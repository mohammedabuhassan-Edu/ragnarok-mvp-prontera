// loop.js — fixed-step game loop plus a seeded random number generator.
//
// The simulation always advances in fixed steps (60 Hz by default), so the
// game plays the same on a 30 Hz phone and a 144 Hz monitor, and a seeded run
// is reproducible. Rendering happens once per animation frame and gets an
// `alpha` (0..1) that says how far we are between two simulation steps, for
// optional interpolation.

/**
 * Deterministic RNG (mulberry32). Same seed -> same stream.
 * @param {number|string} seed
 * @returns {{ next():number, int(a:number,b:number):number, pick<T>(arr:T[]):T, seed:number }}
 */
export function createRng(seed = 1) {
  let s = typeof seed === 'string' ? hashString(seed) : (seed >>> 0);
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    seed: s,
    next,
    /** integer in [a, b], both inclusive */
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    /** random float in [a, b) */
    range: (a, b) => a + next() * (b - a),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

// FNV-1a, so a Blueprint can use a readable seed such as "neon-city".
function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * @param {object} o
 * @param {number} [o.step=1/60]   simulation step in seconds
 * @param {(dt:number, t:number) => void} o.update   called once per step
 * @param {(alpha:number, frameDt:number) => void} [o.render]  called once per frame
 * @param {number} [o.maxSteps=5]  cap of steps per frame; extra time is dropped
 * Test hooks (defaults are the browser globals):
 * @param {() => number} [o.now]   ms clock
 * @param {(cb:Function) => any} [o.raf]
 * @param {(id:any) => void} [o.caf]
 * @param {Document|null} [o.doc] document for pause-when-hidden (null disables)
 */
export function createLoop({
  step = 1 / 60, update, render = () => {}, maxSteps = 5,
  now = () => performance.now(),
  raf = (cb) => requestAnimationFrame(cb),
  caf = (id) => cancelAnimationFrame(id),
  doc = typeof document !== 'undefined' ? document : null,
} = {}) {
  let running = false;
  let paused = false;      // paused by the game (pause menu)
  let hidden = false;      // paused because the tab is hidden
  let rafId = null;
  let last = 0;
  let acc = 0;
  let simT = 0;
  let frames = 0;
  // A tiny tolerance so float drift (e.g. 10 ms frames vs a 1/60 s step)
  // never loses or gains a step.
  const EPS = 1e-7;

  function tick() {
    if (!running) return;
    rafId = raf(tick);
    const t = now();
    let frameDt = (t - last) / 1000;
    last = t;
    if (frameDt < 0) frameDt = 0;
    frames++;

    if (!paused && !hidden) {
      acc += frameDt;
      let steps = 0;
      while (acc + EPS >= step && steps < maxSteps) {
        update(step, simT);
        simT += step;
        acc -= step;
        steps++;
      }
      // After a stall (tab switch, GC, debugger) do not try to catch up:
      // drop the backlog so the game does not fast-forward.
      if (steps === maxSteps && acc >= step) acc = 0;
    }
    render(paused || hidden ? 0 : Math.min(1, acc / step), frameDt);
  }

  function onVisibility() {
    hidden = doc.visibilityState === 'hidden';
    if (!hidden) { last = now(); acc = 0; }
  }
  if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', onVisibility);

  return {
    start() {
      if (running) return;
      running = true;
      last = now();
      acc = 0;
      rafId = raf(tick);
    },
    stop() {
      running = false;
      if (rafId != null) caf(rafId);
      rafId = null;
    },
    /** pause(true) freezes updates (render keeps running for menus) */
    pause(b = true) {
      const was = paused;
      paused = !!b;
      if (was && !paused) { last = now(); acc = 0; }
    },
    get paused() { return paused || hidden; },
    get running() { return running; },
    /** simulated seconds since start */
    get t() { return simT; },
    /** rendered frames since start */
    get frame() { return frames; },
    destroy() {
      this.stop();
      if (doc && doc.removeEventListener) doc.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
