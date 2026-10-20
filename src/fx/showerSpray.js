// The rain-head spray: water leaving each nozzle as an unbroken jet that breaks into drops 14-26 cm under the head,
// the drops falling as thin motion-blurred streaks, small crown splashes where they hit the floor, and a wet film on
// the shower floor that darkens and shines while it is wet and dries slowly after.
// The floor falls to the drain (data/floor.js): the drops fall to the floor's height under the head (over the drain
// the floor is level with the grate, so every drop lands within 2 mm of it), and the film is a grid that follows the
// fall, 1.5 mm over the tiles, open over the drain.
// The drops are computed on the GPU from the time alone (each nozzle sends its drops at an uneven beat; a drop
// relaunches the moment it lands), so a frame costs no CPU work and no allocations. Turning the water on fills the
// head from the centre out and the jets grow from it; turning it off lets the last water fall and the head dribble
// empty, nozzle by nozzle.
//
// How it reads on a phone (the owner, 2026-10-19: "I see no drops in the shower (yes, on the ground, but not falling)"):
// - Every streak's strip winds counter-clockwise on screen. The first version's wound the other way and three.js
//   culled every one of them (only the splashes, which wind the right way, ever showed). The materials also draw
//   both sides.
// - The water is drawn with the room, before the shower glass (waterMaterial.js drawWithRoom): see-through things come
//   after the glass, which writes depth, so water behind the glass was hidden as well.
// - A thread of water against light tiles reads by refraction: it shows a darker picture of what is behind it (its
//   rims most), and a bright highlight where it mirrors the lamp over the shower (half-vector between lamp and eye,
//   Fresnel, the head's own shadow, beaded by the drop's wobble or the jet's waves). The strip is a pixel wider than
//   the water on each side and the fragment works out the water's share of each pixel, so a thread thinner than a
//   pixel neither vanishes nor flickers. The highlight is the lamp's light added on top of a lit wall's, through the
//   camera's own tone curve; it follows the room's light switch (setLightLevel). The numbers: SPRAY_LOOK.
// - It reads as water through the shower glass too (the visual check, 2026-10-19: from the vanity side it looked like
//   falling snow). The glass shows a picture of the room drawn without the camera's curve and samples it softly
//   (three.js: a cubic B-spline plus a little of the next mip level), so a highlight written there as raw light spread
//   into a white flake. There it is written as the light that shows, at the curve's slope at the wall, the brightening
//   the screen shows (L / (1 + L / 2) of the wall's light), and its beads keep half their contrast. Fresnel's rise
//   toward a lamp behind the water is kneed (at most 3 x): backlit water glints brighter, but not white.
// - No sequin curtain at 1 px per point: drops leave each nozzle at uneven beats, about a third wobble in their
//   3-lobed mode (their highlight flickers 1.94 x as fast), and on a screen coarser than a phone's own 2 px per point
//   a pixel shows what that phone shows, averaged (a glint tone-mapped whole in a big pixel reads as a sequin).
// The shader maths is mirrored in JS (streakCorner, streakShade) for the tests (tests/waterLook.test.js).
//
// createShowerSpray(ctx, opts) -> { object3d, update(dtMs), setFlow(0..1), setTemperature(t), setLightLevel(l),
//   flow, wetness, running, count, nozzles, dispose }. Quality 'low' halves the drops (and nozzles) and skips the
//   ring ripples. Events through opts.onEvent(type): 'start' (first drops land), 'stop' (last drops landed).
import * as THREE from 'three';
import { LAYOUT } from '../data/layout.js';
import { GLSL_NOISE, GLSL_BUMP } from './glsl.js';
import {
  inject, makeWaterMaterial, toVec3, qualityOf, stepSeconds, pixelWorldAt1m, usePremultipliedBlending, drawWithRoom,
  roomWall, nearestLamp,
} from './waterMaterial.js';
import { createRng } from './rng.js';
import { floorHeight, floorGrid, isDrainCell } from '../data/floor.js';

const G = 9.81;

// The look, in one place for the shaders and their JS mirror (Claude's tuning 2026-10-19, checked on pictures of this
// room at phone size: tmp/wave3/water.md).
export const SPRAY_LOOK = {
  dropsPerNozzle: 9, // drops in the air per nozzle, at an uneven beat (beatJitter)
  blur: 0.03, // s: the trail a drop leaves in one picture (a phone filming 30 pictures a second exposes up to 1/30 s)
  dropWidth: 0.0021, // m across a drop at full flow (x 0.85-1.15)
  jetWidth: 0.0011, // m across a nozzle's jet (x 0.9-1.1)
  breakup: [0.14, 0.26], // m under the head where a nozzle's jet breaks into drops
  speedFactor: [0.92, 1.08], // nozzle to nozzle
  darkCore: 0.06, // share of what is behind hidden by a resolved thread's core,
  darkRim: 0.26, // by its rims (refraction bends them toward the darker room),
  darkMean: 0.14, // and on average across it (a thread thinner than a few pixels)
  tail: 0.55, // a drop's trail thins to this toward its oldest end
  glint: 9, // the lamp's highlight on a drop 1 m from the lamp, x a lit wall's light (before Fresnel)
  glintWidth: 0.18, // the highlight's half-width, in the water's half-widths
  glintFill: 0.25, // the highlight left in the head's shadow (the other lamps, the walls)
  jetGlint: 0.15, // a smooth jet mirrors the lamp toward the eye only at its waves
  // a falling drop wobbles (Rayleigh's lowest mode: f = sqrt(8 sigma / (rho r^3)) / 2 pi, water sigma 0.072 N/m):
  // a 2.1 mm drop about 112 times a second, a bigger one slower, x (2.1 mm / d)^1.5; its highlight beads with it
  dropHz: 112,
  dropRef: 0.0021,
  jetWave: 0.005, // m between a jet's wave crests (Rayleigh-Plateau: the fastest-growing wave is 9 x the jet's radius)
  splash: 2.2, // a splash crown's light, x a lit wall's
  // irregular, as real water is (the visual check, 2026-10-19: at 1 px per point the even curtain read as sequins)
  beatJitter: 0.3, // a drop leaves up to this share of a beat early or late (a jet breaks up unevenly)
  // a drop pinched off unevenly also wobbles in its 3-lobed mode, sqrt(3 * 2 * 5 / (2 * 1 * 4)) x as fast as the 2-lobed
  // one (Rayleigh: f ~ sqrt(n (n - 1) (n + 2))); Claude's call: about a third of the drops flicker at that rate
  mode3Share: 0.35,
  mode3Rate: 1.9365,
  // the highlight's rise toward a lamp behind the water (Fresnel: up to 50 x, 10.8 x at 150 degrees between lamp and
  // eye) is kneed to at most this: on the phone's tone curve (white at about 5.5 x the wall's light) a rise that big
  // turns a bead white; 3 x keeps backlit water brighter than front-lit. A jet's own factor (its waves' facets across
  // the cylinder: high with the lamp above too, and jetGlint was tuned with it) takes the knee a drop there would get
  fresnelMax: 3,
  // in a picture drawn without the camera's curve (the one the shower glass refracts, the mirror's): a highlight of L x
  // the wall's light is written as L / (1 + L / glassKnee). The evening camera's curve (AgX) brightens the wall by
  // 27 / 40 / 54 / 65 / 75 sRGB levels for 1 / 2 / 4 / 8 / 20 x its light, 42 levels per wall at first: L / (1 + L / 2)
  // x 42 matches that within 5 % (the day camera's within 6 %; tmp/wave3/fix-water.md)
  glassKnee: 2,
  // and there a bead keeps this share of its contrast: the glass samples its picture softly (a cubic B-spline), which
  // widens a thread to about 3 px and turned its beads into round blobs (snow); a nearly even highlight stays a thread
  glassBeads: 0.5,
  // a phone's own pixel at 1 m (upright, fov 72, 812 points at 2 px per point: 2 tan 36 / 1624): on a coarser screen
  // a pixel shows the average of what that phone shows in the part of the picture the pixel covers
  finePixel: 0.000895,
};
const L = SPRAY_LOOK;
const f = (x) => Number(x).toFixed(6); // a GLSL float literal

// The wet film's surface: the floor's height grid over the area (open over the drain), in the plane's own frame
// (x across, y = room -z, z = up; the mesh is turned flat by rotation.x = -PI/2 and sits at (cx, 0, cz)), so the film
// shader keeps reading position.xy as plane coordinates.
function filmGeometry(layout, x0, x1, z0, z1, lift) {
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const grid = floorGrid(layout, { x0, x1, z0, z1, lift, skip: (gx, gz) => isDrainCell(layout, gx, gz) });
  const n = grid.positions.length / 3;
  const pos = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = grid.positions[i * 3] - cx;
    const y = cz - grid.positions[i * 3 + 2];
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = grid.positions[i * 3 + 1];
    uv[i * 2] = (x1 - x0) > 0 ? (x + (x1 - x0) / 2) / (x1 - x0) : 0;
    uv[i * 2 + 1] = (z1 - z0) > 0 ? (y + (z1 - z0) / 2) / (z1 - z0) : 0;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(grid.index);
  g.computeVertexNormals();
  return g;
}

const SPRAY_VERTEX_PARS = /* glsl */ `
uniform float uFxClock;
uniform float uFxStart;
uniform float uFxStop;
uniform float uFxFlow;
uniform float uFxV0;
uniform float uFxDrop;
uniform float uFxBlur;
uniform float uFxWidth;
uniform float uFxJetWidth;
uniform float uFxPixel;
uniform float uFxHeadR;
uniform float uFxHeadRim;
uniform vec3 uFxLamp;
uniform float uFxGlint;
attribute vec4 aNoz;
attribute vec4 aMisc;
attribute vec4 aJet;
`;

// The strip a thread of water is drawn on (vertex stage; needs uFxPixel): from lead (its leading end) back to tail
// along dir, one pixel wider than the water on each side and one pixel longer at each end, so the fragment's coverage
// maths draws even a thread thinner than a pixel smoothly. It winds counter-clockwise on screen: three.js culls the
// other winding. position.x = -0.5 | 0.5 across, position.y = 0 at the lead, 1 at the tail. Returns the corner's clip
// position and sets fxSide (the strip's sideways direction, view space) and fxInfo (x the water's share of the strip's
// width, y the strip's width in pixels, z the water's length in pixels, w this corner's place along it, 0 = lead).
export const STRIP_GLSL = /* glsl */ `
vec3 fxSide;
vec4 fxInfo;
vec4 fx_strip( vec3 lead, vec3 tail, vec3 dir, float wTrue ) {
	float segLen = length( lead - tail );
	vec4 m0 = modelViewMatrix * vec4( position.y < 0.5 ? lead : tail, 1.0 );
	float pix = uFxPixel * max( - m0.z, 0.05 );
	float along = position.y < 0.5 ? - pix : segLen + pix;
	vec4 mv = modelViewMatrix * vec4( lead - dir * along, 1.0 );
	vec3 dv = normalize( ( modelViewMatrix * vec4( dir, 0.0 ) ).xyz );
	fxSide = cross( normalize( - mv.xyz ), dv );
	float sl = length( fxSide );
	fxSide = sl > 0.0001 ? fxSide / sl : vec3( 1.0, 0.0, 0.0 );
	float wDraw = wTrue + 2.0 * pix;
	mv.xyz += fxSide * ( position.x * wDraw );
	fxInfo = vec4( wTrue / wDraw, wDraw / pix, segLen / pix, along / max( segLen, 0.000001 ) );
	return projectionMatrix * mv;
}
`;

// The lamp's highlight on the water at lead (vertex stage; needs uFxHeadRim): where across the thread it sits (the
// half-vector between lamp and eye, along side, -0.9..0.9) and how bright, x the lamp's light (Fresnel, the lamp's
// distance, and the head's shadow: water just under the head is shaded from a lamp above it; head = the head's face
// centre). jet > 0.5: a cylinder, which mirrors the lamp only across its own axis. Fresnel (Schlick, water); its rise
// toward a lamp behind the water (measured as for a drop there) is kneed at SPRAY_LOOK.fresnelMax, for a jet as a
// ratio of its own factor. Returns vec4( place, strength, lit 0..1, Fresnel factor ).
export const GLINT_GLSL = /* glsl */ `
vec4 fx_glint( vec3 lead, vec3 dir, vec3 side, vec3 lamp, vec3 head, float jet ) {
	vec3 leadV = ( modelViewMatrix * vec4( lead, 1.0 ) ).xyz;
	vec3 lampV = ( modelViewMatrix * vec4( lamp, 1.0 ) ).xyz;
	vec3 toL = normalize( lampV - leadV );
	vec3 h = normalize( toL + normalize( - leadV ) );
	float back = 1.0 + 49.0 * pow( 1.0 - clamp( dot( h, toL ), 0.0, 1.0 ), 5.0 );
	vec3 dv = normalize( ( modelViewMatrix * vec4( dir, 0.0 ) ).xyz );
	if ( jet > 0.5 ) h = normalize( h - dv * dot( h, dv ) );
	float fres = 1.0 + 49.0 * pow( 1.0 - clamp( dot( h, toL ), 0.0, 1.0 ), 5.0 );
	fres *= ( 1.0 + ( back - 1.0 ) / ( 1.0 + ( back - 1.0 ) / ${f(L.fresnelMax - 1)} ) ) / back;
	vec3 toLamp = lamp - lead;
	float lit = 1.0;
	if ( toLamp.y > 0.0001 ) {
		vec3 x = lead + toLamp * ( ( head.y - lead.y ) / toLamp.y );
		lit = smoothstep( uFxHeadRim - 0.015, uFxHeadRim + 0.015, length( x.xz - head.xz ) );
	}
	float dl = max( length( toLamp ), 0.3 );
	return vec4( clamp( dot( h, side ), - 0.9, 0.9 ), fres * mix( ${f(L.glintFill)}, 1.0, lit ) / dl, lit, fres );
}
`;

// What this pass writes for scene-linear light: the camera's picture (its tone curve and sRGB) on screen; the light
// itself into a render target (the picture of the room the shower glass refracts).
const OUT_GLSL = /* glsl */ `
vec3 fx_out( vec3 c ) {
#ifdef TONE_MAPPING
	c = toneMapping( c );
#endif
	return linearToOutputTexel( vec4( c, 1.0 ) ).rgb;
}
`;

// The thread's own look (fragment stage), shared with the drip. Output for blending One, OneMinusSrcAlpha: what is
// behind is dimmed by the water's darkness (a darker picture of the same colours) and the highlight's light is added:
// on screen through the camera's curve (on a screen coarser than a phone's own, as that phone shows it, averaged); in
// a picture without the curve (the one the shower glass refracts) kneed to what the screen shows (SPRAY_LOOK.glassKnee).
export const STREAK_FRAGMENT_GLSL = /* glsl */ `
uniform vec3 uFxWall;
uniform vec3 uFxLampColor;
uniform float uFxRound;
uniform float uFxPixel;
varying vec4 vFxUv;
varying vec4 vFxW;
varying vec4 vFxL;
${OUT_GLSL}
void main() {
	float hw = 1.0 / max( vFxW.y, 1.0 );
	float t = vFxUv.y;
	float k = vFxW.x * mix( 1.0, sqrt( max( 1.0 - ( 2.0 * t - 1.0 ) * ( 2.0 * t - 1.0 ), 0.0 ) ), uFxRound );
	float u = vFxUv.x;
	float cov = clamp( ( min( u + hw, k ) - max( u - hw, - k ) ) * 0.5 / hw, 0.0, 1.0 );
	float q = clamp( u / max( k, 0.0001 ), - 1.0, 1.0 );
	float res = smoothstep( 1.5, 4.0, vFxW.y * k );
	float body = mix( ${f(L.darkMean)}, mix( ${f(L.darkCore)}, ${f(L.darkRim)}, smoothstep( 0.45, 0.95, abs( q ) ) ), res );
	float ends = clamp( t * vFxUv.z + 0.5, 0.0, 1.0 ) * clamp( ( 1.0 - t ) * vFxUv.z + 0.5, 0.0, 1.0 );
	float trail = 1.0 + ( ${f(L.tail)} - 1.0 ) * clamp( t, 0.0, 1.0 ) * ( 1.0 - vFxUv.w );
	float dark = body * cov * vFxL.x * ends * trail;
	float gw = ${f(L.glintWidth)} * k;
	float gc = clamp( ( min( u + hw, k * vFxW.z + gw ) - max( u - hw, k * vFxW.z - gw ) ) * 0.5 / hw, 0.0, 1.0 );
	float b = 0.5 + 0.5 * cos( vFxW.w );
	float beadAmp = vFxL.z;
#ifndef TONE_MAPPING
	beadAmp *= ${f(L.glassBeads)};
#endif
	float bead = mix( 1.0, b * b * b * 3.2, beadAmp );
	float win = vFxL.w < 0.0 ? 1.0 : 1.0 - smoothstep( 0.12, 0.3, abs( t - vFxL.w ) );
	float shine = vFxL.y * gc * bead * ends * win;
	vec3 light = vec3( 0.0 );
	if ( shine > 0.00001 ) {
#ifdef TONE_MAPPING
		// on screen: at a pixel coarser than a phone's own, what that phone shows there, averaged
		float fine = min( 1.0, ${f(L.finePixel)} / max( uFxPixel, 0.0000001 ) );
		light = ( fx_out( uFxWall + uFxLampColor * ( shine / fine ) ) - fx_out( uFxWall ) ) * fine;
#else
		// in a picture without the camera's curve: L x the wall's light written as L / (1 + L / glassKnee)
		vec3 luma = vec3( 0.2126, 0.7152, 0.0722 );
		float x = shine * dot( uFxLampColor, luma ) / max( dot( uFxWall, luma ), 0.00001 );
		light = fx_out( uFxWall + uFxLampColor * ( shine / ( 1.0 + x / ${f(L.glassKnee)} ) ) ) - fx_out( uFxWall );
#endif
	}
	if ( dark < 0.002 && light.r + light.g + light.b < 0.003 ) discard;
	gl_FragColor = vec4( light, dark );
}
`;

export const SPRAY_GLSL = {
  streakVertex: /* glsl */ `
${SPRAY_VERTEX_PARS}
attribute float aRate;
varying vec4 vFxUv;
varying vec4 vFxW;
varying vec4 vFxL;
${STRIP_GLSL}
${GLINT_GLSL}
void main() {
	float v0 = uFxV0 * aNoz.w;
	float tf = ( sqrt( v0 * v0 + 19.62 * uFxDrop ) - v0 ) / 9.81;
	float lt = mod( uFxClock + aNoz.z * tf, tf );
	float launch = uFxClock - lt;
	float period = aJet.y * tf;
	float tb = aJet.x;
	float rad = clamp( length( aNoz.xy ) / uFxHeadR, 0.0, 1.0 );
	float first = uFxStart + rad * 0.12;
	float dry = uFxStop + aJet.z;
	// the youngest drop of each nozzle (exactly one: a drop's gap runs until its nozzle's next drop leaves) draws the
	// nozzle's unbroken jet; older drops still above the breakup point are part of it; the rest fall free
	float jet = ( 1.0 - step( period, lt ) ) * ( 1.0 - step( tb, lt ) );
	float tLead = lt;
	float tTail = max( lt - uFxBlur, tb );
	float show = step( first, launch ) * step( launch, dry ) * smoothstep( aMisc.z - 0.03, aMisc.z + 0.001, uFxFlow ) * step( tb, lt );
	float size = aMisc.w;
	if ( jet > 0.5 ) {
		tLead = min( tb, max( uFxClock - first, 0.0 ) );
		tTail = max( uFxClock - dry, 0.0 );
		show = smoothstep( aJet.w - 0.03, aJet.w + 0.001, uFxFlow ) * step( tTail + 0.0001, tLead );
		size = 0.9 + 0.2 * aJet.w;
	}
	vec2 vh = aMisc.xy * v0;
	vec3 lead = vec3( aNoz.x + vh.x * tLead, - ( v0 * tLead + 4.905 * tLead * tLead ), aNoz.y + vh.y * tLead );
	vec3 tail = vec3( aNoz.x + vh.x * tTail, - ( v0 * tTail + 4.905 * tTail * tTail ), aNoz.y + vh.y * tTail );
	vec3 dir = normalize( vec3( vh.x, - ( v0 + 9.81 * tLead ), vh.y ) );
	float wTrue = ( jet > 0.5 ? uFxJetWidth : uFxWidth ) * size;
	gl_Position = fx_strip( lead, tail, dir, wTrue );
	vec4 gli = fx_glint( lead, dir, fxSide, uFxLamp, vec3( 0.0 ), jet );
	float tHere = position.y < 0.5 ? tLead : tTail;
	float bead = 6.2832 * ${f(L.dropHz)} * pow( ${f(L.dropRef)} / wTrue, 1.5 ) * aRate * tHere + aMisc.z * 40.0;
	float beadC = 1.0;
	float glintK = 1.0;
	if ( jet > 0.5 ) {
		// the jet's waves travel with the water (the phase is where the water at this end left the nozzle) and grow
		// toward the breakup point: a smooth jet mirrors the lamp toward the eye only at its waves
		bead = 6.2832 * ( fract( v0 * uFxClock / ${f(L.jetWave)} ) - v0 * tHere / ${f(L.jetWave)} ) + aJet.w * 40.0;
		vec4 mc = modelViewMatrix * vec4( lead, 1.0 );
		float grow = clamp( tHere / tb, 0.0, 1.0 );
		grow *= grow;
		beadC = smoothstep( 2.5, 5.0, ${f(L.jetWave)} / ( uFxPixel * max( - mc.z, 0.05 ) ) ) * grow;
		glintK = ${f(L.jetGlint)} * grow;
	}
	vFxUv = vec4( position.x * 2.0, fxInfo.w, fxInfo.z, jet );
	vFxW = vec4( fxInfo.x, fxInfo.y, gli.x, bead );
	vFxL = vec4( show, show * uFxGlint * gli.y * glintK, beadC, - 1.0 );
	if ( show < 0.002 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
}
`,
  streakFragment: STREAK_FRAGMENT_GLSL,
  splashVertex: /* glsl */ `
${SPRAY_VERTEX_PARS}
varying vec2 vFxUv;
varying float vFxA;
varying float vFxAge;
varying float vFxSeed;
void main() {
	float v0 = uFxV0 * aNoz.w;
	float tf = ( sqrt( v0 * v0 + 19.62 * uFxDrop ) - v0 ) / 9.81;
	float lt = mod( uFxClock + aNoz.z * tf, tf );
	float launchPrev = uFxClock - lt - tf;
	float rad = clamp( length( aNoz.xy ) / uFxHeadR, 0.0, 1.0 );
	float on = step( uFxStart + rad * 0.12, launchPrev ) * step( launchPrev, uFxStop + aJet.z );
	float dens = smoothstep( aMisc.z - 0.03, aMisc.z + 0.001, uFxFlow );
	float age = lt / 0.14;
	vec2 land = aNoz.xy + aMisc.xy * v0 * tf;
	vec4 mv = modelViewMatrix * vec4( land.x, 0.002 - uFxDrop, land.y, 1.0 );
	float sz = mix( 0.014, 0.05, sqrt( clamp( age, 0.0, 1.0 ) ) ) * aMisc.w;
	mv.xy += vec2( position.x * sz, ( position.y + 0.5 ) * sz * 0.85 );
	gl_Position = projectionMatrix * mv;
	vFxUv = position.xy + 0.5;
	vFxAge = clamp( age, 0.0, 1.0 );
	vFxSeed = fract( aNoz.z * 7.13 );
	vFxA = on * dens * ( 1.0 - step( 1.0, age ) );
	if ( vFxA < 0.002 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
}
`,
  splashFragment: /* glsl */ `
uniform vec3 uFxSplash;
uniform float uFxOpacity;
varying vec2 vFxUv;
varying float vFxA;
varying float vFxAge;
varying float vFxSeed;
${OUT_GLSL}
void main() {
	vec2 c = vec2( vFxUv.x - 0.5, vFxUv.y );
	float a = 0.0;
	for ( int k = 0; k < 5; k ++ ) {
		float fk = float( k ) - 2.0;
		float sx = ( fk * 0.1 + ( vFxSeed - 0.5 ) * 0.06 ) * ( 0.5 + vFxAge );
		float sy = ( 0.8 - abs( fk ) * 0.2 ) * vFxAge * ( 1.7 - vFxAge * 1.5 );
		vec2 d = c - vec2( sx, sy );
		a += 1.0 - smoothstep( 0.025, 0.075, length( d ) );
	}
	a += ( 1.0 - smoothstep( 0.0, 0.16, c.y ) ) * ( 1.0 - smoothstep( 0.08, 0.42, abs( c.x ) ) ) * 0.4;
	a = clamp( a, 0.0, 1.0 ) * vFxA * uFxOpacity * ( 1.0 - vFxAge );
	if ( a < 0.003 ) discard;
	gl_FragColor = vec4( fx_out( uFxSplash ) * a, a );
}
`,
  filmVertexPars: /* glsl */ `
varying vec2 vFxF;
`,
  filmVertexMain: /* glsl */ `
	vFxF = position.xy;
`,
  filmFragmentPars: /* glsl */ `
uniform float uFxTime;
uniform float uFxWet;
uniform float uFxRain;
uniform vec2 uFxHalf;
varying vec2 vFxF;
${GLSL_NOISE}
${GLSL_BUMP}
// rings from drops landing on the wet floor: one drop at a time per 8 cm cell, at a random place and rhythm
float fx_rings( vec2 p ) {
	vec2 cell = floor( p * 12.0 );
	float h = 0.0;
	for ( int j = -1; j <= 1; j ++ ) {
		for ( int i = -1; i <= 1; i ++ ) {
			vec2 c = cell + vec2( float( i ), float( j ) );
			float rnd = fx_hash12( c );
			float period = 0.3 + rnd * 0.35;
			float age = fract( uFxTime / period + rnd * 5.3 );
			vec2 ctr = ( c + vec2( fx_hash12( c + 3.1 ), fx_hash12( c + 7.7 ) ) ) / 12.0;
			float ring = length( p - ctr ) - age * 0.07;
			h += sin( ring * 300.0 ) * exp( - ring * ring * 40000.0 ) * ( 1.0 - age );
		}
	}
	return h;
}
`,
  filmFragmentMainHigh: /* glsl */ `
	float fxH = ( fx_noise3( vec3( vFxF * 40.0, uFxTime * 0.4 ) ) - 0.5 ) * 0.00025 + fx_rings( vFxF ) * 0.0003 * uFxRain;
`,
  filmFragmentMainLow: /* glsl */ `
	float fxH = ( fx_noise3( vec3( vFxF * 40.0, uFxTime * 0.4 ) ) - 0.5 ) * 0.00025;
`,
  filmFragmentShade: /* glsl */ `
	normal = fx_bumpNormal( - vViewPosition, normal, fxH );
	vec2 fxEdge = uFxHalf - abs( vFxF );
	float fxIn = smoothstep( 0.0, 0.04, min( fxEdge.x, fxEdge.y ) );
	float fxPatch = 0.75 + 0.25 * fx_noise2( vFxF * 6.0 );
	float fxWetHere = uFxWet * fxIn * fxPatch;
	float fxAlpha = fxWetHere * 0.32;
	diffuseColor.rgb = vec3( 0.05, 0.06, 0.06 );
`,
  // after #include <aomap_fragment>: dry floor reflects nothing extra
  filmAfterLights: /* glsl */ `
	reflectedLight.directSpecular *= fxWetHere;
	reflectedLight.indirectSpecular *= fxWetHere;
`,
};

// ---------------------------------------------------------------------------------------------- the nozzles

const fallTime = (v0, h) => (Math.sqrt(v0 * v0 + 2 * G * h) - v0) / G;

// The head's nozzles on a sunflower spiral (even, no rings or rows to see), count drops shared out among them, each
// nozzle's drops at an uneven beat (each up to SPRAY_LOOK.beatJitter of a beat early or late). Per drop: aNoz =
// (nozzle x, nozzle z, phase 0..1, speed factor), aMisc = (spread x, spread z, index 0..1 for thinning at a low flow,
// size), aJet = (breakup time s, the share of the fall time until the nozzle's next drop leaves, dry-out delay s, the
// nozzle's own index 0..1), aRate = how fast its highlight flickers, x a 2-lobed wobble's (1 or SPRAY_LOOK.mode3Rate).
// The shader's jet test needs exactly one drop per nozzle inside its own gap: the gaps tile the beat. Pure; drop = the
// fall from the head's face to the floor.
export function buildNozzles(count, headRadius, { seed = 21, speed = 2.2, drop = 2.18 } = {}) {
  const rng = createRng(seed);
  const N = Math.max(1, Math.round(count / L.dropsPerNozzle));
  const noz = new Float32Array(count * 4);
  const misc = new Float32Array(count * 4);
  const jet = new Float32Array(count * 4);
  const rate = new Float32Array(count);
  const rngBeat = createRng(seed + 101); // own sequences: the nozzles and their drops stay as they were
  const rngRate = createRng(seed + 202);
  const R = headRadius * 0.94;
  const nozzles = [];
  let speedMin = Infinity;
  let speedMax = 0;
  for (let n = 0; n < N; n++) {
    const r = R * Math.sqrt((n + 0.5) / N);
    const a = n * 2.399963229728653 + rng.next() * 0.2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const sf = rng.range(L.speedFactor[0], L.speedFactor[1]);
    speedMin = Math.min(speedMin, sf);
    speedMax = Math.max(speedMax, sf);
    nozzles.push({
      x, z, sf,
      // a rain head throws its outer jets slightly outward
      sx: (x / headRadius) * 0.05 + rng.signed() * 0.008,
      sz: (z / headRadius) * 0.05 + rng.signed() * 0.008,
      phase: rng.next(),
      lb: rng.range(L.breakup[0], L.breakup[1]),
      dry: rng.next() * 0.5, // the head empties nozzle by nozzle over half a second
      index: rng.next(),
      count: 0,
      slot: 0,
    });
  }
  for (let i = 0; i < count; i++) nozzles[i % N].count++;
  for (const nz of nozzles) {
    // where in the beat each drop leaves (in order: the jitter is under half a beat), and the gap after it: a drop
    // with a higher phase leaves earlier, so the next to leave after drop k is drop k - 1 (the last one wraps round)
    nz.slots = [];
    for (let k = 0; k < nz.count; k++) nz.slots.push((k + (nz.count > 1 ? rngBeat.range(-L.beatJitter, L.beatJitter) : 0)) / nz.count);
    nz.gaps = nz.slots.map((p, k) => (k > 0 ? p - nz.slots[k - 1] : p + 1 - nz.slots[nz.count - 1]));
    nz.gapMax = Math.max(...nz.gaps);
  }
  for (let i = 0; i < count; i++) {
    const nz = nozzles[i % N];
    const v0 = speed * nz.sf;
    const tf = fallTime(v0, drop);
    const k = nz.slot++;
    // one drop draws the jet (the shader): the jet breaks no higher than the nozzle's longest gap under it
    const tb = Math.min(Math.max(fallTime(v0, nz.lb), nz.gapMax * tf * 1.05), tf * 0.6);
    noz[i * 4] = nz.x;
    noz[i * 4 + 1] = nz.z;
    noz[i * 4 + 2] = (((nz.phase + nz.slots[k]) % 1) + 1) % 1;
    noz[i * 4 + 3] = nz.sf;
    misc[i * 4] = nz.sx + rng.signed() * 0.004;
    misc[i * 4 + 1] = nz.sz + rng.signed() * 0.004;
    misc[i * 4 + 2] = (i + 0.5) / count;
    misc[i * 4 + 3] = rng.range(0.85, 1.15);
    jet[i * 4] = tb;
    jet[i * 4 + 1] = nz.gaps[k];
    jet[i * 4 + 2] = nz.dry;
    jet[i * 4 + 3] = nz.index;
    rate[i] = rngRate.next() < L.mode3Share ? L.mode3Rate : 1;
  }
  // shuffle the drops' index fractions so a low flow thins every line evenly instead of by area
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const t = misc[i * 4 + 2];
    misc[i * 4 + 2] = misc[j * 4 + 2];
    misc[j * 4 + 2] = t;
  }
  return { noz, misc, jet, rate, nozzles: N, speedMin, speedMax };
}

function quadGeometry(count, noz, misc, jet, yFrom) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, yFrom, 0, 0.5, yFrom, 0, -0.5, yFrom + 1, 0, 0.5, yFrom + 1, 0], 3));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  geo.setAttribute('aNoz', new THREE.InstancedBufferAttribute(noz, 4));
  geo.setAttribute('aMisc', new THREE.InstancedBufferAttribute(misc, 4));
  geo.setAttribute('aJet', new THREE.InstancedBufferAttribute(jet, 4));
  geo.instanceCount = count;
  return geo;
}

// A water shader drawn with the room (before the glass), blended One, OneMinusSrcAlpha, both sides.
export function waterShader(name, uniforms, vertexShader, fragmentShader, defines) {
  const m = new THREE.ShaderMaterial({ name, uniforms, vertexShader, fragmentShader, side: THREE.DoubleSide });
  if (defines) m.defines = defines;
  usePremultipliedBlending(m);
  return drawWithRoom(m);
}

// ---------------------------------------------------------------------------------------------- the JS mirror

// The shaders' uniforms as plain numbers, for streakCorner and streakShade.
export function mirrorUniforms(u) {
  const v = (k) => u[k].value;
  const c = (k) => { const x = u[k].value; return x.isColor ? [x.r, x.g, x.b] : [x.x, x.y, x.z]; };
  return {
    clock: v('uFxClock'), start: v('uFxStart'), stop: v('uFxStop'), flow: v('uFxFlow'), v0: v('uFxV0'),
    drop: v('uFxDrop'), blur: v('uFxBlur'), width: v('uFxWidth'), jetWidth: v('uFxJetWidth'), pixel: v('uFxPixel'),
    headR: v('uFxHeadR'), headRim: v('uFxHeadRim'), lamp: c('uFxLamp'), glint: v('uFxGlint'), wall: c('uFxWall'),
    lampColor: c('uFxLampColor'), round: v('uFxRound'),
  };
}

const sm = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const stepf = (e, x) => (x >= e ? 1 : 0);
const clampf = (x, a, b) => Math.min(b, Math.max(a, x));
const fract = (x) => x - Math.floor(x);
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len3 = (a) => Math.sqrt(dot3(a, a));
const norm3 = (a) => { const l = len3(a); return l > 0 ? mul3(a, 1 / l) : [0, 0, 0]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const LUMA = [0.2126, 0.7152, 0.0722]; // Rec. 709 luminance, as the shader's
const xf = (m, p, w = 1) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12] * w,
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13] * w,
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14] * w,
];

// STRIP_GLSL and GLINT_GLSL in JS (mv: the model-view matrix's 16 elements, column-major).
export function stripCorner(mv, pixel, lead, tail, dir, wTrue, px, py) {
  const segLen = len3(sub3(lead, tail));
  const m0 = xf(mv, py < 0.5 ? lead : tail);
  const pix = pixel * Math.max(-m0[2], 0.05);
  const along = py < 0.5 ? -pix : segLen + pix;
  const m = xf(mv, sub3(lead, mul3(dir, along)));
  const dv = norm3(xf(mv, dir, 0));
  let side = cross3(norm3(mul3(m, -1)), dv);
  const sl = len3(side);
  side = sl > 0.0001 ? mul3(side, 1 / sl) : [1, 0, 0];
  const wDraw = wTrue + 2 * pix;
  const view = add3(m, mul3(side, px * wDraw));
  return { view, side, info: [wTrue / wDraw, wDraw / pix, segLen / pix, along / Math.max(segLen, 0.000001)] };
}
export function glintAt(mv, headRim, lead, dir, side, lamp, head, jet) {
  const leadV = xf(mv, lead);
  const toL = norm3(sub3(xf(mv, lamp), leadV));
  let h = norm3(add3(toL, norm3(mul3(leadV, -1))));
  const back = 1 + 49 * Math.pow(1 - clampf(dot3(h, toL), 0, 1), 5); // as for a drop here: how far the lamp is behind
  const dv = norm3(xf(mv, dir, 0));
  if (jet > 0.5) h = norm3(sub3(h, mul3(dv, dot3(h, dv))));
  const schlick = 1 + 49 * Math.pow(1 - clampf(dot3(h, toL), 0, 1), 5);
  const fres = (schlick * (1 + (back - 1) / (1 + (back - 1) / (L.fresnelMax - 1)))) / back;
  const toLamp = sub3(lamp, lead);
  let lit = 1;
  if (toLamp[1] > 0.0001) {
    const x = add3(lead, mul3(toLamp, (head[1] - lead[1]) / toLamp[1]));
    lit = sm(headRim - 0.015, headRim + 0.015, Math.hypot(x[0] - head[0], x[2] - head[2]));
  }
  const dl = Math.max(len3(toLamp), 0.3);
  return { place: clampf(dot3(h, side), -0.9, 0.9), strength: (fres * (L.glintFill + (1 - L.glintFill) * lit)) / dl, lit, fres, schlick, lampDist: len3(toLamp) };
}

// SPRAY_GLSL.streakVertex in JS for one corner (px = -0.5 | 0.5, py = 0 | 1) of drop a = { noz, misc, jet } (4
// numbers each) and rate (its aRate, 1 if left out). Returns null when the drop is not drawn, else { view (view-space
// position), vary (the varyings by name), info (the drop's state, for tests) }.
export function streakCorner(a, U, mv, px, py) {
  const [nx, nz, phase, sf] = a.noz;
  const [sx, sz, index, size0] = a.misc;
  const [tb, invD, dryDelay, nIndex] = a.jet;
  const rate = a.rate ?? 1;
  const v0 = U.v0 * sf;
  const tf = (Math.sqrt(v0 * v0 + 19.62 * U.drop) - v0) / 9.81;
  const x0 = U.clock + phase * tf;
  const lt = x0 - tf * Math.floor(x0 / tf);
  const launch = U.clock - lt;
  const period = invD * tf;
  const rad = clampf(Math.hypot(nx, nz) / U.headR, 0, 1);
  const first = U.start + rad * 0.12;
  const dry = U.stop + dryDelay;
  const jet = (1 - stepf(period, lt)) * (1 - stepf(tb, lt));
  let tLead = lt;
  let tTail = Math.max(lt - U.blur, tb);
  let show = stepf(first, launch) * stepf(launch, dry) * sm(index - 0.03, index + 0.001, U.flow) * stepf(tb, lt);
  let size = size0;
  if (jet > 0.5) {
    tLead = Math.min(tb, Math.max(U.clock - first, 0));
    tTail = Math.max(U.clock - dry, 0);
    show = sm(nIndex - 0.03, nIndex + 0.001, U.flow) * stepf(tTail + 0.0001, tLead);
    size = 0.9 + 0.2 * nIndex;
  }
  if (show < 0.002) return null;
  const at = (t) => [nx + sx * v0 * t, -(v0 * t + 4.905 * t * t), nz + sz * v0 * t];
  const lead = at(tLead);
  const tail = at(tTail);
  const dir = norm3([sx * v0, -(v0 + 9.81 * tLead), sz * v0]);
  const wTrue = (jet > 0.5 ? U.jetWidth : U.width) * size;
  const s = stripCorner(mv, U.pixel, lead, tail, dir, wTrue, px, py);
  const g = glintAt(mv, U.headRim, lead, dir, s.side, U.lamp, [0, 0, 0], jet);
  const tHere = py < 0.5 ? tLead : tTail;
  let bead = 6.2832 * L.dropHz * Math.pow(L.dropRef / wTrue, 1.5) * rate * tHere + index * 40;
  let beadC = 1;
  let glintK = 1;
  if (jet > 0.5) {
    bead = 6.2832 * (fract((v0 * U.clock) / L.jetWave) - (v0 * tHere) / L.jetWave) + nIndex * 40;
    const mc = xf(mv, lead);
    const grow = clampf(tHere / tb, 0, 1) ** 2;
    beadC = sm(2.5, 5, L.jetWave / (U.pixel * Math.max(-mc[2], 0.05))) * grow;
    glintK = L.jetGlint * grow;
  }
  const glint = show * U.glint * g.strength * glintK;
  return {
    view: s.view,
    vary: {
      u: px * 2, t: s.info[3], lenPx: s.info[2], jet, k: s.info[0], px: s.info[1], go: g.place, bead, body: show, glint, beadC, at: -1,
    },
    info: { jet: jet > 0.5, tLead, tTail, lt, wTrue, lit: g.lit, fres: g.fres, schlick: g.schlick, lampDist: g.lampDist, glint },
  };
}

// STREAK_FRAGMENT_GLSL in JS: v = the varyings by name (as streakCorner gives them, interpolated), out(c) = what the
// pass writes for scene-linear light c ([r, g, b]), target = a picture without the camera's curve (the shader's
// #ifndef TONE_MAPPING: the one the glass refracts; out is then the identity). Returns null (discarded) or
// { add: [r, g, b], a }.
export function streakShade(v, U, out, target = false) {
  const hw = 1 / Math.max(v.px, 1);
  const t = v.t;
  const k = v.k * (1 + (Math.sqrt(Math.max(1 - (2 * t - 1) * (2 * t - 1), 0)) - 1) * (U.round || 0));
  const u = v.u;
  const cov = clampf(((Math.min(u + hw, k) - Math.max(u - hw, -k)) * 0.5) / hw, 0, 1);
  const q = clampf(u / Math.max(k, 0.0001), -1, 1);
  const res = sm(1.5, 4, v.px * k);
  const prof = L.darkCore + (L.darkRim - L.darkCore) * sm(0.45, 0.95, Math.abs(q));
  const body = L.darkMean + (prof - L.darkMean) * res;
  const ends = clampf(t * v.lenPx + 0.5, 0, 1) * clampf((1 - t) * v.lenPx + 0.5, 0, 1);
  const trail = 1 + (L.tail - 1) * clampf(t, 0, 1) * (1 - v.jet);
  const dark = body * cov * v.body * ends * trail;
  const gw = L.glintWidth * k;
  const gc = clampf(((Math.min(u + hw, k * v.go + gw) - Math.max(u - hw, k * v.go - gw)) * 0.5) / hw, 0, 1);
  const b = 0.5 + 0.5 * Math.cos(v.bead);
  const bead = 1 + (b * b * b * 3.2 - 1) * v.beadC * (target ? L.glassBeads : 1);
  const win = v.at < 0 ? 1 : 1 - sm(0.12, 0.3, Math.abs(t - v.at));
  const gl = v.glint * gc * bead * ends * win;
  let add = [0, 0, 0];
  if (gl > 0.00001) {
    // on screen at a pixel coarser than a phone's own: what that phone shows, averaged (no pixel size: as fine)
    const fine = target || !(U.pixel > 0) ? 1 : Math.min(1, L.finePixel / U.pixel);
    // without the camera's curve: L x the wall's light written as L / (1 + L / glassKnee)
    const g = target ? gl / (1 + (gl * dot3(U.lampColor, LUMA)) / Math.max(dot3(U.wall, LUMA), 0.00001) / L.glassKnee) : gl / fine;
    const w0 = out(U.wall);
    const w1 = out([U.wall[0] + U.lampColor[0] * g, U.wall[1] + U.lampColor[1] * g, U.wall[2] + U.lampColor[2] * g]);
    add = [(w1[0] - w0[0]) * fine, (w1[1] - w0[1]) * fine, (w1[2] - w0[2]) * fine];
  }
  if (dark < 0.002 && add[0] + add[1] + add[2] < 0.003) return null;
  return { add, a: dark };
}

// ---------------------------------------------------------------------------------------------- the effect

export function createShowerSpray(ctx, opts = {}) {
  const low = qualityOf(ctx) === 'low';
  const layout = (ctx && ctx.layout) || LAYOUT;
  const sh = layout.shower;
  const head = toVec3(opts.head, sh.rainHead); // a point, or the shower fixture's anchors.rainHead
  // nozzle field radius: given, or the anchor's userData.radius, or that of a 250 mm rain head; the head itself is a
  // little wider (it shades the water under it from the lamp)
  const headRadius = opts.headRadius ?? opts.head?.userData?.radius ?? 0.11;
  const headRim = opts.headRim ?? headRadius + 0.012;
  const floorY = opts.floorY ?? floorHeight(layout, head.x, head.z);
  const count = Math.max(8, Math.round(opts.count ?? (low ? 450 : 900)));
  const splashCount = Math.max(4, Math.floor(count / 3));
  const speed = opts.speed ?? 2.2; // m/s out of the nozzles
  const pipeDelay = opts.pipeDelay ?? 0.2; // s from the lever to water at the head
  const onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : null;
  const drop = Math.max(0.2, head.y - floorY);

  const U = {
    uFxClock: { value: 0 },
    uFxStart: { value: 1e6 },
    uFxStop: { value: 1e6 },
    uFxFlow: { value: 0 },
    uFxV0: { value: speed },
    uFxDrop: { value: drop },
    uFxBlur: { value: L.blur },
    uFxWidth: { value: L.dropWidth },
    uFxJetWidth: { value: L.jetWidth },
    uFxPixel: { value: pixelWorldAt1m(ctx) },
    uFxHeadR: { value: headRadius },
    uFxHeadRim: { value: headRim },
    uFxLamp: { value: new THREE.Vector3() }, // the nearest ceiling lamp, from the head's face
    uFxGlint: { value: 0 },
    uFxWall: { value: new THREE.Color() },
    uFxLampColor: { value: new THREE.Color() },
    uFxRound: { value: 0 },
    uFxSplash: { value: new THREE.Color() },
    uFxOpacity: { value: 0.42 },
  };

  const built = buildNozzles(count, headRadius, { seed: opts.seed ?? 21, speed, drop });
  const { noz, misc, jet } = built;
  const streakGeo = quadGeometry(count, noz, misc, jet, 0);
  streakGeo.setAttribute('aRate', new THREE.InstancedBufferAttribute(built.rate, 1));
  streakGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -drop / 2, 0), drop / 2 + 0.4);
  const streakMat = waterShader('fx-spray-streaks', U, SPRAY_GLSL.streakVertex, SPRAY_GLSL.streakFragment);
  const streaks = new THREE.Mesh(streakGeo, streakMat);
  streaks.name = 'fx-spray-streaks';
  streaks.position.copy(head);
  streaks.visible = false;
  streaks.renderOrder = 3;

  // every third drop gets a splash
  const sNoz = new Float32Array(splashCount * 4);
  const sMisc = new Float32Array(splashCount * 4);
  const sJet = new Float32Array(splashCount * 4);
  for (let i = 0; i < splashCount; i++) {
    sNoz.set(noz.subarray(i * 12, i * 12 + 4), i * 4);
    sMisc.set(misc.subarray(i * 12, i * 12 + 4), i * 4);
    sJet.set(jet.subarray(i * 12, i * 12 + 4), i * 4);
  }
  const splashGeo = quadGeometry(splashCount, sNoz, sMisc, sJet, -0.5);
  splashGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -drop, 0), 0.6);
  const splashMat = waterShader('fx-spray-splashes', U, SPRAY_GLSL.splashVertex, SPRAY_GLSL.splashFragment);
  const splashes = new THREE.Mesh(splashGeo, splashMat);
  splashes.name = 'fx-spray-splashes';
  splashes.position.copy(head);
  splashes.visible = false;
  splashes.renderOrder = 3;

  // the wet film over the shower floor
  const group = new THREE.Group();
  group.name = 'fx-shower-spray';
  group.add(streaks, splashes);
  let film = null;
  const UF = {
    uFxTime: { value: 0 },
    uFxWet: { value: 0 },
    uFxRain: { value: 0 },
    uFxHalf: { value: new THREE.Vector2() },
  };
  if (opts.film !== false) {
    const fx0 = opts.filmArea?.x0 ?? sh.x0;
    const fx1 = opts.filmArea?.x1 ?? sh.x1;
    const fz0 = opts.filmArea?.z0 ?? sh.z0;
    const fz1 = opts.filmArea?.z1 ?? sh.z1;
    const w = fx1 - fx0;
    const d = fz1 - fz0;
    UF.uFxHalf.value.set(w / 2, d / 2);
    const filmMat = makeWaterMaterial({
      transmission: false,
      key: `film-${low ? 'l' : 'h'}`,
      roughness: 0.06,
      patch(shader) {
        Object.assign(shader.uniforms, UF);
        shader.vertexShader = inject(shader.vertexShader, '#include <common>', SPRAY_GLSL.filmVertexPars);
        shader.vertexShader = inject(shader.vertexShader, '#include <begin_vertex>', SPRAY_GLSL.filmVertexMain);
        let fs = shader.fragmentShader;
        fs = inject(fs, '#include <common>', SPRAY_GLSL.filmFragmentPars);
        fs = inject(fs, '#include <normal_fragment_maps>',
          (low ? SPRAY_GLSL.filmFragmentMainLow : SPRAY_GLSL.filmFragmentMainHigh) + SPRAY_GLSL.filmFragmentShade);
        fs = inject(fs, '#include <aomap_fragment>', SPRAY_GLSL.filmAfterLights);
        shader.fragmentShader = fs;
      },
    });
    drawWithRoom(filmMat); // the wet floor shows through the glass too, under the falling water
    // a flat film only when asked for a height; otherwise it lies on the falling floor
    const flat = opts.filmY !== undefined;
    film = new THREE.Mesh(flat ? new THREE.PlaneGeometry(w, d, 1, 1) : filmGeometry(layout, fx0, fx1, fz0, fz1, 0.0015), filmMat);
    film.name = 'fx-shower-film';
    film.rotation.x = -Math.PI / 2;
    film.position.set((fx0 + fx1) / 2, flat ? opts.filmY + 0.0015 : 0, (fz0 + fz1) / 2);
    film.visible = false;
    film.renderOrder = 1;
    group.add(film);
  }

  // the room's light: a lit wall's, the nearest lamp (found again if the room's lamps are replaced), the switch
  let light = 1;
  let lampsFrom;
  const lampWorld = new THREE.Vector3();
  function findLamp() {
    lampsFrom = ctx && ctx.downlights;
    nearestLamp(ctx, head, lampWorld, U.uFxLampColor.value);
    U.uFxLamp.value.copy(lampWorld).sub(head);
  }
  function applyLight() {
    const wall = roomWall(ctx, U.uFxWall.value, light);
    U.uFxGlint.value = L.glint * wall * light;
    U.uFxSplash.value.copy(U.uFxWall.value).multiplyScalar(L.splash);
  }
  findLamp();
  applyLight();

  let target = 0;
  let flow = 0;
  let temperature = 0.5;
  let clock = 0;
  let running = false; // water on at the valve
  let active = false; // drops may be in the air
  let landedOn = false;
  let wet = 0;
  let time = 0;
  let dryTick = 0;
  // the first drops land from the fastest nozzle; the last from the slowest, after the head has run dry
  const tfFast = fallTime(speed * built.speedMax, drop);
  const tfSlow = fallTime(speed * built.speedMin, drop);

  function update(dtMs) {
    const dt = stepSeconds(dtMs);
    if (dt <= 0) return false;
    time += dt;
    flow += (target - flow) * (1 - Math.exp(-dt / 0.25));
    if (Math.abs(target - flow) < 1e-4) flow = target;

    const on = target > 0.001;
    if (on && !running) {
      if (!active) clock = 0;
      U.uFxStart.value = clock + pipeDelay;
      U.uFxStop.value = 1e6;
      // the head fills from the centre out (in the shader); the density starts at the lever's setting so no drop
      // appears in mid-air
      flow = target;
      running = true;
      active = true;
    } else if (!on && running) {
      U.uFxStop.value = clock;
      running = false;
    }
    if (active) {
      clock += dt;
      U.uFxClock.value = clock;
      // while stopping, the drops already in the air keep their density and size until they land
      if (running) {
        U.uFxFlow.value = flow;
        U.uFxWidth.value = L.dropWidth * (0.75 + 0.25 * flow);
      }
      U.uFxPixel.value = pixelWorldAt1m(ctx);
      if ((ctx && ctx.downlights) !== lampsFrom) findLamp();
      applyLight(); // follows the camera (day or evening) as well as the switch
      const firstLand = U.uFxStart.value + tfFast;
      const lastLand = U.uFxStop.value + 0.5 + tfSlow + 0.15;
      if (!landedOn && running && clock >= firstLand) {
        landedOn = true;
        if (onEvent) onEvent('start');
      }
      if (!running && clock >= lastLand) {
        active = false;
        if (landedOn) {
          landedOn = false;
          if (onEvent) onEvent('stop');
        }
      }
    }
    streaks.visible = active;
    splashes.visible = active;

    // the floor gets wet within seconds and dries over minutes
    const rain = landedOn && running ? flow : 0;
    const wetTarget = rain > 0.01 ? 1 : 0;
    wet += (wetTarget - wet) * (1 - Math.exp(-dt / (wetTarget > wet ? 2.5 : 90)));
    if (film) {
      UF.uFxTime.value = time % 600;
      UF.uFxWet.value = wet;
      UF.uFxRain.value = rain;
      film.visible = wet > 0.01;
    }
    // still moving: drops in the air; a drying floor only needs a picture about four times a second
    if (active) return true;
    if (film && wet > 0.01) {
      dryTick += dt;
      if (dryTick >= 0.25) { dryTick = 0; return true; }
    }
    return false;
  }

  function setLightLevel(l) {
    light = THREE.MathUtils.clamp(Number.isFinite(l) ? l : 1, 0, 2);
    applyLight();
  }

  return {
    object3d: group,
    parts: { streaks, splashes, film },
    update,
    setFlow(fl) { target = THREE.MathUtils.clamp(Number.isFinite(fl) ? fl : 0, 0, 1); },
    setTemperature(t) { temperature = THREE.MathUtils.clamp(Number.isFinite(t) ? t : 0, 0, 1); },
    setLightLevel,
    get flow() { return flow; },
    get temperature() { return temperature; },
    get wetness() { return wet; },
    get running() { return active; },
    get landing() { return landedOn; },
    get light() { return light; },
    count,
    nozzles: built.nozzles,
    splashCount,
    head,
    dispose() {
      streakGeo.dispose(); streakMat.dispose(); splashGeo.dispose(); splashMat.dispose();
      if (film) { film.geometry.dispose(); film.material.dispose(); }
    },
  };
}
