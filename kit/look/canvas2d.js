// look/canvas2d.js — the two Canvas 2D chores every 2D game repeats:
//   fitCanvas()   size the canvas for the screen and the pixel ratio, with a CRISP world
//                 scale: a whole number of canvas pixels per art texel, smoothing off,
//                 so pixel art never shimmers or blurs
//   loadSheet()   a BrainDaemon library sprite sheet (game-assets/characters/2d/*.png + .json,
//                 the Phaser atlas format), with its animations built from the library
//                 index's frame lists (or from the frame names), drawn feet first
//
//   import { fitCanvas, loadSheet, drawFrame } from 'kit';     // also canvasLook.fitCanvas, ...
//   const hero = await loadSheet('./assets/characters/adventurer', { anims: entry.frames });
//   function resize() { const v = fitCanvas(canvas, { dpr: quality.dpr, min: 180, texel: 0.5 }); k = v.k; cam.setView(v.w, v.h); }
//   // render: drawFrame(ctx, hero, hero.frameAt('walk', t, 8), x, feetY, { height: 27, flip: facing < 0 });
//
// Every function only touches the DOM when called (fitCanvas reads innerWidth / innerHeight,
// loadSheet uses Image and fetch); crispScale() and buildSheet() are pure.
// loadSheetSafe() is loadSheet that never stops the game: a sheet that does not load
// becomes placeholderSheet() (one console.warn), and the game still boots.

import { assetWarn, withTimeout } from '../safe-load.js';

/**
 * The crisp world scale for a screen: k = canvas px per world unit, a whole number of
 * canvas pixels per texel, chosen so the SHORTER side shows about `min` world units.
 * Pure (no DOM): fitCanvas uses it.
 * @param {number} cw   canvas width in px
 * @param {number} ch   canvas height in px
 * @param {number} min  world units the shorter side should show (about; never fewer pixels than 1 per texel)
 * @param {number} [texel=1]  world units per art pixel (a 32 px tile drawn 16 units wide: 0.5)
 * @returns {{k:number, px:number, w:number, h:number}}  px = canvas px per texel; w, h = the view in world units
 */
export function crispScale(cw, ch, min, texel = 1) {
  const t = texel > 0 ? texel : 1;
  const m = min > 0 ? min : Math.min(cw, ch) * t;
  const px = Math.max(1, Math.floor((Math.min(cw, ch) * t) / m));
  const k = px / t;
  return { k, px, w: cw / k, h: ch / k };
}

/**
 * Size the canvas to the screen (times the pixel ratio) and pick the crisp scale.
 * Call it on start, on 'resize' and on quality.onChange (a resize resets imageSmoothingEnabled,
 * so it turns smoothing off again every time).
 *   fitCanvas(canvas, { dpr: quality.dpr, min: 180, texel: 0.5 })
 *   fitCanvas(canvas, quality.dpr, 180, 0.5)                 // the same, positional
 * @param {HTMLCanvasElement} canvas
 * @param {object|number} [o]  options, or dpr (then min, texel follow)
 * @param {number} [o.dpr=1]      quality.dpr
 * @param {number} [o.min=180]    world units the shorter screen side shows (about)
 * @param {number} [o.texel=1]    world units per art pixel
 * @param {number} [o.width]      CSS px to fill (default innerWidth)
 * @param {number} [o.height]     CSS px to fill (default innerHeight)
 * @param {boolean} [o.smoothing=false]  imageSmoothingEnabled after the resize
 * @returns {{k:number, px:number, w:number, h:number, dpr:number}}  k = canvas px per world unit;
 *   draw the world with ctx.setTransform(k, 0, 0, k, -viewX * k, -viewY * k) (camera2d.apply(ctx, k) does)
 */
export function fitCanvas(canvas, o = {}, min, texel) {
  const opt = typeof o === 'number' ? { dpr: o, min, texel } : (o || {});
  const g = globalThis;
  const dpr = opt.dpr > 0 ? opt.dpr : 1;
  const cssW = opt.width ?? g.innerWidth ?? canvas.clientWidth ?? canvas.width;
  const cssH = opt.height ?? g.innerHeight ?? canvas.clientHeight ?? canvas.height;
  canvas.width = Math.max(1, Math.round(cssW * dpr));
  canvas.height = Math.max(1, Math.round(cssH * dpr));
  const r = crispScale(canvas.width, canvas.height, opt.min ?? 180, opt.texel ?? 1);
  const ctx = canvas.getContext && canvas.getContext('2d');
  if (ctx) ctx.imageSmoothingEnabled = !!opt.smoothing;
  return { ...r, dpr };
}

/** frame names in animation order: "walk1", "walk2" -> walk; "bat-0", "bat-1" -> bat; "idle" -> idle */
function animsFromNames(names) {
  const groups = {};
  for (const n of names) {
    const m = /^(.*?)[-_]?(\d+)$/.exec(n);
    const base = m && m[1] ? m[1] : n;
    (groups[base] ||= []).push([m && m[1] ? Number(m[2]) : -1, n]);
  }
  const out = {};
  for (const [k, list] of Object.entries(groups)) out[k] = list.sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  return out;
}

/**
 * A sheet from an image and its atlas JSON (the Phaser "frames" hash or array format). Pure.
 * @param {CanvasImageSource & {width?:number}} img
 * @param {{frames: object|object[], meta?: object}} atlas
 * @param {Record<string, string[]>} [anims]  animation -> frame names in order (the library index's
 *   `frames` of the character); missing: built from the frame names ("walk1", "walk2" -> walk)
 * @returns {{img, frames:Record<string, {frame:{x,y,w,h}}>, anims:Record<string,string[]>, meta:object,
 *   has(name):boolean, frame(name):{x,y,w,h}|null, frameAt(anim, t, fps?, loop?):string}}
 */
export function buildSheet(img, atlas, anims) {
  const raw = atlas && atlas.frames;
  const frames = {};
  if (Array.isArray(raw)) { for (const f of raw) if (f && f.filename) frames[f.filename] = f; }
  else if (raw && typeof raw === 'object') Object.assign(frames, raw);
  const names = Object.keys(frames);
  const A = {};
  const given = anims && typeof anims === 'object' ? anims : null;
  for (const [k, list] of Object.entries(given || animsFromNames(names))) {
    const ok = (Array.isArray(list) ? list : [list]).filter((n) => frames[n]);
    if (ok.length) A[k] = ok;
  }
  const sheet = {
    img, frames, anims: A, meta: (atlas && atlas.meta) || {},
    has: (name) => !!frames[name],
    frame: (name) => (frames[name] ? frames[name].frame : null),
    /** the frame name of an animation (or a plain frame name) at time t */
    frameAt(anim, t, fps = 8, loop = true) {
      const list = A[anim] || (frames[anim] ? [anim] : null);
      if (!list) return null;
      return frameAt(list, t, fps, loop);
    },
  };
  return sheet;
}

/**
 * Load a library sheet: base = './assets/characters/adventurer' (the .png and .json beside it),
 * or { png, json } URLs. The library index (characters/index.json) lists each 2D character's
 * animations as `frames: { walk: ['walk1', 'walk2'], ... }`: pass that as anims.
 *   const sheet = await loadSheet('./assets/characters/pixel-crew', { anims: { bat: ['bat-0', 'bat-1', 'bat-2'] } });
 * @param {string|{png:string, json:string}} src
 * @param {{anims?:Record<string,string[]>, frames?:Record<string,string[]>}} [o]  frames: the index's field name, the same thing
 */
export async function loadSheet(src, o = {}) {
  const png = typeof src === 'string' ? `${src}.png` : src.png;
  const json = typeof src === 'string' ? `${src}.json` : src.json;
  const [img, atlas] = await Promise.all([
    new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error(`loadSheet: no image ${png}`));
      i.src = png;
    }),
    fetch(json).then((r) => { if (r.ok === false) throw new Error(`loadSheet: no atlas ${json}`); return r.json(); }),
  ]);
  return buildSheet(img, atlas, o.anims || o.frames);
}

/** every frame name in a list, or in an object of lists (anims), or nested (a data block of anims) */
function frameNames(names, out = new Set()) {
  if (typeof names === 'string') out.add(names);
  else if (Array.isArray(names)) for (const n of names) frameNames(n, out);
  else if (names && typeof names === 'object') for (const v of Object.values(names)) frameNames(v, out);
  return out;
}

/** a canvas to paint on: the DOM's, or an OffscreenCanvas; null where there is none (node) */
function makeCanvas(w, h) {
  const g = globalThis;
  try {
    if (g.document && typeof g.document.createElement === 'function') {
      const c = g.document.createElement('canvas');
      c.width = w; c.height = h;
      return c;
    }
    if (typeof g.OffscreenCanvas === 'function') return new g.OffscreenCanvas(w, h);
  } catch { /* fall through */ }
  return null;
}

/**
 * A stand-in sheet for one that did not load: every frame name the game draws is the
 * same simple figure (a rounded body, a head, a visor that shows the facing), so
 * drawFrame and the game's frame lists keep working and the game still boots.
 * @param {string[]|Record<string,string[]>|object} names  the frame names (a list, anims -> lists, or any nesting of them)
 * @param {object} [o]
 * @param {[number, number]} [o.size=[24, 32]]  frame width and height in sheet pixels (match the real sheet's frames)
 * @param {string} [o.color='#7C8CA8']           body colour
 * @returns {ReturnType<typeof buildSheet> & {placeholder: true}}
 */
export function placeholderSheet(names, { size = [24, 32], color = '#7C8CA8' } = {}) {
  const w = Math.max(4, Math.round(size[0]) || 24), h = Math.max(4, Math.round(size[1]) || 32);
  const canvas = makeCanvas(w, h);
  const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  if (ctx) {
    const u = Math.min(w, h * 0.75);
    const cx = w / 2, headR = u * 0.22, bodyW = u * 0.56, bodyH = h * 0.52;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(cx - bodyW / 2, h - 2, bodyW, 2);                         // feet line
    ctx.fillStyle = color;
    const top = h - 2 - bodyH;
    if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(cx - bodyW / 2, top, bodyW, bodyH, bodyW * 0.35); ctx.fill(); }
    else ctx.fillRect(cx - bodyW / 2, top, bodyW, bodyH);
    ctx.beginPath(); ctx.arc(cx, top - headR * 0.9, headR, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#1A1F2B';
    ctx.fillRect(cx, top - headR * 1.15, headR * 0.9, Math.max(1, headR * 0.45));   // visor: faces right (drawFrame flips it)
  }
  const img = canvas || { width: w, height: h };                          // node: a blank image with a size
  const frames = {};
  for (const n of frameNames(names)) frames[n] = { frame: { x: 0, y: 0, w, h } };
  const sheet = buildSheet(img, { frames, meta: { placeholder: true } }, names && !Array.isArray(names) && typeof names === 'object' ? names : undefined);
  sheet.placeholder = true;
  return sheet;
}

/**
 * loadSheet that never stops the game: when the image or the atlas does not load (a 404,
 * a bad JSON, a timeout), it warns once (console.warn) and returns placeholderSheet(names).
 *   const sheet = await loadSheetSafe(HERO.sheet, { names: HERO.anims, size: [80, 110] });
 * @param {string|{png:string, json:string}} src  as loadSheet
 * @param {object} [o]  loadSheet's options, plus:
 * @param {string[]|Record<string,string[]>|object} [o.names]  every frame name the game draws (default: anims / frames)
 * @param {[number, number]} [o.size]    the placeholder's frame size (the real sheet's frame size)
 * @param {string} [o.color]             the placeholder's colour
 * @param {number} [o.timeout=20000]     ms before a hanging load counts as failed
 * @returns {Promise<ReturnType<typeof buildSheet> & {placeholder?: boolean}>}
 */
export async function loadSheetSafe(src, o = {}) {
  const { names, size, color, timeout = 20000, ...opts } = o;
  try {
    return await withTimeout(loadSheet(src, opts), timeout, 'loadSheet');
  } catch (err) {
    assetWarn(typeof src === 'string' ? src : src && src.png, err, 'a placeholder sheet stands in');
    return placeholderSheet(names ?? opts.anims ?? opts.frames ?? [], { size, color });
  }
}

/**
 * The frame name of a list at time t (seconds).
 * @param {string[]} list
 * @param {number} t
 * @param {number} [fps=8]
 * @param {boolean} [loop=true]  false: stays on the last frame
 */
export function frameAt(list, t, fps = 8, loop = true) {
  if (!list || !list.length) return null;
  const i = Math.max(0, Math.floor((t || 0) * fps));
  return list[loop ? i % list.length : Math.min(i, list.length - 1)];
}

/**
 * Draw one frame with its feet (bottom centre) at x, y, in the current transform.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof buildSheet>} sheet
 * @param {string} name  a frame name (sheet.frameAt(anim, t) gives one)
 * @param {number} x
 * @param {number} y
 * @param {object} [o]
 * @param {number} [o.height]   drawn height in world units (or scale)
 * @param {number} [o.scale]    world units per sheet pixel (default 1 when no height)
 * @param {boolean} [o.flip]    face left (mirror)
 * @param {number} [o.sx=1]     squash / stretch
 * @param {number} [o.sy=1]
 * @param {boolean} [o.smooth=false]  true for the cartoon sheets drawn below their size, false (crisp) for pixel art
 * @param {number} [o.alpha=1]
 * @returns {boolean} false when the frame is missing (nothing drawn)
 */
export function drawFrame(ctx, sheet, name, x, y, { height, scale, flip = false, sx = 1, sy = 1, smooth = false, alpha = 1 } = {}) {
  const f = sheet && sheet.frames[name] && sheet.frames[name].frame;
  if (!f) return false;
  const s = scale ?? (height ? height / f.h : 1);
  const w = f.w * s * sx, h = f.h * s * sy;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = smooth;
  if (smooth) ctx.imageSmoothingQuality = 'high';
  ctx.translate(x, y);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(sheet.img, f.x, f.y, f.w, f.h, -w / 2, -h, w, h);
  ctx.restore();
  return true;
}
