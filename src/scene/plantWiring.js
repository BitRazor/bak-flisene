// The plants, the rubber duck and the wicker basket answer touches (fixtures/plants.js). scene/interactions.js
// install() calls wirePlants(ctx, helpers) after its own wiring, with the same helpers; each thing is wired when its
// model has arrived (its fixture's ready), so nothing of it can be touched before it is seen. From then on, too, the
// mirror counts its first uses (helpers.discoverable) and a thing on the floor is in the visitor's way
// (core/walkArea.js addLow): after a failed or a stuck download the mirror never counts a thing nobody can find and
// the walk meets no invisible wall (review 2026-10-19, findings 7 and 9).
// - a leaf tapped: the plant sways (a damped spring, fixtures/plants.js createSway; it settles in about 1.5 s) and its
//   leaves rustle; more taps keep it going, never past its limit (PLANT_SWAY: the leafy plant's tips swing about 5 cm,
//   never into a wall, the vanity or past its own floor, SWAY_ROOM). The small succulent turns all the way round and
//   answers anywhere on it (one finger-sized touch box): on its pot (at or below the rim) a knock, above it a rustle.
// - the pot dragged sideways: it turns on its foot within its free range and the leaves rustle once; let go, the
//   leaves wobble and the pot stays turned. A tap on the pot knocks it (terracotta, ceramic) and the leaves shiver.
// - the duck tapped: a squeak; it squashes under the finger, springs back a little past its shape and hops a
//   centimetre on the shelf. Squeeze it as often as you like.
// - the basket tapped: a dry wicker knock and a small give.
// The room plays nothing by itself (the owner, 2026-10-19): every sound and motion here follows a touch, and the
// plants ask for frames only while they sway (update returns false at rest).
// Sounds (PLANT_SOUNDS, roles in app/assets/sounds/manifest.json): when the sound list is known (ctx.assets.manifest)
// and a role is not in it, the leaves use a quiet paper rustle and the basket a low wood knock; the duck stays silent.
import * as THREE from 'three';
import { setJoint } from '../fixtures/util.js';
import { createSway, bendWeight, PLANT_DIMS } from '../fixtures/plants.js';
import { hingeDragMaker, jv, axisW } from './touchKit.js';

export const PLANT_DISCOVERIES = ['plantSway', 'plantTurn', 'duck', 'basket'];
export const PLANT_SOUNDS = { leaf: 'leaf_rustle', pot: 'knock_ceramic', duck: 'duck_squeak', basket: 'knock_wicker' };
const FALLBACK = {
  leaf_rustle: ['paper_rustle', { volume: 0.5, rate: 1.35 }],
  knock_wicker: ['knock_wood', { volume: 0.8, rate: 0.72 }],
};
const PLANTS = ['succulent', 'leafyPlant'];

// The sway (createSway: how far the top leans at most, how quickly it swings; it settles in PLANT_DIMS.settle, 1.5 s).
// The succulent is a stiff rosette: PLANT_DIMS' small, quick sway (8 mm at its tips). The leafy plant's 2 cm were too
// little to see (the look, 2026-10-19: "very small and easy to miss"): its leaf tips now swing up to about 5 cm, a
// little slower. In each direction its leaves stop short of whatever is near them (freeTilt, measured from their own
// geometry and the room): at the pot's middle turn nothing stops a full swing; turned to an end, they lean less toward
// the wall or the vanity there.
export const PLANT_SWAY = {
  succulent: PLANT_DIMS.sway.succulent,
  leafyPlant: { freq: 1.8, maxTilt: 0.18 },
};
// How the free room is measured: in `dirs` directions (5 degrees apart; a lean between two takes the smaller), `gap`
// metres short of a wall, the plant's own floor (LAYOUT reach: the walking area keeps the visitor off it) or a fixture
// (a drawer counted pulled fully out), and no further than `over` times the plant's fullest lean (more is never used);
// a push throws the leaves at most `first` of the free room its way. It is measured at the pot's turns on a grid
// `turnStep` apart (and at the ends of its range), each grid turn once and kept; at a turn between two grid turns the
// leaves get the smaller room of the two each way. A pot turned while its leaves swayed was measured again on most
// frames (1.5-7.5 ms each on a phone: review 2026-10-20, finding 5). Between two grid turns 2 degrees apart a leaf
// tip 30 cm from the pot's axis moves 1 cm along an arc that stays within 0.05 mm of the straight line between its
// ends, so the smaller room of the two holds there (tests/plants.test.js checks turns between grid turns).
export const SWAY_ROOM = { dirs: 72, gap: 0.002, over: 1.25, first: 0.98, turnStep: Math.PI / 90, measured: ['leafyPlant'] };
// the photographed things themselves (not obstacles to their own leaves)
const MODEL_FIXTURES = new Set(['plants', 'duck', 'basket', 'towelRolls']);

// an angle into -pi..pi (a pot that turns all the way round)
const wrapAngle = (a) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
// scratch for the leaves' turn (no allocations per frame)
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _box = new THREE.Box3();

// A fixture's box in the room (its visible meshes, not its invisible touch boxes), with every slide in it (a drawer,
// the plug) at either end of its travel.
function reachBox(group) {
  const out = new THREE.Box3();
  group.updateWorldMatrix(true, true);
  const add = (root, shift) => root.traverseVisible((o) => {
    if (!o.isMesh || o.userData.touchBox || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    _box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    if (shift) _box.translate(shift);
    out.union(_box);
  });
  add(group, null);
  group.traverse((o) => {
    const j = o.userData && o.userData.joint;
    if (!j || j.type !== 'slide' || !o.parent) return;
    for (const end of [j.min, j.max]) add(o, axisW(o).multiplyScalar(end - j.value));
  });
  return out;
}

// How far the leaves may lean in each of SWAY_ROOM.dirs directions (radians of tilt; direction k lies k * 360 / dirs
// degrees from the room's +x toward +z), for the pose they are in now. The leaves bend level, a leaf at height y by
// tilt x bendWeight (fixtures/plants.js), so each leaf moves on a straight line as the plant leans; a leaf already
// within the gap of a fixture allows no lean at all.
function measureRoom(ctx, key, leaves, maxTilt) {
  const L = ctx.layout;
  const g = SWAY_ROOM.gap;
  const reach = L.plants && L.plants[key] && L.plants[key].reach;
  const xMax = Math.min(L.room.W, reach ? reach.x1 : Infinity) - g;
  const xMin = Math.max(0, reach ? reach.x0 : -Infinity) + g;
  const zMax = Math.min(L.room.D, reach ? reach.z1 : Infinity) - g;
  const zMin = Math.max(0, reach ? reach.z0 : -Infinity) + g;
  leaves.updateWorldMatrix(true, false);
  const scale = _s.setFromMatrixScale(leaves.matrixWorld).x;
  const pos = leaves.geometry.attributes.position;
  const pts = []; // x, y, z and metres travelled per radian, for every leaf point that moves
  let gx1 = Infinity; // the walls and the floor's edges: the least tilt that brings a leaf to each
  let gx0 = Infinity;
  let gz1 = Infinity;
  let gz0 = Infinity;
  let wMax = 0;
  for (let i = 0; i < pos.count; i++) {
    const w = bendWeight(pos.getY(i), leaves.userData.bend) * scale;
    if (!(w > 0)) continue;
    _p.fromBufferAttribute(pos, i).applyMatrix4(leaves.matrixWorld);
    pts.push(_p.x, _p.y, _p.z, w);
    gx1 = Math.min(gx1, (xMax - _p.x) / w);
    gx0 = Math.min(gx0, (_p.x - xMin) / w);
    gz1 = Math.min(gz1, (zMax - _p.z) / w);
    gz0 = Math.min(gz0, (_p.z - zMin) / w);
    wMax = Math.max(wMax, w);
  }
  // the fixtures a leaf could reach (leaning up to `cap`, beyond any swing), each grown by the gap, and the leaf points
  // near enough to one to meet it
  const cap = SWAY_ROOM.over * maxTilt;
  const around = new THREE.Box3().setFromObject(leaves);
  around.expandByVector(_s.set(cap * wMax + g, g, cap * wMax + g));
  const near = []; // [box, indices into pts]
  for (const [name, f] of Object.entries(ctx.fixtures || {})) {
    if (!f || !f.group || MODEL_FIXTURES.has(name)) continue;
    const b = reachBox(f.group);
    if (b.isEmpty() || !b.intersectsBox(around)) continue;
    b.expandByScalar(g);
    const idx = [];
    for (let i = 0; i < pts.length; i += 4) {
      if (pts[i + 1] < b.min.y || pts[i + 1] > b.max.y) continue;
      const ox = Math.max(b.min.x - pts[i], 0, pts[i] - b.max.x);
      const oz = Math.max(b.min.z - pts[i + 2], 0, pts[i + 2] - b.max.z);
      if (Math.hypot(ox, oz) <= cap * pts[i + 3]) idx.push(i);
    }
    if (idx.length) near.push([b, idx]);
  }
  const out = new Float64Array(SWAY_ROOM.dirs);
  for (let k = 0; k < out.length; k++) {
    const a = (k / out.length) * 2 * Math.PI;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    let t = cap;
    if (dx > 1e-9) t = Math.min(t, gx1 / dx); else if (dx < -1e-9) t = Math.min(t, gx0 / -dx);
    if (dz > 1e-9) t = Math.min(t, gz1 / dz); else if (dz < -1e-9) t = Math.min(t, gz0 / -dz);
    for (const [b, idx] of near) {
      for (const i of idx) {
        // when does the leaf's straight path (x, z) + tilt * w * (dx, dz) enter the box's floor plan? (slabs)
        const x = pts[i];
        const z = pts[i + 2];
        const ux = dx * pts[i + 3];
        const uz = dz * pts[i + 3];
        let tIn = 0;
        let tOut = Infinity;
        if (Math.abs(ux) < 1e-12) {
          if (x < b.min.x || x > b.max.x) continue;
        } else {
          const ta = (b.min.x - x) / ux;
          const tb = (b.max.x - x) / ux;
          tIn = Math.max(tIn, Math.min(ta, tb));
          tOut = Math.min(tOut, Math.max(ta, tb));
        }
        if (Math.abs(uz) < 1e-12) {
          if (z < b.min.z || z > b.max.z) continue;
        } else {
          const ta = (b.min.z - z) / uz;
          const tb = (b.max.z - z) / uz;
          tIn = Math.max(tIn, Math.min(ta, tb));
          tOut = Math.min(tOut, Math.max(ta, tb));
        }
        if (tIn <= tOut && tOut >= 0) t = Math.min(t, tIn);
      }
    }
    out[k] = Math.max(0, t);
  }
  return out;
}

export function wirePlants(ctx, { found, play, reg, control, loop, tweens, discoverable = null }) {
  const F = ctx.fixtures || {};
  const hingeDrag = hingeDragMaker(tweens, loop);
  let warned = false;
  const seen = (key) => {
    try { found(key); } catch (e) { if (!warned) { warned = true; console.warn('plants: the room\'s discoveries do not know this key (PLANT_DISCOVERIES)', e); } }
  };
  // the mirror counts a thing's first uses once it can be found: when its model is in (never for a failed download)
  const findable = (keys) => { if (discoverable && keys.length) discoverable(keys); };
  // and a thing on the floor is in the visitor's way from then on (core/walkArea.js: no invisible wall before)
  const onFloor = (key) => { const walk = ctx.rig && ctx.rig.walkArea; if (walk && walk.addLow) walk.addLow(key); };
  function sound(role, opts = {}) {
    const list = ctx.assets && ctx.assets.manifest && ctx.assets.manifest.sounds;
    if (list && !list[role]) {
      const fb = FALLBACK[role];
      return fb ? play(fb[0], { ...opts, ...fb[1], volume: (opts.volume ?? 1) * fb[1].volume }) : null;
    }
    return play(role, opts);
  }

  // ---------- the plants' sway: pushed away from the eye, level; each frame the leaves get the tilt in their own frame,
  // never further any way than the room there allows (freeTilt)
  const sways = {};
  for (const key of PLANTS) sways[key] = createSway(PLANT_SWAY[key]);
  const P = F.plants;
  // the free room per direction at each grid turn of the pot it was measured at (SWAY_ROOM.turnStep), and for the turn
  // asked last the smaller of its two grid turns' each way
  const rooms = {};
  const stats = { measured: 0 };
  function gridRoom(key, room, leaves, pivot, k) {
    if (!room.grid.has(k)) {
      const was = jv(pivot);
      setJoint(pivot, k * SWAY_ROOM.turnStep); // (clamped to the pot's range: the grid's ends are the range's ends)
      pivot.updateWorldMatrix(false, true);
      room.grid.set(k, measureRoom(ctx, key, leaves, PLANT_SWAY[key].maxTilt));
      setJoint(pivot, was); // back where it stands, in the same task: nothing is drawn in between
      pivot.updateWorldMatrix(false, true);
      stats.measured++;
    }
    return room.grid.get(k);
  }
  function roomOf(key) {
    const leaves = P && P.parts[`${key}Leaves`];
    const pivot = P && P.parts[`${key}Pivot`];
    if (!SWAY_ROOM.measured.includes(key) || !leaves || !leaves.userData.bend || !pivot) return null;
    const room = rooms[key] || (rooms[key] = { grid: new Map(), turn: NaN, limits: new Float64Array(SWAY_ROOM.dirs) });
    const turn = jv(pivot);
    if (room.turn !== turn) {
      const f = turn / SWAY_ROOM.turnStep;
      const on = Math.abs(f - Math.round(f)) < 1e-6; // on a grid turn (to a hair: 4e-8 rad)
      const a = gridRoom(key, room, leaves, pivot, on ? Math.round(f) : Math.floor(f));
      const b = on ? a : gridRoom(key, room, leaves, pivot, Math.ceil(f));
      for (let i = 0; i < room.limits.length; i++) room.limits[i] = Math.min(a[i], b[i]);
      room.turn = turn;
    }
    return room.limits;
  }
  // the most the plant's leaves may lean toward room direction `angle` (radians from +x toward +z), as it stands now
  function freeTilt(key, angle) {
    const lim = roomOf(key);
    if (!lim) return Infinity;
    const n = lim.length;
    const f = (((angle / (2 * Math.PI)) * n) % n + n) % n;
    const i = Math.floor(f) % n;
    return Math.min(lim[i], lim[(i + 1) % n]);
  }
  function push(key, point, share = 1) {
    const s = sways[key];
    let dx = point.x - ctx.camera.position.x;
    let dz = point.z - ctx.camera.position.z;
    if (!(Math.hypot(dx, dz) > 1e-6)) { dx = 0; dz = -1; }
    // the first swing goes no further than the room allows that way; the swings after it are held as they are shown
    s.poke(dx, dz, Math.min(s.maxTilt * share, SWAY_ROOM.first * freeTilt(key, Math.atan2(dz, dx))));
    loop.wake(300);
  }
  function apply(key) {
    const leaves = P && P.parts[`${key}Leaves`];
    const u = leaves && leaves.userData.sway;
    if (!u) return;
    const s = sways[key];
    let x = s.x;
    let z = s.z;
    const r = Math.hypot(x, z);
    if (r > 0) { const m = freeTilt(key, Math.atan2(z, x)); if (r > m) { x *= m / r; z *= m / r; } }
    // the leaves' turn in the room (their group's yaw and the pot's turn): rotate the room tilt into their own frame
    leaves.updateWorldMatrix(true, false);
    leaves.matrixWorld.decompose(_p, _q, _s);
    const ex = 1 - 2 * (_q.y * _q.y + _q.z * _q.z); // world x of the model's +x
    const ez = 2 * (_q.x * _q.z - _q.w * _q.y); // world z of the model's +x
    const yaw = Math.atan2(-ez, ex);
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    u.value.set(c * x - sn * z, sn * x + c * z);
  }
  function update(dt) {
    let busy = false;
    for (const key of PLANTS) {
      const s = sways[key];
      if (!s.moving) continue;
      busy = s.update(dt) || busy;
      apply(key);
    }
    return busy;
  }
  loop.add(update);

  const leafTap = (key) => (hit) => {
    push(key, hit.point);
    sound(PLANT_SOUNDS.leaf, { volume: key === 'succulent' ? 0.45 : 0.7 });
    seen('plantSway');
  };
  // the pot: dragged round on its foot (a hinge about y, the drag along its rim), tapped: a knock. With onTapElse (the
  // small succulent: one handler and one finger box for all of it) where the finger lands decides: the pot itself, or
  // the box at or below the pot's rim, knocks; the leaves, or the box above the rim, answer with onTapElse (the look,
  // 2026-10-19: a tap on the succulent's pot rustled its leaves)
  const rimBox = new THREE.Box3();
  const onPot = (key, hit) => {
    const pot = P.parts[`${key}Pot`];
    if (!pot || hit.object === P.parts[`${key}Leaves`]) return false;
    if (hit.object === pot) return true;
    return !!hit.point && hit.point.y <= rimBox.setFromObject(pot).max.y;
  };
  function potHandler(key, onTapElse = null) {
    const p = P.parts[`${key}Pivot`];
    const wrap = !!p.userData.joint.wrap;
    const turn = hingeDrag(p, { set: wrap ? (x, v) => setJoint(x, wrapAngle(v)) : setJoint });
    return {
      tap(hit) {
        if (onTapElse && !onPot(key, hit)) { onTapElse(hit); return; }
        sound(PLANT_SOUNDS.pot, { volume: 0.5 });
        push(key, hit.point, 0.3);
      },
      dragAxis: turn.dragAxis,
      dragStart(hit, e) {
        turn.dragStart(hit, e);
        sound(PLANT_SOUNDS.leaf, { volume: 0.35, rate: 0.9 });
        seen('plantTurn');
      },
      drag: turn.drag,
      dragEnd(hit, e) {
        turn.dragEnd(hit, e);
        if (hit && hit.point) push(key, hit.point, 0.35); // let go: the leaves wobble
      },
      repeat: true,
      knock: 'ceramic',
    };
  }

  // ---------- the duck: squeezed (squash, spring back past its shape, a little hop)
  function duckTap() {
    const D = F.duck;
    const DD = PLANT_DIMS.duck;
    const sq = D.parts.squash.scale;
    const pv = D.parts.duckPivot;
    sound(PLANT_SOUNDS.duck, { volume: 0.8 });
    seen('duck');
    const x0 = sq.x;
    const y0 = sq.y;
    tweens.add({
      key: 'duck.squash', from: 0, to: 1, duration: DD.pressMs, ease: 'outCubic',
      onUpdate: (v) => sq.set(x0 + (DD.squash.xz - x0) * v, y0 + (DD.squash.y - y0) * v, x0 + (DD.squash.xz - x0) * v),
      onDone: () => tweens.add({
        key: 'duck.squash', from: 0, to: 1, duration: DD.releaseMs, ease: 'outBack',
        onUpdate: (v) => sq.set(DD.squash.xz + (1 - DD.squash.xz) * v, DD.squash.y + (1 - DD.squash.y) * v, DD.squash.xz + (1 - DD.squash.xz) * v),
        onDone: () => sq.set(1, 1, 1),
      }),
    });
    tweens.add({
      key: 'duck.hop', from: jv(pv), to: DD.hop, duration: 150, delay: DD.pressMs, ease: 'outCubic',
      onUpdate: (v) => setJoint(pv, v),
      onDone: () => tweens.add({ key: 'duck.hop', from: DD.hop, to: 0, duration: 200, ease: 'inQuad', onUpdate: (v) => setJoint(pv, v) }),
    });
    loop.wake(DD.pressMs + DD.releaseMs + 300);
  }

  // ---------- the basket: a knock and a small give, side to side in turn
  let side = 1;
  function basketTap() {
    const p = F.basket.parts.basketPivot;
    const B = PLANT_DIMS.basket;
    sound(PLANT_SOUNDS.basket, { volume: 0.7 });
    seen('basket');
    side = -side;
    const s = side;
    tweens.add({
      key: 'basket.give', from: 0, to: 1, duration: B.ms, ease: 'linear',
      onUpdate: (t) => setJoint(p, s * B.shake * Math.sin(t * Math.PI * 5) * (1 - t) * (1 - t)),
      onDone: () => setJoint(p, 0),
    });
    loop.wake(B.ms + 100);
  }

  // ---------- wire each thing when its model is in (its touches, and the mirror counts its first uses from then on)
  const waits = [];
  if (P && P.ready) {
    waits.push(P.ready.then(() => {
      const succulent = !!(P.parts.succulentPot || P.parts.succulentLeaves);
      if (P.parts.leafyPlantLeaves) reg(P.parts.leafyPlantLeaves, { tap: leafTap('leafyPlant'), repeat: true });
      if (P.parts.leafyPlantPot) reg(P.parts.leafyPlantPot, potHandler('leafyPlant'));
      if (P.parts.leafyPlantPot || P.parts.leafyPlantLeaves) onFloor('leafyPlant');
      roomOf('leafyPlant'); // its free room measured now (a few milliseconds), not at the first tap
      // the small succulent: one handler for all of it and a finger-sized box round it
      if (succulent) control(P.parts.succulentPivot, potHandler('succulent', leafTap('succulent')), 0.09);
      findable([
        ...(P.parts.leafyPlantLeaves || succulent ? ['plantSway'] : []),
        ...(P.parts.leafyPlantPot || succulent ? ['plantTurn'] : []),
      ]);
    }));
  }
  if (F.duck && F.duck.ready) {
    waits.push(F.duck.ready.then(() => {
      if (!F.duck.parts.body) return;
      control(F.duck.parts.duckPivot, { tap: duckTap, repeat: true }, 0.08);
      findable(['duck']);
    }));
  }
  if (F.basket && F.basket.ready) {
    // the basket's own mesh only: the rolled towels lying in it (fixtures/index.js furnish) answer for themselves
    waits.push(F.basket.ready.then(() => {
      if (!F.basket.parts.body) return;
      reg(F.basket.parts.body, { tap: basketTap, knock: 'wood' });
      onFloor('basket');
      findable(['basket']);
    }));
  }
  const api = { sways, update, freeTilt, stats };
  api.ready = Promise.all(waits).then(() => api);
  return api;
}
