// The toothbrushes and their cup (fixtures/toothbrushCup.js). A tap on a brush pulls it out: it slides up out of the cup
// with a bristle slide and turns upright to the visitor, a hand's breadth in front of the cup (the camera never moves:
// the brush comes to the eye); another tap puts it back, and it lands in the cup with a soft clink. One brush out at a
// time: another brush tapped sends the first one home. The child's brush shows its dinosaur (an easter egg without
// words, research/inventory-dry.md 20.2). A tap on the cup: a glass-and-ceramic ting (20.1). Each brush gets a
// finger-sized touch box that moves with it (a brush's handle is a centimetre wide).
//
// wireToothbrushes(ctx, { found, play, reg, loop, tweens }) -> { tapBrush(i), tapCup(), presented, poseOf(i), boxes },
// or null when the room has no such cup (ctx.fixtures.toothbrushCup with poseBrush). Discovery keys:
// TOOTHBRUSH_DISCOVERIES (and 'knock_ceramic' for the cup, which the room already counts). Sound roles: brush_slide,
// cup_ting.
import * as THREE from 'three';
import { HIT } from './touchKit.js';
import { BRUSHES, BRUSH_MOTION } from '../fixtures/toothbrushCup.js';

export const TOOTHBRUSH_DISCOVERIES = ['toothbrush', 'dino'];
// The pull takes upMs; the brush's foot comes up over the cup's rim about 0.35 s into it (poseBrush's easing). The
// brush_slide sound's bristle "frrt", its loudest part, comes frrtS into every variant (tmp/wave3/sounds.md), so the
// sound starts slideDelayS after the tap and the two meet (tests/integration.test.js).
export const BRUSH_TIMING = { upMs: 950, downMs: 750, frrtS: 0.2, slideDelayS: 0.15 };
// A brush's touch box, in its own frame (y up its handle, z its front): from just under the rim to over its head.
const BOX = { from: 0.085, over: 0.008, w: 0.032, d: 0.03, front: 0.005 };

export function wireToothbrushes(ctx, helpers = {}) {
  const cup = ctx.fixtures && ctx.fixtures.toothbrushCup;
  if (!cup || !cup.poseBrush) return null;
  const { found = () => {}, play = () => null, reg, loop, tweens } = helpers;
  const st = BRUSHES.map(() => ({ t: 0, yaw: 0, out: false }));
  let shown = -1;

  // the yaw that turns a brush held in front of the cup to face the visitor's eye (the cup is never turned)
  const at = new THREE.Vector3();
  function yawToEye() {
    cup.group.updateWorldMatrix(true, false);
    at.fromArray(BRUSH_MOTION.present).applyMatrix4(cup.group.matrixWorld);
    const eye = ctx.camera.position;
    return Math.atan2(eye.x - at.x, eye.z - at.z);
  }

  function move(i, out) {
    const s = st[i];
    s.out = out;
    if (out) s.yaw = yawToEye();
    const from = s.t;
    const to = out ? 1 : 0;
    const ms = Math.max(150, Math.abs(to - from) * (out ? BRUSH_TIMING.upMs : BRUSH_TIMING.downMs));
    tweens.add({
      key: `brush${i}:${cup.group.uuid}`, from, to, duration: ms, ease: 'linear', // (poseBrush eases each stage)
      onUpdate: (v) => { s.t = v; cup.poseBrush(i, v, s.yaw); },
      onDone: () => { if (!out) play('cup_ting', { volume: 0.28, rate: 1.5 }); }, // home: a soft clink in the cup
    });
    if (loop) loop.wake(ms + 150);
  }

  function tapBrush(i) {
    if (st[i].out) { move(i, false); if (shown === i) shown = -1; return; }
    if (shown >= 0 && shown !== i) move(shown, false);
    shown = i;
    move(i, true);
    play('brush_slide', { volume: 0.7, delay: BRUSH_TIMING.slideDelayS });
    found('toothbrush');
    if (BRUSHES[i].dino != null) found('dino');
  }
  function tapCup() {
    play('cup_ting', { volume: 0.75 });
    found('knock_ceramic');
  }

  if (reg) {
    reg(cup.parts.brushes, { tap: (hit) => { const i = cup.brushAt(hit); if (i >= 0) tapBrush(i); } });
    reg(cup.parts.cup, { tap: tapCup, knock: 'ceramic' });
  }
  const boxes = BRUSHES.map((b, i) => {
    const h = b.len + BOX.over - BOX.from;
    const box = new THREE.Mesh(new THREE.BoxGeometry(BOX.w, h, BOX.d), HIT);
    box.position.set(0, BOX.from + h / 2, BOX.front);
    box.name = `toothbrushCup.brush${i}.touch`;
    box.userData.touchBox = true;
    cup.parts[`brush${i}Pivot`].add(box);
    if (ctx.interaction) ctx.interaction.register(box, { tap: () => tapBrush(i) });
    return box;
  });

  return {
    tapBrush, tapCup, boxes,
    get presented() { return shown; },
    poseOf: (i) => ({ t: st[i].t, yaw: st[i].yaw, out: st[i].out }),
  };
}
