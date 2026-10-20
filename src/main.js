// Boots the 3D bathroom. The start view comes first: the hallway, the closed door with the light under it and the
// doormat need only three.js, the fonts and the oak, so a phone on mobile data sees the door in seconds; the bathroom
// behind the door loads while the visitor looks around (a tap on the door presses its handle, and the door opens the
// moment the room is ready). Then: the shell, the light bake, the fixtures, effects, wiring, and the room's own light.
//
// Light (2026-10-19, phase 2 "realism"): the visitor's clock picks the day or the evening bake (scene/mood.js); a
// camera on top balances and exposes the picture (warm lamps stay warm, whites read white); the fixtures and the mirror
// get this room's own light, photographed from inside it (scene/roomEnvironment.js), and the hallway its own.
import * as THREE from 'three';
import { LAYOUT } from './data/layout.js';
import { createMaterials } from './core/materials.js';
import { createAssets } from './core/assets.js';
import { createLoop } from './core/loop.js';
import { createTweens } from './core/tween.js';
import { createCameraRig } from './core/cameraRig.js';
import { createInteraction } from './core/interaction.js';
import { guessQuality, createFrameGovernor, GOVERNOR_STEPS } from './core/quality.js';
import { createAudio } from './systems/audio.js';
import { createShell } from './scene/shell.js';
import { moodAt, grade, skyAt, gradedToneMapping } from './scene/mood.js';
import {
  createProbe, captureHides, boxProjected, roomBox, ROOM_PROBE, HALL_PROBE, gateHallway, finishEyeDraws, warmEyeDraws,
  photographOnArrival, governorSteps, createDoorLight, doorLightMaterials,
} from './scene/roomEnvironment.js';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('room');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const device = deviceInfo(renderer);
const forced = params.get('q') === 'low' || params.get('q') === 'high' ? params.get('q') : null;
const quality = forced || guessQuality(device);
let ratioCap = quality === 'low' ? 1.5 : 2;
const applyRatio = () => renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ratioCap));
applyRatio();
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.0;
console.info(`quality ${quality}${forced ? ' (asked for)' : ''}; graphics: ${device.gpu || 'unknown'}`);

// The light mood by the visitor's clock (the sun over Bergen); ?mood=day|evening and ?sky=day|dusk|night for checks.
// A weak phone keeps one light bake (the evening's, lamps on) and shows the hour through the window only.
const when = moodAt(new Date());
const askedMood = ['day', 'evening'].includes(params.get('mood')) ? params.get('mood') : null;
const MOOD = askedMood || when.mood;
const askedSky = ['day', 'dusk', 'night'].includes(params.get('sky')) ? params.get('sky') : null;
const SKY = askedSky || (askedMood ? (askedMood === 'day' ? 'day' : 'dusk') : when.sky);
const BAKE_MOOD = quality === 'low' ? 'evening' : MOOD;
const TONE_CHUNK = THREE.ShaderChunk.tonemapping_pars_fragment;
console.info(`light: ${MOOD} (sun ${when.elevation.toFixed(1)} deg), sky ${SKY}, bake ${BAKE_MOOD}`);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1c1b19);
const camera = new THREE.PerspectiveCamera(70, 1, 0.03, 40);
const materials = createMaterials();
const tweens = createTweens();
const audio = createAudio();
const assets = createAssets(renderer, quality);
const rig = createCameraRig(camera, LAYOUT);
const loop = createLoop(() => renderer.render(scene, camera));
loop.add((dt) => { tweens.update(dt); return tweens.active() > 0; });
loop.add((dt) => rig.update(dt));

const ctx = { THREE, scene, camera, renderer, loop, tweens, assets, materials, audio, layout: LAYOUT, quality, rig, gpu: device.gpu };
ctx.lightMood = { mood: MOOD, sky: SKY, bake: BAKE_MOOD, sunElevation: when.elevation };

const interaction = createInteraction({
  canvas, camera, rig,
  onAnyInput: () => { loop.wake(1800); audio.unlock(); },
  onKnock: (hit, kind) => knock(kind, hit),
});
ctx.interaction = interaction;
interaction.tickLoop = loop.add(() => { interaction.tick(); return false; });

function knock(kind, hit) {
  audio.play(`knock_${kind}`, { volume: 0.8 });
  ctx.onKnock?.(kind, hit);
}

// What the device says about itself (the graphics chip's name where the browser gives it).
function deviceInfo(r) {
  let gpu = '';
  try {
    const gl = r.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '';
  } catch { /* no name: judged by the rest */ }
  return {
    ua: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints || 0, deviceMemory: navigator.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency, gpu: String(gpu || ''), screenW: screen.width, screenH: screen.height,
  };
}

// Slow frames while the visitor moves (measured, not guessed): first plain glass instead of refracting glass (the
// shower glass as clear glass, the frosted window as its glow), then a little less sharpness, then the live mirror at
// the weak device's setting, then the live mirror off, then less sharpness again (core/quality.js GOVERNOR_STEPS;
// each step applied by scene/roomEnvironment.js governorSteps, tested there).
const governor = forced ? null : createFrameGovernor({ steps: GOVERNOR_STEPS, slowMs: 40, windowMs: 2500, minFrames: 45 });
const applyStep = governorSteps(ctx, {
  sharpness: () => {
    const next = [1.5, 1.25, 1].find((r) => r < Math.min(ratioCap, window.devicePixelRatio || 1) - 0.01);
    if (next) { ratioCap = next; applyRatio(); }
  },
  wake: () => loop.wake(300),
});
let measuring = false;
loop.onRendered = (dt) => {
  if (!governor || !measuring || document.visibilityState !== 'visible') return;
  const step = governor.frame(dt);
  if (!step) return;
  applyStep(step);
  ctx.qualitySteps = governor.level;
  console.info(`slow frames: ${step}; pixel ratio now ${renderer.getPixelRatio()}`);
};

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  camera.aspect = w / h;
  camera.fov = camera.aspect < 1 ? 72 : 56; // upright phone: taller view
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  loop.wake(300);
}
window.addEventListener('resize', resize);
resize();

// Sound button: the only control on screen.
const soundBtn = document.querySelector('.sound');
soundBtn.addEventListener('click', async () => {
  await audio.unlock();
  const on = audio.isMuted();
  audio.setMuted(!on);
  soundBtn.setAttribute('aria-pressed', String(on));
});

async function applyTextureSet(matName, key) {
  const set = await assets.textureSet(key);
  if (!set) return null;
  materials.setMaps(matName, { map: set.map, normalMap: set.normalMap, roughnessMap: set.roughnessMap });
  return set.entry;
}

// Every UV in the room is in metres (shell and fixtures alike), so a material's maps repeat once per the real size
// one image covers: a tile grid is tilesAcross x the tile size we lay; other photos use their measured real size.
function setRealSize(matName, entry, tileM, fallbackM) {
  const m = materials.get(matName);
  const px = entry && entry.size && entry.size.color_1k;
  let w = fallbackM;
  let h = px ? (fallbackM * px[1]) / px[0] : fallbackM; // keep the photo's own shape (plaster is 2:1)
  if (entry && entry.tilesAcross && tileM) { w = entry.tilesAcross * tileM; h = (entry.tilesDown || entry.tilesAcross) * tileM; }
  else if (entry && entry.realSizeCm) { w = entry.realSizeCm[0] / 100; h = entry.realSizeCm[1] / 100; }
  for (const k of ['map', 'normalMap', 'roughnessMap']) if (m[k]) m[k].repeat.set(1 / w, 1 / h);
}

// The bake's small description file (moods, lamps, exposure), without its light maps.
async function bakeInfo() {
  try {
    const res = await fetch(`${assets.base}bake/bake.json`, { cache: 'no-cache' });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

// The camera: its white balance goes into the tone mapping (every material at once), its exposure is the renderer's.
// Must run before the first material is drawn (the tone mapping is compiled into every shader).
function applyCamera(info) {
  const g = grade(BAKE_MOOD, info);
  const chunk = gradedToneMapping(TONE_CHUNK, g.whiteGain);
  if (chunk) {
    THREE.ShaderChunk.tonemapping_pars_fragment = chunk;
    renderer.toneMapping = THREE.CustomToneMapping;
  } else console.warn('three.js tone mapping changed: the camera keeps the bake\'s white balance');
  renderer.toneMappingExposure = g.exposure;
  return g;
}


const stage = (name) => { window.__bath = { ...ctx, ready: false, stage: name }; };

async function start() {
  stage('manifest');
  const manifest = await assets.loadManifest();
  audio.setManifest(manifest, assets.base);

  // ---- the start view: the hallway, the closed door with the light under it, the doormat
  stage('entrance');
  // Paint is smooth and even: the plaster photo has a crack in it (a crack in a wet-room firm's own walls reads as
  // shoddy work), so the paint is plain warm white, matt (and the photo is not downloaded at all).
  const paintMat = materials.get('paint');
  paintMat.map = null;
  paintMat.normalMap = null;
  paintMat.roughnessMap = null;
  paintMat.color.set(0xefebe4);
  paintMat.roughness = 0.88;
  paintMat.needsUpdate = true;
  const [oakEntry, info] = await Promise.all([
    applyTextureSet('oak', 'oak'),
    bakeInfo(),
    assets.font(), // the doormat's words are drawn in the room's font
  ]);
  setRealSize('oak', oakEntry, 0, 1.83);
  ctx.bakeInfo = info;
  ctx.lightMood.grade = applyCamera(info);
  const mood = (info && info.moods && info.moods.evening) || {}; // the lamps are always the evening bake's
  const { createDoor } = await import('./fixtures/door.js');
  ctx.door = createDoor(ctx, {});
  scene.add(ctx.door.group);
  const { createHallway } = await import('./scene/hallway.js');
  ctx.hallway = createHallway(ctx, { mood });
  scene.add(ctx.hallway.group);
  // The hallway's one lamp with a wide beam, about a 700 lm downlight: its light reaches the door and falls off toward
  // the ceiling's corners (the start view was a flat grey picture: review 2026-10-19, visual finding 7). By day the
  // hallway has daylight from the rest of the home too: its light is the scene's white (3500 K), not lamp-orange.
  ctx.hallway.group.traverse((o) => {
    if (!o.isSpotLight) return;
    o.intensity *= 1.6;
    o.angle = 1.2;
    o.penumbra = 0.85;
    if (BAKE_MOOD === 'day') o.color.setRGB(1, 1, 1);
  });
  const { installEntrance } = await import('./scene/entrance.js');
  ctx.entrance = installEntrance(ctx);
  // soft shadow lines along the door's casings and under the trolley (scene/contactShadows.js)
  try {
    const { createHallwayShadows } = await import('./scene/contactShadows.js');
    ctx.hallwayShadows = createHallwayShadows(ctx);
    scene.add(ctx.hallwayShadows.group);
  } catch (e) { console.warn('hallway shadows not made:', e); }
  // From the hallway with the door shut the eye draws the hallway, the door and the light under it only (no gap round
  // the leaf shows the room): the room behind, as it loads, is drawn from the first moment the door turns
  // (scene/roomEnvironment.js gateHallway; scripts/measure-draws.mjs builds the counted room with the same call).
  gateHallway(ctx);
  // the hallway's own light: photographed from its middle (its lamp on its walls, a first bounce), so the start view
  // is lit by the hallway, not by a borrowed photo
  ctx.hallProbe = createProbe(ctx, { size: 128, position: HALL_PROBE(LAYOUT) });
  const hallEnv = photograph(ctx.hallProbe, { passes: 2 });
  if (hallEnv) scene.environment = hallEnv;
  else scene.add(new THREE.HemisphereLight(0xfff4e6, 0x8a8278, 0.6));
  loop.wake(2000); // the first frames: the closed door
  audio.preload(); // the first sounds (door, steps, knocks, the echo) download now, before the first touch
  window.__bath = { ...ctx, ready: false, stage: 'start view', startView: true };

  // ---- the bathroom behind the closed door
  stage('textures');
  const [mosaicEntry, concreteEntry, tilesMod] = await Promise.all([
    applyTextureSet('mosaic', 'mosaic_hex'),
    applyTextureSet('concrete', 'concrete'),
    import('./scene/tiles.js'),
  ]);
  setRealSize('mosaic', mosaicEntry, LAYOUT.tiles.mosaic, 0.8); // shower floor: 5 cm hexagons
  setRealSize('concrete', concreteEntry, 0, 1.1);
  // Warm the hex mosaic toward the sand floor so the shower floor reads tone-on-tone.
  materials.get('mosaic').color.set(0xe9dcc6);
  // Clean new porcelain, drawn (scene/tiles.js): light stone-look 30 x 30 cm walls, sand stone-look 60 x 60 cm floor.
  // (The tile photographs had stains, chips and a crack; the floor's was blown up 1.8 times.) Each tile keeps one
  // roughness: satin-glazed walls, matt non-slip floor.
  const px = quality === 'low' ? 1024 : 2048;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  for (const [name, look, seed, r] of [['tileWhite', tilesMod.TILE_LOOKS.wall, 11, 0.3], ['tileSand', tilesMod.TILE_LOOKS.floor, 23, 0.5]]) {
    await new Promise((res) => setTimeout(res, 0)); // one picture per task: the start view keeps moving meanwhile
    const t = tilesMod.tileTextures(look, { px, normalPx: px / 2, seed, anisotropy: aniso });
    materials.setMaps(name, { map: t.map, normalMap: t.normalMap });
    const m = materials.get(name);
    m.roughnessMap = null;
    m.roughness = r;
    m.needsUpdate = true;
  }

  stage('shell');
  const shell = createShell(ctx, {
    wallMat: materials.get('tileWhite'),
    floorMat: materials.get('tileSand'),
    showerFloorMat: materials.get('mosaic'),
    ceilingMat: materials.get('paint'),
    texMetres: { floor: 1, wall: 1, mosaic: 1 },
  });
  scene.add(shell.group);
  ctx.shell = shell;
  for (const [mesh, kind] of shell.knocks) interaction.register(mesh, { knock: kind });
  shell.group.traverse((o) => { if (o.isMesh && !interaction.isRegistered(o)) interaction.register(o, { knock: 'tile' }); });

  // Baked light: the lamps' (evening) maps always; by day the day maps under them (daylight stays when the lamps go
  // off). The shell's planes, plus the faces packed into their walls' maps.
  stage('bake');
  const { bakeShellMesh, createDownlights, createLedStrip, createRoomLight, setShellDayMaps, SHELL, SHELL_PATCH_OK } = await import('./scene/lighting.js');
  const { packedUV1 } = await import('./scene/packedLight.js');
  if (!SHELL_PATCH_OK) console.warn('three.js light chunks changed: the baked shell may be lit twice');
  const [bake, dayBake] = await Promise.all([
    assets.bakeMaps('evening'),
    BAKE_MOOD === 'day' ? assets.bakeMaps('day') : Promise.resolve(null),
  ]);
  const bakedMood = (bake && bake.info.moods && bake.info.moods.evening) || mood;
  if (bake && dayBake && ctx.lightMood.grade.dayGain) {
    const pairs = new Map();
    for (const [s, t] of Object.entries(bake.maps)) if (dayBake.maps[s]) pairs.set(t, dayBake.maps[s]);
    setShellDayMaps(pairs, ctx.lightMood.grade.dayGain);
    ctx.dayBake = dayBake;
  }
  const packed = (root, surface) => {
    const faces = ((bake && bake.info.extraFaces) || []).filter((f) => f.surface === surface);
    if (!faces.length || !bake.maps[surface]) return;
    root.updateWorldMatrix(true, true);
    root.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      const { uv1, missed } = packedUV1(faces, g.attributes.position.array, g.attributes.normal.array);
      const own = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
      own.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
      g.dispose(); // the world-space copy was only for the lookup
      if (own !== o.geometry) { const replaced = o.geometry; o.geometry = own; replaced.dispose(); } // (each swap relights a new boxing)
      if (missed) console.info(`${o.name || surface}: ${missed} vertices outside the packed faces`);
      bakeShellMesh(o, bake.maps[surface], bakedMood.lightMapIntensity ?? 1);
    });
  };
  if (bake) {
    for (const [name, mesh] of Object.entries(shell.parts)) {
      const surf = name === 'floorShower' ? 'floor' : name;
      if (mesh.isMesh && bake.maps[surf]) bakeShellMesh(mesh, bake.maps[surf], bakedMood.lightMapIntensity ?? 1);
    }
    packed(shell.parts.niche, 'wall_back');
    packed(shell.parts.windowReveal, 'wall_right');
    ctx.bake = bake;
  }
  ctx.mood = bakedMood;
  const downlights = createDownlights(ctx, bakedMood);
  scene.add(downlights.group);
  ctx.downlights = downlights;
  // the mirror's LED strip lights the counter under it (the bake has its light on the walls only)
  // (not on a weak device: a rect-area light costs on every lit pixel; the counter is then lit by the lamps alone)
  const led = quality === 'low' ? null : createLedStrip(ctx, bakedMood);
  if (led) scene.add(led.light);
  ctx.ledStrip = led;
  // the light switch: lamps, baked light and the room's photograph follow; the LED strip stays on
  const G = ctx.lightMood.grade;
  ctx.roomLight = createRoomLight({
    scene, downlights, led, onChange: () => photographRoom(),
    dayGain: SHELL.dayMaps ? G.dayGain : null, dayAdapt: SHELL.dayMaps ? G.dayAdapt : null,
  });
  ctx.shellLight = SHELL;

  // The fixtures (tiles on the boxing and in the reveal match the walls). The door is already up (the start view).
  stage('fixtures');
  const fixturesMod = await import('./fixtures/index.js');
  ctx.fixtureModule = fixturesMod;
  const fixtureOpts = {
    toilet: { boxMaterial: 'tileWhite' }, window: { wallMaterial: 'tileWhite' }, shower: { wallMaterial: 'tileWhite' },
  };
  ctx.fixtures = {};
  for (const [name, create] of Object.entries(fixturesMod.FIXTURES)) {
    if (name === 'door') { ctx.fixtures.door = ctx.door; continue; }
    ctx.fixtures[name] = create(ctx, fixtureOpts[name] || {});
    scene.add(ctx.fixtures[name].group);
  }
  if (!ctx.fixtures.door) ctx.fixtures.door = ctx.door;
  // the rolled towels into the basket (shown once its model is in); the photographed models (the plants, the duck, the
  // basket) load on their own meanwhile: nothing here waits for them, and a failed download leaves them out
  fixturesMod.furnish(ctx, ctx.fixtures);
  // the shell already has the niche and the window reveal, lit by the bake: hide the fixtures' copies
  for (const m of [ctx.fixtures.window.parts.reveal, ctx.fixtures.shower.parts.nicheLining]) if (m) m.visible = false;
  // a new boxing (a toilet swap) gets the baked light at the switch's current level (the level is shared: lighting.js)
  ctx.relightBoxing = (t) => {
    if (!bake) return;
    for (const k of ['boxing', 'boxingTop']) if (t.parts[k]) packed(t.parts[k], 'wall_right');
  };
  ctx.relightBoxing(ctx.fixtures.toilet);
  // Without the boxing (the floor-standing toilet) the wall and floor it covered need light of their own (and by day
  // the day maps too); it gets its contact shadows, and the room is photographed again.
  if (bake) {
    const { patchedMap, uv1At } = await import('./scene/lightPatch.js');
    const T = LAYOUT.toilet;
    const W = LAYOUT.room.W;
    const face = (bake.info.extraFaces || []).find((f) => f.surface === 'wall_right' && f.name.startsWith('boxing'));
    let bare = null;
    ctx.setToiletLight = (variant) => {
      const wall = shell.parts.wall_right;
      const floor = shell.parts.floor;
      if (variant !== 'floor') {
        wall.material.lightMap = bake.maps.wall_right;
        floor.material.lightMap = bake.maps.floor;
      } else {
        if (!bare) {
          const r = face && face.region;
          const a = uv1At(floor, new THREE.Vector3(W - T.boxing.depth, 0, T.boxing.z0), new THREE.Vector3(0, 1, 0));
          const b = uv1At(floor, new THREE.Vector3(W - 0.002, 0, T.boxing.z1), new THREE.Vector3(0, 1, 0));
          // the wall: the boxing's own area plus the shade it cast beside it (about 25-30 cm along the wall) and the
          // light its stone top threw up the wall (15 cm), as measured on the bake (2026-10-19), down to the floor
          const n = new THREE.Vector3(-1, 0, 0);
          const wa = r && uv1At(wall, new THREE.Vector3(W, T.boxing.height + 0.15, T.boxing.z0 - 0.25), n);
          const wb = r && uv1At(wall, new THREE.Vector3(W, 0.001, T.boxing.z1 + 0.3), n);
          const wallRects = wa && wb ? [{ u0: wa.x, u1: wb.x, v0: 0, v1: wa.y }]
            : r ? [{ u0: r[0], u1: r[1], v0: r[2], v1: r[3] }] : null;
          const floorRects = a && b ? [{ u0: a.x, u1: b.x, v0: a.y, v1: b.y }] : null;
          bare = {
            wall: wallRects ? patchedMap(bake.maps.wall_right, wallRects) : bake.maps.wall_right,
            floor: floorRects ? patchedMap(bake.maps.floor, floorRects) : bake.maps.floor,
          };
          if (SHELL.dayMaps && ctx.dayBake) {
            const dm = ctx.dayBake.maps;
            SHELL.dayMaps.set(bare.wall, wallRects && dm.wall_right ? patchedMap(dm.wall_right, wallRects) : dm.wall_right);
            SHELL.dayMaps.set(bare.floor, floorRects && dm.floor ? patchedMap(dm.floor, floorRects) : dm.floor);
          }
        }
        wall.material.lightMap = bare.wall;
        floor.material.lightMap = bare.floor;
      }
      if (ctx.contactShadows) ctx.contactShadows.setToilet(ctx.fixtures.toilet);
      if (ctx.roomProbe) photographRoom();
      loop.wake(200);
    };
  }

  // the sky behind the frosted window over the toilet: the visitor's own hour
  const { createOutside } = await import('./scene/outside.js');
  ctx.outside = createOutside(ctx, { sky: skyAt(SKY, info) });
  scene.add(ctx.outside.object3d);
  if (ctx.fixtures.window.parts.glass) ctx.fixtures.window.parts.glass.material = ctx.outside.frosted;

  stage('effects');
  try {
    const fxMod = await import('./fx/index.js');
    ctx.fx = fxMod.install(ctx, { fan: 0.3 }); // the extract fan's quiet base speed; a hot shower fogs the glass in about a minute
  } catch (e) { console.warn('effects not installed:', e); }
  stage('wiring');
  try {
    const wiring = await import('./scene/interactions.js');
    ctx.wiring = wiring.install(ctx, { deferReady: true }); // the door opens after the first light photograph (below)
    setTimeout(() => ctx.wiring && ctx.wiring.setReady && ctx.wiring.setReady(), 8000); // never later than this
  } catch (e) { console.warn('interactions not installed:', e); }

  // ---- the room's own light: contact shadows, the mirror's reflection, the room's photograph
  stage('light');
  try {
    const { createContactShadows } = await import('./scene/contactShadows.js');
    ctx.contactShadows = createContactShadows(ctx, { hallway: !ctx.hallwayShadows }); // (the hallway's are up already)
    scene.add(ctx.contactShadows.group);
    if (!ctx.hallwayShadows) ctx.viewGate.mark(ctx.contactShadows.group); // (they hold the hallway's then)
  } catch (e) { console.warn('contact shadows not made:', e); }
  const box = { ...roomBox(LAYOUT), probe: ROOM_PROBE(LAYOUT) };
  boxProjected(materials.get('mirror'), box); // the mirror shows the walls where they really are
  if (materials.has('glass')) boxProjected(materials.get('glass'), box); // so does the shower glass's reflection
  const fog = ctx.fx && ctx.fx.mirrorFog && ctx.fx.mirrorFog.meshes[0];
  if (fog && fog.material) boxProjected(fog.material, box); // fogged glass over the same reflection
  // 512 px a side on a strong device (the mirror shows it nearly sharp), 256 on a weak one; two pictures kept (the
  // light switch's on and off), about 25 MB each at 512
  // 512 px only on a strong device with a mouse (a desktop); phones get 256 (a photograph is then a quarter of the work)
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  ctx.roomProbe = createProbe(ctx, { size: quality === 'high' && !coarse ? 512 : 256, position: box.probe, keep: 2 });
  // the hallway and the door keep the hallway's light until the door opens (the start view does not change); then the
  // door takes the room's light and the hallway its photograph with the door open, blended in over the first quarter
  // radian of the swing and back as the door shuts with the eye in the hallway (scene/roomEnvironment.js
  // createDoorLight: it changed in one frame and never went back, the look 2026-10-20)
  const { door: doorMats, hall: hallMats } = doorLightMaterials(ctx); // the hallway-side casings with the hallway
  for (const m of [...hallMats, ...doorMats]) m.envMap = scene.environment;
  ctx.doorLight = createDoorLight(ctx, { door: doorMats, hall: hallMats });
  loop.add((dt) => ctx.doorLight.update(dt));
  // the mirror's live reflection of the room on its shut doors (scene/mirrorReflection.js); never in a photograph
  try {
    const { createMirrorReflection } = await import('./scene/mirrorReflection.js');
    ctx.mirrorReflection = createMirrorReflection(ctx, { coarse, whiteGain: G.whiteGain });
  } catch (e) { console.warn('the mirror shows the room\'s photograph only:', e); }
  // what the eye draws (scene/roomEnvironment.js finishEyeDraws, after the mirror; the counted room in
  // scripts/measure-draws.mjs is wired by the same call): every still thing counts as in view only when its own box is
  // (three.js's bounding spheres reach far: a refracting pane's started see-through passes in views without it, the
  // vanity's and the cabinet's let them into the mirror's pass from under and behind its glass; the effects, plants,
  // towels, scale and brushes keep three.js's own test); the door wall hides its far side but for the door's opening;
  // from the hallway and the doorway the shower glass is clear glass without a see-through pass
  finishEyeDraws(ctx, { box });
  photographRoom({ first: true });
  // The room is not drawn from the hallway while the door is shut: its shaders for the screen are built now (as the
  // first frames behind the shut door used to build them), and one frame draws it behind the door with the refracting
  // shower glass (its see-through picture and the rest made then), so the door's first swing and the first look inside
  // have nothing left to prepare.
  warmEyeDraws(ctx, renderer);
  loop.wake(300);
  if (ctx.wiring && ctx.wiring.setReady) ctx.wiring.setReady(); // now a door tapped during loading swings, unhindered
  // Later, when the page is idle (never in the way of the door opening): on a strong device the switch's "off"
  // picture (0.12: the switch's off level, scene/interactions.js), so the light switch never waits for a photograph,
  // and the hallway with the room's light coming through the open door. A weak device photographs "off" at the switch.
  // (Not while a paper or a towel is in the visitor's hand.)
  const inHand = () => !!(ctx.wiring && (ctx.wiring.lifted || (ctx.wiring.towels && ctx.wiring.towels.held)));
  const shootOff = () => {
    if (quality === 'low' || !ctx.roomLight || ctx.roomLight.level !== 1 || inHand()) return;
    ctx.roomLight.setLevel(0.12);
    ctx.roomLight.setLevel(1); // the "on" picture is kept: no new photograph
  };
  // The photographed models arrive on their own time. After each one that came after the room was photographed, every
  // kept picture is out of date (the fixtures' and the mirror doors' light would miss it): when the page is next idle
  // and nothing is moving (never in the door's swing), this state is photographed again, and the switch's "off"
  // picture too (a strong device); a state not shown since is taken again when it is next shown. One download that
  // never ends holds none of the others out (three.js's loader has no timeout).
  const modelsIn = () => ['plants', 'duck', 'basket'].reduce((n, k) => {
    const f = ctx.fixtures[k];
    if (f) f.group.traverse((o) => { if (o.isMesh && o.userData.model) n++; });
    return n;
  }, 0);
  const whenStill = (fn) => whenIdle(() => (tweens.active() > 0 ? whenStill(fn) : fn()));
  photographOnArrival(['plants', 'duck', 'basket'].map((k) => ctx.fixtures[k] && ctx.fixtures[k].ready), {
    count: modelsIn,
    since: modelsIn(),
    whenStill,
    shoot: () => {
      if (!ctx.roomProbe) return;
      ctx.roomProbe.stale();
      photographRoom();
      shootOff();
    },
  });
  if (quality !== 'low') {
    whenIdle(() => {
      shootOff();
      ctx.hallProbeOpen = createProbe(ctx, { size: 128, position: HALL_PROBE(LAYOUT) });
      ctx.doorLight.setHallOpen(photograph(ctx.hallProbeOpen, { doorOpen: true })); // (blended in if the door is open)
      loop.wake(200);
    });
  }
  // the membrane view changes how the walls look: photograph them again once it has settled
  let lookSeen = ctx.wiring && ctx.wiring.membrane ? ctx.wiring.membrane.look : 0;
  let lookTimer = 0;
  loop.add(() => {
    const look = ctx.wiring && ctx.wiring.membrane ? ctx.wiring.membrane.look : 0;
    if (look !== lookSeen) {
      lookSeen = look;
      clearTimeout(lookTimer);
      lookTimer = setTimeout(() => { photographRoom(); }, 1400);
    }
    return false;
  });

  loop.wake(2500);
  window.__bath = { ...ctx, ready: true, photographRoom };
  setTimeout(() => { measuring = true; }, 1500); // judge the frame rate once the first shaders are built
}

// Runs fn when the page is idle (or after a few seconds at the latest).
function whenIdle(fn, timeout = 4000) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => fn(), { timeout });
  else setTimeout(fn, 1500);
}

// Photographs the scene from a probe (scene/roomEnvironment.js): passes > 1 lights the first picture with itself
// (a second bounce); doorOpen sets the door at its open angle for the picture (the bake has it open too).
function photograph(probe, { passes = 1, first = false, doorOpen = false } = {}) {
  if (!probe) return null;
  const leaf = ctx.door && ctx.door.parts.leafPivot;
  const saved = leaf ? leaf.quaternion.clone() : null;
  const before = () => {
    if (!leaf || !doorOpen) return;
    leaf.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.66);
    leaf.updateMatrixWorld(true);
  };
  const after = () => { if (leaf && saved) { leaf.quaternion.copy(saved); leaf.updateMatrixWorld(true); } };
  let tex = null;
  for (let i = 0; i < passes; i++) {
    tex = probe.capture({ hide: captureHides(ctx, { mirror: first && i === 0 }), before, after });
    if (tex && i < passes - 1) scene.environment = tex;
  }
  return tex;
}

// The room's photograph: taken when the room is first up, and again when its light changes (the switch, the toilet
// swap, the membrane view); never every frame. Each state's picture is kept (the light switch's two states toggle
// without a new photograph). A new picture takes two shots: the first lit by the room's light so far (scaled to the
// new lamp level, a first guess at the bounce), the second by the first.
function roomKey() {
  const level = ctx.roomLight ? ctx.roomLight.level : 1;
  const toilet = ctx.fixtures && ctx.fixtures.toilet ? ctx.fixtures.toilet.variant || (ctx.fixtures.toilet.parts.boxing ? 'wallHung' : 'floor') : '';
  const look = ctx.wiring && ctx.wiring.membrane ? ctx.wiring.membrane.look : 0;
  return `${level}|${toilet}|${look}`;
}
function photographRoom({ first = false } = {}) {
  const probe = ctx.roomProbe;
  if (!probe) return null;
  const key = roomKey();
  const level = ctx.roomLight ? ctx.roomLight.level : 1;
  if (!first && probe.has(key)) {
    const tex = probe.capture({ key });
    ctx.roomEnv = tex;
    ctx.roomEnvLevel = level;
    scene.environment = tex;
    loop.wake(300);
    return tex;
  }
  const was = scene.environment;
  const wasIntensity = scene.environmentIntensity;
  // The bake's walls know only the bathroom's own light: the hallway seen through the door goes into the room's
  // photograph at the bathroom's light level, so with the lamps off the fixtures fall dark with the walls (the
  // hallway lamp would otherwise light them from the doorway while the walls stay dark).
  const hall = [];
  if (level < 1 && ctx.hallway) {
    ctx.hallway.group.traverse((o) => {
      if (o.isLight) hall.push([o, 'intensity', o.intensity]);
      else if (o.isMesh) for (const m of [].concat(o.material)) if (m && m.envMap) hall.push([m, 'envMapIntensity', m.envMapIntensity]);
    });
    for (const [o, k, v] of hall) o[k] = v * level;
  }
  const leaf = ctx.door && ctx.door.parts.leafPivot;
  const saved = leaf ? leaf.quaternion.clone() : null;
  // the door, seen from inside, in the room's light at this photograph's strength (createDoorLight forCapture)
  let undoDoor = null;
  const before = () => {
    if (leaf) { leaf.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.66); leaf.updateMatrixWorld(true); }
    if (ctx.doorLight) undoDoor = ctx.doorLight.forCapture(scene.environmentIntensity);
  };
  const after = () => {
    if (leaf && saved) { leaf.quaternion.copy(saved); leaf.updateMatrixWorld(true); }
    if (undoDoor) { undoDoor(); undoDoor = null; }
  };
  if (!first && ctx.roomEnv) {
    scene.environment = ctx.roomEnv;
    scene.environmentIntensity = Math.min(1, level / (ctx.roomEnvLevel || 1));
  }
  let tex = probe.capture({ key, fresh: true, hide: captureHides(ctx, { mirror: first }), before, after });
  if (tex && (first || quality !== 'low')) { // the second shot (the bounce), on a weak device only the first time
    scene.environment = tex;
    scene.environmentIntensity = 1;
    tex = probe.capture({ key, fresh: true, hide: captureHides(ctx), before, after });
  }
  for (const [o, k, v] of hall) o[k] = v;
  if (tex) {
    ctx.roomEnv = tex;
    ctx.roomEnvLevel = level;
    scene.environment = tex;
    scene.environmentIntensity = 1;
  } else {
    scene.environment = was;
    scene.environmentIntensity = wasIntensity;
  }
  loop.wake(300);
  return tex;
}

window.__bath = { ...ctx, ready: false };
start();
