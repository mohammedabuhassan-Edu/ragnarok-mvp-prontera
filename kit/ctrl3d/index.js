// ctrl3d — tested 3D controllers and camera rigs for the Game Kit.
//
// The game never writes movement or camera code: it picks a controller and a
// rig and sets a few numbers.
//
//   controller        rig                      for
//   createGridCrawler firstPerson              dungeon crawlers (one tap = one tile)
//   createWalker      thirdPersonOrbit / followChase / firstPerson (mode 'strafe')
//   createVehicle     followChase              karts, cars
//   createPlatformer3d followChase / thirdPersonOrbit
//   createTopdown3d   topDown / overview       top-down and isometric
//                     sideView                 2.5D side views
//
// Each controller: state, step(intent, dt), reset(pose), events (cleared every
// step), lastAction(), pose(alpha), apply(object3d, alpha). Build the intent with
// intentFromInput(input, map) once per fixed step. attachCharacter() puts a
// library GLB on any of them; loadCharacterSafe() loads that GLB and gives a
// placeholder figure when it does not load, so a missing file never stops the game. A bot or a foe that steers by a WORLD direction
// uses intentToward(dx, dz, viewYaw) (or worldToStick) instead of its own math.

export {
  intentFromInput, flushInput, idleIntent, DEFAULT_INPUT_MAP, intentToward, worldToStick,
  boxesCollider, boxesGround, boxesRaycast, gridCollider, overlaps, bodyBox, sweep,
  applyPose, lerpPose, wrapAngle, lerpAngle, clamp,
} from './common.js';
export { createGridCrawler } from './grid-crawler.js';
export { createWalker, WALKER_DEFAULTS } from './walker.js';
export { createVehicle, VEHICLE_DEFAULTS, SURFACES } from './vehicle.js';
export { createPlatformer3d, PLATFORMER3D_DEFAULTS } from './platformer3d.js';
export { createTopdown3d, TOPDOWN3D_DEFAULTS } from './topdown3d.js';
export { followChase, thirdPersonOrbit, firstPerson, sideView, topDown, overview, frameCheck, targetBox } from './cameras.js';
export {
  attachCharacter, feetOffset, clipFor, resolveClip, LIBRARY_CLIPS, CLIP_FALLBACKS,
  loadCharacterSafe, placeholderCharacter, PLACEHOLDER_PART,
} from './attach.js';
