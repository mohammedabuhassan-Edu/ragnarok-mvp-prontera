// platformer.js — a side-view platformer body: run, jump, fall, land.
// Pure logic: no DOM. The game owns the world and draws the player.
//
//   const world = tileWorld(level.rows, { tileSize: 16 });
//   const hero = createPlatformer({ world, x: 32, y: 100 });
//   function update(dt) {
//     hero.step(intentFromInput(input), dt);
//     for (const e of hero.events) if (e.type === 'jumped') audio.sfx('jump');
//     game.state.player = { x: hero.state.x, y: hero.state.y, facing: hero.state.facing };
//   }
//   game.lastAction = hero.lastAction;
//
// state: { x, y, w, h (top-left AABB), vx, vy, onGround, onOneWay, facing (-1|1),
//          wallDir (-1|0|1 touching a wall), wallSliding, jumping, airJumpsLeft,
//          look (-1 up, 0, 1 down: lookUpDown), ducking (down held on the ground) }
// events: jumped, airjumped, walljumped, landed {vy}, bumped {side}, headbumped,
//         stepped (a footstep every stepDistance on the ground), dropped (through a one-way),
//         look {dir} (up / down pressed or let go; lastAction 'look-up' / 'duck')
//
// Look up / duck: move the camera with it (camera2d options change live):
//   cam.options.offset.y = baseOffsetY + hero.state.look * 48;
// and draw the duck frame while hero.state.ducking.
//
// Tuned for 16 px tiles at 60 steps/s (createLoop's default). Scale every
// speed by tileSize / 16 for other tile sizes (or pass `scale`).

import { moveAndCollide, probe, cornerSlip } from './collide.js';
import { approach, createEvents, readIntent, sign, withDefaults } from './common.js';

export const PLATFORMER_DEFAULTS = {
  x: 0, y: 0, w: 12, h: 14,
  scale: 1,                // multiplies every speed/acceleration (tileSize / 16)
  maxSpeed: 140,           // px/s
  accel: 2600,             // ground acceleration: full speed in ~55 ms (a stick nudge ~ a key tap)
  turnAccel: 3600,         // when reversing direction
  friction: 2600,          // ground deceleration with no input: 140 px/s stops in ~4 px
  airAccel: 1100,
  airFriction: 450,        // in the air with no input (keeps a little momentum)
  gravity: 1800,
  fallGravityMul: 1.2,     // a little heavier on the way down
  maxFall: 560,            // terminal velocity
  jumpSpeed: 470,          // full hold: ~4 tiles high
  jumpCut: 0.45,           // release early: vy *= jumpCut (a tap: ~2 tiles)
  minJumpTime: 0.05,       // the cut never happens sooner than this
  apexHang: true,          // softer gravity near the top while jump is held
  apexThreshold: 60,
  apexGravityMul: 0.5,
  coyoteTime: 0.1,         // jump still works this long after walking off a ledge
  jumpBuffer: 0.12,        // a press this long before landing still jumps
  airJumps: 0,             // 1 = double jump
  airJumpSpeed: 400,
  wallSlide: false,
  wallSlideSpeed: 70,
  wallJump: false,
  wallJumpX: 190,
  wallJumpY: 440,
  wallJumpLock: 0.14,      // seconds of reduced control after a wall jump
  dropThrough: true,       // down + jump on a one-way platform drops through it
  cornerCorrection: 4,     // px: slip past a ceiling corner instead of bonking
  deadzone: 0.05,
  stepDistance: 14,        // px between 'stepped' events
  lookUpDown: true,        // up = look up, down = duck: state.look -1 / 0 / 1, state.ducking (on the ground),
                           // a 'look' event and lastAction 'look-up' / 'duck', so verify sees up / down answer.
                           // false: up / down do nothing (then use layoutFor('platformer', { lookUpDown: false }))
  lookThreshold: 0.5,      // |moveY| that counts as up / down
};

/**
 * @param {object} o  PLATFORMER_DEFAULTS overrides plus:
 * @param {object} o.world  { tileSize, solidAt, oneWayAt?, boxes? } (see collide.js)
 * @param {(e:object)=>void} [o.onEvent]
 */
export function createPlatformer(o = {}) {
  const C = withDefaults(PLATFORMER_DEFAULTS, o);
  const k = C.scale;
  const ev = createEvents(o.onEvent);
  let world = o.world || null;
  const s = {};
  let coyote = 0, buffer = 0, jumpTime = 0, cut = false, lock = 0, dropT = 0, wallCoyote = 0, lastWall = 0, stepAcc = 0;

  function reset(at) {
    Object.assign(s, {
      x: at?.x ?? C.x, y: at?.y ?? C.y, w: C.w, h: C.h, vx: 0, vy: 0,
      onGround: false, onOneWay: false, facing: 1, wallDir: 0, wallSliding: false, jumping: false,
      airJumpsLeft: C.airJumps, look: 0, ducking: false,
    });
    coyote = buffer = jumpTime = lock = dropT = wallCoyote = stepAcc = 0;
    cut = false; lastWall = 0;
    ev.reset();
  }
  reset();

  function startJump(vy, type, extra) {
    s.vy = -vy * k;
    s.onGround = false; s.jumping = true;
    coyote = 0; buffer = 0; jumpTime = 0; cut = false;
    ev.emit(type, { x: s.x + s.w / 2, y: s.y + s.h, ...extra });
    ev.act(type === 'jumped' ? 'jump' : type.replace('ed', ''));
  }

  function step(intent, dt) {
    ev.clear();
    if (!(dt > 0) || !world) return;
    const I = readIntent(intent);
    const mx = Math.abs(I.moveX) < C.deadzone ? 0 : I.moveX;

    // ---- timers
    coyote = s.onGround ? C.coyoteTime : coyote - dt;
    buffer = I.jump ? C.jumpBuffer : buffer - dt;
    lock = Math.max(0, lock - dt);
    dropT = Math.max(0, dropT - dt);
    if (s.jumping) jumpTime += dt;

    // ---- walls (only matter in the air)
    s.wallDir = 0;
    if ((C.wallSlide || C.wallJump) && !s.onGround) {
      if (probe(s, 1, 0, world)) s.wallDir = 1;
      else if (probe(s, -1, 0, world)) s.wallDir = -1;
    }
    if (s.wallDir) { lastWall = s.wallDir; wallCoyote = C.wallJumpLock; } else wallCoyote = Math.max(0, wallCoyote - dt);

    // ---- horizontal
    const target = mx * C.maxSpeed * k;
    let rate;
    if (mx !== 0) {
      const turning = s.vx !== 0 && sign(s.vx) !== sign(mx);
      rate = s.onGround ? (turning ? C.turnAccel : C.accel) : C.airAccel;
      if (lock > 0) rate *= 0.35;
      s.facing = mx > 0 ? 1 : -1;
    } else rate = s.onGround ? C.friction : C.airFriction;
    s.vx = approach(s.vx, target, rate * k * dt);

    // ---- jump: ground / coyote, drop-through, wall, air
    if (buffer > 0) {
      const canGround = s.onGround || coyote > 0;
      if (canGround && C.dropThrough && s.onOneWay && I.moveY > 0.5) {
        dropT = 0.18; buffer = 0; s.onGround = false; coyote = 0;
        ev.emit('dropped', { x: s.x + s.w / 2, y: s.y + s.h }); ev.act('drop');
      } else if (canGround) {
        startJump(C.jumpSpeed, 'jumped');
      } else if (C.wallJump && (s.wallDir || wallCoyote > 0)) {
        const away = -(s.wallDir || lastWall);
        startJump(C.wallJumpY, 'walljumped', { side: -away });
        s.vx = away * C.wallJumpX * k; s.facing = away; lock = C.wallJumpLock;
      } else if (s.airJumpsLeft > 0) {
        s.airJumpsLeft--;
        startJump(C.airJumpSpeed, 'airjumped');
      }
    }

    // ---- variable height: release early to cut the jump
    if (s.jumping && s.vy < 0 && !I.jumpHeld && !cut && jumpTime >= C.minJumpTime) { s.vy *= C.jumpCut; cut = true; }

    // ---- gravity (velocity-Verlet: the same arc at 30, 60 or 144 steps/s)
    let g = C.gravity * k;
    if (s.vy > 0) g *= C.fallGravityMul;
    else if (C.apexHang && I.jumpHeld && s.jumping && Math.abs(s.vy) < C.apexThreshold * k) g *= C.apexGravityMul;
    const vy0 = s.vy;
    let vy1 = Math.min(vy0 + g * dt, C.maxFall * k);
    s.wallSliding = false;
    if (C.wallSlide && s.wallDir && vy1 > 0 && sign(mx) === s.wallDir) {
      vy1 = Math.min(vy1, C.wallSlideSpeed * k);
      s.wallSliding = true;
    }
    s.vy = vy1;
    const dy = ((vy0 + vy1) / 2) * dt;

    // ---- move
    const wasGround = s.onGround;
    const vxBefore = s.vx;
    const x0 = s.x;
    const r = moveAndCollide(s, s.vx * dt, dy, world, { dropThrough: dropT > 0 });
    if (r.hitX) {
      if (Math.abs(vxBefore) > 40 * k) { ev.emit('bumped', { side: r.right ? 1 : -1, x: s.x, y: s.y }); }
      s.vx = 0;
    }
    if (r.bottom) {
      s.onOneWay = r.oneWay;
      if (!wasGround) {
        ev.emit('landed', { vy: vy1, x: s.x + s.w / 2, y: s.y + s.h });
        ev.act('land');
      }
      s.onGround = true; s.jumping = false; s.vy = 0; s.airJumpsLeft = C.airJumps;
    } else {
      s.onGround = false; s.onOneWay = false;
    }
    if (r.top) {
      // a ceiling corner: slip around it instead of losing the jump
      if (!(C.cornerCorrection > 0 && cornerSlip(s, 'y', -1, world, C.cornerCorrection))) {
        s.vy = 0;
        ev.emit('headbumped', { x: s.x + s.w / 2, y: s.y });
      }
    }
    if (s.onGround && Math.abs(s.x - x0) > 0) {
      stepAcc += Math.abs(s.x - x0);
      if (stepAcc >= C.stepDistance * k) { stepAcc = 0; ev.emit('stepped', { x: s.x + s.w / 2, y: s.y + s.h }); ev.act(s.vx > 0 ? 'run-right' : 'run-left'); }
    }

    // ---- look up / duck (up / down have a job, so they are never dead controls)
    if (C.lookUpDown) {
      const th = C.lookThreshold;
      const look = I.moveY < -th ? -1 : I.moveY > th ? 1 : 0;
      if (look !== s.look) {
        s.look = look;
        ev.emit('look', { dir: look, x: s.x + s.w / 2, y: s.y });
        if (look) ev.act(look < 0 ? 'look-up' : 'duck');
      }
      s.ducking = look > 0 && s.onGround;
    }
    if (![s.x, s.y, s.vx, s.vy].every(Number.isFinite)) reset(); // NaN guard
  }

  return {
    state: s,
    get events() { return ev.events; },
    step,
    reset,
    lastAction: () => ev.last(),
    /** swap the world (a new level) */
    setWorld(w) { world = w; },
    /** move without velocity changes (respawn, door) */
    teleport(x, y) { s.x = x; s.y = y; s.vx = 0; s.vy = 0; },
    /** a spring, a stomp bounce: vy = -speed */
    bounce(speed) { s.vy = -Math.abs(speed) * k; s.onGround = false; s.jumping = true; cut = true; jumpTime = 0; },
    center: () => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 }),
    feet: () => ({ x: s.x + s.w / 2, y: s.y + s.h }),
    options: C,
  };
}
