// The room layout: the single source of truth for the three.js scene AND the Blender bake.
// Units: metres. Axes: x = left -> right (looking from the door), y = up, z = back wall (0) -> door wall (D).
// The visitor starts in the hallway at the door (z > D) looking toward the back wall (-z).
// scripts/export-layout.mjs writes this object to blender/layout.json for the bake.

export const ROOM = { W: 2.6, D: 3.0, H: 2.4 };

export const LAYOUT = {
  room: ROOM,
  // Tile sizes as laid (metres): walls 30 x 30, floor 60 x 60, the shower floor 5 cm hexagons. Openings sit on joints.
  // Set-out (where a tiler starts the joints, so the cuts fall where they look deliberate): along each surface's u axis
  // (the docs/ARCHITECTURE.md table, in metres) a joint lies at u = setOut[surface] + k * tile; on every wall the
  // horizontal joints lie at y = setOut.rows + k * tile; on the floor at u (x) = floor.u + k * 0.6 and v (D - z) =
  // floor.v + k * 0.6. tests/layout.test.js checks that the openings sit on these joints.
  tiles: {
    wall: 0.3, floor: 0.6, mosaic: 0.05,
    setOut: {
      wall_back: 0.25, // a joint on the basin's axis (x 1.75): equal 25 cm cuts in both corners
      wall_front: 0, // u runs from the right corner: a joint on the door's centre line (x 1.4), equal cuts by the casings
      wall_left: 0, // u runs from the door corner: 3.0 m is ten whole tiles
      wall_right: 0, // the window (z 1.2-1.8) and the toilet's centre (z 1.5) on joints: the boxing gets equal 15 cm cuts
      rows: 0.2, // rows set out from the vanity line: joints at the counter top (0.8) and the mirror cabinet's
      // underside (1.1); a 20 cm row at the floor (cut to its fall) and a 10 cm row at the ceiling; the niche and the
      // window sit on these joints (Claude's call 2026-10-19: no sliver under the cabinet)
      floor: { u: 1.0, v: 0 }, // whole 60 cm tiles from the shower's edge (x 1.0, z 1.2) and from the door line
    },
  },
  // The finished floor falls to the drain (TEK17 13-15 guidance, research/rules-wetroom.md 0c): 1:50 within 0.8 m of the
  // drain's frame, 1:100 on the rest, no reverse fall; the grate flush with the tiles at its frame, 33 mm below the door
  // line (the rule: at least 25 mm), the door line within 2 mm of the hallway floor (y = 0). app/src/data/floor.js
  // floorHeight() is the one formula (the bake ports it); cell = the grid the floor is built on; the walls reach
  // wallFoot below y = 0 so they meet the falling floor everywhere.
  floor: { grate: -0.033, steep: 1 / 50, steepRun: 0.8, slope: 1 / 100, cell: 0.05, wallFoot: 0.05 },
  // Shower area in the back-left corner (always tiled). Walk-in glass along x = 1.0.
  // Fittings: a standard exposed shower system on the left wall: the bar thermostat, the riser straight above it (the
  // hand shower's holder slides on it between slideBar.y0 and y1), and the overhead arm off the riser's top at armY with
  // the rain head over the drain. The hand shower in its holder faces into the shower, toward the glass.
  shower: {
    x0: 0, x1: 1.0, z0: 0, z1: 1.2,
    glass: { x: 1.0, z0: 0, z1: 0.9, height: 2.0, thickness: 0.008 },
    rainHead: { x: 0.5, z: 0.55, y: 2.15, armY: 2.2 },
    mixer: { wall: 'left', x: 0, z: 0.55, y: 1.05 }, // thermostatic mixer on the left wall
    slideBar: { wall: 'left', x: 0, z: 0.55, y0: 1.2, y1: 1.95 }, // the holder stays clear above the thermostat
    niche: { wall: 'back', x0: 0.25, x1: 0.85, y0: 1.1, y1: 1.4, depth: 0.1 }, // two tiles wide, one high: on the joints
    drain: { type: 'round', x: 0.5, z: 0.55, size: 0.2 },
  },
  // Vanity centred on the back wall, mirror cabinet above; the clipboard and stamp sit on the counter.
  vanity: {
    wall: 'back', x0: 1.25, x1: 2.25, depth: 0.46, bottom: 0.23, top: 0.8,
    drawers: [
      { key: 'top', y0: 0.63, y1: 0.8 },
      { key: 'middle', y0: 0.46, y1: 0.63 },
      { key: 'bottom', y0: 0.23, y1: 0.46 },
    ],
    basin: { type: 'vessel', x: 1.75, z: 0.25, diameter: 0.35, height: 0.11 },
    mixer: { x: 1.75, z: 0.06 },
    counter: { clipboard: { x: 2.05, z: 0.28 }, phone: { x: 1.42, z: 0.3 }, soap: { x: 1.36, z: 0.12 } },
  },
  mirror: { wall: 'back', x0: 1.25, x1: 2.25, y0: 1.1, y1: 1.8, depth: 0.14, display: { u0: 0.56, u1: 0.94, v0: 0.08, v1: 0.42 } },
  // Wall-hung toilet on the right wall, facing left; frame boxed in. Its centre 1.04 m from the vanity's front and 0.9 m
  // from the washer: the bowl stays out of the room to stand at the basin (the owner, 2026-10-25: "its to near to the
  // sink"; the distances in tests/layout.test.js).
  toilet: {
    wall: 'right', z: 1.5, boxing: { z0: 1.05, z1: 1.95, depth: 0.2, height: 1.2 },
    paperHolder: { wall: 'right', z: 2.02, y: 0.72 },
  },
  // The window is in a dry wall (never in a wet zone: the owner's rule, 2026-10-19): over the toilet, centred on it,
  // clear of the boxing's shelf. A tiled-in reveal, 20 cm deep.
  window: { wall: 'right', z0: 1.2, z1: 1.8, y0: 1.4, y1: 2.0, depth: 0.2 }, // edges on the tile joints
  // Two potted plants, a rubber duck and a wicker basket (photographed models, fixtures/plants.js): where each one's
  // foot stands (x, z, on its surface: the window sill, the floor, the shower niche's shelf), its yaw (radians,
  // three.js rotation.y), its scale (of the model's own metres) and, for a plant, how far its pot turns each way when
  // dragged. Placed by the models' geometry (tests/plants.test.js): clear of the walls, every fixture, the door's swing
  // and the tilting sash, at every turn and sway. reach: the floor a floor thing covers at any turn and sway (for the
  // walking area). The succulent turns all the way round (a small round pot in front of the window frame).
  plants: {
    succulent: { surface: 'sill', x: 2.64, z: 1.62, yaw: 0, scale: 0.45, turn: Math.PI },
    leafyPlant: { surface: 'floor', x: 2.4, z: 0.2, yaw: 2.531, scale: 0.5, turn: 0.349, reach: { x0: 2.25, x1: 2.6, z0: 0.02, z1: 0.43 } },
  },
  duck: { surface: 'nicheShelf', x: 0.44, z: -0.045, yaw: 0.698, scale: 0.32 }, // facing out, toward the room
  basket: { surface: 'floor', x: 0.159, z: 2.55, yaw: Math.PI / 2, scale: 1, reach: { x0: 0.01, x1: 0.31, z0: 2.355, z1: 2.745 } },
  // The electric towel rail and its connection box (on the door side) stay out of the wet zone (the left wall's
  // membrane ends at z 2.2) and more than 1.2 m from the shower's water outlets; the door leaf clears it.
  towelRail: { wall: 'left', z0: 2.3, z1: 2.8, y0: 0.6, y1: 1.85 },
  // The towels on the rail (fixtures/towels.js): sizes as sold (width x length), each folded lengthwise and laid over
  // a rung (0 = the rail's lowest of 12) so both halves hang down; x = along the rail from its centre (+ toward the
  // back wall). The bath towel on the top rung, the hand towel lower, clear of each other and of the floor.
  towels: { bath: { rung: 11, size: [0.7, 1.4], x: 0.005 }, hand: { rung: 3, size: [0.5, 0.9], x: -0.01 } },
  washer: { x0: 2.0, x1: 2.6, z0: 2.4, z1: 3.0, height: 1.72 },
  // The bathroom scale (fixtures/scale.js): the centre of its 30 x 30 cm footprint on the floor, half under the floating
  // vanity's front edge (z 0.46), the dial on the half out in the room; yaw = its turn about y (a little askew, as a
  // scale is pushed back under a vanity by foot)
  scale: { x: 1.98, z: 0.49, yaw: -0.09 },
  // Door in the front wall, hinged at its left edge, opening into the room.
  door: { x0: 1.0, x1: 1.8, height: 2.05, hinge: 'left', thickness: 0.04 },
  // light switch and floor-heating thermostat by the door: centred between the door casing (x 1.85) and the washer's
  // front (x 2.045), clear of both
  panel: { wall: 'front', x: 1.947, y: 1.1 },
  // The brass "Membran" button: on the back wall right of the vanity, so the visitor faces the shower and the floor
  // (where the membrane shows) when pressing it. Claude's call 2026-10-19 (review: by the door the effect was behind you).
  membraneButton: { wall: 'back', x: 2.5, y: 1.15 }, // its plate clear of the basin's wet-zone edge (x 2.425)
  // the ceiling extract valve (a white 125 mm disc valve, fixtures/extractValve.js); the steam is pulled to it
  vent: { x: 1.3, z: 0.7, size: 0.125 },
  hallway: { depth: 2.4, trolley: { x: 0.45, z: 4.35 } },
  camera: { start: { x: 1.4, y: 1.6, z: 4.9 }, lookAt: { x: 1.4, y: 1.0, z: 3.0 }, eye: 1.6 },
  // Wet zones (membrane): whole floor; walls within 1.0 m of the shower area and 0.5 m around the basin;
  // full height over the shower. Owner's practice = the rule's minimum (kontor/decisions.md 2026-10-19).
  wetZone: { showerExtra: 1.0, basinExtra: 0.5, floorUpstand: 0.05 },
};

export function floorArea(l = LAYOUT) {
  return l.room.W * l.room.D;
}
