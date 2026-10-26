// ctrl2d — tested 2D controllers for the Game Kit (pure logic, no DOM).
// Agents configure these instead of writing movement or physics.
//
//   import { intentFromInput, inputOptions, createPlatformer, tileWorld, createCamera2d } from './kit/src/ctrl2d/index.js';
//
// Every controller: state, step(intent, dt), reset(), events (the last step's), lastAction().
// The grid mover also has stepSize (set window.__game.stepSize to it).

export { DEFAULT_MAP, AXIS_DEFAULTS, normalizeAxis, neutralIntent, intentFromInput, inputOptions, trackPointer } from './intent.js';
export { tileWorld, sweepX, sweepY, moveAndCollide, probe, overlapsWorld, cornerSlip, overlap, intersect, separate, containsPoint, sweepAabb, boxesAt } from './collide.js';
export { createPlatformer, PLATFORMER_DEFAULTS } from './platformer.js';
export { createTopDown, TOPDOWN_DEFAULTS } from './topdown.js';
export { createGridMover, GRID_DEFAULTS } from './grid-mover.js';
export { createBrawler, drawBrawlerDebug, BRAWLER_DEFAULTS, PLAYER_MOVES, ENEMY_MOVES } from './brawler.js';
export { createRunner, RUNNER_DEFAULTS } from './runner.js';
export { createShmup, SHMUP_DEFAULTS } from './shmup.js';
export { createCamera2d, CAMERA2D_DEFAULTS } from './camera2d.js';
export { createDigital, approach, clamp, damp } from './common.js';
