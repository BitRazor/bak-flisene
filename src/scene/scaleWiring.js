// The bathroom scale's touch (fixtures/scale.js). A tap steps on: the platform gives with a spring bonk and the needle
// swings past the reading, back, and settles with soft ticks; a second tap steps off and the needle springs back onto
// its pin. The camera never moves (concept rule 1): the visitor "steps on" by touch alone.
// The reading is the visitor's price feeling (research/inventory-dry.md 26.1, docs/CONCEPT.md 7.2): where the middle of
// their range (systems/price.js estimate(), the same range the sheet and the mirror show) lies between the cheapest and
// the dearest bathroom the room offers (data/prices.js), from "Enkelt" to "Påkostet". No kroner on the dial, ever.
// While someone stands on it, the needle follows a changed choice (a size ticked on the sheet, the toilet swapped:
// research/experience-design.md 4.3, "it always agrees with the range") without a sound of its own: the visitor did
// that elsewhere, and the room plays nothing by itself (the owner, 2026-10-19).
// The dial's words are about 3 px high on a phone from anywhere a visitor can stand (review 2026-10-19, finding 12), so
// once the needle has settled after a step on, the mirror (the room's one screen) says the reading for a few seconds in
// the dial's own words (data/texts.js LINES.scaleReading): nearer "Enkelt", nearer "Påkostet", or about midway. Not
// for a needle that followed a choice made elsewhere (that choice says its own), never a number or kroner.
//
// wireScale(ctx, { found, play, reg, loop, tweens, state, mirrorNote }) -> { stepOn(), stepOff(), tap(), on, angle,
// reading() }, or null when the room has no scale (ctx.fixtures.scale). state = the visitor's choices ({ size,
// choices }, as scene/interactions.js keeps them); mirrorNote(lines, ms) = words that pass over the mirror's screen.
// Discovery keys: SCALE_DISCOVERIES. Sound roles: scale_spring, scale_tick.
import { estimate } from '../systems/price.js';
import { SIZES, OPTIONS, DEFAULT_SIZE } from '../data/prices.js';
import { LINES } from '../data/texts.js';
import { SCALE_DIAL, DIAL_WORDS, needleAngle } from '../fixtures/scale.js';

export const SCALE_DISCOVERIES = ['scale'];
export const SCALE_TIMING = {
  swingMs: 1700, // stepping on: the needle has settled (its last wobble under a thousandth of the swing)
  offMs: 1300, // stepping off: back on the pin, after a small bounce on it
  noteMs: 8000, // the reading's words on the mirror (time to look up from the floor to the mirror and read two lines)
};
// The reading in words: nearer "Enkelt" under `low` of the way, nearer "Påkostet" over `high`, about midway between.
export const READING_BANDS = { low: 0.4, high: 0.6 };
export function readingWords(feeling) {
  const word = (tag) => DIAL_WORDS.find((w) => w.tag === tag).text;
  const side = feeling < READING_BANDS.low ? 'low' : feeling > READING_BANDS.high ? 'high' : 'middle';
  return LINES.scaleReading(side, word('left'), word('right'));
}
// The needle on its spring: a damping ratio of 0.5 swings it about 16 % past its target and back (the first turn at
// 0.35 s with 9 rad/s), then it settles.
export const SPRING = { zeta: 0.5, wd: 9 };
const DECAY = (SPRING.zeta * SPRING.wd) / Math.sqrt(1 - SPRING.zeta * SPRING.zeta);
const TICK = { min: 0.02, base: 0.05, perRad: 0.25, max: 0.4 }; // a tick as loud as the swing before it was long

// Where the needle is s seconds after it was let go at `from` toward `to` (it starts still: a needle has weight).
export function springAt(from, to, s) {
  const e = Math.exp(-DECAY * s);
  return to + (from - to) * e * (Math.cos(SPRING.wd * s) + (DECAY / SPRING.wd) * Math.sin(SPRING.wd * s));
}

// Every bathroom the room can make: each size with each combination of every option's choices.
export function allBaths() {
  let combos = [{}];
  for (const [group, opt] of Object.entries(OPTIONS)) {
    const next = [];
    for (const c of combos) for (const key of Object.keys(opt.choices)) next.push({ ...c, [group]: key });
    combos = next;
  }
  const out = [];
  for (const size of Object.keys(SIZES)) for (const choices of combos) out.push({ size, choices });
  return out;
}

const middle = (r) => (r.low + r.high) / 2;
// The middle of the cheapest and of the dearest range the room can show (kroner, incl. VAT; never printed).
export const FEELING = (() => {
  let min = Infinity;
  let max = -Infinity;
  for (const b of allBaths()) { const m = middle(estimate(b)); min = Math.min(min, m); max = Math.max(max, m); }
  return { min, max };
})();

// The price feeling of a bathroom ({ size, choices }): 0 = the room's cheapest, 1 = its dearest.
export function priceFeeling(bath) {
  const m = middle(estimate({ size: (bath && bath.size) || DEFAULT_SIZE, choices: (bath && bath.choices) || {} }));
  if (!(FEELING.max > FEELING.min)) return 0.5;
  return Math.min(1, Math.max(0, (m - FEELING.min) / (FEELING.max - FEELING.min)));
}

export function wireScale(ctx, helpers = {}) {
  const sc = ctx.fixtures && ctx.fixtures.scale;
  if (!sc || !sc.parts || !sc.parts.needlePivot || !sc.setNeedle) return null;
  const { found = () => {}, play = () => null, reg, loop, tweens, state, mirrorNote = null } = helpers;
  const needle = sc.parts.needlePivot;
  const joint = needle.userData.joint;
  const key = `scale${needle.uuid}`;
  const groups = Object.keys(OPTIONS);
  const seen = { size: null, choices: {} }; // the choices the needle shows
  let on = false;

  const angle = () => joint.value;
  const reading = () => needleAngle(priceFeeling(state));
  function remember() {
    seen.size = state ? state.size : null;
    for (const g of groups) seen.choices[g] = state && state.choices ? state.choices[g] : undefined;
  }
  function changed() { // (no allocation: it is asked every frame)
    if (!state) return false;
    if (state.size !== seen.size) return true;
    for (let i = 0; i < groups.length; i++) if ((state.choices && state.choices[groups[i]]) !== seen.choices[groups[i]]) return true;
    return false;
  }

  // The needle on its spring from where it stands now to `to`. With sound, it ticks where it turns back and where it
  // lands on its pin or its stop, each as soft as the swing before it was short. settled() runs once it is still (not
  // when another swing took over first).
  function swing(to, ms, sound, settled = null) {
    const from = angle();
    let last = from;
    let dir = 0;
    let swept = 0;
    let pinned = false;
    const tick = (amp) => {
      if (sound && amp >= TICK.min) play('scale_tick', { volume: Math.min(TICK.max, TICK.base + TICK.perRad * amp) });
    };
    tweens.add({
      key, from: 0, to: 1, duration: ms, ease: 'linear',
      onUpdate: (p) => {
        const raw = p >= 1 ? to : springAt(from, to, (p * ms) / 1000);
        const now = sc.setNeedle(raw);
        const d = now - last;
        last = now;
        if (raw < joint.min - 1e-9 || raw > joint.max + 1e-9) { // on the pin or against the stop
          if (!pinned) { tick(swept + Math.abs(d)); swept = 0; dir = 0; }
          pinned = true;
          return;
        }
        pinned = false;
        if (Math.abs(d) < 1e-9) return;
        const sgn = Math.sign(d);
        if (dir && sgn !== dir) { tick(swept); swept = 0; }
        dir = sgn;
        swept += Math.abs(d);
      },
      onDone: () => { sc.setNeedle(to); if (settled) settled(); },
    });
    if (loop) loop.wake(ms + 200);
  }

  // the reading in words on the mirror (stepped on and settled only)
  const sayReading = () => { if (mirrorNote) mirrorNote(readingWords(priceFeeling(state)), SCALE_TIMING.noteMs); };
  function stepOn() {
    on = true;
    remember();
    play('scale_spring', { volume: 0.8 });
    swing(reading(), SCALE_TIMING.swingMs, true, sayReading);
    found('scale');
  }
  function stepOff() {
    on = false;
    play('scale_spring', { volume: 0.4, rate: 1.25 }); // the platform rising again, lighter
    swing(SCALE_DIAL.rest, SCALE_TIMING.offMs, true);
  }
  const tap = () => (on ? stepOff() : stepOn());
  if (reg) reg(sc.group, { tap });
  if (loop) loop.add(() => { if (on && changed()) { remember(); swing(reading(), SCALE_TIMING.swingMs, false); } return false; });

  return {
    stepOn, stepOff, tap, reading,
    get on() { return on; },
    get angle() { return angle(); },
  };
}
