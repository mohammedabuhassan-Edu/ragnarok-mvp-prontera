// intent.js — one intent object per step, from the Kit input (keys, joystick
// and touch buttons all go through the same path).
//
//   const input = createInput(canvas, inputOptions('platformer'));
//   function update(dt) {
//     const intent = intentFromInput(input);          // read ONCE per step
//     player.step(intent, dt);
//   }
//
// intent = {
//   moveX, moveY        -1..1, SCREEN axes (+y is down), deadzone + curve applied
//   jump,  jumpHeld     jump: pressed since the last step (edge); jumpHeld: held now
//   attack, attackHeld  special, specialHeld   grab, grabHeld   action, actionHeld
//   dash, dashHeld      focus, focusHeld       undo
//   dragX, dragY        (opts.look) drag-look delta in world units
//   pointer             (opts.pointer) { x, y, down } in world units
// }
//
// Read the intent once per step and pass it to every controller that needs it:
// input.pressed() is edge-triggered, so a second reader in the same step
// would see false.

import { clamp } from './common.js';

/**
 * Logical intent names -> the input control names that drive them.
 * A control name is what createInput knows: a button's `name`, or a default
 * key name (Space = 'jump', Shift = 'boost', E = 'use', F = 'fire', Enter = 'start').
 */
export const DEFAULT_MAP = {
  jump: ['jump'],
  attack: ['attack', 'punch', 'fire'],
  special: ['special', 'heavy', 'kick'],
  grab: ['grab'],
  action: ['action', 'use'],
  dash: ['dash', 'boost'],
  focus: ['focus'],
  undo: ['undo'],
};

/** Joystick shaping that makes a short stick nudge move about as far as a key tap. */
export const AXIS_DEFAULTS = { deadzone: 0.12, saturate: 0.85, curve: 1 };

/**
 * Radial deadzone + outer saturation + response curve.
 * The Kit stick already removes its own small dead zone; this adds a little
 * more and, more importantly, treats anything past `saturate` as a full push,
 * so a quick thumb flick reaches full speed like a key does.
 * Keys give magnitude 1 and pass through unchanged (diagonals stay length 1).
 * @returns {{x:number, y:number, mag:number}}
 */
export function normalizeAxis(x, y, { deadzone = AXIS_DEFAULTS.deadzone, saturate = AXIS_DEFAULTS.saturate, curve = AXIS_DEFAULTS.curve } = {}) {
  x = Number.isFinite(x) ? x : 0;
  y = Number.isFinite(y) ? y : 0;
  const mag = Math.hypot(x, y);
  if (mag === 0 || mag <= deadzone) return { x: 0, y: 0, mag: 0 };
  let m = clamp((mag - deadzone) / Math.max(1e-6, saturate - deadzone), 0, 1);
  if (curve !== 1 && curve > 0) m **= curve;
  return { x: (x / mag) * m, y: (y / mag) * m, mag: m };
}

/** an intent with nothing pressed */
export function neutralIntent(extra) {
  const i = { moveX: 0, moveY: 0, dragX: 0, dragY: 0, pointer: null };
  for (const k of Object.keys(DEFAULT_MAP)) { i[k] = false; i[k + 'Held'] = false; }
  return Object.assign(i, extra || {});
}

/**
 * Build this step's intent from a Kit input (createInput).
 * @param {object} input   the Kit input: axis.x/.y (+y up), held(name), pressed(name), consumeLook(), active
 * @param {object} [map]   overrides of DEFAULT_MAP, e.g. { attack: ['punch'], special: ['kick'] }
 * @param {object} [opts]
 * @param {object} [opts.axis]       normalizeAxis options
 * @param {boolean} [opts.look]      consume the drag-look delta into dragX/dragY
 * @param {number} [opts.lookScale=1]  world units per screen pixel for dragX/dragY
 * @param {{x:number,y:number,down:boolean}} [opts.pointer]  a trackPointer() object, copied into intent.pointer
 */
export function intentFromInput(input, map, opts = {}) {
  const m = { ...DEFAULT_MAP, ...(map || {}) };
  const intent = neutralIntent();
  if (!input) return intent;
  // An inactive input (menus, game over) still drains its edges, so the
  // Space that started the game is not replayed as a jump on the first step.
  const live = input.active !== false;
  for (const [key, names] of Object.entries(m)) {
    const list = Array.isArray(names) ? names : [names];
    let edge = false, held = false;
    for (const n of list) {
      if (typeof input.pressed === 'function' && input.pressed(n)) edge = true;
      if (typeof input.held === 'function' && input.held(n)) held = true;
    }
    intent[key] = live && edge;
    intent[key + 'Held'] = live && held;
  }
  if (opts.look && typeof input.consumeLook === 'function') {
    const d = input.consumeLook();
    const s = Number.isFinite(opts.lookScale) ? opts.lookScale : 1;
    if (live) { intent.dragX = d.dx * s; intent.dragY = d.dy * s; }
  }
  if (!live) return intent;
  const ax = input.axis ? normalizeAxis(input.axis.x, input.axis.y, opts.axis) : { x: 0, y: 0 };
  intent.moveX = ax.x || 0;
  intent.moveY = ax.y ? -ax.y : 0; // the Kit axis is +y up; ctrl2d is +y down
  if (opts.pointer) intent.pointer = { x: opts.pointer.x, y: opts.pointer.y, down: !!opts.pointer.down };
  return intent;
}

/**
 * createInput options whose control names match DEFAULT_MAP, per controller.
 * Spread them into createInput (and add your own buttons after):
 *   createInput(canvas, inputOptions('brawler'))
 * Labels are plain ASCII so every font draws them; change them with setLabel().
 */
export function inputOptions(kind) {
  const jump = { name: 'jump', label: 'JUMP', keys: ['Space', 'KeyK'], expect: 'jump' };
  switch (kind) {
    case 'platformer':
      return { joystick: true, moveExpect: 'move', buttons: [jump] };
    case 'topdown':
      return { joystick: true, moveExpect: 'move', buttons: [
        { name: 'dash', label: 'DASH', keys: ['ShiftLeft', 'ShiftRight', 'Space'], expect: 'move' },
        { name: 'action', label: 'USE', keys: ['KeyE', 'Enter'], expect: 'action' },
      ] };
    case 'grid':
      return { joystick: true, moveExpect: 'step', buttons: [
        { name: 'undo', label: 'UNDO', keys: ['KeyZ', 'Backspace', 'KeyU'], expect: 'action' },
      ] };
    case 'brawler':
      return { joystick: true, moveExpect: 'move', buttons: [
        { name: 'attack', label: 'PUNCH', keys: ['KeyJ', 'KeyF', 'KeyZ'], expect: 'action' },
        { name: 'jump', label: 'JUMP', keys: ['Space', 'KeyK'], expect: 'jump' },
        { name: 'special', label: 'KICK', keys: ['KeyL', 'KeyX'], expect: 'action' },
        { name: 'grab', label: 'GRAB', keys: ['KeyE', 'KeyC'], expect: 'action' },
      ] };
    case 'runner':
      return { joystick: true, moveExpect: 'move', buttons: [
        jump,
        { name: 'special', label: 'SLIDE', keys: ['KeyS', 'ArrowDown', 'ShiftLeft'], expect: 'action' },
      ] };
    case 'shmup':
      // Touch: drag anywhere moves the ship (relative drag) and fires; keys move 8-way.
      return { joystick: false, dragLook: true, moveExpect: 'move', buttons: [
        { name: 'focus', label: 'FOCUS', keys: ['ShiftLeft', 'ShiftRight'], expect: 'move' },
        { name: 'attack', label: 'FIRE', keys: ['KeyJ', 'KeyZ', 'Space'], expect: 'action' },
      ] };
    default:
      return { joystick: true, moveExpect: 'move', buttons: [] };
  }
}

/**
 * Optional DOM helper (only touches the DOM when called): tracks the main
 * pointer's position in world units, for the shmup's follow-finger mode.
 *   const ptr = trackPointer(canvas, (cx, cy) => ({ x: view.x + cx * dpr / k, y: view.y + cy * dpr / k }));
 *   intentFromInput(input, null, { pointer: ptr })
 */
export function trackPointer(el, toWorld = (x, y) => ({ x, y })) {
  const p = { x: 0, y: 0, down: false, id: null };
  const at = (e) => {
    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0 };
    const w = toWorld(e.clientX - r.left, e.clientY - r.top);
    p.x = w.x; p.y = w.y;
  };
  const down = (e) => { if (p.id !== null) return; p.id = e.pointerId; p.down = true; at(e); };
  const move = (e) => { if (e.pointerId === p.id) at(e); };
  const up = (e) => { if (e.pointerId === p.id) { p.id = null; p.down = false; } };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  p.destroy = () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
  };
  return p;
}
