// Light for faces outside the six shell planes (the niche, the window reveal, the toilet boxing). The bake packs their
// light into hidden parts of their wall's map (bake.json "extraFaces"): for a point p on such a face,
//   u = uFrom + (p[u.axis] - u.from) / (u.to - u.from) * (uTo - uFrom), and v likewise.
// A vertex belongs to the face whose plane it lies on, whose extent holds it, and whose plane faces the way the
// vertex normal points (a corner vertex lies on several planes; its normal says which face it is part of). Pure.

const AXES = { x: 0, y: 1, z: 2 };
const EPS = 0.004;

// The axis a face is flat in (boxMin and boxMax agree there), e.g. 'z' for the niche's back.
export function flatAxis(face) {
  for (const a of ['x', 'y', 'z']) if (Math.abs(face.boxMax[AXES[a]] - face.boxMin[AXES[a]]) < 1e-6) return a;
  return null;
}

export function faceFor(faces, p, n) {
  let best = null;
  for (const f of faces) {
    const a = flatAxis(f);
    if (!a) continue;
    const i = AXES[a];
    // the vertex normal must point along the face's flat axis
    const dom = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0 : Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2;
    if (dom !== i) continue;
    if (Math.abs(p[i] - f.boxMin[i]) > EPS) continue;
    let inside = true;
    for (let k = 0; k < 3; k++) {
      if (k === i) continue;
      if (p[k] < f.boxMin[k] - EPS || p[k] > f.boxMax[k] + EPS) { inside = false; break; }
    }
    if (inside) { best = f; break; }
  }
  return best;
}

export function packedUV(face, p) {
  const u = face.u;
  const v = face.v;
  const pu = p[AXES[u.axis]];
  const pv = p[AXES[v.axis]];
  return [
    u.uFrom + ((pu - u.from) / (u.to - u.from)) * (u.uTo - u.uFrom),
    v.vFrom + ((pv - v.from) / (v.to - v.from)) * (v.vTo - v.vFrom),
  ];
}

// Fills a uv1 array for world-space positions and normals (flat arrays of xyz). Returns how many vertices found no
// face (they get the centre of their surface's packed region, a soft average, instead of a wrong bright spot).
export function packedUV1(faces, positions, normals) {
  const n = positions.length / 3;
  const uv1 = new Float32Array(n * 2);
  let missed = 0;
  for (let i = 0; i < n; i++) {
    const p = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
    const nn = [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]];
    const f = faceFor(faces, p, nn);
    if (f) {
      const [u, v] = packedUV(f, p);
      uv1[i * 2] = u;
      uv1[i * 2 + 1] = v;
    } else {
      missed++;
      const r = faces[0].region; // [u0, u1, v0, v1]
      uv1[i * 2] = (r[0] + r[1]) / 2;
      uv1[i * 2 + 1] = (r[2] + r[3]) / 2;
    }
  }
  return { uv1, missed };
}
