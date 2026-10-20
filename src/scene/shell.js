// The room's shell: floor, ceiling and walls with the door opening, the tiled-in window opening and the niche.
// The floor falls to the drain (app/src/data/floor.js, LAYOUT.floor): the tiled floor and the shower's mosaic are height
// grids on LAYOUT.floor.cell, the mosaic with the opening the drain sits in (shower.js builds the drain under it); the
// walls reach LAYOUT.floor.wallFoot below y = 0, so they meet the falling floor everywhere (the floor hides the rest).
// UVs follow docs/ARCHITECTURE.md: `uv` in metres for the tiles, set out from LAYOUT.tiles.setOut so the joints fall
// where a tiler puts them; `uv1` = 0..1 per surface for the baked light maps (below y = 0, at the walls' foot, v runs
// a little under 0: the light map clamps to its edge there). Every surface knocks in its own material voice.
import * as THREE from 'three';
import { floorGrid, isDrainCell } from '../data/floor.js';

// uv1 (the light map's 0..1) of a room point on one of the six surfaces: the table in docs/ARCHITECTURE.md.
export function surfaceUV1(L, surface, x, y, z) {
  const { W, D, H } = L.room;
  switch (surface) {
    case 'floor': return [x / W, (D - z) / D];
    case 'ceiling': return [x / W, z / D];
    case 'wall_back': return [x / W, y / H];
    case 'wall_front': return [(W - x) / W, y / H];
    case 'wall_left': return [(D - z) / D, y / H];
    case 'wall_right': return [z / D, y / H];
    default: throw new Error(`unknown surface "${surface}"`);
  }
}

// Where a surface's tile joints start (metres along its u axis, and up for the walls): LAYOUT.tiles.setOut.
export function tileOrigin(L, surface) {
  const so = (L.tiles && L.tiles.setOut) || {};
  if (surface === 'floor') return [(so.floor && so.floor.u) || 0, (so.floor && so.floor.v) || 0];
  if (surface === 'ceiling') return [0, 0];
  return [so[surface] || 0, so.rows || 0];
}

function wallShape(w, h, y0, holes = [], notches = []) {
  // notches: openings touching the bottom edge, as [s0, s1, top]
  const pts = [[0, y0]];
  for (const [s0, s1, top] of notches.sort((a, b) => a[0] - b[0])) pts.push([s0, y0], [s0, top], [s1, top], [s1, y0]);
  pts.push([w, y0], [w, h], [0, h]);
  const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const [s0, s1, t0, t1] of holes) {
    const hole = new THREE.Path([new THREE.Vector2(s0, t0), new THREE.Vector2(s1, t0), new THREE.Vector2(s1, t1), new THREE.Vector2(s0, t1)]);
    shape.holes.push(hole);
  }
  return shape;
}

// Build a planar surface from a 2D shape in (s, t) metres; place it with a matrix (rotation + translation, no mirror).
// uv = tile metres from the set-out origin (s0, t0); uv1 = s / sizeS, t / sizeT.
function surface(shape, matrix, sizeS, sizeT, texMetres, [s0, t0] = [0, 0]) {
  const g = new THREE.ShapeGeometry(shape, 1);
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const uv1 = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const s = pos.getX(i);
    const t = pos.getY(i);
    uv[i * 2] = (s - s0) / texMetres;
    uv[i * 2 + 1] = (t - t0) / texMetres;
    uv1[i * 2] = s / sizeS;
    uv1[i * 2 + 1] = t / sizeT;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  g.applyMatrix4(matrix);
  g.computeVertexNormals();
  return g;
}

// A piece of the falling floor: a height grid with tile uv in metres from the set-out origin and the floor's uv1.
function floorSurface(L, rect, skip, texMetres, [u0, v0] = [0, 0]) {
  const { W, D } = L.room;
  const grid = floorGrid(L, { ...rect, skip });
  const n = grid.positions.length / 3;
  const uv = new Float32Array(n * 2);
  const uv1 = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = grid.positions[i * 3];
    const z = grid.positions[i * 3 + 2];
    uv[i * 2] = (x - u0) / texMetres;
    uv[i * 2 + 1] = (D - z - v0) / texMetres;
    uv1[i * 2] = x / W;
    uv1[i * 2 + 1] = (D - z) / D;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(grid.positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  g.setIndex(grid.index);
  g.computeVertexNormals();
  return g;
}

// One flat quad from four room points (counter-clockwise seen from the side it faces) with its tile uv per corner.
function quad(points, uvs) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.flat(), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

const M = (rx, ry, tx, ty, tz) => new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ')).setPosition(tx, ty, tz);

export function createShell(ctx, { wallMat, floorMat, showerFloorMat, ceilingMat, texMetres = { wall: 1.2, floor: 1.2, mosaic: 0.3 } }) {
  const { layout } = ctx;
  const L = layout;
  const { W, D, H } = layout.room;
  const group = new THREE.Group();
  group.name = 'shell';
  const parts = {};
  const sh = layout.shower;
  const win = layout.window; // in a dry wall (never in a wet zone): the toilet wall
  const niche = sh.niche;
  const door = layout.door;
  const foot = -((layout.floor && layout.floor.wallFoot) || 0);

  // --- floor: large tiles outside the shower, mosaic inside (both use the same floor light map); both fall to the drain
  parts.floor = new THREE.Mesh(floorSurface(L, { x0: 0, x1: W, z0: 0, z1: D },
    (cx, cz) => cx > sh.x0 && cx < sh.x1 && cz > sh.z0 && cz < sh.z1, texMetres.floor, tileOrigin(L, 'floor')), floorMat);
  parts.floorShower = new THREE.Mesh(floorSurface(L, { x0: sh.x0, x1: sh.x1, z0: sh.z0, z1: sh.z1 },
    (cx, cz) => isDrainCell(L, cx, cz), texMetres.mosaic), showerFloorMat);

  // --- ceiling
  parts.ceiling = new THREE.Mesh(surface(wallShape(W, D, 0), M(Math.PI / 2, 0, 0, H, 0), W, D, 1), ceilingMat);

  // --- walls (s, t in metres along the table in ARCHITECTURE.md), from the foot below the floor to the ceiling
  parts.wall_back = new THREE.Mesh(surface(
    wallShape(W, H, foot, [[niche.x0, niche.x1, niche.y0, niche.y1]]), M(0, 0, 0, 0, 0), W, H, texMetres.wall,
    tileOrigin(L, 'wall_back')), wallMat);
  parts.wall_front = new THREE.Mesh(surface(
    wallShape(W, H, foot, [], [[W - door.x1, W - door.x0, door.height]]), M(0, Math.PI, W, 0, D), W, H, texMetres.wall,
    tileOrigin(L, 'wall_front')), wallMat);
  parts.wall_left = new THREE.Mesh(surface(wallShape(D, H, foot), M(0, Math.PI / 2, 0, 0, D), D, H, texMetres.wall,
    tileOrigin(L, 'wall_left')), wallMat);
  parts.wall_right = new THREE.Mesh(surface(
    wallShape(D, H, foot, [[win.z0, win.z1, win.y0, win.y1]]), M(0, -Math.PI / 2, W, 0, 0), D, H, texMetres.wall,
    tileOrigin(L, 'wall_right')), wallMat);

  // --- the niche: a tiled box set into the back wall. Its tiles continue the back wall's joints (the niche's edges
  // are on joints): the back and the sill/top follow the wall's columns, the sides and the back follow its rows.
  const [bu, rows] = tileOrigin(L, 'wall_back');
  const tm = texMetres.wall;
  const nd = niche.depth;
  const { x0: nx0, x1: nx1, y0: ny0, y1: ny1 } = niche;
  const nicheGroup = new THREE.Group();
  const nicheFace = (pts, uvs) => {
    const m = new THREE.Mesh(quad(pts, uvs.map(([u, v]) => [u / tm, v / tm])), wallMat);
    nicheGroup.add(m);
    return m;
  };
  const cu = (x) => x - bu;
  const rv = (y) => y - rows;
  nicheFace([[nx0, ny0, -nd], [nx1, ny0, -nd], [nx1, ny1, -nd], [nx0, ny1, -nd]],
    [[cu(nx0), rv(ny0)], [cu(nx1), rv(ny0)], [cu(nx1), rv(ny1)], [cu(nx0), rv(ny1)]]); // back (faces +z)
  nicheFace([[nx0, ny0, 0], [nx1, ny0, 0], [nx1, ny0, -nd], [nx0, ny0, -nd]],
    [[cu(nx0), 0], [cu(nx1), 0], [cu(nx1), nd], [cu(nx0), nd]]); // sill (faces up)
  nicheFace([[nx0, ny1, -nd], [nx1, ny1, -nd], [nx1, ny1, 0], [nx0, ny1, 0]],
    [[cu(nx0), nd], [cu(nx1), nd], [cu(nx1), 0], [cu(nx0), 0]]); // top (faces down)
  nicheFace([[nx0, ny0, 0], [nx0, ny0, -nd], [nx0, ny1, -nd], [nx0, ny1, 0]],
    [[0, rv(ny0)], [nd, rv(ny0)], [nd, rv(ny1)], [0, rv(ny1)]]); // left side (faces +x)
  nicheFace([[nx1, ny0, -nd], [nx1, ny0, 0], [nx1, ny1, 0], [nx1, ny1, -nd]],
    [[nd, rv(ny0)], [0, rv(ny0)], [0, rv(ny1)], [nd, rv(ny1)]]); // right side (faces -x)
  parts.niche = nicheGroup;

  // --- the window reveal (tiled-in, over the toilet): four tiled faces into the right wall, continuing its joints
  const [ru] = tileOrigin(L, 'wall_right');
  const wd = win.depth;
  const xo = W + wd;
  const reveal = new THREE.Group();
  const revealFace = (pts, uvs) => reveal.add(new THREE.Mesh(quad(pts, uvs.map(([u, v]) => [u / tm, v / tm])), wallMat));
  const zu = (z) => z - ru;
  revealFace([[W, win.y0, win.z0], [W, win.y0, win.z1], [xo, win.y0, win.z1], [xo, win.y0, win.z0]],
    [[zu(win.z0), 0], [zu(win.z1), 0], [zu(win.z1), wd], [zu(win.z0), wd]]); // sill (faces up)
  revealFace([[xo, win.y1, win.z0], [xo, win.y1, win.z1], [W, win.y1, win.z1], [W, win.y1, win.z0]],
    [[zu(win.z0), wd], [zu(win.z1), wd], [zu(win.z1), 0], [zu(win.z0), 0]]); // head (faces down)
  revealFace([[W, win.y0, win.z0], [xo, win.y0, win.z0], [xo, win.y1, win.z0], [W, win.y1, win.z0]],
    [[0, rv(win.y0)], [wd, rv(win.y0)], [wd, rv(win.y1)], [0, rv(win.y1)]]); // side toward the back (faces +z)
  revealFace([[xo, win.y0, win.z1], [W, win.y0, win.z1], [W, win.y1, win.z1], [xo, win.y1, win.z1]],
    [[wd, rv(win.y0)], [0, rv(win.y0)], [0, rv(win.y1)], [wd, rv(win.y1)]]); // side toward the door (faces -z)
  parts.windowReveal = reveal;

  for (const k of ['floor', 'floorShower', 'ceiling', 'wall_back', 'wall_front', 'wall_left', 'wall_right']) {
    parts[k].name = k;
    group.add(parts[k]);
  }
  group.add(nicheGroup, reveal);

  // Knock voices: tiles on walls and floors, paint on the ceiling.
  const knocks = [
    [parts.floor, 'tile'], [parts.floorShower, 'tile'], [parts.ceiling, 'paint'],
    [parts.wall_back, 'tile'], [parts.wall_front, 'tile'], [parts.wall_left, 'tile'], [parts.wall_right, 'tile'],
  ];
  return { group, parts, knocks, surfaces: ['floor', 'ceiling', 'wall_back', 'wall_front', 'wall_left', 'wall_right'] };
}
