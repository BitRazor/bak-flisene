// Light in the room. The shell (floor, walls, ceiling) gets ALL its diffuse light from the Blender bake (direct and
// bounced, see app/assets/bake/bake.json). The fixtures are lit live by the same six ceiling downlights, at the bake's
// own intensities, so both match, by the mirror's LED strip (a rect-area light, also at the bake's strength), and by
// the room itself (the environment is a photograph of this room: scene/roomEnvironment.js). The shell must not be lit
// a second time: its materials skip the live punctual lights and the environment's diffuse light, and keep only the
// environment's reflections (the glaze's sheen). Units are the evening bake's (its exposure and 3500 K balance); the
// camera (scene/mood.js) balances and exposes the whole picture in the tone mapping.
//
// The light switch (createRoomLight): the lamps' baked light dims through one shared uniform (bathLampLevel) and the
// downlights with it. The LED strip stays on: its baked share would dim with the rest, so its live light lights the
// shell where its light falls (the wall between the counter and the cabinet) by exactly the share the dimmed bake no
// longer carries (bathShellRect = 1 - level). By day the day bake is added under the lamps' bake (bathDayMap,
// bathDayGain): the daylight stays when the lamps go off.
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

const DIRECT = /\( NUM_(POINT|SPOT|DIR|SUN)_LIGHTS > 0 \) && defined\( RE_Direct \)/g;
const RECT = 'RE_Direct_RectArea( rectAreaLight,';
const IBL_DIFFUSE = /iblIrradiance \+= getIBLIrradiance\( geometryNormal \);/;
const LIGHTMAP = 'vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;';
const SRC_BEGIN = THREE.ShaderChunk.lights_fragment_begin;
const SRC_MAPS = THREE.ShaderChunk.lights_fragment_maps;
const BEGIN = SRC_BEGIN.replace(DIRECT, '( 0 > 1 )').replace(RECT, `rectAreaLight.color *= bathShellRect * bathLedReach;\n\t\t${RECT}`);
const MAPS_BASE = SRC_MAPS.replace(IBL_DIFFUSE, '');
const MAPS_EVENING = MAPS_BASE.replace(LIGHTMAP, 'vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity * bathLampLevel;');
const MAPS_DAY = MAPS_BASE.replace(LIGHTMAP,
  'vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity * bathLampLevel + texture2D( bathDayMap, vLightMapUv ).rgb * bathDayGain;');
const DECLS = `
uniform float bathLampLevel;
uniform float bathShellRect;
uniform vec3 bathLedMin;
uniform vec3 bathLedMax;
varying vec3 vBathWorld;
`;
const DECLS_DAY = `${DECLS}uniform sampler2D bathDayMap;
uniform vec3 bathDayGain;
`;
// where the LED strip's own light falls on the shell: a box in room metres (set by createLedStrip)
const REACH = `
	float bathLedReach = step( bathLedMin.x, vBathWorld.x ) * step( vBathWorld.x, bathLedMax.x )
		* step( bathLedMin.y, vBathWorld.y ) * step( vBathWorld.y, bathLedMax.y )
		* step( bathLedMin.z, vBathWorld.z ) * step( vBathWorld.z, bathLedMax.z );
`;
// False if a three.js update changed the shader text this relies on (the shell would then look too bright).
export const SHELL_PATCH_OK = BEGIN !== SRC_BEGIN && !DIRECT.test(BEGIN) && BEGIN.includes('bathShellRect')
  && MAPS_BASE !== SRC_MAPS && MAPS_EVENING !== MAPS_BASE && MAPS_DAY !== MAPS_BASE;

// One set of uniforms shared by every shell material (the light switch moves them all at once), and the day maps.
export const SHELL = {
  uniforms: {
    bathLampLevel: { value: 1 },
    bathShellRect: { value: 0 },
    bathLedMin: { value: new THREE.Vector3(0, 0, 0) },
    bathLedMax: { value: new THREE.Vector3(-1, -1, -1) }, // empty until the LED strip is made
    bathDayGain: { value: new THREE.Vector3(0, 0, 0) },
  },
  dayMaps: null, // Map(lamp light map -> the day light map of the same surface) while the day bake is in use
};
const BLACK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
BLACK.needsUpdate = true;

// By day: pairs every lamp (evening) light map with its surface's day map, and sets the day map's strength (linear
// RGB in scene units, mood.js grade().dayGain). Call before the first shell material is drawn; null switches it off.
export function setShellDayMaps(pairs, gain) {
  SHELL.dayMaps = pairs || null;
  if (gain) SHELL.uniforms.bathDayGain.value.fromArray(gain);
}

function shellKey() { return SHELL.dayMaps ? 'baked-shell-v1-day' : 'baked-shell-v1'; }

// onBeforeCompile of every shell material (`this` is the material being compiled: a copy made for the membrane view
// finds its own light map's day map)
function bakedOnly(shader) {
  const mat = this;
  const day = !!SHELL.dayMaps;
  for (const k of ['bathLampLevel', 'bathShellRect', 'bathLedMin', 'bathLedMax']) shader.uniforms[k] = SHELL.uniforms[k];
  if (day) {
    shader.uniforms.bathDayGain = SHELL.uniforms.bathDayGain;
    shader.uniforms.bathDayMap = { get value() { return (SHELL.dayMaps && mat && SHELL.dayMaps.get(mat.lightMap)) || BLACK; } };
  }
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vBathWorld;')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n\tvBathWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${day ? DECLS_DAY : DECLS}`)
    .replace('#include <lights_fragment_begin>', REACH + BEGIN)
    .replace('#include <lights_fragment_maps>', day ? MAPS_DAY : MAPS_EVENING);
}

// Gives a shell mesh its baked light map (a clone of its material, so shared library materials stay untouched).
export function bakeShellMesh(mesh, map, intensity) {
  const m = mesh.material.clone();
  m.lightMap = map;
  m.lightMapIntensity = intensity;
  m.envMapIntensity = 1;
  m.onBeforeCompile = bakedOnly;
  m.customProgramCacheKey = shellKey;
  m.userData.bathShell = true;
  mesh.material = m;
  return m;
}

// Six warm downlights (the bake's lamps) for the fixtures, plus the visible lamp trims in the ceiling.
// Returns { group, setLevel(0..1) } — the light switch dims them; the shell's baked light follows (createRoomLight).
export function createDownlights(ctx, mood) {
  const { THREE: T = THREE, materials } = ctx;
  const group = new T.Group();
  group.name = 'downlights';
  const lamps = [];
  const exposure = mood.exposure ?? 1;
  const trimGeo = new T.CylinderGeometry(0.045, 0.045, 0.012, 32);
  const lensGeo = new T.CircleGeometry(0.032, 32);
  const chrome = materials.get('brushedSteel');
  const lens = new T.MeshBasicMaterial({ color: 0xfff0d8, toneMapped: false });
  lens.name = 'downlightLens';
  for (const l of mood.lights || []) {
    if (l.type !== 'spot') continue;
    const colour = new T.Color().setRGB(...(l.colourLinear || [1, 1, 1]));
    const max = Math.max(colour.r, colour.g, colour.b);
    colour.multiplyScalar(1 / max);
    const s = new T.SpotLight(colour, l.threeIntensity * exposure * max, 0, l.threeAngle ?? Math.PI / 4, l.threePenumbra ?? 0.6, 2);
    s.position.fromArray(l.position);
    s.target.position.set(l.position[0] + l.direction[0], l.position[1] + l.direction[1], l.position[2] + l.direction[2]);
    s.castShadow = false;
    group.add(s, s.target);
    lamps.push({ light: s, base: s.intensity });
    // the trim: a brushed ring flush with the ceiling and a warm diffuser
    const trim = new T.Mesh(trimGeo, chrome);
    trim.position.set(l.position[0], ctx.layout.room.H - 0.004, l.position[2]);
    const disc = new T.Mesh(lensGeo, lens);
    disc.rotation.x = Math.PI / 2;
    disc.position.set(l.position[0], ctx.layout.room.H - 0.0105, l.position[2]);
    disc.userData.lampLens = true;
    group.add(trim, disc);
  }
  let level = 1;
  return {
    group,
    lamps,
    lens,
    get level() { return level; },
    setLevel(v) {
      level = Math.max(0, Math.min(1, v));
      for (const lp of lamps) lp.light.intensity = lp.base * level;
      lens.color.setScalar(0.08 + 0.92 * level).multiply(new T.Color(0xfff0d8));
    },
  };
}

// The LED strip under the mirror cabinet's front edge (bakelib/scene.py mirror_leds: (W - 4 cm) x 12 mm, 4.5 mm under
// the cabinet, centred 12 mm behind the body's front; it shines down) as a live rect-area light at the bake's
// luminance: it lights the counter and what stands on it, which the bake (walls only) cannot.
let rectLib = false;
export function createLedStrip(ctx, mood) {
  const { THREE: T = THREE } = ctx;
  if (!rectLib) { RectAreaLightUniformsLib.init(); rectLib = true; }
  const Mr = ctx.layout.mirror;
  const strip = ((mood && mood.lights) || []).find((l) => l.type === 'emitter' && l.name === 'led_strip')
    || { cd_m2: 8289.3, colourLinear: [1.1688, 0.9808, 0.693] }; // the 2026-10-19 bake's numbers
  const colour = new T.Color().setRGB(...strip.colourLinear);
  const max = Math.max(colour.r, colour.g, colour.b);
  colour.multiplyScalar(1 / max);
  const exposure = (mood && mood.exposure) ?? 4.889718193433124;
  const intensity = (strip.cd_m2 / 683) * exposure * max;
  const width = Mr.x1 - Mr.x0 - 0.04;
  const bd = Mr.depth - 0.018 - 0.002; // the cabinet body's depth behind its 18 mm doors
  const light = new T.RectAreaLight(colour, intensity, width, 0.012);
  light.position.set((Mr.x0 + Mr.x1) / 2, Mr.y0 - 0.0045, bd - 0.012);
  light.rotation.x = -Math.PI / 2; // its light leaves along its own -z: straight down
  light.name = 'mirrorLedStrip';
  // the shell it reaches with its own light: the back wall between the counter top and the cabinet, a little wider
  // than the strip (everything lower or farther is in the vanity's shadow or barely reached)
  const counterTop = ctx.layout.vanity ? ctx.layout.vanity.top : Mr.y0 - 0.3;
  SHELL.uniforms.bathLedMin.value.set(Mr.x0 - 0.25, counterTop - 0.01, -0.06);
  SHELL.uniforms.bathLedMax.value.set(Mr.x1 + 0.25, Mr.y0 + 0.01, 0.02);
  return { light, base: intensity };
}

// The light switch. setLevel(v): v = 1 lamps on, less = dimmed (the switch uses 0.12 for "off"). Everything the lamps
// light follows: the downlights, the shell's baked lamp light (shared uniform), any other light-mapped material by its
// own intensity, and (onChange) the room's photograph that lights the fixtures and fills the mirror. The LED strip
// stays on. By day (dayGain, dayAdapt from mood.js grade) the daylight left with the lamps off is seen as by an eye
// balanced for daylight. paperLight: the share of a held paper's own little light (systems/paper.js) — never quite
// out, a paper must stay readable.
export function createRoomLight({ scene = null, downlights, led = null, onChange = null, dayGain = null, dayAdapt = null } = {}) {
  let level = 1;
  const foreign = new Map(); // a light-mapped material without the shell patch -> its intensity at full light
  function setLevel(v) {
    const next = Math.max(0, Math.min(1, Number(v)));
    if (!Number.isFinite(next) || next === level) return level;
    level = next;
    if (downlights) downlights.setLevel(level);
    SHELL.uniforms.bathLampLevel.value = level;
    SHELL.uniforms.bathShellRect.value = 1 - level;
    if (dayGain && dayAdapt) SHELL.uniforms.bathDayGain.value.set(...dayGain.map((g, i) => g * (1 + (dayAdapt[i] - 1) * (1 - level))));
    if (scene) {
      scene.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        for (const m of [].concat(o.material)) {
          if (!m || !m.lightMap || (m.userData && m.userData.bathShell)) continue;
          if (!foreign.has(m)) foreign.set(m, m.lightMapIntensity);
          m.lightMapIntensity = foreign.get(m) * level;
        }
      });
    }
    if (onChange) onChange(level);
    return level;
  }
  return {
    setLevel,
    led,
    get level() { return level; },
    get paperLight() { return 0.45 + 0.55 * level; },
  };
}
