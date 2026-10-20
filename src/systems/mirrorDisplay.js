// The digital LED mirror's display: thin white letters behind the glass, Straume green as the only colour.
// Home row: the time, a greeting and the discoveries ring (the number in the ring, "av 38 oppdaget" under it).
// Body: a message (after the stamp, after a swap) or "Ditt bad" with the price, its legal label, date and trader.
// When the room goes quiet a "Visste du?" fact with its source fades in where the price was: the price fades out first,
// so a fact never sits under a price (texts.js). Each fact shows once per visit, idle ones in their order.
// State and layout are pure (tests/mirrorDisplay.test.js); createMirrorDisplay paints them on a canvas texture and
// redraws only when something changed.
import * as THREE from 'three';
import { flowText, fixedLine, paintLines, canvasMeasure } from './paper.js';
import { FACTS, IDLE_FACTS, GREETING, LINES, PRICE_TEXT } from '../data/texts.js';
import { estimate, formatKr, sizeLabel } from './price.js';

export const MIRROR = { W: 640, H: 400, minPx: 20 }; // design px; the display is 0.38 m wide, so 20 px = 1.2 cm
const IDLE_MS = 22000;
const FADE_IN = 800;
const HOLD = 9000;
const FADE_OUT = 900;
const WHITE = (a) => `rgba(255,255,255,${a})`;
const GREEN = 'rgba(171,192,55,0.95)';

export function createMirrorState() {
  const st = { found: 0, total: 0, bath: null, message: null, fact: null, factAge: 0, idle: 0, dirty: true };
  const shown = new Set();
  const factAlpha = () => {
    if (!st.fact) return 0;
    const a = st.factAge;
    return a < FADE_IN ? a / FADE_IN : a > HOLD ? Math.max(0, 1 - (a - HOLD) / FADE_OUT) : 1;
  };
  // key: that fact (shown by its own action); no key: the next idle fact. asked: the visitor asked for it (its own
  // action, or a tap on the screen). Never one already shown. Returns shown?
  function showFact(key, asked = !!key) {
    const f = key ? FACTS.find((x) => x.key === key) : IDLE_FACTS.find((x) => !shown.has(x.key));
    if (!f || shown.has(f.key)) return false;
    shown.add(f.key);
    st.fact = f;
    st.factAsked = asked;
    st.factAge = 0;
    st.idle = 0;
    st.dirty = true;
    return true;
  }
  // A passing note (words over the body: the scale's reading, a swap) ends a showing fact at once, with the fact's own
  // fade-out from where it stands (a note drawn under a fact was lost: the look, 2026-10-20, look3 defect 3). Returns
  // the ms until the body is fully back (0 without a fact).
  // A fact cut short may come again (it was not read): an idle one in its turn, and one the visitor asked for goes back
  // to the front of the queue (takeCut(); review4 2026-10-20: the 1891 fact was cut after 3 s and never came back).
  function endFact() {
    if (!st.fact) return 0;
    if (st.factAge < HOLD) {
      shown.delete(st.fact.key);
      st.cut = { key: st.fact.key, asked: !!st.factAsked };
      st.factAge = HOLD + (1 - factAlpha()) * FADE_OUT;
      st.dirty = true;
    }
    return Math.max(0, HOLD + FADE_OUT - st.factAge);
  }
  // The fact the last endFact() cut short ({ key, asked }), once; null if none.
  function takeCut() {
    const c = st.cut || null;
    st.cut = null;
    return c;
  }
  // Called every frame with dt in ms; returns true while a fade runs (the loop keeps drawing).
  function update(dt) {
    st.idle += dt;
    if (st.fact) {
      const before = factAlpha();
      st.factAge += dt;
      if (st.factAge >= HOLD + FADE_OUT) { st.fact = null; st.idle = 0; st.dirty = true; return false; }
      if (Math.abs(factAlpha() - before) > 0.001) { st.dirty = true; return true; }
      return false;
    }
    if (st.idle > IDLE_MS && !st.message) return showFact();
    return false;
  }
  return {
    update, showFact, endFact, takeCut,
    setDiscovered(found, total) { st.found = found; st.total = total; st.idle = 0; st.dirty = true; },
    setBath(bath) { st.bath = bath ? { size: bath.size, choices: { ...(bath.choices || {}) } } : null; st.dirty = true; },
    // The stamp's message always carries its second line (the visitor sends the email themself), even when a caller
    // passes only the first.
    setMessage(lines) {
      st.message = lines && lines.length === 1 && lines[0] === LINES.readyToSend ? LINES.mailReady : lines || null;
      st.dirty = true;
    },
    poke() { st.idle = 0; },
    shown: () => [...shown],
    takeDirty() { const d = st.dirty; st.dirty = false; return d; },
    view: () => ({ found: st.found, total: st.total, bath: st.bath, message: st.message, fact: st.fact, factAlpha: factAlpha() }),
  };
}

const withAlpha = (lines, alpha) => lines.map((l) => ({ ...l, alpha }));

// The screen as data: { lines (each with alpha), ring }. view = state.view(); now = a Date.
export function mirrorLayout(view, now, measure) {
  const lines = [];
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  lines.push(fixedLine(`${hh}:${mm}`, { x: 26, y: 70, size: 58, weight: 300, color: WHITE(0.92), tag: 'time' }, measure));
  lines.push(fixedLine(GREETING(now.getHours()), { x: 28, y: 112, size: 28, weight: 400, color: WHITE(0.8), tag: 'greeting' }, measure));
  let ring = null;
  if (view.total) {
    ring = { cx: 532, cy: 58, r: 36, frac: view.found / view.total, text: String(view.found) };
    lines.push(fixedLine(ring.text, { x: ring.cx - 40, w: 80, y: ring.cy + 11, size: 30, weight: 500, color: WHITE(0.92), align: 'center', tag: 'ring' }, measure));
    lines.push(fixedLine(LINES.discoveredCaption(view.total), { x: ring.cx - 100, w: 200, y: ring.cy + ring.r + 32, size: 22, weight: 400, color: WHITE(0.8), align: 'center', tag: 'caption' }, measure));
  }
  const box = { x: 26, w: MIRROR.W - 52, top: 150, bottom: MIRROR.H - 8 };
  // one after the other in the same place: the body is gone before the fact starts to show (and back the same way)
  const fa = Math.max(0, 2 * view.factAlpha - 1);
  const bodyAlpha = Math.max(0, 1 - 2 * view.factAlpha);
  if (view.message) {
    const m = flowText([
      { text: view.message[0], size: 40, weight: 600, color: WHITE(0.92), tag: 'message' },
      { text: view.message[1] || '', size: 28, weight: 400, color: WHITE(0.86), gap: 6, tag: 'message' },
    ], measure, box);
    lines.push(...withAlpha(m.lines, bodyAlpha));
  } else if (view.bath) {
    const r = estimate(view.bath);
    const b = flowText([
      { text: `${LINES.yourBath} · ${sizeLabel(view.bath.size)}, vanlige valg`, size: 26, weight: 600, color: GREEN, tag: 'bath' }, // what the range assumes
      { text: `ca. ${formatKr(r.low)} – ${formatKr(r.high)} kr`, size: 46, weight: 500, color: WHITE(0.94), gap: 2, tag: 'bath' },
      { text: PRICE_TEXT.label, size: 24, weight: 450, color: WHITE(0.86), gap: 4, tag: 'bath' },
      { text: PRICE_TEXT.vatDate, size: 22, weight: 400, color: WHITE(0.8), tag: 'bath' },
      { text: PRICE_TEXT.trader, size: 20, weight: 400, color: WHITE(0.72), tag: 'bath' },
    ], measure, box);
    lines.push(...withAlpha(b.lines, bodyAlpha));
  }
  if (view.fact && fa > 0) {
    const f = flowText([
      { text: 'Visste du?', size: 24, weight: 600, color: GREEN, tag: 'fact' },
      { text: view.fact.text, size: 28, weight: 400, color: WHITE(0.92), gap: 4, tag: 'fact' },
      { text: `Kilde: ${view.fact.source}`, size: 20, weight: 400, color: WHITE(0.66), gap: 8, tag: 'factSource' },
    ], measure, box);
    lines.push(...withAlpha(f.lines, fa));
  }
  return { lines, ring };
}

export function createMirrorDisplay({ width = 640, height = 400 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  const measure = canvasMeasure(g);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const state = createMirrorState();
  let lastMinute = -1;

  function draw() {
    const W = canvas.width;
    const s = W / MIRROR.W;
    g.clearRect(0, 0, W, canvas.height);
    const L = mirrorLayout(state.view(), new Date(), measure);
    if (L.ring) {
      const { cx, cy, r, frac } = L.ring;
      g.lineWidth = 4 * s;
      g.strokeStyle = WHITE(0.25);
      g.beginPath(); g.arc(cx * s, cy * s, r * s, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = GREEN;
      g.beginPath(); g.arc(cx * s, cy * s, r * s, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); g.stroke();
    }
    paintLines(g, L.lines, s);
    texture.needsUpdate = true;
  }

  // Called by the loop; returns true while animating (fade) so the loop keeps drawing.
  function update(dt) {
    const minute = new Date().getMinutes();
    let redraw = minute !== lastMinute;
    lastMinute = minute;
    const anim = state.update(dt);
    if (state.takeDirty()) redraw = true;
    if (redraw) draw();
    return anim;
  }

  const touch = (fn) => (...a) => { const r = fn(...a); draw(); return r; };
  return {
    canvas, texture, material, update, draw,
    showFact: touch(state.showFact),
    endFact: touch(state.endFact),
    takeCut: state.takeCut,
    setDiscovered: touch(state.setDiscovered),
    setBath: touch(state.setBath),
    setMessage: touch(state.setMessage),
    poke: state.poke,
    view: state.view, // (what the screen shows: tests)
  };
}
