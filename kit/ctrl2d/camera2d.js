// camera2d.js — a 2D follow camera: deadzone, look-ahead, level-bounds clamp,
// trauma screen shake and optional pixel snapping. Pure logic: no DOM
// (apply() only calls ctx.setTransform on the context you pass).
//
//   const cam = createCamera2d({ view: { w: view.w, h: view.h }, bounds: { x: 0, y: 0, w: world.width, h: world.height } });
//   cam.jumpTo(hero.center());                       // on spawn: no swoop
//   function update(dt) { ...; cam.follow({ ...hero.center(), vx: hero.state.vx }, dt); }
//   function render() {
//     cam.apply(ctx, k);                             // world transform (k = canvas px per world unit)
//     ...draw the world...
//   }
//   on a hit: cam.shake(0.4)                         // trauma 0..1, adds up, decays
//   on resize: cam.setView(view.w, view.h)
//
// state: { x, y (top-left of the view, before shake), w, h, cx, cy (center), trauma }
// view(): { x, y, w, h, angle } with shake and snapping: draw with it (apply() does)
//
// cam.options is the LIVE config (the camera's own merged copy, never the defaults):
// change any field at any time and the next follow() / view() uses it, no rebuild.
//   cam.options.offset.y = -16 + hero.state.look * 48;      // look up / duck
//   cam.options.lookAhead.x = view.w * 0.3;                  // a wider lead on a wide screen
//   cam.options.deadzone.w = 0; cam.options.smooth = 12; cam.options.pixelSnap = true;
// The view size and the level bounds go through setView(w, h) and setBounds(b) (they re-clamp at once).

import { clamp, damp, sign, withDefaults } from './common.js';

export const CAMERA2D_DEFAULTS = {
  view: { w: 320, h: 180 },
  bounds: null,            // { x, y, w, h } the level; null = unbounded
  deadzone: { w: 40, h: 36 },   // the target moves freely inside this box (world units)
  lookAhead: { x: 36, y: 0, rate: 3 },  // shift toward the facing / velocity
  lookAheadMinSpeed: 20,   // |vx| below this keeps the last look-ahead side
  smooth: 9,               // 1/s follow rate (0 = snap)
  offset: { x: 0, y: 0 },  // e.g. y: -20 to see more above the player
  pixelSnap: false,        // round the view to whole canvas pixels (pixel art)
  shake: { x: 10, y: 8, angle: 0.05, decay: 1.6, freq: 22 },
  shakeInsideBounds: true, // never shake the view past the level edge
  seed: 7,
};

// smooth 1D noise in [-1, 1] (value noise), deterministic per seed and channel
function noise1(seed, ch, t) {
  const h = (i) => {
    let x = (Math.imul(i | 0, 374761393) + Math.imul(seed + ch * 1013, 668265263)) | 0;
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967295 * 2 - 1;
  };
  const i = Math.floor(t), f = t - i;
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

export function createCamera2d(o = {}) {
  const C = withDefaults(CAMERA2D_DEFAULTS, o);
  const s = { x: 0, y: 0, w: C.view.w, h: C.view.h, cx: C.view.w / 2, cy: C.view.h / 2, trauma: 0 };
  let la = 0, laSide = 1, focusX = s.cx, focusY = s.cy, t = 0;

  function clampCenter(cx, cy) {
    const b = C.bounds;
    if (!b) return [cx, cy];
    const x = b.w <= s.w ? b.x + b.w / 2 : clamp(cx, b.x + s.w / 2, b.x + b.w - s.w / 2);
    const y = b.h <= s.h ? b.y + b.h / 2 : clamp(cy, b.y + s.h / 2, b.y + b.h - s.h / 2);
    return [x, y];
  }
  function sync() {
    [s.cx, s.cy] = clampCenter(s.cx, s.cy);
    s.x = s.cx - s.w / 2; s.y = s.cy - s.h / 2;
  }

  function lookAheadTarget(target) {
    const vx = Number.isFinite(target.vx) ? target.vx : 0;
    if (Math.abs(vx) >= C.lookAheadMinSpeed) laSide = sign(vx);
    else if (target.facing) laSide = sign(target.facing) || laSide;
    return laSide * C.lookAhead.x;
  }

  /** follow a target {x, y, vx?, vy?, facing?} (world units) */
  function follow(target, dt) {
    if (!target || !(dt >= 0)) return;
    t += dt;
    s.trauma = Math.max(0, s.trauma - C.shake.decay * dt);
    la += (lookAheadTarget(target) - la) * damp(C.lookAhead.rate, dt);
    const tx = target.x + C.offset.x, ty = target.y + C.offset.y;
    // deadzone: the focus point only moves when the target leaves the box
    const hw = C.deadzone.w / 2, hh = C.deadzone.h / 2;
    if (tx > focusX + hw) focusX = tx - hw; else if (tx < focusX - hw) focusX = tx + hw;
    if (ty > focusY + hh) focusY = ty - hh; else if (ty < focusY - hh) focusY = ty + hh;
    const k = C.smooth > 0 ? damp(C.smooth, dt) : 1;
    s.cx += (focusX + la - s.cx) * k;
    s.cy += (focusY + (C.lookAhead.y || 0) - s.cy) * k;
    sync();
  }

  /** snap to a target with no smoothing (spawn, respawn, a level change) */
  function jumpTo(target) {
    focusX = target.x + C.offset.x; focusY = target.y + C.offset.y;
    la = lookAheadTarget(target);
    s.cx = focusX + la; s.cy = focusY + (C.lookAhead.y || 0);
    sync();
  }

  /** the view to draw with this frame: shake + bounds + pixel snap */
  function view(k = 1) {
    const sh = s.trauma * s.trauma;
    let x = s.x, y = s.y, angle = 0;
    if (sh > 0) {
      const f = t * C.shake.freq;
      x += C.shake.x * sh * noise1(C.seed, 0, f);
      y += C.shake.y * sh * noise1(C.seed, 1, f);
      angle = C.shake.angle * sh * noise1(C.seed, 2, f);
      if (C.shakeInsideBounds && C.bounds) {
        const b = C.bounds;
        if (b.w > s.w) x = clamp(x, b.x, b.x + b.w - s.w);
        if (b.h > s.h) y = clamp(y, b.y, b.y + b.h - s.h);
      }
    }
    if (C.pixelSnap && k > 0) { x = Math.round(x * k) / k; y = Math.round(y * k) / k; }
    return { x, y, w: s.w, h: s.h, angle };
  }

  return {
    state: s,
    follow,
    step: follow,
    jumpTo,
    view,
    /** add screen-shake trauma (0..1); shake strength is trauma squared */
    shake(amount = 0.3) { s.trauma = clamp(s.trauma + amount, 0, 1); },
    setView(w, h) { s.w = w; s.h = h; sync(); },
    setBounds(b) { C.bounds = b; sync(); },
    /** set the world transform on a 2D context: k = canvas pixels per world unit, dpr folded in */
    apply(ctx, k = 1) {
      const v = view(k);
      if (v.angle) {
        const c = Math.cos(v.angle), sn = Math.sin(v.angle);
        const cx = v.w / 2, cy = v.h / 2;
        // rotate about the view center
        ctx.setTransform(k * c, k * sn, -k * sn, k * c,
          k * (cx - (c * (v.x + cx) - sn * (v.y + cy))),
          k * (cy - (sn * (v.x + cx) + c * (v.y + cy))));
      } else ctx.setTransform(k, 0, 0, k, -v.x * k, -v.y * k);
      return v;
    },
    worldToScreen: (wx, wy, k = 1) => ({ x: (wx - s.x) * k, y: (wy - s.y) * k }),
    screenToWorld: (sx, sy, k = 1) => ({ x: sx / k + s.x, y: sy / k + s.y }),
    /** is a world rect on screen (with a margin)? for culling */
    sees: (r, m = 0) => r.x + r.w > s.x - m && r.x < s.x + s.w + m && r.y + r.h > s.y - m && r.y < s.y + s.h + m,
    /** the live config: edits take effect on the next follow() / view() */
    options: C,
  };
}
