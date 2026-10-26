// ctrl3d/cameras.js — camera rigs: pure math for the camera position and look-at
// point from the target's pose, then apply(camera) puts it on a three.js camera.
//
//   const cam = followChase({ raycast: boxesRaycast(walls) });
//   // render(alpha, frameDt):
//   cam.update(hero.pose(alpha), frameDt);   // any { x, y, z, yaw } (feet position); pitch for firstPerson
//   cam.apply(camera);                        // position, up, lookAt, fov (+ portrait widening)
//
// Every rig: update(target, dt), apply(camera), pose(aspect) for frameCheck,
// snap() (skip the smoothing once: a respawn, a cut), shake(amount),
// and .yaw, the horizontal direction it looks (pass it as intent.viewYaw so
// "stick up" walks away from the camera).
//
// Framing rules built in: the look point is the target's body (lookHeight), not
// its feet; followChase and thirdPersonOrbit never look down steeper than
// maxPitch (no "straight down at the party's backs"), and a raycast pull-in keeps
// them out of walls. frameCheck(camera, box) tells the self-test whether the
// target is fully in view and big enough.

import { clamp, lerpAngle, damp, DEG, fwdX, fwdZ, rightX, rightZ } from './common.js';

// critically damped spring (smooth, no overshoot) for one component
function springTo(cur, vel, target, omega, dt, k) {
  const x = omega * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur[k] - target[k];
  const temp = (vel[k] + omega * change) * dt;
  vel[k] = (vel[k] - omega * temp) * e;
  cur[k] = target[k] + (change + temp) * e;
}
function spring3(cur, vel, target, omega, dt) {
  if (!(omega > 0)) { cur.x = target.x; cur.y = target.y; cur.z = target.z; return; }
  springTo(cur, vel, target, omega, dt, 'x');
  springTo(cur, vel, target, omega, dt, 'y');
  springTo(cur, vel, target, omega, dt, 'z');
}
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
const copy = (a, b) => { a.x = b.x; a.y = b.y; a.z = b.z; return a; };
const rayDist = (hit) => (hit === null || hit === undefined || hit === false ? null : typeof hit === 'number' ? hit : hit.distance ?? null);

/** common rig parts: position / target / up, fov, shake, apply, pose */
function baseRig(kind, o) {
  let shakeAmt = 0, shakeT = 0;
  const rig = {
    kind,
    position: v3(), target: v3(), up: v3(0, 1, 0),
    yaw: 0, pitch: 0,
    fov: o.fov ?? 60,
    /** extra degrees of fov on a portrait screen (aspect < 0.8), so the sides are not cropped */
    portraitFov: o.portraitFov ?? 10,
    aspect: o.aspect ?? 16 / 9,
    near: o.near ?? 0.1,
    fovKick: 0,
    initialized: false,
    /** skip the smoothing on the next update (a respawn, a camera cut) */
    snap() { rig.initialized = false; return rig; },
    /** a decaying shake (impacts): amount in metres */
    shake(amount = 0.3) { shakeAmt = Math.min(1.5, Math.max(shakeAmt, amount)); return rig; },
    currentFov(aspect = rig.aspect) { return rig.fov + rig.fovKick + (aspect < 0.8 ? rig.portraitFov : 0); },
    /** a plain camera pose for frameCheck (no three.js needed) */
    pose(aspect = rig.aspect) {
      return { position: { ...rig.position }, target: { ...rig.target }, up: { ...rig.up }, fov: rig.currentFov(aspect), aspect, near: rig.near };
    },
    /** put the rig on a three.js camera (duck-typed: position.set, up.set, lookAt, fov, updateProjectionMatrix) */
    apply(camera) {
      if (typeof camera.aspect === 'number' && camera.aspect > 0) rig.aspect = camera.aspect;
      if (rig.onAspect) rig.onAspect(rig.aspect);
      const p = rig.position;
      let sx = 0, sy = 0, sz = 0;
      if (shakeAmt > 0.001) {
        sx = (Math.sin(shakeT * 91) + Math.sin(shakeT * 57)) * 0.5 * shakeAmt;
        sy = (Math.sin(shakeT * 73) + Math.cos(shakeT * 39)) * 0.35 * shakeAmt;
        sz = Math.sin(shakeT * 67) * 0.5 * shakeAmt;
      }
      camera.position.set(p.x + sx, p.y + sy, p.z + sz);
      if (camera.up && camera.up.set) camera.up.set(rig.up.x, rig.up.y, rig.up.z);
      camera.lookAt(rig.target.x, rig.target.y, rig.target.z);
      if (typeof camera.fov === 'number') {
        const f = rig.currentFov(rig.aspect);
        if (Math.abs(camera.fov - f) > 1e-3) { camera.fov = f; if (camera.updateProjectionMatrix) camera.updateProjectionMatrix(); }
      }
      return camera;
    },
    _tickShake(dt) { shakeT += dt; shakeAmt = Math.max(0, shakeAmt - dt * 1.8); },
  };
  return rig;
}

// a velocity estimate from successive target positions (the controllers' pose has no velocity)
function velTracker() {
  const t = { x: 0, z: 0, vx: 0, vz: 0, init: false };
  t.update = (p, dt) => {
    if (!t.init || !(dt > 0)) { t.x = p.x; t.z = p.z; t.vx = p.vx ?? 0; t.vz = p.vz ?? 0; t.init = true; return t; }
    const vx = p.vx ?? (p.x - t.x) / dt, vz = p.vz ?? (p.z - t.z) / dt;
    const k = damp(12, dt);
    t.vx += (vx - t.vx) * k; t.vz += (vz - t.vz) * k;
    t.x = p.x; t.z = p.z;
    return t;
  };
  t.speed = () => Math.hypot(t.vx, t.vz);
  return t;
}

// wall pull-in: keep the camera on the near side of the first hit between pivot and camera
function pullIn(raycast, pivot, pos, minDistance, padding) {
  if (!raycast) return false;
  const dx = pos.x - pivot.x, dy = pos.y - pivot.y, dz = pos.z - pivot.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return false;
  const hit = rayDist(raycast(pivot, pos));
  if (hit === null || hit >= len) return false;
  // keep padding off the wall; closer than minDistance only when the wall itself is that close (never inside it)
  const d = Math.max(hit - padding, Math.min(minDistance, hit * 0.9));
  pos.x = pivot.x + (dx / len) * d; pos.y = pivot.y + (dy / len) * d; pos.z = pivot.z + (dz / len) * d;
  return true;
}

// do not look down steeper than maxPitch at the look point
function limitPitch(pos, look, maxPitchDeg) {
  const hd = Math.hypot(pos.x - look.x, pos.z - look.z);
  const maxRise = Math.tan(clamp(maxPitchDeg, 1, 89) * DEG) * Math.max(hd, 1e-3);
  if (pos.y - look.y > maxRise) pos.y = look.y + maxRise;
}

/**
 * Behind and above the target, looking a little ahead of it; spring smoothing;
 * pulled in by walls (raycast) and kept above the ground (groundHeight).
 * Karts, cars, third-person runners and platformers.
 * @param {object} [o]
 * @param {number} [o.distance=6]     metres behind
 * @param {number} [o.height=2.4]     metres above the feet
 * @param {number} [o.lookHeight=1.2] the look point above the feet (the body, not the feet)
 * @param {number} [o.lookAhead=2]    metres ahead of the target along its heading
 * @param {number} [o.followVelocity=0]  0..1: aim along the travel direction instead of the nose (drifts)
 * @param {number} [o.yawStiffness=4] 1/s: how fast the camera swings behind a turn
 * @param {number} [o.stiffness=8]    spring rate of the position (higher = tighter)
 * @param {number} [o.maxPitch=35]    degrees: never looks down steeper than this
 * @param {number} [o.minDistance=1.2] closest a wall may push it (padding still wins)
 * @param {(from:{x,y,z}, to:{x,y,z})=>number|{distance:number}|null} [o.raycast]  distance to the first wall, or null
 * @param {number} [o.wallPadding=0.3]
 * @param {(x:number, z:number)=>number} [o.groundHeight]  keeps the camera groundClearance above it
 * @param {number} [o.groundClearance=0.4]
 * @param {number} [o.fov=60]
 * @param {number} [o.speedFov=0]     extra degrees of fov at speedRef (speed feel)
 * @param {number} [o.speedRef=25]    m/s
 * @param {number} [o.portraitFov=10]
 */
export function followChase(o = {}) {
  const c = {
    distance: 6, height: 2.4, lookHeight: 1.2, lookAhead: 2, followVelocity: 0, yawStiffness: 4, stiffness: 8,
    maxPitch: 35, minDistance: 1.2, raycast: null, wallPadding: 0.3, groundHeight: null, groundClearance: 0.4,
    speedFov: 0, speedRef: 25, ...o,
  };
  const rig = baseRig('followChase', c);
  rig.options = c;
  const vel = v3(), lookVel = v3(), want = v3(), look = v3(), pivot = v3();
  const vt = velTracker();
  let camYaw = 0;
  rig.update = (t, dt = 1 / 60) => {
    vt.update(t, dt);
    const sp = vt.speed();
    let heading = t.yaw ?? 0;
    if (c.followVelocity > 0 && sp > 1) heading = lerpAngle(heading, Math.atan2(vt.vx, vt.vz), c.followVelocity);
    camYaw = rig.initialized ? lerpAngle(camYaw, heading, damp(c.yawStiffness, dt)) : heading;
    pivot.x = t.x; pivot.y = t.y + c.lookHeight; pivot.z = t.z;
    look.x = pivot.x + fwdX(heading) * c.lookAhead; look.y = pivot.y; look.z = pivot.z + fwdZ(heading) * c.lookAhead;
    want.x = t.x - fwdX(camYaw) * c.distance; want.y = t.y + c.height; want.z = t.z - fwdZ(camYaw) * c.distance;
    limitPitch(want, look, c.maxPitch);
    if (!rig.initialized) {
      copy(rig.position, want); copy(rig.target, look);
      vel.x = vel.y = vel.z = lookVel.x = lookVel.y = lookVel.z = 0;
      rig.initialized = true;
    } else {
      spring3(rig.position, vel, want, c.stiffness, dt);
      spring3(rig.target, lookVel, look, c.stiffness * 1.5, dt);
    }
    if (c.groundHeight) rig.position.y = Math.max(rig.position.y, c.groundHeight(rig.position.x, rig.position.z) + c.groundClearance);
    limitPitch(rig.position, rig.target, c.maxPitch + 10);
    if (pullIn(c.raycast, pivot, rig.position, c.minDistance, c.wallPadding)) { vel.x = vel.y = vel.z = 0; }
    rig.yaw = Math.atan2(rig.target.x - rig.position.x, rig.target.z - rig.position.z);
    rig.pitch = Math.atan2(rig.position.y - rig.target.y, Math.hypot(rig.target.x - rig.position.x, rig.target.z - rig.position.z));
    rig.fovKick = c.speedFov * Math.min(1.2, sp / c.speedRef);
    rig._tickShake(dt);
    return rig;
  };
  return rig;
}

/**
 * Orbit around the target: drag (orbit(dx, dy)) or a right stick (orbitStick(x, y, dt)),
 * auto-recentres behind the target after a pause while it moves. Third-person adventure.
 * @param {object} [o]
 * @param {number} [o.distance=5]
 * @param {number} [o.minDistance=0.8]
 * @param {number} [o.pitch=0.32]     rad, the start (and recentre) pitch: + is above, looking down
 * @param {number} [o.minPitch=-0.2]  rad (a little below the shoulder)
 * @param {number} [o.maxPitch=1.05]  rad (60°: never straight down)
 * @param {number} [o.lookHeight=1.4] the pivot above the feet
 * @param {number} [o.sensitivity=0.006]  rad per drag pixel
 * @param {number} [o.stickSpeed=2.5] rad/s at full stick
 * @param {boolean} [o.invertY=false]
 * @param {boolean} [o.autoRecenter=true]
 * @param {number} [o.recenterDelay=1.5]  s without orbit input before recentring
 * @param {number} [o.recenterSpeed=1.5]  1/s
 * @param {number} [o.stiffness=15]   spring rate of the pivot
 * @param {number} [o.yaw]            start yaw (default: behind the target)
 * @param {Function} [o.raycast]  as followChase
 * @param {number} [o.wallPadding=0.3]
 * @param {Function} [o.groundHeight]
 * @param {number} [o.groundClearance=0.4]
 * @param {number} [o.fov=60]
 */
export function thirdPersonOrbit(o = {}) {
  const c = {
    distance: 5, minDistance: 0.8, pitch: 0.32, minPitch: -0.2, maxPitch: 1.05, lookHeight: 1.4,
    sensitivity: 0.006, stickSpeed: 2.5, invertY: false, autoRecenter: true, recenterDelay: 1.5, recenterSpeed: 1.5,
    stiffness: 15, raycast: null, wallPadding: 0.3, groundHeight: null, groundClearance: 0.4, ...o,
  };
  const rig = baseRig('thirdPersonOrbit', c);
  rig.options = c;
  rig.pitch = c.pitch;
  let idle = Infinity;
  const pivot = v3(), pivVel = v3(), want = v3();
  const vt = velTracker();
  /** drag pixels (intent.lookX / lookY): drag right turns the view right */
  rig.orbit = (dx = 0, dy = 0) => {
    if (!dx && !dy) return rig;
    rig.yaw -= dx * c.sensitivity;
    rig.pitch = clamp(rig.pitch + dy * c.sensitivity * (c.invertY ? -1 : 1), c.minPitch, c.maxPitch);
    idle = 0;
    return rig;
  };
  /** a right stick (-1..1): x right turns right, y up looks up */
  rig.orbitStick = (x = 0, y = 0, dt = 1 / 60) => {
    if (Math.abs(x) < 0.05 && Math.abs(y) < 0.05) return rig;
    rig.yaw -= x * c.stickSpeed * dt;
    rig.pitch = clamp(rig.pitch - y * c.stickSpeed * dt * (c.invertY ? -1 : 1), c.minPitch, c.maxPitch);
    idle = 0;
    return rig;
  };
  rig.update = (t, dt = 1 / 60) => {
    vt.update(t, dt);
    idle += dt;
    if (!rig.initialized) rig.yaw = c.yaw ?? t.yaw ?? 0;
    if (c.autoRecenter && idle > c.recenterDelay && vt.speed() > 0.5) {
      const k = damp(c.recenterSpeed, dt);
      rig.yaw = lerpAngle(rig.yaw, t.yaw ?? rig.yaw, k);
      rig.pitch += (c.pitch - rig.pitch) * k;
    }
    want.x = t.x; want.y = t.y + c.lookHeight; want.z = t.z;
    if (!rig.initialized) { copy(pivot, want); pivVel.x = pivVel.y = pivVel.z = 0; rig.initialized = true; }
    else spring3(pivot, pivVel, want, c.stiffness, dt);
    const cp = Math.cos(rig.pitch), spch = Math.sin(rig.pitch);
    rig.position.x = pivot.x - fwdX(rig.yaw) * cp * c.distance;
    rig.position.y = pivot.y + spch * c.distance;
    rig.position.z = pivot.z - fwdZ(rig.yaw) * cp * c.distance;
    if (c.groundHeight) rig.position.y = Math.max(rig.position.y, c.groundHeight(rig.position.x, rig.position.z) + c.groundClearance);
    pullIn(c.raycast, pivot, rig.position, c.minDistance, c.wallPadding);
    copy(rig.target, pivot);
    rig._tickShake(dt);
    return rig;
  };
  return rig;
}

/**
 * First person at eye height, looking along the target's yaw (and pitch).
 * The grid crawler and the first-person walker (mode 'strafe').
 * @param {object} [o]
 * @param {number} [o.eyeHeight=1.6]
 * @param {number} [o.headBob=0]      metres of bob while moving (0.03 to 0.05 is plenty; 0 = off)
 * @param {number} [o.bobStride=1.7]  metres per bob cycle
 * @param {number} [o.pitch=0]        rad, used when the target has no pitch (a slight -0.05 looks down the corridor)
 * @param {number} [o.fov=70]
 */
export function firstPerson(o = {}) {
  const c = { eyeHeight: 1.6, headBob: 0, bobStride: 1.7, pitch: 0, fov: 70, ...o };
  const rig = baseRig('firstPerson', c);
  rig.options = c;
  const vt = velTracker();
  let phase = 0, bobAmp = 0;
  rig.update = (t, dt = 1 / 60) => {
    vt.update(t, dt);
    const sp = vt.speed();
    phase += (sp * dt / c.bobStride) * Math.PI * 2;
    bobAmp += ((sp > 0.3 ? Math.min(1, sp / 3) : 0) - bobAmp) * damp(8, dt);
    const bob = c.headBob * bobAmp * Math.sin(phase * 2);
    rig.yaw = t.yaw ?? 0;
    rig.pitch = t.pitch ?? c.pitch;
    rig.position.x = t.x; rig.position.y = t.y + c.eyeHeight + bob; rig.position.z = t.z;
    const cp = Math.cos(rig.pitch);
    rig.target.x = rig.position.x + fwdX(rig.yaw) * cp * 10;
    rig.target.y = rig.position.y + Math.sin(rig.pitch) * 10;
    rig.target.z = rig.position.z + fwdZ(rig.yaw) * cp * 10;
    rig.initialized = true;
    rig._tickShake(dt);
    return rig;
  };
  return rig;
}

/**
 * Side view (a 2.5D side-scroller in 3D): the camera looks along yaw from the side,
 * follows with a dead zone and looks ahead in the direction of travel.
 * @param {object} [o]
 * @param {number} [o.yaw=Math.PI]   the direction the camera looks (PI: toward -Z, screen right = +X)
 * @param {number} [o.distance=14]
 * @param {number} [o.height=1.5]    camera above the look point
 * @param {number} [o.lookHeight=1]  look point above the feet
 * @param {number} [o.lookAhead=2.5] metres toward the travel direction (screen right / left)
 * @param {{x:number, y:number}} [o.deadZone={x:1, y:1.5}]  the target moves this far before the camera follows
 * @param {number} [o.stiffness=6]
 * @param {{min:{x,y,z}, max:{x,y,z}}} [o.bounds]  clamp the look point (level edges)
 * @param {number} [o.fov=50]
 */
export function sideView(o = {}) {
  const c = { yaw: Math.PI, distance: 14, height: 1.5, lookHeight: 1, lookAhead: 2.5, deadZone: { x: 1, y: 1.5 }, stiffness: 6, bounds: null, fov: 50, ...o };
  const rig = baseRig('sideView', c);
  rig.options = c;
  rig.yaw = c.yaw;
  const focus = v3(), want = v3(), look = v3(), lookVel = v3();
  const vt = velTracker();
  let ahead = 0;
  rig.update = (t, dt = 1 / 60) => {
    vt.update(t, dt);
    const rx = rightX(c.yaw), rz = rightZ(c.yaw);
    const ty = t.y + c.lookHeight;
    if (!rig.initialized) { focus.x = t.x; focus.y = ty; focus.z = t.z; ahead = 0; }
    // dead zone along the screen's right axis and up
    const along = (t.x - focus.x) * rx + (t.z - focus.z) * rz;
    if (Math.abs(along) > c.deadZone.x) { const m = along - Math.sign(along) * c.deadZone.x; focus.x += rx * m; focus.z += rz * m; }
    const fwdOff = (t.x - focus.x) * fwdX(c.yaw) + (t.z - focus.z) * fwdZ(c.yaw);   // depth: always follow
    focus.x += fwdX(c.yaw) * fwdOff; focus.z += fwdZ(c.yaw) * fwdOff;
    if (Math.abs(ty - focus.y) > c.deadZone.y) focus.y += (ty - focus.y) - Math.sign(ty - focus.y) * c.deadZone.y;
    const vAlong = vt.vx * rx + vt.vz * rz;
    const wantAhead = Math.abs(vAlong) > 0.5 ? Math.sign(vAlong) * c.lookAhead : ahead;
    ahead += (wantAhead - ahead) * damp(2.5, dt);
    want.x = focus.x + rx * ahead; want.y = focus.y; want.z = focus.z + rz * ahead;
    if (c.bounds) {
      want.x = clamp(want.x, c.bounds.min.x, c.bounds.max.x);
      want.y = clamp(want.y, c.bounds.min.y, c.bounds.max.y);
      want.z = clamp(want.z, c.bounds.min.z, c.bounds.max.z);
    }
    if (!rig.initialized) { copy(look, want); lookVel.x = lookVel.y = lookVel.z = 0; rig.initialized = true; }
    else spring3(look, lookVel, want, c.stiffness, dt);
    copy(rig.target, look);
    rig.position.x = look.x - fwdX(c.yaw) * c.distance;
    rig.position.y = look.y + c.height;
    rig.position.z = look.z - fwdZ(c.yaw) * c.distance;
    rig.yaw = c.yaw;
    rig._tickShake(dt);
    return rig;
  };
  return rig;
}

/**
 * Top-down / isometric: above the target at `pitch`, screen-up along yaw.
 * @param {object} [o]
 * @param {number} [o.height=12]     metres above the look point
 * @param {number} [o.pitch=55]      degrees down from the horizon (90 = straight down; isometric about 35)
 * @param {number} [o.yaw=0]         the world direction that is screen-up (pass rig.yaw as intent.viewYaw)
 * @param {number} [o.lookHeight=0.5]
 * @param {number} [o.lookAhead=0]   metres toward the travel direction
 * @param {number} [o.stiffness=8]
 * @param {number} [o.fov=50]
 */
export function topDown(o = {}) {
  const c = { height: 12, pitch: 55, yaw: 0, lookHeight: 0.5, lookAhead: 0, stiffness: 8, fov: 50, ...o };
  const rig = baseRig('topDown', c);
  rig.options = c;
  rig.yaw = c.yaw;
  const want = v3(), look = v3(), lookVel = v3();
  const vt = velTracker();
  rig.update = (t, dt = 1 / 60) => {
    vt.update(t, dt);
    const sp = vt.speed();
    want.x = t.x + (sp > 0.3 ? (vt.vx / sp) * c.lookAhead : 0);
    want.y = t.y + c.lookHeight;
    want.z = t.z + (sp > 0.3 ? (vt.vz / sp) * c.lookAhead : 0);
    if (!rig.initialized) { copy(look, want); lookVel.x = lookVel.y = lookVel.z = 0; rig.initialized = true; }
    else spring3(look, lookVel, want, c.stiffness, dt);
    const p = clamp(c.pitch, 5, 90) * DEG;
    const back = c.height / Math.tan(p);
    rig.yaw = c.yaw;
    rig.pitch = p;
    copy(rig.target, look);
    rig.position.x = look.x - fwdX(c.yaw) * back;
    rig.position.y = look.y + c.height;
    rig.position.z = look.z - fwdZ(c.yaw) * back;
    // near straight down, "up" on screen is the yaw direction (lookAt needs a non-parallel up)
    if (c.pitch > 80) { rig.up.x = fwdX(c.yaw); rig.up.y = 0; rig.up.z = fwdZ(c.yaw); } else { rig.up.x = 0; rig.up.y = 1; rig.up.z = 0; }
    rig._tickShake(dt);
    return rig;
  };
  return rig;
}

/**
 * Overview: fits a whole box (a board, an arena, a level) on screen, from yaw / pitch.
 * update() needs no target; fit(bounds) changes the box. The aspect comes from apply(camera).
 * @param {object} [o]
 * @param {{min:{x,y,z}, max:{x,y,z}}} o.bounds
 * @param {number} [o.yaw=0]
 * @param {number} [o.pitch=50]   degrees down
 * @param {number} [o.margin=1.1] 1 = touching the edges
 * @param {number} [o.fov=50]
 */
export function overview(o = {}) {
  const c = { bounds: { min: v3(-5, 0, -5), max: v3(5, 1, 5) }, yaw: 0, pitch: 50, margin: 1.1, fov: 50, ...o };
  const rig = baseRig('overview', c);
  rig.options = c;
  function compute(aspect) {
    const b = c.bounds;
    const cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2, cz = (b.min.z + b.max.z) / 2;
    const radius = 0.5 * Math.hypot(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
    const vfov = rig.currentFov(aspect) * DEG;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const half = Math.min(vfov, hfov) / 2;
    const dist = (radius * c.margin) / Math.sin(half);
    const p = clamp(c.pitch, 5, 89.5) * DEG;
    rig.target.x = cx; rig.target.y = cy; rig.target.z = cz;
    rig.position.x = cx - fwdX(c.yaw) * Math.cos(p) * dist;
    rig.position.y = cy + Math.sin(p) * dist;
    rig.position.z = cz - fwdZ(c.yaw) * Math.cos(p) * dist;
    rig.yaw = c.yaw; rig.pitch = p;
    rig.distance = dist;
  }
  rig.onAspect = compute;
  rig.fit = (bounds) => { c.bounds = bounds; compute(rig.aspect); return rig; };
  rig.update = (_t, dt = 1 / 60) => { compute(rig.aspect); rig.initialized = true; rig._tickShake(dt); return rig; };
  const basePose = rig.pose;
  rig.pose = (aspect = rig.aspect) => { compute(aspect); return basePose(aspect); };
  compute(rig.aspect);
  return rig;
}

// ---------------------------------------------------------------- framing check

const normBox = (b) => (b.min ? b : { min: { x: b.minX, y: b.minY, z: b.minZ }, max: { x: b.maxX, y: b.maxY, z: b.maxZ } });

/** a body box from a controller state / pose (feet at y) */
export function targetBox(t, { radius = 0.4, height = 1.8 } = {}) {
  return { min: { x: t.x - radius, y: t.y, z: t.z - radius }, max: { x: t.x + radius, y: t.y + height, z: t.z + radius } };
}

function cameraBasis(cam) {
  if (cam && cam.matrixWorld && cam.matrixWorld.elements) {
    // a three.js camera: read its world matrix (columns: right, up, back, position)
    if (cam.updateMatrixWorld) cam.updateMatrixWorld(true);
    const e = cam.matrixWorld.elements;
    const n = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return { x: x / l, y: y / l, z: z / l }; };
    return {
      p: { x: e[12], y: e[13], z: e[14] },
      r: n(e[0], e[1], e[2]), u: n(e[4], e[5], e[6]), f: n(-e[8], -e[9], -e[10]),
      ortho: !!cam.isOrthographicCamera, cam,
      fov: cam.fov, aspect: cam.aspect || 1, near: cam.near ?? 0.1,
    };
  }
  // a plain pose { position, target, up, fov, aspect, near } (rig.pose())
  const p = cam.position, t = cam.target, up = cam.up || { x: 0, y: 1, z: 0 };
  let f = { x: t.x - p.x, y: t.y - p.y, z: t.z - p.z };
  const fl = Math.hypot(f.x, f.y, f.z) || 1;
  f = { x: f.x / fl, y: f.y / fl, z: f.z / fl };
  let r = { x: f.y * up.z - f.z * up.y, y: f.z * up.x - f.x * up.z, z: f.x * up.y - f.y * up.x };
  const rl = Math.hypot(r.x, r.y, r.z) || 1;
  r = { x: r.x / rl, y: r.y / rl, z: r.z / rl };
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  return { p, r, u, f, ortho: false, fov: cam.fov ?? 60, aspect: cam.aspect ?? 16 / 9, near: cam.near ?? 0.1 };
}

/**
 * Is the target framed? Projects the 8 corners of its box.
 * @param {object} camera  a three.js camera (after rig.apply) or a rig.pose(aspect)
 * @param {{min:{x,y,z},max:{x,y,z}}|{minX:number}} box  the target's box (targetBox(state))
 * @param {object} [o]
 * @param {number} [o.minScreenFrac=0.08]  the box must be at least this fraction of the screen height
 * @param {number} [o.edge=0]  extra safe margin in NDC (0.05 = keep 2.5% away from the edges)
 * @returns {{ok:boolean, visible:boolean, inFrustum:boolean, cropped:boolean, behind:boolean, screenFrac:number,
 *   ndc:{minX:number,maxX:number,minY:number,maxY:number}}}
 *   visible: some of it is on screen; inFrustum: all of it (not cropped); ok: inFrustum and big enough
 */
export function frameCheck(camera, box, { minScreenFrac = 0.08, edge = 0 } = {}) {
  const B = cameraBasis(camera);
  const b = normBox(box);
  const ty = B.ortho ? 0 : Math.tan(((B.fov || 60) * DEG) / 2);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let behind = false, inside = 0;
  const lim = 1 - edge;
  for (let i = 0; i < 8; i++) {
    const q = { x: i & 1 ? b.max.x : b.min.x, y: i & 2 ? b.max.y : b.min.y, z: i & 4 ? b.max.z : b.min.z };
    const d = { x: q.x - B.p.x, y: q.y - B.p.y, z: q.z - B.p.z };
    const zc = d.x * B.f.x + d.y * B.f.y + d.z * B.f.z;
    const xc = d.x * B.r.x + d.y * B.r.y + d.z * B.r.z;
    const yc = d.x * B.u.x + d.y * B.u.y + d.z * B.u.z;
    let nx, ny;
    if (B.ortho) {
      const cam = B.cam, zoom = cam.zoom || 1;
      const hw = (cam.right - cam.left) / 2 / zoom, hh = (cam.top - cam.bottom) / 2 / zoom;
      const cx = (cam.right + cam.left) / 2, cy = (cam.top + cam.bottom) / 2;
      nx = (xc - cx) / hw; ny = (yc - cy) / hh;
      if (zc < B.near) behind = true;
    } else {
      if (zc < B.near) { behind = true; continue; }
      nx = xc / (zc * ty * B.aspect); ny = yc / (zc * ty);
    }
    minX = Math.min(minX, nx); maxX = Math.max(maxX, nx); minY = Math.min(minY, ny); maxY = Math.max(maxY, ny);
    if (Math.abs(nx) <= lim && Math.abs(ny) <= lim) inside++;
  }
  const any = minX <= maxX;
  const visible = any && maxX >= -1 && minX <= 1 && maxY >= -1 && minY <= 1;
  const inFrustum = !behind && inside === 8;
  const screenFrac = any ? (Math.min(maxY, 1) - Math.max(minY, -1)) / 2 : 0;
  return {
    ok: inFrustum && screenFrac >= minScreenFrac,
    visible, inFrustum, cropped: visible && !inFrustum, behind,
    screenFrac: Math.max(0, screenFrac),
    ndc: { minX, maxX, minY, maxY },
  };
}
