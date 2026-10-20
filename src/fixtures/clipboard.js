// The clipboard on the vanity counter: a hardboard board with a spring clip, an A4 sheet (a plane for the "Befaring"
// canvas texture), and the chunky green self-inking date stamp standing at the bottom of the sheet.
// Placement: LAYOUT.vanity.counter.clipboard (x, z) on the counter surface; the clip end points at the back wall.
//
// createClipboard(ctx, { angle: 0, finish: 'chrome' })
// parts: board, clipBase (static), clipPivot (hinge along x at the spring; negative rotation.x lifts the jaw, to -0.35)
//   + clip, sheet (A4 plane, 0.210 x 0.297 m; its material is a per-sheet clone of 'paper', UV u = left -> right,
//   v = bottom -> top as read from the front), stamp (Group), stampBody (base + inner core, static),
//   stampPlungerPivot (slides down, 0..0.02 m) + stampPlunger (the green shell and grip), stampLabel ("HOLD INNE"
//   printed on the grip's flat top: a decal with a canvas texture, on the plunger pivot; hidden where there is no
//   canvas, as in the headless tests).
// anchors: sheetCentre, sheetTop (middle of the sheet's top edge), stampFoot (where the stamp prints on the sheet).
import * as THREE from 'three';
import { mat, mesh, pivot, anchor, createBuilder, M, flatExtrude, roundedRectShape, RoundedBox, boxGeo, cylinderBetween } from './util.js';
import { counterTop } from './vanity.js';
import { flowText, paintLines, canvasMeasure } from '../systems/paper.js';
import { SHEET_TEXT } from '../data/texts.js';

export const CLIPBOARD_DIMS = {
  board: { w: 0.23, l: 0.32, t: 0.0032 },
  sheet: { w: 0.21, l: 0.297, offset: 0.012 },
  stampAt: 0.095, // stamp centre, metres toward the reader from the board centre
  stampTravel: 0.02,
  // the grip on top of the stamp's green shell: flat-topped with rounded edges, as on a real self-inking stamp, so its
  // label has room (the flat is w - 2r by d - 2r)
  stampGrip: { w: 0.056, h: 0.024, d: 0.046, r: 0.005 },
};

// "HOLD INNE" on the grip's flat top, where a real self-inking stamp carries its label: dark green print on the green
// grip (contrast about 6 to 1, tests/clipboard.test.js), framed like a stamp's index label. 20 canvas px per mm: the
// capitals are 9.3 mm tall, about 6.4 px on an upright phone from where the visitor stands at the counter.
export const STAMP_GRIP_LABEL = { w: 0.044, d: 0.034, canvas: [880, 680], ink: '#2d3b07' };

// The label's words (the sheet's own "Hold inne", data/texts.js), as laid out on its canvas.
export function stampGripLayout(measure) {
  const [cw, ch] = STAMP_GRIP_LABEL.canvas;
  return flowText(SHEET_TEXT.stampRight.map((s) => ({
    text: s.toUpperCase(), size: 256, weight: 800, color: STAMP_GRIP_LABEL.ink, align: 'center', tag: 'grip',
  })), measure, { x: 20, w: cw - 40, top: 18, bottom: ch - 18 });
}

export function createClipboard(ctx, opts = {}) {
  const L = ctx.layout;
  const C = L.vanity.counter.clipboard;
  const D = CLIPBOARD_DIMS;
  const finishMat = opts.finish || 'chrome';
  const group = new THREE.Group();
  group.name = 'clipboard';
  group.position.set(C.x, counterTop(L), C.z);
  group.rotation.y = opts.angle || 0;
  const parts = {};
  const anchors = {};
  const bt = D.board.t;

  parts.board = mesh(ctx, flatExtrude(roundedRectShape(D.board.w, D.board.l, 0.012), bt, 0.0008, 6, 1), 'oakDark', 'clipboard.board');
  group.add(parts.board);

  // The sheet: an A4 plane lying on the board, its top edge under the clip.
  const sheetG = new THREE.PlaneGeometry(D.sheet.w, D.sheet.l);
  sheetG.rotateX(-Math.PI / 2);
  const paperMat = mat(ctx, 'paper').clone();
  paperMat.name = 'paper:befaring';
  parts.sheet = mesh(ctx, sheetG, paperMat, 'clipboard.sheet');
  parts.sheet.position.set(0, bt + 0.0003, D.sheet.offset);
  parts.sheet.castShadow = false;
  group.add(parts.sheet);
  const sheetTopZ = D.sheet.offset - D.sheet.l / 2;
  anchors.sheetCentre = anchor('sheetCentre', group, 0, bt + 0.0004, D.sheet.offset);
  anchors.sheetTop = anchor('sheetTop', group, 0, bt + 0.0004, sheetTopZ);

  // The clip: a riveted base plate, the spring roll (hinge axis) and the jaw pressing on the sheet. It holds the sheet
  // by its top margin only: narrow and short enough to leave the letterhead ("Straume", "Befaring", "EKSEMPEL") clear.
  const clipZ = -D.board.l / 2 + 0.009;
  const cb = createBuilder(ctx);
  cb.add(finishMat, new RoundedBox(0.068, 0.0016, 0.03, 1, 0.0007), M([0, bt + 0.0008, clipZ + 0.006]));
  for (const sx of [-0.025, 0.025]) cb.add(finishMat, cylinderBetween([sx, bt, clipZ + 0.006], [sx, bt + 0.0028, clipZ + 0.006], 0.0032, 12));
  parts.clipBase = cb.build(group, 'clipboard.clipBase')[finishMat];
  const rollY = bt + 0.0062;
  parts.clipPivot = pivot('clipPivot', 0, rollY, clipZ, { type: 'hinge', axis: [1, 0, 0], min: -0.35, max: 0 });
  const jb = createBuilder(ctx);
  jb.add(finishMat, cylinderBetween([-0.036, 0, 0], [0.036, 0, 0], 0.0048, 16));
  // jaw: from the roll down onto the sheet's top margin, 22 mm long
  const jawLen = 0.022;
  const jawAngle = Math.atan2(rollY - bt - 0.0012, jawLen);
  jb.add(finishMat, new RoundedBox(0.07, 0.0014, jawLen, 1, 0.0006), M([0, -Math.sin(jawAngle) * jawLen * 0.5, Math.cos(jawAngle) * jawLen * 0.5], [jawAngle, 0, 0]));
  // thumb lever: a short curl behind the roll
  jb.add(finishMat, new RoundedBox(0.065, 0.0014, 0.02, 1, 0.0006), M([0, 0.006, -0.008], [-0.75, 0, 0]));
  parts.clip = jb.build(parts.clipPivot, 'clipboard.clip')[finishMat];
  group.add(parts.clipPivot);

  // The date stamp: a fixed base on the paper with the dark core showing, and the green shell + grip that travel down.
  const stamp = new THREE.Group();
  stamp.name = 'clipboard.stamp';
  stamp.position.set(0, bt + 0.0004, D.stampAt);
  const sb = createBuilder(ctx);
  sb.add('plasticGreen', new RoundedBox(0.056, 0.016, 0.046, 2, 0.004), M([0, 0.008, 0]));
  sb.add('rubber', boxGeo(0.05, 0.034, 0.04), M([0, 0.033, 0]));
  const stampBuilt = sb.build(stamp, 'clipboard.stampBody');
  parts.stampBody = stampBuilt.plasticGreen;
  parts.stampCore = stampBuilt.rubber;
  const topY = 0.092; // the grip's top (the plunger pivot sits there)
  const G = D.stampGrip;
  parts.stampPlungerPivot = pivot('stampPlungerPivot', 0, topY, 0, { type: 'slide', axis: [0, -1, 0], min: 0, max: D.stampTravel });
  const pb = createBuilder(ctx);
  pb.add('plasticGreen', new RoundedBox(0.062, 0.05, 0.052, 2, 0.006), M([0, 0.047 - topY, 0]));
  pb.add('plasticGreen', new RoundedBox(G.w, G.h, G.d, 3, G.r), M([0, -G.h / 2, 0]));
  parts.stampPlunger = pb.build(parts.stampPlungerPivot, 'clipboard.stampPlunger').plasticGreen;
  stamp.add(parts.stampPlungerPivot);

  // "HOLD INNE" on the grip's top: it goes down with the grip; the top of the words points to the wall, so it reads
  // upright for the visitor standing in front of the counter
  const LB = STAMP_GRIP_LABEL;
  const labelMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.42, metalness: 0, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  labelMat.name = 'decal:stampLabel';
  parts.stampLabel = mesh(ctx, new THREE.PlaneGeometry(LB.w, LB.d), labelMat, 'clipboard.stampLabel');
  parts.stampLabel.rotation.x = -Math.PI / 2;
  parts.stampLabel.position.set(0, 0.0003, 0);
  parts.stampLabel.castShadow = false;
  parts.stampPlungerPivot.add(parts.stampLabel);
  if (typeof document !== 'undefined' && document.createElement) {
    const [cw, ch] = LB.canvas;
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const print = () => {
      const g = canvas.getContext('2d');
      g.clearRect(0, 0, cw, ch);
      g.strokeStyle = LB.ink; // the label's frame
      g.lineWidth = 10;
      g.beginPath();
      g.roundRect(8, 8, cw - 16, ch - 16, 44);
      g.stroke();
      paintLines(g, stampGripLayout(canvasMeasure(g)).lines);
      tex.needsUpdate = true;
    };
    print();
    // printed before the room's font had arrived? print it again once it has
    const fonts = document.fonts;
    if (fonts && fonts.check && fonts.load && !fonts.check("800 80px 'Exhibit Sans'")) {
      fonts.load("800 80px 'Exhibit Sans'").then((got) => { if (got && got.length) print(); }).catch(() => {});
    }
    labelMat.map = tex;
    labelMat.needsUpdate = true;
  } else {
    parts.stampLabel.visible = false; // no canvas here: nothing to print
  }

  group.add(stamp);
  parts.stamp = stamp;
  anchors.stampFoot = anchor('stampFoot', stamp, 0, 0, 0);

  return { group, parts, anchors };
}
