// Clean new tiles, drawn rather than photographed. The free tile photographs read as old stone: the wall stone had
// rust-red stains, chipped corners and a crack, and the floor stone (shot with 33 cm tiles) was blown up to 60 cm
// (review 2026-10-19, visual finding 5). A Straume bathroom has new porcelain: the walls a light stone-look porcelain
// (30 x 30 cm), the floor a sand stone-look porcelain (60 x 60 cm). Each picture covers whole tiles with a seamless
// repeat (the joints lie on its tile lines, half a joint at each edge), each tile a little different from the next
// (as a real batch is), soft clouds and fine specks like printed stone, and grey joints. A normal map gives the joints
// their depth and each tile a hair of tilt, so a lamp's reflection breaks at the joints as on a real tiled wall.
// The pure part (tilePlan, jointCentres) is tested in tests/tiles.test.js; the drawing needs a canvas.
import * as THREE from 'three';

export const TILE_LOOKS = {
  wall: {
    tileM: 0.3, tiles: 8, jointMm: 2.5, bevelMm: 1.6, base: '#dedad3', grout: '#aea89e', tileVariation: 0.022,
    cloud: 0.05, speck: 0.06, specks: 260, grain: 0.022,
  },
  floor: {
    tileM: 0.6, tiles: 4, jointMm: 3, bevelMm: 1.8, base: '#baa991', grout: '#887d6d', tileVariation: 0.03,
    cloud: 0.065, speck: 0.08, specks: 900, grain: 0.03,
  },
};

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
// linear RGB (0..1) of a '#rrggbb' colour
export function colourOf(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255));
}
function hexOf(rgb) {
  return `#${rgb.map((c) => Math.round(Math.max(0, Math.min(1, linearToSrgb(c))) * 255).toString(16).padStart(2, '0')).join('')}`;
}

// a small seeded random source (the same picture every visit)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Where the joints' centres lie across the picture (px): on every tile line, both edges included.
export function jointCentres(look, px) {
  return Array.from({ length: look.tiles + 1 }, (_, k) => (k * px) / look.tiles);
}

// The picture's plan: how many metres it covers, and each tile's own colour, tilt and cloud offset.
export function tilePlan(look, { px = 2048, seed = 1 } = {}) {
  const r = rng(seed);
  const base = colourOf(look.base);
  const tiles = [];
  for (let j = 0; j < look.tiles; j++) {
    for (let i = 0; i < look.tiles; i++) {
      const v = (r() * 2 - 1) * look.tileVariation;
      tiles.push({
        i, j,
        colour: hexOf(base.map((c) => c * (1 + v))),
        tilt: [Math.round((r() * 2 - 1) * 1.4), Math.round((r() * 2 - 1) * 1.4)], // normal-map steps
        cloud: [r(), r()],
        flip: r() < 0.5,
      });
    }
  }
  return { metres: look.tiles * look.tileM, tilePx: px / look.tiles, px, tiles, seed };
}

// Smooth seamless clouds on a small canvas: a sum of waves whose frequencies are whole numbers of cycles across it.
function cloudCanvas(n, r) {
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n;
  const g = c.getContext('2d');
  const img = g.createImageData(n, n);
  const waves = [];
  for (let k = 0; k < 9; k++) {
    const fx = Math.round((r() * 2 - 1) * 6);
    const fy = Math.round((r() * 2 - 1) * 6) || 1;
    const f = Math.hypot(fx, fy);
    waves.push({ fx, fy, a: 1 / (0.6 + f), ph: r() * Math.PI * 2 });
  }
  let max = 0;
  const vals = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let v = 0;
      for (const w of waves) v += w.a * Math.sin(((w.fx * x + w.fy * y) / n) * Math.PI * 2 + w.ph);
      vals[y * n + x] = v;
      max = Math.max(max, Math.abs(v));
    }
  }
  for (let i = 0; i < n * n; i++) {
    const v = vals[i] / max; // -1..1
    const o = i * 4;
    const light = v > 0;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = light ? 255 : 0;
    img.data[o + 3] = Math.round(Math.abs(v) * 255);
  }
  g.putImageData(img, 0, 0);
  return c;
}
function grainCanvas(n, r) {
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n;
  const g = c.getContext('2d');
  const img = g.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const v = r();
    const o = i * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = v > 0.5 ? 255 : 0;
    img.data[o + 3] = Math.round(Math.abs(v - 0.5) * 2 * 255);
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Draws the colour and normal pictures. Returns { map, normalMap, plan } (three.js textures, repeat set to the plan).
export function tileTextures(look, { px = 2048, normalPx = px / 2, seed = 1, anisotropy = 8 } = {}) {
  const plan = tilePlan(look, { px, seed });
  const r = rng(seed * 7919 + 13);
  const T = plan.tilePx;
  const perM = px / plan.metres;
  const joint = (look.jointMm / 1000) * perM;

  // --- colour
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  const g = c.getContext('2d');
  const clouds = cloudCanvas(128, r);
  const fine = cloudCanvas(64, r);
  const grain = grainCanvas(256, r);
  for (const t of plan.tiles) {
    const x = t.i * T;
    const y = t.j * T;
    g.save();
    g.beginPath();
    g.rect(x, y, T, T);
    g.clip();
    g.fillStyle = t.colour;
    g.fillRect(x, y, T, T);
    // soft clouds, each tile cut from a different place of the cloud picture (printed stone never repeats tile to tile)
    g.globalAlpha = look.cloud;
    const cs = T * 2.2;
    const ox = x - t.cloud[0] * cs;
    const oy = y - t.cloud[1] * cs;
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) g.drawImage(clouds, ox + a * cs, oy + b * cs, cs, cs);
    g.globalAlpha = look.cloud * 0.6;
    const fs = T * 0.7;
    for (let a = -1; a < 3; a++) for (let b = -1; b < 3; b++) g.drawImage(fine, x - t.cloud[1] * fs + a * fs, y - t.cloud[0] * fs + b * fs, fs, fs);
    g.restore();
  }
  // fine specks, as in printed stone porcelain: a little darker or lighter than the tile, never another colour
  // (small squares: at this size a speck is a pixel or two, and squares draw many times faster than circles)
  const base = colourOf(look.base);
  const shades = [-1, -0.6, 0.5, 1].map((s) => hexOf(base.map((v) => v * (1 + s * look.speck))));
  const n = Math.round(look.specks * look.tiles * look.tiles * (px / 2048));
  g.globalAlpha = 0.8;
  for (let k = 0; k < n; k++) {
    const sx = r() * px;
    const sy = r() * px;
    const size = Math.max(1, (0.4 + r() * 1.2) * (perM / 1000)); // 0.4..1.6 mm
    g.fillStyle = shades[(r() * shades.length) | 0];
    g.fillRect(sx, sy, size, size);
  }
  // grain over everything (seamless: the picture is a whole number of grain tiles across)
  g.globalAlpha = look.grain;
  for (let gy = 0; gy < px; gy += 256) for (let gx = 0; gx < px; gx += 256) g.drawImage(grain, gx, gy);
  // the joints: centred on the tile lines (half at each edge, so the repeat joins), grout grey
  g.globalAlpha = 1;
  g.fillStyle = look.grout;
  for (const p of jointCentres(look, px)) {
    g.fillRect(p - joint / 2, 0, joint, px);
    g.fillRect(0, p - joint / 2, px, joint);
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;

  // --- normals: flat faces with a hair of tilt each, bevelled edges into the joints, flat recessed grout
  const nc = document.createElement('canvas');
  nc.width = normalPx;
  nc.height = normalPx;
  const ng = nc.getContext('2d');
  const s = normalPx / px;
  const TN = T * s;
  const jn = Math.max(1, joint * s);
  const bev = Math.max(1, (look.bevelMm / 1000) * perM * s);
  for (const t of plan.tiles) {
    ng.fillStyle = `rgb(${128 + t.tilt[0]},${128 + t.tilt[1]},255)`;
    ng.fillRect(t.i * TN, t.j * TN, TN, TN);
  }
  const edge = (x, y, w, h, nx, ny) => {
    ng.fillStyle = `rgb(${Math.round(128 + nx * 127)},${Math.round(128 + ny * 127)},${Math.round(128 + Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)) * 127)})`;
    ng.fillRect(x, y, w, h);
  };
  const lines = jointCentres(look, normalPx);
  for (const p of lines) {
    // the tile edge right of / below a joint tilts toward it, the one left of / above it the other way (+v is up)
    edge(p + jn / 2, 0, bev, normalPx, -0.7, 0);
    edge(p - jn / 2 - bev, 0, bev, normalPx, 0.7, 0);
    edge(0, p + jn / 2, normalPx, bev, 0, 0.7);
    edge(0, p - jn / 2 - bev, normalPx, bev, 0, -0.7);
  }
  ng.fillStyle = 'rgb(128,128,255)';
  for (const p of lines) {
    ng.fillRect(p - jn / 2, 0, jn, normalPx);
    ng.fillRect(0, p - jn / 2, normalPx, jn);
  }
  const normalMap = new THREE.CanvasTexture(nc);
  normalMap.colorSpace = THREE.NoColorSpace;

  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
    t.repeat.set(1 / plan.metres, 1 / plan.metres);
    t.needsUpdate = true;
  }
  return { map, normalMap, plan };
}
