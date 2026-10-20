// The door's and the hallway's light (moved out of scene/roomEnvironment.js 2026-10-20, as it was; that file
// re-exports all of it). See the section comment below.
import * as THREE from 'three';

// How far a hinge has turned (radians), read from the pivot itself (a joint value can lag a direct rotation).
// (Math.sqrt, not Math.hypot: V8's three-argument hypot made 32 bytes of garbage a call, measured 2026-10-20.)
export function hingeAngle(pivot) {
  const q = pivot.quaternion;
  return 2 * Math.atan2(Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z), Math.abs(q.w));
}
// Whether it has turned less than rad (the per-frame question: a yes or no makes no garbage, a returned angle can).
export function hingeBelow(pivot, rad) {
  const q = pivot.quaternion;
  return 2 * Math.atan2(Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z), Math.abs(q.w)) < rad;
}

// ---- The door's and the hallway's light
// Until the door first opens, the hallway and the door are lit by the hallway's photograph. Open, the door stands in
// the room and takes the room's (scene.environment), the hallway its photograph with the door open (the room's light
// through it). That came in one frame at 0.05 rad: the leaf 15 grey levels brighter, its frame 13, the walls 6 (37 %
// of the start view), and it never went back when the door was shut (the look, 2026-10-20, look3 defects 1 and 4).
// Now each of those materials carries both photographs and the second's share: it follows the leaf over its first
// DOOR_LIGHT.fullRad (about 0.6 s of the first swing; shutting, the last 0.4 s), never faster than the whole change in
// DOOR_LIGHT.ms, and goes back as the door shuts with the eye in the hallway. With the eye in the room the door keeps
// the room's light (its room face is what is seen).
export const DOOR_LIGHT = { fullRad: 0.25, ms: 450 };
export function doorLightShare(rad) {
  const t = Math.min(1, Math.max(0, rad / DOOR_LIGHT.fullRad));
  return t * t * (3 - 2 * t);
}
const toward = (v, w, most) => (v < w ? Math.min(w, v + most) : Math.max(w, v - most));
// One frame's step toward the shares wanted (s = { door, hall }, changed in place): rad the leaf's angle, inRoom the
// eye on the room's side of the door line, hallOpen whether that photograph exists, dt in ms, level the room's light
// (the hallway's open-door photograph is made with the lamps on: with them low, only that much of it; review4).
export function doorLightStep(s, rad, inRoom, hallOpen, dt, level = 1) {
  const share = doorLightShare(rad);
  const most = dt / DOOR_LIGHT.ms;
  s.door = toward(s.door, inRoom ? 1 : share, most);
  s.hall = toward(s.hall, hallOpen ? share * Math.min(1, Math.max(0, level)) : 0, most);
  return s;
}
// The second photograph sampled as three.js samples a material's own (three.js's bilinearCubeUV and textureCubeUV,
// taken from its chunk and renamed, with that photograph's size from uniforms instead of the program's constants: the
// two differ in size), and the mix (one lookup where only one shows).
const CUBE_UV = THREE.ShaderChunk.cube_uv_reflection_fragment || '';
const cubeFn = (head) => { const i = CUBE_UV.indexOf(head); const j = i >= 0 ? CUBE_UV.indexOf('\n\t}', i) : -1; return j > i ? CUBE_UV.slice(i, j + 3) : ''; };
const B_SIZES = (s) => s.replaceAll('CUBEUV_MAX_MIP', 'bathEnvBSize.z').replaceAll('CUBEUV_TEXEL_WIDTH', 'bathEnvBSize.x').replaceAll('CUBEUV_TEXEL_HEIGHT', 'bathEnvBSize.y');
const B_BILINEAR = cubeFn('vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {');
const B_TEXTURE = cubeFn('vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {');
export const ENV_B_GLSL = /* glsl */ `
uniform sampler2D bathEnvB;
uniform vec3 bathEnvBSize;
uniform float bathEnvMix;
${B_SIZES(B_BILINEAR).replace('bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt )', 'bathBilinearB( vec3 direction, float mipInt )').replaceAll('( envMap,', '( bathEnvB,')}
${B_SIZES(B_TEXTURE).replace('textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness )', 'bathTextureCubeUVB( vec3 sampleDir, float roughness )').replaceAll('bilinearCubeUV( envMap,', 'bathBilinearB(')}
vec4 bathEnv( vec3 dir, float roughness ) {
	vec4 c = vec4( 0.0 );
	if ( bathEnvMix < 1.0 ) c = textureCubeUV( envMap, dir, roughness );
	if ( bathEnvMix > 0.0 ) c = mix( c, bathTextureCubeUVB( dir, roughness ), bathEnvMix );
	return c;
}
`;
const ENV_PARS = THREE.ShaderChunk.envmap_physical_pars_fragment || '';
export const ENV_MIX_OK = !!B_BILINEAR && !!B_TEXTURE && (ENV_PARS.match(/textureCubeUV\( envMap, /g) || []).length >= 2;
// three.js's CUBEUV constants for a photograph's layout (generateCubeUVSize), from its height; no garbage
function cubeSize(getTexture) {
  const v = new THREE.Vector3(1, 1, 0);
  let h = -1;
  return {
    get value() {
      const t = getTexture();
      const ih = t && t.image ? t.image.height : 0;
      if (ih !== h && ih > 0) {
        const maxMip = Math.log2(ih) - 2;
        v.set(1 / (3 * Math.max(2 ** maxMip, 7 * 16)), 1 / ih, maxMip);
      }
      h = ih;
      return v;
    },
  };
}
function twoPhotographs(material, uniforms) {
  const prev = material.onBeforeCompile;
  const hadOwn = prev && prev !== THREE.Material.prototype.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  const base = typeof prevKey === 'function' && prevKey !== THREE.Material.prototype.customProgramCacheKey ? prevKey.call(material) : '';
  material.onBeforeCompile = function envMix(shader, renderer) {
    if (hadOwn) prev.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader.replace('#include <envmap_physical_pars_fragment>',
      `#if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_CUBE_UV )\n${ENV_B_GLSL}\n#endif\n${ENV_PARS.replaceAll('textureCubeUV( envMap, ', 'bathEnv( ')}`);
  };
  material.customProgramCacheKey = () => (base ? `${base}+envB` : `bath-envB-${material.type}`);
  material.needsUpdate = true;
}
// Own copies of the standard materials under root (a door's or a hallway's light must not change the library's
// material, which the room's fixtures share); a material owned already is kept. Returns the root's own materials.
export function ownMaterials(root) {
  const made = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const swap = (m) => {
      if (!m || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) return m;
      if (m.userData.bathOwned) { made.set(m, m); return m; }
      if (!made.has(m)) {
        const c = m.clone();
        if (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) {
          c.onBeforeCompile = m.onBeforeCompile;
          c.customProgramCacheKey = m.customProgramCacheKey;
        }
        c.userData.bathOwned = true;
        made.set(m, c);
      }
      return made.get(m);
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
  return [...new Set(made.values())];
}
// The materials the door light works on: the hallway's own and the door's casings on the hallway's face (they take the
// hallway's light), and the rest of the door's (the leaf, the frame and casings on the room's side: the room's light).
// The casings on the hallway's face were one mesh with the leaf's material and lit up as if they stood in the bathroom
// (review4 2026-10-20).
export function doorLightMaterials(ctx) {
  const hall = ownMaterials(ctx.hallway.group);
  const frameHall = ctx.door.parts && ctx.door.parts.frameHall;
  if (frameHall) hall.push(...ownMaterials(frameHall).filter((m) => !hall.includes(m)));
  const door = ownMaterials(ctx.door.group).filter((m) => !hall.includes(m));
  return { door, hall };
}
// Wires it on the door's and the hallway's own materials (doorLightMaterials), lit by the hallway's photograph (their
// envMap) until now. update(dt): one frame (main.js's loop), true while the light still changes; setHallOpen(texture):
// the hallway's photograph with the door open, once taken; shares: { door, hall } now.
export function createDoorLight(ctx, { door = [], hall = [] } = {}) {
  const shares = { door: 0, hall: 0 };
  let hallOpen = null;
  const roomEnv = () => ctx.scene.environment;
  const openEnv = () => hallOpen;
  const doorMix = { value: 0 };
  const hallMix = { value: 0 };
  if (ENV_MIX_OK) {
    const doorU = { bathEnvB: { get value() { return roomEnv(); } }, bathEnvBSize: cubeSize(roomEnv), bathEnvMix: doorMix };
    const hallU = { bathEnvB: { get value() { return openEnv(); } }, bathEnvBSize: cubeSize(openEnv), bathEnvMix: hallMix };
    for (const m of door) twoPhotographs(m, doorU);
    for (const m of hall) twoPhotographs(m, hallU);
  } else console.warn('three.js light chunks changed: the door\'s light changes at once');
  const leaf = ctx.door && ctx.door.parts && ctx.door.parts.leafPivot;
  return {
    shares,
    setHallOpen(t) { hallOpen = t || null; },
    // A room photograph (main.js photographRoom) sees the door from inside the room: it takes the room's light, at the
    // photograph's strength (three.js applies scene.environmentIntensity only to materials without an envMap of their
    // own, and the door has one: with the lamps off the door was lit x1 against x0.12, review4 2026-10-20). Returns
    // the undo.
    forCapture(intensity = 1) {
      const mix = doorMix.value;
      const own = door.map((m) => m.envMapIntensity);
      doorMix.value = 1;
      for (const m of door) m.envMapIntensity *= intensity;
      return () => {
        doorMix.value = mix;
        door.forEach((m, i) => { m.envMapIntensity = own[i]; });
      };
    },
    update(dt) {
      const d = shares.door;
      const h = shares.hall;
      const eye = ctx.rig.position;
      const level = ctx.roomLight ? ctx.roomLight.level : 1;
      doorLightStep(shares, leaf ? hingeAngle(leaf) : 0, eye.z < ctx.layout.room.D, !!hallOpen, dt, level);
      if (!ENV_MIX_OK) { shares.door = Math.round(shares.door); shares.hall = Math.round(shares.hall); }
      doorMix.value = shares.door;
      hallMix.value = shares.hall;
      return shares.door !== d || shares.hall !== h;
    },
  };
}
