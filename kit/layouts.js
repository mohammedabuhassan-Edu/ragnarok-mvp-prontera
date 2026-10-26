// layouts.js — the touch + key layout for each game type, ready for createInput.
//
//   const input = createInput(canvas, layoutFor('crawler'));
//
// Every layout names its controls the way the controller intents expect them
// (ctrl2d intentFromInput2d's DEFAULT_MAP, ctrl3d intentFromInput3d's
// DEFAULT_INPUT_MAP), so no input map is needed. Every control has an `expect`
// hint for the verify controls pass, its keys, and a phone place for the
// thumbs: a floating joystick (left half) or a d-pad (bottom left), action
// buttons bottom right. Labels are short ASCII words or plain arrows.
//
// Change a layout by editing the returned object before createInput (it is a
// fresh copy every call):
//   const o = layoutFor('vehicle');
//   o.buttons.push({ name: 'drift', label: 'DRIFT', keys: ['Space'], expect: 'action' });
//
//   kind          controls (touch)                               controller
//   platformer    joystick + JUMP (up looks up, down ducks)      ctrl2d createPlatformer
//   topdown       joystick + DASH, USE                           ctrl2d createTopDown
//   grid          d-pad (step) + UNDO                            ctrl2d createGridMover
//   brawler       joystick + PUNCH, JUMP, KICK, GRAB             ctrl2d createBrawler
//   runner        lane buttons < > + JUMP, SLIDE                 ctrl2d createRunner (mode 'lanes')
//                 { mode: 'free' }: JUMP, SLIDE only             ctrl2d createRunner (mode 'free')
//   shmup         drag anywhere + FIRE, FOCUS                    ctrl2d createShmup
//
// Options (the second argument):
//   layoutFor('runner', { mode: 'free' })              a side-view auto-runner has no lanes: no lane buttons
//   layoutFor('platformer', { lookUpDown: false })     only left / right are declared (createPlatformer
//                                                      lookUpDown: false, where up / down do nothing)
//   crawler       d-pad (step, turn) + USE, strafe < >           ctrl3d createGridCrawler
//   walker        joystick + drag-look + JUMP, USE               ctrl3d createWalker
//   vehicle       steer < > + GAS, BRAKE                         ctrl3d createVehicle
//   platformer3d  joystick + drag-look + JUMP                    ctrl3d createPlatformer3d
//   topdown3d     joystick + USE                                 ctrl3d createTopdown3d

/** every kind layoutFor() knows */
export const LAYOUT_KINDS = Object.freeze([
  'platformer', 'topdown', 'grid', 'brawler', 'runner', 'shmup',
  'crawler', 'walker', 'vehicle', 'platformer3d', 'topdown3d',
]);

// A d-pad cross at the bottom left: [offset-x, offset-y, size] in px from the corner.
const DPAD = { up: [64, 122, 54], down: [64, 6, 54], left: [6, 64, 54], right: [122, 64, 54] };
const KEYS = { up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'] };

const dir = (name, label, expect, at, hint) => ({ name, label, keys: KEYS[name].slice(), side: 'left', at: at.slice(), expect, ...(hint ? { hint } : {}) });
const jump = () => ({ name: 'jump', label: 'JUMP', keys: ['Space', 'KeyK'], expect: 'jump' });

const BUILD = {
  // ------------------------------------------------------------------ 2D (ctrl2d)
  // up / down: createPlatformer's look-up / duck (lookUpDown, on by default); without it only left / right are controls
  platformer: (o) => ({ joystick: true, moveExpect: 'move', ...(o.lookUpDown === false ? { axes: ['left', 'right'] } : {}), buttons: [jump()] }),
  topdown: () => ({ joystick: true, moveExpect: 'move', buttons: [
    { name: 'dash', label: 'DASH', keys: ['ShiftLeft', 'ShiftRight', 'Space'], expect: 'move' },
    { name: 'action', label: 'USE', keys: ['KeyE', 'Enter'], expect: 'action' },
  ] }),
  grid: () => ({ joystick: false, moveExpect: 'step', buttons: [
    dir('up', '▲', 'step', DPAD.up), dir('down', '▼', 'step', DPAD.down),
    dir('left', '◀', 'step', DPAD.left), dir('right', '▶', 'step', DPAD.right),
    { name: 'undo', label: 'UNDO', keys: ['KeyZ', 'Backspace', 'KeyU'], expect: 'action' },
  ] }),
  brawler: () => ({ joystick: true, moveExpect: 'move', buttons: [
    { name: 'attack', label: 'PUNCH', keys: ['KeyJ', 'KeyF', 'KeyZ'], expect: 'action' },
    jump(),
    { name: 'special', label: 'KICK', keys: ['KeyL', 'KeyX'], expect: 'action' },
    { name: 'grab', label: 'GRAB', keys: ['KeyE', 'KeyC'], expect: 'action' },
  ] }),
  // mode 'lanes' (default): the lane buttons switch lanes; mode 'free' runs on its own, so it has none
  runner: (o) => ({ joystick: false, moveExpect: 'move', buttons: [
    ...(o.mode === 'free' ? [] : [dir('left', '◀', 'move', [6, 30, 66]), dir('right', '▶', 'move', [88, 30, 66])]),
    jump(),
    { name: 'special', label: 'SLIDE', keys: ['KeyS', 'ArrowDown', 'ShiftLeft'], expect: 'action' },
  ] }),
  // drag anywhere moves the ship (intentFromInput2d(input, null, { look: true })); keys move 8-way
  shmup: () => ({ joystick: false, dragLook: true, moveExpect: 'move', buttons: [
    { name: 'attack', label: 'FIRE', keys: ['KeyJ', 'KeyZ', 'Space'], expect: 'action' },
    { name: 'focus', label: 'FOCUS', keys: ['ShiftLeft', 'ShiftRight'], expect: 'move' },
  ] }),

  // ------------------------------------------------------------------ 3D (ctrl3d)
  // up / down step, left / right turn (the crawler's lateral 'turn'); Q / E strafe, so E is unbound from 'use'
  crawler: () => ({ joystick: false, moveExpect: 'step', unbind: ['KeyE'], buttons: [
    dir('up', '▲', 'step', DPAD.up), dir('down', '▼', 'step', DPAD.down),
    dir('left', '◀', 'turn', DPAD.left, 'TURN'), dir('right', '▶', 'turn', DPAD.right, 'TURN'),
    { name: 'use', label: 'USE', keys: ['Space', 'Enter', 'KeyF'], expect: 'action' },
    { name: 'strafeLeft', label: '<', hint: 'STEP', keys: ['KeyQ'], at: [92, 122, 56], expect: 'step' },
    { name: 'strafeRight', label: '>', hint: 'STEP', keys: ['KeyE'], at: [22, 122, 56], expect: 'step' },
  ] }),
  // stick moves, drag on the right half orbits the camera (third person) or looks (first person)
  walker: () => ({ joystick: true, dragLook: true, moveExpect: 'move', buttons: [
    jump(),
    { name: 'use', label: 'USE', keys: ['KeyE', 'Enter'], expect: 'action' },
  ] }),
  vehicle: () => ({ joystick: false, moveExpect: 'move', buttons: [
    dir('left', '◀', 'turn', [10, 30, 76]), dir('right', '▶', 'turn', [100, 30, 76]),
    { name: 'up', label: 'GAS', keys: KEYS.up.slice(), expect: 'move' },
    { name: 'down', label: 'BRAKE', keys: KEYS.down.slice(), expect: 'move' },
  ] }),
  platformer3d: () => ({ joystick: true, dragLook: true, moveExpect: 'move', buttons: [jump()] }),
  topdown3d: () => ({ joystick: true, moveExpect: 'move', buttons: [
    { name: 'use', label: 'USE', keys: ['KeyE', 'Enter'], expect: 'action' },
  ] }),
};

/**
 * createInput options for a game type (a fresh object every call).
 * @param {'platformer'|'topdown'|'grid'|'brawler'|'runner'|'shmup'|'crawler'|'walker'|'vehicle'|'platformer3d'|'topdown3d'} kind
 * @param {object} [o]
 * @param {'lanes'|'free'} [o.mode='lanes']   runner: 'free' drops the lane buttons (match createRunner's mode)
 * @param {boolean} [o.lookUpDown=true]       platformer: false declares only left / right (match createPlatformer's lookUpDown)
 * @returns {{joystick:boolean, dragLook?:boolean, moveExpect:string, unbind?:string[], axes?:string[], buttons:object[]}}
 */
export function layoutFor(kind, o = {}) {
  const make = BUILD[kind];
  if (!make) throw new Error(`layoutFor: unknown kind "${kind}" (have: ${LAYOUT_KINDS.join(', ')})`);
  return make(o || {});
}
