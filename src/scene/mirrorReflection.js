// The mirror's live reflection. The owner, 2026-10-19: "Also mirror should like mirror, I can't see reflection." The
// doors showed a photograph of the room taken once from its middle (scene/roomEnvironment.js): soft, still, and wrong
// for anything near. Now the shut doors' glass shows the room the way the visitor's own eye sees it in a mirror: the
// room is drawn a second time, from the eye mirrored in the glass, into a picture the glass shows (the method of
// three.js's Reflector, addons/objects/Reflector.js, with what this room needs on top):
// - one picture for both doors while they are shut (their glass is one plane; the 3 mm gap between them stays open,
//   its dark stop shows through); a door off zero shows its own face again (the room's photograph, box-projected),
//   which swings with it;
// - drawn only for the visitor's own view, only while the glass is on screen and seen from its front; and only the
//   glass's patch of the picture, through a frustum that just holds the glass (what lies outside it is never drawn:
//   the picture costs what the glass covers on the screen);
// - never in a photograph of the room (roomEnvironment.js captureHides leaves it out, and a photograph's camera never
//   sets it off: it answers the visitor's camera only);
// - sharpness by device: a computer as sharp as its screen with smoothed edges, a phone three quarters, a weak device
//   0.4 and every other frame; it follows the screen's size (a turned phone, the frame-rate governor's lower sharpness);
// - linear and full-range until the screen: the glass multiplies the picture by the silvered glass's reflectance (the
//   'mirror' material's colour, about 82 %, a little more at a slant) and the camera's tone curve and colour encoding
//   follow once, as for everything else. Lamp lenses are drawn without the tone curve (a fixed colour on the screen):
//   while the reflection is drawn they carry the brightness the curve shows as that colour, so a lamp in the glass is
//   as bright as the lamp.
// The fog overlays ride on the doors' faces and still show (a face draws nothing while the live mirror lies on it; its
// children do); the LED display, the LED strip's light, the light switch and the toilet swap are simply part of the
// room it draws. The display's area reflects less, as on the doors' own glass (fixtures/mirrorCabinet.js DISPLAY_DIM).
//
// What it costs on a phone, and when it rests (2026-10-19, measured: tmp/wave3/fix-perf.md). A strong phone facing the
// vanity drew 315 draw calls a frame, 204 of them for the mirror: the room again (109), and three.js's see-through pass
// for the shower glass and the frosted window inside the mirror's view (95). Now:
// - the mirror's pass draws no see-through thing: a pane is drawn in it as plain glass (the shower glass as the eye's
//   clear glass, roomEnvironment.js createGlassSwitch, or the library's 'glassSimple' without one; the window as its own
//   plain glow: scene/outside.js plainPane); see-through running water (the tap's stream, the basin's water) is left
//   out (the shower's water is drawn with the room and so shows in the mirror);
// - it rests (the doors' own glass, the room's photograph, shows) while the visitor stands in the hallway and none of
//   the glass can be seen through the opening past the leaf (roomEnvironment.js seenThroughDoor: it wakes the moment
//   some may show), and under thick fog until a finger or the demister clears some of it (FOG_REST);
// - on a weak device ('low'), and after the frame governor's 'mirrorLow' step (setPlan('low')), the picture is drawn
//   every other frame at 0.4 of the screen (the glass shows the last one in between);
// - setLive(false) turns it off for good (the frame governor's 'mirror' step, its last mirror step: core/quality.js
//   GOVERNOR_STEPS);
// - the hook makes no garbage per frame, from the room or the hallway.
//
// createMirrorReflection(ctx, { coarse, whiteGain, lamps, clipBias, quality }) -> { mesh, renderTarget, camera, plan,
//   stats, textureMatrix, lamps, beforeRender(renderer, scene, camera), refresh(), setLive(on), setPlan(tier), live,
//   failed, dispose() }. It installs itself as the scene's before-render hook (keeping one that was there): three.js
//   calls it at the start of every renderer.render(scene, camera).
import * as THREE from 'three';
import { hingeAngle, hingeBelow, seenThroughDoor } from './roomEnvironment.js';
import { DISPLAY_GLSL, DISPLAY_GLSL_PARS, displayUniforms } from '../fixtures/mirrorCabinet.js';

export { hingeAngle };

// Sharpness by device (core/quality.js 'high' | 'low'; a coarse pointer is a phone): the picture's size against the
// screen's drawing buffer, its longest side, its edge smoothing (multisampling), and how often it is drawn (frames).
export const REFLECTION = {
  pc: { scale: 1, maxSide: 1920, samples: 4, every: 1 },
  phone: { scale: 0.75, maxSide: 1280, samples: 0, every: 1 },
  low: { scale: 0.4, maxSide: 640, samples: 0, every: 2 },
};
export const SHUT_RAD = 1e-4; // a mirror door this close to zero is shut (0.03 mm at its free edge)
// Thick fog (density at or over `dense`; thin again under `thin`, so it never flickers between the two) hides the
// glass except where it is clear: the LED display's own patch (always), a written line, a finger's wipes, the
// demister. The live mirror rests while no more than `wiped` of the glass (outside the display) is clear beyond the
// line being written or held; it is judged every `every` frames.
export const FOG_REST = { dense: 0.75, thin: 0.7, wiped: 0.003, every: 8 };

export function reflectionPlan(quality, coarse) {
  const tier = quality === 'low' ? 'low' : coarse ? 'phone' : 'pc';
  return { tier, ...REFLECTION[tier] };
}

// The picture's size for a drawing buffer of w x h pixels (written into out when given).
export function targetSize(plan, w, h, out = { width: 1, height: 1 }) {
  const sw = Math.max(0, w) * plan.scale;
  const sh = Math.max(0, h) * plan.scale;
  const k = Math.min(1, plan.maxSide / Math.max(sw, sh, 1e-9));
  out.width = Math.max(1, Math.round(sw * k));
  out.height = Math.max(1, Math.round(sh * k));
  return out;
}

// The two doors' glass while shut, in the cabinet's own frame: { left: { x0, x1, y0, y1 }, right: {...}, z }.
export function mirrorRects(cabinet) {
  const out = {};
  let z = null;
  for (const side of ['Left', 'Right']) {
    const face = cabinet.parts[`door${side}Face`];
    const pivot = cabinet.parts[`door${side}Pivot`];
    if (!face.geometry.boundingBox) face.geometry.computeBoundingBox();
    face.updateMatrix();
    const rest = new THREE.Matrix4().compose(pivot.userData.rest || pivot.position, new THREE.Quaternion(), pivot.scale);
    const box = face.geometry.boundingBox.clone().applyMatrix4(rest.multiply(face.matrix));
    if (z === null) z = box.max.z;
    else if (Math.abs(box.max.z - z) > 5e-4) throw new Error('the mirror doors\' glass is not one plane');
    out[side.toLowerCase()] = { x0: box.min.x, x1: box.max.x, y0: box.min.y, y1: box.max.y };
  }
  out.z = z;
  return out;
}

// Where rectangles on the glass (its own frame, z = 0) land in the picture's uv (0..1: the screen, mirrored), counting
// only what lies in front of the eye (each rectangle is cut at the eye's plane): { u0, u1, v0, v1 } (written into out
// when given), or null when all of it is behind the eye. matrix: the glass's texture matrix (its frame -> the
// picture's homogeneous uv).
const _corners = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
function putPoint(out, x, y, w) {
  const u = x / w;
  const v = y / w;
  if (u < out.u0) out.u0 = u;
  if (u > out.u1) out.u1 = u;
  if (v < out.v0) out.v0 = v;
  if (v > out.v1) out.v1 = v;
}
export function glassPatch(rects, matrix, eps = 1e-4, out = null) {
  const box = out || { u0: 0, u1: 0, v0: 0, v1: 0 };
  box.u0 = Infinity; box.u1 = -Infinity; box.v0 = Infinity; box.v1 = -Infinity;
  for (let r = 0; r < rects.length; r++) {
    const g = rects[r];
    _corners[0].set(g.x0, g.y0, 0, 1).applyMatrix4(matrix);
    _corners[1].set(g.x1, g.y0, 0, 1).applyMatrix4(matrix);
    _corners[2].set(g.x1, g.y1, 0, 1).applyMatrix4(matrix);
    _corners[3].set(g.x0, g.y1, 0, 1).applyMatrix4(matrix);
    for (let i = 0; i < 4; i++) {
      const a = _corners[i];
      const b = _corners[(i + 1) % 4];
      if (a.w >= eps) putPoint(box, a.x, a.y, a.w);
      if ((a.w - eps) * (b.w - eps) < 0) { // the edge passes the eye's plane: where it does
        const t = (eps - a.w) / (b.w - a.w);
        putPoint(box, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, eps);
      }
    }
  }
  return box.u0 === Infinity ? null : box;
}

// The share of the glass the fog leaves clear, by how clear each pixel is (a pixel half grown over counts half),
// outside rect (the LED display's own patch, which its demister keeps clear: in mask pixels, as fx/fogMask.js
// heatRect takes it). mask: the fog's grid (fx/fogMask.js createMask).
export function clearShare(mask, rect = null) {
  const { w, h, data } = mask;
  let i0 = 0;
  let i1 = -1;
  let j0 = 0;
  let j1 = -1;
  if (rect) {
    i0 = Math.max(0, Math.ceil(rect.x0 - 0.5));
    i1 = Math.min(w - 1, Math.floor(rect.x1 - 0.5 - 1e-9));
    j0 = Math.max(0, Math.ceil(rect.y0 - 0.5));
    j1 = Math.min(h - 1, Math.floor(rect.y1 - 0.5 - 1e-9));
  }
  const left = w * h - (i1 >= i0 && j1 >= j0 ? (i1 - i0 + 1) * (j1 - j0 + 1) : 0);
  if (!mask.active || !(left > 0)) return 0;
  let sum = 0;
  const x0 = Math.max(0, mask.bx0);
  const x1 = Math.min(w - 1, mask.bx1);
  for (let j = Math.max(0, mask.by0), jEnd = Math.min(h - 1, mask.by1); j <= jEnd; j++) {
    const row = j * w;
    const skipRow = j >= j0 && j <= j1;
    for (let i = x0; i <= x1; i++) {
      if (skipRow && i >= i0 && i <= i1) continue;
      sum += data[row + i];
    }
  }
  return sum / left;
}

// rects in the cabinet's frame (x across the mirror from its middle, y up from its bottom); W, H: the whole mirror's
// size. uv is the doors' own (fixtures/mirrorCabinet.js: u across both doors, v bottom to top), for the screen's area.
function glassGeometry(rects, W, H) {
  const pos = [];
  for (const r of [rects.left, rects.right]) pos.push(r.x0, r.y0, 0, r.x1, r.y0, 0, r.x0, r.y1, 0, r.x1, r.y1, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
  const uv = [];
  for (let i = 0; i < pos.length; i += 3) uv.push((pos[i] + W / 2) / W, pos[i + 1] / H);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7]); // left door: indices 0-5, right door: 6-11
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

// The glass: the picture (projected from the mirrored eye: uMirrorMatrix) times the reflectance, less over the screen's
// area (fixtures/mirrorCabinet.js DISPLAY_DIM, as the doors' own glass), then the room's tone curve and colour encoding
// (three.js adds them for the screen, and leaves them out inside a picture).
export const MIRROR_GLSL = {
  vertex: /* glsl */ `
uniform mat4 uMirrorMatrix;
varying vec4 vMirrorUv;
varying vec3 vMirrorWorld;
varying vec3 vMirrorNormal;
varying vec2 vMirrorFaceUv;
void main() {
	vMirrorUv = uMirrorMatrix * vec4( position, 1.0 );
	vMirrorWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
	vMirrorNormal = normalize( mat3( modelMatrix ) * normal );
	vMirrorFaceUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`,
  fragment: /* glsl */ `
uniform sampler2D uMirrorMap;
uniform vec3 uMirrorTint;
${DISPLAY_GLSL_PARS}
varying vec4 vMirrorUv;
varying vec3 vMirrorWorld;
varying vec3 vMirrorNormal;
varying vec2 vMirrorFaceUv;
${DISPLAY_GLSL}
void main() {
	float c = clamp( dot( normalize( cameraPosition - vMirrorWorld ), normalize( vMirrorNormal ) ), 0.0, 1.0 );
	vec3 reflectance = uMirrorTint + ( 1.0 - uMirrorTint ) * pow( 1.0 - c, 5.0 );
	gl_FragColor = vec4( texture2D( uMirrorMap, vMirrorUv.xy / vMirrorUv.w ).rgb * reflectance * bathDisplayShade( vMirrorFaceUv ), 1.0 );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`,
};

// Replaces the near plane of a perspective projection by a plane (in the camera's view space, (normal, constant),
// the kept side positive): what lies behind the glass is cut away, whatever touches it in front is kept. Lengyel's
// oblique frustum, as three.js's Reflector writes it. clipBias > 0 would keep a sliver behind the plane.
const _q = new THREE.Vector4();
export function obliqueNear(projection, plane, clipBias = 0) {
  const e = projection.elements;
  _q.set((Math.sign(plane.x) + e[8]) / e[0], (Math.sign(plane.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
  plane.multiplyScalar(2 / plane.dot(_q));
  e[2] = plane.x;
  e[6] = plane.y;
  e[10] = plane.z + 1 - clipBias;
  e[14] = plane.w;
  return projection;
}

// ---- lamps in the glass
// AgX on a grey value as three.js 0.186.1 draws it (tonemapping_pars_fragment: its colour matrices keep grey grey):
// linear in (after the exposure), linear out.
const AGX_MIN = -12.47393;
const AGX_MAX = 4.026069;
function agxCurve(v) {
  const v2 = v * v;
  const v4 = v2 * v2;
  return 15.5 * v4 * v2 - 40.14 * v4 * v + 31.96 * v4 - 6.868 * v2 * v + 0.4298 * v2 + 0.1191 * v - 0.00232;
}
const agxOut = (v) => Math.min(1, Math.max(0, agxCurve(v)) ** 2.2);
export function agxGrey(x) {
  const v = Math.min(1, Math.max(0, (Math.log2(Math.max(x, 1e-10)) - AGX_MIN) / (AGX_MAX - AGX_MIN)));
  return agxOut(v);
}
// The grey that AgX shows as y (y at or above the curve's top: the top, 2^4.03 = 16.3).
export function agxGreyInverse(y) {
  if (!(y > 0)) return 0;
  if (y >= agxOut(1)) return 2 ** AGX_MAX;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (agxOut(mid) < y) lo = mid;
    else hi = mid;
  }
  return 2 ** ((lo + hi) / 2 * (AGX_MAX - AGX_MIN) + AGX_MIN);
}
// A lens drawn without the tone curve shows its colour c (linear) as it is; in the glass it passes the curve (after
// the exposure and the camera's white balance gain): this is the colour that the curve shows as c (written into out).
export function lampBoost(c, exposure, gain = [1, 1, 1], out = [0, 0, 0]) {
  const e = Math.max(1e-6, exposure);
  for (let i = 0; i < 3; i++) out[i] = c[i] > 0 ? agxGreyInverse(c[i]) / (e * Math.max(1e-6, gain[i])) : 0;
  return out;
}
// Lamp lenses: plain colours drawn without the tone curve (scene/lighting.js, scene/hallway.js); a screen's glow
// (additive, with a picture) is not one.
export function findLamps(scene) {
  const out = [];
  scene.traverse((o) => {
    const m = o.isMesh ? o.material : null;
    if (!m || Array.isArray(m) || !m.isMeshBasicMaterial || m.toneMapped !== false) return;
    if (m.map || m.transparent || m.blending !== THREE.NormalBlending || out.includes(m)) return;
    out.push(m);
  });
  return out;
}

const NO_GAIN = [1, 1, 1];
const clampTo = (v, n) => Math.min(n, Math.max(0, v));
const seeThroughMaterial = (m) => !!m && m.transmission > 0;

// ---- the live mirror
export function createMirrorReflection(ctx, opts = {}) {
  const { scene, renderer } = ctx;
  const eyeCamera = ctx.camera;
  const cabinet = opts.cabinet || (ctx.fixtures && ctx.fixtures.mirrorCabinet);
  if (!cabinet) throw new Error('no mirror cabinet to reflect in');
  const parts = cabinet.parts;
  const plan = reflectionPlan(opts.quality || ctx.quality, !!opts.coarse);
  const clipBias = opts.clipBias ?? 0; // nothing touches the glass in front: the cut is the glass itself
  const rects = mirrorRects(cabinet);
  const shownRects = [[rects.left, rects.right], [rects.left], [rects.right]]; // both shut, the left only, the right only

  const ext = renderer && renderer.extensions;
  const halfFloat = !ext || ext.has('EXT_color_buffer_half_float') || ext.has('EXT_color_buffer_float');
  const size = new THREE.Vector2();
  const want = { width: 1, height: 1 };
  if (renderer && renderer.getDrawingBufferSize) {
    renderer.getDrawingBufferSize(size);
    targetSize(plan, size.x, size.y, want);
  }
  const renderTarget = new THREE.WebGLRenderTarget(want.width, want.height, {
    samples: plan.samples, type: halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
  });
  renderTarget.texture.name = 'bath-mirror-reflection';

  const textureMatrix = new THREE.Matrix4();
  const mirrorMat = ctx.materials && ctx.materials.has && ctx.materials.has('mirror') ? ctx.materials.get('mirror') : null;
  const material = new THREE.ShaderMaterial({
    name: 'bath-mirror',
    uniforms: {
      uMirrorMap: { value: renderTarget.texture },
      uMirrorMatrix: { value: textureMatrix },
      uMirrorTint: { value: mirrorMat ? mirrorMat.color : new THREE.Color(0xe9ece9) }, // the library's silvered glass
      ...displayUniforms(ctx.layout), // the screen's area reflects less (as the doors' own glass)
    },
    vertexShader: MIRROR_GLSL.vertex,
    fragmentShader: MIRROR_GLSL.fragment,
  });
  const geometry = glassGeometry(rects, ctx.layout.mirror.x1 - ctx.layout.mirror.x0, ctx.layout.mirror.y1 - ctx.layout.mirror.y0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'mirrorCabinet.reflection';
  mesh.isReflector = true; // never in a photograph of the room (roomEnvironment.js captureHides)
  mesh.position.set(0, 0, rects.z);
  mesh.renderOrder = 1; // after the room's solid things: it lies exactly on the doors' glass and wins there
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = () => {}; // a touch lands on the door behind it (the doors keep their handlers)
  cabinet.group.add(mesh);
  parts.reflection = mesh;

  // a shut door's face draws nothing (the live mirror lies on it); its children (the fog) still do
  const under = new THREE.MeshBasicMaterial({ visible: false });
  under.name = 'mirror-face-under-reflection';
  const doors = ['Left', 'Right'].map((side) => ({ face: parts[`door${side}Face`], pivot: parts[`door${side}Pivot`], own: parts[`door${side}Face`].material }));
  const setFace = (d, shut) => {
    const wantMat = shut ? under : d.own;
    if (d.face.material !== wantMat) d.face.material = wantMat;
  };

  const camera = new THREE.PerspectiveCamera().copy(eyeCamera, false);
  camera.name = 'mirror-reflection-eye';
  // three.js sizes a see-through thing's own picture by the camera's viewport when it has one (the mirror's pass draws
  // none now; kept so that one never makes a new picture each frame)
  camera.viewport = new THREE.Vector4();
  const lamps = opts.lamps || findLamps(scene);
  const whiteGain = opts.whiteGain || NO_GAIN;
  const savedLamps = new Float64Array(lamps.length * 3);
  // each lens's boosted colour, worked out again only when its colour, the exposure or the white balance changes
  const lampIn = new Float64Array(lamps.length * 3).fill(NaN);
  const lampOut = new Float64Array(lamps.length * 3);
  const lampKey = new Float64Array(4).fill(NaN); // the exposure and the gain the boosts were worked out for
  const boost = [0, 0, 0];
  const lens = [0, 0, 0];
  const stats = {
    renders: 0, last: null,
    skipped: { open: 0, behind: 0, door: 0, fog: 0, offscreen: 0, rate: 0, off: 0 },
  };
  let busy = false;
  let failed = false;
  let disposed = false;
  let live = true;
  let frameNo = 0;
  let pictureOk = false; // the picture on the glass belongs to the frame it was drawn in (the weak device's rate)
  let drawnAt = -1;
  let drawnRange = -1;

  const glassPoint = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const look = new THREE.Vector3();
  const target = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const rotation = new THREE.Matrix4();
  const crop = new THREE.Matrix4();
  const plane = new THREE.Plane();
  const clip = new THREE.Vector4();
  const patch = { u0: 0, u1: 0, v0: 0, v1: 0 };

  const skip = (reason) => { stats.last = reason; stats.skipped[reason]++; return false; };
  // the doors' own glass again (the room's photograph): nothing of the live mirror shows
  function rest(reason) {
    setFace(doors[0], false);
    setFace(doors[1], false);
    mesh.visible = false;
    pictureOk = false;
    return skip(reason);
  }

  // From the hallway: none of the glass can be seen through the opening past the leaf (the shut door's or the turning
  // leaf's). It waited for the door's angle (30 degrees), but part of the glass shows through the gap earlier from
  // many hallway spots: the picture jumped from the photograph to the live one mid-swing (review 2026-10-20, finding
  // 4). Judged on the glass's box: it wakes when the glass may be seen, never later.
  const glassBox = new THREE.Box3();
  function doorHides(p) {
    const L = ctx.layout;
    const parts = ctx.door && ctx.door.parts;
    if (!parts || !parts.leafPivot || !L || !L.room || !(p.z > L.room.D)) return false;
    if (parts.leaf) parts.leaf.updateWorldMatrix(true, false);
    glassBox.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
    return !seenThroughDoor(L, p, parts.leafPivot, parts.leaf, glassBox);
  }

  // Thick fog hides the glass but where it is clear. While a line is being written the live mirror rests (the line
  // shows the doors' own glass, as a 1.4 cm stroke would show the live one); while it is held, until more than the
  // line is cleared (a finger, or the demister starting); with no line, until anything outside the display is clear.
  const displayUv = ctx.layout && ctx.layout.mirror && ctx.layout.mirror.display;
  const displayRect = { x0: 0, x1: 0, y0: 0, y1: 0 };
  let fogDense = false;
  let fogHide = false;
  let fogBase = -1;
  let fogJudged = -1;
  function fogHides() {
    const fog = ctx.fx && ctx.fx.mirrorFog;
    if (!fog || !fog.mask) return false;
    fogDense = fogDense ? fog.density >= FOG_REST.thin : fog.density >= FOG_REST.dense;
    if (!fogDense) {
      fogHide = false;
      fogBase = -1;
      fogJudged = -1;
      return false;
    }
    if (fogJudged >= 0 && frameNo - fogJudged < FOG_REST.every) return fogHide;
    fogJudged = frameNo;
    const m = fog.mask;
    let share;
    if (displayUv) {
      displayRect.x0 = displayUv.u0 * m.w;
      displayRect.x1 = displayUv.u1 * m.w;
      displayRect.y0 = displayUv.v0 * m.h;
      displayRect.y1 = displayUv.v1 * m.h;
      share = clearShare(m, displayRect);
    } else share = clearShare(m, null);
    if (fog.writing) {
      fogBase = share;
      fogHide = true;
    } else if (fog.holding > 0) {
      if (fogBase < 0) fogBase = share;
      fogHide = share <= fogBase + FOG_REST.wiped;
    } else {
      fogBase = -1;
      fogHide = share <= FOG_REST.wiped;
    }
    return fogHide;
  }

  // See-through things would make three.js run a see-through pass of the mirror's own: in the mirror's pass a pane is
  // drawn as plain glass, anything else see-through (running water) is left out. Found again when the scene changes.
  const seeThrough = []; // { mesh, standIn (a material, or null: left out), own (while swapped), hid }
  let scanned = -1;
  function standInFor(o) {
    if (Array.isArray(o.material)) return null;
    const pane = ctx.fixtures && ctx.fixtures.window && ctx.fixtures.window.parts && ctx.fixtures.window.parts.glass;
    if (o === pane && ctx.outside && typeof ctx.outside.plainPane === 'function') return ctx.outside.plainPane(null);
    const lib = ctx.materials && ctx.materials.has && ctx.materials.has('glassSimple') ? ctx.materials.get('glassSimple') : null;
    if (lib && (o === pane || o.material.name === 'glass')) return lib;
    return null;
  }
  function refresh() {
    seeThrough.length = 0;
    scene.traverse((o) => {
      if (!o.isMesh || o === mesh) return;
      // (the shower glass also while the eye draws it as clear glass: roomEnvironment.js createGlassSwitch)
      if (o.userData.bathSeeThrough || (Array.isArray(o.material) ? o.material.some(seeThroughMaterial) : seeThroughMaterial(o.material))) {
        seeThrough.push({ mesh: o, standIn: standInFor(o), own: null, hid: false });
      }
    });
    scanned = scene.children.length;
  }
  refresh();
  // A pane the eye draws as clear glass from the hallway (ctx.glassSwitch) is that clear glass in the mirror in both
  // states: the mirror's picture does not change when the eye's glass does; drawn as it is, it needs no stand-in.
  function plainGlass() {
    const sw = ctx.glassSwitch;
    for (let i = 0; i < seeThrough.length; i++) {
      const e = seeThrough[i];
      const o = e.mesh;
      e.own = null;
      e.hid = false;
      if (!o.visible) continue;
      const m = o.material;
      if (!(Array.isArray(m) ? m.some(seeThroughMaterial) : seeThroughMaterial(m))) continue;
      e.own = m;
      const standIn = sw && sw.has(o) ? sw.plain : e.standIn;
      if (standIn && !Array.isArray(m)) o.material = standIn;
      else { o.visible = false; e.hid = true; }
    }
  }
  function ownGlass() {
    for (let i = 0; i < seeThrough.length; i++) {
      const e = seeThrough[i];
      if (e.own === null) continue;
      if (e.hid) e.mesh.visible = true;
      else e.mesh.material = e.own;
      e.own = null;
      e.hid = false;
    }
  }

  function fail(e) {
    failed = true;
    for (const d of doors) d.face.material = d.own;
    mesh.visible = false;
    console.warn('the mirror shows the room\'s photograph only (its live reflection failed):', e);
  }

  // while the reflection is drawn, a lamp lens carries the brightness the tone curve shows as its colour
  function boostLamps(r) {
    const gain = r.toneMapping === THREE.CustomToneMapping ? whiteGain : r.toneMapping === THREE.AgXToneMapping ? NO_GAIN : null;
    if (!gain || !lamps.length) return false;
    const exposure = r.toneMappingExposure ?? 1;
    const anew = exposure !== lampKey[0] || gain[0] !== lampKey[1] || gain[1] !== lampKey[2] || gain[2] !== lampKey[3];
    if (anew) {
      lampKey[0] = exposure;
      lampKey[1] = gain[0];
      lampKey[2] = gain[1];
      lampKey[3] = gain[2];
    }
    for (let i = 0; i < lamps.length; i++) {
      const c = lamps[i].color;
      const k = 3 * i;
      savedLamps[k] = c.r;
      savedLamps[k + 1] = c.g;
      savedLamps[k + 2] = c.b;
      if (anew || c.r !== lampIn[k] || c.g !== lampIn[k + 1] || c.b !== lampIn[k + 2]) {
        lampIn[k] = lens[0] = c.r;
        lampIn[k + 1] = lens[1] = c.g;
        lampIn[k + 2] = lens[2] = c.b;
        lampBoost(lens, exposure, gain, boost);
        lampOut[k] = boost[0];
        lampOut[k + 1] = boost[1];
        lampOut[k + 2] = boost[2];
      }
      c.r = lampOut[k];
      c.g = lampOut[k + 1];
      c.b = lampOut[k + 2];
    }
    return true;
  }
  function restoreLamps() {
    for (let i = 0; i < lamps.length; i++) {
      const c = lamps[i].color;
      c.r = savedLamps[3 * i];
      c.g = savedLamps[3 * i + 1];
      c.b = savedLamps[3 * i + 2];
    }
  }

  // The hook: called by three.js at the start of each renderer.render(scene, camera), after the scene's matrices are
  // brought up to date. Returns whether a reflection was drawn.
  function beforeRender(r, s, cam) {
    if (busy || failed || disposed || cam !== eyeCamera || !r) return false;
    frameNo++;
    if (!live) return rest('off');
    const L = doors[0];
    const R = doors[1];
    const leftShut = hingeBelow(L.pivot, SHUT_RAD);
    const rightShut = hingeBelow(R.pivot, SHUT_RAD);
    if (!leftShut && !rightShut) return rest('open');

    // the glass, and the eye in front of it
    mesh.updateWorldMatrix(true, false);
    cam.updateWorldMatrix(true, false);
    glassPoint.setFromMatrixPosition(mesh.matrixWorld);
    rotation.extractRotation(mesh.matrixWorld);
    normal.set(0, 0, 1).applyMatrix4(rotation).normalize();
    eye.setFromMatrixPosition(cam.matrixWorld);
    if (tmp.subVectors(eye, glassPoint).dot(normal) <= 0) return rest('behind');
    if (doorHides(eye)) return rest('door');
    if (fogHides()) return rest('fog');

    // the live glass on the shut doors
    setFace(L, leftShut);
    setFace(R, rightShut);
    mesh.visible = true;
    const range = leftShut && rightShut ? 0 : leftShut ? 1 : 2;
    geometry.setDrawRange(leftShut ? 0 : 6, leftShut && rightShut ? 12 : 6);
    // a weak device: every other frame the glass keeps the last picture (with the matrix it was drawn with)
    if (plan.every > 1 && pictureOk && range === drawnRange && frameNo - drawnAt < plan.every) return skip('rate');

    // the eye mirrored in the glass, looking where the eye looks, mirrored
    rotation.extractRotation(cam.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rotation).add(eye);
    target.subVectors(glassPoint, look).reflect(normal).negate().add(glassPoint);
    camera.position.subVectors(glassPoint, eye).reflect(normal).negate().add(glassPoint);
    camera.up.set(0, 1, 0).applyMatrix4(rotation).reflect(normal);
    camera.lookAt(target);
    camera.near = cam.near;
    camera.far = cam.far;
    camera.layers.mask = cam.layers.mask;
    camera.updateMatrixWorld();

    // the picture fits the screen; the glass looks up its pixel through the eye's own projection, mirrored
    if (r.getDrawingBufferSize) {
      r.getDrawingBufferSize(size);
      targetSize(plan, size.x, size.y, want);
      if (want.width !== renderTarget.width || want.height !== renderTarget.height) renderTarget.setSize(want.width, want.height);
    }
    textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(cam.projectionMatrix).multiply(camera.matrixWorldInverse).multiply(mesh.matrixWorld);

    // the glass's patch of the picture: where the shown doors land, the part of them in front of the eye only
    const W = renderTarget.width;
    const H = renderTarget.height;
    const box = glassPatch(shownRects[range], textureMatrix, 1e-4, patch);
    if (!box) return rest('offscreen'); // all of it behind the eye
    // in whole pixels and a pixel more, within the picture: nothing left means beside the screen
    const px0 = clampTo(Math.floor(box.u0 * W) - 1, W); const px1 = clampTo(Math.ceil(box.u1 * W) + 1, W);
    const py0 = clampTo(Math.floor(box.v0 * H) - 1, H); const py1 = clampTo(Math.ceil(box.v1 * H) + 1, H);
    if (px1 - px0 < 1 || py1 - py0 < 1) return rest('offscreen');
    // a frustum that just holds that patch (nothing outside it is drawn), its near plane the glass (the crop's four
    // numbers written straight in: handing computed numbers to a function that is not inlined makes garbage)
    const x0n = (2 * px0) / W - 1; const x1n = (2 * px1) / W - 1;
    const y0n = (2 * py0) / H - 1; const y1n = (2 * py1) / H - 1;
    const ce = crop.elements; // column-major: x scale, y scale, x offset, y offset
    ce[0] = 2 / (x1n - x0n);
    ce[5] = 2 / (y1n - y0n);
    ce[12] = -(x1n + x0n) / (x1n - x0n);
    ce[13] = -(y1n + y0n) / (y1n - y0n);
    camera.projectionMatrix.multiplyMatrices(crop, cam.projectionMatrix);
    plane.setFromNormalAndCoplanarPoint(normal, glassPoint).applyMatrix4(camera.matrixWorldInverse);
    obliqueNear(camera.projectionMatrix, clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant), clipBias);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    renderTarget.viewport.set(px0, py0, px1 - px0, py1 - py0);
    renderTarget.scissor.copy(renderTarget.viewport);
    renderTarget.scissorTest = true;
    camera.viewport.set(0, 0, W, H);

    // draw the room into it: without the glass itself, the room's matrices as they are this frame
    if (scene.children.length !== scanned) refresh();
    const before = r.getRenderTarget();
    const xrWas = r.xr ? r.xr.enabled : false;
    const shadowsWere = r.shadowMap ? r.shadowMap.autoUpdate : false;
    const worldWas = s.matrixWorldAutoUpdate;
    const lit = boostLamps(r);
    busy = true;
    mesh.visible = false;
    try {
      plainGlass();
      if (r.xr) r.xr.enabled = false;
      if (r.shadowMap) r.shadowMap.autoUpdate = false;
      s.matrixWorldAutoUpdate = false;
      r.setRenderTarget(renderTarget);
      if (r.state && r.state.buffers) r.state.buffers.depth.setMask(true); // so the depth can be cleared (three.js #18897)
      if (r.autoClear === false) r.clear();
      r.render(s, camera);
      stats.renders++;
      stats.last = 'rendered';
      pictureOk = true;
      drawnAt = frameNo;
      drawnRange = range;
    } catch (e) {
      fail(e);
    } finally {
      ownGlass();
      if (lit) restoreLamps();
      s.matrixWorldAutoUpdate = worldWas;
      if (r.shadowMap) r.shadowMap.autoUpdate = shadowsWere;
      if (r.xr) r.xr.enabled = xrWas;
      r.setRenderTarget(before);
      mesh.visible = !failed;
      busy = false;
    }
    return !failed;
  }

  const hadOwnHook = Object.prototype.hasOwnProperty.call(scene, 'onBeforeRender');
  const earlier = scene.onBeforeRender;
  function hook(r, s, cam, rt) {
    if (hadOwnHook) earlier.call(this, r, s, cam, rt);
    beforeRender(r, s, cam);
  }
  scene.onBeforeRender = hook;

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (scene.onBeforeRender === hook) {
      if (hadOwnHook) scene.onBeforeRender = earlier;
      else delete scene.onBeforeRender;
    }
    for (const d of doors) d.face.material = d.own;
    mesh.removeFromParent();
    if (parts.reflection === mesh) delete parts.reflection;
    renderTarget.dispose();
    material.dispose();
    geometry.dispose();
    under.dispose();
  }

  return {
    mesh, renderTarget, camera, plan, stats, textureMatrix, lamps,
    beforeRender,
    refresh,
    // off for good (the frame governor's 'mirror' step): the doors' own glass, no second drawing of the room
    setLive(on) {
      live = !!on;
      if (!live) rest('off');
    },
    // another device's plan from the next frame (the frame governor's 'mirrorLow' step: 'low', every other frame at
    // 0.4 of the screen); the picture follows (its size each frame; a change of smoothing makes it anew)
    setPlan(tier) {
      const next = REFLECTION[tier];
      if (!next) throw new Error(`no reflection plan '${tier}'`);
      const samples = plan.samples;
      Object.assign(plan, { tier }, next);
      if (plan.samples !== samples) {
        renderTarget.samples = plan.samples;
        renderTarget.dispose();
      }
      pictureOk = false;
    },
    get live() { return live; },
    get failed() { return failed; },
    dispose,
  };
}
