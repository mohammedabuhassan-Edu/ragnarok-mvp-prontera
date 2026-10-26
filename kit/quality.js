// quality.js — automatic quality tiers.
//
// Picks a starting tier from the device (pixel ratio, CPU cores, phone or
// not), caps the renderer's pixel ratio for that tier, and steps the tier
// down when the measured frame rate stays under the target for 3 seconds
// (after a 2 s warm-up; single long hitches are ignored).
// It never steps back up on its own: oscillating between tiers looks worse
// than a stable, slightly lower tier.
//
// Software WebGL (SwiftShader, llvmpipe: cloud machines, headless browsers)
// draws on the CPU at a few frames per second. When the GPU name says so, the
// tier is forced to 'low' with a 0.75 pixel ratio and q.software is true.
// Start-tier priority: the `tier` option, then ?quality=low|mid|high, then the
// software renderer, then the device guess.

const TIERS = ['low', 'mid', 'high'];
const DPR_CAP = { low: 1, mid: 1.5, high: 2 };
const SOFTWARE_DPR = 0.75;
const SOFTWARE_RE = /swiftshader|llvmpipe|softpipe|software/i;

// Suggested per-tier settings a game can read (all optional to honour).
const SETTINGS = {
  low:  { shadows: false, bloom: false, antialias: false, particles: 0.4, drawDistance: 0.6 },
  mid:  { shadows: false, bloom: true,  antialias: false, particles: 0.7, drawDistance: 0.8 },
  high: { shadows: true,  bloom: true,  antialias: true,  particles: 1.0, drawDistance: 1.0 },
};

const DOWNGRADE_AFTER = 3; // seconds under target before stepping down
const WARMUP = 2;          // seconds ignored at start (shader compiles, texture uploads)
const HITCH = 0.25;        // a single frame longer than this is a hitch, not a low frame rate

function detectEnv(renderer) {
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  const nav = g.navigator || {};
  const ua = nav.userAgent || '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile|Telegram/i.test(ua) ||
    (nav.maxTouchPoints > 1 && /Macintosh/.test(ua)); // iPadOS reports as a Mac
  return {
    dpr: g.devicePixelRatio || 1,
    cores: nav.hardwareConcurrency || 4,
    mobile,
    gpu: gpuName(renderer),
  };
}

// One throwaway probe per page: parallax, createQuality and the software-canvas check all ask.
let cachedGpuName = null;

/** the WebGL renderer string ('' when unknown): from the game's renderer, else a throwaway canvas */
export function gpuName(renderer) {
  if (!renderer && cachedGpuName !== null) return cachedGpuName;
  const read = (gl) => {
    if (!gl || typeof gl.getParameter !== 'function') return '';
    try {
      const ext = gl.getExtension && gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      return typeof name === 'string' ? name : '';
    } catch { return ''; }
  };
  try {
    const gl = renderer && typeof renderer.getContext === 'function' ? renderer.getContext() : null;
    if (gl) return read(gl);
    if (typeof document === 'undefined' || !document.createElement) return '';
    const c = document.createElement('canvas');
    const probe = c.getContext && (c.getContext('webgl') || c.getContext('experimental-webgl'));
    const name = read(probe);
    try { probe && probe.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ }
    cachedGpuName = name;
    return name;
  } catch { return ''; }
}

/** true when the GPU name is a CPU (software) rasteriser */
export function isSoftwareRenderer(name) {
  return SOFTWARE_RE.test(String(name || ''));
}

/**
 * On a software GL (SwiftShader, llvmpipe) Canvas 2D is "accelerated" through the
 * GPU process: full-screen pattern fills pile up in its queue and the page stops
 * answering while it drains (seconds per screenshot or new tab). A CPU-backed 2D
 * context (willReadFrequently) never joins that queue. Real GPUs are left alone.
 * Installed once, when the Kit loads, before any game calls getContext('2d').
 */
export function installSoftwareCanvas() {
  const C = globalThis.HTMLCanvasElement;
  if (!C || !C.prototype || typeof C.prototype.getContext !== 'function' || C.prototype.getContext.__bdSoftwareCanvas) return;
  const orig = C.prototype.getContext;
  let software = null;
  const onSoftware = () => {
    if (software === null) {
      try { software = isSoftwareRenderer(gpuName(null)); } catch { software = false; }
    }
    return software;
  };
  function getContext(type, opts) {
    if (type === '2d' && onSoftware()) return orig.call(this, '2d', { ...(opts || {}), willReadFrequently: true });
    return orig.call(this, type, opts);
  }
  getContext.__bdSoftwareCanvas = true;
  C.prototype.getContext = getContext;
}

function initialTier({ cores, mobile, dpr }) {
  if (mobile) return cores >= 8 && dpr <= 3 ? 'mid' : 'low';
  if (cores >= 8) return 'high';
  return cores >= 4 ? 'mid' : 'low';
}

/**
 * @param {object|null} [renderer] three.js WebGLRenderer (anything with setPixelRatio)
 * @param {object} [o]
 * @param {number} [o.target=50]  fps target
 * @param {'low'|'mid'|'high'} [o.tier]  force a starting tier (wins over ?quality= and the software check)
 * @param {{dpr:number,cores:number,mobile:boolean,gpu?:string,software?:boolean,search?:string}} [o.env] test hook
 *   (gpu: the WebGL renderer string; search: stands in for location.search)
 */
export function createQuality(renderer = null, { target = 50, tier: forced, env } = {}) {
  const e = env || detectEnv(renderer);
  const software = e.software === true || isSoftwareRenderer(e.gpu);
  const fromUrl = readUrlTier(e.search);
  const override = TIERS.includes(forced) ? forced : fromUrl;
  let tier = override || (software ? 'low' : initialTier(e));
  let under = 0;          // seconds spent under target
  let fpsAvg = 60;        // smoothed fps
  let warm = 0;           // seconds sampled so far
  const listeners = [];

  // On a software renderer the low tier draws at 0.75 (however low was chosen: the check, ?quality=low,
  // or a step down); an explicit mid/high keeps its normal cap.
  const dprFor = (t) => Math.min(e.dpr || 1, software && t === 'low' ? SOFTWARE_DPR : DPR_CAP[t]);

  function apply() {
    if (renderer && typeof renderer.setPixelRatio === 'function') renderer.setPixelRatio(dprFor(tier));
  }
  apply();

  const q = {
    get tier() { return tier; },
    get dpr() { return dprFor(tier); },
    get fps() { return fpsAvg; },
    get settings() { return SETTINGS[tier]; },
    get mobile() { return !!e.mobile; },
    /** true on a software WebGL renderer (SwiftShader, llvmpipe) */
    get software() { return software; },
    /** the WebGL renderer string, '' when unknown */
    get gpu() { return e.gpu || ''; },
    /** where the starting tier came from: 'option' | 'url' | 'software' | 'device' */
    source: TIERS.includes(forced) ? 'option' : fromUrl ? 'url' : software ? 'software' : 'device',
    /** fn(tier, q) runs after every tier change */
    onChange(fn) { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn) >>> 0, 1); },
    /** feed the real frame time (seconds) once per rendered frame */
    sample(dt) {
      if (!(dt > 0) || dt > HITCH) return;
      if (warm < WARMUP) { warm += dt; return; }
      const fps = 1 / dt;
      // Exponential average over roughly half a second of frames.
      fpsAvg += (fps - fpsAvg) * 0.08;
      if (fps < target) under += dt; else under = Math.max(0, under - dt * 2);
      if (under >= DOWNGRADE_AFTER) {
        under = 0;
        const i = TIERS.indexOf(tier);
        if (i > 0) q.set(TIERS[i - 1]);
      }
    },
    /** force a tier (a settings menu, or the auto downgrade) */
    set(t) {
      if (!TIERS.includes(t) || t === tier) return;
      tier = t;
      apply();
      for (const fn of listeners.slice()) fn(tier, q);
    },
  };
  // verify-game.mjs and the gate read __game.quality.software; games may overwrite it with this same object.
  const G = globalThis.__game;
  if (G && typeof G === 'object' && !G.quality) G.quality = q;
  return q;
}

function readUrlTier(search) {
  try {
    const t = new URLSearchParams(search ?? globalThis.location?.search ?? '').get('quality');
    return TIERS.includes(t) ? t : null;
  } catch { return null; }
}
