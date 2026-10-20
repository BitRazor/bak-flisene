// The brass "Membran" button: shows the waterproofing hidden behind the tiles, only where the owner lays it (his
// practice, kontor/decisions.md 2026-10-19): the whole floor, an upstand on every wall (a level line 5 cm above the
// highest point of the finished floor), the walls of the shower area to full height plus 1 m beyond it, and 50 cm
// around the basin. Two looks for him to choose between:
//   look 1, "frosted": the tiles turn to frosted glass and the blue membrane shows through them;
//   look 2, "laid": the tiles are gone and the membrane shows as laid: rolled on in 25 cm lanes (lap marks, a fine
//   stipple, a second coat), the reinforcing tape lapping 5 cm up the wall and 5 cm onto the floor at every floor-wall
//   joint, up the shower's inside corner and round the niche, a collar round every pipe through it (the thermostat's
//   two connections, the basin's supplies and waste, the soil stack through the floor), and at the drain the membrane
//   lapped onto the drain's collar under the steel clamp ring (the grate and its frame lifted away with the tiles).
// It follows the room as built: the floor's fall (data/floor.js), the door (the upstand stops at the jambs; the floor
// membrane runs on under the threshold), and the toilet: with the wall-hung one the upstand and the tape turn onto the
// boxing's face and sides; with the floor-standing one they run along the wall. It takes the room's baked light like
// the tiles it covers (each sheet carries its surface's uv1 and the shell's baked-only shading, scene/lighting.js).
// The toilet's frame, cistern and pipes show too (its boxing turns to frosted glass), and a flush runs through them.
import * as THREE from 'three';
import { floorHeight, floorGrid, isDrainCell, upstandTop } from '../data/floor.js';
import { surfaceUV1 } from './shell.js';
import { bakeShellMesh } from './lighting.js';
import { packedUV1 } from './packedLight.js';
import { SHOWER_DIMS } from '../fixtures/shower.js';

const MEMBRANE_M = 1.25; // metres one membrane picture covers: five 25 cm roller lanes
const TAPE_M = 0.2;

// A fixed pseudo-random number in 0..1 for integer inputs (the pictures must come out the same every time).
function hash(a, b, c = 0) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483587);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// The liquid membrane as rolled on, as RGBA pixels (S x S, covering MEMBRANE_M metres): vertical lanes 25 cm wide, each
// its own shade and fading as the roller empties, a darker lap where one lane overlaps the next, the roller's fine
// streaks, a soft mottle, a stipple, and the second coat laid half a lane over. Seamless (every term repeats exactly
// at the edges); 1.25 m before it repeats. Pure (tests/membrane.test.js checks the seams and the lanes).
export function membranePixels(S = 640) {
  const lane = S / 5;
  const px = new Uint8ClampedArray(S * S * 4);
  const base = [92, 134, 160];
  const TAU = Math.PI * 2;
  const k1 = S / 640; // the lap's width scales with the picture
  const lapAt = (d) => 1 - 0.05 * Math.exp(-((d / (9 * k1)) ** 2)) + 0.022 * Math.exp(-(((d - 5 * k1) / (1.6 * k1)) ** 2));
  const wrap = (v) => ((v % S) + S) % S;
  for (let x = 0; x < S; x++) {
    const streak = (hash(x, 5) - 0.5) * 0.03;
    for (let y = 0; y < S; y++) {
      // a hand-rolled lane wanders a little: its edges move a few millimetres along the wall
      const xw = wrap(x + 4 * k1 * Math.sin(TAU * ((2 * y) / S + x / S)));
      const i = Math.floor(xw / lane);
      const d = Math.min(xw % lane, lane - (xw % lane));
      const x2 = wrap(xw + lane / 2); // the second coat, half a lane over
      const j = Math.floor(x2 / lane);
      const d2 = Math.min(x2 % lane, lane - (x2 % lane));
      const tone = 1 + (hash(i, 1) - 0.5) * 0.06;
      const tone2 = (hash(j, 3) - 0.5) * 0.04;
      const lap = lapAt(d) * (1 - 0.02 * Math.exp(-((d2 / 6) ** 2)));
      const load = 1 - 0.035 * (0.5 + 0.5 * Math.sin((y / S) * TAU * (1 + (i % 2)) + i * 1.7));
      const mottle = 0.025 * Math.sin((x / S) * TAU * 2 + 0.3) * Math.sin((y / S) * TAU * 3) + 0.012 * Math.sin(((5 * x + 7 * y) / S) * TAU);
      const f = tone * lap * load + mottle + streak + (hash(x, y, 9) - 0.5) * 0.06;
      const k = (y * S + x) * 4;
      px[k] = base[0] * f * (1 - tone2);
      px[k + 1] = base[1] * f;
      px[k + 2] = base[2] * f * (1 + tone2);
      px[k + 3] = 255;
    }
  }
  return px;
}

function membraneTexture() {
  if (typeof document === 'undefined') return null;
  const S = 640;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  img.data.set(membranePixels(S));
  g.putImageData(img, 0, 0);
  return canvasTexture(c, MEMBRANE_M);
}

// The reinforcing tape and the collars: a fleece-backed rubber, light grey, fibres running along the tape.
function tapeTexture() {
  if (typeof document === 'undefined') return null;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const px = img.data;
  for (let x = 0; x < S; x++) {
    for (let y = 0; y < S; y++) {
      const fibre = (hash(x, Math.floor(y / 6), 11) - 0.5) * 0.08;
      const f = 1 + fibre + (hash(x, y, 13) - 0.5) * 0.1;
      const k = (y * S + x) * 4;
      px[k] = Math.min(255, 196 * f);
      px[k + 1] = Math.min(255, 206 * f);
      px[k + 2] = Math.min(255, 212 * f);
      px[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return canvasTexture(c, TAPE_M);
}

function canvasTexture(c, metres) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / metres, 1 / metres);
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------- geometry pieces ({ pos, uv, idx } in room metres)
const v2 = (a, b) => new THREE.Vector2(a, b);

// A plane frame: point (s along the wall, t up) -> o + s * u + t * up, `lift` off the plane along n (into the room).
const at = (fr, s, t, lift) => [fr.o[0] + s * fr.u[0] + lift * fr.n[0], t, fr.o[2] + s * fr.u[2] + lift * fr.n[2]];

// A sheet on a frame from a Shape in (s, t) metres; uv = (s, t).
function shapeOnFrame(fr, shape, lift) {
  const g = new THREE.ShapeGeometry(shape, 24);
  const p = g.attributes.position;
  const pos = [];
  const uv = [];
  for (let i = 0; i < p.count; i++) {
    pos.push(...at(fr, p.getX(i), p.getY(i), lift));
    uv.push(p.getX(i), p.getY(i));
  }
  const idx = Array.from(g.index.array);
  g.dispose();
  return { pos, uv, idx };
}
function rectShape(s0, s1, t0, t1, holes = []) {
  const shape = new THREE.Shape([v2(s0, t0), v2(s1, t0), v2(s1, t1), v2(s0, t1)]);
  for (const [a, b, c, d] of holes) shape.holes.push(new THREE.Path([v2(a, c), v2(b, c), v2(b, d), v2(a, d)]));
  return shape;
}

export function createMembraneView(ctx) {
  const { scene, layout: L, tweens, loop, quality } = ctx;
  const { W, D, H } = L.room;
  const sh = L.shower;
  const wz = L.wetZone;
  const T = L.toilet;
  const dr = sh.drain;
  const off = 0.0025;
  const cell = L.floor.cell;
  const foot = -L.floor.wallFoot;
  const upTop = upstandTop(L); // level: 5 cm over the floor's highest point
  const group = new THREE.Group();
  group.name = 'membrane';
  group.visible = false;
  scene.add(group);

  const bd = T.boxing.depth;
  const FR = {
    wall_back: { o: [0, 0, 0], u: [1, 0, 0], n: [0, 0, 1], target: 'wall_back' },
    wall_front: { o: [W, 0, D], u: [-1, 0, 0], n: [0, 0, -1], target: 'wall_front' },
    wall_left: { o: [0, 0, D], u: [0, 0, -1], n: [1, 0, 0], target: 'wall_left' },
    wall_right: { o: [W, 0, 0], u: [0, 0, 1], n: [-1, 0, 0], target: 'wall_right' },
    boxing_front: { o: [W - bd, 0, 0], u: [0, 0, 1], n: [-1, 0, 0], target: 'boxing' },
    boxing_back: { o: [W, 0, T.boxing.z0], u: [-1, 0, 0], n: [0, 0, -1], target: 'boxing' },
    boxing_door: { o: [W - bd, 0, T.boxing.z1], u: [1, 0, 0], n: [0, 0, 1], target: 'boxing' },
  };

  // pieces collect in buckets: one mesh per (kind, target, toilet variant)
  const buckets = new Map();
  function put(kind, target, variant, piece) {
    const key = `${kind}|${target}|${variant}`;
    if (!buckets.has(key)) buckets.set(key, { kind, target, variant, pieces: [] });
    buckets.get(key).pieces.push(piece);
  }

  // a strip on a frame whose foot follows the floor: from the floor (less `below`) up `height` or to a level `top`
  function footStrip(fr, s0, s1, { below = 0.01, height = 0, top = null }, lift) {
    const n = Math.max(1, Math.round((s1 - s0) / cell));
    const pos = [];
    const uv = [];
    const idx = [];
    for (let k = 0; k <= n; k++) {
      const s = s0 + ((s1 - s0) * k) / n;
      const [x, , z] = at(fr, s, 0, 0);
      const f = floorHeight(L, x, z);
      const b = f - below;
      const t = top ?? f + height;
      pos.push(...at(fr, s, b, lift), ...at(fr, s, t, lift));
      uv.push(s, b, s, t);
      if (k < n) idx.push(2 * k, 2 * k + 2, 2 * k + 3, 2 * k, 2 * k + 3, 2 * k + 1);
    }
    return { pos, uv, idx };
  }
  // a band on the floor along a frame's foot, from the wall line `w` metres into the room
  function floorBand(fr, s0, s1, w, lift) {
    const n = Math.max(1, Math.round((s1 - s0) / cell));
    const pos = [];
    const uv = [];
    const idx = [];
    for (let k = 0; k <= n; k++) {
      const s = s0 + ((s1 - s0) * k) / n;
      const [bx, , bz] = at(fr, s, 0, 0);
      const ix = bx + w * fr.n[0];
      const iz = bz + w * fr.n[2];
      pos.push(bx, floorHeight(L, bx, bz) + lift, bz, ix, floorHeight(L, ix, iz) + lift, iz);
      uv.push(bx, bz, ix, iz);
      if (k < n) idx.push(2 * k, 2 * k + 1, 2 * k + 3, 2 * k, 2 * k + 3, 2 * k + 2);
    }
    return { pos, uv, idx };
  }
  // a shape lying on the floor, (x, z) in the shape's (x, y); heights from the floor plus `lift`
  function floorShape(shape, lift) {
    const g = new THREE.ShapeGeometry(shape, 32);
    const p = g.attributes.position;
    const pos = [];
    const uv = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getY(i);
      pos.push(x, floorHeight(L, x, z) + lift, z);
      uv.push(x, z);
    }
    const a = g.index.array;
    const idx = [];
    for (let i = 0; i < a.length; i += 3) idx.push(a[i], a[i + 2], a[i + 1]); // (x, z) shapes wind the other way up
    g.dispose();
    return { pos, uv, idx };
  }
  function gridPiece(g) {
    const uv = [];
    for (let i = 0; i < g.positions.length; i += 3) uv.push(g.positions[i], g.positions[i + 2]);
    return { pos: g.positions, uv, idx: g.index };
  }
  // the tape along a floor-wall joint: 5 cm onto the floor and 5 cm up the wall
  function tapeJoint(fr, s0, s1, variant) {
    put('tape', 'floor', variant, floorBand(fr, s0, s1, 0.05, off * 1.6));
    put('tape', fr.target, variant, footStrip(fr, s0, s1, { below: fr.target === 'boxing' ? 0.0005 : 0.01, height: 0.05 }, off * 1.6));
  }
  // a collar where a pipe comes through: a square of fleece-backed rubber with the pipe's round hole
  function wallCollar(fr, s, t, size, r, variant = 'all') {
    const shape = rectShape(s - size / 2, s + size / 2, t - size / 2, t + size / 2);
    shape.holes.push(new THREE.Path().absarc(s, t, r, 0, Math.PI * 2, true));
    put('collar', fr.target, variant, shapeOnFrame(fr, shape, off * 1.8));
  }

  // --- the floor, all of it, open round the drain (where its collar and clamp ring are)
  const dHole = 0.15;
  const nearDrain = (cx, cz) => Math.abs(cx - dr.x) < dHole && Math.abs(cz - dr.z) < dHole;
  put('sheet', 'floor', 'all', gridPiece(floorGrid(L, { x0: 0, x1: W, z0: 0, z1: D, lift: off, skip: nearDrain })));
  // look 1: the frosted membrane runs right up to the drain's frame
  put('apron', 'floor', 'all', gridPiece(floorGrid(L, { x0: dr.x - dHole, x1: dr.x + dHole, z0: dr.z - dHole, z1: dr.z + dHole, lift: off, skip: (cx, cz) => isDrainCell(L, cx, cz) })));
  // look 2: the drain's collar (laid into the drain, its round hole the drain's throat), the membrane lapped onto it
  // all the way in under the steel clamp ring that clamps both (Ardex/SINTEF: no bare collar between membrane and ring)
  const collarShape = rectShape(dr.x - dHole, dr.x + dHole, dr.z - dHole, dr.z + dHole);
  collarShape.holes.push(new THREE.Path().absarc(dr.x, dr.z, SHOWER_DIMS.drain.throat, 0, Math.PI * 2, true));
  put('collar', 'floor', 'all', floorShape(collarShape, off * 0.8));
  const lapShape = rectShape(dr.x - dHole, dr.x + dHole, dr.z - dHole, dr.z + dHole);
  lapShape.holes.push(new THREE.Path().absarc(dr.x, dr.z, 0.09, 0, Math.PI * 2, true)); // ends under the ring (r 0.095)
  put('lap', 'floor', 'all', floorShape(lapShape, off * 1.1));

  // --- the walls: the shower area to full height (the niche cut out) plus 1 m, 50 cm round the basin, and the upstand
  const showerWallX = Math.min(W, sh.x1 + wz.showerExtra); // along the back wall
  const showerWallZ = Math.min(D, sh.z1 + wz.showerExtra); // along the left wall
  const b = L.vanity.basin;
  const basinX1 = Math.min(W, b.x + b.diameter / 2 + wz.basinExtra);
  const basinTop = L.vanity.top + b.height + wz.basinExtra;
  const n = sh.niche;
  put('sheet', 'wall_back', 'all', shapeOnFrame(FR.wall_back, rectShape(0, showerWallX, foot, H, [[n.x0, n.x1, n.y0, n.y1]]), off));
  if (basinX1 > showerWallX) put('sheet', 'wall_back', 'all', shapeOnFrame(FR.wall_back, rectShape(showerWallX, basinX1, foot, basinTop), off));
  put('sheet', 'wall_left', 'all', shapeOnFrame(FR.wall_left, rectShape(D - showerWallZ, D, foot, H), off));
  const upstand = (fr, s0, s1, variant = 'all') => { if (s1 > s0 + 1e-6) put('sheet', fr.target, variant, shapeOnFrame(fr, rectShape(s0, s1, foot, upTop), off)); };
  upstand(FR.wall_back, basinX1, W);
  upstand(FR.wall_left, 0, D - showerWallZ);
  // the front wall: on both sides of the door, stopping at the jambs (under the threshold the floor membrane runs on)
  const door = L.door;
  upstand(FR.wall_front, 0, W - door.x1);
  upstand(FR.wall_front, W - door.x0, W);
  // the right wall: with the wall-hung toilet, the upstand turns onto the boxing's sides and face
  upstand(FR.wall_right, 0, T.boxing.z0);
  upstand(FR.wall_right, T.boxing.z1, D);
  upstand(FR.wall_right, T.boxing.z0, T.boxing.z1, 'floor');
  for (const fr of [FR.boxing_front, FR.boxing_back, FR.boxing_door]) {
    const [s0, s1] = fr === FR.boxing_front ? [T.boxing.z0, T.boxing.z1] : [0, bd];
    put('sheet', 'boxing', 'wallHung', footStrip(fr, s0, s1, { below: 0.0005, top: upTop }, off));
  }
  // the niche is inside the wet zone: copies of its faces, nudged out by the same amount
  const nicheMeshes = [];
  if (ctx.shell && ctx.shell.parts.niche) {
    ctx.shell.parts.niche.updateWorldMatrix(true, true);
    ctx.shell.parts.niche.traverse((o) => { if (o.isMesh) nicheMeshes.push(o); });
  }
  for (const o of nicheMeshes) put('sheet', 'niche', 'all', nudgedCopy(o, off));

  // --- the tape (look 2): every floor-wall joint, the shower's inside corner, the niche's corners
  tapeJoint(FR.wall_back, 0, W, 'all');
  tapeJoint(FR.wall_left, 0, D, 'all');
  tapeJoint(FR.wall_front, 0, W - door.x1, 'all');
  tapeJoint(FR.wall_front, W - door.x0, W, 'all');
  tapeJoint(FR.wall_right, 0, T.boxing.z0, 'all');
  tapeJoint(FR.wall_right, T.boxing.z1, D, 'all');
  tapeJoint(FR.wall_right, T.boxing.z0, T.boxing.z1, 'floor');
  tapeJoint(FR.boxing_back, 0, bd, 'wallHung');
  tapeJoint(FR.boxing_front, T.boxing.z0, T.boxing.z1, 'wallHung');
  tapeJoint(FR.boxing_door, 0, bd, 'wallHung');
  const tw = 0.05;
  put('tape', 'wall_back', 'all', shapeOnFrame(FR.wall_back, rectShape(0, tw, foot, H), off * 1.6));
  put('tape', 'wall_left', 'all', shapeOnFrame(FR.wall_left, rectShape(D - tw, D, foot, H), off * 1.6));
  // round the niche's opening on the wall, and its inside (the sides, sill and top are 10 cm deep: two tapes cover them)
  put('tape', 'wall_back', 'all', shapeOnFrame(FR.wall_back, rectShape(n.x0 - tw, n.x1 + tw, n.y0 - tw, n.y1 + tw, [[n.x0, n.x1, n.y0, n.y1]]), off * 1.6));
  const nicheBack = { o: [0, 0, -n.depth], u: [1, 0, 0], n: [0, 0, 1], target: 'niche' };
  put('tape', 'niche', 'all', shapeOnFrame(nicheBack, rectShape(n.x0, n.x1, n.y0, n.y1, [[n.x0 + tw, n.x1 - tw, n.y0 + tw, n.y1 - tw]]), off * 1.6));
  for (const o of nicheMeshes) {
    const nrm = o.geometry.attributes.normal;
    if (Math.abs(nrm.getZ(0)) > 0.5) continue; // the back: only its edges are taped (above)
    put('tape', 'niche', 'all', nudgedCopy(o, off * 1.6));
  }

  // --- collars (look 2) where pipes come through the membrane: the thermostat's two connections on the left wall,
  // the basin's two supplies and its waste on the back wall, the soil stack through the floor (wall-hung toilet: set
  // per toilet in showToilet). The shower's rain head is fed through the exposed riser: no hole for it.
  const X = SHOWER_DIMS.mixer;
  for (const s of [-1, 1]) wallCollar(FR.wall_left, D - (sh.mixer.z + (s * X.legs) / 2), sh.mixer.y, 0.1, 0.012);
  wallCollar(FR.wall_back, b.x - 0.07, 0.56, 0.1, 0.012);
  wallCollar(FR.wall_back, b.x + 0.07, 0.56, 0.1, 0.012);
  wallCollar(FR.wall_back, b.x, 0.44, 0.14, 0.022);

  // ------------------------------------------------------------ materials and meshes
  const bake = ctx.bake || null;
  const mood = ctx.mood || {};
  // plain colours until the view is first shown; then the pictures are painted (once) and put on every sheet
  const common = { metalness: 0, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true };
  const BASE = {
    sheet: new THREE.MeshStandardMaterial({ ...common, color: 0x5c86a0, roughness: 0.82, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    tape: new THREE.MeshStandardMaterial({ ...common, color: 0xb4c3cb, roughness: 0.9, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    collar: new THREE.MeshStandardMaterial({ ...common, color: 0xc8cfd2, roughness: 0.85, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  };
  let painted = false;
  function paint() {
    if (painted) return;
    painted = true;
    const memTex = membraneTexture();
    const tapeTex = tapeTexture();
    const put = (list, tex, tint) => { if (!tex) return; for (const m of list) { m.map = tex; m.color.set(tint); m.needsUpdate = true; } };
    put([...mats.sheet, ...mats.apron, ...mats.lap], memTex, 0xffffff);
    put(mats.tape, tapeTex, 0xd4dde2);
    put(mats.collar, tapeTex, 0xe6e9ea);
  }
  // paint the pictures while the visitor looks around, not on the button press (about 0.1 s on a PC, more on a phone)
  {
    const idle = typeof requestIdleCallback === 'function' ? (fn) => requestIdleCallback(fn, { timeout: 8000 }) : (fn) => setTimeout(fn, 4000);
    const h = idle(() => paint());
    if (h && typeof h.unref === 'function') h.unref(); // (in a test run, never keep the process waiting)
  }
  BASE.apron = BASE.sheet;
  BASE.lap = BASE.sheet;
  const ORDER = { sheet: 3, apron: 3, collar: 4, tape: 4, lap: 5 };
  const mats = { sheet: [], apron: [], lap: [], tape: [], collar: [], clamp: [] };
  const meshes = [];
  const extra = (surface) => ((bake && bake.info && bake.info.extraFaces) || []).filter((f) => f.surface === surface);
  for (const bk of buckets.values()) {
    const g = mergePieces(bk.pieces);
    const pos = g.attributes.position;
    const surface = bk.target === 'niche' ? 'wall_back' : bk.target === 'boxing' ? 'wall_right' : bk.target;
    let uv1;
    if (bk.target === 'niche' || bk.target === 'boxing') {
      // the packed faces are found by the plane a point lies on: look them up from just over the face (the sheets and
      // tapes stand 2.5-4.5 mm off it), the uv itself does not depend on that distance
      const faces = extra(surface);
      const nrm = g.attributes.normal.array;
      const onFace = Float32Array.from(pos.array, (v, i) => v - nrm[i] * 0.0035);
      uv1 = faces.length ? packedUV1(faces, onFace, nrm).uv1 : new Float32Array(pos.count * 2);
    } else {
      uv1 = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        const [u, v] = surfaceUV1(L, surface, pos.getX(i), pos.getY(i), pos.getZ(i));
        uv1[i * 2] = u;
        uv1[i * 2 + 1] = v;
      }
    }
    g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    const m = new THREE.Mesh(g, BASE[bk.kind]);
    m.name = `membrane.${bk.kind}.${bk.target}${bk.variant === 'all' ? '' : `.${bk.variant}`}`;
    m.renderOrder = ORDER[bk.kind];
    m.userData.kind = bk.kind;
    m.userData.surface = surface;
    m.userData.variant = bk.variant;
    if (bake && bake.maps && bake.maps[surface]) bakeShellMesh(m, bake.maps[surface], mood.lightMapIntensity ?? 1); // its own clone
    else m.material = m.material.clone();
    mats[bk.kind].push(m.material);
    meshes.push(m);
    group.add(m);
  }
  // the drain's steel clamp ring with its six screws (look 2), over the collar round the throat
  const clampMat = new THREE.MeshStandardMaterial({ color: 0xc9c9c6, roughness: 0.32, metalness: 1, transparent: true, opacity: 0, depthWrite: false });
  mats.clamp.push(clampMat);
  const ringPieces = [geometryPiece(new THREE.LatheGeometry([v2(0.095, 0), v2(0.095, 0.003), v2(0.065, 0.003), v2(0.0625, 0.0015), v2(0.0625, 0)], 48))];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    ringPieces.push(geometryPiece(new THREE.CylinderGeometry(0.0042, 0.0045, 0.0018, 12).translate(Math.cos(a) * 0.079, 0.0039, Math.sin(a) * 0.079)));
  }
  const clamp = new THREE.Mesh(mergePieces(ringPieces), clampMat); // one draw call, screws included
  clamp.name = 'membrane.clampRing';
  clamp.position.set(dr.x, floorHeight(L, dr.x, dr.z) + off * 1.4, dr.z);
  clamp.renderOrder = 6;
  group.add(clamp);

  // the soil stack's collar on the floor (only the wall-hung toilet's stack comes up through the room's floor): a square
  // round the pipe, trimmed the way a tradesman trims it to lie inside the boxing's footprint (the tape at the boxing's
  // foot runs on the floor outside it)
  const stackCollar = new THREE.Mesh(new THREE.BufferGeometry(), null);
  stackCollar.visible = false;
  let stackPlaced = false;
  function placeStackCollar(t) {
    const join = t && t.anchors && t.anchors.stackJoin;
    stackPlaced = false;
    if (!join || !t.parts.boxing) return;
    const p = join.getWorldPosition(new THREE.Vector3());
    if (p.x > W - 0.06) return;
    const half = 0.12;
    const inset = 0.005; // inside the boxing's faces
    const shape = rectShape(
      Math.max(p.x - half, W - bd + inset), Math.min(p.x + half, W - inset),
      Math.max(p.z - half, T.boxing.z0 + inset), Math.min(p.z + half, T.boxing.z1 - inset),
    );
    shape.holes.push(new THREE.Path().absarc(p.x, p.z, 0.057, 0, Math.PI * 2, true));
    const g = mergePieces([floorShape(shape, off * 1.8)]);
    const uv1 = new Float32Array(g.attributes.position.count * 2);
    for (let i = 0; i < g.attributes.position.count; i++) {
      const [u, v] = surfaceUV1(L, 'floor', g.attributes.position.getX(i), 0, g.attributes.position.getZ(i));
      uv1[i * 2] = u;
      uv1[i * 2 + 1] = v;
    }
    g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    stackCollar.geometry.dispose();
    stackCollar.geometry = g;
    stackPlaced = true;
  }
  {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), BASE.collar);
    if (bake && bake.maps && bake.maps.floor) bakeShellMesh(m, bake.maps.floor, mood.lightMapIntensity ?? 1);
    else m.material = m.material.clone();
    stackCollar.material = m.material;
    stackCollar.name = 'membrane.collar.stack';
    stackCollar.renderOrder = ORDER.collar;
    stackCollar.userData.kind = 'collar';
    stackCollar.userData.surface = 'floor';
    mats.collar.push(stackCollar.material);
    group.add(stackCollar);
  }

  // ------------------------------------------------------------ the looks
  const GOALS = [
    { sheet: 0, apron: 0, lap: 0, tape: 0, collar: 0, clamp: 0 },
    { sheet: 0.62, apron: 0.62, lap: 0, tape: 0, collar: 0, clamp: 0 },
    { sheet: 1, apron: 0, lap: 1, tape: 1, collar: 1, clamp: 1 },
  ];
  const now = { ...GOALS[0] };
  // a kind at zero opacity is not drawn at all (no draw calls for what cannot be seen); a mesh shows when its kind is
  // on and it belongs to the toilet now in the room
  let variantNow = 'wallHung';
  const refresh = () => {
    for (const m of meshes) m.visible = now[m.userData.kind] > 0.001 && (m.userData.variant === 'all' || m.userData.variant === variantNow);
    clamp.visible = now.clamp > 0.001;
    stackCollar.visible = stackPlaced && now.collar > 0.001;
  };
  const setOpacity = (k, v) => { now[k] = v; for (const m of mats[k]) m.opacity = v; };
  let look = 0;
  let veil = null; // the shower pane's veil while the membrane shows
  let glassWas = null; // what the pane wore before (only where no glass switch owns it)
  let toiletNow = ctx.fixtures && ctx.fixtures.toilet;
  // the drain's grate and frame go with the tiles in look 2, so its collar and clamp ring show
  function drainShown(show) {
    const s = ctx.fixtures && ctx.fixtures.shower;
    if (!s) return;
    for (const k of ['drainGratePivot', 'drainFrame']) if (s.parts[k]) s.parts[k].visible = show;
  }
  // Each piece takes the light its surface has NOW: with the floor-standing toilet the shell's floor and right wall use
  // a patched map (no boxing there), and a piece still on the original map would show the boxing's dark footprint.
  function syncLight() {
    const now = (surface) => { const p = ctx.shell && ctx.shell.parts && ctx.shell.parts[surface]; return p && p.material && p.material.lightMap; };
    for (const m of meshes) {
      const map = now(m.userData.surface);
      if (map && m.material.lightMap && m.material.lightMap !== map) m.material.lightMap = map;
    }
    const fm = now('floor');
    if (fm && stackCollar.material && stackCollar.material.lightMap) stackCollar.material.lightMap = fm;
  }
  function apply(target, toiletFixture) {
    const show = target > 0;
    if (show) { paint(); syncLight(); group.visible = true; }
    if (target !== 2) drainShown(true);
    const from = { ...now };
    const goal = GOALS[target];
    tweens.add({
      key: 'membrane', from: 0, to: 1, duration: 650, ease: 'inOutSine',
      onUpdate: (p) => { for (const k of Object.keys(goal)) setOpacity(k, from[k] + (goal[k] - from[k]) * p); refresh(); },
      onDone: () => {
        if (!show) group.visible = false;
        if (target === 2) drainShown(false);
      },
    });
    showToilet(toiletFixture || toiletNow, show);
    // the clear shower glass is drawn from a picture of the solid room only, which has no membrane in it: while the
    // membrane shows, the pane wears a veil, plain see-through glass that writes no depth (the sheets behind it are
    // drawn). Where the eye's glass switch owns the pane (scene/roomEnvironment.js createGlassSwitch) the veil goes on
    // and off through it, and the switch puts back the glass for where the eye is then; only the veil is freed here
    // (review 2026-10-20, round 3, finding 1: writing the pane past the switch lost the veil and freed glass in use).
    const pane = ctx.fixtures && ctx.fixtures.shower && ctx.fixtures.shower.parts.glass;
    if (pane) {
      const sw = ctx.glassSwitch && ctx.glassSwitch.has(pane) ? ctx.glassSwitch : null;
      if (show && !veil) {
        veil = new THREE.MeshStandardMaterial({ name: 'glassVeil', color: 0xe6eeee, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false });
        if (sw) sw.override(veil);
        else { glassWas = pane.material; pane.material = veil; }
      }
      if (!show && veil) {
        if (sw) sw.release();
        else if (pane.material === veil) pane.material = glassWas;
        glassWas = null;
        veil.dispose();
        veil = null;
      }
    }
    if (loop) loop.wake(800);
  }
  // A see-through copy of a mesh's own material that keeps its baked-light shading (Material.clone copies neither
  // onBeforeCompile nor customProgramCacheKey: without them the baked boxing would be lit a second time).
  function seeThrough(m) {
    const c = m.material.clone();
    c.onBeforeCompile = m.material.onBeforeCompile;
    c.customProgramCacheKey = m.material.customProgramCacheKey;
    return c;
  }
  function showToilet(t, on) {
    if (!t) return;
    toiletNow = t;
    if (t.setHiddenVisible) t.setHiddenVisible(on);
    // the membrane follows this toilet: onto the boxing (wall-hung) or along the wall (floor-standing)
    variantNow = t.parts.boxing ? 'wallHung' : 'floor';
    placeStackCollar(t);
    syncLight(); // the shell's light maps change with the toilet (main.js setToiletLight)
    refresh();
    // the boxing turns to frosted glass, the ceramic to a milky shell, so the water's way through shows; turning the
    // view off gives every part its own material back
    for (const [k, o] of [['boxing', 0.22], ['boxingTop', 0.22], ['bowl', 0.45], ['tank', 0.45], ['tankBase', 0.45]]) {
      const m = t.parts[k];
      if (!m) continue;
      if (on) {
        if (!m.userData.solidMaterial) {
          m.userData.solidMaterial = m.material;
          m.material = seeThrough(m);
        }
        m.material.transparent = true;
        m.material.opacity = o;
        m.material.depthWrite = false;
        m.material.needsUpdate = true;
      } else if (m.userData.solidMaterial) {
        const solid = m.userData.solidMaterial;
        if (solid.lightMap) solid.lightMapIntensity = m.material.lightMapIntensity; // the light switch may have dimmed it
        m.material.dispose();
        m.material = solid;
        delete m.userData.solidMaterial;
      }
    }
  }
  // water running through the hidden pipes: each turns water-blue for a moment, in the order the water reaches it
  function flushPulse(t, amount = 1) {
    const path = ['cistern', 'flushPipe', 'bowlTrap', 'outletPipe', 'stack'].map((k) => t.parts[k]).filter(Boolean);
    path.forEach((m, i) => {
      if (!m.material || !m.material.color) return;
      if (!m.userData.dryColor) { m.material = m.material.clone(); m.userData.dryColor = m.material.color.clone(); }
      const dry = m.userData.dryColor;
      const wet = new THREE.Color(0x4f86b8);
      tweens.add({
        key: `pulse${m.uuid}`, from: 0, to: 1, duration: 900 * amount + 500, delay: i * 320, ease: 'linear',
        onUpdate: (v) => { m.material.color.copy(dry).lerp(wet, Math.sin(v * Math.PI)); },
      });
    });
    if (loop) loop.wake(3500);
  }
  if (toiletNow) {
    variantNow = toiletNow.parts.boxing ? 'wallHung' : 'floor';
    placeStackCollar(toiletNow);
  }
  refresh();
  return {
    group,
    meshes,
    clamp,
    stackCollar,
    get look() { return look; },
    cycle(toiletFixture) { look = (look + 1) % 3; apply(look, toiletFixture); return look; },
    set(l, toiletFixture) { look = l; apply(l, toiletFixture); },
    showToilet,
    flushPulse,
    quality,
  };
}

// A copy of a mesh's faces in room coordinates, nudged `d` along their normals, with uv in metres on the face's plane.
function nudgedCopy(o, d) {
  const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
  g.applyMatrix4(o.matrixWorld);
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const out = [];
  const uv = [];
  for (let i = 0; i < pos.count; i++) {
    const [nx, ny, nz] = [nrm.getX(i), nrm.getY(i), nrm.getZ(i)];
    const p = [pos.getX(i) + nx * d, pos.getY(i) + ny * d, pos.getZ(i) + nz * d];
    out.push(...p);
    if (Math.abs(nz) > 0.5) uv.push(p[0], p[1]);
    else if (Math.abs(nx) > 0.5) uv.push(p[2], p[1]);
    else uv.push(p[0], p[2]);
  }
  const idx = [];
  for (let i = 0; i < pos.count; i++) idx.push(i);
  g.dispose();
  return { pos: out, uv, idx };
}

// A three.js geometry as a piece ({ pos, uv, idx }); the geometry is disposed.
function geometryPiece(g) {
  const p = g.attributes.position;
  const t = g.attributes.uv;
  const pos = Array.from(p.array);
  const uv = t ? Array.from(t.array) : new Array(p.count * 2).fill(0);
  const idx = g.index ? Array.from(g.index.array) : [...Array(p.count).keys()];
  g.dispose();
  return { pos, uv, idx };
}

// Joins pieces ({ pos, uv, idx }) into one indexed geometry with normals.
function mergePieces(pieces) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (const p of pieces) {
    const base = pos.length / 3;
    pos.push(...p.pos);
    uv.push(...p.uv);
    for (const i of p.idx) idx.push(base + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
