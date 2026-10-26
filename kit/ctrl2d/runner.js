// runner.js — an auto-runner: lanes (switch with a tween) or free side-view
// running, plus jump, slide and a speed ramp. Pure logic: no DOM.
//
// mode 'lanes' (a lane runner seen from behind or above):
//   lane      0..lanes-1, laneX the lateral position (tweened, 0 = the middle lane)
//   z         jump height above the ground (>= 0)
//   distance  how far the runner has gone (spawn obstacles ahead of it)
// mode 'free' (a side-view auto-runner):
//   x, y      top-left of the body (screen axes, +y down), x grows with speed
//   the ground: `world` (a tile world, see collide.js) or groundAt(x) -> ground top y | null (a pit)
//
//   const run = createRunner({ mode: 'lanes', lanes: 3 });
//   function update(dt) {
//     run.step(intentFromInput(input), dt);       // left/right switch lanes, jump, down/special slides
//     for (const e of run.events) if (e.type === 'jumped') audio.sfx('jump');
//     const b = run.box();                        // the current hitbox, for the game's obstacle checks
//     game.state.player = { x: run.state.laneX, y: run.state.distance, z: run.state.z };
//   }
//
// events: lanechanged {lane, from}, bumped {dir} (no lane that way), jumped, landed,
//         slid, slideend, fell (free mode, below fallY), crashed (free mode, hit a wall), stumbled
//
// Respawn after a pit (free mode): on 'fell', run.reset({ x: lastSafeX, distance: run.state.distance }).
// Touch layout: layoutFor('runner') has the lane buttons; layoutFor('runner', { mode: 'free' }) only JUMP + SLIDE.

import { moveAndCollide, overlapsWorld } from './collide.js';
import { clamp, createDigital, createEvents, readIntent, smoothstep, withDefaults } from './common.js';

export const RUNNER_DEFAULTS = {
  mode: 'lanes',
  lanes: 3,
  laneWidth: 48,
  startLane: null,         // null: the middle lane
  laneTime: 0.14,          // s for a lane switch tween
  speed: 220,              // px/s at the start
  maxSpeed: 480,
  ramp: 6,                 // px/s gained per second
  gravity: 2200,
  jumpSpeed: 680,          // ~105 px high
  jumpCut: 0.5,            // free mode: release early for a lower jump
  minJumpTime: 0.06,
  coyoteTime: 0.08,
  jumpBuffer: 0.12,
  fastFall: 2600,          // down / slide in the air pulls the runner down fast
  slideTime: 0.55,
  w: 24, h: 40, slideH: 18,
  x: 0, y: 0,              // free mode start (top-left)
  groundY: 0,              // free mode without world/groundAt: a flat ground at this y
  fallY: Infinity,         // free mode: below this the runner 'fell'
  on: 0.5, off: 0.3,       // stick thresholds for lane switches and swipes
};

export function createRunner(o = {}) {
  const C = withDefaults(RUNNER_DEFAULTS, o);
  const ev = createEvents(o.onEvent);
  const world = o.world || null;
  const groundAt = typeof o.groundAt === 'function' ? o.groundAt : null;
  const digX = createDigital(C.on, C.off), digY = createDigital(C.on, C.off);
  const s = {};
  let tw = null, prevDX = 0, prevDY = 0, coyote = 0, buffer = 0, jumpT = 0, cut = false;

  const laneCenter = (i) => (i - (C.lanes - 1) / 2) * C.laneWidth;

  /**
   * Start over, or respawn at a place (like the other controllers' reset(at)):
   *   run.reset()                                          // the start: C.x / C.y / startLane, speed C.speed, distance 0
   *   run.reset({ x: safeX, distance: run.state.distance, speed: run.state.speed * 0.8 })   // back on the track after a pit
   * @param {{x?:number, y?:number, lane?:number, speed?:number, distance?:number}} [at]
   *   free mode: x (top-left); y defaults to standing on the ground under x (groundY, or groundAt
   *   when it has ground there), or C.y with a tile world; lanes mode: lane. speed and distance
   *   default to a fresh run's.
   */
  function reset(at) {
    const lane = clamp(Math.round(at?.lane ?? C.startLane ?? Math.floor((C.lanes - 1) / 2)), 0, Math.max(0, C.lanes - 1));
    const x = at?.x ?? C.x;
    Object.assign(s, {
      lane, laneX: laneCenter(lane), z: 0, vz: 0,
      x, y: at?.y ?? C.y, vy: 0,
      speed: clamp(at?.speed ?? C.speed, 0, C.maxSpeed), distance: at?.distance ?? 0,
      onGround: true, sliding: false, slideT: 0, jumping: false, alive: true,
    });
    if (C.mode === 'free' && at?.y === undefined) {
      if (!world && !groundAt) s.y = C.groundY - C.h;
      else if (groundAt && at) { const gy = groundAt(x + C.w / 2); if (Number.isFinite(gy)) s.y = gy - C.h; }
    }
    tw = null; prevDX = prevDY = 0; coyote = buffer = jumpT = 0; cut = false;
    digX.reset(); digY.reset();
    ev.reset();
  }
  reset();

  const curH = () => (s.sliding ? C.slideH : C.h);

  function startSlide() {
    if (s.sliding) { s.slideT = C.slideTime; return; }
    s.sliding = true; s.slideT = C.slideTime;
    if (C.mode === 'free') s.y += C.h - C.slideH; // keep the feet on the ground
    ev.emit('slid', {}); ev.act('slide');
  }
  function endSlide() {
    if (!s.sliding) return;
    if (C.mode === 'free') {
      // stand up only if there is head room
      const upY = s.y - (C.h - C.slideH);
      if (world && overlapsWorld({ x: s.x, y: upY, w: C.w, h: C.h - C.slideH }, world)) return;
      s.y = upY;
    }
    s.sliding = false; s.slideT = 0;
    ev.emit('slideend', {});
  }
  function jump() {
    if (s.sliding) endSlide();
    if (s.sliding) return false;
    s.onGround = false; s.jumping = true; coyote = 0; buffer = 0; jumpT = 0; cut = false;
    if (C.mode === 'lanes') s.vz = C.jumpSpeed; else s.vy = -C.jumpSpeed;
    ev.emit('jumped', {}); ev.act('jump');
    return true;
  }

  function stepLanes(I, dx, dy, dt) {
    // lane switch on a new left/right press (keys, a stick flick or a swipe)
    if (dx && dx !== prevDX) {
      const to = s.lane + dx;
      if (to < 0 || to >= C.lanes) { ev.emit('bumped', { dir: dx }); ev.act('bump'); } else {
        const from = s.lane;
        s.lane = to;
        tw = { t: 0, from: s.laneX, to: laneCenter(to) }; // retargets from where it is now
        ev.emit('lanechanged', { lane: to, from }); ev.act(dx > 0 ? 'lane-right' : 'lane-left');
      }
    }
    if (tw) {
      tw.t += dt;
      s.laneX = tw.from + (tw.to - tw.from) * smoothstep(C.laneTime > 0 ? tw.t / C.laneTime : 1);
      if (tw.t >= C.laneTime) { s.laneX = tw.to; tw = null; }
    }
    // vertical: jump / slide
    if (buffer > 0 && (s.onGround || coyote > 0)) jump();
    if ((I.special || (dy > 0 && dy !== prevDY)) && !I.jump) {
      if (s.onGround) startSlide(); else s.vz = Math.min(s.vz, 0);
    }
    const g = C.gravity + (!s.onGround && (dy > 0 || I.specialHeld) ? C.fastFall : 0);
    if (!s.onGround) {
      const v0 = s.vz;
      s.vz -= g * dt;
      s.z += ((v0 + s.vz) / 2) * dt;
      if (s.z <= 0) { s.z = 0; s.vz = 0; s.onGround = true; s.jumping = false; ev.emit('landed', {}); ev.act('land'); if (dy > 0 || I.specialHeld) startSlide(); }
    }
  }

  function stepFree(I, dx, dy, dt) {
    if (buffer > 0 && (s.onGround || coyote > 0)) jump();
    if (s.jumping && s.vy < 0 && !I.jumpHeld && !cut && jumpT >= C.minJumpTime) { s.vy *= C.jumpCut; cut = true; }
    if ((I.special || (dy > 0 && dy !== prevDY)) && !I.jump && s.onGround) startSlide();
    const g = C.gravity + (!s.onGround && (dy > 0 || I.specialHeld) ? C.fastFall : 0);
    const v0 = s.vy;
    s.vy = Math.min(v0 + g * dt, 1500);
    const ddy = ((v0 + s.vy) / 2) * dt;
    const ddx = s.speed * dt;
    const was = s.onGround;
    const body = { x: s.x, y: s.y, w: C.w, h: curH() };
    let landed = false;
    if (world) {
      const r = moveAndCollide(body, ddx, ddy, world);
      if (r.hitX) { ev.emit('crashed', { x: body.x, y: body.y }); ev.act('crash'); s.speed = 0; }
      if (r.bottom) landed = true;
      if (r.top) s.vy = 0;
    } else {
      body.x += ddx; body.y += ddy;
      const gy = groundAt ? groundAt(body.x + body.w / 2) : C.groundY;
      const prevBottom = s.y + curH();
      if (gy !== null && gy !== undefined && s.vy >= 0 && prevBottom <= gy + 0.5 && body.y + body.h >= gy) { body.y = gy - body.h; landed = true; }
    }
    s.x = body.x; s.y = body.y;
    if (landed) {
      s.vy = 0; s.onGround = true;
      if (!was) { s.jumping = false; ev.emit('landed', {}); ev.act('land'); }
    } else s.onGround = false;
    if (s.y > C.fallY && s.alive) { s.alive = false; ev.emit('fell', { x: s.x, y: s.y }); }
  }

  function step(intent, dt) {
    ev.clear();
    if (!(dt > 0)) return;
    const I = readIntent(intent);
    const dx = digX(I.moveX), dy = digY(I.moveY);
    coyote = s.onGround ? C.coyoteTime : coyote - dt;
    const swipeUp = dy < 0 && dy !== prevDY;
    buffer = I.jump || swipeUp ? C.jumpBuffer : buffer - dt;
    if (s.jumping) jumpT += dt;
    if (s.sliding) { s.slideT -= dt; if (s.slideT <= 0) endSlide(); }

    s.speed = Math.min(C.maxSpeed, s.speed + C.ramp * dt);
    if (C.mode === 'lanes') { s.distance += s.speed * dt; stepLanes(I, dx, dy, dt); } else {
      const x0 = s.x;
      stepFree(I, dx, dy, dt);
      s.distance += s.x - x0;
    }
    prevDX = dx; prevDY = dy;
  }

  return {
    state: s,
    get events() { return ev.events; },
    step,
    reset,
    lastAction: () => ev.last(),
    /** the current hitbox: lanes {x: lateral, z, w, h} (z = bottom height); free {x, y, w, h} */
    box: () => (C.mode === 'lanes'
      ? { x: s.laneX - C.w / 2, z: s.z, w: C.w, h: curH() }
      : { x: s.x, y: s.y, w: C.w, h: curH() }),
    /** an obstacle clipped the runner: lose some speed */
    stumble(loss = 0.3) { s.speed = clamp(s.speed * (1 - loss), 0, C.maxSpeed); ev.emit('stumbled', {}); },
    laneCenter,
    options: C,
  };
}
