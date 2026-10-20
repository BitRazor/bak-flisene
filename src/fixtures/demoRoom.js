// Dev only: the plain room the fixtures demo page (app/fixtures-demo.html) places the fixtures in. Not the real room
// shell (that one carries the baked light maps); just floor, ceiling and walls facing inward, with openings for the
// door, the tiled-in window and the shower niche, plus the hallway behind the door. Walls face inward, so seen from
// outside the near walls vanish and you can look in from any side. The floor falls to the drain like the real one
// (data/floor.js, open where the drain sits) and the room's walls reach below it, so the fixtures stand as in the room.
import * as THREE from 'three';
import { mat } from './util.js';
import { floorGrid, isDrainCell } from '../data/floor.js';

function rectShape(u0, u1, v0, v1, holes = []) {
  const s = new THREE.Shape();
  s.moveTo(u0, v0);
  s.lineTo(u1, v0);
  s.lineTo(u1, v1);
  s.lineTo(u0, v1);
  s.lineTo(u0, v0);
  for (const [a0, a1, b0, b1] of holes) {
    const h = new THREE.Path();
    h.moveTo(a0, b0);
    h.lineTo(a0, b1);
    h.lineTo(a1, b1);
    h.lineTo(a1, b0);
    h.lineTo(a0, b0);
    s.holes.push(h);
  }
  return s;
}

// A wall plane facing into the room. wall: 'back' | 'front' | 'left' | 'right'; holes in room coordinates
// ([along0, along1, y0, y1], along = x for back/front, z for left/right); at = the plane's position on its axis.
function wallPlane(ctx, name, wall, size, height, holes, at, materialName, bottom = 0) {
  let shape;
  let g;
  if (wall === 'back') {
    g = new THREE.ShapeGeometry(rectShape(0, size, bottom, height, holes));
    g.translate(0, 0, at);
  } else if (wall === 'front') {
    // rotateY(PI) maps x -> -x, so build mirrored and shift back.
    shape = rectShape(-size, 0, bottom, height, holes.map(([a, b, c, d]) => [-b, -a, c, d]));
    g = new THREE.ShapeGeometry(shape);
    g.rotateY(Math.PI);
    g.translate(0, 0, at);
  } else if (wall === 'left') {
    // rotateY(+PI/2) maps shape u -> z = -u.
    shape = rectShape(-size, 0, bottom, height, holes.map(([a, b, c, d]) => [-b, -a, c, d]));
    g = new THREE.ShapeGeometry(shape);
    g.rotateY(Math.PI / 2);
    g.translate(at, 0, 0);
  } else {
    // rotateY(-PI/2) maps shape u -> z = u.
    g = new THREE.ShapeGeometry(rectShape(0, size, bottom, height, holes));
    g.rotateY(-Math.PI / 2);
    g.translate(at, 0, 0);
  }
  const m = new THREE.Mesh(g, mat(ctx, materialName));
  m.name = `demoRoom.${name}`;
  m.receiveShadow = true;
  return m;
}

export function createDemoRoom(ctx, { wallThickness = 0.12 } = {}) {
  const L = ctx.layout;
  const { W, D, H } = L.room;
  const S = L.shower;
  const Dr = L.door;
  const hall = L.hallway.depth;
  const group = new THREE.Group();
  group.name = 'demoRoom';

  const grid = floorGrid(L, { x0: 0, x1: W, z0: 0, z1: D, skip: (cx, cz) => isDrainCell(L, cx, cz) });
  const floor = new THREE.BufferGeometry();
  floor.setAttribute('position', new THREE.Float32BufferAttribute(grid.positions, 3));
  floor.setAttribute('uv', new THREE.Float32BufferAttribute(grid.positions.filter((v, i) => i % 3 !== 1), 2)); // metres (x, z)
  floor.setIndex(grid.index);
  floor.computeVertexNormals();
  const foot = -((L.floor && L.floor.wallFoot) || 0);
  const ceil = new THREE.PlaneGeometry(W, D);
  ceil.rotateX(Math.PI / 2);
  ceil.translate(W / 2, H, D / 2);
  const fm = new THREE.Mesh(floor, mat(ctx, 'tileSand'));
  fm.name = 'demoRoom.floor';
  const cm = new THREE.Mesh(ceil, mat(ctx, 'paint'));
  cm.name = 'demoRoom.ceiling';
  group.add(fm, cm);

  const doorHole = [Dr.x0 - 0.03, Dr.x1 + 0.03, 0, Dr.height + 0.03];
  group.add(wallPlane(ctx, 'wallBack', 'back', W, H, [[S.niche.x0, S.niche.x1, S.niche.y0, S.niche.y1]], 0, 'tileSand', foot));
  const Wn = L.window; // in the dry right wall, over the toilet
  group.add(wallPlane(ctx, 'wallLeft', 'left', D, H, [], 0, 'tileSand', foot));
  group.add(wallPlane(ctx, 'wallRight', 'right', D, H, [[Wn.z0, Wn.z1, Wn.y0, Wn.y1]], W, 'paint', foot));
  group.add(wallPlane(ctx, 'wallFront', 'front', W, H, [doorHole], D, 'paint', foot));

  // Hallway: the front wall's other face (with the door opening), floor, ceiling and its walls.
  const z0 = D + wallThickness;
  const z1 = D + hall;
  const hf = new THREE.PlaneGeometry(W, z1 - z0);
  hf.rotateX(-Math.PI / 2);
  hf.translate(W / 2, 0, (z0 + z1) / 2);
  const hfm = new THREE.Mesh(hf, mat(ctx, 'oak'));
  hfm.name = 'demoRoom.hallFloor';
  const hc = new THREE.PlaneGeometry(W, z1 - z0);
  hc.rotateX(Math.PI / 2);
  hc.translate(W / 2, H, (z0 + z1) / 2);
  const hcm = new THREE.Mesh(hc, mat(ctx, 'paint'));
  hcm.name = 'demoRoom.hallCeiling';
  group.add(hfm, hcm);
  group.add(wallPlane(ctx, 'hallDoorWall', 'back', W, H, [doorHole], z0, 'paint'));
  group.add(wallPlane(ctx, 'hallFar', 'front', W, H, [], z1, 'paint'));
  const side = (name, wall, at) => {
    const g = wallPlane(ctx, name, wall, z1 - z0, H, [], at, 'paint');
    g.geometry.translate(0, 0, z0); // both side walls are built from z = 0; move them to the hallway
    return g;
  };
  group.add(side('hallLeft', 'left', 0), side('hallRight', 'right', W));
  return group;
}
