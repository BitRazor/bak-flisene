// The vanity: a wall-hung oak unit (Vikingbad MIE 100-like, 100 x 46 x 57 cm) with three drawers (each with an LED
// strip inside its front and a bar handle), a 12 mm solid-surface countertop, a vessel basin (SIRI-like, 35 x 11 cm)
// with a pop-up plug, and a tall single-lever basin mixer. Sizes: research/products.md sections B and D.
// Placement: LAYOUT.vanity (back wall). Local frame = back-wall frame, origin at the unit's centre on the wall at the
// floor; it matches room axes (x right, y up, z out of the wall).
//
// createVanity(ctx, { finish: 'chrome', body: 'oak', top: 'stoneTop' })
// parts: carcass, countertop, drawer{Top,Middle,Bottom}Pivot (slide out along +z, 0..0.38 m) with drawer{..}Front and
//   drawer{..}Box (one merged oak mesh; subpartAt() tells 'front' from 'box'), drawer{..}Handle, drawer{..}Led (the
//   LED strip; visible = false until the drawer opens), basinOuter, basinInner (userData.profile: [r, y] of the inside
//   from the drain edge up to the rim, y from the basin's base), flange and mixerBody (one merged metal mesh,
//   subparts 'flange', 'mixerBody', 'aerator'), drainDark, plugPivot (slides up, 0..0.012 m) + plug, leverPivot
//   (joint 'lever': yaw about y, negative = left = warm; pitch about x, negative = lifted = flow) + lever.
// anchors: spout (where the water leaves the aerator), plug (top of the plug cap), drain (drain seat centre),
//   basinBase (centre of the basin's inside bottom), drawer{..}Inside (centre of each drawer's floor).
import * as THREE from 'three';
import {
  mesh, pivot, anchor, placeOnWall, createBuilder, boxGeo, M, lathe, smooth, cylinderBetween, tubeAlong, seg,
} from './util.js';

export const VANITY_DIMS = {
  frontT: 0.019,
  panelT: 0.016,
  counterT: 0.012,
  drawerTravel: 0.38,
  plugTravel: 0.012,
  mixer: { bodyR: 0.014, bodyH: 0.215, spoutY: 0.19, spoutReach: 0.168, outletY: 0.1752 },
};

// Height of the counter surface (where things stand on the vanity).
export function counterTop(layout) {
  return layout.vanity.top + VANITY_DIMS.counterT;
}

function cap(word) {
  return word[0].toUpperCase() + word.slice(1);
}

// Basin profiles, [r, y] from the basin's base (the counter surface).
function basinProfiles(N) {
  const outer = [
    [0.032, 0], [0.075, 0],
    ...smooth([[0.075, 0], [0.1, 0.006], [0.125, 0.018], [0.148, 0.038], [0.163, 0.062], [0.172, 0.088], [0.175, 0.105]], N).slice(1),
    [0.1748, 0.108], [0.1735, 0.1098], [0.1715, 0.11], [0.1695, 0.1095],
  ];
  const inner = [
    [0.1695, 0.1095], [0.168, 0.106],
    ...smooth([[0.168, 0.106], [0.165, 0.095], [0.157, 0.075], [0.142, 0.055], [0.12, 0.038], [0.095, 0.026], [0.068, 0.019], [0.045, 0.0158], [0.034, 0.015]], N).slice(1),
    [0.032, 0.012], [0.032, 0],
  ];
  return { outer, inner };
}

export function createVanity(ctx, opts = {}) {
  const L = ctx.layout;
  const V = L.vanity;
  const D = VANITY_DIMS;
  const finishMat = opts.finish || 'chrome';
  const bodyMat = opts.body || 'oak';
  const topMat = opts.top || 'stoneTop';
  const cx = (V.x0 + V.x1) / 2;
  const W = V.x1 - V.x0;
  const hw = W / 2;
  const cd = V.depth - D.frontT; // carcass depth behind the fronts
  const P = D.panelT;
  const yTop = counterTop(L);

  const group = new THREE.Group();
  group.name = 'vanity';
  placeOnWall(group, L, V.wall, cx, 0);
  const parts = {};
  const anchors = {};

  // --- carcass: sides, bottom, top, back and a divider under each drawer boundary ---
  const cb = createBuilder(ctx);
  const h = V.top - V.bottom;
  const ym = (V.top + V.bottom) / 2;
  cb.add(bodyMat, boxGeo(P, h, cd, 0.0015, 1), M([-hw + P / 2, ym, cd / 2]));
  cb.add(bodyMat, boxGeo(P, h, cd, 0.0015, 1), M([hw - P / 2, ym, cd / 2]));
  cb.add(bodyMat, boxGeo(W - 2 * P, P, cd), M([0, V.bottom + P / 2, cd / 2]));
  cb.add(bodyMat, boxGeo(W - 2 * P, P, cd), M([0, V.top - P / 2, cd / 2]));
  cb.add(bodyMat, boxGeo(W - 2 * P, h - 2 * P, 0.008), M([0, ym, 0.004]));
  const bounds = [...new Set(V.drawers.flatMap((d) => [d.y0, d.y1]))].filter((y) => y > V.bottom + 1e-6 && y < V.top - 1e-6);
  for (const y of bounds) cb.add(bodyMat, boxGeo(W - 2 * P, 0.012, cd - 0.01), M([0, y, (cd - 0.01) / 2 + 0.008]));
  parts.carcass = cb.build(group, 'vanity.carcass')[bodyMat];

  // --- drawers: each slides out of the carcass on its own pivot (front face centre) ---
  for (const d of V.drawers) {
    const K = cap(d.key);
    const dh = d.y1 - d.y0;
    const p = pivot(`drawer${K}Pivot`, 0, (d.y0 + d.y1) / 2, V.depth, { type: 'slide', axis: [0, 0, 1], min: 0, max: D.drawerTravel });
    const db = createBuilder(ctx);
    db.add(bodyMat, boxGeo(W - 0.003, dh - 0.003, D.frontT, 0.0025, 2), M([0, 0, -D.frontT / 2]), 'front');
    // Inner box in the same oak: two sides, a back and a floor, 40 cm long.
    const boxH = dh - 0.045;
    const by0 = -dh / 2 + 0.02;
    const bw = W - 2 * P - 0.03;
    const bl = 0.4;
    const bz = -D.frontT - bl / 2;
    db.add(bodyMat, boxGeo(0.012, boxH, bl), M([-bw / 2 + 0.006, by0 + boxH / 2, bz]), 'box');
    db.add(bodyMat, boxGeo(0.012, boxH, bl), M([bw / 2 - 0.006, by0 + boxH / 2, bz]), 'box');
    db.add(bodyMat, boxGeo(bw - 0.024, boxH, 0.012), M([0, by0 + boxH / 2, -D.frontT - bl + 0.006]), 'box');
    db.add(bodyMat, boxGeo(bw - 0.024, 0.012, bl - 0.012), M([0, by0 + 0.006, bz + 0.006]), 'box');
    // Bar handle (160 mm centres) in the tap finish.
    db.add(finishMat, tubeAlong([[-0.096, 0, 0.028], [0.096, 0, 0.028]], 0.006, { tubular: 2, radial: 16, caps: true }), null, 'handle');
    for (const sx of [-0.08, 0.08]) db.add(finishMat, cylinderBetween([sx, 0, 0], [sx, 0, 0.028], 0.0045, 12), null, 'handle');
    const built = db.build(p, `vanity.drawer${K}`);
    // LED strip inside the front: lit (visible) only while the drawer is open.
    const led = mesh(ctx, boxGeo(bw - 0.04, 0.006, 0.006), 'ledWarm', `vanity.drawer${K}Led`);
    led.position.set(0, dh / 2 - 0.035, -D.frontT - 0.004);
    led.castShadow = false;
    led.visible = false;
    p.add(led);
    group.add(p);
    parts[`drawer${K}Pivot`] = p;
    parts[`drawer${K}Front`] = built[bodyMat];
    parts[`drawer${K}Box`] = built[bodyMat];
    parts[`drawer${K}Handle`] = built[finishMat];
    parts[`drawer${K}Led`] = led;
    anchors[`drawer${K}Inside`] = anchor(`drawer${K}Inside`, p, 0, by0 + 0.012, bz);
  }

  // --- countertop ---
  const top = boxGeo(W, D.counterT, V.depth, 0.002, 1);
  top.translate(0, V.top + D.counterT / 2, V.depth / 2);
  parts.countertop = mesh(ctx, top, topMat, 'vanity.countertop');
  group.add(parts.countertop);

  // --- vessel basin (outer and inner surfaces), waste flange, pop-up plug ---
  const B = V.basin;
  const bxl = B.x - cx;
  const scale = B.diameter / 0.35;
  const sy = B.height / 0.11;
  const prof = basinProfiles(14);
  const outerPts = prof.outer.map(([r, y]) => [r * scale, y * sy]);
  const innerPts = prof.inner.map(([r, y]) => [r * scale, y * sy]);
  const S = seg(ctx, 72);
  const outerG = lathe(outerPts, S);
  outerG.translate(bxl, yTop, B.z);
  const innerG = lathe(innerPts, S);
  innerG.translate(bxl, yTop, B.z);
  parts.basinOuter = mesh(ctx, outerG, 'ceramicWhite', 'vanity.basinOuter');
  parts.basinInner = mesh(ctx, innerG, 'ceramicWhite', 'vanity.basinInner');
  parts.basinInner.userData.profile = innerPts.slice(0, -2).reverse(); // drain edge -> rim
  group.add(parts.basinOuter, parts.basinInner);

  // Static metal (waste flange + mixer body) and the dark waste depth are merged; see the mixer below.
  const seatY = 0.015 * sy;
  const fb = createBuilder(ctx);
  fb.add(finishMat, lathe([[0.032, seatY - 0.0005], [0.0395, seatY - 0.0005], [0.04, seatY + 0.0012], [0.0385, seatY + 0.0025], [0.032, seatY + 0.0025], [0.032, seatY - 0.004]], seg(ctx, 40)), M([bxl, yTop, B.z]), 'flange');
  // The dark depth of the waste under the plug (a disc facing up).
  fb.add('rubber', lathe([[0.032, 0.006], [0, 0.006]], seg(ctx, 24)), M([bxl, yTop, B.z]), 'drainDark');

  parts.plugPivot = pivot('plugPivot', bxl, yTop + seatY + 0.0025, B.z, { type: 'slide', axis: [0, 1, 0], min: 0, max: D.plugTravel });
  const plugG = lathe([[0, -0.03], [0.006, -0.03], [0.006, -0.002], [0.012, -0.0012], [0.029, -0.001], [0.0315, 0.0005], [0.0305, 0.0022], [0.026, 0.0038], [0.015, 0.0048], [0, 0.0052]], seg(ctx, 40));
  parts.plug = mesh(ctx, plugG, finishMat, 'vanity.plug');
  parts.plugPivot.add(parts.plug);
  group.add(parts.plugPivot);
  anchors.plug = anchor('plug', parts.plugPivot, 0, 0.0052, 0);
  anchors.drain = anchor('drain', group, bxl, yTop + seatY, B.z);
  anchors.basinBase = anchor('basinBase', group, bxl, yTop + seatY, B.z, { profile: parts.basinInner.userData.profile });

  // --- tall basin mixer with a top lever ---
  const X = D.mixer;
  const mx = V.mixer.x - cx;
  const mz = V.mixer.z;
  const at = (x, y, z) => M([mx + x, yTop + y, mz + z]);
  fb.add(finishMat, lathe([[0, 0], [0.0205, 0], [0.0205, 0.004], [0.019, 0.006], [X.bodyR, 0.007]], seg(ctx, 32)), at(0, 0, 0), 'mixerBody');
  fb.add(finishMat, cylinderBetween([0, 0.006, 0], [0, X.bodyH - 0.01, 0], X.bodyR, seg(ctx, 32), true), at(0, 0, 0), 'mixerBody');
  fb.add(finishMat, lathe([[X.bodyR, X.bodyH - 0.0101], [X.bodyR + 0.0005, X.bodyH - 0.004], [X.bodyR - 0.001, X.bodyH], [0, X.bodyH]], seg(ctx, 32)), at(0, 0, 0), 'mixerBody');
  fb.add(finishMat, tubeAlong([[0, X.spoutY, 0], [0, X.spoutY, X.spoutReach - 0.003]], 0.0095, { tubular: 2, radial: seg(ctx, 24) }), at(0, 0, 0), 'mixerBody');
  fb.add(finishMat, lathe([[0.0086, X.outletY], [0.0105, X.outletY], [0.0105, X.spoutY + 0.0085], [0.0095, X.spoutY + 0.0105], [0, X.spoutY + 0.011]], seg(ctx, 24)), at(0, 0, X.spoutReach), 'mixerBody');
  // The aerator's face (a disc facing down, 0.4 mm inside the outlet).
  fb.add(finishMat, lathe([[0, X.outletY + 0.0004], [0.0086, X.outletY + 0.0004]], seg(ctx, 24)), at(0, 0, X.spoutReach), 'aerator');
  const fixed = fb.build(group, 'vanity.metal');
  parts.flange = parts.mixerBody = fixed[finishMat];
  parts.drainDark = fixed.rubber;
  const mixerGroup = new THREE.Group();
  mixerGroup.position.set(mx, yTop, mz);
  parts.leverPivot = pivot('leverPivot', 0, X.bodyH, 0, { type: 'lever', yaw: { min: -0.7, max: 0.7 }, pitch: { min: -0.4, max: 0 } });
  const lb = createBuilder(ctx);
  lb.add(finishMat, cylinderBetween([0, 0, 0], [0, 0.012, 0], 0.0118, seg(ctx, 24)));
  lb.add(finishMat, new THREE.SphereGeometry(0.0118, seg(ctx, 24), 8, 0, Math.PI * 2, 0, Math.PI / 2), M([0, 0.012, 0], [0, 0, 0], [1, 0.35, 1]));
  lb.add(finishMat, tubeAlong([[0, 0.009, 0.004], [0, 0.0105, 0.08]], 0.0048, { tubular: 2, radial: 16, caps: true }));
  parts.lever = lb.build(parts.leverPivot, 'vanity.lever')[finishMat];
  mixerGroup.add(parts.leverPivot);
  group.add(mixerGroup);
  anchors.spout = anchor('spout', mixerGroup, 0, X.outletY, X.spoutReach, { direction: [0, -1, 0] });

  return { group, parts, anchors };
}
