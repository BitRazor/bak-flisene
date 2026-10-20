// Baked light where the bake could not see: the toilet boxing covered part of the right wall and the floor, so with
// the floor-standing toilet (no boxing) those patches would show the boxing's packed light or plain darkness. A copy
// of the map gets each patch filled from the light all round it (light varies smoothly along a wall), so no edge of
// the old boxing shows.
import * as THREE from 'three';

// rects: [{ u0, u1, v0, v1 }] in the map's uv1 space (v up; the image rows run down, as flipY loads them).
export function patchedMap(map, rects) {
  const img = map.image;
  const W = img.width;
  const H = img.height;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, W, H);
  const px = d.data;
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(Math.min(r.u0, r.u1) * W) - 1);
    const x1 = Math.min(W - 1, Math.ceil(Math.max(r.u0, r.u1) * W) + 1);
    const y0 = Math.max(0, Math.floor((1 - Math.max(r.v0, r.v1)) * H) - 1);
    const y1 = Math.min(H - 1, Math.ceil((1 - Math.min(r.v0, r.v1)) * H) + 1);
    fillPatch(px, W, H, { x0, x1, y0, y1 });
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = map.colorSpace;
  t.channel = map.channel;
  t.flipY = map.flipY;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Fills the pixels [x0..x1] x [y0..y1] of an RGBA image (inclusive) from the ring of pixels just outside them: a
// Coons patch, which meets the light round the hole on every side (no edge of it shows) and runs smoothly between.
// A side against the map's edge has no light beyond it; it is drawn straight between its two corners. Pure.
export function fillPatch(px, W, H, { x0, x1, y0, y1 }) {
  const xl = x0 - 1;
  const xr = x1 + 1;
  const yt = y0 - 1;
  const yb = y1 + 1;
  const get = (x, y, k) => px[(Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4 + k];
  for (let k = 0; k < 3; k++) {
    const c00 = get(xl, yt, k);
    const c10 = get(xr, yt, k);
    const c01 = get(xl, yb, k);
    const c11 = get(xr, yb, k);
    for (let y = y0; y <= y1; y++) {
      const t = (y - yt) / (yb - yt);
      const L = xl >= 0 ? get(xl, y, k) : c00 + (c01 - c00) * t;
      const R = xr < W ? get(xr, y, k) : c10 + (c11 - c10) * t;
      for (let x = x0; x <= x1; x++) {
        const s = (x - xl) / (xr - xl);
        const T = yt >= 0 ? get(x, yt, k) : c00 + (c10 - c00) * s;
        const B = yb < H ? get(x, yb, k) : c01 + (c11 - c01) * s;
        const v = (1 - t) * T + t * B + (1 - s) * L + s * R
          - ((1 - s) * (1 - t) * c00 + s * (1 - t) * c10 + (1 - s) * t * c01 + s * t * c11);
        px[(y * W + x) * 4 + k] = Math.max(0, Math.min(255, Math.round(v)));
      }
    }
  }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px[(y * W + x) * 4 + 3] = 255;
}

// The uv1 of a surface at a world point, by a short ray straight onto it (along -normal).
export function uv1At(mesh, point, normal) {
  const ray = new THREE.Raycaster(point.clone().addScaledVector(normal, 0.05), normal.clone().negate(), 0, 0.2);
  const hit = ray.intersectObject(mesh, false)[0];
  return hit && hit.uv1 ? hit.uv1.clone() : null;
}
