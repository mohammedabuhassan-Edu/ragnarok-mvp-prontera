// common.js — small shared helpers for the 2D controllers (pure: no DOM).
//
// Axes everywhere in ctrl2d are SCREEN axes: +x is right, +y is DOWN.
// Times are seconds, distances are world units (usually pixels).

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const easeOutCubic = (t) => { t = clamp(t, 0, 1); return 1 - (1 - t) ** 3; };
export const finite = (...v) => v.every(Number.isFinite);

/** move v toward target by at most `delta` (delta >= 0) */
export function approach(v, target, delta) {
  if (v < target) return Math.min(v + delta, target);
  if (v > target) return Math.max(v - delta, target);
  return v;
}

/** exponential smoothing factor for a rate (1/s) over dt: frame-rate independent */
export const damp = (rate, dt) => (rate <= 0 || !Number.isFinite(rate) ? 1 : 1 - Math.exp(-rate * dt));

/**
 * A full intent with every field present (missing fields become 0 / false).
 * moveX, moveY are -1..1 in screen axes (+y down).
 */
export function readIntent(i) {
  i = i || {};
  const mx = Number.isFinite(i.moveX) ? clamp(i.moveX, -1, 1) : 0;
  const my = Number.isFinite(i.moveY) ? clamp(i.moveY, -1, 1) : 0;
  return {
    ...i,
    moveX: mx, moveY: my,
    jump: !!i.jump, jumpHeld: !!i.jumpHeld,
    attack: !!i.attack, attackHeld: !!i.attackHeld,
    special: !!i.special, specialHeld: !!i.specialHeld,
    grab: !!i.grab, grabHeld: !!i.grabHeld,
    action: !!i.action, actionHeld: !!i.actionHeld,
    dash: !!i.dash, dashHeld: !!i.dashHeld,
    focus: !!i.focus, focusHeld: !!i.focusHeld,
    undo: !!i.undo,
  };
}

/**
 * Turns an analog value into -1 / 0 / +1 with hysteresis, so a stick that
 * wobbles around the threshold does not fire extra presses.
 *   const dx = createDigital(); dx(intent.moveX) -> -1|0|1
 */
export function createDigital(on = 0.5, off = 0.3) {
  let s = 0;
  const f = (v) => {
    v = Number.isFinite(v) ? v : 0;
    if (s === 0) { if (v >= on) s = 1; else if (v <= -on) s = -1; }
    else if (s === 1) { if (v <= -on) s = -1; else if (v < off) s = 0; }
    else { if (v >= on) s = 1; else if (v > -off) s = 0; }
    return s;
  };
  f.reset = () => { s = 0; };
  Object.defineProperty(f, 'value', { get: () => s });
  return f;
}

/**
 * The events list + lastAction() bookkeeping every controller shares.
 *   ctrl.events      events of the LAST step (cleared when the next step starts):
 *                    read them in the same update, right after step()
 *   ctrl.lastAction() "jump#3": the last thing the player did, with a counter so
 *                    two presses of the same control read as two changes
 */
export function createEvents(onEvent) {
  const events = [];
  let n = 0;
  let last = null;
  return {
    events,
    clear() { events.length = 0; },
    emit(type, data) {
      const e = { type, ...(data || {}) };
      events.push(e);
      if (typeof onEvent === 'function') { try { onEvent(e); } catch { /* the game's handler */ } }
      return e;
    },
    act(name) { n++; last = `${name}#${n}`; return last; },
    last: () => last,
    reset() { events.length = 0; n = 0; last = null; },
  };
}

/** merge user options over defaults, one level deep for plain objects */
export function withDefaults(defaults, opts) {
  const plain = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  const out = {};
  // copy plain-object defaults so a controller never mutates the shared defaults
  for (const [k, d] of Object.entries(defaults)) out[k] = plain(d) ? { ...d } : d;
  for (const [k, v] of Object.entries(opts || {})) {
    if (v === undefined) continue;
    const d = defaults[k];
    out[k] = d && typeof d === 'object' && !Array.isArray(d) && v && typeof v === 'object' && !Array.isArray(v) ? { ...d, ...v } : v;
  }
  return out;
}
