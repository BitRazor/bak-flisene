// A single-stroke "fingertip" hand for writing in fog: each glyph is the path a finger takes, not an outline.
// Pure: no DOM, no three.js. Units: em, baseline at 0, x-height 0.5, capitals 0.74, ascenders 0.78, descenders -0.27.
//
// Path language (one string = one pen-down stroke):
//   M x y              start the stroke here
//   L x y              straight line to
//   Q cx cy x y        quadratic curve to
//   C ax ay bx by x y  cubic curve to
//   E cx cy rx ry a0 a1  elliptical arc from angle a0 to a1 (degrees, counter-clockwise when a1 > a0)

import { createRng } from './rng.js';

const A_LOWER = 'E 0.2 0.25 0.18 0.25 25 385 L 0.385 0.5 L 0.385 0.03 Q 0.39 0 0.43 0.01';
const O_LOWER = 'E 0.22 0.25 0.19 0.25 100 465';
const O_UPPER = 'E 0.32 0.37 0.29 0.37 100 465';
const A_UPPER = ['M 0.02 0 L 0.26 0.74 L 0.5 0', 'M 0.1 0.25 L 0.42 0.25'];

const GLYPHS = {
  a: { adv: 0.5, s: [A_LOWER] },
  b: { adv: 0.5, s: ['M 0.06 0.78 L 0.06 0 L 0.06 0.25 E 0.25 0.25 0.19 0.25 180 -165'] },
  c: { adv: 0.44, s: ['E 0.22 0.25 0.19 0.25 40 315'] },
  d: { adv: 0.5, s: ['E 0.2 0.25 0.18 0.25 25 385 L 0.385 0.78 L 0.385 0.03 Q 0.39 0 0.43 0.01'] },
  e: { adv: 0.46, s: ['M 0.04 0.26 L 0.4 0.26 E 0.22 0.25 0.18 0.25 5 320'] },
  f: { adv: 0.34, s: ['M 0.34 0.72 Q 0.28 0.79 0.2 0.76 Q 0.14 0.72 0.14 0.6 L 0.14 0', 'M 0.02 0.47 L 0.3 0.47'] },
  g: { adv: 0.48, s: ['E 0.2 0.25 0.18 0.25 25 385 L 0.385 0.5 L 0.385 -0.1 Q 0.38 -0.27 0.2 -0.27 Q 0.08 -0.27 0.04 -0.18'] },
  h: { adv: 0.46, s: ['M 0.06 0.78 L 0.06 0 L 0.06 0.3 Q 0.1 0.5 0.24 0.5 Q 0.38 0.5 0.38 0.32 L 0.38 0'] },
  i: { adv: 0.2, s: ['M 0.08 0.5 L 0.08 0', 'M 0.08 0.66 L 0.082 0.668'] },
  j: { adv: 0.26, s: ['M 0.16 0.5 L 0.16 -0.15 Q 0.15 -0.27 0.06 -0.27 Q 0 -0.27 -0.03 -0.22', 'M 0.16 0.66 L 0.162 0.668'] },
  k: { adv: 0.42, s: ['M 0.06 0.78 L 0.06 0', 'M 0.36 0.5 L 0.07 0.2 L 0.38 0'] },
  l: { adv: 0.2, s: ['M 0.08 0.78 L 0.08 0.06 Q 0.09 0 0.14 0'] },
  m: { adv: 0.62, s: ['M 0.06 0.5 L 0.06 0 L 0.06 0.32 Q 0.1 0.5 0.2 0.5 Q 0.3 0.5 0.3 0.34 L 0.3 0 L 0.3 0.34 Q 0.33 0.5 0.44 0.5 Q 0.54 0.5 0.54 0.34 L 0.54 0'] },
  n: { adv: 0.46, s: ['M 0.06 0.5 L 0.06 0 L 0.06 0.3 Q 0.1 0.5 0.24 0.5 Q 0.38 0.5 0.38 0.32 L 0.38 0'] },
  o: { adv: 0.46, s: [O_LOWER] },
  p: { adv: 0.48, s: ['M 0.06 0.5 L 0.06 -0.27 L 0.06 0.3 E 0.25 0.25 0.19 0.25 165 -170'] },
  q: { adv: 0.5, s: ['E 0.2 0.25 0.18 0.25 25 385 L 0.385 0.5 L 0.385 -0.27 Q 0.39 -0.2 0.45 -0.17'] },
  r: { adv: 0.34, s: ['M 0.06 0.5 L 0.06 0 L 0.06 0.28 Q 0.12 0.5 0.32 0.48'] },
  s: { adv: 0.4, s: ['M 0.34 0.44 Q 0.28 0.51 0.19 0.5 Q 0.05 0.49 0.06 0.38 Q 0.07 0.29 0.2 0.26 Q 0.36 0.22 0.35 0.11 Q 0.33 0 0.18 0 Q 0.07 0 0.03 0.07'] },
  t: { adv: 0.34, s: ['M 0.14 0.68 L 0.14 0.08 Q 0.15 0 0.24 0 Q 0.29 0 0.31 0.03', 'M 0.02 0.48 L 0.3 0.48'] },
  u: { adv: 0.46, s: ['M 0.06 0.5 L 0.06 0.18 Q 0.07 0 0.22 0 Q 0.36 0 0.38 0.2 L 0.38 0.5 L 0.38 0'] },
  v: { adv: 0.42, s: ['M 0.02 0.5 L 0.2 0 L 0.38 0.5'] },
  w: { adv: 0.58, s: ['M 0.02 0.5 L 0.15 0 L 0.28 0.36 L 0.41 0 L 0.54 0.5'] },
  x: { adv: 0.42, s: ['M 0.04 0.5 L 0.36 0', 'M 0.36 0.5 L 0.04 0'] },
  y: { adv: 0.42, s: ['M 0.04 0.5 L 0.21 0.04', 'M 0.38 0.5 L 0.16 -0.18 Q 0.11 -0.28 0.02 -0.26'] },
  z: { adv: 0.42, s: ['M 0.04 0.5 L 0.36 0.5 L 0.04 0 L 0.38 0'] },
  æ: { adv: 0.78, s: ['E 0.2 0.25 0.18 0.25 25 385 L 0.385 0.5 L 0.385 0.03', 'M 0.385 0.26 L 0.72 0.26 E 0.55 0.25 0.17 0.25 5 320'] },
  ø: { adv: 0.46, s: [O_LOWER, 'M 0.42 0.55 L 0.02 -0.05'] },
  å: { adv: 0.5, s: [A_LOWER, 'E 0.21 0.67 0.065 0.065 90 450'] },

  A: { adv: 0.56, s: A_UPPER },
  B: { adv: 0.52, s: ['M 0.06 0 L 0.06 0.74 Q 0.4 0.76 0.4 0.56 Q 0.4 0.39 0.08 0.39 Q 0.46 0.39 0.45 0.18 Q 0.44 0 0.06 0'] },
  C: { adv: 0.6, s: ['E 0.32 0.37 0.28 0.37 50 310'] },
  D: { adv: 0.6, s: ['M 0.06 0 L 0.06 0.74 Q 0.52 0.74 0.52 0.37 Q 0.52 0 0.06 0'] },
  E: { adv: 0.5, s: ['M 0.42 0.74 L 0.06 0.74 L 0.06 0 L 0.44 0', 'M 0.06 0.38 L 0.36 0.38'] },
  F: { adv: 0.46, s: ['M 0.42 0.74 L 0.06 0.74 L 0.06 0', 'M 0.06 0.38 L 0.34 0.38'] },
  G: { adv: 0.66, s: ['E 0.32 0.37 0.28 0.37 50 345 L 0.6 0.34 L 0.4 0.34'] },
  H: { adv: 0.56, s: ['M 0.06 0.74 L 0.06 0', 'M 0.48 0.74 L 0.48 0', 'M 0.06 0.38 L 0.48 0.38'] },
  I: { adv: 0.2, s: ['M 0.08 0.74 L 0.08 0'] },
  J: { adv: 0.42, s: ['M 0.34 0.74 L 0.34 0.18 Q 0.33 0 0.18 0 Q 0.04 0 0.02 0.14'] },
  K: { adv: 0.5, s: ['M 0.06 0.74 L 0.06 0', 'M 0.44 0.74 L 0.07 0.3', 'M 0.18 0.42 L 0.46 0'] },
  L: { adv: 0.44, s: ['M 0.06 0.74 L 0.06 0 L 0.4 0'] },
  M: { adv: 0.64, s: ['M 0.04 0 L 0.08 0.74 L 0.31 0.2 L 0.54 0.74 L 0.58 0'] },
  N: { adv: 0.56, s: ['M 0.06 0 L 0.06 0.74 L 0.48 0 L 0.48 0.74'] },
  O: { adv: 0.64, s: [O_UPPER] },
  P: { adv: 0.5, s: ['M 0.06 0 L 0.06 0.74 Q 0.44 0.76 0.44 0.55 Q 0.44 0.35 0.06 0.36'] },
  Q: { adv: 0.66, s: [O_UPPER, 'M 0.38 0.16 L 0.6 -0.04'] },
  R: { adv: 0.52, s: ['M 0.06 0 L 0.06 0.74 Q 0.44 0.76 0.44 0.55 Q 0.44 0.36 0.08 0.36 L 0.46 0'] },
  S: { adv: 0.5, s: ['M 0.44 0.66 Q 0.36 0.75 0.24 0.74 Q 0.06 0.72 0.07 0.56 Q 0.08 0.42 0.25 0.38 Q 0.46 0.33 0.46 0.18 Q 0.45 0 0.24 0 Q 0.08 0 0.03 0.1'] },
  T: { adv: 0.5, s: ['M 0 0.74 L 0.5 0.74', 'M 0.25 0.74 L 0.25 0'] },
  U: { adv: 0.56, s: ['M 0.06 0.74 L 0.06 0.24 Q 0.07 0 0.27 0 Q 0.48 0 0.48 0.24 L 0.48 0.74'] },
  V: { adv: 0.52, s: ['M 0.02 0.74 L 0.26 0 L 0.5 0.74'] },
  W: { adv: 0.7, s: ['M 0.02 0.74 L 0.18 0 L 0.34 0.56 L 0.5 0 L 0.66 0.74'] },
  X: { adv: 0.52, s: ['M 0.04 0.74 L 0.48 0', 'M 0.48 0.74 L 0.04 0'] },
  Y: { adv: 0.5, s: ['M 0.02 0.74 L 0.25 0.38 L 0.48 0.74', 'M 0.25 0.38 L 0.25 0'] },
  Z: { adv: 0.52, s: ['M 0.04 0.74 L 0.46 0.74 L 0.04 0 L 0.48 0'] },
  Æ: { adv: 0.78, s: ['M 0.02 0 L 0.34 0.74 L 0.72 0.74', 'M 0.34 0.74 L 0.34 0 L 0.72 0', 'M 0.14 0.26 L 0.34 0.26', 'M 0.34 0.38 L 0.64 0.38'] },
  Ø: { adv: 0.64, s: [O_UPPER, 'M 0.6 0.8 L 0.04 -0.06'] },
  Å: { adv: 0.56, s: [...A_UPPER, 'E 0.26 0.86 0.07 0.07 90 450'] },

  0: { adv: 0.46, s: ['E 0.22 0.36 0.19 0.36 100 465'] },
  1: { adv: 0.32, s: ['M 0.06 0.56 L 0.2 0.72 L 0.2 0'] },
  2: { adv: 0.46, s: ['M 0.04 0.56 Q 0.08 0.72 0.22 0.72 Q 0.38 0.72 0.38 0.55 Q 0.38 0.42 0.04 0 L 0.4 0'] },
  3: { adv: 0.44, s: ['M 0.04 0.64 Q 0.12 0.73 0.22 0.72 Q 0.36 0.71 0.36 0.56 Q 0.36 0.4 0.16 0.4 Q 0.4 0.4 0.39 0.19 Q 0.38 0 0.2 0 Q 0.08 0 0.02 0.08'] },
  4: { adv: 0.46, s: ['M 0.3 0 L 0.3 0.72 L 0.02 0.22 L 0.42 0.22'] },
  5: { adv: 0.46, s: ['M 0.38 0.72 L 0.08 0.72 L 0.06 0.42 Q 0.14 0.46 0.22 0.46 Q 0.4 0.45 0.4 0.24 Q 0.4 0 0.2 0 Q 0.08 0 0.02 0.08'] },
  6: { adv: 0.46, s: ['M 0.34 0.71 Q 0.06 0.68 0.05 0.28 Q 0.05 0 0.22 0 Q 0.39 0 0.39 0.22 Q 0.39 0.44 0.22 0.44 Q 0.07 0.44 0.05 0.26'] },
  7: { adv: 0.44, s: ['M 0.02 0.72 L 0.4 0.72 L 0.14 0'] },
  8: { adv: 0.46, s: ['M 0.22 0.4 Q 0.04 0.44 0.05 0.57 Q 0.06 0.72 0.22 0.72 Q 0.38 0.72 0.38 0.57 Q 0.38 0.44 0.22 0.4 Q 0.02 0.36 0.03 0.19 Q 0.04 0 0.22 0 Q 0.41 0 0.41 0.19 Q 0.41 0.36 0.22 0.4'] },
  9: { adv: 0.46, s: ['M 0.38 0.46 Q 0.36 0.28 0.2 0.28 Q 0.04 0.28 0.04 0.5 Q 0.05 0.72 0.22 0.72 Q 0.38 0.72 0.38 0.5 L 0.38 0.22 Q 0.37 0 0.18 0 Q 0.08 0 0.04 0.06'] },

  '.': { adv: 0.16, s: ['M 0.06 0.02 L 0.062 0.028'] },
  ',': { adv: 0.16, s: ['M 0.07 0.04 L 0.03 -0.1'] },
  '!': { adv: 0.2, s: ['M 0.08 0.74 L 0.08 0.2', 'M 0.08 0.02 L 0.082 0.028'] },
  '?': { adv: 0.42, s: ['M 0.04 0.6 Q 0.08 0.74 0.2 0.74 Q 0.36 0.74 0.36 0.58 Q 0.36 0.46 0.2 0.38 L 0.2 0.22', 'M 0.2 0.02 L 0.202 0.028'] },
  '-': { adv: 0.32, s: ['M 0.04 0.28 L 0.26 0.28'] },
  ':': { adv: 0.18, s: ['M 0.08 0.42 L 0.082 0.428', 'M 0.08 0.04 L 0.082 0.048'] },
  "'": { adv: 0.14, s: ['M 0.06 0.76 L 0.05 0.6'] },
  '"': { adv: 0.22, s: ['M 0.05 0.76 L 0.04 0.6', 'M 0.14 0.76 L 0.13 0.6'] },
  '(': { adv: 0.24, s: ['M 0.18 0.8 Q 0 0.4 0.18 -0.1'] },
  ')': { adv: 0.24, s: ['M 0.04 0.8 Q 0.22 0.4 0.04 -0.1'] },
  '/': { adv: 0.38, s: ['M 0.36 0.78 L 0.02 -0.08'] },
  '+': { adv: 0.42, s: ['M 0.04 0.3 L 0.36 0.3', 'M 0.2 0.14 L 0.2 0.46'] },
  '=': { adv: 0.42, s: ['M 0.04 0.36 L 0.36 0.36', 'M 0.04 0.2 L 0.36 0.2'] },
  '%': { adv: 0.52, s: ['E 0.1 0.6 0.07 0.1 90 450', 'M 0.42 0.74 L 0.06 0', 'E 0.4 0.13 0.07 0.1 90 450'] },
  '♥': { adv: 0.64, s: ['M 0.3 0.05 Q 0 0.3 0.04 0.5 Q 0.1 0.68 0.3 0.52 Q 0.5 0.68 0.56 0.5 Q 0.6 0.3 0.3 0.05'] },
};

const SPACE = 0.3;
const STEP = 0.025; // em between sampled points on curves

// Parse one stroke string into a flat array [x0, y0, x1, y1, ...] in em.
function parseStroke(str) {
  const t = str.trim().split(/\s+/);
  const pts = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  const num = () => Number(t[i++]);
  const push = (x, y) => {
    pts.push(x, y);
    cx = x;
    cy = y;
  };
  while (i < t.length) {
    const cmd = t[i++];
    if (cmd === 'M' || cmd === 'L') {
      push(num(), num());
    } else if (cmd === 'Q') {
      const qx = num(); const qy = num(); const x = num(); const y = num();
      const x0 = cx; const y0 = cy;
      const len = Math.hypot(qx - x0, qy - y0) + Math.hypot(x - qx, y - qy);
      const n = Math.max(4, Math.ceil(len / STEP));
      for (let k = 1; k <= n; k++) {
        const u = k / n;
        const a = (1 - u) * (1 - u); const b = 2 * (1 - u) * u; const c = u * u;
        push(a * x0 + b * qx + c * x, a * y0 + b * qy + c * y);
      }
    } else if (cmd === 'C') {
      const ax = num(); const ay = num(); const bx = num(); const by = num(); const x = num(); const y = num();
      const x0 = cx; const y0 = cy;
      const len = Math.hypot(ax - x0, ay - y0) + Math.hypot(bx - ax, by - ay) + Math.hypot(x - bx, y - by);
      const n = Math.max(4, Math.ceil(len / STEP));
      for (let k = 1; k <= n; k++) {
        const u = k / n; const v = 1 - u;
        const a = v * v * v; const b = 3 * v * v * u; const c = 3 * v * u * u; const d = u * u * u;
        push(a * x0 + b * ax + c * bx + d * x, a * y0 + b * ay + c * by + d * y);
      }
    } else if (cmd === 'E') {
      const ecx = num(); const ecy = num(); const rx = num(); const ry = num(); const a0 = num(); const a1 = num();
      const sweep = ((a1 - a0) * Math.PI) / 180;
      const n = Math.max(4, Math.ceil(Math.abs(sweep) * Math.max(rx, ry) / STEP));
      for (let k = 0; k <= n; k++) {
        const ang = (a0 * Math.PI) / 180 + (sweep * k) / n;
        push(ecx + rx * Math.cos(ang), ecy + ry * Math.sin(ang));
      }
    } else {
      throw new Error(`fogFont: unknown path command "${cmd}" in "${str}"`);
    }
  }
  return pts;
}

const PARSED = new Map();
function glyph(ch) {
  if (PARSED.has(ch)) return PARSED.get(ch);
  const g = GLYPHS[ch];
  if (!g) return null;
  const out = { adv: g.adv, strokes: g.s.map(parseStroke) };
  PARSED.set(ch, out);
  return out;
}

export function hasGlyph(ch) {
  return ch === ' ' || ch in GLYPHS;
}

export function glyphChars() {
  return Object.keys(GLYPHS).join('');
}

// Lay out one line of text as finger strokes, in metres on the surface (x right, y up).
// opts: size = metres per em (the x-height is half of it), x/y = where the middle of the line goes (y = the middle
// of the lowercase letters), slant (italic shear), spacing (em), seed + jitter for the hand's small irregularities.
// Returns { strokes: Float32Array[] (x, y pairs), width (advance, m), bounds (ink, m), length (m), size }.
export function layoutText(text, opts = {}) {
  const size = opts.size ?? 0.1;
  const slant = opts.slant ?? 0.1;
  const spacing = opts.spacing ?? 0.03;
  const jitter = opts.jitter ?? 1;
  const rng = createRng(opts.seed ?? 1);
  const strokesEm = [];
  let pen = 0;
  let lastAdv = 0;
  for (const ch of String(text)) {
    if (ch === ' ' || !GLYPHS[ch]) {
      pen += SPACE;
      lastAdv = 0;
      continue;
    }
    const g = glyph(ch);
    // the hand's irregularities: a little up/down, a small turn, a slightly different size per letter
    const dy = rng.signed() * 0.018 * jitter;
    const rot = rng.signed() * 0.035 * jitter;
    const sc = 1 + rng.signed() * 0.035 * jitter;
    const ox = g.adv / 2;
    const oy = 0.25;
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    for (const src of g.strokes) {
      const wobPhase = rng.next() * Math.PI * 2;
      const wobAmp = 0.006 * jitter;
      const out = new Array(src.length);
      for (let k = 0; k < src.length; k += 2) {
        let x = src[k] - ox;
        let y = src[k + 1] - oy;
        const rx = (x * cs - y * sn) * sc;
        const ry = (x * sn + y * cs) * sc;
        const w = Math.sin(k * 0.21 + wobPhase) * wobAmp;
        x = rx + ox + pen;
        y = ry + oy + dy + w;
        out[k] = x + slant * y;
        out[k + 1] = y;
      }
      strokesEm.push(out);
    }
    pen += g.adv + spacing;
    lastAdv = spacing;
  }
  const widthEm = Math.max(0, pen - lastAdv);
  // ink bounds in em, then place: ink centred on x, the middle of the x-height on y
  let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity;
  for (const s of strokesEm) {
    for (let k = 0; k < s.length; k += 2) {
      if (s[k] < x0) x0 = s[k];
      if (s[k] > x1) x1 = s[k];
      if (s[k + 1] < y0) y0 = s[k + 1];
      if (s[k + 1] > y1) y1 = s[k + 1];
    }
  }
  if (!strokesEm.length) { x0 = 0; x1 = 0; y0 = 0; y1 = 0; }
  const cxEm = (x0 + x1) / 2;
  const offX = (opts.x ?? 0) - cxEm * size;
  const offY = (opts.y ?? 0) - 0.25 * size;
  let length = 0;
  const strokes = strokesEm.map((s) => {
    const f = new Float32Array(s.length);
    for (let k = 0; k < s.length; k += 2) {
      f[k] = s[k] * size + offX;
      f[k + 1] = s[k + 1] * size + offY;
      if (k >= 2) length += Math.hypot(f[k] - f[k - 2], f[k + 1] - f[k - 1]);
    }
    return f;
  });
  return {
    strokes,
    width: widthEm * size,
    bounds: { x0: x0 * size + offX, x1: x1 * size + offX, y0: y0 * size + offY, y1: y1 * size + offY },
    length,
    size,
  };
}
