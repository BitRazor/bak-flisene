// A falling stream of water from an outlet (a tap's aerator or a shower outlet) down to a surface.
// The column narrows as the water speeds up (continuity), carries fine moving ripples, sways a little lower down,
// breaks into beads when it is only a trickle, and is white-streaked when the outlet is aerated. Turning the flow on
// or off travels down the stream at the water's own speed (a short flow history), so the front falls and the tail
// detaches like the real thing. Droplets splash up where it lands.
//
// createWaterStream(ctx, opts) -> { object3d, update(dtMs), setFlow, setTemperature, setTargetY, setFrom,
//   setSurface, setContain, flow, landedFlow, impactPoint, running, dispose }
// object3d lives in room coordinates: add it to the scene root, not to a moved fixture group.
import * as THREE from 'three';
import { LAYOUT } from '../data/layout.js';
import { GLSL_NOISE, GLSL_BUMP } from './glsl.js';
import { inject, editChunk, makeWaterMaterial, toVec3, qualityOf, stepSeconds } from './waterMaterial.js';
import { createSplash } from './splash.js';
import { BASIN_DEFAULTS } from './basinModel.js';

const G = 9.81;
const HIST = 8; // flow samples kept for the travelling on/off and narrowing
const VALVE_RATE = 5; // flow units per second the valve can change

// Where the water leaves a tall vessel-basin mixer, until the tap fixture provides its own spout anchor:
// above the mixer's base on the counter, reaching 15 cm forward over the basin, 27 cm above the counter.
export function defaultTapOutlet(layout = LAYOUT) {
  const v = layout.vanity;
  return { x: v.mixer.x, y: v.top + 0.27, z: v.mixer.z + 0.15 };
}

export function defaultBasinFloorY(layout = LAYOUT) {
  return layout.vanity.top + BASIN_DEFAULTS.floor;
}

export const STREAM_GLSL = {
  vertexPars: /* glsl */ `
uniform float uFxTime;
uniform float uFxLength;
uniform float uFxV0;
uniform float uFxRMax;
uniform float uFxSway;
uniform float uFxSeed;
uniform float uFxHistDt;
uniform vec2 uFxExit;
uniform float uFxHist[ ${HIST} ];
varying vec2 vFxCirc;
varying float vFxTau;
varying float vFxNeck;
varying float vFxR;
varying float vFxFlow;
${GLSL_NOISE}
float fx_hist( float tf ) {
	float k = clamp( tf / uFxHistDt, 0.0, ${(HIST - 1).toFixed(1)} - 0.001 );
	float fk = floor( k );
	int i0 = int( fk );
	return mix( uFxHist[ i0 ], uFxHist[ i0 + 1 ], k - fk );
}
`,
  // after #include <beginnormal_vertex>: the stream's shape and its shading normal
  vertexNormal: /* glsl */ `
	float fxT = clamp( - position.y, 0.0, 1.0 );
	float fxD = fxT * uFxLength;
	float fxV = sqrt( uFxV0 * uFxV0 + 19.62 * fxD );
	float fxTf = ( fxV - uFxV0 ) / 9.81;
	float fxTau = uFxTime - fxTf;
	float fxFlow = fx_hist( fxTf );
	vec2 fxCirc = position.xz;
	float fxBase = uFxRMax * sqrt( max( fxFlow, 0.0 ) ) * sqrt( uFxV0 / fxV );
	// water that left the tap as a thin trickle necks into beads further down (Plateau-Rayleigh)
	float fxBreak = 1.0 - smoothstep( 0.05, 0.3, fxFlow );
	float fxGrow = clamp( fxTf * mix( 3.0, 14.0, fxBreak ), 0.0, 1.0 );
	float fxAmp = fxGrow * mix( 0.05, 1.05, fxBreak );
	float fxFreq = mix( 30.0, 55.0, fxBreak ) * 6.2831853;
	float fxPhase = fxTau * fxFreq;
	float fxNeck = 1.0 + fxAmp * sin( fxPhase );
	float fxRip = ( fx_noise3( vec3( fxCirc * 1.6, fxTau * 38.0 + uFxSeed ) ) - 0.5 ) * mix( 0.07, 0.18, fxGrow );
	float fxRad = fxBase * max( fxNeck + fxRip, 0.0 );
	vec2 fxSway = vec2( fx_noise3( vec3( fxTau * 2.1, uFxSeed, 0.5 ) ), fx_noise3( vec3( fxTau * 2.1, uFxSeed + 7.3, 3.5 ) ) ) - 0.5;
	vec2 fxOff = uFxExit * fxTf + fxSway * uFxSway * fxD;
	float fxDr = - fxBase * 4.905 / ( fxV * fxV ) - fxBase * fxAmp * cos( fxPhase ) * fxFreq / fxV;
	objectNormal = normalize( vec3( fxCirc.x, fxDr, fxCirc.y ) );
	vFxCirc = fxCirc;
	vFxTau = fxTau;
	vFxNeck = fxNeck + fxRip;
	vFxR = fxRad;
	vFxFlow = fxFlow;
`,
  // after #include <begin_vertex>
  vertexPosition: /* glsl */ `
	transformed = vec3( fxCirc.x * fxRad + fxOff.x, - fxD, fxCirc.y * fxRad + fxOff.y );
`,
  fragmentPars: /* glsl */ `
uniform float uFxAerate;
uniform float uFxAlpha;
uniform float uFxRipple;
varying vec2 vFxCirc;
varying float vFxTau;
varying float vFxNeck;
varying float vFxR;
varying float vFxFlow;
${GLSL_NOISE}
${GLSL_BUMP}
`,
  // after #include <normal_fragment_maps>
  fragmentMain: /* glsl */ `
	float fxH = ( fx_noise3( vec3( vFxCirc * 2.2, vFxTau * 52.0 ) ) * 0.65 + fx_noise3( vec3( vFxCirc * 4.7, vFxTau * 117.0 + 3.0 ) ) * 0.35 ) * vFxR * uFxRipple;
	normal = fx_bumpNormal( - vViewPosition, normal, fxH );
	// an aerator whitens a strong stream with air; a trickle comes out clear
	float fxFoam = uFxAerate * smoothstep( 0.15, 0.6, vFxFlow ) * smoothstep( 0.3, 0.85, fx_noise3( vec3( vFxCirc * 2.6, vFxTau * 24.0 + 11.0 ) ) );
	float fxFres = pow( 1.0 - clamp( abs( dot( normal, normalize( vViewPosition ) ) ), 0.0, 1.0 ), 3.0 );
	float fxAlpha = clamp( uFxAlpha + fxFres * 0.5 + fxFoam * 0.6, 0.0, 1.0 );
	diffuseColor.rgb = mix( vec3( 0.82, 0.9, 0.92 ), vec3( 1.0 ), fxFoam );
	if ( vFxR < 0.00012 || vFxNeck < 0.1 ) discard;
`,
};

function patchStream(shader, mode, U) {
  Object.assign(shader.uniforms, U);
  let vs = shader.vertexShader;
  vs = inject(vs, '#include <common>', STREAM_GLSL.vertexPars);
  vs = inject(vs, '#include <beginnormal_vertex>', STREAM_GLSL.vertexNormal);
  vs = inject(vs, '#include <begin_vertex>', STREAM_GLSL.vertexPosition);
  shader.vertexShader = vs;
  let fs = shader.fragmentShader;
  fs = inject(fs, '#include <common>', STREAM_GLSL.fragmentPars);
  fs = inject(fs, '#include <normal_fragment_maps>', STREAM_GLSL.fragmentMain);
  if (mode === 'transmission') {
    // foam (air bubbles) scatters light instead of letting it through
    fs = editChunk(fs, 'transmission_fragment', [
      ['material.transmission = transmission;', 'material.transmission = transmission * ( 1.0 - fxFoam * 0.85 );'],
    ]);
  }
  shader.fragmentShader = fs;
}

const _v = new THREE.Vector3();
// how droplets leave the impact: sideways and upward speeds (m/s) and radius (m)
const SPEC_HARD = { out: [0.1, 0.42], up: [0.22, 0.7], size: [0.0005, 0.0014], contain: null };
const SPEC_WATER = { out: [0.04, 0.22], up: [0.1, 0.42], size: [0.0004, 0.001], contain: null };

export function createWaterStream(ctx, opts = {}) {
  const low = qualityOf(ctx) === 'low';
  const layout = (ctx && ctx.layout) || LAYOUT;
  const from = toVec3(opts.from, defaultTapOutlet(layout));
  let targetY = opts.targetY ?? defaultBasinFloorY(layout);
  const rMax = opts.radius ?? 0.0085; // outlet radius at full flow (an aerator's stream is about 17 mm across)
  const vMax = opts.speed ?? 1.25; // exit speed at full flow, m/s
  const exitFull = toVec3(opts.exit, { x: 0, y: 0, z: 0 }); // sideways exit velocity at full flow (m/s)
  const transmission = opts.transmission ?? !low;
  const aerated = opts.aerated ?? true;
  const onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : null;
  let surface = opts.surface === 'water' ? 'water' : 'hard';
  let contain = opts.contain || null;

  const hist = new Float32Array(HIST);
  const U = {
    uFxTime: { value: 0 },
    uFxLength: { value: 0.25 },
    uFxV0: { value: vMax },
    uFxRMax: { value: rMax },
    uFxSway: { value: opts.sway ?? 0.012 },
    uFxSeed: { value: (opts.seed ?? 3) * 1.37 },
    uFxHistDt: { value: 0.035 },
    uFxExit: { value: new THREE.Vector2() },
    uFxHist: { value: hist },
    uFxAerate: { value: aerated ? 0.55 : 0 },
    uFxAlpha: { value: 0.1 },
    uFxRipple: { value: 0.07 },
  };

  const geo = new THREE.CylinderGeometry(1, 1, 1, low ? 10 : 16, low ? 28 : 56, true);
  geo.translate(0, -0.5, 0); // y runs 0 (outlet) .. -1 (target); the vertex shader stretches it to the real length
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.15, 0), 0.3);
  const mat = makeWaterMaterial({
    transmission,
    key: 'stream',
    thickness: rMax * 1.6,
    attenuationColor: 0xd6eef0,
    attenuationDistance: 0.4,
    patch: (shader, mode) => patchStream(shader, mode, U),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'fx-water-stream';
  mesh.position.copy(from);
  mesh.visible = false;
  mesh.renderOrder = 1;

  const splash = createSplash(ctx, { count: low ? 16 : 40, seed: (opts.seed ?? 3) + 11 });
  const group = new THREE.Group();
  group.name = 'fx-water-stream-group';
  group.add(mesh, splash.object3d);

  let target = 0;
  let flow = 0;
  let temperature = 0.5;
  let time = 0;
  let histClock = 0;
  let landed = 0;
  let landedOn = false;
  let emitAcc = 0;
  const impact = new THREE.Vector3();
  const evt = { position: impact, flow: 0 };

  function length() {
    return Math.max(0.01, from.y - targetY);
  }
  function exitScale(f) {
    return 0.35 + 0.65 * f;
  }
  function v0Of(f) {
    return vMax * exitScale(f);
  }
  function fallTime(L, v0) {
    return (Math.sqrt(v0 * v0 + 2 * G * L) - v0) / G;
  }
  function histAt(tf) {
    const k = Math.min(Math.max(tf / U.uFxHistDt.value, 0), HIST - 1 - 0.001);
    const i = Math.floor(k);
    return hist[i] + (hist[i + 1] - hist[i]) * (k - i);
  }
  function refreshGeometry() {
    const L = length();
    const v0 = v0Of(Math.max(flow, 0.05));
    U.uFxLength.value = L;
    // spread the flow history over the whole fall so on/off travels down all of it
    U.uFxHistDt.value = Math.max(0.02, fallTime(L, v0Of(0.05)) / (HIST - 1.5));
    const tf = fallTime(L, v0);
    const ex = exitFull.x * exitScale(flow) * tf;
    const ez = exitFull.z * exitScale(flow) * tf;
    impact.set(from.x + ex, targetY, from.z + ez);
    const bs = geo.boundingSphere;
    bs.center.set(ex / 2, -L / 2, ez / 2);
    bs.radius = L / 2 + 0.05 + Math.hypot(ex, ez) + L * 0.02;
  }
  refreshGeometry();

  function update(dtMs) {
    const dt = stepSeconds(dtMs);
    if (dt <= 0) return false;
    time += dt;
    U.uFxTime.value = time % 600;
    // the valve follows the lever at a limited rate (fully open or shut in about 0.2 s), so there is no endless
    // thinning tail and no jump
    const step = VALVE_RATE * dt;
    flow += Math.max(-step, Math.min(step, target - flow));
    histClock += dt;
    const hdt = U.uFxHistDt.value;
    while (histClock >= hdt) {
      for (let k = HIST - 1; k > 0; k--) hist[k] = hist[k - 1];
      histClock -= hdt;
    }
    hist[0] = flow;
    let any = 0;
    for (let k = 0; k < HIST; k++) if (hist[k] > any) any = hist[k];
    mesh.visible = any > 1e-4;

    const v0 = v0Of(flow);
    U.uFxV0.value = v0;
    U.uFxExit.value.set(exitFull.x * exitScale(flow), exitFull.z * exitScale(flow));
    if (transmission) mat.thickness = Math.max(0.002, rMax * 1.6 * Math.sqrt(flow));
    refreshGeometry();

    // the water arriving at the target now left the outlet one fall-time ago
    landed = histAt(fallTime(length(), v0));
    evt.flow = landed;
    if (!landedOn && landed > 0.02) {
      landedOn = true;
      if (onEvent) onEvent('start', evt);
    } else if (landedOn && landed <= 0.001) {
      landedOn = false;
      if (onEvent) onEvent('stop', evt);
    }

    // droplets thrown up where it lands (fewer when it lands in water)
    const rate = (low ? 70 : 150) * (surface === 'water' ? 0.35 : 1);
    emitAcc += rate * landed * dt;
    const n = Math.floor(emitAcc);
    if (n > 0) {
      emitAcc -= n;
      const spec = surface === 'water' ? SPEC_WATER : SPEC_HARD;
      spec.contain = contain;
      splash.emit(n, impact.x, impact.y, impact.z, spec);
    }
    splash.update(dt);
    return mesh.visible || splash.alive > 0;
  }

  return {
    object3d: group,
    parts: { stream: mesh, splash: splash.object3d },
    update,
    setFlow(f) { target = THREE.MathUtils.clamp(Number.isFinite(f) ? f : 0, 0, 1); },
    setTemperature(t) { temperature = THREE.MathUtils.clamp(Number.isFinite(t) ? t : 0, 0, 1); },
    setTargetY(y) { if (Number.isFinite(y)) { targetY = Math.min(y, from.y - 0.01); refreshGeometry(); } },
    setFrom(v) { from.set(v.x, v.y, v.z); mesh.position.copy(from); refreshGeometry(); },
    setSurface(kind) { surface = kind === 'water' ? 'water' : 'hard'; },
    setContain(c) { contain = c || null; },
    get flow() { return flow; },
    get targetFlow() { return target; },
    get temperature() { return temperature; },
    get landedFlow() { return landed; },
    get running() { return mesh.visible || splash.alive > 0; },
    get length() { return length(); },
    impactPoint: impact,
    outlet: from,
    worldImpact(out = _v) { return out.copy(impact); },
    dispose() { geo.dispose(); mat.dispose(); splash.dispose(); },
  };
}
