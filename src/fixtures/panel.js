// The panel by the door (room side of the front wall): one vertical white two-gang plate holding the floor thermostat
// (with a small display plane) above the light switch rocker, white plastic like an ordinary Norwegian switch (the
// owner, 2026-10-19: "sockets yellow, ugly, should be white"; it was brushed brass). The "Membran" button is its own
// fixture now (membraneButton.js, on the back wall: pressed there, the visitor faces the membrane it shows).
// Placement: LAYOUT.panel (wall, x, y = the centre of the light switch, the lower module). Local frame = wall frame of
// its wall (util.js).
//
// createPanel(ctx, {})
// parts: plate (= thermostat: one white mesh; subpartAt() names 'plate', 'thermostat', 'thermostatMinus',
//   'thermostatPlus'), thermostatGlass, thermostatDisplay (per-object screen material), switchRockerPivot (hinge along
//   x; the rocker tips -0.08..0.08 rad) + switchRocker.
// anchors: switch (rocker centre), thermostatDisplay.
import * as THREE from 'three';
import { mesh, pivot, anchor, placeOnWall, createBuilder, M, lathe, RoundedBox, boxGeo, screenMaterial } from './util.js';

export const PANEL_DIMS = { w: 0.084, h: 0.155, t: 0.008, pitch: 0.071 };

export function createPanel(ctx, opts = {}) {
  const L = ctx.layout;
  const P = L.panel;
  const D = PANEL_DIMS;
  const group = new THREE.Group();
  group.name = 'panel';
  placeOnWall(group, L, P.wall, P.x, P.y);
  const parts = {};
  const anchors = {};
  const ft = D.t; // front face of the plate

  const b = createBuilder(ctx);
  // the plate spans both modules: the switch at its lower module (y = 0), the thermostat one pitch above
  b.add('plasticWhite', new RoundedBox(D.w, D.h, D.t, 2, 0.003), M([0, D.pitch / 2, D.t / 2]), 'plate');
  // Thermostat module (top): a raised square with a dark display glass and two small buttons (- and +).
  b.add('plasticWhite', new RoundedBox(0.056, 0.056, 0.008, 2, 0.004), M([0, D.pitch, ft + 0.004]), 'thermostat');
  b.add('screenBlack', boxGeo(0.034, 0.02, 0.001), M([0, D.pitch + 0.008, ft + 0.0085]), 'thermostat');
  b.add('plasticWhite', lathe([[0.004, 0], [0.004, 0.0015], [0, 0.002]], 16).rotateX(Math.PI / 2), M([-0.012, D.pitch - 0.013, ft + 0.008]), 'thermostatMinus');
  b.add('plasticWhite', lathe([[0.004, 0], [0.004, 0.0015], [0, 0.002]], 16).rotateX(Math.PI / 2), M([0.012, D.pitch - 0.013, ft + 0.008]), 'thermostatPlus');
  const built = b.build(group, 'panel.plate');
  parts.plate = parts.thermostat = built.plasticWhite;
  parts.thermostatGlass = built.screenBlack;

  const disp = mesh(ctx, new THREE.PlaneGeometry(0.032, 0.018), screenMaterial('thermostat'), 'panel.thermostatDisplay');
  disp.position.set(0, D.pitch + 0.008, ft + 0.0092);
  disp.castShadow = false;
  group.add(disp);
  parts.thermostatDisplay = disp;
  anchors.thermostatDisplay = anchor('thermostatDisplay', group, 0, D.pitch + 0.008, ft + 0.0092);

  // Light switch rocker (lower module).
  parts.switchRockerPivot = pivot('switchRockerPivot', 0, 0, ft, { type: 'hinge', axis: [1, 0, 0], min: -0.08, max: 0.08 });
  parts.switchRocker = mesh(ctx, new RoundedBox(0.05, 0.05, 0.008, 2, 0.003), 'plasticWhite', 'panel.switchRocker');
  parts.switchRocker.position.z = 0.005;
  parts.switchRockerPivot.add(parts.switchRocker);
  group.add(parts.switchRockerPivot);
  anchors.switch = anchor('switch', parts.switchRockerPivot, 0, 0, 0.009);

  return { group, parts, anchors };
}
