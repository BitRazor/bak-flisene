// The washer tower in the front-right corner: a steel drip tray with a leak sensor, a front-loading washer, a stacking
// frame and a condenser dryer on top. Each machine has a round door on a hinge at its left side, a drum behind it,
// and a control strip with a drawer, a program knob and a small display plane (canvas texture).
// Placement: LAYOUT.washer footprint (x0..x1, z0..z1, height). The machines stand with their backs to a wall:
// opts.wall 'right' (default: facing the room, toward -x) or 'front' (facing the back wall). Local frame = that wall's
// frame (util.js), origin on the wall surface at the footprint's centre line, at the floor: the floor falls to the
// drain (data/floor.js), so the flat tray sits at the lowest floor point under the footprint and touches it there.
//
// createWasherTower(ctx, { wall: 'right' })
// Static pieces are merged per material (one draw call each): parts.static = { [material]: mesh }; parts.washerBody,
//   dryerBody, tray, stackKit, washerDrum, dryerDrum, leakSensor point at the mesh holding them, and
//   subpartAt(hit.object, hit.faceIndex) (util.js) names the piece a touch landed on.
// Moving parts: washerDoorPivot / dryerDoorPivot (vertical hinge at the door's left edge; opening = negative rotation.y
//   up to 1.75) + washerDoor / dryerDoor (+ ...DoorGlass), washerKnobPivot / dryerKnobPivot (about z, +-2.6 rad) +
//   washerKnob / dryerKnob, and washerDisplay / dryerDisplay (planes with per-object screen materials).
// anchors: washerDrum / dryerDrum (inside each drum opening), trayFloor (front of the tray, where spilt water goes),
//   washerDisplay / dryerDisplay (display centres).
import * as THREE from 'three';
import { mesh, pivot, anchor, placeOnWall, createBuilder, boxGeo, M, lathe, cylinderBetween, standExtrude, roundedRectShape, screenMaterial, RoundedBox, seg } from './util.js';
import { lowestUnder } from '../data/floor.js';

export const WASHER_DIMS = { w: 0.594, h: 0.84, d: 0.55, feet: 0.018, kit: 0.018, doorY: 0.42, doorR: 0.236, opening: 0.165, maxOpen: 1.75, panelH: 0.74 };

// Adds one machine's static pieces to builder b and its moving parts to group.
function machine(ctx, b, group, parts, anchors, prefix, y0, kind) {
  const D = WASHER_DIMS;
  const hw = D.w / 2;
  const fz = 0.005 + D.d; // front face plane
  const body = `${prefix}Body`;
  const enamel = 'enamelGloss'; // stove-enamelled steel under a clear lacquer (materials.js)
  // Cabinet: top board, sides, back, floor; the front panel with the porthole; the control strip above it.
  b.add(enamel, new RoundedBox(D.w, 0.014, D.d, 2, 0.005), M([0, y0 + D.h - 0.007, 0.005 + D.d / 2]), body);
  b.add(enamel, boxGeo(0.012, D.h - 0.014, D.d), M([-hw + 0.006, y0 + (D.h - 0.014) / 2, 0.005 + D.d / 2]), body);
  b.add(enamel, boxGeo(0.012, D.h - 0.014, D.d), M([hw - 0.006, y0 + (D.h - 0.014) / 2, 0.005 + D.d / 2]), body);
  b.add(enamel, boxGeo(D.w - 0.024, D.h - 0.014, 0.01), M([0, y0 + (D.h - 0.014) / 2, 0.01]), body);
  b.add(enamel, boxGeo(D.w - 0.024, 0.01, D.d - 0.02), M([0, y0 + 0.005, 0.005 + D.d / 2]), body);
  const panelH = D.panelH;
  const front = roundedRectShape(D.w, panelH, 0.004);
  const hole = new THREE.Path();
  hole.absarc(0, D.doorY - panelH / 2, D.opening, 0, Math.PI * 2, true);
  front.holes.push(hole);
  b.add(enamel, standExtrude(front, 0.008, 0.0015, seg(ctx, 48), 1), M([0, y0 + panelH / 2, fz - 0.008]), body);
  const stripH = D.h - 0.014 - panelH;
  const sy = y0 + panelH + stripH / 2;
  b.add('plasticWhite', boxGeo(D.w, stripH, 0.012, 0.002, 1), M([0, sy, fz - 0.006]), `${prefix}Strip`);
  // Drawer (detergent for the washer, water tank for the dryer) on the left of the strip, with its grip.
  b.add('plasticWhite', new RoundedBox(0.17, stripH - 0.016, 0.01, 2, 0.003), M([-hw + 0.105, sy, fz + 0.004]), `${prefix}Drawer`);
  b.add('plasticGrey', boxGeo(0.06, 0.008, 0.004), M([-hw + 0.105, sy - 0.022, fz + 0.0092]), `${prefix}Drawer`);
  b.add('screenBlack', boxGeo(0.11, 0.036, 0.003), M([0, sy, fz + 0.0015]), `${prefix}DisplayGlass`);
  // Drum (stainless) with three lifters, and the door seal (rubber boot on the washer, a plastic ring on the dryer).
  const drumDepth = 0.3;
  const drum = lathe([[D.opening, 0], [D.opening, -drumDepth], [0, -drumDepth]], seg(ctx, 48)).rotateX(Math.PI / 2);
  b.add('brushedSteel', drum, M([0, y0 + D.doorY, fz - 0.008]), `${prefix}Drum`);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    b.add('brushedSteel', boxGeo(0.03, 0.03, drumDepth - 0.04), M([Math.cos(a) * (D.opening - 0.014), y0 + D.doorY + Math.sin(a) * (D.opening - 0.014), fz - 0.008 - drumDepth / 2 - 0.01], [0, 0, a]), `${prefix}Drum`);
  }
  const seal = kind === 'washer' ? 'rubber' : 'plasticGrey';
  b.add(seal, new THREE.TorusGeometry(D.opening + 0.004, 0.014, 10, seg(ctx, 48)), M([0, y0 + D.doorY, fz - 0.012]), `${prefix}Seal`);
  anchors[`${prefix}Drum`] = anchor(`${prefix}Drum`, group, 0, y0 + D.doorY, fz - 0.05);

  // Display plane (canvas texture) on the glass.
  const dsp = mesh(ctx, new THREE.PlaneGeometry(0.104, 0.03), screenMaterial(`${prefix}Display`), `${prefix}.display`);
  dsp.position.set(0, sy, fz + 0.0032);
  dsp.castShadow = false;
  group.add(dsp);
  parts[`${prefix}Display`] = dsp;
  anchors[`${prefix}Display`] = anchor(`${prefix}Display`, group, 0, sy, fz + 0.0032);

  // Program knob (turns about the machine's front normal), with a pointer mark.
  const kp = pivot(`${prefix}KnobPivot`, hw - 0.1, sy, fz, { type: 'hinge', axis: [0, 0, 1], min: -2.6, max: 2.6 });
  const kb = createBuilder(ctx);
  kb.add('chrome', lathe([[0.031, 0], [0.031, 0.006], [0.0285, 0.007], [0.0285, 0.018], [0.026, 0.021], [0, 0.0215]], seg(ctx, 32)).rotateX(Math.PI / 2));
  kb.add('chrome', boxGeo(0.003, 0.016, 0.002), M([0, 0.016, 0.0215])); // the pointer: a raised ridge
  parts[`${prefix}Knob`] = kb.build(kp, `${prefix}.knob`).chrome;
  parts[`${prefix}KnobPivot`] = kp;
  group.add(kp);

  // Door: a chrome ring, domed smoked glass (the drum shows dimly behind it), a chrome grip on its free side; hinge on
  // the left edge.
  const R = D.doorR;
  const dp = pivot(`${prefix}DoorPivot`, -R, y0 + D.doorY, fz + 0.014, { type: 'hinge', axis: [0, 1, 0], min: -D.maxOpen, max: 0 });
  const db = createBuilder(ctx);
  const ring = lathe([[0.15, -0.012], [0.2, -0.013], [R - 0.004, -0.009], [R, 0.0], [R - 0.002, 0.012], [R - 0.012, 0.022], [0.185, 0.026], [0.158, 0.024], [0.15, 0.016], [0.15, -0.012]], seg(ctx, 56)).rotateX(Math.PI / 2);
  db.add('chrome', ring, M([R, 0, 0]));
  // Glass profile from the rim inward so the concave side (the side you look at) faces out of the machine.
  const dome = lathe([[0.153, 0.018], [0.152, 0.0], [0.14, -0.022], [0.11, -0.045], [0.06, -0.064], [0, -0.07]], seg(ctx, 40)).rotateX(Math.PI / 2);
  db.add('glassSmoked', dome, M([R, 0, 0]));
  db.add('chrome', new RoundedBox(0.03, 0.09, 0.03, 2, 0.008), M([2 * R - 0.012, 0, 0.012]));
  const dbuilt = db.build(dp, `${prefix}.door`);
  parts[`${prefix}Door`] = dbuilt.chrome;
  parts[`${prefix}DoorGlass`] = dbuilt.glassSmoked;
  parts[`${prefix}DoorPivot`] = dp;
  group.add(dp);
}

export function createWasherTower(ctx, opts = {}) {
  const L = ctx.layout;
  const Wt = L.washer;
  const D = WASHER_DIMS;
  const wall = opts.wall || 'right';
  const side = wall === 'right' || wall === 'left';
  const group = new THREE.Group();
  group.name = 'washerTower';
  placeOnWall(group, L, wall, side ? (Wt.z0 + Wt.z1) / 2 : (Wt.x0 + Wt.x1) / 2, lowestUnder(L, Wt));
  const parts = {};
  const anchors = {};
  const fw = side ? Wt.z1 - Wt.z0 : Wt.x1 - Wt.x0;
  const fd = side ? Wt.x1 - Wt.x0 : Wt.z1 - Wt.z0;

  const b = createBuilder(ctx);
  // Drip tray (stainless), the washer's feet, and a leak sensor in the tray under the washer's front edge.
  const th = 0.035;
  b.add('brushedSteel', boxGeo(fw, 0.002, fd), M([0, 0.001, fd / 2]), 'tray');
  b.add('brushedSteel', boxGeo(fw, th, 0.002), M([0, th / 2, 0.001]), 'tray');
  b.add('brushedSteel', boxGeo(fw, th, 0.002), M([0, th / 2, fd - 0.001]), 'tray');
  b.add('brushedSteel', boxGeo(0.002, th, fd - 0.004), M([-fw / 2 + 0.001, th / 2, fd / 2]), 'tray');
  b.add('brushedSteel', boxGeo(0.002, th, fd - 0.004), M([fw / 2 - 0.001, th / 2, fd / 2]), 'tray');
  for (const x of [-0.25, 0.25]) for (const z of [0.06, 0.52]) b.add('plasticGrey', cylinderBetween([x, 0.002, z], [x, D.feet, z], 0.016, 16), null, 'feet');
  b.add('plasticWhite', lathe([[0.02, 0], [0.02, 0.009], [0.017, 0.012], [0, 0.0125]], 24), M([0.17, 0.002, 0.53]), 'leakSensor');
  anchors.trayFloor = anchor('trayFloor', group, 0, 0.002, fd - 0.02);

  const yWasher = D.feet;
  machine(ctx, b, group, parts, anchors, 'washer', yWasher, 'washer');
  b.add('plasticWhite', boxGeo(D.w, D.kit, D.d, 0.003, 1), M([0, yWasher + D.h + D.kit / 2, 0.005 + D.d / 2]), 'stackKit');
  machine(ctx, b, group, parts, anchors, 'dryer', yWasher + D.h + D.kit, 'dryer');

  parts.static = b.build(group, 'washerTower.static');
  parts.washerBody = parts.dryerBody = parts.static.enamelGloss;
  parts.washerBody.userData.knock = 'metal';
  parts.tray = parts.washerDrum = parts.dryerDrum = parts.static.brushedSteel;
  parts.stackKit = parts.leakSensor = parts.static.plasticWhite;

  return { group, parts, anchors };
}
