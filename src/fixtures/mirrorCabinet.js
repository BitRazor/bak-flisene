// The mirror cabinet above the vanity: a two-door cabinet (INR STAGE-like) with double-sided mirror doors on concealed
// hinges, two glass shelves, an LED strip under its front edge, a light inside that comes on when a door opens, and the
// LED mirror's display region (a separate plane for a canvas texture) on the right door. Sizes: products.md section E.
// Placement: LAYOUT.mirror (back wall, x0..x1, y0..y1, depth). Local frame = back-wall frame, origin at the cabinet's
// bottom centre on the wall.
//
// createMirrorCabinet(ctx, { body: 'enamelWhite' })
// parts: body, shelves, doorLeftPivot / doorRightPivot (vertical hinge axes at the outer edges; left opens with negative
//   rotation.y, right with positive, up to 110 degrees), doorLeft / doorRight (door slab + the mirror on its inside,
//   one mesh; doorLeftBack / doorRightBack point at it), doorLeftFace / doorRightFace (the front mirror glass; UVs span
//   the WHOLE closed mirror 0..1, same space as LAYOUT.mirror.display), display (plane on the right door at
//   LAYOUT.mirror.display; material is per-object, black + additive until a system sets .map and a white .color),
//   ledStrip (under the front edge), insideLight (visible = false until a door opens).
// anchors: mirrorCentre (centre of the closed mirror face), displayCentre (moves with the right door), shelfLow,
//   shelfHigh (centre of each shelf's top).
import * as THREE from 'three';
import { mesh, pivot, anchor, placeOnWall, createBuilder, boxGeo, M, screenMaterial } from './util.js';

export const MIRROR_DIMS = { doorT: 0.018, panelT: 0.016, gap: 0.002, maxOpen: 1.92, shelves: [0.25, 0.48] };

// The screen's area (LAYOUT.mirror.display, in the whole mirror's uv): an LED mirror's screen sits behind its glass,
// which reflects less there (the dark panel behind it shows through), so the screen's white words stay readable over a
// bright reflection (the look, 2026-10-20: they lost contrast over a reflected white washer or door). The reflected
// light is multiplied by `factor` inside the area (half: a look choice, for the visual check), easing in over
// `featherM` metres inside its edge: a calm, even screen area, not a hard box. The doors' own glass (the shared
// 'mirror' material, on the front glass only) and the live mirror (scene/mirrorReflection.js) darken it alike, so
// nothing changes when one takes over from the other.
export const DISPLAY_DIM = { factor: 0.5, featherM: 0.006 };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// the factor at (u, v) on the whole mirror (both doors shut: u across both, v bottom to top): 1 outside the area
export function displayShade(L, u, v, dim = DISPLAY_DIM) {
  const d = L.mirror.display;
  const fu = dim.featherM / (L.mirror.x1 - L.mirror.x0);
  const fv = dim.featherM / (L.mirror.y1 - L.mirror.y0);
  const inside = smooth(d.u0, d.u0 + fu, u) * smooth(d.v0, d.v0 + fv, v) * (1 - smooth(d.u1 - fu, d.u1, u)) * (1 - smooth(d.v1 - fv, d.v1, v));
  return 1 - (1 - dim.factor) * inside;
}
// the same in GLSL (uBathDisplay: u0, u1, v0, v1; uBathDisplayFeather: the soft edge in uv; uBathDisplayDim: factor)
export const DISPLAY_GLSL = /* glsl */ `
float bathDisplayShade( vec2 uv ) {
	vec2 lo = smoothstep( uBathDisplay.xz, uBathDisplay.xz + uBathDisplayFeather, uv );
	vec2 hi = 1.0 - smoothstep( uBathDisplay.yw - uBathDisplayFeather, uBathDisplay.yw, uv );
	return 1.0 - ( 1.0 - uBathDisplayDim ) * lo.x * lo.y * hi.x * hi.y;
}
`;
export const DISPLAY_GLSL_PARS = 'uniform vec4 uBathDisplay;\nuniform vec2 uBathDisplayFeather;\nuniform float uBathDisplayDim;';
export function displayUniforms(L, dim = DISPLAY_DIM) {
  const d = L.mirror.display;
  return {
    uBathDisplay: { value: new THREE.Vector4(d.u0, d.u1, d.v0, d.v1) },
    uBathDisplayFeather: { value: new THREE.Vector2(dim.featherM / (L.mirror.x1 - L.mirror.x0), dim.featherM / (L.mirror.y1 - L.mirror.y0)) },
    uBathDisplayDim: { value: dim.factor },
  };
}
// The shared 'mirror' material darkens the screen's area on a door's front glass only: every mesh the cabinet draws
// with it carries a per-vertex flag (bathScreen: 1 on the front glass, 0 on the slabs and the inside mirrors; none is
// left without it, so no stale default reaches the shader). Patched once per material; a later patch of its own
// (main.js boxProjected) keeps this one.
function shadeScreenArea(material, L) {
  if (material.userData.bathScreenArea) return;
  material.userData.bathScreenArea = true;
  const uniforms = displayUniforms(L);
  const prev = material.onBeforeCompile;
  const hadOwn = prev && prev !== THREE.Material.prototype.onBeforeCompile;
  material.onBeforeCompile = function screenArea(shader, renderer) {
    if (hadOwn) prev.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float bathScreen;\nvarying float vBathScreen;\nvarying vec2 vBathMirrorUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvBathScreen = bathScreen;\n\tvBathMirrorUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${DISPLAY_GLSL_PARS}\nvarying float vBathScreen;\nvarying vec2 vBathMirrorUv;\n${DISPLAY_GLSL}`)
      .replace('#include <opaque_fragment>', 'outgoingLight *= mix( 1.0, bathDisplayShade( vBathMirrorUv ), vBathScreen );\n#include <opaque_fragment>');
  };
  const prevKey = material.customProgramCacheKey;
  const base = typeof prevKey === 'function' && prevKey !== THREE.Material.prototype.customProgramCacheKey ? prevKey.call(material) : '';
  material.customProgramCacheKey = () => (base ? `${base}+screen` : 'bath-mirror-screen');
  material.needsUpdate = true;
}
const flagScreen = (geometry, on) => {
  geometry.setAttribute('bathScreen', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(on ? 1 : 0), 1));
};

// A door's slab without its flat front: the door's glass (its face, 1 mm in front) always covers it, whether the live
// mirror lies on the glass or the glass shows its own reflection, so it was shaded a second time for nothing every
// frame (review 2026-10-19, finding 5). Its rounded front edge stays. g: a box (three.js's rounded box is not
// indexed: each triangle has its own three vertices), +z its front.
function withoutFlatFront(g) {
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  g.computeBoundingBox();
  const front = g.boundingBox.max.z;
  const flat = (v) => nrm.getZ(v) > 0.9999 && Math.abs(pos.getZ(v) - front) < 1e-7;
  const n = g.index ? g.index.count : pos.count;
  const at = (i) => (g.index ? g.index.getX(i) : i);
  const keep = [];
  for (let i = 0; i < n; i += 3) if (!(flat(at(i)) && flat(at(i + 1)) && flat(at(i + 2)))) keep.push(at(i), at(i + 1), at(i + 2));
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) {
    const arr = new a.array.constructor(keep.length * a.itemSize);
    keep.forEach((v, k) => { for (let c = 0; c < a.itemSize; c++) arr[k * a.itemSize + c] = a.array[v * a.itemSize + c]; });
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  g.dispose();
  return out;
}

export function createMirrorCabinet(ctx, opts = {}) {
  const L = ctx.layout;
  const Mr = L.mirror;
  const D = MIRROR_DIMS;
  const bodyMat = opts.body || 'enamelWhite';
  const W = Mr.x1 - Mr.x0;
  const H = Mr.y1 - Mr.y0;
  const hw = W / 2;
  const t = D.panelT;
  const bd = Mr.depth - D.doorT - D.gap; // body depth behind the doors

  const group = new THREE.Group();
  group.name = 'mirrorCabinet';
  placeOnWall(group, L, Mr.wall, (Mr.x0 + Mr.x1) / 2, Mr.y0);
  const parts = {};
  const anchors = {};

  const b = createBuilder(ctx);
  b.add(bodyMat, boxGeo(t, H, bd, 0.0015, 1), M([-hw + t / 2, H / 2, bd / 2]));
  b.add(bodyMat, boxGeo(t, H, bd, 0.0015, 1), M([hw - t / 2, H / 2, bd / 2]));
  b.add(bodyMat, boxGeo(W - 2 * t, t, bd), M([0, H - t / 2, bd / 2]));
  b.add(bodyMat, boxGeo(W - 2 * t, t, bd), M([0, t / 2, bd / 2]));
  b.add(bodyMat, boxGeo(W - 2 * t, H - 2 * t, 0.006), M([0, H / 2, 0.003]));
  for (const sy of D.shelves) b.add('glassSimple', boxGeo(W - 2 * t - 0.004, 0.006, bd - 0.03), M([0, sy, 0.006 + (bd - 0.03) / 2]));
  const built = b.build(group, 'mirrorCabinet.body');
  parts.body = built[bodyMat];
  if (bodyMat === 'enamelWhite') parts.body.userData.knock = 'wood'; // painted board
  parts.shelves = built.glassSimple;
  anchors.shelfLow = anchor('shelfLow', group, 0, D.shelves[0] + 0.003, bd / 2);
  anchors.shelfHigh = anchor('shelfHigh', group, 0, D.shelves[1] + 0.003, bd / 2);

  // Doors: mirror glass on both faces with polished edges; hinge axes at the outer front edges of the body.
  const dw = hw - 0.0015;
  const sides = [
    ['Left', -hw, 1, [-D.maxOpen, 0]],
    ['Right', hw, -1, [0, D.maxOpen]],
  ];
  for (const [side, px, dir, [min, max]] of sides) {
    const p = pivot(`door${side}Pivot`, px, H / 2, bd + D.gap, { type: 'hinge', axis: [0, 1, 0], min, max });
    const db = createBuilder(ctx);
    db.add('mirror', withoutFlatFront(boxGeo(dw, H, D.doorT - 0.002, 0.001, 1)), M([(dir * dw) / 2, 0, D.doorT / 2]), 'door');
    const backG = new THREE.PlaneGeometry(dw, H);
    backG.rotateY(Math.PI);
    db.add('mirror', backG, M([(dir * dw) / 2, 0, 0]), 'back');
    const door = db.build(p, `mirrorCabinet.door${side}`).mirror;
    flagScreen(door.geometry, false); // (the slab and the inside mirror: no screen behind them)
    // The front mirror face: UVs in the whole mirror's space (u across both doors, v bottom -> top).
    const u0 = dir > 0 ? 0 : (hw + 0.0015) / W;
    const u1 = dir > 0 ? dw / W : 1;
    const faceG = new THREE.PlaneGeometry(dw, H);
    const uv = faceG.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, u0 + uv.getX(i) * (u1 - u0));
    faceG.translate((dir * dw) / 2, 0, D.doorT);
    flagScreen(faceG, true);
    const face = mesh(ctx, faceG, 'mirror', `mirrorCabinet.door${side}Face`);
    shadeScreenArea(face.material, L);
    p.add(face);
    group.add(p);
    parts[`door${side}Pivot`] = p;
    parts[`door${side}`] = door;
    parts[`door${side}Back`] = door;
    parts[`door${side}Face`] = face;
  }
  // The stop the doors close against, behind the gap between them: dark and dull, so the 3 mm gap reads as one clean
  // dark line (the cabinet's lit inside showed through it as a broken bright line, like a crack in the mirror).
  parts.gapStop = mesh(ctx, boxGeo(0.014, H - 2 * t, 0.004), 'gapDark', 'mirrorCabinet.gapStop');
  parts.gapStop.position.set(0, H / 2, bd - 0.0025);
  parts.gapStop.castShadow = false;
  group.add(parts.gapStop);

  // Display region of the LED mirror, on the right door (it moves with the door).
  const dsp = Mr.display;
  const dW = (dsp.u1 - dsp.u0) * W;
  const dH = (dsp.v1 - dsp.v0) * H;
  const dx = -hw + ((dsp.u0 + dsp.u1) / 2) * W;
  const dy = ((dsp.v0 + dsp.v1) / 2) * H;
  const displayG = new THREE.PlaneGeometry(dW, dH);
  parts.display = mesh(ctx, displayG, screenMaterial('mirrorDisplay'), 'mirrorCabinet.display');
  parts.display.position.set(dx - hw, dy - H / 2, D.doorT + 0.0007);
  parts.display.castShadow = false;
  parts.display.receiveShadow = false;
  parts.display.renderOrder = 2;
  parts.doorRightPivot.add(parts.display);
  anchors.displayCentre = anchor('displayCentre', parts.doorRightPivot, dx - hw, dy - H / 2, D.doorT + 0.001);
  anchors.mirrorCentre = anchor('mirrorCentre', group, 0, H / 2, Mr.depth);

  // LED strip under the front edge (lights the counter) and the light inside (on only while a door is open).
  parts.ledStrip = mesh(ctx, boxGeo(W - 0.04, 0.004, 0.012), 'ledWarm', 'mirrorCabinet.ledStrip');
  parts.ledStrip.position.set(0, -0.002, bd - 0.012);
  parts.ledStrip.castShadow = false;
  parts.insideLight = mesh(ctx, boxGeo(W - 2 * t - 0.02, 0.005, 0.01), 'ledWarm', 'mirrorCabinet.insideLight');
  parts.insideLight.position.set(0, H - t - 0.004, bd - 0.016);
  parts.insideLight.castShadow = false;
  parts.insideLight.visible = false;
  group.add(parts.ledStrip, parts.insideLight);

  return { group, parts, anchors };
}
