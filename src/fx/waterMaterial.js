// Helpers shared by the water effects: patching three.js's built-in materials safely, the two water looks
// (with and without the transmission pass), and small conversions. Every patch throws if three.js's shader text
// no longer has the hook it expects, so an upgrade fails loudly in the tests instead of silently on a phone.
import * as THREE from 'three';
import { GLSL_PREMULTIPLIED_OUT, GLSL_ROUGHNESS_FIX } from './glsl.js';
import { CAMERA, grade } from '../scene/mood.js';

// Insert code after (or before) an anchor that must appear exactly once.
export function inject(src, anchor, code, where = 'after') {
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error(`fx: shader hook "${anchor}" not found (three.js changed?)`);
  if (src.indexOf(anchor, at + anchor.length) >= 0) throw new Error(`fx: shader hook "${anchor}" appears twice`);
  return where === 'before'
    ? src.slice(0, at) + code + '\n' + src.slice(at)
    : src.slice(0, at + anchor.length) + '\n' + code + src.slice(at + anchor.length);
}

export function replaceOnce(src, anchor, code) {
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error(`fx: shader hook "${anchor}" not found (three.js changed?)`);
  if (src.indexOf(anchor, at + anchor.length) >= 0) throw new Error(`fx: shader hook "${anchor}" appears twice`);
  return src.slice(0, at) + code + src.slice(at + anchor.length);
}

// Replace an #include with that chunk's text after editing a line inside it.
export function editChunk(src, chunkName, edits) {
  let chunk = THREE.ShaderChunk[chunkName];
  if (chunk === undefined) throw new Error(`fx: shader chunk "${chunkName}" not found`);
  for (const [from, to] of edits) chunk = replaceOnce(chunk, from, to);
  return replaceOnce(src, `#include <${chunkName}>`, chunk);
}

// Blending for the see-through water look without transmission: colour = reflections + body * alpha.
export function usePremultipliedBlending(mat) {
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendEquationAlpha = THREE.AddEquation;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return mat;
}

// Water that must show behind the shower glass. three.js draws see-through (transparent) things after the glass, which
// writes depth, and leaves them out of the picture of the room the glass refracts: water behind the glass was hidden.
// Drawn with the room instead (the opaque list; renderOrder > 0 puts it after the room's own surfaces): it is still
// blended, as three.js keeps any blending but NormalBlending on for opaque materials, and writes no depth. Needs the
// premultiplied blending above (or another custom blending) already set.
export function drawWithRoom(mat) {
  if (mat.blending === THREE.NormalBlending) throw new Error('fx: drawWithRoom needs a custom blending');
  mat.transparent = false;
  mat.depthWrite = false;
  return mat;
}

// The room's light as the camera sees it, for effects that add their own light on top of it (scene-linear: the light
// a lit wall sends, in a colour the camera shows as neutral grey). The camera (scene/mood.js) exposes the median wall
// to CAMERA[mood].exposure; its white balance is in the tone mapping, so a colour of 1 / whiteGain shows neutral.
// Writes it times `level` (the light switch) into `out` (a Color or Vector3); returns the wall's luminance at level 1.
const EVENING = grade('evening', null);
export function roomWall(ctx, out, level = 1) {
  const g = (ctx && ctx.lightMood && ctx.lightMood.grade) || EVENING;
  const cam = CAMERA[g.name] || CAMERA.evening;
  const wall = cam.exposure / g.exposure;
  const r = 1 / g.whiteGain[0];
  const gg = 1 / g.whiteGain[1];
  const b = 1 / g.whiteGain[2];
  const k = (wall * level) / (0.2126 * r + 0.7152 * gg + 0.0722 * b);
  if (out.isColor) out.setRGB(r * k, gg * k, b * k);
  else out.set(r * k, gg * k, b * k);
  return wall;
}

// The ceiling lamp nearest a point (ctx.downlights' spot lights: the bake's lamps), its world position into `pos` and
// its colour (scene-linear, brightest channel 1) into `colour`. Without lamps (a test room) a stand-in at the ceiling
// 25 cm toward the room's middle, in the camera's neutral white. Returns the lamp object (or null).
export function nearestLamp(ctx, point, pos, colour) {
  const lamps = ctx && ctx.downlights && Array.isArray(ctx.downlights.lamps) ? ctx.downlights.lamps : [];
  let best = null;
  let bestD = Infinity;
  for (const lp of lamps) {
    const l = lp && lp.light;
    if (!l || !l.isLight) continue;
    l.updateWorldMatrix(true, false);
    const e = l.matrixWorld.elements;
    const d = (e[12] - point.x) ** 2 + (e[14] - point.z) ** 2;
    if (d < bestD) { bestD = d; best = l; }
  }
  if (best) {
    const e = best.matrixWorld.elements;
    pos.set(e[12], e[13], e[14]);
    colour.copy(best.color);
    return best;
  }
  const L = (ctx && ctx.layout) || null;
  const W = L ? L.room.W : 2.6;
  const D = L ? L.room.D : 3.0;
  const H = L ? L.room.H : 2.4;
  const dx = W / 2 - point.x;
  const dz = D / 2 - point.z;
  const n = Math.hypot(dx, dz) || 1;
  pos.set(point.x + (dx / n) * 0.25, H - 0.03, point.z + (dz / n) * 0.25);
  roomWall(ctx, colour, 1);
  colour.multiplyScalar(1 / Math.max(colour.r ?? colour.x, colour.g ?? colour.y, colour.b ?? colour.z));
  return null;
}

// A water material. transmission true: MeshPhysicalMaterial refracting what is behind it (costs a second render of
// the opaque scene when visible; three.js shares that pass with the shower glass). false: MeshStandardMaterial with
// the see-through blending above. patch(shader, mode) adds the effect's own shader code; key names the program.
export function makeWaterMaterial({ transmission, key, patch, color = 0xffffff, roughness = 0.03, thickness = 0.01,
  attenuationColor = 0xdcf2f4, attenuationDistance = 0.5, side = THREE.FrontSide, depthWrite = true }) {
  let mat;
  if (transmission) {
    mat = new THREE.MeshPhysicalMaterial({
      color, roughness, metalness: 0, transmission: 1, ior: 1.333, thickness,
      attenuationColor: new THREE.Color(attenuationColor), attenuationDistance, specularIntensity: 1,
      transparent: true, depthWrite, side,
    });
  } else {
    mat = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, side });
    usePremultipliedBlending(mat);
  }
  const mode = transmission ? 'transmission' : 'blend';
  mat.name = `fx-${key}-${mode}`;
  mat.onBeforeCompile = (shader) => {
    patch(shader, mode);
    shader.fragmentShader = inject(shader.fragmentShader, '#include <lights_physical_fragment>', GLSL_ROUGHNESS_FIX);
    if (mode === 'blend') shader.fragmentShader = replaceOnce(shader.fragmentShader, '#include <opaque_fragment>', GLSL_PREMULTIPLIED_OUT);
  };
  mat.customProgramCacheKey = () => `fx-${key}-${mode}`;
  return mat;
}

// Small droplets (splashes, the shower-head drip): always the cheap see-through look; tiny objects should never
// trigger the transmission pass on their own.
export function makeDropMaterial(key = 'drop') {
  return makeWaterMaterial({
    transmission: false,
    key,
    roughness: 0.04,
    depthWrite: false,
    patch(shader) {
      shader.fragmentShader = inject(shader.fragmentShader, '#include <normal_fragment_maps>', /* glsl */ `
	float fxAlpha = 0.16 + 0.7 * pow( 1.0 - clamp( abs( dot( normal, normalize( vViewPosition ) ) ), 0.0, 1.0 ), 3.0 );`);
    },
  });
}

// A point from { x, y, z }, a Vector3, or a fixture anchor (an Object3D: its world position).
export function toVec3(v, fallback) {
  const src = v ?? fallback;
  if (src && src.isObject3D) {
    src.updateWorldMatrix(true, false);
    return src.getWorldPosition(new THREE.Vector3());
  }
  return new THREE.Vector3(src.x, src.y, src.z);
}

export function qualityOf(ctx) {
  return ctx && ctx.quality === 'low' ? 'low' : 'high';
}

// dt from the render loop is in milliseconds (like core/tween.js); effects step in seconds, capped so a stalled tab
// does not jump the simulation.
export function stepSeconds(dtMs, capMs = 100) {
  if (!(dtMs > 0)) return 0;
  return Math.min(dtMs, capMs) / 1000;
}

// World-space size of one screen pixel at 1 m from the camera, for keeping thin streaks at least a pixel wide.
const _size = new THREE.Vector2();
export function pixelWorldAt1m(ctx) {
  const cam = ctx && ctx.camera;
  const fov = cam && cam.isPerspectiveCamera ? cam.fov : 50;
  let h = 1080;
  if (ctx && ctx.renderer && typeof ctx.renderer.getDrawingBufferSize === 'function') {
    ctx.renderer.getDrawingBufferSize(_size);
    if (_size.y > 0) h = _size.y;
  }
  return (2 * Math.tan((fov * Math.PI) / 360)) / h;
}
