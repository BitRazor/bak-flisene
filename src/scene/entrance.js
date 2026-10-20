// The entrance: what the visitor sees and can touch before the room behind the door has loaded (concept section 1: the
// closed door with the light under it is what you see while the room loads). main.js calls installEntrance(ctx) as
// soon as the hallway and the door exist; scene/interactions.js install(ctx) wires the rest of the room and calls
// setReady(). A tap on the door before then presses the handle, and the door opens the moment the room is ready.
//
// The door: a tap decides by where the visitor wants it (open or shut), never by its angle, and a second tap within
// half a second is the other half of a double-tap. A swing stops at the visitor instead of passing through them (the
// leaf is an obstacle in the walk area at whatever angle it stands). The WC lock turns, and holds a shut door shut.
// The oak threshold is floor (a tap there walks through the doorway); the frame, casings and hinges only knock.
import * as THREE from 'three';
import { setJoint } from '../fixtures/util.js';
import { WIRING, jv, nowMs, jointTweener, fingerBoxMaker } from './touchKit.js';

// The line of light under the shut door, on screen (sRGB) per light mood: a warm light a little lighter than the oak
// round it (on screen at 375 x 812, measured 2026-10-20: evening (174, 144, 115), day (146, 101, 60)).
export const GAP_LIGHT = { evening: [198, 164, 122], day: [165, 121, 78] };

export function installEntrance(ctx) {
  const { scene, interaction, audio, tweens, loop, layout: L } = ctx;
  const door = ctx.door || (ctx.fixtures && ctx.fixtures.door);
  const hall = ctx.hallway;
  const walk = ctx.rig.walkArea;
  const play = (role, o) => audio.play(role, o);
  const tweenJoint = jointTweener(tweens, loop);
  const fingerBox = fingerBoxMaker(interaction);
  const reg = (root, h) => { if (root) root.traverse((o) => { if (o.isMesh) interaction.register(o, h); }); return h; };
  const hooks = { found: () => {}, firstOpen: () => {} };
  const leaf = door.parts.leafPivot;
  const OPEN = WIRING.doorOpen;
  let ready = false;
  let pending = false; // the visitor tapped the door before the room had loaded
  let doorOpen = false; // where the visitor wants the door (open or shut); the leaf follows
  let blockedOpen = false; // an opening swing stopped at the visitor: the next tap tries to open again
  let movedAt = -1e9;
  let swingDir = 0; // +1 opening, -1 closing, 0 still
  let opened = false;
  let lockTarget = !!door.isLocked();

  // the room's light through the 1 cm air gap under the closed door (the gap is for the bathroom's air supply; the
  // owner: a small, barely visible gap over the oak threshold): the gap itself, between the threshold's top and the
  // leaf's foot, just in front of the leaf's hallway face, between the door stops (12 mm each side) — about 2 px from
  // the start spot on a phone. It sat 8 cm in front of the leaf and read as a grey seam at night and a dark one by day
  // (the look, 2026-10-20, look3 defect 2). Unlit and outside the camera's tone curve: on screen it is GAP_LIGHT's
  // colour for the light mood, a warm light a little lighter than the oak. It fades out as the door opens and back in
  // when it shuts by its opacity, in its own colour (a fade of its colour drew a black line across the threshold at
  // every opening, the look 2026-10-20), so it stays transparent. main.js marks it for the view gate: it is the
  // hallway's, seen while the door is shut (scene/roomEnvironment.js gateHallway).
  const lit = GAP_LIGHT[ctx.lightMood && ctx.lightMood.bake === 'day' ? 'day' : 'evening'];
  const glowColour = new THREE.Color().setRGB(lit[0] / 255, lit[1] / 255, lit[2] / 255, THREE.SRGBColorSpace);
  const gapH = 0.0095; // the 10 mm gap, a quarter millimetre clear of the threshold and of the leaf
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(L.door.x1 - L.door.x0 - 0.024, gapH),
    new THREE.MeshBasicMaterial({ color: glowColour.clone(), transparent: true, opacity: 1, toneMapped: false }),
  );
  glow.name = 'door.gapLight';
  door.anchors.doorGap.getWorldPosition(glow.position); // the gap's middle (its height, the leaf's middle)
  glow.position.z = L.room.D + L.door.thickness + 0.001;
  scene.add(glow);
  // Its strength: the door's share (shut 1, open 0) times the room's light (the lamps low: only that much light comes
  // through the gap; with the lamps off it stayed lit, review4 2026-10-20).
  let doorK = 1;
  let lightK = 1;
  const applyGlow = () => {
    glow.material.opacity = doorK * lightK;
    glow.visible = glow.material.opacity > 0.01;
  };
  const glowTo = (to, ms) => {
    glow.visible = true;
    tweens.add({
      key: 'glow', from: doorK, to, duration: ms,
      onUpdate: (v) => { doorK = v; applyGlow(); },
      onDone: () => { doorK = to; applyGlow(); },
    });
    loop.wake(ms + 100);
  };
  const setLightLevel = (level) => {
    const to = Math.min(1, Math.max(0, level));
    tweens.add({
      key: 'glowLight', from: lightK, to, duration: 300,
      onUpdate: (v) => { lightK = v; applyGlow(); },
      onDone: () => { lightK = to; applyGlow(); },
    });
    loop.wake(400);
  };

  // the leaf is an obstacle where it stands, and a swing that would reach the visitor stops there
  walk.setDoorLeaf(jv(leaf));
  loop.add(() => {
    const a = jv(leaf);
    walk.setDoorLeaf(a);
    if (swingDir) {
      const eye = ctx.rig.position;
      const ahead = a + swingDir * 0.05;
      const d1 = walk.leafDistance(eye.x, eye.z, ahead);
      if (ahead > 0.02 && d1 < walk.leafReach && d1 < walk.leafDistance(eye.x, eye.z, a) - 1e-4) stopSwingAtVisitor(a);
    }
    return false;
  });

  function swing(to, ms, ease, delay, onDone) {
    swingDir = Math.sign(to - jv(leaf));
    tweenJoint(leaf, to, Math.max(250, ms), ease, () => { swingDir = 0; onDone?.(); }, delay);
  }
  function stopSwingAtVisitor(a) {
    const dir = swingDir;
    swingDir = 0;
    tweens.cancel(`j${leaf.uuid}`);
    setJoint(leaf, a);
    play('knock_wood', { volume: 0.35, rate: 0.8 }); // the door bumps against you
    if (dir < 0) { doorOpen = true; swing(OPEN, 700, 'inOutSine', 120); } // a closing door swings back open
    else blockedOpen = true; // an opening door stops where you stand; step back and tap again
  }

  function pressHandle() {
    tweenJoint(door.parts.handlePivot, 0.6, 140, 'outCubic', () => tweenJoint(door.parts.handlePivot, 0, 260, 'outBack'));
  }
  // Which side of the door the visitor stands on: the thumb-turn is inside, the outside has only the emergency release.
  const inside = () => ctx.rig.position.z < ctx.layout.room.D;
  let rattledAt = -1e9;
  function openDoor() {
    const shut = jv(leaf) < 0.02;
    movedAt = nowMs();
    if (shut && lockTarget) {
      if (!inside() && nowMs() - rattledAt < 4000) {
        // a second try from the hallway: the outside emergency release turns the lock open (as on a real WC lock)
        lockTarget = false;
        tweenJoint(door.parts.thumbTurnPivot, 0, 220, 'outCubic', () => door.setLocked(false));
        door.setLocked(false);
        play('switch_click', { volume: 0.8, rate: 0.8 });
      } else { // the WC lock holds it: the handle goes down, the latch rattles, the door stays
        rattledAt = nowMs();
        pressHandle();
        audio.unlock().then(() => play('door_latch', { volume: 0.7, rate: 0.9 }));
        return;
      }
    }
    doorOpen = true;
    blockedOpen = false;
    const first = !opened;
    opened = true;
    audio.unlock().then(() => {
      if (first) hooks.firstOpen();
      if (shut) play('door_latch', { volume: 0.8 });
      play('door_open', { volume: 0.9, delay: shut ? 0.12 : 0 });
    });
    if (shut) pressHandle();
    swing(OPEN, 2300 * Math.max(0.3, 1 - jv(leaf) / OPEN), 'inOutSine', shut ? 160 : 0);
    glowTo(0, 500);
  }
  function closeDoor() {
    doorOpen = false;
    blockedOpen = false;
    movedAt = nowMs();
    swing(0, 1600 * Math.max(0.3, jv(leaf) / OPEN), 'inOutSine', 0, () => {
      if (doorOpen) return;
      play('door_close', { volume: 0.9 });
      glowTo(1, 400);
    });
  }
  function toggleLock() {
    lockTarget = !lockTarget;
    const locked = lockTarget;
    // the thumb-turn turns first; the lock is set when it gets there
    tweenJoint(door.parts.thumbTurnPivot, locked ? Math.PI / 2 : 0, 220, 'outCubic', () => door.setLocked(locked));
    play('switch_click', { volume: 0.9 });
    hooks.found('lock');
  }
  function doorTap() {
    if (nowMs() - movedAt < WIRING.doorRepeatMs) return; // the second half of a double-tap
    if (!ready) { // the room behind is still loading: the handle answers, the door opens as soon as it can
      pending = true;
      movedAt = nowMs();
      pressHandle();
      audio.unlock().then(() => play('door_latch', { volume: 0.6 }));
      return;
    }
    if (doorOpen && !blockedOpen) closeDoor(); else openDoor();
  }

  reg(leaf, { tap: doorTap, knock: 'wood' });
  // the lock turns only from inside; from the hallway the same spot (just under the handle) works the door
  const lockHandler = { tap: () => (inside() ? toggleLock() : doorTap()), knock: 'metal' };
  reg(door.parts.thumbTurnPivot, lockHandler);
  fingerBox(door.parts.thumbTurnPivot, lockHandler, 0.06);
  for (const f of [door.parts.frame, door.parts.frameHall]) if (f) reg(f, { knock: 'wood' });
  reg(door.parts.hinges, { knock: 'metal' });

  // walking: a tap on the floor walks there (soft footsteps); the eye keeps looking where it looked. A tap where the
  // visitor already stands gets a soft knock instead of nothing.
  ctx.rig.onStep = () => play('footstep_wet', { volume: 0.22, rate: 0.95 });
  function walkHere(hit, kind = 'tile') {
    const eye = ctx.rig.position;
    if (Math.hypot(hit.point.x - eye.x, hit.point.z - eye.z) < 0.15) {
      play(`knock_${kind}`, { volume: 0.3, rate: 0.85 });
      return false;
    }
    ctx.rig.walkToPoint(hit.point.x, hit.point.z);
    loop.wake(400);
    return true;
  }
  const floorHandler = (kind) => ({ tap: (hit) => walkHere(hit, kind), knock: kind, repeat: true, cursor: 'walk' });
  interaction.register(hall.parts.floor, floorHandler('wood'));
  reg(door.parts.threshold, floorHandler('wood'));
  for (const o of hall.parts.walls) interaction.register(o, { knock: o.userData.knock || 'paint' });
  // the doormat: a tap opens a shut door; once it is open, the mat is floor like the rest
  reg(hall.parts.doormat, {
    tap: (hit) => { if (!doorOpen || !ready) doorTap(); else walkHere(hit, 'wood'); },
    knock: 'wood', repeat: true, cursor: 'walk',
  });
  // the trolley knocks until the room is ready (then its box swaps the toilet)
  reg(hall.parts.trolley, { knock: 'wood' });
  ctx.rig.walkArea.setDoorLeaf(jv(leaf));
  loop.wake(1500);

  return {
    hooks, glow, walkHere, floorHandler, toggleLock, setLightLevel,
    tap: doorTap,
    openDoor: () => { if (!ready) { pending = true; return; } openDoor(); },
    closeDoor,
    get open() { return doorOpen; },
    get ready() { return ready; },
    get pending() { return pending; },
    get locked() { return lockTarget; },
    // the room behind the door has loaded: a door tapped while it loaded opens now
    setReady() {
      if (ready) return;
      ready = true;
      if (pending) { pending = false; movedAt = -1e9; openDoor(); }
    },
  };
}
