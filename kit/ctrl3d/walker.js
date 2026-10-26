// ctrl3d/walker.js — continuous walking (third or first person), and the core
// of the 3D platformer and the top-down mover.
//
//   accelerates and decelerates (no sliding after release: decel is a brake),
//   turns to face the move direction ('turn') or keeps facing the view ('strafe'),
//   gravity, grounding on the game's groundHeight, a slope limit and step-up,
//   walls through the game's collide (the capsule as an AABB) with sliding,
//   jump with coyote time and a jump buffer.
//
//   const hero = createWalker({
//     groundHeight: (x, z, maxY) => terrain(x, z),
//     collide: boxesCollider(walls),          // or (aabb) => true / false
//     start: { x: 0, z: 0, yaw: 0 },
//   });
//   const cam = thirdPersonOrbit({ raycast: boxesRaycast(walls) });
//   // update(dt):
//   //   const intent = intentFromInput(input);
//   //   intent.viewYaw = cam.yaw;               // 'view' frame: stick up = away from the camera
//   //   hero.step(intent, dt);
//   //   cam.orbit(intent.lookX, intent.lookY);
//   //   game.state.player = hero.state;
//   // render(alpha, frameDt): hero.apply(heroRoot, alpha); cam.update(hero.pose(alpha), frameDt); cam.apply(camera);
//
// Speeds are metres per second and every number is per second, so it plays the
// same at any frame rate (the Kit loop's fixed step is 1/60 s).

import { createRecorder, clamp, wrapAngle, approach2, sweep, applyPose, lerpPose, DEG, fwdX, fwdZ, rightX, rightZ } from './common.js';

/**
 * @typedef {object} WalkerOptions
 * @property {number} [speed=4.5]       walk speed (m/s)
 * @property {number} [runSpeed=7.5]    speed while intent.boost is held
 * @property {number} [accel=35]        m/s² toward the wanted velocity while there is input
 * @property {number} [decel=45]        m/s² braking with no input (or reversing): the stop distance is speed² / (2 · decel)
 * @property {number} [airControl=0.35] fraction of accel / decel in the air
 * @property {'turn'|'strafe'} [mode='turn']  'turn': face the move direction (third person);
 *   'strafe': keep facing, moveX strafes, intent.turn and drag-look turn (first person)
 * @property {'view'|'facing'|'world'} [moveFrame]  what "forward" means: 'view' = intent.viewYaw (the camera,
 *   see the rigs' .yaw), 'facing' = the body's yaw, 'world' = +Z. Default: 'view' for mode 'turn', 'facing' for 'strafe'
 * @property {number} [turnSpeed=12]    rad/s the body turns toward the move direction (mode 'turn')
 * @property {number} [turnRate=2.6]    rad/s for intent.turn (mode 'strafe')
 * @property {number} [lookSensitivity=0.005]  rad per drag pixel (intent.lookX / lookY) in mode 'strafe'
 * @property {number} [pitchLimit=1.2]  rad up / down for the first-person pitch (state.pitch)
 * @property {boolean} [eightWay=false] snap the move direction to 8 directions (top-down)
 * @property {number} [radius=0.35]     body half-width (the capsule as a square AABB)
 * @property {number} [height=1.8]      body height (feet to head)
 * @property {number} [stepHeight=0.35] climbs ledges / stairs this high; also the snap-down distance
 * @property {number} [slopeLimit=50]   degrees: steeper ground cannot be walked up
 * @property {number} [gravity=26]      m/s² (0 = no gravity: stays on groundHeight)
 * @property {number} [fallGravityScale=1]  extra gravity while falling (platformer feel)
 * @property {number} [maxFallSpeed=40]
 * @property {boolean} [canJump=true]
 * @property {number} [jumpSpeed=8]     m/s up at take-off (apex = jumpSpeed² / (2 · gravity))
 * @property {number} [coyoteTime=0.1]  s after walking off a ledge that a jump still works
 * @property {number} [jumpBuffer=0.12] s a jump pressed before landing is kept
 * @property {number} [airJumps=0]      extra jumps in the air (1 = double jump)
 * @property {number} [airJumpSpeed]    take-off speed of an air jump (default jumpSpeed)
 * @property {number} [jumpCut=1]       on releasing jump while rising, vy *= jumpCut (variable height; 1 = off)
 * @property {number} [ledgeAssist=0]   m: in the air, a wall whose top is this close above the feet is climbed onto
 * @property {(x:number, z:number, maxY:number)=>number} [groundHeight]  floor height under (x, z), the highest one
 *   at or below maxY (feet + stepHeight); -Infinity = a pit. Default: flat floor at 0
 * @property {(aabb:object)=>boolean|object[]} [collide]  walls: true / the overlapping boxes when aabb is blocked.
 *   The query box spans feet + stepHeight to the head, so low steps are left to groundHeight
 * @property {{x?:number, y?:number, z?:number, yaw?:number}} [start]  y defaults to the ground
 * @property {(e:object)=>void} [onEvent]
 */
export const WALKER_DEFAULTS = Object.freeze({
  speed: 4.5, runSpeed: 7.5, accel: 35, decel: 45, airControl: 0.35,
  mode: 'turn', moveFrame: null, turnSpeed: 12, turnRate: 2.6, lookSensitivity: 0.005, pitchLimit: 1.2,
  eightWay: false, radius: 0.35, height: 1.8, stepHeight: 0.35, slopeLimit: 50,
  gravity: 26, fallGravityScale: 1, maxFallSpeed: 40,
  canJump: true, jumpSpeed: 8, coyoteTime: 0.1, jumpBuffer: 0.12, airJumps: 0, airJumpSpeed: null, jumpCut: 1, ledgeAssist: 0,
  groundHeight: null, collide: null, start: null, onEvent: null,
});

/** @param {WalkerOptions} [o] */
export function createWalker(o = {}) {
  const opt = { ...WALKER_DEFAULTS, ...o };
  const kind = o.kind || 'walker';
  const ground = (x, z, maxY) => {
    const g = opt.groundHeight ? opt.groundHeight(x, z, maxY) : 0;
    return Number.isFinite(g) || g === -Infinity ? g : 0;
  };
  const rec = createRecorder(opt.onEvent);
  const state = {
    x: 0, y: 0, z: 0, yaw: 0, angle: 0, pitch: 0,
    vx: 0, vy: 0, vz: 0, speed: 0, grounded: true, groundY: 0,
    jumping: false, airJumpsLeft: 0, moving: false, wall: false, dir8: 0,
    coyote: 0, buffer: 0,
    dead: false, hurt: false,     // set by the game (attachCharacter plays 'die' / 'hit'); reset() clears them
  };
  const prev = { x: 0, y: 0, z: 0, yaw: 0 };
  let viewYaw = 0;
  let lastAct = '';

  function reset(pose = opt.start || {}) {
    state.x = pose.x ?? 0;
    state.z = pose.z ?? 0;
    state.yaw = state.angle = pose.yaw ?? 0;
    state.pitch = 0;
    state.groundY = ground(state.x, state.z, (pose.y ?? Infinity));
    state.y = pose.y ?? (Number.isFinite(state.groundY) ? state.groundY : 0);
    state.vx = state.vy = state.vz = state.speed = 0;
    state.grounded = Number.isFinite(state.groundY) && state.y <= state.groundY + 1e-6;
    if (state.grounded) state.y = state.groundY;
    state.jumping = false; state.airJumpsLeft = opt.airJumps; state.moving = false; state.wall = false;
    state.coyote = 0; state.buffer = 0;
    // the game's own flags that attachCharacter reads: a retry must not keep playing the death / hurt clip
    state.dead = false; state.hurt = false;
    Object.assign(prev, { x: state.x, y: state.y, z: state.z, yaw: state.yaw });
    rec.reset();
  }

  const tanLimit = () => Math.tan(clamp(opt.slopeLimit, 1, 89) * DEG);

  // One horizontal axis move with walls, step-up and the slope limit. Returns true when blocked.
  const pos = { x: 0, y: 0, z: 0 };
  function moveAxis(axis, d) {
    if (!d) return false;
    pos.x = state.x; pos.y = state.y; pos.z = state.z;
    const r = sweep(opt.collide, pos, axis, d, opt.radius, opt.stepHeight, opt.height);
    let blocked = r.hit;
    if (blocked && opt.ledgeAssist > 0 && !state.grounded && state.vy < 2) {
      // ledge forgiveness: a wall top just above the feet: climb onto it
      const lift = { x: state.x, y: state.y + opt.ledgeAssist, z: state.z };
      const r2 = sweep(opt.collide, lift, axis, d, opt.radius, opt.stepHeight, opt.height);
      // the ledge is under the body's leading edge (its centre is still in front of it)
      const lead = (opt.radius + 0.05) * Math.sign(d);
      const top = Math.max(ground(lift.x, lift.z, lift.y + 1e-3), ground(lift.x + (axis === 'x' ? lead : 0), lift.z + (axis === 'z' ? lead : 0), lift.y + 1e-3));
      if (!r2.hit && top > state.y && top <= state.y + opt.ledgeAssist) {
        state.x = lift.x; state.z = lift.z; state.y = top; state.vy = 0;
        rec.emit('ledgeAssist', { top });
        return false;
      }
    }
    // the ground under the new spot: too high is a wall, too steep is a wall
    const g1 = ground(pos.x, pos.z, state.y + opt.stepHeight);
    const rise = g1 - state.y;
    if (Number.isFinite(g1) && g1 > state.y + opt.stepHeight + 1e-6) {
      blocked = true; pos[axis] = state[axis];
    } else if (state.grounded && Number.isFinite(g1) && rise > 1e-4) {
      // steep = the rise over this move AND the ground just ahead keep climbing (a stair top is flat)
      const dist = Math.abs(pos[axis] - state[axis]) || 1e-6;
      const e = 0.05 * Math.sign(d);
      const ax = axis === 'x' ? e : 0, az = axis === 'z' ? e : 0;
      const ahead = ground(pos.x + ax, pos.z + az, g1 + opt.stepHeight);
      const lim = tanLimit();
      if (rise / dist > lim && (ahead - g1) / Math.abs(e) > lim) { blocked = true; pos[axis] = state[axis]; }
    }
    state.x = pos.x; state.z = pos.z;
    return blocked;
  }

  /**
   * One fixed step.
   * @param {object} intent  intentFromInput(); optional intent.viewYaw (the camera yaw for moveFrame 'view')
   * @param {number} dt
   */
  function step(intent = {}, dt) {
    rec.begin(dt);
    prev.x = state.x; prev.y = state.y; prev.z = state.z; prev.yaw = state.yaw;
    if (intent.viewYaw !== undefined && intent.viewYaw !== null) viewYaw = intent.viewYaw;
    const s = state;
    const mode = opt.mode;
    const frame = opt.moveFrame || (mode === 'strafe' ? 'facing' : 'view');

    // ---- facing in strafe mode (first person): turn keys + drag-look
    if (mode === 'strafe') {
      s.yaw = wrapAngle(s.yaw - (intent.turn || 0) * opt.turnRate * dt - (intent.lookX || 0) * opt.lookSensitivity);
      s.pitch = clamp(s.pitch - (intent.lookY || 0) * opt.lookSensitivity, -opt.pitchLimit, opt.pitchLimit);
    }

    // ---- wanted velocity
    let mx = clamp((intent.moveX || 0) + (mode === 'strafe' ? (intent.strafe || 0) : 0), -1, 1);
    let my = clamp(intent.moveY || 0, -1, 1);
    let len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; len = 1; }
    if (opt.eightWay && len > 0.2) {
      const a = Math.round(Math.atan2(mx, my) / (Math.PI / 4)) * (Math.PI / 4);
      mx = Math.sin(a) * len; my = Math.cos(a) * len;
    }
    const fy = frame === 'world' ? 0 : frame === 'facing' ? s.yaw : viewYaw;
    const wx = fwdX(fy) * my + rightX(fy) * mx;
    const wz = fwdZ(fy) * my + rightZ(fy) * mx;
    const has = len > 0.05;
    if (mode === 'turn' && has) {
      const want = Math.atan2(wx, wz);
      const d = wrapAngle(want - s.yaw);
      const maxTurn = opt.turnSpeed * dt;
      s.yaw = wrapAngle(s.yaw + clamp(d, -maxTurn, maxTurn));
    }
    const top = intent.boost ? opt.runSpeed : opt.speed;
    const tx = wx * top, tz = wz * top;
    const reversing = has && s.vx * tx + s.vz * tz < 0;
    let rate = has ? (reversing ? Math.max(opt.accel, opt.decel) : opt.accel) : opt.decel;
    if (!s.grounded) rate *= opt.airControl;
    [s.vx, s.vz] = approach2(s.vx, s.vz, tx, tz, rate * dt);

    // ---- jump: coyote time and buffer
    s.coyote = s.grounded ? opt.coyoteTime : Math.max(0, s.coyote - dt);
    s.buffer = intent.jump ? opt.jumpBuffer : Math.max(0, s.buffer - dt);
    if (opt.canJump && s.buffer > 0) {
      if (s.grounded || s.coyote > 0) {
        s.vy = opt.jumpSpeed; s.grounded = false; s.jumping = true;
        s.coyote = 0; s.buffer = 0;
        rec.emit('jumped', { air: false });
        rec.act('jump'); lastAct = 'jump';
      } else if (intent.jump && s.airJumpsLeft > 0) {
        s.vy = opt.airJumpSpeed ?? opt.jumpSpeed; s.jumping = true; s.airJumpsLeft--;
        s.buffer = 0;
        rec.emit('jumped', { air: true, left: s.airJumpsLeft });
        rec.act('jump:air'); lastAct = 'jump';
      }
    }
    // variable height: let go while rising and the jump is cut (jumpHeld missing = held)
    if (s.jumping && s.vy > 0 && opt.jumpCut < 1 && intent.jumpHeld === false) {
      s.vy *= opt.jumpCut; s.jumping = false;
    }

    // ---- gravity
    if (!s.grounded && opt.gravity > 0) {
      const g = opt.gravity * (s.vy < 0 ? opt.fallGravityScale : 1);
      s.vy = Math.max(s.vy - g * dt, -opt.maxFallSpeed);
    }

    // ---- horizontal move: substeps no longer than the radius, so no wall is skipped
    const dx = s.vx * dt, dz = s.vz * dt;
    const n = Math.max(1, Math.min(64, Math.ceil(Math.hypot(dx, dz) / (opt.radius * 0.9))));
    let hitX = false, hitZ = false;
    for (let i = 0; i < n; i++) {
      if (!hitX && moveAxis('x', dx / n)) hitX = true;
      if (!hitZ && moveAxis('z', dz / n)) hitZ = true;
    }
    if (hitX) s.vx = 0;
    if (hitZ) s.vz = 0;
    const wall = hitX || hitZ;
    if (wall && !s.wall) rec.emit('bumped', { x: hitX, z: hitZ });
    s.wall = wall;

    // ---- vertical move
    const prevY = s.y;
    if (!s.grounded) {
      const dy = s.vy * dt;
      if (dy > 0 && opt.collide) {
        pos.x = s.x; pos.y = s.y; pos.z = s.z;
        const r = sweep(opt.collide, pos, 'y', dy, opt.radius, opt.stepHeight, opt.height);
        s.y = pos.y;
        if (r.hit) { s.vy = 0; s.jumping = false; rec.emit('bonked', {}); }
      } else s.y += dy;
    }
    const g = ground(s.x, s.z, Math.max(prevY, s.y) + opt.stepHeight);
    if (s.grounded) {
      if (Number.isFinite(g) && g >= s.y - opt.stepHeight - 1e-6 && g <= s.y + opt.stepHeight + 1e-6) {
        s.y = g; s.vy = 0;                          // walk on, step up, snap down slopes and stairs
      } else {
        s.grounded = false;                         // walked off a ledge: coyote time starts
        rec.emit('leftGround', {});
      }
    }
    if (!s.grounded && Number.isFinite(g) && s.y <= g + 1e-6 && s.vy <= 0) {
      const impact = -s.vy;
      s.y = g; s.vy = 0; s.grounded = true; s.jumping = false; s.airJumpsLeft = opt.airJumps;
      rec.emit('landed', { impact });
    }
    s.groundY = Number.isFinite(g) ? g : -Infinity;

    s.speed = Math.hypot(s.vx, s.vz);
    s.moving = s.speed > 0.05;
    s.angle = s.yaw;
    if (opt.eightWay) s.dir8 = ((Math.round(s.yaw / (Math.PI / 4)) % 8) + 8) % 8;
    if (has && lastAct !== 'move') { rec.act('move'); lastAct = 'move'; }
    if (!has && lastAct === 'move') lastAct = '';
    if (intent.action) { rec.act('action'); rec.emit('action', {}); }
    return s;
  }

  const _pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const api = {
    kind,
    expect: 'move',
    options: opt,
    state,
    get events() { return rec.events; },
    step,
    reset,
    lastAction: () => rec.lastAction(),
    /** the yaw 'view' movement is relative to (the camera); intent.viewYaw sets it too */
    setViewYaw(y) { viewYaw = y; },
    get viewYaw() { return viewYaw; },
    pose(alpha = 1) { return lerpPose(prev, state, alpha, _pose); },
    apply(obj, alpha = 1, yawOffset = 0) { return applyPose(obj, api.pose(alpha), yawOffset); },
    /** the body box (for frameCheck and hit tests) */
    box() {
      return { min: { x: state.x - opt.radius, y: state.y, z: state.z - opt.radius }, max: { x: state.x + opt.radius, y: state.y + opt.height, z: state.z + opt.radius } };
    },
  };
  reset(opt.start || {});
  return api;
}
