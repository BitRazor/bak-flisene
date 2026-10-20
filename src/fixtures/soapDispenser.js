// A matt ceramic soap dispenser (7 cm across, 16.5 cm to the top of the pump) with a chrome pump that travels down.
// Placement: LAYOUT.vanity.counter.soap (x, z) on the counter surface; the nozzle points toward the room (+z).
//
// createSoapDispenser(ctx, { finish: 'chrome', angle: 0 })
// parts: body, collar, pumpPivot (slides down, 0..0.01 m) + pump (stem, head and nozzle).
// anchors: nozzle (where the soap comes out; moves with the pump).
import * as THREE from 'three';
import { mesh, pivot, anchor, createBuilder, M, lathe, smooth, cylinderBetween, tubeAlong, RoundedBox, seg } from './util.js';
import { counterTop } from './vanity.js';

export const SOAP_DIMS = { headTop: 0.165, travel: 0.01 };

export function createSoapDispenser(ctx, opts = {}) {
  const L = ctx.layout;
  const C = L.vanity.counter.soap;
  const finishMat = opts.finish || 'chrome';
  const group = new THREE.Group();
  group.name = 'soapDispenser';
  group.position.set(C.x, counterTop(L), C.z);
  group.rotation.y = opts.angle || 0;
  const parts = {};
  const anchors = {};

  const bodyProfile = [
    [0, 0], [0.031, 0], [0.0338, 0.0012],
    ...smooth([[0.0348, 0.004], [0.035, 0.03], [0.0349, 0.08], [0.033, 0.102], [0.027, 0.114], [0.017, 0.12], [0.0126, 0.1215]], 12),
  ];
  parts.body = mesh(ctx, lathe(bodyProfile, seg(ctx, 40)), 'ceramicMatt', 'soapDispenser.body');
  parts.collar = mesh(ctx, lathe([[0.0124, 0.1205], [0.0152, 0.1205], [0.0154, 0.1305], [0.0138, 0.1328], [0.0042, 0.1328]], seg(ctx, 32)), finishMat, 'soapDispenser.collar');
  group.add(parts.body, parts.collar);

  const top = SOAP_DIMS.headTop;
  parts.pumpPivot = pivot('pumpPivot', 0, top, 0, { type: 'slide', axis: [0, -1, 0], min: 0, max: SOAP_DIMS.travel });
  const pb = createBuilder(ctx);
  pb.add(finishMat, cylinderBetween([0, 0.1305 - top, 0], [0, -0.012, 0], 0.0036, 12));
  pb.add(finishMat, new RoundedBox(0.02, 0.016, 0.024, 2, 0.0045), M([0, -0.008, 0.001]));
  pb.add(finishMat, tubeAlong([[0, -0.007, 0.01], [0, -0.008, 0.03], [0, -0.012, 0.034]], 0.0036, { bend: 0.004, tubular: 12, radial: 12, caps: true }));
  parts.pump = pb.build(parts.pumpPivot, 'soapDispenser.pump')[finishMat];
  group.add(parts.pumpPivot);
  anchors.nozzle = anchor('nozzle', parts.pumpPivot, 0, -0.0125, 0.034, { direction: [0, -1, 0] });

  return { group, parts, anchors };
}
