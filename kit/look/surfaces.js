// look/surfaces.js — procedural, tileable, seeded surface textures as plain
// RGBA pixel buffers (no DOM), plus a matching height field and normal map.
//
//   const s = paintSurface('flagstones', { size: 512, seed: 3 });
//   s.data   -> Uint8ClampedArray RGBA (size x size), tiles seamlessly
//   s.normal -> Uint8ClampedArray RGBA tangent-space normal map (or null)
//   s.tile   -> world metres one tile should cover (for texture.repeat)
//
// Every pattern is built from periodic functions (wrapped lattices, wrapped
// cells, integer frequencies), so the right edge continues into the left edge
// and the bottom into the top. Shading from the height field is baked in
// (top-left light), so surfaces read as relief even with flat lighting.
// three-look.js turns these into THREE.CanvasTexture; canvas-look.js draws them.

import {
  hexToRgb, mixHex, noise2, fbm2, cell2, hash2, clamp, smoothstep, PALETTES, isHex,
} from './core.js';

// Colours: base/dark/light are the body, accent a highlight or detail, gap the joints.
// tile: world metres one texture tile covers. shade: baked relief strength. normal: normal-map strength.
export const SURFACES = Object.freeze({
  flagstones: { base: '#948F86', dark: '#7A756C', light: '#ABA69B', accent: '#8C8478', gap: '#5E574D', tile: 4, roughness: 0.85, metalness: 0, shade: 1.0, normal: 1.0 },
  cobbles:    { base: '#86817C', dark: '#6C6763', light: '#A29A90', accent: '#8E8070', gap: '#4E443A', tile: 2.5, roughness: 0.8, metalness: 0, shade: 1.1, normal: 1.2 },
  planks:     { base: '#9A6A3E', dark: '#7C5230', light: '#B47E4C', accent: '#5A3A22', gap: '#3E2818', tile: 3, roughness: 0.7, metalness: 0, shade: 0.8, normal: 0.8 },
  grass:      { base: '#5E9440', dark: '#41702C', light: '#8ABD52', accent: '#B8D86A', gap: '#3A5A26', tile: 4, roughness: 0.95, metalness: 0, shade: 0.5, normal: 0.5 },
  dirt:       { base: '#8C6C4A', dark: '#6E5238', light: '#A88762', accent: '#BCA88C', gap: '#5A4430', tile: 4, roughness: 0.95, metalness: 0, shade: 0.7, normal: 0.7 },
  sand:       { base: '#E0C38E', dark: '#C9A872', light: '#F2DCAA', accent: '#FFF0CC', gap: '#B89660', tile: 5, roughness: 0.95, metalness: 0, shade: 0.6, normal: 0.6 },
  asphalt:    { base: '#44464C', dark: '#33353A', light: '#5A5C62', accent: '#E9E6DA', gap: '#F2C14A', tile: 8, roughness: 0.9, metalness: 0, shade: 0.4, normal: 0.4 },
  brick:      { base: '#A5523B', dark: '#86402E', light: '#BE6A4E', accent: '#6E3424', gap: '#C9BFAE', tile: 2, roughness: 0.85, metalness: 0, shade: 1.0, normal: 1.0 },
  tiles:      { base: '#DCD6C8', dark: '#C6BEAC', light: '#EEEAE0', accent: '#B8AE98', gap: '#9A9282', tile: 2, roughness: 0.35, metalness: 0, shade: 0.7, normal: 0.6 },
  metal:      { base: '#727C88', dark: '#5C6470', light: '#8E98A4', accent: '#B4BCC6', gap: '#2C3038', tile: 3, roughness: 0.45, metalness: 0.6, shade: 0.9, normal: 0.9 },
  wood:       { base: '#A8743F', dark: '#875A30', light: '#C48A52', accent: '#6A4426', gap: '#5A3A20', tile: 2, roughness: 0.7, metalness: 0, shade: 0.5, normal: 0.5 },
  water:      { base: '#1E6E92', dark: '#134C68', light: '#3A9CC0', accent: '#CFF0FA', gap: '#0E3C52', tile: 6, roughness: 0.12, metalness: 0, shade: 0.3, normal: 0.8 },
  snow:       { base: '#EAF0F6', dark: '#C4D2E2', light: '#FFFFFF', accent: '#FFFFFF', gap: '#A8BCD4', tile: 5, roughness: 0.9, metalness: 0, shade: 0.8, normal: 0.6 },
});
export const SURFACE_KINDS = Object.freeze(Object.keys(SURFACES));
const ALIASES = { 'dirt-path': 'dirt', path: 'dirt', stone: 'flagstones', flagstone: 'flagstones', cobble: 'cobbles', plank: 'planks', bricks: 'brick', tile: 'tiles', 'metal-panels': 'metal', panels: 'metal', road: 'asphalt' };
export const resolveKind = (k) => (SURFACES[k] ? k : ALIASES[k] || null);

// Named palettes nudge every surface toward the preset's mood a little.
const TINTS = {
  sunset: ['#FF9A6A', 0.1], night: ['#4A64B0', 0.14], 'night-neon': ['#7A3AA8', 0.14], 'dungeon-torch': ['#7A4A2A', 0.12],
  'cozy-indoor': ['#C88A5A', 0.08], space: ['#4A5A98', 0.12], underwater: ['#1F8AA8', 0.18], storybook: ['#FFE6B8', 0.08],
};
const COLOR_KEYS = ['base', 'dark', 'light', 'accent', 'gap'];

/**
 * The colours a kind paints with, after a palette is applied.
 * palette: a named palette ('sunset'...), an array [base, dark, light, accent, gap],
 * or an object { base, dark, ... } (partial is fine).
 */
export function surfaceColors(kind, palette) {
  const k = resolveKind(kind);
  if (!k) throw new Error(`look: unknown surface "${kind}" (have: ${SURFACE_KINDS.join(', ')})`);
  const c = {};
  for (const key of COLOR_KEYS) c[key] = SURFACES[k][key];
  if (Array.isArray(palette)) palette.forEach((v, i) => { if (isHex(v) && COLOR_KEYS[i]) c[COLOR_KEYS[i]] = v; });
  else if (palette && typeof palette === 'object') { for (const key of COLOR_KEYS) if (isHex(palette[key])) c[key] = palette[key]; }
  else if (typeof palette === 'string' && TINTS[palette]) {
    const [t, a] = TINTS[palette];
    for (const key of COLOR_KEYS) c[key] = mixHex(c[key], t, a);
  } else if (typeof palette === 'string' && !PALETTES[palette]) {
    throw new Error(`look: unknown palette "${palette}"`);
  }
  return c;
}

// ------------------------------------------------------------------ painter helpers
// Each painter fills R, G, B (0..255 floats) and H (height 0..1) for an S x S tile.

function painter(S) {
  const N = S * S;
  return { S, N, R: new Float32Array(N), G: new Float32Array(N), B: new Float32Array(N), H: new Float32Array(N), px: S / 256 };
}
function put(T, i, c, h) { T.R[i] = c[0]; T.G[i] = c[1]; T.B[i] = c[2]; T.H[i] = h; }
function mixc(a, b, t, out = [0, 0, 0]) { out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t; return out; }
function mul(c, k, out = [0, 0, 0]) { out[0] = c[0] * k; out[1] = c[1] * k; out[2] = c[2] * k; return out; }
/** blend a colour into pixel (x, y) with alpha a, wrapping coordinates */
function blendPx(T, x, y, c, a, h) {
  const S = T.S;
  x = Math.floor(((x % S) + S) % S); y = Math.floor(((y % S) + S) % S);
  const i = y * S + x;
  T.R[i] += (c[0] - T.R[i]) * a; T.G[i] += (c[1] - T.G[i]) * a; T.B[i] += (c[2] - T.B[i]) * a;
  if (h != null) T.H[i] += (h - T.H[i]) * a;
}
/** a stone colour picked per id from base/dark/light (written into out) */
function tone(C, id, spread, out) {
  const t = (id - 0.5) * 2 * spread;
  return t >= 0 ? mixc(C.base, C.light, t, out) : mixc(C.base, C.dark, -t, out);
}
/** rows of segments: each row has an x offset and boundaries covering exactly [0, S) */
function rows(S, count, seed, minParts, maxParts) {
  const out = [];
  for (let r = 0; r < count; r++) {
    const off = hash2(r, 1, seed) * S;
    const k = minParts + Math.floor(hash2(r, 2, seed) * (maxParts - minParts + 1));
    const w = [];
    for (let j = 0; j < k; j++) w.push(0.55 + hash2(r, 10 + j, seed));
    const sum = w.reduce((a, b) => a + b, 0);
    const b = [0];
    for (let j = 0; j < k; j++) b.push(b[j] + (w[j] / sum) * S);
    b[k] = S;
    out.push({ off, b });
  }
  return out;
}
function findSeg(b, x) { let j = 0; while (j < b.length - 2 && x >= b[j + 1]) j++; return j; }
/** rounded-rectangle distance to the nearest joint (cornerR in px) */
function edgeDist(dx, dy, cornerR) {
  if (dx < cornerR && dy < cornerR) return cornerR - Math.hypot(cornerR - dx, cornerR - dy);
  return dx < dy ? dx : dy;
}

const P = {};

// Flagstones: continuous courses of cut stone, thin joints, no black gaps.
P.flagstones = (T, C, seed, o) => {
  const { S } = T;
  const courses = 4 * o.scale;
  const rowH = S / courses;
  const R = rows(S, courses, seed, 2, 4);
  const joint = Math.max(1, 1.3 * T.px), bevel = 6 * T.px, corner = 5 * T.px;
  const wob1 = noise2(32, 32, seed + 5), wob2 = noise2(96, 96, seed + 6);
  const mottF = fbm2(6, 6, 4, seed + 11), grainF = noise2(128, 128, seed + 12), stainF = fbm2(4, 4, 3, seed + 21);
  const c = [0, 0, 0], st = [0, 0, 0], g = [0, 0, 0];
  for (let y = 0; y < S; y++) {
    const row = Math.min(courses - 1, Math.floor(y / rowH));
    const ly = y + 0.5 - row * rowH;
    const { off, b } = R[row];
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const xx = (((x + 0.5 - off) % S) + S) % S;
      const j = findSeg(b, xx);
      const dx = Math.min(xx - b[j], b[j + 1] - xx), dy = Math.min(ly, rowH - ly);
      const wob = (wob1(u, v) - 0.5) * 2.2 * T.px + (wob2(u, v) - 0.5) * 0.9 * T.px;
      const e = edgeDist(dx, dy, corner) - joint - wob;
      tone(C, hash2(row, j, seed + 3), 0.55, st);
      const mott = mottF(u, v), grain = grainF(u, v);
      mul(st, 0.86 + mott * 0.26 + (grain - 0.5) * 0.08, st);
      mixc(st, C.dark, smoothstep(0.62, 0.8, stainF(u, v)) * 0.35, st);
      const m = smoothstep(-0.8, 0.8, e);
      mul(C.gap, 0.9 + grain * 0.2, g);
      put(T, y * S + x, mixc(g, st, m, c), m * (0.55 + 0.45 * smoothstep(0, bevel, e)) * (0.92 + mott * 0.08));
    }
  }
};

// Cobbles: rounded stones in a tileable cell pattern over packed dirt.
P.cobbles = (T, C, seed, o) => {
  const { S } = T;
  const cell = cell2(8 * o.scale, seed, 0.75);
  const gapN = noise2(40, 40, seed + 4), mottF = fbm2(8, 8, 3, seed + 9), gritN = noise2(160, 160, seed + 2);
  const c = [0, 0, 0], st = [0, 0, 0], g = [0, 0, 0];
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const w = cell(u, v);
      const e = w.f2 - w.f1;
      const gw = 0.07 + (gapN(u, v) - 0.5) * 0.04;
      const m = smoothstep(gw - 0.015, gw + 0.015, e);
      const dome = Math.sqrt(clamp((e - gw) / 0.3));
      tone(C, w.id, 1, st);
      mul(st, 0.82 + mottF(u, v) * 0.3 + dome * 0.08, st);
      mul(C.gap, 0.85 + gritN(u, v) * 0.3, g);
      put(T, y * S + x, mixc(g, st, m, c), m * (0.35 + 0.65 * dome));
    }
  }
};

// Planks: boards with staggered butt joints, flowing grain and nail heads.
P.planks = (T, C, seed, o) => {
  const { S } = T;
  const count = 6 * o.scale;
  const rowH = S / count;
  const R = rows(S, count, seed, 1, 2);
  const gap = Math.max(0.8, 1.1 * T.px), bevel = 3 * T.px;
  const warpF = fbm2(2, count * 2, 3, seed + 7), streakN = noise2(3, S / 3, seed + 8);
  const c = [0, 0, 0], wd = [0, 0, 0];
  for (let y = 0; y < S; y++) {
    const row = Math.min(count - 1, Math.floor(y / rowH));
    const ly = y + 0.5 - row * rowH;
    const { off, b } = R[row];
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const xx = (((x + 0.5 - off) % S) + S) % S;
      const j = findSeg(b, xx);
      const dx = Math.min(xx - b[j], b[j + 1] - xx), dy = Math.min(ly, rowH - ly);
      const e = Math.min(dx, dy) - gap;
      const id = hash2(row, j, seed + 3);
      const ring = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (v * count * 4 + (warpF(u, v) - 0.5) * 3 + id * 3));
      tone(C, id, 0.8, wd);
      mixc(wd, C.dark, ring * 0.32 + (streakN(u, v) - 0.5) * 0.25, wd);
      let nail = 0;
      for (let q = 0; q < 2; q++) {
        const bx = q ? b[j + 1] - 7 * T.px : b[j] + 7 * T.px;
        for (let r = 0; r < 2; r++) {
          const d = Math.hypot(xx - bx, ly - rowH * (r ? 0.72 : 0.28));
          const nn = 1 - smoothstep(1.1 * T.px, 2 * T.px, d);
          if (nn > nail) nail = nn;
        }
      }
      mixc(wd, C.accent, nail * 0.8, wd);
      const m = smoothstep(-0.7, 0.7, e);
      put(T, y * S + x, mixc(C.gap, wd, m, c), m * (0.6 + 0.4 * smoothstep(0, bevel, e)) + ring * 0.04 - nail * 0.1);
    }
  }
};

// Grass: soft colour fields plus thousands of tiny blade strokes.
P.grass = (T, C, seed, o) => {
  const { S, px } = T;
  const fF = fbm2(4, 4, 4, seed), patchF = fbm2(2, 2, 3, seed + 3);
  const col = [0, 0, 0];
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      // low-frequency contrast stays gentle: big variation comes from world-space tinting
      // (groundPlane), so the tile repeat does not read as a checkerboard
      const f = fF(u, v), fa = 0.5 + (f - 0.5) * 0.6;
      if (fa > 0.5) mixc(C.base, C.light, (fa - 0.5) * 1.3, col); else mixc(C.dark, C.base, fa * 2, col);
      mixc(col, C.dark, smoothstep(0.55, 0.75, patchF(u, v)) * 0.16, col);
      put(T, y * S + x, col, f * 0.5);
    }
  }
  const blades = Math.round((S * S) / 11);
  const bc = [0, 0, 0];
  for (let k = 0; k < blades; k++) {
    const x0 = hash2(k, 1, seed + 50) * S, y0 = hash2(k, 2, seed + 50) * S;
    const len = (2.5 + hash2(k, 3, seed + 50) * 4.5) * px;
    const lean = (hash2(k, 4, seed + 50) - 0.5) * 0.9;
    const t = hash2(k, 5, seed + 50);
    if (t > 0.55) mixc(C.light, C.accent, (t - 0.55) * 0.9, bc); else mixc(C.dark, C.base, t * 1.2, bc);
    for (let s = 0; s < len; s += 0.7) blendPx(T, x0 + lean * s, y0 - s, bc, 0.65 * (1 - s / len) + 0.2, 0.5 + 0.5 * (s / len));
  }
  if (o.flowers) {
    const fl = [[255, 248, 230], [255, 214, 90], [240, 150, 190]];
    for (let k = 0; k < (S * S) / 1800; k++) {
      const x0 = hash2(k, 9, seed + 77) * S, y0 = hash2(k, 10, seed + 77) * S, fc = fl[k % 3];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) blendPx(T, x0 + dx * px, y0 + dy * px, fc, dx === 0 || dy === 0 ? 0.95 : 0.4, 0.9);
    }
  }
};

// Dirt path: mottled earth, damp patches and small pebbles.
P.dirt = (T, C, seed) => {
  const { S, px } = T;
  const fF = fbm2(5, 5, 5, seed), dampF = fbm2(2, 2, 3, seed + 4), gritN = noise2(140, 140, seed + 5);
  const col = [0, 0, 0];
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const f = fF(u, v), damp = smoothstep(0.58, 0.78, dampF(u, v)), grit = gritN(u, v);
      if (f > 0.5) mixc(C.base, C.light, (f - 0.5) * 1.2, col); else mixc(C.dark, C.base, f * 2, col);
      mixc(col, C.gap, damp * 0.3, col);
      mul(col, 0.94 + grit * 0.12, col);
      put(T, y * S + x, col, f * 0.6 + grit * 0.1 - damp * 0.15);
    }
  }
  const n = Math.round((S * S) / 420);
  const pc = [0, 0, 0];
  for (let k = 0; k < n; k++) {
    const cx = hash2(k, 1, seed + 30) * S, cy = hash2(k, 2, seed + 30) * S;
    const r = (0.8 + hash2(k, 3, seed + 30) ** 2 * 2.6) * px;
    mixc(C.accent, C.dark, hash2(k, 4, seed + 30) * 0.6, pc);
    const rc = Math.ceil(r);
    for (let dy = -rc; dy <= rc; dy++) {
      for (let dx = -rc; dx <= rc; dx++) {
        const d = Math.hypot(dx, dy) / r;
        if (d > 1) continue;
        blendPx(T, cx + dx, cy + dy, pc, smoothstep(1, 0.6, d), 0.7 + 0.3 * Math.sqrt(1 - d * d));
      }
    }
  }
};

// Sand: wind ripples and glittering grains.
P.sand = (T, C, seed, o) => {
  const { S } = T;
  const freq = 7 * o.scale;
  const warpF = fbm2(3, 3, 3, seed), fF = fbm2(4, 4, 3, seed + 3), grainN = noise2(180, 180, seed + 4);
  const col = [0, 0, 0];
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const rip = Math.sin(Math.PI * 2 * (v * freq + u + (warpF(u, v) - 0.5) * 1.8));
      const sharp = Math.pow(0.5 + 0.5 * rip, 1.6);
      const f = fF(u, v);
      mixc(C.dark, C.base, 0.35 + sharp * 0.5 + (f - 0.5) * 0.4, col);
      mixc(col, C.light, smoothstep(0.75, 1, sharp) * 0.35, col);
      mul(col, 0.95 + grainN(u, v) * 0.1, col);
      if (hash2(x, y, seed + 9) > 0.996) mixc(col, C.accent, 0.8, col);
      put(T, y * S + x, col, sharp * 0.7 + f * 0.3);
    }
  }
};

// Asphalt: aggregate grain, repair patches, tyre wear, painted lane lines.
// The road runs along the texture's V axis; U crosses it. o.lanes, o.lines, o.center.
P.asphalt = (T, C, seed, o) => {
  const { S } = T;
  const lanes = Math.max(1, (o.lanes | 0) || 2);
  const edge = 0.055, lw = 0.02, dashes = 2;
  const yel = hexToRgb(SURFACES.asphalt.gap), worn = [0, 0, 0];
  mul(C.dark, 0.85, worn);
  const centre = o.center || 'dashed';
  const laneW = (1 - 2 * edge) / lanes;
  const fF = fbm2(8, 8, 4, seed), aggN = noise2(S / 2, S / 2, seed + 4), patchF = fbm2(2, 2, 3, seed + 6), wornN = noise2(48, 48, seed + 8);
  const col = [0, 0, 0];
  const line = (u, lx, w) => 1 - smoothstep(w * 0.4, w * 0.6, Math.abs(u - lx));
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    const dashOn = ((v * dashes) % 1) < 0.5;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const f = fF(u, v), agg = aggN(u, v);
      mixc(C.dark, C.base, 0.35 + f * 0.6, col);
      if (agg > 0.82) mixc(col, C.light, (agg - 0.82) * 3.5, col);
      mixc(col, C.dark, smoothstep(0.66, 0.7, patchF(u, v)) * 0.4, col);
      let h = f * 0.4 + (agg > 0.82 ? 0.15 : 0);
      if (o.lines !== false) {
        const lu = (u - edge) / laneW;
        if (lu > 0 && lu < lanes) {
          const fr = lu - Math.floor(lu);
          const wear = Math.max(1 - Math.abs(fr - 0.28) / 0.1, 1 - Math.abs(fr - 0.72) / 0.1, 0);
          mixc(col, worn, wear * 0.22, col);
        }
        let paint = Math.max(line(u, edge, lw), line(u, 1 - edge, lw)), pc = C.accent;
        for (let i = 1; i < lanes; i++) {
          const lx = edge + i * laneW;
          if (centre === 'double-yellow' && lanes === 2) {
            const p2 = Math.max(line(u, lx - lw * 0.6, lw * 0.75), line(u, lx + lw * 0.6, lw * 0.75));
            if (p2 > paint) { paint = p2; pc = yel; }
          } else if (dashOn) paint = Math.max(paint, line(u, lx, lw));
        }
        if (paint > 0) {
          mixc(col, pc, paint * (0.7 + 0.3 * wornN(u, v)) * (agg > 0.9 ? 0.6 : 0.95), col);
          h += paint * 0.12;
        }
      }
      put(T, y * S + x, col, h);
    }
  }
};

// Brick: running bond, light mortar, varied and slightly burnt bricks.
P.brick = (T, C, seed, o) => {
  const { S } = T;
  const count = 8 * o.scale;
  const rowH = S / count, bw = rowH * 2, perRow = Math.round(S / bw);
  const mortar = Math.max(1, 1.6 * T.px), bevel = 3 * T.px, corner = 2.5 * T.px;
  const wobN = noise2(48, 48, seed + 5), mottF = fbm2(8, 8, 3, seed + 11), pitN = noise2(110, 110, seed + 12);
  const c = [0, 0, 0], bc = [0, 0, 0], mc = [0, 0, 0];
  for (let y = 0; y < S; y++) {
    const row = Math.min(count - 1, Math.floor(y / rowH));
    const ly = y + 0.5 - row * rowH;
    const off = (row % 2) * bw * 0.5;
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const xx = (((x + 0.5 - off) % S) + S) % S;
      const j = Math.floor(xx / bw) % perRow;
      const lx = xx - j * bw;
      const e = edgeDist(Math.min(lx, bw - lx), Math.min(ly, rowH - ly), corner) - mortar - (wobN(u, v) - 0.5) * 1.4 * T.px;
      tone(C, hash2(row, j, seed + 3), 1, bc);
      if (hash2(row, j, seed + 9) > 0.86) mixc(bc, C.accent, 0.5, bc);
      const pit = pitN(u, v);
      mul(bc, 0.86 + mottF(u, v) * 0.24 + (pit - 0.5) * 0.12, bc);
      const m = smoothstep(-0.7, 0.7, e);
      mul(C.gap, 0.9 + pit * 0.15, mc);
      put(T, y * S + x, mixc(mc, bc, m, c), m * (0.5 + 0.5 * smoothstep(0, bevel, e)) + (pit - 0.5) * 0.05);
    }
  }
};

// Tiles: square glazed tiles with grout; o.checker alternates two tones.
P.tiles = (T, C, seed, o) => {
  const { S } = T;
  const n = 4 * o.scale, cs = S / n;
  const grout = Math.max(0.8, 1.2 * T.px), bevel = 2.5 * T.px;
  const speckN = noise2(128, 128, seed + 8);
  const c = [0, 0, 0], tc = [0, 0, 0];
  for (let y = 0; y < S; y++) {
    const ty = Math.floor(y / cs), ly = y + 0.5 - ty * cs;
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const tx = Math.floor(x / cs), lx = x + 0.5 - tx * cs;
      const e = edgeDist(Math.min(lx, cs - lx), Math.min(ly, cs - ly), 2 * T.px) - grout;
      const id = hash2(tx, ty, seed + 3);
      mixc(o.checker && (tx + ty) % 2 ? C.dark : C.base, C.light, (id - 0.5) * 0.3 + 0.1, tc);
      const sheen = 1 - Math.abs((lx + ly) / (cs * 2) - 0.35) * 2;
      mixc(tc, C.light, clamp(sheen) * 0.25, tc);
      mul(tc, 0.97 + speckN(u, v) * 0.06, tc);
      const m = smoothstep(-0.6, 0.6, e);
      put(T, y * S + x, mixc(C.gap, tc, m, c), m * (0.6 + 0.4 * smoothstep(0, bevel, e)));
    }
  }
};

// Metal panels: brushed plates, dark seams, rivets, grime along the seams.
P.metal = (T, C, seed, o) => {
  const { S } = T;
  const n = 2 * o.scale, ps = S / n;
  const seam = Math.max(1, 1.5 * T.px), rr = 2.2 * T.px, inset = ps * 0.07;
  const br1 = noise2(2, S / 2, seed + 4), br2 = noise2(6, S / 4, seed + 5), grimeF = fbm2(6, 6, 3, seed + 7);
  const c = [0, 0, 0], mc = [0, 0, 0];
  for (let y = 0; y < S; y++) {
    const py = Math.floor(y / ps), ly = y + 0.5 - py * ps;
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const pxi = Math.floor(x / ps), lx = x + 0.5 - pxi * ps;
      const ed = Math.min(lx, ps - lx, ly, ps - ly);
      const id = hash2(pxi, py, seed + 3);
      const brushed = br1(u, v) * 0.6 + br2(u, v) * 0.4;
      mixc(C.base, id > 0.5 ? C.light : C.dark, Math.abs(id - 0.5) * 0.7, mc);
      mul(mc, 0.9 + brushed * 0.18, mc);
      mixc(mc, C.gap, (1 - smoothstep(0, ps * 0.18, ed)) * grimeF(u, v) * 0.45, mc);
      let rv = 0;
      for (let a = 0; a < 2; a++) for (let b2 = 0; b2 < 2; b2++) {
        const d = Math.hypot(lx - (a ? ps - inset : inset), ly - (b2 ? ps - inset : inset));
        const r1 = 1 - smoothstep(rr * 0.7, rr, d);
        if (r1 > rv) rv = r1;
      }
      mixc(mc, C.accent, rv * 0.6, mc);
      const m = smoothstep(-0.6, 0.6, ed - seam);
      put(T, y * S + x, mixc(C.gap, mc, m, c), m * 0.7 + rv * 0.3 + brushed * 0.02);
    }
  }
};

// Wood: continuous grain for props, crates and furniture (no board seams).
P.wood = (T, C, seed, o) => {
  const { S } = T;
  // long, gently wavering grain lines with fine fibre streaks; one small knot
  const rings = 9 * o.scale;
  const knot = { x: hash2(0, 1, seed + 40), y: hash2(0, 2, seed + 40), r: 0.035 + hash2(0, 3, seed + 40) * 0.02 };
  const warpF = fbm2(1, 3, 3, seed), streakN = noise2(2, S / 2, seed + 8), fibre = noise2(8, S, seed + 9), toneF = fbm2(2, 2, 2, seed + 10);
  const col = [0, 0, 0];
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      let ph = v * rings + (warpF(u, v) - 0.5) * 1.6;
      let dx = Math.abs(u - knot.x); dx = Math.min(dx, 1 - dx);
      let dy = Math.abs(v - knot.y); dy = Math.min(dy, 1 - dy);
      const d = Math.hypot(dx * 0.45, dy) / knot.r;
      ph += Math.exp(-d * d) * 0.9;
      const knotDark = Math.exp(-d * d * 6);
      const ring = Math.pow(0.5 + 0.5 * Math.sin(Math.PI * 2 * ph), 3);
      const streak = streakN(u, v) * 0.6 + fibre(u, v) * 0.4;
      mixc(C.base, C.light, (toneF(u, v) - 0.5) * 0.6 + 0.2, col);
      mixc(col, C.dark, ring * 0.45 + (streak - 0.5) * 0.35, col);
      mixc(col, C.accent, knotDark * 0.6, col);
      put(T, y * S + x, col, (1 - ring) * 0.2 + streak * 0.12);
    }
  }
};

// Water: deep/shallow colour fields and bright caustic-like ripple lines.
P.water = (T, C, seed, o) => {
  const { S } = T;
  const cell = cell2(5 * o.scale, seed + 5, 0.9);
  const fF = fbm2(3, 3, 4, seed), wa = noise2(4, 4, seed + 3), wb = noise2(4, 4, seed + 4);
  const col = [0, 0, 0];
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const f = fF(u, v);
      const wu = u + (wa(u, v) - 0.5) * 0.08, wv = v + (wb(u, v) - 0.5) * 0.08;
      const w = cell(((wu % 1) + 1) % 1, ((wv % 1) + 1) % 1);
      const caust = 1 - smoothstep(0.0, 0.16, w.f2 - w.f1);
      mixc(C.dark, C.base, 0.3 + f * 0.8, col);
      mixc(col, C.light, caust * 0.55, col);
      if (caust > 0.85 && hash2(x, y, seed + 9) > 0.7) mixc(col, C.accent, 0.5, col);
      put(T, y * S + x, col, f * 0.5 + caust * 0.5);
    }
  }
};

// Snow: soft drifts with blue shadows in hollows and sparkles.
P.snow = (T, C, seed) => {
  const { S } = T;
  const fF = fbm2(3, 3, 5, seed), fineN = noise2(90, 90, seed + 3);
  const col = [0, 0, 0], white = [255, 255, 255];
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const f = fF(u, v), fine = fineN(u, v);
      mixc(C.base, C.gap, (1 - smoothstep(0.22, 0.55, f)) * 0.5, col);
      mixc(col, C.light, smoothstep(0.6, 0.85, f) * 0.6, col);
      mul(col, 0.97 + fine * 0.05, col);
      if (hash2(x, y, seed + 9) > 0.995) mixc(col, white, 1, col);
      put(T, y * S + x, col, f * 0.9 + fine * 0.1);
    }
  }
};

// ------------------------------------------------------------------ public
const LIGHT = (() => { const l = [-0.45, -0.55, 0.7]; const n = Math.hypot(...l); return l.map((x) => x / n); })();

/**
 * Paint a tileable surface.
 * @param {string} kind  one of SURFACE_KINDS (aliases: dirt-path, stone, road, panels...)
 * @param {object} [o]
 * @param {number} [o.size=256]  texture size in px (power of two recommended)
 * @param {string|string[]|object} [o.palette]  see surfaceColors
 * @param {number|string} [o.seed=1]
 * @param {number} [o.scale=1]  pattern density (integer: more stones/boards per tile)
 * @param {boolean} [o.normal=true]  also build a normal map
 * @param {number} [o.lanes=2]  asphalt: lanes between the edge lines
 * @param {boolean} [o.lines=true]  asphalt: paint lane lines
 * @param {'dashed'|'double-yellow'} [o.center]  asphalt centre line style
 * @param {boolean} [o.flowers]  grass: sprinkle tiny flowers
 * @param {boolean} [o.checker]  tiles: alternate two tones
 */
export function paintSurface(kind, o = {}) {
  const k = resolveKind(kind);
  if (!k) throw new Error(`look: unknown surface "${kind}" (have: ${SURFACE_KINDS.join(', ')})`);
  const S = Math.max(16, Math.round(o.size || 256));
  const seed = typeof o.seed === 'string' ? strSeed(o.seed) : (o.seed ?? 1) | 0;
  const opts = { ...o, scale: Math.max(1, Math.round(o.scale || 1)) };
  const C = {};
  const cols = surfaceColors(k, o.palette);
  for (const key of COLOR_KEYS) C[key] = hexToRgb(cols[key]);
  const T = painter(S);
  P[k](T, C, (Math.imul(seed, 7919) + 17) | 0, opts);

  // bake relief: shading from the wrapped height gradient (light from the top left)
  const def = SURFACES[k];
  const shade = o.shade ?? def.shade;
  const nStr = (o.normalStrength ?? def.normal) * 3.0;
  const data = new Uint8ClampedArray(S * S * 4);
  const normal = o.normal === false ? null : new Uint8ClampedArray(S * S * 4);
  const H = T.H, k2 = 3.2 / T.px;
  for (let y = 0; y < S; y++) {
    const ym = ((y - 1 + S) % S) * S, yp = ((y + 1) % S) * S, yr = y * S;
    for (let x = 0; x < S; x++) {
      const xm = (x - 1 + S) % S, xp = (x + 1) % S;
      const i = yr + x;
      const dx = (H[yr + xp] - H[yr + xm]) * k2, dy = (H[yp + x] - H[ym + x]) * k2;
      // image-space normal: x right, y down, z out of the surface
      const nl = Math.sqrt(dx * dx + dy * dy + 1);
      const lam = (-dx * LIGHT[0] - dy * LIGHT[1] + LIGHT[2]) / nl;
      // clamped so steep joints read as a soft bevel, never as black cracks
      const lit = clamp(1 + shade * (lam - LIGHT[2]) * 1.4, 0.62, 1.32);
      const o4 = i * 4;
      data[o4] = T.R[i] * lit; data[o4 + 1] = T.G[i] * lit; data[o4 + 2] = T.B[i] * lit; data[o4 + 3] = 255;
      if (normal) {
        // tangent space for a flipY texture: +x = +u (right), +y = +v (up the image)
        const tx = -dx * nStr, ty = dy * nStr, tl = Math.sqrt(tx * tx + ty * ty + 1);
        normal[o4] = (tx / tl * 0.5 + 0.5) * 255;
        normal[o4 + 1] = (ty / tl * 0.5 + 0.5) * 255;
        normal[o4 + 2] = (1 / tl * 0.5 + 0.5) * 255;
        normal[o4 + 3] = 255;
      }
    }
  }
  return {
    kind: k, width: S, height: S, data, normal, heightField: H,
    tile: def.tile * (o.tileScale || 1), roughness: def.roughness, metalness: def.metalness, colors: cols,
  };
}

function strSeed(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h | 0;
}

/**
 * Seam check used by the tests: mean absolute luminance step across the wrap
 * seam (right column -> left column, bottom row -> top row) divided by the mean
 * step between neighbouring interior columns/rows. About 1 means seamless;
 * patterns whose joints sit exactly on the tile edge score a little higher.
 */
export function seamRatio(img) {
  const { width: W, height: Hh, data } = img;
  const lum = (i) => data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
  let seamX = 0, inX = 0, seamY = 0, inY = 0;
  for (let y = 0; y < Hh; y++) {
    seamX += Math.abs(lum((y * W + W - 1) * 4) - lum((y * W) * 4));
    for (let x = 1; x < W; x++) inX += Math.abs(lum((y * W + x) * 4) - lum((y * W + x - 1) * 4));
  }
  for (let x = 0; x < W; x++) {
    seamY += Math.abs(lum(((Hh - 1) * W + x) * 4) - lum(x * 4));
    for (let y = 1; y < Hh; y++) inY += Math.abs(lum((y * W + x) * 4) - lum(((y - 1) * W + x) * 4));
  }
  return { x: (seamX / Hh) / (inX / (Hh * (W - 1)) || 1), y: (seamY / W) / (inY / (W * (Hh - 1)) || 1) };
}
