// Every fixture factory, and a helper that builds the whole set placed per LAYOUT.
// Module contract (docs/ARCHITECTURE.md): createX(ctx, opts) -> { group, parts, anchors, ...methods }.
// ctx needs { materials, layout, quality }; THREE comes from the 'three' import (same module as ctx.THREE).
// Joints: see util.js (pivot.userData.joint, setJoint, listJoints). Hidden see-through parts: toilet.hidden.
// Static pieces that share a material are merged into one mesh per fixture (phone draw-call budget); such a mesh
// keeps userData.subparts, and subpartAt(hit.object, hit.faceIndex) names the piece a raycast hit.
// Units are metres and every UV on tiled/oak/stone surfaces is in metres (texture.repeat = 1 / metres per image).
// The photographed models (the plants, the duck, the basket: fixtures/models.js) stand at once as empty groups and fill
// in when their files arrive (fixture.ready); a failed download leaves them empty and the room works without them.
// furnish(ctx, fixtures) puts things into other things once the set is built (the rolled towels into the basket).
export { createToilet, TOILET_DIMS } from './toilet.js';
export { createPaperHolder, PAPER_DIMS } from './paperHolder.js';
export { createVanity, counterTop, VANITY_DIMS } from './vanity.js';
export { createMirrorCabinet, MIRROR_DIMS } from './mirrorCabinet.js';
export { createShower, SHOWER_DIMS } from './shower.js';
export { createDoor, DOOR_DIMS } from './door.js';
export { createWindow, WINDOW_DIMS } from './window.js';
export { createTowelRail, RAIL_DIMS } from './towelRail.js';
export { createWasherTower, WASHER_DIMS } from './washerTower.js';
export { createPanel, PANEL_DIMS } from './panel.js';
export { createClipboard, CLIPBOARD_DIMS } from './clipboard.js';
export { createPhone, PHONE_DIMS } from './phone.js';
export { createSoapDispenser, SOAP_DIMS } from './soapDispenser.js';
export { createToothbrushCup, CUP_DIMS } from './toothbrushCup.js';
export { createExtractValve, VALVE_DIMS } from './extractValve.js';
export { createMembraneButton, MEMBRANE_BUTTON_DIMS } from './membraneButton.js';
export { createTowels, createRolledTowel, rollsForBasket, TOWEL_DIMS, TOWEL_KINDS, TOWEL_COLOURS, ROLL_DIMS } from './towels.js';
export { createScale, SCALE_DIMS, SCALE_DIAL } from './scale.js';
export { createPlants, createDuck, createBasket, PLANT_DIMS } from './plants.js';
export { MODELS } from './models.js';
export { setJoint, listJoints, subpartAt, triangleCount, drawCalls, REQUESTED_MATERIALS } from './util.js';

import { createToilet } from './toilet.js';
import { createPaperHolder } from './paperHolder.js';
import { createVanity } from './vanity.js';
import { createMirrorCabinet } from './mirrorCabinet.js';
import { createShower } from './shower.js';
import { createDoor } from './door.js';
import { createWindow } from './window.js';
import { createTowelRail } from './towelRail.js';
import { createWasherTower } from './washerTower.js';
import { createPanel } from './panel.js';
import { createClipboard } from './clipboard.js';
import { createPhone } from './phone.js';
import { createSoapDispenser } from './soapDispenser.js';
import { createToothbrushCup } from './toothbrushCup.js';
import { createExtractValve } from './extractValve.js';
import { createMembraneButton } from './membraneButton.js';
import { createTowels, createRolledTowel } from './towels.js';
import { createScale } from './scale.js';
import { createPlants, createDuck, createBasket } from './plants.js';

// name -> factory, in a sensible build order. `opts[name]` is passed to each factory.
export const FIXTURES = {
  toilet: createToilet,
  paperHolder: createPaperHolder,
  vanity: createVanity,
  mirrorCabinet: createMirrorCabinet,
  shower: createShower,
  door: createDoor,
  window: createWindow,
  towelRail: createTowelRail,
  towels: createTowels, // a bath towel and a hand towel over the rail's rungs (LAYOUT.towels)
  washerTower: createWasherTower,
  scale: createScale, // the bathroom scale half under the vanity (LAYOUT.scale)
  panel: createPanel,
  clipboard: createClipboard,
  phone: createPhone,
  soapDispenser: createSoapDispenser,
  toothbrushCup: createToothbrushCup,
  extractValve: createExtractValve,
  membraneButton: createMembraneButton, // the white "Membran" button on the back wall (left the door panel 2026-10-19)
  // photographed models (they load on their own: each stands at once, empty, and fills in when its files arrive)
  plants: createPlants, // a succulent on the window sill, a leafy plant on the floor by the vanity (LAYOUT.plants)
  duck: createDuck, // a rubber duck on the shower niche's shelf (LAYOUT.duck)
  basket: createBasket, // a wicker basket on the floor under the towel rail (LAYOUT.basket)
};

// Things that go into other things, once the set is built: the rolled towels lie in the basket (fixtures.towelRolls,
// the frame of the basket's anchors.inside). They are hidden until the basket itself has arrived (a photographed model),
// so towels never lie in the air; a basket that never arrives keeps them hidden. Returns fixtures.
export function furnish(ctx, fixtures) {
  const basket = fixtures.basket;
  const inside = basket && basket.anchors && basket.anchors.inside;
  if (inside && !fixtures.towelRolls) {
    const rolls = createRolledTowel(ctx, { basket: inside.userData });
    rolls.group.visible = false;
    inside.add(rolls.group);
    fixtures.towelRolls = rolls;
    if (basket.ready) {
      basket.ready.then(() => {
        rolls.group.visible = !!basket.parts.body;
        if (rolls.group.visible && ctx.loop && ctx.loop.wake) ctx.loop.wake(300);
      }, () => {});
    }
  }
  return fixtures;
}

// Builds every fixture and furnishes them; adds each group to `parent` when given. Returns { [name]: fixture } (plus
// towelRolls, inside the basket's group).
export function createAllFixtures(ctx, opts = {}, parent = null) {
  const out = {};
  for (const [name, create] of Object.entries(FIXTURES)) {
    out[name] = create(ctx, opts[name] || {});
    if (parent) parent.add(out[name].group);
  }
  return furnish(ctx, out);
}
