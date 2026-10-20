// Small water droplets thrown up where water lands: one InstancedMesh, simulated on the CPU (a few dozen at most),
// stretched along their velocity for a motion-blur look. Shared by the tap stream and the shower-head drip.
// No allocations per frame: fixed arrays, reused math objects.
import * as THREE from 'three';
import { makeDropMaterial } from './waterMaterial.js';
import { createRng } from './rng.js';

const G = 9.81;
const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();

export function createSplash(ctx, { count = 32, seed = 7, blur = 0.014, material = null } = {}) {
  const rng = createRng(seed);
  const low = ctx && ctx.quality === 'low';
  const geo = new THREE.SphereGeometry(1, low ? 6 : 8, low ? 4 : 6);
  const mat = material || makeDropMaterial('splash');
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false; // droplets fly outside the unit sphere's bounds
  mesh.name = 'fx-splash';
  mesh.renderOrder = 2;
  // shown only while droplets fly: with none three.js draws nothing, but still sets up the material every frame while
  // it is shown (the look, 2026-10-20: idle effects stayed in the draw list)
  mesh.visible = false;

  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const rad = new Float32Array(count);
  const floor = new Float32Array(count);
  const life = new Float32Array(count);
  const cx = new Float32Array(count); // containment centre x/z and radius (0 = none)
  const cz = new Float32Array(count);
  const cr = new Float32Array(count);
  let alive = 0;

  // Throw n droplets from (x, y, z). spec: { out: [min,max] m/s sideways, up: [min,max] m/s, size: [min,max] m,
  // floorY (default y), contain: { x, z, radius } keeps them inside a basin }
  function emit(n, x, y, z, spec = {}) {
    const out = spec.out || [0.15, 0.5];
    const up = spec.up || [0.3, 0.8];
    const size = spec.size || [0.0006, 0.0015];
    const fl = spec.floorY ?? y;
    const con = spec.contain || null;
    for (let k = 0; k < n && alive < count; k++) {
      const i = alive++;
      const a = rng.next() * Math.PI * 2;
      const sp = rng.range(out[0], out[1]);
      pos[i * 3] = x;
      pos[i * 3 + 1] = y + 0.001;
      pos[i * 3 + 2] = z;
      vel[i * 3] = Math.cos(a) * sp;
      vel[i * 3 + 1] = rng.range(up[0], up[1]);
      vel[i * 3 + 2] = Math.sin(a) * sp;
      rad[i] = rng.range(size[0], size[1]);
      floor[i] = fl;
      life[i] = 1.2;
      cx[i] = con ? con.x : 0;
      cz[i] = con ? con.z : 0;
      cr[i] = con ? con.radius : 0;
    }
  }

  function kill(i) {
    const last = --alive;
    if (i === last) return;
    for (let c = 0; c < 3; c++) {
      pos[i * 3 + c] = pos[last * 3 + c];
      vel[i * 3 + c] = vel[last * 3 + c];
    }
    rad[i] = rad[last];
    floor[i] = floor[last];
    life[i] = life[last];
    cx[i] = cx[last];
    cz[i] = cz[last];
    cr[i] = cr[last];
  }

  function update(dt) {
    if (alive === 0 && mesh.count === 0) return;
    for (let i = alive - 1; i >= 0; i--) {
      vel[i * 3 + 1] -= G * dt;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      life[i] -= dt;
      let dead = life[i] <= 0 || (pos[i * 3 + 1] < floor[i] && vel[i * 3 + 1] < 0);
      if (!dead && cr[i] > 0) {
        const dx = pos[i * 3] - cx[i];
        const dz = pos[i * 3 + 2] - cz[i];
        dead = dx * dx + dz * dz > cr[i] * cr[i];
      }
      if (dead) kill(i);
    }
    for (let i = 0; i < alive; i++) {
      _d.set(vel[i * 3], vel[i * 3 + 1], vel[i * 3 + 2]);
      const speed = _d.length();
      if (speed > 1e-5) _q.setFromUnitVectors(UP, _d.multiplyScalar(1 / speed));
      else _q.identity();
      const r = rad[i];
      _s.set(r, r + speed * blur * 0.5, r);
      _p.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
    }
    mesh.count = alive;
    mesh.visible = alive > 0;
    mesh.instanceMatrix.needsUpdate = true;
  }

  return {
    object3d: mesh,
    emit,
    update,
    get alive() { return alive; },
    clear() { alive = 0; mesh.count = 0; mesh.visible = false; },
    dispose() { geo.dispose(); if (!material) mat.dispose(); },
  };
}
