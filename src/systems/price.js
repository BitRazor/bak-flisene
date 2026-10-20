// The rough price range for the visitor's bathroom. Pure functions, no DOM.
// Display rules (research/prices.md section 5.8): always a range, both ends, incl. VAT,
// dated, called "uforpliktende prisantydning"; never "fra", never "prisoverslag".
import { PRICE_LEVEL, SIZES, OPTIONS, DEFAULT_SIZE } from '../data/prices.js';

const STEP = 5000;
const MIN_SPREAD = 1.2; // the high end is never below 120 % of the low end

export function estimate({ size = DEFAULT_SIZE, choices = {} } = {}) {
  const base = SIZES[size];
  if (!base) throw new Error(`Unknown size "${size}"`);
  let [low, high] = base.range;
  for (const [group, key] of Object.entries(choices)) {
    const opt = OPTIONS[group];
    if (!opt) throw new Error(`Unknown option group "${group}"`);
    const choice = opt.choices[key];
    if (!choice) throw new Error(`Unknown choice "${key}" for ${group}`);
    low += choice.delta[0];
    high += choice.delta[1];
  }
  return roundRange({ low, high });
}

export function roundRange({ low, high }) {
  const lo = Math.floor(low / STEP) * STEP;
  let hi = Math.ceil(high / STEP) * STEP;
  const minHigh = Math.ceil((lo * MIN_SPREAD) / STEP) * STEP;
  if (hi < minHigh) hi = minHigh;
  return { low: lo, high: hi };
}

export function formatKr(n) {
  const digits = String(Math.round(Math.abs(n)));
  const groups = [];
  for (let i = digits.length; i > 0; i -= 3) groups.unshift(digits.slice(Math.max(0, i - 3), i));
  return (n < 0 ? '-' : '') + groups.join(' ');
}

export function formatRange({ low, high }) {
  return `ca. ${formatKr(low)} – ${formatKr(high)} kr inkl. mva`;
}

export function formatDelta([a, b]) {
  if (a === 0 && b === 0) return 'ingen tillegg';
  if (b <= 0) return `rimeligere: ca. ${formatKr(-b)} – ${formatKr(-a)} kr`;
  return `tillegg ca. ${formatKr(a)} – ${formatKr(b)} kr`;
}

export function priceLabel() {
  return `Uforpliktende prisantydning, prisnivå ${PRICE_LEVEL}. Fast pris får du skriftlig etter gratis befaring.`;
}

export function sizeLabel(size = DEFAULT_SIZE) {
  const s = SIZES[size];
  if (!s) throw new Error(`Unknown size "${size}"`);
  return s.label;
}
