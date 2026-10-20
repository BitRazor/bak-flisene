// Easing curves and a tiny tween manager driven by the render loop (dt in ms). Pure.

export const ease = {
  linear: (t) => t,
  outCubic: (t) => 1 - (1 - t) ** 3,
  inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
  // A soft-close damper: most travel early, a long slow finish.
  softClose: (t) => 1 - (1 - t) ** 4,
  inQuad: (t) => t * t,
};

export function createTweens() {
  let list = [];

  function add({ key = null, from, to, duration, ease: e = 'outCubic', onUpdate = null, onDone = null, delay = 0 }) {
    if (key !== null) list = list.filter((tw) => tw.key !== key);
    const fn = typeof e === 'function' ? e : ease[e];
    if (!fn) throw new Error(`Unknown easing "${e}"`);
    const tw = { key, from, to, duration: Math.max(1, duration), fn, onUpdate, onDone, t: -delay };
    list.push(tw);
    return tw;
  }

  function update(dt) {
    if (!list.length) return;
    const finished = [];
    for (const tw of list) {
      tw.t += dt;
      if (tw.t < 0) continue;
      const p = Math.min(1, tw.t / tw.duration);
      const v = tw.from + (tw.to - tw.from) * tw.fn(p);
      if (tw.onUpdate) tw.onUpdate(v, p);
      if (p >= 1) finished.push(tw);
    }
    if (finished.length) {
      list = list.filter((tw) => !finished.includes(tw));
      for (const tw of finished) if (tw.onDone) tw.onDone();
    }
  }

  function cancel(key) {
    list = list.filter((tw) => tw.key !== key);
  }

  return { add, update, cancel, active: () => list.length };
}
