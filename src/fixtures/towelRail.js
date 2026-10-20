// The electric towel rail on the left wall: a vertical ladder (Strømberg CENTO 125-like: 125 cm high, 50 cm wide,
// polished steel), two side tubes, twelve rungs, four wall brackets, and a small white connection box beside it on
// the door side. Sizes: research/products.md section F. Placement: LAYOUT.towelRail (wall, z0..z1, y0..y1): out of the
// wet zone, so its cable never goes through the membrane.
// Local frame = wall frame of its wall (util.js); origin on the wall surface at the ladder's bottom centre.
//
// createTowelRail(ctx, { finish: 'chrome', rungs: 12 })
// parts: rail (all tubes and brackets, one mesh), connectionBox.
// anchors: topRung (centre of the highest rung; hang a towel here), button (the timer button on the right tube).
import * as THREE from 'three';
import { mesh, anchor, placeOnWall, createBuilder, M, cylinderBetween, lathe, RoundedBox, seg } from './util.js';

export const RAIL_DIMS = { out: 0.065, sideR: 0.0125, rungR: 0.009 };

export function createTowelRail(ctx, opts = {}) {
  const L = ctx.layout;
  const T = L.towelRail;
  const D = RAIL_DIMS;
  const finishMat = opts.finish || 'chrome';
  const n = opts.rungs || 12;
  const width = T.z1 - T.z0;
  const height = T.y1 - T.y0;
  const group = new THREE.Group();
  group.name = 'towelRail';
  placeOnWall(group, L, T.wall, (T.z0 + T.z1) / 2, T.y0);
  const parts = {};
  const anchors = {};

  const b = createBuilder(ctx);
  const sx = width / 2 - D.sideR;
  const z = D.out;
  for (const s of [-1, 1]) {
    b.add(finishMat, cylinderBetween([s * sx, 0.006, z], [s * sx, height - 0.006, z], D.sideR, seg(ctx, 24), true));
    for (const [y, f] of [[0.006, -1], [height - 0.006, 1]]) b.add(finishMat, new THREE.SphereGeometry(D.sideR, seg(ctx, 24), 8), M([s * sx, y, z], [0, 0, 0], [1, 0.5 * f * f, 1]));
    for (const y of [0.12, height - 0.12]) {
      b.add(finishMat, cylinderBetween([s * sx, y, 0], [s * sx, y, z - D.sideR + 0.002], 0.0085, 12, true));
      b.add(finishMat, lathe([[0.02, 0], [0.02, 0.007], [0.017, 0.0095], [0.0085, 0.01]], seg(ctx, 24)).rotateX(Math.PI / 2), M([s * sx, y, 0]));
    }
  }
  const step = (height - 0.12) / (n - 1);
  let topY = 0;
  for (let i = 0; i < n; i++) {
    const y = 0.06 + i * step;
    topY = y;
    b.add(finishMat, cylinderBetween([-sx + D.sideR - 0.002, y, z], [sx - D.sideR + 0.002, y, z], D.rungR, seg(ctx, 16), true));
  }
  // Timer button (3 or 6 hours, lights while on) on the right tube.
  b.add(finishMat, cylinderBetween([sx, 0.3, z + D.sideR - 0.003], [sx, 0.3, z + D.sideR + 0.004], 0.0075, 16));
  parts.rail = b.build(group, 'towelRail.rail')[finishMat];
  anchors.topRung = anchor('topRung', group, 0, topY, z);
  anchors.button = anchor('button', group, sx, 0.3, z + D.sideR + 0.004);

  // The connection box sits beside the rail on the door side, away from the shower (on a side wall the wall frame's
  // +x runs toward the back wall on the left wall and toward the door on the right wall).
  const doorSide = T.wall === 'left' ? -1 : 1;
  const box = new RoundedBox(0.08, 0.08, 0.034, 2, 0.006);
  parts.connectionBox = mesh(ctx, box, 'plasticWhite', 'towelRail.connectionBox');
  parts.connectionBox.position.set(doorSide * (sx + 0.07), 0.04, 0.017);
  group.add(parts.connectionBox);

  return { group, parts, anchors };
}
