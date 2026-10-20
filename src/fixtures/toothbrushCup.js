// A matt ceramic toothbrush cup (7.4 cm across, 10 cm high) with three toothbrushes: two adults' and a child's, whose
// handle carries a tiny dinosaur - a household lives here (research/inventory-dry.md 20.2: an easter egg without
// words). A brush can be pulled out to be looked at (scene/toothbrushWiring.js): it slides up out of the cup along its
// own lean, then stands upright a hand's breadth in front of the cup, its bristles turned to the visitor; and back.
// Placement: LAYOUT has no spot for it, so it stands beside the soap dispenser (LAYOUT.vanity.counter.soap + 12 cm
// toward the basin, 2 cm toward the wall); pass { x, z } to move it.
// Two draw calls: the cup (the room's matt ceramic) and the three brushes (one mesh: the handles, the bristles and the
// dinosaur take their colours from a small palette texture). A brush's vertices follow its pivot (poseBrush), so a
// brush in motion costs no draw call of its own.
//
// createToothbrushCup(ctx, { x, z })
// parts: cup, brushes (the three brushes, one mesh; subpartAt() names a brush 'brush0'..'brush2'), brush0Pivot ..
//   brush2Pivot (each at its brush's foot, turned as the brush stands - not the identity, unlike other pivots; joint: a
//   slide along the brush's own axis, 0 .. BRUSH_MOTION.pull, the first part of pulling it out).
// anchors: rim (centre of the opening; pour water here), bottom (centre of the inside floor).
// methods: poseBrush(i, t, yaw) (t 0 = in the cup, 1 = held up in front of it, its front turned to yaw: radians about
//   y, 0 = toward the room), brushAt(hit) (the brush a raycast hit on the brushes' mesh, or -1).
// brushPieces[i]: the names of brush i's pieces ('handle', 'bristles', 'bristleRow', and 'dino' on the child's).
import * as THREE from 'three';
import { mesh, anchor, pivot, lathe, smooth, seg, loftGeometry, mergeGeometries, setJoint, subpartAt } from './util.js';
import { counterTop } from './vanity.js';

export const CUP_DIMS = { radius: 0.037, height: 0.1, offset: [0.12, -0.02] };
const H = CUP_DIMS.height;
const DEG = Math.PI / 180;

// The cup's inside wall, from the rim down to the middle of its floor: [r, y] from the cup's foot.
const INNER = [[0.0338, H - 0.0012], ...smooth([[0.0335, H - 0.004], [0.0332, 0.06], [0.0322, 0.025], [0.029, 0.0125], [0.02, 0.0105], [0, 0.01]], 10)];

// The radius of the cup's inside at height y over its foot (0 under its floor).
export function cupInnerRadius(y) {
  if (y >= INNER[0][1]) return INNER[0][0];
  for (let i = 0; i < INNER.length - 1; i++) {
    const [r0, y0] = INNER[i];
    const [r1, y1] = INNER[i + 1];
    if ((y <= y0 && y >= y1) || (y >= y0 && y <= y1)) return y0 === y1 ? Math.max(r0, r1) : r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return 0;
}

// The brushes as they are made: the length; the section along it ([s, hx, hz]: metres from the handle's foot, half
// the width, half the thickness; the bristles stand on the front, +z); where the head's bristles start and end
// (`head`, along s), their height. Colours are BRUSH_PALETTE indices.
const ADULT = {
  len: 0.19,
  section: [
    [0, 0, 0], [0.002, 0.0045, 0.0035], [0.008, 0.0062, 0.0046], [0.03, 0.0068, 0.005], [0.07, 0.0068, 0.005],
    [0.095, 0.0062, 0.0046], [0.118, 0.0042, 0.0034], [0.134, 0.0029, 0.0025], [0.148, 0.0029, 0.0025],
    [0.158, 0.0048, 0.0028], [0.165, 0.0056, 0.003], [0.182, 0.0055, 0.003], [0.188, 0.0042, 0.0025], [0.19, 0, 0],
  ],
  head: [0.16, 0.187],
  bristleH: 0.011,
};
const CHILD = {
  len: 0.145,
  section: [
    [0, 0, 0], [0.002, 0.0052, 0.004], [0.008, 0.0072, 0.0054], [0.025, 0.0078, 0.006], [0.06, 0.0078, 0.006],
    [0.08, 0.007, 0.0055], [0.095, 0.0045, 0.0038], [0.105, 0.0032, 0.0028], [0.115, 0.0032, 0.0028],
    [0.121, 0.0044, 0.0029], [0.128, 0.0048, 0.003], [0.141, 0.0047, 0.003], [0.144, 0.0036, 0.0024], [0.145, 0, 0],
  ],
  head: [0.123, 0.142],
  bristleH: 0.009,
};
// white and grey handles, white bristles (one brush with a blue row), the child's yellow with pink, a green dinosaur
export const BRUSH_PALETTE = ['#efeee9', '#aab0ae', '#f6f6f3', '#4f86b8', '#ecc75c', '#5f9b3f', '#e58ba6'];
// Three brushes in the cup: where each foot stands on the cup's floor (x, z from its middle), the way it leans
// (`toward`: degrees from the room's side, +z, toward +x), which way its bristles face (out of the cup, or in: the
// child's faces in, so its dinosaur never scrapes the rim), and `girth` (its widest half-size below the head).
export const BRUSHES = [
  { key: 'adultWhite', ...ADULT, foot: [-0.01, -0.01], toward: -40, faces: 'out', handle: 0, bristles: [2, 3], girth: 0.0072 },
  { key: 'adultGrey', ...ADULT, foot: [0.011, -0.008], toward: 37, faces: 'out', handle: 1, bristles: [2, 2], girth: 0.0072 },
  {
    key: 'child', ...CHILD, foot: [0, 0.01], toward: 0, faces: 'in', handle: 4, bristles: [2, 6], girth: 0.0088,
    child: true, dino: 5, dinoAt: [0.022, 0.048],
  },
];

export const BRUSH_MOTION = {
  pull: 0.1, // the slide up the brush's own axis: its foot comes up over the rim
  split: 0.45, // the share of the motion that slide takes; then it stands up and turns to the visitor
  present: [0, H + 0.014, 0.105], // where its foot is held then: over the counter, a hand's breadth in front of the cup
  rim: H - 0.0012, // where a brush leans on the cup's inside: the top of its inner wall (a leaning brush is furthest out
  // there: lower down its axis lies further in)
  gap: 0.0006, // and the hair it keeps from it
  footY: 0.0108, // its foot on the cup's floor
};

// A small dinosaur standing on the child's handle, facing up the handle: its outline in mm (x across, y along).
const DINO = [
  [-8, 3], [-6, 5.5], [-4.5, 9], [-3.5, 14], [-2.6, 18.5], [-1.6, 22], [-0.6, 24.6], [1.5, 26], [4.5, 25.8], [7, 24.6],
  [8, 23], [7.2, 21.6], [4.5, 21.2], [2.6, 20], [2.8, 17.6], [5.2, 16.6], [5.4, 15.4], [3.2, 15.2], [3.4, 11],
  [3.6, 7.5], [4.6, 4], [5.6, 0.8], [5.6, 0], [2.2, 0], [2, 3], [0.6, 4.2], [-0.6, 1.2], [-0.6, 0], [-3.8, 0],
  [-3.4, 2.6], [-5.4, 2.4],
];

// The section of a brush at s (interpolated): { hx, hz }.
function sectionAt(b, s) {
  const S = b.section;
  for (let i = 0; i < S.length - 1; i++) {
    if (s >= S[i][0] && s <= S[i + 1][0]) {
      const k = (s - S[i][0]) / (S[i + 1][0] - S[i][0] || 1);
      return { hx: S[i][1] + (S[i + 1][1] - S[i][1]) * k, hz: S[i][2] + (S[i + 1][2] - S[i][2]) * k };
    }
  }
  return { hx: 0, hz: 0 };
}

// How a brush stands in the cup: its foot on the floor, leaning until its side rests on the rim's inside.
function restPose(b) {
  const M = BRUSH_MOTION;
  const phi = b.toward * DEG;
  const d = new THREE.Vector3(Math.sin(phi), 0, Math.cos(phi));
  const [fx, fz] = b.foot;
  const rimR = cupInnerRadius(M.rim);
  // the thickest half of the handle that passes the rim on the way out (on the side it leans to: its back for the
  // child's, whose dinosaur is on its front), as a level cut through the leaning handle shows it
  const hz = Math.max(...b.section.filter(([s]) => s < 0.1).map(([, , z]) => z));
  let lean = 0.2;
  for (let k = 0; k < 5; k++) {
    const target = rimR - hz / Math.cos(lean) - M.gap;
    const p = fx * d.x + fz * d.z;
    const s = -p + Math.sqrt(p * p - (fx * fx + fz * fz - target * target)); // along d to that radius
    lean = Math.atan2(s, M.rim - M.footY);
  }
  const axis = new THREE.Vector3(d.x * Math.sin(lean), Math.cos(lean), d.z * Math.sin(lean));
  const out = d.clone().addScaledVector(axis, -d.dot(axis)).normalize(); // square to the brush, out of the cup
  const front = b.faces === 'in' ? out.clone().negate() : out;
  const x = new THREE.Vector3().crossVectors(axis, front);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, axis, front));
  return { foot: new THREE.Vector3(fx, M.footY, fz), axis, q, lean };
}
const RESTS = BRUSHES.map(restPose);

function paletteTexture() {
  const n = BRUSH_PALETTE.length;
  const data = new Uint8Array(n * 4);
  BRUSH_PALETTE.forEach((hex, i) => {
    for (let c = 0; c < 3; c++) data[i * 4 + c] = parseInt(hex.slice(1 + 2 * c, 3 + 2 * c), 16);
    data[i * 4 + 3] = 255;
  });
  const tex = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// every UV of a piece on one colour of the palette
function paint(geo, colour) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (colour + 0.5) / BRUSH_PALETTE.length, 0.5);
  return geo;
}

// One brush in its own frame: its foot at the origin, its axis +y, its front (the bristles) +z, its width along x.
function brushGeometry(ctx, b) {
  const N = seg(ctx, 10);
  const rings = b.section.map(([s, hx, hz]) => {
    const ring = [];
    for (let k = 0; k < N; k++) { const a = (k / N) * Math.PI * 2; ring.push([Math.cos(a) * hx, s, Math.sin(a) * hz]); }
    return ring;
  });
  const pieces = [paint(loftGeometry(rings), b.handle)];
  const names = ['handle'];
  // the bristles on the head's front: a block, and a row through its middle a hair proud of it (its own colour)
  const [h0, h1] = b.head;
  const mid = sectionAt(b, (h0 + h1) / 2);
  const bw = 2 * mid.hx * 0.84;
  const z0 = mid.hz - 0.0008; // rooted a little into the head
  pieces.push(paint(new THREE.BoxGeometry(bw, h1 - h0, b.bristleH).translate(0, (h0 + h1) / 2, z0 + b.bristleH / 2), b.bristles[0]));
  names.push('bristles');
  pieces.push(paint(new THREE.BoxGeometry(bw + 0.0004, (h1 - h0) * 0.36, b.bristleH + 0.0004).translate(0, (h0 + h1) / 2, z0 + b.bristleH / 2 + 0.0002), b.bristles[1]));
  names.push('bristleRow');
  if (b.dino != null) {
    // moulded on the grip's front: its back sunk into the handle, its face 2.5 mm proud of it
    const [s0, s1] = b.dinoAt;
    const k = (s1 - s0) / 26; // metres per mm of the outline, along the handle
    const shape = new THREE.Shape(DINO.map(([x, y]) => new THREE.Vector2(x * k * 0.75, y * k)));
    const hz = sectionAt(b, (s0 + s1) / 2).hz;
    const back = hz * 0.35;
    const g = new THREE.ExtrudeGeometry(shape, { depth: hz + 0.0025 - back, bevelEnabled: false, curveSegments: 1 });
    pieces.push(paint(g.translate(0, s0, back), b.dino));
    names.push('dino');
  }
  const geo = mergeGeometries(pieces);
  for (const p of pieces) p.dispose();
  return { geo, names };
}

const sineInOut = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

export function createToothbrushCup(ctx, opts = {}) {
  const L = ctx.layout;
  const S = L.vanity.counter.soap;
  const D = CUP_DIMS;
  const M = BRUSH_MOTION;
  const group = new THREE.Group();
  group.name = 'toothbrushCup';
  group.position.set(opts.x ?? S.x + D.offset[0], counterTop(L), opts.z ?? S.z + D.offset[1]);
  const parts = {};
  const anchors = {};

  const profile = [
    [0, 0], [0.031, 0], [0.0335, 0.0012],
    ...smooth([[0.0345, 0.004], [0.0355, 0.04], [0.0365, 0.08], [0.037, 0.097]], 10),
    [0.0368, H - 0.0012], [0.036, H], [0.0346, H], ...INNER,
  ];
  parts.cup = mesh(ctx, lathe(profile, seg(ctx, 40)), 'ceramicMatt', 'toothbrushCup.cup');
  group.add(parts.cup);

  // --- the three brushes: one mesh, each brush's vertices placed by its pivot
  const built = [];
  const list = [];
  const subparts = [];
  const brushPieces = [];
  let v0 = 0;
  let t0 = 0;
  for (const [i, b] of BRUSHES.entries()) {
    const { geo: g, names } = brushGeometry(ctx, b);
    const count = g.attributes.position.count;
    const tris = g.index.count / 3;
    built.push({ start: v0, count, pos: Float32Array.from(g.attributes.position.array), nor: Float32Array.from(g.attributes.normal.array) });
    subparts.push({ name: `brush${i}`, start: t0, count: tris });
    brushPieces.push(names);
    list.push(g);
    v0 += count;
    t0 += tris;
  }
  const geo = mergeGeometries(list);
  for (const g of list) g.dispose();
  geo.attributes.position.setUsage(THREE.DynamicDrawUsage);
  geo.attributes.normal.setUsage(THREE.DynamicDrawUsage);
  const brushMat = new THREE.MeshStandardMaterial({ map: paletteTexture(), roughness: 0.38, metalness: 0 });
  brushMat.name = 'decal:toothbrushes';
  parts.brushes = mesh(ctx, geo, brushMat, 'toothbrushCup.brushes');
  parts.brushes.userData.subparts = subparts;
  group.add(parts.brushes);
  for (const [i, r] of RESTS.entries()) {
    const p = pivot(`brush${i}Pivot`, r.foot.x, r.foot.y, r.foot.z, { type: 'slide', axis: r.axis.toArray(), min: 0, max: M.pull });
    p.quaternion.copy(r.q);
    group.add(p);
    parts[`brush${i}Pivot`] = p;
  }

  // brush i's vertices and normals to where its pivot holds it
  function syncBrush(i) {
    const b = built[i];
    const p = parts[`brush${i}Pivot`];
    p.updateMatrix();
    const e = p.matrix.elements;
    const P = geo.attributes.position.array;
    const Nn = geo.attributes.normal.array;
    for (let k = 0; k < b.count; k++) {
      const x = b.pos[k * 3];
      const y = b.pos[k * 3 + 1];
      const z = b.pos[k * 3 + 2];
      const nx = b.nor[k * 3];
      const ny = b.nor[k * 3 + 1];
      const nz = b.nor[k * 3 + 2];
      const o = (b.start + k) * 3;
      P[o] = e[0] * x + e[4] * y + e[8] * z + e[12];
      P[o + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      P[o + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      Nn[o] = e[0] * nx + e[4] * ny + e[8] * nz;
      Nn[o + 1] = e[1] * nx + e[5] * ny + e[9] * nz;
      Nn[o + 2] = e[2] * nx + e[6] * ny + e[10] * nz;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.computeBoundingSphere(); // (raycasts and the camera's culling use it)
    geo.computeBoundingBox();
  }

  // Brush i at t along its way out (0 in the cup .. 1 held up in front of it, turned to yaw). First it slides up its
  // own axis until its foot is over the rim; then it comes out toward the visitor before it rises, and stands up and
  // turns as it goes, so its head never reaches under the mirror cabinet.
  const present = new THREE.Vector3(...M.present);
  const pulled = new THREE.Vector3();
  const facing = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);
  function poseBrush(i, t, yaw = 0) {
    const r = RESTS[i];
    const p = parts[`brush${i}Pivot`];
    const k = Math.min(1, Math.max(0, t));
    setJoint(p, M.pull * (k >= M.split ? 1 : sineInOut(k / M.split)));
    p.quaternion.copy(r.q);
    if (k > M.split) {
      const c = (k - M.split) / (1 - M.split);
      const out = 1 - (1 - c) ** 3; // out first ...
      const up = c * c * (3 - 2 * c); // ... then up and round
      pulled.copy(r.foot).addScaledVector(r.axis, M.pull);
      p.position.set(pulled.x + (present.x - pulled.x) * out, pulled.y + (present.y - pulled.y) * up, pulled.z + (present.z - pulled.z) * out);
      p.quaternion.slerp(facing.setFromAxisAngle(UP, yaw), up);
    }
    syncBrush(i);
  }
  for (let i = 0; i < BRUSHES.length; i++) syncBrush(i);

  anchors.rim = anchor('rim', group, 0, H, 0);
  anchors.bottom = anchor('bottom', group, 0, 0.01, 0);

  const brushAt = (hit) => {
    if (!hit || hit.object !== parts.brushes || hit.faceIndex == null) return -1;
    const name = subpartAt(parts.brushes, hit.faceIndex);
    return name ? Number(name.slice(5)) : -1;
  };
  return { group, parts, anchors, poseBrush, brushAt, brushPieces, brushCount: BRUSHES.length };
}
