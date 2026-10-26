// selftest.js — the self-test contract (spec §5.4).
//
//   window.__game.test() -> Promise<{ pass, total, failures[] }>
//   ?test in the URL      -> runs it after the game boots and writes
//                            "TEST PASS n/m" or "TEST FAIL <names>" into document.title
//
// Built-in checks always run first:
//   brand          __game.brand.count() >= 3
//   brand-visible  __game.brand.visibleAtStart() === true
//   errors         no uncaught error / unhandled rejection since install
// Install it as early as possible so the error check sees boot errors.
//
// Games that load data or build their world first pass { autoRun: false } and
// call window.__game.ready() (or the returned ready()) once the world exists:
// the ?test run then starts `delay` ms after ready() instead of after install.

const CHECK_TIMEOUT_MS = 10000;

/**
 * @param {object} o
 * @param {{name:string, run:() => Promise<boolean>|boolean}[]} [o.checks]  game checks
 * @param {object} [o.brand]  defaults to window.__game.brand at run time
 * @param {number} [o.delay=2500]  ms to wait before the ?test run (let frames render): counted from
 *   install, or from ready() when autoRun is false
 * @param {boolean} [o.autoRun=true]  false: wait for __game.ready() before the ?test run
 * Test hooks: o.window, o.document (default: the globals)
 * @returns {{ test: () => Promise<object>, ready: () => void, result: Promise<object>|null, errors: string[] }}
 */
export function installSelfTest({ checks = [], brand, delay = 2500, autoRun = true, window: win, document: doc } = {}) {
  const W = win || (typeof window !== 'undefined' ? window : null);
  const D = doc || (typeof document !== 'undefined' ? document : null);
  const errors = [];       // uncaught page errors (fail the 'errors' check)
  const checkErrors = [];  // checks that threw (reported, but only fail their own check)

  if (W && W.addEventListener) {
    W.addEventListener('error', (e) => errors.push(String(e?.message || e?.error || 'error')));
    W.addEventListener('unhandledrejection', (e) => errors.push(String(e?.reason?.message || e?.reason || 'rejection')));
  }

  const getBrand = () => brand || (W && W.__game && W.__game.brand) || null;

  const builtIn = [
    { name: 'brand', run: () => { const b = getBrand(); return !!b && b.count() >= 3; } },
    { name: 'brand-visible', run: () => { const b = getBrand(); return !!b && b.visibleAtStart() === true; } },
    { name: 'errors', run: () => errors.length === 0 },
  ];

  async function runOne(c) {
    let timer;
    try {
      const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(false), CHECK_TIMEOUT_MS); });
      return (await Promise.race([Promise.resolve().then(() => c.run()), timeout])) === true;
    } catch (err) {
      checkErrors.push(`${c.name}: ${err && err.message ? err.message : err}`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  const isTestMode = () => {
    try { return new URLSearchParams(W?.location?.search || '').has('test'); } catch { return false; }
  };

  async function test() {
    checkErrors.length = 0;
    const all = [...builtIn, ...checks];
    const failures = [];
    for (const c of all) if (!(await runOne(c))) failures.push(c.name);
    const res = { pass: failures.length === 0, total: all.length, failures, errors: errors.slice(0, 10), checkErrors: checkErrors.slice() };
    if (D && isTestMode()) {
      D.title = res.pass ? `TEST PASS ${all.length}/${all.length}` : `TEST FAIL ${failures.join(' ')}`;
    }
    return res;
  }

  // ready(): the game says its world exists. Starts the ?test run when autoRun is false; safe to call twice.
  let isReady = false;
  let startRun = null;
  function ready() {
    if (isReady) return;
    isReady = true;
    if (W && W.__game) W.__game.isReady = true;
    if (startRun) startRun();
  }

  if (W) {
    W.__game = W.__game || {};
    W.__game.test = test;
    W.__game.ready = ready;
    W.__game.isReady = false;
  }

  let result = null;
  if (isTestMode()) {
    const wait = () => new Promise((resolve) => setTimeout(resolve, delay)).then(test);
    result = autoRun ? wait() : new Promise((resolve) => { startRun = () => resolve(wait()); });
  }
  return { test, ready, result, errors };
}
