// BrainDaemon Game Kit — public entry.
//
//   import { createLoop, createInput, createAudio, createShell, createBrand,
//            createQuality, installSelfTest, game } from './kit/src/index.js';
//
// Importing this module also creates window.__game, the object the self-test,
// the Blueprint gate and verify-game.mjs read:
//   window.__game = { kit, state, score, level, brand, audio, quality, test, ready, share, controls }
//   (kit is KIT_VERSION; quality.software is true on a software WebGL renderer;
//   controls() lists every control declared with createInput, null without one)
// The game fills it in: game.state.player = {x,y,z}; game.brand = brand; ...
// Optional, for the verify controls pass: game.stepSize (a grid game's step,
// in state.player units) and game.lastAction() (the last thing the player did).
// bindController(ctrl) sets all three from a Kit controller.
//
// Kit 0.3: controllers, camera rigs, touch layouts and looks.
//   - Every controller and camera rig is exported by its own name:
//       2D  createPlatformer, createTopDown, createGridMover, createBrawler, createRunner,
//           createShmup, createCamera2d, tileWorld, ...           (src/ctrl2d)
//       3D  createGridCrawler, createWalker, createVehicle, createPlatformer3d, createTopdown3d,
//           followChase, thirdPersonOrbit, firstPerson, sideView, topDown, overview,
//           attachCharacter, boxesCollider, ...                    (src/ctrl3d)
//   - The two names both groups have get a suffix: intentFromInput2d / intentFromInput3d
//     (clamp is only in the namespaces).
//   - The whole groups are also namespaces: ctrl2d.intentFromInput, ctrl3d.intentFromInput, ctrl3d.clamp.
//   - layoutFor(kind): the createInput options (buttons, keys, expect, phone places) per game type.
//   - Looks: createLook(THREE) for three.js (the Kit never imports three itself, so 2D
//     games load this file without it) and the canvasLook namespace for Canvas 2D.
//   - Canvas 2D chores: fitCanvas (crisp whole-pixel scale, smoothing off), loadSheet /
//     buildSheet / frameAt / drawFrame (the library sprite sheets), flat and in canvasLook.
//   - intentToward(dx, dz, viewYaw) / worldToStick: a world direction as a 3D controller's stick (bots, foes).
//   - Never let a missing asset stop the game: loadJsonSafe (data JSON with built-in defaults),
//     loadSheetSafe (placeholder sprites), loadCharacterSafe (a placeholder figure for a GLB).

import { describeControls } from './input.js';

export const KIT_VERSION = '0.3.0';

export { createRng, createLoop } from './loop.js';
export { createInput, describeControls, CONTROL_EXPECTS } from './input.js';
export { layoutFor, LAYOUT_KINDS } from './layouts.js';
export { createQuality, isSoftwareRenderer, gpuName, installSoftwareCanvas } from './quality.js';
import { installSoftwareCanvas } from './quality.js';
installSoftwareCanvas();
export { createAudio, midiToHz } from './audio.js';
export { createShell, STRINGS, LANGS, tr, detectLang } from './shell.js';
export { createBrand } from './brand.js';
export { installSelfTest } from './selftest.js';

// ---------------------------------------------------------------- 2D controllers (src/ctrl2d)
export * as ctrl2d from './ctrl2d/index.js';
export { intentFromInput as intentFromInput2d } from './ctrl2d/index.js';
export {
  DEFAULT_MAP, AXIS_DEFAULTS, normalizeAxis, neutralIntent, inputOptions, trackPointer,
  tileWorld, sweepX, sweepY, moveAndCollide, probe, overlapsWorld, cornerSlip, overlap, intersect, separate, containsPoint, sweepAabb, boxesAt,
  createPlatformer, PLATFORMER_DEFAULTS, createTopDown, TOPDOWN_DEFAULTS, createGridMover, GRID_DEFAULTS,
  createBrawler, drawBrawlerDebug, BRAWLER_DEFAULTS, PLAYER_MOVES, ENEMY_MOVES,
  createRunner, RUNNER_DEFAULTS, createShmup, SHMUP_DEFAULTS, createCamera2d, CAMERA2D_DEFAULTS,
  createDigital, approach, damp,
} from './ctrl2d/index.js';

// ---------------------------------------------------------------- 3D controllers and camera rigs (src/ctrl3d)
export * as ctrl3d from './ctrl3d/index.js';
export { intentFromInput as intentFromInput3d } from './ctrl3d/index.js';
export {
  flushInput, idleIntent, DEFAULT_INPUT_MAP, intentToward, worldToStick,
  boxesCollider, boxesGround, boxesRaycast, gridCollider, overlaps, bodyBox, sweep,
  applyPose, lerpPose, wrapAngle, lerpAngle,
  createGridCrawler, createWalker, WALKER_DEFAULTS, createVehicle, VEHICLE_DEFAULTS, SURFACES,
  createPlatformer3d, PLATFORMER3D_DEFAULTS, createTopdown3d, TOPDOWN3D_DEFAULTS,
  followChase, thirdPersonOrbit, firstPerson, sideView, topDown, overview, frameCheck, targetBox,
  attachCharacter, feetOffset, clipFor, resolveClip, LIBRARY_CLIPS, CLIP_FALLBACKS,
  loadCharacterSafe, placeholderCharacter, PLACEHOLDER_PART,
} from './ctrl3d/index.js';

// ---------------------------------------------------------------- looks (src/look)
// three-look.js has no import of three: createLook(THREE) binds the game's own copy.
export { createLook, PRESET_NAMES, PRESET_GROUNDS, PALETTES, SURFACE_KINDS, PROP_KINDS } from './look/three-look.js';
export * as canvasLook from './look/canvas-look.js';
// Canvas 2D chores (look/canvas2d.js), also flat: crisp integer scaling and the library sprite sheets
export { fitCanvas, crispScale, loadSheet, buildSheet, frameAt, drawFrame, loadSheetSafe, placeholderSheet } from './look/canvas2d.js';
// Never let a missing asset stop the game (safe-load.js): a failed load warns once and falls back
//   loadJsonSafe(url, defaults)  loadSheetSafe(src, { names })  loadCharacterSafe(loader, url, { THREE, clips })
export { loadJsonSafe, withTimeout } from './safe-load.js';

const root = typeof window !== 'undefined' ? window : globalThis;
const existing = root.__game || {};

/** the shared game object (same instance as window.__game) */
export const game = Object.assign(existing, {
  kit: KIT_VERSION,
  state: existing.state || {},
  score: existing.score ?? 0,
  level: existing.level ?? 1,
  brand: existing.brand ?? null,
  audio: existing.audio ?? null,
  quality: existing.quality ?? null,
  // test() is installed by installSelfTest(); until then it reports "not installed".
  test: existing.test || (async () => ({ pass: false, total: 0, failures: ['selftest-not-installed'] })),
  // ready() is installed by installSelfTest() too (it starts the ?test run when autoRun is false).
  ready: existing.ready || (() => {}),
  /** every control declared with createInput (input.describe() of each live input), or null without one */
  controls: existing.controls || (() => describeControls()),
  /** share hook (spec §5.6): tells the parent player page to open its share UI */
  share(extra = {}) {
    const msg = { type: 'braindaemon:game-share', score: game.score, level: game.level, title: root.document?.title, ...extra };
    try { if (root.parent && root.parent !== root) root.parent.postMessage(msg, '*'); } catch { /* cross-origin parent */ }
    return msg;
  },
});
root.__game = game;

/** the player for verify, from a controller: its state, the brawler's player fighter, a lane runner's lane */
function autoPlayer(ctrl) {
  if (ctrl.player && typeof ctrl.player === 'object') return ctrl.player;           // brawler
  const s = ctrl.state;
  const lanes = s && Number.isFinite(s.laneX) && typeof ctrl.box === 'function' && !('y' in ctrl.box());
  if (lanes) return { x: s.laneX, y: s.distance, z: s.z, lane: s.lane };          // runner, lanes mode
  return s;
}

/**
 * Wire a Kit controller to window.__game for verify:
 *   game.state.player  a live view of the controller's state (always current, no copy per step)
 *   game.stepSize      the controller's stepSize (grid crawler, grid mover), when it has one
 *   game.lastAction()  the controller's lastAction(), or the newest act(name) of the game
 *
 *   const hero = createWalker({ ... });
 *   const link = bindController(hero);
 *   // the game's own actions count too (a door opened, a lever pulled, "nothing here"):
 *   link.act('use:door');
 *
 * @param {object} ctrl  a ctrl2d / ctrl3d controller (state, lastAction(), stepSize?)
 * @param {object} [o]
 * @param {boolean|(() => object)} [o.player=true]  false: leave game.state.player to the game;
 *   a function: its result is the player ({x, y, z, dir}) verify reads
 * @returns {{ act(name:string): string, unbind(): void }}
 */
export function bindController(ctrl, { player = true } = {}) {
  if (!ctrl || typeof ctrl !== 'object') throw new Error('bindController: pass a Kit controller');
  let seen = null, last = null, n = 0;
  const ctrlLast = () => (typeof ctrl.lastAction === 'function' ? ctrl.lastAction() : null);
  const lastAction = () => {
    const c = ctrlLast();
    if (c !== seen) { seen = c; if (c !== null && c !== undefined) last = c; }
    return last;
  };
  seen = ctrlLast();
  game.lastAction = lastAction;
  if (Number.isFinite(ctrl.stepSize)) game.stepSize = ctrl.stepSize;
  if (player) {
    const get = typeof player === 'function' ? player : () => autoPlayer(ctrl);
    if (!game.state || typeof game.state !== 'object') game.state = {};
    Object.defineProperty(game.state, 'player', {
      configurable: true, enumerable: true,
      get,
      // a game that assigns state.player itself takes it back
      set(v) { Object.defineProperty(game.state, 'player', { value: v, writable: true, configurable: true, enumerable: true }); },
    });
  }
  return {
    /** report a game action (verify counts it as the press doing something) */
    act(name) { n++; last = `${name}#g${n}`; return last; },
    unbind() {
      if (game.lastAction === lastAction) delete game.lastAction;
      if (player && game.state) {
        const d = Object.getOwnPropertyDescriptor(game.state, 'player');
        if (d && d.get) Object.defineProperty(game.state, 'player', { value: d.get(), writable: true, configurable: true, enumerable: true });
      }
    },
  };
}
