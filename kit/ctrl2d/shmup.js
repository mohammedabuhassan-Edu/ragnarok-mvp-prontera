// shmup.js — a shoot-'em-up ship: keyboard / stick 8-way, touch relative drag
// or follow-finger, screen bounds, a focus (slow) mode and a fire cadence.
// Pure logic: no DOM. The ship only says WHEN and WHERE to fire ('fire'
// events); the game spawns and moves its own bullets.
//
//   const input = createInput(canvas, inputOptions('shmup'));   // drag anywhere + FOCUS / FIRE
//   const ship = createShmup({ bounds: { x: 0, y: 0, w: view.w, h: view.h }, x: 160, y: 300 });
//   function update(dt) {
//     ship.step(intentFromInput(input, null, { look: true, lookScale: dpr / k }), dt);
//     for (const e of ship.events) if (e.type === 'fire') for (const g of e.guns) bullets.push({ x: g.x, y: g.y, vy: -420 });
//     game.state.player = { x: ship.state.x, y: ship.state.y };
//   }
//
// touchMode 'relative' (default): intent.dragX/dragY move the ship 1:1 (times dragScale)
// touchMode 'follow':  intent.pointer {x, y, down} pulls the ship toward the finger
//                      (offset above it so the thumb does not hide the ship)
// Fire: attack held (or a tap), or automatically while touching (autoFire 'touch') / always.
//
// state: { x, y (center), vx, vy, focus, firing, shots }
// events: fire {x, y, guns: [{x, y, angle}], n, focus}, focus {on} (FOCUS pressed / let go)
// lastAction: 'move', 'fire', 'focus-on', 'focus-off' (so FOCUS answers even with the ship still)

import { approach, clamp, createEvents, readIntent, withDefaults } from './common.js';

export const SHMUP_DEFAULTS = {
  x: 0, y: 0,
  w: 14, h: 14,            // the ship's body (bounds keep all of it on screen)
  bounds: null,            // { x, y, w, h } (screen / world rect)
  speed: 220,              // px/s, keys and stick
  accel: 5000,             // crisp; lower for a heavier ship
  focusMul: 0.45,          // speed share while focusing
  touchMode: 'relative',   // 'relative' | 'follow'
  dragScale: 1,
  followSpeed: 900,        // px/s max toward the finger
  followOffsetY: -40,      // the ship sits this far above the finger
  fireRate: 10,            // shots per second
  focusFireRate: null,     // null: same as fireRate
  autoFire: 'touch',       // 'touch' | 'always' | false
  guns: [{ x: 0, y: -8, angle: -Math.PI / 2 }],
  focusGuns: null,         // null: same guns
};

export function createShmup(o = {}) {
  const C = withDefaults(SHMUP_DEFAULTS, o);
  const ev = createEvents(o.onEvent);
  const s = {};
  let cool = 0, touchT = 0;

  function reset(at) {
    Object.assign(s, { x: at?.x ?? C.x, y: at?.y ?? C.y, vx: 0, vy: 0, focus: false, firing: false, shots: 0 });
    cool = 0; touchT = 0;
    ev.reset();
  }
  reset();

  function step(intent, dt) {
    ev.clear();
    if (!(dt > 0)) return;
    const I = readIntent(intent);
    const focus = I.focusHeld || I.focus;
    if (focus !== s.focus) {
      s.focus = focus;
      ev.emit('focus', { on: focus, x: s.x, y: s.y });
      ev.act(focus ? 'focus-on' : 'focus-off');
    }
    const mul = s.focus ? C.focusMul : 1;
    const x0 = s.x, y0 = s.y;

    // ---- touch
    const drag = (I.dragX || 0) !== 0 || (I.dragY || 0) !== 0;
    const ptr = I.pointer && I.pointer.down ? I.pointer : null;
    if (C.touchMode === 'relative' && drag) {
      // 1:1 with the finger (focus does not slow a drag: the thumb is the precision)
      s.x += I.dragX * C.dragScale;
      s.y += I.dragY * C.dragScale;
      s.vx = s.vy = 0;
    } else if (C.touchMode === 'follow' && ptr) {
      const tx = ptr.x, ty = ptr.y + C.followOffsetY;
      const dx = tx - s.x, dy = ty - s.y, d = Math.hypot(dx, dy);
      const max = C.followSpeed * mul * dt;
      if (d <= max) { s.x = tx; s.y = ty; } else { s.x += (dx / d) * max; s.y += (dy / d) * max; }
      s.vx = s.vy = 0;
    } else {
      // ---- keys / stick
      let ix = I.moveX, iy = I.moveY;
      const m = Math.hypot(ix, iy);
      if (m > 1) { ix /= m; iy /= m; }
      const r = C.accel * dt;
      s.vx = approach(s.vx, ix * C.speed * mul, r);
      s.vy = approach(s.vy, iy * C.speed * mul, r);
      s.x += s.vx * dt; s.y += s.vy * dt;
    }

    // ---- bounds
    if (C.bounds) {
      const b = C.bounds;
      const nx = clamp(s.x, b.x + C.w / 2, b.x + b.w - C.w / 2), ny = clamp(s.y, b.y + C.h / 2, b.y + b.h - C.h / 2);
      if (nx !== s.x) s.vx = 0;
      if (ny !== s.y) s.vy = 0;
      s.x = nx; s.y = ny;
    }
    if (Math.hypot(s.x - x0, s.y - y0) > 0.5) ev.act('move');

    // ---- fire cadence
    const touching = drag || !!ptr;
    touchT = touching ? 0.15 : Math.max(0, touchT - dt); // drag frames come in bursts: bridge the gaps
    s.firing = I.attack || I.attackHeld || C.autoFire === 'always' || (C.autoFire === 'touch' && touchT > 0);
    const rate = (s.focus && C.focusFireRate) || C.fireRate;
    const interval = 1 / Math.max(0.1, rate);
    cool -= dt;
    if (!s.firing) cool = Math.max(cool, 0);
    else {
      let n = 0;
      while (cool <= 1e-9 && n < 8) {
        const guns = (s.focus && C.focusGuns) || C.guns;
        s.shots++; n++;
        ev.emit('fire', { x: s.x, y: s.y, n: s.shots, focus: s.focus, guns: guns.map((g) => ({ x: s.x + g.x, y: s.y + g.y, angle: g.angle ?? -Math.PI / 2 })) });
        cool += interval;
      }
      if (n) ev.act('fire');
    }
    if (![s.x, s.y].every(Number.isFinite)) reset();
  }

  return {
    state: s,
    get events() { return ev.events; },
    step,
    reset,
    lastAction: () => ev.last(),
    setBounds(b) { C.bounds = b; },
    /** the ship's hit rect (top-left), e.g. a smaller core for bullet-hell games */
    box: (core = 1) => ({ x: s.x - (C.w * core) / 2, y: s.y - (C.h * core) / 2, w: C.w * core, h: C.h * core }),
    options: C,
  };
}
