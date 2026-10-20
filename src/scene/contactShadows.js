// Soft contact shadows where things stand, so nothing floats (review 2026-10-19, visual finding 4): the shell carries
// the baked shadows of the fixed fixtures, but the things on the counter, the washer's foot, the floor-standing toilet
// (it has no bake: it replaces the boxed-in one) and the hallway trolley had none. Each gets a soft, baked-looking
// shadow drawn into the surface it stands on: a multiply decal (the surface darkens, nothing is added), darkest at the
// thing's edge and fading out over a blur that grows with how high the thing stands. No shadow maps, no lights: one
// draw call for all the fixed ones, made once; the floor-standing toilet's are made when it is swapped in. A multiply
// keeps a share of the light under it, so every shadow falls with the room's light (the switch, day and evening).
//
// The door leaf (the owner's picture of the shut door, 2026-10-19: "strange line on floor"): the light bake had the leaf
// open at 95 degrees, so its shadow stayed on the floor when the door was shut. The bake now leaves the leaf out and the
// leaf's shadow is live: in the same draw call, under its bottom edge at whatever angle it stands, laid point by point
// on the falling floor. Only on a frame in which the leaf has turned are its own points laid again; a door standing
// still costs four number comparisons a frame. Shut, it lies in the doorway under the leaf (the oak threshold covers it).
//
// Shadows for new things (plants, a scale, a basket): add(object, opts) -> handle { item, refresh(), remove() } | null
//   kind: 'floor' (the falling floor; beyond the door line the hallway's level floor) | 'counter' (the vanity's top) |
//     'level' (any other level surface, a windowsill or the boxing's top: at the thing's own lowest point)
//   footprint: left out = measured where the thing touches (its points within `touch`, 1 cm, of its lowest point, in its
//     own turned frame); 'outline' = its whole outline seen from above (leaves or a rim wider than its foot);
//     { w, d } or { x0, x1, z0, z1 } = metres in its own turned frame, about its origin.
//   strength: how dark under it (0.42; the others are 0.38-0.5); round: an ellipse (a pot, a round basket);
//   blur: metres (left out: 22 % of the thing's height, 8 mm to 6 cm); name: for the item (the object's name).
//   Call it once the thing stands where it stays: its place and turn are read then, never every frame. After it has
//   moved, handle.refresh(); handle.remove() takes the shadow away. Adding the same thing again changes its options and
//   keeps one shadow. All added things share one more draw call. Nothing to stand (no object, no visible mesh) or an
//   unknown kind: null, no error.
//
// createContactShadows(ctx) -> { items, toiletItems, meshes, setToilet(toilet), door, add(object, opts), addedItems,
//   group }; door = { item, mesh, first, count, update() } (null without a door): ctx.loop runs update() every frame.
import * as THREE from 'three';
import { floorHeight } from '../data/floor.js';
import { counterTop } from '../fixtures/vanity.js';

export const SHADOW = {
  lift: 0.0006, // metres over the surface
  cell: 0.05, // the grid on the falling floor (as the floor's own: LAYOUT.floor.cell)
  // pure mirror of the fragment shader (tests): how much of the shadow at local point p of a footprint of half size
  // h, blurred over r; 1 = full, under the thing; round = an ellipse
  shade(p, h, r, round) {
    let d;
    if (round) {
      const k = Math.hypot(p[0] / h[0], p[1] / h[1]);
      d = (k - 1) * Math.min(h[0], h[1]);
    } else {
      const qx = Math.abs(p[0]) - h[0];
      const qz = Math.abs(p[1]) - h[1];
      d = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
    }
    const a = -0.3 * r;
    const t = Math.min(1, Math.max(0, (d - a) / (r - a)));
    const s = 1 - t * t * (3 - 2 * t);
    return s * s;
  },
};

const VERT = /* glsl */ `
attribute vec2 aLocal;
attribute vec4 aShape;
attribute float aRound;
varying vec2 vLocal;
varying vec4 vShape;
varying float vRound;
void main() {
	vLocal = aLocal;
	vShape = aShape;
	vRound = aRound;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;
const FRAG = /* glsl */ `
varying vec2 vLocal;
varying vec4 vShape;
varying float vRound;
void main() {
	vec2 h = max( vShape.xy, vec2( 1e-4 ) );
	float r = max( vShape.z, 1e-4 );
	float d;
	if ( vRound > 0.5 ) {
		d = ( length( vLocal / h ) - 1.0 ) * min( h.x, h.y );
	} else {
		vec2 q = abs( vLocal ) - h;
		d = length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 );
	}
	float s = 1.0 - smoothstep( -0.3 * r, r, d );
	s *= s;
	gl_FragColor = vec4( vec3( 1.0 - vShape.w * s ), 1.0 );
}
`;

// The extent of a thing where it touches its surface: the points within `touch` metres of its lowest point.
// points: [[x, y, z], ...] in the thing's own (yaw-aligned) frame. Returns { x0, x1, z0, z1, y0 }.
export function footprint(points, { touch = 0.01 } = {}) {
  let y0 = Infinity;
  for (const p of points) y0 = Math.min(y0, p[1]);
  const f = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, y0 };
  for (const p of points) {
    if (p[1] > y0 + touch) continue;
    f.x0 = Math.min(f.x0, p[0]);
    f.x1 = Math.max(f.x1, p[0]);
    f.z0 = Math.min(f.z0, p[2]);
    f.z1 = Math.max(f.z1, p[2]);
  }
  return f;
}

// The shadow's grid: the footprint grown by the blur on every side, each point `lift` over heightAt(x, z) (the
// falling floor, or a flat counter). Returns { positions, local } (flat arrays) and the grid's index.
// toWorld(lx, lz) -> [x, z] turns the footprint's own frame into the room's; place(lx, lz) -> [x, y, z] instead puts
// a point anywhere (a shadow standing on a wall).
export function decalGrid(rect, blur, heightAt, lift, { cell = SHADOW.cell, toWorld = null, place = null } = {}) {
  const x0 = rect.x0 - blur;
  const x1 = rect.x1 + blur;
  const z0 = rect.z0 - blur;
  const z1 = rect.z1 + blur;
  const nx = Math.max(2, Math.ceil((x1 - x0) / cell));
  const nz = Math.max(2, Math.ceil((z1 - z0) / cell));
  const cx = (rect.x0 + rect.x1) / 2;
  const cz = (rect.z0 + rect.z1) / 2;
  const positions = [];
  const local = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const lx = x0 + ((x1 - x0) * i) / nx;
      const lz = z0 + ((z1 - z0) * j) / nz;
      if (place) positions.push(...place(lx, lz));
      else {
        const [wx, wz] = toWorld ? toWorld(lx, lz) : [lx, lz];
        positions.push(wx, heightAt(wx, wz) + lift, wz);
      }
      local.push(lx - cx, lz - cz);
    }
  }
  const index = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i;
      const b = a + 1;
      const c = a + (nx + 1);
      const d = c + 1;
      index.push(a, c, b, b, c, d); // faces up (+y)
    }
  }
  return { positions, local, index };
}

// world points of a thing's meshes in a frame turned by -yaw about its origin (so a turned phone's footprint is its own
// rectangle, not a bigger box round it)
function pointsOf(root, origin, yaw, filter = null) {
  const out = [];
  const v = new THREE.Vector3();
  const c = Math.cos(-yaw);
  const s = Math.sin(-yaw);
  root.updateWorldMatrix(true, true);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position || (filter && !filter(o))) return;
    if (o.visible === false) return;
    let hidden = false;
    for (let p = o; p && p !== root; p = p.parent) if (p.visible === false) { hidden = true; break; }
    if (hidden) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).sub(origin);
      out.push([c * v.x + s * v.z, v.y + origin.y, -s * v.x + c * v.z]);
    }
  });
  return out;
}
function yawOf(o) {
  const q = new THREE.Quaternion();
  o.updateWorldMatrix(true, false);
  o.getWorldQuaternion(q);
  const x = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  return Math.atan2(-x.z, x.x);
}

// One mesh holding many shadows (one draw call). specs: { name, surface, x/z frame, rect (local), blur, strength,
// round, heightAt, yaw, origin } -> items describe each for tests and checks; ranges: each one's points in the mesh
// ({ first, count }), for a shadow whose points are laid again (the door leaf's).
function buildMesh(specs) {
  const pos = [];
  const loc = [];
  const shape = [];
  const round = [];
  const idx = [];
  const items = [];
  const ranges = [];
  for (const sp of specs) {
    const c = Math.cos(sp.yaw || 0);
    const s = Math.sin(sp.yaw || 0);
    const o = sp.origin || new THREE.Vector3();
    const toWorld = (lx, lz) => [o.x + c * lx + s * lz, o.z - s * lx + c * lz];
    const g = decalGrid(sp.rect, sp.blur, sp.heightAt, SHADOW.lift, { toWorld, cell: sp.cell, place: sp.place });
    const base = pos.length / 3;
    ranges.push({ first: base, count: g.positions.length / 3 });
    pos.push(...g.positions);
    loc.push(...g.local);
    const hx = (sp.rect.x1 - sp.rect.x0) / 2;
    const hz = (sp.rect.z1 - sp.rect.z0) / 2;
    for (let i = 0; i < g.positions.length / 3; i++) { shape.push(hx, hz, sp.blur, sp.strength); round.push(sp.round ? 1 : 0); }
    for (const k of g.index) idx.push(base + k);
    const mid = [(sp.rect.x0 + sp.rect.x1) / 2, (sp.rect.z0 + sp.rect.z1) / 2];
    if (sp.place) {
      const [x, y, z] = sp.place(...mid);
      items.push({ name: sp.name, surface: sp.surface, x, y, z, hx, hz, blur: sp.blur, strength: sp.strength });
    } else {
      const [cx, cz] = toWorld(...mid);
      items.push({ name: sp.name, surface: sp.surface, cx, cz, y: sp.heightAt(cx, cz) + SHADOW.lift, hx, hz, blur: sp.blur, strength: sp.strength });
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aLocal', new THREE.Float32BufferAttribute(loc, 2));
  geo.setAttribute('aShape', new THREE.Float32BufferAttribute(shape, 4));
  geo.setAttribute('aRound', new THREE.Float32BufferAttribute(round, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, decalMaterial());
  mesh.renderOrder = -1; // first among the see-through things: straight onto the surfaces under them
  mesh.raycast = () => {}; // a shadow never takes a touch
  mesh.userData.contactShadow = true;
  mesh.frustumCulled = false;
  return { mesh, items, ranges };
}
function decalMaterial() {
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.ZeroFactor,
    // no depth offset: the 0.6 mm lift is enough (the depth buffer resolves it at any distance in the room), and an
    // offset pulled the counter's shadow of the clipboard in front of the 3 mm board, greying the price sheet
    side: THREE.DoubleSide, // shadows on floors face up, on walls they face the room: never culled
  });
  m.name = 'contactShadow';
  return m;
}

// A spec for a thing standing on a surface: its footprint where it touches (or its whole outline from above, for a
// basin that overhangs its foot), blurred by how high it stands.
function onSurface(name, root, surface, heightAt, { touch = 0.01, round = false, strength = 0.42, blurK = 0.22, minBlur = 0.008, maxBlur = 0.06, pad = 0 } = {}) {
  if (!root) return null;
  root.updateWorldMatrix(true, true);
  const origin = new THREE.Vector3().setFromMatrixPosition(root.matrixWorld);
  const yaw = yawOf(root);
  const pts = pointsOf(root, origin, yaw);
  if (!pts.length) return null;
  const f = footprint(pts, { touch });
  let top = -Infinity;
  for (const p of pts) top = Math.max(top, p[1]);
  const height = top - f.y0;
  const blur = Math.min(maxBlur, Math.max(minBlur, height * blurK));
  const rect = { x0: f.x0 - pad, x1: f.x1 + pad, z0: f.z0 - pad, z1: f.z1 + pad };
  return { name, surface, rect, blur, strength, round, heightAt, yaw, origin };
}

// The door leaf's shadow: under its bottom edge, measured in the hinge pivot's own frame (x along the leaf from the
// hinge, z across it). The earlier evening bake (the leaf open) had a sharp dark core about 2.4 cm wide under the 4 cm
// leaf: light reaches in under its 2.8 cm air gap. So its darkest part stops 6 mm in from the leaf's faces and fades
// over 2.5 cm, at 0.5 (the darkest of the others): the floor keeps half its light under the leaf, 80 % at its faces.
const LEAF = { strength: 0.5, blur: 0.025, inset: 0.006 };
function leafSpec(pivot, leaf, heightAt) {
  pivot.updateWorldMatrix(true, true);
  const toPivot = new THREE.Matrix4().copy(pivot.matrixWorld).invert().multiply(leaf.matrixWorld);
  const pos = leaf.geometry && leaf.geometry.attributes.position;
  if (!pos || !pos.count) return null;
  const v = new THREE.Vector3();
  const pts = [];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(toPivot);
    pts.push([v.x, v.y, v.z]);
  }
  const f = footprint(pts, { touch: 0.01 });
  const k = LEAF.inset;
  return {
    name: 'doorLeaf', surface: 'floor', rect: { x0: f.x0 + k, x1: f.x1 - k, z0: f.z0 + k, z1: f.z1 - k },
    blur: LEAF.blur, strength: LEAF.strength, round: false, heightAt,
    yaw: yawOf(pivot), origin: new THREE.Vector3().setFromMatrixPosition(pivot.matrixWorld),
  };
}

// Lays the leaf's shadow again on a frame in which the leaf has turned (its pivot's quaternion changed): each point's
// place in the leaf's frame through the pivot's world matrix, on the floor there; only those points are sent to the
// graphics card again. No allocation per frame. The item follows the leaf: its middle, its direction (hinge -> free
// edge) and its angle, read from the matrix (rotation.y alone reads 85 degrees for an opening of 95).
function liveLeaf(mesh, range, item, pivot, spec) {
  const attr = mesh.geometry.attributes.position;
  const local = mesh.geometry.attributes.aLocal.array;
  const cx = (spec.rect.x0 + spec.rect.x1) / 2;
  const cz = (spec.rect.z0 + spec.rect.z1) / 2;
  const q = pivot.quaternion;
  const seen = [NaN, NaN, NaN, NaN];
  function update() {
    if (q.x === seen[0] && q.y === seen[1] && q.z === seen[2] && q.w === seen[3]) return false;
    seen[0] = q.x; seen[1] = q.y; seen[2] = q.z; seen[3] = q.w;
    pivot.updateWorldMatrix(true, false);
    const e = pivot.matrixWorld.elements;
    const a = attr.array;
    const end = range.first + range.count;
    for (let k = range.first; k < end; k++) {
      const lx = local[k * 2] + cx;
      const lz = local[k * 2 + 1] + cz;
      const x = e[0] * lx + e[8] * lz + e[12];
      const z = e[2] * lx + e[10] * lz + e[14];
      a[k * 3] = x;
      a[k * 3 + 1] = spec.heightAt(x, z) + SHADOW.lift;
      a[k * 3 + 2] = z;
    }
    attr.clearUpdateRanges();
    attr.addUpdateRange(range.first * 3, range.count * 3);
    attr.needsUpdate = true;
    const n = Math.hypot(e[0], e[2]) || 1;
    item.dirX = e[0] / n;
    item.dirZ = e[2] / n;
    item.angle = Math.atan2(-item.dirZ, item.dirX);
    item.cx = e[0] * cx + e[8] * cz + e[12];
    item.cz = e[2] * cx + e[10] * cz + e[14];
    item.y = spec.heightAt(item.cx, item.cz) + SHADOW.lift;
    return true;
  }
  update();
  return { get item() { return item; }, mesh, first: range.first, count: range.count, update };
}

// The hallway's: the door's casings on the hallway wall, and the trolley. They belong to the start view, so main.js
// makes them with the hallway (createHallwayShadows) and the room's later.
function hallwaySpecs(ctx) {
  const L = ctx.layout;
  const F = ctx.fixtures || {};
  const specs = [];
  const onHall = () => 0;
  const H = ctx.hallway;
  // the door's casings stand a centimetre proud of the hallway wall: a soft line along their outer edges, as the
  // hallway lamp above and in front casts it (the start view had none: review 2026-10-19, visual finding 7)
  const door = F.door || ctx.door;
  if (door && H) {
    const Dr = L.door;
    const c = 0.05; // fixtures/door.js DOOR_DIMS.casing
    const wallZ = L.room.D + 0.12 + SHADOW.lift; // the hallway face of the door wall (scene/hallway.js)
    const onWall = (lx, lz) => [lx, lz, wallZ];
    const line = (name, rect, blur) => ({ name, surface: 'hallwayWall', rect, blur, strength: 0.26, round: false, heightAt: () => 0, place: onWall, cell: 0.25 });
    specs.push(
      line('casingLeft', { x0: Dr.x0 - c - 0.002, x1: Dr.x0 - c, z0: 0.07, z1: Dr.height + c }, 0.014),
      line('casingRight', { x0: Dr.x1 + c, x1: Dr.x1 + c + 0.002, z0: 0.07, z1: Dr.height + c }, 0.014),
      line('casingTop', { x0: Dr.x0 - c, x1: Dr.x1 + c, z0: Dr.height + c, z1: Dr.height + c + 0.003 }, 0.018),
    );
  }
  // the hallway trolley: a soft shadow under its deck and a dark spot under each castor
  if (H && H.parts && H.parts.trolley) {
    const t = H.parts.trolley;
    const deck = onSurface('trolley', t, 'hallway', onHall, { touch: Infinity, strength: 0.4, blurK: 0.12, minBlur: 0.1, maxBlur: 0.12, pad: -0.04 });
    if (deck) specs.push(deck);
    t.updateWorldMatrix(true, true);
    t.traverse((o) => {
      if (!o.isMesh || !o.geometry || o.geometry.type !== 'CylinderGeometry' || o.position.y > 0.1) return;
      const wp = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
      specs.push({ name: 'trolleyWheel', surface: 'hallway', rect: { x0: -0.018, x1: 0.018, z0: -0.03, z1: 0.03 }, blur: 0.025, strength: 0.5, round: true, heightAt: onHall, yaw: 0, origin: wp });
    });
  }
  return specs;
}

// The start view's shadows (one draw call): the casings' lines and the trolley's shadow.
export function createHallwayShadows(ctx) {
  const built = buildMesh(hallwaySpecs(ctx));
  built.mesh.name = 'contactShadows.hallway';
  return { group: built.mesh, items: built.items, meshes: [built.mesh] };
}

export function createContactShadows(ctx, { hallway = true } = {}) {
  const L = ctx.layout;
  const F = ctx.fixtures || {};
  const group = new THREE.Group();
  group.name = 'contactShadows';
  const top = counterTop(L);
  const onCounter = () => top;
  const onFloor = (x, z) => floorHeight(L, x, z);
  // the door leaf's floor: the room's, and past the door line (inside the oak threshold and the frame, never seen) the
  // room's floor carried on level from the door line, so no part in the room bends up toward the hallway's floor
  const onRoomFloor = (x, z) => floorHeight(L, x, Math.min(z, L.room.D));
  const specs = [
    onSurface('soapDispenser', F.soapDispenser && F.soapDispenser.group, 'counter', onCounter, { round: true, strength: 0.45 }),
    onSurface('toothbrushCup', F.toothbrushCup && F.toothbrushCup.group, 'counter', onCounter, { round: true, strength: 0.45 }),
    onSurface('phone', F.phone && F.phone.group, 'counter', onCounter, { touch: 0.02, strength: 0.5, minBlur: 0.006 }),
    onSurface('clipboard', F.clipboard && F.clipboard.parts.board, 'counter', onCounter, { touch: 0.02, strength: 0.4, minBlur: 0.005, maxBlur: 0.008 }),
    // the vessel basin's bowl overhangs its foot: the counter under its rim is in its shadow (the lamps are above)
    onSurface('basin', F.vanity && F.vanity.parts.basinOuter, 'counter', onCounter, { touch: Infinity, round: true, strength: 0.38, blurK: 0.25, pad: -0.012 }),
    // the washer tower stands in its steel tray on the falling floor
    onSurface('washerTower', F.washerTower && F.washerTower.parts.tray, 'floor', onFloor, { touch: 0.04, strength: 0.42, minBlur: 0.035, maxBlur: 0.035 }),
    // the bathroom scale, 5 mm up on its feet: its base (set in under the platform) on the falling floor
    onSurface('scale', F.scale && F.scale.group, 'floor', onFloor, { touch: 0.008, strength: 0.42, minBlur: 0.02, maxBlur: 0.03 }),
  ].filter(Boolean);
  // the door leaf: its shadow turns with it (in the same draw call; only its own points are laid again)
  const door = F.door || ctx.door;
  const leafPivot = door && door.parts ? door.parts.leafPivot : null;
  const leafSp = leafPivot && door.parts.leaf ? leafSpec(leafPivot, door.parts.leaf, onRoomFloor) : null;
  if (leafSp) specs.push(leafSp);
  if (hallway) specs.push(...hallwaySpecs(ctx));
  const built = buildMesh(specs);
  group.add(built.mesh);
  const meshes = [built.mesh];
  let doorShadow = null;
  if (leafSp) {
    const i = specs.indexOf(leafSp);
    doorShadow = liveLeaf(built.mesh, built.ranges[i], built.items[i], leafPivot, leafSp);
    if (ctx.loop && ctx.loop.add) ctx.loop.add(() => { doorShadow.update(); return false; });
  }

  // the stamp moves (it stands beside the board after a visit is sent): its shadow rides with it
  const stamp = F.clipboard && F.clipboard.parts.stamp;
  let stampItem = null;
  if (stamp) {
    const sp = onSurface('stamp', stamp, 'sheet', () => 0, { touch: 0.004, round: false, strength: 0.4, minBlur: 0.008, maxBlur: 0.012 });
    if (sp) {
      // built in the stamp's own frame: at its base, lying on the paper under it
      const inv = new THREE.Matrix4().copy(stamp.matrixWorld).invert();
      const o = sp.origin.clone().applyMatrix4(inv);
      const local = buildMesh([{ ...sp, origin: o, yaw: 0, heightAt: () => -0.0003 }]);
      stamp.add(local.mesh);
      meshes.push(local.mesh);
      stampItem = local.items[0];
    }
  }

  // the floor-standing toilet (swapped in from the hallway): floor round its foot, the wall round its cistern
  let toiletMesh = null;
  let toiletItems = [];
  function setToilet(t) {
    if (toiletMesh) {
      toiletMesh.removeFromParent();
      toiletMesh.geometry.dispose();
      toiletMesh.material.dispose();
      toiletMesh = null;
    }
    toiletItems = [];
    if (!t || t.parts.boxing || !t.group) return;
    const foot = onSurface('toilet', t.group, 'floor', onFloor, { touch: 0.03, strength: 0.48, minBlur: 0.045, maxBlur: 0.06 });
    const specsT = foot ? [foot] : [];
    // a soft shadow on the tiles round the cistern's back edge (it stands a centimetre off the wall)
    const tank = t.parts.tank;
    if (tank) {
      tank.updateWorldMatrix(true, false);
      const b = new THREE.Box3().setFromObject(tank);
      const wallX = L.room.W - 0.0008;
      // standing on the right wall: the shadow's own "x" runs along the wall (room z), its "z" up the wall (room y)
      specsT.push({
        name: 'toiletWall', surface: 'wall_right', rect: { x0: b.min.z, x1: b.max.z, z0: b.min.y, z1: b.max.y },
        blur: 0.045, strength: 0.3, round: false, heightAt: () => 0, place: (lx, lz) => [wallX, lz, lx], cell: 0.1,
      });
    }
    const built2 = buildMesh(specsT);
    toiletMesh = built2.mesh;
    toiletItems = built2.items;
    group.add(toiletMesh);
  }
  setToilet(F.toilet);

  // ---- shadows for new things (see the top): one more draw call for all of them, made again when one is added,
  // refreshed or removed (never every frame)
  const added = new Map(); // object -> { opts, spec, item, handle }
  let addedMesh = null;
  function rebuildAdded() {
    if (addedMesh) {
      addedMesh.removeFromParent();
      addedMesh.geometry.dispose();
      addedMesh.material.dispose();
      addedMesh = null;
    }
    const list = [...added.values()];
    if (!list.length) return;
    const b = buildMesh(list.map((e) => e.spec));
    b.mesh.name = 'contactShadows.added';
    list.forEach((e, i) => { e.item = b.items[i]; });
    addedMesh = b.mesh;
    group.add(addedMesh);
  }
  function addedSpec(object, o) {
    const kind = o.kind || 'floor';
    let heightAt = kind === 'floor' ? onFloor : kind === 'counter' ? onCounter : null;
    if (kind === 'level') { // any other level surface: at the thing's own lowest point (its origin's, if it has none)
      object.updateWorldMatrix(true, true);
      const at = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
      let y0 = Infinity;
      for (const p of pointsOf(object, at, 0)) y0 = Math.min(y0, p[1]);
      const y = Number.isFinite(y0) ? y0 : at.y;
      heightAt = () => y;
    }
    if (!heightAt) {
      console.warn(`contact shadow: no surface "${kind}" (floor, counter or level)`);
      return null;
    }
    const name = o.name || object.name || 'added';
    const strength = o.strength ?? 0.42;
    const round = !!o.round;
    const pad = o.pad || 0;
    const fp = o.footprint;
    if (fp && typeof fp === 'object') { // a given size, in the thing's own turned frame about its origin
      const d = fp.d ?? fp.w;
      const r = 'w' in fp ? { x0: -fp.w / 2, x1: fp.w / 2, z0: -d / 2, z1: d / 2 } : { x0: fp.x0, x1: fp.x1, z0: fp.z0, z1: fp.z1 };
      if (![r.x0, r.x1, r.z0, r.z1].every(Number.isFinite) || r.x1 <= r.x0 || r.z1 <= r.z0) {
        console.warn(`contact shadow: footprint of "${name}" is not a size`);
        return null;
      }
      object.updateWorldMatrix(true, true);
      const origin = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
      const yaw = yawOf(object);
      let blur = o.blur;
      if (blur == null) { // as onSurface: by its height, if it has anything to measure
        let y0 = Infinity;
        let y1 = -Infinity;
        for (const p of pointsOf(object, origin, yaw)) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
        blur = y1 >= y0 ? Math.min(0.06, Math.max(0.008, (y1 - y0) * 0.22)) : 0.02;
      }
      const rect = { x0: r.x0 - pad, x1: r.x1 + pad, z0: r.z0 - pad, z1: r.z1 + pad };
      return { name, surface: kind, rect, blur, strength, round, heightAt, yaw, origin };
    }
    const fixed = o.blur != null ? { minBlur: o.blur, maxBlur: o.blur } : {};
    return onSurface(name, object, kind, heightAt, { touch: fp === 'outline' ? Infinity : o.touch ?? 0.01, round, strength, pad, ...fixed });
  }
  function add(object, opts = {}) {
    if (!object || !object.isObject3D) return null;
    const spec = addedSpec(object, opts);
    if (!spec) return null;
    let entry = added.get(object);
    if (!entry) {
      const e = { opts, spec, item: null, handle: null };
      e.handle = {
        get item() { return e.item; },
        // measure it again where it now stands (after it has moved); false when it is gone or has nothing to measure
        refresh() {
          if (added.get(object) !== e) return false;
          const sp = addedSpec(object, e.opts);
          if (!sp) { added.delete(object); rebuildAdded(); return false; }
          e.spec = sp;
          rebuildAdded();
          return true;
        },
        remove() {
          if (added.get(object) !== e) return false;
          added.delete(object);
          rebuildAdded();
          return true;
        },
      };
      added.set(object, e);
      entry = e;
    }
    entry.opts = opts;
    entry.spec = spec;
    rebuildAdded();
    return entry.handle;
  }

  // ---- the photographed models (fixtures/plants.js) get theirs when they arrive (their fixture's ready; a failed
  // download leaves the fixture empty: no shadow). The pots and the basket are wider at the rim than at the foot: a
  // foot-sized shadow would hide under the rim, so theirs is their outline from above. Turning a round pot or the
  // basket's small give does not move a shadow (no refresh).
  const arrivals = [
    ['plants', 'leafyPlantPot', 'leafyPlant', { kind: 'floor', footprint: 'outline', round: true }],
    ['plants', 'succulentPot', 'succulent', { kind: 'level', footprint: 'outline', round: true }],
    ['duck', 'body', 'duck', { kind: 'level' }],
    ['basket', 'body', 'basket', { kind: 'floor', footprint: 'outline' }],
  ];
  for (const key of new Set(arrivals.map((a) => a[0]))) {
    const f = F[key];
    if (!f || !f.ready || typeof f.ready.then !== 'function') continue;
    f.ready.then(() => {
      for (const [k, part, name, o] of arrivals) if (k === key && f.parts[part]) add(f.parts[part], { ...o, name });
      if (ctx.loop && ctx.loop.wake) ctx.loop.wake(200);
    }, () => {});
  }

  return {
    group,
    get items() { return built.items.concat(stampItem ? [stampItem] : []); },
    get toiletItems() { return toiletItems; },
    get meshes() { return meshes.concat(toiletMesh ? [toiletMesh] : [], addedMesh ? [addedMesh] : []); },
    get addedItems() { return [...added.values()].map((e) => e.item); },
    setToilet,
    door: doorShadow,
    add,
  };
}
