// The room's own light, photographed from inside it. A borrowed daylight photo of another bathroom used to light the
// fixtures and fill the mirror (review 2026-10-19, visual findings 2 and 3): now the room is photographed once from
// its middle at standing eye height, after the baked shell and the fixtures are in, as a six-sided picture
// (PMREMGenerator.fromScene) that becomes scene.environment. The fixtures are then lit by this room's walls and lamps,
// the mirror reflects this room, and the picture is taken again only when the light changes (the switch, the toilet
// swap, the membrane view) — never every frame. The hallway gets its own small picture, so the start view is lit by
// its own lamp, not by the bathroom.
//
// The mirror's reflection is box-projected: a reflection is looked up where it really meets the room's walls (a box),
// seen from where the picture was taken, so the walls in the mirror sit where they are and shift as the eye moves.
//
// What the visitor's eye draws (phones, 2026-10-19/20: tmp/wave3/fix-perf.md, r3-code.md): from the hallway with the
// door shut the eye drew the whole room behind the door every frame (createViewGate keeps it to the hallway, the door
// and the light under it then); a see-through pane is judged in view by its own box (cullTightly); the door wall hides
// its far side but for the opening (createDoorPortal); from the hallway and the doorway the shower glass is clear glass
// and the window's frosted pane its plain glow, without a see-through pass (createGlassSwitch, the panes' one owner);
// the frame governor's steps (governorSteps); main.js and the counted room wire all of it with the same calls
// (gateHallway, finishEyeDraws, warmEyeDraws). The photographed models re-light the room one by one as they arrive
// (photographOnArrival). The door and the hallway blend from the hallway's light to the open door's (createDoorLight).
import * as THREE from 'three';
import { GOVERNOR_STEPS } from '../core/quality.js';
import { hingeAngle, hingeBelow } from './doorLight.js';
export * from './doorLight.js'; // the door's and the hallway's light, and the hinge helpers (moved 2026-10-20)

// Where the room is photographed from: the room's middle at about eye height (a little toward the door, so the
// shower glass and the washer are seen from the side the visitor sees them).
export function ROOM_PROBE(L) {
  return [L.room.W / 2, 1.45, Math.min(L.room.D - 1.1, 1.35)];
}
export function HALL_PROBE(L) {
  return [(L.door.x0 + L.door.x1) / 2, 1.45, L.room.D + Math.min(1.3, L.hallway.depth / 2)];
}
// The room as a box for the reflections: the floor's lowest point (it falls to the drain) to the ceiling.
export function roomBox(L) {
  const low = (L.floor && L.floor.grate) || 0;
  return { min: [0, Math.min(0, low - 0.005), 0], max: [L.room.W, L.room.H, L.room.D] };
}

// Pure version of the shader's projection (tested): the ray p + t r leaves the box through the nearest wall; returns
// the direction from the probe to that point.
export function boxProject(p, r, min, max, probe) {
  let t = Infinity;
  for (let k = 0; k < 3; k++) {
    if (r[k] > 1e-9) t = Math.min(t, (max[k] - p[k]) / r[k]);
    else if (r[k] < -1e-9) t = Math.min(t, (min[k] - p[k]) / r[k]);
  }
  return [0, 1, 2].map((k) => p[k] + r[k] * t - probe[k]);
}

export const BOX_GLSL = /* glsl */ `
vec3 bathBoxProject( vec3 p, vec3 r ) {
	vec3 rr = mix( vec3( 1e-5 ), r, step( vec3( 1e-5 ), abs( r ) ) );
	vec3 tMax = ( bathBoxMax - p ) / rr;
	vec3 tMin = ( bathBoxMin - p ) / rr;
	vec3 t = max( tMax, tMin );
	float d = min( min( t.x, t.y ), t.z );
	return p + r * d - bathProbe;
}
`;
const LOOKUP = 'reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );';

// Gives a PBR material box-projected environment reflections (keeps any shader change it already has).
export function boxProjected(material, { min, max, probe }) {
  const uniforms = {
    bathBoxMin: { value: new THREE.Vector3().fromArray(min) },
    bathBoxMax: { value: new THREE.Vector3().fromArray(max) },
    bathProbe: { value: new THREE.Vector3().fromArray(probe) },
  };
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  const hadOwn = prev && prev !== THREE.Material.prototype.onBeforeCompile;
  material.onBeforeCompile = function boxProjection(shader, renderer) {
    if (hadOwn) prev.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBathEnvWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n\tvBathEnvWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    // the chunk is written out (if another change has not done so already), then the reflection is projected once,
    // in world space, right before the lookup in getIBLRadiance
    let fs = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 bathBoxMin;\nuniform vec3 bathBoxMax;\nuniform vec3 bathProbe;\nvarying vec3 vBathEnvWorld;\n${BOX_GLSL}`)
      .replace('#include <envmap_physical_pars_fragment>', THREE.ShaderChunk.envmap_physical_pars_fragment);
    const i = fs.indexOf('vec3 getIBLRadiance(');
    const j = i >= 0 ? fs.indexOf(LOOKUP, i) : -1;
    if (j > i && !fs.includes('bathBoxProject( vBathEnvWorld')) {
      fs = `${fs.slice(0, j + LOOKUP.length)}\n\t\t\treflectVec = bathBoxProject( vBathEnvWorld, reflectVec );${fs.slice(j + LOOKUP.length)}`;
    }
    shader.fragmentShader = fs;
  };
  const base = typeof prevKey === 'function' && prevKey !== THREE.Material.prototype.customProgramCacheKey ? prevKey.call(material) : '';
  material.customProgramCacheKey = () => (base ? `${base}+box` : `bath-box-${material.type}`);
  material.needsUpdate = true;
  return uniforms;
}

// The effects' objects (ctx.fx: the water, the steam, the fog, the drips; some are grouped one level down).
export function effectObjects(ctx) {
  const out = [];
  for (const v of Object.values(ctx.fx || {})) {
    if (v && v.object3d) out.push(v.object3d);
    else if (v && typeof v === 'object' && !Array.isArray(v)) for (const w of Object.values(v)) if (w && w.object3d) out.push(w.object3d);
  }
  return out;
}
// What moves its own vertices on the graphics card or every frame: the effects, the plants' sway, the towels (and the
// rolls in the basket), the scale's dial, the toothbrushes (cullTightlyUnder leaves them to three.js's own test).
export function movingRoots(ctx) {
  const f = ctx.fixtures || {};
  return [...effectObjects(ctx), ...['plants', 'duck', 'basket', 'towels', 'scale', 'toothbrushCup'].map((k) => f[k] && f[k].group)].filter(Boolean);
}

// What a photograph of the room leaves out: what passes (water, steam, fog, drips), see-through glass (it is drawn
// from a picture of the solid room; the shower glass also while it is clear glass), a paper held up to read and a towel
// held in front of the eye (scene/towelWiring.js),
// the mirror's live reflection (scene/mirrorReflection.js: it is the visitor's own view in the glass, and is drawn for
// the visitor's camera only), and on the first photograph the mirror (it has nothing to show yet). The window's outside
// stays: the room sees the sky through the opening.
export function captureHides(ctx, { mirror = false } = {}) {
  const out = [];
  const add = (o) => { if (o && !out.includes(o)) out.push(o); };
  for (const o of effectObjects(ctx)) add(o);
  if (ctx.mirrorReflection) add(ctx.mirrorReflection.mesh);
  if (ctx.scene) {
    ctx.scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      // (the shower glass also while it is drawn as clear glass: createGlassSwitch)
      if (o.isReflector || o.userData.bathSeeThrough || [].concat(o.material).some((m) => m && m.transmission > 0)) add(o);
    });
  }
  const held = ctx.wiring && ctx.wiring.lifted;
  if (held && held.mesh) add(held.mesh);
  const tw = ctx.wiring && ctx.wiring.towels;
  const inHand = tw && tw.held && tw.towels && tw.towels.towels && tw.towels.towels[tw.held];
  if (inHand) add(inHand.pivot); // the towel and its label
  if (mirror) {
    const mc = ctx.fixtures && ctx.fixtures.mirrorCabinet;
    if (mc) for (const k of ['doorLeftFace', 'doorRightFace', 'doorLeft', 'doorRight', 'display']) add(mc.parts[k]);
  }
  return out;
}

// A probe: photographs the scene from `position` into a PMREM environment of `size`.
//   capture({ key, hide, before, after }) -> the environment texture. With a key it is kept: asking again for the same
//   key gives the kept picture without a new photograph (the light switch's two states), unless fresh: true. The probe
//   keeps at most `keep` pictures and frees the oldest (and a picture replaced under the same key).
//   has(key): is a picture kept (and not stale) for it.
//   stale(): every kept picture is out of date (the room changed in a way no key names: the photographed models
//   arrived); each is taken again the next time its key is asked for, and freed then, not before.
export function createProbe(ctx, { size = 256, position, near = 0.03, far = 30, keep = 1, render = null } = {}) {
  const { renderer, scene } = ctx;
  const pos = new THREE.Vector3().fromArray(position);
  const kept = new Map(); // key -> render target, the most recently used last
  const stale = new Set(); // kept keys whose picture is out of date (stale())
  let current = null;
  let serial = 0;
  let failed = false;
  const free = (rt) => queueMicrotask(() => rt.dispose()); // after the materials have been pointed at the new one
  // the photograph itself (render: a stand-in for tests, which have no GPU)
  const photo = render || (() => {
    const pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromScene(scene, 0, near, far, { size, position: pos });
    pm.dispose();
    return rt;
  });
  function shoot({ hide = [], before = null, after = null } = {}) {
    if (failed) return null;
    const shown = [];
    for (const o of hide) if (o && o.visible) { o.visible = false; shown.push(o); }
    let out = null;
    try {
      if (before) before();
      out = photo();
    } catch (e) {
      failed = true;
      console.warn('the room could not be photographed for its light:', e);
    } finally {
      for (const o of shown) o.visible = true;
      if (after) after();
    }
    if (out) out.texture.name = `bath-probe-${size}`;
    return out;
  }
  function capture({ key = null, fresh = false, ...opts } = {}) {
    if (key !== null && !fresh && kept.has(key) && !stale.has(key)) {
      const rt = kept.get(key);
      kept.delete(key);
      kept.set(key, rt);
      current = rt;
      return rt.texture;
    }
    const rt = shoot(opts);
    if (!rt) return current ? current.texture : null;
    const k = key ?? `#${serial++}`;
    stale.delete(k);
    if (kept.has(k)) { free(kept.get(k)); kept.delete(k); }
    kept.set(k, rt);
    while (kept.size > keep) {
      const [oldKey, oldRt] = kept.entries().next().value;
      kept.delete(oldKey);
      stale.delete(oldKey);
      free(oldRt);
    }
    current = rt;
    return rt.texture;
  }
  return {
    capture,
    has: (key) => kept.has(key) && !stale.has(key),
    stale() { for (const k of kept.keys()) stale.add(k); },
    get texture() { return current ? current.texture : null; },
    get failed() { return failed; },
    get kept() { return kept.size; },
    position: pos,
    size,
    dispose() { for (const rt of kept.values()) rt.dispose(); kept.clear(); stale.clear(); current = null; },
  };
}

// The photographed models (the plants, the duck, the basket) arrive on their own time (fixtures/models.js: each
// fixture's `ready`). After each arrival that brought something new into the room, the room is photographed again
// once nothing moves; arrivals before that moment share one photograph; a download that fails or never ends (three.js's
// loader has no timeout) holds none of the others out of the room's light.
//   readies: the fixtures' ready promises (anything else is skipped); count(): the model meshes in the room now;
//   since: how many the last photograph had; whenStill(fn): run fn once nothing moves; shoot(): photograph again.
export function photographOnArrival(readies, { count, since = 0, whenStill, shoot }) {
  let taken = since;
  let waiting = false;
  const arrived = () => {
    if (waiting || count() <= taken) return;
    waiting = true;
    whenStill(() => {
      waiting = false;
      const n = count();
      if (n <= taken) return;
      taken = n;
      shoot();
    });
  };
  for (const r of readies) if (r && typeof r.then === 'function') r.then(arrived, () => {});
}

// ---- What the visitor's eye draws
// three.js draws an object for a camera when the two share a layer (Object3D.layers). Layer 0 holds everything (the
// room, the hallway: every camera that photographs the room sees all of it). VIEW_LAYERS.hall marks, as well, what can
// be seen from the hallway while the bathroom door is shut: the hallway, the door, their shadows, and every light (a
// camera that does not see a light leaves it out of the frame's lights: every shader would be built anew the moment
// the door opens).
export const VIEW_LAYERS = { hall: 1 };
export const DOOR_SHUT_RAD = 1e-3; // the bathroom door counts as shut below this (0.8 mm at its free edge)

// Whether an eye at p can see into the room: not from the hallway (beyond the door line) while the door is shut.
export function seesRoom(L, p, leaf) {
  return !(p.z > L.room.D && !!leaf && hingeBelow(leaf, DOOR_SHUT_RAD));
}

// The gate on the visitor's eye (ctx.camera). While the eye stands in the hallway and the door is shut it draws what
// is marked for the hallway only: every gap round the shut leaf is closed to the eye (tests/roomEnvironment.test.js
// traces the lines of sight), so nothing seen changes. From the first moment the leaf turns, or with the eye in the
// room, it draws everything it drew before. Other cameras (the room's photographs, the mirror's) are left alone. It
// installs itself as the scene's before-render hook (three.js calls it at the start of every render, before it sorts
// what to draw), keeping a hook that was there; a later hook must chain it too (scene/mirrorReflection.js does).
//   hall: the roots seen from the hallway (the hallway, the door; mark(root) adds one made later: their shadows).
//   warm(): the next frame of the eye draws the room too, behind the shut door: what the room's first frame needs
//   (its see-through picture, buffers) is made then, not on the door's first swing. precompile(renderer): every
//   material compiled for the eye with the room shown (renderer.compile). closed: the last frame of the eye drew the
//   hallway only. stats: { closed, open, warm } frames. dispose().
export function createViewGate(ctx, { hall = [] } = {}) {
  const { scene } = ctx;
  const eye = ctx.camera;
  const open = eye.layers.mask;
  const hallMask = 1 << VIEW_LAYERS.hall;
  const roots = [];
  const stats = { closed: 0, open: 0, warm: 0 };
  const p = new THREE.Vector3();
  let warmNext = false;
  let closed = false;
  let disposed = false;
  const markOne = (o) => o.layers.enable(VIEW_LAYERS.hall);
  const markLight = (o) => { if (o.isLight) o.layers.enable(VIEW_LAYERS.hall); };
  function mark(root) {
    if (!root) return;
    if (!roots.includes(root)) roots.push(root);
    root.traverse(markOne);
  }
  for (const root of hall) mark(root);

  function before(cam) {
    if (disposed || cam !== eye) return;
    const leaf = ctx.door && ctx.door.parts && ctx.door.parts.leafPivot;
    p.setFromMatrixPosition(cam.matrixWorld);
    const shut = !!ctx.layout && !seesRoom(ctx.layout, p, leaf);
    if (shut && !warmNext) {
      for (const root of roots) root.traverse(markOne); // what was added to the hallway since
      scene.traverse(markLight); // and the lights added since (the room's come with the room)
      cam.layers.mask = hallMask;
      closed = true;
      stats.closed++;
      return;
    }
    cam.layers.mask = open;
    closed = false;
    if (shut) stats.warm++;
    else stats.open++;
    warmNext = false;
  }
  const hadOwnHook = Object.prototype.hasOwnProperty.call(scene, 'onBeforeRender');
  const earlier = scene.onBeforeRender;
  function hook(r, s, cam, rt) {
    if (hadOwnHook) earlier.call(this, r, s, cam, rt);
    before(cam);
  }
  scene.onBeforeRender = hook;

  return {
    mark,
    warm() { warmNext = true; },
    precompile(renderer) {
      const was = eye.layers.mask;
      eye.layers.mask = open;
      try { renderer.compile(scene, eye); } finally { eye.layers.mask = was; }
    },
    get closed() { return closed; },
    stats,
    dispose() {
      if (disposed) return;
      disposed = true;
      eye.layers.mask = open;
      if (scene.onBeforeRender === hook) { // (under a later hook it stays in the chain, doing nothing)
        if (hadOwnHook) scene.onBeforeRender = earlier;
        else delete scene.onBeforeRender;
      }
    },
  };
}

// The start view's gate as the app builds it (main.js; scripts/measure-draws.mjs builds the counted room with the same
// call, so the two cannot drift apart): the hallway and the door, the hallway's shadows when they are made, and the
// warm line of light under the shut door (scene/entrance.js: its own mesh at the scene's root; review 2026-10-20
// finding 2: without its mark the first view of the visit lost it). Sets ctx.viewGate.
export function gateHallway(ctx) {
  const gate = createViewGate(ctx, { hall: [ctx.hallway.group, ctx.door.group] });
  if (ctx.hallwayShadows) gate.mark(ctx.hallwayShadows.group);
  if (ctx.entrance && ctx.entrance.glow) gate.mark(ctx.entrance.glow);
  ctx.viewGate = gate;
  return gate;
}

// A see-through pane (the shower glass, the window's frosted pane) makes three.js draw everything in view a second
// time, into the picture the pane refracts. three.js judges a thing in view by its bounding sphere: the shower glass's
// (0.9 x 2 m) reaches far past the pane, so the second drawing ran in views without the glass in them. Judged by its
// own box instead (as safe: a box test never leaves out a thing that is in view). The box follows the thing's vertices
// when they are moved and flagged as changed (needsUpdate); vertices moved on the graphics card it cannot see.
const _box = new THREE.Box3();
const _sphere = new THREE.Sphere();
// a mesh's box in the room (its geometry's box, worked out again when its vertices were flagged as changed)
function worldBox(o, target) {
  const g = o.geometry;
  const pos = g.attributes.position;
  const version = pos ? pos.version : 0;
  if (!g.boundingBox || g.userData.bathBoxVersion !== version) {
    g.computeBoundingBox();
    g.userData.bathBoxVersion = version;
  }
  return target.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
}
function boxInView(frustum) {
  return frustum.intersectsBox(worldBox(this, _box));
}
export function cullTightly(mesh) {
  if (mesh && mesh.isMesh && !mesh.isInstancedMesh && !mesh.isSkinnedMesh && !mesh.isBatchedMesh) mesh.intersectsFrustum = boxInView;
  return mesh;
}
// Every still mesh under root, judged by its box: a skirting board's sphere is 1.5 m round, and the vanity's and the
// mirror cabinet's reach from under and behind the glass into the mirror's view (measured: the mirror's pass drew
// them). except: roots whose meshes move their own vertices on the graphics card or every frame (the effects, the
// plants' sway, the towels, the scale's dial, the toothbrushes): they keep three.js's sphere. Returns how many.
export function cullTightlyUnder(root, except = []) {
  let n = 0;
  const skip = new Set(except.filter(Boolean));
  (function walk(o) {
    if (skip.has(o)) return;
    if (o.isMesh && o.frustumCulled !== false && !o.isInstancedMesh && !o.isSkinnedMesh && !o.isBatchedMesh) {
      cullTightly(o);
      n++;
    }
    for (const c of o.children) walk(c);
  })(root);
  return n;
}

// ---- The door wall
// The wall between the room and the hallway hides its far side from a camera but for the door's opening (the leaf, at
// any angle, only hides more). So a thing wholly on the far side of the wall from a camera is drawn for that camera
// only when it lies in the cone from the camera through the opening (judged by its box when it is judged by its box,
// else by its sphere: as safe as three.js's own test). Measured: from the hallway with the door open the eye drew the
// room beside and behind the door wall, from the room the hallway's trolley beside the door. Every camera: the eye, the
// mirror's, a photograph's. Installed after the mirror (main.js), so its hook runs last: the eye's cut never reaches
// the mirror's pass (drawn from inside the eye's hook), and each render's cut is undone at its end (onAfterRender).
// Leaf meshes only (a mesh with children keeps them: a door's fog rides on its glass); never what three.js itself
// never culls (frustumCulled false: the effects that place themselves in a shader).
export const DOOR_WALL_T = 0.12; // the door wall's thickness (scene/hallway.js, fixtures/door.js, core/walkArea.js)

// The cone from apex through the rectangle rect = [x0, x1, y0, y1, z] (x0..x1, y0..y1 in the plane z: a Frustum's four
// side planes; its other two hold everything). Each side plane is turned toward the apex's mirror image through the
// rectangle's centre: that point lies on the line from the apex through the centre, beyond the rectangle, so it is
// inside the cone from any apex off the plane (a fixed point beyond the opening is not: from an eye beside the
// opening it fell outside the skewed cone and turned a plane the wrong way, review 2026-10-20 finding 1). No garbage:
// the rectangle comes in an array the caller fills and the planes are worked out in plain numbers (computed numbers
// handed to a function are boxed: 80-190 bytes a call, measured 2026-10-20).
const _coneX = [0, 0, 0, 0];
const _coneY = [0, 0, 0, 0];
export function coneThrough(cone, apex, rect) {
  const x0 = rect[0];
  const x1 = rect[1];
  const y0 = rect[2];
  const y1 = rect[3];
  const z = rect[4];
  _coneX[0] = x0; _coneX[1] = x1; _coneX[2] = x1; _coneX[3] = x0;
  _coneY[0] = y0; _coneY[1] = y0; _coneY[2] = y1; _coneY[3] = y1;
  const ax = apex.x;
  const ay = apex.y;
  const az = apex.z;
  const dz = z - az; // the rectangle's plane from the apex
  // the apex's mirror image through the rectangle's centre, from the apex
  const ix = x0 + x1 - 2 * ax;
  const iy = y0 + y1 - 2 * ay;
  const iz = 2 * dz;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    // the plane through the apex and corners i, j: normal (corner i - apex) x (corner j - apex)
    const ux = _coneX[i] - ax;
    const uy = _coneY[i] - ay;
    const vx = _coneX[j] - ax;
    const vy = _coneY[j] - ay;
    let nx = uy * dz - dz * vy;
    let ny = dz * vx - ux * dz;
    let nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    if (nx * ix + ny * iy + nz * iz < 0) { nx = -nx; ny = -ny; nz = -nz; } // the inner side positive
    const p = cone.planes[i];
    p.normal.x = nx / len;
    p.normal.y = ny / len;
    p.normal.z = nz / len;
    p.constant = -(p.normal.x * ax + p.normal.y * ay + p.normal.z * az);
  }
  for (let i = 4; i < 6; i++) {
    const p = cone.planes[i];
    p.normal.x = 0;
    p.normal.y = 0;
    p.normal.z = 0;
    p.constant = 1;
  }
  return cone;
}

// ---- What a hallway eye sees through the open door
// The stretches of the opening's room face (x at z = D) a hallway eye sees through past the leaf: written into out as
// [a0, b0, a1, b1], their count returned (0, 1 or 2: beside the hinge, past the free edge); -1 when the eye is not in
// the hallway. The leaf opens into the room; seen from the eye it hides the stretch between the outermost of its
// box's eight corners as they fall on the room face. Judged in plan, which holds for anything at a height the leaf
// covers where the lines of sight pass it: the mirror (rays from the eye at 1.6 m to its glass, 1.1-1.8 m, pass the
// leaf's reach at 1.3-1.7 m; the leaf spans 0.03-2.05 m). No garbage.
const _corner = new THREE.Vector3();
const LEAF_ROUND = 0.003;
// where the line (in plan) from the eye (ex, ez) through (x, z) meets the plane z = face
const toFace = (ex, ez, face, x, z) => ex + ((x - ex) * (ez - face)) / (ez - z);
export function doorGaps(L, eye, leaf, out) {
  const near = L.room.D;
  const far = near + DOOR_WALL_T;
  const ex = eye.x;
  const ez = eye.z;
  if (!(ez > far)) return -1;
  const oa = Math.max(L.door.x0, toFace(ex, ez, near, L.door.x0, far)); // the opening, both faces of the wall
  const ob = Math.min(L.door.x1, toFace(ex, ez, near, L.door.x1, far));
  if (!(ob > oa)) return 0;
  let la = Infinity;
  let lb = -Infinity;
  if (leaf && leaf.geometry) {
    const g = leaf.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox;
    for (let i = 0; i < 8; i++) {
      _corner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(leaf.matrixWorld);
      if (!(_corner.z < ez - 1e-6)) { la = Infinity; lb = -Infinity; break; } // (the leaf reaches the eye: none hidden)
      const x = toFace(ex, ez, near, _corner.x, _corner.z);
      if (x < la) la = x;
      if (x > lb) lb = x;
    }
    // the leaf's edges are rounded (fixtures/door.js, 3 mm) where its box is square: a line of sight just past an edge
    // that the box would stop counts as seen (erring on "seen": the mirror then wakes a hair early, never late)
    la += LEAF_ROUND;
    lb -= LEAF_ROUND;
  }
  if (!(lb > la)) { out[0] = oa; out[1] = ob; return 1; }
  let n = 0;
  if (la > oa) { out[0] = oa; out[1] = Math.min(ob, la); if (out[1] > out[0]) n = 1; }
  const a = Math.max(oa, lb);
  if (ob > a) { out[2 * n] = a; out[2 * n + 1] = ob; n++; }
  return n;
}
// Whether a hallway eye can see any of box (a box in the room) through the door's opening past its leaf: the cone from
// the eye through each stretch doorGaps finds, over the opening's height, meets the box (judged as three.js judges a
// box in view: never "no" for a box that is in the cone). An eye not in the hallway: true (the door does not stand
// between). A shut door (under DOOR_SHUT_RAD, as the view gate counts it): false.
const _gaps = [0, 0, 0, 0];
const _gapRect = [0, 0, 0, 0, 0];
const _gapCone = new THREE.Frustum();
export function seenThroughDoor(L, eye, leafPivot, leaf, box) {
  if (!(eye.z > L.room.D + DOOR_WALL_T)) return true;
  if (leafPivot && hingeBelow(leafPivot, DOOR_SHUT_RAD)) return false;
  const n = doorGaps(L, eye, leaf, _gaps);
  for (let i = 0; i < n; i++) {
    _gapRect[0] = _gaps[2 * i];
    _gapRect[1] = _gaps[2 * i + 1];
    _gapRect[2] = 0;
    _gapRect[3] = L.door.height;
    _gapRect[4] = L.room.D;
    coneThrough(_gapCone, eye, _gapRect);
    if (_gapCone.intersectsBox(box)) return true;
  }
  return false;
}

export function createDoorPortal(ctx) {
  const { scene } = ctx;
  const L = ctx.layout;
  const near = L.room.D; // the wall's room face
  const far = L.room.D + DOOR_WALL_T; // its hallway face
  const mid = (near + far) / 2; // every line through the opening passes its middle section
  const cone = new THREE.Frustum();
  const opening = [L.door.x0, L.door.x1, 0, L.door.height, mid]; // the opening at the wall's middle
  const apex = new THREE.Vector3();
  const frames = []; // per render under way: the meshes it hid (shown again at its end)
  let depth = 0;
  let disposed = false;
  let hallSide = false;
  let frame = null;
  const stats = { culled: 0, renders: 0 };

  function hide(o) {
    o.visible = false;
    if (frame.n < frame.items.length) frame.items[frame.n] = o;
    else frame.items.push(o);
    frame.n++;
    stats.culled++;
  }
  // (a line from the camera to a thing wholly beyond the wall's middle meets that middle: inside the opening, or in
  // the wall; a thing reaching into the middle is kept)
  function visit(o) {
    if (!o.isMesh || !o.visible || o.children.length || o.frustumCulled === false || !o.geometry) return;
    if (o.intersectsFrustum === boxInView) {
      worldBox(o, _box);
      if (hallSide ? _box.max.z > mid : _box.min.z < mid) return; // not wholly beyond the wall's middle
      if (!cone.intersectsBox(_box)) hide(o);
      return;
    }
    const g = o.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    _sphere.copy(o.boundingSphere || g.boundingSphere).applyMatrix4(o.matrixWorld);
    if (hallSide ? _sphere.center.z + _sphere.radius > mid : _sphere.center.z - _sphere.radius < mid) return;
    if (!cone.intersectsSphere(_sphere)) hide(o);
  }

  function before(cam) {
    while (depth > 0 && cam === ctx.camera) after(); // (the eye's render is never inside another: a render that broke off)
    frame = frames[depth] || (frames[depth] = { items: [], n: 0 });
    frame.n = 0;
    depth++;
    if (disposed || !(cam.layers.mask & 1)) return; // the gate has the eye in the hallway behind the shut door
    apex.setFromMatrixPosition(cam.matrixWorld);
    if (apex.z >= near && apex.z <= far) return; // in the doorway itself
    hallSide = apex.z > far;
    coneThrough(cone, apex, opening);
    stats.renders++;
    scene.traverse(visit);
  }
  function after() {
    if (depth === 0) return;
    depth--;
    const f = frames[depth];
    for (let i = 0; i < f.n; i++) { f.items[i].visible = true; f.items[i] = null; }
    f.n = 0;
  }

  const hadBefore = Object.prototype.hasOwnProperty.call(scene, 'onBeforeRender');
  const earlierBefore = scene.onBeforeRender;
  const hadAfter = Object.prototype.hasOwnProperty.call(scene, 'onAfterRender');
  const earlierAfter = scene.onAfterRender;
  function hookBefore(r, s, cam, rt) {
    if (hadBefore) earlierBefore.call(this, r, s, cam, rt);
    before(cam);
  }
  function hookAfter(r, s, cam) {
    after();
    if (hadAfter) earlierAfter.call(this, r, s, cam);
  }
  scene.onBeforeRender = hookBefore;
  scene.onAfterRender = hookAfter;

  return {
    stats,
    dispose() {
      if (disposed) return;
      disposed = true;
      while (depth > 0) after();
      if (scene.onBeforeRender === hookBefore) {
        if (hadBefore) scene.onBeforeRender = earlierBefore;
        else delete scene.onBeforeRender;
      }
      if (scene.onAfterRender === hookAfter) {
        if (hadAfter) scene.onAfterRender = earlierAfter;
        else delete scene.onAfterRender;
      }
    },
  };
}

// ---- The shower glass from the hallway and the doorway
// From there the shower glass is seen at a slant through the door with the whole room behind it, and its see-through
// pass drew everything in view a second time (61-96 draw calls: 238 and 177 a frame on a strong phone against the
// ~150 budget, the look 2026-10-20; along the walk in, facing the back wall, it stays over the budget until about 1 m
// into the room: tmp/wave3/r3-code.md). A flat 8 mm pane barely refracts (what lies behind it shifts by millimetres),
// so in front of GLASS_SWITCH's line (z over the door line minus `margin`) it is drawn as clear glass without that pass
// (clearGlass); behind it, the refracting glass. The two take over from each other only on a frame where the pane is
// not on the eye's screen (out of view, cut by the door wall, or behind the shut door): no frame shows the change.
// `band` keeps an eye standing at the line from changing it back and forth.
export const GLASS_SWITCH = { margin: 1.0, band: 0.05 };

// Clear glass drawn without a see-through pass. The refracting glass shows what lies behind it times (1 - F) and the
// room's reflection (its photograph, box-projected) and the lamps' highlights on top, F being the environment's
// Fresnel share (three.js transmission_pars_fragment, getIBLVolumeRefraction). Here the same reflection is written at
// its own brightness, with F as its cover (alpha), over what is already drawn behind the pane: the same reflection and
// tint (none), blended on the screen rather than in the light (equal where the reflection is as bright as what lies
// behind, and for small differences). A lamp's highlight covers more (all of it where the lamp outshines the room).
// No colour of its own (black: nothing diffuse), the refracting glass's roughness and reflection.
export const CLEAR_GLASS_GLSL = /* glsl */ `
	vec3 bathF = material.specularColorBlended * material.dfg.x + material.specularF90 * material.dfg.y;
	float bathShare = max( dot( bathF, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 );
	vec3 bathRoom = reflectedLight.indirectSpecular / bathShare;
	vec3 bathLamps = reflectedLight.directSpecular;
	float bathRoomLum = dot( bathRoom, vec3( 0.2126, 0.7152, 0.0722 ) );
	float bathLampLum = dot( bathLamps, vec3( 0.2126, 0.7152, 0.0722 ) );
	float bathCover = clamp( ( bathShare * bathRoomLum + bathLampLum ) / max( bathRoomLum + bathLampLum, 1e-6 ), bathShare, 1.0 );
	gl_FragColor = vec4( bathRoom + bathLamps, bathCover );
`;
export function clearGlass(of) {
  const m = new THREE.MeshStandardMaterial({
    color: 0x000000, roughness: of.roughness, metalness: 0, transparent: true, depthWrite: of.depthWrite, side: of.side,
    envMapIntensity: of.envMapIntensity ?? 1,
  });
  m.name = 'glassClear';
  m.onBeforeCompile = (shader) => { shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', CLEAR_GLASS_GLSL); };
  m.customProgramCacheKey = () => 'bath-glass-clear';
  return m;
}

// The switch for the refracting meshes given (the shower glass; on a weak device it is plain glass already: null).
// box: the room's box for the clear glass's reflection, as the refracting glass has it (main.js boxProjected). plain:
// the panes' plain look in front of the line, when it is not the clear glass (the window's frosted pane: its plain
// glow, scene/outside.js).
//   state: 'plain' | 'refracting'; plain: the plain look; meshes; has(mesh); snap(): set for where the eye stands
//   now (the eye placed, not walked: the start, a measurement); warm(): the next frame of the eye draws the refracting
//   glass (its see-through picture made with the room's warm frame, not on the first look inside); plainForGood(): the
//   frame governor's glass step; dispose().
//   override(material) / release(): the switch is the panes' one owner. Another look that needs a pane of its own (the
//   membrane view's veil: scene/membrane.js) puts it on through override(); while it is on, the switch only tracks its
//   state (at once: nothing it would change is shown), and release() puts on the glass for the state now. The membrane
//   view used to write the pane itself: the switch then replaced its veil when the eye crossed the line, and turning
//   the view off freed the switch's glass and put back the wrong one (review 2026-10-20, round 3, finding 1).
// Its hook runs after the others (finishEyeDraws makes it last): the door wall has cut what the eye cannot see by then.
const _paneBox = new THREE.Box3();
export function createGlassSwitch(ctx, { meshes = [], box = null, plain: plainLook = null } = {}) {
  const { scene } = ctx;
  const L = ctx.layout;
  const eye = ctx.camera;
  const list = meshes.filter((m) => m && m.isMesh && !Array.isArray(m.material) && m.material.transmission > 0);
  if (!list.length) return null;
  const refracting = list.map((m) => m.material);
  const plain = plainLook || clearGlass(refracting[0]);
  if (box && !plainLook) boxProjected(plain, box);
  for (const m of list) m.userData.bathSeeThrough = true; // a photograph leaves it out, the mirror draws it plain
  const frustum = new THREE.Frustum();
  const proj = new THREE.Matrix4();
  const p = new THREE.Vector3();
  let state = 'refracting';
  let forGood = false;
  let warmNext = false;
  let disposed = false;
  let over = null; // another look's material on the panes (override), or null
  function put() {
    for (let i = 0; i < list.length; i++) list[i].material = over || (state === 'plain' ? plain : refracting[i]);
  }
  function set(want) {
    state = want;
    if (!over) put();
  }
  function wanted(z) {
    if (forGood) return 'plain';
    const line = L.room.D - GLASS_SWITCH.margin;
    if (state === 'plain') return z < line - GLASS_SWITCH.band ? 'refracting' : 'plain';
    return z > line + GLASS_SWITCH.band ? 'plain' : 'refracting';
  }
  // the pane could be on the eye's screen this frame: shown (the door wall has not cut it), in view (its box), and the
  // room drawn at all (not behind the shut door)
  function seen(cam) {
    if (ctx.viewGate && ctx.viewGate.closed) return false;
    proj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(proj, THREE.WebGLCoordinateSystem, cam.reversedDepth);
    for (let i = 0; i < list.length; i++) {
      let shown = true;
      for (let o = list[i]; o; o = o.parent) if (!o.visible) { shown = false; break; }
      if (shown && frustum.intersectsBox(worldBox(list[i], _paneBox))) return true;
    }
    return false;
  }
  function before(cam) {
    if (disposed || cam !== eye) return;
    p.setFromMatrixPosition(cam.matrixWorld);
    const want = warmNext && !over ? 'refracting' : wanted(p.z);
    if (want !== state && (over || warmNext || !seen(cam))) set(want);
    warmNext = false;
  }
  const hadOwnHook = Object.prototype.hasOwnProperty.call(scene, 'onBeforeRender');
  const earlier = scene.onBeforeRender;
  function hook(r, s, cam, rt) {
    if (hadOwnHook) earlier.call(this, r, s, cam, rt);
    before(cam);
  }
  scene.onBeforeRender = hook;
  const api = {
    plain,
    meshes: list,
    get state() { return state; },
    has: (o) => list.includes(o),
    snap() {
      eye.updateMatrixWorld();
      p.setFromMatrixPosition(eye.matrixWorld);
      const want = wanted(p.z);
      if (want !== state) set(want);
    },
    warm() { warmNext = true; },
    plainForGood() { forGood = true; },
    override(material) { over = material || null; put(); },
    release() { over = null; put(); },
    // fn() run with the refracting looks on (precompile sees only what a mesh wears: both looks built at load)
    withRefracting(fn) {
      if (over) return fn();
      for (let i = 0; i < list.length; i++) list[i].material = refracting[i];
      try { return fn(); } finally { put(); }
    },
    get overridden() { return !!over; },
    dispose() {
      if (disposed) return;
      disposed = true;
      over = null;
      set('refracting');
      for (const m of list) delete m.userData.bathSeeThrough;
      if (scene.onBeforeRender === hook) {
        if (hadOwnHook) scene.onBeforeRender = earlier;
        else delete scene.onBeforeRender;
      }
    },
  };
  api.snap();
  return api;
}

// ---- The frame governor's steps as the room takes them (core/quality.js GOVERNOR_STEPS; main.js applies them only
// through this, so every step the governor gives does something: a step name without a handler is refused here)
//   sharpness(): the caller's (main.js: the renderer's pixel ratio); wake(): after each step (main.js: the loop).
//   Returns apply(step) -> whether the step was known.
export function governorSteps(ctx, { sharpness = null, wake = null, steps = GOVERNOR_STEPS } = {}) {
  const handlers = {
    sharpness: () => { if (sharpness) sharpness(); },
    // plain glass for good: the shower glass as clear glass, the window's frosted pane as its plain glow
    // (scene/outside.js), each taken over by its switch when it is next off screen (the switch is the pane's one
    // owner); no see-through pass for either
    glass: () => {
      if (ctx.glassSwitch) ctx.glassSwitch.plainForGood();
      if (ctx.windowSwitch) ctx.windowSwitch.plainForGood();
      const pane = ctx.fixtures && ctx.fixtures.window && ctx.fixtures.window.parts.glass;
      if (!ctx.windowSwitch && pane && ctx.outside && pane.material && pane.material.transmission > 0) ctx.outside.plainPane(pane);
    },
    // the mirror at the weak device's setting: every other frame, a smaller picture (scene/mirrorReflection.js)
    mirrorLow: () => { if (ctx.mirrorReflection) ctx.mirrorReflection.setPlan('low'); },
    // the live mirror off for good: the doors' photographed glass
    mirror: () => { if (ctx.mirrorReflection) ctx.mirrorReflection.setLive(false); },
  };
  const missing = [...new Set(steps)].filter((s) => !handlers[s]);
  if (missing.length) throw new Error(`the frame governor's step(s) ${missing.join(', ')} have nothing to do`);
  return (step) => {
    const h = handlers[step];
    if (!h) return false;
    h();
    if (wake) wake();
    return true;
  };
}

// ---- What the eye draws, wired as the app wires it (main.js; scripts/measure-draws.mjs builds the counted room with
// the same calls, so the two cannot drift apart: review 2026-10-20, finding 8)
// Once the room is in, after the mirror: every still thing judged by its box, the door wall (its hook after the
// mirror's: the eye's cut never reaches the mirror's pass), the shower glass's switch (its hook last). box: the room's
// box for the clear glass's reflection (null where nothing is drawn).
export function finishEyeDraws(ctx, { box = null } = {}) {
  cullTightlyUnder(ctx.scene, movingRoots(ctx));
  ctx.doorPortal = createDoorPortal(ctx);
  const shower = ctx.fixtures && ctx.fixtures.shower;
  ctx.glassSwitch = createGlassSwitch(ctx, { meshes: shower ? [shower.parts.glass] : [], box });
  // the window's frosted pane over the toilet the same way, its plain glow in front of the line (from the hallway it
  // ran the see-through pass too: up to 244 draw calls, review 2026-10-20, round 3, finding 2); at night and on a weak
  // device it is the plain pane already (no switch)
  const pane = ctx.fixtures && ctx.fixtures.window && ctx.fixtures.window.parts.glass;
  ctx.windowSwitch = pane && ctx.outside ? createGlassSwitch(ctx, { meshes: [pane], plain: ctx.outside.plainPane(null) }) : null;
}
// The room's screen shaders built (with a renderer that can: main.js's) and its first frame drawn behind the shut door
// with the refracting glass (its see-through picture and buffers made then), so the door's first swing and the first
// look inside have nothing left to prepare.
export function warmEyeDraws(ctx, renderer = null) {
  const switched = [ctx.glassSwitch, ctx.windowSwitch].filter(Boolean);
  if (renderer && typeof renderer.compile === 'function') {
    const compile = () => ctx.viewGate.precompile(renderer);
    try {
      compile(); // the looks on now (from the start spot: the plain ones)
      switched.reduce((next, sw) => () => sw.withRefracting(next), compile)(); // and the refracting ones
    } catch (e) { console.warn('the room\'s shaders are built when first seen:', e); }
  }
  ctx.viewGate.warm();
  for (const sw of switched) sw.warm();
}
