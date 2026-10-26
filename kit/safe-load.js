// safe-load.js — never let a missing asset stop the game.
//
// A game that awaits a file at boot (its data JSON, a sprite sheet, a GLB) and gets a
// 404 or a hang never reaches its title screen: no self-test, no brand, a flat colour.
// These helpers turn a failed load into a fallback and one console.warn (verify counts
// console errors, a warning is not one), so the game still boots:
//
//   const data = await loadJsonSafe('./data/game.json', DEFAULTS);     // DEFAULTS: a built-in copy
//   const sheet = await loadSheetSafe('./assets/characters/adventurer', { names: HERO.anims });   // look/canvas2d.js
//   const gltf = await loadCharacterSafe(new GLTFLoader(), url, { THREE, clips: LIBRARY_CLIPS.adventurer });   // ctrl3d/attach.js
//
// The fallbacks are for robustness, not a way to ship: a published game still bundles
// every file it loads (same origin, in its own folder).

/** The warning every Kit fallback prints (console.warn, never console.error). */
export function assetWarn(what, err, instead) {
  const why = err && err.message ? err.message : String(err ?? 'failed');
  try { console.warn(`[kit] ${what} did not load (${why}): ${instead}`); } catch { /* no console */ }
}

/**
 * `promise`, or a rejection after `ms` (0 or less: no limit). The timer is always cleared.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} [label]
 * @returns {Promise<T>}
 */
export function withTimeout(promise, ms, label = 'load') {
  if (!(ms > 0)) return Promise.resolve(promise);
  let timer = null;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: no answer in ${ms} ms`)), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/**
 * Fetch and parse a JSON file; on any failure (404, network, bad JSON, timeout) warn once
 * and return the fallback instead. The game boots either way.
 * @param {string} url
 * @param {object|(() => object)} fallback  the built-in defaults (a function is called only when needed)
 * @param {object} [o]
 * @param {number} [o.timeout=20000]  ms before a hanging request counts as failed
 * @param {(url:string, err:Error) => void} [o.onFallback]  told when the fallback is used
 * @returns {Promise<object>}
 */
export async function loadJsonSafe(url, fallback, { timeout = 20000, onFallback } = {}) {
  if (fallback === undefined) throw new TypeError('loadJsonSafe: pass the built-in defaults as the fallback');
  try {
    const r = await withTimeout(fetch(url), timeout, url);
    if (!r || r.ok === false) throw new Error(`HTTP ${r ? r.status : 'no response'}`);
    return await r.json();
  } catch (err) {
    assetWarn(url, err, 'using the built-in defaults');
    if (onFallback) onFallback(url, err);
    return typeof fallback === 'function' ? fallback() : fallback;
  }
}
