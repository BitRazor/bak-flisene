// Two potted plants, a rubber duck and a wicker basket: photographed models (fixtures/models.js) placed per
// LAYOUT.plants, LAYOUT.duck and LAYOUT.basket. The succulent stands on the window sill in front of the frame, the
// leafy plant on the floor in the corner beside the vanity, the duck on the shower niche's shelf, the basket on the
// floor under the towel rail (rolled towels go inside it: anchors.inside). Each fixture stands at once (its group,
// pivots and anchors; it draws nothing yet) and fills in when its model arrives (ready).
//
// createPlants(ctx) -> { group, parts, anchors, ready }
//   parts: succulentPivot, leafyPlantPivot (the pot turns on its foot: a hinge about y within LAYOUT's turn; a full
//     circle wraps round, joint.wrap), succulent, leafyPlant (the model, scaled), and once loaded succulentPot,
//     succulentLeaves, leafyPlantPot, leafyPlantLeaves. The leaves carry userData.bend (MODELS bend) and
//     userData.sway (their shader's tilt: a Vector2 in the model's own x/z, radians at the top).
//   anchors: succulentFoot, leafyPlantFoot (the pot's foot centre on its surface).
// createDuck(ctx) -> parts: duckPivot (the hop: a slide up, 0..PLANT_DIMS.duck.hop), squash (its scale squashes the
//   duck from the foot), duck (the model), body (loaded); anchors: foot.
// createBasket(ctx) -> parts: basketPivot (a small give about y), basket (the model), body (loaded); anchors: inside
//   (the middle of its woven floor; local x along its length; userData length, width, depth in metres).
// placeOf(L, key) -> { x, y, z, yaw, scale, turn, rect }: where a thing's foot stands (pure: LAYOUT, MODELS, the floor).
// createSway({ freq, maxTilt }), bendWeight(y, bend), installBend(material, bend): the leaves' sway (pure physics)
// and its bend from the soil up, in the leaves' own shader.
import * as THREE from 'three';
import { pivot, anchor } from './util.js';
import { MODELS, loadModel } from './models.js';
import { lowestUnder } from '../data/floor.js';

export const PLANT_DIMS = {
  shelfT: 0.012, // the niche shelf's thickness (fixtures/shower.js builds it 12 mm thick across the niche's middle)
  settle: 1.5, // seconds for a sway to die away (to 1/60 of its first swing)
  sway: {
    succulent: { freq: 3.4, maxTilt: 0.15 }, // a stiff rosette: quick and small, 8 mm at its tips at most
    leafyPlant: { freq: 2.1, maxTilt: 0.08 }, // leaves on long stalks: slower; 2 cm at the tips, clear of the walls
  },
  duck: { hop: 0.012, squash: { y: 0.84, xz: 1.08 }, pressMs: 90, releaseMs: 380 },
  basket: { give: 0.04, shake: 0.02, ms: 420 },
};

const ENTRY = { succulent: (L) => L.plants.succulent, leafyPlant: (L) => L.plants.leafyPlant, duck: (L) => L.duck, basket: (L) => L.basket };

// The height of the surface a thing stands on, under its foot (rect: the foot in room x/z).
function surfaceY(L, e, rect) {
  if (e.surface === 'floor') return lowestUnder(L, rect); // a flat foot on the lowest floor point under it
  if (e.surface === 'sill') return L.window.y0; // the reveal's tiled sill (scene/shell.js)
  if (e.surface === 'nicheShelf') { const N = L.shower.niche; return (N.y0 + N.y1) / 2 + PLANT_DIMS.shelfT / 2; }
  throw new Error(`plants: unknown surface "${e.surface}"`);
}

export function placeOf(L, key) {
  const e = ENTRY[key](L);
  const [[fx0, fz0], [fx1, fz1]] = MODELS[key].foot;
  const c = Math.cos(e.yaw);
  const s = Math.sin(e.yaw);
  const xs = [];
  const zs = [];
  for (const [fx, fz] of [[fx0, fz0], [fx1, fz0], [fx0, fz1], [fx1, fz1]]) {
    xs.push(e.x + e.scale * (c * fx + s * fz));
    zs.push(e.z + e.scale * (-s * fx + c * fz));
  }
  const rect = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  return { x: e.x, y: surfaceY(L, e, rect), z: e.z, yaw: e.yaw, scale: e.scale, turn: e.turn || 0, rect };
}

// ---------- the sway: a damped spring in two directions (x and z: which way the top leans), integrated in fixed 4 ms
// steps, so it moves the same at any frame rate. A poke throws the top so that its first swing reaches `tilt`; the
// swing dies away to 1/60 in PLANT_DIMS.settle seconds; the top never leans past maxTilt (leaves meeting their limit
// stop there). It asks for frames only while it moves (update returns true) and comes to rest exactly at 0.
const STEP = 0.004;
export function createSway({ freq = 2, maxTilt = 0.1, settle = PLANT_DIMS.settle } = {}) {
  const w = 2 * Math.PI * freq;
  const zw = Math.log(60) / settle; // the envelope e^(-zw t)
  const wd = Math.sqrt(Math.max(1e-6, w * w - zw * zw));
  const tp = Math.atan2(wd, zw) / wd; // time of the first swing's peak from rest
  const throwGain = wd / (Math.exp(-zw * tp) * Math.sin(wd * tp)); // velocity per radian of first swing
  let x = 0;
  let z = 0;
  let vx = 0;
  let vz = 0;
  let acc = 0;
  let moving = false;
  function limit() {
    const r = Math.hypot(x, z);
    if (r > maxTilt) {
      const ux = x / r;
      const uz = z / r;
      x = ux * maxTilt;
      z = uz * maxTilt;
      const out = vx * ux + vz * uz;
      if (out > 0) { vx -= out * ux; vz -= out * uz; }
    }
    // never more energy than one full throw (a frantic visitor cannot pump it up)
    const a = Math.hypot(x, z, vx / w, vz / w);
    const cap = maxTilt * (throwGain / w);
    if (a > cap) { const k = cap / a; x *= k; z *= k; vx *= k; vz *= k; }
  }
  return {
    poke(dx, dz, tilt = maxTilt) {
      const l = Math.hypot(dx, dz);
      if (!(l > 0)) return;
      const t = Math.min(Math.abs(tilt), maxTilt);
      vx += (dx / l) * t * throwGain;
      vz += (dz / l) * t * throwGain;
      limit();
      moving = true;
    },
    update(dtMs) {
      if (!moving) return false;
      acc += Math.min(Math.max(0, dtMs), 100) / 1000;
      while (acc >= STEP) {
        acc -= STEP;
        vx += (-w * w * x - 2 * zw * vx) * STEP;
        vz += (-w * w * z - 2 * zw * vz) * STEP;
        x += vx * STEP;
        z += vz * STEP;
        limit();
      }
      if (Math.hypot(x, z, vx / w, vz / w) < 0.01 * maxTilt) { x = 0; z = 0; vx = 0; vz = 0; acc = 0; moving = false; }
      return moving;
    },
    reset() { x = 0; z = 0; vx = 0; vz = 0; acc = 0; moving = false; },
    get x() { return x; },
    get z() { return z; },
    get moving() { return moving; },
    maxTilt,
  };
}

// ---------- the bend: the leaves lean from the soil up, by h squared (h: height above the soil over the leaves'
// height), so the stalks stay in the soil and the tips travel furthest. bendWeight mirrors the shader for tests.
export function bendWeight(y, bend) {
  const h = Math.min(1, Math.max(0, (y - bend.y0) / bend.height));
  return h * h * bend.height;
}
const BEND_GLSL = '{ float h = clamp( ( position.y - uBend.x ) / uBend.y, 0.0, 1.0 ); transformed.xz += uSway * ( h * h * uBend.y ); }';
export function installBend(material, bend) {
  const sway = { value: new THREE.Vector2() };
  const uBend = { value: new THREE.Vector2(bend.y0, bend.height) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSway = sway;
    shader.uniforms.uBend = uBend;
    shader.vertexShader = `uniform vec2 uSway;\nuniform vec2 uBend;\n${shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${BEND_GLSL}`)}`;
  };
  material.customProgramCacheKey = () => 'plantBend';
  material.needsUpdate = true;
  return sway;
}

// ---------- the fixtures
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// A thing's group at its foot (turned to its yaw) and the holder its model goes into: scaled, its lowest point on the
// group's origin.
function stand(L, key) {
  const at = placeOf(L, key);
  const g = new THREE.Group();
  g.name = key;
  g.position.set(at.x, at.y, at.z);
  g.rotation.y = at.yaw;
  const h = new THREE.Group();
  h.name = `${key}.model`;
  h.scale.setScalar(at.scale);
  h.position.y = -MODELS[key].box[0][1] * at.scale;
  return { at, g, h };
}

// Loads a model into its holder and names its meshes in parts (prefix + Part, or `single` for a one-part model).
function fill(ctx, key, h, parts, prefix, single = null) {
  return loadModel(ctx, key).then((root) => {
    if (!root) return;
    h.add(root);
    root.traverse((o) => {
      if (!o.isMesh) return;
      const part = o.userData.part;
      parts[single || `${prefix}${cap(part)}`] = o;
      if (part === 'leaves' && MODELS[key].bend) {
        o.userData.bend = MODELS[key].bend;
        o.userData.sway = installBend(o.material, MODELS[key].bend);
      }
    });
  });
}

export function createPlants(ctx) {
  const L = ctx.layout;
  const group = new THREE.Group();
  group.name = 'plants';
  const parts = {};
  const anchors = {};
  const loads = [];
  for (const key of ['succulent', 'leafyPlant']) {
    const { at, g, h } = stand(L, key);
    const full = at.turn >= Math.PI - 1e-9;
    const p = pivot(`${key}Pivot`, 0, 0, 0, { type: 'hinge', axis: [0, 1, 0], min: full ? -Math.PI : -at.turn, max: full ? Math.PI : at.turn });
    if (full) p.userData.joint.wrap = true;
    p.add(h);
    g.add(p);
    group.add(g);
    parts[`${key}Pivot`] = p;
    parts[key] = h;
    anchors[`${key}Foot`] = anchor(`${key}Foot`, g, 0, 0, 0);
    loads.push(fill(ctx, key, h, parts, key));
  }
  const fixture = { group, parts, anchors };
  fixture.ready = Promise.all(loads).then(() => fixture);
  return fixture;
}

export function createDuck(ctx) {
  const { g, h } = stand(ctx.layout, 'duck');
  const parts = {};
  const anchors = {};
  parts.duckPivot = pivot('duckPivot', 0, 0, 0, { type: 'slide', axis: [0, 1, 0], min: 0, max: PLANT_DIMS.duck.hop });
  parts.squash = new THREE.Group();
  parts.squash.name = 'duck.squash';
  parts.squash.add(h);
  parts.duckPivot.add(parts.squash);
  g.add(parts.duckPivot);
  parts.duck = h;
  anchors.foot = anchor('foot', g, 0, 0, 0);
  const fixture = { group: g, parts, anchors };
  fixture.ready = fill(ctx, 'duck', h, parts, 'duck', 'body').then(() => fixture);
  return fixture;
}

export function createBasket(ctx) {
  const { at, g, h } = stand(ctx.layout, 'basket');
  const B = PLANT_DIMS.basket;
  const parts = {};
  const anchors = {};
  parts.basketPivot = pivot('basketPivot', 0, 0, 0, { type: 'hinge', axis: [0, 1, 0], min: -B.give, max: B.give });
  parts.basketPivot.add(h);
  g.add(parts.basketPivot);
  parts.basket = h;
  const I = MODELS.basket.inside;
  anchors.inside = anchor('inside', h, 0, I.y, 0, { length: I.length * at.scale, width: I.width * at.scale, depth: I.depth * at.scale });
  const fixture = { group: g, parts, anchors };
  fixture.ready = fill(ctx, 'basket', h, parts, 'basket', 'body').then(() => fixture);
  return fixture;
}
