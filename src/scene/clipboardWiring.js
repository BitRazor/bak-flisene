// The clipboard on the counter: the "Befaring" sheet with the price range (a pencil rubs it out and writes the new one
// with every choice), and the green date stamp that asks for the free site visit.
//
// The sheet held up to read turns over at its turn-over line (the back says how the number is made); its size boxes
// and its stamp box answer on the front. Its empty stamp spot says "her" while it is up.
//
// The stamp: press and hold it (about half a second), on the board or in the stamp box of the sheet held up to read
// (then the stamp comes up onto the held sheet first). The print lands while the finger is down; the visitor's own email opens the moment the finger lifts (a phone lets a
// page open the mail app only from a touch, never from a timer). The original tears off and goes into the bottom
// drawer (the first time), the copy stays on the board ("Din kopi"), and the stamp stands aside so the print shows;
// the next stamping sets it back on the sheet first. If the page is still showing a moment after the mail was asked
// for (no mail app answered), an envelope rises from the bottom drawer: a tap on it opens the same email.
// ?nomail (test runs) never starts a mail program; the email's link is kept in ctx.lastMail.
import * as THREE from 'three';
import { canvasSheet, makeSheetMesh, FONT } from '../systems/paper.js';
import { drawBefaring, sizeTickAt, stampBoxAt, flipAt, SHEET } from '../systems/clipboard.js';
import { buildOfferMail } from '../systems/offer.js';
import { LINES, stampDate } from '../data/texts.js';
import { setJoint } from '../fixtures/util.js';
import { WIRING, pageVisible, noMail, jointTweener } from './touchKit.js';

export function wireClipboard(ctx, { state, md, found, setDrawer, holdUp, lifted, setMirrorMessage }) {
  const { scene, interaction, audio, tweens, loop } = ctx;
  const CB = ctx.fixtures.clipboard;
  const V_ = ctx.fixtures.vanity;
  const play = (role, o) => audio.play(role, o);
  const tweenJoint = jointTweener(tweens, loop);

  // ---- the sheet
  const sheetCanvas = canvasSheet(SHEET.W, SHEET.H);
  const sheetTex = new THREE.CanvasTexture(sheetCanvas);
  sheetTex.colorSpace = THREE.SRGBColorSpace;
  sheetTex.anisotropy = 8;
  const sheetMesh = CB.parts.sheet;
  sheetMesh.material.map = sheetTex;
  sheetMesh.material.color.set(0xffffff);
  sheetMesh.material.needsUpdate = true;
  let sheetOpts = { copy: false, stamped: null, side: 'front', held: false, flippable: false };
  const drawSheet = (o = {}) => {
    const { bath, ...opts } = o;
    drawBefaring(sheetCanvas, bath || state, { ...sheetOpts, ...opts });
    sheetTex.needsUpdate = true;
    loop.wake(100);
  };
  drawSheet();
  // what the sheet showed before a change (the eraser rubs that out: its tick too, so a first tick never flashes on
  // the size the sheet only assumed)
  const snapshot = () => ({ size: state.size, sizeChosen: state.sizeChosen, choices: { ...state.choices } });
  // Rub the old range out and write the new one, the way a pencil would. The sheet is redrawn only when the rubbing or
  // the writing visibly moves on (a few dozen uploads of the sheet, not one every frame).
  function rewriteRange(before) {
    play('paper_rustle', { volume: 0.35, rate: 1.4 });
    let rubbed = -1;
    tweens.add({
      key: 'erase', from: 1, to: 0, duration: 450, ease: 'linear',
      onUpdate: (v) => { const s = Math.round(v * 6); if (s !== rubbed) { rubbed = s; drawSheet({ eraseT: s / 6, bath: before }); } },
      onDone: () => {
        md.setBath(state);
        let written = -1;
        tweens.add({
          key: 'erase', from: 0, to: 1, duration: 900, ease: 'linear',
          onUpdate: (v) => { const s = Math.round(v * 24); if (s !== written) { written = s; drawSheet({ writeT: s / 24 }); } },
        });
      },
    });
    loop.wake(1600);
  }

  // ---- the stamp
  const plunger = CB.parts.stampPlungerPivot;
  const stampGroup = CB.parts.stamp;
  const stampParent = stampGroup.parent;
  const stampHome = stampGroup.position.clone();
  const stampHomeQuat = stampGroup.quaternion.clone();
  const stampAside = new THREE.Vector3(stampHome.x + 0.15, stampHome.y, stampHome.z - 0.045);
  const stampOnSheet = stampHome.clone().sub(sheetMesh.position); // its spot in the sheet's own frame
  const stampMeshes = [];
  stampGroup.traverse((o) => { if (o.isMesh) stampMeshes.push(o); });
  const isStampHit = (hit) => !!hit && (stampMeshes.includes(hit.object)
    || (hit.object === sheetMesh && !!hit.uv && sheetOpts.side === 'front' && stampBoxAt(hit.uv.x, hit.uv.y)));
  let stampAt = 'home'; // 'home' (on the sheet's box), 'aside' (on the board beside it), 'moving'
  let send = null; // { printed, mailed, aside } while a stamping is under way
  let torn = false; // the original went to the drawer (only the first time)
  let mailHref = null;
  let envelope = null;
  let envelopeTimer = 0;

  function homeStamp() { // back in the clipboard's own frame, exactly on its spot
    tweens.cancel('stampMove');
    stampParent.add(stampGroup);
    stampGroup.position.copy(stampHome);
    stampGroup.quaternion.copy(stampHomeQuat);
    stampAt = 'home';
  }
  // move the stamp along a short arc to a pose in its current parent's frame
  function moveStamp(toPos, toQuat, ms, onDone, delay = 0) {
    const fromPos = stampGroup.position.clone();
    const fromQuat = stampGroup.quaternion.clone();
    stampAt = 'moving';
    tweens.add({
      key: 'stampMove', from: 0, to: 1, duration: ms, delay, ease: 'inOutSine',
      onUpdate: (v) => {
        stampGroup.position.lerpVectors(fromPos, toPos, v);
        stampGroup.position.y += Math.sin(v * Math.PI) * 0.06;
        stampGroup.quaternion.slerpQuaternions(fromQuat, toQuat, v);
      },
      onDone,
    });
    loop.wake(ms + delay + 200);
  }
  const stampHandler = {
    tap() { // a short press only wiggles it: the paper says "Hold inne stempelet"
      tweenJoint(plunger, plunger.userData.joint.max * 0.35, 90, 'outCubic', () => tweenJoint(plunger, 0, 200, 'outBack'));
      play('touch_tick', { volume: 0.5 });
    },
    holdStart() { stampAndSend(); },
    holdEnd(hit, e) { releaseStamp(e); },
    knock: 'wood',
  };
  for (const m of stampMeshes) interaction.register(m, stampHandler);

  function stampAndSend() {
    if (send) return;
    send = { printed: false, mailed: false, aside: false };
    lowerEnvelope();
    bringStamp(press);
  }
  // the stamp goes onto the sheet's box first: up onto the held sheet if it is up (things come to the visitor), back
  // onto its spot on the board if it stands aside; standing on its spot already, it presses at once
  function bringStamp(then) {
    const held = lifted();
    if (held && held.mesh === sheetMesh) {
      tweens.cancel('stampMove');
      sheetMesh.attach(stampGroup);
      moveStamp(stampOnSheet, new THREE.Quaternion(), 380, () => { stampAt = 'home'; then(); });
    } else if (stampAt === 'home') then();
    else {
      tweens.cancel('stampMove');
      stampParent.attach(stampGroup);
      moveStamp(stampHome, stampHomeQuat, 380, () => { stampAt = 'home'; then(); });
    }
  }
  function press() { // ka-CHUNK
    if (!send || send.pressing) return;
    send.pressing = true;
    tweenJoint(plunger, plunger.userData.joint.max, 140, 'inQuad', () => print());
  }
  function print() {
    if (!send || send.printed) return;
    send.printed = true;
    const date = stampDate();
    play('stamp_press', { volume: 1 });
    sheetOpts = { ...sheetOpts, stamped: { date } }; // a copy stays "Din kopi"
    drawSheet();
    found('stamp');
    tweenJoint(plunger, 0, 260, 'outBack', null, 220);
    // lift the stamp off the paper and set it down beside the sheet on the board, so the print shows
    tweens.cancel('stampMove');
    stampParent.attach(stampGroup);
    moveStamp(stampAside, stampHomeQuat, 650, () => {
      stampAt = 'aside';
      if (send && send.mailed) send = null; else if (send) send.aside = true;
    }, 700);
    if (!torn) { torn = true; setTimeout(() => tearOriginal(date), 1500); }
  }
  // the finger lifts: the print lands now if it had not yet, and the visitor's email opens (inside the touch). A hold
  // the system cancelled (no lift) opens nothing by itself: the envelope rises at once for a tap.
  function releaseStamp(e) {
    if (!send || send.mailed) return;
    if (!send.printed) {
      if (stampAt !== 'home') { // still on its way back to the sheet: set it down now
        tweens.cancel('stampMove');
        if (stampGroup.parent === sheetMesh) { stampGroup.position.copy(stampOnSheet); stampGroup.quaternion.identity(); } else homeStamp();
        stampAt = 'home';
      }
      send.pressing = true;
      tweens.cancel(`j${plunger.uuid}`);
      setJoint(plunger, plunger.userData.joint.max);
      print();
    }
    openMail({ navigate: !(e && e.cancelled) });
    if (send && send.aside) send = null;
  }
  // the original tears off and goes into an envelope in the bottom drawer; the copy stays on the board. It is plain
  // paper lit by the room like the sheet on the board: the little light of a sheet held up to read (systems/paper.js)
  // stays with the sheet in the hand, never on the paper going into the drawer.
  function tearOriginal(date) {
    play('paper_tear', { volume: 0.8 });
    const original = new THREE.Mesh(sheetMesh.geometry, sheetMesh.material.clone());
    const snap = canvasSheet(SHEET.W, SHEET.H);
    snap.getContext('2d').drawImage(sheetCanvas, 0, 0);
    original.material.map = new THREE.CanvasTexture(snap);
    original.material.map.colorSpace = THREE.SRGBColorSpace;
    original.material.emissive.set(0x000000); // as the paper material comes from the library: no light of its own
    original.material.emissiveMap = null;
    original.material.emissiveIntensity = 1;
    sheetMesh.updateWorldMatrix(true, false);
    original.applyMatrix4(sheetMesh.matrixWorld);
    scene.add(original);
    sheetOpts = { ...sheetOpts, copy: true, stamped: { date } };
    drawSheet();
    const p0 = original.position.clone();
    const drawerFront = V_.parts.drawerBottomPivot.getWorldPosition(new THREE.Vector3());
    setDrawer('Bottom', true, 600);
    tweens.add({
      key: 'fold', from: 0, to: 1, duration: 1300, ease: 'inOutSine',
      onUpdate: (v) => {
        original.scale.set(1, 1, 1 - 0.66 * Math.min(1, v * 1.6)); // folded in three
        original.position.lerpVectors(p0, drawerFront.clone().add(new THREE.Vector3(0, 0.05, 0.12)), v);
        if (v > 0.35 && !original.userData.rustled) { original.userData.rustled = true; play('paper_rustle', { volume: 0.7 }); }
      },
      onDone: () => {
        original.removeFromParent();
        original.material.map.dispose(); // the geometry is the sheet's own (kept)
        original.material.dispose();
        setDrawer('Bottom', false, 700);
      },
    });
    loop.wake(3000);
  }

  // ---- the email
  function goToMail(href) {
    ctx.lastMail = href;
    ctx.mailOpens = (ctx.mailOpens || 0) + 1;
    if (noMail()) return; // test runs: never start a mail program
    try { window.location.href = href; } catch (e) { console.warn('mail app did not open', e); }
  }
  function openMail({ navigate = true } = {}) {
    mailHref = buildOfferMail({ to: '', state, baseUrl: location.origin + location.pathname });
    ctx.lastMail = mailHref;
    if (send) send.mailed = true;
    setMirrorMessage(LINES.mailReady || [LINES.readyToSend]);
    clearTimeout(envelopeTimer);
    if (!navigate) { if (pageVisible()) raiseEnvelope(); return; }
    goToMail(mailHref);
    // still here a moment later (no mail app answered): an envelope rises from the bottom drawer
    envelopeTimer = setTimeout(() => { if (pageVisible()) raiseEnvelope(); }, WIRING.mailFallbackMs);
  }

  // ---- the envelope (the fallback when the mail app did not open by itself)
  function makeEnvelope() {
    const c = canvasSheet(1024, 724);
    const g = c.getContext('2d');
    g.fillStyle = '#f3efe6';
    g.fillRect(0, 0, 1024, 724);
    g.strokeStyle = 'rgba(120,110,95,0.35)'; // the flap's folds
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(8, 8); g.lineTo(512, 330); g.lineTo(1016, 8); g.stroke();
    g.fillStyle = '#abc037';
    g.fillRect(60, 646, 120, 10);
    g.fillStyle = '#282827';
    g.textAlign = 'center';
    const { main, sub } = envelopeText();
    g.font = `760 84px ${FONT}`;
    const words = main.split(' ');
    const half = Math.ceil(words.length / 2);
    g.fillText(words.slice(0, half).join(' '), 512, 410);
    g.fillText(words.slice(half).join(' '), 512, 505);
    if (sub) {
      g.font = `500 44px ${FONT}`;
      g.fillStyle = '#3f4042';
      g.fillText(sub, 512, 570);
    }
    g.textAlign = 'left';
    g.font = `500 34px ${FONT}`;
    g.fillStyle = '#5a5a56';
    g.fillText('Gratis befaring · Straume Våtrom AS', 200, 662);
    const m = makeSheetMesh(0.229, 0.162, c, ctx.materials); // a C5 envelope
    m.name = 'envelope';
    m.userData.texture.needsUpdate = true;
    return m;
  }
  function raiseEnvelope() {
    if (!mailHref) return;
    if (!envelope) {
      envelope = makeEnvelope();
      interaction.register(envelope, { tap: () => { play('paper_rustle', { volume: 0.5 }); goToMail(mailHref); }, knock: 'wood' });
    }
    if (envelope.parent) return; // already up
    setDrawer('Bottom', true, 500);
    const L = ctx.layout;
    const inside = new THREE.Vector3();
    (V_.anchors.drawerBottomInside || V_.parts.drawerBottomPivot).getWorldPosition(inside);
    const top = ctx.fixtureModule && ctx.fixtureModule.counterTop ? ctx.fixtureModule.counterTop(L) : L.vanity.top + 0.02;
    const b = L.vanity.basin;
    // up out of the drawer and onto the counter's front edge in front of the basin, leaning back a little, facing the room
    const end = new THREE.Vector3(b.x, top + 0.081 * Math.cos(0.2), L.vanity.depth - 0.035);
    const start = inside.clone().add(new THREE.Vector3(0, 0.03, 0.2));
    const via = new THREE.Vector3(end.x, top + 0.2, L.vanity.depth + 0.12);
    const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const standing = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0, 0));
    envelope.position.copy(start);
    envelope.quaternion.copy(flat);
    scene.add(envelope);
    tweens.add({
      key: 'envelope', from: 0, to: 1, duration: 1100, delay: 450, ease: 'inOutSine',
      onUpdate: (v) => {
        const a = start.clone().lerp(via, v);
        envelope.position.copy(a.lerp(via.clone().lerp(end, v), v));
        envelope.quaternion.slerpQuaternions(flat, standing, v);
      },
      onDone: () => setDrawer('Bottom', false, 700),
    });
    play('paper_slide', { volume: 0.5, delay: 0.45 });
    loop.wake(2000);
  }
  function lowerEnvelope() {
    clearTimeout(envelopeTimer);
    if (envelope && envelope.parent) {
      tweens.cancel('envelope');
      envelope.removeFromParent();
      loop.wake(200);
    }
  }

  // ---- the sheet: tap it to hold it up and read it; a size box there picks the size; a hold in its stamp box (or on
  // the stamp standing in it, which comes up with the sheet) stamps and sends exactly like the stamp on the board
  interaction.register(sheetMesh, {
    tap() {
      found('sheet');
      const held = holdUp(sheetMesh, {
        normal: new THREE.Vector3(0, 1, 0), // the sheet is modelled lying on the board, its top toward the wall
        up: new THREE.Vector3(0, 0, -1),
        targets: [sheetMesh, ...stampMeshes],
        onTap(hit) {
          if (stampMeshes.includes(hit.object)) { stampHandler.tap(); return; }
          if (!hit.uv) return;
          if (flipAt(hit.uv.x, hit.uv.y, sheetOpts.side)) { turnSheet(); return; }
          const size = sheetOpts.side === 'front' ? sizeTickAt(hit.uv.x, hit.uv.y) : null;
          if (!size || (size === state.size && state.sizeChosen)) return;
          found('size');
          if (size === state.size) { // the size the range already assumed: the pencil ticks it, the range stays
            state.sizeChosen = true;
            drawSheet();
            play('paper_rustle', { volume: 0.4, rate: 1.4 });
            return;
          }
          const before = snapshot();
          state.size = size;
          state.sizeChosen = true;
          rewriteRange(before);
          play('paper_rustle', { volume: 0.4 });
        },
        onHoldAt: isStampHit, // only the stamp box takes a hold; elsewhere a resting finger reads
        onHold: (hit) => { if (!isStampHit(hit)) return false; stampAndSend(); return true; },
        onHoldEnd: (hit, e) => releaseStamp(e),
        onDrop: () => {
          sheetOpts = { ...sheetOpts, side: 'front', held: false, flippable: false }; // it lies front up on the board
          drawSheet();
          if (stampGroup.parent !== sheetMesh) return;
          const waiting = !!send && !send.pressing; // it was still on its way onto the sheet: it stamps on the board
          homeStamp();
          if (waiting) press();
        },
      });
      if (held) { sheetOpts = { ...sheetOpts, held: true, flippable: !!held.ctl.flip }; drawSheet(); }
    },
    knock: 'wood',
  });

  // turn the held sheet over: the paper turns edge-on, its other side is drawn, it turns back to the eye
  function turnSheet() {
    const held = lifted();
    if (!held || held.mesh !== sheetMesh || !held.ctl.flip) return;
    play('paper_slide', { volume: 0.4, rate: 1.3 });
    held.ctl.flip(() => { sheetOpts = { ...sheetOpts, side: sheetOpts.side === 'back' ? 'front' : 'back' }; drawSheet(); });
  }

  return {
    get side() { return sheetOpts.side; },
    get sheetOptions() { return { ...sheetOpts }; }, // what the sheet shows (tests)
    drawSheet, rewriteRange, snapshot, stampAndSend, releaseStamp, raiseEnvelope, sheetMesh, stampMeshes,
    get envelope() { return envelope; },
    get stampAt() { return stampAt; },
    get sending() { return send; },
  };
}

// The envelope's words (data/texts.js LINES.mailFallback: the instruction, then a smaller line), else the instruction.
function envelopeText() {
  const t = LINES.mailFallback;
  if (Array.isArray(t)) return { main: t[0], sub: t[1] || '' };
  return { main: t || WIRING.envelopeText, sub: '' };
}
