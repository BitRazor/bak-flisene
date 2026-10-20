// Toilet-roll holder on the right wall beside the toilet boxing: a wall rosette with an L-shaped arm whose free end
// is the spindle (open toward the boxing), a full roll (12 cm across, 10 cm wide, 4.5 cm core) and a hanging tail sheet.
// Placement: LAYOUT.toilet.paperHolder (wall, z = roll centre along the wall, y = roll centre height).
// Local frame = wall frame of its wall (util.js): +z out of the wall, +x along the wall.
//
// createPaperHolder(ctx, { orientation: 'over' | 'under', tail: 0.06, finish: 'chrome' })
// parts: holder (rosette + arm, static), rollPivot (hinge on the spindle axis, local x; unbounded), roll, core,
//   tailPivot (where the sheet leaves the roll), tail (a sheet hanging down; its length is tail.scale.y in metres).
// anchors: tear (where a pulled sheet tears off: the point the paper leaves the roll), tailEnd (bottom of the tail).
// methods: setOrientation('over'|'under'), setTail(lenMetres), pull(lenMetres) (lengthens the tail and spins the roll the
//   right way for the orientation), orientation(), tailLength().
import * as THREE from 'three';
import { mesh, pivot, anchor, placeOnWall, createBuilder, cylinderBetween, tubeAlong, lathe, seg, M } from './util.js';

export const PAPER_DIMS = { rollRadius: 0.06, coreRadius: 0.0225, width: 0.098, spindleOut: 0.075, rosetteAlong: 0.065 };

export function createPaperHolder(ctx, opts = {}) {
  const L = ctx.layout;
  const P = L.toilet.paperHolder;
  const finishMat = opts.finish || 'chrome';
  const { rollRadius: R, coreRadius: Rc, width, spindleOut: S, rosetteAlong: RA } = PAPER_DIMS;
  const hl = width / 2;

  const group = new THREE.Group();
  group.name = 'paperHolder';
  placeOnWall(group, L, P.wall, P.z, P.y);
  const parts = {};
  const anchors = {};

  // Rosette on the wall and the arm: out from the wall, then along the wall as the spindle.
  const b = createBuilder(ctx);
  b.add(finishMat, cylinderBetween([RA, 0, 0], [RA, 0, 0.008], 0.024, seg(ctx, 32)));
  b.add(finishMat, tubeAlong([[RA, 0, 0.006], [RA, 0, S], [-hl - 0.008, 0, S]], 0.006, { bend: 0.014, tubular: 32, radial: 12 }));
  b.add(finishMat, new THREE.SphereGeometry(0.0062, 12, 8), M([-hl - 0.008, 0, S]));
  parts.holder = b.build(group, 'paperHolder.holder')[finishMat];

  // The roll spins on the spindle axis (local x).
  parts.rollPivot = pivot('rollPivot', 0, 0, S, { type: 'hinge', axis: [1, 0, 0], min: -1e9, max: 1e9 });
  const rollG = lathe([
    [Rc, -hl], [R - 0.004, -hl], [R - 0.001, -hl + 0.001], [R, -hl + 0.004],
    [R, hl - 0.004], [R - 0.001, hl - 0.001], [R - 0.004, hl], [Rc, hl],
  ], seg(ctx, 48));
  rollG.rotateZ(-Math.PI / 2);
  parts.roll = mesh(ctx, rollG, 'paper', 'paperHolder.roll');
  const coreG = lathe([[Rc, hl - 0.0015], [Rc, -hl + 0.0015]], seg(ctx, 24));
  coreG.rotateZ(-Math.PI / 2);
  parts.core = mesh(ctx, coreG, 'cardboard', 'paperHolder.core');
  parts.rollPivot.add(parts.roll, parts.core);
  group.add(parts.rollPivot);

  // The tail: a sheet from the roll's tangent point straight down. Over = room side, under = wall side.
  parts.tailPivot = pivot('tailPivot', 0, 0, S + R);
  const tailG = new THREE.PlaneGeometry(width - 0.002, 1);
  tailG.translate(0, -0.5, 0);
  parts.tail = mesh(ctx, tailG, 'paper', 'paperHolder.tail');
  parts.tail.castShadow = false;
  parts.tailPivot.add(parts.tail);
  group.add(parts.tailPivot);
  anchors.tear = anchor('tear', parts.tailPivot, 0, 0, 0);
  anchors.tailEnd = anchor('tailEnd', parts.tail, 0, -1, 0);

  let orientation = 'over';
  let tail = 0;

  function setOrientation(o) {
    if (o !== 'over' && o !== 'under') throw new Error(`paperHolder: orientation must be 'over' or 'under', got "${o}"`);
    orientation = o;
    parts.tailPivot.position.z = o === 'over' ? S + R : S - R;
    return orientation;
  }

  function setTail(len) {
    tail = Math.max(0, len);
    parts.tail.visible = tail > 0.002;
    parts.tail.scale.y = Math.max(0.002, tail);
    return tail;
  }

  function pull(len) {
    const sign = orientation === 'over' ? 1 : -1;
    parts.rollPivot.rotation.x += (sign * len) / R;
    parts.rollPivot.userData.joint.value = parts.rollPivot.rotation.x;
    return setTail(tail + len);
  }

  setOrientation(opts.orientation || 'over');
  setTail(opts.tail ?? 0.06);

  return {
    group, parts, anchors, setOrientation, setTail, pull,
    orientation: () => orientation,
    tailLength: () => tail,
  };
}
