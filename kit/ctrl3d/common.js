// ctrl3d/common.js — shared pieces of the 3D controllers: math, the per-step
// intent (one path for touch and keys), the event recorder, the collision
// sweep, and world-query helpers for box and grid worlds.
//
// Conventions (every controller and camera rig uses them):
//   - three.js world, y up; positions are the FEET of the body.
//   - yaw is the angle about +Y; yaw 0 faces +Z, and the facing vector is
//     (sin yaw, 0, cos yaw). The library characters face +Z, so
//     `model.rotation.y = yaw` faces them along the movement.
//   - yaw increasing turns LEFT; "right" of a yaw is (-cos yaw, 0, sin yaw).
//   - intent.moveY +1 is forward (stick up, W, arrow up), moveX +1 is right.
//   - the cores never touch three.js or the DOM: plain numbers in and out.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** shortest-way angle lerp */
export const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;
/** fraction to move toward a target this step for an exponential approach at `rate` per second */
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
export const DEG = Math.PI / 180;
export const fwdX = (yaw) => Math.sin(yaw);
export const fwdZ = (yaw) => Math.cos(yaw);
export const rightX = (yaw) => -Math.cos(yaw);
export const rightZ = (yaw) => Math.sin(yaw);
const EPS = 1e-9;

/** move v toward target by at most maxDelta */
export function approach(v, target, maxDelta) {
  if (v < target) return Math.min(v + maxDelta, target);
  return Math.max(v - maxDelta, target);
}

/** move the 2D vector (vx, vz) toward (tx, tz) by at most maxDelta (length); returns [vx, vz] */
export function approach2(vx, vz, tx, tz, maxDelta) {
  const dx = tx - vx, dz = tz - vz;
  const d = Math.hypot(dx, dz);
  if (d <= maxDelta || d < EPS) return [tx, tz];
  return [vx + (dx / d) * maxDelta, vz + (dz / d) * maxDelta];
}

// ---------------------------------------------------------------- events + lastAction

/**
 * The per-step event list and the lastAction() string every controller exposes.
 * `events` is cleared at the start of every step(): read it right after step().
 * @param {(e:object)=>void} [onEvent]  also called for every event as it happens
 */
export function createRecorder(onEvent) {
  const events = [];
  let last = null;
  let count = 0;
  let t = 0;
  return {
    events,
    begin(dt) { events.length = 0; t += dt; },
    emit(type, data) {
      const e = { type, t, ...data };
      events.push(e);
      if (onEvent) onEvent(e);
      return e;
    },
    /** a player action for the verify controls pass ("step:forward", "bump", "jump") */
    act(name) { count++; last = name; },
    /** "<action>#<n>": the counter makes two identical actions in a row still read as a change */
    lastAction() { return last === null ? null : `${last}#${count}`; },
    get time() { return t; },
    reset() { events.length = 0; },
  };
}

// ---------------------------------------------------------------- intent

/**
 * The input map: which Kit input names feed each intent field. Every entry is a
 * name or a list of names declared in createInput (buttons, keyControls, or the
 * built-in 'up' / 'down' / 'left' / 'right' / 'jump' / 'boost' / 'use' / 'fire').
 * The joystick and WASD / arrows always feed moveX / moveY through input.axis;
 * extra names in forward / back / left / right add to it (an on-screen "▲" button).
 */
export const DEFAULT_INPUT_MAP = Object.freeze({
  forward: ['up'], back: ['down'], left: ['left'], right: ['right'],
  turnLeft: ['turnLeft'], turnRight: ['turnRight'],
  strafeLeft: ['strafeLeft'], strafeRight: ['strafeRight'],
  jump: ['jump'], boost: ['boost'], brake: ['brake'], drift: ['drift'],
  action: ['use', 'fire'],
  /** consume input.look (drag-to-look pixels) into lookX / lookY; false leaves it for the game */
  look: true,
});

const AXIS_NAMES = new Set(['up', 'down', 'left', 'right']);
const names = (v) => (v == null || v === false ? [] : Array.isArray(v) ? v : [v]);

/**
 * Build one step's intent from the Kit input (createInput). Call it ONCE per
 * fixed step, inside the loop's update(dt): it consumes the press edges
 * (input.pressed) so one press is seen by exactly one step.
 *
 *   const intent = intentFromInput(input, { turnLeft: 'turnL', turnRight: 'turnR' });
 *   ctrl.step(intent, dt);
 *
 * @param {object} input  the object createInput() returned (axis, held, pressed, consumeLook)
 * @param {Partial<typeof DEFAULT_INPUT_MAP>} [map]  overrides of DEFAULT_INPUT_MAP
 * @returns {{moveX:number, moveY:number, turn:number, strafe:number, jump:boolean, jumpHeld:boolean,
 *   boost:boolean, brake:boolean, drift:boolean, action:boolean, lookX:number, lookY:number,
 *   taps:{forward:boolean, back:boolean, left:boolean, right:boolean, turnLeft:boolean, turnRight:boolean, strafeLeft:boolean, strafeRight:boolean}}}
 */
export function intentFromInput(input, map = {}) {
  const m = { ...DEFAULT_INPUT_MAP, ...map };
  const held = (k) => names(m[k]).some((n) => input.held(n));
  const extraHeld = (k) => names(m[k]).some((n) => !AXIS_NAMES.has(n) && input.held(n));
  // read every name so every edge is consumed, not just the first that fired
  const pressed = (k) => { let any = false; for (const n of names(m[k])) if (input.pressed(n)) any = true; return any; };
  const ax = input.axis || { x: 0, y: 0 };
  const moveX = clamp((ax.x || 0) + (extraHeld('right') ? 1 : 0) - (extraHeld('left') ? 1 : 0), -1, 1);
  const moveY = clamp((ax.y || 0) + (extraHeld('forward') ? 1 : 0) - (extraHeld('back') ? 1 : 0), -1, 1);
  let lookX = 0, lookY = 0;
  if (m.look && typeof input.consumeLook === 'function') {
    const l = input.consumeLook();
    lookX = l.dx || 0; lookY = l.dy || 0;
  }
  return {
    moveX, moveY,
    turn: (held('turnRight') ? 1 : 0) - (held('turnLeft') ? 1 : 0),
    strafe: (held('strafeRight') ? 1 : 0) - (held('strafeLeft') ? 1 : 0),
    jump: pressed('jump'), jumpHeld: held('jump'),
    boost: held('boost'), brake: held('brake'), drift: held('drift'),
    action: pressed('action'),
    lookX, lookY,
    taps: {
      forward: pressed('forward'), back: pressed('back'), left: pressed('left'), right: pressed('right'),
      turnLeft: pressed('turnLeft'), turnRight: pressed('turnRight'),
      strafeLeft: pressed('strafeLeft'), strafeRight: pressed('strafeRight'),
    },
  };
}

/** drop stale press edges and drag-look (call when play starts or a menu closes) */
export function flushInput(input, map = {}) { intentFromInput(input, map); }

/** an all-zero intent (no input); pass overrides, e.g. idleIntent({ moveY: 1 }) */
export function idleIntent(over = {}) {
  return {
    moveX: 0, moveY: 0, turn: 0, strafe: 0, jump: false, jumpHeld: false, boost: false, brake: false,
    drift: false, action: false, lookX: 0, lookY: 0,
    ...over,
    taps: { forward: false, back: false, left: false, right: false, turnLeft: false, turnRight: false, strafeLeft: false, strafeRight: false, ...(over.taps || {}) },
  };
}

// ---------------------------------------------------------------- world direction -> stick

/**
 * The stick (moveX, moveY) that walks a controller along a WORLD direction: for a
 * bot, an enemy that uses a Kit controller, or a cutscene. Pass the yaw that the
 * controller's moveFrame measures "forward" from:
 *   moveFrame 'view'   (the walker default in mode 'turn'): the camera yaw (rig.yaw, the intent.viewYaw you pass)
 *   moveFrame 'world'  (moveY +1 = +Z, moveX +1 = -X): 0, or leave it out
 *   moveFrame 'facing' (mode 'strafe'): the body's state.yaw
 * The length is kept (a short vector is a gentle push) and capped at 1.
 *   const s = worldToStick(goal.x - p.x, goal.z - p.z, cam.yaw);   // { moveX, moveY }
 * @returns {{moveX:number, moveY:number}}
 */
export function worldToStick(dx, dz, viewYaw = 0) {
  dx = Number.isFinite(dx) ? dx : 0; dz = Number.isFinite(dz) ? dz : 0;
  const y = Number.isFinite(viewYaw) ? viewYaw : 0;
  let moveY = dx * fwdX(y) + dz * fwdZ(y);        // along "forward" of that yaw
  let moveX = dx * rightX(y) + dz * rightZ(y);    // along its "right"
  const len = Math.hypot(moveX, moveY);
  if (len > 1) { moveX /= len; moveY /= len; }
  return { moveX: moveX || 0, moveY: moveY || 0 };
}

/**
 * A whole intent (idleIntent) that pushes the stick FULLY toward a world direction:
 * what a bot's thumb does. Zero-length direction = no push. viewYaw as in worldToStick.
 *   hero.step({ ...intentToward(gem.x - p.x, gem.z - p.z, cam.yaw, { boost: true }), viewYaw: cam.yaw }, dt);
 *   foe.step(intentToward(p.x - f.x, p.z - f.z), dt);    // a moveFrame: 'world' foe
 * @param {number} dx  world X of the direction
 * @param {number} dz  world Z of the direction
 * @param {number} [viewYaw=0]
 * @param {object} [extra]  more intent fields (jump, action, boost, ...)
 */
export function intentToward(dx, dz, viewYaw = 0, extra = {}) {
  const n = Math.hypot(Number.isFinite(dx) ? dx : 0, Number.isFinite(dz) ? dz : 0);
  const s = n > 1e-9 ? worldToStick(dx / n, dz / n, viewYaw) : { moveX: 0, moveY: 0 };
  return idleIntent({ ...s, ...extra });
}

// ---------------------------------------------------------------- collision

/**
 * An axis-aligned box: { minX, minY, minZ, maxX, maxY, maxZ }.
 * The game's collide(aabb) returns either a boolean (true = blocked) or the
 * array of solid boxes that overlap aabb (empty = free). Arrays give exact
 * contact; a boolean is resolved by bisection (to about 1 mm).
 */
export function overlaps(a, b) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY && a.minZ < b.maxZ && a.maxZ > b.minZ;
}
export const isHit = (res) => res === true || (Array.isArray(res) && res.length > 0);

/** the body box: square r around (x, z), from y + y0 to y + y1 */
export function bodyBox(x, y, z, r, y0, y1, out = {}) {
  out.minX = x - r; out.maxX = x + r;
  out.minZ = z - r; out.maxZ = z + r;
  out.minY = y + y0; out.maxY = y + y1;
  return out;
}

const SKIN = 1e-3;
const _q = {};
const AX = { x: ['minX', 'maxX'], y: ['minY', 'maxY'], z: ['minZ', 'maxZ'] };

/**
 * Move pos (feet {x, y, z}) along one axis by delta against collide(), stopping
 * flush at the first solid. Keep |delta| <= r for x / z (the controllers substep),
 * so a thin wall can never be skipped. Mutates pos.
 * @returns {{moved:number, hit:boolean}}
 */
export function sweep(collide, pos, axis, delta, r, y0, y1) {
  if (!delta || !collide) {
    pos[axis] += delta || 0;
    return { moved: delta || 0, hit: false };
  }
  const start = pos[axis];
  const box = () => bodyBox(pos.x, pos.y, pos.z, r, y0, y1, _q);
  pos[axis] = start + delta;
  const res = collide(box());
  if (!isHit(res)) return { moved: delta, hit: false };
  let lim = null;
  if (Array.isArray(res)) {
    const [lo, hi] = AX[axis];
    const extPos = axis === 'y' ? y1 : r;   // body spans [p + extNeg, p + extPos] on this axis
    const extNeg = axis === 'y' ? y0 : -r;
    let best = start + delta;
    for (const b of res) {
      if (delta > 0) best = Math.min(best, b[lo] - extPos - SKIN);
      else best = Math.max(best, b[hi] - extNeg + SKIN);
    }
    lim = delta > 0 ? clamp(best, start, start + delta) : clamp(best, start + delta, start);
    pos[axis] = lim;
    if (lim !== start && isHit(collide(box()))) lim = null; // another solid in the way: bisect
  }
  if (lim === null) {
    let a = 0, b = 1;
    for (let i = 0; i < 12; i++) {
      const mid = (a + b) / 2;
      pos[axis] = start + delta * mid;
      if (isHit(collide(box()))) b = mid; else a = mid;
    }
    lim = start + delta * a;
  }
  pos[axis] = lim;
  return { moved: lim - start, hit: true };
}

/**
 * collide() for a fixed list of solid boxes (walls, crates, platforms).
 * @param {{minX:number,minY:number,minZ:number,maxX:number,maxY:number,maxZ:number}[]} boxes
 */
export function boxesCollider(boxes) {
  return (q) => {
    const hits = [];
    for (const b of boxes) if (overlaps(b, q)) hits.push(b);
    return hits;
  };
}

/**
 * groundHeight() for a list of boxes over a base floor: the highest box top
 * under (x, z) that is at or below maxY (the controllers pass feet + stepHeight).
 * @param {object[]} boxes
 * @param {number} [base=0]  floor height outside the boxes (-Infinity for a void)
 */
export function boxesGround(boxes, base = 0) {
  return (x, z, maxY = Infinity) => {
    let g = base;
    for (const b of boxes) {
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && b.maxY <= maxY + 1e-6 && b.maxY > g) g = b.maxY;
    }
    return g;
  };
}

/**
 * collide() for a tile map: cell (cx, cz) is centred at (cx * cellSize, cz * cellSize)
 * (the grid crawler's convention).
 * @param {(cx:number, cz:number)=>boolean} isSolid
 * @param {object} [o]
 * @param {number} [o.cellSize=2]
 * @param {number} [o.height=3]   wall height (from y = 0)
 */
export function gridCollider(isSolid, { cellSize = 2, height = 3 } = {}) {
  return (q) => {
    const hits = [];
    const x0 = Math.round(q.minX / cellSize), x1 = Math.round(q.maxX / cellSize);
    const z0 = Math.round(q.minZ / cellSize), z1 = Math.round(q.maxZ / cellSize);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        if (!isSolid(cx, cz)) continue;
        const b = { minX: (cx - 0.5) * cellSize, maxX: (cx + 0.5) * cellSize, minY: 0, maxY: height, minZ: (cz - 0.5) * cellSize, maxZ: (cz + 0.5) * cellSize };
        if (overlaps(b, q)) hits.push(b);
      }
    }
    return hits;
  };
}

/**
 * raycast() for a list of boxes (the camera rigs' wall pull-in): the distance
 * from `from` to the first box along the segment, or null.
 */
export function boxesRaycast(boxes) {
  return (from, to) => {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < EPS) return null;
    let best = null;
    for (const b of boxes) {
      const t = raySlab(from, dx, dy, dz, b);
      if (t !== null && t <= 1 && (best === null || t < best)) best = t;
    }
    return best === null ? null : best * len;
  };
}

function raySlab(o, dx, dy, dz, b) {
  let t0 = 0, t1 = Infinity;
  for (const [p, d, lo, hi] of [[o.x, dx, b.minX, b.maxX], [o.y, dy, b.minY, b.maxY], [o.z, dz, b.minZ, b.maxZ]]) {
    if (Math.abs(d) < EPS) { if (p < lo || p > hi) return null; continue; }
    let a = (lo - p) / d, c = (hi - p) / d;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return null;
  }
  return t0;
}

// ---------------------------------------------------------------- three.js adapter

/**
 * Put a pose on an Object3D (duck-typed: position.set and rotation.y).
 * @param {{position:{set:Function}, rotation:{y:number}}} obj
 * @param {{x:number,y:number,z:number,yaw:number}} pose
 * @param {number} [yawOffset=0]  added to yaw (a model that does not face +Z)
 */
export function applyPose(obj, pose, yawOffset = 0) {
  obj.position.set(pose.x, pose.y, pose.z);
  obj.rotation.y = pose.yaw + yawOffset;
  return obj;
}

/** interpolate two poses for rendering (alpha from the loop's render) */
export function lerpPose(a, b, alpha, out = {}) {
  out.x = lerp(a.x, b.x, alpha);
  out.y = lerp(a.y, b.y, alpha);
  out.z = lerp(a.z, b.z, alpha);
  out.yaw = lerpAngle(a.yaw, b.yaw, alpha);
  return out;
}
