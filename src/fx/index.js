// Water, steam and fog effects for the bathroom (contract: docs/ARCHITECTURE.md, "Effects").
// Every effect: createX(ctx, opts) -> { object3d, update(dtMs) -> busy, ...setters }. object3d is in room coordinates
// (metres, y up): add it to the scene root. update takes the render loop's dt in MILLISECONDS (like core/tween.js) and
// returns true while something visibly moves, so the loop may sleep otherwise. Anchors may be fixture anchors
// (Object3D): their world position is used. Nothing touches the DOM.
//
// The simple way in: install(ctx) (main.js calls it after the fixtures) builds every effect from the fixtures' anchors
// (or LAYOUT), runs them on ctx.loop, plays the water sounds through ctx.audio and returns the controls as ctx.fx:
//   ctx.fx.setTap(flow, temperature); ctx.fx.setPlug(true); ctx.fx.setShower(1, 0.8); ctx.fx.setFan(1);
//   ctx.fx.greet();  // the mirror wakes fogged with "Ta gjerne på alt" written by a fingertip
//   ctx.fx.mirrorFog.wipe(hit.uv);  // a raycast hit on ctx.fx.mirrorFog.meshes (or the mirror door faces)
//   ctx.fx.on('basin:full', fn);
// A working example with sliders: app/fx-demo.html (app/src/fx/dev/fxDemo.js).

export { install } from './install.js';
export { createWaterStream, defaultTapOutlet, defaultBasinFloorY } from './waterStream.js';
export { createBasinWater } from './basinWater.js';
export { createShowerSpray } from './showerSpray.js';
export { createSteam, showerSteamSource } from './steam.js';
export { createFog } from './fog.js';
export { createDrip } from './drip.js';
export { createSplash } from './splash.js';
export { HUMIDITY, steamStrength, humidityStep, createHumidity } from './humidity.js';
export {
  BASIN_DEFAULTS, basinDims, vesselProfile, cylinderProfile, pointsProfile, makeVolumeTable, createBasinState, basinStep,
} from './basinModel.js';
export { layoutText, hasGlyph } from './fogFont.js';
export { createMask, stampDisc, stampSegment, regrow, heatRect } from './fogMask.js';
