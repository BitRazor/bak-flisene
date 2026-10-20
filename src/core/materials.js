// One shared material library, so the whole room looks consistent and phones share textures.
// get(name) returns the same instance every time; clone() it before changing per-object properties.
// Textures (photo maps) are attached later by assets.js via setMaps(name, maps) — the material works without them.
import * as THREE from 'three';

const DEFS = {
  // ceramics and stone
  ceramicWhite: { color: 0xf4f3ef, roughness: 0.08, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.08, physical: true },
  ceramicMatt: { color: 0xeeece7, roughness: 0.45, metalness: 0 },
  stoneTop: { color: 0xf1efea, roughness: 0.35, metalness: 0 },            // Corian-like solid surface
  // metals (finishes match real tap lines: chrome, matt black, brushed brass, brushed copper, brushed steel)
  chrome: { color: 0xf2f2f2, roughness: 0.06, metalness: 1 },
  brushedSteel: { color: 0xc9c9c6, roughness: 0.32, metalness: 1 },
  brushedBrass: { color: 0xc9a46a, roughness: 0.3, metalness: 1 },
  brushedCopper: { color: 0xc07a55, roughness: 0.32, metalness: 1 },
  matteBlack: { color: 0x1d1d1d, roughness: 0.55, metalness: 0.4 },
  brass: { color: 0xd4af6a, roughness: 0.22, metalness: 1 },
  // glass and mirror
  glass: { color: 0xffffff, roughness: 0.02, metalness: 0, transmission: 1, thickness: 0.008, ior: 1.5, transparent: true, opacity: 1, physical: true },
  glassSimple: { color: 0xdfe8e6, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.18 },
  // a washer's porthole: thick dark-tinted glass, the drum shows dimly behind its reflections
  glassSmoked: { color: 0x1a1918, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.74 },
  // a silvered mirror reflects a little less than all, through faintly green glass (the room's own reflection fills it)
  mirror: { color: 0xe9ece9, roughness: 0.02, metalness: 1 },
  // dark and dull: what shows through a narrow gap (the stop between two cabinet doors)
  gapDark: { color: 0x262624, roughness: 0.9, metalness: 0 },
  // wood, paint, tiles (photo maps attached by assets.js)
  oak: { color: 0xb08a62, roughness: 0.55, metalness: 0 },
  oakDark: { color: 0x6b4e35, roughness: 0.55, metalness: 0 },
  paint: { color: 0xece8e1, roughness: 0.85, metalness: 0 },
  tileSand: { color: 0xd8c9b1, roughness: 0.38, metalness: 0 },
  tileWhite: { color: 0xf0eee9, roughness: 0.2, metalness: 0 },
  mosaic: { color: 0xd9ccb6, roughness: 0.35, metalness: 0 },
  grout: { color: 0xb9ae9d, roughness: 0.9, metalness: 0 },
  concrete: { color: 0x9b9893, roughness: 0.9, metalness: 0 },
  // soft goods and small parts
  rubber: { color: 0x2a2a2a, roughness: 0.85, metalness: 0 },
  plasticWhite: { color: 0xf2f1ee, roughness: 0.4, metalness: 0 },
  plasticGrey: { color: 0xb8b8b4, roughness: 0.5, metalness: 0 },
  paper: { color: 0xfbfaf6, roughness: 0.95, metalness: 0, side: THREE.DoubleSide },
  cardboard: { color: 0xb8956a, roughness: 0.95, metalness: 0 },
  towel: { color: 0xece6dc, roughness: 1, metalness: 0 },
  enamelWhite: { color: 0xf5f5f2, roughness: 0.25, metalness: 0 },
  // a washer's or dryer's cabinet: stove-enamelled steel under a clear lacquer
  enamelGloss: { color: 0xf3f3f0, roughness: 0.2, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.08, physical: true },
  ledWarm: { color: 0xfff1d6, emissive: 0xffe2b0, emissiveIntensity: 2.2, roughness: 0.5 },
  ledGreen: { color: 0xabc037, emissive: 0xabc037, emissiveIntensity: 1.2, roughness: 0.5 },
  // the membrane as seen in the membrane view (a real brush-on membrane colour, not neon)
  membrane: { color: 0x5f8aa0, roughness: 0.6, metalness: 0 },
  membraneTape: { color: 0x9fb6c0, roughness: 0.7, metalness: 0 },
};

export function createMaterials() {
  const cache = new Map();

  function make(name) {
    const def = DEFS[name];
    if (!def) throw new Error(`Unknown material "${name}"`);
    const { physical, ...params } = def;
    const Ctor = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    const mat = new Ctor(params);
    mat.name = name;
    return mat;
  }

  function get(name) {
    if (!cache.has(name)) cache.set(name, make(name));
    return cache.get(name);
  }

  // maps: { map, normalMap, roughnessMap, aoMap } — any may be missing.
  function setMaps(name, maps) {
    const mat = get(name);
    for (const [k, v] of Object.entries(maps)) if (v) mat[k] = v;
    if (maps.map) mat.color.set(0xffffff);
    mat.needsUpdate = true;
    return mat;
  }

  return { get, setMaps, names: () => Object.keys(DEFS), has: (n) => n in DEFS };
}
