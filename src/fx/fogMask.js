// The fog mask maths: a small grid of "clearness" values (0 = fogged, 1 = wiped clear) laid over a glass or mirror.
// Pure: no DOM, no three.js. Pixel (i, j) has its centre at (i + 0.5, j + 0.5); row j = 0 is the BOTTOM edge (v = 0),
// matching a DataTexture with flipY = false on a plane's default uv.
// A finger stamps clearness; the fog creeps back linearly over `seconds`; a heater keeps its rectangle clear.

export function createMask(w, h) {
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  return {
    w: W,
    h: H,
    data: new Float32Array(W * H),
    // bounding box of pixels that may be above 0 (inclusive), so regrowth only walks that part
    bx0: W, by0: H, bx1: -1, by1: -1,
    active: false, // some pixel is above 0
    dirty: true, // changed since the texture was last filled
  };
}

function grow(m, x0, y0, x1, y1) {
  if (x0 < m.bx0) m.bx0 = x0;
  if (y0 < m.by0) m.by0 = y0;
  if (x1 > m.bx1) m.bx1 = x1;
  if (y1 > m.by1) m.by1 = y1;
}

// Value of a brush at distance d: hard (feather 0) = 1 inside r (inclusive), else 0; soft = 1 inside r - feather,
// falling linearly to 0 at r.
function brush(d, r, feather) {
  if (feather > 0) {
    const v = (r - d) / feather;
    return v >= 1 ? 1 : v > 0 ? v : 0;
  }
  return d <= r ? 1 : 0;
}

// Clear a capsule from (ax, ay) to (bx, by) with radius r (pixel units). amount scales the clearness (0..1).
export function stampSegment(m, ax, ay, bx, by, r, feather = 0, amount = 1) {
  if (!(r > 0)) return;
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 1));
  const x1 = Math.min(m.w - 1, Math.ceil(Math.max(ax, bx) + r + 1));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 1));
  const y1 = Math.min(m.h - 1, Math.ceil(Math.max(ay, by) + r + 1));
  if (x0 > x1 || y0 > y1) return;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let touched = false;
  for (let j = y0; j <= y1; j++) {
    const py = j + 0.5;
    for (let i = x0; i <= x1; i++) {
      const px = i + 0.5;
      let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + dx * t - px;
      const qy = ay + dy * t - py;
      const v = brush(Math.sqrt(qx * qx + qy * qy), r, feather) * amount;
      if (v > 0) {
        const k = j * m.w + i;
        if (v > m.data[k]) {
          m.data[k] = v > 1 ? 1 : v;
          touched = true;
        }
      }
    }
  }
  if (touched) {
    grow(m, x0, y0, x1, y1);
    m.active = true;
    m.dirty = true;
  }
}

export function stampDisc(m, cx, cy, r, feather = 0, amount = 1) {
  stampSegment(m, cx, cy, cx, cy, r, feather, amount);
}

// The fog creeps back: clearness falls by dt / seconds * factor (factor 0..1 follows how humid the air is).
export function regrow(m, dtSec, seconds, factor = 1) {
  if (!m.active || !(dtSec > 0) || !(seconds > 0) || !(factor > 0)) return;
  const dec = (dtSec / seconds) * factor;
  let any = false;
  let nx0 = m.w; let ny0 = m.h; let nx1 = -1; let ny1 = -1;
  for (let j = m.by0; j <= m.by1; j++) {
    const row = j * m.w;
    for (let i = m.bx0; i <= m.bx1; i++) {
      const k = row + i;
      const c = m.data[k];
      if (c > 0) {
        const n = c - dec;
        if (n > 0) {
          m.data[k] = n;
          any = true;
          if (i < nx0) nx0 = i;
          if (i > nx1) nx1 = i;
          if (j < ny0) ny0 = j;
          if (j > ny1) ny1 = j;
        } else {
          m.data[k] = 0;
        }
      }
    }
  }
  m.bx0 = nx0; m.by0 = ny0; m.bx1 = nx1; m.by1 = ny1;
  m.active = any;
  m.dirty = true;
}

// A heated pad keeps its rectangle clear, spreading from the centre: pixels whose rounded-rectangle distance from the
// centre (0 at the centre, about 1 at the edge) is below `front` are cleared. Only pixels inside the rectangle change.
// rect in pixel units { x0, y0, x1, y1 } (x1, y1 exclusive edges).
export function heatRect(m, rect, front, featherPx = 0) {
  if (!(front > 0)) return;
  const cx = (rect.x0 + rect.x1) / 2;
  const cy = (rect.y0 + rect.y1) / 2;
  const hw = Math.max(1e-6, (rect.x1 - rect.x0) / 2);
  const hh = Math.max(1e-6, (rect.y1 - rect.y0) / 2);
  const i0 = Math.max(0, Math.ceil(rect.x0 - 0.5));
  const i1 = Math.min(m.w - 1, Math.floor(rect.x1 - 0.5 - 1e-9));
  const j0 = Math.max(0, Math.ceil(rect.y0 - 0.5));
  const j1 = Math.min(m.h - 1, Math.floor(rect.y1 - 0.5 - 1e-9));
  if (i0 > i1 || j0 > j1) return;
  // the feather is given in pixels; convert to the normalised distance along the shorter half-size
  const f = featherPx > 0 ? featherPx / Math.min(hw, hh) : 0;
  let touched = false;
  for (let j = j0; j <= j1; j++) {
    const ny = Math.abs(j + 0.5 - cy) / hh;
    const ny4 = ny * ny * ny * ny;
    for (let i = i0; i <= i1; i++) {
      const nx = Math.abs(i + 0.5 - cx) / hw;
      const s = Math.sqrt(Math.sqrt(nx * nx * nx * nx + ny4));
      const v = f > 0 ? Math.min(1, Math.max(0, (front - s) / f)) : s < front ? 1 : 0;
      if (v > 0) {
        const k = j * m.w + i;
        if (v > m.data[k]) {
          m.data[k] = v;
          touched = true;
        }
      }
    }
  }
  if (touched) {
    grow(m, i0, j0, i1, j1);
    m.active = true;
    m.dirty = true;
  }
}

// Fill a Uint8Array (w * h) for the texture: 0..1 -> 0..255, rounded.
export function toBytes(m, out) {
  const d = m.data;
  for (let k = 0; k < d.length; k++) out[k] = (d[k] * 255 + 0.5) | 0;
  m.dirty = false;
  return out;
}

// For tests and checks: [i, j] of every pixel at or above the threshold.
export function clearedPixels(m, threshold = 0.999) {
  const out = [];
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) if (m.data[j * m.w + i] >= threshold) out.push([i, j]);
  return out;
}

export function clearMask(m) {
  m.data.fill(0);
  m.bx0 = m.w; m.by0 = m.h; m.bx1 = -1; m.by1 = -1;
  m.active = false;
  m.dirty = true;
}
