// The finished floor of the wet room. It falls to the drain everywhere (TEK17 13-15 guidance, research/rules-wetroom.md
// section 0c): at least 1:50 within 0.8 m of the drain, at least 1:100 on the rest of the floor, no reverse fall, and
// the floor at the door at least 25 mm above the top of the grate. The grate sits flush with the tiles at its frame, so
// the fall is measured from the frame's edge (the floor is level with the grate over the frame itself).
//
// This is the one formula for the floor's height: the shell (scene/shell.js), the fixtures that stand on the floor,
// the membrane view, the effects (where water lands) and the Blender bake (blender/bakelib/common.py floor_height, a
// line-by-line port reading blender/layout.json) all use it. Numbers: LAYOUT.floor. Pure: no three.js, no DOM.

// Distance in the floor plane from (x, z) to the drain's frame, a square LAYOUT.shower.drain.size wide (0 inside it).
export function drainDistance(L, x, z) {
  const d = L.shower.drain;
  const a = d.size / 2;
  const dx = Math.max(0, Math.abs(x - d.x) - a);
  const dz = Math.max(0, Math.abs(z - d.z) - a);
  return Math.hypot(dx, dz);
}

// The floor's height at a distance e from the drain's frame: 1:50 for the first 0.8 m, then 1:100.
export function heightAtDistance(L, e) {
  const f = L.floor;
  return f.grate + Math.min(e, f.steepRun) * f.steep + Math.max(0, e - f.steepRun) * f.slope;
}

// Height (metres, y) of the finished floor at (x, z). Inside the room it falls to the drain; beyond the room's front
// wall (z > D: the door opening and the hallway) the floor is level at 0. Points outside the room's walls take the
// height at the wall.
export function floorHeight(L, x, z) {
  const { W, D } = L.room;
  if (z > D) return 0;
  return heightAtDistance(L, drainDistance(L, Math.min(W, Math.max(0, x)), Math.max(0, z)));
}

// True when a floor cell's centre lies inside the drain's frame: those cells are the opening the drain sits in.
export function isDrainCell(L, cx, cz) {
  const d = L.shower.drain;
  const a = d.size / 2;
  return Math.abs(cx - d.x) < a && Math.abs(cz - d.z) < a;
}

// The lowest floor point under a rectangle { x0, x1, z0, z1 } (room metres): where a flat foot (a washer's tray, a
// toilet's foot) has to sit so that it touches the floor and never floats; the floor is higher everywhere else under it.
export function lowestUnder(L, r) {
  const d = L.shower.drain;
  const a = d.size / 2;
  const dx = Math.max(0, r.x0 - (d.x + a), (d.x - a) - r.x1);
  const dz = Math.max(0, r.z0 - (d.z + a), (d.z - a) - r.z1);
  return heightAtDistance(L, Math.hypot(dx, dz));
}

// The highest point of the finished floor (the corner farthest from the drain: the height only grows with distance).
export function floorHighest(L) {
  const { W, D } = L.room;
  return Math.max(floorHeight(L, 0, 0), floorHeight(L, W, 0), floorHeight(L, 0, D), floorHeight(L, W, D));
}

// The top of the floor membrane's upstand on the walls: a level line LAYOUT.wetZone.floorUpstand (5 cm) above the
// highest point of the finished floor (the wet-room norm), so it is at least 5 cm up the wall everywhere.
export function upstandTop(L) {
  return floorHighest(L) + L.wetZone.floorUpstand;
}

// A height grid over a rectangle of the floor: nodes every `cell` metres from (x0, z0) (the far edges must lie on the
// grid), at floorHeight + lift; cells whose centre makes skip(cx, cz) true are left out (the drain's opening).
// Returns plain arrays: positions [x, y, z per node], index [two triangles per cell, counter-clockwise seen from above],
// and the node counts along x and z.
export function floorGrid(L, { x0, x1, z0, z1, cell = L.floor.cell, lift = 0, skip = null }) {
  const nx = Math.round((x1 - x0) / cell);
  const nz = Math.round((z1 - z0) / cell);
  const positions = [];
  for (let j = 0; j <= nz; j++) {
    const z = j === nz ? z1 : z0 + j * cell;
    for (let i = 0; i <= nx; i++) {
      const x = i === nx ? x1 : x0 + i * cell;
      positions.push(x, floorHeight(L, x, z) + lift, z);
    }
  }
  const index = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      if (skip && skip(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell)) continue;
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + nx + 1;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  return { positions, index, nx: nx + 1, nz: nz + 1 };
}
