// Paper in the room: sheets drawn on canvas (the company card, the clipboard's "Befaring" sheet, labels) and "lift to
// read": a held sheet rises toward the eye to a readable size; the visitor can bring it closer, slide it and turn it
// over; a tap puts it back. The PAPER moves; the camera never does (concept rule 1).
//
// Text on paper is laid out by a small pure engine (flowText) that takes measure(text, size, weight, family): the room
// passes canvasMeasure(ctx2d), the tests pass the real font metrics (tests/_fontMeasure.mjs). So the check "every line
// fits its paper at a size a phone can read" runs on the same layout code the room draws with.
import * as THREE from 'three';

export const FONT = "'Exhibit Sans', system-ui, sans-serif";
export const HAND = "'Caveat', 'Segoe Print', 'Comic Sans MS', cursive";
export const FAMILIES = { sans: FONT, hand: HAND };

// Phone reading size. A held paper is about 0.93 x the width of an upright phone (see liftSheet): on a 375 px phone a
// 1000-px-wide paper canvas shows at x0.35, so 46 canvas px is 16 px on screen, the concept's floor (rule 9, check 13.5).
export const PAPER_W = 1000;
export const PAPER_MIN_PX = 46;
export const INK = '#2b2c2e';
export const INK_SOFT = '#4a4b4f';
export const GREEN = '#abc037'; // Straume green: bars and marks, too light for words on white
export const GREEN_INK = '#5b7514'; // green for words on paper (the stamp's ink family)
export const PENCIL = 'rgba(45,45,48,0.95)';

export function canvasSheet(wPx, hPx) {
  const c = document.createElement('canvas');
  c.width = wPx;
  c.height = hPx;
  return c;
}

export function makeSheetMesh(widthM, heightM, canvas, materials) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const mat = materials.get('paper').clone();
  mat.map = tex;
  mat.color.set(0xffffff);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthM, heightM), mat);
  mesh.userData.texture = tex;
  return mesh;
}

// ---------------------------------------------------------------------------------------------------------------
// Text layout (pure)

export function fontCss(size, weight = 430, family = 'sans') {
  return `${weight} ${Math.round(size * 100) / 100}px ${FAMILIES[family] || family}`;
}

// measure(text, size, weight, family) -> width in px, backed by a 2D canvas context.
export function canvasMeasure(g) {
  return (text, size, weight = 430, family = 'sans') => {
    g.font = fontCss(size, weight, family);
    return g.measureText(text).width;
  };
}

// Splits text into lines no wider than maxW. Words are never broken (a single word wider than maxW keeps a line of its
// own; the tests catch that); '\n' forces a break; no-break spaces (U+00A0) hold numbers like 250 000 together.
export function wrapText(text, maxW, size, weight, family, measure) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      if (!word) continue;
      const t = line ? `${line} ${word}` : word;
      if (line && measure(t, size, weight, family) > maxW) { out.push(line); line = word; } else line = t;
    }
    out.push(line);
  }
  return out;
}

// The ink of a line, in em above and below its baseline: the ring on Å and the tail of g, measured in the two fonts at
// every weight used (tests/font-metrics.json; tests/paper.test.js checks these cover them). A line's pitch is never
// less than ascent + descent, so lines never touch.
export const VERT = { sans: { ascent: 1.01, descent: 0.2 }, hand: { ascent: 0.88, descent: 0.24 } };
const vert = (family) => VERT[family] || VERT.sans;

// Lays out blocks top to bottom in the column { x, w } from `top`. A block: { text, size, weight = 430, family = 'sans',
// color, align: 'left'|'center'|'right', gap (px before it), lead (line height / size, default 1.25), indent, w (a
// narrower column), tag }. Returns { lines, bottom, scale, fits }; each line: { text, x, w, y (baseline), size, weight,
// family, color, align, tag, width }. If the blocks pass `bottom`, every size shrinks a little (to minScale): that only
// happens with a fallback font, and the tests hold the real fonts to scale 1.
export function flowText(blocks, measure, { x = 0, w, top = 0, bottom = Infinity, minScale = 0.86 } = {}) {
  let last = null;
  for (let k = 1; k >= minScale - 1e-9; k -= 0.02) {
    const r = placeBlocks(blocks, measure, x, w, top, k);
    if (r.bottom <= bottom) return { ...r, scale: k, fits: true };
    last = { ...r, scale: k, fits: false };
  }
  return last;
}

function placeBlocks(blocks, measure, x0, w0, top, k) {
  const lines = [];
  let y = top;
  for (const b of blocks) {
    if (!b || b.text == null || b.text === '') continue;
    const size = b.size * k;
    const weight = b.weight ?? 430;
    const family = b.family ?? 'sans';
    const lead = b.lead ?? 1.25;
    const indent = b.indent ?? 0;
    const bx = x0 + indent;
    const bw = (b.w ?? w0) - indent;
    y += (b.gap ?? 0) * k;
    const v = vert(family);
    for (const text of wrapText(b.text, bw, size, weight, family, measure)) {
      lines.push({
        text, x: bx, w: bw, y: y + size * v.ascent, size, weight, family, color: b.color, align: b.align || 'left', tag: b.tag,
        width: measure(text, size, weight, family),
      });
      y += size * Math.max(lead, v.ascent + v.descent);
    }
  }
  return { lines, bottom: y };
}

// One fixed line (not flowed), in the same shape as a flowed one.
export function fixedLine(text, { x, y, w = 0, size, weight = 430, family = 'sans', color, align = 'left', tag }, measure) {
  return { text, x, y, w, size, weight, family, color, align, tag, width: measure(text, size, weight, family) };
}

// The box a line's ink can occupy (for overlap checks): from its accent height to below its descenders.
export function lineBox(l) {
  const left = l.align === 'center' ? l.x + (l.w - l.width) / 2 : l.align === 'right' ? l.x + l.w - l.width : l.x;
  const v = vert(l.family);
  return { x0: left, x1: left + l.width, y0: l.y - l.size * v.ascent, y1: l.y + l.size * v.descent };
}

// Draws laid-out lines; s scales design px to canvas px. reveal[tag] (0..1) writes only that much of a line (the
// pencil); a line's alpha (0..1, default 1) fades it.
export function paintLines(g, lines, s = 1, { reveal = null } = {}) {
  for (const l of lines) {
    const alpha = l.alpha ?? 1;
    if (alpha <= 0.003) continue;
    g.globalAlpha = alpha;
    g.font = fontCss(l.size * s, l.weight, l.family);
    g.fillStyle = l.color || INK;
    g.textAlign = l.align;
    const x = l.align === 'center' ? l.x + l.w / 2 : l.align === 'right' ? l.x + l.w : l.x;
    const part = reveal && l.tag in reveal ? l.text.slice(0, Math.round(l.text.length * reveal[l.tag])) : l.text;
    if (part) g.fillText(part, x * s, l.y * s);
  }
  g.globalAlpha = 1;
  g.textAlign = 'left';
}

// ---------------------------------------------------------------------------------------------------------------
// Lift to read

// While a paper is held up it faces the eye, away from the ceiling's downlights, and reads grey: a little of its own
// light (an emissive copy of its print) makes it read as paper in a lit room. Not a glow: the room still shades it.
export const HELD_PAPER_LIGHT = 0.38;
const ZOOM_MAX = 3;
const inSine = (t) => 1 - Math.cos((t * Math.PI) / 2);
const outSine = (t) => Math.sin((t * Math.PI) / 2);

function setHeldLight(mesh, k) {
  const m = mesh.material;
  if (!m || !m.isMeshStandardMaterial) return;
  if (k > 0 && m.emissiveMap !== m.map) {
    m.emissiveMap = m.map;
    m.emissive.set(0xffffff);
    m.needsUpdate = true;
  }
  m.emissiveIntensity = k;
}

// Lift a sheet toward the camera and keep it there. Returns a controller:
//   drop(onDone)            put it back where it came from
//   panBy(dyPx, viewH, dxPx) slide it with the finger (screen px; viewH = the canvas height in CSS px)
//   zoomBy(factor)          bring it closer (> 1) or let it back (< 1), between its first size and 3x
//   flip(onHalf)            turn it over; onHalf() runs edge-on, the moment to redraw the other side
//   refresh()               re-place it in front of the eye (call if the eye moved while it is held)
//   zoom, held              read-only state
// fill / fillW: how much of the screen's height / width the sheet may take at first. normal / up: which way the
// printed face and the top of the text point in the mesh's own geometry (a plain plane: +z and +y; a sheet modelled
// lying flat on a board: +y and -z).
export function liftSheet(ctx, mesh, {
  fill = 0.62, fillW = 0.93, ms = 420, normal = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3(0, 1, 0),
  light = HELD_PAPER_LIGHT,
} = {}) {
  const { camera, scene, tweens, loop } = ctx;
  // the paper's own little light follows the room's (lamps off: dimmer, never too dark to read; scene/lighting.js)
  light *= ctx.roomLight && Number.isFinite(ctx.roomLight.paperLight) ? ctx.roomLight.paperLight : 1;
  const home = { parent: mesh.parent, pos: mesh.position.clone(), quat: mesh.quaternion.clone(), scale: mesh.scale.clone() };
  const startPos = new THREE.Vector3();
  const startQuat = new THREE.Quaternion();
  mesh.getWorldPosition(startPos);
  mesh.getWorldQuaternion(startQuat);
  const worldScale = new THREE.Vector3();
  mesh.getWorldScale(worldScale);
  scene.attach(mesh);
  const geo = mesh.geometry.parameters;
  const h = geo.height * worldScale.y;
  const w = geo.width * worldScale.x;
  // turn the sheet's own printed face toward the eye, text upright: camera rotation x (geometry basis -> plane basis)
  const n = normal.clone().normalize();
  const u = up.clone().normalize();
  const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(u, n), u, n);
  const align = new THREE.Quaternion().setFromRotationMatrix(basis).invert();
  const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.05, 0.02, 0.01)); // a sheet in a hand is never flat
  const turn = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);
  const s = { zoom: 1, offX: 0, offY: 0, spin: 0, lift: 0, dropped: false, flipping: false };
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const upW = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();

  const tanV = () => Math.tan((camera.fov * Math.PI) / 360);
  function baseDist() { // the distance at which the whole sheet fits the screen
    const tanH = tanV() * camera.aspect;
    return Math.max((h / 2) / tanV() / fill, (w / 2) / tanH / fillW, camera.near * 4);
  }
  const dist = () => Math.max(baseDist() / s.zoom, camera.near * 2.5);
  function clampOffsets() { // a sheet larger than the view may slide until its edge meets the screen's edge
    const vh = dist() * tanV();
    const vw = vh * camera.aspect;
    const lx = Math.max(0, w / 2 - vw);
    const ly = Math.max(0, h / 2 - vh);
    s.offX = THREE.MathUtils.clamp(s.offX, -lx, lx);
    s.offY = THREE.MathUtils.clamp(s.offY, -ly, ly);
  }
  function heldPose() {
    const q = camera.quaternion;
    fwd.set(0, 0, -1).applyQuaternion(q);
    right.set(1, 0, 0).applyQuaternion(q);
    upW.set(0, 1, 0).applyQuaternion(q);
    pos.copy(camera.position).addScaledVector(fwd, dist()).addScaledVector(right, s.offX).addScaledVector(upW, s.offY);
    turn.setFromAxisAngle(Y, s.spin);
    quat.copy(q).multiply(turn).multiply(tilt).multiply(align);
  }
  function place() {
    heldPose();
    const t = s.lift;
    mesh.position.lerpVectors(startPos, pos, t);
    mesh.quaternion.slerpQuaternions(startQuat, quat, t);
    loop.wake(250);
  }

  mesh.renderOrder = 10;
  tweens.add({
    key: `lift-${mesh.uuid}`, from: 0, to: 1, duration: ms, ease: 'outCubic',
    onUpdate: (t) => { s.lift = t; place(); setHeldLight(mesh, light * t); },
  });
  loop.wake(ms + 200);

  return {
    get zoom() { return s.zoom; },
    get held() { return !s.dropped; },
    panBy(dyPx, viewH, dxPx = 0) {
      if (s.dropped || !viewH) return;
      const metresPerPx = (2 * dist() * tanV()) / viewH;
      s.offX += dxPx * metresPerPx;
      s.offY -= dyPx * metresPerPx; // the finger moves down the screen: the paper follows it down
      clampOffsets();
      place();
    },
    zoomBy(factor) {
      if (s.dropped || !(factor > 0)) return;
      s.zoom = THREE.MathUtils.clamp(s.zoom * factor, 1, ZOOM_MAX);
      clampOffsets();
      place();
    },
    flip(onHalf, flipMs = 460) {
      if (s.dropped || s.flipping) return;
      s.flipping = true;
      tweens.add({
        key: `flip-${mesh.uuid}`, from: 0, to: Math.PI / 2, duration: flipMs / 2, ease: inSine,
        onUpdate: (v) => { s.spin = v; place(); },
        onDone: () => {
          onHalf?.(); // edge-on: the other side is drawn now, so the turned sheet never shows its print mirrored
          tweens.add({
            key: `flip-${mesh.uuid}`, from: -Math.PI / 2, to: 0, duration: flipMs / 2, ease: outSine,
            onUpdate: (v) => { s.spin = v; place(); },
            onDone: () => { s.flipping = false; },
          });
        },
      });
      loop.wake(flipMs + 200);
    },
    refresh() { if (!s.dropped) place(); },
    drop(onDone) {
      if (s.dropped) return;
      s.dropped = true;
      tweens.cancel(`flip-${mesh.uuid}`);
      const fromPos = mesh.position.clone();
      const fromQuat = mesh.quaternion.clone();
      tweens.add({
        key: `lift-${mesh.uuid}`, from: 0, to: 1, duration: ms * 0.85, ease: 'inOutSine',
        onUpdate: (t) => {
          mesh.position.lerpVectors(fromPos, startPos, t);
          mesh.quaternion.slerpQuaternions(fromQuat, startQuat, t);
          setHeldLight(mesh, light * (1 - t));
        },
        onDone: () => {
          home.parent.add(mesh);
          mesh.position.copy(home.pos);
          mesh.quaternion.copy(home.quat);
          mesh.scale.copy(home.scale);
          mesh.renderOrder = 0;
          setHeldLight(mesh, 0);
          onDone?.();
        },
      });
      loop.wake(ms + 200);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The company card ("Om oss") on Straume letterhead: an A5 card (canvas 1000 x 1414). Front: who we are, the site's six
// reasons, phone and email. Back: the approvals (with FFV's trades), the bath count, address and company number.

export const CARD = {
  W: 1000,
  H: 1414,
  footer: 1150, // the grey contact band (front) starts here
  flip: { x0: 380, x1: 1000, y0: 1330, y1: 1414 }, // "Godkjenninger på baksiden ->" / "<- Tilbake til forsiden"
};

// Is a tap (sheet UV: u left -> right, v bottom -> top) on the card's turn-over corner?
export function cardFlipAt(u, v) {
  const x = u * CARD.W;
  const y = (1 - v) * CARD.H;
  const f = CARD.flip;
  return x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1;
}

function logoLines(measure, { x, y, size }) {
  const lines = [fixedLine('Straume', { x, y, size, weight: 760, color: '#282827', tag: 'logo' }, measure)];
  const barSize = size * 0.52;
  const barW = measure('Våtrom AS', barSize, 600) + barSize * 0.9;
  const bar = { x, y: y + size * 0.22, w: barW, h: barSize * 1.36 };
  lines.push(fixedLine('Våtrom AS', { x: x + barSize * 0.45, y: bar.y + barSize * 1.03, size: barSize, weight: 600, color: '#ffffff', tag: 'logo' }, measure));
  return { lines, bar };
}

// The card's layout as data: { lines, rects, side }. Tested with the real font metrics (tests/paper.test.js).
export function companyCardLayout(C, { side = 'front', flippable = false, flipText = null } = {}, measure) {
  const X = 70;
  const Wd = CARD.W - 2 * X;
  const lines = [];
  const rects = {};
  const logo = logoLines(measure, { x: X, y: 120, size: 70 });
  lines.push(...logo.lines);
  rects.bar = logo.bar;
  if (side === 'front') {
    const body = flowText([
      { text: C.tagline, size: 64, weight: 800, color: INK, lead: 1.15 },
      { text: C.intro, size: 48, weight: 430, color: INK_SOFT, gap: 10 },
      { text: C.promisesHeading, size: 52, weight: 700, color: INK, gap: 36, lead: 1.2 },
      ...C.promises.map((p, i) => ({ text: p, size: 50, weight: 450, color: INK, indent: 44, gap: i ? 4 : 12, tag: 'promise' })),
    ], measure, { x: X, w: Wd, top: 236, bottom: CARD.footer - 24 });
    lines.push(...body.lines);
    rects.footer = { x: 0, y: CARD.footer, w: CARD.W, h: CARD.H - CARD.footer };
    lines.push(fixedLine(C.phone, { x: X, y: CARD.footer + 82, size: 56, weight: 760, color: '#282827', tag: 'contact' }, measure));
    lines.push(fixedLine(C.email, { x: X, y: CARD.footer + 152, size: 48, weight: 600, color: '#282827', tag: 'contact' }, measure));
    return { lines, rects, side, fits: body.fits, scale: body.scale, flipLine: flipLine(flippable, flipText || 'Godkjenninger på baksiden →', 'right', measure, lines) };
  }
  const body = flowText([
    { text: C.credentialsHeading, size: 56, weight: 800, color: INK, lead: 1.15 },
    ...C.credentials.map((c, i) => ({ text: c, size: 46, weight: 450, color: INK, indent: 40, gap: i ? 14 : 12, tag: 'credential' })),
  ], measure, { x: X, w: Wd, top: 236, bottom: 900 });
  lines.push(...body.lines);
  const countY = body.bottom + 110;
  const count = fixedLine(C.built.count, { x: X, y: countY, size: 100, weight: 800, color: '#282827', tag: 'count' }, measure);
  lines.push(count);
  // "bad bygget" / "(per oktober 2026)": the date on a line of its own, beside the big number
  const note = flowText([{ text: C.built.note.replace(' (', '\n('), size: 46, weight: 450, color: INK_SOFT }], measure,
    { x: X + count.width + 28, w: Wd - count.width - 28, top: countY - 100 * 0.7 });
  lines.push(...note.lines);
  const contact = flowText([
    { text: `${C.name}\n${C.address}`, size: 46, weight: 450, color: INK },
    { text: `${C.web}  ·  Org.nr ${C.orgnr}`, size: 46, weight: 450, color: INK, gap: 4 },
    { text: `${C.since}  ·  ${C.demo}`, size: 46, weight: 450, color: INK_SOFT, gap: 4 },
  ], measure, { x: X, w: Wd, top: Math.max(countY + 70, note.bottom + 30), bottom: CARD.flip.y0 - 6 });
  lines.push(...contact.lines);
  const fits = body.fits && contact.fits && note.fits;
  return { lines, rects, side, fits, scale: Math.min(body.scale, contact.scale), flipLine: flipLine(flippable, flipText || '← Tilbake til forsiden', 'right', measure, lines) };
}

function flipLine(flippable, text, align, measure, lines) {
  if (!flippable) return null;
  const f = CARD.flip;
  const l = fixedLine(text, { x: f.x0, w: f.x1 - f.x0 - 70, y: f.y0 + 58, size: 46, weight: 650, color: GREEN_INK, align, tag: 'flip' }, measure);
  lines.push(l);
  return l;
}

export function drawCompanyCard(canvas, C, opts = {}) {
  const g = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const s = W / CARD.W;
  const L = companyCardLayout(C, opts, canvasMeasure(g));
  g.fillStyle = '#fbfaf6';
  g.fillRect(0, 0, W, H);
  if (L.rects.footer) {
    const f = L.rects.footer;
    g.fillStyle = '#efefef';
    g.fillRect(f.x * s, f.y * s, f.w * s, f.h * s);
  }
  const b = L.rects.bar;
  g.fillStyle = GREEN;
  g.beginPath();
  g.roundRect(b.x * s, b.y * s, b.w * s, b.h * s, 12 * s);
  g.fill();
  for (const l of L.lines) {
    if (l.tag !== 'promise') continue;
    g.fillStyle = GREEN;
    g.beginPath();
    g.arc((l.x - 22) * s, (l.y - l.size * 0.34) * s, 9 * s, 0, Math.PI * 2);
    g.fill();
  }
  paintLines(g, L.lines, s);
  return L;
}
