// Puts the water, steam and fog into the room and runs them on the render loop. main.js calls install(ctx) after the
// fixtures (whose anchors it uses when ctx.fixtures has them: the tap's spout, the basin's own bowl profile, the rain
// head, the mirror doors, the shower glass) and before the interaction wiring, which drives the controls on the
// returned object (ctx.fx). Without fixtures everything falls back to LAYOUT.
//
// Controls: setTap(flow, temperature), setShower(flow, temperature), setPlug(open), setFan(f), setWindow(w),
//   setMirrorHeater(on), setDrip(on), setLightLevel(l), greet(text?) (the mirror wakes fogged with the line written
//   by a fingertip, then its demister clears it: GREETING), on(type, fn) for events ('tap:start', 'basin:full',
//   'basin:gurgle', 'drip:land', ...).
// Sound: the water's own sounds play through ctx.audio with the manifest's roles (tap_running, basin_fill,
//   shower_spray, drip, drain_gurgle) unless install(ctx, { sound: false }) or setSound(false).
import * as THREE from 'three';
import { LAYOUT } from '../data/layout.js';
import { LINES } from '../data/texts.js';
import { createWaterStream } from './waterStream.js';
import { createBasinWater } from './basinWater.js';
import { createShowerSpray } from './showerSpray.js';
import { createSteam } from './steam.js';
import { createFog } from './fog.js';
import { createDrip } from './drip.js';
import { createHumidity, steamStrength } from './humidity.js';
import { clamp01, smoothstep } from './rng.js';

// The greeting. The owner, 2026-10-19: "mirror should like mirror"; its fog stood thick for about 35 s and was gone
// only after about 90 s, so a first look at the mirror always met fog. Now: the mirror wakes fogged (density) and a
// fingertip writes the line; once written it holds holdS seconds to be read; then the mirror's own demister clears
// its pad from the middle out (demistS) and the rest of the fog fades (fadeS): a mirror again about 18 s after it
// greets. From then on the fog follows the room's air as before: a hot shower fogs it, a finger wipes it.
export const GREETING = { density: 0.85, holdS: 7, demistS: 2, fadeS: 2.5 };

export function install(ctx, opts = {}) {
  const fixtures = ctx.fixtures || {};
  const anchorsOf = (name) => (fixtures[name] && fixtures[name].anchors) || {};
  const partsOf = (name) => (fixtures[name] && fixtures[name].parts) || {};
  const low = ctx.quality === 'low';
  const layout = ctx.layout || LAYOUT;
  const listeners = new Map();
  const emit = (type, info) => {
    const set = listeners.get(type);
    if (set) for (const fn of set) fn(info);
  };
  const relay = (prefix) => (type, info) => emit(`${prefix}:${type}`, info);

  const humidity = createHumidity();
  const tap = createWaterStream(ctx, { from: anchorsOf('vanity').spout, onEvent: relay('tap') });
  const basin = createBasinWater(ctx, { anchor: anchorsOf('vanity').basinBase, onEvent: relay('basin') });
  tap.setContain({ x: basin.center.x, z: basin.center.z, radius: basin.rimRadius - 0.01 });
  const spray = createShowerSpray(ctx, { head: anchorsOf('shower').rainHead, onEvent: relay('shower') });
  const steamShower = createSteam(ctx, { seed: 31 });
  const basinSrc = { type: 'disc', center: { x: basin.center.x, y: basin.surfaceY, z: basin.center.z }, radius: 0.1 };
  const steamBasin = createSteam(ctx, { seed: 37, maxParticles: low ? 30 : 60, rate: low ? 8 : 16, source: basinSrc, glass: null });
  const mc = partsOf('mirrorCabinet');
  const faces = [mc.doorLeftFace, mc.doorRightFace].filter(Boolean);
  // the LED display's own demister keeps its patch of the mirror clear, so the screen reads through any fog
  const mirrorFog = createFog(ctx, {
    surface: 'mirror', targets: faces.length ? faces : undefined, onEvent: relay('mirror'), keepClear: layout.mirror.display,
  });
  // the glass fog covers the fixture's pane when there is one (it sits in a wall profile and clear of the floor)
  const glassOpts = { surface: 'glass' };
  const pane = partsOf('shower').glass;
  if (pane && pane.isMesh) {
    pane.updateWorldMatrix(true, false);
    const bb = new THREE.Box3().setFromObject(pane);
    Object.assign(glassOpts, {
      width: bb.max.z - bb.min.z,
      height: bb.max.y - bb.min.y,
      position: { x: bb.max.x + 0.0015, y: (bb.min.y + bb.max.y) / 2, z: (bb.min.z + bb.max.z) / 2 },
    });
  }
  const glassFog = createFog(ctx, glassOpts);
  const drip = createDrip(ctx, { head: anchorsOf('shower').rainHead, onEvent: relay('drip') });
  const effects = [tap, basin, spray, steamShower, steamBasin, mirrorFog, glassFog, drip];
  if (ctx.scene) for (const e of effects) ctx.scene.add(e.object3d);

  // the controls' settings (the interaction wiring writes these through the setters below)
  const state = {
    tapFlow: 0, tapTemp: 0.5, plug: false, showerFlow: 0, showerTemp: 0.5,
    fan: opts.fan ?? 0.5, // the fan's base speed runs all the time; 1 = boost
    window: 0, heater: false, drip: true,
  };
  let greeting = null; // the greeting under way: { t, start (demister on, s), demistS, fadeS, density, front }
  function stepGreeting(s) {
    const g = greeting;
    g.t += s;
    const into = g.t - g.start; // seconds since the demister came on
    if (into < 0) return;
    if (into < g.demistS) {
      const p = into / g.demistS;
      const front = 1 - (1 - p) * (1 - p); // quick at first, easing into the pad's corners
      if (front - g.front >= 0.02) { mirrorFog.demist(front); g.front = front; }
      return;
    }
    if (g.front < 1) { mirrorFog.demist(1); g.front = 1; }
    const q = (into - g.demistS) / g.fadeS;
    if (q < 1) { mirrorFog.setDensity(g.density * (1 - smoothstep(0, 1, q)), true); return; }
    mirrorFog.setDensity(null); // the room's air again
    greeting = null;
  }
  // The head empties drop by drop for a while after a shower, then stops. It never drips in a room nobody showered
  // in: a head that drips for ever reads as a leak, and it was a background sound that never ended (the owner,
  // 2026-10-19: no background sound that is always on).
  const DRIP_AFTER_S = 40;
  let dripLeft = 0;

  // ---- sound
  const audio = ctx.audio && typeof ctx.audio.play === 'function' && typeof ctx.audio.loop === 'function' ? ctx.audio : null;
  let soundOn = opts.sound !== false && !!audio;
  const loops = { tap: null, fill: null, shower: null };
  const sent = { tap: [0, 0], fill: [0, 0], shower: [0, 0] };
  function setLoop(key, role, volume, rate = 1) {
    if (!soundOn || volume <= 0.01) {
      if (loops[key]) { loops[key].stop(); loops[key] = null; }
      return;
    }
    if (!loops[key]) {
      loops[key] = audio.loop(role, { volume, fade: 0.25 });
      sent[key][0] = volume;
      sent[key][1] = 1;
    }
    const h = loops[key];
    if (Math.abs(sent[key][0] - volume) > 0.02 && h.setVolume) { h.setVolume(volume, 0.15); sent[key][0] = volume; }
    if (Math.abs(sent[key][1] - rate) > 0.01 && h.setRate) { h.setRate(rate); sent[key][1] = rate; }
  }
  function stopLoops() {
    for (const k of Object.keys(loops)) if (loops[k]) { loops[k].stop(); loops[k] = null; }
  }
  const oneShots = [
    ['drip:land', (i) => audio.play('drip', { volume: Math.min(0.9, 0.35 + (i?.speed ?? 6) * 0.07) })],
    ['basin:gurgle', () => audio.play('drain_gurgle', { volume: 0.8 })],
    ['basin:empty', () => audio.play('drain_gurgle', { volume: 0.45, rate: 1.15 })],
  ];
  for (const [type, fn] of oneShots) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add((info) => { if (soundOn) fn(info); });
  }
  function updateSound() {
    if (!audio) return;
    const into = smoothstep(0.003, 0.012, basin.depth); // the stream lands in water rather than on ceramic
    const landed = tap.landedFlow;
    setLoop('tap', 'tap_running', landed * (1 - 0.6 * into) * 0.9);
    // the filling basin's sound rises in pitch as the water deepens
    setLoop('fill', 'basin_fill', landed * into, 0.92 + 0.3 * basin.level);
    setLoop('shower', 'shower_spray', spray.landing ? spray.flow : 0);
  }

  // ---- one frame (dt in milliseconds, from the render loop); returns true while anything moves
  function step(dt) {
    tap.setFlow(state.tapFlow);
    tap.setTemperature(state.tapTemp);
    tap.setTargetY(basin.surfaceYAt(tap.impactPoint.x, tap.impactPoint.z));
    tap.setSurface(basin.depth > 0.004 ? 'water' : 'hard');
    basin.setInflow(tap.landedFlow);
    basin.setInflowTemperature(state.tapTemp);
    basin.setImpact(tap.impactPoint.x, tap.impactPoint.z);
    basin.setPlug(state.plug);
    spray.setFlow(state.showerFlow);
    spray.setTemperature(state.showerTemp);
    const showerOn = spray.landing ? state.showerFlow : 0;
    humidity.setSource('shower', showerOn, state.showerTemp, 1);
    humidity.setSource('tap', tap.landedFlow, state.tapTemp, 0.35);
    humidity.setSource('basin', basin.depth > 0.004 ? 1 : 0, basin.temperature, 0.12);
    humidity.setFan(state.fan);
    humidity.setWindow(state.window);
    humidity.update(dt);
    steamShower.setFlow(showerOn);
    steamShower.setTemperature(state.showerTemp);
    steamShower.setFan(state.fan);
    steamShower.setHumidity(humidity.value);
    basinSrc.center.y = basin.surfaceY;
    basinSrc.radius = Math.max(0.03, basin.radius * 0.8);
    steamBasin.setSource(basinSrc);
    steamBasin.setFlow(tap.landedFlow);
    steamBasin.setTemperature(state.tapTemp);
    steamBasin.setStrength(basin.depth > 0.004 ? 0.5 * steamStrength(1, basin.temperature) : 0);
    steamBasin.setFan(state.fan);
    steamBasin.setHumidity(humidity.value);
    mirrorFog.setHumidity(humidity.value);
    mirrorFog.setHeater(state.heater);
    glassFog.setHumidity(humidity.value);
    dripLeft = state.showerFlow > 0 ? DRIP_AFTER_S : Math.max(0, dripLeft - Math.max(0, dt) / 1000);
    drip.setActive(state.drip && state.showerFlow === 0 && dripLeft > 0);
    if (greeting) stepGreeting(Math.max(0, dt) / 1000);
    let busy = false;
    for (const e of effects) if (e.update(dt)) busy = true;
    updateSound();
    return busy;
  }
  const removeFromLoop = ctx.loop && typeof ctx.loop.add === 'function' ? ctx.loop.add(step) : null;
  const wake = () => { if (ctx.loop && typeof ctx.loop.wake === 'function') ctx.loop.wake(600); };

  return {
    tap, basin, spray, steam: { shower: steamShower, basin: steamBasin }, mirrorFog, glassFog, drip, humidity, state,
    setTap(flow, temperature) {
      if (Number.isFinite(flow)) state.tapFlow = clamp01(flow);
      if (Number.isFinite(temperature)) state.tapTemp = clamp01(temperature);
      wake();
    },
    setShower(flow, temperature) {
      if (Number.isFinite(flow)) state.showerFlow = clamp01(flow);
      if (Number.isFinite(temperature)) state.showerTemp = clamp01(temperature);
      wake();
    },
    setPlug(open) { state.plug = !!open; wake(); },
    setFan(f) { state.fan = clamp01(f); },
    setWindow(w) { state.window = clamp01(w); },
    setMirrorHeater(on) { state.heater = !!on; wake(); },
    setDrip(on) { state.drip = !!on; },
    setLightLevel(l) { spray.setLightLevel(l); steamShower.setLightLevel(l); steamBasin.setLightLevel(l); },
    // The mirror wakes fogged (as if someone just showered) and a fingertip writes the line; it holds to be read,
    // then the demister clears it and the fog follows the room's air again (GREETING; o may change its numbers).
    greet(text = LINES.touchAll, o = {}) {
      const { density = GREETING.density, holdS = GREETING.holdS, demistS = GREETING.demistS, fadeS = GREETING.fadeS, ...writing } = o;
      mirrorFog.setDensity(density, true);
      // the written line keeps its shape until the greeting is over (no creeping back under the forced fog)
      const handle = mirrorFog.write(text, { hold: holdS + demistS + fadeS, ...writing });
      greeting = { t: 0, start: handle.duration + holdS, demistS, fadeS, density, front: 0 };
      wake();
      return handle;
    },
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type).delete(fn);
    },
    setSound(on) { soundOn = !!on && !!audio; if (!soundOn) stopLoops(); },
    get sound() { return soundOn; },
    update: step,
    dispose() {
      if (removeFromLoop) removeFromLoop();
      stopLoops();
      for (const e of effects) { if (e.object3d.parent) e.object3d.removeFromParent(); e.dispose(); }
    },
  };
}
