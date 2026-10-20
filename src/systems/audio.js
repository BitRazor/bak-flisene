// Real recorded sounds, played with the short echo of a small tiled room. Starts on the first touch (phones require
// it). Roles come from app/assets/sounds/manifest (never file paths in code). Missing roles stay silent, never crash.
// The first sounds a visitor hears (the room's echo, the door, footsteps, knocks) are downloaded as soon as the start
// view is on the screen (preload(), called by main.js; before that the hallway's own files go first), before any
// touch, so the first tap is never silent on a slow connection; they are decoded the moment the first touch unlocks
// sound, and everything else loads then. Sound pauses while the page is hidden (the
// visitor went to their mail app or locked the phone) and comes back when it shows.

export const FIRST_SOUNDS = [
  'ir_small_tiled', 'door_latch', 'door_open', 'footstep_wet', 'knock_wood', 'knock_paint', 'touch_tick',
  'switch_click', 'door_close',
];

export function createAudio() {
  let ctx = null;
  let master = null;
  let dry = null;
  let wet = null;
  let muted = false;
  let manifest = { sounds: {} };
  let base = '';
  const buffers = new Map(); // role -> AudioBuffer[]
  const loading = new Map();
  const loops = new Set();
  const bytes = new Map(); // file -> Promise<ArrayBuffer|null>, fetched before the first touch
  let decodingStarted = false;

  const fetchBytes = (file) => fetch(base + file).then((res) => (res.ok ? res.arrayBuffer() : null)).catch(() => null);

  function prefetch(roles) {
    for (const role of roles) {
      const entry = manifest.sounds && manifest.sounds[role];
      if (!entry || buffers.has(role) || loading.has(role)) continue;
      for (const file of entry.files) if (!bytes.has(file)) bytes.set(file, fetchBytes(file));
    }
  }

  // Once there is a context and a sound list: the echo first, then the first sounds, then everything else.
  function startDecoding() {
    if (decodingStarted || !ctx || !Object.keys(manifest.sounds || {}).length) return null;
    decodingStarted = true;
    const ir = load('ir_small_tiled').then((l) => { if (l && l[0] && wet) wet.buffer = l[0]; });
    for (const role of FIRST_SOUNDS) load(role);
    for (const role of Object.keys(manifest.sounds)) load(role);
    return ir;
  }

  async function unlock() {
    if (ctx) {
      if (ctx.state !== 'running' && !hidden()) { try { await ctx.resume(); } catch { /* the next touch tries again */ } }
      return;
    }
    // Let phone sound play even with the iPhone ring switch on silent (WebKit audio session), quietly.
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* not supported */ }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);
    dry = ctx.createGain();
    dry.gain.value = 1;
    dry.connect(master);
    wet = ctx.createConvolver();
    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.32;
    wet.connect(wetGain).connect(master);
    const ir = startDecoding();
    // the first sound waits a moment for the echo (it is already downloaded, so this is quick), never long
    if (ir) await Promise.race([ir, new Promise((r) => setTimeout(r, 250))]);
  }

  function setManifest(m, baseUrl) {
    manifest = m || { sounds: {} };
    base = baseUrl;
    startDecoding(); // a touch came before the list: decode now (the room's echo, then everything)
  }

  async function load(role) {
    if (buffers.has(role)) return buffers.get(role);
    if (loading.has(role)) return loading.get(role);
    const entry = manifest.sounds && manifest.sounds[role];
    if (!entry || !ctx) return null;
    const p = (async () => {
      const list = [];
      for (const file of entry.files) {
        try {
          const early = bytes.get(file);
          bytes.delete(file); // decoding uses the bytes up
          const arr = await (early || fetchBytes(file));
          if (arr) list.push(await ctx.decodeAudioData(arr));
        } catch (e) { console.warn('sound failed', role, file, e); }
      }
      buffers.set(role, list);
      return list;
    })();
    loading.set(role, p);
    return p;
  }

  function route(node, reverb) {
    node.connect(dry);
    if (reverb > 0 && wet.buffer) {
      const send = ctx.createGain();
      send.gain.value = reverb;
      node.connect(send).connect(wet);
    }
  }

  // The manifest's own level for a role (sounds were levelled against each other when they were made).
  const gainOf = (role) => {
    const g = manifest.sounds && manifest.sounds[role] && manifest.sounds[role].gain;
    return Number.isFinite(g) ? g : 1;
  };

  function play(role, { volume = 1, rate = 1, reverb = 1, delay = 0 } = {}) {
    if (!ctx) return null;
    const list = buffers.get(role);
    if (!list || !list.length) {
      // still loading (the first touch starts every download): play it as soon as it arrives, unless that is late
      const asked = ctx.currentTime;
      const p = load(role);
      if (p && p.then) p.then((l) => { if (l && l.length && ctx.currentTime - asked < 0.6) play(role, { volume, rate, reverb, delay }); });
      return null;
    }
    const src = ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    src.playbackRate.value = rate * (0.97 + Math.random() * 0.06); // slight drift so repeats never sound machine-made
    const g = ctx.createGain();
    g.gain.value = volume * gainOf(role);
    src.connect(g);
    route(g, reverb);
    src.start(ctx.currentTime + delay);
    return src;
  }

  function loop(role, { volume = 1, fade = 0.4, reverb = 1 } = {}) {
    const handle = { src: null, gain: null, stopped: false, role };
    if (!ctx) return { setVolume() {}, stop() {} };
    (async () => {
      const list = await load(role);
      if (!list || !list.length || handle.stopped) return;
      const i = Math.floor(Math.random() * list.length);
      const src = ctx.createBufferSource();
      src.buffer = list[i];
      src.loop = true;
      // seamless loop points measured when the sound was made (manifest variants[i]); whole file otherwise
      const v = manifest.sounds[role].variants && manifest.sounds[role].variants[i];
      if (v && Number.isFinite(v.loopEnd) && v.loopEnd > (v.loopStart || 0)) {
        src.loopStart = v.loopStart || 0;
        src.loopEnd = Math.min(v.loopEnd, src.buffer.duration);
      }
      handle.level = gainOf(role);
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(volume * handle.level, ctx.currentTime + fade);
      src.connect(g);
      route(g, reverb);
      src.start();
      handle.src = src;
      handle.gain = g;
      loops.add(handle);
    })();
    handle.setVolume = (v, t = 0.2) => {
      if (!handle.gain) return;
      const now = ctx.currentTime;
      handle.gain.gain.cancelScheduledValues(now);
      handle.gain.gain.setValueAtTime(handle.gain.gain.value, now);
      handle.gain.gain.linearRampToValueAtTime(v * (handle.level ?? 1), now + t);
    };
    handle.setRate = (r) => { if (handle.src) handle.src.playbackRate.value = r; };
    handle.stop = (t = 0.35) => {
      handle.stopped = true;
      if (handle.gain) {
        handle.gain.gain.cancelScheduledValues(ctx.currentTime);
        handle.gain.gain.setValueAtTime(handle.gain.gain.value, ctx.currentTime);
        handle.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + t);
        handle.src.stop(ctx.currentTime + t + 0.05);
      }
      loops.delete(handle);
    };
    return handle;
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.05);
  }

  // The page hidden (mail app, another tab, a locked phone): the rain at an open window and any running water go quiet, and
  // come back when the visitor returns. If a phone refuses to resume without a touch, the next touch resumes it.
  const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
  function onVisibility() {
    if (!ctx) return;
    if (hidden()) { if (ctx.state === 'running') ctx.suspend().catch(() => {}); } else if (ctx.state !== 'running') ctx.resume().catch(() => {});
  }
  if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', onVisibility);
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('pagehide', () => { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); });

  return {
    unlock, setManifest, play, loop, setMuted, isMuted: () => muted, ready: () => !!ctx,
    preload: (roles = FIRST_SOUNDS) => prefetch(roles), // download (not decode) these now
  };
}
