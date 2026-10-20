// Shared GLSL snippets for the effects. Every name starts with fx_ so nothing clashes with three.js's own chunks.
// Written for GLSL ES 3.00 (WebGL 2): float literals always carry a decimal point (no implicit int -> float).

// Value noise from a cheap hash (no textures): fx_hash12/13, fx_noise2/3 return 0..1.
export const GLSL_NOISE = /* glsl */ `
float fx_hash13( vec3 p3 ) {
	p3 = fract( p3 * 0.1031 );
	p3 += dot( p3, p3.zyx + 31.32 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float fx_hash12( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float fx_noise2( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	float a = fx_hash12( i );
	float b = fx_hash12( i + vec2( 1.0, 0.0 ) );
	float c = fx_hash12( i + vec2( 0.0, 1.0 ) );
	float d = fx_hash12( i + vec2( 1.0, 1.0 ) );
	return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}
float fx_noise3( vec3 p ) {
	vec3 i = floor( p );
	vec3 f = fract( p );
	vec3 u = f * f * ( 3.0 - 2.0 * f );
	float n000 = fx_hash13( i );
	float n100 = fx_hash13( i + vec3( 1.0, 0.0, 0.0 ) );
	float n010 = fx_hash13( i + vec3( 0.0, 1.0, 0.0 ) );
	float n110 = fx_hash13( i + vec3( 1.0, 1.0, 0.0 ) );
	float n001 = fx_hash13( i + vec3( 0.0, 0.0, 1.0 ) );
	float n101 = fx_hash13( i + vec3( 1.0, 0.0, 1.0 ) );
	float n011 = fx_hash13( i + vec3( 0.0, 1.0, 1.0 ) );
	float n111 = fx_hash13( i + vec3( 1.0, 1.0, 1.0 ) );
	float x00 = mix( n000, n100, u.x );
	float x10 = mix( n010, n110, u.x );
	float x01 = mix( n001, n101, u.x );
	float x11 = mix( n011, n111, u.x );
	return mix( mix( x00, x10, u.y ), mix( x01, x11, u.y ), u.z );
}
`;

// Tilt a view-space normal by a height field (metres) using screen-space derivatives (Mikkelsen's surface gradient,
// the same idea as three.js's bump map). Fragment shaders only.
export const GLSL_BUMP = /* glsl */ `
vec3 fx_bumpNormal( vec3 surfPos, vec3 surfNorm, float height ) {
	vec3 dpx = dFdx( surfPos );
	vec3 dpy = dFdy( surfPos );
	float dhx = dFdx( height );
	float dhy = dFdy( height );
	vec3 r1 = cross( dpy, surfNorm );
	vec3 r2 = cross( surfNorm, dpx );
	float det = dot( dpx, r1 );
	vec3 grad = sign( det ) * ( dhx * r1 + dhy * r2 );
	return normalize( abs( det ) * surfNorm - grad );
}
`;

// Output for water and glass WITHOUT the transmission pass (quality 'low'): the body is see-through (alpha), the
// reflections (and any added light such as caustics, put in totalEmissiveRadiance) stay at full strength. Used with
// premultiplied-style blending (One, OneMinusSrcAlpha), see usePremultipliedBlending(). Needs fxAlpha declared
// earlier in main().
export const GLSL_PREMULTIPLIED_OUT = /* glsl */ `
gl_FragColor = vec4( totalDiffuse * fxAlpha + totalSpecular + totalEmissiveRadiance, fxAlpha );
`;

// three.js widens the roughness of tightly curved surfaces to stop sparkle; on a thin water stream that dulls the
// glassy highlights, so the patched materials keep only part of that widening.
export const GLSL_ROUGHNESS_FIX = /* glsl */ `
material.roughness = min( max( roughnessFactor, 0.0525 ) + geometryRoughness * 0.3, 1.0 );
`;
