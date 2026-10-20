// Fog on a mirror or a glass pane: a thin lit layer whose thickness follows the room's humidity, clearing from the
// edges first when the air dries. A finger can wipe it (wipe), the fog creeps back over about 20-40 s, a fingertip
// can write in it (write, used for "Ta gjerne på alt" at the start), and a heated pad behind the mirror
// (setHeater) clears its rectangle from the centre out and keeps it clear (demist(front) clears it the same way once,
// without warmth: the greeting's demister). After a long steamy spell a few drops run down and leave clear trails.
// The wiped/written state is a small grid (fogMask.js) uploaded as a texture.
//
// createFog(ctx, { surface: 'mirror' | 'glass', ... }) -> { object3d, update(dtMs), setHumidity, setDensity, setHeater,
//   demist(front), wipe(uv, radiusM?, fromUv?), endStroke, write(text, opts) -> handle, clear, density, heat, mask, ... }
// uv: { x, y } or [u, v] in 0..1 across the surface (a raycast's uv on object3d works directly).
import * as THREE from 'three';
import { LAYOUT } from '../data/layout.js';
import { GLSL_NOISE } from './glsl.js';
import { inject, toVec3, qualityOf, stepSeconds } from './waterMaterial.js';
import { createMask, stampDisc, stampSegment, regrow, heatRect, toBytes, clearMask } from './fogMask.js';
import { layoutText } from './fogFont.js';
import { createRng, clamp01, smoothstep } from './rng.js';

export const FOG_GLSL = {
  vertexPars: /* glsl */ `
varying vec2 vFxUv;
`,
  vertexMain: /* glsl */ `
	vFxUv = uv;
`,
  fragmentPars: /* glsl */ `
uniform sampler2D uFxMask;
uniform float uFxDensity;
uniform float uFxMaxOpacity;
uniform vec2 uFxSize;
uniform float uFxGradient;
varying vec2 vFxUv;
${GLSL_NOISE}
`,
  // after #include <alphamap_fragment>
  fragmentMain: /* glsl */ `
	float fxClear = texture2D( uFxMask, vFxUv ).r;
	vec2 fxP = vFxUv * uFxSize;
	vec2 fxE2 = min( vFxUv, 1.0 - vFxUv ) * uFxSize;
	float fxEdge = smoothstep( 0.0, 0.16, min( fxE2.x, fxE2.y ) );
	float fxGrainK = 1.0 - smoothstep( 0.0008, 0.0025, length( fwidth( fxP ) ) );
	float fxGrain = mix( 0.5, fx_noise2( fxP * 900.0 ), fxGrainK );
	float fxMott = fx_noise2( fxP * 18.0 ) * 0.6 + fx_noise2( fxP * 47.0 ) * 0.4;
	float fxLocal = uFxDensity * ( 0.72 + 0.28 * fxEdge ) * mix( 1.0, 0.55 + 0.45 * vFxUv.y, uFxGradient ) + ( fxMott - 0.5 ) * 0.12;
	float fxFog = smoothstep( 0.08, 0.45, fxLocal );
	fxFog *= 1.0 - fxClear * ( 0.95 - 0.06 * fxGrain );
	fxFog *= 0.9 + 0.1 * fxGrain;
	diffuseColor.a *= uFxMaxOpacity * fxFog;
	if ( diffuseColor.a < 0.002 ) discard;
`,
};

function readUv(uv) {
  if (!uv) return null;
  if (Array.isArray(uv)) return { u: uv[0], v: uv[1] };
  return { u: uv.x, v: uv.y };
}

export function createFog(ctx, opts = {}) {
  const low = qualityOf(ctx) === 'low';
  const layout = (ctx && ctx.layout) || LAYOUT;
  const kind = opts.surface === 'glass' ? 'glass' : 'mirror';
  let width;
  let height;
  let centre;
  let normal;
  if (kind === 'mirror') {
    const m = layout.mirror;
    width = opts.width ?? (m.x1 - m.x0 - 0.01);
    height = opts.height ?? (m.y1 - m.y0 - 0.01);
    centre = toVec3(opts.position, { x: (m.x0 + m.x1) / 2, y: (m.y0 + m.y1) / 2, z: m.depth + 0.0015 });
    normal = toVec3(opts.normal, { x: 0, y: 0, z: 1 });
  } else {
    const g = layout.shower.glass;
    width = opts.width ?? (g.z1 - g.z0);
    height = opts.height ?? g.height;
    // on the room side of the pane (the visitor never stands inside the shower)
    centre = toVec3(opts.position, { x: g.x + g.thickness / 2 + 0.0015, y: (opts.bottom ?? 0) + height / 2, z: (g.z0 + g.z1) / 2 });
    normal = toVec3(opts.normal, { x: 1, y: 0, z: 0 });
  }
  const pxPerM = opts.pxPerMetre ?? (kind === 'mirror' ? (low ? 160 : 384) : (low ? 80 : 160));
  const mw = Math.min(1024, Math.max(4, Math.round(width * pxPerM)));
  const mh = Math.min(1024, Math.max(4, Math.round(height * pxPerM)));
  const sx = mw / width; // mask pixels per metre, across
  const sy = mh / height; // and up
  const mask = createMask(mw, mh);
  const bytes = new Uint8Array(mw * mh);
  const tex = new THREE.DataTexture(bytes, mw, mh, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1; // one byte per pixel and widths that are not a multiple of 4: rows must not be padded
  tex.name = `fx-fog-mask-${kind}`;
  tex.needsUpdate = true;

  const fingerRadius = opts.fingerRadius ?? 0.011; // a fingertip wipe leaves a trail about 2 cm wide
  const feather = opts.feather ?? 0.004;
  const regrowSeconds = opts.regrowSeconds ?? 30;
  const sensitivity = opts.sensitivity ?? (kind === 'glass' ? 1.15 : 1);
  const heaterUv = opts.heater === null ? null
    : opts.heater || (kind === 'mirror' ? { u0: 0.15, u1: 0.85, v0: 0.12, v1: 0.88 } : null);
  const heaterRect = heaterUv ? { x0: heaterUv.u0 * mw, x1: heaterUv.u1 * mw, y0: heaterUv.v0 * mh, y1: heaterUv.v1 * mh } : null;
  // the heated edge is soft over about 6 % of the pad; at full heat the clear area reaches the pad's corners
  // (rounded-rectangle distance up to 2^(1/4) = 1.19) plus that soft edge
  const heaterFeatherPx = heaterRect ? Math.max(1, 0.06 * Math.min(heaterRect.x1 - heaterRect.x0, heaterRect.y1 - heaterRect.y0)) : 0;
  // keepClear: a pad that is always warm (an LED mirror's demister behind its display): its patch never fogs
  const keepUv = opts.keepClear || null;
  const keepRect = keepUv ? { x0: keepUv.u0 * mw, x1: keepUv.u1 * mw, y0: keepUv.v0 * mh, y1: keepUv.v1 * mh } : null;
  const keepFeatherPx = keepRect ? Math.max(1, 0.08 * Math.min(keepRect.x1 - keepRect.x0, keepRect.y1 - keepRect.y0)) : 0;
  const keepReach = keepRect ? 1.2 + keepFeatherPx / (Math.min(keepRect.x1 - keepRect.x0, keepRect.y1 - keepRect.y0) / 2) : 0;
  const heaterReach = heaterRect
    ? 1.2 + heaterFeatherPx / (Math.min(heaterRect.x1 - heaterRect.x0, heaterRect.y1 - heaterRect.y0) / 2)
    : 0;
  const onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : null;

  const U = {
    uFxMask: { value: tex },
    uFxDensity: { value: 0 },
    uFxMaxOpacity: { value: opts.maxOpacity ?? (kind === 'mirror' ? 0.97 : 0.72) },
    uFxSize: { value: new THREE.Vector2(width, height) },
    uFxGradient: { value: opts.gradient ?? (kind === 'glass' ? 1 : 0) },
  };
  // Fog on a mirror is fogged glass over the mirror's own reflection: the droplets blur what the mirror shows (a
  // rough, mostly reflective sheen of the room: main.js gives it the room's box-projected reflection) and add a little
  // white haze; where the fog is thick the sharp reflection hardly shows. Fog on clear glass is a white haze.
  const look = kind === 'mirror' ? { roughness: 0.5, metalness: 0.72 } : { roughness: 0.55, metalness: 0 };
  const mat = new THREE.MeshStandardMaterial({
    color: opts.color ?? (kind === 'mirror' ? 0xf1f0ed : 0xeceeed),
    roughness: opts.roughness ?? look.roughness,
    metalness: opts.metalness ?? look.metalness,
    transparent: true,
    depthWrite: false,
    side: kind === 'glass' ? THREE.DoubleSide : THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  mat.name = 'fx-fog';
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = inject(shader.vertexShader, '#include <common>', FOG_GLSL.vertexPars);
    shader.vertexShader = inject(shader.vertexShader, '#include <uv_vertex>', FOG_GLSL.vertexMain);
    shader.fragmentShader = inject(shader.fragmentShader, '#include <common>', FOG_GLSL.fragmentPars);
    shader.fragmentShader = inject(shader.fragmentShader, '#include <alphamap_fragment>', FOG_GLSL.fragmentMain);
  };
  mat.customProgramCacheKey = () => 'fx-fog';
  // Either its own plane, or overlays that ride on given meshes (opts.targets, for example the mirror cabinet's two
  // door faces, whose uv spans the whole closed mirror): each overlay reuses the target's geometry, sits a hair in
  // front of it (local +z) and swings with it when a door opens. One mask covers them all.
  const targets = Array.isArray(opts.targets) ? opts.targets.filter((t) => t && t.isMesh) : [];
  const meshes = [];
  let object3d;
  if (targets.length) {
    object3d = new THREE.Group();
    object3d.name = `fx-fog-${kind}`;
    for (const t of targets) {
      const o = new THREE.Mesh(t.geometry, mat);
      o.name = `fx-fog-${kind}-overlay`;
      o.position.z = opts.offset ?? 0.0012;
      o.renderOrder = 4;
      o.visible = false;
      t.add(o);
      meshes.push(o);
    }
  } else {
    object3d = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    object3d.name = `fx-fog-${kind}`;
    object3d.position.copy(centre);
    object3d.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
    object3d.renderOrder = 4;
    object3d.visible = false;
    meshes.push(object3d);
  }
  let shown = false;
  function setShown(v) {
    if (v === shown) return false;
    shown = v;
    for (const o of meshes) o.visible = v;
    return true;
  }

  let humidity = clamp01(opts.humidity ?? 0);
  let override = Number.isFinite(opts.density) ? clamp01(opts.density) : null;
  let density = override ?? 0;
  let heaterOn = !!opts.heaterOn;
  let heat = heaterOn ? 1 : 0;
  let hold = 0;
  let tickAcc = 0;
  let uploadNow = true;
  let last = null; // last wipe point (px) while a finger stroke goes on
  let writer = null;
  const rng = createRng(opts.seed ?? 41);
  const runners = [];
  let steamy = 0; // seconds of heavy fog, for the running drops

  function target() {
    if (override !== null) return override;
    return smoothstep(0.22, 0.65, humidity * sensitivity);
  }

  function px(u, v) {
    return { x: u * mw, y: v * mh };
  }

  // Wipe with a fingertip. radius in metres (default a fingertip); a stroke continues from the previous call until
  // endStroke(), or from fromUv when given.
  function wipe(uv, radius = fingerRadius, fromUv = null) {
    const p = readUv(uv);
    if (!p) return;
    const b = px(p.u, p.v);
    const r = radius * sx;
    const f = feather * sx;
    const from = fromUv ? readUv(fromUv) : null;
    const a = from ? px(from.u, from.v) : last;
    if (a) stampSegment(mask, a.x, a.y, b.x, b.y, r, f);
    else stampDisc(mask, b.x, b.y, r, f);
    last = b;
    uploadNow = true;
  }

  function endStroke() {
    last = null;
  }

  // Write text with a fingertip. opts: u, v (where the middle of the line goes, 0..1), size (metres per em; the
  // lowercase letters are half that tall), speed (m/s of finger travel), radius (m), seed, instant, hold (seconds the
  // writing stays before the fog starts to creep back).
  function write(text, o = {}) {
    if (writer) writer.handle.done = true; // a new message replaces one still being written
    writer = null;
    let size = o.size ?? Math.min(0.1, height * 0.16);
    let lay = layoutText(text, { size, x: (o.u ?? 0.5) * width, y: (o.v ?? 0.62) * height, seed: o.seed ?? 3, slant: o.slant, jitter: o.jitter });
    if (lay.bounds.x1 - lay.bounds.x0 > width * 0.9) {
      size *= (width * 0.9) / (lay.bounds.x1 - lay.bounds.x0);
      lay = layoutText(text, { size, x: (o.u ?? 0.5) * width, y: (o.v ?? 0.62) * height, seed: o.seed ?? 3, slant: o.slant, jitter: o.jitter });
    }
    const speed = o.speed ?? 0.5;
    const radius = o.radius ?? Math.max(0.005, size * 0.068);
    const strokes = lay.strokes;
    let duration = lay.length / speed;
    for (let k = 1; k < strokes.length; k++) {
      const a = strokes[k - 1];
      const b = strokes[k];
      duration += 0.07 + Math.hypot(b[0] - a[a.length - 2], b[1] - a[a.length - 1]) / 1.2;
    }
    const handle = {
      done: false,
      duration,
      cancel() { if (writer === w) writer = null; handle.done = true; },
    };
    const w = { strokes, si: 0, pi: 0, carry: 0, pause: 0, speed, radius, travelled: 0, started: false, handle, hold: o.hold ?? 8 };
    if (o.instant) {
      for (const s of strokes) {
        stampDisc(mask, s[0] * sx, s[1] * sy, radius * 1.15 * sx, feather * sx);
        for (let k = 2; k < s.length; k += 2) stampSegment(mask, s[k - 2] * sx, s[k - 1] * sy, s[k] * sx, s[k + 1] * sy, radius * sx, feather * sx);
      }
      handle.done = true;
      hold = Math.max(hold, w.hold);
      uploadNow = true;
      return handle;
    }
    writer = w;
    return handle;
  }

  function stampWriter(ax, ay, bx, by, r) {
    stampSegment(mask, ax * sx, ay * sy, bx * sx, by * sy, r * sx, feather * sx);
  }

  function advanceWriter(dt) {
    const w = writer;
    let tl = dt;
    while (tl > 0 && writer === w) {
      if (w.pause > 0) {
        const take = Math.min(w.pause, tl);
        w.pause -= take;
        tl -= take;
        continue;
      }
      const s = w.strokes[w.si];
      if (!w.started) {
        // the fingertip lands: a slightly bigger blob
        stampDisc(mask, s[0] * sx, s[1] * sy, w.radius * 1.15 * sx, feather * sx);
        w.started = true;
      }
      if (w.pi * 2 + 2 >= s.length) {
        // stroke finished: lift, move to the next
        w.si++;
        w.pi = 0;
        w.carry = 0;
        w.started = false;
        if (w.si >= w.strokes.length) {
          w.handle.done = true;
          hold = Math.max(hold, w.hold);
          writer = null;
          if (onEvent) onEvent('written', w.handle);
          break;
        }
        const n = w.strokes[w.si];
        w.pause = 0.07 + Math.hypot(n[0] - s[s.length - 2], n[1] - s[s.length - 1]) / 1.2;
        continue;
      }
      const ax = s[w.pi * 2];
      const ay = s[w.pi * 2 + 1];
      const bx = s[w.pi * 2 + 2];
      const by = s[w.pi * 2 + 3];
      const seg = Math.hypot(bx - ax, by - ay);
      const rem = seg - w.carry;
      const go = tl * w.speed;
      const r = w.radius * (1 + 0.06 * Math.sin(w.travelled * 40));
      const t0 = seg > 0 ? w.carry / seg : 0;
      if (go < rem) {
        const t1 = seg > 0 ? (w.carry + go) / seg : 1;
        stampWriter(ax + (bx - ax) * t0, ay + (by - ay) * t0, ax + (bx - ax) * t1, ay + (by - ay) * t1, r);
        w.carry += go;
        w.travelled += go;
        tl = 0;
      } else {
        stampWriter(ax + (bx - ax) * t0, ay + (by - ay) * t0, bx, by, r);
        tl -= rem / w.speed;
        w.travelled += rem;
        w.pi++;
        w.carry = 0;
      }
    }
    uploadNow = true;
  }

  // a few drops run down a long-fogged glass and leave clear trails
  function stepRunners(dt) {
    if (density > 0.85 && humidity * sensitivity > 0.6) steamy += dt;
    else steamy = Math.max(0, steamy - dt * 2);
    const want = opts.runs ?? true;
    if (want && steamy > 15 && runners.length < (low ? 2 : 3) && rng.next() < dt * (low ? 0.1 : 0.25)) {
      runners.push({
        x: rng.range(0.04, width - 0.04),
        y: rng.range(height * 0.3, height - 0.03),
        v: rng.range(0.02, 0.06),
        left: rng.range(0.05, 0.3),
        r: rng.range(0.0018, 0.0028),
        ph: rng.next() * 6,
      });
    }
    for (let i = runners.length - 1; i >= 0; i--) {
      const d = runners[i];
      const step = d.v * dt;
      const nx = d.x + Math.sin(d.ph + d.y * 60) * 0.0006;
      const ny = d.y - step;
      stampSegment(mask, d.x * sx, d.y * sy, nx * sx, ny * sy, d.r * sx, d.r * 0.5 * sx, 0.9);
      d.x = nx;
      d.y = ny;
      d.left -= step;
      if (d.left <= 0 || d.y < 0.01) runners.splice(i, 1);
    }
  }

  function update(dtMs) {
    const dt = stepSeconds(dtMs, 250);
    if (dt <= 0) return false;
    const tgt = target();
    const before = density;
    density += (tgt - density) * (1 - Math.exp(-dt / (tgt > density ? 5 : 14)));
    if (Math.abs(tgt - density) < 1e-4) density = tgt;
    U.uFxDensity.value = density;
    heat += ((heaterOn ? 1 : 0) - heat) * (1 - Math.exp(-dt / (heaterOn ? 2.5 : 15)));
    const writing = writer !== null;
    if (writer) advanceWriter(dt);
    // slower work on the mask runs about 15 times a second
    tickAcc += dt;
    if (tickAcc >= 1 / 15) {
      const t = tickAcc;
      tickAcc = 0;
      if (hold > 0) hold = Math.max(0, hold - t);
      else regrow(mask, t, regrowSeconds, override !== null ? (override > 0.2 ? 1 : 0) : clamp01(tgt / 0.6));
      if (heaterRect && heat > 0.016) heatRect(mask, heaterRect, heat * heaterReach, heaterFeatherPx);
      if (keepRect) heatRect(mask, keepRect, keepReach, keepFeatherPx);
      stepRunners(t);
      if (mask.dirty) uploadNow = true;
    }
    let uploaded = false;
    if (uploadNow && mask.dirty) {
      toBytes(mask, bytes);
      tex.needsUpdate = true;
      uploaded = true;
    }
    uploadNow = false;
    const toggled = setShown(density > 0.003);
    // still moving: the fog thickens or thins, a finger writes, or the mask changed while the fog shows
    return toggled || (shown && (Math.abs(density - before) > 2e-4 || writing || uploaded));
  }

  return {
    object3d,
    meshes, // what a raycast for wiping should test (their uv is the mask's uv)
    update,
    setHumidity(h) { humidity = clamp01(h); },
    // force a fog amount (0..1), for example a mirror already fogged at the start; null hands it back to humidity
    setDensity(d, immediate = false) {
      override = d === null || d === undefined ? null : clamp01(d);
      if (immediate && override !== null) density = override;
    },
    setHeater(on) { heaterOn = !!on; },
    // The demister by hand (the greeting's): its front, 0..1 from the pad's middle out to its corners, clears the pad
    // as the heater does but leaves no warmth behind, so steam later fogs the glass again like any wiped glass.
    demist(front) {
      if (!heaterRect || !(front > 0)) return;
      heatRect(mask, heaterRect, Math.min(1, front) * heaterReach, heaterFeatherPx);
      uploadNow = true;
    },
    wipe,
    endStroke,
    write,
    // fog everywhere again (forget wipes and writing)
    clear() { clearMask(mask); writer = null; runners.length = 0; hold = 0; uploadNow = true; },
    get density() { return density; },
    get humidity() { return humidity; },
    get heat() { return heat; },
    get heaterOn() { return heaterOn; },
    get writing() { return writer !== null; },
    get holding() { return hold; },
    mask,
    width,
    height,
    resolution: { w: mw, h: mh },
    kind,
    dispose() {
      if (targets.length) for (const o of meshes) o.removeFromParent(); // the targets own their geometry
      else object3d.geometry.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
