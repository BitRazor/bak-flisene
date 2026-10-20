// The room's light mood and the camera that photographs it. Pure maths (no three.js, no DOM), unit-tested in
// tests/mood.test.js.
//
// Which bake: the visitor's own clock decides, through the sun over Bergen (Straume Våtrom's home). While the sun is
// at least 3 degrees up the room uses the day bake (app/assets/bake/day: daylight through the window over the toilet),
// otherwise the evening bake (the six downlights, the mirror's LED strip, the blue-hour sky). The sky behind the
// frosted window follows the sun a little more finely: daylight, dusk (until the sun is 8 degrees down) or night.
//
// The camera on top of the bake. The bake balances its light for a 3500 K camera and exposes the median wall to
// mid-grey (blender/bakelib/scene.py MOODS, blender/room_bake.py EXPOSURE_TARGET): 2700 K lamps came out orange and the
// light stone walls brown (review 2026-10-19, visual finding 1). The app keeps the evening bake's units as its scene
// units (its exposure, its 3500 K balance: the live lamps are given in those), and the camera balances and exposes the
// whole picture once, in the tone mapping, the way a phone camera does: warm lamps stay warm, whites read white.

export const BERGEN = { lat: 60.39, lon: 5.32 };

// The camera: white balance (K) and the median wall's brightness before the tone curve (scene-linear, like the bake's
// EXPOSURE_TARGET). Evening: 2900 K leaves 2700 K lamps warm but not orange; +0.7 EV over the bake's mid-grey.
// Day (daylight plus the lamps, which are on when the visitor comes in): a camera between the two lights.
export const CAMERA = {
  evening: { whiteK: 2800, exposure: 0.54 },
  day: { whiteK: 4300, exposure: 0.5 },
};
// The eye adapts to the light it is in: by day with the lamps off a room lit by daylight alone looks white, not blue.
// The day camera is balanced for daylight and the lamps together; with the lamps off the daylight is seen as by an eye
// balanced for daylight (createRoomLight shifts the day light toward this as the lamps dim).
export const DAYLIGHT_EYE_K = 5800;
// blender/room_bake.py EXPOSURE_TARGET: the median shell luminance each mood's bake was exposed to (read 2026-10-19).
export const BAKE_EXPOSURE_TARGET = { evening: 0.2, day: 0.3 };
// bake.json's numbers as of the 2026-10-19 bake, used when the file has not arrived.
const BAKE_DEFAULTS = {
  evening: {
    whiteBalanceK: 3500, exposure: 4.889718193433124, scale: 0.6620268023014069, lightMapIntensity: 10.169726547181265,
    sky: { zenith: { cd_m2: 12, colour: '2f4e86' }, horizon: { cd_m2: 40, colour: '9fb0cc' }, ground: { cd_m2: 3, colour: '2c302e' } },
  },
  day: {
    whiteBalanceK: 6500, exposure: 6.3929297756546335, scale: 1.4170008897781372, lightMapIntensity: 28.459019256352157,
    sky: { zenith: { cd_m2: 4000, colour: 12000 }, horizon: { cd_m2: 7000, colour: 7500 }, ground: { cd_m2: 1500, colour: '77786a' } },
  },
};
// The night sky over Bergen: low cloud lit from below by the town, faint and grey-blue (LED street lights).
const NIGHT_SKY = { zenith: { cd_m2: 0.15, colour: '242a36' }, horizon: { cd_m2: 0.5, colour: '3c4452' }, ground: { cd_m2: 0.2, colour: '2a2c2e' } };
const LM_PER_W = 683;

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const normalizeY = (rgb) => { const y = luminance(rgb); return rgb.map((c) => c / y); };

// ---------------------------------------------------------------- colour (a line-by-line port of bakelib/common.py)

function lobe(x, mu, s1, s2) {
  const s = x < mu ? s1 : s2;
  return Math.exp(-0.5 * ((x - mu) / s) ** 2);
}
// CIE 1931 2-degree colour matching functions (Wyman, Sloan, Shirley 2013 multi-lobe fit)
function cmf(nm) {
  const x = 1.056 * lobe(nm, 599.8, 37.9, 31.0) + 0.362 * lobe(nm, 442.0, 16.0, 26.7) - 0.065 * lobe(nm, 501.1, 20.4, 26.2);
  const y = 0.821 * lobe(nm, 568.8, 46.9, 40.5) + 0.286 * lobe(nm, 530.9, 16.3, 31.1);
  const z = 1.217 * lobe(nm, 437.0, 11.8, 36.0) + 0.681 * lobe(nm, 459.0, 26.0, 13.8);
  return [x, y, z];
}
const bbCache = new Map();
// Linear Rec.709 colour of a black body at `kelvin`, scaled to luminance 1.
export function blackbody(kelvin) {
  if (bbCache.has(kelvin)) return bbCache.get(kelvin).slice();
  const h = 6.62607015e-34;
  const c = 2.99792458e8;
  const k = 1.380649e-23;
  let X = 0;
  let Y = 0;
  let Z = 0;
  for (let nm = 380; nm <= 780; nm += 2) {
    const lam = nm * 1e-9;
    const b = (2 * h * c * c) / lam ** 5 / (Math.exp((h * c) / (lam * k * kelvin)) - 1);
    const [xb, yb, zb] = cmf(nm);
    X += b * xb;
    Y += b * yb;
    Z += b * zb;
  }
  const r = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
  const g = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z;
  const bl = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
  const out = normalizeY([Math.max(r, 1e-6), Math.max(g, 1e-6), Math.max(bl, 1e-6)]);
  bbCache.set(kelvin, out);
  return out.slice();
}

// Per-channel gains that turn light balanced for a `fromK` camera into light balanced for a `toK` camera, with
// luminance 1 (so a change of balance does not change the exposure).
export function whiteBalance(fromK, toK) {
  const a = blackbody(fromK);
  const b = blackbody(toK);
  return normalizeY(a.map((v, i) => v / b[i]));
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function hexToLinear(hex) {
  const h = String(hex).replace('#', '');
  return [0, 2, 4].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255));
}
// A sky patch (luminance in cd/m2, colour as a colour temperature or an sRGB hex) in Blender units for a camera
// balanced at `kelvinWB` (bakelib/scene.py colour_spec).
function colourSpec(cdm2, colour, kelvinWB) {
  const rgb = typeof colour === 'number' ? blackbody(colour) : normalizeY(hexToLinear(colour));
  const ref = blackbody(kelvinWB);
  const balanced = normalizeY(rgb.map((v, i) => v / ref[i]));
  return balanced.map((v) => (v * cdm2) / LM_PER_W);
}

// ---------------------------------------------------------------- the sun (NOAA's solar calculator equations)

// The sun's geometric elevation in degrees (no refraction: sunrise and sunset are at -0.833) at `date` over `place`.
export function sunElevation(date, place = BERGEN) {
  const t = date instanceof Date ? date.getTime() : Number(date);
  const jd = t / 86400000 + 2440587.5;
  const jc = (jd - 2451545) / 36525;
  const L0 = (((280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360) + 360) % 360;
  const M = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const C = Math.sin(rad(M)) * (1.914602 - jc * (0.004817 + 0.000014 * jc))
    + Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * jc) + Math.sin(rad(3 * M)) * 0.000289;
  const omega = 125.04 - 1934.136 * jc;
  const appLong = L0 + C - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const obliq0 = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliq = obliq0 + 0.00256 * Math.cos(rad(omega));
  const decl = Math.asin(Math.sin(rad(obliq)) * Math.sin(rad(appLong)));
  const y = Math.tan(rad(obliq / 2)) ** 2;
  const eqTime = 4 * deg(y * Math.sin(2 * rad(L0)) - 2 * e * Math.sin(rad(M)) + 4 * e * y * Math.sin(rad(M)) * Math.cos(2 * rad(L0))
    - 0.5 * y * y * Math.sin(4 * rad(L0)) - 1.25 * e * e * Math.sin(2 * rad(M))); // minutes
  const utcMinutes = (((t / 60000) % 1440) + 1440) % 1440;
  const solar = (((utcMinutes + eqTime + 4 * place.lon) % 1440) + 1440) % 1440;
  const ha = rad(solar / 4 < 0 ? solar / 4 + 180 : solar / 4 - 180);
  const lat = rad(place.lat);
  const cosZ = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  return 90 - deg(Math.acos(Math.max(-1, Math.min(1, cosZ))));
}

export const SUN_DAY = 3; // degrees up: the day bake from here
export const SUN_NIGHT = -8; // degrees down: past the blue hour

// { mood: 'day' | 'evening' (which bake), sky: 'day' | 'dusk' | 'night' (behind the window), elevation }
export function moodAt(date = new Date(), place = BERGEN) {
  const elevation = sunElevation(date, place);
  const mood = elevation >= SUN_DAY ? 'day' : 'evening';
  const sky = elevation >= SUN_DAY ? 'day' : elevation > SUN_NIGHT ? 'dusk' : 'night';
  return { mood, sky, elevation };
}

// ---------------------------------------------------------------- the camera's grade

function moodInfo(bakeInfo, name) {
  const got = bakeInfo && bakeInfo.moods && bakeInfo.moods[name];
  return { ...BAKE_DEFAULTS[name], ...(got || {}) };
}

// The camera for a mood, in the evening bake's scene units:
//   whiteGain: per-channel gains (luminance 1) applied before the tone curve (the camera's white balance)
//   exposure:  renderer.toneMappingExposure (the camera's exposure over the bake's)
//   dayGain:   in the day mood, the day light map's per-channel strength in scene units (it is added to the lamps'
//              map, which keeps its own lightMapIntensity); null in the evening
//   sceneK:    the scene units' white balance (the evening bake's), cameraK: the camera's
// The median wall a mood's bake was exposed to: bake.json's own number when a bake writes one (moods[m].exposureTarget),
// else blender/room_bake.py's (BAKE_EXPOSURE_TARGET). A bake exposed brighter then needs less from the camera.
function exposedTo(info, name) {
  return Number.isFinite(info.exposureTarget) && info.exposureTarget > 0 ? info.exposureTarget : BAKE_EXPOSURE_TARGET[name];
}

export function grade(name, bakeInfo) {
  const eve = moodInfo(bakeInfo, 'evening');
  const sceneK = eve.whiteBalanceK || 3500;
  const cam = CAMERA[name] || CAMERA.evening;
  const whiteGain = whiteBalance(sceneK, cam.whiteK);
  if (name !== 'day') {
    return { name: 'evening', whiteGain, exposure: cam.exposure / exposedTo(eve, 'evening'), dayGain: null, sceneK, cameraK: cam.whiteK };
  }
  const day = moodInfo(bakeInfo, 'day');
  const toScene = eve.exposure / day.exposure; // the day bake's exposure -> the scene's (evening) exposure
  const strength = day.lightMapIntensity * toScene;
  const dayGain = whiteBalance(day.whiteBalanceK || 6500, sceneK).map((g) => g * strength);
  // median wall in scene units with the lamps on: the lamps' (as the evening bake exposed it) plus daylight's
  const median = exposedTo(eve, 'evening') + exposedTo(day, 'day') * toScene;
  // with the lamps off: the daylight as an eye balanced for daylight sees it (relative to this camera)
  const dayAdapt = whiteBalance(cam.whiteK, DAYLIGHT_EYE_K);
  return { name: 'day', whiteGain, exposure: cam.exposure / median, dayGain, dayAdapt, sceneK, cameraK: cam.whiteK };
}

// The sky behind the window in scene units (linear RGB radiance, balanced like the scene): zenith, horizon, ground.
export function skyAt(sky, bakeInfo) {
  const eve = moodInfo(bakeInfo, 'evening');
  const sceneK = eve.whiteBalanceK || 3500;
  const E = eve.exposure;
  const src = sky === 'day' ? moodInfo(bakeInfo, 'day').sky : sky === 'night' ? NIGHT_SKY : eve.sky;
  const out = {};
  for (const k of ['zenith', 'horizon', 'ground']) {
    const s = src[k] || NIGHT_SKY[k];
    out[k] = colourSpec(s.cd_m2, s.colour, sceneK).map((v) => v * E);
  }
  out.state = sky;
  return out;
}

// The camera's white balance goes into three.js's custom tone mapping (renderer.toneMapping = CustomToneMapping):
// the AgX curve the room already used, on the balanced colour. Returns the patched chunk, or null if three.js changed.
export function gradedToneMapping(chunk, gain) {
  const hook = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
  if (typeof chunk !== 'string' || !chunk.includes(hook)) return null;
  const g = gain.map((v) => Number(v).toFixed(5)).join(', ');
  return chunk.replace(hook, `vec3 CustomToneMapping( vec3 color ) { return AgXToneMapping( color * vec3( ${g} ) ); }`);
}
