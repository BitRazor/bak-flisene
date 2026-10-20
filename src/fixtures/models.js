// Photographed models (Poly Haven, CC0; simplified for phones and shipped in app/assets/models/<id>/, licences in
// app/assets/LICENSES.md): the two potted plants, the rubber duck and the wicker basket (fixtures/plants.js).
// loadModel(ctx, name, { loader }) -> Promise<Object3D | null>: the model's meshes, named for touches and set up for
//   this room's light. loader(url) -> Promise<{ scene }> (a glTF result); else ctx.modelLoader; else three.js's
//   GLTFLoader, only where there is a page to load from (ctx.assets). The headless tests have none: no model, no error.
//   A failed load warns once and resolves null: the fixture stays empty and the room works without it.
// prepareModel(root, name, ctx): meshes named `${name}.${part}` (part = the node name in the file: pot, leaves, body,
//   basket; mesh.userData.part), materials `model:${id}:${part}`.
// MODELS: each file's facts measured from the shipped geometry (tests/plants.test.js checks them against the files), so
//   where a thing stands is known before its model arrives: box (its bounds, in the file's own metres), foot (where it
//   touches: [[x0, z0], [x1, z1]] within 2 mm of its lowest point), bend (plants: the soil level y0 and the height of
//   the leaves above it, for their sway), knock (per part), triangles.
import * as THREE from 'three';

export const MODELS = {
  // a zebra haworthia (succulent) in a white pot topped with gravel
  succulent: {
    id: 'potted_plant_04', title: 'Potted Plant 04', author: 'James Ray Cock', parts: ['pot', 'leaves'], triangles: 2899,
    box: [[-0.0839, 0.0005, -0.0828], [0.0839, 0.2676, 0.1006]],
    foot: [[-0.0515, -0.0515], [0.0515, 0.0515]],
    bend: { y0: 0.14, height: 0.1276 },
    knock: { pot: 'ceramic' },
  },
  // a leafy arrowhead plant (syngonium) in a terracotta pot
  leafyPlant: {
    id: 'potted_plant_02', title: 'Potted Plant 02', author: 'Rico Cilliers', parts: ['pot', 'leaves'], triangles: 6999,
    box: [[-0.3964, 0.0001, -0.4203], [0.3045, 0.8412, 0.2358]],
    foot: [[-0.1242, -0.1253], [0.1242, 0.1179]],
    bend: { y0: 0.32, height: 0.5212 },
    knock: { pot: 'ceramic' },
  },
  // a yellow rubber duck; its beak points along +z in the file
  duck: {
    id: 'rubber_duck_toy', title: 'Rubber Duck Toy', author: 'Plat251', parts: ['body'], triangles: 1000,
    box: [[-0.1068, 0, -0.1452], [0.1057, 0.2853, 0.1529]],
    foot: [[-0.0663, -0.1176], [0.0663, 0.1164]],
  },
  // a low rectangular wicker basket, its length along x in the file; inside: its woven floor and the room for things
  basket: {
    id: 'wicker_basket_01', title: 'Wicker Basket 01', author: 'Kuutti Siitonen', parts: ['basket'], triangles: 8600,
    box: [[-0.1917, -0.0009, -0.1469], [0.1913, 0.1165, 0.146]],
    foot: [[-0.163, -0.1248], [0.164, 0.1251]],
    inside: { y: 0.018, length: 0.325, width: 0.245, depth: 0.098 },
    knock: { basket: 'wood' },
  },
};

export function modelUrl(ctx, name) {
  const spec = MODELS[name];
  const base = (ctx.assets && ctx.assets.base) || './assets/';
  return spec ? `${base}models/${spec.id}/${spec.id}.gltf` : null;
}

// three.js's own loader, fetched only when a model is really loaded on a page
async function gltfLoad(url) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  return new GLTFLoader().loadAsync(url);
}

export async function loadModel(ctx, name, { loader = null } = {}) {
  const spec = MODELS[name];
  if (!spec) return null;
  const load = loader || ctx.modelLoader || (ctx.assets && typeof window !== 'undefined' ? gltfLoad : null);
  if (!load) return null;
  try {
    const gltf = await load(modelUrl(ctx, name));
    const root = gltf && (gltf.scene || (gltf.scenes && gltf.scenes[0]));
    return root ? prepareModel(root, name, ctx) : null;
  } catch (e) {
    console.warn(`model ${spec.id} not loaded:`, e && e.message ? e.message : e);
    return null;
  }
}

// Sets a loaded model up for the room: names, knocks, and materials that sit in the room's light like the others
// (the room's photograph as their light, scene/roomEnvironment.js): colour photos in sRGB, the data maps as data, no
// metal (the packed maps' blue channel, metalness, carries only compression noise), the texture's own roughness.
export function prepareModel(root, name, ctx) {
  const spec = MODELS[name];
  const aniso = ctx && ctx.renderer && ctx.renderer.capabilities ? Math.min(4, ctx.renderer.capabilities.getMaxAnisotropy()) : 1;
  const done = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const part = o.userData.part || o.name;
    o.userData.part = part;
    o.userData.model = name;
    o.name = `${name}.${part}`;
    const k = spec && spec.knock && spec.knock[part];
    if (k) o.userData.knock = k;
    for (const m of [].concat(o.material)) {
      if (!m || done.has(m)) continue;
      done.add(m);
      if (spec) m.name = `model:${spec.id}:${part}`;
      if ('metalness' in m) { m.metalness = 0; m.metalnessMap = null; }
      if ('roughness' in m && m.roughnessMap) m.roughness = 1;
      if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
      for (const key of ['normalMap', 'roughnessMap', 'aoMap']) if (m[key]) m[key].colorSpace = THREE.NoColorSpace;
      for (const key of ['map', 'normalMap', 'roughnessMap', 'aoMap']) if (m[key]) m[key].anisotropy = Math.max(m[key].anisotropy || 1, aniso);
      m.needsUpdate = true;
    }
  });
  return root;
}
