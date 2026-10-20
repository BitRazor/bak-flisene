// The ceiling extract valve (a white 125 mm disc valve, Fläkt KSO-125-like): a white collar set in the ceiling round
// the duct, and the round disc hanging a little below it on its centre spindle (the air goes in through the ring-shaped
// gap; turning the disc sets the flow). Every Norwegian bathroom has one; the steam is pulled to it (fx/steam.js uses
// LAYOUT.vent) and the room's mirror teaches its 54 / 108 m3/h. Not part of the light bake: lit live like every fixture.
// Placement: LAYOUT.vent (x, z on the ceiling, size = the disc's diameter). The group sits at the vent point on the
// ceiling's surface; its axes are the room's.
//
// createExtractValve(ctx, opts)
// parts: valve (the collar), disc (the disc and its centre knob), opening (the dark duct seen through the gap).
// anchors: intake (the middle of the gap under the ceiling, where the air goes in).
import * as THREE from 'three';
import { mesh, anchor, lathe, seg, createBuilder, M } from './util.js';

export const VALVE_DIMS = { collarIn: 0.058, collarOut: 0.072, collarDrop: 0.004, gap: 0.012, discT: 0.006, knobR: 0.014 };

export function createExtractValve(ctx, opts = {}) {
  const L = ctx.layout;
  const V = L.vent;
  const D = VALVE_DIMS;
  const H = L.room.H;
  const r = (V.size || 0.125) / 2;
  const group = new THREE.Group();
  group.name = 'extractValve';
  group.position.set(V.x, H, V.z);
  const parts = {};
  const anchors = {};

  // the collar: a white ring round the duct, 4 mm proud of the ceiling (profile down the inside, out, up the outside),
  // and the spindle the disc hangs on (seen in the gap)
  const top = -(D.collarDrop + D.gap);
  const vb = createBuilder(ctx);
  vb.add('plasticWhite', lathe([[D.collarIn, 0], [D.collarIn, -D.collarDrop], [D.collarOut - 0.004, -D.collarDrop],
    [D.collarOut, -0.0015], [D.collarOut, 0]], seg(ctx, 48)));
  vb.add('plasticWhite', new THREE.CylinderGeometry(0.0025, 0.0025, -top, 8), M([0, top / 2, 0]));
  parts.valve = vb.build(group, 'extractValve.valve').plasticWhite;
  // the duct behind it, dark (seen through the gap between the disc and the collar)
  const hole = new THREE.CircleGeometry(D.collarIn, seg(ctx, 32));
  hole.rotateX(Math.PI / 2); // faces down into the room
  hole.translate(0, -0.0005, 0);
  parts.opening = mesh(ctx, hole, 'rubber', 'extractValve.opening');
  parts.opening.castShadow = false;
  // the disc, slightly domed underneath, with the knob that sets the flow (one mesh)
  const db = createBuilder(ctx);
  db.add('plasticWhite', lathe([[0, -D.discT], [r * 0.7, -D.discT + 0.0006], [r - 0.002, -0.002], [r, -0.0008], [r, 0], [r - 0.004, 0.0006], [0, 0.001]], seg(ctx, 64)), M([0, top, 0]));
  db.add('plasticWhite', lathe([[0, -0.0045], [D.knobR * 0.8, -0.0042], [D.knobR, -0.002], [D.knobR, 0]], seg(ctx, 24)), M([0, top - D.discT, 0]));
  group.add(parts.opening);
  parts.disc = db.build(group, 'extractValve.disc').plasticWhite;
  for (const m of [parts.valve, parts.disc]) m.userData.knock = 'paint'; // a dull plastic tap
  anchors.intake = anchor('intake', group, 0, -(D.collarDrop + D.gap / 2), 0);
  return { group, parts, anchors };
}
