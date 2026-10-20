// Touching the towels (fixtures/towels.js). A tap on a towel on the rail: it comes off its rung and hangs in front of
// the visitor from their fingers (things come to the visitor; the eye never moves), swinging gently until it settles;
// never nearer than it fits the screen, clear of every real part in the room (TOWEL_WIRING.hold); standing right at
// the rail it is lifted off its rung and held there. Its shape blends from hung-over-a-rung to held-from-the-fingers.
// While it is held: a drag swings it, a sharp one shakes it out (a flap, a little lint in the air); a finger resting
// on it lifts its corner and the care label sewn into the hem comes up to be read (research/ideas-sales.md idea 16:
// bathroom care in small symbols); a tap puts the label back; the next tap (or a tap beside it, Escape, the phone's
// Back) hangs the towel back over its rung with a soft fump. A rolled towel in the basket gives a little under a
// finger. Every sound follows the visitor's own touch; nothing here plays by itself.
//
// wireTowels(ctx, helpers, { towels, rolls }) with helpers = { found, play, reg, control, holdUp, loop, tweens } as
// built in scene/interactions.js install(); towels = createTowels() (default ctx.fixtures.towels), rolls =
// createRolledTowel() (default ctx.fixtures.towelRolls). Returns a small control surface (tests, the integrator).
import * as THREE from 'three';
import { OBB } from 'three/addons/math/OBB.js';
import { setJoint } from '../fixtures/util.js';
import { TOWEL_DIMS, refreshTowelNormals } from '../fixtures/towels.js';
import { canvasSheet, flowText, fixedLine, paintLines, canvasMeasure, HELD_PAPER_LIGHT, INK, INK_SOFT, GREEN } from '../systems/paper.js';

// Discovery keys (add them to scene/interactions.js DISCOVERIES: the mirror counts them).
export const TOWEL_DISCOVERIES = ['towelTake', 'towelShake', 'towelLabel'];

export const TOWEL_WIRING = {
  liftMs: 560, // off the rail and up to the eye
  hangMs: 620, // back over the rung
  labelMs: 650, // the corner up and the label to the eye (and back)
  repeatMs: 400, // a tap this soon after the take is the other half of a double-tap
  fill: 0.8, // a held towel takes at most this much of the view's height ...
  fillW: 0.82, // ... and of its width
  labelFill: 0.78, // the label read: this much of the view's height at most ...
  labelFillW: 0.8, // ... and of its width (on an upright phone the width decides: 80 % of 375 px)
  zoomMax: 2, // a pinch brings a held towel up to twice as near: never past where it fills the screen, nor nearer than hold.near
  // Where a towel in hand hangs (tmp/wave3/look.md H1: never on the visitor's face). In front of the eye, never nearer
  // than the whole towel just fits the screen; the room is checked by the real parts (each mesh's own box: the open
  // door leaf is a thin slab, not the door's whole box). Where the comfortable place is taken it hangs a little lower,
  // higher or to the side, a little farther ("a little smaller in view"), or nearer down to where it just fits; failing
  // that, partly off the screen to the side or below. Near the rail, where no place in front of the eye holds it whole,
  // it comes off the rail all the same (tmp/wave3/look2.md 7: lifted 4 cm it read as nothing happening): nearer than it
  // fits, held lower or to the side, its top fold in the upper part of the screen (close). No part of it ever comes
  // within `near` of the eye. Only where even that has no room is it lifted off its rung and held in front of the rail.
  hold: {
    further: [1, 1.05, 1.1, 1.15, 1.2, 1.3], // times the comfortable distance
    nearer: 4, // steps from the comfortable distance in to where it just fits the screen
    step: 0.05, // metres: shifts lower (up to lower steps), higher and to the side
    lower: 6,
    higher: 3,
    side: 5,
    gap: 0.02, // clear of every part and the walls by this much
    swing: 0.04, // room to swing toward and away from the eye
    edge: 0.02, // room for its edges and hem to sway
    partW: 0.55, // partly off the screen: at least this much of its width ...
    partH: 0.6, // ... and of its height on it, its top fold always on it
    near: 0.3, // metres: no part of a towel in hand nearer the eye (tmp/wave3/look2.md 6: a pinch put it on the face)
    // near the rail: at these distances (metres along the view, under the fitting one), its top fold a quarter of the
    // screen below the screen's top (shifted up to `lower` steps either way) and up to `side` steps aside; at least w of
    // its width and h of its height on the screen, its top no higher than `top` (of the screen's half-height)
    close: { dists: [0.56, 0.5, 0.46, 0.42, 0.39, 0.36, 0.33], lower: 3, side: 5, w: 0.45, h: 0.3, top: 0.92 },
    rail: { out: 0.08, lift: 0.12, swing: 0.05, near: 1.25, face: 0.3 }, // held at the rail: out of the rungs, well up off
    // its rung (seen to come off), its hem swinging at most this far toward the wall; partly off the screen is tried first
    // only when it hung farther than near x the fitting distance; never brought nearer the eye than face (metres). Only
    // where nothing in front of the eye has room (looking along the wall beside the rail: tests/towelWiring.test.js)
  },
  gravity: 9.81,
  damping: 1.5, // 1/s: a swing dies away in a few seconds (still after about 6 s)
  takeKick: 0.8, // rad/s: lifted off the rail, its foot trails behind
  kick: 0.012, // rad/s per pixel a finger drags it
  flapSpeed: 2.6, // rad/s: a drag this sharp shakes it out (a slower one only swings it)
  flapGapMs: 450, // one flap per snap
  snapMs: 320, // the cloth pulls taut this long after the flick: the snap in every towel_flap variant (its whoosh first)
  maxPitch: 0.7, // rad: it never swings further
  maxRoll: 0.5,
  wave: { length: 0.32, speed: 0.85, ms: 1100, decayMs: 350 }, // the ripple a shake sends down the cloth
  fluff: { count: 24, lifeMs: 2000 },
};

// ---------------------------------------------------------------------------------------------------------------
// The care label: a satin label like the one in clothing, with bathroom care in small symbols. The four lines are
// research/ideas-sales.md idea 16 (general care advice; no intervals, no numbers). Design px: 500 x 1000 (the label
// is 4.5 x 9 cm); the canvas is drawn 1.536x larger for a sharp read.
export const LABEL = {
  W: 500,
  H: 1000,
  scale: 1.536,
  margin: 34,
  heading: 'Stell og vedlikehold',
  items: [
    { symbol: 'drain', text: 'Rens sluket' },
    { symbol: 'joint', text: 'Sjekk silikonfugene' },
    { symbol: 'air', text: 'Luft ut etter dusjen' },
    { symbol: 'noDrill', text: 'Ikke bor i dusjsonen uten å spørre oss' },
  ],
  maker: 'Straume Våtrom',
  hem: 56, // the top 56 px are folded into the towel's hem (a stitch line)
  symbol: { x: 40, size: 92 },
  textX: 150,
};
// The smallest text size (design px) that reads at 16 px on a 375 px wide phone with the label held up to read.
export const LABEL_MIN_PX = 16 / ((TOWEL_WIRING.labelFillW * 375) / LABEL.W);

// The label's layout as data: { lines, rows: [{ symbol, cy }], rule, fits }. Pure (measure = paper.js canvasMeasure
// in the room, the real font metrics in the tests).
export function careLabelLayout(measure) {
  const X = LABEL.margin;
  const Wd = LABEL.W - 2 * X;
  const head = flowText([{ text: LABEL.heading, size: 46, weight: 760, color: INK, align: 'center', lead: 1.1, tag: 'heading' }], measure,
    { x: X, w: Wd, top: LABEL.hem + 26 });
  const lines = [...head.lines];
  const rule = { x: X, y: head.bottom + 14, w: Wd };
  const rows = [];
  let y = rule.y + 26;
  const tw = LABEL.W - LABEL.textX - X;
  for (const item of LABEL.items) {
    const t = flowText([{ text: item.text, size: 40, weight: 560, color: INK, lead: 1.14, tag: item.symbol }], measure, { x: LABEL.textX, w: tw, top: y });
    const textH = t.bottom - y;
    const h = Math.max(LABEL.symbol.size, textH);
    // the text sits beside the symbol's middle
    const shift = (h - textH) / 2;
    for (const l of t.lines) lines.push({ ...l, y: l.y + shift });
    rows.push({ symbol: item.symbol, cy: y + h / 2 });
    y += h + 30;
  }
  const maker = fixedLine(LABEL.maker, { x: X, w: Wd, y: LABEL.H - 46, size: 38, weight: 700, color: INK_SOFT, align: 'center', tag: 'maker' }, measure);
  lines.push(maker);
  const fits = y - 30 <= LABEL.H - 46 - 38 * 1.05 - 18;
  return { lines, rows, rule, fits, bottom: y - 30 };
}

// Line art for the four symbols, in a box of side s centred at (cx, cy) (design px; the canvas is scaled).
function drawSymbol(g, kind, cx, cy, s) {
  const r = s / 2;
  g.save();
  g.translate(cx, cy);
  g.strokeStyle = '#3d3e40';
  g.fillStyle = '#3d3e40';
  g.lineWidth = 4.5;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (kind === 'drain') { // a round drain grate seen from above: its ring, a hub, slots between them
    g.beginPath(); g.arc(0, 0, r * 0.82, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(0, 0, r * 0.2, 0, Math.PI * 2); g.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 + Math.PI / 8;
      g.beginPath(); g.moveTo(Math.cos(a) * r * 0.34, Math.sin(a) * r * 0.34); g.lineTo(Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66); g.stroke();
    }
  } else if (kind === 'joint') { // a wall meeting a floor, the silicone bead filling the corner
    g.beginPath(); g.moveTo(-r * 0.55, -r * 0.8); g.lineTo(-r * 0.55, r * 0.55); g.lineTo(r * 0.8, r * 0.55); g.stroke();
    g.beginPath(); g.moveTo(-r * 0.55, r * 0.1); g.quadraticCurveTo(-r * 0.4, r * 0.4, -r * 0.1, r * 0.55); g.lineTo(-r * 0.55, r * 0.55); g.closePath();
    g.globalAlpha = 0.35; g.fill(); g.globalAlpha = 1; g.stroke();
  } else if (kind === 'air') { // steam rising and going out
    for (const dx of [-0.42, -0.08, 0.26]) {
      g.beginPath();
      g.moveTo(r * dx, r * 0.75);
      g.bezierCurveTo(r * (dx - 0.22), r * 0.35, r * (dx + 0.22), r * 0.05, r * dx, -r * 0.35);
      g.stroke();
    }
    g.beginPath(); g.moveTo(r * 0.2, -r * 0.62); g.lineTo(r * 0.72, -r * 0.62); g.moveTo(r * 0.5, -r * 0.82); g.lineTo(r * 0.74, -r * 0.62); g.lineTo(r * 0.5, -r * 0.42); g.stroke();
  } else if (kind === 'noDrill') { // a drill bit, crossed out the way a care label says "do not"
    g.beginPath(); g.moveTo(-r * 0.12, -r * 0.8); g.lineTo(r * 0.12, -r * 0.8); g.lineTo(r * 0.12, r * 0.45); g.lineTo(0, r * 0.75); g.lineTo(-r * 0.12, r * 0.45); g.closePath(); g.stroke();
    for (let k = -0.6; k < 0.4; k += 0.25) { g.beginPath(); g.moveTo(-r * 0.12, r * k); g.lineTo(r * 0.12, r * (k + 0.14)); g.stroke(); }
    g.lineWidth = 6;
    g.beginPath(); g.moveTo(-r * 0.78, -r * 0.78); g.lineTo(r * 0.78, r * 0.78); g.moveTo(r * 0.78, -r * 0.78); g.lineTo(-r * 0.78, r * 0.78); g.stroke();
  }
  g.restore();
}

// Draws the label on its canvas (satin, the hem's fold and stitch at the top, the words and symbols); returns the
// layout. The label's back (a blank satin corner, fixtures/towels.js) needs nothing.
export function drawCareLabel(canvas) {
  const g = canvas.getContext('2d');
  const s = canvas.width / LABEL.W;
  const L = careLabelLayout(canvasMeasure(g));
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#f7f6f2';
  g.fillRect(0, 0, canvas.width, canvas.height);
  // satin: a fine weave and a soft sheen down its length
  g.globalAlpha = 0.05;
  g.fillStyle = '#9a968d';
  for (let y = 0; y < canvas.height; y += 3 * s) g.fillRect(0, y, canvas.width, Math.max(1, 0.6 * s));
  g.globalAlpha = 1;
  // the hem: the fold that goes into the towel, its stitch
  g.fillStyle = '#ebe8e1';
  g.fillRect(0, 0, canvas.width, LABEL.hem * s);
  g.strokeStyle = 'rgba(80,78,72,0.55)';
  g.lineWidth = 2 * s;
  g.setLineDash([10 * s, 7 * s]);
  g.beginPath(); g.moveTo(10 * s, 38 * s); g.lineTo(canvas.width - 10 * s, 38 * s); g.stroke();
  g.setLineDash([]);
  // a thin rule under the heading, the brand's green as a small bar by the maker
  g.fillStyle = 'rgba(61,62,64,0.5)';
  g.fillRect(L.rule.x * s, L.rule.y * s, L.rule.w * s, 2 * s);
  g.fillStyle = GREEN;
  g.fillRect((LABEL.W / 2 - 40) * s, (LABEL.H - 100) * s, 80 * s, 6 * s);
  g.setTransform(s, 0, 0, s, 0, 0);
  for (const row of L.rows) drawSymbol(g, row.symbol, LABEL.symbol.x + LABEL.symbol.size / 2, row.cy, LABEL.symbol.size);
  g.setTransform(1, 0, 0, 1, 0, 0);
  paintLines(g, L.lines, s);
  return L;
}

// ---------------------------------------------------------------------------------------------------------------
const Y = new THREE.Vector3(0, 1, 0);
const ease = (t) => -(Math.cos(Math.PI * Math.min(1, Math.max(0, t))) - 1) / 2;

export function wireTowels(ctx, helpers, opts = {}) {
  const { found, play, reg, loop } = helpers;
  const towels = opts.towels || (ctx.fixtures && ctx.fixtures.towels);
  const rolls = opts.rolls || (ctx.fixtures && ctx.fixtures.towelRolls);
  const { scene, camera, interaction } = ctx;
  const W = TOWEL_WIRING;
  if (!towels) return { towels, rolls, take: () => false, hangBack: () => false, held: null, state: 'rail' };

  // ---- the label's print: one canvas for both labels (the same words), drawn the first time a label is read
  const labelMat = towels.parts.bathLabel.material;
  let labelDrawn = false;
  function printLabel() {
    if (labelDrawn) return;
    labelDrawn = true;
    const c = canvasSheet(Math.round(LABEL.W * LABEL.scale), Math.round(LABEL.H * LABEL.scale));
    drawCareLabel(c);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    labelMat.map = tex;
    labelMat.color.set(0xffffff);
    labelMat.needsUpdate = true;
  }
  // a label held up to read gets a little light of its own, like a held paper (systems/paper.js): never a glow
  function labelLight(k) {
    const room = ctx.roomLight && Number.isFinite(ctx.roomLight.paperLight) ? ctx.roomLight.paperLight : 1;
    if (k > 0 && labelMat.map && labelMat.emissiveMap !== labelMat.map) {
      labelMat.emissiveMap = labelMat.map;
      labelMat.emissive.set(0xffffff);
      labelMat.needsUpdate = true;
    }
    labelMat.emissiveIntensity = Math.max(0, HELD_PAPER_LIGHT * room * k); // (never -0: ease(0) is -0)
  }

  // ---- the state of the towel in hand (one at a time)
  let active = null; // the towel's info (fixtures/towels.js towels[kind]) while it is off the rail
  let state = 'rail'; // 'rail' | 'taking' | 'held' | 'reading' | 'hanging'
  let t = 0; // progress of the move under way, 0..1
  let takenAt = -1e9;
  let armed = false; // a history entry is up: the phone's Back hangs the towel back
  const swing = { phi: 0, phiV: 0, psi: 0, psiV: 0 }; // pitch (to and from the eye) and roll (side to side)
  let lastFlap = -1e9;
  let read = 0; // 0 = held, 1 = its label up to the eye
  let readTarget = 0;
  let zoom = 1;
  let hold = null; // where the towel in hand hangs (placeHeld: found as it is taken)
  const railPos = new THREE.Vector3();
  const railQuat = new THREE.Quaternion();
  const fromPos = new THREE.Vector3();
  const fromQuat = new THREE.Quaternion();
  const targets = [];
  const now = () => performance.now();

  // ---- where it hangs (TOWEL_WIRING.hold): found once as it is taken (the eye stands still while a towel is in hand)
  // and again only for a pinch. In front of the eye its pinch point is the eye + d along the view + sx to the right +
  // sy up + half its hanging length up, less its middle across (the fingers hold it a little off its middle), so its
  // middle is on the line of sight when sx = sy = 0; its room side to the eye.
  const fwd = new THREE.Vector3();
  const flat = new THREE.Vector3();
  const right = new THREE.Vector3();
  const heldPos = new THREE.Vector3();
  const heldQuat = new THREE.Quaternion();
  const tanV = () => Math.tan((camera.fov * Math.PI) / 360);
  // the comfortable distance: it takes at most 80 % of the view's height and 82 % of its width
  // (its size held from the fingers: the held shape's own box)
  const sizes = new WeakMap(); // (worked out once per box: asked every frame while it is held)
  const sizeOf = (info) => {
    const b = boxOf(info);
    if (!sizes.has(b)) sizes.set(b, { w: b.max.x - b.min.x, h: b.max.y - b.min.y, mid: (b.max.y + b.min.y) / 2, midX: (b.max.x + b.min.x) / 2 });
    return sizes.get(b);
  };
  function fitDistance(info) {
    const tv = tanV();
    const th = tv * camera.aspect;
    const s = sizeOf(info);
    return Math.max((s.h + 0.06) / 2 / tv / W.fill, (s.w + 0.04) / 2 / th / W.fillW, camera.near * 4);
  }
  // the distance at which the whole towel just fits the screen (its height or its width, a centimetre to spare)
  function screenFit(info) {
    const tv = tanV();
    const s = sizeOf(info);
    return Math.max((s.h + 0.03) / 2 / tv, (s.w + 0.02) / 2 / (tv * camera.aspect));
  }
  function viewFrame() {
    camera.updateMatrixWorld();
    fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    flat.set(fwd.x, 0, fwd.z);
    if (flat.lengthSq() < 1e-8) flat.set(0, 0, -1).applyQuaternion(camera.quaternion).setY(0);
    if (flat.lengthSq() < 1e-8) flat.set(0, 0, -1);
    flat.normalize();
    right.set(-flat.z, 0, flat.x);
  }
  // the towel's own box in its pivot frame (x across, y up from the pinch, z out of its room side)
  const boxOf = (info) => info.heldBox || info.mesh.geometry.boundingBox;

  // Every part a towel in hand keeps clear of, as found when it is taken: each visible mesh of every fixture as its own
  // oriented box (its geometry's box where it stands), so the open door leaf is a thin slab and the rail the block of
  // its rungs, never a fixture's whole box grown round the eye. The towel in hand is off the rail by then (the other
  // towel is among them); invisible touch boxes are not.
  const parts = [];
  const pool = [];
  function collectParts() {
    parts.length = 0;
    lastHit = lastHide = null;
    for (const f of Object.values(ctx.fixtures || {})) {
      if (!f || !f.group) continue;
      f.group.updateWorldMatrix(true, true);
      f.group.traverseVisible((o) => {
        if (!o.isMesh || o.userData.touchBox) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        if (mats.every((m) => !m || m.visible === false)) return;
        const g = o.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        if (g.boundingBox.isEmpty()) return;
        const e = o.matrixWorld.elements;
        const sx = Math.hypot(e[0], e[1], e[2]); const sy = Math.hypot(e[4], e[5], e[6]); const sz = Math.hypot(e[8], e[9], e[10]);
        if (!(sx > 1e-9 && sy > 1e-9 && sz > 1e-9)) return;
        const b = pool[parts.length] || (pool[parts.length] = { box: new OBB(), r: 0, eye: false });
        g.boundingBox.getCenter(b.box.center).applyMatrix4(o.matrixWorld); // (OBB.applyMatrix4 would not turn the centre)
        g.boundingBox.getSize(b.box.halfSize).multiplyScalar(0.5);
        b.box.halfSize.x *= sx; b.box.halfSize.y *= sy; b.box.halfSize.z *= sz;
        b.box.rotation.set(e[0] / sx, e[4] / sy, e[8] / sz, e[1] / sx, e[5] / sy, e[9] / sz, e[2] / sx, e[6] / sy, e[10] / sz);
        b.r = b.box.halfSize.length();
        b.eye = b.box.containsPoint(camera.position); // (the door frame round an eye in the doorway hides nothing ahead)
        parts.push(b);
      });
    }
  }

  // Whether the towel can hang with its pinch at p, turned by q: inside the room (over the floor, under the ceiling),
  // no part of it within W.hold.near of the eye, clear of every part, and nothing in front of what of it is on the
  // screen; `screen` 'whole' (all of it on the screen), 'part' (enough of it, its top fold on it), 'close' (held near:
  // less of it, its top fold in the screen's upper part) or 'none'. `cover` gets how much of its width and height is on
  // the screen.
  const tBox = new OBB();
  const tLocal = new THREE.Vector3();
  const pinchP = new THREE.Vector3();
  const tq = new THREE.Quaternion();
  const tm4 = new THREE.Matrix4();
  const tmp = new THREE.Vector3();
  const sight = new THREE.Ray();
  const hitP = new THREE.Vector3();
  const cover = { w: 0, h: 0 };
  const FACE = [[0, 1], [1, 1], [0, 0], [1, 0], [0.5, 0.5], [0.5, 1]]; // its face's corners, middle, top middle
  function clearAt(info, p, q, screen) {
    const H = W.hold;
    const bb = boxOf(info);
    const z0 = Math.min(bb.min.z, -0.03); const z1 = Math.max(bb.max.z, 0.03);
    tBox.halfSize.set((bb.max.x - bb.min.x) / 2 + H.edge + H.gap, (bb.max.y - bb.min.y) / 2 + H.edge + H.gap, (z1 - z0) / 2 + H.swing + H.gap);
    tLocal.set((bb.max.x + bb.min.x) / 2, (bb.max.y + bb.min.y) / 2, (z1 + z0) / 2);
    tBox.center.copy(tLocal).applyQuaternion(q).add(p);
    tBox.rotation.setFromMatrix4(tm4.makeRotationFromQuaternion(q));
    const e = tBox.rotation.elements;
    const hs = tBox.halfSize;
    const c = tBox.center;
    const L = ctx.layout.room;
    const ex = Math.abs(e[0]) * hs.x + Math.abs(e[3]) * hs.y + Math.abs(e[6]) * hs.z;
    const ey = Math.abs(e[1]) * hs.x + Math.abs(e[4]) * hs.y + Math.abs(e[7]) * hs.z;
    const ez = Math.abs(e[2]) * hs.x + Math.abs(e[5]) * hs.y + Math.abs(e[8]) * hs.z;
    if (c.x - ex < 0 || c.x + ex > L.W || c.z - ez < 0 || c.z + ez > L.D || c.y - ey < 0 || c.y + ey > L.H) return false;
    // (cheapest first: the walls, the screen, the parts, then what lies between it and the eye)
    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
    for (let i = 0; i < 4; i++) {
      tmp.set(bb.min.x + (bb.max.x - bb.min.x) * FACE[i][0], bb.min.y + (bb.max.y - bb.min.y) * FACE[i][1], bb.max.z).applyQuaternion(q).add(p).project(camera);
      if (tmp.z > 1) { x0 = y0 = -Infinity; x1 = y1 = Infinity; break; } // behind the eye
      x0 = Math.min(x0, tmp.x); x1 = Math.max(x1, tmp.x); y0 = Math.min(y0, tmp.y); y1 = Math.max(y1, tmp.y);
    }
    cover.w = Math.max(0, Math.min(1, x1) - Math.max(-1, x0)) / Math.max(1e-9, x1 - x0);
    cover.h = Math.max(0, Math.min(1, y1) - Math.max(-1, y0)) / Math.max(1e-9, y1 - y0);
    if (screen === 'whole' && (x0 < -1 || x1 > 1 || y0 < -1 || y1 > 1)) return false;
    if (screen === 'part' && (cover.w < H.partW || cover.h < H.partH || y1 > 1)) return false;
    if (screen === 'close' && (cover.w < H.close.w || cover.h < H.close.h || y1 > H.close.top)) return false;
    if (nearestOfBox(info, p, q) < H.near) return false; // never on the face
    const reach = hs.length();
    if (lastHit && hits(lastHit, c, reach)) return false;
    for (const b of parts) if (b !== lastHit && hits(b, c, reach)) { lastHit = b; return false; }
    // seen: no part between the eye and what of it is on the screen
    const eye = camera.position;
    for (const [fx, fy] of FACE) {
      tmp.set(bb.min.x + (bb.max.x - bb.min.x) * fx, bb.min.y + (bb.max.y - bb.min.y) * fy, bb.max.z).applyQuaternion(q).add(p);
      const len = tmp.distanceTo(eye);
      sight.origin.copy(eye);
      sight.direction.copy(tmp).sub(eye).divideScalar(Math.max(1e-9, len));
      tmp.project(camera);
      if (Math.abs(tmp.x) > 1 || Math.abs(tmp.y) > 1) continue; // off the screen: nothing to hide
      if (lastHide && hides(lastHide, len)) return false;
      for (const b of parts) if (b !== lastHide && hides(b, len)) { lastHide = b; return false; }
    }
    return true;
  }
  // (the part that turned the last place down is asked first: the open leaf turns down many places in a row)
  let lastHit = null;
  let lastHide = null;
  const hits = (b, c, reach) => b.box.center.distanceTo(c) <= b.r + reach && b.box.intersectsOBB(tBox);
  function hides(b, len) { // b lies on the sight line before its end
    if (b.eye) return false;
    const eye = camera.position;
    const along = tmp.copy(b.box.center).sub(eye).dot(sight.direction); // (nowhere near the line: no)
    if (along < -b.r || along > len + b.r || tmp.lengthSq() - along * along > b.r * b.r) return false;
    return b.box.intersectRay(sight, hitP) !== null && hitP.distanceTo(eye) < len - 0.01;
  }
  const pinchAt = (info, d, sx, sy, out) => out.copy(camera.position).addScaledVector(fwd, d).addScaledVector(right, sx - sizeOf(info).midX)
    .addScaledVector(Y, sy - sizeOf(info).mid);

  // Standing at the rail: lifted off its rung and held right in front of the rail, out of the rungs, but never brought
  // nearer the eye than W.hold.rail.face (then less far out: it was that near on the rail already).
  const nOut = new THREE.Vector3();
  const local = new THREE.Vector3();
  function nearestOfBox(info, p, q) { // metres from the eye to the towel's own box hanging at p, turned by q
    const bb = boxOf(info);
    local.copy(camera.position).sub(p).applyQuaternion(tq.copy(q).invert());
    const dx = Math.max(bb.min.x - local.x, 0, local.x - bb.max.x);
    const dy = Math.max(bb.min.y - local.y, 0, local.y - bb.max.y);
    const dz = Math.max(bb.min.z - local.z, 0, local.z - bb.max.z);
    return Math.hypot(dx, dy, dz);
  }
  function railHold(info) {
    const R = W.hold.rail;
    nOut.set(0, 0, 1).applyQuaternion(railQuat); // out of the wall
    let out = R.out;
    while (out > 0 && nearestOfBox(info, pinchP.copy(railPos).addScaledVector(nOut, out).addScaledVector(Y, R.lift), railQuat) < R.face) out -= 0.005;
    return { kind: 'rail', out: Math.max(0, out), lift: R.lift };
  }

  // Where the towel in hand hangs: the cheapest free place in front of the eye with all of it on the screen (the
  // comfortable distance first; a little lower, higher, to the side, farther, or nearer down to where it just fits);
  // then, unless the visitor stands right at the rail, the cheapest with enough of it on the screen; else at the rail.
  function placeHeld(info) {
    const H = W.hold;
    viewFrame();
    collectParts();
    const near = fitDistance(info);
    const fits = Math.min(near, screenFit(info));
    const turn = new THREE.Quaternion().setFromAxisAngle(Y, Math.atan2(-flat.x, -flat.z));
    const dists = H.further.map((k) => near * k);
    for (let i = 1; i <= H.nearer; i++) dists.push(near - ((near - fits) * i) / H.nearer);
    const cost = (d, sx, sy) => (d >= near ? (d / near - 1) * 2.2 : (1 - d / near) * 2.6) + Math.abs(sx) * 3 + (sy < 0 ? -sy * 1.6 : sy * 2.4);
    const steps = (lo, hi, s) => { const a = []; for (let i = lo; i <= hi; i++) a.push(i * s); return a; };
    function pick(screen, ys, xs, list = []) {
      if (!list.length) for (const d of dists) for (const sy of ys) for (const sx of xs) list.push({ d, sx, sy, c: cost(d, sx, sy) });
      list.sort((a, b) => a.c - b.c);
      for (const k of list) if (clearAt(info, pinchAt(info, k.d, k.sx, k.sy, pinchP), turn, screen)) return { kind: 'view', screen, d: k.d, sx: k.sx, sy: k.sy };
      return null;
    }
    // (only the parts in front of the eye and within reach of any of these places can be in the way)
    const far = dists[H.further.length - 1] + H.step * Math.max(H.side, H.lower) * 2 + info.hang + info.width;
    for (let i = parts.length - 1; i >= 0; i--) {
      const b = parts[i];
      const rel = tmp.copy(b.box.center).sub(camera.position);
      if (rel.length() > far + b.r || rel.dot(fwd) < -b.r) parts.splice(i, 1);
    }
    const whole = pick('whole', steps(-H.lower, H.higher, H.step), steps(-H.side, H.side, H.step));
    if (whole) return whole;
    // how far its middle hung from the eye on the rail
    const bb = boxOf(info);
    const onRail = tmp.set((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2).applyQuaternion(railQuat).add(railPos).distanceTo(camera.position);
    if (onRail > H.rail.near * fits) {
      const part = pick('part', steps(-2 * H.lower, H.higher, H.step), steps(-2 * H.side, 2 * H.side, H.step));
      if (part) return part;
    }
    // near the rail: nearer than it fits, its top fold a quarter of the screen below the top, lower or aside
    const C = H.close;
    const topOff = bb.max.y - sizeOf(info).mid; // its top above its middle
    const list = [];
    for (const d of C.dists) {
      if (d >= fits) continue;
      const want = 0.5 * d * tanV() - topOff;
      for (let i = -C.lower; i <= C.lower; i++) {
        for (let j = -C.side; j <= C.side; j++) list.push({ d, sx: j * H.step, sy: want + i * H.step, c: (1 - d / fits) * 2 + Math.abs(i * H.step) * 2 + Math.abs(j * H.step) * 2.5 });
      }
    }
    const close = list.length ? pick('close', null, null, list) : null;
    return close || railHold(info);
  }

  // The pinch's place and turn this frame (heldPos, heldQuat); returns how far in front of the eye its middle hangs.
  function heldPose(info) {
    if (!hold) hold = placeHeld(info);
    viewFrame();
    if (hold.kind === 'rail') {
      heldPos.copy(railPos).addScaledVector(nOut, hold.out).addScaledVector(Y, hold.lift);
      heldQuat.copy(railQuat);
    } else {
      pinchAt(info, hold.d / zoom, hold.sx / zoom, hold.sy / zoom, heldPos); // a pinch brings it nearer along its own line
      heldQuat.setFromAxisAngle(Y, Math.atan2(-flat.x, -flat.z)); // its room side (+z) toward the eye
    }
    const bb = boxOf(info);
    tmp.set((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2).applyQuaternion(heldQuat).add(heldPos);
    return tmp.sub(camera.position).dot(fwd);
  }
  // A pinch asks for zoom `want` (1 = where it was placed): back out always, nearer only as far as that place is clear
  // (the parts found as it was taken: nothing in the room moves while a towel is in hand), no part of it within
  // W.hold.near of the eye, and as much of it on the screen as where it was placed (whole stays whole: it never
  // outgrows the screen; tmp/wave3/look2.md 6)
  function zoomTo(info, want) {
    if (!hold || hold.kind !== 'view') return 1;
    if (want <= zoom) return want;
    viewFrame();
    const turn = new THREE.Quaternion().setFromAxisAngle(Y, Math.atan2(-flat.x, -flat.z));
    const ok = (z) => clearAt(info, pinchAt(info, hold.d / z, hold.sx / z, hold.sy / z, pinchP), turn, hold.screen);
    if (ok(want)) return want;
    let lo = zoom; let hi = want;
    for (let i = 0; i < 10; i++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
    return lo;
  }
  const qSwing = new THREE.Quaternion();
  const qBlend = new THREE.Quaternion();
  const eSwing = new THREE.Euler();
  function swung(q, k = 1) { // the held orientation turned by the swing (about the pinch point)
    eSwing.set(swing.phi * k, 0, swing.psi * k, 'XZY');
    return q.multiply(qSwing.setFromEuler(eSwing));
  }

  // ---- reading: the label's middle in front of the eye, facing it, upright
  const mRel = new THREE.Matrix4();
  const mDown = new THREE.Matrix4();
  const mTarget = new THREE.Matrix4();
  const readPos = new THREE.Vector3();
  const readQuat = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  const readAt = new THREE.Vector3(); // (asked every frame while the label is read: no new vector each time)
  function readPose(info) {
    camera.updateMatrixWorld();
    const tv = tanV();
    const th = tv * camera.aspect;
    const { w, h } = TOWEL_DIMS.label;
    const d = Math.max((h / 2) / tv / W.labelFill, (w / 2) / th / W.labelFillW, camera.near * 2.5);
    fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const mount = info.labelMount;
    mount.updateMatrix();
    // the label's middle in the towel's own frame (the hinge open: the label hanging straight down from the hem)
    mRel.copy(mount.matrix).multiply(mDown.makeTranslation(0, -h / 2, 0));
    mTarget.compose(readAt.copy(camera.position).addScaledVector(fwd, d), camera.quaternion, tmpS.set(1, 1, 1));
    mTarget.multiply(mRel.invert());
    mTarget.decompose(readPos, readQuat, tmpS);
    return d;
  }

  // ---- the ripple a shake sends down the cloth, and back to its rest shape
  let wave = null; // { t, amp }
  let snap = null; // { at, amp, dir }: a shake's snap still to come (the cloth swings out first, then pulls taut)
  function rippleTo(info, ms) {
    const g = info.mesh.geometry;
    const P = g.attributes.position;
    const rest = baseShape(info);
    if (!wave) return;
    const { length, speed, decayMs } = W.wave;
    const k = (2 * Math.PI) / length;
    const om = k * speed;
    const sec = ms / 1000;
    const fade = Math.exp(-ms / decayMs) * wave.amp;
    const sh = info.shape;
    for (let i = 0; i < P.count; i++) {
      const sAbs = Math.abs(sh.sTop[i]);
      const env = Math.min(1, Math.max(0, (sAbs - 0.03) / Math.max(0.05, info.hang)));
      const d = fade * env * Math.sin(k * sAbs - om * sec);
      P.array[i * 3] = rest[i * 3];
      P.array[i * 3 + 1] = rest[i * 3 + 1] + sh.nrm[i * 3 + 1] * d;
      P.array[i * 3 + 2] = rest[i * 3 + 2] + sh.nrm[i * 3 + 2] * d;
    }
    P.needsUpdate = true;
    refreshTowelNormals(info);
  }
  // ---- its shape: hung over the rung (mix 0) or held from the fingers (mix 1, fixtures/towels.js), blended while it
  // moves between them; the label's mount follows its hem
  let mix = 0;
  let blend = null; // the shape in between (one scratch array)
  function baseShape(info) {
    if (mix <= 0) return info.railPositions;
    if (mix >= 1) return info.heldPositions;
    const A = info.railPositions; const B = info.heldPositions;
    if (!blend || blend.length !== A.length) blend = new Float32Array(A.length);
    for (let i = 0; i < A.length; i++) blend[i] = A[i] + (B[i] - A[i]) * mix;
    return blend;
  }
  let blendC = null; // (its shade in between: the rail's folds or the fingers' fan)
  function restShape(info) { // its shape for the present mix, no ripple
    const g = info.mesh.geometry;
    g.attributes.position.array.set(baseShape(info));
    g.attributes.position.needsUpdate = true;
    if (mix > 0 && mix < 1) refreshTowelNormals(info);
    else { g.attributes.normal.array.set(mix <= 0 ? info.railNormals : info.heldNormals); g.attributes.normal.needsUpdate = true; }
    if (info.heldColours) {
      const A = info.railColours; const B = info.heldColours;
      if (mix > 0 && mix < 1) {
        if (!blendC || blendC.length !== A.length) blendC = new Float32Array(A.length);
        for (let i = 0; i < A.length; i++) blendC[i] = A[i] + (B[i] - A[i]) * mix;
      }
      g.attributes.color.array.set(mix <= 0 ? A : mix >= 1 ? B : blendC);
      g.attributes.color.needsUpdate = true;
    }
    info.labelMount.position.lerpVectors(info.labelRest.position, info.labelHeld.position, mix);
    info.labelMount.quaternion.slerpQuaternions(info.labelRest.quaternion, info.labelHeld.quaternion, mix);
  }
  function setMix(info, m) {
    const v = Math.min(1, Math.max(0, m));
    if (v === mix) return;
    mix = v;
    restShape(info);
  }

  // ---- a little lint shaken out of the pile: tiny specks lit by the room like the towel, drifting down
  let fluff = null;
  const fl = { t: 0, live: false, pos: null, vel: null, size: null };
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  function puff(info, dir) {
    const n = W.fluff.count;
    if (!fluff) {
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, transparent: true, depthWrite: false });
      mat.name = 'lint';
      fluff = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat, n);
      fluff.name = 'towels.lint';
      fluff.frustumCulled = false;
      fluff.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      fl.pos = new Float32Array(n * 3);
      fl.vel = new Float32Array(n * 3);
      fl.size = new Float32Array(n);
      scene.add(fluff);
    }
    const c = info.mesh.geometry.attributes.color;
    fluff.material.color.setRGB(c.getX(0), c.getY(0), c.getZ(0)).multiplyScalar(1.15);
    info.mesh.updateWorldMatrix(true, false);
    const P = info.mesh.geometry.attributes.position;
    const sh = info.shape;
    fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    let k = 0;
    for (let tries = 0; k < n && tries < n * 40; tries++) {
      const i = Math.floor(Math.random() * P.count);
      if (Math.abs(sh.sTop[i]) < info.hang * 0.45) continue; // from the lower half, where the cloth flaps
      _p.fromBufferAttribute(P, i).applyMatrix4(info.mesh.matrixWorld);
      fl.pos.set([_p.x, _p.y, _p.z], k * 3);
      fl.vel[k * 3] = (Math.random() - 0.5) * 0.3 + dir.x * 0.25 - fwd.x * 0.08;
      fl.vel[k * 3 + 1] = 0.08 + Math.random() * 0.22;
      fl.vel[k * 3 + 2] = (Math.random() - 0.5) * 0.3 + dir.z * 0.25 - fwd.z * 0.08;
      fl.size[k] = 0.0009 + Math.random() * 0.0012;
      k++;
    }
    fluff.count = k;
    fl.t = 0;
    fl.live = true;
    fluff.visible = true;
    stepFluff(0);
  }
  function stepFluff(dt) {
    if (!fl.live) return false;
    fl.t += dt;
    const s = dt / 1000;
    const drag = Math.exp(-2.6 * s);
    for (let k = 0; k < fluff.count; k++) {
      fl.vel[k * 3] *= drag;
      fl.vel[k * 3 + 1] = fl.vel[k * 3 + 1] * drag - 0.25 * s; // lint falls slowly
      fl.vel[k * 3 + 2] *= drag;
      for (let a = 0; a < 3; a++) fl.pos[k * 3 + a] += fl.vel[k * 3 + a] * s;
      _p.fromArray(fl.pos, k * 3);
      _m.compose(_p, _q.identity(), _s.setScalar(fl.size[k]));
      fluff.setMatrixAt(k, _m);
    }
    fluff.instanceMatrix.needsUpdate = true;
    const life = fl.t / W.fluff.lifeMs;
    fluff.material.opacity = 0.85 * (1 - Math.min(1, life)) ** 2;
    if (life >= 1) { fl.live = false; fluff.visible = false; }
    return fl.live;
  }

  // ---- the moves
  function setModal() {
    targets.length = 0;
    targets.push(active.mesh);
    interaction.setModal({
      targets,
      tap(hit, e) {
        if (e && e.type === 'escape') { hangBack(); return; }
        if (now() - takenAt < W.repeatMs) return; // the second half of the double-tap that took it
        if (state === 'reading' && hit) { closeLabel(); return; }
        hangBack();
      },
      holdAt: (hit) => !!hit && (state === 'held' || state === 'reading'),
      holdStart(hit) {
        if (!hit) return false;
        if (state === 'held') { openLabel(); return true; }
        if (state === 'reading') { closeLabel(); return true; }
        return false;
      },
      holdEnd() {}, // the label stays up when the finger lifts: nothing covers it while it is read
      pan: (dx, dy) => shake(dx, dy),
      zoom: (f) => { if (state === 'held' || state === 'taking') { zoom = zoomTo(active, Math.min(W.zoomMax, Math.max(1, zoom * f))); loop.wake(300); } },
    });
  }

  function take(kind) {
    if (state !== 'rail') return false;
    const info = towels.towels[kind];
    if (!info) return false;
    active = info;
    info.pivot.getWorldPosition(railPos);
    info.pivot.getWorldQuaternion(railQuat);
    scene.attach(info.pivot);
    mix = 0; // (it leaves the rung in its rail shape; update() blends it to the held one as it comes up)
    zoom = 1;
    read = 0;
    readTarget = 0;
    hold = placeHeld(info); // (off the rail first: the other towel is in the way, this one is not)
    swing.phi = 0; swing.psi = 0;
    // its foot trails behind as it comes up; lifted at the rail, it swings out into the room, never into the rungs
    swing.phiV = hold.kind === 'rail' ? -0.5 * W.takeKick : W.takeKick;
    swing.psiV = 0.25 * W.takeKick;
    state = 'taking';
    t = 0;
    takenAt = now();
    setModal();
    try { history.pushState({ bathTowel: true }, ''); armed = true; } catch { armed = false; }
    play('towel_rustle', { volume: 0.55 });
    found('towelTake');
    loop.wake(W.liftMs + 400);
    return true;
  }

  function hangBack() {
    if (!active || state === 'hanging' || state === 'rail') return false;
    fromPos.copy(active.pivot.position);
    fromQuat.copy(active.pivot.quaternion);
    state = 'hanging';
    t = 0;
    readTarget = 0;
    snap = null; // a snap still to come stays away: the towel goes back as it is
    interaction.setModal(null);
    if (armed) { armed = false; try { history.back(); } catch { /* no history here */ } }
    play('towel_rustle', { volume: 0.35, rate: 1.1 });
    loop.wake(W.hangMs + 300);
    return true;
  }

  function landed() {
    const info = active;
    towels.group.attach(info.pivot);
    info.pivot.position.copy(info.rest.position);
    info.pivot.quaternion.copy(info.rest.quaternion);
    wave = null;
    mix = 0;
    restShape(info); // exactly its rail shape again
    setJoint(info.labelPivot, info.labelPivot.userData.joint.min);
    info.label.visible = false;
    labelLight(0);
    active = null;
    hold = null;
    state = 'rail';
    play('towel_fump', { volume: 0.7 });
  }

  function openLabel() {
    if (state !== 'held') return false;
    printLabel();
    state = 'reading';
    readTarget = 1;
    active.label.visible = true;
    if (!targets.includes(active.label)) targets.push(active.label);
    wave = null;
    snap = null;
    restShape(active);
    play('towel_rustle', { volume: 0.45, rate: 1.25 });
    found('towelLabel');
    loop.wake(W.labelMs + 300);
    return true;
  }
  function closeLabel() {
    if (state !== 'reading') return false;
    state = 'held';
    readTarget = 0;
    play('towel_rustle', { volume: 0.3, rate: 1.3 });
    loop.wake(W.labelMs + 300);
    return true;
  }

  // a drag while it is held: the cloth swings with the finger; a sharp one shakes it out: the flap's whoosh as it swings
  // out, and at the sound's snap (W.snapMs) the cloth pulls taut: a ripple runs down it and a little lint flies
  function shake(dx, dy) {
    if (state !== 'held' && state !== 'taking') return false;
    const cx = Math.max(-80, Math.min(80, dx || 0));
    const cy = Math.max(-80, Math.min(80, dy || 0));
    swing.psiV += cx * W.kick;
    swing.phiV -= cy * W.kick;
    const speed = Math.max(Math.abs(swing.psiV), Math.abs(swing.phiV));
    if (speed >= W.flapSpeed && now() - lastFlap >= W.flapGapMs) {
      lastFlap = now();
      play('towel_flap', { volume: Math.min(1, 0.45 + 0.12 * speed) });
      const dir = new THREE.Vector3(1, 0, 0).applyQuaternion(active.pivot.quaternion).multiplyScalar(Math.sign(cx || 1));
      snap = { at: now() + W.snapMs, amp: Math.min(0.035, 0.008 * speed), dir };
      found('towelShake');
      loop.wake(W.snapMs + 600);
    }
    loop.wake(600);
    return true;
  }

  // ---- every frame while a towel is off the rail
  const pose = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  function stepSwing(info, dt) {
    const s = Math.min(0.064, dt / 1000);
    const g = W.gravity / Math.max(0.1, (2 / 3) * info.hang);
    const n = Math.max(1, Math.ceil(s / 0.008));
    const h = s / n;
    const damp = state === 'reading' ? 9 : W.damping;
    const back = Math.asin(Math.min(1, W.hold.rail.swing / Math.max(0.1, info.hang)));
    for (let i = 0; i < n; i++) {
      swing.phiV += (-g * Math.sin(swing.phi) - damp * swing.phiV) * h;
      swing.psiV += (-g * Math.sin(swing.psi) - damp * swing.psiV) * h;
      swing.phi += swing.phiV * h;
      swing.psi += swing.psiV * h;
      if (Math.abs(swing.phi) > W.maxPitch) { swing.phi = Math.sign(swing.phi) * W.maxPitch; swing.phiV *= -0.3; }
      if (Math.abs(swing.psi) > W.maxRoll) { swing.psi = Math.sign(swing.psi) * W.maxRoll; swing.psiV *= -0.3; }
      // held at the rail its hem swings into the room freely, toward the rungs only a little (+phi is toward the wall)
      if (hold && hold.kind === 'rail' && swing.phi > back) { swing.phi = back; swing.phiV = -0.3 * Math.abs(swing.phiV); }
    }
    const w = Math.sqrt(g);
    const energy = Math.abs(swing.phi) + Math.abs(swing.psi) + (Math.abs(swing.phiV) + Math.abs(swing.psiV)) / w;
    if (energy < 0.002) { swing.phi = swing.psi = swing.phiV = swing.psiV = 0; return false; }
    return true;
  }
  function update(dt) {
    let busy = stepFluff(fl.live ? dt : 0);
    if (!active) return busy;
    const info = active;
    const moving = state === 'taking' || state === 'hanging';
    if (moving) t = Math.min(1, t + dt / (state === 'taking' ? W.liftMs : W.hangMs));
    // its shape: from the rung's to the fingers' as it comes up, back as it is hung (before any ripple is laid on)
    setMix(info, state === 'taking' ? ease(t) : state === 'hanging' ? 1 - ease(t) : 1);
    // the label: up toward the eye or back into the hem
    const was = read;
    if (read !== readTarget) {
      const step = dt / W.labelMs;
      read = readTarget > read ? Math.min(readTarget, read + step) : Math.max(readTarget, read - step);
    }
    const k = ease(read);
    if (read !== was || read > 0) {
      const j = info.labelPivot.userData.joint;
      setJoint(info.labelPivot, j.min + (j.max - j.min) * k); // out toward the eye as it comes up
      labelLight(k);
    }
    if (read === 0 && was > 0) { // folded back in
      info.label.visible = false;
      const i = targets.indexOf(info.label);
      if (i >= 0) targets.splice(i, 1);
    }
    const swinging = stepSwing(info, dt);
    if (state === 'hanging') {
      const e = ease(t);
      pose.lerpVectors(fromPos, railPos, e);
      pose.y += Math.sin(Math.PI * e) * 0.05;
      quat.slerpQuaternions(fromQuat, railQuat, e);
      info.pivot.position.copy(pose);
      info.pivot.quaternion.copy(quat);
      if (t >= 1) { landed(); return true; }
      return true;
    }
    heldPose(info);
    swung(quat.copy(heldQuat), 1);
    pose.copy(heldPos);
    if (state === 'taking') {
      const e = ease(t);
      pose.lerpVectors(railPos, heldPos, e);
      pose.y += Math.sin(Math.PI * e) * 0.06;
      quat.slerpQuaternions(railQuat, swung(qBlend.copy(heldQuat), e), e);
      if (t >= 1) state = 'held';
    }
    if (read > 0) {
      readPose(info);
      pose.lerp(readPos, k);
      quat.slerp(readQuat, k);
    }
    info.pivot.position.copy(pose);
    info.pivot.quaternion.copy(quat);
    // a shake's snap: the cloth pulls taut, a ripple runs down it from the fingers and lint flies
    if (snap && now() >= snap.at) {
      if (state === 'held' || state === 'taking') { wave = { t: 0, amp: snap.amp }; puff(info, snap.dir); }
      snap = null;
    }
    // the ripple of a shake
    const rippling = !!wave;
    if (wave) {
      wave.t += dt;
      if (wave.t >= W.wave.ms) { wave = null; restShape(info); } else rippleTo(info, wave.t);
    }
    // once it hangs still in front of the eye nothing needs drawing again (the loop sleeps until the next touch)
    return busy || state === 'taking' || read !== readTarget || (read > 0 && read < 1) || swinging || rippling || !!snap;
  }
  loop.add(update);

  // the phone's Back hangs it back
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('popstate', () => { if (armed) { armed = false; hangBack(); } });
  }

  // ---- touches on the towels on the rail: take it
  for (const kind of ['bath', 'hand']) {
    if (!towels.towels[kind]) continue;
    reg(towels.parts[kind], { tap: () => take(kind) });
  }

  // ---- the rolled towels in the basket: a finger presses one, it gives and comes back
  if (rolls && rolls.parts && rolls.parts.rolls) {
    const m = rolls.parts.rolls;
    const P = m.geometry.attributes.position;
    const rest = P.array.slice();
    let squash = null; // { roll, t }
    const rollAt = (hit) => {
      const f = hit && Number.isInteger(hit.faceIndex) ? hit.faceIndex : -1;
      const v = f >= 0 && m.geometry.index ? m.geometry.index.getX(f * 3) : -1;
      return rolls.rolls.find((r) => v >= r.start && v < r.start + r.count) || rolls.rolls[0];
    };
    // pressed, a roll gives toward where it rests (its underside stays put) and spreads a little across its axis
    const press = (r, k) => {
      const [cx, , cz] = r.centre;
      const [ax, , az] = r.axis; // a lying roll's axis is level: only what is across it spreads
      for (let i = r.start; i < r.start + r.count; i++) {
        const x = rest[i * 3]; const y = rest[i * 3 + 1]; const z = rest[i * 3 + 2];
        const along = (x - cx) * ax + (z - cz) * az;
        const ox = x - cx - along * ax;
        const oz = z - cz - along * az;
        P.array[i * 3] = cx + along * ax + ox * (1 + 0.03 * k);
        P.array[i * 3 + 1] = r.base + (y - r.base) * (1 - 0.06 * k);
        P.array[i * 3 + 2] = cz + along * az + oz * (1 + 0.03 * k);
      }
      P.needsUpdate = true;
    };
    reg(m, {
      tap(hit) {
        const r = rollAt(hit);
        if (squash) press(squash.roll, 0);
        squash = { roll: r, t: 0 };
        play('towel_fump', { volume: 0.35, rate: 1.2 });
        loop.wake(500);
      },
      repeat: true,
    });
    loop.add((dt) => {
      if (!squash) return false;
      squash.t += dt;
      const p = Math.min(1, squash.t / 320);
      press(squash.roll, Math.sin(Math.PI * p) * (1 - 0.3 * p));
      if (p >= 1) { press(squash.roll, 0); squash = null; return false; }
      return true;
    });
  }

  // (a literal with live getters: Object.assign would copy each getter's value once)
  return {
    towels, rolls, take, hangBack, shake, openLabel, closeLabel,
    get held() { return active ? active.kind : null; },
    get state() { return state; },
    get swing() { return { ...swing }; },
    get read() { return read; },
    get lint() { return fluff; },
    get rippling() { return !!wave; },
    get place() { return hold ? { ...hold, zoom } : null; }, // where the towel in hand hangs ('view' or 'rail')
    heldDistance: () => (active ? heldPose(active) : 0), // its middle's distance in front of the eye, along the view
    readDistance: () => (active ? readPose(active) : 0),
  };
}
