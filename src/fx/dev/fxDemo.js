// Dev page for the effects (app/fx-demo.html): the tap running into the vessel basin, the rain shower behind its
// glass, steam, and a fogged mirror you wipe with the mouse (or a finger), driven through fx.install() - the same
// wiring the app gets - with a panel of sliders. It builds the real fixtures when they load (?fixtures=0 uses simple
// stand-ins instead). Not part of the visitor's app: the panel and preset views are here on purpose, for checking the
// effects by eye. ?q=low runs the weak-phone path. Shader compile errors are listed in red on the page.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { LAYOUT } from '../../data/layout.js';
import { createMaterials } from '../../core/materials.js';
import * as fx from '../index.js';

const params = new URLSearchParams(location.search);
const quality = params.get('q') === 'low' ? 'low' : 'high';
const L = LAYOUT;
const R = L.room;

// ---------------------------------------------------------------- renderer, scene, camera
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.AgXToneMapping; // as main.js
document.getElementById('stage').appendChild(renderer.domElement);

const shaderErrors = [];
// the log plus the source lines around each reported error line ("ERROR: 0:123: ...")
function excerpt(gl, shader, stage) {
  const logText = gl.getShaderInfoLog(shader) || '';
  if (!logText.trim()) return '';
  const lines = (gl.getShaderSource(shader) || '').split('\n');
  const out = [`${stage}: ${logText.trim()}`];
  for (const m of logText.matchAll(/ERROR:\s*\d+:(\d+)/g)) {
    const n = Number(m[1]);
    for (let k = Math.max(1, n - 3); k <= Math.min(lines.length, n + 3); k++) out.push(`${k === n ? '>' : ' '} ${k}: ${lines[k - 1]}`);
  }
  return out.join('\n');
}
renderer.debug.onShaderError = (gl, program, vs, fs) => {
  const msg = [gl.getProgramInfoLog(program), excerpt(gl, vs, 'vertex'), excerpt(gl, fs, 'fragment')].filter((s) => s && s.trim()).join('\n');
  shaderErrors.push(msg);
  console.error('fx shader error:\n' + msg);
  showErrors();
};
function showErrors() {
  const el = document.getElementById('errors');
  el.textContent = shaderErrors.length ? `Shader errors (${shaderErrors.length}):\n\n${shaderErrors.join('\n\n')}` : '';
  el.hidden = !shaderErrors.length;
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1c1b19);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.03, 30);
const VIEWS = {
  start: { pos: [L.camera.start.x, L.camera.start.y, L.camera.start.z], look: [L.camera.lookAt.x, L.camera.lookAt.y, L.camera.lookAt.z] },
  basin: { pos: [1.78, 1.32, 0.86], look: [1.75, 0.86, 0.22] },
  mirror: { pos: [1.72, 1.52, 1.05], look: [1.75, 1.45, 0.14] },
  shower: { pos: [1.95, 1.55, 1.75], look: [0.55, 1.0, 0.4] },
  glass: { pos: [1.7, 1.4, 1.3], look: [1.0, 1.2, 0.45] },
};
function setView(name) {
  const v = VIEWS[name];
  camera.position.set(...v.pos);
  camera.lookAt(...v.look);
  for (const b of document.querySelectorAll('[data-view]')) b.classList.toggle('on', b.dataset.view === name);
}

const materials = createMaterials();
const ctx = { THREE, scene, camera, renderer, loop: null, tweens: null, assets: null, materials, audio: null, layout: L, quality };

// ---------------------------------------------------------------- the room: a plain shell, then fixtures or stand-ins
function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  scene.add(m);
  return m;
}
function plane(w, h, mat, pos, rotY = 0, rotX = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(...pos);
  m.rotation.set(rotX, rotY, 0);
  scene.add(m);
  return m;
}
plane(R.W, R.D, materials.get('tileSand'), [R.W / 2, 0, R.D / 2], 0, -Math.PI / 2); // floor
plane(R.W, R.H, materials.get('tileWhite'), [R.W / 2, R.H / 2, 0]); // back wall
plane(R.D, R.H, materials.get('tileWhite'), [0, R.H / 2, R.D / 2], Math.PI / 2); // left wall
plane(R.D, R.H, materials.get('paint'), [R.W, R.H / 2, R.D / 2], -Math.PI / 2); // right wall
plane(R.W, R.D, materials.get('paint'), [R.W / 2, R.H, R.D / 2], 0, Math.PI / 2); // ceiling
const ceilingLight = new THREE.PointLight(0xffe2c0, 7, 0, 2);
ceilingLight.position.set(1.4, R.H - 0.05, 1.3);
scene.add(ceilingLight);
scene.add(new THREE.HemisphereLight(0xfff4e8, 0x8a8070, 0.35));

let fixtureNote = 'stand-ins';
if (params.get('fixtures') !== '0') {
  try {
    const F = await import('../../fixtures/index.js');
    ctx.fixtures = F.createAllFixtures(ctx, {}, scene);
    fixtureNote = 'real fixtures';
  } catch (e) {
    console.warn('fixtures did not build, using stand-ins:', e);
    fixtureNote = `stand-ins (fixtures failed: ${e && e.message})`;
    ctx.fixtures = null;
  }
}
if (!ctx.fixtures) buildStandIns();

// Simple stand-ins in the LAYOUT positions (the vessel basin lathed from the effects' own default bowl curve).
function buildStandIns() {
  const v = L.vanity;
  box(v.x1 - v.x0, v.top - v.bottom - 0.02, v.depth, materials.get('oak'), (v.x0 + v.x1) / 2, (v.top + v.bottom - 0.02) / 2, v.depth / 2);
  box(v.x1 - v.x0 + 0.01, 0.02, v.depth + 0.01, materials.get('stoneTop'), (v.x0 + v.x1) / 2, v.top - 0.01, v.depth / 2);
  const dims = fx.basinDims(v.basin);
  const prof = fx.vesselProfile(dims);
  const pts = [new THREE.Vector2(0.001, dims.floor)];
  for (let k = 0; k <= 24; k++) pts.push(new THREE.Vector2(prof.radiusAt((dims.innerDepth * k) / 24), dims.floor + (dims.innerDepth * k) / 24));
  pts.push(new THREE.Vector2(dims.outerRadius - 0.002, dims.height + 0.002), new THREE.Vector2(dims.outerRadius, dims.height - 0.004));
  for (let k = 1; k <= 12; k++) pts.push(new THREE.Vector2(dims.outerRadius - 0.03 * (k / 12) ** 2, dims.height * (1 - k / 12)));
  const ceramic = materials.get('ceramicWhite').clone();
  ceramic.side = THREE.DoubleSide;
  const basinMesh = new THREE.Mesh(new THREE.LatheGeometry(pts, 72), ceramic);
  basinMesh.position.set(v.basin.x, v.top, v.basin.z);
  scene.add(basinMesh);
  const outlet = fx.defaultTapOutlet(L);
  const chrome = materials.get('chrome');
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, outlet.y + 0.03 - v.top, 32), chrome);
  body.position.set(v.mixer.x, (outlet.y + 0.03 + v.top) / 2, v.mixer.z);
  scene.add(body);
  const reach = outlet.z - v.mixer.z;
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, reach, 24), chrome);
  spout.rotation.x = Math.PI / 2;
  spout.position.set(v.mixer.x, outlet.y + 0.018, v.mixer.z + reach / 2);
  scene.add(spout);
  box(0.023, 0.02, 0.023, chrome, outlet.x, outlet.y + 0.01, outlet.z);
  const m = L.mirror;
  box(m.x1 - m.x0, m.y1 - m.y0, m.depth - 0.004, materials.get('plasticWhite'), (m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2, (m.depth - 0.004) / 2);
  plane(m.x1 - m.x0, m.y1 - m.y0, materials.get('mirror'), [(m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2, m.depth]);
  const rh = L.shower.rainHead;
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.008, 48), chrome);
  head.position.set(rh.x, rh.y + 0.004, rh.z);
  scene.add(head);
  const g = L.shower.glass;
  box(g.thickness, g.height, g.z1 - g.z0, quality === 'low' ? materials.get('glassSimple') : materials.get('glass'), g.x, g.height / 2, (g.z0 + g.z1) / 2);
}

// ---------------------------------------------------------------- the effects, through install()
const api = fx.install(ctx, { sound: false });
const log = [];
for (const type of ['tap:start', 'tap:stop', 'basin:full', 'basin:drainStart', 'basin:gurgle', 'basin:empty', 'shower:start',
  'shower:stop', 'drip:fall', 'drip:land', 'mirror:written']) {
  api.on(type, (info) => {
    const extra = info && Number.isFinite(info.speed) && info.speed > 0 ? ` ${info.speed.toFixed(1)} m/s` : '';
    log.unshift(`${(performance.now() / 1000).toFixed(1)} s  ${type}${extra}`);
    log.length = Math.min(log.length, 8);
  });
}
api.greet(); // the mirror wakes fogged with the greeting, as at the start of a visit

// ---------------------------------------------------------------- panel
const s = api.state;
function bindRange(id, set, init) {
  const el = document.getElementById(id);
  el.value = init;
  el.addEventListener('input', () => set(Number(el.value)));
}
bindRange('tapFlow', (v) => api.setTap(v), s.tapFlow);
bindRange('tapTemp', (v) => api.setTap(undefined, v), s.tapTemp);
bindRange('showerFlow', (v) => api.setShower(v), s.showerFlow);
bindRange('showerTemp', (v) => api.setShower(undefined, v), s.showerTemp);
bindRange('fan', (v) => api.setFan(v), s.fan);
bindRange('window', (v) => api.setWindow(v), s.window);
function bindToggle(id, get, set, onLabel, offLabel) {
  const el = document.getElementById(id);
  const paintIt = () => { el.textContent = get() ? onLabel : offLabel; el.classList.toggle('on', get()); };
  el.addEventListener('click', () => { set(!get()); paintIt(); });
  paintIt();
}
bindToggle('plug', () => s.plug, (v) => api.setPlug(v), 'Plug open (draining)', 'Plug closed');
bindToggle('heater', () => s.heater, (v) => api.setMirrorHeater(v), 'Mirror heater on', 'Mirror heater off');
bindToggle('drip', () => s.drip, (v) => api.setDrip(v), 'Drip on', 'Drip off');
document.getElementById('write').addEventListener('click', () => api.greet());
document.getElementById('refog').addEventListener('click', () => api.mirrorFog.clear());
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => setView(b.dataset.view));
document.getElementById('quality').textContent = quality === 'low' ? 'Quality: low (weak phone)' : 'Quality: high';
document.getElementById('quality').href = quality === 'low' ? '?q=high' : '?q=low';
setView(params.get('view') && VIEWS[params.get('view')] ? params.get('view') : 'basin');

// ---------------------------------------------------------------- wiping with the mouse or a finger
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const fogs = [api.mirrorFog, api.glassFog];
let wiping = null;
function hitFog(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(fogs.flatMap((f) => f.meshes), false);
  if (!hits.length) return null;
  return { fog: fogs.find((f) => f.meshes.includes(hits[0].object)), uv: hits[0].uv };
}
renderer.domElement.addEventListener('pointerdown', (ev) => {
  const h = hitFog(ev);
  if (!h) return;
  wiping = h.fog;
  wiping.wipe(h.uv);
  renderer.domElement.setPointerCapture(ev.pointerId);
});
renderer.domElement.addEventListener('pointermove', (ev) => {
  if (!wiping) return;
  const h = hitFog(ev);
  if (h && h.fog === wiping) wiping.wipe(h.uv);
  else wiping.endStroke();
});
renderer.domElement.addEventListener('pointerup', () => { if (wiping) wiping.endStroke(); wiping = null; });

// ---------------------------------------------------------------- compile everything once, so shader errors show now
const hidden = [];
scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
try { renderer.compile(scene, camera); } finally { for (const o of hidden) o.visible = false; }

// ---------------------------------------------------------------- the loop
const readout = document.getElementById('readout');
let last = performance.now();
let fpsT = 0;
let fpsN = 0;
let fps = 0;
function frame(now) {
  const dt = Math.min(64, now - last);
  last = now;
  fpsT += dt;
  fpsN++;
  if (fpsT > 500) { fps = (fpsN * 1000) / fpsT; fpsT = 0; fpsN = 0; }
  const busy = api.update(dt);
  renderer.render(scene, camera);
  const info = renderer.info;
  readout.textContent = [
    `${fps.toFixed(0)} fps · ${info.render.calls} draw calls · ${(info.render.triangles / 1000).toFixed(1)}k triangles · ${fixtureNote}`,
    `humidity ${api.humidity.value.toFixed(2)} · mirror fog ${api.mirrorFog.density.toFixed(2)} · glass fog ${api.glassFog.density.toFixed(2)} · ${busy ? 'moving' : 'still (the app would sleep)'}`,
    `basin ${api.basin.volume.toFixed(2)} L · ${(api.basin.depth * 1000).toFixed(1)} mm · level ${api.basin.level.toFixed(2)} · ${api.basin.plugOpen ? `draining ${api.basin.outflow.toFixed(2)} L/s` : 'plug closed'}`,
    `tap landing ${api.tap.landedFlow.toFixed(2)} · shower floor wet ${api.spray.wetness.toFixed(2)} · steam puffs ${api.steam.shower.alive + api.steam.basin.alive}`,
    '',
    ...log,
  ].join('\n');
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// for poking at it from the console
window.fxDemo = { THREE, scene, camera, renderer, api, ctx, setView };
