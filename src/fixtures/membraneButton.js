// The "Membran" button: the room's "see behind the tiles" switch, on the back wall right of the vanity, so the
// visitor pressing it faces the shower and the floor where the membrane shows. A white push button in a bezel on a
// white plate, like the room's other switches (the owner, 2026-10-19: "sockets yellow, ugly, should be white"; it was
// brass); "MEMBRAN" and "Se bak flisene" are engraved under it (dark filled engraving). White on the light tiles the
// round button nearly disappeared (the look, 2026-10-19), so its bezel's face is a light grey ring with a soft shadow
// round its foot on the plate: painted in the engraving's own decal, it costs no draw call of its own.
// Placement: LAYOUT.membraneButton (wall, x, y = the button's centre). Local frame = the wall's frame (util.js).
//
// createMembraneButton(ctx, {})
// parts: plate (white plate + bezel, one mesh), pivot (slides into the wall, 0..0.004 m) + button, label (the decal:
//   the engraved words on a plane, and the bezel's ring and shadow over the bezel and the plate, userData.subparts
//   'engraving' and 'ring'; a canvas texture and per-vertex colour with opacity; hidden where there is no canvas, as in
//   the headless tests).
// anchors: button (front centre of the button).
import * as THREE from 'three';
import { mesh, pivot, anchor, placeOnWall, createBuilder, M, lathe, RoundedBox, seg, mergeGeometries } from './util.js';
import { flowText, paintLines, canvasMeasure } from '../systems/paper.js';

export const MEMBRANE_BUTTON_DIMS = {
  plate: { w: 0.096, h: 0.135, t: 0.006, below: 0.093 }, // the plate reaches 4.2 cm above the button and 9.3 cm below
  button: { r: 0.019, travel: 0.004 },
  buttonOut: 0.006, // the button's pivot stands this far in front of the plate's face
  // the bezel round the button: its profile outside the button's radius, [r beyond it, z over the plate's face] (m)
  bezel: [[0.0045, 0], [0.0045, 0.002], [0.0025, 0.003], [0.0008, 0.003], [0.0008, -0.002]],
  // the engraved field: 10 canvas px per mm; under it in the same canvas a clear spacer and an opaque white band (rows)
  // that the ring's colours are drawn on
  label: { w: 0.09, h: 0.052, y: -0.061, canvas: [900, 520], spacer: 32, band: 64 },
  // the ring: 0.2 mm in front of the bezel's face and the plate, outermost first, [r beyond the button's radius, z over
  // the plate's face, shade, opacity]: the soft shadow round the bezel's foot (fading out over 4 mm) and the bezel's
  // face a light grey (sRGB colours)
  ring: {
    shadow: 0x2b2926,
    grey: 0xc0bfbb,
    points: [
      [0.0085, 0.0002, 'shadow', 0], [0.0063, 0.0002, 'shadow', 0.14], [0.0047, 0.0002, 'shadow', 0.38],
      [0.0047, 0.0021, 'grey', 1], [0.0026, 0.0032, 'grey', 1], [0.0008, 0.0032, 'grey', 1],
    ],
  },
};

// The decal's geometry in the button's frame: the engraved field (a plane under the button, its picture above the
// canvas's band) and the ring (a lathe round the button over the bezel and the plate, its picture the opaque band, its
// shades per vertex). Every vertex carries a colour with opacity (white and opaque on the engraving).
function decalGeometry(ctx) {
  const D = MEMBRANE_BUTTON_DIMS;
  const L = D.label;
  const R = D.button.r;
  const ft = D.plate.t;
  const H = L.canvas[1] + L.spacer + L.band;
  const plane = new THREE.PlaneGeometry(L.w, L.h);
  plane.translate(0, L.y, ft + 0.0003);
  const pu = plane.attributes.uv;
  const vField = (L.band + L.spacer) / H;
  for (let i = 0; i < pu.count; i++) pu.setY(i, vField + pu.getY(i) * (1 - vField));
  const P = D.ring.points;
  const ring = lathe(P.map(([r, z]) => [R + r, z]), seg(ctx, 40)).rotateX(Math.PI / 2).translate(0, 0, ft);
  const ru = ring.attributes.uv;
  for (let i = 0; i < ru.count; i++) ru.setXY(i, 0.5, L.band / 2 / H);
  const geo = mergeGeometries([plane, ring]);
  const tint = { shadow: new THREE.Color(D.ring.shadow), grey: new THREE.Color(D.ring.grey) }; // (linear, as the shader reads them)
  const col = new Float32Array(geo.attributes.position.count * 4).fill(1);
  const n0 = plane.attributes.position.count;
  for (let i = 0; i < ring.attributes.position.count; i++) {
    const [, , shade, a] = P[i % P.length]; // a lathe lists each turn's profile in order
    col.set([tint[shade].r, tint[shade].g, tint[shade].b, a], (n0 + i) * 4);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
  const t0 = plane.index.count / 3;
  const subparts = [{ name: 'engraving', start: 0, count: t0 }, { name: 'ring', start: t0, count: ring.index.count / 3 }];
  plane.dispose();
  ring.dispose();
  return { geo, subparts, H };
}

// The engraving as laid-out lines (canvas px; 10 px = 1 mm). Tested with the real fonts.
export function membraneEngraving(measure) {
  const [Wc] = MEMBRANE_BUTTON_DIMS.label.canvas;
  const ink = 'rgba(30,23,15,0.92)';
  return flowText([
    { text: 'MEMBRAN', size: 160, weight: 760, color: ink, align: 'center', tag: 'word' },
    { text: 'Se bak flisene', size: 92, weight: 560, color: ink, align: 'center', gap: 14, tag: 'hint' },
  ], measure, { x: 0, w: Wc, top: 40, bottom: MEMBRANE_BUTTON_DIMS.label.canvas[1] - 10 });
}

export function createMembraneButton(ctx, opts = {}) {
  const L = ctx.layout;
  const P = L.membraneButton;
  const D = MEMBRANE_BUTTON_DIMS;
  const group = new THREE.Group();
  group.name = 'membraneButton';
  placeOnWall(group, L, P.wall, P.x, P.y);
  const parts = {};
  const anchors = {};
  const ft = D.plate.t; // the plate's front face
  const R = D.button.r;

  // The plate (its centre below the button, leaving room for the engraving) and the bezel ring around the button.
  const b = createBuilder(ctx);
  const plateCy = (D.plate.h - D.plate.below) - D.plate.h / 2; // the plate's centre, relative to the button's
  b.add('plasticWhite', new RoundedBox(D.plate.w, D.plate.h, D.plate.t, 2, 0.003), M([0, plateCy, D.plate.t / 2]), 'plate');
  b.add('plasticWhite', lathe(D.bezel.map(([r, z]) => [R + r, z]), seg(ctx, 40)).rotateX(Math.PI / 2), M([0, 0, ft]), 'bezel');
  parts.plate = b.build(group, 'membraneButton.plate').plasticWhite;

  // The push button: travels into the wall when pressed.
  parts.pivot = pivot('membraneButtonPivot', 0, 0, ft + D.buttonOut, { type: 'slide', axis: [0, 0, -1], min: 0, max: D.button.travel });
  const btn = lathe([[R, -0.008], [R, -0.0015], [R - 0.0012, -0.0003], [R - 0.004, 0], [0.008, 0.0008], [0, 0.001]], seg(ctx, 40)).rotateX(Math.PI / 2);
  parts.button = mesh(ctx, btn, 'plasticWhite', 'membraneButton.button');
  parts.pivot.add(parts.button);
  group.add(parts.pivot);
  anchors.button = anchor('button', parts.pivot, 0, 0, 0.001);

  // The engraved words and the bezel's ring: one decal just in front of the plate and the bezel, drawn into a canvas
  // (the room's font may arrive after the fixture is built, so it is engraved again once it has).
  const labelMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.55, metalness: 0, transparent: true, depthWrite: false, vertexColors: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  labelMat.name = 'decal:membraneLabel';
  const decal = decalGeometry(ctx);
  parts.label = mesh(ctx, decal.geo, labelMat, 'membraneButton.label');
  parts.label.userData.subparts = decal.subparts;
  parts.label.castShadow = false;
  group.add(parts.label);
  if (typeof document !== 'undefined' && document.createElement) {
    const [cw, ch0] = D.label.canvas;
    const ch = decal.H;
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const engrave = () => {
      const g = canvas.getContext('2d');
      g.clearRect(0, 0, cw, ch);
      paintLines(g, membraneEngraving(canvasMeasure(g)).lines);
      g.fillStyle = '#ffffff'; // the band the ring's shades are drawn on
      g.fillRect(0, ch0 + D.label.spacer, cw, D.label.band);
      tex.needsUpdate = true;
    };
    engrave();
    const fonts = document.fonts;
    if (fonts && fonts.check && fonts.load && !fonts.check("760 80px 'Exhibit Sans'")) {
      fonts.load("760 80px 'Exhibit Sans'").then((got) => { if (got && got.length) engrave(); }).catch(() => {});
    }
    labelMat.map = tex;
    labelMat.needsUpdate = true;
  } else {
    parts.label.visible = false; // no canvas here: nothing to engrave
  }

  return { group, parts, anchors };
}
