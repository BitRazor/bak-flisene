// The toilet: wall-hung (Geberit Acanto-like, 35.5 x 34 x 51 cm) or floor-standing back-to-wall (35 x 42.5 x 51 cm),
// both rimless, with a soft-close seat and lid, the boxed-in wall with its flush plate (small and large button), and the
// hidden parts for the see-through view: steel frame, concealed cistern, flush pipe, the trapway in the bowl, the outlet
// pipe and the soil stack (all visible = false until the view shows them). Sizes: research/products.md section A.
//
// Placement: LAYOUT.toilet (right wall, facing left). Local frame = wall frame of the right wall (util.js):
// origin on the wall surface at the floor, at z = LAYOUT.toilet.z; +z out of the wall, +x along the wall (room +z).
// The floor falls to the drain (data/floor.js): the wall-hung toilet's boxing is tiled down to the floor; the
// floor-standing one sits with its foot on the lowest floor point under it. The boxing's tiles continue the right
// wall's joints (world-based uv from LAYOUT.tiles.setOut), so its cuts match the wall's.
//
// createToilet(ctx, { variant: 'wallHung' | 'floor', finish: 'chrome', boxMaterial: 'tileSand' })
// parts (wall-hung): boxing, boxingTop, bowl, hinges, seatPivot/seat, lidPivot/lid (hinge axis along the wall at the
//   back of the bowl; opening = negative rotation.x), flushPlatePivot/flushPlate (slides out of the wall),
//   flushLargePivot/flushLarge and flushSmallPivot/flushSmall (slide into the wall), hidden: frame, cistern, flushPipe,
//   bowlTrap, outletPipe, stack.
// parts (floor, close-coupled): no boxing, frame or wall plate; tankBase (the ceramic body back to the wall), tank (the
//   cistern on it),
//   flushLarge/SmallPivot on the tank lid (pressed down), hidden: bowlTrap, outletPipe, stack (the stack is in the wall).
// anchors: flushInlet, bowlWater (userData.halfWidth/halfDepth of the water surface), outlet, stackJoin, seatTop.
import * as THREE from 'three';
import {
  mesh, pivot, anchor, placeOnWall, createBuilder, boxGeo, M, loftGeometry, flatExtrude, standExtrude,
  roundedRectShape, tubeAlong, tubeSmooth, cylinderBetween, seg, RoundedBox,
} from './util.js';
import { lowestUnder } from '../data/floor.js';

// Tile uv (metres) for a box on the right wall built in this fixture's wall frame (local +x = room +z, local +z = out
// of the wall = room -x): the face toward the room continues the wall's columns (u = room z - the wall's set-out), the
// sides start a tile at the wall's corner, and every face continues the wall's rows (v = y - rows).
function wallTileUV(g, L, wallZ) {
  const so = (L.tiles && L.tiles.setOut) || {};
  const u0 = so.wall_right || 0;
  const rows = so.rows || 0;
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const [lx, ly, lz] = [p.getX(i), p.getY(i), p.getZ(i)];
    const [nx, ny] = [n.getX(i), n.getY(i)];
    if (Math.abs(ny) > 0.5) uv.setXY(i, lx, lz); // top and bottom: hidden
    else if (nx > 0.5) uv.setXY(i, -lz, ly - rows); // the side toward the door (room +z)
    else if (nx < -0.5) uv.setXY(i, lz, ly - rows); // the side toward the shower (room -z)
    else uv.setXY(i, wallZ + lx - u0, ly - rows); // the face toward the room (and its hidden back)
  }
  uv.needsUpdate = true;
  return g;
}

export const TOILET_DIMS = {
  wallHung: { rimY: 0.40, height: 0.34, depth: 0.51, halfWidth: 0.1775, outletY: 0.23 },
  floor: { rimY: 0.425, height: 0.425, depth: 0.51, halfWidth: 0.175, outletY: 0.18 },
  hingeBack: 0.055, // hinge axis: 5.5 cm in front of the boxing face
  hingeUp: 0.023, // ... and 2.3 cm above the rim (between seat and lid)
  waterDrop: 0.125, // water surface 12.5 cm below the rim
  plateY: 1.0, // flush plate centre height
  buttonTravel: 0.005,
};

// Outer outline of the bowl seen from above, normalised: x in [-1, 1], z in [0, 1] (0 = wall, 1 = front).
// A superellipse whose back is flattened against the wall and whose front narrows a little (egg shape).
function outerOutline(N) {
  const pts = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const u = Math.sign(c) * Math.abs(c) ** (2 / 2.6);
    const v = Math.sign(s) * Math.abs(s) ** (2 / 2.6);
    const zn = Math.max(0, 0.46 + 0.54 * v);
    const f = Math.max(0, (zn - 0.5) / 0.5);
    pts.push([u * (1 - 0.2 * f ** 1.6), zn]);
  }
  return pts;
}

// The bowl opening seen from above, normalised: x in [-1, 1], v in [-1, 1] (-1 = back, +1 = front).
function openingOutline(N) {
  const pts = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const u = Math.sign(c) * Math.abs(c) ** (2 / 2.3);
    const v = Math.sign(s) * Math.abs(s) ** (2 / 2.3);
    const f = Math.max(0, v);
    pts.push([u * (1 - 0.12 * f ** 1.5), v]);
  }
  return pts;
}

const OPEN = { halfWidth: 0.128, halfDepth: 0.14, centre: 0.335 }; // the opening in bowl coordinates (z from the wall)
// Inside of the bowl going down from the rim: [drop below rim, scale of the opening, centre z]; ends in the throat.
const DESCENT = [
  [0.004, 1.0, 0.335], [0.012, 0.975, 0.336], [0.03, 0.93, 0.338], [0.055, 0.85, 0.342], [0.08, 0.75, 0.346],
  [0.105, 0.635, 0.35], [0.125, 0.545, 0.353], [0.145, 0.43, 0.357], [0.165, 0.3, 0.362], [0.18, 0.19, 0.366],
  [0.192, 0.09, 0.369], [0.2, 0.0, 0.37],
];

function bowlGeometry(variant, N) {
  const d = TOILET_DIMS[variant];
  const { rimY, depth: D, halfWidth: A } = d;
  const out = outerOutline(N);
  const opn = openingOutline(N);
  const rings = [];
  const fil = 0.006;
  if (variant === 'wallHung') {
    // Side profile [height, depth from the wall, half width]: a gently rising underside, a rounded front-bottom
    // corner and a near-vertical front; the lowest rings are narrower so the bottom edge is rounded too.
    const yb = rimY - d.height; // the product's 34 cm body height: lowest point at the wall
    const table = [
      [yb, 0, 0.085], [yb + 0.006, 0.06, 0.105], [yb + 0.015, 0.13, 0.12], [yb + 0.027, 0.2, 0.13],
      [yb + 0.04, 0.26, 0.136], [yb + 0.057, 0.32, 0.142], [yb + 0.077, 0.37, 0.148], [yb + 0.105, 0.415, 0.154],
      [yb + 0.14, 0.452, 0.16], [yb + 0.18, 0.48, 0.166], [yb + 0.225, 0.498, 0.171], [yb + 0.27, 0.507, 0.175],
      [yb + 0.305, D, A], [rimY - fil, D, A],
    ];
    for (const [y, dd, a] of table) rings.push(out.map(([xn, zn]) => [a * xn, y, dd * zn]));
  } else {
    // Floor-standing, back to wall: a closed foot that widens up to the rim.
    const table = [
      [0, 0.4, 0.125], [0.012, 0.402, 0.126], [0.06, 0.412, 0.13], [0.12, 0.43, 0.138], [0.18, 0.452, 0.148],
      [0.24, 0.474, 0.158], [0.3, 0.492, 0.166], [0.35, 0.503, 0.172], [0.39, 0.509, A], [rimY - fil, D, A],
    ];
    for (const [y, dd, a] of table) rings.push(out.map(([xn, zn]) => [a * xn, y, dd * zn]));
  }
  // Rounded top edge, then the flat deck, then the rimless inside down to the throat.
  rings.push(out.map(([xn, zn]) => [A * 0.97 * xn, rimY, 0.004 + (D - 0.008) * zn]));
  rings.push(opn.map(([xn, vn]) => [OPEN.halfWidth * 1.05 * xn, rimY, OPEN.centre + OPEN.halfDepth * 1.05 * vn]));
  for (const [drop, f, zc] of DESCENT) {
    rings.push(opn.map(([xn, vn]) => [OPEN.halfWidth * f * xn, rimY - drop, zc + OPEN.halfDepth * f * vn]));
  }
  return loftGeometry(rings);
}

// The part of the outer rim outline in front of zCut (bowl coordinates), as a Shape in (x, z), plus the opening hole.
function seatShape(variant, N, zCut, scale, hole) {
  const { depth: D, halfWidth: A } = TOILET_DIMS[variant];
  const ring = outerOutline(N).map(([xn, zn]) => [A * scale * xn, 0.004 + (D - 0.008) * zn]);
  const pts = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (a[1] >= zCut) pts.push(new THREE.Vector2(a[0], a[1]));
    if ((a[1] >= zCut) !== (b[1] >= zCut)) {
      const t = (zCut - a[1]) / (b[1] - a[1]);
      pts.push(new THREE.Vector2(a[0] + t * (b[0] - a[0]), zCut));
    }
  }
  const shape = new THREE.Shape(pts);
  if (hole) {
    const h = openingOutline(N).map(([xn, vn]) => new THREE.Vector2(OPEN.halfWidth * hole * xn, OPEN.centre + OPEN.halfDepth * hole * vn));
    shape.holes.push(new THREE.Path(h));
  }
  return shape;
}

export function createToilet(ctx, opts = {}) {
  const variant = opts.variant === 'floor' ? 'floor' : 'wallHung';
  const finishMat = opts.finish || 'chrome';
  const boxMat = opts.boxMaterial || 'tileSand';
  const L = ctx.layout;
  const T = L.toilet;
  const dims = TOILET_DIMS[variant];
  const { rimY, outletY } = dims;
  const BOX = T.boxing.depth;
  const bx0 = T.boxing.z0 - T.z;
  const bx1 = T.boxing.z1 - T.z;
  const bh = T.boxing.height;
  const N = seg(ctx, 56);

  const group = new THREE.Group();
  group.name = `toilet:${variant}`;
  // a floor-standing toilet stands with its foot (the bowl's foot and the body back to the wall) on the falling floor:
  // level, touching the floor's lowest point under it; a wall-hung one hangs on its frame at the usual height
  const footY = variant === 'floor'
    ? lowestUnder(L, { x0: L.room.W - BOX - 0.4, x1: L.room.W - 0.015, z0: T.z - 0.15, z1: T.z + 0.15 })
    : 0;
  placeOnWall(group, L, T.wall, T.z, footY);
  const parts = {};
  const anchors = {};

  // --- the boxed-in wall (frame cladding) and its stone top: only the wall-hung toilet has them ---
  if (variant === 'wallHung') {
    // tiled down to the floor, which falls toward the drain under it: the foot reaches its lowest point
    const foot = lowestUnder(L, { x0: L.room.W - BOX, x1: L.room.W, z0: T.boxing.z0, z1: T.boxing.z1 }) - 0.0005;
    const boxGeoTiles = boxGeo(bx1 - bx0, bh - 0.02 - foot, BOX);
    boxGeoTiles.translate((bx0 + bx1) / 2, foot + (bh - 0.02 - foot) / 2, BOX / 2);
    wallTileUV(boxGeoTiles, L, T.z);
    parts.boxing = mesh(ctx, boxGeoTiles, boxMat, 'toilet.boxing');
    const top = boxGeo(bx1 - bx0 + 0.01, 0.02, BOX + 0.01, 0.002, 1);
    top.translate((bx0 + bx1) / 2, bh - 0.01, (BOX + 0.01) / 2);
    parts.boxingTop = mesh(ctx, top, 'stoneTop', 'toilet.boxingTop');
    group.add(parts.boxing, parts.boxingTop);
  } else {
    // A close-coupled floor toilet: the ceramic body runs back to the wall and carries the cistern (no frame, no
    // boxing: the price note's "Ingen ramme i veggen og ingen innkassing"). Buttons on the lid, pressed down.
    const backBody = new RoundedBox(0.3, rimY - 0.01, BOX - 0.015, 3, 0.03);
    backBody.translate(0, (rimY - 0.01) / 2, 0.015 + (BOX - 0.015) / 2);
    const tankH = 0.36;
    const tank = new RoundedBox(0.36, tankH, BOX - 0.03, 3, 0.018);
    tank.translate(0, rimY + tankH / 2, 0.012 + (BOX - 0.03) / 2);
    parts.tankBase = mesh(ctx, backBody, 'ceramicWhite', 'toilet.tankBase');
    parts.tank = mesh(ctx, tank, 'ceramicWhite', 'toilet.tank');
    group.add(parts.tankBase, parts.tank);
    const lidY = rimY + tankH;
    const zc = 0.012 + (BOX - 0.03) / 2;
    for (const [name, x, r] of [['flushLarge', -0.03, 0.024], ['flushSmall', 0.032, 0.016]]) {
      const p = pivot(`${name}Pivot`, x, lidY, zc, { type: 'slide', axis: [0, -1, 0], min: 0, max: TOILET_DIMS.buttonTravel });
      const g = new THREE.CylinderGeometry(r, r, 0.008, 32);
      g.translate(0, 0.002, 0);
      const m = mesh(ctx, g, finishMat, `toilet.${name}`);
      p.add(m);
      group.add(p);
      parts[`${name}Pivot`] = p;
      parts[name] = m;
    }
  }

  const bowl = bowlGeometry(variant, N);
  bowl.translate(0, 0, BOX);
  parts.bowl = mesh(ctx, bowl, 'ceramicWhite', 'toilet.bowl');
  group.add(parts.bowl);

  // Hinge blocks on the back deck (chrome, static), around the hinge axis.
  const hb = createBuilder(ctx);
  const hingeZ = BOX + TOILET_DIMS.hingeBack;
  const hingeY = rimY + TOILET_DIMS.hingeUp;
  const hingeBlock = new RoundedBox(0.028, 0.03, 0.04, 2, 0.008);
  for (const sx of [-0.072, 0.072]) hb.add(finishMat, hingeBlock, M([sx, rimY + 0.015, BOX + 0.04]));
  parts.hinges = hb.build(group, 'toilet.hinges')[finishMat];

  // --- seat and lid on the soft-close hinge axis (along the wall, at the back of the bowl) ---
  parts.seatPivot = pivot('seatPivot', 0, hingeY, hingeZ, { type: 'hinge', axis: [1, 0, 0], min: -1.56, max: 0 });
  const seatG = flatExtrude(seatShape(variant, N, 0.075, 0.97, 0.96), 0.02, 0.005, 2, 3);
  seatG.translate(0, -0.02, BOX - hingeZ);
  parts.seat = mesh(ctx, seatG, 'enamelWhite', 'toilet.seat');
  parts.seatPivot.add(parts.seat);
  parts.lidPivot = pivot('lidPivot', 0, hingeY, hingeZ, { type: 'hinge', axis: [1, 0, 0], min: -1.62, max: 0 });
  const lidG = flatExtrude(seatShape(variant, N, 0.07, 0.975, 0), 0.02, 0.007, 2, 3);
  lidG.translate(0, 0, BOX - hingeZ);
  parts.lid = mesh(ctx, lidG, 'enamelWhite', 'toilet.lid');
  parts.lidPivot.add(parts.lid);
  group.add(parts.seatPivot, parts.lidPivot);

  // --- flush plate (Sigma-like, 24.6 x 16.4 cm) with a large and a small button that travel into the wall ---
  if (variant === 'wallHung') {
  const py = TOILET_DIMS.plateY;
  parts.flushPlatePivot = pivot('flushPlatePivot', 0, py, BOX, { type: 'slide', axis: [0, 0, 1], min: 0, max: 0.06 });
  const frameShape = roundedRectShape(0.246, 0.164, 0.006);
  frameShape.holes.push(new THREE.Path(roundedRectShape(0.226, 0.144, 0.004).getPoints(6)));
  parts.flushPlate = mesh(ctx, standExtrude(frameShape, 0.006, 0.0012, 6, 2), finishMat, 'toilet.flushPlate');
  parts.flushPlatePivot.add(parts.flushPlate);
  const btnFace = 0.0085;
  const buttons = [
    ['flushLarge', -0.0475, 0.13],
    ['flushSmall', 0.0665, 0.09],
  ];
  for (const [name, x, w] of buttons) {
    const p = pivot(`${name}Pivot`, x, 0, btnFace, { type: 'slide', axis: [0, 0, -1], min: 0, max: TOILET_DIMS.buttonTravel });
    const g = standExtrude(roundedRectShape(w, 0.14, 0.004), 0.008, 0.0015, 6, 2);
    g.translate(0, 0, -0.008);
    const m = mesh(ctx, g, finishMat, `toilet.${name}`);
    p.add(m);
    parts.flushPlatePivot.add(p);
    parts[`${name}Pivot`] = p;
    parts[name] = m;
  }
  group.add(parts.flushPlatePivot);
  }

  // --- hidden parts (see-through view): frame, cistern, flush pipe (wall-hung only), trapway, outlet pipe, stack ---
  const wallHung = variant === 'wallHung';
  if (wallHung) {
  const fb = createBuilder(ctx);
  const post = new THREE.BoxGeometry(0.04, 1.12, 0.04);
  for (const sx of [-0.22, 0.22]) {
    fb.add('brushedSteel', post, M([sx, 0.56, 0.07]));
    fb.add('brushedSteel', new THREE.BoxGeometry(0.07, 0.006, 0.16), M([sx, 0.003, 0.08]));
  }
  fb.add('brushedSteel', new THREE.BoxGeometry(0.48, 0.04, 0.04), M([0, 1.12, 0.07]));
  fb.add('brushedSteel', new THREE.BoxGeometry(0.48, 0.03, 0.03), M([0, 0.62, 0.07]));
  if (variant === 'wallHung') {
    fb.add('brushedSteel', new THREE.BoxGeometry(0.48, 0.04, 0.03), M([0, outletY, 0.075]));
    for (const sx of [-0.09, 0.09]) fb.add('brushedSteel', cylinderBetween([sx, outletY, 0.09], [sx, outletY, BOX + 0.03], 0.006, 8), null);
  }
  const frameMeshes = fb.build(group, 'toilet.frame');
  parts.frame = frameMeshes.brushedSteel;

  const cis = new RoundedBox(0.38, 0.44, 0.095, 2, 0.012);
  cis.translate(0, 0.86, 0.1375);
  parts.cistern = mesh(ctx, cis, 'plasticWhite', 'toilet.cistern');
  parts.flushPipe = mesh(ctx, tubeAlong([[0, 0.64, 0.14], [0, 0.33, 0.14], [0, 0.33, BOX + 0.045]], 0.0225, { bend: 0.05, tubular: 40, radial: 12, caps: true }), 'plasticWhite', 'toilet.flushPipe');
  }
  const sumpZ = BOX + 0.37;
  const drop = rimY - 0.2;
  const trapPts = variant === 'wallHung'
    ? [[0, drop + 0.005, sumpZ], [0, drop - 0.005, sumpZ - 0.03], [0, drop - 0.01, sumpZ - 0.1], [0, drop + 0.025, sumpZ - 0.17], [0, rimY - TOILET_DIMS.waterDrop + 0.025, sumpZ - 0.23], [0, outletY + 0.04, sumpZ - 0.29], [0, outletY + 0.005, BOX + 0.03], [0, outletY, BOX]]
    : [[0, drop + 0.005, sumpZ], [0, drop - 0.06, sumpZ - 0.04], [0, drop - 0.07, sumpZ - 0.12], [0, drop - 0.005, sumpZ - 0.19], [0, rimY - TOILET_DIMS.waterDrop + 0.025, sumpZ - 0.24], [0, outletY + 0.06, sumpZ - 0.3], [0, outletY + 0.005, BOX + 0.03], [0, outletY, BOX]];
  parts.bowlTrap = mesh(ctx, tubeSmooth(trapPts, 0.024, 64, 12, true), 'ceramicWhite', 'toilet.bowlTrap');
  const stackX = 0.36;
  const fall = stackX / 40; // 1:40 fall toward the stack
  // wall-hung: the pipes run inside the boxing; floor-standing: straight back into the wall to the stack in it
  const pipeZ = wallHung ? 0.14 : -0.05;
  const stackZ = wallHung ? 0.1 : -0.07;
  parts.outletPipe = mesh(ctx, tubeAlong([[0, outletY, BOX + 0.03], [0, outletY, pipeZ], [stackX, outletY - fall, pipeZ]], 0.045, { bend: 0.07, tubular: 40, radial: 16, caps: true }), 'plasticGrey', 'toilet.outletPipe');
  // the soil stack comes up through the floor (the membrane view shows its collar there)
  const stackFoot = lowestUnder(L, { x0: L.room.W - stackZ - 0.055, x1: L.room.W - stackZ + 0.055, z0: T.z + stackX - 0.055, z1: T.z + stackX + 0.055 }) - footY - 0.002;
  parts.stack = mesh(ctx, cylinderBetween([stackX, stackFoot, stackZ], [stackX, bh - 0.03, stackZ], 0.055, 24), 'plasticGrey', 'toilet.stack');
  const hidden = wallHung ? ['frame', 'cistern', 'flushPipe', 'bowlTrap', 'outletPipe', 'stack'] : ['bowlTrap', 'outletPipe', 'stack'];
  for (const h of hidden) {
    parts[h].visible = false;
    parts[h].userData.hidden = true;
    if (!parts[h].parent) group.add(parts[h]);
  }

  // --- anchors ---
  anchors.flushInlet = anchor('flushInlet', group, 0, rimY - 0.02, BOX + 0.2);
  anchors.bowlWater = anchor('bowlWater', group, 0, rimY - TOILET_DIMS.waterDrop, BOX + 0.353, {
    halfWidth: OPEN.halfWidth * 0.545,
    halfDepth: OPEN.halfDepth * 0.545,
  });
  anchors.outlet = anchor('outlet', group, 0, outletY, BOX);
  anchors.stackJoin = anchor('stackJoin', group, stackX, outletY - fall, stackZ);
  anchors.seatTop = anchor('seatTop', group, 0, hingeY, BOX + 0.3);

  function setHiddenVisible(v) {
    for (const h of hidden) parts[h].visible = v;
  }

  return { group, parts, anchors, variant, hidden, setHiddenVisible };
}
