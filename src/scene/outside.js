// What is behind the window over the toilet: the sky of the visitor's own hour (scene/mood.js skyAt: daylight, the
// blue hour or the night over Bergen) at its real brightness in the room's units, seen through obscured bathroom
// glass (Norwegian bathroom windows are patterned or frosted: the pane passes most of the light but scatters it, so
// the window reads as a soft glow with a fine glass texture — bright white by day, a soft blue at dusk, dark at
// night). The old pane let 55 % of a sky darkened by a grey wash through and read as a grey board (review 2026-10-19,
// visual finding 6).
import * as THREE from 'three';

// The obscured pane: light through (most of it), how much it scatters, and how much of the sky's colour survives the
// scattering (the glass also sends some of the room's own warm light back: a dusk sky reads soft blue, not saturated).
export const PANE = { transmission: 0.86, roughness: 0.62, saturation: 0.55, patternM: 0.08 };

const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
// What reaches the pane through the glass: a mix of the sky up to the zenith and the ground, a little desaturated.
function seen(sky, h, z, g) {
  const c = [0, 1, 2].map((i) => sky.horizon[i] * h + sky.zenith[i] * z + sky.ground[i] * g);
  const y = lum(c);
  return c.map((v) => y + (v - y) * PANE.saturation);
}
export function paneGlow(sky) {
  return seen(sky, 0.5, 0.3, 0.2).map((v) => v * PANE.transmission);
}

// The glass's pattern (a fine, irregular hammered texture, as on "chinchilla"-type obscured glass): a seamless
// normal map drawn once. Null where there is no canvas (headless tests).
let patternTex = null;
export function glassPattern(size = 256, seed = 5) {
  if (patternTex) return patternTex;
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (!g || !g.createImageData) return null;
  let a = seed >>> 0;
  const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  const hgt = new Float32Array(size * size);
  for (let k = 0; k < 420; k++) {
    const cx = rnd() * size;
    const cy = rnd() * size;
    const r = 4 + rnd() * 9;
    const amp = (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.5);
    const R = Math.ceil(r * 2.5);
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const x = (((Math.round(cx) + dx) % size) + size) % size;
        const y = (((Math.round(cy) + dy) % size) + size) % size;
        hgt[y * size + x] += amp * Math.exp(-(dx * dx + dy * dy) / (2 * r * r));
      }
    }
  }
  const img = g.createImageData(size, size);
  const at = (x, y) => hgt[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = -(at(x + 1, y) - at(x - 1, y)) * 0.35;
      const ny = (at(x, y + 1) - at(x, y - 1)) * 0.35;
      const l = Math.hypot(nx, ny, 1);
      const o = (y * size + x) * 4;
      img.data[o] = Math.round((nx / l * 0.5 + 0.5) * 255);
      img.data[o + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
      img.data[o + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  patternTex = new THREE.CanvasTexture(c);
  patternTex.colorSpace = THREE.NoColorSpace;
  patternTex.wrapS = patternTex.wrapT = THREE.RepeatWrapping;
  patternTex.repeat.set(1 / PANE.patternM, 1 / PANE.patternM); // the pane's uv is in metres
  return patternTex;
}

export function createOutside(ctx, { sky } = {}) {
  const { layout: L, quality } = ctx;
  const Wn = L.window;
  const s = sky || { horizon: [0.13, 0.28, 0.85], zenith: [0.015, 0.07, 0.47], ground: [0.02, 0.02, 0.02] };
  // the sky's own light on a plane outside: the sky above, and lower down the neighbours' roofs and the trees (the
  // ground's light), which the obscured glass blurs into a darker lower part of the pane
  const geo = new THREE.PlaneGeometry(2.4, 2.4, 1, 24);
  const centreY = (Wn.y0 + Wn.y1) / 2 + 0.3; // the plane's middle, in the room
  const skyCol = seen(s, 0.55, 0.35, 0.1);
  const groundCol = seen(s, 0.3, 0.05, 0.65);
  const horizon = (Wn.y0 + Wn.y1) / 2 - 0.05; // the roofline, seen just under the pane's middle
  const pos = geo.attributes.position;
  const colours = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = centreY + pos.getY(i);
    const u = Math.min(1, Math.max(0, (y - (horizon - 0.12)) / 0.24));
    const t = u * u * (3 - 2 * u);
    for (let k = 0; k < 3; k++) colours[i * 3 + k] = groundCol[k] + (skyCol[k] - groundCol[k]) * t;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff });
  mat.name = 'outsideSky';
  const plane = new THREE.Mesh(geo, mat);
  // behind the window's wall, facing the room through it
  const sideX = { right: 1, left: -1 }[Wn.wall] ?? 1;
  plane.rotation.y = sideX > 0 ? -Math.PI / 2 : Math.PI / 2;
  plane.position.set(sideX > 0 ? L.room.W + Wn.depth + 0.9 : -Wn.depth - 0.9, centreY, (Wn.z0 + Wn.z1) / 2);
  plane.name = 'outside';

  const pattern = glassPattern();
  // At night the dark sky gives the pane nothing to pass: the patterned glass then reads as a dark surface whose
  // glossy bumps break the room's light into small glints. (A refracting pane blurred the black sky together with
  // the light frame round it into a dark blob with light edges; a matt one read as a flat grey board; both seen
  // 2026-10-19.)
  const night = s.state === 'night';
  // the obscured pane on a weak phone (and after the slow-frames step): no refraction, the same glow
  const glow = paneGlow(s);
  const peak = Math.max(...glow, 1e-6);
  const plain = new THREE.MeshStandardMaterial({
    color: night ? 0x3b4248 : 0xe2e6e8, roughness: night ? 0.28 : 0.7, metalness: 0, transparent: !night,
    opacity: night ? 1 : 0.92,
    emissive: night ? 0x000000 : new THREE.Color().setRGB(glow[0] / peak, glow[1] / peak, glow[2] / peak),
    emissiveIntensity: night ? 0 : peak,
    ...(pattern ? { normalMap: pattern, normalScale: new THREE.Vector2(night ? 1.3 : 1, night ? 1.3 : 1) } : {}),
  });
  plain.name = 'glassFrostedPlain';
  const frosted = quality === 'low' || night
    ? plain
    : new THREE.MeshPhysicalMaterial({
      color: 0xf2f4f4, roughness: PANE.roughness, metalness: 0, transmission: PANE.transmission, thickness: 0.004, ior: 1.5,
      ...(pattern ? { normalMap: pattern, normalScale: new THREE.Vector2(0.8, 0.8) } : {}),
    });
  if (frosted !== plain) frosted.name = 'glassFrosted';
  return {
    object3d: plane,
    frosted,
    material: mat,
    glow,
    transmission: PANE.transmission,
    // swap a refracting pane for the plain glow (the frame governor's glass step)
    plainPane(mesh) { if (mesh) mesh.material = plain; return plain; },
  };
}
