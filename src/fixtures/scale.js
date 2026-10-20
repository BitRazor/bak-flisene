// The bathroom scale: the room's price feeling (research/inventory-dry.md section 26; docs/CONCEPT.md section 7.2). A
// modern analogue scale, 30 x 30 cm and 4.5 cm high: a white body on four small feet, two grey ribbed pads to stand on,
// and a round dial window toward the room whose needle settles between "Enkelt" and "Påkostet" by the visitor's
// choices (scene/scaleWiring.js) - a feeling without numbers, never kroner.
// Placement: LAYOUT.scale (its footprint's centre on the floor and a slight turn), half under the floating vanity's
// front edge, the dial on the half out in the room. The floor falls to the drain (data/floor.js): the scale rests on
// its four feet and tilts with the floor under them (a fraction of a degree), so each foot touches it.
// Local frame: x across, y up, z toward the room (the dial's side). The dial reads upright for a visitor in front of
// it: its 12 o'clock points away from them (-z), "Enkelt" lies on their left, "Påkostet" on their right.
// Two draw calls: the body (the room's white plastic) and the dial (one mesh with its own canvas texture: the face,
// the needle, its hub and the ribs, which take their colours from patches in the canvas's corners). The needle is part
// of that mesh: its six vertices follow needlePivot (syncNeedle), so the needle costs no draw call of its own.
//
// createScale(ctx, { x, z, yaw })   (defaults: LAYOUT.scale)
// parts: body, dial (userData.needle = { start, count, tip }: the needle's vertices, tip and tip + 1 at its point;
//   userData.faceRadius), needlePivot (joint: hinge about the dial's axis, [0, -1, 0]; value = the needle's angle in
//   radians, clockwise from 12 o'clock as the reader sees it, from SCALE_DIAL.rest (its pin) to SCALE_DIAL.stop).
// anchors: foot0..foot3 (the bottom of each foot), dial (the centre of the dial face).
// methods: setNeedle(angle) (the joint and the needle's vertices; returns the angle, held between the pin and the
//   stop), syncNeedle() (the needle's vertices to the joint's angle; returns whether they moved).
import * as THREE from 'three';
import { mesh, pivot, anchor, roundedRectShape, flatExtrude, mergeGeometries, seg, setJoint } from './util.js';
import { floorHeight } from '../data/floor.js';
import { fixedLine, paintLines, canvasMeasure, INK } from '../systems/paper.js';

const DEG = Math.PI / 180;

export const SCALE_DIMS = {
  w: 0.3, // across (x)
  d: 0.3, // front to back (z)
  corner: 0.05,
  feet: { r: 0.011, h: 0.005, at: 0.115 }, // four round feet, their centres 11.5 cm out from the middle each way
  base: { y0: 0.005, y1: 0.013, inset: 0.006 }, // the base under the platform, set in: a shadow line under its edge
  top: { y0: 0.012, y1: 0.0435, bevel: 0.006 }, // the platform with its rounded edges
  window: { z: 0.07, r: 0.062 }, // the dial window: its centre toward the room, its radius where the wall is straight
  faceDepth: 0.009, // the dial face lies this far under the platform's top
  needleLift: 0.0012, // the needle over the face; its hub a little higher
  ribs: { n: 7, w: 0.003, h: 0.0016, len: 0.11, z: -0.075, x0: 0.042, pitch: 0.0125 }, // two pads of seven ribs
};

// The dial, in radians clockwise from 12 o'clock as the visitor reads it, and in face radii. The needle rests on its pin
// a little before "Enkelt", the scale runs from "Enkelt" (a0, the room's cheapest bathroom) to "Påkostet" (a1, its
// dearest), and a stop a little past it holds a needle that swings too far.
export const SCALE_DIAL = {
  rest: -125 * DEG,
  a0: -110 * DEG,
  a1: 110 * DEG,
  stop: 110 * DEG + 0.25,
  canvas: 512, // px a side; the round face fills it, the corners hold the colour patches
  needle: { len: 0.86, base: 0.035, tip: 0.006, tail: 0.14, tailW: 0.022, hub: 0.068 },
  ticks: { n: 20, major: 5 }, // a tick every twentieth of the scale, a long one every quarter
};

// Where the needle points for a price feeling t (0 = the cheapest bathroom the room offers, 1 = the dearest).
export function needleAngle(t) {
  const k = Math.min(1, Math.max(0, t));
  return SCALE_DIAL.a0 + k * (SCALE_DIAL.a1 - SCALE_DIAL.a0);
}

// The words on the dial (research/inventory-dry.md 26.1 and 26.4: "Enkelt" on the left, "Påkostet" on the right, a small
// "Ditt bad" at the pivot), in face radii from the centre (cx across, base = the baseline, up positive), below the
// scale's arc where the needle never reaches (tests/scale.test.js checks every place it can stand).
export const DIAL_WORDS = [
  { text: 'Enkelt', cx: -0.35, base: -0.62, size: 0.13, weight: 650, tag: 'left' },
  { text: 'Påkostet', cx: 0.35, base: -0.62, size: 0.13, weight: 650, tag: 'right' },
  { text: 'Ditt bad', cx: 0, base: -0.4, size: 0.095, weight: 600, tag: 'pivot' },
];

// The dial's words laid out on its canvas (px, y down): { size, radius, lines } (lines as systems/paper.js lays them).
export function dialLayout(measure, size = SCALE_DIAL.canvas) {
  const R = size / 2;
  const lines = DIAL_WORDS.map((w) => fixedLine(w.text, {
    x: R + (w.cx - 0.5) * R, y: R - w.base * R, w: R, size: w.size * R, weight: w.weight, color: INK, align: 'center', tag: w.tag,
  }, measure));
  return { size, radius: R, lines };
}

// Points along the needle standing at `angle`, from its tail to its tip, on the dial's canvas (px, y down), each with the
// needle's half-width there: { x, y, hw }.
export function needleSamples(angle, size = SCALE_DIAL.canvas, step = 1) {
  const N = SCALE_DIAL.needle;
  const R = size / 2;
  const sx = Math.sin(angle);
  const sy = -Math.cos(angle);
  const out = [];
  const u0 = -N.tail * R;
  const u1 = N.len * R;
  const hubR = N.hub * R;
  for (let u = u0; u <= u1 + 1e-9; u += step) {
    const hw = (u < 0 ? N.base + (N.tailW - N.base) * (u / u0) : N.base + (N.tip - N.base) * (u / u1)) * R;
    const overHub = Math.abs(u) < hubR ? Math.sqrt(hubR * hubR - u * u) : 0; // the round hub over the needle's root
    out.push({ x: R + sx * u, y: R + sy * u, hw: Math.max(hw, overHub) });
  }
  return out;
}

const FACE = '#f6f4ef';
// colour patches in the canvas's corners, outside the round face: the needle (the room's signal red, as the lock's
// "Opptatt" disc), its hub (Straume's charcoal) and the rubber ribs
const PATCH = { needle: [28, 28, '#b3261e'], hub: [484, 28, '#3f4042'], rubber: [28, 484, '#8c9094'] };
const PATCH_HALF = 26;
const patchUV = (k) => [PATCH[k][0] / 512, 1 - PATCH[k][1] / 512];

// Draws the dial: the face, a soft shade at its rim, the wedge that grows from "Enkelt" to "Påkostet" (more is
// thicker: readable without the words), the ticks, the needle's pin, the words, and the colour patches.
export function drawDial(g, size = SCALE_DIAL.canvas, measure = canvasMeasure(g)) {
  const R = size / 2;
  const s = size / 512;
  const at = (a, r) => [R + Math.sin(a) * r * R, R - Math.cos(a) * r * R];
  g.clearRect(0, 0, size, size);
  g.fillStyle = FACE;
  g.fillRect(0, 0, size, size);
  const rim = g.createRadialGradient(R, R, R * 0.84, R, R, R);
  rim.addColorStop(0, 'rgba(70,62,50,0)');
  rim.addColorStop(1, 'rgba(70,62,50,0.3)');
  g.fillStyle = rim;
  g.beginPath();
  g.arc(R, R, R, 0, Math.PI * 2);
  g.fill();
  // the wedge
  const steps = 64;
  g.fillStyle = 'rgba(63,64,66,0.85)';
  g.beginPath();
  for (let k = 0; k <= steps; k++) { const [x, y] = at(needleAngle(k / steps), 0.755); if (k) g.lineTo(x, y); else g.moveTo(x, y); }
  for (let k = steps; k >= 0; k--) { const t = k / steps; const [x, y] = at(needleAngle(t), 0.755 - 0.012 - 0.07 * t); g.lineTo(x, y); }
  g.closePath();
  g.fill();
  // the ticks
  const T = SCALE_DIAL.ticks;
  g.strokeStyle = INK;
  g.lineCap = 'butt';
  for (let k = 0; k <= T.n; k++) {
    const major = k % T.major === 0;
    const a = needleAngle(k / T.n);
    const [x0, y0] = at(a, major ? 0.78 : 0.8);
    const [x1, y1] = at(a, major ? 0.9 : 0.87);
    g.lineWidth = (major ? 0.02 : 0.011) * R;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }
  // the pin the needle rests on
  const [px, py] = at(SCALE_DIAL.rest, 0.86);
  g.fillStyle = INK;
  g.beginPath();
  g.arc(px, py, 0.026 * R, 0, Math.PI * 2);
  g.fill();
  paintLines(g, dialLayout(measure, size).lines);
  for (const [x, y, c] of Object.values(PATCH)) {
    g.fillStyle = c;
    g.fillRect((x - PATCH_HALF) * s, (y - PATCH_HALF) * s, 2 * PATCH_HALF * s, 2 * PATCH_HALF * s);
  }
}

// a geometry's UVs all on one colour patch of the dial's canvas
function onPatch(geo, k) {
  const [u, v] = patchUV(k);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
  return geo;
}

// The needle at angle 0 (pointing to 12 o'clock, -z), about its hub, in metres: [x, z] for its six vertices: the
// tail's end, the hub, the tip (left and right of each).
function needleRest(Rf) {
  const N = SCALE_DIAL.needle;
  return [
    [-N.tailW * Rf, N.tail * Rf], [N.tailW * Rf, N.tail * Rf],
    [-N.base * Rf, 0], [N.base * Rf, 0],
    [-N.tip * Rf, -N.len * Rf], [N.tip * Rf, -N.len * Rf],
  ];
}

export function createScale(ctx, opts = {}) {
  const L = ctx.layout;
  const P = { ...L.scale, ...opts };
  const D = SCALE_DIMS;
  const group = new THREE.Group();
  group.name = 'scale';
  const parts = {};
  const anchors = {};

  // --- on the falling floor: the plane through the floor under the four feet (the floor is a gentle cone round the
  // drain: over the 23 cm between the feet it is a plane to within a tenth of a millimetre)
  const yaw = P.yaw || 0;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const a = D.feet.at;
  const under = (fx, fz) => floorHeight(L, P.x + fx * cy + fz * sy, P.z - fx * sy + fz * cy);
  const hBL = under(-a, -a);
  const hBR = under(a, -a);
  const hFL = under(-a, a);
  const hFR = under(a, a);
  const slopeX = (hBR + hFR - hBL - hFL) / (4 * a);
  const slopeZ = (hFL + hFR - hBL - hBR) / (4 * a);
  group.position.set(P.x, (hBL + hBR + hFL + hFR) / 4, P.z);
  group.rotation.set(-Math.atan(slopeZ), yaw, Math.atan(slopeX), 'YXZ');

  // --- the body: the base, the platform with its round window, the feet (one mesh, the room's white plastic)
  const body = [];
  const bi = D.base.inset;
  body.push(flatExtrude(roundedRectShape(D.w - 2 * bi, D.d - 2 * bi, D.corner - bi), D.base.y1 - D.base.y0, 0.0015, seg(ctx, 8), 1).translate(0, D.base.y0, 0));
  const top = roundedRectShape(D.w, D.d, D.corner);
  const hole = new THREE.Path();
  hole.absarc(0, D.window.z, D.window.r, 0, Math.PI * 2, true);
  top.holes.push(hole);
  body.push(flatExtrude(top, D.top.y1 - D.top.y0, D.top.bevel, seg(ctx, 14), 3).translate(0, D.top.y0, 0));
  const feet = [[-a, -a], [a, -a], [-a, a], [a, a]];
  for (const [fx, fz] of feet) body.push(new THREE.CylinderGeometry(D.feet.r * 0.9, D.feet.r, D.feet.h, seg(ctx, 14)).translate(fx, D.feet.h / 2, fz));
  parts.body = mesh(ctx, mergeGeometries(body), 'plasticWhite', 'scale.body');
  for (const g of body) g.dispose();
  group.add(parts.body);
  feet.forEach(([fx, fz], i) => { anchors[`foot${i}`] = anchor(`foot${i}`, group, fx, 0, fz); });

  // --- the dial: the face, the needle, its hub and the ribs (one mesh with its own canvas texture)
  const faceY = D.top.y1 - D.faceDepth;
  const Rf = D.window.r + 0.0005; // a little under the window's wall, so no gap shows at its edge
  const hub = new THREE.Vector3(0, faceY + D.needleLift, D.window.z);
  const pieces = [];
  pieces.push(new THREE.CircleGeometry(Rf, seg(ctx, 48)).rotateX(-Math.PI / 2).translate(0, faceY, D.window.z));
  const rest = needleRest(Rf);
  const needle = new THREE.BufferGeometry();
  needle.setAttribute('position', new THREE.Float32BufferAttribute(rest.flatMap(([x, z]) => [hub.x + x, hub.y, hub.z + z]), 3));
  needle.setAttribute('normal', new THREE.Float32BufferAttribute(rest.flatMap(() => [0, 1, 0]), 3));
  needle.setAttribute('uv', new THREE.Float32BufferAttribute(rest.flatMap(() => [0, 0]), 2));
  needle.setIndex([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4]); // counter-clockwise seen from above: they face up
  pieces.push(onPatch(needle, 'needle'));
  pieces.push(onPatch(new THREE.CircleGeometry(SCALE_DIAL.needle.hub * Rf, seg(ctx, 14)).rotateX(-Math.PI / 2).translate(hub.x, faceY + 0.002, hub.z), 'hub'));
  const Rb = D.ribs;
  for (const side of [-1, 1]) {
    for (let k = 0; k < Rb.n; k++) {
      const rib = new THREE.BoxGeometry(Rb.w, Rb.h, Rb.len).translate(side * (Rb.x0 + k * Rb.pitch), D.top.y1 + Rb.h / 2 - 0.0003, Rb.z);
      pieces.push(onPatch(rib, 'rubber'));
    }
  }
  const start = pieces[0].attributes.position.count;
  const geo = mergeGeometries(pieces);
  for (const g of pieces) g.dispose();
  geo.attributes.position.setUsage(THREE.DynamicDrawUsage);
  const dialMat = new THREE.MeshStandardMaterial({ color: 0xf6f4ef, roughness: 0.32, metalness: 0 });
  dialMat.name = 'decal:scaleDial';
  parts.dial = mesh(ctx, geo, dialMat, 'scale.dial');
  parts.dial.castShadow = false;
  parts.dial.userData.needle = { start, count: 6, tip: start + 4 };
  parts.dial.userData.faceRadius = Rf;
  group.add(parts.dial);
  anchors.dial = anchor('dial', group, 0, faceY, D.window.z);
  if (typeof document !== 'undefined' && document.createElement) {
    const size = SCALE_DIAL.canvas;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const paint = () => { drawDial(canvas.getContext('2d'), size); tex.needsUpdate = true; };
    paint();
    // the room's font may arrive after the scale is built: the words are printed again once it has
    const fonts = document.fonts;
    if (fonts && fonts.check && fonts.load && !fonts.check("650 40px 'Exhibit Sans'")) {
      fonts.load("650 40px 'Exhibit Sans'").then((got) => { if (got && got.length) paint(); }).catch(() => {});
    }
    dialMat.map = tex;
    dialMat.color.set(0xffffff);
    dialMat.needsUpdate = true;
  }

  // --- the needle's hinge; the needle's vertices follow it
  parts.needlePivot = pivot('needlePivot', hub.x, hub.y, hub.z, { type: 'hinge', axis: [0, -1, 0], min: SCALE_DIAL.rest, max: SCALE_DIAL.stop });
  group.add(parts.needlePivot);
  let synced = 0; // the needle's vertices were made pointing at 12 o'clock
  function syncNeedle() {
    const ang = parts.needlePivot.userData.joint.value;
    if (ang === synced) return false;
    synced = ang;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const pos = geo.attributes.position;
    // turned clockwise (seen from above, 12 o'clock = -z) about the hub
    for (let k = 0; k < rest.length; k++) {
      const [x, z] = rest[k];
      pos.setXYZ(start + k, hub.x + x * c - z * s, hub.y, hub.z + x * s + z * c);
    }
    pos.needsUpdate = true;
    return true;
  }
  function setNeedle(ang) {
    const v = setJoint(parts.needlePivot, ang);
    syncNeedle();
    return v;
  }
  setNeedle(SCALE_DIAL.rest); // nobody on it

  return { group, parts, anchors, setNeedle, syncNeedle };
}
