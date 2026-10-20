// Shared helpers for the fixture modules: materials, geometry building and merging, pivots (joints), anchors, wall
// frames, counting.
// Units: metres. Room axes (docs/ARCHITECTURE.md): x left -> right, y up, z back wall (0) -> door wall (D).
//
// Wall-local frame used by wall-mounted fixtures: +z points OUT of the wall into the room, +x runs along the wall to the
// right as you face the wall from inside the room, +y is up. placeOnWall() turns that frame into room coordinates.
//
// Joints: every moving part sits under a pivot Group at its real hinge or slide axis. pivot.userData.joint describes it:
//   { type: 'hinge', axis: [x,y,z] (the pivot's own axis), min, max, value }   value = angle in radians
//   { type: 'slide', axis: [x,y,z] (in the parent's frame), min, max, value }   value = metres along the axis
//   { type: 'lever', yaw: { min, max }, pitch: { min, max }, value: [yaw, pitch] } (rotation order 'YXZ')
// setJoint(pivot, value) clamps and applies it; every pivot's rest rotation is identity, so pivot.rotation and
// pivot.position can also be driven directly.
import * as THREE from 'three';
import { RoundedBoxGeometry as RoundedBox } from 'three/addons/geometries/RoundedBoxGeometry.js';

export { RoundedBox };

// Materials this module set needs that materials.js does not have yet. They are asked for in the fixture notes;
// until materials.js holds them, mat() makes one shared instance per material library.
export const REQUESTED_MATERIALS = {
  signalRed: { color: 0xb3261e, roughness: 0.45, metalness: 0 }, // the WC lock's "Opptatt" indicator
  plasticGreen: { color: 0xabc037, roughness: 0.42, metalness: 0 }, // the date stamp body (Straume green, no glow)
  screenBlack: { color: 0x0b0c0d, roughness: 0.1, metalness: 0 }, // the dark glass of a device screen when off
  waterSeal: { color: 0x0d1012, roughness: 0.04, metalness: 0 }, // the still water in the drain's trap, seen through the grate
};

const extraMats = new WeakMap();

export function mat(ctx, name) {
  const lib = ctx.materials;
  if (lib.has(name)) return lib.get(name);
  const def = REQUESTED_MATERIALS[name];
  if (!def) throw new Error(`fixtures: unknown material "${name}"`);
  let cache = extraMats.get(lib);
  if (!cache) {
    cache = new Map();
    extraMats.set(lib, cache);
  }
  if (!cache.has(name)) {
    const m = new THREE.MeshStandardMaterial(def);
    m.name = name;
    cache.set(name, m);
  }
  return cache.get(name);
}

// A per-object material for a canvas texture on a device screen (mirror display, phone, thermostat, washer panel).
// Black + additive blending draws nothing until a system sets .map and turns .color white: glowing pixels only.
export function screenMaterial(name) {
  const m = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  m.name = `screen:${name}`;
  return m;
}

// The default knock for a material (interaction contract: 'tile'|'glass'|'wood'|'metal'|'paint'|'ceramic'), stored as
// mesh.userData.knock. Painted white ('enamelWhite') can be wood, metal or plastic, so fixtures set it per part.
const KNOCK = [
  [/^ceramic|^stoneTop/, 'ceramic'],
  [/^glass|^mirror|^screenBlack/, 'glass'],
  [/^oak|^cardboard/, 'wood'],
  [/^tile|^mosaic|^grout/, 'tile'],
  [/^paint|^concrete/, 'paint'],
  [/chrome|brushed|brass|Steel|matteBlack|^copper/i, 'metal'],
];
export function knockFor(materialName) {
  for (const [re, k] of KNOCK) if (re.test(materialName)) return k;
  return undefined;
}

export function seg(ctx, n) {
  return ctx.quality === 'low' ? Math.max(6, Math.round(n * 0.66)) : n;
}

export function glassName(ctx) {
  return ctx.quality === 'low' ? 'glassSimple' : 'glass';
}

// ---------- meshes, pivots, anchors ----------
export function mesh(ctx, geometry, materialName, name) {
  const m = new THREE.Mesh(geometry, typeof materialName === 'string' ? mat(ctx, materialName) : materialName);
  m.name = name || '';
  m.castShadow = true;
  m.receiveShadow = true;
  const mn = typeof materialName === 'string' ? materialName : materialName.name;
  const k = knockFor(mn || '');
  if (k) m.userData.knock = k;
  return m;
}

export function pivot(name, x, y, z, joint) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  if (joint) {
    g.userData.joint = { ...joint, value: joint.type === 'lever' ? [0, 0] : 0 };
    g.userData.rest = g.position.clone();
    if (joint.type === 'lever') g.rotation.order = 'YXZ';
  }
  return g;
}

const _q = new THREE.Quaternion();
const _ax = new THREE.Vector3();
export function setJoint(p, value) {
  const j = p.userData.joint;
  if (!j) throw new Error(`setJoint: "${p.name}" is not a joint`);
  if (j.type === 'lever') {
    const [yaw, pitch] = value;
    const y = THREE.MathUtils.clamp(yaw, j.yaw.min, j.yaw.max);
    const x = THREE.MathUtils.clamp(pitch, j.pitch.min, j.pitch.max);
    j.value = [y, x];
    p.rotation.set(x, y, 0, 'YXZ');
    return j.value;
  }
  const v = THREE.MathUtils.clamp(value, j.min, j.max);
  j.value = v;
  _ax.fromArray(j.axis).normalize();
  if (j.type === 'hinge') p.quaternion.copy(_q.setFromAxisAngle(_ax, v));
  else p.position.copy(p.userData.rest).addScaledVector(_ax, v);
  return v;
}

export function anchor(name, parent, x, y, z, data) {
  const a = new THREE.Object3D();
  a.name = name;
  a.position.set(x, y, z);
  if (data) Object.assign(a.userData, data);
  parent.add(a);
  return a;
}

// Every joint inside a fixture, by part name (for tests, the demo and the interaction layer).
export function listJoints(fixture) {
  const out = [];
  for (const [name, obj] of Object.entries(fixture.parts)) if (obj && obj.userData && obj.userData.joint) out.push({ name, pivot: obj, joint: obj.userData.joint });
  return out;
}

// ---------- wall frames ----------
// rotation.y that maps the wall-local frame (z out of the wall) onto the room.
export const WALL_ROT = { back: 0, front: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 };

// Places `obj` with its wall-local origin at room point (along the wall, height y), `out` metres in front of the wall.
// along = x for back/front walls, z for left/right walls.
export function placeOnWall(obj, layout, wall, along, y, out = 0) {
  const { W, D } = layout.room;
  obj.rotation.set(0, WALL_ROT[wall], 0);
  if (wall === 'back') obj.position.set(along, y, out);
  else if (wall === 'front') obj.position.set(along, y, D - out);
  else if (wall === 'left') obj.position.set(out, y, along);
  else if (wall === 'right') obj.position.set(W - out, y, along);
  else throw new Error(`unknown wall "${wall}"`);
  return obj;
}

// ---------- matrices ----------
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
export function M(p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1]) {
  _q.setFromEuler(_e.set(r[0], r[1], r[2]));
  return new THREE.Matrix4().compose(_p.fromArray(p), _q, _s.fromArray(s));
}

// ---------- geometry helpers ----------
// Merges geometries (position + normal + uv; indexed or not) into one indexed geometry. Groups are dropped.
export function mergeGeometries(list) {
  let vCount = 0;
  let iCount = 0;
  for (const g of list) {
    vCount += g.attributes.position.count;
    iCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
  let vo = 0;
  let io = 0;
  for (const g of list) {
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const t = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos[(vo + i) * 3] = p.getX(i);
      pos[(vo + i) * 3 + 1] = p.getY(i);
      pos[(vo + i) * 3 + 2] = p.getZ(i);
      if (n) {
        nor[(vo + i) * 3] = n.getX(i);
        nor[(vo + i) * 3 + 1] = n.getY(i);
        nor[(vo + i) * 3 + 2] = n.getZ(i);
      }
      if (t) {
        uv[(vo + i) * 2] = t.getX(i);
        uv[(vo + i) * 2 + 1] = t.getY(i);
      }
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo;
    else for (let i = 0; i < p.count; i++) idx[io + i] = vo + i;
    io += g.index ? g.index.count : p.count;
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

// Collects static pieces per material and builds one mesh per material (fewer draw calls on phones).
// A piece added with a name is findable again: mesh.userData.subparts = [{ name, start, count }] in triangles,
// and subpartAt(mesh, faceIndex) turns a raycast hit into that name.
export function createBuilder(ctx) {
  const byMat = new Map();
  return {
    add(materialName, geometry, matrix, name = null) {
      const g = geometry.clone();
      if (matrix) g.applyMatrix4(matrix);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!byMat.has(materialName)) byMat.set(materialName, []);
      byMat.get(materialName).push({ g, name });
      return this;
    },
    // Adds one mesh per material to parent; returns { [materialName]: mesh }.
    build(parent, name) {
      const out = {};
      for (const [mn, list] of byMat) {
        const m = mesh(ctx, mergeGeometries(list.map((p) => p.g)), mn, `${name}:${mn}`);
        const subparts = [];
        let start = 0;
        for (const p of list) {
          const count = (p.g.index ? p.g.index.count : p.g.attributes.position.count) / 3;
          if (p.name) {
            const last = subparts[subparts.length - 1];
            if (last && last.name === p.name && last.start + last.count === start) last.count += count;
            else subparts.push({ name: p.name, start, count });
          }
          start += count;
        }
        if (subparts.length) m.userData.subparts = subparts;
        parent.add(m);
        out[mn] = m;
        for (const p of list) p.g.dispose();
      }
      byMat.clear();
      return out;
    },
  };
}

// The named piece of a merged mesh that a raycast hit (hit.object, hit.faceIndex) landed on, or null.
export function subpartAt(m, faceIndex) {
  const list = m && m.userData && m.userData.subparts;
  if (!list) return null;
  for (const s of list) if (faceIndex >= s.start && faceIndex < s.start + s.count) return s.name;
  return null;
}

// Box with UVs in metres on every face (so tile/oak maps keep their real size; set texture.repeat = 1/tile size).
export function boxGeo(w, h, d, radius = 0, segments = 2) {
  let g;
  if (radius > 0) g = new RoundedBox(w, h, d, segments, radius);
  else g = new THREE.BoxGeometry(w, h, d);
  metreUV(g, w, h, d);
  return g;
}

// BoxGeometry / RoundedBoxGeometry keep their faces in the order +x, -x, +y, -y, +z, -z in six equal chunks.
export function metreUV(g, w, h, d) {
  const uv = g.attributes.uv;
  const chunk = uv.count / 6;
  const sizes = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = f * chunk; i < (f + 1) * chunk; i++) uv.setXY(i, uv.getX(i) * sizes[f][0], uv.getY(i) * sizes[f][1]);
  }
  uv.needsUpdate = true;
  return g;
}

// Lathe from [r, y] pairs (profile order bottom -> top gives outward normals).
// three's LatheGeometry leaves the last profile point's normal unnormalised (it would skew the shading), so fix it.
export function lathe(points, segments, phiStart = 0, phiLength = Math.PI * 2) {
  const g = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), segments, phiStart, phiLength);
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) {
    const l = Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) || 1;
    n.setXYZ(i, n.getX(i) / l, n.getY(i) / l, n.getZ(i) / l);
  }
  return g;
}

// A smooth profile through control points ([r, y] pairs), sampled to n points.
export function smooth(points, n) {
  const c = new THREE.SplineCurve(points.map(([a, b]) => new THREE.Vector2(a, b)));
  return c.getPoints(n).map((v) => [v.x, v.y]);
}

// A cylinder between two points (for bars, pipes and rungs).
export function cylinderBetween(a, b, r, radial = 16, open = false) {
  const va = new THREE.Vector3().fromArray(a);
  const vb = new THREE.Vector3().fromArray(b);
  const len = va.distanceTo(vb);
  const g = new THREE.CylinderGeometry(r, r, len, radial, 1, open);
  const dir = vb.clone().sub(va).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const m = new THREE.Matrix4().compose(va.clone().add(vb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

// Closes both ends of a TubeGeometry with flat discs (for pipes whose open ends would show).
function capTube(tube, r, radial) {
  const path = tube.parameters.path;
  const list = [tube];
  for (const t of [0, 1]) {
    const disc = new THREE.CircleGeometry(r, radial);
    const dir = path.getTangentAt(t).normalize();
    if (t === 0) dir.negate();
    disc.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir));
    disc.translate(...path.getPointAt(t).toArray());
    list.push(disc);
  }
  return mergeGeometries(list);
}

// A tube along a path of points (polyline corners rounded by `bend` metres); caps closes the ends.
export function tubeAlong(points, r, { bend = 0.03, tubular = 48, radial = 12, caps = false } = {}) {
  const path = new THREE.CurvePath();
  const P = points.map((p) => new THREE.Vector3().fromArray(p));
  if (P.length === 2) path.add(new THREE.LineCurve3(P[0], P[1]));
  else {
    let start = P[0].clone();
    for (let i = 1; i < P.length - 1; i++) {
      const prev = P[i - 1];
      const cur = P[i];
      const next = P[i + 1];
      const inDir = cur.clone().sub(prev).normalize();
      const outDir = next.clone().sub(cur).normalize();
      const b = Math.min(bend, cur.distanceTo(prev) / 2, cur.distanceTo(next) / 2);
      const p1 = cur.clone().addScaledVector(inDir, -b);
      const p2 = cur.clone().addScaledVector(outDir, b);
      if (start.distanceTo(p1) > 1e-6) path.add(new THREE.LineCurve3(start, p1));
      path.add(new THREE.QuadraticBezierCurve3(p1, cur, p2));
      start = p2;
    }
    path.add(new THREE.LineCurve3(start, P[P.length - 1]));
  }
  const g = new THREE.TubeGeometry(path, tubular, r, radial, false);
  return caps ? capTube(g, r, radial) : g;
}

// A smooth tube through points (Catmull-Rom), e.g. a hanging hose or the trapway inside a toilet bowl.
export function tubeSmooth(points, r, tubular = 64, radial = 12, caps = false) {
  const c = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3().fromArray(p)), false, 'centripetal');
  const g = new THREE.TubeGeometry(c, tubular, r, radial, false);
  return caps ? capTube(g, r, radial) : g;
}

// Surface through rings of points (each ring a closed loop of the same length, points running from +x toward +z).
// Rings ordered along the profile (up the outside, over a rim, down the inside) give outward-facing normals.
export function loftGeometry(rings) {
  const R = rings.length;
  const N = rings[0].length;
  const pos = new Float32Array(R * (N + 1) * 3);
  const uv = new Float32Array(R * (N + 1) * 2);
  for (let j = 0; j < R; j++) {
    for (let i = 0; i <= N; i++) {
      const p = rings[j][i % N];
      const k = j * (N + 1) + i;
      pos[k * 3] = p[0];
      pos[k * 3 + 1] = p[1];
      pos[k * 3 + 2] = p[2];
      uv[k * 2] = i / N;
      uv[k * 2 + 1] = j / (R - 1);
    }
  }
  const idx = [];
  for (let j = 0; j < R - 1; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i;
      const b = (j + 1) * (N + 1) + i;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Close the seam: the first and last column share a position, so give them the same (averaged) normal.
  const n = g.attributes.normal;
  for (let j = 0; j < R; j++) {
    const a = j * (N + 1);
    const b = a + N;
    const x = n.getX(a) + n.getX(b);
    const y = n.getY(a) + n.getY(b);
    const z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l);
    n.setXYZ(b, x / l, y / l, z / l);
  }
  return g;
}

// A rounded rectangle Shape centred on the origin (x across, y along).
export function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// Extrudes a Shape lying flat (shape x -> x, shape y -> z), from y = 0 up to y = thickness (bevel included).
export function flatExtrude(shape, thickness, bevel = 0, curveSegments = 12, bevelSegments = 2) {
  const depth = Math.max(1e-4, thickness - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments,
    curveSegments,
  });
  g.rotateX(Math.PI / 2); // shape y -> +z, extrusion -> -y
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox.min.y, 0);
  g.computeBoundingBox();
  return g;
}

// Extrudes a Shape standing up (shape x -> x, shape y -> y), from z = 0 out to z = thickness (bevel included).
export function standExtrude(shape, thickness, bevel = 0, curveSegments = 12, bevelSegments = 2) {
  const depth = Math.max(1e-4, thickness - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments,
    curveSegments,
  });
  g.computeBoundingBox();
  g.translate(0, 0, -g.boundingBox.min.z);
  g.computeBoundingBox();
  return g;
}

// ---------- counting ----------
export function triangleCount(object, { visibleOnly = false } = {}) {
  let n = 0;
  object.traverse((o) => {
    if (!o.isMesh) return;
    if (visibleOnly) {
      let v = true;
      for (let p = o; p; p = p.parent) if (!p.visible) v = false;
      if (!v) return;
    }
    const g = o.geometry;
    n += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return Math.round(n);
}

export function drawCalls(object) {
  let n = 0;
  object.traverse((o) => {
    if (!o.isMesh) return;
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    n += Array.isArray(o.material) ? o.material.length : 1;
  });
  return n;
}
