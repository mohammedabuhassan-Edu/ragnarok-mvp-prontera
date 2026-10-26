// ctrl3d/grid-crawler.js — first-person grid movement (dungeon crawlers, a party
// that moves one tile at a time).
//
//   One press = one tile. A move is a tween (moveTime) and the controller is
//   locked until it ends; presses that arrive during a move are DROPPED (never
//   queued). Holding repeats after repeatDelay, at most repeatRate steps / s.
//   Turning is a tweened 90°. A blocked step is a bump (event + nudge), no move.
//
//   const crawler = createGridCrawler({
//     cellSize: 3,
//     isBlocked: (x, z) => map[z]?.[x] !== '.',
//     start: { x: 1, z: 1, dir: 0 },
//   });
//   game.stepSize = crawler.stepSize;              // verify's overshoot check
//   game.lastAction = () => crawler.lastAction();
//   const eye = firstPerson({ eyeHeight: 1.6 });
//   // update(dt):  crawler.step(intentFromInput(input), dt);
//   //              for (const e of crawler.events) if (e.type === 'bumped') audio.sfx('bump');
//   //              game.state.player = crawler.state;
//   // render(alpha, frameDt):  eye.update(crawler.pose(alpha), frameDt); eye.apply(camera);
//
// Input: intent.moveY (forward / back), intent.moveX (turns, or strafes with
// lateral: 'strafe'), intent.turn (always turns), intent.strafe (always strafes),
// and intent.taps (the press edges, so a tap shorter than one step still counts).

import { createRecorder, wrapAngle, lerpAngle, lerp, applyPose, lerpPose } from './common.js';

const HALF_PI = Math.PI / 2;
const EPS = 1e-6;
const PRIORITY = ['forward', 'back', 'turnLeft', 'turnRight', 'strafeLeft', 'strafeRight'];

/**
 * @typedef {object} GridCrawlerOptions
 * @property {number} [cellSize=2]  world units per tile (state.x = cell.x * cellSize)
 * @property {(x:number, z:number, fromX:number, fromZ:number) => boolean} [isBlocked]
 *   the game's map: true when the cell (x, z) cannot be entered from (fromX, fromZ). Default: never blocked.
 * @property {{x?:number, z?:number, dir?:number}} [start]  start cell and facing (dir 0 = +Z, 1 = +X, 2 = -Z, 3 = -X)
 * @property {number} [moveTime=0.18]   seconds per step tween
 * @property {number} [turnTime=0.15]   seconds per 90° turn tween
 * @property {number} [bumpTime=0.14]   seconds of the bump nudge (also locks input)
 * @property {number} [bumpDepth=0.12]  how far the nudge goes, in tiles
 * @property {number} [repeatDelay=0.25]  hold this long before a held control repeats
 * @property {number} [repeatRate=6]    max steps (or turns) per second while held
 * @property {'turn'|'strafe'} [lateral='turn']  what moveX (A / D, stick left / right) does
 * @property {boolean} [allowBack=true]    moveY < 0 steps backwards
 * @property {boolean} [allowStrafe=true]  strafing at all (intent.strafe, or lateral 'strafe')
 * @property {number} [threshold=0.5]   stick / axis value that counts as a press
 * @property {(e:object)=>void} [onEvent]  called for every event
 */

/** @param {GridCrawlerOptions} [o] */
export function createGridCrawler(o = {}) {
  const opt = {
    cellSize: 2, isBlocked: () => false, start: { x: 0, z: 0, dir: 0 },
    moveTime: 0.18, turnTime: 0.15, bumpTime: 0.14, bumpDepth: 0.12,
    repeatDelay: 0.25, repeatRate: 6, lateral: 'turn', allowBack: true, allowStrafe: true,
    threshold: 0.5, onEvent: null, ...o,
  };
  const rec = createRecorder(opt.onEvent);

  const state = {
    cell: { x: 0, z: 0 }, dir: 0, x: 0, y: 0, z: 0, yaw: 0, angle: 0,
    moving: false, turning: false, bumping: false, busy: false, speed: 0, grounded: true,
    vx: 0, vz: 0,
  };
  const prev = { x: 0, y: 0, z: 0, yaw: 0 };
  let tw = null;                // { kind, t, dur, from, to }
  let wasOn = {};
  let holdCmd = null, holdT = 0, sinceStep = Infinity;

  const yawOf = (dir) => wrapAngle(dir * HALF_PI);
  const delta = (dir) => [Math.round(Math.sin(yawOf(dir))), Math.round(Math.cos(yawOf(dir)))];

  function reset(pose = opt.start) {
    state.cell.x = pose.x ?? 0;
    state.cell.z = pose.z ?? 0;
    state.dir = ((pose.dir ?? 0) % 4 + 4) % 4;
    state.x = state.cell.x * opt.cellSize;
    state.z = state.cell.z * opt.cellSize;
    state.y = 0;
    state.yaw = state.angle = yawOf(state.dir);
    state.moving = state.turning = state.bumping = state.busy = false;
    state.speed = state.vx = state.vz = 0;
    tw = null; wasOn = {}; holdCmd = null; holdT = 0; sinceStep = Infinity;
    Object.assign(prev, { x: state.x, y: state.y, z: state.z, yaw: state.yaw });
    rec.reset();
  }

  function commandsOn(intent) {
    const th = opt.threshold;
    const mx = intent.moveX || 0, my = intent.moveY || 0, turn = intent.turn || 0, strafe = intent.strafe || 0;
    const lat = opt.lateral === 'strafe' && opt.allowStrafe;
    const taps = intent.taps || {};
    const on = {
      forward: my > th,
      back: opt.allowBack && my < -th,
      turnLeft: turn < -th || (!lat && mx < -th),
      turnRight: turn > th || (!lat && mx > th),
      strafeLeft: opt.allowStrafe && (strafe < -th || (lat && mx < -th)),
      strafeRight: opt.allowStrafe && (strafe > th || (lat && mx > th)),
    };
    const tap = {
      forward: !!taps.forward,
      back: opt.allowBack && !!taps.back,
      turnLeft: !!taps.turnLeft || (!lat && !!taps.left),
      turnRight: !!taps.turnRight || (!lat && !!taps.right),
      strafeLeft: opt.allowStrafe && (!!taps.strafeLeft || (lat && !!taps.left)),
      strafeRight: opt.allowStrafe && (!!taps.strafeRight || (lat && !!taps.right)),
    };
    return { on, tap };
  }

  function run(cmd, repeat) {
    const interval = 1 / opt.repeatRate;
    const from = { x: state.x, z: state.z, yaw: state.yaw };
    sinceStep = 0;
    if (cmd === 'turnLeft' || cmd === 'turnRight') {
      const by = cmd === 'turnLeft' ? 1 : -1;           // yaw + 90° is a left turn
      state.dir = (state.dir + by + 4) % 4;
      const dur = repeat ? Math.min(opt.turnTime, interval) : opt.turnTime;
      tw = { kind: 'turn', t: 0, dur, from, to: { x: state.x, z: state.z, yaw: yawOf(state.dir) } };
      rec.emit('turned', { dir: state.dir, by, repeat });
      rec.act(cmd === 'turnLeft' ? 'turn:left' : 'turn:right');
      return;
    }
    let [dx, dz] = delta(state.dir);
    if (cmd === 'back') { dx = -dx; dz = -dz; }
    else if (cmd === 'strafeRight') { [dx, dz] = delta((state.dir + 3) % 4); }
    else if (cmd === 'strafeLeft') { [dx, dz] = delta((state.dir + 1) % 4); }
    const tx = state.cell.x + dx, tz = state.cell.z + dz;
    if (opt.isBlocked(tx, tz, state.cell.x, state.cell.z)) {
      const d = opt.bumpDepth * opt.cellSize;
      tw = { kind: 'bump', t: 0, dur: opt.bumpTime, from, to: { x: from.x + dx * d, z: from.z + dz * d, yaw: from.yaw } };
      rec.emit('bumped', { cell: { x: tx, z: tz }, command: cmd, repeat });
      rec.act('bump');
      return;
    }
    const fromCell = { x: state.cell.x, z: state.cell.z };
    state.cell.x = tx; state.cell.z = tz;
    const dur = repeat ? Math.min(opt.moveTime, interval) : opt.moveTime;
    tw = { kind: 'move', t: 0, dur, from, to: { x: tx * opt.cellSize, z: tz * opt.cellSize, yaw: from.yaw } };
    rec.emit('stepped', { from: fromCell, to: { x: tx, z: tz }, command: cmd, repeat });
    rec.act(`step:${cmd}`);
  }

  function advanceTween(dt) {
    if (!tw) return;
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.dur);
    const e = k * k * (3 - 2 * k);
    if (tw.kind === 'bump') {
      const b = Math.sin(Math.PI * k);                  // out and back
      state.x = lerp(tw.from.x, tw.to.x, b);
      state.z = lerp(tw.from.z, tw.to.z, b);
    } else {
      state.x = lerp(tw.from.x, tw.to.x, e);
      state.z = lerp(tw.from.z, tw.to.z, e);
      state.yaw = lerpAngle(tw.from.yaw, tw.to.yaw, e);
    }
    if (tw.t + EPS >= tw.dur) {
      state.x = tw.kind === 'bump' ? tw.from.x : tw.to.x;
      state.z = tw.kind === 'bump' ? tw.from.z : tw.to.z;
      state.yaw = wrapAngle(tw.to.yaw);
      tw = null;
    }
  }

  /**
   * One fixed step.
   * @param {object} intent  intentFromInput() (or any object with the same fields)
   * @param {number} dt      the loop's fixed step (seconds)
   */
  function step(intent, dt) {
    rec.begin(dt);
    prev.x = state.x; prev.y = state.y; prev.z = state.z; prev.yaw = state.yaw;
    const { on, tap } = commandsOn(intent || {});

    // hold tracking: the highest-priority control held right now
    const heldNow = PRIORITY.find((c) => on[c]) || null;
    if (heldNow !== holdCmd) { holdCmd = heldNow; holdT = 0; } else if (holdCmd) holdT += dt;
    sinceStep += dt;
    // a fresh press: an edge this step (a tap), or an axis that just crossed the threshold
    const fresh = PRIORITY.find((c) => tap[c] || (on[c] && !wasOn[c])) || null;
    wasOn = on;

    const px = state.x, pz = state.z;
    advanceTween(dt);
    if (!tw) {
      if (fresh) {
        run(fresh, false);
        if (fresh === holdCmd) holdT = 0;
      } else if (holdCmd && holdT + EPS >= opt.repeatDelay && sinceStep + EPS >= 1 / opt.repeatRate) {
        run(holdCmd, true);
      }
      // a press that arrived during the tween is dropped (fresh is simply not used);
      // a new tween starts moving this very step (no frame of latency)
      if (tw) advanceTween(dt);
    }
    state.busy = !!tw;
    state.moving = tw?.kind === 'move';
    state.turning = tw?.kind === 'turn';
    state.bumping = tw?.kind === 'bump';
    state.angle = state.yaw;
    state.vx = (state.x - px) / dt;
    state.vz = (state.z - pz) / dt;
    state.speed = state.moving ? opt.cellSize / tw.dur : 0;
    return state;
  }

  const _pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const api = {
    kind: 'grid-crawler',
    /** verify's controls hint: the move controls are 'step' controls (createInput moveExpect) */
    expect: 'step',
    options: opt,
    state,
    get events() { return rec.events; },
    /** one step in state units (game.stepSize) */
    get stepSize() { return opt.cellSize; },
    step,
    reset,
    lastAction: () => rec.lastAction(),
    /** the render pose between the last two steps (alpha from the loop's render) */
    pose(alpha = 1) { return lerpPose(prev, state, alpha, _pose); },
    /** put the pose on an Object3D (a party marker, or a camera holder) */
    apply(obj, alpha = 1, yawOffset = 0) { return applyPose(obj, api.pose(alpha), yawOffset); },
    /** world position of a cell's centre */
    cellToWorld(x, z) { return { x: x * opt.cellSize, y: 0, z: z * opt.cellSize }; },
    /** the cell a world point is in */
    worldToCell(x, z) { return { x: Math.round(x / opt.cellSize), z: Math.round(z / opt.cellSize) }; },
    /** the cell straight ahead (for "use" / doors / talk) */
    facingCell() { const [dx, dz] = delta(state.dir); return { x: state.cell.x + dx, z: state.cell.z + dz }; },
  };
  reset(opt.start);
  return api;
}
