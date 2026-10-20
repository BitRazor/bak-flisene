// Towels: a bath towel and a hand towel hung over rungs of the electric towel rail, and rolled towels for a basket
// (the owner, 2026-10-19: "How about more interaction, also some refinments like towels, plants?").
// Real terry cloth, not paper: each towel on the rail is folded lengthwise (two layers: a closed, thick slab with a
// rounded fold on one long side and the two selvages on the other, the inner one a step short), laid over a rung so
// both halves hang down (the back half a little to one side: its edge shows), the fold a thick round roll over the rung
// with each half tucked in under it, soft folds that drift and deepen toward the hem, edges that are never quite
// straight, rounded top corners, a flat-woven band near each end (thinner, a darker stripe) and a folded hem
// (tmp/wave3/look.md M1, look2.md 2: it had read as a flat board). Held, it hangs from the fingers in a second shape
// the wiring blends to. One shared material (fixtures/terry.js: cloth sheen, the loop pile, the pile's tone) and vertex
// colours (each towel's colour, the shade between its halves, in its folds' hollows and under the roll), so every towel
// is one draw call.
//
// Sizes: a bath towel 70 x 140 cm and a hand towel 50 x 90 cm (common sizes); LAYOUT.towels says which rung each
// hangs on. The rail's rungs: fixtures/towelRail.js (railRungs() repeats its formula; tests/towels.test.js checks it
// against the rail's own mesh). Local frame = the rail's wall frame (util.js): +z out of the wall, +y up, +x along it.
//
// createTowels(ctx, opts) -> { group, parts, anchors, towels }
//   parts: bath, hand (the meshes), bathPivot, handPivot (Groups at the top of each fold, where fingers pinch it: the
//          wiring moves these), bathLabelPivot, handLabelPivot (hinges at the hem, folded in at rest), bathLabel,
//          handLabel (the care label, hidden until it is read; one shared material for the wiring to print on)
//   anchors: bathHold, handHold (the pinch points), lowest (the lowest point of any towel: the floor below is free)
//   towels: { bath, hand } the numbers the wiring needs: size, hanging length (held), the rest pose, the shape per
//          vertex, both shapes (railPositions/heldPositions, their normals, heldBox) and the label's mount in each
// createRolledTowel(ctx, opts) -> { group, parts: { rolls }, anchors, rolls } (all rolls in one mesh)
import * as THREE from 'three';
import { mesh, anchor, placeOnWall } from './util.js';
import { RAIL_DIMS } from './towelRail.js';
import { createRng, smoothstep } from '../fx/rng.js';
import { TOWEL_DIMS, towelThickness, flatWoven, inBand, layoutV, PILE_MEAN, towelMaterial } from './terry.js';

// the cloth and its material (fixtures/terry.js), as importers of this module know them
export {
  TOWEL_DIMS, towelThickness, layoutV, layoutRoughness, tileMetres, PILE_MEAN, terryMaps, pileTone, PILE_TONE,
  TERRY_GLSL, TERRY_HOOKS, towelMaterial,
} from './terry.js';

// Calm Scandinavian colours that sit with the light stone tiles and oak (nothing loud): the bath towel a soft sage,
// deeper than the tiles so it stands off the wall (tmp/wave3/look2.md 2: in stone it melted into the tiles), the hand
// towel off-white beside it; the rolls in the basket in the same family.
export const TOWEL_COLOURS = { sage: '#9aa595', stone: '#c6bfb4', offWhite: '#ebe7df', oat: '#dad3c7' };

// Per kind: the folded thickness (two layers of a heavy terry), the fold's centre-line radius over the rung (a thick
// towel makes a round roll there), how far each half tucks back in under that roll, how deep its folds get at the hem,
// how much shorter the back half hangs and how far it lies to one side (its edge shows beside the front half), how much
// narrower the inner layer is folded (both selvages show), its colour, its seed (folds are repeatable), the faces'
// segments across, the rings' spacing down the halves; held from the fingers (HELD below): where the fingers pinch it
// (a share of its half-width off the middle), how much cloth each side they gather (metres), how steeply the top edge
// falls from them to the corners (radians below level), how much of its width the hem opens to, how deep the folds
// that fan out from the fingers.
export const TOWEL_KINDS = {
  bath: { thickness: 0.012, wrapR: 0.025, tuck: 0.007, folds: 0.022, backShorter: 0.04, backShift: 0.026, inStep: 0.005, colour: 'sage', seed: 11, faces: 11, bodyStep: 0.075, pinch: 0.12, gather: 0.08, fall: 1.25, open: 0.8, fan: 0.034 },
  hand: { thickness: 0.008, wrapR: 0.02, tuck: 0.004, folds: 0.015, backShorter: 0.03, backShift: 0.016, inStep: 0.004, colour: 'offWhite', seed: 23, faces: 7, bodyStep: 0.075, pinch: -0.14, gather: 0.058, fall: 1.2, open: 0.82, fan: 0.024 },
};

// A hand towel 50 x 90 folded in three lengthwise and rolled from one end: 16.7 cm tall, about 12 cm across.
export const ROLL_DIMS = { length: 0.167, pitch: 0.0095, core: 0.011, strip: 0.9 };
// The rolls' spiral is sampled about this often along the strip (metres): on the outer turn (5.8 cm) a chord stands
// at most 0.7 mm off the circle (1.6 mm on weak phones), so the ends read round (tests/towels.test.js)
export const ROLL_STEP = { high: 0.014, low: 0.021 };
// Phone budget for all towels together (the brief): the rail's two and three rolls.
export const TOWEL_BUDGET = { triangles: 6000, drawCalls: 3 };

// The look on the rail (tmp/wave3/look2.md 2: under the room's soft light the folds hardly showed): how much darker
// the deepest hollow of a fold at the hem is than the cloth around it (the light reaches into it less), how much
// darker the cloth tucked in just under the roll is, how far the long edges sway (metres), and the radius the top
// corners round off to, seen from the front.
export const TOWEL_LOOK = { hollow: 0.5, underRoll: 0.2, sway: 0.006, corner: 0.016 };

// ---------------------------------------------------------------------------------------------------------------
// The rail's rungs in its own frame (fixtures/towelRail.js builds them the same way).
export function railRungs(L, n = 12) {
  const T = L.towelRail;
  const height = T.y1 - T.y0;
  const width = T.z1 - T.z0;
  const step = (height - 0.12) / (n - 1);
  const sideX = width / 2 - RAIL_DIMS.sideR;
  return {
    ys: Array.from({ length: n }, (_, i) => 0.06 + i * step),
    z: RAIL_DIMS.out,
    r: RAIL_DIMS.rungR,
    sideX,
    sideR: RAIL_DIMS.sideR,
    inner: sideX - RAIL_DIMS.sideR, // half the clear width between the side tubes
  };
}

// The centre line of a towel laid over a rung, in the rail's frame (y up, z out of the wall): from the hem of the back
// half (s = 0) up behind the rung, over it in a half circle whose inside rests rungGap over the rung's top, and down
// the front to the front half's hem (s = length). A thick towel's roll is rounder than the rung: under it each half
// tucks back in by `tuck` (over a few centimetres, leaving the roll with a level tangent), so the roll overhangs the
// cloth below it. at(s) -> { y, z, ty, tz (the way s grows), ny, nz (the outer face's normal: the wall side on the back
// half, up on the fold, the room side on the front half), part (-1 back, 0 over the rung, 1 front), down (metres below
// the fold) }.
const TUCK_RUN = 0.012; // the tuck is half done 2 cm under the roll, all but done 6 cm under it
export function drapePath({ rungY, rungZ, rungR, thickness, length, backShorter = 0.04, wrapR = TOWEL_DIMS.wrapR, lean = TOWEL_DIMS.lean, tuck = 0 }) {
  const yc = rungY + rungR + TOWEL_DIMS.rungGap + thickness / 2 - wrapR;
  const zc = rungZ;
  const arc = Math.PI * wrapR;
  const back = (length - arc - backShorter) / 2;
  const front = length - arc - back;
  const u0 = 0.12;
  const tk = (u) => tuck * (1 - (1 + u / TUCK_RUN) * Math.exp(-u / TUCK_RUN));
  const tkd = (u) => (tuck * u * Math.exp(-u / TUCK_RUN)) / (TUCK_RUN * TUCK_RUN); // (its slope)
  function at(s) {
    if (s <= back) {
      const u = back - s;
      const d = tkd(u);
      const k = 1 / Math.hypot(1, d);
      return { y: yc - u, z: zc - wrapR + tk(u), ty: k, tz: -d * k, ny: -d * k, nz: -k, part: -1, down: u };
    }
    if (s <= back + arc) {
      const th = Math.PI - (s - back) / wrapR;
      return { y: yc + wrapR * Math.sin(th), z: zc + wrapR * Math.cos(th), ty: -Math.cos(th), tz: Math.sin(th), ny: Math.sin(th), nz: Math.cos(th), part: 0, down: 0 };
    }
    const u = s - back - arc;
    const e = Math.exp(-u / u0);
    const slope = lean * (1 - e) - tkd(u);
    const k = 1 / Math.hypot(1, slope);
    return { y: yc - u, z: zc + wrapR + lean * (u - u0 * (1 - e)) - tk(u), ty: -k, tz: slope * k, ny: slope * k, nz: k, part: 1, down: u };
  }
  return { at, length, back, arc, front, yc, zc, top: { y: yc + wrapR, z: zc } };
}

// ---------------------------------------------------------------------------------------------------------------
// The cross-section of a towel folded lengthwise, as a closed ring: a = across the towel (metres), b = through it
// (in half-thicknesses, so the band and the hem can be thinner). Points: { a0, ak, bk, side } with a = a0 + ak * ht
// and b = bk * ht; side 1 = the outer face, -1 the inner face, 0 the edges. It starts and ends (a seam) in the middle
// of the rounded fold (a = -w/2) and runs up, along the outer face to the open edge (the two selvages with a groove
// between them), back along the inner face.
// The inner layer is folded a little short of the outer one (inStep, metres), so the open edge shows both selvages as
// a step, as a towel folded by hand does. edge: 'fold' (the rounded fold) or 'open' (the selvages).
function ringProfile(w, nFace, inStep = 0) {
  const hw = w / 2;
  const s2 = Math.SQRT1_2;
  const wi = w - inStep;
  const pts = [{ a0: -hw, ak: 0, bk: 0, side: 0, edge: 'fold' }, { a0: -hw, ak: 1 - s2, bk: s2, side: 0, edge: 'fold' }];
  for (let i = 0; i <= nFace; i++) pts.push({ a0: -hw + (i / nFace) * w, ak: 1 - 1.3 * (i / nFace), bk: 1, side: 1 });
  pts.push({ a0: hw, ak: 0, bk: 0.45, side: 0, edge: 'open' }, { a0: hw - inStep, ak: -0.35, bk: 0, side: 0, edge: 'open' }, { a0: hw - inStep, ak: 0, bk: -0.45, side: 0, edge: 'open' });
  for (let i = nFace; i >= 0; i--) pts.push({ a0: -hw + (i / nFace) * wi, ak: 1 - 1.3 * (i / nFace), bk: -1, side: -1 });
  pts.push({ a0: -hw, ak: 1 - s2, bk: -s2, side: 0, edge: 'fold' }, { a0: -hw, ak: 0, bk: 0, side: 0, edge: 'fold' });
  return pts;
}

// Soft vertical folds across the towel: a few waves of different lengths that drift a little down its length, so no
// fold runs dead straight; a value in about -1..1 (crests +, hollows -), repeatable from a seed.
function foldField(rng) {
  const waves = [[0.21, 0.62], [0.12, 0.3], [0.07, 0.12]].map(([l, k]) => ({
    f: ((2 * Math.PI) / l) * (0.88 + 0.24 * rng.next()), k, p: 2 * Math.PI * rng.next(),
    m: 0.014 * rng.signed(), q: (2 * Math.PI) / (0.45 + 0.5 * rng.next()), r: 2 * Math.PI * rng.next(),
  }));
  return (a, s = 0) => {
    let v = 0;
    for (const w of waves) v += w.k * Math.sin(w.f * (a + w.m * Math.sin(w.q * s + w.r)) + w.p);
    return v;
  };
}
// A hanging fold's profile: broad round crests, narrower hollows between them (as cloth falls), from the field's -1..1.
const foldProfile = (f) => { const c = Math.max(-1, Math.min(1, f)); return c + 0.3 * (1 - c * c); };

// Smooth value noise in two dimensions (cells of `cell` metres), about -1..1, repeatable from a seed: crumpled cloth.
function noise2(rng, cell) {
  const n = 16;
  const v = Float32Array.from({ length: n * n }, () => rng.signed());
  const at = (i, j) => v[(((j % n) + n) % n) * n + (((i % n) + n) % n)];
  return (x, y) => {
    const gx = x / cell + 5.37; const gy = y / cell + 2.71;
    const x0 = Math.floor(gx); const y0 = Math.floor(gy);
    const fx = smoothstep(0, 1, gx - x0); const fy = smoothstep(0, 1, gy - y0);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
    return a + (b - a) * fy;
  };
}

// The s of every ring along a towel: dense on the hem's and the band's edges at both ends, close under the roll (the
// tuck's curve), every few cm on the halves, every 30 degrees over the rung.
const UNDER_ROLL = [0.012, 0.03, 0.055];
function towelStations(path, bodyStep) {
  const L = path.length;
  const d = TOWEL_DIMS.edgeStep / 2;
  const list = [];
  for (const e of [0, TOWEL_DIMS.hem - d, TOWEL_DIMS.hem + d, TOWEL_DIMS.band[0] - d, TOWEL_DIMS.band[0] + d, TOWEL_DIMS.band[1] - d, TOWEL_DIMS.band[1] + d, TOWEL_DIMS.endZone]) {
    list.push(e, L - e);
  }
  const fill = (from, to) => {
    const n = Math.max(1, Math.round((to - from) / bodyStep));
    for (let i = 0; i <= n; i++) list.push(from + ((to - from) * i) / n);
  };
  const last = UNDER_ROLL[UNDER_ROLL.length - 1];
  fill(TOWEL_DIMS.endZone, path.back - last);
  for (const u of UNDER_ROLL) list.push(path.back - u, path.back + path.arc + u);
  for (let i = 0; i <= 6; i++) list.push(path.back + (path.arc * i) / 6);
  fill(path.back + path.arc + last, L - TOWEL_DIMS.endZone);
  list.sort((a, b) => a - b);
  return list.filter((s, i) => i === 0 || s - list[i - 1] > 1e-6);
}

// Held from the fingers (the wiring blends to this shape as a towel is taken; tmp/wave3/look2.md 5: not a smooth
// symmetric arch). The fold closes to a tight round under the pinch; the fingers hold it a little off its middle and
// the cloth there crumples into them (kG: what is gathered keeps this share of its width; crumple: how far down the
// crumpling reaches); from the gather the top edge falls steeply to the corners; below it every column of cloth hangs
// straight down from the top edge, the sides opening evenly toward the hem (straight, not bulging); the spare width
// lies in folds that fan out from the fingers (fanWave: across, metres along the cloth; x 1.4 on weak phones); the hem
// uneven.
const HELD = { wrapR: 0.008, kG: 0.28, crumple: 0.1, fanWave: 0.1, bunch: 0.009, knee: 0.015, sag: 0.01 };
// v, but never below floor: a soft stop (2 mm wide), as cloth meets a rung
const softFloor = (v, floor) => floor + 0.002 * Math.log1p(Math.exp((v - floor) / 0.002));

// One towel over one rung: the geometry (relative to its pinch point) in the two shapes the wiring blends (hung over
// the rung; held from the fingers), and per vertex what the wiring needs to bend it.
function buildTowel(ctx, { width, length, kind, rung, R, x }) {
  const K = TOWEL_KINDS[kind];
  const Look = TOWEL_LOOK;
  const low = ctx.quality === 'low';
  const t = K.thickness;
  const path = drapePath({ rungY: R.ys[rung], rungZ: R.z, rungR: R.r, thickness: t, length, backShorter: K.backShorter, wrapR: K.wrapR, tuck: K.tuck });
  const held = drapePath({ rungY: 0, rungZ: 0, rungR: 0, thickness: t, length, backShorter: K.backShorter, wrapR: HELD.wrapR, lean: 0 });
  // a point along the towel hung (s) is this far along it held: the hems stay the hems, the fold the fold
  const toHeld = (s) => (s <= path.back ? (s * held.back) / path.back : s <= path.back + path.arc
    ? held.back + ((s - path.back) / path.arc) * held.arc : held.back + held.arc + ((s - path.back - path.arc) * held.front) / path.front);
  const stations = towelStations(path, low ? K.bodyStep * 1.5 : K.bodyStep);
  const ring = ringProfile(width, low ? Math.max(5, Math.round(K.faces * 0.66)) : K.faces, K.inStep);
  const M = ring.length;
  // the ring's own length (uv u, metres) at the pile's thickness
  const uRing = new Float32Array(M);
  for (let j = 1; j < M; j++) {
    const p = ring[j - 1]; const q = ring[j];
    uRing[j] = uRing[j - 1] + Math.hypot((q.a0 + q.ak * t / 2) - (p.a0 + p.ak * t / 2), (q.bk - p.bk) * t / 2);
  }
  const perim = uRing[M - 1];
  const rng = createRng(K.seed);
  const foldFront = foldField(rng);
  const foldBack = foldField(rng);
  const hemWave = foldField(rng);
  const mottle = foldField(rng);
  const sway = [foldField(rng), foldField(rng)]; // the two long edges are never quite straight
  const fanPhase = 2 * Math.PI * rng.next(); // where the folds that fan out from the fingers fall across
  const crumple = [noise2(rng, 0.034), noise2(rng, 0.034), noise2(rng, 0.034)];
  const hemNoise = noise2(rng, 0.07);
  // rings: a cap that closes the hem at s = 0, the stations, a cap at s = length
  const hemHt = (t * TOWEL_DIMS.hemThick) / 2;
  const rings = [{ s: 0, cap: -1 }, ...stations.map((s) => ({ s, cap: 0 })), { s: length, cap: 1 }];
  const nV = rings.length * M;
  const pos = new Float32Array(nV * 3);
  const posH = new Float32Array(nV * 3);
  const uv = new Float32Array(nV * 2);
  const uv1 = new Float32Array(nV * 2);
  const col = new Float32Array(nV * 3);
  const colH = new Float32Array(nV * 3);
  const shade = new Float32Array(nV);
  const shadeH = new Float32Array(nV);
  const shape = {
    side: new Int8Array(nV), part: new Int8Array(nV), a: new Float32Array(nV), e: new Float32Array(nV),
    sTop: new Float32Array(nV), nrm: new Float32Array(nV * 3),
  };
  const base = new THREE.Color(TOWEL_COLOURS[K.colour]);
  const sTop = path.back + path.arc / 2;
  const hold = { x, y: path.top.y, z: path.top.z };
  const hw = width / 2;
  const rungFront = R.z + R.r + 0.0012; // the plane of the rungs' fronts and backs, a hair clear
  const rungBack = R.z - R.r - 0.0012;

  // ---- held from the fingers (HELD): the column of cloth at a (across), depth metres below the fold
  const pa = K.pinch * hw; // the fingers hold it this far off its middle
  const G = K.gather;
  const cosF = Math.cos(K.fall); const sinF = Math.sin(K.fall);
  // where the column's top lies on the top edge (x from the fingers, y below them): the gathered cloth bunches up
  // round over the fingers; past it the edge falls to the corner (a loose edge between the fingers and the corner's
  // weight, so it sags a little), turning down softly where it leaves the gather
  const topEdge = (ra) => {
    const r = Math.abs(ra); const sg = ra < 0 ? -1 : 1;
    const L = ra < 0 ? hw + pa : hw - pa; // from the fingers to this side's corner
    const out = r > G ? r - G - HELD.knee * (1 - Math.exp(-(r - G) / HELD.knee)) : 0; // (level where it leaves the gather)
    const sag = HELD.sag * Math.sin(Math.PI * Math.min(1, Math.max(0, (r - G) / Math.max(1e-6, L - G))));
    return [sg * (Math.min(r, G) * HELD.kG + out * cosF), -out * sinF + HELD.bunch * (1 - smoothstep(0, G, r)) - sag];
  };
  const lenH = held.front; // the longer half's length below the fingers
  const columnX = (ra, depth) => { const [xT] = topEdge(ra); return xT + (ra * K.open - xT) * Math.min(1, depth / lenH); };
  const spread = (depth) => (columnX(hw - pa, depth) - columnX(-hw - pa, depth)) / (2 * hw); // its width in view / its own
  const fanWave = low ? HELD.fanWave * 1.4 : HELD.fanWave;
  function heldAt(a, depth) { // -> [x, y (from the top edge, crumples, the hem), z (fans, crumples), its shade]
    const ra = a - pa;
    const [, yT] = topEdge(ra);
    let hx = columnX(ra, depth);
    let hy = yT;
    // the folds that fan out from the fingers: the spare width (what is not seen across) in soft waves, deepest by
    // the fingers; one fan for both halves (they fold together by their place, so neither shows through the other)
    const fv = Math.sin((2 * Math.PI * ra) / fanWave + fanPhase);
    const fan = ((1 - spread(depth)) / (1 - HELD.kG)) * smoothstep(0, 0.04, depth); // 0..1: how deep the fan is here
    let hz = K.fan * fan * Math.sign(fv) * Math.abs(fv) ** 0.7;
    // crumpled into the fingers: uneven, never a smooth peak
    const c = (1 - Math.min(1, depth / HELD.crumple)) ** 2 * (1 - smoothstep(G, G + 0.05, Math.abs(ra)));
    hx += 0.005 * c * crumple[0](ra, depth);
    hy += 0.004 * c * crumple[1](ra, depth);
    hz += 0.013 * c * crumple[2](ra, depth);
    // the hem: uneven, a little higher on one side
    const h = smoothstep(lenH - 0.14, lenH, depth);
    hy += h * (0.014 * hemNoise(ra, 0) + 0.01 * (ra / hw));
    // its shade held (the room side to the eye): the fan's hollows darker, its crests a touch lighter, the cloth
    // bunched in the fingers in its own shade
    const shadeH = (1 - Look.hollow * 0.9 * fan * smoothstep(0.35, -0.9, fv) + 0.05 * fan * smoothstep(0.3, 1, fv)) * (1 - 0.22 * c);
    return [hx, hy, hz, shadeH];
  }

  // where a point of the cloth goes: across a, along s, b0 out of the path's face (its place in the thickness), d its
  // fold on the rail, along it (the hem's line); returns [rail x, y, z, held x, y, z, held shade] relative to the pinch
  // (the towel's x on the rail cancels against the hold's). Held, the two halves hang close: they fold together (one
  // fold and one fan by where they are across and how far below the fingers), so neither ever shows through the other.
  function place(a, s, b0, d, along) {
    const p = path.at(s);
    const q = held.at(toHeld(s));
    const side = Math.max(-1, Math.min(1, a / hw));
    const swayK = p.part === 0 ? 0 : Look.sway * (0.4 + 0.6 * smoothstep(0, 0.6, p.down)); // edges sway, more down low
    const shift = K.backShift * (p.part === -1 ? 1 : p.part === 0 ? 1 - smoothstep(path.back, path.back + path.arc, s) : 0);
    const x = a + Math.sign(a) * side ** 4 * swayK * sway[a < 0 ? 0 : 1](s * 0.6) + shift;
    // the top corners round off (seen from the front): the cloth sags a little at its two ends, never where it rests on
    // the rung (over the rung's top it stays, the drop grows round the roll's sides and fades down the halves)
    const cr = Look.corner;
    const c = Math.min(1, Math.max(0, Math.abs(a) - (hw - cr)) / cr);
    const drop = cr * (1 - Math.sqrt(1 - c * c)) * (p.part === 0 ? (1 - Math.max(0, p.ny)) ** 2 : 1 - smoothstep(0, 2.5 * cr, p.down));
    // held: the halves hang straight under each other (the rail's shift and sway are gone), from the fingers
    const yh = q.y + b0 * q.ny + along * q.ty - held.top.y;
    const depth = Math.max(0, -yh);
    const [hx, hy, hz, shadeH] = heldAt(a, depth);
    const fold = 0.6 * K.folds * (0.3 + 0.7 * smoothstep(0, 0.8 * held.front, depth)) * (0.25 + foldProfile(foldFront(a, depth)));
    return [
      x, p.y + (b0 + d) * p.ny + along * p.ty - hold.y - drop, p.z + (b0 + d) * p.nz + along * p.tz - hold.z,
      hx, yh + hy, q.z + b0 * q.nz + along * q.tz - held.top.z + fold + hz, shadeH,
    ];
  }
  // a soft bump that peaks 1.8 cm under the roll: the cloth tucked in there lies in the roll's shade
  const underRoll = (down) => (down / 0.018) * Math.exp(1 - down / 0.018);
  for (let k = 0; k < rings.length; k++) {
    const { s, cap } = rings[k];
    const p = path.at(s);
    const e = Math.min(s, length - s);
    const ht = towelThickness(t, e) / 2;
    const bScale = cap ? 0 : 1;
    // the folds grow down each half from just under the fold (the back half, pressed to the rungs, less); over the
    // rung the cloth only bunches outward (its inside rests on the rung)
    const grow = 0.3 + 0.7 * smoothstep(0, 0.8 * (p.part === -1 ? path.back : path.front), p.down);
    const A = p.part === 1 ? K.folds * grow : p.part === -1 ? 0.45 * K.folds * grow : 0.3 * K.folds;
    // the hem's line is never quite straight; the caps reach out round the hem's edge
    const endW = smoothstep(TOWEL_DIMS.endZone, 0, e);
    const outward = s < length / 2 ? -1 : 1;
    const capReach = cap ? 0.6 * hemHt : 0;
    for (let j = 0; j < M; j++) {
      const r = ring[j];
      const a = r.a0 + r.ak * ht;
      const f = p.part === -1 ? foldBack(a, s) : foldFront(a, s);
      const g = foldProfile(f);
      // (a hollow never reaches through the rungs: each half's inner face stays on its own side of them, softly)
      const d = p.part === 0 ? A * Math.max(0, f) : softFloor(A * (0.25 + g), (p.part === 1 ? rungFront - p.z : p.z - rungBack) + ht);
      // over the rung the fold's outer face rounds off toward the two edges (soft corners, not a cut card)
      const corner = p.part === 0 && r.bk > 0 ? 1 - 0.5 * smoothstep(0.82, 1, Math.abs(a) / hw) * Math.max(0, p.ny) : 1;
      const xyz = place(a, s, r.bk * ht * bScale * corner, d * corner, outward * (0.008 * hemWave(a) * endW + capReach));
      const i = k * M + j;
      pos.set(xyz.slice(0, 3), i * 3);
      posH.set(xyz.slice(3, 6), i * 3);
      const flat = flatWoven(e);
      uv[i * 2] = uRing[j] * (flat ? TOWEL_DIMS.bandU : 1);
      uv[i * 2 + 1] = s;
      uv1[i * 2] = uRing[j] / perim;
      uv1[i * 2 + 1] = layoutV(s, length);
      // the shade (as the room's soft light leaves it). In both shapes: the halves face each other inside the fold, the
      // back half faces away, the groove between the selvages, the cloth turning into its long edges, the woven band and
      // the step of the pile at its edges, a faint mottle. On the rail: a fold's hollow darker the deeper it lies (the
      // light reaches into it less), its crest a touch lighter, the cloth tucked in under the roll in its shade, the
      // roll's top catching the light. Held: the fan's hollows and the bunch in the fingers (heldAt).
      let ao = 1;
      if (r.side === -1) ao = p.part === 0 ? 0.55 : 0.58 + 0.25 * smoothstep(0, 0.5, p.down);
      else if (r.side === 0) ao = r.edge === 'open' ? (r.bk === 0 ? 0.5 : 0.8) : 0.9;
      else if (p.part === -1) ao = 0.8;
      let onRail = 1;
      if (p.part !== 0 && r.side !== -1) {
        const deep = A / K.folds; // 0.3 just under the fold to 1 at the hem (the back half less)
        onRail *= 1 - Look.hollow * deep * smoothstep(0.35, -0.95, f) + 0.05 * deep * smoothstep(0.3, 1, f);
        onRail *= 1 - Look.underRoll * (p.part === 1 ? 1 : 0.6) * underRoll(p.down);
        ao *= 1 - 0.14 * smoothstep(0.82, 1, Math.abs(a) / hw);
      }
      if (p.part === 0 && r.side === 1) onRail *= 1 + 0.1 * Math.max(0, p.ny);
      ao *= 1 + 0.05 * mottle(a * 0.5, s * 0.6);
      if (cap) ao *= 0.88;
      const step = !flatWoven(e) && Math.min(Math.abs(e - TOWEL_DIMS.band[0]), Math.abs(e - TOWEL_DIMS.band[1])) < 0.002;
      ao *= inBand(e) ? 0.9 : step ? 0.84 : e < TOWEL_DIMS.hem ? 0.94 : 1;
      shade[i] = ao * onRail;
      shadeH[i] = ao * (r.side === -1 ? 1 : xyz[6]);
      shape.side[i] = cap ? 0 : r.side;
      shape.part[i] = p.part;
      shape.a[i] = a;
      shape.e[i] = cap ? 0 : e;
      shape.sTop[i] = s - sTop;
      shape.nrm[i * 3] = 0;
      shape.nrm[i * 3 + 1] = p.ny;
      shape.nrm[i * 3 + 2] = p.nz;
    }
  }
  // in each shape the front's shades average to 1 (the towel shows its named colour), and the pile's own mean is
  // divided out
  for (const [sh, out] of [[shade, col], [shadeH, colH]]) {
    let sum = 0; let n = 0;
    for (let i = 0; i < nV; i++) if (shape.side[i] === 1 && shape.part[i] === 1 && shape.e[i] > 0.15) { sum += sh[i]; n++; }
    const norm = n ? n / sum / PILE_MEAN : 1 / PILE_MEAN;
    for (let i = 0; i < nV; i++) {
      out[i * 3] = Math.min(1, base.r * sh[i] * norm);
      out[i * 3 + 1] = Math.min(1, base.g * sh[i] * norm);
      out[i * 3 + 2] = Math.min(1, base.b * sh[i] * norm);
    }
  }
  const idx = [];
  for (let k = 0; k < rings.length - 1; k++) {
    for (let j = 0; j < M - 1; j++) {
      const a = k * M + j; const b = (k + 1) * M + j; const c = a + 1; const d = b + 1;
      idx.push(a, b, c, c, b, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(posH, 3)); // the held shape's normals first ...
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col.slice(), 3)); // (it starts on the rail)
  g.setIndex(idx);
  g.computeVertexNormals();
  joinSeam(g, M);
  const heldNormals = g.attributes.normal.array.slice();
  const heldBox = new THREE.Box3().setFromBufferAttribute(g.attributes.position);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); // ... then the shape on the rail, as it starts
  g.computeVertexNormals();
  joinSeam(g, M);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  let hang = 0;
  for (let i = 1; i < pos.length; i += 3) hang = Math.max(hang, -pos[i]);
  // the label sewn into the front half's hem, 3.5 cm in from the open edge, between the layers (on its fold)
  const aL = hw - TOWEL_DIMS.label.fromEdge;
  const sL = length - TOWEL_DIMS.hem / 2;
  const lp = path.at(sL);
  const lq = held.at(toHeld(sL));
  const AL = K.folds * (0.3 + 0.7 * smoothstep(0, 0.8 * path.front, lp.down)); // (as the rings' folds grow)
  const at = place(aL, sL, -0.5 * hemHt, softFloor(AL * (0.25 + foldProfile(foldFront(aL, sL))), rungFront - lp.z + hemHt), 0);
  // its frame: x across the towel, y up the towel (against s), z out of the front half's outer face
  const label = { at: at.slice(0, 3), basis: [[1, 0, 0], [0, -lp.ty, -lp.tz], [0, lp.ny, lp.nz]] };
  const labelHeld = { at: at.slice(3, 6), basis: [[1, 0, 0], [0, -lq.ty, -lq.tz], [0, lq.ny, lq.nz]] };
  return {
    geometry: g, path, stations, shape, hold, hang, label, labelHeld, perim, ringSize: M,
    railPositions: pos.slice(), heldPositions: posH, railNormals: g.attributes.normal.array.slice(), heldNormals, heldBox,
    railColours: col, heldColours: colH,
  };
}

// The ring's seam runs along the middle of the fold: both copies of each point there get the same (averaged) normal.
function joinSeam(g, M) {
  const n = g.attributes.normal;
  for (let a = 0; a < n.count; a += M) {
    const b = a + M - 1;
    const x = n.getX(a) + n.getX(b); const y = n.getY(a) + n.getY(b); const z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l);
    n.setXYZ(b, x / l, y / l, z / l);
  }
  n.needsUpdate = true;
}

// After the wiring bends a towel (a shake's ripple): its shading follows the new shape.
export function refreshTowelNormals(info) {
  const g = info.mesh.geometry;
  g.computeVertexNormals();
  joinSeam(g, info.ringSize);
}

// The care label: a satin label, its printed face (+z) the canvas, its back a blank corner of the same canvas, its
// top edge on the hinge (it hangs down from the hem).
function labelGeometry() {
  const { w, h } = TOWEL_DIMS.label;
  const front = new THREE.PlaneGeometry(w, h);
  front.translate(0, -h / 2, 0.0002);
  const back = new THREE.PlaneGeometry(w, h);
  back.rotateY(Math.PI);
  back.translate(0, -h / 2, -0.0002);
  const buv = back.attributes.uv;
  for (let i = 0; i < buv.count; i++) buv.setXY(i, 0.01 + buv.getX(i) * 0.03, 0.01 + buv.getY(i) * 0.03);
  const g = new THREE.BufferGeometry();
  const count = front.attributes.position.count;
  for (const name of ['position', 'normal', 'uv']) {
    const A = front.attributes[name]; const B = back.attributes[name];
    const arr = new Float32Array((A.count + B.count) * A.itemSize);
    arr.set(A.array, 0);
    arr.set(B.array, A.array.length);
    g.setAttribute(name, new THREE.BufferAttribute(arr, A.itemSize));
  }
  const ia = Array.from(front.index.array);
  const ib = Array.from(back.index.array, (v) => v + count);
  g.setIndex([...ia, ...ib]);
  front.dispose();
  back.dispose();
  return g;
}

export function createTowels(ctx, opts = {}) {
  const L = ctx.layout;
  const T = L.towelRail;
  const R = railRungs(L);
  const group = new THREE.Group();
  group.name = 'towels';
  placeOnWall(group, L, T.wall, (T.z0 + T.z1) / 2, T.y0);
  const parts = {};
  const anchors = {};
  const towels = {};
  const material = towelMaterial(ctx);
  const labelMat = new THREE.MeshStandardMaterial({ color: 0xf7f5f0, roughness: 0.48, metalness: 0 });
  labelMat.name = 'decal:careLabel'; // a printed label, as the stamp's and the Membran button's
  let lowest = Infinity;
  for (const kind of ['bath', 'hand']) {
    const spec = { ...L.towels[kind], ...(opts[kind] || {}) };
    const built = buildTowel(ctx, { width: spec.size[0] / 2, length: spec.size[1], kind, rung: spec.rung, R, x: spec.x || 0 });
    const pivot = new THREE.Group();
    pivot.name = `towels.${kind}Pivot`;
    pivot.position.set(built.hold.x, built.hold.y, built.hold.z);
    group.add(pivot);
    const m = mesh(ctx, built.geometry, material, `towels.${kind}`);
    pivot.add(m);
    // the label: a mount in the hem (the label's frame), a hinge in it: at rest (min) the label lies folded up flat
    // inside the hem; it swings out toward the room (through +z, never back into the gap between the halves) to hang
    // straight down below the hem (max)
    const mount = new THREE.Object3D();
    mount.name = `towels.${kind}LabelMount`;
    mount.position.fromArray(built.label.at);
    mount.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(...built.label.basis.map((v) => new THREE.Vector3().fromArray(v))));
    pivot.add(mount);
    const hinge = new THREE.Group();
    hinge.name = `towels.${kind}LabelPivot`;
    hinge.userData.joint = { type: 'hinge', axis: [1, 0, 0], min: -Math.PI, max: 0, value: 0 };
    mount.add(hinge);
    hinge.userData.joint.value = hinge.userData.joint.min;
    hinge.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), hinge.userData.joint.min);
    const label = mesh(ctx, labelGeometry(), labelMat, `towels.${kind}Label`);
    label.castShadow = false;
    label.visible = false;
    hinge.add(label);
    parts[kind] = m;
    parts[`${kind}Pivot`] = pivot;
    parts[`${kind}LabelPivot`] = hinge;
    parts[`${kind}Label`] = label;
    anchors[`${kind}Hold`] = anchor(`${kind}Hold`, pivot, 0, 0, 0);
    lowest = Math.min(lowest, built.hold.y - built.hang);
    const basis = (b) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(...b.map((v) => new THREE.Vector3().fromArray(v))));
    towels[kind] = {
      kind, mesh: m, pivot, label, labelPivot: hinge, labelMount: mount,
      width: spec.size[0] / 2, length: spec.size[1], thickness: TOWEL_KINDS[kind].thickness,
      hang: -built.heldBox.min.y, // how far the towel in hand reaches below the fingers
      ringSize: built.ringSize, // points round its cross-section (the geometry is rings of these along the towel)
      stations: built.stations, shape: built.shape, path: built.path,
      rest: { position: pivot.position.clone(), quaternion: pivot.quaternion.clone() },
      // its two shapes (positions, normals and shades, the pivot's frame): hung over the rung, and held from the fingers
      // (heldBox: the held shape's box); the label's mount in each
      railPositions: built.railPositions, heldPositions: built.heldPositions,
      railNormals: built.railNormals, heldNormals: built.heldNormals, heldBox: built.heldBox,
      railColours: built.railColours, heldColours: built.heldColours,
      labelRest: { position: mount.position.clone(), quaternion: mount.quaternion.clone() },
      labelHeld: { position: new THREE.Vector3().fromArray(built.labelHeld.at), quaternion: basis(built.labelHeld.basis) },
    };
  }
  anchors.lowest = anchor('lowest', group, 0, lowest, RAIL_DIMS.out);
  return { group, parts, anchors, towels };
}

// ---------------------------------------------------------------------------------------------------------------
// A rolled towel: the folded strip wound in a spiral from its core (an Archimedean spiral, one layer's thickness a
// turn). Only what can be seen is built: the spiral ends (each layer's rounded edge, a groove between layers, the dark
// core), the outside of the last turn with its band near the end, and the step where the towel's end lies.
export function rollShape({ strip = ROLL_DIMS.strip, pitch = ROLL_DIMS.pitch, core = ROLL_DIMS.core } = {}) {
  const A = pitch / (4 * Math.PI);
  const thetaMax = (-core + Math.sqrt(core * core + 4 * A * strip)) / (2 * A);
  const r = (th) => core + (pitch * th) / (2 * Math.PI);
  const arc = (th) => core * th + A * th * th; // length of the strip from the core to angle th
  return { thetaMax, r, arc, pitch, strip, outer: r(thetaMax) + pitch / 2 };
}

const SQUASH = 1.03; // a roll sags a little under its own weight: slightly oval
const BELLY = 0.0022; // and is a little fuller in the middle of its length
const ROLL_GAP = 0.0015; // rolls lying together: a hair apart (the terry's fuzz)

// One roll in its own frame: its axis along +y from y = 0 to its length. ends 'top': the spiral shows at the top end
// only (it stands on the other); 'both': at both ends (it lies). spin turns the towel's end (the flap) round the roll;
// the oval's long side stays along x (a lying roll sags downward, never sideways).
function rollGeometry(ctx, { colour, seed, ends = 'top', spin = 0 }) {
  const low = ctx.quality === 'low';
  const both = ends === 'both';
  const S = rollShape();
  const p = S.pitch;
  const h = ROLL_DIMS.length;
  const edge = 0.0012; // the layers' rounded edges stand this far in from the roll's ends; their tops this far out
  const base = new THREE.Color(colour);
  const rng = createRng(seed);
  const shade = 0.97 + 0.03 * rng.next();
  const pos = []; const uv = []; const uv1 = []; const col = []; const idx = [];
  const at = (r, th, y) => [r * Math.cos(th + spin) * SQUASH, y, (r * Math.sin(th + spin)) / SQUASH];
  const add = (xyz, u, v, u1, v1, ao) => {
    pos.push(...xyz); uv.push(u, v); uv1.push(u1, v1);
    const k = (ao * shade) / PILE_MEAN;
    col.push(Math.min(1, base.r * k), Math.min(1, base.g * k), Math.min(1, base.b * k));
    return pos.length / 3 - 1;
  };
  const tri = (a, b, c, out) => { // wound so its face looks along `out`
    const P = (i) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    const n = P(b).sub(P(a)).cross(P(c).sub(P(a)));
    if (n.dot(out) >= 0) idx.push(a, b, c); else idx.push(a, c, b);
  };
  const quad = (a, b, c, d, out) => { tri(a, b, c, out); tri(c, b, d, out); };
  const eOf = (th) => S.strip - S.arc(th); // distance from the towel's end (the outside)
  const v1Of = (th) => layoutV(S.arc(th), S.strip);
  // The spiral is sampled along the strip about every ROLL_STEP metres (at least 8 a turn): round turns, not polygons
  // (tmp/wave3/look.md M2: ten steps a turn read as cardboard). The outside uses the same samples on the last turn,
  // so its rim meets the ends' exactly.
  const step = low ? ROLL_STEP.low : ROLL_STEP.high;
  const spiral = [0];
  while (spiral[spiral.length - 1] < S.thetaMax - 1e-9) {
    const th = spiral[spiral.length - 1];
    spiral.push(Math.min(S.thetaMax, th + Math.min(Math.PI / 4, step / S.r(th))));
  }
  const th0 = S.thetaMax - 2 * Math.PI;
  const rimFace = []; // the ends' outer rim and the outside's last rows: shaded round over the edge (a rolled edge)
  const rimSide = [];
  // a spiral end: each layer's edge rounded out, a groove where two layers meet, the dark core inside the first turn;
  // each layer a shade of its own, the inner turns a little darker
  function spiralEnd(y, sign) {
    const out = new THREE.Vector3(0, sign, 0);
    let prev = null;
    for (const th of spiral) {
      const r = S.r(th);
      const u = S.arc(th);
      const tone = (0.86 + 0.14 * (r / S.outer)) * (1 + 0.035 * Math.sin(th * 0.5 + seed));
      const cur = [
        add(at(r - p / 2, th, y), u, 0, 0.5, v1Of(th), 0.62 * tone),
        add(at(r, th, y + sign * 0.0028), u, p / 2, 0.5, v1Of(th), 0.96 * tone),
        add(at(r + p / 2, th, y), u, p, 0.5, v1Of(th), 0.62 * tone),
      ];
      if (th >= th0 - 1e-9) rimFace.push([cur[2], th, sign]);
      if (prev) { quad(prev[0], cur[0], prev[1], cur[1], out); quad(prev[1], cur[1], prev[2], cur[2], out); }
      prev = cur;
    }
    const c0 = add([0, y - sign * 0.011, 0], 0, 0, 0.5, 0, 0.3);
    let last = null;
    for (const th of [...spiral.filter((t) => t < 2 * Math.PI - 1e-9), 2 * Math.PI]) {
      const v = add(at(S.r(th) - p / 2, th, y), S.arc(th), 0, 0.5, v1Of(th), 0.45);
      if (last !== null) tri(c0, last, v, out);
      last = v;
    }
  }
  spiralEnd(h - edge, 1);
  if (both) spiralEnd(edge, -1);
  // the outside of the last turn: a slight belly, the band (a little sunk) near the end; standing, rounded at its foot
  const ths = [th0, ...spiral.filter((t) => t > th0 + 1e-9)];
  const d = TOWEL_DIMS.edgeStep / 2;
  for (const e of [TOWEL_DIMS.hem - d, TOWEL_DIMS.hem + d, TOWEL_DIMS.band[0] - d, TOWEL_DIMS.band[0] + d, TOWEL_DIMS.band[1] - d, TOWEL_DIMS.band[1] + d]) {
    // the angle at which the strip is e from its end, on the last turn: solve arc(th) = strip - e
    const A = p / (4 * Math.PI);
    const th = (-ROLL_DIMS.core + Math.sqrt(ROLL_DIMS.core ** 2 + 4 * A * (S.strip - e))) / (2 * A);
    if (th > th0 && th < S.thetaMax) ths.push(th);
  }
  ths.sort((a, b) => a - b);
  // rows up the roll: [y, radius change, shade]; the end rows meet the spiral ends' outer edges exactly
  const rows = both
    ? [[edge, 0, 0.97], [h / 2, BELLY, 1], [h - edge, 0, 0.97]]
    : [[0, -0.004, 0.78], [0.03, 0, 0.92], [h / 2, BELLY, 1], [h - edge, 0, 0.97]]; // standing: its foot curls under
  const endRow = (k) => k === rows.length - 1 || (both && k === 0);
  let col0 = null;
  for (const th of ths) {
    const e = eOf(th);
    const sunk = inBand(e) ? -0.0015 : 0;
    const R0 = S.r(th) + p / 2;
    const flat = flatWoven(e);
    const tint = inBand(e) ? 0.9 : 1;
    const cur = rows.map(([y, dr, ao], k) => add(at(R0 + (endRow(k) ? 0 : dr + sunk), th, y),
      S.arc(th) * (flat ? TOWEL_DIMS.bandU : 1), y, y / h, v1Of(th), ao * tint));
    rows.forEach(([y], k) => { if (endRow(k)) rimSide.push([cur[k], y > h / 2 ? 1 : -1]); });
    if (col0) {
      const out = new THREE.Vector3(Math.cos(th + spin), 0, Math.sin(th + spin));
      for (let k = 0; k < rows.length - 1; k++) quad(col0[k], cur[k], col0[k + 1], cur[k + 1], out);
    }
    col0 = cur;
  }
  // the step where the towel's end lies on the turn under it
  const thE = S.thetaMax;
  const outE = new THREE.Vector3(-Math.sin(thE + spin), 0, Math.cos(thE + spin));
  const inner = rows.map(([y, dr], k) => add(at(S.r(thE) - p / 2 + (endRow(k) ? 0 : dr), thE, y), S.arc(thE), y, y / h, 1, 0.8));
  const outer = rows.map(([y, dr], k) => add(at(S.r(thE) + p / 2 + (endRow(k) ? 0 : dr), thE, y), S.arc(thE) + p, y, y / h, 1, 0.85));
  for (let k = 0; k < rows.length - 1; k++) quad(inner[k], outer[k], inner[k + 1], outer[k + 1], outE);
  rows.forEach(([y], k) => { if (endRow(k)) rimSide.push([outer[k], y > h / 2 ? 1 : -1]); });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the rim: a rolled edge is round, so its shading turns over it (the outside's last row leans toward the end, the
  // end's outer rim toward the side) instead of breaking at a cut edge
  const N = g.attributes.normal;
  const lean = (i, x, y, z) => {
    const nx = N.getX(i) + x; const ny = N.getY(i) + y; const nz = N.getZ(i) + z;
    const l = Math.hypot(nx, ny, nz) || 1;
    N.setXYZ(i, nx / l, ny / l, nz / l);
  };
  for (const [i, sign] of rimSide) lean(i, 0, 0.9 * sign, 0);
  for (const [i, th] of rimFace) lean(i, 0.9 * Math.cos(th + spin), 0, 0.9 * Math.sin(th + spin));
  return g;
}

// Joins geometries with position, normal, uv, uv1 and color (util.js mergeGeometries keeps only the first three).
function mergeTowelGeometries(list) {
  const names = ['position', 'normal', 'uv', 'uv1', 'color'];
  let vCount = 0;
  let iCount = 0;
  for (const g of list) { vCount += g.attributes.position.count; iCount += g.index.count; }
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const size = list[0].attributes[name].itemSize;
    const arr = new Float32Array(vCount * size);
    let o = 0;
    for (const g of list) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let io = 0;
  let vo = 0;
  for (const g of list) {
    for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo;
    io += g.index.count;
    vo += g.attributes.position.count;
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

// How rolled towels lie in a basket of this inside size (the basket's anchors.inside: its length along x, its width
// along z, its floor at y = 0): two side by side along its length, the third on top in the dip between them, each
// across the basket so both spiral ends show; their towels' ends turned different ways, three soft colours.
export const BASKET_INSIDE = { length: 0.32, width: 0.24 };
export function rollsForBasket({ length = BASKET_INSIDE.length } = {}) {
  const S = rollShape();
  const reach = S.outer * SQUASH + BELLY; // how far a roll reaches from its axis
  const s = Math.min(reach + ROLL_GAP / 2, length / 2 - reach - 0.006);
  return [
    { x: -s, colour: 'offWhite', spin: 0.6 },
    { x: s, colour: 'sage', spin: 2.5 }, // (as the bath towel on the rail)
    { x: 0, onTop: true, colour: 'oat', spin: 4.3 },
  ];
}

// Rolled towels for a basket: all rolls in one mesh (the integrator puts the group on the basket's inside floor, in
// the frame of its anchors.inside). opts.basket: that inside's size ({ length, width }) for the default pyramid, or
// opts.rolls: [{ x, z?, y?, yaw? (turns a lying roll's axis about the vertical; 0 = across, along z), upright?, onTop?
// (lies in the dip between the two rolls nearest below it), spin?, colour (a TOWEL_COLOURS name or a hex) }].
// Returns { group, parts: { rolls }, anchors, rolls: [{ start, count (its vertices), centre [x, y, z] (on its axis),
// axis, radius, base (its lowest y), colour }] } (a tap squashes one roll: the wiring moves its own vertices).
export function createRolledTowel(ctx, { rolls = null, basket = null } = {}) {
  const specs = rolls || rollsForBasket(basket || BASKET_INSIDE);
  const group = new THREE.Group();
  group.name = 'towelRolls';
  const h = ROLL_DIMS.length;
  const built = specs.map((r, i) => {
    const colour = TOWEL_COLOURS[r.colour] || r.colour || TOWEL_COLOURS.offWhite;
    const g = rollGeometry(ctx, { colour, seed: 31 + i, ends: r.upright ? 'top' : 'both', spin: r.spin || 0 });
    if (r.upright) {
      g.rotateY(-(r.yaw || 0));
      return { r, g, colour, axis: [0, 1, 0], reach: 0, lift: 0 };
    }
    g.translate(0, -h / 2, 0); // centred on its axis, the axis laid along z (across the basket), then turned by yaw
    g.rotateX(Math.PI / 2);
    if (r.yaw) g.rotateY(r.yaw);
    g.computeBoundingBox();
    const P = g.attributes.position;
    let reach = 0;
    for (let k = 0; k < P.count; k++) reach = Math.max(reach, Math.hypot(P.getX(k), P.getY(k)));
    const a = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), r.yaw || 0);
    return { r, g, colour, axis: [a.x, a.y, a.z].map((v) => (Math.abs(v) < 1e-12 ? 0 : v)), reach, lift: -g.boundingBox.min.y };
  });
  // where each lies: on the floor, or in the dip between the two rolls below it
  const centres = built.map((b) => [b.r.x || 0, b.r.upright ? (b.r.y || 0) + h / 2 : (b.r.y || 0) + b.lift, b.r.z || 0]);
  built.forEach((b, i) => {
    if (!b.r.onTop || b.r.upright) return;
    const below = built.map((o, j) => ({ o, j })).filter(({ o, j }) => j !== i && !o.r.onTop && !o.r.upright)
      .sort((p, q) => Math.abs(centres[p.j][0] - centres[i][0]) - Math.abs(centres[q.j][0] - centres[i][0])).slice(0, 2);
    if (below.length === 2) { // it settles until it touches both: where the two contact circles meet, the upper point
      const [p, q] = below.map(({ o, j }) => ({ x: centres[j][0], y: centres[j][1], R: b.reach + o.reach + ROLL_GAP }));
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d > 0 && d < p.R + q.R) {
        const a = (p.R * p.R - q.R * q.R + d * d) / (2 * d);
        const hh = Math.sqrt(Math.max(0, p.R * p.R - a * a));
        const mx = p.x + (a * (q.x - p.x)) / d;
        const my = p.y + (a * (q.y - p.y)) / d;
        const s = (q.x - p.x) >= 0 ? 1 : -1; // the perpendicular that points up
        centres[i][0] = mx - (s * hh * (q.y - p.y)) / d;
        centres[i][1] = my + (s * hh * (q.x - p.x)) / d;
        return;
      }
    }
    let y = centres[i][1];
    for (const { o, j } of below) {
      const dx = centres[i][0] - centres[j][0];
      const R = b.reach + o.reach + ROLL_GAP;
      if (Math.abs(dx) < R) y = Math.max(y, centres[j][1] + Math.sqrt(R * R - dx * dx));
    }
    centres[i][1] = y;
  });
  const list = [];
  const info = [];
  let start = 0;
  built.forEach((b, i) => {
    const [x, y, z] = centres[i];
    b.g.translate(x, b.r.upright ? (b.r.y || 0) : y, z);
    // what faces down (the basket's floor, the roll below) is in shade
    const N = b.g.attributes.normal;
    const C = b.g.attributes.color;
    for (let k = 0; k < N.count; k++) {
      const f = 1 - 0.25 * Math.max(0, -N.getY(k));
      C.setXYZ(k, C.getX(k) * f, C.getY(k) * f, C.getZ(k) * f);
    }
    const count = b.g.attributes.position.count;
    b.g.computeBoundingBox();
    info.push({
      start, count, centre: [x, y, z], axis: b.axis, radius: b.r.upright ? rollShape().outer * SQUASH + BELLY : b.reach,
      base: b.g.boundingBox.min.y, colour: b.colour,
    });
    list.push(b.g);
    start += count;
  });
  const geometry = mergeTowelGeometries(list);
  for (const g of list) g.dispose();
  const m = mesh(ctx, geometry, towelMaterial(ctx), 'towelRolls.rolls');
  group.add(m);
  geometry.computeBoundingBox();
  const anchors = { top: anchor('top', group, 0, geometry.boundingBox.max.y, 0) };
  return { group, parts: { rolls: m }, anchors, rolls: info };
}
