// ctrl3d/vehicle.js — an arcade kart / car.
//
//   throttle, brake then reverse, speed-dependent steering (full lock at low
//   speed, calmer at top speed), grip that bleeds the sideways slide away, a
//   drift (hold drift, or a long full-lock turn at speed) that charges a boost
//   in stages and fires it on release, off-track slowdown from the game's
//   surfaceAt(x, z), and walls through collide() with substeps so it never
//   tunnels through a wall, at any speed.
//
//   const kart = createVehicle({
//     collide: boxesCollider(barriers),
//     surfaceAt: (x, z) => (onTrack(x, z) ? 'track' : 'grass'),
//     start: { x: 0, z: 0, yaw: 0 },
//   });
//   const cam = followChase({ distance: 6.5, height: 2.6, lookAhead: 4, followVelocity: 0.6 });
//   // update(dt):
//   //   kart.step(intentFromInput(input, { drift: ['drift', 'jump'] }), dt);
//   //   for (const e of kart.events) if (e.type === 'drifted') fx.boostFlash(e.stage);
//   // render(alpha, frameDt): kart.apply(kartRoot, alpha); cam.update(kart.pose(alpha), frameDt); cam.apply(camera);
//
// Input: moveY > 0 (or intent.throttle) = gas, moveY < 0 or intent.brake = brake
// then reverse, moveX + intent.turn = steer (right +), intent.drift = drift.

import { createRecorder, clamp, wrapAngle, sweep, applyPose, lerpPose, fwdX, fwdZ, rightX, rightZ } from './common.js';

/**
 * surfaceAt() may return one of these names (or an object, or a number = speed factor).
 * speed multiplies the top speed, grip the sideways grip, drag is m/s² of extra slowdown;
 * boost (seconds) makes the surface a boost pad: driving on it acts like kick(boost), so the
 * car reaches boostSpeed and never more. The top speed is capped at boostSpeed on every
 * surface (a custom speed factor above 1 can not throw the car past it either).
 */
export const SURFACES = Object.freeze({
  track: { speed: 1, grip: 1, drag: 0 },
  road: { speed: 1, grip: 1, drag: 0 },
  kerb: { speed: 0.95, grip: 1, drag: 1 },
  grass: { speed: 0.55, grip: 0.75, drag: 5 },
  dirt: { speed: 0.7, grip: 0.7, drag: 3 },
  sand: { speed: 0.45, grip: 0.6, drag: 7 },
  ice: { speed: 1, grip: 0.15, drag: 0 },
  boost: { speed: 1, grip: 1, drag: 0, boost: 0.5 },
});

/**
 * @typedef {object} VehicleOptions
 * @property {number} [topSpeed=24]     m/s on track
 * @property {number} [accel=16]        m/s² at a standstill (fades toward topSpeed)
 * @property {number} [brake=32]        m/s² braking
 * @property {number} [reverseSpeed=7]  m/s top reverse
 * @property {number} [reverseAccel=10]
 * @property {number} [coastDrag=4]     m/s² slowdown with no pedal
 * @property {number} [steerRate=2.4]   rad/s yaw at full lock
 * @property {number} [steerRamp=5]     m/s for full steering (less when crawling)
 * @property {number} [steerFalloff=40] m/s: steering divides by (1 + speed / steerFalloff)
 * @property {number} [steerSmooth=10]  how fast the wheel follows the input (1/s)
 * @property {number} [grip=9]          1/s: how fast the sideways slide dies
 * @property {'hold'|'auto'|'both'|'off'} [driftMode='both']  'hold': while intent.drift; 'auto': a full-lock turn at speed
 * @property {number} [driftGrip=4]     grip while drifting (lower = a wider slide; the slip angle is about atan(yaw rate / driftGrip))
 * @property {number} [driftYaw=1]      steering multiplier while drifting
 * @property {number} [driftMinSpeed=9] m/s to start or keep a drift
 * @property {number} [autoDriftSteer=0.85]  |steer| that counts as full lock (auto drift)
 * @property {number} [autoDriftTime=0.3]    s of full lock at speed before an auto drift
 * @property {number[]} [driftStages=[0.5, 1.1, 1.8]]  s of drifting for boost stage 1, 2, 3
 * @property {number[]} [driftBoost=[0.5, 0.9, 1.4]]   boost seconds per stage on release
 * @property {number} [boostSpeed=32]   top speed while boosting; also the hard cap on every surface
 * @property {number} [boostAccel=30]   extra m/s² while boosting
 * @property {number} [radius=0.9]      the car's half-size (square AABB for walls)
 * @property {number} [height=1.2]
 * @property {number} [clearance=0.3]   the collide box starts this far above the ground
 * @property {number} [stepHeight=0.4]  kerbs it drives over; higher ground is a wall
 * @property {number} [bounce=0.25]     wall bounce (0..1 of the speed into the wall)
 * @property {number} [wallFriction=0.3] speed lost along the wall on a hard hit (0..1)
 * @property {number} [gravity=25]
 * @property {(x:number, z:number)=>string|number|{speed?:number,grip?:number,drag?:number,boost?:number}} [surfaceAt]
 *   the ground type under the car: a SURFACES name, a speed factor (1 = track), or an object
 * @property {Record<string, {speed:number,grip:number,drag:number,boost?:number}>} [surfaces]  extra / changed surface names
 * @property {(x:number, z:number, maxY:number)=>number} [groundHeight]  default flat 0
 * @property {(aabb:object)=>boolean|object[]} [collide]
 * @property {{x?:number, z?:number, yaw?:number, speed?:number}} [start]
 * @property {(e:object)=>void} [onEvent]
 */
export const VEHICLE_DEFAULTS = Object.freeze({
  topSpeed: 24, accel: 16, brake: 32, reverseSpeed: 7, reverseAccel: 10, coastDrag: 4,
  steerRate: 2.4, steerRamp: 5, steerFalloff: 40, steerSmooth: 10,
  grip: 9, driftMode: 'both', driftGrip: 4, driftYaw: 1, driftMinSpeed: 9,
  autoDriftSteer: 0.85, autoDriftTime: 0.3,
  driftStages: [0.5, 1.1, 1.8], driftBoost: [0.5, 0.9, 1.4],
  boostSpeed: 32, boostAccel: 30,
  radius: 0.9, height: 1.2, clearance: 0.3, stepHeight: 0.4, bounce: 0.25, wallFriction: 0.3,
  gravity: 25, surfaceAt: null, surfaces: null, groundHeight: null, collide: null, start: null, onEvent: null,
});

/** @param {VehicleOptions} [o] */
export function createVehicle(o = {}) {
  const opt = { ...VEHICLE_DEFAULTS, ...o };
  const rec = createRecorder(opt.onEvent);
  const surfaces = { ...SURFACES, ...(opt.surfaces || {}) };
  const ground = (x, z, maxY) => {
    const g = opt.groundHeight ? opt.groundHeight(x, z, maxY) : 0;
    return Number.isFinite(g) || g === -Infinity ? g : 0;
  };
  const state = {
    x: 0, y: 0, z: 0, yaw: 0, angle: 0,
    vx: 0, vy: 0, vz: 0, speed: 0, vf: 0, vl: 0, slip: 0, steer: 0,
    throttle: 0, braking: false, reversing: false,
    drifting: false, driftDir: 0, driftT: 0, driftStage: 0, driftBy: null, autoT: 0,
    boostT: 0, boosting: false,
    surface: 'track', offTrack: false, grounded: true, wall: false,
  };
  const prev = { x: 0, y: 0, z: 0, yaw: 0 };
  let lastAct = '';

  function surfaceInfo(x, z) {
    if (!opt.surfaceAt) return ['track', surfaces.track];
    const v = opt.surfaceAt(x, z);
    if (typeof v === 'string') return [v, surfaces[v] || surfaces.track];
    if (typeof v === 'number') return [v >= 0.95 ? 'track' : 'offroad', { speed: v, grip: v >= 0.95 ? 1 : 0.75, drag: v >= 0.95 ? 0 : 5 * (1 - v) }];
    if (v && typeof v === 'object') return [v.name || 'custom', { speed: v.speed ?? 1, grip: v.grip ?? 1, drag: v.drag ?? 0, boost: v.boost ?? 0 }];
    return ['track', surfaces.track];
  }

  function reset(pose = opt.start || {}) {
    state.x = pose.x ?? 0; state.z = pose.z ?? 0;
    state.yaw = state.angle = pose.yaw ?? 0;
    const g = ground(state.x, state.z, Infinity);
    state.y = pose.y ?? (Number.isFinite(g) ? g : 0);
    const sp = pose.speed ?? 0;
    state.vx = fwdX(state.yaw) * sp; state.vz = fwdZ(state.yaw) * sp; state.vy = 0;
    state.speed = state.vf = sp; state.vl = 0; state.slip = 0; state.steer = 0;
    state.drifting = false; state.driftDir = 0; state.driftT = 0; state.driftStage = 0; state.autoT = 0;
    state.boostT = 0; state.boosting = false; state.grounded = true; state.wall = false;
    state.dead = false; state.hurt = false;     // the game's flags (attachCharacter on a driver)
    const [name, sf] = surfaceInfo(state.x, state.z);
    state.surface = name; state.offTrack = sf.speed < 0.95;
    Object.assign(prev, { x: state.x, y: state.y, z: state.z, yaw: state.yaw });
    rec.reset();
  }

  function endDrift(reward) {
    const s = state;
    if (reward && s.driftStage > 0) {
      const t = opt.driftBoost[Math.min(s.driftStage, opt.driftBoost.length) - 1];
      s.boostT = Math.max(s.boostT, t);
      rec.emit('drifted', { stage: s.driftStage, boost: t, time: s.driftT });
      rec.emit('boost', { time: t, from: 'drift' });
    } else rec.emit('driftEnd', { stage: s.driftStage });
    s.drifting = false; s.driftDir = 0; s.driftT = 0; s.driftStage = 0; s.autoT = 0;
  }

  const pos = { x: 0, y: 0, z: 0 };
  /**
   * One fixed step.
   * @param {object} intent  intentFromInput() (moveX, moveY, turn, brake, drift; optional throttle 0..1)
   * @param {number} dt
   */
  function step(intent = {}, dt) {
    rec.begin(dt);
    prev.x = state.x; prev.y = state.y; prev.z = state.z; prev.yaw = state.yaw;
    const s = state;
    const my = intent.moveY || 0;
    const throttle = clamp(intent.throttle ?? Math.max(0, my), 0, 1);
    const brakeIn = intent.brake ? 1 : clamp(Math.max(0, -my), 0, 1);
    const steerIn = clamp((intent.moveX || 0) + (intent.turn || 0), -1, 1);
    s.throttle = throttle;
    s.steer += (steerIn - s.steer) * Math.min(1, dt * opt.steerSmooth);

    const [sname, sf] = surfaceInfo(s.x, s.z);
    if (sname !== s.surface) {
      const wasOff = s.offTrack;
      s.surface = sname; s.offTrack = sf.speed < 0.95;
      if (s.offTrack && !wasOff) rec.emit('offTrack', { surface: sname });
      if (!s.offTrack && wasOff) rec.emit('onTrack', { surface: sname });
    }
    // a boost surface is a pad: it acts like kick() (refreshed while the car is on it)
    if (sf.boost > 0 && s.grounded) {
      if (s.boostT <= 0) rec.emit('boost', { time: sf.boost, from: 'surface', surface: sname });
      s.boostT = Math.max(s.boostT, sf.boost);
    }

    // ---- yaw: speed-dependent steering (steer right = yaw decreases)
    let f = [fwdX(s.yaw), fwdZ(s.yaw)];
    let vf = s.vx * f[0] + s.vz * f[1];
    const sp = Math.abs(vf);
    const yawMax = opt.steerRate * Math.min(1, sp / opt.steerRamp) / (1 + sp / opt.steerFalloff);
    const dir = vf < -0.5 ? -1 : 1;
    let yawRate;
    if (s.drifting) {
      // a drift keeps turning into its side; steering tightens or widens it
      const k = 0.55 + 0.45 * clamp(s.steer * s.driftDir, -1, 1);
      yawRate = -s.driftDir * yawMax * opt.driftYaw * k;
    } else {
      yawRate = -s.steer * yawMax * dir;
    }
    if (s.grounded) s.yaw = wrapAngle(s.yaw + yawRate * dt);

    // ---- re-split the velocity in the new heading
    f = [fwdX(s.yaw), fwdZ(s.yaw)];
    const r = [rightX(s.yaw), rightZ(s.yaw)];
    vf = s.vx * f[0] + s.vz * f[1];
    let vl = s.vx * r[0] + s.vz * r[1];

    // ---- engine, brakes, boost, drag
    s.boosting = s.boostT > 0;
    // never past boostSpeed: a fast surface (speed > 1) and a boost do not multiply
    const top = Math.min((s.boosting ? opt.boostSpeed : opt.topSpeed) * sf.speed, Math.max(opt.boostSpeed, opt.topSpeed));
    s.braking = false; s.reversing = false;
    if (s.grounded) {
      if (throttle > 0) {
        if (vf < -0.5) vf += opt.brake * throttle * dt;
        else vf += opt.accel * throttle * Math.sqrt(Math.max(0, 1 - vf / Math.max(1, top))) * dt;
      }
      if (brakeIn > 0) {
        if (vf > 0.5) { vf -= opt.brake * brakeIn * dt; s.braking = true; }
        else if (vf > -opt.reverseSpeed) { vf -= opt.reverseAccel * brakeIn * dt; s.reversing = true; }
      }
      if (s.boosting && vf < top) vf = Math.min(top, vf + opt.boostAccel * dt);   // the boost pushes up to top, never past it
      if (throttle === 0 && brakeIn === 0) vf -= Math.sign(vf) * Math.min(Math.abs(vf), opt.coastDrag * dt);
      if (sf.drag > 0) vf -= Math.sign(vf) * Math.min(Math.abs(vf), sf.drag * dt);
      // over the surface's top speed (off-track, or after a boost): bleed it off fast
      if (vf > top) vf = Math.max(top, vf - (vf - top) * Math.min(1, 3 * dt) - 2 * dt);
      if (vf < -opt.reverseSpeed) vf = -opt.reverseSpeed;
    }
    if (s.boostT > 0) s.boostT = Math.max(0, s.boostT - dt);

    // ---- drift
    const fullLock = Math.abs(steerIn) >= opt.autoDriftSteer && vf > opt.driftMinSpeed;
    s.autoT = fullLock ? s.autoT + dt : 0;
    const holdOk = (opt.driftMode === 'hold' || opt.driftMode === 'both') && !!intent.drift;
    const autoOk = (opt.driftMode === 'auto' || opt.driftMode === 'both') && s.autoT >= opt.autoDriftTime;
    if (!s.drifting) {
      if ((holdOk && Math.abs(steerIn) > 0.3 || autoOk) && vf > opt.driftMinSpeed && s.grounded) {
        s.drifting = true; s.driftDir = Math.sign(steerIn); s.driftT = 0; s.driftStage = 0; s.driftBy = holdOk ? 'hold' : 'auto';
        rec.emit('driftStart', { dir: s.driftDir });
        rec.act('drift'); lastAct = 'drift';
      }
    } else {
      s.driftT += dt;
      let st = 0;
      for (const th of opt.driftStages) if (s.driftT >= th) st++;
      if (st > s.driftStage) { s.driftStage = st; rec.emit('driftStage', { stage: st }); }
      // a held drift lasts while the button is held; an auto drift while the wheel stays on its side
      const keep = s.driftBy === 'hold' ? !!intent.drift : Math.abs(steerIn) > 0.2 && Math.sign(steerIn) === s.driftDir;
      if (vf < opt.driftMinSpeed * 0.6) endDrift(false);
      else if (!keep) endDrift(true);
    }

    // ---- grip
    const grip = (s.drifting ? opt.driftGrip : opt.grip) * sf.grip;
    vl *= Math.exp(-grip * dt);
    s.slip = Math.atan2(vl, Math.max(2, Math.abs(vf)));
    s.vx = f[0] * vf + r[0] * vl;
    s.vz = f[1] * vf + r[1] * vl;

    // ---- move: substeps of at most half the car, so walls are never skipped
    const dx = s.vx * dt, dz = s.vz * dt;
    const n = Math.max(1, Math.min(256, Math.ceil(Math.hypot(dx, dz) / (opt.radius * 0.5))));
    let hit = null;
    for (let i = 0; i < n; i++) {
      for (const axis of ['x', 'z']) {
        const d = (axis === 'x' ? s.vx : s.vz) * dt / n;
        if (!d) continue;
        pos.x = s.x; pos.y = s.y; pos.z = s.z;
        const res = sweep(opt.collide, pos, axis, d, opt.radius, opt.clearance, opt.height);
        let blocked = res.hit;
        const g1 = ground(pos.x, pos.z, s.y + opt.stepHeight);
        if (Number.isFinite(g1) && g1 > s.y + opt.stepHeight + 1e-6) { blocked = true; pos[axis] = s[axis]; }
        s.x = pos.x; s.z = pos.z;
        if (blocked) {
          const vIn = axis === 'x' ? s.vx : s.vz;
          const impact = Math.abs(vIn);
          if (axis === 'x') { s.vx = -s.vx * opt.bounce; s.vz *= 1 - opt.wallFriction * Math.min(1, impact / 15); }
          else { s.vz = -s.vz * opt.bounce; s.vx *= 1 - opt.wallFriction * Math.min(1, impact / 15); }
          if (!hit || impact > hit.impact) hit = { axis, impact };
        }
      }
    }
    if (hit && (!s.wall || hit.impact > 2)) rec.emit('bumped', { impact: hit.impact, axis: hit.axis });
    if (hit && s.drifting && hit.impact > 8) endDrift(false);
    s.wall = !!hit;

    // ---- ground: follow it, fall off drops, land
    const g = ground(s.x, s.z, s.y + opt.stepHeight);
    if (s.grounded) {
      if (Number.isFinite(g) && g >= s.y - opt.stepHeight - 1e-6) { s.y = g; s.vy = 0; }
      else { s.grounded = false; rec.emit('leftGround', {}); }
    }
    if (!s.grounded) {
      s.vy -= opt.gravity * dt;
      s.y += s.vy * dt;
      if (Number.isFinite(g) && s.y <= g) { rec.emit('landed', { impact: -s.vy }); s.y = g; s.vy = 0; s.grounded = true; }
    }

    s.vf = s.vx * f[0] + s.vz * f[1];
    s.vl = s.vx * r[0] + s.vz * r[1];
    s.speed = s.vf;
    s.angle = s.yaw;
    const act = throttle > 0 ? 'gas' : brakeIn > 0 ? (s.reversing ? 'reverse' : 'brake') : Math.abs(steerIn) > 0.2 ? 'steer' : '';
    if (act && act !== lastAct) { rec.act(act); lastAct = act; }
    if (!act && lastAct !== 'drift') lastAct = '';
    if (intent.action) { rec.act('action'); rec.emit('action', {}); }
    return s;
  }

  const _pose = { x: 0, y: 0, z: 0, yaw: 0 };
  const api = {
    kind: 'vehicle',
    expect: 'move',
    options: opt,
    state,
    get events() { return rec.events; },
    step,
    reset,
    lastAction: () => rec.lastAction(),
    /** a boost from a pad, a pickup or a start-line launch (seconds) */
    kick(seconds) { state.boostT = Math.max(state.boostT, seconds); rec.emit('boost', { time: seconds, from: 'kick' }); },
    pose(alpha = 1) { return lerpPose(prev, state, alpha, _pose); },
    apply(obj, alpha = 1, yawOffset = 0) { return applyPose(obj, api.pose(alpha), yawOffset); },
    box() {
      return { min: { x: state.x - opt.radius, y: state.y, z: state.z - opt.radius }, max: { x: state.x + opt.radius, y: state.y + opt.height, z: state.z + opt.radius } };
    },
  };
  reset(opt.start || {});
  return api;
}
