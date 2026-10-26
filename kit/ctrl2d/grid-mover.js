// grid-mover.js — a tile-by-tile mover (roguelike, Sokoban, tactics).
// Pure logic: no DOM.
//
// One press = one tile. Holding repeats after repeatDelay (250 ms) at most
// repeatRate (6) tiles per second. Each move tweens over moveTime; while it
// tweens no new move starts, and a press made then is DROPPED, never queued
// (the same rule as the 3D grid crawler and kit-contract.md §14): a tap always
// moves exactly one tile. A key still held after the tween repeats as a hold
// (after repeatDelay from its press).
// Walking into a wall gives a 'bumped' event and a little bump offset to draw.
// Optional push-blocks follow the Sokoban rule (push one, never pull, never two)
// and every move can be undone.
//
//   const mover = createGridMover({ world, tx: 2, ty: 3, tileSize: 16, pushBlocks: true, blocks: level.crates });
//   game.stepSize = mover.stepSize;                         // for the verify controls pass
//   createInput(canvas, inputOptions('grid'));              // moveExpect 'step'
//   function update(dt) {
//     mover.step(intentFromInput(input), dt);               // intent.undo undoes
//     for (const e of mover.events) if (e.type === 'bumped') audio.sfx('bump');
//     game.state.player = { x: mover.state.x, y: mover.state.y, dir: mover.state.dir };
//   }
//
// state: { tx, ty (tile), x, y (pixel top-left, tweened), moving, facing {x, y},
//          dir ('up'|'down'|'left'|'right'|'up-left'...), moves, pushes,
//          bumpX, bumpY (pixel offset while bumping: draw at x + bumpX) }
// blocks: [{ id, tx, ty, x, y, ...your fields }]  (x, y tweened pixels)
// events: stepped {tx, ty, fromTx, fromTy}, bumped {tx, ty, block?}, pushed {block, tx, ty}, undone

import { createDigital, createEvents, lerp, easeOutCubic, readIntent, withDefaults } from './common.js';

export const GRID_DEFAULTS = {
  tx: 0, ty: 0,
  tileSize: 16,
  moveTime: 0.12,          // s per tile tween
  repeatDelay: 0.25,       // hold this long before repeating
  repeatRate: 6,           // max tiles per second while held
  diagonal: false,         // 8-way (no corner cutting past two walls)
  on: 0.5, off: 0.3,       // stick thresholds (hysteresis)
  pushBlocks: false,
  blocks: [],              // [{tx, ty, ...}]
  undo: true,
  historyLimit: 1000,
  bumpTime: 0.14,
  bumpAmount: 0.18,        // of a tile
};

const DIR_NAMES = { '0,-1': 'up', '0,1': 'down', '-1,0': 'left', '1,0': 'right', '-1,-1': 'up-left', '1,-1': 'up-right', '-1,1': 'down-left', '1,1': 'down-right' };

/**
 * @param {object} o  GRID_DEFAULTS overrides plus:
 * @param {object} [o.world]   { solidAt(tx, ty) } (a tileWorld works)
 * @param {(tx:number, ty:number) => boolean} [o.blocked]  instead of world: true = cannot enter
 */
export function createGridMover(o = {}) {
  const C = withDefaults(GRID_DEFAULTS, o);
  const T = C.tileSize;
  const ev = createEvents(o.onEvent);
  let world = o.world || null;
  const blockedFn = (tx, ty) => (typeof o.blocked === 'function' ? !!o.blocked(tx, ty) : world ? !!world.solidAt(tx, ty) : false);
  const digX = createDigital(C.on, C.off), digY = createDigital(C.on, C.off);
  const s = {};
  let blocks = [];
  let history = [];
  let tween = null;        // { t, fx, fy, block?, bfx, bfy }
  let bump = null;         // { t, dx, dy }
  let prevKey = '0,0', holdT = 0, nextRepeat = 0, lastAxis = 'x';

  function reset(at) {
    Object.assign(s, {
      tx: at?.tx ?? C.tx, ty: at?.ty ?? C.ty, moving: false, facing: { x: 0, y: 1 }, dir: 'down',
      moves: 0, pushes: 0, bumpX: 0, bumpY: 0,
    });
    s.x = s.tx * T; s.y = s.ty * T;
    blocks = (at?.blocks ?? C.blocks ?? []).map((b, i) => ({ ...b, id: b.id ?? i, x: b.tx * T, y: b.ty * T }));
    history = []; tween = null; bump = null;
    prevKey = '0,0'; holdT = 0; nextRepeat = 0;
    digX.reset(); digY.reset();
    ev.reset();
  }
  reset();

  const blockAt = (tx, ty) => blocks.find((b) => b.tx === tx && b.ty === ty) || null;
  const free = (tx, ty) => !blockedFn(tx, ty) && !(C.pushBlocks && blockAt(tx, ty));

  function finishTween() {
    if (!tween) return;
    s.x = s.tx * T; s.y = s.ty * T;
    if (tween.block) { tween.block.x = tween.block.tx * T; tween.block.y = tween.block.ty * T; }
    tween = null; s.moving = false;
  }

  function tryMove(dx, dy) {
    s.facing = { x: dx, y: dy };
    s.dir = DIR_NAMES[`${dx},${dy}`];
    const nx = s.tx + dx, ny = s.ty + dy;
    const doBump = (extra) => {
      bump = { t: 0, dx, dy };
      ev.emit('bumped', { tx: nx, ty: ny, dir: s.dir, ...extra });
      ev.act('bump');
    };
    // diagonal: never squeeze between two walls
    if (dx && dy && (!free(s.tx + dx, s.ty) || !free(s.tx, s.ty + dy))) return doBump({ corner: true });
    if (blockedFn(nx, ny)) return doBump();
    const blk = C.pushBlocks ? blockAt(nx, ny) : null;
    let pushed = null;
    if (blk) {
      const bx = nx + dx, by = ny + dy;
      if (!free(bx, by)) return doBump({ block: blk });
      pushed = { block: blk, ftx: blk.tx, fty: blk.ty };
      blk.tx = bx; blk.ty = by;
    }
    if (C.undo) {
      history.push({ tx: s.tx, ty: s.ty, facing: s.facing, dir: s.dir, block: pushed });
      if (history.length > C.historyLimit) history.shift();
    }
    tween = { t: 0, fx: s.x, fy: s.y, block: pushed?.block || null, bfx: pushed ? pushed.block.x : 0, bfy: pushed ? pushed.block.y : 0 };
    const from = { fromTx: s.tx, fromTy: s.ty };
    s.tx = nx; s.ty = ny; s.moving = true; s.moves++;
    if (pushed) {
      s.pushes++;
      ev.emit('pushed', { block: pushed.block, tx: pushed.block.tx, ty: pushed.block.ty });
      ev.act('push-' + s.dir);
    } else ev.act('step-' + s.dir);
    ev.emit('stepped', { tx: nx, ty: ny, ...from, dir: s.dir });
  }

  function undo() {
    if (!history.length) return false;
    finishTween();
    const h = history.pop();
    s.tx = h.tx; s.ty = h.ty; s.x = s.tx * T; s.y = s.ty * T;
    s.facing = h.facing; s.dir = h.dir;
    if (h.block) {
      h.block.block.tx = h.block.ftx; h.block.block.ty = h.block.fty;
      h.block.block.x = h.block.ftx * T; h.block.block.y = h.block.fty * T;
      s.pushes = Math.max(0, s.pushes - 1);
    }
    s.moves = Math.max(0, s.moves - 1);
    bump = null; s.bumpX = s.bumpY = 0;
    ev.emit('undone', { tx: s.tx, ty: s.ty });
    ev.act('undo');
    return true;
  }

  function step(intent, dt) {
    ev.clear();
    if (!(dt > 0)) return;
    const I = readIntent(intent);

    // ---- tweens
    if (tween) {
      tween.t += dt;
      const k = C.moveTime > 0 ? easeOutCubic(tween.t / C.moveTime) : 1;
      s.x = lerp(tween.fx, s.tx * T, k); s.y = lerp(tween.fy, s.ty * T, k);
      if (tween.block) { tween.block.x = lerp(tween.bfx, tween.block.tx * T, k); tween.block.y = lerp(tween.bfy, tween.block.ty * T, k); }
      if (tween.t >= C.moveTime) finishTween();
    }
    if (bump) {
      bump.t += dt;
      const a = Math.sin(Math.PI * Math.min(1, bump.t / C.bumpTime)) * C.bumpAmount * T;
      s.bumpX = bump.dx * a; s.bumpY = bump.dy * a;
      if (bump.t >= C.bumpTime) { bump = null; s.bumpX = s.bumpY = 0; }
    }

    if (I.undo && C.undo) undo();

    // ---- direction (digital, with hysteresis)
    let dx = digX(I.moveX), dy = digY(I.moveY);
    if (dx && dy && !C.diagonal) {
      const ax = Math.abs(I.moveX), ay = Math.abs(I.moveY);
      if (Math.abs(ax - ay) < 0.05) { if (lastAxis === 'x') dy = 0; else dx = 0; } else if (ax > ay) dy = 0; else dx = 0;
    }
    const key = `${dx},${dy}`;
    let move = false;
    if (dx || dy) {
      if (key !== prevKey) {
        // a new press: one tile now; during a tween it is dropped (never queued)
        lastAxis = dx && !dy ? 'x' : !dx && dy ? 'y' : lastAxis;
        holdT = 0; nextRepeat = C.repeatDelay;
        move = !tween;
      } else {
        holdT += dt;
        // a hold repeats; a repeat that falls inside a tween fires when it ends (if still held)
        if (holdT + 1e-9 >= nextRepeat && !tween) {
          move = true;
          nextRepeat += 1 / Math.max(0.1, C.repeatRate);
        }
      }
    } else { holdT = 0; }
    prevKey = key;

    if (move) tryMove(dx, dy);
  }

  return {
    state: s,
    get events() { return ev.events; },
    get blocks() { return blocks; },
    stepSize: T,
    step,
    reset,
    undo,
    lastAction: () => ev.last(),
    blockAt,
    /** can the mover enter this tile right now (a wall or an unpushable block says no) */
    canEnter: (tx, ty) => free(tx, ty),
    get history() { return history.length; },
    setWorld(w) { world = w; },
    teleport(tx, ty) { finishTween(); s.tx = tx; s.ty = ty; s.x = tx * T; s.y = ty * T; },
    /** pixel center of the mover (tweened) */
    center: () => ({ x: s.x + T / 2 + s.bumpX, y: s.y + T / 2 + s.bumpY }),
    options: C,
  };
}
