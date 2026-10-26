// topdown.js — 8-way top-down movement with acceleration, wall sliding and
// an optional dash. Pure logic: no DOM.
//
//   const hero = createTopDown({ world, x: 40, y: 40, dash: true });
//   function update(dt) {
//     hero.step(intentFromInput(input), dt);
//     for (const e of hero.events) if (e.type === 'dashed') camera.shake(0.2);
//     game.state.player = { x: hero.state.x, y: hero.state.y, dir: hero.state.angle };
//   }
//
// state: { x, y, w, h (top-left AABB), vx, vy, facing {x, y} (unit), angle (radians),
//          dashing, dashCooldown, moving }
// events: dashed {dirX, dirY}, dashready, bumped {side: 'x'|'y'}, stepped
//
// The world is optional: without one the body moves freely, clamped to
// `bounds` ({x, y, w, h}) when given.

import { moveAndCollide, cornerSlip } from './collide.js';
import { clamp, createEvents, readIntent, withDefaults } from './common.js';

export const TOPDOWN_DEFAULTS = {
  x: 0, y: 0, w: 12, h: 12,
  maxSpeed: 120,           // px/s
  accel: 2000,             // full speed in 60 ms (a stick nudge ~ a key tap)
  friction: 1800,          // stop from full speed in ~0.07 s (~4 px): no sliding after release
  turnBoost: 1.5,          // extra acceleration when reversing
  deadzone: 0.05,
  cornerCorrection: 5,     // px: slip around a wall corner instead of snagging
  dash: false,             // true or { speed, time, cooldown }
  dashSpeed: 340,
  dashTime: 0.14,
  dashCooldown: 0.5,
  dashEndSpeed: 0.5,       // speed kept after a dash, as a share of maxSpeed
  stepDistance: 16,
  bounds: null,            // { x, y, w, h } clamp (also works with a world)
};

export function createTopDown(o = {}) {
  const C = withDefaults(TOPDOWN_DEFAULTS, o);
  if (C.dash && typeof C.dash === 'object') {
    if (C.dash.speed) C.dashSpeed = C.dash.speed;
    if (C.dash.time) C.dashTime = C.dash.time;
    if (C.dash.cooldown !== undefined) C.dashCooldown = C.dash.cooldown;
  }
  const ev = createEvents(o.onEvent);
  let world = o.world || null;
  const s = {};
  let dashT = 0, dashX = 0, dashY = 0, stepAcc = 0, blockedX = false, blockedY = false;

  function reset(at) {
    Object.assign(s, {
      x: at?.x ?? C.x, y: at?.y ?? C.y, w: C.w, h: C.h, vx: 0, vy: 0,
      facing: { x: 0, y: 1 }, angle: Math.PI / 2, dashing: false, dashCooldown: 0, moving: false,
    });
    dashT = stepAcc = 0; blockedX = blockedY = false;
    ev.reset();
  }
  reset();

  function step(intent, dt) {
    ev.clear();
    if (!(dt > 0)) return;
    const I = readIntent(intent);
    let ix = I.moveX, iy = I.moveY;
    let m = Math.hypot(ix, iy);
    if (m < C.deadzone) { ix = iy = m = 0; } else if (m > 1) { ix /= m; iy /= m; m = 1; }
    if (m > 0) { s.facing = { x: ix / m, y: iy / m }; s.angle = Math.atan2(iy, ix); }

    // ---- dash
    const cdWas = s.dashCooldown;
    s.dashCooldown = Math.max(0, s.dashCooldown - dt);
    if (cdWas > 0 && s.dashCooldown === 0 && C.dash) ev.emit('dashready');
    if (C.dash && I.dash && !s.dashing && s.dashCooldown <= 0) {
      dashX = m > 0 ? ix / m : s.facing.x; dashY = m > 0 ? iy / m : s.facing.y;
      s.dashing = true; dashT = C.dashTime; s.dashCooldown = C.dashCooldown + C.dashTime;
      ev.emit('dashed', { dirX: dashX, dirY: dashY, x: s.x + s.w / 2, y: s.y + s.h / 2 });
      ev.act('dash');
    }

    if (s.dashing) {
      s.vx = dashX * C.dashSpeed; s.vy = dashY * C.dashSpeed;
      dashT -= dt;
      if (dashT <= 0) {
        s.dashing = false;
        s.vx = dashX * C.maxSpeed * C.dashEndSpeed; s.vy = dashY * C.maxSpeed * C.dashEndSpeed;
      }
    } else {
      // ---- acceleration toward the stick's velocity, as a vector
      const tx = ix * C.maxSpeed, ty = iy * C.maxSpeed;
      const dvx = tx - s.vx, dvy = ty - s.vy;
      const d = Math.hypot(dvx, dvy);
      let rate = m > 0 ? C.accel : C.friction;
      if (m > 0 && s.vx * tx + s.vy * ty < 0) rate *= C.turnBoost;
      const maxDv = rate * dt;
      if (d <= maxDv || d === 0) { s.vx = tx; s.vy = ty; } else { s.vx += (dvx / d) * maxDv; s.vy += (dvy / d) * maxDv; }
    }

    // ---- move: per axis, so a blocked axis slides along the wall
    const x0 = s.x, y0 = s.y;
    let hitX = false, hitY = false;
    if (world) {
      const r = moveAndCollide(s, s.vx * dt, s.vy * dt, world);
      hitX = r.hitX; hitY = r.hitY;
      // pushing straight into a corner: slip past it
      if (C.cornerCorrection > 0) {
        if (hitX && Math.abs(iy) < 0.2 && m > 0) cornerSlip(s, 'x', Math.sign(s.vx), world, C.cornerCorrection);
        if (hitY && Math.abs(ix) < 0.2 && m > 0) cornerSlip(s, 'y', Math.sign(s.vy), world, C.cornerCorrection);
      }
      if (hitX) s.vx = 0;
      if (hitY) s.vy = 0;
    } else {
      s.x += s.vx * dt; s.y += s.vy * dt;
    }
    if (C.bounds) {
      const b = C.bounds;
      const nx = clamp(s.x, b.x, b.x + b.w - s.w), ny = clamp(s.y, b.y, b.y + b.h - s.h);
      if (nx !== s.x) { s.x = nx; s.vx = 0; hitX = true; }
      if (ny !== s.y) { s.y = ny; s.vy = 0; hitY = true; }
    }
    if (hitX && !blockedX && m > 0) { ev.emit('bumped', { side: 'x', x: s.x, y: s.y }); ev.act('bump'); }
    if (hitY && !blockedY && m > 0) { ev.emit('bumped', { side: 'y', x: s.x, y: s.y }); ev.act('bump'); }
    blockedX = hitX; blockedY = hitY;

    const moved = Math.hypot(s.x - x0, s.y - y0);
    s.moving = moved > 1e-4;
    stepAcc += moved;
    if (stepAcc >= C.stepDistance) { stepAcc = 0; ev.emit('stepped', { x: s.x + s.w / 2, y: s.y + s.h }); ev.act('walk'); }
    if (![s.x, s.y, s.vx, s.vy].every(Number.isFinite)) reset();
  }

  return {
    state: s,
    get events() { return ev.events; },
    step,
    reset,
    lastAction: () => ev.last(),
    setWorld(w) { world = w; },
    teleport(x, y) { s.x = x; s.y = y; s.vx = s.vy = 0; },
    /** an outside push (knockback): adds velocity, friction brings it back */
    push(vx, vy) { s.vx += vx; s.vy += vy; },
    center: () => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 }),
    options: C,
  };
}
