// Loads the asset manifest, photo textures, the environment light and the font. Everything degrades gracefully:
// if a file is missing, the material keeps its plain colour and the room still works.
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

export function createAssets(renderer, quality) {
  const base = './assets/';
  const tex = new THREE.TextureLoader();
  const cache = new Map();
  let manifest = null;
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  async function loadManifest() {
    try {
      const res = await fetch(`${base}manifest.json`, { cache: 'no-cache' });
      manifest = res.ok ? await res.json() : { textures: {}, sounds: {} };
    } catch {
      manifest = { textures: {}, sounds: {} };
    }
    return manifest;
  }

  function load(url, srgb) {
    if (cache.has(url)) return cache.get(url);
    const p = new Promise((resolve) => {
      tex.load(url, (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = maxAniso;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        resolve(t);
      }, undefined, () => resolve(null));
    });
    cache.set(url, p);
    return p;
  }

  // Returns { map, normalMap, roughnessMap, metresAcross } for a texture key in the manifest, or null.
  async function textureSet(key) {
    const entry = manifest && manifest.textures && manifest.textures[key];
    if (!entry) return null;
    const dir = `${base}textures/${key}/`;
    const colour = quality === 'low' ? 'color_1k.webp' : 'color_2k.webp';
    const [map, normalMap, roughnessMap] = await Promise.all([
      load(dir + colour, true), load(`${dir}normal_1k.webp`, false), load(`${dir}rough_1k.webp`, false),
    ]);
    return { map, normalMap, roughnessMap, entry };
  }

  async function environment() {
    const file = manifest && manifest.env && manifest.env.file ? manifest.env.file : 'env/modern_bathroom_1k.hdr';
    return new Promise((resolve) => {
      new HDRLoader().load(base + file, (hdr) => {
        const pm = new THREE.PMREMGenerator(renderer);
        const env = pm.fromEquirectangular(hdr).texture;
        hdr.dispose();
        pm.dispose();
        resolve(env);
      }, undefined, () => resolve(null));
    });
  }

  async function bakeMaps(mood) {
    let info = null;
    try {
      const res = await fetch(`${base}bake/bake.json`, { cache: 'no-cache' });
      if (res.ok) info = await res.json();
    } catch { /* no bake yet */ }
    if (!info) return null;
    const surfaces = ['floor', 'ceiling', 'wall_back', 'wall_front', 'wall_left', 'wall_right'];
    const maps = {};
    await Promise.all(surfaces.map(async (s) => {
      const t = await load(`${base}bake/${mood}/${s}.webp`, (info.encoding || 'srgb') === 'srgb');
      if (t) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.channel = 1; maps[s] = t; }
    }));
    return { maps, info };
  }

  // The fonts are declared in css/style.css; canvas text (papers, the mirror) only draws in a font that has loaded,
  // so this waits for both before anything is written. Resolves false if a font could not load (system font then).
  async function font() {
    if (!document.fonts || !document.fonts.load) return false;
    try {
      const got = await Promise.all([
        document.fonts.load("600 32px 'Exhibit Sans'"),
        document.fonts.load("600 32px 'Caveat'"),
      ]);
      return got.every((list) => list.length > 0);
    } catch { return false; }
  }

  return { loadManifest, textureSet, environment, bakeMaps, font, get manifest() { return manifest; }, base };
}
