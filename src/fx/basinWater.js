// Water in the round vessel basin: a surface that rises as the basin fills and falls as it drains, sized to the
// bowl's inner curve at that height. Ring waves and churn where the stream plunges in, a thin sheet with a
// hydraulic-jump ring while the water is shallow, waves that die away after the tap closes, a soft swirl and funnel
// over the open waste, a meniscus line where the water meets the ceramic, and faint caustics on the bottom.
// The level comes from basinModel.js (volume in, Torricelli out), so it is the same maths the tests check.
//
// createBasinWater(ctx, opts) -> { object3d, update(dtMs), setInflow(flow 0..1), setInflowTemperature(t),
//   setPlug(open), setImpact(x, z), setLevel(0..1), level, depth, volume (L), surfaceY, temperature, ... }
// Events through opts.onEvent(type, info): 'full', 'drainStart', 'gurgle', 'empty'.
import * as THREE from 'three';
import { LAYOUT } from '../data/layout.js';
import { GLSL_NOISE, GLSL_BUMP } from './glsl.js';
import { inject, editChunk, makeWaterMaterial, qualityOf, stepSeconds, toVec3 } from './waterMaterial.js';
import {
  BASIN_DEFAULTS, basinDims, vesselProfile, pointsProfile, makeVolumeTable, createBasinState, basinStep,
} from './basinModel.js';

const smooth = THREE.MathUtils.smoothstep;
const clamp = THREE.MathUtils.clamp;

export const BASIN_GLSL = {
  vertexPars: /* glsl */ `
uniform float uFxRadius;
uniform float uFxFunnel;
uniform vec2 uFxDrain;
varying vec2 vFxP;
varying vec3 vFxTx;
varying vec3 vFxTz;
`,
  // after #include <beginnormal_vertex>: unit ring -> metres, the funnel over the waste
  vertexNormal: /* glsl */ `
	vec2 fxP = position.xz * uFxRadius;
	vec2 fxS = fxP - uFxDrain;
	float fxDip = uFxFunnel * exp( - dot( fxS, fxS ) / 0.00032 );
	vec2 fxG = fxS * ( 2.0 / 0.00032 ) * fxDip;
	objectNormal = normalize( vec3( - fxG.x, 1.0, - fxG.y ) );
	vFxP = fxP;
	vFxTx = normalize( normalMatrix * vec3( 1.0, 0.0, 0.0 ) );
	vFxTz = normalize( normalMatrix * vec3( 0.0, 0.0, 1.0 ) );
`,
  vertexPosition: /* glsl */ `
	transformed = vec3( fxP.x, - fxDip, fxP.y );
`,
  fragmentPars: /* glsl */ `
uniform float uFxTime;
uniform vec2 uFxImpact;
uniform float uFxInflow;
uniform float uFxPlunge;
uniform float uFxJump;
uniform float uFxJumpR;
uniform float uFxWake;
uniform float uFxSwirl;
uniform vec2 uFxDrain;
uniform float uFxRadius;
uniform float uFxCaustic;
uniform float uFxDepthK;
uniform float uFxAlpha;
uniform float uFxVis;
varying vec2 vFxP;
varying vec3 vFxTx;
varying vec3 vFxTz;
${GLSL_NOISE}
${GLSL_BUMP}
// surface height in metres at p (local, metres from the basin centre); amplitudes below are in millimetres
float fx_height( vec2 p, float detail ) {
	float h = ( fx_noise3( vec3( p * 70.0, uFxTime * 0.5 ) ) - 0.5 ) * 0.06;
	vec2 q = p - uFxImpact;
	float r = length( q );
	vec2 dir = q / max( r, 0.0001 );
	float pl = uFxInflow * uFxPlunge;
	h += sin( r * 260.0 - uFxTime * 36.0 ) * exp( - r * 24.0 ) * 0.22 * pl;
	h += ( fx_noise3( vec3( q * 210.0, uFxTime * 8.0 ) ) - 0.5 ) * exp( - r * 60.0 ) * 0.9 * pl * detail;
	float jp = uFxInflow * uFxJump;
	float inner = 1.0 - smoothstep( uFxJumpR - 0.004, uFxJumpR, r );
	h += ( fx_noise3( vec3( dir * 3.5, r * 150.0 - uFxTime * 24.0 ) ) - 0.5 ) * 0.25 * inner * jp * detail;
	float rj = ( r - uFxJumpR ) / 0.005;
	h += exp( - rj * rj ) * ( 0.45 + 0.55 * fx_noise3( vec3( q * 260.0, uFxTime * 5.0 ) ) ) * 0.7 * jp;
	h += sin( r * 200.0 - uFxTime * 20.0 ) * exp( - r * 10.0 ) * 0.12 * uFxWake;
	vec2 s = p - uFxDrain;
	float rs = length( s ) + 0.003;
	float sa = atan( s.y, s.x + 0.00001 );
	h += sin( sa * 3.0 + log( rs ) * 9.0 + uFxTime * 7.0 ) * exp( - rs * 28.0 ) * 0.3 * uFxSwirl;
	float e = smoothstep( uFxRadius - 0.006, uFxRadius, length( p ) );
	h += e * e * 0.6;
	return h * 0.001;
}
`,
  // after #include <normal_fragment_maps> (precise normal: three height samples)
  fragmentMainHigh: /* glsl */ `
	float fxPix = length( fwidth( vFxP ) );
	float fxDetail = 1.0 - smoothstep( 0.0015, 0.004, fxPix );
	float fxH0 = fx_height( vFxP, fxDetail );
	float fxE = 0.0006;
	float fxHx = ( fx_height( vFxP + vec2( fxE, 0.0 ), fxDetail ) - fxH0 ) / fxE;
	float fxHz = ( fx_height( vFxP + vec2( 0.0, fxE ), fxDetail ) - fxH0 ) / fxE;
	normal = normalize( normal - fxHx * vFxTx - fxHz * vFxTz );
`,
  // after #include <normal_fragment_maps> (cheap normal: one sample and screen derivatives)
  fragmentMainLow: /* glsl */ `
	float fxPix = length( fwidth( vFxP ) );
	float fxDetail = 1.0 - smoothstep( 0.0015, 0.004, fxPix );
	float fxH0 = fx_height( vFxP, fxDetail );
	normal = fx_bumpNormal( - vViewPosition, normal, fxH0 );
`,
  fragmentShade: /* glsl */ `
	vec2 fxQ = vFxP - uFxImpact;
	float fxRq = length( fxQ );
	float fxFoam = smoothstep( 0.5, 0.82, fx_noise3( vec3( fxQ * 170.0, uFxTime * 3.0 ) ) ) * exp( - fxRq * 70.0 ) * uFxInflow * uFxPlunge;
	float fxRj = ( fxRq - uFxJumpR ) / 0.004;
	fxFoam = clamp( fxFoam + exp( - fxRj * fxRj ) * 0.35 * uFxJump * uFxInflow, 0.0, 1.0 );
	vec2 fxCp = vFxP * 55.0;
	float fxC1 = fx_noise3( vec3( fxCp, uFxTime * 0.9 ) );
	float fxC2 = fx_noise3( vec3( fxCp * 1.6 + 4.0, uFxTime * 1.3 ) );
	float fxCaus = pow( clamp( 1.0 - abs( fxC1 - fxC2 ) * 2.2, 0.0, 1.0 ), 5.0 ) * uFxCaustic * fxDetail;
	float fxFres = pow( 1.0 - clamp( abs( dot( normal, normalize( vViewPosition ) ) ), 0.0, 1.0 ), 5.0 );
	float fxAlpha = clamp( uFxAlpha + uFxDepthK * 0.06 + fxFres * 0.45 + fxFoam * 0.55, 0.0, 1.0 ) * uFxVis;
	diffuseColor.rgb = mix( mix( vec3( 0.9, 0.95, 0.96 ), vec3( 0.74, 0.88, 0.9 ), uFxDepthK ), vec3( 1.0 ), fxFoam );
	diffuseColor.a *= uFxVis;
`,
  // after #include <aomap_fragment>, blend mode only: caustic light seen through the water, reflections fade with the film
  afterLightsBlend: /* glsl */ `
	float fxLum = dot( reflectedLight.directDiffuse + reflectedLight.indirectDiffuse, vec3( 0.2126, 0.7152, 0.0722 ) ) / max( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ), 0.05 );
	totalEmissiveRadiance += vec3( fxCaus * fxLum * 0.45 * uFxVis );
	reflectedLight.directSpecular *= uFxVis;
	reflectedLight.indirectSpecular *= uFxVis;
`,
};

function patchBasin(shader, mode, U, low) {
  Object.assign(shader.uniforms, U);
  let vs = shader.vertexShader;
  vs = inject(vs, '#include <common>', BASIN_GLSL.vertexPars);
  vs = inject(vs, '#include <beginnormal_vertex>', BASIN_GLSL.vertexNormal);
  vs = inject(vs, '#include <begin_vertex>', BASIN_GLSL.vertexPosition);
  shader.vertexShader = vs;
  let fs = shader.fragmentShader;
  fs = inject(fs, '#include <common>', BASIN_GLSL.fragmentPars);
  fs = inject(fs, '#include <normal_fragment_maps>',
    (low ? BASIN_GLSL.fragmentMainLow : BASIN_GLSL.fragmentMainHigh) + BASIN_GLSL.fragmentShade);
  if (mode === 'transmission') {
    fs = editChunk(fs, 'transmission_fragment', [
      ['material.transmission = transmission;', 'material.transmission = transmission * ( 1.0 - fxFoam * 0.8 );'],
      ['totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );',
        'totalDiffuse = mix( totalDiffuse, transmitted.rgb * ( 1.0 + fxCaus * 1.5 ), material.transmission );'],
    ]);
  } else {
    fs = inject(fs, '#include <aomap_fragment>', BASIN_GLSL.afterLightsBlend);
  }
  shader.fragmentShader = fs;
}

export function createBasinWater(ctx, opts = {}) {
  const low = qualityOf(ctx) === 'low';
  const layout = (ctx && ctx.layout) || LAYOUT;
  const basin = opts.basin || layout.vanity.basin;
  const dims = basinDims(basin);
  // The bowl's shape: the vanity fixture's own profile when given (opts.anchor = anchors.basinBase, whose
  // userData.profile is [r, y] from the waste's edge to the rim and whose position is that lowest point), else
  // opts.profilePoints, opts.profile, or the default vessel curve.
  const anchorPos = opts.anchor && opts.anchor.isObject3D ? toVec3(opts.anchor) : null;
  const points = opts.profilePoints || (opts.anchor && opts.anchor.userData && opts.anchor.userData.profile) || null;
  const profile = points ? pointsProfile(points) : opts.profile || vesselProfile(dims);
  const table = makeVolumeTable(profile);
  const centre = anchorPos
    ? { x: anchorPos.x, z: anchorPos.z }
    : { x: opts.center?.x ?? basin.x, z: opts.center?.z ?? basin.z };
  const baseY = opts.baseY ?? layout.vanity.top; // the basin stands on the counter
  const bottomY = anchorPos ? anchorPos.y : baseY + (points ? profile.bottomOffset : dims.floor);
  const maxDepth = Math.min(profile.depth, (opts.maxFill ?? BASIN_DEFAULTS.maxFill) * profile.depth);
  const lps = opts.litresPerSecond ?? BASIN_DEFAULTS.litresPerSecond;
  const params = {
    table,
    maxDepth,
    drainArea: opts.drainArea ?? BASIN_DEFAULTS.drainArea,
    coolTau: opts.coolTau ?? BASIN_DEFAULTS.coolTau,
    ambient: opts.ambient ?? BASIN_DEFAULTS.ambient,
  };
  const transmission = opts.transmission ?? !low;
  const onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : null;
  const state = createBasinState();
  const inputs = { inflow: 0, plugOpen: !!opts.plugOpen, temperature: 0.5 };

  const U = {
    uFxTime: { value: 0 },
    uFxRadius: { value: profile.radiusAt(0) },
    uFxFunnel: { value: 0 },
    uFxDrain: { value: new THREE.Vector2(0, 0) },
    uFxImpact: { value: new THREE.Vector2(0, -0.04) },
    uFxInflow: { value: 0 },
    uFxPlunge: { value: 0 },
    uFxJump: { value: 0 },
    uFxJumpR: { value: 0.02 },
    uFxWake: { value: 0 },
    uFxSwirl: { value: 0 },
    uFxCaustic: { value: 0 },
    uFxDepthK: { value: 0 },
    uFxAlpha: { value: 0.08 },
    uFxVis: { value: 0 },
  };

  const geo = new THREE.RingGeometry(0.0005, 1, low ? 40 : 72, low ? 8 : 14);
  geo.rotateX(-Math.PI / 2);
  const mat = makeWaterMaterial({
    transmission,
    key: `basin-${low ? 'l' : 'h'}`,
    roughness: 0.02,
    thickness: 0.02,
    attenuationColor: 0xcfe9ea,
    attenuationDistance: 0.45,
    patch: (shader, mode) => patchBasin(shader, mode, U, low),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'fx-basin-water';
  mesh.position.set(centre.x, bottomY, centre.z);
  mesh.visible = false;
  mesh.renderOrder = 0;

  let flowIn = 0; // 0..1 of the tap's full flow arriving now
  let time = 0;
  let wake = 0;
  let swirl = 0;
  let wasFull = false;
  let wasDeep = false;
  let draining = false;
  const evt = { level: 0, depth: 0, volume: 0 };

  function emit(type) {
    if (!onEvent) return;
    evt.level = state.depth / maxDepth;
    evt.depth = state.depth;
    evt.volume = state.volume * 1000;
    onEvent(type, evt);
  }

  function applyVisuals() {
    const depth = state.depth;
    const vis = smooth(depth, 0.0004, 0.0025);
    mesh.visible = vis > 0.001;
    mesh.position.y = bottomY + depth;
    U.uFxVis.value = vis;
    U.uFxRadius.value = profile.radiusAt(depth) + 0.0015; // tucked a little into the ceramic wall
    U.uFxDepthK.value = smooth(depth, 0, 0.08);
    if (transmission) mat.thickness = Math.max(0.002, depth);
  }

  function update(dtMs) {
    const dt = stepSeconds(dtMs, 250);
    if (dt <= 0) return false;
    time += dt;
    U.uFxTime.value = time % 600;
    inputs.inflow = (flowIn * lps) / 1000;
    const before = state.depth;
    basinStep(state, dt, inputs, params);
    const depth = state.depth;

    // how the stream meets the water
    U.uFxInflow.value = flowIn;
    U.uFxPlunge.value = smooth(depth, 0.004, 0.016);
    U.uFxJump.value = 1 - smooth(depth, 0.006, 0.02);
    U.uFxJumpR.value = Math.max(0.006, (0.03 + (0.012 - 0.03) * smooth(depth, 0.002, 0.012)) * Math.sqrt(flowIn));
    wake = Math.max(flowIn, wake * Math.exp(-dt / 1.6));
    U.uFxWake.value = flowIn > 0.01 ? 0 : wake;

    // the swirl forms over a second or so once the waste runs, and goes when it stops
    const swirlTarget = inputs.plugOpen ? smooth(depth, 0.003, 0.02) * clamp(state.outflow / 2e-4, 0, 1) : 0;
    swirl += (swirlTarget - swirl) * (1 - Math.exp(-dt / (swirlTarget > swirl ? 1.2 : 0.6)));
    U.uFxSwirl.value = swirl;
    const shallowBoost = 1 + 0.5 * (1 - smooth(depth, 0.01, 0.05));
    U.uFxFunnel.value = Math.min(depth * 0.8, swirl * Math.min(0.012, depth * 0.55) * shallowBoost);
    U.uFxCaustic.value = smooth(depth, 0.003, 0.02) * (0.25 + 0.75 * Math.max(flowIn, wake, swirl)) * (low ? 0.3 : 0.45);
    applyVisuals();

    // events for sound
    if (state.full && !wasFull) emit('full');
    wasFull = state.full || (wasFull && depth > maxDepth * 0.98);
    if (inputs.plugOpen && state.outflow > 0 && !draining && depth > 0.002) {
      draining = true;
      emit('drainStart');
    }
    if (draining && before >= 0.004 && depth < 0.004) emit('gurgle');
    if (draining && state.empty) {
      draining = false;
      emit('empty');
    }
    if (!inputs.plugOpen) draining = false;
    wasDeep = depth > 0.004;
    // still moving: the level changes, the stream lands, or waves and swirl have not died away
    return mesh.visible && (Math.abs(depth - before) > 1e-7 || flowIn > 0 || wake > 0.01 || swirl > 0.01);
  }

  return {
    object3d: mesh,
    parts: { surface: mesh },
    update,
    setInflow(f) { flowIn = clamp(Number.isFinite(f) ? f : 0, 0, 1); },
    setInflowTemperature(t) { if (Number.isFinite(t)) inputs.temperature = clamp(t, 0, 1); },
    setPlug(open) { inputs.plugOpen = !!open; },
    // where the stream lands, in room coordinates
    setImpact(x, z) { U.uFxImpact.value.set(x - centre.x, z - centre.z); },
    setLevel(level) {
      const d = clamp(Number.isFinite(level) ? level : 0, 0, 1) * maxDepth;
      state.volume = table.volumeAt(d);
      state.depth = d;
      state.empty = d <= 0;
      state.full = d >= maxDepth;
      applyVisuals();
    },
    get level() { return state.depth / maxDepth; },
    get depth() { return state.depth; },
    get volume() { return state.volume * 1000; },
    get surfaceY() { return bottomY + state.depth; },
    // where falling water meets the basin at (x, z): the water surface, or the ceramic where the bowl is higher
    surfaceYAt(x, z) {
      const r = Math.hypot(x - centre.x, z - centre.z);
      const bowl = profile.heightAtRadius ? profile.heightAtRadius(r) : 0;
      return bottomY + Math.max(state.depth, bowl);
    },
    get temperature() { return state.temperature; },
    get plugOpen() { return inputs.plugOpen; },
    get outflow() { return state.outflow * 1000; },
    get full() { return state.full; },
    get empty() { return state.empty; },
    get swirl() { return swirl; },
    get radius() { return profile.radiusAt(state.depth); },
    get deep() { return wasDeep; },
    rimRadius: profile.radiusAt(profile.depth),
    dims,
    profile,
    maxDepth,
    bottomY,
    center: centre,
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
