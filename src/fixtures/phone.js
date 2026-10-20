// A phone lying face-down on the vanity counter (about 7.2 x 14.7 x 0.8 cm), back up with its camera bump; the screen
// plane is on the underside, facing the counter, ready for a canvas texture once the phone is picked up.
// Placement: LAYOUT.vanity.counter.phone (x, z) on the counter surface.
//
// createPhone(ctx, { angle: 0.25 })
// parts: body (= cameraBump, one merged mesh), lenses, screen (plane on the underside facing down; per-object screen
//   material).
// anchors: screenCentre.
import * as THREE from 'three';
import { mesh, anchor, createBuilder, M, flatExtrude, roundedRectShape, lathe, screenMaterial, seg } from './util.js';
import { counterTop } from './vanity.js';

export const PHONE_DIMS = { w: 0.0716, l: 0.1467, t: 0.0078, corner: 0.011 };

export function createPhone(ctx, opts = {}) {
  const L = ctx.layout;
  const C = L.vanity.counter.phone;
  const D = PHONE_DIMS;
  const group = new THREE.Group();
  group.name = 'phone';
  group.position.set(C.x, counterTop(L), C.z);
  group.rotation.y = opts.angle ?? 0.25;
  const parts = {};
  const anchors = {};

  // Body, and the camera bump on the back (which faces up): a raised rounded square with two lenses.
  const b = createBuilder(ctx);
  b.add('matteBlack', flatExtrude(roundedRectShape(D.w, D.l, D.corner), D.t, 0.0016, 8, 2), null, 'body');
  const bx = -D.w / 2 + 0.021;
  const bz = -D.l / 2 + 0.021;
  b.add('matteBlack', flatExtrude(roundedRectShape(0.03, 0.03, 0.007), 0.0012, 0.0004, 6, 1), M([bx, D.t, bz]), 'cameraBump');
  for (const [lx, lz] of [[-0.007, -0.007], [0.007, 0.007]]) {
    b.add('brushedSteel', lathe([[0.0062, 0], [0.0062, 0.0014], [0.0052, 0.0016]], seg(ctx, 20)), M([bx + lx, D.t + 0.0012, bz + lz]), 'cameraBump');
    b.add('screenBlack', lathe([[0.0052, 0.0013], [0, 0.0013]], seg(ctx, 20)), M([bx + lx, D.t + 0.0012, bz + lz]), 'cameraBump');
  }
  const built = b.build(group, 'phone.body');
  parts.body = parts.cameraBump = built.matteBlack;
  parts.body.userData.knock = 'glass'; // a glass back
  parts.lenses = built.brushedSteel;

  // Screen plane on the underside (face-down).
  const screenG = new THREE.PlaneGeometry(D.w - 0.005, D.l - 0.006);
  screenG.rotateX(Math.PI / 2);
  parts.screen = mesh(ctx, screenG, screenMaterial('phone'), 'phone.screen');
  parts.screen.position.y = -0.0002;
  parts.screen.castShadow = false;
  group.add(parts.screen);
  anchors.screenCentre = anchor('screenCentre', group, 0, -0.0002, 0);

  return { group, parts, anchors };
}
