// The first test version's touch actions (concept section 14): every thing answers with motion and a real sound, and
// papers, labels and device screens carry the words. The camera is never moved here (concept rule 1): things come to
// the visitor. install(ctx) runs after the fixtures and the effects; it returns a small control surface for tests.
// Split by area: scene/entrance.js (the hallway and the door, wired before the room has loaded), scene/clipboardWiring.js
// (the Befaring sheet, the stamp and the email), scene/touchKit.js (shared helpers), and the things added for the owner's
// "more interaction, also some refinments like towels, plants" (2026-10-19): scene/towelWiring.js (the towels and the
// rolls in the basket), scene/plantWiring.js (the plants, the duck, the basket: each wired when its model arrives),
// scene/scaleWiring.js (the bathroom scale), scene/toothbrushWiring.js (the toothbrushes); everything else is here.
import * as THREE from 'three';
import { createMirrorDisplay } from '../systems/mirrorDisplay.js';
import { createDiscovery } from '../systems/discovery.js';
import { canvasSheet, makeSheetMesh, liftSheet, drawCompanyCard, cardFlipAt } from '../systems/paper.js';
import { decodeChoices } from '../systems/offer.js';
import { COMPANY, LINES } from '../data/texts.js';
import { DEFAULT_SIZE, OPTIONS } from '../data/prices.js';
import { floorHeight } from '../data/floor.js';
import { setJoint } from '../fixtures/util.js';
import { createMembraneView } from './membrane.js';
import { installEntrance } from './entrance.js';
import { wireClipboard } from './clipboardWiring.js';
import { wireTowels, TOWEL_DISCOVERIES } from './towelWiring.js';
import { wirePlants } from './plantWiring.js';
import { wireScale, SCALE_DISCOVERIES } from './scaleWiring.js';
import { wireToothbrushes, TOOTHBRUSH_DISCOVERIES } from './toothbrushWiring.js';
import {
  WIRING, jv, nowMs, jointTweener, fingerBoxMaker, slideDragMaker, hingeDragMaker, disposeRemoved,
} from './touchKit.js';

export { installEntrance, WIRING };

// Every first use the mirror counts from the start ("av N oppdaget"); the added things' keys come from their own wiring
// files. The photographed things' first uses (PLANT_DISCOVERIES: the plants, the duck, the basket) are counted only
// once their models have arrived (scene/plantWiring.js, through the kit's `discoverable`), so after a failed or a
// stuck download the mirror never counts a thing nobody can find (review 2026-10-19, finding 7).
export const DISCOVERIES = [
  'door', 'mirrorWipe', 'mirrorDoor', 'tapOn', 'tapWarm', 'tapCold', 'plug', 'lid', 'seat', 'flushSmall', 'flushLarge',
  'flushPlate', 'paperPull', 'paperTear', 'paperFlip', 'drawerTop', 'companyCard', 'drawerMiddle', 'drawerBottom',
  'showerOn', 'showerTemp', 'drain', 'membrane', 'membraneLook2', 'lightSwitch', 'window', 'lock', 'soap',
  'knock_tile', 'knock_glass', 'knock_wood', 'knock_metal', 'knock_ceramic', 'knock_paint', 'swapToilet', 'size',
  'sheet', 'stamp',
  ...TOWEL_DISCOVERIES, ...SCALE_DISCOVERIES, ...TOOTHBRUSH_DISCOVERIES,
];

export function install(ctx, opts = {}) {
  const { scene, interaction, audio, tweens, loop, fx } = ctx;
  const F = ctx.fixtures;
  const entrance = ctx.entrance || installEntrance(ctx);
  // sizeChosen: false until the visitor ticks a size box on the sheet (the sheet then shows the tick, and the email
  // names the size as theirs; until then the range only says which size it assumes)
  const state = { size: DEFAULT_SIZE, sizeChosen: false, choices: { toilet: 'vegghengt' } };
  const discovery = createDiscovery(DISCOVERIES);
  const tweenJoint = jointTweener(tweens, loop);
  const slideDrag = slideDragMaker(tweens, loop);
  const hingeDrag = hingeDragMaker(tweens, loop);
  const fingerBox = fingerBoxMaker(interaction);

  // ---------- helpers
  const play = (role, o) => audio.play(role, o);
  const found = (key) => discovery.first(key);
  const reg = (root, h) => { if (root) root.traverse((o) => { if (o.isMesh && !o.userData.touchBox) interaction.register(o, h); }); return h; };
  // a small control: its own meshes plus a finger-sized touch box (min: the box's smallest side, metres)
  const control = (root, h, min) => { reg(root, h); fingerBox(root, h, min); return h; };
  const unreg = (root) => root && root.traverse((o) => { if (o.isMesh) interaction.unregister(o); });

  // ---------- the mirror's screen and the discovery count
  const md = createMirrorDisplay({ width: 640, height: 400 });
  const mc = F.mirrorCabinet;
  if (mc.parts.display) mc.parts.display.material = md.material;
  md.setDiscovered(0, discovery.total());
  md.setBath(state);
  discovery.onChange((key, n, total) => { md.setDiscovered(n, total); loop.wake(300); });
  loop.add((dt) => md.update(dt));
  ctx.onKnock = (kind) => found(`knock_${kind}`);
  // the mirror's standing message (after the visit is sent: "Klar til sending"), and short notes that pass over it
  let baseMessage = null;
  let noteTimer = 0;
  let noteUntil = 0; // when the passing note's time is up
  // A message also ends a showing fact, so it reads at once (the stamp's "Klar til sending" sat under an idle fact for
  // up to 9 s: review4 2026-10-20).
  const setMirrorMessage = (lines) => {
    baseMessage = lines;
    clearTimeout(noteTimer);
    noteUntil = 0;
    if (lines) cutFact();
    md.setMessage(lines);
    loop.wake(500);
  };
  // Words over the mirror's body end a showing fact with its own fade-out (drawn under a fact the scale's reading was
  // lost: the look 2026-10-20, look3 defect 3); a fact the visitor asked for, cut short, goes back to the front of the
  // queue and shows again in full after the words (review4: the 1891 fact was cut after 3 s and never came back).
  // Returns the ms until the body is fully back.
  function cutFact() {
    const fading = md.endFact();
    const cut = md.takeCut();
    if (cut && cut.asked) factsWaiting.unshift(cut.key);
    return fading;
  }
  // A note ends a fact that is showing (cutFact), then has its whole time.
  function mirrorNote(lines, ms = 6000) {
    clearTimeout(noteTimer);
    const fading = cutFact();
    md.setMessage(lines);
    noteUntil = nowMs() + fading + ms;
    loop.wake(300 + fading);
    noteTimer = setTimeout(() => { md.setMessage(baseMessage); loop.wake(300); }, fading + ms);
  }
  // A surprise for the mirror waits until the mirror is in view (the visitor may be facing the toilet), then shows
  // with a soft tick from the display. Two waiting surprises take turns: the next one shows after the first has had
  // its time on the mirror. Each is asked for once (the mirror shows each fact once per visit). A fact fades the
  // screen's body out, so it also waits for a passing note (the scale's reading, a swap) to have had its time.
  const displayAt = new THREE.Vector3();
  const FACT_MS = 10000; // a fact's time on the mirror (systems/mirrorDisplay.js: 0.8 s in, 9 s, 0.9 s out)
  const factsWaiting = [];
  const factsAsked = new Set();
  let factFreeAt = 0;
  function mirrorFact(key) {
    if (factsAsked.has(key)) return;
    factsAsked.add(key);
    factsWaiting.push(key);
    loop.wake(300);
  }
  function mirrorInView() {
    (mc.parts.display || mc.group).getWorldPosition(displayAt);
    if (displayAt.distanceTo(ctx.camera.position) > 4) return false;
    ctx.camera.updateMatrixWorld();
    const v = displayAt.clone().project(ctx.camera);
    return v.z > -1 && v.z < 1 && Math.abs(v.x) < 0.85 && Math.abs(v.y) < 0.85;
  }
  loop.add(() => {
    if (factsWaiting.length && nowMs() >= factFreeAt && nowMs() >= noteUntil && mirrorInView() && md.showFact(factsWaiting.shift())) {
      play('touch_tick', { volume: 0.3, rate: 1.2 });
      factFreeAt = nowMs() + FACT_MS;
      loop.wake(1000);
    }
    return false;
  });

  // ---------- every fixture surface at least knocks (and blocks touches behind it)
  for (const f of Object.values(F)) {
    if (!f || !f.group) continue;
    f.group.traverse((o) => { if (o.isMesh && !interaction.isRegistered(o)) interaction.register(o, { knock: o.userData.knock || 'tile' }); });
  }

  // ---------- the door (wired by the entrance): the first opening wakes the mirror. The room plays nothing by itself:
  // every sound comes from something the visitor does (the owner, 2026-10-19: no background sound that is always on;
  // a room hum, a fan and rain had started with the door and never stopped)
  let rain = null;
  let windowOpen = false;
  entrance.hooks.found = found;
  entrance.hooks.firstOpen = () => {
    found('door');
    if (fx) setTimeout(() => fx.greet(), 1200);
  };
  for (const floor of [ctx.shell.parts.floor, ctx.shell.parts.floorShower]) if (floor) interaction.register(floor, entrance.floorHandler('tile'));

  // ---------- the mirror: wipe the fog with a finger (touch the glass, then rub); tap a door to open the cabinet
  const fog = fx && fx.mirrorFog;
  const fogMeshes = fog ? fog.meshes : [];
  const doorFor = (point) => (point.x < (ctx.layout.mirror.x0 + ctx.layout.mirror.x1) / 2 ? 'Left' : 'Right');
  function toggleMirrorDoor(side) {
    const p = mc.parts[`door${side}Pivot`];
    const j = p.userData.joint;
    const target = Math.abs(jv(p)) > 0.2 ? 0 : side === 'Left' ? j.min * 0.95 : j.max * 0.95;
    tweenJoint(p, target, 700, 'inOutSine');
    play(target === 0 ? 'drawer_soft_close' : 'drawer_open', { volume: 0.5, rate: 1.2 });
    if (mc.parts.insideLight) mc.parts.insideLight.visible = target !== 0 || Math.abs(jv(mc.parts[`door${side === 'Left' ? 'Right' : 'Left'}Pivot`])) > 0.2;
    found('mirrorDoor');
  }
  function displayTap() { md.poke(); md.showFact(undefined, true); play('touch_tick', { volume: 0.4 }); loop.wake(1000); }
  // a tap on the display's area reaches the display even through the fog over the glass
  const displayBox = new THREE.Box3();
  function onDisplay(point) {
    const d = mc.parts.display;
    const rp = mc.parts.doorRightPivot;
    if (!d || (rp && Math.abs(jv(rp)) > 0.05)) return false;
    displayBox.setFromObject(d).expandByScalar(0.005);
    return point.x >= displayBox.min.x && point.x <= displayBox.max.x && point.y >= displayBox.min.y && point.y <= displayBox.max.y;
  }
  const mirrorHandler = {
    free: () => !!fog && fog.density > 0.08,
    freeDelay: 250, // a drag that moves at once looks around; a finger that rests on the glass first wipes
    tap: (hit) => (onDisplay(hit.point) ? displayTap() : toggleMirrorDoor(doorFor(hit.point))),
    drag(m, hit, e) {
      const ray = interaction.rayAt(e.x, e.y);
      const h = ray.intersectObjects(fogMeshes, false)[0];
      if (h && h.uv) { fog.wipe(h.uv); found('mirrorWipe'); loop.wake(400); }
    },
    dragEnd() { if (fog) fog.endStroke(); },
    knock: 'glass',
  };
  for (const m of fogMeshes) interaction.register(m, mirrorHandler);
  for (const k of ['doorLeftFace', 'doorRightFace', 'doorLeft', 'doorRight']) if (mc.parts[k]) reg(mc.parts[k], mirrorHandler);
  if (mc.parts.display) interaction.register(mc.parts.display, { tap: displayTap, knock: 'glass' });

  // ---------- the basin tap: tap = water on/off, drag sideways = warm (left) / cold (right)
  const V_ = F.vanity;
  const lever = V_.parts.leverPivot;
  let tapFlow = 0;
  const tapTemp = () => 0.5 - jv(lever)[0] / 1.4; // yaw -0.7 (left) = hot, +0.7 = cold
  function applyTap() { if (fx) fx.setTap(tapFlow, tapTemp()); }
  let yawStart = 0;
  control(V_.parts.leverPivot, {
    tap() {
      tapFlow = tapFlow > 0 ? 0 : 1;
      const [yaw] = jv(lever);
      tweens.add({ key: 'lever', from: jv(lever)[1], to: tapFlow ? -0.4 : 0, duration: 260, onUpdate: (v) => setJoint(lever, [yaw, v]) });
      loop.wake(400);
      play('switch_click', { volume: 0.35, rate: 0.7 });
      applyTap();
      if (tapFlow) found('tapOn');
    },
    dragAxis: () => new THREE.Vector3(1, 0, 0),
    dragStart() { yawStart = jv(lever)[0]; },
    drag(m) {
      if (m == null) return;
      const [, pitch] = jv(lever);
      setJoint(lever, [yawStart + m * 14, pitch]);
      applyTap();
      if (tapTemp() > 0.75) found('tapWarm');
      if (tapTemp() < 0.25) found('tapCold');
      loop.wake(200);
    },
    knock: 'metal',
  });
  // the pop-up plug: tap to close (the basin fills) or open (it drains with a gurgle)
  let plugClosed = false;
  control(V_.parts.plugPivot, {
    tap() {
      plugClosed = !plugClosed;
      tweenJoint(V_.parts.plugPivot, plugClosed ? 0 : V_.parts.plugPivot.userData.joint.max, 160);
      play('button_press', { volume: 0.5 });
      if (fx) fx.setPlug(!plugClosed);
      found('plug');
    },
    knock: 'metal',
  });
  setJoint(V_.parts.plugPivot, V_.parts.plugPivot.userData.joint.max);
  if (fx) fx.setPlug(true);

  // ---------- the drawers (soft-close runners); the top one holds the company card
  const drawerOpen = (k) => jv(V_.parts[`drawer${k}Pivot`]) > 0.05;
  function setDrawer(k, open, ms = 520) {
    const p = V_.parts[`drawer${k}Pivot`];
    const to = open ? p.userData.joint.max * 0.82 : 0;
    tweenJoint(p, to, ms, open ? 'outCubic' : 'softClose', () => { if (!open) play('drawer_soft_close', { volume: 0.7 }); });
    if (open) play('drawer_open', { volume: 0.7 });
    const led = V_.parts[`drawer${k}Led`];
    if (led) led.visible = open;
    found(`drawer${k}`);
  }
  for (const k of ['Top', 'Middle', 'Bottom']) {
    const p = V_.parts[`drawer${k}Pivot`];
    const led = V_.parts[`drawer${k}Led`];
    if (led) led.visible = false;
    reg(p, {
      tap: () => setDrawer(k, !drawerOpen(k)),
      ...slideDrag(p, {
        onChange: (v) => { if (led) led.visible = v > 0.02; },
        onEnd: (v) => setDrawer(k, v > p.userData.joint.max * 0.3),
      }),
      knock: 'wood',
    });
  }
  // the "Om oss" card lying in the top drawer
  const cardCanvas = canvasSheet(1000, 1414);
  drawCompanyCard(cardCanvas, COMPANY);
  const card = makeSheetMesh(0.148, 0.21, cardCanvas, ctx.materials);
  card.rotation.x = -Math.PI / 2;
  card.rotation.z = 0.06;
  card.position.set(-0.12, -0.05, -0.2);
  V_.parts.drawerTopPivot.add(card);
  card.userData.texture.needsUpdate = true;

  // ---------- holding a paper up to read. The paper comes to the eye; the eye stays where it is. A drag or the wheel
  // slides it, a pinch brings it nearer (the paper's own controller, when it has one); a tap on it answers it (a box on
  // the sheet) and otherwise leaves it up; a tap off it, Escape or the phone's Back button puts it down.
  let lifted = null;
  let historyArmed = false;
  let onBack = null;
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('popstate', () => { if (historyArmed) { historyArmed = false; onBack?.(); } });
  }
  function holdUp(mesh, { onTap, onHold, onHoldAt, onHoldEnd, onDrop, targets, normal, up } = {}) {
    if (lifted) return null;
    play('paper_rustle', { volume: 0.6 });
    const ctl = liftSheet(ctx, mesh, { fill: 0.72, ...(normal ? { normal, up } : {}) });
    const held = { ctl, mesh };
    lifted = held;
    const putDown = () => {
      if (lifted !== held || held.down) return;
      held.down = true;
      interaction.setModal(null);
      play('paper_slide', { volume: 0.5 });
      if (historyArmed) { historyArmed = false; try { history.back(); } catch { /* no history here */ } }
      ctl.drop(() => { lifted = null; onDrop?.(); });
    };
    held.putDown = putDown;
    interaction.setModal({
      targets: targets || [mesh],
      tap(hit) {
        if (!hit) { putDown(); return; } // off the paper (or Escape)
        onTap?.(hit); // on the paper: its own boxes answer; anywhere else on it, nothing (it stays up)
      },
      holdAt: onHoldAt ? (hit) => !!(hit && onHoldAt(hit)) : undefined, // where a resting finger is a hold, not reading
      holdStart: onHold ? (hit) => !!(hit && onHold(hit)) : undefined,
      holdEnd: onHoldEnd ? (hit, e) => onHoldEnd(hit, e) : undefined,
      pan: (dx, dy, viewH) => { if (ctl.panBy) { ctl.panBy(dy, viewH, dx); loop.wake(300); } },
      zoom: (f) => { if (ctl.zoomBy) { ctl.zoomBy(f); loop.wake(300); } },
    });
    onBack = putDown;
    try { history.pushState({ bathPaper: true }, ''); historyArmed = true; } catch { historyArmed = false; }
    return held;
  }
  // the card turns over at its corner while it is held (its back: the approvals, the bath count, the company number)
  let cardSide = 'front';
  const drawCard = (flippable) => { drawCompanyCard(cardCanvas, COMPANY, { side: cardSide, flippable }); card.userData.texture.needsUpdate = true; loop.wake(100); };
  function turnCard() {
    if (!lifted || lifted.mesh !== card || !lifted.ctl.flip) return;
    play('paper_slide', { volume: 0.4, rate: 1.3 });
    lifted.ctl.flip(() => { cardSide = cardSide === 'back' ? 'front' : 'back'; drawCard(true); });
  }
  interaction.register(card, {
    tap: () => {
      found('companyCard');
      const held = holdUp(card, {
        onTap: (hit) => { if (hit.uv && cardFlipAt(hit.uv.x, hit.uv.y)) turnCard(); },
        onDrop: () => { cardSide = 'front'; drawCard(false); }, // it lies front up in the drawer
      });
      if (held) drawCard(!!held.ctl.flip);
    },
    knock: 'wood',
  });

  // ---------- the toilet (built again when it is swapped)
  let toilet = F.toilet;
  function wireToilet(t) {
    const lid = t.parts.lidPivot;
    const seat = t.parts.seatPivot;
    // The lid lies on the seat: never more closed than the seat (angles are negative when open). A lid coming down
    // pushes a raised seat down with it; a seat going up stops at the lid.
    const setLid = (p, v) => {
      const a = setJoint(p, v);
      if (jv(seat) < a) { tweens.cancel(`j${seat.uuid}`); setJoint(seat, a); }
      return a;
    };
    const setSeat = (p, v) => setJoint(p, Math.max(v, jv(lid)));
    const setterOf = (p) => (p === lid ? setLid : setSeat);
    const softClose = (p, role) => {
      const set = setterOf(p);
      // a short free fall, then the damper takes over and lowers it slowly, landing without a sound worth a name
      tweenJoint(p, jv(p) * 0.82, 220, 'inQuad', () => tweenJoint(p, 0, 3400, 'softClose', () => play(role, { volume: 0.6 }), 0, set), 0, set);
    };
    const openFully = (p) => { tweenJoint(p, p.userData.joint.min, 520, 'outCubic', null, 0, setterOf(p)); play('seat_click', { volume: 0.4, rate: 0.9 }); };
    const up = (p) => jv(p) < -0.2;
    // a tap on the raised pair lowers the seat first (a finger reaches the lid through the seat's ring); a seat under a
    // closed lid comes up only with the lid, so the lid opens first
    const lidTap = () => {
      if (up(lid) && up(seat)) { softClose(seat, 'seat_click'); found('seat'); return; }
      if (up(lid)) softClose(lid, 'lid_soft_close'); else openFully(lid);
      found('lid');
    };
    const seatTap = () => {
      if (!up(lid)) { openFully(lid); found('lid'); return; }
      if (up(seat)) softClose(seat, 'seat_click'); else openFully(seat);
      found('seat');
    };
    // a tap anywhere on the toilet: the lid first; with the lid up, the seat (a finger on a phone is not precise)
    reg(t.parts.bowl, { tap: () => (up(lid) ? seatTap() : lidTap()), knock: 'ceramic' });
    reg(lid, {
      tap: lidTap,
      ...hingeDrag(lid, { set: setLid, onEnd: (v) => { if (v > lid.userData.joint.min * 0.8) softClose(lid, 'lid_soft_close'); else tweenJoint(lid, lid.userData.joint.min, 300, 'outCubic', null, 0, setLid); found('lid'); } }),
      knock: 'ceramic',
    });
    reg(seat, {
      tap: seatTap,
      ...hingeDrag(seat, { set: setSeat, onEnd: (v) => { if (v > seat.userData.joint.min * 0.8) softClose(seat, 'seat_click'); else tweenJoint(seat, seat.userData.joint.min, 300, 'outCubic', null, 0, setSeat); found('seat'); } }),
      knock: 'ceramic',
    });
    // the flush plate slides out of the wall on a hold (on the plate or on a button); a tap on a button flushes
    const plate = t.parts.flushPlatePivot;
    const plateHold = plate ? () => {
      const open = jv(plate) < 0.01;
      tweenJoint(plate, open ? plate.userData.joint.max : 0, 400, 'inOutSine');
      play('relay_click', { volume: 0.6 });
      if (open) found('flushPlate');
    } : null;
    // one flush at a time: until the cistern has refilled, a button only clicks
    let flushBusyUntil = 0;
    for (const [name, role] of [['flushSmall', 'flush_small'], ['flushLarge', 'flush_large']]) {
      const p = t.parts[`${name}Pivot`];
      if (!p) continue;
      control(p, {
        tap() {
          tweenJoint(p, p.userData.joint.max, 90, 'outCubic', () => tweenJoint(p, 0, 260, 'outBack'));
          play('button_press', { volume: 0.6 });
          found(name);
          if (nowMs() < flushBusyUntil) return;
          const refillAt = role === 'flush_large' ? 5.5 : 3.8;
          flushBusyUntil = nowMs() + refillAt * 1000 + WIRING.refillMs;
          play(role, { volume: 1, delay: 0.15 });
          play('cistern_refill', { volume: 0.8, delay: refillAt });
          if (membrane.look) membrane.flushPulse(t, role === 'flush_large' ? 1 : 0.6);
        },
        ...(plateHold ? { holdStart: plateHold, holdEnd() {} } : {}),
        knock: 'metal',
      });
    }
    if (plateHold && t.parts.flushPlate) reg(t.parts.flushPlate, { holdStart: plateHold, holdEnd() {}, knock: 'metal' });
  }

  // ---------- the paper roll: pull the sheet down (it tears at the perforation), tap the roll to hang it the other way
  const PH = F.paperHolder;
  let pulled = 0;
  let flips = 0;
  control(PH.parts.tailPivot, {
    dragAxis: () => new THREE.Vector3(0, -1, 0),
    dragStart() { pulled = 0; },
    drag(m) {
      if (m == null || m <= pulled) return;
      PH.pull(m - pulled);
      pulled = m;
      if (pulled > 0.04) found('paperPull');
      if (PH.tailLength() > 0.3) tear();
      loop.wake(200);
    },
    tap() { PH.pull(0.06); play('roll_spin', { volume: 0.5 }); found('paperPull'); loop.wake(300); if (PH.tailLength() > 0.3) tear(); },
    repeat: true,
    knock: 'wood',
  });
  // The torn sheet falls and lies on the floor for a moment: its torn edge drops straight down while the sheet tips
  // over away from the wall onto its back, printed face up, and comes to rest flat with its middle 4 mm over the floor
  // (which falls to the drain: data/floor.js). On the way down it never dips into the floor or the wall.
  const TORN = { lift: 0.004, wallGap: 0.012, fallMs: 700 };
  function tear() {
    const len = PH.tailLength();
    PH.setTail(0.04);
    pulled = 1e9; // this drag is spent
    play('paper_tear', { volume: 0.9 });
    found('paperTear');
    const L = ctx.layout;
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.098, len), ctx.materials.get('paper'));
    const edge = PH.anchors.tear.getWorldPosition(new THREE.Vector3()); // the torn edge, under the roll
    edge.x = Math.min(edge.x, L.room.W - TORN.wallGap);
    const restY = floorHeight(L, edge.x - len / 2, edge.z) + TORN.lift; // flat on the floor, its middle 4 mm over it
    const y0 = edge.y;
    const face = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2); // hanging: face to the room
    const tip = new THREE.Quaternion();
    const Z = new THREE.Vector3(0, 0, 1);
    const pose = (v) => {
      const a = (v * Math.PI) / 2; // 0 hanging; pi/2 lying on its back, its far end out in the room
      const dx = -Math.sin(a);
      const dy = -Math.cos(a);
      const farFloor = floorHeight(L, edge.x + dx * len, edge.z) + TORN.lift; // the far end stays over the floor under it
      const edgeY = Math.max(y0 + (restY - y0) * v, farFloor - dy * len);
      sheet.position.set(edge.x + (dx * len) / 2, edgeY + (dy * len) / 2, edge.z);
      sheet.quaternion.multiplyQuaternions(tip.setFromAxisAngle(Z, -a), face);
    };
    pose(0);
    scene.add(sheet);
    tweens.add({
      key: `torn${sheet.uuid}`, from: 0, to: 1, duration: TORN.fallMs, ease: 'inQuad',
      onUpdate: pose,
      onDone: () => tweens.add({
        key: `torn${sheet.uuid}`, from: 1, to: 0, duration: 400, delay: 2500, onUpdate: (v) => sheet.scale.setScalar(Math.max(0.001, v)),
        onDone: () => { sheet.removeFromParent(); sheet.geometry.dispose(); }, // the paper material is the shared one
      }),
    });
    loop.wake(4000);
  }
  control(PH.parts.rollPivot, {
    tap() {
      PH.setOrientation(PH.orientation() === 'over' ? 'under' : 'over');
      play('roll_spin', { volume: 0.7 });
      flips++;
      found('paperFlip');
      if (flips === 2) mirrorFact('paper1891'); // shown when the visitor next faces the mirror
    },
    knock: 'wood',
  });

  // ---------- the shower: lever = water on/off, dial = temperature (38 °C in the middle), grate lifts off the drain
  // (the eye stays outside the shower, a metre or more from the mixer, so its controls get bigger touch boxes)
  const S = F.shower;
  let showerFlow = 0;
  // the thermostat: 38 °C at the safety stop in the middle, 15 °C fully one way, 50 °C the other; the effects'
  // temperature scale runs 0.4 = 28 °C (steam starts to show) to 1 = 55 °C
  const showerDegrees = () => { const v = jv(S.parts.tempDialPivot); return 38 + v * (v > 0 ? 12 / 2.4 : 23 / 2.4); };
  const showerTemp = () => Math.max(0, Math.min(1, 0.4 + ((showerDegrees() - 28) / 27) * 0.6));
  control(S.parts.flowLeverPivot, {
    tap() {
      showerFlow = showerFlow > 0 ? 0 : 1;
      tweenJoint(S.parts.flowLeverPivot, showerFlow ? 1.5 : 0, 380, 'inOutSine');
      play('switch_click', { volume: 0.5, rate: 0.6 });
      if (fx) fx.setShower(showerFlow, showerTemp());
      if (showerFlow) found('showerOn');
    },
    knock: 'metal',
  }, 0.11);
  control(S.parts.tempDialPivot, {
    tap() {
      const v = jv(S.parts.tempDialPivot);
      tweenJoint(S.parts.tempDialPivot, v > 1.5 ? -1.2 : v + 0.9, 300);
      play('touch_tick', { volume: 0.8 });
      if (fx) setTimeout(() => fx.setShower(showerFlow, showerTemp()), 320);
      found('showerTemp');
    },
    ...hingeDrag(S.parts.tempDialPivot, { onChange: () => { if (fx) fx.setShower(showerFlow, showerTemp()); found('showerTemp'); } }),
    repeat: true,
    knock: 'metal',
  }, 0.11);
  if (S.parts.drainGratePivot) {
    control(S.parts.drainGratePivot, {
      tap() {
        const p = S.parts.drainGratePivot;
        tweenJoint(p, jv(p) > 0.001 ? 0 : p.userData.joint.max, 300);
        play('knock_metal', { volume: 0.5, rate: 1.3 });
        found('drain');
      },
      knock: 'metal',
    });
  }
  // the shower glass is clear: a finger reaching for the mixer behind it gets the mixer, a tap on the open wall the glass
  if (S.parts.glass) reg(S.parts.glass, { knock: 'glass', passThrough: true });

  // ---------- the window: turn the handle, the sash tilts in and the rain outside comes in; shut, it is quiet again
  const Wd = F.window;
  const toggleWindow = () => {
    windowOpen = !windowOpen;
    tweenJoint(Wd.parts.handlePivot, windowOpen ? Math.PI / 2 : 0, 260, 'outCubic', () => {
      tweenJoint(Wd.parts.sashPivot, windowOpen ? Wd.parts.sashPivot.userData.joint.max : 0, 600, 'inOutSine');
    });
    play('switch_click', { volume: 0.7, rate: 0.8 });
    if (fx) fx.setWindow(windowOpen ? 1 : 0);
    if (windowOpen && !rain) rain = audio.loop('rain_window', { volume: 2.4, fade: 1.2 });
    else if (!windowOpen && rain) { rain.stop(0.8); rain = null; }
    found('window');
  };
  control(Wd.parts.handlePivot, { tap: toggleWindow, knock: 'metal' }, 0.1);
  reg(Wd.parts.sashPivot, { tap: toggleWindow, knock: 'glass' });

  // ---------- the brass "Membran" button (its own fixture on the back wall; the old one on the door's panel answers
  // the same while it exists) and the light switch by the door
  const P = F.panel;
  const membrane = createMembraneView(ctx);
  const membranePivots = [F.membraneButton && F.membraneButton.parts && F.membraneButton.parts.pivot, P && P.parts.membraneButtonPivot]
    .filter((p, i, all) => p && all.indexOf(p) === i);
  for (const p of membranePivots) {
    control(p, {
      tap() {
        tweenJoint(p, p.userData.joint.max, 70, 'outCubic', () => tweenJoint(p, 0, 200, 'outBack'));
        play('button_press', { volume: 0.8 });
        const look = membrane.cycle(toilet);
        if (look === 1) found('membrane');
        if (look === 2) { found('membraneLook2'); mirrorFact('penetrations'); } // the tiles are off, the pipe collars show
      },
      knock: 'metal',
    });
  }
  let lightsOn = true;
  control(P.parts.switchRockerPivot, {
    tap() {
      lightsOn = !lightsOn;
      tweenJoint(P.parts.switchRockerPivot, lightsOn ? 0.08 : -0.08, 80);
      play('switch_click', { volume: 0.9 });
      setLight(lightsOn ? 1 : 0.12);
      found('lightSwitch');
    },
    knock: 'metal',
  });
  setJoint(P.parts.switchRockerPivot, 0.08);
  // The room's light (scene/lighting.js createRoomLight) dims the lamps, the baked light, the fixtures' light (the
  // room is photographed again) and a held paper's light, and keeps the mirror's LED strip on; without it (a test
  // room), the lamps and every light map are dimmed here.
  function setLight(level) {
    if (ctx.roomLight) ctx.roomLight.setLevel(level);
    else {
      ctx.downlights.setLevel(level);
      const k = (ctx.mood && ctx.mood.lightMapIntensity) || 1;
      scene.traverse((o) => { if (o.isMesh && o.material && o.material.lightMap) o.material.lightMapIntensity = k * level; });
    }
    if (fx) fx.setLightLevel(level);
    if (entrance.setLightLevel) entrance.setLightLevel(level); // the light under the shut door follows the room's
    loop.wake(300);
  }

  // ---------- small things on the counter
  if (F.soapDispenser.parts.pumpPivot) {
    control(F.soapDispenser.parts.pumpPivot, {
      tap() {
        const p = F.soapDispenser.parts.pumpPivot;
        tweenJoint(p, p.userData.joint.max, 120, 'outCubic', () => tweenJoint(p, 0, 300, 'outBack'));
        play('button_press', { volume: 0.4, rate: 0.8 });
        found('soap');
      },
      repeat: true,
      knock: 'ceramic',
    });
  }

  // ---------- the clipboard: the "Befaring" sheet with the price range, and the green date stamp
  const clip = wireClipboard(ctx, { state, md, found, setDrawer, holdUp, lifted: () => lifted, setMirrorMessage });

  // ---------- the towels (take one off the rail, shake it, read its care label; the rolls in the basket give), the
  // plants, the duck and the basket (each wired when its model has arrived), the scale (the needle reads the visitor's
  // price feeling from the same state as the sheet) and the toothbrushes. Each returns null or a stub without its fixture.
  // discoverable(keys): first uses the mirror counts from now on (a model has arrived and its thing can be found);
  // mirrorNote(lines, ms): words that pass over the mirror's screen (the scale's reading, too small to read on its dial)
  const kit = { found, play, reg, control, holdUp, loop, tweens, state, mirrorNote, discoverable: (keys) => discovery.add(keys) };
  const towelWire = wireTowels(ctx, kit);
  const plantWire = wirePlants(ctx, kit);
  const scaleWire = wireScale(ctx, kit);
  const brushWire = wireToothbrushes(ctx, kit);

  // ---------- the delivery box in the hallway: the other toilet; tap it to swap
  ctx.hallway.drawLabel(state.choices.toilet);
  function setToilet(next, { quiet = false } = {}) {
    if (next === state.choices.toilet) return;
    const before = clip.snapshot();
    state.choices.toilet = next; // the choice is made now: a second quick tap sees it
    if (!quiet) {
      play('drawer_open', { volume: 0.6, rate: 0.6 });
      play('knock_ceramic', { volume: 0.7, rate: 0.7, delay: 0.5 });
    }
    const old = toilet;
    unreg(old.group);
    old.group.traverse((o) => tweens.cancel(`j${o.uuid}`)); // a lid still closing on the old toilet makes no sound later
    old.group.removeFromParent();
    const made = ctx.fixtureModule.createToilet(ctx, { variant: next === 'vegghengt' ? 'wallHung' : 'floor', boxMaterial: 'tileWhite' });
    scene.add(made.group);
    F.toilet = made;
    toilet = made;
    if (ctx.relightBoxing) ctx.relightBoxing(made);
    if (ctx.setToiletLight) ctx.setToiletLight(made.variant);
    made.group.traverse((o) => { if (o.isMesh && !interaction.isRegistered(o)) interaction.register(o, { knock: o.userData.knock || 'ceramic' }); });
    wireToilet(made);
    if (membrane.look) membrane.showToilet(made, true);
    disposeRemoved(scene, old.group, ctx.materials);
    if (quiet) { md.setBath(state); clip.drawSheet(); } else clip.rewriteRange(before);
    ctx.hallway.drawLabel(next);
    if (!quiet) {
      found('swapToilet');
      if (LINES.swapDone) {
        const label = (OPTIONS.toilet && OPTIONS.toilet.choices[next] && OPTIONS.toilet.choices[next].label) || next;
        mirrorNote([].concat(typeof LINES.swapDone === 'function' ? LINES.swapDone(label, next) : LINES.swapDone));
      }
    }
    loop.wake(600);
  }
  let swapBusyUntil = 0;
  const swapToilet = () => {
    if (nowMs() < swapBusyUntil) return; // a swap is under way
    swapBusyUntil = nowMs() + WIRING.swapBusyMs;
    setToilet(state.choices.toilet === 'vegghengt' ? 'gulvstaaende' : 'vegghengt');
  };
  reg(ctx.hallway.parts.trolley, { tap: swapToilet, knock: 'wood' });
  wireToilet(toilet);

  // ---------- a visitor's own link ("Se badet mitt igjen" in their email) opens their bathroom as they left it
  if (typeof location !== 'undefined' && location.hash.startsWith('#bad=')) {
    const mine = decodeChoices(decodeURIComponent(location.hash.slice(5)));
    // a size other than the sheet's assumption was the visitor's own tick
    if (mine.size !== state.size) { state.size = mine.size; state.sizeChosen = true; md.setBath(state); clip.drawSheet(); }
    if (mine.choices.toilet) setToilet(mine.choices.toilet, { quiet: true });
  }

  // a door tapped while the room loaded opens now - or, with deferReady, when the caller says so (main.js waits for
  // the room's first light photograph, so the door's first swing never stutters behind it)
  if (!opts.deferReady) entrance.setReady();
  loop.wake(1000);
  return {
    state, discovery, md, swapToilet, setLight, membrane, entrance, holdUp, clip,
    towels: towelWire, plants: plantWire, scale: scaleWire, toothbrushes: brushWire,
    setReady: () => entrance.setReady(),
    openDoor: entrance.openDoor,
    stampAndSend: clip.stampAndSend,
    releaseStamp: clip.releaseStamp,
    raiseEnvelope: clip.raiseEnvelope,
    get lifted() { return lifted; },
    get cardSide() { return cardSide; },
    get toilet() { return toilet; },
    get lastMail() { return ctx.lastMail || null; },
  };
}
