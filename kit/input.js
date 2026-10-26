// input.js — touch-first input: floating joystick, context buttons, drag-to-look,
// taps, and the keyboard as a full alternative.
//
//   const input = createInput(canvas, { buttons: [{ name: 'jump', label: '⤒' }] });
//   input.axis.x / input.axis.y   -1..1 (x: right is +, y: forward/up is +)
//   input.look.dx / .dy           accumulated drag pixels (call consumeLook() each frame)
//   input.held('jump')            true while down (button, or its key)
//   input.pressed('jump')         true once per press (edge-triggered)
//
//   input.describe()              every declared control (see describe() below);
//                                 window.__game.controls() returns the same list
//
// Multi-touch: every pointer is tracked by id, so the thumb on the joystick and
// a second thumb on a button (or dragging to look) work at the same time.
// Never uses pointer lock (it fails on phones and in Telegram).

const DEAD_ZONE = 0.14;     // of the stick radius
const RADIUS = 58;          // px, knob travel
const TAP_MS = 280;
const TAP_PX = 12;

// Default keyboard map: key code -> logical names.
const DEFAULT_KEYS = {
  KeyW: ['up'], ArrowUp: ['up'], KeyS: ['down'], ArrowDown: ['down'],
  KeyA: ['left'], ArrowLeft: ['left'], KeyD: ['right'], ArrowRight: ['right'],
  Space: ['jump'], ShiftLeft: ['boost'], ShiftRight: ['boost'], KeyE: ['use'], KeyF: ['fire'],
  Enter: ['start'],
};
const SCROLL_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

const CSS = `
.gk-input{position:fixed;inset:0;z-index:30;pointer-events:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
.gk-stick{position:absolute;width:${RADIUS * 2 + 8}px;height:${RADIUS * 2 + 8}px;margin:-${RADIUS + 4}px 0 0 -${RADIUS + 4}px;border-radius:50%;
  background:radial-gradient(circle at 50% 50%,rgba(42,99,238,.22),rgba(14,19,34,.28) 62%,rgba(134,180,255,.10) 63%,rgba(14,19,34,.22) 70%);
  border:2px solid rgba(134,180,255,.45);box-shadow:0 0 24px rgba(42,99,238,.25),inset 0 0 18px rgba(76,134,255,.18);
  opacity:0;transition:opacity .18s ease;will-change:transform,opacity}
.gk-stick.gk-idle{opacity:.38}
.gk-stick.gk-live{opacity:1;transition:none}
.gk-knob{position:absolute;left:50%;top:50%;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;
  background:radial-gradient(circle at 38% 32%,#EAF2FF 0,#86B4FF 22%,#4C86FF 55%,#2A63EE 100%);
  box-shadow:0 4px 14px rgba(0,0,0,.35),0 0 calc(10px + var(--m,0) * 26px) rgba(76,134,255,calc(.35 + var(--m,0) * .5));will-change:transform}
.gk-btn-touch{position:absolute;border-radius:50%;display:grid;place-items:center;pointer-events:auto;touch-action:none;
  font:800 22px/1 system-ui,-apple-system,"Segoe UI",sans-serif;color:#EAF2FF;text-shadow:0 1px 2px rgba(0,0,0,.5);
  background:radial-gradient(circle at 50% 35%,rgba(76,134,255,.55),rgba(14,19,34,.55) 75%);border:2px solid rgba(134,180,255,.55);
  box-shadow:0 6px 18px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.25);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  transition:transform .08s ease,box-shadow .08s ease,background .08s ease}
.gk-btn-touch.gk-down{transform:scale(.9);background:radial-gradient(circle at 50% 35%,rgba(134,180,255,.85),rgba(42,99,238,.7) 75%);
  box-shadow:0 0 26px rgba(76,134,255,.75),inset 0 1px 0 rgba(255,255,255,.4)}
.gk-btn-touch small{display:block;font-size:10px;font-weight:700;letter-spacing:.06em;opacity:.8;margin-top:2px;text-transform:uppercase}
.gk-input.gk-notouch .gk-btn-touch,.gk-input.gk-notouch .gk-stick.gk-idle{display:none}
.gk-input.gk-off{display:none}
`;

// Button slots around the bottom corner: [offset-x, offset-y, size] in px from the corner.
const SLOTS = [[22, 26, 86], [122, 30, 66], [30, 126, 66], [120, 118, 56], [206, 30, 56]];

// What one press of a control should do (the optional `expect` hint, read by verify-game.mjs):
//   step    one press = one step on a grid (verify flags a tap that moves more than 1.5 steps)
//   move    continuous movement while held      turn    turns the player or camera
//   action  a one-shot action (use, fire)        jump    a jump
//   toggle  switches something on and off (map)  menu    opens or closes a menu
export const CONTROL_EXPECTS = ['step', 'move', 'turn', 'action', 'jump', 'toggle', 'menu'];
const expectOf = (v) => (CONTROL_EXPECTS.includes(v) ? v : null);
// The joystick's four directions: [name, label, drag direction on screen].
const AXIS_CONTROLS = [['up', 'Up', [0, -1]], ['down', 'Down', [0, 1]], ['left', 'Left', [-1, 0]], ['right', 'Right', [1, 0]]];

// Every live input (createInput, until destroy()), for window.__game.controls().
const LIVE = new Set();

/**
 * Every declared control of every live input, or null when the game never
 * called createInput (window.__game.controls() returns this; see index.js).
 */
export function describeControls() {
  if (LIVE.size === 0) return null;
  return [...LIVE].flatMap((i) => i.describe());
}

/**
 * @param {HTMLElement} el  the game surface (usually the canvas)
 * @param {object} [o]
 * @param {boolean} [o.joystick=true]   floating stick on the left half
 * @param {{name:string,label?:string,hint?:string,side?:'right'|'left',keys?:string[],hidden?:boolean,expect?:string,at?:number[]}[]} [o.buttons]
 *   hidden: start hidden (context buttons such as "enter"); show(name) / hide(name) / setLabel(name, label, hint) later
 *   expect: what one press should do (CONTROL_EXPECTS), read by the verify controls pass
 *   at: [offsetX, offsetY, size] in px from the bottom corner of its side (a d-pad cross);
 *       without it the button takes the next free round slot of its side
 *   A button named 'up' / 'down' / 'left' / 'right' also drives input.axis (a d-pad).
 * @param {{name:string,label?:string,keys:string[],expect?:string}[]} [o.keyControls]
 *   keyboard-only controls (a map key, a strafe key): held(name) / pressed(name) work for them too,
 *   and describe() lists them, so verify presses them like every other control
 * @param {string} [o.moveExpect='move']  the joystick / WASD directions' expect ('step' in a grid game)
 * @param {boolean} [o.dragLook=false]  right half drag (or mouse drag) feeds look.dx/dy
 * @param {'auto'|boolean} [o.touchUI='auto']  show touch controls (auto: coarse pointer or first touch)
 * @param {string[]} [o.unbind]  key codes whose default names are dropped (['KeyE']: E no longer means 'use'),
 *   so a declared control can own the key alone
 * @param {string[]} [o.axes=['up','down','left','right']]  the joystick / WASD directions describe() declares
 *   (verify presses each one): ['left', 'right'] for a game whose up / down do nothing. The stick and the
 *   keys still fill input.axis in every direction; this only says which directions are controls.
 */
export function createInput(el, { joystick = true, buttons = [], keyControls = [], moveExpect = 'move', dragLook = false, touchUI = 'auto', unbind = [], axes = null } = {}) {
  const axisNames = Array.isArray(axes) ? axes : AXIS_CONTROLS.map(([n]) => n);
  const keyMap = {};
  for (const [code, names] of Object.entries(DEFAULT_KEYS)) if (!unbind.includes(code)) keyMap[code] = names.slice();
  for (const b of [...buttons, ...keyControls]) for (const code of b.keys || []) (keyMap[code] ||= []).includes(b.name) || keyMap[code].push(b.name);
  // Keys a declared button or key control owns: the joystick directions do not list them again.
  const claimed = new Set([...buttons, ...keyControls].flatMap((b) => b.keys || []));

  const keysDown = new Set();       // key codes
  const heldBy = new Map();         // name -> Set of sources ('k:Space', 'p:12')
  const edges = new Set();          // names pressed since last pressed() read
  const tapFns = [];
  let active = true;
  const look = { dx: 0, dy: 0 };
  const stick = { x: 0, y: 0, id: null, ox: 0, oy: 0 };
  const lookPtr = { id: null, x: 0, y: 0 };
  const downs = new Map();          // pointerId -> {t, x, y, moved}

  function hold(name, src) {
    let s = heldBy.get(name);
    if (!s) heldBy.set(name, (s = new Set()));
    if (s.size === 0) edges.add(name);
    s.add(src);
  }
  function release(name, src) {
    const s = heldBy.get(name);
    if (s) s.delete(src);
  }
  const isHeld = (name) => (heldBy.get(name)?.size || 0) > 0;

  // ------------------------------------------------------------ axis (always fresh)
  const axis = {
    get x() { return combined().x; },
    get y() { return combined().y; },
  };
  function combined() {
    let x = stick.x + (isHeld('right') ? 1 : 0) - (isHeld('left') ? 1 : 0);
    let y = stick.y + (isHeld('up') ? 1 : 0) - (isHeld('down') ? 1 : 0);
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  // ------------------------------------------------------------ keyboard
  const onKeyDown = (e) => {
    const names = keyMap[e.code];
    if (!names || !active) return;
    if (SCROLL_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    keysDown.add(e.code);
    for (const n of names) hold(n, 'k:' + e.code);
  };
  const onKeyUp = (e) => {
    const names = keyMap[e.code];
    if (!names) return;
    keysDown.delete(e.code);
    for (const n of names) release(n, 'k:' + e.code);
  };
  const onBlur = () => {
    for (const s of heldBy.values()) s.clear();
    keysDown.clear();
    resetStick();
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  // ------------------------------------------------------------ overlay DOM
  if (!document.getElementById('gk-input-css')) {
    const st = document.createElement('style');
    st.id = 'gk-input-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  el.style.touchAction = 'none';
  el.style.webkitUserSelect = 'none';
  el.style.userSelect = 'none';
  const onContext = (e) => e.preventDefault();
  el.addEventListener('contextmenu', onContext);

  const layer = document.createElement('div');
  layer.className = 'gk-input';
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  // 'auto': visible on coarse-pointer devices; otherwise shown on the first touch.
  const touchVisible = touchUI === true || (touchUI === 'auto' && coarse);
  if (!touchVisible) layer.classList.add('gk-notouch');

  const base = document.createElement('div');
  base.className = 'gk-stick';
  const knob = document.createElement('div');
  knob.className = 'gk-knob';
  base.appendChild(knob);
  if (joystick) layer.appendChild(base);

  // Resting spot for the idle hint (bottom-left, respecting the safe area).
  function placeIdle() {
    base.style.left = `calc(${RADIUS + 34}px + env(safe-area-inset-left))`;
    base.style.top = `calc(100% - ${RADIUS + 40}px - env(safe-area-inset-bottom))`;
    base.style.transform = '';
    knob.style.transform = '';
    knob.style.setProperty('--m', 0);
    base.classList.remove('gk-live');
    base.classList.add('gk-idle');
  }
  placeIdle();

  const btnEls = [];
  const btnByName = new Map();      // name -> { el, release }
  const sideCount = { right: 0, left: 0 };
  for (const b of buttons) {
    const side = b.side === 'left' ? 'left' : 'right';
    const [ox, oy, size] = Array.isArray(b.at) && b.at.length >= 3 ? b.at : SLOTS[sideCount[side]++ % SLOTS.length];
    const n = document.createElement('div');
    n.className = 'gk-btn-touch';
    n.setAttribute('role', 'button');
    n.setAttribute('aria-label', b.hint || b.name);
    n.setAttribute('data-bd-control', b.name);
    n.style.width = n.style.height = size + 'px';
    n.style[side] = `calc(${ox}px + env(safe-area-inset-${side}))`;
    n.style.bottom = `calc(${oy}px + env(safe-area-inset-bottom))`;
    n.style.fontSize = Math.round(size * 0.3) + 'px';
    n.textContent = b.label ?? b.name;
    if (b.hint) { const s = document.createElement('small'); s.textContent = b.hint; n.appendChild(s); }
    const src = new Set();
    const down = (e) => {
      e.preventDefault(); e.stopPropagation();
      try { n.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      src.add(e.pointerId);
      hold(b.name, 'p:' + e.pointerId);
      n.classList.add('gk-down');
      if (navigator.vibrate) try { navigator.vibrate(8); } catch { /* ignore */ }
    };
    const up = (e) => {
      if (!src.has(e.pointerId)) return;
      src.delete(e.pointerId);
      release(b.name, 'p:' + e.pointerId);
      if (src.size === 0) n.classList.remove('gk-down');
    };
    n.addEventListener('pointerdown', down);
    n.addEventListener('pointerup', up);
    n.addEventListener('pointercancel', up);
    n.addEventListener('lostpointercapture', up);
    if (b.hidden) n.style.display = 'none';
    layer.appendChild(n);
    btnEls.push(n);
    btnByName.set(b.name, {
      el: n,
      release() {
        for (const id of src) release(b.name, 'p:' + id);
        src.clear();
        n.classList.remove('gk-down');
      },
    });
  }
  document.body.appendChild(layer);

  function showTouchUI() { layer.classList.remove('gk-notouch'); }

  // ------------------------------------------------------------ pointers on the surface
  function resetStick() {
    stick.id = null; stick.x = 0; stick.y = 0;
    placeIdle();
  }

  const onDown = (e) => {
    if (!active) return;
    const r = el.getBoundingClientRect();
    const touchLike = e.pointerType !== 'mouse';
    if (touchLike) showTouchUI();
    downs.set(e.pointerId, { t: performance.now(), x: e.clientX, y: e.clientY, moved: false });

    const leftHalf = e.clientX < r.left + r.width * 0.5;
    if (joystick && touchLike && leftHalf && stick.id === null) {
      stick.id = e.pointerId;
      // Keep the whole base on screen even when the thumb lands at the edge.
      const m = RADIUS + 10;
      stick.ox = Math.min(Math.max(e.clientX, r.left + m), r.right - m);
      stick.oy = Math.min(Math.max(e.clientY, r.top + m), r.bottom - m);
      base.classList.remove('gk-idle');
      base.classList.add('gk-live');
      base.style.left = stick.ox + 'px';
      base.style.top = stick.oy + 'px';
      moveStick(e.clientX, e.clientY);
    } else if (dragLook && lookPtr.id === null && (!touchLike || !joystick || !leftHalf)) {
      lookPtr.id = e.pointerId; lookPtr.x = e.clientX; lookPtr.y = e.clientY;
    }
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  function moveStick(cx, cy) {
    let dx = cx - stick.ox, dy = cy - stick.oy;
    const dist = Math.hypot(dx, dy);
    if (dist > RADIUS) { dx = dx / dist * RADIUS; dy = dy / dist * RADIUS; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const raw = Math.min(1, dist / RADIUS);
    if (raw < DEAD_ZONE || dist === 0) { stick.x = 0; stick.y = 0; knob.style.setProperty('--m', 0); return; }
    // Rescale so output starts at 0 right outside the dead zone (no jump).
    const mag = (raw - DEAD_ZONE) / (1 - DEAD_ZONE);
    const ux = (cx - stick.ox) / dist, uy = (cy - stick.oy) / dist;
    stick.x = ux * mag;
    stick.y = -uy * mag; // screen up = forward
    knob.style.setProperty('--m', mag.toFixed(3));
  }

  const onMove = (e) => {
    const d = downs.get(e.pointerId);
    if (d && !d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_PX) d.moved = true;
    if (e.pointerId === stick.id) moveStick(e.clientX, e.clientY);
    else if (e.pointerId === lookPtr.id) {
      look.dx += e.clientX - lookPtr.x;
      look.dy += e.clientY - lookPtr.y;
      lookPtr.x = e.clientX; lookPtr.y = e.clientY;
    }
  };

  const onUp = (e) => {
    const d = downs.get(e.pointerId);
    downs.delete(e.pointerId);
    if (e.pointerId === stick.id) resetStick();
    if (e.pointerId === lookPtr.id) lookPtr.id = null;
    if (e.type === 'pointerup' && d && !d.moved && performance.now() - d.t < TAP_MS) {
      for (const fn of tapFns.slice()) fn({ x: e.clientX, y: e.clientY, pointerType: e.pointerType });
    }
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);

  const keysOf = (name) => Object.keys(keyMap).filter((c) => keyMap[c].includes(name));
  /**
   * Every declared control, as the verify controls pass reads it:
   *   { name, label, keys, kind: 'axis'|'button'|'key', expect, visible, touch, touchVisible, selector, drag, el }
   * axis    the joystick's directions (joystick: true; all four, or the `axes` list): WASD / arrows not owned by a button,
   *         touch 'joystick', drag = the screen direction to push the stick
   * button  a declared on-screen button: touch 'button', selector '[data-bd-control="<name>"]', el the element
   * key     a keyControls entry: keyboard only (touch null)
   * visible: usable right now (the input is active and the button is not hidden);
   * touchVisible: its on-screen part shows right now (touch UI on).
   */
  function describe() {
    const touchOn = active && !layer.classList.contains('gk-notouch');
    const out = [];
    if (joystick) {
      for (const [name, label, drag] of AXIS_CONTROLS) {
        if (!axisNames.includes(name)) continue;
        out.push({
          name, label, keys: keysOf(name).filter((c) => !claimed.has(c)), kind: 'axis', expect: expectOf(moveExpect),
          visible: active, touch: 'joystick', touchVisible: touchOn, selector: null, drag: drag.slice(), el: null,
        });
      }
    }
    for (const b of buttons) {
      const shownNow = btnByName.get(b.name)?.el.style.display !== 'none';
      out.push({
        name: b.name, label: String(b.label ?? b.name), keys: (b.keys || []).slice(), kind: 'button', expect: expectOf(b.expect),
        visible: active && shownNow, touch: 'button', touchVisible: touchOn && shownNow,
        selector: `[data-bd-control="${b.name}"]`, drag: null, el: btnByName.get(b.name)?.el ?? null,
      });
    }
    for (const k of keyControls) {
      out.push({
        name: k.name, label: String(k.label ?? k.name), keys: (k.keys || []).slice(), kind: 'key', expect: expectOf(k.expect),
        visible: active, touch: null, touchVisible: false, selector: null, drag: null, el: null,
      });
    }
    return out;
  }

  const api = {
    describe,
    axis,
    look,
    /** read and zero the drag-look delta (call once per frame) */
    consumeLook() { const r = { dx: look.dx, dy: look.dy }; look.dx = 0; look.dy = 0; return r; },
    held: isHeld,
    pressed(name) { if (edges.has(name)) { edges.delete(name); return true; } return false; },
    onTap(fn) { tapFns.push(fn); return () => { const i = tapFns.indexOf(fn); if (i >= 0) tapFns.splice(i, 1); }; },
    /** pause input (menus, game over): hides the controls, releases everything, ignores pointers */
    setActive(b = true) {
      active = !!b;
      layer.classList.toggle('gk-off', !active);
      if (!active) { onBlur(); lookPtr.id = null; downs.clear(); look.dx = look.dy = 0; }
    },
    get active() { return active; },
    /** show or hide the on-screen touch controls */
    showTouch(b = true) { layer.classList.toggle('gk-notouch', !b); },
    /** show one button again (after hide() or { hidden: true }) */
    show(name) { const b = btnByName.get(name); if (b) b.el.style.display = ''; return !!b; },
    /** hide one button; a finger holding it is released */
    hide(name) { const b = btnByName.get(name); if (b) { b.el.style.display = 'none'; b.release(); } return !!b; },
    /** is this button shown (it may still be off on a desktop without touch) */
    shown(name) { const b = btnByName.get(name); return !!b && b.el.style.display !== 'none'; },
    /** change a button's label and, optionally, its small hint line */
    setLabel(name, label, hint) {
      const b = btnByName.get(name);
      if (!b) return false;
      const n = b.el;
      const small = n.querySelector('small');
      n.textContent = label ?? name;
      const h = hint !== undefined ? hint : small?.textContent;
      if (h) { const s = document.createElement('small'); s.textContent = h; n.appendChild(s); }
      if (hint !== undefined) n.setAttribute('aria-label', hint || label || name);
      return true;
    },
    get touch() { return !layer.classList.contains('gk-notouch'); },
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('contextmenu', onContext);
      layer.remove();
      LIVE.delete(api);
    },
  };
  LIVE.add(api);
  return api;
}
