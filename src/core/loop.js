// The render loop: renders only while something moves (saves battery and heat on phones).
// Anything animating calls loop.wake(ms) or registers an updater that returns true while busy.
// loop.onRendered(dtMs) hears the time between two frames drawn one after the other (the quality governor's measure);
// the pauses while the loop sleeps are never reported as frames.

export function createLoop(render) {
  const updaters = new Set();
  let awakeUntil = 0;
  let last = performance.now();
  let frames = 0;
  let fpsT = last;
  let fps = 0;
  let lastDrawn = -1; // when the previous frame was drawn, if the frame before this one was drawn
  let onRendered = null;

  function wake(ms = 1500) {
    awakeUntil = Math.max(awakeUntil, performance.now() + ms);
  }

  function add(fn) {
    updaters.add(fn);
    wake();
    return () => updaters.delete(fn);
  }

  function frame(now) {
    const dt = Math.max(0, Math.min(64, now - last));
    last = Math.max(last, now);
    let busy = now < awakeUntil;
    for (const fn of updaters) if (fn(dt, now)) busy = true;
    if (busy) {
      render(dt, now);
      frames += 1;
      if (lastDrawn >= 0 && onRendered) onRendered(now - lastDrawn);
      lastDrawn = now;
    } else lastDrawn = -1;
    if (now - fpsT >= 1000) {
      fps = (frames * 1000) / (now - fpsT);
      frames = 0;
      fpsT = now;
    }
    requestAnimationFrame(frame);
  }

  // Test hook: hand-crank n frames (a hidden or background tab may throttle requestAnimationFrame).
  function pump(n = 1, stepMs = 16) {
    for (let i = 0; i < n; i++) {
      const now = last + stepMs;
      for (const fn of updaters) fn(stepMs, now);
      render(stepMs, now);
      last = now;
    }
  }

  requestAnimationFrame(frame);
  return {
    wake, add, pump, fps: () => fps,
    set onRendered(fn) { onRendered = fn; },
  };
}
