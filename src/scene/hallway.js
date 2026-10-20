// The hallway outside the bathroom door, where the visit starts: painted walls, an oak floor, one ceiling light, and the
// crew's trolley with a delivery box (this version: the toilet you could choose instead). Not part of the light bake:
// lit live by its own lamp and the environment.
// Words here: the doormat (the only instructions in the visit, readable from the start view), the delivery sheet lying
// on the box (the other toilet, what choosing it does to the price, with the price's legal label) and the product name
// printed on the box's side. Their layout is pure and tested with the real fonts (tests/hallway.test.js).
import * as THREE from 'three';
import { flowText, fixedLine, paintLines, canvasMeasure, INK, INK_SOFT, GREEN } from '../systems/paper.js';
import { OPTIONS } from '../data/prices.js';
import { formatKr } from '../systems/price.js';
import { DOORMAT, PRICE_TEXT } from '../data/texts.js';

// ---------------------------------------------------------------------------------------------------------------
// The doormat: a coir mat (90 x 50 cm) in front of the door, its words woven in. canvas = the mat's top face.
export const DOORMAT_DIMS = { w: 0.9, h: 0.5, t: 0.012, canvas: [1152, 640] };

export function matPlacement(L) {
  const Dr = L.door;
  const z0 = L.room.D + 0.12;
  return { position: [(Dr.x0 + Dr.x1) / 2, DOORMAT_DIMS.t, z0 + 0.3], rotation: [-Math.PI / 2, 0, 0], order: 'XYZ' };
}

export function doormatLayout(measure) {
  const [Wc, Hc] = DOORMAT_DIMS.canvas;
  const ink = 'rgba(38,28,18,0.9)';
  const sizes = [80, 72, 72, 60];
  return flowText([
    { text: DOORMAT.title, size: 96, weight: 800, color: ink, align: 'center', tag: 'title' },
    ...DOORMAT.lines.map((t, i) => ({ text: t, size: sizes[i] ?? 60, weight: i === 0 ? 700 : 650, color: ink, align: 'center', gap: i === 0 ? 22 : 2, tag: 'line' })),
  ], measure, { x: 70, w: Wc - 140, top: 64, bottom: Hc - 60 });
}

// ---------------------------------------------------------------------------------------------------------------
// The delivery box. Its delivery sheet lies on the box's top, nearly as big as the top, so a visitor who walks up to
// the trolley reads it looking down; the side facing the hallway carries the product name in big print.
export const LABEL_DIMS = { w: 0.56, h: 0.38, canvas: [1024, 695] };
export const SIDE_PRINT_DIMS = { w: 0.58, h: 0.4, canvas: [1024, 706] };
const BOX = { w: 0.42, h: 0.5, d: 0.62, deckTop: 0.1725, z: -0.04 };

export function labelPlacement(L) {
  const T = L.hallway.trolley;
  // flat on the box (over the tape), its top edge away from the hallway, turned a little toward the start spot
  return { position: [T.x, BOX.deckTop + BOX.h + 0.003, T.z + BOX.z], rotation: [-Math.PI / 2, Math.PI / 2 - 0.05, 0], order: 'YXZ' };
}

export function sidePrintPlacement(L) {
  const T = L.hallway.trolley;
  return { position: [T.x + BOX.w / 2 + 0.0012, BOX.deckTop + BOX.h / 2, T.z + BOX.z], rotation: [0, Math.PI / 2, 0], order: 'XYZ' };
}

const otherToilet = (installed) => (installed === 'vegghengt' ? 'gulvstaaende' : 'vegghengt');

// What choosing the box's toilet does to the range, against the toilet standing in the room now: [low, high] in kr.
export function deliveryDelta(installed) {
  const C = OPTIONS.toilet.choices;
  const now = C[installed].delta;
  const then = C[otherToilet(installed)].delta;
  return [then[0] - now[0], then[1] - now[1]].sort((a, b) => a - b);
}

const kr = (n) => formatKr(Math.abs(n));
function deltaText([a, b]) {
  if (a === 0 && b === 0) return 'Samme prisantydning';
  if (b <= 0) return `Rimeligere: ca. ${kr(b)} – ${kr(a)} kr`;
  if (a >= 0) return `Tillegg: ca. ${kr(a)} – ${kr(b)} kr`;
  return `Mellom ca. ${kr(a)} kr rimeligere og ${kr(b)} kr dyrere`;
}

export function deliveryLabelText(installed) {
  const opt = OPTIONS.toilet.choices[otherToilet(installed)];
  return {
    header: 'LEVERANSE · EKSEMPEL',
    title: opt.label,
    delta: deltaText(deliveryDelta(installed)),
    compare: 'sammenlignet med toalettet i badet nå', // reads with "Rimeligere: …" and "Tillegg: …" alike
    why: opt.why,
    legal: `${PRICE_TEXT.label}\n${PRICE_TEXT.vatDate}`,
    cta: 'Heller denne? Trykk på esken.',
    trader: PRICE_TEXT.trader,
  };
}

// "EKSEMPEL" (in the header, at the sheet's far edge as the visitor stands at the trolley) and the price's legal line
// are never smaller than the body text: at least the papers' reading floor (systems/paper.js PAPER_MIN_PX), and the
// header a little more, since the far edge of a sheet lying flat reads smaller (tests/hallway.test.js measures both).
export function deliveryLabelLayout(installed, measure) {
  const t = deliveryLabelText(installed);
  const [Wc] = LABEL_DIMS.canvas;
  const headerH = 96;
  const lines = [fixedLine(t.header, { x: 44, y: 68, size: 52, weight: 700, color: '#ffffff', tag: 'header' }, measure)];
  const body = flowText([
    { text: t.title, size: 84, weight: 800, color: '#282827', tag: 'title' },
    { text: t.delta, size: 56, weight: 700, color: INK, gap: 2, tag: 'delta' },
    { text: t.compare, size: 42, weight: 450, color: INK_SOFT, tag: 'compare' },
    { text: t.why, size: 42, weight: 450, color: INK, gap: 10, tag: 'why' },
    { text: t.legal, size: 46, weight: 500, color: INK, gap: 10, tag: 'legal' },
    { text: t.cta, size: 56, weight: 760, color: '#282827', gap: 14, tag: 'cta' },
    { text: t.trader, size: 38, weight: 450, color: INK_SOFT, gap: 8, tag: 'trader' },
  ], measure, { x: 44, w: Wc - 88, top: headerH + 16, bottom: LABEL_DIMS.canvas[1] - 20 });
  lines.push(...body.lines);
  return { lines, fits: body.fits, scale: body.scale, header: { h: headerH } };
}

export function sidePrintLayout(installed, measure) {
  const words = OPTIONS.toilet.choices[otherToilet(installed)].label.toUpperCase().split(' ');
  const [Wc, Hc] = SIDE_PRINT_DIMS.canvas;
  return flowText(words.map((w) => ({ text: w, size: 116, weight: 800, color: 'rgba(36,27,20,0.86)', align: 'center', tag: 'print' })),
    measure, { x: 40, w: Wc - 80, top: (Hc - words.length * 116 * 1.21) / 2, bottom: Hc - 20 });
}

function placeMesh(mesh, place, parentWorld) {
  // place is in room coordinates; the trolley group only translates, so subtract its position
  mesh.position.set(place.position[0] - parentWorld.x, place.position[1] - parentWorld.y, place.position[2] - parentWorld.z);
  mesh.rotation.set(place.rotation[0], place.rotation[1], place.rotation[2], place.order);
}

function scaleUV(geo, k) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k);
  uv.needsUpdate = true;
  return geo;
}

function plane(w, h, texM) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / texM, (uv.getY(i) * h) / texM);
  return g;
}

export function createHallway(ctx, { mood = {} } = {}) {
  const { materials, layout: L } = ctx;
  const group = new THREE.Group();
  group.name = 'hallway';
  const { W, D, H } = L.room;
  const wallT = 0.12;
  const z0 = D + wallT;
  const z1 = D + L.hallway.depth;
  const x0 = -0.3;
  const x1 = W + 0.3;
  const paint = materials.get('paint');
  const oak = materials.get('oak');
  const PAINT_M = 2.0;
  const OAK_M = 1.83;
  const parts = {};

  // floor (oak), ceiling (paint)
  const floor = new THREE.Mesh(plane(x1 - x0, z1 - z0 + wallT, OAK_M), oak);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((x0 + x1) / 2, 0, (z0 - wallT + z1) / 2);
  floor.userData.knock = 'wood';
  const ceiling = new THREE.Mesh(plane(x1 - x0, z1 - z0, PAINT_M), paint);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set((x0 + x1) / 2, H, (z0 + z1) / 2);
  ceiling.userData.knock = 'paint';

  // the wall with the bathroom door, seen from the hallway (faces +z), with the door opening cut out
  const Dr = L.door;
  const shape = new THREE.Shape();
  shape.moveTo(x0, 0); shape.lineTo(Dr.x0, 0); shape.lineTo(Dr.x0, Dr.height); shape.lineTo(Dr.x1, Dr.height);
  shape.lineTo(Dr.x1, 0); shape.lineTo(x1, 0); shape.lineTo(x1, H); shape.lineTo(x0, H); shape.lineTo(x0, 0);
  const doorWall = new THREE.Mesh(scaleUV(new THREE.ShapeGeometry(shape), 1 / PAINT_M), paint);
  doorWall.position.z = z0;
  doorWall.userData.knock = 'paint';
  const back = new THREE.Mesh(plane(x1 - x0, H, PAINT_M), paint);
  back.rotation.y = Math.PI;
  back.position.set((x0 + x1) / 2, H / 2, z1);
  back.userData.knock = 'paint';
  const left = new THREE.Mesh(plane(z1 - z0, H, PAINT_M), paint);
  left.rotation.y = Math.PI / 2;
  left.position.set(x0, H / 2, (z0 + z1) / 2);
  left.userData.knock = 'paint';
  const right = new THREE.Mesh(plane(z1 - z0, H, PAINT_M), paint);
  right.rotation.y = -Math.PI / 2;
  right.position.set(x1, H / 2, (z0 + z1) / 2);
  right.userData.knock = 'paint';
  // skirting boards (painted wood) along the three hallway walls and both sides of the door
  const skirt = materials.get('enamelWhite');
  const sk = (w, x, z, ry) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, 0.012), skirt);
    m.position.set(x, 0.035, z);
    m.rotation.y = ry;
    m.userData.knock = 'wood';
    return m;
  };
  group.add(floor, ceiling, doorWall, back, left, right,
    sk(Dr.x0 - x0 - 0.06, (x0 + Dr.x0 - 0.06) / 2, z0 + 0.006, 0),
    sk(x1 - Dr.x1 - 0.06, (x1 + Dr.x1 + 0.06) / 2, z0 + 0.006, 0),
    sk(x1 - x0, (x0 + x1) / 2, z1 - 0.006, 0),
    sk(z1 - z0, x0 + 0.006, (z0 + z1) / 2, Math.PI / 2),
    sk(z1 - z0, x1 - 0.006, (z0 + z1) / 2, Math.PI / 2));
  parts.floor = floor;
  parts.walls = [doorWall, back, left, right, ceiling];

  // the doormat in front of the bathroom door: coir, with the only instructions in the whole visit woven into it
  const [MW, MH] = DOORMAT_DIMS.canvas;
  const matCanvas = document.createElement('canvas');
  matCanvas.width = MW;
  matCanvas.height = MH;
  const matTex = new THREE.CanvasTexture(matCanvas);
  matTex.colorSpace = THREE.SRGBColorSpace;
  matTex.anisotropy = 8;
  function drawMat() {
    const mg = matCanvas.getContext('2d');
    mg.fillStyle = '#8b6a3e';
    mg.fillRect(0, 0, MW, MH);
    for (let i = 0; i < 29000; i++) { // coir fibres: short strokes in browns
      const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const y = (Math.sin(i * 78.233) * 12543.1234) % 1;
      const s = (Math.sin(i * 3.17) * 9871.31) % 1;
      mg.strokeStyle = `rgba(${s > 0 ? 160 : 90},${s > 0 ? 120 : 64},${s > 0 ? 70 : 34},0.35)`;
      mg.lineWidth = 1.4;
      mg.beginPath();
      const px = Math.abs(x) * MW;
      const py = Math.abs(y) * MH;
      mg.moveTo(px, py);
      mg.lineTo(px + s * 6, py + 5);
      mg.stroke();
    }
    mg.strokeStyle = 'rgba(40,30,20,0.85)';
    mg.lineWidth = 14;
    mg.strokeRect(34, 34, MW - 68, MH - 68);
    paintLines(mg, doormatLayout(canvasMeasure(mg)).lines);
    matTex.needsUpdate = true;
  }
  drawMat();
  // woven before the room's font had arrived? weave it again once it has
  const fonts = typeof document !== 'undefined' ? document.fonts : null;
  if (fonts && fonts.check && fonts.load && !fonts.check("700 80px 'Exhibit Sans'")) {
    fonts.load("700 80px 'Exhibit Sans'").then((got) => { if (got && got.length) drawMat(); }).catch(() => {});
  }
  const doormat = new THREE.Mesh(new THREE.BoxGeometry(DOORMAT_DIMS.w, DOORMAT_DIMS.t, DOORMAT_DIMS.h), [
    materials.get('rubber'), materials.get('rubber'),
    new THREE.MeshStandardMaterial({ map: matTex, roughness: 1, metalness: 0 }),
    materials.get('rubber'), materials.get('rubber'), materials.get('rubber'),
  ]);
  const mp = matPlacement(L);
  doormat.position.set(mp.position[0], DOORMAT_DIMS.t / 2, mp.position[2]); // the box's top face is the placed face
  doormat.userData.knock = 'wood';
  group.add(doormat);
  parts.doormat = doormat;

  // one ceiling lamp, at the bake's downlight strength
  const lamp = (mood.lights || []).find((l) => l.type === 'spot');
  const exposure = mood.exposure ?? 1;
  const light = new THREE.SpotLight(0xffd9a8, lamp ? lamp.threeIntensity * exposure * 1.3 : 3, 0, 1.0, 0.7, 2);
  light.position.set(1.4, H - 0.03, (z0 + z1) / 2);
  light.target.position.set(1.4, 0, (z0 + z1) / 2);
  const trim = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 32), materials.get('brushedSteel'));
  trim.position.set(1.4, H - 0.004, (z0 + z1) / 2);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.032, 32), new THREE.MeshBasicMaterial({ color: 0xfff0d8, toneMapped: false }));
  lens.rotation.x = Math.PI / 2;
  lens.position.set(1.4, H - 0.0105, (z0 + z1) / 2);
  group.add(light, light.target, trim, lens);

  // the crew's trolley: a plywood deck on four castors, a steel push handle
  const T = L.hallway.trolley;
  const trolley = new THREE.Group();
  trolley.name = 'trolley';
  trolley.position.set(T.x, 0, T.z);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.025, 0.78), oak);
  deck.position.y = 0.16;
  deck.userData.knock = 'wood';
  trolley.add(deck);
  const rubber = materials.get('rubber');
  const steel = materials.get('brushedSteel');
  for (const [cx, cz] of [[-0.2, -0.33], [0.2, -0.33], [-0.2, 0.33], [0.2, 0.33]]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 20), rubber);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(cx, 0.05, cz);
    const fork = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.03), steel);
    fork.position.set(cx, 0.115, cz);
    trolley.add(wheel, fork);
  }
  for (const sx of [-0.22, 0.22]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.8, 12), steel);
    post.position.set(sx, 0.57, 0.37);
    post.userData.knock = 'metal';
    trolley.add(post);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.46, 12), steel);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 0.97, 0.37);
  bar.userData.knock = 'metal';
  trolley.add(bar);

  // the delivery box: a sheet lying on its top (read by a visitor who walks up to the trolley) and the product name
  // printed on the side facing the hallway
  const canvasTex = ([w, h]) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return { c, t };
  };
  const sheet = canvasTex(LABEL_DIMS.canvas);
  const print = canvasTex(SIDE_PRINT_DIMS.canvas);
  const card = materials.get('cardboard');
  const box = new THREE.Mesh(new THREE.BoxGeometry(BOX.w, BOX.h, BOX.d), card);
  box.position.set(0, BOX.deckTop + BOX.h / 2, BOX.z);
  box.userData.knock = 'wood';
  const labelMat = materials.get('paper').clone();
  labelMat.map = sheet.t;
  labelMat.color.set(0xffffff);
  const label = new THREE.Mesh(new THREE.PlaneGeometry(LABEL_DIMS.w, LABEL_DIMS.h), labelMat);
  placeMesh(label, labelPlacement(L), trolley.position);
  const printMat = new THREE.MeshStandardMaterial({
    map: print.t, transparent: true, roughness: 0.95, metalness: 0, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const sidePrint = new THREE.Mesh(new THREE.PlaneGeometry(SIDE_PRINT_DIMS.w, SIDE_PRINT_DIMS.h), printMat);
  placeMesh(sidePrint, sidePrintPlacement(L), trolley.position);
  // packing tape over the top
  const tape = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.002, BOX.d + 0.002), materials.get('plasticGrey'));
  tape.position.set(0, BOX.deckTop + BOX.h + 0.001, BOX.z);
  trolley.add(box, label, sidePrint, tape);
  group.add(trolley);
  parts.trolley = trolley;
  parts.deliveryBox = box;
  parts.deliveryLabel = label;
  parts.deliveryPrint = sidePrint;

  // The sheet shows the toilet that is NOT in the room now, and what choosing it does to the price against the one in
  // the room: choosing it swaps them.
  function drawLabel(installed) {
    const g = sheet.c.getContext('2d');
    const [w, h] = LABEL_DIMS.canvas;
    const lay = deliveryLabelLayout(installed, canvasMeasure(g));
    g.fillStyle = '#f7f5ef';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#282827';
    g.fillRect(0, 0, w, lay.header.h);
    const cta = lay.lines.find((l) => l.tag === 'cta');
    if (cta) { g.fillStyle = GREEN; g.fillRect(44, cta.y - cta.size * 1.18, w - 88, 5); }
    paintLines(g, lay.lines);
    sheet.t.needsUpdate = true;
    const p = print.c.getContext('2d');
    p.clearRect(0, 0, print.c.width, print.c.height);
    paintLines(p, sidePrintLayout(installed, canvasMeasure(p)).lines);
    print.t.needsUpdate = true;
  }

  return { group, parts, drawLabel };
}
