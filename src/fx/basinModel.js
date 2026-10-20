// The basin's water: how much is in it, how deep, how warm, and how fast it leaves through an open plug. Pure.
// Units: metres, cubic metres, seconds. Temperature 0..1 on the mixer's scale (0 cold, 1 full hot).
//
// Filling: volume grows by the inflow. Draining: Torricelli's law, outflow = drainArea * sqrt(2 g depth), where
// drainArea is the waste's effective opening (discharge coefficient times area). The default 3.9e-4 m2 lets an open
// waste keep up with the tap holding about a centimetre of water, and empties a full vessel basin in about 20 s
// (a tuned value, not a measured product figure).

export const G = 9.81;

export const BASIN_DEFAULTS = Object.freeze({
  wall: 0.008, // ceramic wall thickness at the rim (m)
  floor: 0.012, // thickness under the inner bottom (m)
  bottomShare: 0.55, // flat bottom radius as a share of the inner rim radius
  maxFill: 0.8, // water stops at 80 % of the inner depth (no overflow in a vessel basin)
  drainArea: 3.9e-4, // effective waste opening (m2), see above
  litresPerSecond: 0.2, // tap at full flow: about twice a real aerated basin tap, so a visitor sees it fill in ~25 s
  coolTau: 300, // seconds for the water to lose most of its heat to the room
  ambient: 0.3, // the room's temperature on the mixer scale (about 23 degrees)
});

// The vessel basin's inner shape from LAYOUT.vanity.basin ({ diameter, height }).
export function basinDims(basin, d = BASIN_DEFAULTS) {
  const outerRadius = basin.diameter / 2;
  const innerRadius = outerRadius - d.wall;
  const innerDepth = basin.height - d.floor;
  return {
    outerRadius,
    innerRadius,
    innerDepth,
    bottomRadius: innerRadius * d.bottomShare,
    floor: d.floor,
    wall: d.wall,
    height: basin.height,
  };
}

// Inner radius at height h above the inner bottom: a flat bottom that rounds up into the wall as a quarter ellipse.
// Fixtures that model the bowl should lathe this same curve so the water's edge meets the ceramic.
export function vesselProfile({ innerRadius, bottomRadius, innerDepth }) {
  const R = innerRadius;
  const rb = bottomRadius;
  const D = innerDepth;
  return {
    depth: D,
    bottomOffset: 0,
    rimRadius: R,
    radiusAt(h) {
      const x = h <= 0 ? 0 : h >= D ? 1 : h / D;
      const k = 1 - (1 - x) * (1 - x);
      return rb + (R - rb) * Math.sqrt(k > 0 ? k : 0);
    },
    // where the bowl reaches radius r: height above the inner bottom (0 on the flat bottom)
    heightAtRadius(r) {
      if (r <= rb) return 0;
      if (r >= R) return D;
      const s = (r - rb) / (R - rb);
      return D * (1 - Math.sqrt(1 - s * s));
    },
  };
}

export function cylinderProfile(radius, depth) {
  return { depth, radiusAt: () => radius, heightAtRadius: () => 0 };
}

// A bowl given as [r, y] points from its lowest point (the waste's edge) up to the rim, y measured from the basin's
// base: the format the vanity fixture publishes on anchors.basinBase.userData.profile. Heights in radiusAt are above
// the lowest point; bottomOffset is that point's height above the base.
export function pointsProfile(points) {
  const pts = points.map(([r, y]) => [r, y]).sort((a, b) => a[1] - b[1]);
  const y0 = pts[0][1];
  const depth = pts[pts.length - 1][1] - y0;
  function lerpBy(key, value, other) {
    // walk the points while `key` (0 = r, 1 = y) grows, interpolate `other`
    if (value <= pts[0][key]) return pts[0][other];
    for (let i = 1; i < pts.length; i++) {
      if (value <= pts[i][key]) {
        const a = pts[i - 1];
        const b = pts[i];
        const t = b[key] > a[key] ? (value - a[key]) / (b[key] - a[key]) : 1;
        return a[other] + (b[other] - a[other]) * t;
      }
    }
    return pts[pts.length - 1][other];
  }
  return {
    depth,
    bottomOffset: y0,
    rimRadius: pts[pts.length - 1][0],
    radiusAt: (h) => lerpBy(1, y0 + Math.min(Math.max(h, 0), depth), 0),
    heightAtRadius: (r) => lerpBy(0, r, 1) - y0,
  };
}

// A depth <-> volume table (Simpson integration of pi r^2 between table rows), so a frame needs only a lookup.
export function makeVolumeTable(profile, n = 256, sub = 8) {
  const D = profile.depth;
  const h = new Float64Array(n + 1);
  const v = new Float64Array(n + 1);
  const area = (y) => Math.PI * profile.radiusAt(y) ** 2;
  for (let k = 1; k <= n; k++) {
    const a = (D * (k - 1)) / n;
    const b = (D * k) / n;
    const step = (b - a) / sub;
    let s = area(a) + area(b);
    for (let q = 1; q < sub; q++) s += (q % 2 ? 4 : 2) * area(a + q * step);
    h[k] = b;
    v[k] = v[k - 1] + (s * step) / 3;
  }
  function volumeAt(depth) {
    if (!(depth > 0)) return 0;
    if (depth >= D) return v[n];
    const f = (depth / D) * n;
    const k = Math.floor(f);
    const t = f - k;
    // exact inside a row for a cylinder; Simpson-accurate rows otherwise
    return v[k] + (v[k + 1] - v[k]) * t;
  }
  function depthAt(volume) {
    if (!(volume > 0)) return 0;
    if (volume >= v[n]) return D;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (v[mid] <= volume) lo = mid;
      else hi = mid;
    }
    const span = v[hi] - v[lo];
    const t = span > 0 ? (volume - v[lo]) / span : 0;
    return h[lo] + (h[hi] - h[lo]) * t;
  }
  return { depth: D, n, h, v, volumeAt, depthAt, radiusAt: (y) => profile.radiusAt(y), maxVolume: v[n] };
}

export function createBasinState() {
  return { volume: 0, depth: 0, outflow: 0, inflow: 0, temperature: BASIN_DEFAULTS.ambient, full: false, empty: true };
}

const TINY = 2e-7; // m3 (0.2 ml): below this the basin counts as empty

// Advance the basin by dtSec. inputs: { inflow (m3/s), plugOpen (bool), temperature (0..1 of the incoming water) }.
// params: { table, drainArea, maxDepth, coolTau?, ambient? }. Mutates and returns state.
export function basinStep(st, dtSec, inputs, params) {
  const dt = dtSec > 0 ? dtSec : 0;
  const table = params.table;
  const maxDepth = Math.min(params.maxDepth ?? table.depth, table.depth);
  const maxVolume = table.volumeAt(maxDepth);
  const qIn = inputs.inflow > 0 ? inputs.inflow : 0;
  const tIn = Number.isFinite(inputs.temperature) ? inputs.temperature : st.temperature;
  const c = inputs.plugOpen ? (params.drainArea ?? BASIN_DEFAULTS.drainArea) : 0;
  const ambient = params.ambient ?? BASIN_DEFAULTS.ambient;
  const coolTau = params.coolTau ?? BASIN_DEFAULTS.coolTau;

  const out = (vol) => (c > 0 && vol > 0 ? c * Math.sqrt(2 * G * table.depthAt(vol)) : 0);
  const rate = (vol) => qIn - out(vol);

  // RK4 in sub-steps of at most 5 ms (the sqrt makes the last millimetres stiff)
  const steps = Math.max(1, Math.ceil(dt / 0.005));
  const h = dt / steps;
  let V = st.volume;
  let drained = 0;
  for (let s = 0; s < steps; s++) {
    const k1 = rate(V);
    const k2 = rate(Math.max(0, V + 0.5 * h * k1));
    const k3 = rate(Math.max(0, V + 0.5 * h * k2));
    const k4 = rate(Math.max(0, V + h * k3));
    const dV = (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    const before = V;
    // mix in the incoming water's temperature (by volume) before the level is clamped
    const added = qIn * h;
    if (added > 0) st.temperature = (st.temperature * before + tIn * added) / (before + added);
    V = before + dV;
    drained += Math.max(0, added - dV);
    if (V < TINY && qIn === 0) V = 0;
    if (V < 0) V = 0;
    if (V > maxVolume) V = maxVolume;
  }
  st.volume = V;
  st.depth = V > 0 ? Math.min(table.depthAt(V), maxDepth) : 0;
  if (V >= maxVolume) st.depth = maxDepth;
  st.inflow = qIn;
  st.outflow = out(V);
  st.full = V >= maxVolume - 1e-12;
  st.empty = V <= 0;
  // the water cools toward the room
  if (coolTau > 0 && dt > 0) st.temperature = ambient + (st.temperature - ambient) * Math.exp(-dt / coolTau);
  st.drained = drained;
  return st;
}
