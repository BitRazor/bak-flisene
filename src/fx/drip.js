// A drop now and then from the shower head: it gathers at a nozzle, swells and stretches, lets go, falls and lands
// with a tiny splash. Events for the sound through opts.onEvent(type, info): 'form' (a drop starts to gather),
// 'fall' (it lets go), 'land' (it hits; info.speed in m/s, info.size in m). info is reused between calls.
// It is drawn as the spray's threads are (showerSpray.js: one strip, the same water shader): hanging, a round 4.6 mm
// drop (a darker picture of what is behind it, its rims most, with a highlight on it); falling, a streak 0.03 s of its
// fall long whose highlight runs along it. Drawn with the room, so the shower glass shows it. The highlight follows
// the room's light switch (ctx.downlights' level, or setLightLevel).
//
// createDrip(ctx, opts) -> { object3d, update(dtMs), setActive(on), trigger(), setInterval(min, max), setFrom(v),
//   setTargetY(y), setLightLevel(l), state, speed, dispose }
import * as THREE from 'three';
import { LAYOUT } from '../data/layout.js';
import { makeDropMaterial, toVec3, qualityOf, stepSeconds, pixelWorldAt1m, drawWithRoom, roomWall, nearestLamp } from './waterMaterial.js';
import { SPRAY_LOOK, STRIP_GLSL, GLINT_GLSL, STREAK_FRAGMENT_GLSL, waterShader } from './showerSpray.js';
import { createSplash } from './splash.js';
import { createRng } from './rng.js';
import { floorHeight } from '../data/floor.js';

const G = 9.81;
const DRIP_SPLASH = { out: [0.08, 0.3], up: [0.15, 0.45], size: [0.0004, 0.0009] };
const GLINT_AT = 0.62; // the hanging drop's highlight: on its upper half (its strip runs from the bottom, 0, up)

export const DRIP_GLSL = {
  vertex: /* glsl */ `
uniform vec3 uFxLead;
uniform vec3 uFxTail;
uniform vec3 uFxDir;
uniform float uFxWidth;
uniform float uFxPixel;
uniform vec3 uFxLamp;
uniform vec3 uFxHead;
uniform float uFxHeadRim;
uniform float uFxGlint;
uniform float uFxGlintAt;
uniform float uFxBead;
uniform float uFxBeadTail;
uniform float uFxShow;
uniform float uFxSolid;
varying vec4 vFxUv;
varying vec4 vFxW;
varying vec4 vFxL;
${STRIP_GLSL}
${GLINT_GLSL}
void main() {
	gl_Position = fx_strip( uFxLead, uFxTail, uFxDir, uFxWidth );
	vec4 gli = fx_glint( uFxLead, uFxDir, fxSide, uFxLamp, uFxHead, 0.0 );
	vFxUv = vec4( position.x * 2.0, fxInfo.w, fxInfo.z, uFxSolid );
	vFxW = vec4( fxInfo.x, fxInfo.y, gli.x, position.y < 0.5 ? uFxBead : uFxBeadTail );
	vFxL = vec4( uFxShow, uFxShow * uFxGlint * gli.y, uFxGlintAt < 0.0 ? 1.0 : 0.0, uFxGlintAt );
	if ( uFxShow < 0.002 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
}
`,
  fragment: STREAK_FRAGMENT_GLSL,
};

export function createDrip(ctx, opts = {}) {
  const layout = (ctx && ctx.layout) || LAYOUT;
  const rh = layout.shower.rainHead;
  // opts.from: the exact point; opts.head (a point or the shower fixture's anchors.rainHead, on the head's face):
  // a nozzle a little off its centre; default: the same off LAYOUT's rain head, just under its face
  const headAt = opts.head ? toVec3(opts.head) : null;
  const from = opts.from
    ? toVec3(opts.from)
    : headAt
      ? new THREE.Vector3(headAt.x + 0.035, headAt.y - 0.0005, headAt.z - 0.02)
      : new THREE.Vector3(rh.x + 0.035, rh.y - 0.004, rh.z - 0.02);
  const headC = headAt ? headAt.clone() : new THREE.Vector3(rh.x, rh.y - 0.004, rh.z); // the face's centre
  const headRim = opts.headRim ?? (opts.head?.userData?.radius ?? 0.113) + 0.012;
  let floorY = opts.targetY ?? floorHeight(layout, from.x, from.z); // the falling floor (the grate, under the head)
  let minWait = opts.interval?.[0] ?? 3.5;
  let maxWait = opts.interval?.[1] ?? 9;
  let active = opts.active ?? true;
  const rMax = opts.size ?? 0.0023; // a drop from a shower nozzle is about 4-5 mm across
  const onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : null;
  const rng = createRng(opts.seed ?? 51);
  // a drop this size wobbles slower than the spray's (the highlight beads along its streak)
  const wobble = 6.2832 * SPRAY_LOOK.dropHz * Math.pow(SPRAY_LOOK.dropRef / (2 * rMax), 1.5);

  const U = {
    uFxLead: { value: new THREE.Vector3() },
    uFxTail: { value: new THREE.Vector3() },
    uFxDir: { value: new THREE.Vector3(0, -1, 0) },
    uFxWidth: { value: 2 * rMax },
    uFxPixel: { value: pixelWorldAt1m(ctx) },
    uFxLamp: { value: new THREE.Vector3() },
    uFxHead: { value: headC },
    uFxHeadRim: { value: headRim },
    uFxGlint: { value: 0 },
    uFxGlintAt: { value: GLINT_AT },
    uFxBead: { value: 0 },
    uFxBeadTail: { value: 0 },
    uFxShow: { value: 0 },
    uFxSolid: { value: 1 },
    uFxWall: { value: new THREE.Color() },
    uFxLampColor: { value: new THREE.Color() },
    uFxRound: { value: 1 },
  };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0], 3));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  const mat = waterShader('fx-drip', U, DRIP_GLSL.vertex, DRIP_GLSL.fragment);
  const dropMesh = new THREE.Mesh(geo, mat);
  dropMesh.name = 'fx-drip';
  dropMesh.visible = false;
  dropMesh.frustumCulled = false; // the strip is placed by the shader; its own corners sit at the origin
  dropMesh.renderOrder = 3; // over the wet floor
  const splashMat = drawWithRoom(makeDropMaterial('drip-splash'));
  const splash = createSplash(ctx, { count: qualityOf(ctx) === 'low' ? 6 : 10, seed: (opts.seed ?? 51) + 3, material: splashMat });
  splash.object3d.renderOrder = 3;
  const group = new THREE.Group();
  group.name = 'fx-drip-group';
  group.add(dropMesh, splash.object3d);

  // the room's light: a lit wall's, the nearest lamp, the switch (ctx.downlights' level unless set here)
  let level = null;
  let lampsFrom = {}; // the ctx.downlights the lamp was found in (none yet: found on the first call)
  function applyLight() {
    if ((ctx && ctx.downlights) !== lampsFrom) {
      lampsFrom = ctx && ctx.downlights;
      nearestLamp(ctx, from, U.uFxLamp.value, U.uFxLampColor.value);
    }
    const l = level ?? (ctx && ctx.downlights && Number.isFinite(ctx.downlights.level) ? ctx.downlights.level : 1);
    const wall = roomWall(ctx, U.uFxWall.value, l);
    U.uFxGlint.value = SPRAY_LOOK.glint * wall * l;
  }
  applyLight();

  let state = 'idle'; // idle -> forming -> falling -> idle
  let t = 0;
  let wait = opts.firstWait ?? rng.range(1, 3);
  let formTime = 2;
  let y = from.y;
  let v = 0;
  let phase = 0;
  const pos = new THREE.Vector3();
  const info = { position: pos, speed: 0, size: rMax };

  function emit(type) {
    if (onEvent) onEvent(type, info);
  }

  function startForming() {
    state = 'forming';
    t = 0;
    formTime = rng.range(1.2, 2.4);
    phase = rng.next() * 6.2832;
    dropMesh.visible = true;
    pos.copy(from);
    info.speed = 0;
    emit('form');
  }

  function update(dtMs) {
    const dt = stepSeconds(dtMs, 100);
    if (dt <= 0) return false;
    t += dt;
    if (state === 'idle') {
      dropMesh.visible = false;
      U.uFxShow.value = 0;
      if (active && t >= wait) startForming();
    }
    if (state === 'forming') {
      const k = Math.min(1, t / formTime);
      const grow = 1 - (1 - k) * (1 - k);
      const r = rMax * (0.25 + 0.75 * grow);
      const stretch = 1 + 0.35 * k * k; // it sags before it lets go
      // hanging from the nozzle: a round drop r wide, r x stretch tall each way, its top at the nozzle
      U.uFxTail.value.copy(from);
      U.uFxLead.value.set(from.x, from.y - 2 * r * stretch, from.z);
      U.uFxDir.value.set(0, -1, 0);
      U.uFxWidth.value = 2 * r;
      U.uFxRound.value = 1;
      U.uFxSolid.value = 1;
      U.uFxGlintAt.value = GLINT_AT;
      U.uFxShow.value = 1;
      if (k >= 1) {
        state = 'falling';
        t = 0;
        y = from.y - r * stretch * 0.9; // the drop's middle as it lets go
        v = 0;
        pos.set(from.x, y, from.z);
        emit('fall');
      }
    } else if (state === 'falling') {
      v += G * dt;
      y -= v * dt;
      // falling: a streak from the drop's bottom up along 0.03 s of its fall (at least the drop itself)
      const yb = Math.max(y, floorY + rMax) - rMax;
      U.uFxLead.value.set(from.x, yb, from.z);
      U.uFxTail.value.set(from.x, yb + Math.max(v * SPRAY_LOOK.blur, 2 * rMax), from.z);
      U.uFxWidth.value = 2 * rMax;
      U.uFxRound.value = 0;
      U.uFxSolid.value = 0;
      U.uFxGlintAt.value = -1;
      U.uFxBead.value = phase + wobble * t;
      U.uFxBeadTail.value = phase + wobble * Math.max(0, t - SPRAY_LOOK.blur);
      if (y <= floorY + rMax) {
        pos.set(from.x, floorY, from.z);
        info.speed = v;
        dropMesh.visible = false;
        U.uFxShow.value = 0;
        splash.emit(4, from.x, floorY, from.z, DRIP_SPLASH);
        emit('land');
        state = 'idle';
        t = 0;
        wait = rng.range(minWait, maxWait);
      }
    }
    if (state !== 'idle') {
      U.uFxPixel.value = pixelWorldAt1m(ctx);
      applyLight();
    }
    splash.update(dt);
    return state !== 'idle' || splash.alive > 0;
  }

  return {
    object3d: group,
    parts: { drop: dropMesh, splash: splash.object3d },
    update,
    // on: drops keep coming now and then; off: the current drop finishes, no new ones
    setActive(on) { active = !!on; },
    // a drop right away (for example the last drop after the mixer closes)
    trigger() { if (state === 'idle') startForming(); },
    setInterval(min, max) { minWait = Math.max(0.2, min); maxWait = Math.max(minWait, max); },
    setFrom(p) { from.set(p.x, p.y, p.z); lampsFrom = {}; },
    setTargetY(yy) { if (Number.isFinite(yy)) floorY = yy; },
    // the room's light switch (1 on); null: follow ctx.downlights
    setLightLevel(l) { level = Number.isFinite(l) ? Math.max(0, Math.min(2, l)) : null; applyLight(); },
    get state() { return state; },
    get active() { return active; },
    get speed() { return state === 'falling' ? v : 0; },
    fallTime() { return Math.sqrt((2 * Math.max(0, from.y - rMax * 1.3 - floorY - rMax)) / G); },
    dispose() { geo.dispose(); mat.dispose(); splashMat.dispose(); splash.dispose(); },
  };
}
