// The clipboard's "Befaring" sheet: the visitor's size and choices in pencil, the rough price range with what it is and
// what it assumes (rewritten with every choice: an eraser rubs it out, the pencil writes the new one), and the box
// where the green date stamp stands ("Gratis befaring · Hold inne"). Its back says how the number is made, what is in
// and what is not. Phone-first: every word is at least 46 canvas px (16 px on a 375 px phone when held up).
// The canvas has the A4 shape of the paper (0.210 x 0.297 m); every position below is in canvas pixels, y down.
import {
  FONT, flowText, fixedLine, paintLines, canvasMeasure, INK, INK_SOFT, GREEN, GREEN_INK, PENCIL, PAPER_MIN_PX, VERT,
} from './paper.js';
import { estimate, formatKr, sizeLabel } from './price.js';
import { OPTIONS, SIZES } from '../data/prices.js';
import { PRICE_TEXT, SHEET_TEXT, COMPANY, stampDate } from '../data/texts.js';
import { CLIPBOARD_DIMS } from '../fixtures/clipboard.js';

export { FONT };
export const SIZE_KEYS = ['lite', 'middels', 'stort'];

// The stamp's outer size on the paper (its green shell, fixtures/clipboard.js; tests/clipboard.test.js measures the
// model and fails if the two part).
const STAMP_SHELL = { w: 0.062, d: 0.052 };

export const SHEET = {
  W: 1000,
  H: 1414,
  // the three size boxes in one row: box tops/bottoms, box left edges, each option's tap span and the row's tap band
  tick: { y0: 300, y1: 346, x: [56, 416, 688], hit: [[36, 396], [396, 668], [668, 964]], band: [252, 380] },
  price: { y0: 452, h: 494 },
  stampBox: { x0: 56, x1: 944, y0: 960, y1: 1378 },
  // the turn-over lines: the price block's last line on the front, the bottom right on the back
  flip: { front: { x0: 430, x1: 964, y0: 884, y1: 946 }, back: { x0: 430, x1: 964, y0: 1336, y1: 1408 } },
};

const X0 = 56;
const X1 = 944;
const BODY = PAPER_MIN_PX;

// Where the stamp's rubber meets the sheet (from the clipboard model), and the size of its print.
export function stampSpot() {
  const S = CLIPBOARD_DIMS;
  const top = S.sheet.offset - S.sheet.l / 2;
  return {
    x: SHEET.W / 2,
    y: ((S.stampAt - top) / S.sheet.l) * SHEET.H,
    w: (0.048 / S.sheet.w) * SHEET.W,
    h: (0.034 / S.sheet.l) * SHEET.H,
  };
}

// The part of the sheet the standing stamp covers (nothing is printed there; while the sheet is held up, it is the
// empty spot that says "her").
export function stampFootprint() {
  const S = CLIPBOARD_DIMS;
  const c = stampSpot();
  const hw = (STAMP_SHELL.w / 2 / S.sheet.w) * SHEET.W;
  const hd = (STAMP_SHELL.d / 2 / S.sheet.l) * SHEET.H;
  return { x0: c.x - hw, x1: c.x + hw, y0: c.y - hd, y1: c.y + hd };
}

const toPx = (u, v) => ({ x: u * SHEET.W, y: (1 - v) * SHEET.H });

// A tap on the sheet (UV: u left -> right, v bottom -> top) on a size box or its words picks that size.
export function sizeTickAt(u, v) {
  const { x, y } = toPx(u, v);
  const t = SHEET.tick;
  if (y < t.band[0] || y > t.band[1]) return null;
  for (let i = 0; i < SIZE_KEYS.length; i++) if (x >= t.hit[i][0] && x < t.hit[i][1]) return SIZE_KEYS[i];
  return null;
}

// Is a touch inside the dashed stamp box? (While the sheet is held up, a hold there stamps it.)
export function stampBoxAt(u, v) {
  const { x, y } = toPx(u, v);
  const b = SHEET.stampBox;
  return y >= b.y0 && y <= b.y1 && x >= b.x0 && x <= b.x1;
}

// Is a tap on the line that turns the sheet over? side = the side now facing the visitor.
export function flipAt(u, v, side = 'front') {
  const { x, y } = toPx(u, v);
  const r = SHEET.flip[side === 'back' ? 'back' : 'front'];
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

const rangeText = (r) => `ca. ${formatKr(r.low)} – ${formatKr(r.high)} kr`;

function letterhead(lines, rects, measure, { title, copy }) {
  lines.push(fixedLine('Straume', { x: X0, y: 92, size: 60, weight: 760, color: '#282827', tag: 'logo' }, measure));
  const barSize = 32;
  rects.bar = { x: X0, y: 104, w: measure('Våtrom AS', barSize, 600) + 28, h: 42 };
  lines.push(fixedLine('Våtrom AS', { x: X0 + 14, y: 136, size: barSize, weight: 600, color: '#ffffff', tag: 'logo' }, measure));
  lines.push(fixedLine(title, { x: X0, w: X1 - X0, y: 92, size: 64, weight: 800, color: INK, align: 'right', tag: 'title' }, measure));
  lines.push(fixedLine(SHEET_TEXT.example, { x: X0, w: X1 - X0, y: 156, size: BODY, weight: 700, color: INK_SOFT, align: 'right', tag: 'example' }, measure));
  // the trader and the address belong where a price is shown (Marketing Act § 8)
  lines.push(fixedLine(COMPANY.address, { x: X0, y: 214, size: BODY, weight: 450, color: INK_SOFT, tag: 'address' }, measure));
  if (copy) lines.push(fixedLine(SHEET_TEXT.copy, { x: X0, w: X1 - X0, y: 214, size: BODY, weight: 700, color: INK_SOFT, align: 'right', tag: 'copy' }, measure));
  rects.rule = { x: X0, y: 231, w: X1 - X0, h: 2 };
}

// The sheet as data: { lines, rects, ticks, fits, scale, side }. Every word on it goes through here, so the tests read
// the same layout the room paints. state = { size, choices }; opts: side ('front'|'back'), copy, stamped, held,
// flippable, lines (choice lines in pencil, instead of the defaults from OPTIONS).
export function befaringLayout(state, opts = {}, measure) {
  const { side = 'front', copy = false, held = false, flippable = false, lines: choiceOverride = null } = opts;
  const lines = [];
  const rects = {};
  letterhead(lines, rects, measure, { title: side === 'back' ? SHEET_TEXT.backTitle : SHEET_TEXT.title, copy });
  if (side === 'back') return backLayout(lines, rects, measure, { flippable });

  // size: the question and three boxes in one row
  lines.push(fixedLine(SHEET_TEXT.sizeQuestion, { x: X0, y: 280, size: 48, weight: 650, color: INK, tag: 'sizeQuestion' }, measure));
  const t = SHEET.tick;
  // a box carries a pencil tick only once the visitor has ticked it (state.sizeChosen false = not yet: the range then
  // says which size it assumes, and no box pretends to be their answer)
  const ticks = SIZE_KEYS.map((k, i) => {
    const box = { x: t.x[i], y: t.y0, w: t.y1 - t.y0, h: t.y1 - t.y0, key: k, ticked: state.size === k && state.sizeChosen !== false };
    lines.push(fixedLine(SIZES[k].label, { x: t.x[i] + box.w + 12, y: t.y1 - 7, size: BODY, weight: 450, color: INK, tag: 'size' }, measure));
    return box;
  });

  // the choices, in pencil
  lines.push(fixedLine(SHEET_TEXT.choices, { x: X0, y: 420, size: BODY, weight: 650, color: INK, tag: 'choicesHead' }, measure));
  const choiceLines = choiceOverride || Object.entries(OPTIONS).map(([grp, opt]) => opt.choices[state.choices?.[grp] ?? opt.default].label);
  const choiceX = X0 + measure(SHEET_TEXT.choices, BODY, 650) + 22;
  const choices = flowText(choiceLines.map((c) => ({ text: c, size: 64, weight: 500, family: 'hand', color: PENCIL, lead: 1.12, tag: 'choice' })),
    measure, { x: choiceX, w: X1 - choiceX, top: 420 - 64 * VERT.hand.ascent, bottom: SHEET.price.y0 - 6 });
  lines.push(...choices.lines);

  // the price block: what it is, the range, VAT and date, what it assumes and leaves out
  const P = SHEET.price;
  rects.price = { x: 40, y: P.y0, w: SHEET.W - 80, h: P.h };
  const range = rangeText(estimate(state));
  const fr = SHEET.flip.front;
  const price = flowText([
    { text: PRICE_TEXT.label, size: 50, weight: 700, color: INK, lead: 1.2, tag: 'priceLabel' },
    { text: range, size: 84, weight: 600, family: 'hand', color: PENCIL, lead: 1.08, gap: 2, tag: 'range' },
    { text: PRICE_TEXT.vatDate, size: BODY, weight: 450, color: INK, tag: 'vat' },
    { text: PRICE_TEXT.assumes(sizeLabel(state.size)), size: BODY, weight: 430, color: INK_SOFT, gap: 8, tag: 'assumes' },
    { text: PRICE_TEXT.excludesShort, size: BODY, weight: 430, color: INK_SOFT, tag: 'excludes' },
  ], measure, { x: X0 + 14, w: X1 - X0 - 28, top: P.y0 + 12, bottom: flippable ? fr.y0 : P.y0 + P.h - 6 });
  lines.push(...price.lines);
  rects.range = price.lines.find((l) => l.tag === 'range');
  if (flippable) lines.push(fixedLine(SHEET_TEXT.flip, { x: fr.x0, w: X1 - 14 - fr.x0, y: fr.y0 + 46, size: BODY, weight: 650, color: GREEN_INK, align: 'right', tag: 'flip' }, measure));

  // the stamp box: "Gratis befaring" left of the stamp, "Hold inne" right of it, the email line below it
  const B = SHEET.stampBox;
  const foot = stampFootprint();
  rects.stampBox = { x: B.x0, y: B.y0, w: B.x1 - B.x0, h: B.y1 - B.y0 };
  rects.footprint = foot;
  const midY = (foot.y0 + foot.y1) / 2;
  const twoLines = VERT.sans.ascent + VERT.sans.descent; // a two-line block is twice this tall: centre it on the stamp
  const left = flowText(SHEET_TEXT.stampLeft.map((s) => ({ text: s, size: 52, weight: 700, color: INK, lead: twoLines, tag: 'stampLeft' })),
    measure, { x: X0 + 24, w: foot.x0 - 18 - (X0 + 24), top: midY - 52 * twoLines });
  const right = flowText(SHEET_TEXT.stampRight.map((s) => ({ text: s, size: 64, weight: 800, color: GREEN_INK, lead: twoLines, tag: 'stampCue' })),
    measure, { x: foot.x1 + 26, w: X1 - 24 - (foot.x1 + 26), top: midY - 64 * twoLines });
  const below = flowText([{ text: SHEET_TEXT.stampBelow, size: BODY, weight: 500, color: INK, tag: 'stampBelow' }],
    measure, { x: X0 + 24, w: X1 - X0 - 48, top: foot.y1 + 10, bottom: B.y1 - 4 });
  lines.push(...left.lines, ...right.lines, ...below.lines);
  if (held) lines.push(fixedLine(SHEET_TEXT.holdHere, { x: foot.x0, w: foot.x1 - foot.x0, y: midY + BODY * 0.35, size: BODY, weight: 600, color: GREEN_INK, align: 'center', tag: 'holdHere' }, measure));

  const parts = [choices, price, left, right, below];
  return { lines, rects, ticks, side: 'front', fits: parts.every((p) => p.fits), scale: Math.min(...parts.map((p) => p.scale)) };
}

function backLayout(lines, rects, measure, { flippable }) {
  const bk = SHEET.flip.back;
  const head = (text, gap = 0) => ({ text, size: 52, weight: 760, color: INK, lead: 1.15, gap });
  const body = (text, tag, color = INK) => ({ text, size: BODY, weight: 430, color, gap: 4, tag });
  const flow = flowText([
    head(SHEET_TEXT.backHow), body(PRICE_TEXT.how, 'how'), body(PRICE_TEXT.next, 'next'),
    head(SHEET_TEXT.backIn, 26), body(PRICE_TEXT.includes, 'includes'), body(PRICE_TEXT.lavish, 'lavish', INK_SOFT),
    head(SHEET_TEXT.backOut, 26), body(PRICE_TEXT.excludes, 'excludesAll'),
  ], measure, { x: X0, w: X1 - X0, top: 254, bottom: bk.y0 - 6 });
  lines.push(...flow.lines);
  if (flippable) lines.push(fixedLine(SHEET_TEXT.flipBack, { x: bk.x0, w: X1 - bk.x0, y: bk.y0 + 50, size: BODY, weight: 650, color: GREEN_INK, align: 'right', tag: 'flip' }, measure));
  return { lines, rects, ticks: [], side: 'back', fits: flow.fits, scale: flow.scale };
}

// state = { size, choices }; eraseT/writeT animate the range being rubbed out and written; stamped = { date } once the
// stamp has printed; copy = true on the copy that stays on the board ("Din kopi"); side 'back' draws the back; held =
// true while the sheet is held up (its empty stamp spot says "her"); flippable = the touch layer turns it over.
export function drawBefaring(canvas, state, { eraseT = 1, writeT = 1, stamped = null, ...opts } = {}) {
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const s = W / SHEET.W;
  const L = befaringLayout(state, opts, canvasMeasure(g));
  g.fillStyle = '#fbfaf6';
  g.fillRect(0, 0, W, canvas.height);
  const R = L.rects;
  g.fillStyle = GREEN;
  g.beginPath(); g.roundRect(R.bar.x * s, R.bar.y * s, R.bar.w * s, R.bar.h * s, 10 * s); g.fill();
  g.fillStyle = '#dcdad3';
  g.fillRect(R.rule.x * s, R.rule.y * s, R.rule.w * s, R.rule.h * s);
  if (L.side === 'front') {
    g.fillStyle = '#efefef';
    g.fillRect(R.price.x * s, R.price.y * s, R.price.w * s, R.price.h * s);
    for (const box of L.ticks) {
      g.strokeStyle = INK;
      g.lineWidth = 3 * s;
      g.strokeRect(box.x * s, box.y * s, box.w * s, box.h * s);
      if (box.ticked) { // a pencil tick
        g.strokeStyle = 'rgba(43,43,43,0.92)';
        g.lineWidth = 6 * s;
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo((box.x + 6) * s, (box.y + 20) * s);
        g.lineTo((box.x + 18) * s, (box.y + 38) * s);
        g.lineTo((box.x + 50) * s, (box.y - 12) * s);
        g.stroke();
      }
    }
    // the stamp box (the stamp stands in it, on the paper)
    g.strokeStyle = GREEN;
    g.lineWidth = 4 * s;
    g.setLineDash([14 * s, 10 * s]);
    g.strokeRect(R.stampBox.x * s, R.stampBox.y * s, R.stampBox.w * s, R.stampBox.h * s);
    if (opts.held && !stamped) { // where the stamp stood: the spot to hold
      const f = R.footprint;
      g.strokeStyle = 'rgba(91,117,20,0.55)';
      g.lineWidth = 3 * s;
      g.setLineDash([8 * s, 8 * s]);
      g.beginPath(); g.roundRect((f.x0 + 8) * s, (f.y0 + 8) * s, (f.x1 - f.x0 - 16) * s, (f.y1 - f.y0 - 16) * s, 18 * s); g.stroke();
    }
    g.setLineDash([]);
  }
  const shown = stamped ? L.lines.filter((l) => l.tag !== 'holdHere') : L.lines;
  paintLines(g, shown, s, { reveal: { range: writeT } });
  if (L.side === 'front' && eraseT < 1 && R.range) { // the old range under eraser crumbs
    const l = R.range;
    g.fillStyle = `rgba(239,239,239,${1 - eraseT})`;
    g.fillRect((l.x - 6) * s, (l.y - l.size * 0.82) * s, (l.w + 12) * s, l.size * 1.02 * s);
  }
  if (stamped && L.side === 'front') drawStamp(g, s, stamped);
  return L;
}

// The self-inking stamp's print: green ink, slightly uneven, the size of its rubber.
function drawStamp(g, s, { date, alpha = 1 }) {
  const p = stampSpot();
  g.save();
  g.translate(p.x * s, p.y * s);
  g.rotate(-0.035);
  g.globalAlpha = 0.86 * alpha;
  g.strokeStyle = '#6f8f17';
  g.fillStyle = '#6f8f17';
  g.lineWidth = 4 * s;
  g.strokeRect((-p.w / 2) * s, (-p.h / 2) * s, p.w * s, p.h * s);
  g.textAlign = 'center';
  g.font = `800 ${26 * s}px ${FONT}`;
  g.fillText('GRATIS BEFARING', 0, (-p.h / 2 + 40) * s);
  g.fillText('ØNSKES', 0, (-p.h / 2 + 72) * s);
  g.font = `700 ${30 * s}px ${FONT}`;
  g.fillText(date || stampDate(), 0, (p.h / 2 - 22) * s);
  // ink is never perfectly even: a few lighter specks
  g.globalCompositeOperation = 'destination-out';
  g.globalAlpha = 0.35;
  for (let i = 0; i < 40; i++) {
    const rx = Math.sin(i * 12.9898) * 43758.5453;
    const ry = Math.sin(i * 78.233) * 12543.1234;
    g.fillRect(((rx - Math.floor(rx)) - 0.5) * p.w * s, ((ry - Math.floor(ry)) - 0.5) * p.h * s, 3 * s, 2 * s);
  }
  g.restore();
}
