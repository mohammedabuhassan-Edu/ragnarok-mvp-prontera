// brand-art.js — 2D canvas drawing for the Brand Kit (used by brand.js).
//
// - The daemon mark, drawn from the official vector geometry in
//   braindaemon-icons/svg/core-mark.svg (crisp at any texture size), or from
//   assets/brand/core-mark-256.png when it is loaded and the target is small.
// - The two-tone "BrainDaemon" wordmark.
// - Neon glow passes, and a hand-made 16x16 pixel mark plus a 5x7 pixel font
//   for 2D/pixel games.
// Pure canvas-2D calls only, so a fake context works in Node tests.

export const WORDMARK = 'BrainDaemon';
export const SITE = 'braindaemon.com';
export const COLORS = {
  tile: '#0E1322', tileEdge: '#22314F', blue: '#2A63EE', ear: '#4C86FF', light: '#86B4FF',
  ring: '#1B3F9E', pupil: '#0A0E1A', hi: '#EAF2FF', spark: '#B9D2FF',
  gold: '#F4B60A', goldLight: '#FCD34D', violet: '#8B5CF6', white: '#FFFFFF',
};
export const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';

// ------------------------------------------------------------------ colour utils
export function rgba(hex, a = 1) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
/** mix a hex colour toward white (t=0..1) */
export function tint(hex, t) {
  const n = parseInt(hex.replace('#', ''), 16);
  const m = (c) => Math.round(c + (255 - c) * t);
  return `rgb(${m((n >> 16) & 255)},${m((n >> 8) & 255)},${m(n & 255)})`;
}

export function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ------------------------------------------------------------------ the mark
// Mark geometry lives in a 256x256 box; its visible bounds are about
// x 52..204, y 44..198, centred on (128, 121).
const MARK_BOX = { x: 52, y: 44, w: 152, h: 154, cx: 128, cy: 121 };
export const MARK_ASPECT = MARK_BOX.w / MARK_BOX.h;

function earPath(ctx) {
  // "M0 -58 C13 -33 12 5 0 24 C-12 5 -13 -33 0 -58 Z"
  ctx.beginPath();
  ctx.moveTo(0, -58);
  ctx.bezierCurveTo(13, -33, 12, 5, 0, 24);
  ctx.bezierCurveTo(-12, 5, -13, -33, 0, -58);
  ctx.closePath();
}
function eachEar(ctx, fn) {
  for (const [x, deg] of [[107, -23], [149, 23]]) {
    ctx.save();
    ctx.translate(x, 102);
    ctx.rotate((deg * Math.PI) / 180);
    earPath(ctx);
    fn();
    ctx.restore();
  }
}
function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

/**
 * Draw the daemon mark centred at (cx, cy) with height h.
 * style: 'color' (official colours) | 'mono' (one colour) | 'neon' (glowing tube outline)
 */
export function drawMark(ctx, cx, cy, h, { style = 'color', color = COLORS.ear, img = null } = {}) {
  if (style === 'color' && img && h <= MARK_BOX.h * 1.15) {
    // Small target: the rasterised PNG is the exact brand asset.
    const w = h * MARK_ASPECT;
    ctx.drawImage(img, MARK_BOX.x, MARK_BOX.y, MARK_BOX.w, MARK_BOX.h, cx - w / 2, cy - h / 2, w, h);
    return;
  }
  const s = h / MARK_BOX.h;
  const lw = ctx.lineWidth; // caller's line width is in output pixels
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.translate(-MARK_BOX.cx, -MARK_BOX.cy);
  if (style === 'color') {
    ctx.fillStyle = COLORS.ear; eachEar(ctx, () => ctx.fill());
    ctx.fillStyle = COLORS.light; circle(ctx, 128, 140, 54); ctx.fill();
    ctx.fillStyle = COLORS.blue; circle(ctx, 132, 146, 50); ctx.fill();
    ctx.strokeStyle = rgba(COLORS.ring, 0.55); ctx.lineWidth = 2; circle(ctx, 128, 140, 53); ctx.stroke();
    ctx.fillStyle = COLORS.pupil; circle(ctx, 131, 145, 24); ctx.fill();
    ctx.fillStyle = COLORS.hi; circle(ctx, 118, 131, 8); ctx.fill();
    ctx.fillStyle = COLORS.spark; circle(ctx, 141, 153, 3.5); ctx.fill();
  } else if (style === 'mono') {
    ctx.fillStyle = color;
    eachEar(ctx, () => ctx.fill());
    // ring (outer minus inner) + pupil, like core-mono.svg
    ctx.beginPath();
    ctx.arc(128, 140, 54, 0, Math.PI * 2);
    ctx.arc(128, 140, 32, 0, Math.PI * 2, true);
    ctx.fill();
    circle(ctx, 128, 140, 16); ctx.fill();
  } else {
    // neon: outlines as glowing tubes (caller sets glow via neonPasses)
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = lw / s; // undo the mark scale so tubes keep the requested width
    eachEar(ctx, () => ctx.stroke());
    circle(ctx, 128, 140, 52); ctx.stroke();
    circle(ctx, 130, 144, 20); ctx.stroke();
    ctx.save(); ctx.fillStyle = ctx.strokeStyle; circle(ctx, 118, 131, 6); ctx.fill(); ctx.restore();
  }
  ctx.restore();
}

// ------------------------------------------------------------------ wordmark
/**
 * Two-tone wordmark: "Brain" light, "Daemon" brand blue. Returns its width.
 * align: 'left' | 'center' | 'right' around x; y is the text middle.
 */
export function drawWordmark(ctx, x, y, size, {
  align = 'left', a = COLORS.hi, b = COLORS.light, weight = 800, shadow = null, measureOnly = false, text = WORDMARK,
} = {}) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  const split = text === WORDMARK ? 5 : text.length; // "Brain" | "Daemon"
  const p1 = text.slice(0, split), p2 = text.slice(split);
  const w1 = ctx.measureText(p1).width;
  const w = w1 + ctx.measureText(p2).width;
  if (!measureOnly) {
    let x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    if (shadow) { ctx.shadowColor = shadow.color; ctx.shadowBlur = shadow.blur; ctx.shadowOffsetY = shadow.y || 0; }
    ctx.fillStyle = a; ctx.fillText(p1, x0, y);
    ctx.fillStyle = b; ctx.fillText(p2, x0 + w1, y);
  }
  ctx.restore();
  return w;
}

/** largest font size (<= max) at which the wordmark fits in width */
export function fitWordmark(ctx, width, max, weight = 800, text = WORDMARK) {
  const w = drawWordmark(ctx, 0, 0, 100, { measureOnly: true, weight, text });
  return Math.min(max, (100 * width) / Math.max(1, w));
}

// ------------------------------------------------------------------ neon
/**
 * Layered glow: a wide faint bloom, a mid glow, then a near-white tube core.
 * draw(ctx, pass) must build and stroke/fill its shapes using the current styles.
 */
export function neonPasses(ctx, color, lineWidth, draw) {
  const passes = [
    { blur: lineWidth * 6, lw: lineWidth * 2.4, style: rgba(color, 0.35) },
    { blur: lineWidth * 3, lw: lineWidth * 1.5, style: color },
    { blur: lineWidth * 1.2, lw: lineWidth * 0.8, style: tint(color, 0.35) },
    { blur: 0, lw: lineWidth * 0.38, style: tint(color, 0.7) },
  ];
  for (const p of passes) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = p.blur;
    ctx.strokeStyle = p.style;
    ctx.fillStyle = p.style;
    ctx.lineWidth = p.lw;
    draw(ctx, p);
    ctx.restore();
  }
}

// ------------------------------------------------------------------ pixel art
// 16x16 pixel daemon, hand-placed. Palette keys below.
const PIXEL_MARK = [
  '..e..........e..',
  '..ee........ee..',
  '...ee......ee...',
  '...eee....eee...',
  '....llllllll....',
  '...lbbbbbbbbl...',
  '..lbbbbbbbbbbd..',
  '.lbbbbbpppbbbbd.',
  '.lbbbbwwpppbbbd.',
  '.lbbbpwwppppbbd.',
  '.lbbbpppppppbbd.',
  '.lbbbbppppsbbbd.',
  '..bbbbbpppbbbd..',
  '..dbbbbbbbbbbd..',
  '...dbbbbbbbbd...',
  '....dddddddd....',
];
const PIXEL_PAL = {
  e: COLORS.ear, l: COLORS.light, b: COLORS.blue, d: COLORS.ring, p: COLORS.pupil, w: COLORS.hi, s: COLORS.spark,
};
export const PIXEL_MARK_SIZE = 16;

export function drawPixelMark(ctx, x, y, scale = 1) {
  let last = null;
  for (let r = 0; r < PIXEL_MARK.length; r++) {
    const row = PIXEL_MARK[r];
    for (let c = 0; c < row.length; c++) {
      const k = row[c];
      if (k === '.') continue;
      if (k !== last) { ctx.fillStyle = PIXEL_PAL[k]; last = k; }
      ctx.fillRect(x + c * scale, y + r * scale, scale, scale);
    }
  }
}

// 5x7 pixel font, rows top to bottom, '#' = on. Uppercase only (input is upper-cased).
const G = (s) => s.split('/');
const PIXEL_FONT = {
  A: G('.###./#...#/#...#/#####/#...#/#...#/#...#'), B: G('####./#...#/#...#/####./#...#/#...#/####.'),
  C: G('.###./#...#/#..../#..../#..../#...#/.###.'), D: G('####./#...#/#...#/#...#/#...#/#...#/####.'),
  E: G('#####/#..../#..../####./#..../#..../#####'), F: G('#####/#..../#..../####./#..../#..../#....'),
  G: G('.###./#...#/#..../#.###/#...#/#...#/.####'), H: G('#...#/#...#/#...#/#####/#...#/#...#/#...#'),
  I: G('.###./..#../..#../..#../..#../..#../.###.'), J: G('..###/...#./...#./...#./...#./#..#./.##..'),
  K: G('#...#/#..#./#.#../##.../#.#../#..#./#...#'), L: G('#..../#..../#..../#..../#..../#..../#####'),
  M: G('#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#'), N: G('#...#/#...#/##..#/#.#.#/#..##/#...#/#...#'),
  O: G('.###./#...#/#...#/#...#/#...#/#...#/.###.'), P: G('####./#...#/#...#/####./#..../#..../#....'),
  Q: G('.###./#...#/#...#/#...#/#.#.#/#..#./.##.#'), R: G('####./#...#/#...#/####./#.#../#..#./#...#'),
  S: G('.####/#..../#..../.###./....#/....#/####.'), T: G('#####/..#../..#../..#../..#../..#../..#..'),
  U: G('#...#/#...#/#...#/#...#/#...#/#...#/.###.'), V: G('#...#/#...#/#...#/#...#/#...#/.#.#./..#..'),
  W: G('#...#/#...#/#...#/#.#.#/#.#.#/#.#.#/.#.#.'), X: G('#...#/#...#/.#.#./..#../.#.#./#...#/#...#'),
  Y: G('#...#/#...#/.#.#./..#../..#../..#../..#..'), Z: G('#####/....#/...#./..#../.#.../#..../#####'),
  0: G('.###./#...#/#..##/#.#.#/##..#/#...#/.###.'), 1: G('..#../.##../..#../..#../..#../..#../.###.'),
  2: G('.###./#...#/....#/...#./..#../.#.../#####'), 3: G('####./....#/....#/.###./....#/....#/####.'),
  4: G('...#./..##./.#.#./#..#./#####/...#./...#.'), 5: G('#####/#..../####./....#/....#/#...#/.###.'),
  6: G('.###./#..../#..../####./#...#/#...#/.###.'), 7: G('#####/....#/...#./..#../.#.../.#.../.#...'),
  8: G('.###./#...#/#...#/.###./#...#/#...#/.###.'), 9: G('.###./#...#/#...#/.####/....#/....#/.###.'),
  ' ': G('...../...../...../...../...../...../.....'), '.': G('...../...../...../...../...../...../..#..'),
  '!': G('..#../..#../..#../..#../..#../...../..#..'), '-': G('...../...../...../.###./...../...../.....'),
  ':': G('...../..#../...../...../...../..#../.....'),
};
export const PIXEL_GLYPH_W = 5, PIXEL_GLYPH_H = 7;

export function pixelTextWidth(text) {
  return Math.max(0, text.length * (PIXEL_GLYPH_W + 1) - 1);
}

/**
 * Pixel text at (x, y), top-left. `split` chars use colorA, the rest colorB
 * (so "BRAINDAEMON" gets the two-tone wordmark look).
 */
export function drawPixelText(ctx, text, x, y, scale = 1, colorA = COLORS.hi, colorB = colorA, split = Infinity) {
  const up = String(text).toUpperCase();
  for (let i = 0; i < up.length; i++) {
    const g = PIXEL_FONT[up[i]] || PIXEL_FONT[' '];
    ctx.fillStyle = i < split ? colorA : colorB;
    const gx = x + i * (PIXEL_GLYPH_W + 1) * scale;
    for (let r = 0; r < PIXEL_GLYPH_H; r++) {
      const row = g[r];
      for (let c = 0; c < PIXEL_GLYPH_W; c++) if (row[c] === '#') ctx.fillRect(gx + c * scale, y + r * scale, scale, scale);
    }
  }
}
