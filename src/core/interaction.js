// Turns touches and mouse into room actions. One finger: tap / hold / drag (gestures.js decides whether a drag works an
// object or looks around). Two fingers: pinch walks forward/back, sliding moves sideways. Touch: double-tap then slide
// up/down walks with one thumb (a sideways slide still looks around). Mouse: wheel walks, right-drag slides, and the
// cursor shows what answers. Every touchable mesh answers; an unregistered surface with a knock material still knocks.
// While a paper is held up to read (setModal), the eye stays put: taps, holds, drags, the wheel and a pinch go to the
// paper (it pans and zooms), keys never walk, and Escape puts it down.
import * as THREE from 'three';
import { createGestures } from './gestures.js';

export const INPUT = {
  doubleTapMs: 320, // a second touch this soon after a tap, this close to it, may start the one-thumb walk
  doubleTapPx: 30,
  repeatMs: 400, // a second tap on the same toggle this soon is part of the same double-tap / double-click
  thumbWalk: 0.008, // metres per pixel of the one-thumb slide
  pinchWalk: 0.006, // metres per pixel the two fingers spread
  slide: 0.004, // metres per pixel of a two-finger or right-button slide
  wheelStep: 0.0025, // metres per wheel pixel (one notch = 100 px = 25 cm)
};

export function createInteraction({ canvas, camera, rig, onAnyInput, onKnock }) {
  const handlers = new WeakMap(); // mesh -> handler object
  const targets = []; // meshes to raycast
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const gestures = createGestures();
  const pointers = new Map(); // pointerId -> {x, y}
  let pinch = null; // { dist, cx, cy } (two fingers) or { mouseSlide } (right button)
  let lastTap = { t: -1e9, x: 0, y: 0 }; // the last touch tap (for the double-tap-then-slide walk)
  let lastToggle = { handler: null, t: -1e9 }; // the last tap a handler took (a double-tap toggles once)
  let thumbArm = null; // { x0, y0 } a touch that came right after a tap: an up/down slide becomes the thumb walk
  let thumbWalk = null; // { y } during the thumb walk
  let current = null; // { mesh, handler, hit, pointerType, ... } for the active one-finger gesture
  let modal = null; // { targets?, tap(hit|null, e), holdAt?(hit), holdStart?, holdEnd?, pan?(dx, dy, viewH), zoom?(f) } while a paper is held up

  function register(mesh, handler) {
    handlers.set(mesh, handler);
    if (!targets.includes(mesh)) targets.push(mesh);
    mesh.userData.interactive = true;
  }

  function unregister(mesh) {
    handlers.delete(mesh);
    const i = targets.indexOf(mesh);
    if (i >= 0) targets.splice(i, 1);
  }

  // A raycaster through a screen point (CSS pixels), for handlers that follow the finger (wiping the fog).
  function rayAt(x, y) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray;
  }

  // Seen only if it and every parent are visible (three.js draws nothing under a hidden group).
  function shown(o) {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }

  function pick(x, y) {
    rayAt(x, y);
    const hits = ray.intersectObjects(targets, false);
    let glass = null; // clear glass (passThrough) answers only when nothing behind it does
    for (const hit of hits) {
      if (!shown(hit.object)) continue; // hidden, or inside something hidden (a lifted-away grate)
      let o = hit.object;
      while (o && !handlers.has(o)) o = o.parent;
      if (!o) continue;
      const h = handlers.get(o);
      if (h.passThrough) { if (!glass) glass = { mesh: o, handler: h, hit }; continue; }
      if (glass && h.knock && !h.tap && !h.holdStart && !h.dragAxis && !h.drag) return glass; // a plain wall behind: knock the glass
      return { mesh: o, handler: h, hit };
    }
    return glass;
  }

  // The drag axis of a handler is given in world space (e.g. a drawer slides along +z); project it to the screen.
  // dragAxis may be a function of the hit (a lid's path depends on where it is touched).
  function screenAxis(handler, hit) {
    const axisW = typeof handler.dragAxis === 'function' ? handler.dragAxis(hit) : handler.dragAxis;
    if (!axisW) return null;
    const a = hit.point.clone();
    const b = hit.point.clone().add(axisW.clone().multiplyScalar(0.1));
    a.project(camera);
    b.project(camera);
    const r = canvas.getBoundingClientRect();
    const dx = ((b.x - a.x) * r.width) / 2;
    const dy = (-(b.y - a.y) * r.height) / 2;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) return null;
    return [dx / len, dy / len, len / 0.1]; // unit screen direction + pixels per metre along the axis
  }

  const viewH = () => canvas.clientHeight || 1;
  const lookOpts = () => ({ touch: !!current && current.pointerType !== 'mouse', viewW: canvas.clientWidth || 0 });

  // A tap a handler takes. A second tap on the same thing within INPUT.repeatMs is the other half of a double-tap or a
  // double-click and is let go, so a toggle never flips twice; things that repeat on purpose (walking, pulling paper)
  // say repeat: true.
  function tapHandler(h, hit, e) {
    const now = performance.now();
    if (!h.repeat && lastToggle.handler === h && now - lastToggle.t < INPUT.repeatMs) return;
    lastToggle = { handler: h, t: now };
    h.tap(hit, e);
  }

  function dispatch(evts) {
    for (const e of evts) {
      if (!current) return;
      if (current.modal) { dispatchModal(e); continue; }
      const h = current.handler;
      if (e.type === 'tap') {
        if (h && h.tap) tapHandler(h, current.hit, e);
        else if (h && h.knock) onKnock?.(current.hit, h.knock);
      } else if (e.type === 'holdStart') {
        if (h && h.holdStart) h.holdStart(current.hit, e);
      } else if (e.type === 'holdEnd') {
        if (h && h.holdEnd) h.holdEnd(current.hit, e);
        else if (h && h.tap && !h.holdStart) tapHandler(h, current.hit, e);
        else if (h && h.knock && !h.holdStart) onKnock?.(current.hit, h.knock);
      } else if (e.type === 'dragStart') {
        if (e.kind === 'camera') { rig.hold(); setCursor('grabbing'); } else if (h && h.dragStart) h.dragStart(current.hit, e);
      } else if (e.type === 'drag') {
        if (e.kind === 'camera') rig.lookBy(e.dx, e.dy, viewH(), lookOpts());
        else if (h && h.drag) h.drag(e.along === undefined ? null : e.along / current.pxPerMetre, current.hit, e);
      } else if (e.type === 'dragEnd') {
        if (e.kind === 'camera') rig.release();
        else if (h && h.dragEnd) h.dragEnd(current.hit, e);
      }
    }
  }

  // A paper held up to read: a tap answers it (on it or off it), a hold on it is its own (the stamp box), a hold
  // that it does not take ends as a tap, and a drag slides the paper. The view never moves.
  function dispatchModal(e) {
    const m = current.modal;
    if (e.type === 'tap') m.tap(current.hit, e);
    else if (e.type === 'holdStart') current.holdTaken = !!(m.holdStart && m.holdStart(current.hit, e));
    else if (e.type === 'holdEnd') {
      if (current.holdTaken) m.holdEnd?.(current.hit, e);
      else m.tap(current.hit, e);
    } else if (e.type === 'drag') m.pan?.(e.dx, e.dy, viewH());
  }

  function onDown(ev) {
    try { canvas.setPointerCapture?.(ev.pointerId); } catch { /* some browsers refuse capture for a pointer already gone */ }
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    onAnyInput?.(ev);
    if (pointers.size === 2) {
      // a second finger: a hold under way ends as cancelled (the stamp's envelope then rises), a drag is let go
      if (current && gestures.mode() === 'hold') {
        const c = current;
        const e = { type: 'holdEnd', cancelled: true, x: ev.clientX, y: ev.clientY };
        if (c.modal) { if (c.holdTaken) c.modal.holdEnd?.(c.hit, e); } else c.handler?.holdEnd?.(c.hit, e);
      }
      gestures.cancel();
      current = null;
      thumbArm = null;
      thumbWalk = null;
      const [p, q] = [...pointers.values()];
      pinch = { dist: Math.hypot(p.x - q.x, p.y - q.y), cx: (p.x + q.x) / 2, cy: (p.y + q.y) / 2 };
      if (!modal) rig.hold();
      return;
    }
    if (pointers.size > 2) return;
    if (ev.button === 2) { // right mouse: slide (a held paper stays put and so does the eye)
      if (!modal) pinch = { mouseSlide: true, cx: ev.clientX, cy: ev.clientY };
      return;
    }
    const now = performance.now();
    const touch = ev.pointerType !== 'mouse';
    if (modal) {
      const hits = modal.targets ? rayAt(ev.clientX, ev.clientY).intersectObjects(modal.targets, false) : [];
      current = { modal, hit: hits[0] || null, pointerType: ev.pointerType };
      // a hold only where the paper takes holds (the stamp box), decided as the finger lands: anywhere else a resting
      // finger is reading, and it still slides the paper when it moves
      const canHold = !!modal.holdStart && (!modal.holdAt || !!modal.holdAt(current.hit));
      gestures.down(now, ev.clientX, ev.clientY, { id: 'modal', noHold: !canHold }, touch ? 10 : 3);
      return;
    }
    // a touch right after a tap, at the same spot: if it then slides up or down, it walks (one thumb)
    thumbArm = touch && now - lastTap.t < INPUT.doubleTapMs && Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < INPUT.doubleTapPx
      ? { x0: ev.clientX, y0: ev.clientY } : null;
    const picked = pick(ev.clientX, ev.clientY);
    current = picked ? { ...picked, pointerType: ev.pointerType } : { pointerType: ev.pointerType };
    let target = null;
    if (picked) {
      const h = picked.handler;
      const free = typeof h.free === 'function' ? !!h.free(picked.hit) : !!h.free;
      const axis = free ? null : screenAxis(h, picked.hit);
      const base = { id: picked.mesh.uuid, noHold: !h.holdStart };
      if (axis) {
        current.pxPerMetre = axis[2];
        target = { ...base, dragAxis: [axis[0], axis[1]] };
      } else target = { ...base, free, freeDelay: free ? h.freeDelay || 0 : 0 };
    }
    dispatch(gestures.down(now, ev.clientX, ev.clientY, target, touch ? 10 : 3)); // a mouse needs less slop
  }

  function onMove(ev) {
    if (!pointers.has(ev.pointerId)) {
      if (ev.pointerType === 'mouse' && !pointers.size) hoverSoon(ev.clientX, ev.clientY);
      return;
    }
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    onAnyInput?.(ev);
    if (pinch && pinch.mouseSlide) {
      const dx = ev.clientX - pinch.cx;
      pinch.cx = ev.clientX;
      rig.slideBy(-dx * INPUT.slide);
      return;
    }
    if (pinch && pointers.size === 2) {
      const [p, q] = [...pointers.values()];
      const dist = Math.hypot(p.x - q.x, p.y - q.y);
      const cx = (p.x + q.x) / 2;
      if (modal) { // a pinch on a held paper brings it nearer or farther; the eye stays
        if (pinch.dist > 0 && dist > 0) modal.zoom?.(dist / pinch.dist);
      } else {
        rig.dollyBy((dist - pinch.dist) * INPUT.pinchWalk);
        rig.slideBy(-(cx - pinch.cx) * INPUT.slide);
      }
      pinch.dist = dist;
      pinch.cx = cx;
      return;
    }
    if (thumbWalk) {
      const dy = ev.clientY - thumbWalk.y;
      thumbWalk.y = ev.clientY;
      rig.dollyBy(-dy * INPUT.thumbWalk);
      return;
    }
    const evts = gestures.move(performance.now(), ev.clientX, ev.clientY);
    // the second touch of a double-tap that slides up or down where it would only look around: the thumb walk
    if (thumbArm && evts.length && evts[0].type === 'dragStart' && evts[0].kind === 'camera'
      && Math.abs(ev.clientY - thumbArm.y0) > Math.abs(ev.clientX - thumbArm.x0)) {
      gestures.cancel();
      current = null;
      rig.hold();
      thumbWalk = { y: ev.clientY };
      rig.dollyBy(-(ev.clientY - thumbArm.y0) * INPUT.thumbWalk);
      thumbArm = null;
      return;
    }
    if (evts.length) thumbArm = null;
    dispatch(evts);
  }

  function onUp(ev) {
    const wasTwo = pointers.size >= 2;
    pointers.delete(ev.pointerId);
    onAnyInput?.(ev);
    if (pinch) {
      if (pinch.mouseSlide || pointers.size < 2) { pinch = null; if (!modal) rig.release(); }
      return;
    }
    if (wasTwo) return;
    if (thumbWalk) {
      thumbWalk = null;
      rig.release();
      lastTap.t = -1e9;
      return;
    }
    thumbArm = null;
    const evts = gestures.up(performance.now(), ev.clientX, ev.clientY);
    if (ev.pointerType !== 'mouse' && evts.some((e) => e.type === 'tap')) lastTap = { t: performance.now(), x: ev.clientX, y: ev.clientY };
    else if (evts.some((e) => e.type === 'tap')) lastTap = { t: -1e9, x: 0, y: 0 };
    dispatch(evts);
    current = null;
    if (ev.pointerType === 'mouse') hoverSoon(ev.clientX, ev.clientY);
  }

  // The system took the touch (an edge swipe, a call, a scroll it claimed): nothing is tapped, a drag is let go, and a
  // hold ends as cancelled (the stamp then prints but opens no email by itself: its envelope does that on a tap).
  function onCancel(ev) {
    pointers.delete(ev.pointerId);
    if (pinch) {
      if (pinch.mouseSlide || pointers.size < 2) { pinch = null; if (!modal) rig.release(); }
      return;
    }
    if (thumbWalk) { thumbWalk = null; rig.release(); return; }
    thumbArm = null;
    const mode = gestures.mode();
    gestures.cancel();
    const c = current;
    current = null;
    if (!c || !mode) return;
    const e = { type: mode === 'hold' ? 'holdEnd' : 'dragEnd', cancelled: true, x: ev.clientX, y: ev.clientY };
    if (c.modal) {
      if (mode === 'hold' && c.holdTaken) c.modal.holdEnd?.(c.hit, e);
      return;
    }
    if (mode === 'camera') rig.release();
    else if (mode === 'object') c.handler?.dragEnd?.(c.hit, e);
    else if (mode === 'hold') c.handler?.holdEnd?.(c.hit, e);
  }

  // The wheel walks: one notch of a mouse wheel (100 px) is a 25 cm step, a trackpad's small scrolls walk smoothly;
  // the eye glides after it (cameraRig), so steps never jump. Over a held paper it scrolls the paper instead
  // (Ctrl + wheel, or a trackpad pinch, zooms it).
  function onWheel(ev) {
    ev.preventDefault();
    onAnyInput?.(ev);
    const px = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaMode === 2 ? ev.deltaY * 400 : ev.deltaY;
    const step = Math.max(-300, Math.min(300, px));
    if (modal) {
      if (ev.ctrlKey) modal.zoom?.(Math.exp(-step * 0.004));
      else modal.pan?.(0, -step, viewH());
      return;
    }
    rig.dollyBy(-step * INPUT.wheelStep);
  }

  // The keyboard (computers): W/S or up/down walk, A/D slide, left/right turn. Held keys walk at an even pace.
  // A key let go is always let go (even while a paper is held or Ctrl is down), so nothing keeps walking on its own.
  const KEYS = {
    KeyW: ['fwd', 1], ArrowUp: ['fwd', 1], KeyS: ['fwd', -1], ArrowDown: ['fwd', -1],
    KeyA: ['side', -1], KeyD: ['side', 1], ArrowLeft: ['turn', 1], ArrowRight: ['turn', -1],
  };
  const down = new Set();
  function applyKeys() {
    const k = { fwd: 0, side: 0, turn: 0 };
    for (const code of down) { const [axis, v] = KEYS[code]; k[axis] += v; }
    for (const a of Object.keys(k)) k[a] = Math.max(-1, Math.min(1, k[a]));
    rig.setKeys(k);
  }
  function onKey(ev) {
    if (ev.type === 'keydown' && (ev.key === 'Escape' || ev.code === 'Escape') && modal) {
      modal.tap(null, { type: 'escape' }); // put the paper down
      return;
    }
    if (!KEYS[ev.code]) return;
    if (ev.type === 'keyup') {
      if (down.delete(ev.code)) applyKeys();
      return;
    }
    if (ev.altKey || ev.ctrlKey || ev.metaKey || modal) return;
    ev.preventDefault();
    if (down.has(ev.code)) return; // auto-repeat
    down.add(ev.code);
    applyKeys();
    onAnyInput?.(ev);
  }
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', () => { down.clear(); applyKeys(); }); // a key held while the window loses focus

  // Holds are time-based: the loop calls tick().
  function tick() {
    if (!gestures.active()) return;
    dispatch(gestures.tick(performance.now()));
  }

  // The mouse cursor tells what a click would do (it is the visitor's own pointer, not something on the screen):
  // a hand over things that answer, a walk ring over the floor, an open hand elsewhere (drag to look), a closed hand
  // while looking around.
  function setCursor(kind) { if (canvas.dataset && canvas.dataset.cursor !== kind) canvas.dataset.cursor = kind; }
  let hoverAt = null;
  const raf = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : setTimeout(fn, 16));
  function hoverSoon(x, y) {
    const queued = !!hoverAt;
    hoverAt = { x, y };
    if (!queued) raf(hover);
  }
  function hover() {
    const at = hoverAt;
    hoverAt = null;
    if (!at || pointers.size) return;
    if (modal) {
      const on = modal.targets && rayAt(at.x, at.y).intersectObjects(modal.targets, false).length > 0;
      setCursor(on ? 'grab' : 'pointer');
      return;
    }
    const p = pick(at.x, at.y);
    const h = p && p.handler;
    if (h && h.cursor) setCursor(h.cursor);
    else if (h && (h.tap || h.holdStart || h.dragAxis || h.drag)) setCursor('pointer');
    else setCursor('grab');
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    register, unregister, pick, tick, rayAt,
    isRegistered: (m) => handlers.has(m),
    // A paper lifted to read: the eye stops where it is and held keys are let go (nothing walks on its own).
    setModal(m) {
      modal = m || null;
      if (modal) {
        down.clear();
        applyKeys();
        rig.stop?.();
        thumbArm = null;
      }
    },
    get modal() { return modal; },
  };
}
