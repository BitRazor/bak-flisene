// The room's humidity: how steamed-up the air is, 0 (dry, normal) to 1 (saturated). Pure: no DOM, no three.js.
// Hot water adds steam; a little always leaks away; the fan and an open window take it out faster.
//
//   dh/dt = rise * steam * (1 - h)  -  (leak + fan * kFan + window * kWindow) * h
//
// For inputs that stay constant over a step this has an exact solution, so the result does not depend on the
// frame rate and can never leave 0..1. Time is compressed for the exhibit (a visitor should see the mirror fog
// within about 10-20 s of a hot shower, and clear within a minute of the fan), not a lab-accurate dew-point model.

import { clamp01, smoothstep } from './rng.js';

export const HUMIDITY = Object.freeze({
  rise: 1 / 20, // per second at full steam: about 20 s to most of the way there
  leak: 1 / 240, // the room's own slow drying (door gap, walls)
  fan: 1 / 25, // per second at full fan boost
  window: 1 / 40, // per second with the window fully open
  maxSteam: 2, // the sum of all sources is capped here
});

// How much steam hot water makes: 0 for cold water, rising smoothly from temperature 0.4 (about 28 degrees at the
// mixer, where breath-like steam starts to show) to 1 at full hot (55 degrees, the tap limit). flow and temperature 0..1.
export function steamStrength(flow, temperature) {
  return clamp01(flow) * smoothstep(0.4, 1, Number.isFinite(temperature) ? temperature : 0);
}

function finiteOr(x, fallback) {
  return Number.isFinite(x) ? x : fallback;
}

// One exact step. h 0..1, dtSec seconds, inputs { steam (0..maxSteam), fan (0..1), window (0..1) }.
export function humidityStep(h, dtSec, inputs = {}, params = HUMIDITY) {
  const h0 = clamp01(finiteOr(h, 0));
  const dt = Math.max(0, finiteOr(dtSec, 0));
  const steam = Math.min(params.maxSteam, Math.max(0, finiteOr(inputs.steam, 0)));
  const fan = clamp01(finiteOr(inputs.fan, 0));
  const win = clamp01(finiteOr(inputs.window, 0));
  const a = params.rise * steam;
  const b = params.leak + params.fan * fan + params.window * win;
  const k = a + b;
  if (!(k > 0) || dt === 0) return h0;
  const hInf = a / k;
  return clamp01(hInf + (h0 - hInf) * Math.exp(-k * dt));
}

// The shared model the room uses: named steam sources (shower, basin, ...), the fan and the window.
// update(dtMs) takes milliseconds, like core/tween.js and the render loop.
export function createHumidity({ value = 0, params = HUMIDITY } = {}) {
  const sources = new Map();
  let h = clamp01(value);
  let fan = 0;
  let win = 0;

  function totalSteam() {
    let s = 0;
    for (const src of sources.values()) s += src.weight * steamStrength(src.flow, src.temperature);
    return Math.min(params.maxSteam, s);
  }

  return {
    get value() { return h; },
    get steam() { return totalSteam(); },
    get fan() { return fan; },
    get window() { return win; },
    set(v) { h = clamp01(v); },
    // weight: how much this source steams compared with a full hot shower (a basin tap is about 0.35)
    setSource(name, flow, temperature, weight) {
      const src = sources.get(name) || { flow: 0, temperature: 0, weight: 1 };
      src.flow = flow;
      src.temperature = temperature;
      if (weight !== undefined) src.weight = Math.max(0, weight);
      sources.set(name, src);
    },
    removeSource(name) { sources.delete(name); },
    setFan(f) { fan = clamp01(f); },
    setWindow(w) { win = clamp01(w); },
    update(dtMs) {
      h = humidityStep(h, Math.min(Math.max(dtMs, 0), 1000) / 1000, { steam: totalSteam(), fan, window: win }, params);
      return h;
    },
  };
}
