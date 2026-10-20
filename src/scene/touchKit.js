// Shared helpers for the touch wiring (scene/entrance.js, scene/clipboardWiring.js, scene/interactions.js): joint
// tweens, finger-sized touch boxes, drags along a joint's own path, freeing what a removed thing held on the graphics
// card, and the timings the tests and the browser checks lean on.
import * as THREE from 'three';
import { setJoint } from '../fixtures/util.js';

export const WIRING = {
  doorOpen: 1.66, // rad
  doorRepeatMs: 500, // a second tap on the door this soon after it started moving is part of the same double-tap
  mailFallbackMs: 1500, // the page still showing this long after the mail was asked for: the envelope rises
  swapBusyMs: 1400, // the delivery box ignores taps while a swap is under way
  refillMs: 5000, // a flush's cistern refill, after its own delay; the button only clicks until then
  envelopeText: 'Trykk for å åpne e-posten',
};

export const jv = (p) => p.userData.joint.value;
export const nowMs = () => performance.now();
export const pageVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
export const noMail = () => typeof location !== 'undefined' && new URLSearchParams(location.search).has('nomail');

// A tween on a joint (the moving parts are pivots, fixtures/util.js); set = how a value is applied (a coupled part).
export function jointTweener(tweens, loop) {
  return function tweenJoint(p, to, ms, ease = 'outCubic', onDone, delay = 0, set = setJoint) {
    tweens.add({ key: `j${p.uuid}`, from: jv(p), to, duration: ms, ease, delay, onUpdate: (v) => set(p, v), onDone });
    loop.wake(ms + delay + 150);
  };
}

// The invisible material of every touch box (one shared instance).
export const HIT = new THREE.MeshBasicMaterial({ visible: false });

// Small controls get an invisible, finger-sized touch box that moves with them (a fingertip covers about 1 cm of a
// basin tap at arm's length on a phone, so the real parts alone are too small to hit). min = the box's smallest side.
export function fingerBoxMaker(interaction) {
  return function fingerBox(root, handler, min = 0.07, pad = 0.015) {
    if (!root) return null;
    root.updateWorldMatrix(true, true);
    const world = new THREE.Box3();
    root.traverse((o) => { if (o.isMesh && !o.userData.touchBox) world.expandByObject(o); });
    if (world.isEmpty()) return null;
    const inv = root.matrixWorld.clone().invert();
    const local = new THREE.Box3();
    for (const x of [world.min.x, world.max.x]) for (const y of [world.min.y, world.max.y]) for (const z of [world.min.z, world.max.z]) {
      local.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(inv));
    }
    const size = local.getSize(new THREE.Vector3());
    const centre = local.getCenter(new THREE.Vector3());
    const box = new THREE.Mesh(new THREE.BoxGeometry(Math.max(min, size.x + pad), Math.max(min, size.y + pad), Math.max(min, size.z + pad)), HIT);
    box.position.copy(centre);
    box.name = `${root.name}.touch`;
    box.userData.touchBox = true;
    root.add(box);
    interaction.register(box, handler);
    return box;
  };
}

// world direction of a joint's axis (slides move, hinges turn, in the pivot's parent frame)
export function axisW(p) {
  p.parent.updateWorldMatrix(true, false);
  return new THREE.Vector3().fromArray(p.userData.joint.axis).normalize().transformDirection(p.parent.matrixWorld);
}

// a slide joint worked by dragging along its own path
export function slideDragMaker(tweens, loop) {
  return function slideDrag(p, { onChange, onEnd } = {}) {
    let start = 0;
    return {
      dragAxis: () => axisW(p),
      dragStart() { start = jv(p); tweens.cancel(`j${p.uuid}`); },
      // (the joint is set first: `onChange?.(setJoint(...))` would skip the setJoint when there is no onChange)
      drag(m) { if (m == null) return; const v = setJoint(p, start + m); onChange?.(v); loop.wake(200); },
      dragEnd() { onEnd?.(jv(p)); },
    };
  };
}

// a hinge worked by dragging the touched point around its axis (set: how the angle is applied)
export function hingeDragMaker(tweens, loop) {
  const V = new THREE.Vector3();
  return function hingeDrag(p, { onChange, onEnd, set = setJoint } = {}) {
    let start = 0;
    let r = 0.1;
    return {
      dragAxis: (hit) => {
        const a = axisW(p);
        const rel = hit.point.clone().sub(p.getWorldPosition(V));
        const radial = rel.sub(a.clone().multiplyScalar(rel.dot(a)));
        r = Math.max(0.03, radial.length());
        return a.cross(radial).normalize();
      },
      dragStart() { start = jv(p); tweens.cancel(`j${p.uuid}`); },
      drag(m) { if (m == null) return; const v = set(p, start + m / r); onChange?.(v); loop.wake(200); },
      dragEnd() { onEnd?.(jv(p)); },
    };
  };
}

// What a removed thing held on the graphics card (its geometries, its own materials and their textures) is freed;
// anything still used in the scene, the shared material library and the touch boxes' material stay.
// Returns how many geometries, materials and textures were freed.
export function disposeRemoved(scene, root, materials) {
  const isLibrary = (m) => !!materials && typeof materials.has === 'function' && materials.has(m.name) && materials.get(m.name) === m;
  const texturesOf = (m) => Object.values(m).filter((v) => v && v.isTexture);
  const geos = new Set();
  const mats = new Set();
  root.traverse((o) => {
    if (o.geometry) geos.add(o.geometry);
    if (o.material) for (const m of [].concat(o.material)) mats.add(m);
  });
  const usedG = new Set();
  const usedM = new Set();
  scene.traverse((o) => {
    if (o.geometry) usedG.add(o.geometry);
    if (o.material) for (const m of [].concat(o.material)) usedM.add(m);
  });
  const usedT = new Set();
  for (const m of usedM) for (const t of texturesOf(m)) usedT.add(t);
  const freed = { geometries: 0, materials: 0, textures: 0 };
  for (const g of geos) if (!usedG.has(g)) { g.dispose(); freed.geometries++; }
  for (const m of mats) {
    if (usedM.has(m) || isLibrary(m) || m === HIT) continue;
    for (const t of texturesOf(m)) if (!usedT.has(t)) { t.dispose(); usedT.add(t); freed.textures++; }
    m.dispose();
    freed.materials++;
  }
  return freed;
}
