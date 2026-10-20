// The walk-in shower: one 8 mm glass panel (INR ARC 20-like) in a wall profile with a stabiliser bar to the left wall,
// a standard exposed shower system on the left wall (a bar thermostat with temperature dial + flow lever, the riser
// straight above it carrying the hand shower's sliding holder, and the overhead arm off the riser's top with a 25 cm
// rain head over the drain), a hand shower with its hose, the niche's lining, shelf and bottles, and the floor drain
// (square chess grate in its frame, Purus SQUARE-like 197 x 197 mm, flush with the tiles, over a round drain body with
// its water seal). Sizes: research/products.md sections C, D and G.
// Placement: LAYOUT.shower (room coordinates; this group is not rotated: local = room axes). The floor falls to the
// drain (data/floor.js): the drain's top sits at the floor's height there, the glass foot is set above the floor.
//
// createShower(ctx, { finish: 'chrome', profileFinish, drainFinish: 'brushedSteel', wallMaterial: 'tileSand',
//   drainY: floor height at the drain, handShowerY: 1.6 })
// Static pieces are merged per material: parts.static = { [material]: mesh }; parts.profile, stay, rainHead,
//   mixerBody, slideBar (the riser), nicheLining, nicheShelf, bottles and drainDark (the drain's dark body) point at the
//   mesh holding them, and subpartAt(hit.object, hit.faceIndex) (util.js) names the piece a touch landed on.
// Separate meshes: glass, drainFrame (the steel frame in the tiles), waterSeal (the water in the trap, 5 cm down).
//   Moving parts: tempDialPivot (hinge about the bar axis z, +-2.4 rad) + tempDial, flowLeverPivot
//   (hinge about z, +-1.57 rad: one way the hand shower, the other the rain head) + flowLever, handShowerSlidePivot
//   (slides along y on the riser) + holder, handShowerPivot (the hand shower; lift it off the holder by moving this
//   pivot) + handShower, hose (call rebuildHose() after moving the hand shower), drainGratePivot (lifts along +y,
//   0..0.06 m) + drainGrate.
// anchors: rainHead and handShower (water outlets; userData.direction in the parent's frame, userData.radius),
//   mixerHose, drain (the grate's top centre), nicheFloor, nicheShelf.
import * as THREE from 'three';
import {
  mesh, pivot, anchor, createBuilder, boxGeo, M, lathe, cylinderBetween, tubeAlong, tubeSmooth, RoundedBox, seg, glassName,
} from './util.js';
import { floorHeight, lowestUnder } from '../data/floor.js';

export const SHOWER_DIMS = {
  glassGap: 0.006, // gap under the glass at the floor's highest point along it (the floor falls away under it)
  profile: { w: 0.02, d: 0.025 },
  // the stay bar to the left wall; its wall end under a rounded rosette ([r, out from the wall], m): a flat cover
  // mirrored one spot of the room's picture, from the vanity side the window, by night a black disc (the look, 2026-10-19)
  stay: { r: 0.009, fromFreeEdge: 0.15, rosette: [[0.022, 0], [0.0218, 0.003], [0.0205, 0.0062], [0.018, 0.0088], [0.0145, 0.0108], [0.0098, 0.012]] },
  rainHead: { r: 0.125, armR: 0.0125 },
  mixer: { out: 0.075, r: 0.0275, length: 0.26, end: 0.045, legs: 0.16 },
  slideBar: { out: 0.075, r: 0.0125 }, // the riser: on the thermostat's axis, the holder slides on it
  // grate 188 mm in a 200 mm frame (2 cm deep); under it a dark body: a plate with the round throat (r 6 cm), the
  // water seal 5 cm under the grate, the body 8 cm deep
  drain: { grate: 0.188, height: 0.0028, lift: 0.06, frame: 0.005, frameDepth: 0.02, plate: 0.007, throat: 0.06, seal: 0.05, depth: 0.08 },
};

// A bottle: a body h tall, and a cap (CAP_H over the body) or a pump (PUMP_H over it).
const CAP_H = 0.025;
const PUMP_H = 0.032;
function bottle(b, bodyMat, capMat, x, y, z, r, h, pumpMat) {
  b.add(bodyMat, lathe([[0, 0], [r - 0.003, 0], [r, 0.004], [r, h - 0.025], [r * 0.82, h - 0.008], [0.013, h - 0.002], [0.013, h]], 28), M([x, y, z]), 'bottles');
  if (pumpMat) {
    b.add(pumpMat, lathe([[0.0135, h - 0.004], [0.0145, h - 0.004], [0.0145, h + 0.008], [0.004, h + 0.009]], 20), M([x, y, z]), 'bottles');
    b.add(pumpMat, cylinderBetween([0, h + 0.008, 0], [0, h + 0.022, 0], 0.0035, 10), M([x, y, z]), 'bottles');
    b.add(pumpMat, new RoundedBox(0.018, 0.012, 0.03, 1, 0.004), M([x, y + h + PUMP_H - 0.006, z + 0.006]), 'bottles');
  } else {
    b.add(capMat, lathe([[0.0135, h - 0.006], [0.015, h - 0.006], [0.015, h + CAP_H - 0.003], [0.012, h + CAP_H], [0, h + CAP_H]], 20), M([x, y, z]), 'bottles');
  }
}

export function createShower(ctx, opts = {}) {
  const L = ctx.layout;
  const S = L.shower;
  const D = SHOWER_DIMS;
  const finishMat = opts.finish || 'chrome';
  const profileMat = opts.profileFinish || finishMat;
  const drainMat = opts.drainFinish || 'brushedSteel';
  const wallMat = opts.wallMaterial || 'tileSand';
  const drainY = opts.drainY ?? floorHeight(L, S.drain.x, S.drain.z); // the grate's top: flush with the tiles
  const group = new THREE.Group();
  group.name = 'shower';
  const parts = {};
  const anchors = {};
  const sb = createBuilder(ctx); // every static piece

  // --- glass panel in its wall profile, with the stabiliser bar to the left wall ---
  // The floor falls away under the glass toward the drain: the bottom edge is level, glassGap above the floor's highest
  // point along the pane (water runs out under it); the wall profile stands on the floor.
  const G = S.glass;
  const gz0 = G.z0 + D.profile.d * 0.32;
  const gy0 = Math.max(floorHeight(L, G.x, gz0), floorHeight(L, G.x, G.z1)) + D.glassGap;
  const glass = boxGeo(G.thickness, G.height - gy0, G.z1 - gz0);
  glass.translate(G.x, gy0 + (G.height - gy0) / 2, (gz0 + G.z1) / 2);
  parts.glass = mesh(ctx, glass, glassName(ctx), 'shower.glass');
  parts.glass.castShadow = false;
  parts.glass.renderOrder = 1;
  group.add(parts.glass);
  const py0 = lowestUnder(L, { x0: G.x - D.profile.w / 2, x1: G.x + D.profile.w / 2, z0: G.z0, z1: G.z0 + D.profile.d });
  sb.add(profileMat, new RoundedBox(D.profile.w, G.height - py0, D.profile.d, 1, 0.002), M([G.x, py0 + (G.height - py0) / 2, G.z0 + D.profile.d / 2]), 'profile');
  const stayZ = G.z1 - D.stay.fromFreeEdge;
  const stayY = G.height + 0.001;
  sb.add(profileMat, cylinderBetween([0.01, stayY, stayZ], [G.x - 0.018, stayY, stayZ], D.stay.r, 16), null, 'stay'); // closed ends
  sb.add(profileMat, new RoundedBox(0.04, 0.03, 0.03, 2, 0.006), M([G.x, G.height - 0.004, stayZ]), 'stay');
  sb.add(profileMat, lathe(D.stay.rosette, seg(ctx, 32)).rotateZ(-Math.PI / 2), M([0, stayY, stayZ]), 'stay'); // the wall rosette

  // --- the exposed shower system on the left wall: the bar thermostat (body on two legs; temperature dial at the -z
  // end, the bather's right), the riser on its top outlet, and the overhead arm off the riser's top to the rain head ---
  const X = D.mixer;
  const mxp = S.mixer;
  const ax = X.out;
  const ay = mxp.y;
  const za = mxp.z - X.length / 2;
  const zb = mxp.z + X.length / 2;
  const R = S.rainHead;
  const hr = D.rainHead.r;
  const ar = D.rainHead.armR;
  const SB = S.slideBar;
  const sbx = D.slideBar.out;
  const armY = R.armY;
  // the riser, from the thermostat's top outlet up to the bend into the arm (the holder slides on it)
  sb.add(finishMat, cylinderBetween([sbx, ay + X.r - 0.004, SB.z], [sbx, armY - 0.04, SB.z], D.slideBar.r, 24, true), null, 'slideBar');
  sb.add(finishMat, lathe([[0.0165, 0], [0.0165, 0.012], [D.slideBar.r, 0.016]], 24), M([sbx, ay + X.r - 0.006, SB.z]), 'slideBar'); // the union nut
  // one wall bracket just above the slide range holds the riser
  const by = Math.min(SB.y1 + 0.06, armY - 0.08);
  sb.add(finishMat, cylinderBetween([0, by, SB.z], [sbx - D.slideBar.r + 0.002, by, SB.z], 0.0095, 16), null, 'slideBar');
  sb.add(finishMat, lathe([[0.026, 0], [0.026, 0.008], [0.022, 0.011], [0.009, 0.012]], 24).rotateZ(-Math.PI / 2), M([0, by, SB.z]), 'slideBar');
  sb.add(finishMat, new RoundedBox(0.03, 0.03, 0.03, 2, 0.008), M([sbx, by, SB.z]), 'slideBar');
  // the bend and the overhead arm, straight out from the wall over the drain, and the short drop to the head
  sb.add(finishMat, tubeAlong([[sbx, armY - 0.045, SB.z], [sbx, armY, SB.z], [R.x, armY, R.z], [R.x, R.y + 0.006, R.z]], ar, { bend: 0.045, tubular: 48, radial: 16 }), null, 'rainHead');
  sb.add(finishMat, lathe([[0, -0.004], [hr - 0.004, -0.004], [hr - 0.0005, -0.0028], [hr, 0], [hr - 0.0005, 0.0028], [hr - 0.004, 0.004], [0.03, 0.006], [0, 0.0065]], seg(ctx, 64)), M([R.x, R.y, R.z]), 'rainHead');
  sb.add(finishMat, new THREE.SphereGeometry(0.016, 16, 10), M([R.x, R.y + 0.012, R.z]), 'rainHead');
  sb.add(drainMat, lathe([[0, -0.0042], [hr - 0.012, -0.0042]], seg(ctx, 64)), M([R.x, R.y, R.z]), 'rainHead');
  anchors.rainHead = anchor('rainHead', group, R.x, R.y - 0.0045, R.z, { direction: [0, -1, 0], radius: hr - 0.012 });
  sb.add(finishMat, cylinderBetween([ax, ay, za], [ax, ay, zb], X.r, seg(ctx, 40)), null, 'mixerBody');
  for (const s of [-1, 1]) {
    const lz = mxp.z + (s * X.legs) / 2;
    sb.add(finishMat, cylinderBetween([0, ay, lz], [ax - X.r + 0.004, ay, lz], 0.011, 16, true), null, 'mixerBody');
    sb.add(finishMat, lathe([[0.03, 0], [0.03, 0.009], [0.026, 0.012], [0.011, 0.013]], seg(ctx, 28)).rotateZ(-Math.PI / 2), M([0, ay, lz]), 'mixerBody');
  }
  sb.add(finishMat, cylinderBetween([ax, ay - X.r + 0.003, mxp.z], [ax, ay - X.r - 0.016, mxp.z], 0.0095, 16), null, 'mixerBody');
  anchors.mixerHose = anchor('mixerHose', group, ax, ay - X.r - 0.017, mxp.z);

  const knob = (r, len) => lathe([[0, -len / 2], [r - 0.003, -len / 2], [r, -len / 2 + 0.003], [r, len / 2 - 0.003], [r - 0.003, len / 2], [0, len / 2]], seg(ctx, 40)).rotateX(Math.PI / 2);
  parts.tempDialPivot = pivot('tempDialPivot', ax, ay, za - X.end / 2, { type: 'hinge', axis: [0, 0, 1], min: -2.4, max: 2.4 });
  const tb = createBuilder(ctx);
  tb.add(finishMat, knob(0.03, X.end));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    tb.add(finishMat, new THREE.BoxGeometry(0.004, 0.0035, X.end - 0.012), M([Math.cos(a) * 0.0305, Math.sin(a) * 0.0305, 0], [0, 0, a]));
  }
  // The safety stop at 38 degrees: a small red button you press to turn hotter.
  tb.add('signalRed', cylinderBetween([0, 0.029, -0.012], [0, 0.0315, -0.012], 0.0045, 12));
  const tbuilt = tb.build(parts.tempDialPivot, 'shower.tempDial');
  parts.tempDial = tbuilt[finishMat];
  parts.tempStop = tbuilt.signalRed;
  group.add(parts.tempDialPivot);

  parts.flowLeverPivot = pivot('flowLeverPivot', ax, ay, zb + X.end / 2, { type: 'hinge', axis: [0, 0, 1], min: -1.57, max: 1.57 });
  const fb = createBuilder(ctx);
  fb.add(finishMat, knob(0.027, X.end));
  fb.add(finishMat, new RoundedBox(0.055, 0.014, 0.018, 2, 0.005), M([0.045, 0, 0.006]));
  parts.flowLever = fb.build(parts.flowLeverPivot, 'shower.flowLever')[finishMat];
  group.add(parts.flowLeverPivot);

  // --- the hand shower's holder (slides up and down the riser between slideBar.y0 and y1) ---
  const restY = THREE.MathUtils.clamp(opts.handShowerY ?? 1.6, SB.y0 + 0.08, SB.y1 - 0.08);
  parts.handShowerSlidePivot = pivot('handShowerSlidePivot', sbx, restY, SB.z, {
    type: 'slide', axis: [0, 1, 0], min: SB.y0 + 0.08 - restY, max: SB.y1 - 0.08 - restY,
  });
  const tilt = -0.25; // the hand shower leans its head out toward the room
  const cradleX = 0.07;
  const hb = createBuilder(ctx);
  hb.add(finishMat, lathe([[0.0175, -0.026], [0.0185, -0.023], [0.0185, 0.023], [0.0175, 0.026], [0.013, 0.026]], 24));
  hb.add(finishMat, lathe([[0.013, -0.026], [0.0175, -0.026]], 24));
  hb.add(finishMat, new RoundedBox(0.05, 0.024, 0.026, 2, 0.006), M([0.035, 0, 0]));
  hb.add(finishMat, new THREE.TorusGeometry(0.0175, 0.0045, 10, 24).rotateX(Math.PI / 2).rotateZ(tilt), M([cradleX, 0.004, 0]));
  parts.holder = hb.build(parts.handShowerSlidePivot, 'shower.holder')[finishMat];
  group.add(parts.handShowerSlidePivot);

  // The hand shower: handle along its local y (bottom = hose end), round head facing local +x (the room).
  parts.handShowerPivot = pivot('handShowerPivot', cradleX, 0.004, 0);
  parts.handShowerPivot.rotation.z = tilt;
  parts.handShowerPivot.userData.grab = true;
  const hs = createBuilder(ctx);
  hs.add(finishMat, lathe([[0, -0.135], [0.0095, -0.135], [0.0105, -0.128], [0.011, -0.06], [0.0128, 0.02], [0.0128, 0.06], [0, 0.07]], seg(ctx, 24)));
  hs.add(finishMat, lathe([[0, -0.012], [0.05, -0.012], [0.055, -0.007], [0.055, 0.004], [0.05, 0.009], [0.044, 0.0092], [0, 0.0092]], seg(ctx, 40)).rotateZ(-Math.PI / 2), M([0.0, 0.11, 0]));
  parts.handShower = hs.build(parts.handShowerPivot, 'shower.handShower')[finishMat];
  parts.handShowerSlidePivot.add(parts.handShowerPivot);
  anchors.handShower = anchor('handShower', parts.handShowerPivot, 0.0095, 0.11, 0, { direction: [1, 0, 0], radius: 0.044 });
  const hoseEnd = anchor('hoseEnd', parts.handShowerPivot, 0, -0.135, 0);

  // --- the hose: from the thermostat's bottom outlet it hangs in a loop and comes back up in front of the thermostat
  // into the hand shower's handle (the holder is straight above the thermostat, on the riser) ---
  function hoseGeometry() {
    group.updateMatrixWorld(true);
    const a = anchors.mixerHose.getWorldPosition(new THREE.Vector3());
    const e = hoseEnd.getWorldPosition(new THREE.Vector3());
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    a.applyMatrix4(inv);
    e.applyMatrix4(inv);
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(parts.handShowerPivot.getWorldQuaternion(new THREE.Quaternion()));
    const low = Math.max(0.05, Math.min(a.y, e.y) - 0.45);
    const front = ax + X.r + 0.04; // in front of the bar thermostat, clear of it
    const pts = [
      a.toArray(), [a.x + 0.005, a.y - 0.1, a.z + 0.01],
      [a.x + 0.025, low + 0.12, a.z + 0.03], [a.x + 0.045, low, a.z + 0.05],
      [front, ay - 0.15, a.z + 0.04], [front, Math.max(ay + 0.06, Math.min(e.y - 0.12, ay + 0.2)), a.z + 0.025],
      e.clone().addScaledVector(axis, -0.1).toArray(), e.toArray(),
    ];
    return tubeSmooth(pts, 0.0075, seg(ctx, 96), 10);
  }
  parts.hose = mesh(ctx, hoseGeometry(), finishMat, 'shower.hose');
  group.add(parts.hose);
  function rebuildHose() {
    const old = parts.hose.geometry;
    parts.hose.geometry = hoseGeometry();
    old.dispose();
  }

  // --- the niche: tiled lining, a stone shelf across its middle (the light bake has it there too:
  // blender/bakelib/fixtures.py) and three bottles, two under the shelf and one on it. Each bottle is sized to its
  // space with a hand's room (1.5 cm) over it: in the one-tile-high niche (30 cm) that is a short bottle each ---
  const N = S.niche;
  const nw = N.x1 - N.x0;
  const nh = N.y1 - N.y0;
  const nx = (N.x0 + N.x1) / 2;
  const t = 0.006;
  sb.add(wallMat, boxGeo(nw, t, N.depth), M([nx, N.y0 + t / 2, -N.depth / 2]), 'nicheLining');
  sb.add(wallMat, boxGeo(nw, t, N.depth), M([nx, N.y1 - t / 2, -N.depth / 2]), 'nicheLining');
  sb.add(wallMat, boxGeo(t, nh - 2 * t, N.depth), M([N.x0 + t / 2, (N.y0 + N.y1) / 2, -N.depth / 2]), 'nicheLining');
  sb.add(wallMat, boxGeo(t, nh - 2 * t, N.depth), M([N.x1 - t / 2, (N.y0 + N.y1) / 2, -N.depth / 2]), 'nicheLining');
  sb.add(wallMat, boxGeo(nw - 2 * t, nh - 2 * t, t), M([nx, (N.y0 + N.y1) / 2, -N.depth + t / 2]), 'nicheLining');
  const shelfT = 0.012;
  const shelfY = (N.y0 + N.y1) / 2;
  sb.add('stoneTop', boxGeo(nw - 2 * t, shelfT, N.depth - t, 0.0015, 1), M([nx, shelfY, -(N.depth - t) / 2]), 'nicheShelf');
  const floorY = N.y0 + t;
  const shelfTop = shelfY + shelfT / 2;
  const under = shelfY - shelfT / 2 - floorY; // clear height under the shelf
  const over = N.y1 - t - shelfTop; // and over it
  const hand = 0.015;
  bottle(sb, 'plasticWhite', 'rubber', N.x0 + nw * 0.28, floorY, -N.depth * 0.5, 0.026, Math.min(0.15, under - hand - CAP_H));
  bottle(sb, 'plasticGrey', null, N.x0 + nw * 0.62, floorY, -N.depth * 0.48, 0.027, Math.min(0.13, under - hand - 0.012 - PUMP_H), finishMat);
  bottle(sb, 'plasticGrey', 'plasticWhite', N.x0 + nw * 0.72, shelfTop, -N.depth * 0.5, 0.022, Math.min(0.1, over - hand - CAP_H));
  anchors.nicheFloor = anchor('nicheFloor', group, nx, floorY, -N.depth / 2);
  anchors.nicheShelf = anchor('nicheShelf', group, nx, shelfTop, -N.depth / 2);

  // --- floor drain: the steel frame set in the tiles (its top flush with them), under it the drain's dark body (a plate
  // round the throat, the throat itself, and the water seal 5 cm down), and the chess grate that lifts out ---
  const DR = S.drain;
  const g = D.drain;
  const fs = DR.size;
  const fw = g.frame;
  const db = createBuilder(ctx); // its own mesh: the membrane view takes the frame away with the tiles
  db.add(drainMat, boxGeo(fs, g.frameDepth, fw), M([DR.x, drainY - g.frameDepth / 2, DR.z - fs / 2 + fw / 2]));
  db.add(drainMat, boxGeo(fs, g.frameDepth, fw), M([DR.x, drainY - g.frameDepth / 2, DR.z + fs / 2 - fw / 2]));
  db.add(drainMat, boxGeo(fw, g.frameDepth, fs - 2 * fw), M([DR.x - fs / 2 + fw / 2, drainY - g.frameDepth / 2, DR.z]));
  db.add(drainMat, boxGeo(fw, g.frameDepth, fs - 2 * fw), M([DR.x + fs / 2 - fw / 2, drainY - g.frameDepth / 2, DR.z]));
  parts.drainFrame = db.build(group, 'shower.drainFrame')[drainMat];
  const pin = fs / 2 - fw;
  const plate = new THREE.Shape([new THREE.Vector2(-pin, -pin), new THREE.Vector2(pin, -pin), new THREE.Vector2(pin, pin), new THREE.Vector2(-pin, pin)]);
  plate.holes.push(new THREE.Path().absarc(0, 0, g.throat, 0, Math.PI * 2, true));
  const plateGeo = new THREE.ShapeGeometry(plate, seg(ctx, 12));
  plateGeo.rotateX(-Math.PI / 2);
  sb.add('rubber', plateGeo, M([DR.x, drainY - g.plate, DR.z]), 'drainDark');
  // the throat, seen from inside (profile from the top down: the faces look in)
  sb.add('rubber', lathe([[g.throat, 0], [g.throat, -(g.depth - g.plate)]], seg(ctx, 32)), M([DR.x, drainY - g.plate, DR.z]), 'drainDark');
  const water = new THREE.CircleGeometry(g.throat - 0.0005, seg(ctx, 32));
  water.rotateX(-Math.PI / 2);
  parts.waterSeal = mesh(ctx, water, 'waterSeal', 'shower.waterSeal');
  parts.waterSeal.position.set(DR.x, drainY - g.seal, DR.z);
  parts.waterSeal.castShadow = false;
  group.add(parts.waterSeal);
  parts.drainGratePivot = pivot('drainGratePivot', DR.x, drainY - g.height, DR.z, { type: 'slide', axis: [0, 1, 0], min: 0, max: g.lift });
  const gb = createBuilder(ctx);
  const gs = g.grate;
  const bw = 0.008;
  gb.add(drainMat, boxGeo(gs, g.height, bw), M([0, g.height / 2, -gs / 2 + bw / 2]));
  gb.add(drainMat, boxGeo(gs, g.height, bw), M([0, g.height / 2, gs / 2 - bw / 2]));
  gb.add(drainMat, boxGeo(bw, g.height, gs - 2 * bw), M([-gs / 2 + bw / 2, g.height / 2, 0]));
  gb.add(drainMat, boxGeo(bw, g.height, gs - 2 * bw), M([gs / 2 - bw / 2, g.height / 2, 0]));
  const n = 9;
  const cell = (gs - 2 * bw) / n;
  const sq = boxGeo(cell, g.height, cell);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if ((i + j) % 2) continue;
      gb.add(drainMat, sq, M([-gs / 2 + bw + (i + 0.5) * cell, g.height / 2, -gs / 2 + bw + (j + 0.5) * cell]));
    }
  }
  parts.drainGrate = gb.build(parts.drainGratePivot, 'shower.drainGrate')[drainMat];
  group.add(parts.drainGratePivot);
  anchors.drain = anchor('drain', group, DR.x, drainY, DR.z);

  // Merge the static pieces and point the named parts at the mesh that holds them.
  parts.static = sb.build(group, 'shower.static');
  parts.profile = parts.stay = parts.static[profileMat];
  parts.rainHead = parts.mixerBody = parts.slideBar = parts.static[finishMat];
  parts.nicheLining = parts.static[wallMat];
  parts.nicheShelf = parts.static.stoneTop;
  parts.bottles = parts.static.plasticWhite;
  parts.drainDark = parts.static.rubber;

  return { group, parts, anchors, rebuildHose };
}
