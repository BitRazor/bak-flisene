// Steam: soft, irregular puffs rising from hot water (the shower, the basin), drifting with slow eddies, spreading
// under the ceiling, and pulled toward the ceiling vent while the fan runs. The amount follows temperature x flow
// (steamStrength in humidity.js). Puffs never grow into a wall, the floor, the ceiling or the shower glass, so their
// flat edges never show. One draw call; the puff texture is made in code (no image file).
//
// createSteam(ctx, opts) -> { object3d, update(dtMs), setFlow, setTemperature, setStrength, setFan, setHumidity,
//   setSource, setLightLevel, strength, alive, dispose }
import * as THREE from 'three';
import { LAYOUT } from '../data/layout.js';
import { steamStrength } from './humidity.js';
import { createRng, clamp01, smoothstep } from './rng.js';
import { toVec3, qualityOf, stepSeconds } from './waterMaterial.js';

export const STEAM_GLSL = {
  vertex: /* glsl */ `
uniform float uFxNear;
attribute vec3 iPos;
attribute vec4 iData;
varying vec2 vFxUv;
varying float vFxA;
varying float vFxCell;
varying float vFxUp;
void main() {
	vec4 mv = modelViewMatrix * vec4( iPos, 1.0 );
	float c = cos( iData.z );
	float s = sin( iData.z );
	vec2 q = vec2( c * position.x - s * position.y, s * position.x + c * position.y );
	mv.xy += q * iData.x;
	gl_Position = projectionMatrix * mv;
	vFxUv = position.xy + 0.5;
	vFxUp = q.y + 0.5;
	vFxA = iData.y * smoothstep( uFxNear, uFxNear * 3.0, - mv.z );
	vFxCell = iData.w;
	if ( vFxA < 0.0005 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
}
`,
  fragment: /* glsl */ `
uniform sampler2D uFxTex;
uniform vec3 uFxColor;
varying vec2 vFxUv;
varying float vFxA;
varying float vFxCell;
varying float vFxUp;
void main() {
	float cell = floor( vFxCell * 3.999 );
	vec2 off = vec2( mod( cell, 2.0 ), floor( cell / 2.0 ) ) * 0.5;
	float t = texture2D( uFxTex, off + vFxUv * 0.5 ).r;
	float a = t * vFxA;
	if ( a < 0.002 ) discard;
	gl_FragColor = vec4( uFxColor * ( 0.88 + 0.12 * vFxUp ), a );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`,
};

// Four soft, uneven puffs in a 2 x 2 atlas (single channel). Value-noise fbm times a radial falloff.
export function makePuffAtlas(size = 128, seed = 5) {
  const half = size >> 1;
  const data = new Uint8Array(size * size);
  const rng = createRng(seed);
  const L = 16;
  const lat = new Float32Array(L * L);
  for (let k = 0; k < lat.length; k++) lat[k] = rng.next();
  const at = (x, y) => lat[(((y % L) + L) % L) * L + (((x % L) + L) % L)];
  function vnoise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * ux;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * ux;
    return a + (b - a) * uy;
  }
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * half;
    const oy = (cell >> 1) * half;
    const sx = cell * 5.3 + 1.1;
    const sy = cell * 2.9 + 4.7;
    for (let j = 0; j < half; j++) {
      for (let i = 0; i < half; i++) {
        const u = ((i + 0.5) / half) * 2 - 1;
        const v = ((j + 0.5) / half) * 2 - 1;
        const r = Math.sqrt(u * u + v * v);
        const fall = 1 - smoothstep(0.2, 1, r);
        let n = 0;
        let amp = 0.5;
        let f = 2.2;
        for (let o = 0; o < 4; o++) {
          n += amp * vnoise(u * f + sx, v * f + sy);
          f *= 2.03;
          amp *= 0.5;
        }
        n /= 0.9375;
        const val = fall * smoothstep(0.15, 0.85, n * 0.75 + fall * 0.45);
        data[(oy + j) * size + ox + i] = Math.round(clamp01(val) * 255);
      }
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1; // one byte per pixel
  tex.needsUpdate = true;
  tex.name = 'fx-steam-puffs';
  return tex;
}

// The shower: steam comes off the falling water and the hot floor, so the source fills the shower area (more of it low).
export function showerSteamSource(layout = LAYOUT) {
  const s = layout.shower;
  return { type: 'box', min: { x: s.x0 + 0.12, y: 0.1, z: s.z0 + 0.1 }, max: { x: s.x1 - 0.12, y: 1.7, z: s.z1 - 0.15 }, lowBias: 1.6 };
}

function normalizeSource(src) {
  if (src.type === 'disc') {
    return { type: 'disc', center: toVec3(src.center, { x: 0, y: 0, z: 0 }), radius: src.radius ?? 0.1, lowBias: 1 };
  }
  return { type: 'box', min: toVec3(src.min, { x: 0, y: 0, z: 0 }), max: toVec3(src.max, { x: 1, y: 1, z: 1 }), lowBias: src.lowBias ?? 1 };
}

export function createSteam(ctx, opts = {}) {
  const low = qualityOf(ctx) === 'low';
  const layout = (ctx && ctx.layout) || LAYOUT;
  const room = layout.room;
  const max = Math.max(4, Math.round(opts.maxParticles ?? (low ? 80 : 160)));
  const rateMax = opts.rate ?? (low ? 18 : 36); // puffs per second at full strength
  const sizeK = low ? 1.3 : 1; // fewer, slightly larger puffs on weak phones
  const rng = createRng(opts.seed ?? 31);
  let source = normalizeSource(opts.source || showerSteamSource(layout));
  const vent = toVec3(opts.vent, { x: layout.vent.x, y: room.H, z: layout.vent.z });
  const ceil = opts.ceilingY ?? room.H;
  const glass = opts.glass === null ? null : (opts.glass || layout.shower.glass);
  const baseColor = new THREE.Color(opts.color ?? 0xf1efeb);

  // particle state (fixed arrays, packed: 0..alive-1 are live)
  const P = new Float32Array(max * 3);
  const V = new Float32Array(max * 3);
  const age = new Float32Array(max);
  const life = new Float32Array(max);
  const size0 = new Float32Array(max);
  const grow = new Float32Array(max);
  const rot = new Float32Array(max);
  const spin = new Float32Array(max);
  const alpha0 = new Float32Array(max);
  const variant = new Float32Array(max);
  const seedArr = new Float32Array(max);
  let alive = 0;

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  const iData = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
  iPos.setUsage(THREE.DynamicDrawUsage);
  iData.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', iPos);
  geo.setAttribute('iData', iData);
  geo.instanceCount = 0;
  const tex = makePuffAtlas(low ? 64 : 128, (opts.seed ?? 31) + 2);
  const U = {
    uFxTex: { value: tex },
    uFxColor: { value: baseColor.clone().multiplyScalar(0.92) },
    uFxNear: { value: 0.15 },
  };
  const mat = new THREE.ShaderMaterial({
    name: 'fx-steam',
    uniforms: U,
    vertexShader: STEAM_GLSL.vertex,
    fragmentShader: STEAM_GLSL.fragment,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'fx-steam';
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.visible = false;

  let flow = 0;
  let temperature = 0;
  let extra = 0;
  let fan = 0;
  let humidity = 0;
  let acc = 0;
  let time = 0;

  function strength() {
    return Math.max(steamStrength(flow, temperature), clamp01(extra));
  }

  function spawn(s) {
    if (alive >= max) return;
    const i = alive++;
    let x; let y; let z;
    if (source.type === 'disc') {
      const r = source.radius * Math.sqrt(rng.next());
      const a = rng.next() * Math.PI * 2;
      x = source.center.x + Math.cos(a) * r;
      y = source.center.y + 0.01;
      z = source.center.z + Math.sin(a) * r;
    } else {
      x = rng.range(source.min.x, source.max.x);
      y = source.min.y + (source.max.y - source.min.y) * Math.pow(rng.next(), source.lowBias);
      z = rng.range(source.min.z, source.max.z);
    }
    P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z;
    V[i * 3] = rng.signed() * 0.03;
    V[i * 3 + 1] = rng.range(0.05, 0.14);
    V[i * 3 + 2] = rng.signed() * 0.03;
    age[i] = 0;
    life[i] = rng.range(3.5, 7) * (1 + humidity * 0.8);
    size0[i] = rng.range(0.12, 0.26) * sizeK * (source.type === 'disc' ? 0.6 : 1);
    grow[i] = rng.range(1.2, 2.4);
    rot[i] = rng.next() * Math.PI * 2;
    spin[i] = rng.signed() * 0.25;
    alpha0[i] = rng.range(0.05, 0.11) * (0.6 + 0.4 * s) * (low ? 1.4 : 1);
    variant[i] = rng.next();
    seedArr[i] = rng.next() * 10;
  }

  function kill(i) {
    const last = --alive;
    if (i === last) return;
    for (let c = 0; c < 3; c++) { P[i * 3 + c] = P[last * 3 + c]; V[i * 3 + c] = V[last * 3 + c]; }
    age[i] = age[last]; life[i] = life[last]; size0[i] = size0[last]; grow[i] = grow[last];
    rot[i] = rot[last]; spin[i] = spin[last]; alpha0[i] = alpha0[last]; variant[i] = variant[last]; seedArr[i] = seedArr[last];
  }

  // distance to the nearest surface the puff must not cut through
  function clearance(x, y, z) {
    let d = Math.min(y, ceil - y, x, room.W - x, z, room.D - z);
    if (glass && z >= glass.z0 && z <= glass.z1 && y <= glass.height) d = Math.min(d, Math.abs(x - glass.x));
    return Math.max(d, 0.005);
  }

  function update(dtMs) {
    const dtAll = stepSeconds(dtMs, 250);
    if (dtAll <= 0) return false;
    time += dtAll;
    const s = strength();
    acc += rateMax * s * dtAll;
    while (acc >= 1) {
      acc -= 1;
      spawn(s);
    }
    if (alive === 0 && acc < 1 && geo.instanceCount === 0) { mesh.visible = false; return false; }
    // move in steps of at most 50 ms
    const steps = Math.ceil(dtAll / 0.05);
    const dt = dtAll / steps;
    for (let st = 0; st < steps; st++) {
      const t = time - dtAll + dt * (st + 1);
      const kRise = 1 - Math.exp(-dt * 1.2);
      const damp = Math.exp(-dt * 0.7);
      for (let i = alive - 1; i >= 0; i--) {
        age[i] += dt;
        if (age[i] >= life[i]) { kill(i); continue; }
        const k = i * 3;
        let x = P[k]; let y = P[k + 1]; let z = P[k + 2];
        let vx = V[k]; let vy = V[k + 1]; let vz = V[k + 2];
        const sd = seedArr[i];
        // buoyancy: rises, slowing as it cools and mixes
        const riseT = 0.2 * (1 - 0.6 * (age[i] / life[i]));
        vy += (riseT - vy) * kRise;
        // slow eddies (a smooth field of position and time)
        const tx = Math.sin(y * 3.1 + t * 0.7 + sd * 6) + Math.sin(z * 4.3 - t * 0.53 + sd * 3);
        const tz = Math.sin(x * 3.7 - t * 0.61 + sd * 2) + Math.sin(y * 2.3 + t * 0.87 + sd * 5);
        vx = (vx + tx * 0.045 * dt) * damp;
        vz = (vz + tz * 0.045 * dt) * damp;
        // the fan pulls the air to the vent
        if (fan > 0) {
          const dx = vent.x - x; const dy = vent.y - y; const dz = vent.z - z;
          const d2 = dx * dx + dy * dy + dz * dz;
          const d = Math.sqrt(d2) + 1e-6;
          const pull = (fan * 0.5) / (d2 + 0.2);
          vx += (dx / d) * pull * dt;
          vy += (dy / d) * pull * dt;
          vz += (dz / d) * pull * dt;
          if (d < 0.14) age[i] = Math.max(age[i], life[i] - 0.3);
        }
        const nx = x + vx * dt;
        let ny = y + vy * dt;
        const nz = z + vz * dt;
        // the glass is a wall between the shower and the room
        let px = nx;
        if (glass && nz >= glass.z0 && nz <= glass.z1 && ny <= glass.height && (x < glass.x) !== (nx < glass.x)) {
          px = x;
          vx = -vx * 0.2;
        }
        // spread out under the ceiling instead of passing through it
        if (ny > ceil - 0.06) {
          ny = ceil - 0.06;
          if (vy > 0) vy = 0;
        }
        x = Math.min(room.W - 0.03, Math.max(0.03, px));
        y = Math.max(0.04, ny);
        z = Math.min(room.D - 0.03, Math.max(0.03, nz));
        P[k] = x; P[k + 1] = y; P[k + 2] = z;
        V[k] = vx; V[k + 1] = vy; V[k + 2] = vz;
        rot[i] += spin[i] * dt;
      }
    }
    // write the instance data
    const pa = iPos.array;
    const da = iData.array;
    for (let i = 0; i < alive; i++) {
      const k = i * 3;
      const f = age[i] / life[i];
      let sz = size0[i] * (1 + grow[i] * f);
      sz = Math.min(sz, 2.2 * clearance(P[k], P[k + 1], P[k + 2]));
      const fadeIn = smoothstep(0, 0.8, age[i]);
      const fadeOut = 1 - smoothstep(0.55, 1, f);
      pa[k] = P[k]; pa[k + 1] = P[k + 1]; pa[k + 2] = P[k + 2];
      da[i * 4] = sz;
      da[i * 4 + 1] = alpha0[i] * fadeIn * fadeOut;
      da[i * 4 + 2] = rot[i];
      da[i * 4 + 3] = variant[i];
    }
    geo.instanceCount = alive;
    iPos.clearUpdateRanges();
    iData.clearUpdateRanges();
    if (alive > 0) {
      iPos.addUpdateRange(0, alive * 3);
      iData.addUpdateRange(0, alive * 4);
    }
    iPos.needsUpdate = true;
    iData.needsUpdate = true;
    mesh.visible = alive > 0;
    return true; // puffs moved (or the last one just went)
  }

  return {
    object3d: mesh,
    update,
    setFlow(f) { flow = clamp01(f); },
    setTemperature(t) { temperature = clamp01(t); },
    // a direct amount (0..1), for example still-hot water in the basin after the tap closed
    setStrength(s) { extra = clamp01(s); },
    setFan(f) { fan = clamp01(f); },
    setHumidity(h) { humidity = clamp01(h); },
    // safe to call every frame (for the basin's rising surface): same shape -> values copied, nothing allocated
    setSource(src) {
      const type = src.type === 'disc' ? 'disc' : 'box';
      if (type !== source.type) { source = normalizeSource(src); return; }
      if (type === 'disc') {
        source.center.set(src.center.x, src.center.y, src.center.z);
        source.radius = src.radius ?? source.radius;
      } else {
        source.min.set(src.min.x, src.min.y, src.min.z);
        source.max.set(src.max.x, src.max.y, src.max.z);
        source.lowBias = src.lowBias ?? source.lowBias;
      }
    },
    setLightLevel(l) { U.uFxColor.value.copy(baseColor).multiplyScalar(0.92 * Math.max(0, Number.isFinite(l) ? l : 1)); },
    get strength() { return strength(); },
    get alive() { return alive; },
    get source() { return source; },
    dispose() { geo.dispose(); mat.dispose(); tex.dispose(); },
  };
}
