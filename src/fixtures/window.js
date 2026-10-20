// The tiled-in window in a dry wall (over the toilet): a white frame set at the back of a 20 cm reveal, the tiled reveal
// lining, a bottom-hinged sash that tilts its top into the room, a double-glazed pane and a handle on the top rail.
// The frame's rebate runs round its opening behind the sash, so the 2 mm gap round the shut sash is closed: it showed the
// night sky right through as a thin dark-blue line (the look, 2026-10-19). The sash covers the rebate from the room.
// Placement: LAYOUT.window (wall, z0..z1, y0..y1, depth). Local frame = wall frame of its wall (util.js):
// origin on the wall surface at the window's bottom centre, +z out of the wall (into the room), +x along the wall.
//
// createWindow(ctx, { wallMaterial: 'tileSand', handleFinish: 'brushedSteel' })
// parts: frame, reveal (tiled lining), sashPivot (hinge along the sash's bottom room-side edge; tilting in = positive
//   rotation.x up to 0.21 rad, about 10 cm at the top) + sash, glass, handlePivot (on the top rail; turning = positive
//   rotation.z up to PI/2) + handle.
// anchors: glassOutside (outer face of the pane, moves with the sash), sill (middle of the reveal's bottom).
import * as THREE from 'three';
import { mesh, pivot, anchor, placeOnWall, createBuilder, boxGeo, M, RoundedBox, glassName } from './util.js';

// frame.rebate: how far the rebate reaches into the opening (behind the sash's 5.5 cm rails, so never seen from the room)
// and how far behind the sash's back it stays
export const WINDOW_DIMS = {
  frame: { w: 0.05, d: 0.1, rebate: 0.012, behind: 0.001 }, sash: { w: 0.055, d: 0.06, gap: 0.002 }, pane: 0.024, maxTilt: 0.21,
};

export function createWindow(ctx, opts = {}) {
  const L = ctx.layout;
  const Wn = L.window;
  const D = WINDOW_DIMS;
  const wallMat = opts.wallMaterial || 'tileSand';
  const hwMat = opts.handleFinish || 'brushedSteel';
  const w = Wn.z1 - Wn.z0;
  const h = Wn.y1 - Wn.y0;
  const depth = Wn.depth;
  const group = new THREE.Group();
  group.name = 'window';
  placeOnWall(group, L, Wn.wall, (Wn.z0 + Wn.z1) / 2, Wn.y0);
  const parts = {};
  const anchors = {};

  // Frame at the back of the reveal (its outer face at -depth), and the tiled lining in front of it.
  const F = D.frame;
  const fz = -depth + F.d / 2;
  const fb = createBuilder(ctx);
  fb.add('enamelWhite', boxGeo(w, F.w, F.d), M([0, h - F.w / 2, fz]));
  fb.add('enamelWhite', boxGeo(w, F.w, F.d), M([0, F.w / 2, fz]));
  fb.add('enamelWhite', boxGeo(F.w, h - 2 * F.w, F.d), M([-w / 2 + F.w / 2, h / 2, fz]));
  fb.add('enamelWhite', boxGeo(F.w, h - 2 * F.w, F.d), M([w / 2 - F.w / 2, h / 2, fz]));
  // the rebate: from the frame's outer face to just behind the shut sash's back, round the opening
  const S0 = D.sash;
  const rb = F.rebate;
  const kd = F.d - S0.d - F.behind;
  const kz = -depth + kd / 2;
  fb.add('enamelWhite', boxGeo(w - 2 * F.w, rb, kd), M([0, F.w + rb / 2, kz]));
  fb.add('enamelWhite', boxGeo(w - 2 * F.w, rb, kd), M([0, h - F.w - rb / 2, kz]));
  fb.add('enamelWhite', boxGeo(rb, h - 2 * F.w - 2 * rb, kd), M([-w / 2 + F.w + rb / 2, h / 2, kz]));
  fb.add('enamelWhite', boxGeo(rb, h - 2 * F.w - 2 * rb, kd), M([w / 2 - F.w - rb / 2, h / 2, kz]));
  const rd = depth - F.d; // reveal depth in front of the frame
  const t = 0.006;
  fb.add(wallMat, boxGeo(w, t, rd), M([0, h - t / 2, -rd / 2]));
  fb.add(wallMat, boxGeo(w, t, rd), M([0, t / 2, -rd / 2]));
  fb.add(wallMat, boxGeo(t, h - 2 * t, rd), M([-w / 2 + t / 2, h / 2, -rd / 2]));
  fb.add(wallMat, boxGeo(t, h - 2 * t, rd), M([w / 2 - t / 2, h / 2, -rd / 2]));
  const fbuilt = fb.build(group, 'window.frame');
  parts.frame = fbuilt.enamelWhite;
  parts.frame.userData.knock = 'wood';
  parts.reveal = fbuilt[wallMat];
  anchors.sill = anchor('sill', group, 0, t, -rd / 2);

  // Sash: fills the frame opening, its room face flush with the frame's room face; hinged at its bottom edge.
  const S = D.sash;
  const sw = w - 2 * F.w - 2 * S.gap;
  const sh = h - 2 * F.w - 2 * S.gap;
  const sz = -depth + F.d; // room face of frame and sash
  parts.sashPivot = pivot('sashPivot', 0, F.w + S.gap, sz, { type: 'hinge', axis: [1, 0, 0], min: 0, max: D.maxTilt });
  const sb = createBuilder(ctx);
  sb.add('enamelWhite', boxGeo(sw, S.w, S.d), M([0, sh - S.w / 2, -S.d / 2]));
  sb.add('enamelWhite', boxGeo(sw, S.w, S.d), M([0, S.w / 2, -S.d / 2]));
  sb.add('enamelWhite', boxGeo(S.w, sh - 2 * S.w, S.d), M([-sw / 2 + S.w / 2, sh / 2, -S.d / 2]));
  sb.add('enamelWhite', boxGeo(S.w, sh - 2 * S.w, S.d), M([sw / 2 - S.w / 2, sh / 2, -S.d / 2]));
  sb.add(hwMat, new RoundedBox(0.028, 0.05, 0.008, 2, 0.003), M([0, sh - S.w / 2, 0.004]));
  const sbuilt = sb.build(parts.sashPivot, 'window.sash');
  parts.sash = sbuilt.enamelWhite;
  parts.sash.userData.knock = 'wood';
  parts.handleBase = sbuilt[hwMat];
  const pane = boxGeo(sw - 2 * S.w + 0.012, sh - 2 * S.w + 0.012, D.pane);
  pane.translate(0, sh / 2, -S.d / 2);
  parts.glass = mesh(ctx, pane, glassName(ctx), 'window.glass');
  parts.glass.castShadow = false;
  parts.glass.renderOrder = 1;
  parts.sashPivot.add(parts.glass);
  anchors.glassOutside = anchor('glassOutside', parts.sashPivot, 0, sh / 2, -S.d / 2 - D.pane / 2);

  // Handle on the top rail: hangs down over the glass when closed, turns a quarter to release the tilt.
  parts.handlePivot = pivot('handlePivot', 0, sh - S.w / 2, 0.008, { type: 'hinge', axis: [0, 0, 1], min: 0, max: Math.PI / 2 });
  const hb = createBuilder(ctx);
  hb.add(hwMat, new RoundedBox(0.018, 0.018, 0.012, 2, 0.005), M([0, 0, 0.006]));
  hb.add(hwMat, new RoundedBox(0.015, 0.1, 0.011, 2, 0.005), M([0, -0.05, 0.016]));
  parts.handle = hb.build(parts.handlePivot, 'window.handle')[hwMat];
  parts.sashPivot.add(parts.handlePivot);
  group.add(parts.sashPivot);

  return { group, parts, anchors };
}
