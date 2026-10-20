// Terry cloth: the one material every towel shares (the rail's two and the rolls in the basket: fixtures/towels.js), and
// the cloth's measures. Split from fixtures/towels.js on 2026-10-20 when that file grew past one read; towels.js
// re-exports all of it, so importers keep importing from there.
// The material: cloth sheen, a loop-pile normal and albedo tile drawn here in code, a roughness map along the towel
// (the hem and the flat-woven band), and the pile's tone at the scale a phone sees from a metre or two (tufts and their
// clumps, a few millimetres: lighter or darker, more or less sheen), so the cloth keeps its grain where the loops are
// finer than a pixel (tmp/wave3/look2.md 2: at 1-2 m it read as smooth paper).
import * as THREE from 'three';
import { createRng, smoothstep } from '../fx/rng.js';

export const TOWEL_DIMS = {
  wrapR: 0.02, // the fold's centre line over a rung (TOWEL_KINDS gives each kind its own): a folded towel is too thick to hug an 18 mm rung
  rungGap: 0.001, // the inside of the fold rests 1 mm over the rung's top (the terry's fuzz)
  hem: 0.012, // the folded hem at each end
  band: [0.04, 0.088], // the flat-woven band (dobby border), measured from the end
  bandThin: 0.003, // flat-woven: thinner than the loop pile (both layers together)
  hemThick: 0.75, // the hem's thickness over the pile's
  edgeStep: 0.003, // stations this far apart on the band's and the hem's edges keep them crisp
  endZone: 0.13, // stations are dense this near each end
  lean: 0.02, // the front half leans out a little toward its hem (a thick towel is never plumb)
  tile: 0.04, // the loop-pile texture (512 px) repeats every 4 cm (uv in metres); a smaller one covers less
  pilePx: 12.8, // pixels per millimetre of pile at every texture size: a loop (about 1.6 mm) is 20 px across
  bandU: 0.08, // across the band and the hem the pile is drawn stretched 12x: woven ribs instead of loops
  label: { w: 0.045, h: 0.09, fromEdge: 0.035 }, // a satin care label sewn into the front half's hem
};

// The slab's thickness at distance e from the nearer end: the hem, the flat-woven band, the loop pile.
export function towelThickness(t, e) {
  if (e < TOWEL_DIMS.hem) return t * TOWEL_DIMS.hemThick;
  if (e > TOWEL_DIMS.band[0] && e < TOWEL_DIMS.band[1]) return t - TOWEL_DIMS.bandThin;
  return t;
}
export const flatWoven = (e) => e < TOWEL_DIMS.hem || (e > TOWEL_DIMS.band[0] && e < TOWEL_DIMS.band[1]);
export const inBand = (e) => e > TOWEL_DIMS.band[0] && e < TOWEL_DIMS.band[1];

// Where along the towel the second uv set is: the first 15 cm from each end get a tenth of the layout map each (the
// hem and the band, drawn finely), the rest of the towel the middle (plain pile). So one map serves every length.
const END_SPAN = 0.15;
export function layoutV(s, length) {
  if (s < END_SPAN) return (Math.max(0, s) / END_SPAN) * 0.1;
  if (length - s < END_SPAN) return 1 - (Math.max(0, length - s) / END_SPAN) * 0.1;
  return 0.1 + (0.8 * (s - END_SPAN)) / Math.max(1e-6, length - 2 * END_SPAN);
}
// The roughness along that map: the hem a little smooth, the band's woven stripes smoother (they catch a soft sheen),
// the loop pile fully matt.
export function layoutRoughness(e) {
  if (e < TOWEL_DIMS.hem) return 0.86;
  if (inBand(e)) return Math.floor((e - TOWEL_DIMS.band[0]) / 0.006) % 2 ? 0.74 : 0.6;
  return 1;
}

// ---------------------------------------------------------------------------------------------------------------
// The loop pile: a seamless square tile of terry loops (size / TOWEL_DIMS.pilePx millimetres across), drawn as a
// height field: rows of small yarn loops lying over in tufts that lean together, on a ground weave. Returns RGBA
// bytes: a tangent-space normal map and an albedo (sRGB: the hollows between loops in shade, the loop tops light),
// and the tile's size in metres. Pure; seeded.
export const tileMetres = (size) => size / (TOWEL_DIMS.pilePx * 1000);
// The albedo's mean (linear): the pile's own shade. The towels' vertex colours are divided by it, so a towel shows its
// named colour on average (tests/towels.test.js measures it).
export const PILE_MEAN = 0.815;
const tiles = new Map(); // size:seed -> the tile (read-only bytes, shared by every material library: tests build many)
export function terryMaps(size = 512, seed = 7) {
  const key = `${size}:${seed}`;
  if (!tiles.has(key)) tiles.set(key, drawTerry(size, seed));
  return tiles.get(key);
}
function drawTerry(size, seed) {
  const N = size;
  const H = new Float32Array(N * N);
  const tone = new Float32Array(N * N).fill(1);
  const rng = createRng(seed);
  const mm = TOWEL_DIMS.pilePx; // pixels per millimetre
  const rows = Math.max(4, Math.round(N / (1.45 * mm)));
  const cols = Math.max(4, Math.round(N / (1.6 * mm)));
  const sv = N / rows;
  const su = N / cols;
  // a coarse periodic field (5 x 5): the loops lean together in tufts, some tufts stand a little higher
  const G = 5;
  const lean = Float32Array.from({ length: G * G }, () => rng.next());
  const clump = Float32Array.from({ length: G * G }, () => rng.next());
  const field = (f, x, y) => {
    const gx = (((x / N) * G) % G + G) % G;
    const gy = (((y / N) * G) % G + G) % G;
    const x0 = Math.floor(gx); const y0 = Math.floor(gy);
    const fx = gx - x0; const fy = gy - y0;
    const v = (i, j) => f[((j + G) % G) * G + ((i + G) % G)];
    const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * fx;
    const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * fx;
    return a + (b - a) * fy;
  };
  // the ground weave under the loops (periodic over the tile)
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) H[y * N + x] = 0.1 + 0.035 * Math.sin((4 * Math.PI * x) / su) * Math.sin((4 * Math.PI * y) / sv);
  }
  const span = 1.75; // a loop seen from above: an arc of about 200 degrees, its top toward the way it leans
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5 + 0.5 * (r & 1) + 0.35 * rng.signed()) * su;
      const cy = (r + 0.5 + 0.3 * rng.signed()) * sv;
      const dir = field(lean, cx, cy) * Math.PI * 2 + 0.9 * rng.signed();
      const h = (0.7 + 0.3 * rng.next()) * (0.8 + 0.2 * field(clump, cx, cy));
      const rl = su * (0.36 + 0.1 * rng.next());
      const ry = su * 0.16;
      const t = 0.95 + 0.1 * rng.next();
      const e1x = Math.cos(dir + span) * rl; const e1y = Math.sin(dir + span) * rl;
      const e2x = Math.cos(dir - span) * rl; const e2y = Math.sin(dir - span) * rl;
      const reach = Math.ceil(rl + ry + 1);
      // only the ring band round the loop can be yarn (the arc's ends lie on the ring too)
      const in2 = (rl - ry) ** 2;
      const out2 = (rl + ry) ** 2;
      for (let py = Math.floor(cy - reach); py <= Math.ceil(cy + reach); py++) {
        for (let px = Math.floor(cx - reach); px <= Math.ceil(cx + reach); px++) {
          const dx = px - cx; const dy = py - cy;
          const r2 = dx * dx + dy * dy;
          if (r2 <= in2 || r2 >= out2) continue;
          let rel = Math.atan2(dy, dx) - dir;
          rel -= Math.round(rel / (2 * Math.PI)) * 2 * Math.PI;
          const d = Math.abs(rel) <= span ? Math.abs(Math.sqrt(r2) - rl)
            : Math.sqrt(Math.min((dx - e1x) ** 2 + (dy - e1y) ** 2, (dx - e2x) ** 2 + (dy - e2y) ** 2));
          if (d >= ry) continue;
          const v = h * Math.sqrt(1 - (d / ry) ** 2) * (0.72 + 0.28 * Math.cos(Math.max(-span, Math.min(span, rel)) * 0.9));
          const i = (((py % N) + N) % N) * N + (((px % N) + N) % N);
          if (v > H[i]) { H[i] = v; tone[i] = t; }
        }
      }
    }
  }
  const normal = new Uint8Array(N * N * 4);
  const albedo = new Uint8Array(N * N * 4);
  const S = 0.22 * su; // slope scale: a loop's flank leans 40-60 degrees, the pile as a whole stays soft
  const SRGB = new Uint8Array(1025); // linear 0..1 in 1024 steps -> an sRGB byte
  for (let k = 0; k <= 1024; k++) {
    const c = k / 1024;
    SRGB[k] = Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255);
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const gx = (H[y * N + ((x + 1) % N)] - H[y * N + ((x - 1 + N) % N)]) / 2;
      const gy = (H[((y + 1) % N) * N + x] - H[((y - 1 + N) % N) * N + x]) / 2;
      const nx = -gx * S; const ny = -gy * S;
      const l = Math.sqrt(nx * nx + ny * ny + 1);
      normal[i * 4] = Math.round(((nx / l) * 0.5 + 0.5) * 255);
      normal[i * 4 + 1] = Math.round(((ny / l) * 0.5 + 0.5) * 255);
      normal[i * 4 + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      normal[i * 4 + 3] = 255;
      const a = Math.min(1, (0.72 + 0.28 * smoothstep(0.08, 0.85, H[i])) * tone[i]);
      const b = SRGB[Math.round(a * 1024)];
      albedo[i * 4] = b; albedo[i * 4 + 1] = b; albedo[i * 4 + 2] = b; albedo[i * 4 + 3] = 255;
    }
  }
  return { size: N, normal, albedo, metres: tileMetres(N) };
}

// ---------------------------------------------------------------------------------------------------------------
// The pile's tone (tmp/wave3/look2.md 2): at a metre or two a phone's pixel is 1-2.5 mm of cloth, finer loops than that
// average out, so what a camera sees of terry there is its tufts and their clumps: a few millimetres to a couple of
// centimetres, a little lighter or darker, catching more or less sheen. A seamless tile of PILE_TONE.tile metres (not a
// whole number of the loops' 4 cm tiles, so the two never repeat together), drawn as value noise in four octaves
// (cells of about 2, 4, 8 and 18 mm). RGBA bytes, each channel a factor stored as half its value (128 = 1): R the
// colour's (its mean exactly 1: the towel keeps its named colour), G the roughness's, B the sheen's. Pure; seeded.
export const PILE_TONE = { tile: 0.137, size: 256, depth: 0.5, sheen: 0.7, rough: 0.14 };
const tones = new Map();
export function pileTone(size = PILE_TONE.size, seed = 5) {
  const key = `${size}:${seed}`;
  if (!tones.has(key)) tones.set(key, drawPileTone(size, seed));
  return tones.get(key);
}
function drawPileTone(N, seed) {
  const rng = createRng(seed);
  // octaves: lattice cells across the tile (a power of two divides N: seamless), and their weights
  const octaves = [[128, 0.22], [64, 0.34], [32, 0.3], [16, 0.14]].map(([n, w]) => ({ n, w, v: Float32Array.from({ length: n * n }, () => rng.signed()) }));
  const f = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let v = 0;
      for (const o of octaves) {
        const gx = (x / N) * o.n; const gy = (y / N) * o.n;
        const x0 = Math.floor(gx); const y0 = Math.floor(gy);
        const fx = smoothstep(0, 1, gx - x0); const fy = smoothstep(0, 1, gy - y0);
        const at = (i, j) => o.v[((j + o.n) % o.n) * o.n + ((i + o.n) % o.n)];
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
        v += o.w * (a + (b - a) * fy);
      }
      f[y * N + x] = v;
    }
  }
  let mean = 0;
  for (let i = 0; i < N * N; i++) mean += f[i];
  mean /= N * N;
  const data = new Uint8Array(N * N * 4);
  let toneSum = 0;
  const toneOf = (i) => 1 + PILE_TONE.depth * (f[i] - mean);
  for (let i = 0; i < N * N; i++) toneSum += toneOf(i);
  const k = (N * N) / toneSum; // the colour's factor averages exactly 1
  const byte = (v) => Math.max(0, Math.min(255, Math.round((v / 2) * 255)));
  for (let i = 0; i < N * N; i++) {
    const t = toneOf(i) * k;
    data[i * 4] = byte(t);
    data[i * 4 + 1] = byte(1 - PILE_TONE.rough * Math.max(0, f[i] - mean)); // the fluffier tufts a little rougher
    data[i * 4 + 2] = byte(1 + PILE_TONE.sheen * (f[i] - mean)); // and catch more sheen
    data[i * 4 + 3] = 255;
  }
  return { size: N, data, metres: PILE_TONE.tile };
}

function tileTexture(data, N, srgb, metres = tileMetres(N)) {
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.repeat.set(1 / metres, 1 / metres);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// The roughness along a towel (second uv set, v): 4 x 1024, roughness in green (three.js reads G).
function layoutTexture() {
  const W = 4;
  const Hh = 1024;
  const data = new Uint8Array(W * Hh * 4);
  for (let r = 0; r < Hh; r++) {
    const v = (r + 0.5) / Hh;
    const e = v < 0.1 ? (v / 0.1) * END_SPAN : v > 0.9 ? ((1 - v) / 0.1) * END_SPAN : 1;
    const g = Math.round(layoutRoughness(e) * 255);
    for (let c = 0; c < W; c++) {
      const i = (r * W + c) * 4;
      data[i] = 255; data[i + 1] = g; data[i + 2] = 255; data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, W, Hh, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.channel = 1;
  t.needsUpdate = true;
  return t;
}

// The pile's tone in the material's shader (three.js 0.186.1 MeshPhysicalMaterial): sampled once by the towel's metres
// (uv), it scales the colour after the albedo map, the roughness after its map, and the sheen's colour.
export const TERRY_GLSL = {
  vertexPars: 'uniform float bathPileRepeat;\nvarying vec2 vBathPileUv;',
  vertex: '\tvBathPileUv = uv * bathPileRepeat;',
  fragmentPars: 'uniform sampler2D bathPile;\nvarying vec2 vBathPileUv;',
  colour: '\tvec3 bathPileTone = texture2D( bathPile, vBathPileUv ).rgb * 2.0;\n\tdiffuseColor.rgb *= bathPileTone.r;',
  roughness: '\troughnessFactor = min( 1.0, roughnessFactor * bathPileTone.g );',
  sheen: '#ifdef USE_SHEEN\n\tmaterial.sheenColor *= bathPileTone.b;\n#endif',
};
// where each part goes (each hook must be found: tests/towels.test.js assembles the real shader)
export const TERRY_HOOKS = {
  vertex: [['#include <common>', 'vertexPars'], ['#include <uv_vertex>', 'vertex']],
  fragment: [['#include <common>', 'fragmentPars'], ['#include <map_fragment>', 'colour'], ['#include <roughnessmap_fragment>', 'roughness'], ['#include <lights_physical_fragment>', 'sheen']],
};

// The one terry material (per material library): every towel and roll shares it and its textures.
const materials = new WeakMap();
export function towelMaterial(ctx) {
  const lib = ctx.materials;
  if (materials.has(lib)) return materials.get(lib);
  const N = ctx.quality === 'low' ? 256 : 512;
  const tile = terryMaps(N, 7);
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    map: tileTexture(tile.albedo, N, true),
    normalMap: tileTexture(tile.normal, N, false),
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: layoutTexture(),
    sheen: 1, // cloth: a soft lightening where the pile is seen edge-on
    sheenRoughness: 0.55,
    sheenColor: new THREE.Color('#a39b90'),
  });
  m.name = 'cloth:terry'; // its own (cloth) material, not one of the library's (tests/fixtures.test.js material rule)
  const tone = pileTone();
  const uniforms = {
    bathPile: { value: tileTexture(tone.data, tone.size, false, tone.metres) },
    bathPileRepeat: { value: 1 / tone.metres },
  };
  m.userData.pile = uniforms; // (tests)
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    for (const [stage, key] of [['vertex', 'vertexShader'], ['fragment', 'fragmentShader']]) {
      for (const [hook, part] of TERRY_HOOKS[stage]) shader[key] = shader[key].replace(hook, `${hook}\n${TERRY_GLSL[part]}`);
    }
  };
  m.customProgramCacheKey = () => 'clothTerry';
  materials.set(lib, m);
  return m;
}
