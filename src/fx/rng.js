// A small seeded random generator (mulberry32), so effects are repeatable in tests and never allocate per call. Pure.

export function createRng(seed = 1) {
  let s = (seed >>> 0) || 0x9e3779b9;
  function next() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    // a rough bell shape around 0 in -1..1 (sum of two uniforms)
    signed: () => next() + next() - 1,
  };
}

export const clamp01 = (x) => (x > 1 ? 1 : x > 0 ? x : 0); // NaN -> 0

export function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
