// The bathroom door in the front wall: frame (karm) with stops, casings (gerikt) on both faces, an oak threshold, a
// smooth white leaf hinged at its left edge opening into the room (1 cm air gap above the threshold), lever handles on
// both faces on one spindle, a WC thumb-turn inside and, outside, the escutcheon with a quarter window that shows the
// indicator: white = free ("Ledig"), red = occupied ("Opptatt"); the coin slot turns with it.
// Placement: LAYOUT.door (front wall, x0..x1 = clear opening, height = opening height). The group is not rotated:
// local axes = room axes, origin at (x0, 0, D) on the room-side wall surface; +z runs into the wall / hallway.
//
// createDoor(ctx, { wallThickness: 0.12, finish: 'brushedSteel' })
// parts: frame (frame + room-side casings), frameHall (the hallway-side casings), threshold, hinges, leafPivot (vertical hinge axis at the leaf's left edge, room side;
//   opening = positive rotation.y up to 1.75 rad) + leaf, leafHardware (rosettes, escutcheon), handlePivot (spindle
//   along z; pressing = positive rotation.z up to 0.6) + handles, thumbTurnPivot (same kind of spindle; locked =
//   +PI/2) + thumbTurn (= coinSlot, the release boss outside; one mesh), indicatorFree (white quarter) /
//   indicatorBusy (red quarter) (all turn with the thumb-turn; the window shows the busy quarter when locked).
// methods: setLocked(bool) (turns the thumb-turn pivot), isLocked().
// anchors: handleInside, handleOutside, thumbTurn, indicator (centre of the outside window), doorGap (middle of the gap
//   under the leaf, room side).
import * as THREE from 'three';
import { mesh, pivot, anchor, createBuilder, boxGeo, M, cylinderBetween, tubeAlong, standExtrude, RoundedBox, seg } from './util.js';
import { floorHeight } from '../data/floor.js';

export const DOOR_DIMS = { jamb: 0.03, casing: 0.05, casingT: 0.01, threshold: 0.018, gapUnder: 0.01, backset: 0.05, handleY: 1.05, turnBelow: 0.072, maxOpen: 1.75 };

// The oak threshold (eiketerskel, as Straume always fits under a wet-room door): a flat top with a gentle ramp to each
// side, the grain along its length. len along x from 0, height h, base depth d centred on z = 0, flat top `top` wide.
function thresholdGeo(len, h, d, top) {
  const shape = new THREE.Shape([
    new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(top / 2, h), new THREE.Vector2(-top / 2, h),
  ]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 1 });
  g.rotateY(Math.PI / 2); // extrusion runs along x, the profile lies across z
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) { // metres; the oak photo's grain runs along v
    if (Math.abs(nrm.getX(i)) > 0.5) uv.setXY(i, pos.getZ(i), pos.getY(i)); // the ends
    else uv.setXY(i, pos.getZ(i), pos.getX(i)); // top and ramps: grain along the threshold
  }
  return g;
}

export function createDoor(ctx, opts = {}) {
  const L = ctx.layout;
  const Dr = L.door;
  if (Dr.hinge !== 'left') throw new Error('createDoor: only a left-hinged door is modelled');
  const D = DOOR_DIMS;
  const hw = opts.finish || 'brushedSteel';
  const wallT = opts.wallThickness ?? 0.12;
  const W = Dr.x1 - Dr.x0;
  const H = Dr.height;
  const T = Dr.thickness;
  const group = new THREE.Group();
  group.name = 'door';
  group.position.set(Dr.x0, 0, L.room.D);
  const parts = {};
  const anchors = {};

  // --- frame, stops, casings on both faces, threshold ---
  const fb = createBuilder(ctx);
  const j = D.jamb;
  fb.add('enamelWhite', boxGeo(j, H + j, wallT), M([-j / 2, (H + j) / 2, wallT / 2]));
  fb.add('enamelWhite', boxGeo(j, H + j, wallT), M([W + j / 2, (H + j) / 2, wallT / 2]));
  fb.add('enamelWhite', boxGeo(W + 2 * j, j, wallT), M([W / 2, H + j / 2, wallT / 2]));
  fb.add('enamelWhite', boxGeo(0.012, H - D.threshold, 0.012), M([0.006, D.threshold + (H - D.threshold) / 2, T + 0.006]));
  fb.add('enamelWhite', boxGeo(0.012, H - D.threshold, 0.012), M([W - 0.006, D.threshold + (H - D.threshold) / 2, T + 0.006]));
  fb.add('enamelWhite', boxGeo(W, 0.012, 0.012), M([W / 2, H - 0.006, T + 0.006]));
  const c = D.casing;
  const ct = D.casingT;
  // the casings on the hallway's face are a mesh of their own (frameHall): they take the hallway's light, not the
  // room's, as the door opens (one mesh with the leaf's material lit them as if they stood in the bathroom: review4)
  const cb = createBuilder(ctx);
  for (const [b, z] of [[fb, -ct / 2], [cb, wallT + ct / 2]]) {
    b.add('enamelWhite', new RoundedBox(c, H + c, ct, 1, 0.003), M([-c / 2, (H + c) / 2, z]));
    b.add('enamelWhite', new RoundedBox(c, H + c, ct, 1, 0.003), M([W + c / 2, (H + c) / 2, z]));
    b.add('enamelWhite', new RoundedBox(W + 2 * c, c, ct, 1, 0.003), M([W / 2, H + c / 2, z]));
  }
  parts.frameHall = cb.build(group, 'door.frameHall').enamelWhite;
  parts.frameHall.userData.knock = 'wood';
  fb.add('oak', thresholdGeo(W, D.threshold, wallT + 2 * ct, 0.07), M([0, 0, wallT / 2]));
  for (const y of [0.25, 1.05, 1.85]) fb.add(hw, cylinderBetween([0, y - 0.05, -0.006], [0, y + 0.05, -0.006], 0.0065, 12), null);
  const fbuilt = fb.build(group, 'door.frame');
  parts.frame = fbuilt.enamelWhite;
  parts.frame.userData.knock = 'wood';
  parts.threshold = fbuilt.oak;
  parts.hinges = fbuilt[hw];
  // The room's floor falls to the drain and meets the door line within a few millimetres of the hallway floor (y = 0):
  // the threshold's and the frame's feet follow it on the room side (the hallway side stays at 0).
  for (const m of [parts.frame, parts.threshold]) {
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0.004) continue;
      const lz = p.getZ(i);
      const lift = lz <= 1e-9 ? floorHeight(L, Dr.x0 + p.getX(i), L.room.D + lz) : 0;
      p.setY(i, p.getY(i) + lift);
    }
    p.needsUpdate = true;
    m.geometry.computeBoundingBox();
    m.geometry.computeBoundingSphere();
  }

  // --- the leaf on its hinge axis ---
  const ax = [0, 0, -0.006];
  parts.leafPivot = pivot('leafPivot', ax[0], ax[1], ax[2], { type: 'hinge', axis: [0, 1, 0], min: 0, max: D.maxOpen });
  const yb = D.threshold + D.gapUnder;
  const leafW = W - 0.006;
  const leafH = H - 0.003 - yb;
  const leafG = new RoundedBox(leafW, leafH, T, 2, 0.003);
  leafG.translate(0.003 + leafW / 2, yb + leafH / 2, T / 2 - ax[2]);
  parts.leaf = mesh(ctx, leafG, 'enamelWhite', 'door.leaf');
  parts.leaf.userData.knock = 'wood';
  parts.leafPivot.add(parts.leaf);
  group.add(parts.leafPivot);

  // Hardware positions in the leaf pivot's frame: zc = middle of the leaf, faces at zc -+ T/2.
  const zc = T / 2 - ax[2];
  const sx = 0.003 + leafW - D.backset;
  const hy = D.handleY;
  const ty = hy - D.turnBelow;
  const room = zc - T / 2;
  const hall = zc + T / 2;

  const lh = createBuilder(ctx);
  for (const [y, r] of [[hy, 0.026], [ty, 0.022]]) {
    lh.add(hw, cylinderBetween([sx, y, room], [sx, y, room - 0.008], r, seg(ctx, 32)));
    if (y === hy) lh.add(hw, cylinderBetween([sx, y, hall], [sx, y, hall + 0.008], r, seg(ctx, 32)));
  }
  // Outside escutcheon with a quarter window (top) through which the indicator shows.
  const esc = new THREE.Shape();
  esc.absarc(0, 0, 0.024, 0, Math.PI * 2, false);
  const win = new THREE.Path();
  win.absarc(0, 0, 0.0165, Math.PI * 0.28, Math.PI * 0.72, false);
  win.absarc(0, 0, 0.006, Math.PI * 0.72, Math.PI * 0.28, true);
  esc.holes.push(win);
  lh.add(hw, standExtrude(esc, 0.006, 0.001, 24, 1), M([sx, ty, hall]));
  parts.leafHardware = lh.build(parts.leafPivot, 'door.leafHardware')[hw];

  // Lever handles on one spindle: both point toward the hinge side.
  parts.handlePivot = pivot('handlePivot', sx, hy, zc, { type: 'hinge', axis: [0, 0, 1], min: 0, max: 0.6 });
  const hb = createBuilder(ctx);
  const half = T / 2;
  for (const s of [-1, 1]) {
    hb.add(hw, tubeAlong([[0, 0, s * (half + 0.004)], [0, 0, s * (half + 0.058)], [-0.13, 0, s * (half + 0.058)]], 0.0095, { bend: 0.028, tubular: 24, radial: 16, caps: true }));
  }
  parts.handles = hb.build(parts.handlePivot, 'door.handles')[hw];
  parts.leafPivot.add(parts.handlePivot);
  anchors.handleInside = anchor('handleInside', parts.handlePivot, -0.1, 0, -(half + 0.058));
  anchors.handleOutside = anchor('handleOutside', parts.handlePivot, -0.1, 0, half + 0.058);

  // Thumb-turn inside, indicator + coin slot outside, all on one spindle.
  parts.thumbTurnPivot = pivot('thumbTurnPivot', sx, ty, zc, { type: 'hinge', axis: [0, 0, 1], min: 0, max: Math.PI / 2 });
  const tb = createBuilder(ctx);
  tb.add(hw, cylinderBetween([0, 0, -(half + 0.008)], [0, 0, -(half + 0.014)], 0.007, 16));
  tb.add(hw, new RoundedBox(0.011, 0.036, 0.014, 2, 0.004), M([0, 0, -(half + 0.02)]));
  tb.add('enamelWhite', new THREE.CircleGeometry(0.0168, 16, Math.PI / 4, Math.PI / 2), M([0, 0, half + 0.0006]));
  tb.add('signalRed', new THREE.CircleGeometry(0.0168, 16, -Math.PI / 4, Math.PI / 2), M([0, 0, half + 0.0006]));
  // Emergency release outside: a round boss with a raised bar that a coin (or a thumb) turns.
  tb.add(hw, cylinderBetween([0, 0, half], [0, 0, half + 0.0072], 0.0058, 16), null, 'coinSlot');
  tb.add(hw, new RoundedBox(0.0022, 0.0105, 0.0024, 1, 0.0008), M([0, 0, half + 0.0078]), 'coinSlot');
  const tbuilt = tb.build(parts.thumbTurnPivot, 'door.thumbTurn');
  parts.thumbTurn = tbuilt[hw];
  parts.coinSlot = tbuilt[hw];
  parts.indicatorFree = tbuilt.enamelWhite;
  parts.indicatorBusy = tbuilt.signalRed;
  parts.leafPivot.add(parts.thumbTurnPivot);
  anchors.thumbTurn = anchor('thumbTurn', parts.thumbTurnPivot, 0, 0, -(half + 0.02));
  anchors.indicator = anchor('indicator', parts.leafPivot, sx, ty + 0.011, hall + 0.006);
  anchors.doorGap = anchor('doorGap', group, W / 2, D.threshold + D.gapUnder / 2, 0);

  let locked = false;
  function setLocked(v) {
    locked = !!v;
    parts.thumbTurnPivot.rotation.z = locked ? Math.PI / 2 : 0;
    parts.thumbTurnPivot.userData.joint.value = parts.thumbTurnPivot.rotation.z;
    return locked;
  }

  return { group, parts, anchors, setLocked, isLocked: () => locked };
}
