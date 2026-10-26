// look/canvas-look.js — a finished look for Canvas 2D games.
//
//   import * as Look2D from './kit/look/canvas-look.js';
//   const bg = Look2D.parallaxBackground('forest', { seed: 4 });
//   const tiles = Look2D.tilePainter('grass-top', { size: 32 });
//   frame: bg.draw(ctx, cameraX);
//          tiles.fill(ctx, 0, groundY, 30, 3, { scale: 2 });     // grass row on top, dirt below
//          Look2D.hudPanel(ctx, { x: 12, y: 12, w: 220, h: 64 });
//          Look2D.healthBar(ctx, { x: 24, y: 24, w: 160, h: 16 }, hp / maxHp);
//   crisp scale + sprites (canvas2d.js): Look2D.fitCanvas(canvas, { dpr, min: 180, texel: 0.5 }),
//          await Look2D.loadSheet('./assets/characters/adventurer'), Look2D.drawFrame(ctx, sheet, name, x, feetY)
//   vertical scroll: Look2D.parallaxBackground('space', { direction: 'vertical' }).draw(ctx, scrollY)
//
// Same palette names and keys as the three.js looks (core.js PALETTES), so a
// 2D HUD over a 3D scene matches. Tile pixels come from a pure painter
// (paintTile) that is unit-tested: every variant of a kind shares identical
// border pixels and the patterns are periodic, so seams always match.

import {
  PALETTES, palette as getPalette, mixHex, shadeHex, rgba, hexToRgb, noise2, fbm2, hash2, createRng, clamp, isHex, luminance,
} from './core.js';

export { PALETTES };
export const palette = getPalette;
// crisp canvas sizing and the library sprite sheets (canvas2d.js), here too: canvasLook.fitCanvas, ...
export { fitCanvas, crispScale, loadSheet, buildSheet, frameAt, drawFrame, loadSheetSafe, placeholderSheet } from './canvas2d.js';

// ------------------------------------------------------------------ canvases
function makeCanvas(w, h, factory) {
  if (factory) return factory(w, h);
  const g = globalThis;
  if (g.document && g.document.createElement) { const c = g.document.createElement('canvas'); c.width = w; c.height = h; return c; }
  if (typeof g.OffscreenCanvas === 'function') return new g.OffscreenCanvas(w, h);
  throw new Error('look: no canvas available (pass { createCanvas })');
}
function toCanvas(px, factory) {
  const c = makeCanvas(px.width, px.height, factory);
  const g = c.getContext('2d');
  const img = g.createImageData(px.width, px.height);
  img.data.set(px.data);
  g.putImageData(img, 0, 0);
  return c;
}
const R = (r) => (Array.isArray(r) ? { x: r[0], y: r[1], w: r[2], h: r[3] } : r);

// ------------------------------------------------------------------ shapes
export function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function buildPath(ctx, shape) {
  if (typeof shape === 'function') { ctx.beginPath(); shape(ctx); return null; }
  if (typeof Path2D !== 'undefined' && shape instanceof Path2D) return shape;
  if (Array.isArray(shape)) {
    ctx.beginPath();
    shape.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    return null;
  }
  if (shape && Number.isFinite(shape.radius)) { ctx.beginPath(); ctx.arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2); return null; }
  if (shape && Number.isFinite(shape.w)) { roundRectPath(ctx, shape.x, shape.y, shape.w, shape.h, shape.r ?? 0); return null; }
  throw new Error('look: drawOutlined shape must be a Path2D, a function, points, {x,y,w,h,r} or {x,y,radius}');
}
function bounds(shape) {
  if (Array.isArray(shape)) {
    const xs = shape.map((p) => p[0]), ys = shape.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  if (shape && Number.isFinite(shape.radius)) return { x: shape.x - shape.radius, y: shape.y - shape.radius, w: shape.radius * 2, h: shape.radius * 2 };
  if (shape && Number.isFinite(shape.w)) return shape;
  return null;
}

/**
 * Fill a shape, add a soft top light and bottom shade inside it, then a crisp outline.
 * @param shape Path2D | (ctx)=>void path builder | [[x,y],...] | {x,y,w,h,r} | {x,y,radius}
 * @param {string|CanvasGradient} fill
 * @param {string} [outlineColor='#0A0E1A']
 * @param {object} [o] { width=2, shade=true, light=0.22, dark=0.22 }
 */
export function drawOutlined(ctx, shape, fill, outlineColor = '#0A0E1A', o = {}) {
  const { width = 2, shade = true, light = 0.22, dark = 0.22 } = o;
  ctx.save();
  const p = buildPath(ctx, shape);
  ctx.fillStyle = fill;
  if (p) ctx.fill(p); else ctx.fill();
  const b = bounds(shape);
  if (shade && b && ctx.createLinearGradient) {
    ctx.save();
    if (p) ctx.clip(p); else ctx.clip();
    const gr = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    gr.addColorStop(0, `rgba(255,255,255,${light})`);
    gr.addColorStop(0.42, 'rgba(255,255,255,0)');
    gr.addColorStop(0.62, 'rgba(0,0,0,0)');
    gr.addColorStop(1, `rgba(0,0,0,${dark})`);
    ctx.fillStyle = gr;
    ctx.fillRect(b.x - 1, b.y - 1, b.w + 2, b.h + 2);
    ctx.restore();
  }
  if (outlineColor && width > 0) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.lineWidth = width;
    ctx.strokeStyle = outlineColor;
    if (p) ctx.stroke(p); else { buildPath(ctx, shape); ctx.stroke(); }
  }
  ctx.restore();
}

// ------------------------------------------------------------------ sprites
/**
 * Bake a 1-2 px outline around a sprite (any drawable with width/height).
 * Returns a canvas (thickness px larger on every side; canvas.pad tells how much).
 */
export function outlineSprite(image, { thickness = 1, color = '#0A0E1A', createCanvas } = {}) {
  const t = Math.max(1, Math.min(4, Math.round(thickness)));
  const w = image.width, h = image.height;
  const sil = makeCanvas(w, h, createCanvas), sg = sil.getContext('2d');
  sg.drawImage(image, 0, 0);
  sg.globalCompositeOperation = 'source-in';
  sg.fillStyle = color;
  sg.fillRect(0, 0, w, h);
  const out = makeCanvas(w + t * 2, h + t * 2, createCanvas), og = out.getContext('2d');
  og.imageSmoothingEnabled = false;
  for (let dy = -t; dy <= t; dy++) for (let dx = -t; dx <= t; dx++) {
    if (!dx && !dy) continue;
    if (dx * dx + dy * dy > t * t + 0.5) continue;
    og.drawImage(sil, t + dx, t + dy);
  }
  og.drawImage(image, t, t);
  out.pad = t;
  return out;
}

/**
 * Top-light shading for a flat sprite: lighter top, darker bottom, a thin rim
 * highlight on top edges. Returns a canvas of the same size.
 */
export function shadeSprite(image, { light = 0.22, shadow = 0.28, rim = 0.45, createCanvas } = {}) {
  const w = image.width, h = image.height;
  const out = makeCanvas(w, h, createCanvas), g = out.getContext('2d');
  g.drawImage(image, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, `rgba(255,255,255,${light})`);
  gr.addColorStop(0.45, 'rgba(255,255,255,0)');
  gr.addColorStop(0.6, 'rgba(0,0,0,0)');
  gr.addColorStop(1, `rgba(0,0,0,${shadow})`);
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  if (rim > 0) {
    // rim = silhouette minus itself shifted down 1 px: only pixels with nothing above
    const r = makeCanvas(w, h, createCanvas), rg = r.getContext('2d');
    rg.drawImage(image, 0, 0);
    rg.globalCompositeOperation = 'source-in';
    rg.fillStyle = '#FFFFFF'; rg.fillRect(0, 0, w, h);
    rg.globalCompositeOperation = 'destination-out';
    rg.drawImage(image, 0, 1);
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = rim;
    g.drawImage(r, 0, 0);
    g.globalAlpha = 1;
  }
  g.globalCompositeOperation = 'source-over';
  return out;
}

// ------------------------------------------------------------------ tiles (pure pixels)
export const TILE_KINDS = Object.freeze(['stone', 'grass-top', 'dirt', 'wood', 'brick', 'metal']);
const TILE_COLORS = {
  stone: { base: '#8A8794', dark: '#6A6774', light: '#AAA7B4', ink: '#2E2C38', accent: '#5E8A4A' },
  'grass-top': { base: '#62A846', dark: '#3F7A30', light: '#9AD45E', ink: '#2A4A22', accent: '#8A5E3C' },
  dirt: { base: '#8A5E3C', dark: '#6A452A', light: '#A8784E', ink: '#3E2818', accent: '#B8A08A' },
  wood: { base: '#C2884C', dark: '#8A5A30', light: '#DCA868', ink: '#4A2C16', accent: '#5A5E68' },
  brick: { base: '#B0553E', dark: '#8A4030', light: '#CC7458', ink: '#3E1E16', accent: '#D8CCBC' },
  metal: { base: '#7A8696', dark: '#5A6474', light: '#A4B0C0', ink: '#22262E', accent: '#F2C14A' },
};
export const TILE_VARIANTS = 4;

function tileColors(kind, pal) {
  const c = { ...TILE_COLORS[kind] };
  if (pal && typeof pal === 'object' && !Array.isArray(pal)) { for (const k of Object.keys(c)) if (isHex(pal[k])) c[k] = pal[k]; }
  else if (typeof pal === 'string' && PALETTES[pal] && pal !== 'braindaemon' && pal !== 'day') {
    const tint = PALETTES[pal].bg;
    for (const k of Object.keys(c)) c[k] = mixHex(c[k], tint, 0.14);
  }
  const out = {};
  for (const k of Object.keys(c)) out[k] = hexToRgb(c[k]);
  return out;
}

/**
 * Paint one 2D tile as RGBA pixels (pure, no DOM).
 * kinds: stone, grass-top, dirt, wood, brick, metal. variant 0..3 changes only interior
 * details (cracks, moss, pebbles, vents); border pixels are identical for every variant.
 * @returns {{width:number,height:number,data:Uint8ClampedArray,kind:string,variant:number}}
 */
export function paintTile(kind, { size = 32, seed = 1, variant = 0, palette: pal } = {}) {
  if (!TILE_COLORS[kind]) throw new Error(`look: unknown tile "${kind}" (have: ${TILE_KINDS.join(', ')})`);
  const S = Math.max(8, size | 0), px = S / 32;
  const C = tileColors(kind, pal);
  const data = new Uint8ClampedArray(S * S * 4);
  const ks = (seed * 977 + kind.length * 131) | 0;           // kind seed: shared by every variant
  const vs = (ks + 7919 * ((variant | 0) + 1)) | 0;            // variant seed: interior details only
  const speck = noise2(8, 8, ks), fine = noise2(16, 16, ks + 1), big = fbm2(2, 2, 3, ks + 2);
  const dirtF = noise2(8, 8, 991), dirtFine = noise2(16, 16, 992); // shared by grass-top and dirt so they meet cleanly
  const band = 2 * px;
  const interior = (x, y) => (x >= band && y >= band && x < S - band && y < S - band ? 1 : 0);
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const set = (x, y, c) => { const i = (y * S + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = 255; };
  // grass lip profile (periodic over the tile): grass depth per column
  const lip = (x) => Math.round((7 + 1.6 * Math.sin((x / S) * Math.PI * 4 + 1.3) + 1.1 * Math.sin((x / S) * Math.PI * 6 + 0.4)) * px);
  // variant details: a few interior spots per variant
  const spots = [];
  for (let k = 0; k < 4; k++) spots.push({ x: band + 2 * px + hash2(k, 1, vs) * (S - 2 * band - 4 * px), y: band + 2 * px + hash2(k, 2, vs) * (S - 2 * band - 4 * px), r: (1 + hash2(k, 3, vs) * 1.6) * px, t: hash2(k, 4, vs) });
  const spotAt = (x, y) => { for (const s of spots) if (Math.hypot(x + 0.5 - s.x, y + 0.5 - s.y) < s.r) return s; return null; };
  const D = kind === 'dirt' ? C : tileColors('dirt', pal);
  const dirtAt = (x, y) => {
    const u = (x + 0.5) / S, v = (y + 0.5) / S;
    const n = dirtF(u, v) * 0.7 + dirtFine(u, v) * 0.3;
    return n > 0.62 ? mix(D.base, D.light, 0.5) : n < 0.32 ? mix(D.base, D.dark, 0.6) : D.base;
  };

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S, v = (y + 0.5) / S;
      const n = speck(u, v) * 0.6 + fine(u, v) * 0.4;
      const inner = interior(x, y);
      let c;
      switch (kind) {
        case 'stone': {
          const rowH = S / 2, ly = y % rowH, row = Math.floor(y / rowH);
          const bx = row === 0 ? x : ((x - S / 2) % S + S) % S; // x inside the block (row 1 is offset half a tile)
          if (ly < px || (row === 0 ? x < px : (x >= S / 2 && x < S / 2 + px))) { c = C.ink; break; }
          c = n > 0.62 ? mix(C.base, C.light, 0.35) : n < 0.35 ? mix(C.base, C.dark, 0.35) : C.base;
          if (ly < 2 * px || bx < 2 * px) c = mix(c, C.light, 0.55);
          else if (ly >= rowH - px || bx >= S - px) c = mix(c, C.dark, 0.6);
          if (inner) {
            const s = spotAt(x, y);
            if (s && variant % 4 === 1) c = mix(c, C.accent, 0.75);                      // moss
            else if (s && variant % 4 === 2) c = mix(c, C.ink, 0.55);                    // chip
            if (variant % 4 === 3 && Math.abs((x - S * 0.3) - (y - S * 0.3) * 0.6) < 0.6 * px && y > S * 0.3 && y < S * 0.45) c = C.ink; // crack
          }
          break;
        }
        case 'grass-top': {
          const d = lip(x);
          if (y < d) {
            const g = big(u, v);
            c = y < px ? C.light : g > 0.55 ? mix(C.base, C.light, 0.3) : C.base;
            if (y >= d - px) c = C.dark;
            if (inner && variant % 4 === 1 && spotAt(x, y)) c = mix(C.light, [255, 236, 140], 0.6); // flowers
          } else if (y < d + px) c = C.ink;
          else {
            c = dirtAt(x, y);
            if (inner) { const s = spotAt(x, y); if (s && variant % 4 >= 2) c = mix(D.accent, D.light, s.t * 0.4); }
          }
          break;
        }
        case 'dirt': {
          c = dirtAt(x, y);
          if (inner) { const s = spotAt(x, y); if (s && variant % 4 >= 1) c = mix(C.accent, C.light, s.t * 0.4); }
          break;
        }
        case 'wood': {
          // two boards per tile, butt joints staggered (top board at x=0, bottom at x=S/2)
          const rowH = S / 2, ly = y % rowH, row = Math.floor(y / rowH);
          const bx = row === 0 ? x : ((x - S / 2) % S + S) % S;
          if (ly < px || bx < px) { c = C.ink; break; }
          // grain: thin darker lines that waver a little along the board
          const gy = ly + Math.sin((x / S) * Math.PI * 2 + row * 2.1) * 1.2 * px;
          const line = (Math.floor(gy / (3 * px)) + row) % 2 === 0 && (gy % (3 * px)) < px;
          c = mix(C.base, C.light, 0.25 + (fine(u, v) - 0.5) * 0.3);
          if (line) c = mix(c, C.dark, 0.55);
          if (ly < 2 * px || bx < 2 * px) c = mix(c, C.light, 0.55);
          else if (ly >= rowH - px || bx >= S - px) c = mix(c, C.dark, 0.6);
          // nail heads near each board end (identical for all variants)
          for (const nx of [Math.round(3 * px), S - Math.round(4 * px)]) {
            const nxx = row === 0 ? nx : (nx + S / 2) % S;
            if (x >= nxx && x < nxx + px && ly >= rowH / 2 - px && ly < rowH / 2) c = C.accent;
          }
          if (inner && variant % 4 >= 2) { const s = spotAt(x, y); if (s) c = mix(C.dark, C.ink, 0.35); } // knots
          break;
        }
        case 'brick': {
          const rowH = S / 4, row = Math.floor(y / rowH), ly = y % rowH;
          const off = row % 2 ? S / 4 : 0;
          const xx = ((x - off) % S + S) % S, lx = xx % (S / 2);
          if (ly < px || lx < px) { c = C.accent; break; }
          const id = hash2(row, Math.floor(xx / (S / 2)), ks);
          c = id > 0.7 ? mix(C.base, C.light, 0.3) : id < 0.25 ? mix(C.base, C.dark, 0.4) : C.base;
          if (n > 0.66) c = mix(c, C.light, 0.25); else if (n < 0.3) c = mix(c, C.dark, 0.25);
          if (ly < 2 * px) c = mix(c, C.light, 0.4);
          else if (ly >= rowH - px) c = mix(c, C.dark, 0.5);
          if (inner && variant % 4 >= 2) { const s = spotAt(x, y); if (s) c = mix(c, C.ink, 0.45); }
          break;
        }
        case 'metal': {
          if (x < px || y < px) { c = C.ink; break; }
          c = mix(C.base, C.light, (fine(u, v) - 0.5) * 0.3 + 0.1);
          if (x < 2 * px || y < 2 * px) c = mix(c, C.light, 0.6);
          else if (x >= S - px || y >= S - px) c = mix(c, C.dark, 0.7);
          for (const rx of [Math.round(4 * px), S - Math.round(5 * px)]) for (const ry of [Math.round(4 * px), S - Math.round(5 * px)]) {
            if (x >= rx && x < rx + 2 * px && y >= ry && y < ry + 2 * px) c = x < rx + px && y < ry + px ? C.light : C.dark;
          }
          if (inner) {
            const cx = x - S / 2, cy = y - S / 2;
            if (variant % 4 === 1 && Math.abs(cx) < S * 0.28 && Math.abs(cy) < S * 0.22 && Math.floor((cy + S) / (3 * px)) % 2 === 0) c = C.ink;      // vent
            if (variant % 4 === 2 && Math.abs(cy) < S * 0.12 && Math.abs(cx) < S * 0.3) c = Math.floor((cx + cy + S) / (3 * px)) % 2 ? C.accent : C.ink; // hazard
            if (variant % 4 === 3 && spotAt(x, y)) c = mix(c, C.dark, 0.5);                // scuffs
          }
          break;
        }
      }
      set(x, y, c);
    }
  }
  return { width: S, height: S, data, kind, variant };
}

/**
 * Tiles ready to draw: an atlas of TILE_VARIANTS variants per kind.
 * @returns {{ size, kind, atlas, draw(ctx,x,y,variant=0,scale=1), fill(ctx,x,y,cols,rows,{scale,seed}), variantAt(col,row,seed) }}
 */
export function tilePainter(kind, { size = 32, seed = 1, palette: pal, createCanvas } = {}) {
  const S = size;
  const atlas = makeCanvas(S * TILE_VARIANTS, S, createCanvas);
  const ag = atlas.getContext('2d');
  for (let v = 0; v < TILE_VARIANTS; v++) ag.drawImage(toCanvas(paintTile(kind, { size, seed, variant: v, palette: pal }), createCanvas), v * S, 0);
  const sub = kind === 'grass-top' ? tilePainter('dirt', { size, seed, palette: pal, createCanvas }) : null;
  const variantAt = (col, row, s = seed) => {
    const h = hash2(col, row, s * 31 + 5);
    return h < 0.55 ? 0 : h < 0.72 ? 1 : h < 0.88 ? 2 : 3; // mostly plain, some detail
  };
  const tp = {
    size: S, kind, atlas,
    draw(ctx, x, y, variant = 0, scale = 1) {
      const prev = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(atlas, (variant % TILE_VARIANTS) * S, 0, S, S, Math.round(x), Math.round(y), S * scale, S * scale);
      ctx.imageSmoothingEnabled = prev;
    },
    /** fill cols x rows tiles from (x, y); grass-top puts dirt under the first row */
    fill(ctx, x, y, cols, rows = 1, { scale = 1, seed: s = seed, col0 = 0, row0 = 0 } = {}) {
      const step = S * scale;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const p = r > 0 && sub ? sub : tp;
        p.draw(ctx, x + c * step, y + r * step, variantAt(col0 + c, row0 + r, s), scale);
      }
    },
    variantAt,
  };
  return tp;
}

// ------------------------------------------------------------------ parallax backgrounds
export const PARALLAX_KINDS = Object.freeze(['city-night', 'forest', 'desert', 'mountains', 'sea', 'space', 'cave']);
const SCHEMES = {
  'city-night': { top: '#0B0718', horizon: '#5A2470', haze: '#7A2E7A', glow: '#FF4FA0', far: '#2A1840', mid: '#1A0F2C', near: '#0C0716', win: ['#FFD27A', '#22E6FF', '#FF7AD0'], neon: ['#FF2FD0', '#22E6FF', '#FFE14D'], moon: '#F4E8FF', stars: 1 },
  forest: { top: '#5FA0E0', horizon: '#D8ECF0', haze: '#E8F4F0', glow: '#FFF4D8', far: '#8AB4B0', mid: '#5E9468', near: '#2F5E3E', ground: '#24482E', sun: '#FFF6DC', stars: 0 },
  desert: { top: '#4E8ED6', horizon: '#F6D8A6', haze: '#F8E2B8', glow: '#FFE6B0', far: '#D8A07A', mid: '#E2A866', near: '#C27E42', cactus: '#4E6A3A', sun: '#FFF2C8', stars: 0 },
  mountains: { top: '#3E78C8', horizon: '#CFE0F0', haze: '#E0ECF6', glow: '#FFF0D8', far: '#9AB0CC', mid: '#6A80A0', near: '#3E5A5A', snow: '#F4F8FF', sun: '#FFF8E8', stars: 0 },
  sea: { top: '#2E3A7E', horizon: '#FF9E62', haze: '#FFB880', glow: '#FFC27A', far: '#5A3A5E', mid: '#3A4A80', near: '#24306A', foam: '#FFE6D0', sun: '#FFE0A0', stars: 0.2 },
  space: { top: '#04050D', horizon: '#141235', haze: '#2A1A5A', glow: '#6A3CFF', far: '#3A1A7A', mid: '#1A4A8A', near: '#4A4458', planet: '#C86A4A', ring: '#E8C8A0', nebula: ['#6A3CFF', '#FF5CA8', '#22D3FF'], stars: 1.5 },
  cave: { top: '#07060A', horizon: '#1A1220', haze: '#2A1A2E', glow: '#7AE0C0', far: '#221A28', mid: '#16101C', near: '#0A070E', crystal: ['#7AE0C0', '#B07AFF', '#5FC8FF'], shroom: '#FFB86B', stars: 0 },
};

function schemeFor(kind, pal) {
  const s = { ...SCHEMES[kind] };
  if (pal && typeof pal === 'object') { for (const k of Object.keys(pal)) s[k] = pal[k]; }
  else if (typeof pal === 'string' && PALETTES[pal]) {
    const t = PALETTES[pal].primary;
    for (const k of ['far', 'mid', 'near', 'haze']) if (isHex(s[k])) s[k] = mixHex(s[k], t, 0.12);
  }
  return s;
}

/**
 * Layered, seamless parallax backdrop.
 * kinds: city-night, forest, desert, mountains, sea, space, cave.
 *
 * Side-scrolling (default):   bg.draw(ctx, cameraX, { x, y, w, h, cameraY })
 * Vertical (a vertical shmup, a climber): parallaxBackground('space', { direction: 'vertical' }), then
 *   bg.draw(ctx, scrollY, { x, y, w, h, cameraX })
 *   scrollY: canvas pixels the view has travelled UP (grows while flying): the layers stream down.
 *   cameraX: an optional sideways camera shift (canvas px). The sky gradient stays top-to-bottom and
 *   the layers run along the screen height (their silhouettes rise from the left edge), so the game
 *   never rotates the canvas itself. Best with space, cave and sea.
 * Both take canvas pixels and draw in the current transform (reset it first: ctx.setTransform(1, 0, 0, 1, 0, 0)).
 * @param {object} [o] { palette (name or colour overrides), layers=4, seed=1, width=1024, height=512,
 *   direction='horizontal'|'vertical', createCanvas }
 * @returns {{ kind, direction, layers:{canvas,factor,name}[], draw(ctx, scroll, {x,y,w,h,cameraY,cameraX}) }}
 */
export function parallaxBackground(kind = 'forest', o = {}) {
  if (!SCHEMES[kind]) throw new Error(`look: unknown parallax "${kind}" (have: ${PARALLAX_KINDS.join(', ')})`);
  const vertical = o.direction === 'vertical' || o.vertical === true;
  const W = o.width || 1024, H = o.height || 512;
  const S = schemeFor(kind, o.palette);
  const rng = createRng(`${kind}:${o.seed ?? 1}`);
  const seedN = (o.seed ?? 1) * 101 + kind.length;
  const defs = LAYERS[kind](S, W, H, rng, seedN);
  const want = Math.max(1, Math.min(defs.length, o.layers ?? defs.length));
  const pick = want === defs.length ? defs : Array.from({ length: want }, (_, i) => defs[Math.round((i * (defs.length - 1)) / Math.max(1, want - 1))]);
  const layers = pick.map((d) => {
    const c = makeCanvas(W, H, o.createCanvas), g = c.getContext('2d');
    // draw three copies shifted by the width so shapes crossing an edge wrap around
    for (const dx of [-W, 0, W]) { g.save(); g.translate(dx, 0); d.paint(g); g.restore(); }
    return { canvas: c, factor: d.factor, name: d.name, patterns: new WeakMap() };
  });
  const skyCache = { h: 0, grad: null, ctx: null };
  const celestial = SKYPAINT[kind] ? SKYPAINT[kind](S, o.createCanvas) : null;
  // sky: a cached vertical gradient over the screen rect
  function drawSky(ctx, x, y, w, h) {
    if (skyCache.h !== h || skyCache.y !== y || skyCache.ctx !== ctx || !skyCache.grad) {
      const gr = ctx.createLinearGradient(0, y, 0, y + h);
      gr.addColorStop(0, S.top); gr.addColorStop(0.62, S.horizon); gr.addColorStop(1, S.haze || S.horizon);
      skyCache.grad = gr; skyCache.h = h; skyCache.y = y; skyCache.ctx = ctx;
    }
    ctx.fillStyle = skyCache.grad;
    ctx.fillRect(x, y, w, h);
  }
  // the layers, scrolled along their own x by `along`, shifted across by `across`, in the rect
  function drawLayers(ctx, along, across, x, y, w, h) {
    const s = h / H, lw = W * s;
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    for (const L of layers) {
      const off = -(((along * L.factor) % lw) + lw) % lw;
      const oy = y - across * L.factor * 0.2;
      // a repeat-x pattern wraps exactly (drawImage copies would overlap or gap by a pixel)
      let pat = L.patterns.get(ctx);
      if (pat === undefined) {
        pat = null;
        try { pat = ctx.createPattern(L.canvas, 'repeat-x'); if (!pat || typeof pat.setTransform !== 'function' || typeof DOMMatrix === 'undefined') pat = null; } catch { pat = null; }
        L.patterns.set(ctx, pat);
      }
      if (pat) {
        pat.setTransform(new DOMMatrix([s, 0, 0, s, x + off, oy]));
        ctx.fillStyle = pat;
        ctx.fillRect(x, y, w, h);
      } else {
        for (let xx = x + off; xx < x + w; xx += lw) ctx.drawImage(L.canvas, xx, oy, lw, h);
      }
    }
    ctx.imageSmoothingEnabled = prev;
  }
  return {
    kind, layers, width: W, height: H, scheme: S, direction: vertical ? 'vertical' : 'horizontal',
    draw(ctx, scroll = 0, { x = 0, y = 0, w = ctx.canvas ? ctx.canvas.width : W, h = ctx.canvas ? ctx.canvas.height : H, cameraY = 0, cameraX = 0 } = {}) {
      drawSky(ctx, x, y, w, h);
      // the sun / moon / planet at a fixed spot (very far away)
      if (celestial) celestial(ctx, x, y, w, h, vertical ? 0 : scroll);
      if (!vertical) { drawLayers(ctx, scroll, cameraY, x, y, w, h); return; }
      // vertical: the layers run up the screen (a quarter turn about the rect's bottom-left corner),
      // so a growing scroll streams them DOWN; cameraX slides them sideways
      ctx.save();
      ctx.translate(x, y + h);
      ctx.rotate(-Math.PI / 2);
      drawLayers(ctx, scroll, cameraX, 0, 0, h, w);
      ctx.restore();
    },
  };
}

// silhouette helpers (draw into a layer canvas; called for x offsets -W, 0, W)
function ridgePath(g, W, H, baseY, amp, f, { sharp = false, top = false } = {}) {
  g.beginPath();
  g.moveTo(0, top ? 0 : H);
  for (let x = 0; x <= W; x += 4) {
    let n = f(x / W);
    if (sharp) n = 1 - Math.abs(n * 2 - 1);
    const yy = top ? baseY + amp * n : baseY - amp * n;
    g.lineTo(x, yy);
  }
  g.lineTo(W, top ? 0 : H);
  g.closePath();
}
const line1d = (period, oct, seed) => { const f = fbm2(period, 1, oct, seed); return (u) => f(((u % 1) + 1) % 1, 0.5); };
function vgrad(g, y0, y1, a, b) { const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; }
function hazeBand(g, W, y0, y1, color, a) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, rgba(color, 0)); gr.addColorStop(1, rgba(color, a));
  g.fillStyle = gr; g.fillRect(0, y0, W, y1 - y0);
}
function stars(g, W, H, n, rng, maxY, size = 1.2, color = '#FFFFFF') {
  for (let i = 0; i < n; i++) {
    const x = rng.next() * W, y = rng.next() * maxY, r = (0.4 + rng.next() * rng.next() * size);
    g.fillStyle = rgba(color, 0.35 + rng.next() * 0.65);
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
}
function glowDisc(g, x, y, r, color, glow) {
  const gr = g.createRadialGradient(x, y, r * 0.2, x, y, r * 4);
  gr.addColorStop(0, rgba(glow, 0.55)); gr.addColorStop(0.3, rgba(glow, 0.18)); gr.addColorStop(1, rgba(glow, 0));
  g.fillStyle = gr; g.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
  g.fillStyle = color; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}
function pine(g, x, baseY, h, color) {
  g.fillStyle = color;
  g.fillRect(x - h * 0.03, baseY - h * 0.25, h * 0.06, h * 0.25);
  for (let k = 0; k < 3; k++) {
    const y = baseY - h * 0.2 - k * h * 0.26, w = h * (0.34 - k * 0.08);
    g.beginPath(); g.moveTo(x - w, y); g.lineTo(x, y - h * 0.42); g.lineTo(x + w, y); g.closePath(); g.fill();
  }
}

// Sky painters: things drawn once per frame at a fixed screen spot (no parallax).
const SKYPAINT = {
  'city-night': (S) => (ctx, x, y, w, h) => { glowDisc(ctx, x + w * 0.78, y + h * 0.2, h * 0.055, S.moon, S.glow); },
  forest: (S) => (ctx, x, y, w, h) => { glowDisc(ctx, x + w * 0.72, y + h * 0.22, h * 0.06, S.sun, S.glow); },
  desert: (S) => (ctx, x, y, w, h) => { glowDisc(ctx, x + w * 0.3, y + h * 0.3, h * 0.09, S.sun, S.glow); },
  mountains: (S) => (ctx, x, y, w, h) => { glowDisc(ctx, x + w * 0.2, y + h * 0.18, h * 0.05, S.sun, S.glow); },
  sea: (S) => (ctx, x, y, w, h) => {
    glowDisc(ctx, x + w * 0.5, y + h * 0.56, h * 0.08, S.sun, S.glow);
    // glitter path on the water under the sun
    ctx.fillStyle = rgba(S.sun, 0.55);
    for (let k = 0; k < 26; k++) {
      const yy = y + h * (0.66 + k * 0.013), ww = w * (0.02 + k * 0.004) * (0.6 + 0.4 * Math.sin(k * 7.1));
      ctx.fillRect(x + w * 0.5 - ww / 2, yy, ww, Math.max(1, h * 0.004));
    }
  },
  space: () => null,
  cave: () => null,
};

const LAYERS = {
  'city-night': (S, W, H, rng, seed) => {
    const sky = (g) => { stars(g, W, H, 220, createRng(seed + 1), H * 0.55, 1.4); };
    const skyline = (count, minW, maxW, minH, maxH, color, winA, factorName, near) => (g) => {
      const r = createRng(`${seed}:${factorName}`);
      let x = 0;
      while (x < W) {
        const bw = minW + r.next() * (maxW - minW);
        const bh = minH + r.next() * (maxH - minH);
        const top = H - bh;
        g.fillStyle = color;
        g.fillRect(x, top, bw + 1, bh);
        if (near) {
          // rooftop details: parapet, AC boxes, a water tower or an antenna
          g.fillRect(x - 2, top - 4, bw + 4, 4);
          if (r.next() > 0.5) g.fillRect(x + bw * 0.2, top - 14, bw * 0.18, 10);
          if (r.next() > 0.6) { g.fillRect(x + bw * 0.6, top - 30, 14, 22); g.fillRect(x + bw * 0.6 + 2, top - 8, 2, 8); g.fillRect(x + bw * 0.6 + 10, top - 8, 2, 8); }
        } else if (r.next() > 0.55) { g.fillRect(x + bw * 0.5 - 1, top - 26, 2, 26); g.fillStyle = rgba('#FF4050', 0.9); g.fillRect(x + bw * 0.5 - 2, top - 28, 4, 3); }
        // windows
        if (winA > 0) {
          const cw = near ? 7 : 5, ch = near ? 9 : 6;
          for (let wy = top + 8; wy < H - 6; wy += ch + 4) for (let wx = x + 5; wx < x + bw - cw - 3; wx += cw + 4) {
            if (r.next() > 0.38) continue;
            g.fillStyle = rgba(S.win[(r.next() * S.win.length) | 0], winA * (0.5 + r.next() * 0.5));
            g.fillRect(wx, wy, cw, ch);
          }
        }
        // a neon sign now and then
        if (!near && r.next() > 0.7) {
          const nc = S.neon[(r.next() * S.neon.length) | 0], ny = top + 20 + r.next() * 40;
          g.save(); g.shadowColor = nc; g.shadowBlur = 14; g.strokeStyle = nc; g.lineWidth = 3;
          g.strokeRect(x + bw * 0.2, ny, bw * 0.6, 16); g.restore();
        }
        x += bw + (near ? 6 + r.next() * 30 : r.next() * 6);
      }
    };
    return [
      { name: 'stars', factor: 0.02, paint: sky },
      { name: 'far', factor: 0.12, paint: (g) => { skyline(0, 30, 70, 90, 210, S.far, 0.35, 'far', false)(g); hazeBand(g, W, H * 0.55, H, S.haze, 0.35); } },
      { name: 'mid', factor: 0.35, paint: skyline(0, 50, 120, 120, 300, S.mid, 0.8, 'mid', false) },
      { name: 'near', factor: 0.75, paint: (g) => { skyline(0, 90, 200, 60, 150, S.near, 0.9, 'near', true)(g); g.fillStyle = S.near; g.fillRect(0, H - 20, W, 20); } },
    ];
  },
  forest: (S, W, H, rng, seed) => [
    { name: 'far-hills', factor: 0.08, paint: (g) => { const f = line1d(3, 3, seed); ridgePath(g, W, H, H * 0.62, H * 0.18, f); g.fillStyle = S.far; g.fill(); hazeBand(g, W, H * 0.5, H, S.haze, 0.5); } },
    { name: 'canopy', factor: 0.25, paint: (g) => {
      const f = line1d(4, 3, seed + 1), r = createRng(seed + 2);
      ridgePath(g, W, H, H * 0.74, H * 0.12, f); g.fillStyle = S.mid; g.fill();
      for (let x = 0; x < W; x += 18 + r.next() * 14) { const y = H * 0.74 - H * 0.12 * f(x / W); g.beginPath(); g.arc(x, y + 6, 14 + r.next() * 16, 0, Math.PI * 2); g.fill(); }
      hazeBand(g, W, H * 0.62, H, S.haze, 0.3);
    } },
    { name: 'pines', factor: 0.5, paint: (g) => {
      const r = createRng(seed + 3);
      for (let x = 0; x < W; x += 22 + r.next() * 30) pine(g, x, H * 0.92, H * (0.22 + r.next() * 0.16), S.near);
      g.fillStyle = S.near; g.fillRect(0, H * 0.9, W, H * 0.1);
    } },
    { name: 'ground', factor: 0.9, paint: (g) => {
      const f = line1d(6, 3, seed + 4), r = createRng(seed + 5);
      ridgePath(g, W, H, H * 0.97, H * 0.05, f); g.fillStyle = S.ground; g.fill();
      // grass tufts: little clusters of pointed blades along the ridge
      for (let x = 0; x < W; x += 10 + r.next() * 26) {
        const y = H * 0.97 - H * 0.05 * f(x / W) + 3;
        for (let k = -2; k <= 2; k++) {
          const bx = x + k * 3, bh = 6 + r.next() * 9 - Math.abs(k) * 2;
          g.beginPath(); g.moveTo(bx - 2, y); g.lineTo(bx + k * 0.8, y - bh); g.lineTo(bx + 2, y); g.closePath(); g.fill();
        }
      }
    } },
  ],
  desert: (S, W, H, rng, seed) => [
    { name: 'mesas', factor: 0.06, paint: (g) => {
      const r = createRng(seed);
      g.fillStyle = S.far;
      let x = 0;
      while (x < W) {
        const w = 60 + r.next() * 160, h = H * (0.08 + r.next() * 0.16), base = H * 0.66;
        g.beginPath(); g.moveTo(x, base); g.lineTo(x + w * 0.12, base - h); g.lineTo(x + w * 0.88, base - h); g.lineTo(x + w, base); g.closePath(); g.fill();
        x += w + 40 + r.next() * 200;
      }
      g.fillRect(0, H * 0.655, W, H);
      hazeBand(g, W, H * 0.45, H * 0.7, S.haze, 0.55);
    } },
    { name: 'dunes', factor: 0.22, paint: (g) => { const f = line1d(2, 2, seed + 1); ridgePath(g, W, H, H * 0.8, H * 0.12, f); g.fillStyle = vgrad(g, H * 0.65, H, S.mid, mixHex(S.mid, S.near, 0.5)); g.fill(); } },
    { name: 'near-dunes', factor: 0.55, paint: (g) => {
      const f = line1d(2, 3, seed + 2), r = createRng(seed + 3);
      ridgePath(g, W, H, H * 0.93, H * 0.1, f); g.fillStyle = vgrad(g, H * 0.8, H, S.near, mixHex(S.near, '#000000', 0.25)); g.fill();
      g.fillStyle = S.cactus;
      for (let x = 30; x < W; x += 140 + r.next() * 260) {
        const by = H * 0.93 - H * 0.1 * f(x / W) + 4, h = 40 + r.next() * 40;
        roundRectPath(g, x - 5, by - h, 10, h, 5); g.fill();
        roundRectPath(g, x - 18, by - h * 0.7, 7, h * 0.35, 3.5); g.fill(); g.fillRect(x - 18, by - h * 0.4, 14, 6);
        roundRectPath(g, x + 11, by - h * 0.85, 7, h * 0.4, 3.5); g.fill(); g.fillRect(x + 4, by - h * 0.5, 14, 6);
      }
    } },
  ],
  mountains: (S, W, H, rng, seed) => {
    const range = (base, amp, period, sd, color, snowLine) => (g) => {
      const f = line1d(period, 4, sd);
      ridgePath(g, W, H, base, amp, f, { sharp: true });
      g.fillStyle = color; g.fill();
      if (snowLine != null) {
        g.save(); ridgePath(g, W, H, base, amp, f, { sharp: true }); g.clip();
        const sf = line1d(period * 4, 2, sd + 9);
        g.beginPath(); g.moveTo(0, 0);
        for (let x = 0; x <= W; x += 4) g.lineTo(x, snowLine + sf(x / W) * 22);
        g.lineTo(W, 0); g.closePath(); g.fillStyle = S.snow; g.fill();
        g.restore();
      }
    };
    return [
      { name: 'far-range', factor: 0.05, paint: (g) => { range(H * 0.66, H * 0.36, 5, seed, S.far, H * 0.4)(g); hazeBand(g, W, H * 0.4, H * 0.7, S.haze, 0.5); } },
      { name: 'mid-range', factor: 0.18, paint: (g) => { range(H * 0.8, H * 0.32, 4, seed + 1, S.mid, H * 0.56)(g); hazeBand(g, W, H * 0.6, H, S.haze, 0.25); } },
      { name: 'hills', factor: 0.45, paint: (g) => {
        const f = line1d(3, 3, seed + 2), r = createRng(seed + 3);
        ridgePath(g, W, H, H * 0.94, H * 0.1, f); g.fillStyle = S.near; g.fill();
        for (let x = 0; x < W; x += 16 + r.next() * 22) pine(g, x, H * 0.95 - H * 0.1 * f(x / W) + 8, H * (0.1 + r.next() * 0.08), mixHex(S.near, '#000000', 0.25));
      } },
    ];
  },
  sea: (S, W, H, rng, seed) => [
    { name: 'islands', factor: 0.04, paint: (g) => {
      const r = createRng(seed);
      g.fillStyle = S.far;
      for (let x = 40; x < W; x += 260 + r.next() * 300) { const w = 80 + r.next() * 140, h = 14 + r.next() * 30; g.beginPath(); g.ellipse(x, H * 0.62, w / 2, h, 0, Math.PI, 0); g.fill(); }
    } },
    { name: 'far-sea', factor: 0.1, paint: (g) => {
      g.fillStyle = vgrad(g, H * 0.62, H, mixHex(S.horizon, S.mid, 0.55), S.mid); g.fillRect(0, H * 0.62, W, H * 0.38);
      const r = createRng(seed + 1);
      g.fillStyle = rgba(S.foam, 0.18);
      for (let i = 0; i < 160; i++) { const y = H * (0.63 + r.next() * 0.2), w = 6 + r.next() * 30; g.fillRect(r.next() * W, y, w, 1.2); }
    } },
    { name: 'waves', factor: 0.4, paint: (g) => {
      const f = line1d(10, 2, seed + 2);
      ridgePath(g, W, H, H * 0.82, H * 0.025, f); g.fillStyle = S.near; g.fill();
      g.strokeStyle = rgba(S.foam, 0.5); g.lineWidth = 2;
      g.beginPath(); for (let x = 0; x <= W; x += 4) { const y = H * 0.82 - H * 0.025 * f(x / W); if (x) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke();
    } },
    { name: 'near-waves', factor: 0.85, paint: (g) => {
      const f = line1d(6, 2, seed + 3);
      ridgePath(g, W, H, H * 0.94, H * 0.035, f); g.fillStyle = mixHex(S.near, '#000000', 0.3); g.fill();
      g.strokeStyle = rgba(S.foam, 0.7); g.lineWidth = 3;
      g.beginPath(); for (let x = 0; x <= W; x += 4) { const y = H * 0.94 - H * 0.035 * f(x / W); if (x) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke();
    } },
  ],
  space: (S, W, H, rng, seed) => [
    { name: 'dust', factor: 0.02, paint: (g) => { stars(g, W, H, 600, createRng(seed), H, 0.9); } },
    { name: 'nebula', factor: 0.06, paint: (g) => {
      const r = createRng(seed + 1);
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 26; i++) {
        const x = r.next() * W, y = H * (0.2 + r.next() * 0.6), rad = 60 + r.next() * 180, c = S.nebula[i % S.nebula.length];
        const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, rgba(c, 0.16)); gr.addColorStop(1, rgba(c, 0));
        g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      g.globalCompositeOperation = 'source-over';
    } },
    { name: 'stars', factor: 0.15, paint: (g) => {
      const r = createRng(seed + 2);
      for (let i = 0; i < 70; i++) {
        const x = r.next() * W, y = r.next() * H, s = 1 + r.next() * 2.2;
        g.fillStyle = rgba('#FFFFFF', 0.9); g.beginPath(); g.arc(x, y, s * 0.6, 0, Math.PI * 2); g.fill();
        if (s > 2.4) { g.fillStyle = rgba('#CFE0FF', 0.5); g.fillRect(x - s * 3, y - 0.5, s * 6, 1); g.fillRect(x - 0.5, y - s * 3, 1, s * 6); }
      }
    } },
    { name: 'planet', factor: 0.3, paint: (g) => {
      const x = W * 0.3, y = H * 0.42, rad = H * 0.16;
      const gr = g.createRadialGradient(x - rad * 0.4, y - rad * 0.4, rad * 0.1, x, y, rad);
      gr.addColorStop(0, mixHex(S.planet, '#FFFFFF', 0.35)); gr.addColorStop(0.7, S.planet); gr.addColorStop(1, mixHex(S.planet, '#000000', 0.6));
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
      g.strokeStyle = rgba(S.ring, 0.75); g.lineWidth = rad * 0.08;
      g.beginPath(); g.ellipse(x, y, rad * 1.75, rad * 0.38, -0.25, 0.05 * Math.PI, 0.98 * Math.PI, true); g.stroke();
    } },
    { name: 'asteroids', factor: 0.7, paint: (g) => {
      const r = createRng(seed + 4);
      for (let i = 0; i < 9; i++) {
        const cx = r.next() * W, cy = H * (0.15 + r.next() * 0.75), rad = 6 + r.next() * 22;
        const pts = []; for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2, rr = rad * (0.7 + r.next() * 0.4); pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); }
        drawOutlined(g, pts, S.near, mixHex(S.near, '#000000', 0.5), { width: 1.5, light: 0.3, dark: 0.4 });
      }
    } },
  ],
  cave: (S, W, H, rng, seed) => [
    { name: 'far-wall', factor: 0.08, paint: (g) => {
      const f = line1d(6, 3, seed), f2 = line1d(5, 3, seed + 1);
      ridgePath(g, W, H, H * 0.2, H * 0.14, f, { top: true }); g.fillStyle = S.far; g.fill();
      ridgePath(g, W, H, H * 0.8, H * 0.12, f2); g.fill();
    } },
    { name: 'crystals', factor: 0.22, paint: (g) => {
      const r = createRng(seed + 2);
      for (let i = 0; i < 14; i++) {
        const x = r.next() * W, by = H * (0.78 + r.next() * 0.1), c = S.crystal[i % S.crystal.length], h = 18 + r.next() * 40;
        g.save(); g.shadowColor = c; g.shadowBlur = 18;
        for (let k = -1; k <= 1; k++) { g.fillStyle = mixHex(c, '#FFFFFF', 0.2 + k * 0.1); g.beginPath(); g.moveTo(x + k * 8 - 5, by); g.lineTo(x + k * 9, by - h * (1 - Math.abs(k) * 0.35)); g.lineTo(x + k * 8 + 5, by); g.closePath(); g.fill(); }
        g.restore();
      }
    } },
    { name: 'stalactites', factor: 0.45, paint: (g) => {
      const r = createRng(seed + 3);
      g.fillStyle = S.mid;
      g.fillRect(0, 0, W, H * 0.06);
      for (let x = 0; x < W; x += 18 + r.next() * 40) { const w = 10 + r.next() * 26, h = H * (0.08 + r.next() * 0.2); g.beginPath(); g.moveTo(x - w / 2, 0); g.lineTo(x, h); g.lineTo(x + w / 2, 0); g.closePath(); g.fill(); }
      g.fillRect(0, H * 0.9, W, H * 0.1);
      for (let x = 0; x < W; x += 30 + r.next() * 60) { const w = 14 + r.next() * 30, h = H * (0.05 + r.next() * 0.12); g.beginPath(); g.moveTo(x - w / 2, H * 0.92); g.lineTo(x, H * 0.92 - h); g.lineTo(x + w / 2, H * 0.92); g.closePath(); g.fill(); }
    } },
    { name: 'near-rocks', factor: 0.85, paint: (g) => {
      const f = line1d(3, 3, seed + 4), r = createRng(seed + 5);
      ridgePath(g, W, H, H * 0.96, H * 0.08, f); g.fillStyle = S.near; g.fill();
      for (let x = 20; x < W; x += 120 + r.next() * 200) {
        const y = H * 0.96 - H * 0.08 * f(x / W);
        g.save(); g.shadowColor = S.shroom; g.shadowBlur = 12;
        g.fillStyle = mixHex(S.shroom, '#FFFFFF', 0.2); g.fillRect(x - 1.5, y - 12, 3, 12);
        g.beginPath(); g.ellipse(x, y - 12, 9, 5, 0, Math.PI, 0); g.fill();
        g.restore();
      }
    } },
  ],
};

// ------------------------------------------------------------------ HUD
const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * A clean HUD panel: rounded, outlined, soft drop shadow, subtle top highlight.
 * @param rect {x,y,w,h} or [x,y,w,h]
 * @param {object} [style] { palette='braindaemon', radius=12, alpha=0.88, title, accent, pad=10, glass=true }
 * @returns the content rect inside the padding (below the title when there is one)
 */
export function hudPanel(ctx, rect, style = {}) {
  const r = R(rect);
  const P = getPalette(style.palette);
  const rad = style.radius ?? 12, a = style.alpha ?? 0.88, pad = style.pad ?? 10;
  const fill = style.fill || P.panel, edge = style.edge || P.edge;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = style.shadow ?? 16; ctx.shadowOffsetY = 4;
  roundRectPath(ctx, r.x, r.y, r.w, r.h, rad);
  const gr = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
  gr.addColorStop(0, rgba(shadeHex(fill, 0.08), a)); gr.addColorStop(1, rgba(shadeHex(fill, -0.12), a));
  ctx.fillStyle = gr; ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
  ctx.lineWidth = 1.5; ctx.strokeStyle = rgba(edge, 0.95); ctx.stroke();
  // inner top highlight
  roundRectPath(ctx, r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3, Math.max(0, rad - 1.5));
  ctx.save(); ctx.clip();
  const hl = ctx.createLinearGradient(0, r.y, 0, r.y + Math.min(24, r.h * 0.5));
  hl.addColorStop(0, 'rgba(255,255,255,0.10)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = hl; ctx.fillRect(r.x, r.y, r.w, Math.min(24, r.h * 0.5));
  ctx.restore();
  let top = r.y + pad;
  if (style.accent !== false) {
    ctx.fillStyle = style.accent || P.accent;
    roundRectPath(ctx, r.x + pad, r.y - 1.5, Math.min(36, r.w * 0.3), 3, 1.5); ctx.fill();
  }
  if (style.title) {
    ctx.font = `700 ${style.titleSize || 12}px ${FONT}`;
    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.fillStyle = P.dim;
    ctx.fillText(String(style.title).toUpperCase(), r.x + pad, top);
    top += (style.titleSize || 12) + 6;
  }
  ctx.restore();
  return { x: r.x + pad, y: top, w: r.w - pad * 2, h: r.y + r.h - pad - top };
}

/** colour for a 0..1 value: good -> warn -> bad */
export function statusColor(value, P = getPalette()) {
  return value > 0.5 ? P.good : value > 0.25 ? P.warn : P.bad;
}

/**
 * A finished health/energy bar (capsule, inner gloss, optional segments, ghost damage, label).
 * @param {object} [style] { palette, color (default good/warn/bad by value), back, segments=0, ghost, label, radius }
 */
export function healthBar(ctx, rect, value, style = {}) {
  const r = R(rect);
  const P = getPalette(style.palette);
  const v = clamp(value), rad = style.radius ?? r.h / 2;
  const col = style.color || statusColor(v, P);
  ctx.save();
  // outer ink outline + track
  roundRectPath(ctx, r.x - 2, r.y - 2, r.w + 4, r.h + 4, rad + 2);
  ctx.fillStyle = rgba(P.ink, 0.85); ctx.fill();
  roundRectPath(ctx, r.x, r.y, r.w, r.h, rad);
  ctx.fillStyle = style.back || shadeHex(P.panel, -0.25); ctx.fill();
  ctx.save(); ctx.clip();
  if (Number.isFinite(style.ghost) && style.ghost > v) {
    ctx.fillStyle = rgba('#FFFFFF', 0.55);
    ctx.fillRect(r.x, r.y, r.w * clamp(style.ghost), r.h);
  }
  if (v > 0) {
    const gr = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    gr.addColorStop(0, shadeHex(col, 0.3)); gr.addColorStop(0.5, col); gr.addColorStop(1, shadeHex(col, -0.25));
    ctx.fillStyle = gr;
    roundRectPath(ctx, r.x, r.y, Math.max(r.h, r.w * v), r.h, rad);
    if (r.w * v < r.h) { ctx.save(); ctx.globalAlpha = (r.w * v) / r.h; ctx.fill(); ctx.restore(); } else ctx.fill();
    // gloss
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    roundRectPath(ctx, r.x + 3, r.y + 2, Math.max(0, r.w * v - 6), Math.max(1, r.h * 0.32), r.h * 0.16); ctx.fill();
  }
  if (style.segments > 1) {
    ctx.fillStyle = rgba(P.ink, 0.45);
    for (let i = 1; i < style.segments; i++) ctx.fillRect(r.x + (r.w * i) / style.segments - 1, r.y, 2, r.h);
  }
  ctx.restore();
  roundRectPath(ctx, r.x, r.y, r.w, r.h, rad);
  ctx.lineWidth = 1; ctx.strokeStyle = rgba('#FFFFFF', 0.18); ctx.stroke();
  if (style.label) hudText(ctx, style.label, r.x + r.w / 2, r.y + r.h / 2 + 0.5, { size: Math.max(9, r.h * 0.62), align: 'center', palette: style.palette });
  ctx.restore();
}

/**
 * A portrait frame: ring with a soft shadow, the image (or a draw callback) clipped inside, optional badge.
 * @param image  drawable | (ctx, innerRect) => void | null
 * @param {object} [style] { palette, shape='circle'|'rounded', ring (colour), ringWidth=3, badge, back }
 */
export function portrait(ctx, rect, image, style = {}) {
  const r = R(rect);
  const P = getPalette(style.palette);
  const ringW = style.ringWidth ?? 3, ring = style.ring || P.accent;
  const round = style.shape === 'rounded';
  const path = (inset) => {
    if (round) roundRectPath(ctx, r.x + inset, r.y + inset, r.w - inset * 2, r.h - inset * 2, Math.max(2, 12 - inset));
    else { ctx.beginPath(); ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2 - inset, r.h / 2 - inset, 0, 0, Math.PI * 2); }
  };
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
  path(0); ctx.fillStyle = P.ink; ctx.fill();
  ctx.shadowColor = 'transparent';
  path(1);
  const gr = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
  gr.addColorStop(0, shadeHex(ring, 0.35)); gr.addColorStop(1, shadeHex(ring, -0.3));
  ctx.fillStyle = gr; ctx.fill();
  const inner = { x: r.x + 1 + ringW, y: r.y + 1 + ringW, w: r.w - 2 - ringW * 2, h: r.h - 2 - ringW * 2 };
  path(1 + ringW);
  const bg = ctx.createLinearGradient(0, inner.y, 0, inner.y + inner.h);
  bg.addColorStop(0, style.back || shadeHex(P.panel, 0.2)); bg.addColorStop(1, shadeHex(style.back || P.panel, -0.2));
  ctx.fillStyle = bg; ctx.fill();
  ctx.save(); ctx.clip();
  if (typeof image === 'function') image(ctx, inner);
  else if (image && image.width) {
    const s = Math.max(inner.w / image.width, inner.h / image.height);
    const w = image.width * s, h = image.height * s;
    ctx.drawImage(image, inner.x + (inner.w - w) / 2, inner.y + (inner.h - h) / 2, w, h);
  }
  // glass sheen
  const sh = ctx.createLinearGradient(0, inner.y, 0, inner.y + inner.h * 0.5);
  sh.addColorStop(0, 'rgba(255,255,255,0.16)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sh; ctx.fillRect(inner.x, inner.y, inner.w, inner.h * 0.5);
  ctx.restore();
  if (style.badge != null) {
    const br = Math.max(8, r.w * 0.17), bx = r.x + r.w - br * 0.8, by = r.y + r.h - br * 0.8;
    drawOutlined(ctx, { x: bx, y: by, radius: br }, P.primary, P.ink, { width: 2 });
    hudText(ctx, String(style.badge), bx, by + 0.5, { size: br * 1.05, align: 'center', palette: style.palette });
  }
  ctx.restore();
  return inner;
}

/**
 * Meters: 'ring' (circular gauge), 'pips' (a row of filled pips) or 'bar' (slim capsule).
 * @param {object} [style] { kind='ring', palette, color, count=5 (pips), label, thickness }
 */
export function meter(ctx, rect, value, style = {}) {
  const r = R(rect);
  const P = getPalette(style.palette);
  const v = clamp(value), col = style.color || P.secondary;
  const kind = style.kind || 'ring';
  ctx.save();
  if (kind === 'ring') {
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = Math.min(r.w, r.h) / 2 - 2, th = style.thickness ?? Math.max(3, rad * 0.22);
    ctx.lineCap = 'round';
    ctx.lineWidth = th + 3; ctx.strokeStyle = rgba(P.ink, 0.85);
    ctx.beginPath(); ctx.arc(cx, cy, rad - th / 2, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = th; ctx.strokeStyle = shadeHex(P.panel, -0.2);
    ctx.beginPath(); ctx.arc(cx, cy, rad - th / 2, 0, Math.PI * 2); ctx.stroke();
    if (v > 0) {
      ctx.strokeStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(cx, cy, rad - th / 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * v); ctx.stroke();
    }
    ctx.shadowBlur = 0;
    hudText(ctx, style.label ?? `${Math.round(v * 100)}`, cx, cy + 0.5, { size: rad * 0.62, align: 'center', palette: style.palette });
  } else if (kind === 'pips') {
    const n = style.count ?? 5, gap = Math.max(2, r.w * 0.04), pw = (r.w - gap * (n - 1)) / n;
    const filled = v * n;
    for (let i = 0; i < n; i++) {
      const on = clamp(filled - i);
      const x = r.x + i * (pw + gap);
      drawOutlined(ctx, { x, y: r.y, w: pw, h: r.h, r: Math.min(4, r.h / 3) }, on > 0 ? (on >= 1 ? col : mixHex(shadeHex(P.panel, -0.2), col, on)) : shadeHex(P.panel, -0.2), rgba(P.ink, 0.9), { width: 1.5, light: on > 0 ? 0.35 : 0.08 });
    }
  } else {
    healthBar(ctx, r, v, { palette: style.palette, color: col, radius: r.h / 2 });
  }
  ctx.restore();
}

/** outlined HUD text (dark outline + soft shadow) that stays readable on any background */
export function hudText(ctx, text, x, y, { size = 14, color, outline, align = 'left', weight = 800, palette: pal, baseline = 'middle' } = {}) {
  const P = getPalette(pal);
  const fill = color || P.text;
  // dark text gets a light outline (storybook-style palettes), light text a dark one
  const darkText = isHex(fill) && luminance(fill) < 0.45;
  ctx.save();
  ctx.font = `${weight} ${Math.round(size)}px ${FONT}`;
  ctx.textAlign = align; ctx.textBaseline = baseline;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size * 0.2);
  ctx.strokeStyle = outline || (darkText ? rgba('#FFFFFF', 0.85) : rgba(P.ink, 0.9));
  ctx.shadowColor = darkText ? 'transparent' : 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
  ctx.strokeText(text, x, y);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  ctx.restore();
}
