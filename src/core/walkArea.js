// Where the visitor's eye may go: inside the room (keeping clear of walls and fixtures) and in the hallway in front of
// the door; crossing between them only through the door opening. The eye never walks into the vanity, the toilet, the
// washer or the shower (it is looked into, never walked into): it stops a step in front of a fixture and slides along
// it. The door leaf is an obstacle at whatever angle it stands (open along the wall, or swinging), so the eye never
// walks through it, and leafSweepHit() tells the door where a swing would meet the eye, so it stops there instead of
// passing through the visitor. Pure, unit-tested.
// Low things on the floor (the basket under the towel rail, the leafy plant by the vanity) are stepped round, never
// stood on: the eye stops where the visitor's toes would touch them. They are photographed models that arrive after
// the room is up, so each is in the way only once it is there (addLow, called by scene/plantWiring.js when its model
// has arrived): a failed download leaves no invisible wall. (The scale stands half under the vanity, inside the
// vanity's own block: tests/walkArea.test.js proves the eye never stands over it.)
import { LAYOUT } from '../data/layout.js';

const MARGIN = 0.28; // from the walls (the camera's near plane is 3 cm: closer, a wall would clip)
const STEP = 0.2; // from a fixture's front
const LOW_STEP = 0.15; // from a low thing on the floor: the toes reach about a foot's length ahead of the eye's line
const WALL_T = 0.12; // the front wall's thickness (scene/hallway.js and fixtures/door.js build it 12 cm thick)
const LEAF_R = 0.2; // how close the eye may come to the door leaf (its half-thickness and a step)
const OPEN_DEFAULT = 1.66; // the app's open angle (scene/interactions.js), for setDoorOpen(true)
// The towel rail and the towels on it (fixtures/towelRail.js, fixtures/towels.js): its rungs and their cloth stand at most
// RAIL_DEPTH out of the wall. They hang at the eye's height, so the eye keeps a step and a quarter from them beside the
// rail and a long step in front of it: every towel point 30 cm or more from the eye (tests/walkArea.test.js measures the
// built towels), and room for a towel taken off the rail to hang in front of the eye, never within 30 cm of it
// (scene/towelWiring.js: from nearer it could only be lifted where it hung, tmp/wave3/look2.md 7). Its own block, never
// borrowed from the basket below it (tmp/wave3/review2.md 6: with no basket the eye stood 18 cm from the bath towel).
const RAIL_DEPTH = 0.15;
const RAIL_STEP = { side: 0.25, front: 0.43 };

// The fixtures' footprints on the floor, grown by STEP (rectangles in x/z metres).
function obstacles(l) {
  const { W, D } = l.room;
  const sh = l.shower;
  const v = l.vanity;
  const t = l.toilet;
  const w = l.washer;
  const bowlReach = (t.boxing ? t.boxing.depth : 0) + 0.51; // boxing + a wall-hung bowl (a floor toilet reaches as far)
  const out = [
    { x0: 0, x1: sh.x1 + STEP, z0: 0, z1: sh.z1 + STEP }, // the shower: glass and wet floor
    { x0: v.x0 - STEP, x1: v.x1 + STEP, z0: 0, z1: v.depth + STEP }, // the vanity on the back wall
    { x0: W - bowlReach - STEP, x1: W, z0: t.z - 0.18 - STEP, z1: t.z + 0.18 + STEP }, // the toilet bowl
    { x0: w.x0 - STEP, x1: W, z0: w.z0 - STEP, z1: D }, // the washer tower
  ];
  const r = l.towelRail; // the towel rail and its towels (on a side wall: z0..z1 along it)
  if (r && (r.wall === 'left' || r.wall === 'right')) {
    const reach = RAIL_DEPTH + RAIL_STEP.front;
    out.push({ x0: r.wall === 'left' ? 0 : W - reach, x1: r.wall === 'left' ? reach : W, z0: r.z0 - RAIL_STEP.side, z1: r.z1 + RAIL_STEP.side });
  }
  return out;
}

// The low things that arrive later, by name: the floor each covers at any turn and sway (LAYOUT reach).
const LOW = {
  basket: (l) => l.basket && l.basket.reach,
  leafyPlant: (l) => l.plants && l.plants.leafyPlant && l.plants.leafyPlant.reach,
};

export function createWalkArea(l = LAYOUT) {
  const { W, D } = l.room;
  const room = { x0: MARGIN, x1: W - MARGIN, z0: MARGIN, z1: D - MARGIN };
  const hall = { x0: l.door.x0 - 0.4, x1: l.door.x1 + 0.4, z0: D + WALL_T + MARGIN, z1: D + l.hallway.depth - 0.2 };
  const doorway = { x0: l.door.x0 + 0.12, x1: l.door.x1 - 0.12 };
  const blocks = obstacles(l);
  const lowIn = new Set(); // the low things that have arrived
  // A low thing is there now (its model has arrived): its floor, grown by a toe's step, is in the way from now on.
  // Returns whether it was new.
  function addLow(key) {
    const r = LOW[key] ? LOW[key](l) : null;
    if (!r || lowIn.has(key)) return false;
    lowIn.add(key);
    blocks.push({ x0: r.x0 - LOW_STEP, x1: r.x1 + LOW_STEP, z0: r.z0 - LOW_STEP, z1: r.z1 + LOW_STEP });
    return true;
  }
  // the leaf turns about its hinge at the opening's left edge (fixtures/door.js: 6 mm inside the room face), into the room
  const hinge = { x: l.door.x0, z: D - 0.006 };
  const leafLen = l.door.x1 - l.door.x0;
  let leafAngle = OPEN_DEFAULT; // a shut door (0) blocks the doorway (the app shuts it until the visitor opens it)

  const inBox = (b, x, z) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
  const inOpen = (b, x, z) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1;
  const clampBox = (b, x, z) => ({ x: Math.min(b.x1, Math.max(b.x0, x)), z: Math.min(b.z1, Math.max(b.z0, z)) });

  // distance from (x, z) to the leaf standing at `angle` (a segment from the hinge into the room)
  function leafDist(x, z, angle) {
    const dx = Math.cos(angle) * leafLen;
    const dz = -Math.sin(angle) * leafLen;
    const t = Math.max(0, Math.min(1, ((x - hinge.x) * dx + (z - hinge.z) * dz) / (leafLen * leafLen)));
    return Math.hypot(x - (hinge.x + t * dx), z - (hinge.z + t * dz));
  }
  const leafOpen = () => leafAngle > 0.02;
  const leafBlocks = (x, z) => leafOpen() && leafDist(x, z, leafAngle) < LEAF_R;
  const blocked = (x, z) => blocks.some((b) => inOpen(b, x, z)) || leafBlocks(x, z);

  // Walls and the doorway only (the original rules).
  function shell(fx, fz, tx, tz) {
    const inDoorX = (x) => leafOpen() && x >= doorway.x0 && x <= doorway.x1;
    // Inside the door passage (between room and hall), only along the doorway.
    if (inDoorX(tx) && tz > room.z1 && tz < hall.z0 && inDoorX(fx)) {
      return { x: Math.min(doorway.x1, Math.max(doorway.x0, tx)), z: tz };
    }
    if (inBox(room, tx, tz) || inBox(hall, tx, tz)) {
      // Crossing between the two areas must happen through the doorway.
      const fromRoom = fz <= D;
      const toRoom = tz <= D;
      if (fromRoom !== toRoom && !(inDoorX(fx) && inDoorX(tx))) {
        return fromRoom ? clampBox(room, tx, tz) : clampBox(hall, tx, tz);
      }
      return { x: tx, z: tz };
    }
    // Outside both areas: slide along the boundary of the area we came from (or the doorway).
    if (inDoorX(fx) && inDoorX(tx) && fz > room.z1 - 0.01 && fz < hall.z0 + 0.01) {
      return { x: Math.min(doorway.x1, Math.max(doorway.x0, tx)), z: Math.min(hall.z0, Math.max(room.z1, tz)) };
    }
    return fz <= D ? clampBox(room, tx, tz) : clampBox(hall, tx, tz);
  }

  // Move from (fx, fz) toward (tx, tz); returns the allowed end point. The whole path is checked, not only its end:
  // one wheel notch or a big pinch is a long step, and must not hop over the thin door leaf.
  function constrain(fx, fz, tx, tz) {
    const p = shell(fx, fz, tx, tz);
    if (blocked(fx, fz)) return p; // already inside (let a stuck eye walk out)
    const e = alongLine(fx, fz, p.x, p.z);
    if (!e.hit) return p; // free all the way
    // ... then slide along the obstacle with whatever part of the move is still free (x first, then z)
    const sx = shell(e.x, e.z, p.x, e.z);
    const ax = alongLine(e.x, e.z, sx.x, sx.z);
    if (!ax.hit) return ax;
    const sz = shell(e.x, e.z, e.x, p.z);
    const az = alongLine(e.x, e.z, sz.x, sz.z);
    if (!az.hit) return az;
    // both slides run into something: take the one that got farther
    const dx = Math.hypot(ax.x - e.x, ax.z - e.z);
    const dz = Math.hypot(az.x - e.x, az.z - e.z);
    return dx >= dz ? { x: ax.x, z: ax.z } : { x: az.x, z: az.z };
  }

  // The farthest free point on the straight line from (fx, fz) to (px, pz), and whether something stopped it.
  function alongLine(fx, fz, px, pz) {
    const len = Math.hypot(px - fx, pz - fz);
    const n = Math.max(1, Math.ceil(len / 0.04));
    let hi = 0;
    for (let i = 1; i <= n && !hi; i++) if (blocked(fx + ((px - fx) * i) / n, fz + ((pz - fz) * i) / n)) hi = i / n;
    if (!hi) return { x: px, z: pz, hit: false };
    let lo = hi - 1 / n; // walk as far as the obstacle's edge
    for (let i = 0; i < 24; i++) {
      const s = (lo + hi) / 2;
      if (blocked(fx + (px - fx) * s, fz + (pz - fz) * s)) hi = s; else lo = s;
    }
    return { x: fx + (px - fx) * lo, z: fz + (pz - fz) * lo, hit: true };
  }

  // Swinging the leaf from angle `from` to `to` (radians, 0 = shut): the first angle at which it would touch an eye at
  // (x, z), or null when the eye is clear of the whole swing.
  function leafSweepHit(x, z, from, to) {
    const n = Math.max(1, Math.ceil(Math.abs(to - from) / 0.01));
    for (let i = 0; i <= n; i++) {
      const a = from + ((to - from) * i) / n;
      if (a > 0.02 && leafDist(x, z, a) < LEAF_R) return a;
    }
    return null;
  }

  return {
    constrain, room, hall, doorway, blocks, blocked, leafSweepHit, addLow,
    leafDistance: leafDist, // (x, z, angle): metres from the eye to the leaf standing at that angle
    leafReach: LEAF_R, // nearer than this, the leaf touches the visitor
    // the leaf's angle (radians, 0 = shut): it blocks the walk where it stands, and a shut door blocks the doorway
    setDoorLeaf(angle) { leafAngle = Math.max(0, Number(angle) || 0); },
    setDoorOpen(v, angle = OPEN_DEFAULT) { leafAngle = v ? angle : 0; },
    get doorOpen() { return leafOpen(); },
    get doorLeaf() { return leafAngle; },
  };
}
