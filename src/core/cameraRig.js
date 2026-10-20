// The visitor's eye. Only the visitor's own input moves it (concept rule 1): look (drag), walk and slide (wheel, keys,
// pinch, a tap on the floor = walk there). Every input moves a TARGET; the eye glides after it each frame (a short,
// even ease), so a mouse wheel's steps, a jittery drag and a key press all turn into smooth motion. A released look
// drag keeps a little of its swing, like turning your head. Nothing else calls these.
import * as THREE from 'three';
import { createWalkArea } from './walkArea.js';

export const RIG = {
  lookEase: 0.075, // seconds: how quickly the view catches up with the finger or mouse
  moveEase: 0.18, // seconds: how quickly the body catches up with a step
  walkSpeed: 1.25, // m/s with the keys
  tapWalkSpeed: 1.1, // m/s walking to a tapped spot
  turnSpeed: 1.6, // rad/s with the arrow keys
  flingKeep: 0.12, // seconds of swing kept after a look drag is let go
  swipeTurn: Math.PI / 2, // a finger swiped across the whole screen width turns this far (never slower than 1:1)
};

export function createCameraRig(camera, layout) {
  const walk = createWalkArea(layout);
  const pos = new THREE.Vector3(layout.camera.start.x, layout.camera.eye, layout.camera.start.z);
  const tPos = pos.clone();
  const look = layout.camera.lookAt;
  let yaw = Math.atan2(-(look.x - pos.x), -(look.z - pos.z)); // 0 = looking toward -z
  let pitch = Math.atan2(look.y - pos.y, Math.hypot(look.x - pos.x, look.z - pos.z));
  let tYaw = yaw;
  let tPitch = pitch;
  const PITCH_MIN = -1.25;
  const PITCH_MAX = 1.1;
  const keys = { fwd: 0, side: 0, turn: 0 };
  let walkTo = null; // [{ x, z }, ...] while walking to a tapped spot (through the doorway when it lies between)
  let fling = { yaw: 0, pitch: 0 }; // rad/s left over from a released look drag
  let lastLook = { yaw: 0, pitch: 0, t: -1e9 }; // the drag's latest speed (rad/s) and when
  let held = false; // a finger or button is down on the view
  let walked = 0; // metres since the last footstep (for the footstep sound)
  let onStep = null;

  const clampPitch = (p) => Math.min(PITCH_MAX, Math.max(PITCH_MIN, p));

  function apply() {
    camera.position.copy(pos);
    camera.rotation.set(0, 0, 0, 'YXZ');
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
  }

  // Move the target by (fwd, side) metres relative to where the eye looks, through the walk rules.
  function moveTarget(fwd, side) {
    const fx = -Math.sin(tYaw);
    const fz = -Math.cos(tYaw);
    const tx = tPos.x + fx * fwd + Math.cos(tYaw) * side;
    const tz = tPos.z + fz * fwd - Math.sin(tYaw) * side;
    const p = walk.constrain(tPos.x, tPos.z, tx, tz);
    tPos.x = p.x;
    tPos.z = p.z;
  }

  // dx, dy in CSS pixels from a look drag; the view follows the finger (drag the room), one screen height = one fov.
  // A finger on a phone turns faster sideways: one swipe across the screen is a quarter turn (every wall of the room is
  // a quarter turn away, and an upright phone sees only about 37 degrees across); up and down stay 1:1, and a mouse
  // keeps the 1:1 feel both ways.
  function lookBy(dx, dy, viewH, { touch = false, viewW = 0 } = {}) {
    const k = (camera.fov * Math.PI) / 180 / Math.max(200, viewH);
    const kYaw = touch && viewW > 0 ? Math.max(k, RIG.swipeTurn / Math.max(200, viewW)) : k;
    const now = performance.now();
    const dtS = Math.max(0.008, Math.min(0.1, (now - lastLook.t) / 1000));
    tYaw += dx * kYaw;
    tPitch = clampPitch(tPitch + dy * k);
    lastLook = { yaw: (dx * kYaw) / dtS, pitch: (dy * k) / dtS, t: now };
    fling = { yaw: 0, pitch: 0 };
  }

  // Stand still right where the eye is now: no walk, no glide, no swing (a paper was lifted to read).
  function stop() {
    walkTo = null;
    keys.fwd = keys.side = keys.turn = 0;
    fling = { yaw: 0, pitch: 0 };
    tPos.copy(pos);
    tYaw = yaw;
    tPitch = pitch;
  }

  function dollyBy(metres) { walkTo = null; moveTarget(metres, 0); }
  function slideBy(metresX) { walkTo = null; moveTarget(0, metresX); }

  // A finger or button went down on the view: stop any swing where it is.
  function hold() {
    held = true;
    fling = { yaw: 0, pitch: 0 };
    tYaw = yaw;
    tPitch = pitch;
  }

  // ... and lifted: a quick flick keeps a little swing, a slow drag stops where it is.
  function release() {
    held = false;
    if (performance.now() - lastLook.t < 60) fling = { yaw: lastLook.yaw * 0.6, pitch: lastLook.pitch * 0.6 };
  }

  // Walk to a spot on the floor (a tap on it): the eye glides there at walking pace, keeping its direction of view;
  // between hallway and room it goes through the middle of the doorway: from a step in front of it on this side to a
  // step past it on the other. An eye already standing in the doorway (after a tap on the threshold) goes straight on,
  // never back a step first; a spot in the doorway itself (the threshold) is walked to straight along it.
  function walkToPoint(x, z) {
    const D = layout.room.D;
    const doorX = (layout.door.x0 + layout.door.x1) / 2;
    const hallSide = { x: doorX, z: D + 0.35 };
    const roomSide = { x: doorX, z: D - 0.4 };
    const inDoorway = (px, pz) => px >= layout.door.x0 && px <= layout.door.x1 && pz > roomSide.z && pz < hallSide.z;
    const fromHall = tPos.z > D;
    const toHall = z > D;
    walkTo = [];
    if (fromHall !== toHall && walk.doorOpen) {
      if (!inDoorway(tPos.x, tPos.z)) walkTo.push(fromHall ? hallSide : roomSide);
      if (!inDoorway(x, z)) walkTo.push(fromHall ? roomSide : hallSide);
    }
    walkTo.push({ x, z });
  }

  // The keyboard: fwd/side/turn each -1, 0 or 1 (W/S/up/down, A/D, left/right).
  function setKeys(k) { Object.assign(keys, k); if (k.fwd || k.side) walkTo = null; }

  function update(dtMs) {
    const dt = Math.min(0.1, Math.max(0, dtMs) / 1000);
    if (keys.turn) tYaw += keys.turn * RIG.turnSpeed * dt;
    if (keys.fwd || keys.side) moveTarget(keys.fwd * RIG.walkSpeed * dt, keys.side * RIG.walkSpeed * dt);
    if (walkTo) {
      const goal = walkTo[0];
      const dx = goal.x - tPos.x;
      const dz = goal.z - tPos.z;
      const d = Math.hypot(dx, dz);
      const stepLen = Math.min(d, RIG.tapWalkSpeed * dt);
      const before = tPos.clone();
      if (d > 0.005) {
        const p = walk.constrain(tPos.x, tPos.z, tPos.x + (dx / d) * stepLen, tPos.z + (dz / d) * stepLen);
        tPos.x = p.x;
        tPos.z = p.z;
      }
      if (d <= 0.005) walkTo.shift(); // this leg is done
      else if (before.distanceTo(tPos) < 1e-5) walkTo = []; // a wall or a fixture is in the way: stop there
      if (!walkTo.length) walkTo = null;
    }
    if (!held && (fling.yaw || fling.pitch)) {
      tYaw += fling.yaw * dt;
      tPitch = clampPitch(tPitch + fling.pitch * dt);
      const keep = Math.exp(-dt / RIG.flingKeep);
      fling.yaw *= keep;
      fling.pitch *= keep;
      if (Math.abs(fling.yaw) + Math.abs(fling.pitch) < 0.01) fling = { yaw: 0, pitch: 0 };
    }
    // the eye glides after its targets
    const a = 1 - Math.exp(-dt / RIG.lookEase);
    const b = 1 - Math.exp(-dt / RIG.moveEase);
    yaw += (tYaw - yaw) * a;
    pitch += (tPitch - pitch) * a;
    const ox = pos.x;
    const oz = pos.z;
    pos.x += (tPos.x - pos.x) * b;
    pos.z += (tPos.z - pos.z) * b;
    walked += Math.hypot(pos.x - ox, pos.z - oz);
    if (walked > 0.62) { walked = 0; if (onStep) onStep(); }
    apply();
    const settling = Math.abs(tYaw - yaw) > 1e-4 || Math.abs(tPitch - pitch) > 1e-4 || pos.distanceTo(tPos) > 1e-4;
    return settling || !!walkTo || !!(keys.fwd || keys.side || keys.turn) || !!(fling.yaw || fling.pitch);
  }

  apply();
  return {
    lookBy, dollyBy, slideBy, release, hold, update, walkToPoint, setKeys, stop,
    set onStep(fn) { onStep = fn; },
    get walking() { return !!walkTo || !!(keys.fwd || keys.side); },
    // Test runs only (the browser checks put the eye where a visitor would stand); the app itself never calls it.
    testPose(x, z, yawRad, pitchRad) {
      pos.x = tPos.x = x; pos.z = tPos.z = z; yaw = tYaw = yawRad; pitch = tPitch = pitchRad;
      fling = { yaw: 0, pitch: 0 };
      walkTo = null;
      apply();
    },
    get position() { return pos; },
    get yaw() { return yaw; },
    get pitch() { return pitch; },
    walkArea: walk,
  };
}
