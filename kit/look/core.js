// look/core.js — the pure part of the Kit "looks": named palettes, the lighting
// presets as plain data, colour maths, tileable noise, and scatter placement.
// No DOM and no three.js here, so every rule is unit-tested in Node.
//
// The three.js side (three-look.js) and the Canvas 2D side (canvas-look.js)
// both read these tables, so a 3D scene, its HUD and a 2D game share one look.

import { createRng } from '../loop.js';

export { createRng };

// ------------------------------------------------------------------ palettes
// Every palette has the same keys, so HUD code can switch palettes freely.
//   ink: outlines and text shadows   bg: page/backdrop   panel/edge: HUD panels
//   primary/secondary/light: the main hues   text/dim: copy
//   accent/accent2: warm call-outs   good/warn/bad: status colours
//   swatch: prop and decoration colours that sit well in the scene
const BD = {
  ink: '#0A0E1A', bg: '#0E1322', panel: '#141B2E', edge: '#2A3B60',
  primary: '#2A63EE', secondary: '#4C86FF', light: '#86B4FF', text: '#EAF2FF', dim: '#9FB0D0',
  accent: '#F4B60A', accent2: '#FF8A3D', good: '#3DDC84', warn: '#FCD34D', bad: '#FF4D6A',
  swatch: ['#4C86FF', '#86B4FF', '#F4B60A', '#FF8A3D', '#8B5CF6', '#3DDC84'],
};

export const PALETTES = Object.freeze({
  braindaemon: BD,
  day: { ...BD, bg: '#16243A', panel: '#18263F', edge: '#3A5A88', swatch: ['#D9573B', '#F2B544', '#4C86FF', '#6FAF4A', '#E8E1D0', '#8C5A3C'] },
  sunset: { ...BD, bg: '#22142A', panel: '#2A1830', edge: '#6A3A58', primary: '#E85D4A', secondary: '#FF8A5C', light: '#FFC48A', accent: '#FFD166', accent2: '#FF6B8B',
    swatch: ['#E85D4A', '#FFB45C', '#6A4C93', '#F2D0A4', '#3D5A80', '#C8553D'] },
  night: { ...BD, bg: '#080D1E', panel: '#0F1830', edge: '#2A3F70', primary: '#3A6FE8', secondary: '#6F9BFF', light: '#B4CCFF', accent: '#FFD27A',
    swatch: ['#6F9BFF', '#B4CCFF', '#FFD27A', '#5A6A8A', '#D8E4F8', '#8B5CF6'] },
  'night-neon': { ...BD, bg: '#0B0718', panel: '#160C2A', edge: '#5A2A7A', primary: '#FF2FD0', secondary: '#22E6FF', light: '#FF9AD5', accent: '#FFE14D', accent2: '#FF4FA0',
    good: '#3DFFB0', swatch: ['#FF2FD0', '#22E6FF', '#FFE14D', '#8B5CFF', '#FF4FA0', '#4C86FF'] },
  'dungeon-torch': { ...BD, bg: '#0B0806', panel: '#1A120C', edge: '#5A3A20', primary: '#C8742A', secondary: '#FF9A3C', light: '#FFC77A', text: '#F6E6CC', dim: '#B8A080',
    accent: '#FFB347', accent2: '#E04A2A', swatch: ['#8A6A4A', '#5A4A3A', '#FF9A3C', '#7A3A2A', '#A89878', '#3A5A4A'] },
  'cozy-indoor': { ...BD, bg: '#1E1712', panel: '#2A2018', edge: '#6A4A30', primary: '#D88A4A', secondary: '#F2B07A', light: '#FFD9A8', text: '#FFF4E4', dim: '#C8B094',
    accent: '#FFC861', accent2: '#E86A5A', swatch: ['#C8553D', '#F2B544', '#7A9A5A', '#E8D8C0', '#5A7A9A', '#9A6A4A'] },
  space: { ...BD, bg: '#05060F', panel: '#0C1024', edge: '#2A3070', primary: '#6A5CFF', secondary: '#22D3FF', light: '#A8B8FF', accent: '#FFB13D', accent2: '#FF5CA8',
    swatch: ['#6A5CFF', '#22D3FF', '#FFB13D', '#C8D0E0', '#FF5CA8', '#3DDC84'] },
  underwater: { ...BD, bg: '#04202E', panel: '#08303F', edge: '#1F6A80', primary: '#1FB5C8', secondary: '#5FE3E0', light: '#B8F4F0', accent: '#FFB86B', accent2: '#FF7A8A',
    swatch: ['#FF7A8A', '#FFB86B', '#5FE3E0', '#F2E6C8', '#8B5CF6', '#3DDC84'] },
  storybook: { ...BD, bg: '#2A2238', panel: '#FFF6E4', edge: '#3A2E4A', primary: '#E85D4A', secondary: '#4C86FF', light: '#9AD0FF', text: '#2A2238', dim: '#6A5E7A',
    accent: '#F4B60A', accent2: '#7AC74F', swatch: ['#E85D4A', '#F4B60A', '#7AC74F', '#4C86FF', '#F29BB8', '#9A6AD8'] },
});

export const PALETTE_KEYS = Object.keys(BD);

/** a palette by name (falls back to 'braindaemon'); an object passes through, merged over the default */
export function palette(p) {
  if (p && typeof p === 'object') return { ...BD, ...p };
  return PALETTES[p] || BD;
}

// ------------------------------------------------------------------ presets (plain data)
// Colours are sRGB hex. dir: the direction TOWARD the key light (normalised later).
// sky.mode 'dome' draws the gradient dome; 'color' only sets scene.background.
const P = {
  day: {
    sky: { mode: 'dome', top: '#2F6FCC', horizon: '#B8D4EE', bottom: '#9DB0BC', sun: '#FFF4DC', sunSize: 0.9, glow: '#FFE9C0', glowAmt: 0.35, stars: 0, clouds: 0.65, cloudColor: '#FFFFFF' },
    fog: { color: '#B4CEE8', density: 0.009 },
    hemi: { sky: '#D4E6FF', ground: '#8A7A5A', intensity: 1.15 },
    key: { color: '#FFF1D8', intensity: 2.6, dir: [0.55, 0.75, 0.4] },
    ambient: { color: '#FFFFFF', intensity: 0.12 },
    exposure: 1.0, bloom: { strength: 0.22, radius: 0.4, threshold: 0.92 },
    grade: { vignette: 0.22, saturation: 1.1, contrast: 1.05 },
    particles: null, points: [], palette: 'day',
  },
  sunset: {
    sky: { mode: 'dome', top: '#2E3A7E', horizon: '#FF9E62', bottom: '#5A3A4E', sun: '#FFC27A', sunSize: 1.3, glow: '#FF7A4A', glowAmt: 1.0, stars: 0.15, clouds: 0.5, cloudColor: '#FFB89A' },
    fog: { color: '#E8A07A', density: 0.009 },
    hemi: { sky: '#8C8ED8', ground: '#6A4038', intensity: 1.0 },
    key: { color: '#FFB878', intensity: 2.5, dir: [-0.8, 0.22, 0.35] },
    ambient: { color: '#FFD0B0', intensity: 0.1 },
    exposure: 1.05, bloom: { strength: 0.5, radius: 0.5, threshold: 0.78 },
    grade: { vignette: 0.3, saturation: 1.12, contrast: 1.05 },
    particles: null, points: [], palette: 'sunset',
  },
  night: {
    sky: { mode: 'dome', top: '#050A1C', horizon: '#1F3260', bottom: '#0A0F1E', sun: '#DCE6FF', sunSize: 0.6, glow: '#5A78C8', glowAmt: 0.35, stars: 1, clouds: 0.2, cloudColor: '#3A4A78' },
    fog: { color: '#16223F', density: 0.024 },
    hemi: { sky: '#5068B8', ground: '#141A2A', intensity: 0.85 },
    key: { color: '#B8CCFF', intensity: 0.9, dir: [0.35, 0.6, -0.5] },
    ambient: { color: '#3A4A80', intensity: 0.15 },
    exposure: 1.15, bloom: { strength: 0.7, radius: 0.5, threshold: 0.7 },
    particles: null, points: [], palette: 'night',
  },
  'night-neon': {
    sky: { mode: 'dome', top: '#0B0718', horizon: '#54206A', bottom: '#120A26', sun: '#F0E8FF', sunSize: 0.5, glow: '#FF4FA0', glowAmt: 0.9, stars: 0.55, clouds: 0.3, cloudColor: '#6A2A7A' },
    fog: { color: '#22123A', density: 0.022 },
    hemi: { sky: '#6A6CFF', ground: '#1A0D22', intensity: 0.95 },
    key: { color: '#9AA8FF', intensity: 0.7, dir: [-0.5, 0.65, 0.3] },
    ambient: { color: '#4A2A6A', intensity: 0.15 },
    exposure: 1.1, bloom: { strength: 1.0, radius: 0.55, threshold: 0.62 },
    grade: { vignette: 0.36, saturation: 1.12, contrast: 1.06 },
    particles: null, palette: 'night-neon',
    points: [
      { color: '#FF2FD0', intensity: 40, distance: 22, pos: [-6, 4, -3] },
      { color: '#22E6FF', intensity: 34, distance: 20, pos: [7, 3.5, 2] },
    ],
  },
  'dungeon-torch': {
    sky: { mode: 'color', top: '#07060A', horizon: '#0D0A0C', bottom: '#07060A', stars: 0, clouds: 0 },
    fog: { color: '#0E0A0B', density: 0.065 },
    hemi: { sky: '#5A4A6A', ground: '#1A120C', intensity: 0.45 },
    key: { color: '#7A88C0', intensity: 0.35, dir: [0.3, 0.8, 0.4] },
    ambient: { color: '#3A2416', intensity: 0.25 },
    exposure: 1.2, bloom: { strength: 0.65, radius: 0.45, threshold: 0.7 },
    particles: { count: 90, color: '#FFB060', size: 0.07, area: 14, height: 5, rise: 0.25, additive: true },
    grade: { vignette: 0.45, saturation: 1.05, contrast: 1.06 },
    palette: 'dungeon-torch',
    // the carried torch: follows look.setFocus(player, yaw) at this offset in the player's
    // frame (2 m in front, 3.2 m up), turned with the facing (v.yaw when no yaw is passed)
    points: [{ color: '#FF9A3C', intensity: 55, distance: 18, pos: [0, 3.2, 2], follow: 'focus', flicker: 0.18 }],
  },
  'cozy-indoor': {
    sky: { mode: 'color', top: '#1E1712', horizon: '#2A2018', bottom: '#1E1712', stars: 0, clouds: 0 },
    fog: { color: '#3A2A20', density: 0.018 },
    hemi: { sky: '#FFE2C0', ground: '#5A3A28', intensity: 0.9 },
    key: { color: '#FFD9A0', intensity: 2.0, dir: [0.55, 0.7, 0.35] },
    ambient: { color: '#FFC890', intensity: 0.12 },
    exposure: 1.0, bloom: { strength: 0.35, radius: 0.5, threshold: 0.82 },
    particles: { count: 60, color: '#FFE8C0', size: 0.035, area: 10, height: 4, rise: 0.04, additive: true },
    palette: 'cozy-indoor',
    points: [{ color: '#FFB060', intensity: 22, distance: 14, pos: [-3, 3, -2], flicker: 0.04 }],
  },
  space: {
    sky: { mode: 'dome', top: '#04050D', horizon: '#141235', bottom: '#04050D', sun: '#FFF6E8', sunSize: 0.7, glow: '#6A3CFF', glowAmt: 0.6, stars: 2.2, clouds: 0, nebula: '#4A22A0', haze: 0.04 },
    fog: { color: '#0A0A1E', density: 0.006 },
    hemi: { sky: '#5A6AB0', ground: '#14142A', intensity: 0.85 },
    key: { color: '#FFF4E4', intensity: 3.0, dir: [0.7, 0.5, 0.4] },
    ambient: { color: '#303A70', intensity: 0.25 },
    exposure: 1.0, bloom: { strength: 0.8, radius: 0.5, threshold: 0.7 },
    particles: null, points: [], palette: 'space',
  },
  underwater: {
    sky: { mode: 'dome', top: '#3FC0DC', horizon: '#11607E', bottom: '#04202E', sun: '#E8FDFF', sunSize: 2.2, glow: '#9FF4FF', glowAmt: 0.6, stars: 0, clouds: 0, caustics: 1 },
    fog: { color: '#0F5C76', density: 0.05 },
    hemi: { sky: '#7FE3FF', ground: '#0A3040', intensity: 1.0 },
    key: { color: '#C8F6FF', intensity: 1.7, dir: [0.15, 1, 0.25] },
    ambient: { color: '#3FA0B8', intensity: 0.15 },
    exposure: 1.05, bloom: { strength: 0.45, radius: 0.6, threshold: 0.8 },
    particles: { count: 120, color: '#D8FFFF', size: 0.05, area: 14, height: 6, rise: 0.35, additive: true },
    grade: { vignette: 0.38, saturation: 1.08, contrast: 1.04 },
    palette: 'underwater', points: [],
  },
  storybook: {
    sky: { mode: 'dome', top: '#4F98EA', horizon: '#C4DCF0', bottom: '#E8D6B0', sun: '#FFF6E0', sunSize: 1.0, glow: '#FFE0A8', glowAmt: 0.4, stars: 0, clouds: 0.5, cloudColor: '#FFFFFF' },
    fog: { color: '#CFE0EC', density: 0.009 },
    hemi: { sky: '#EAF2FF', ground: '#C9B490', intensity: 1.3 },
    key: { color: '#FFF0D2', intensity: 2.3, dir: [0.5, 0.8, 0.45] },
    ambient: { color: '#FFFFFF', intensity: 0.15 },
    exposure: 0.95, bloom: { strength: 0.18, radius: 0.4, threshold: 0.94 },
    grade: { vignette: 0.18, saturation: 1.14, contrast: 1.03 },
    particles: null, points: [], palette: 'storybook',
  },
};

export const PRESET_NAMES = Object.freeze(Object.keys(P));
export const PRESETS = deepFreeze(JSON.parse(JSON.stringify(P)));

/** which ground kind fits each preset (used by examples and as a default for groundPlane) */
export const PRESET_GROUNDS = Object.freeze({
  day: 'grass', sunset: 'sand', night: 'snow', 'night-neon': 'asphalt', 'dungeon-torch': 'flagstones',
  'cozy-indoor': 'planks', space: 'metal', underwater: 'sand', storybook: 'grass',
});

function deepFreeze(o) {
  if (o && typeof o === 'object') { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(a, b) {
  if (!isObj(b)) return b === undefined ? a : b;
  const out = isObj(a) ? { ...a } : {};
  for (const k of Object.keys(b)) out[k] = isObj(b[k]) && isObj(out[k]) ? merge(out[k], b[k]) : clone(b[k]);
  return out;
}

/**
 * A preset as a fresh, validated, editable config.
 * @param {string|object} name  a preset name, or a full config object
 * @param {object} [overrides]  deep-merged on top (e.g. { fog: { density: 0.03 } })
 */
export function getPreset(name = 'day', overrides) {
  let base;
  if (isObj(name)) base = merge(clone(P.day), name);
  else {
    if (!P[name]) throw new Error(`look: unknown preset "${name}" (have: ${PRESET_NAMES.join(', ')})`);
    base = clone(P[name]);
  }
  const cfg = overrides ? merge(base, overrides) : base;
  cfg.name = typeof name === 'string' ? name : (cfg.name || 'custom');
  cfg.key.dir = normalize3(cfg.key.dir);
  return cfg;
}

/** problems with a config ([] when valid): every colour parses, every number is finite and sane */
export function validatePreset(cfg) {
  const errs = [];
  const col = (path, v) => { if (!isHex(v)) errs.push(`${path} is not a #rrggbb colour: ${v}`); };
  const num = (path, v, lo, hi) => { if (!(Number.isFinite(v) && v >= lo && v <= hi)) errs.push(`${path} out of range [${lo}, ${hi}]: ${v}`); };
  if (!cfg || typeof cfg !== 'object') return ['not an object'];
  const s = cfg.sky || {};
  if (!['dome', 'color'].includes(s.mode)) errs.push(`sky.mode must be dome|color: ${s.mode}`);
  for (const k of ['top', 'horizon', 'bottom']) col(`sky.${k}`, s[k]);
  if (s.mode === 'dome') { col('sky.sun', s.sun); col('sky.glow', s.glow); }
  col('fog.color', cfg.fog?.color); num('fog.density', cfg.fog?.density, 0, 0.2);
  col('hemi.sky', cfg.hemi?.sky); col('hemi.ground', cfg.hemi?.ground); num('hemi.intensity', cfg.hemi?.intensity, 0, 5);
  col('key.color', cfg.key?.color); num('key.intensity', cfg.key?.intensity, 0, 10);
  const d = cfg.key?.dir;
  if (!Array.isArray(d) || d.length !== 3 || d.some((x) => !Number.isFinite(x))) errs.push('key.dir must be [x,y,z]');
  col('ambient.color', cfg.ambient?.color); num('ambient.intensity', cfg.ambient?.intensity, 0, 3);
  num('exposure', cfg.exposure, 0.2, 3);
  if (cfg.bloom) { num('bloom.strength', cfg.bloom.strength, 0, 3); num('bloom.radius', cfg.bloom.radius, 0, 1.5); num('bloom.threshold', cfg.bloom.threshold, 0, 1.5); }
  for (const [i, p] of (cfg.points || []).entries()) { col(`points[${i}].color`, p.color); num(`points[${i}].intensity`, p.intensity, 0, 500); }
  if (cfg.particles) { col('particles.color', cfg.particles.color); num('particles.count', cfg.particles.count, 0, 5000); }
  if (!PALETTES[cfg.palette]) errs.push(`palette "${cfg.palette}" is not a named palette`);
  return errs;
}

// ------------------------------------------------------------------ time of day
// Hours 0..24. Key frames blend the outdoor presets; the key light follows the
// sun by day and the moon by night.
const TOD_KEYS = [[0, 'night'], [5.2, 'night'], [6.6, 'sunset'], [8.5, 'day'], [16, 'day'], [18.2, 'sunset'], [19.8, 'night'], [24, 'night']];

/** the direction toward the sun (by day) or the moon (by night) at an hour, normalised */
export function sunDirection(hour) {
  const h = ((hour % 24) + 24) % 24;
  const day = h >= 6 && h <= 18;
  // the sun rises in the east (+x), peaks in the south-ish sky, sets in the west (-x)
  const t = day ? (h - 6) / 12 : ((h + 6) % 24) / 12; // 0..1 across its arc
  const a = t * Math.PI;
  const elev = Math.max(0.12, Math.sin(a)) * (day ? 1 : 0.75);
  return normalize3([Math.cos(a), elev * 1.2, 0.35]);
}

/** a preset config for an hour (0..24), blended between night, sunset and day */
export function presetAtHour(hour, overrides) {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < TOD_KEYS.length - 2 && h > TOD_KEYS[i + 1][0]) i++;
  const [ha, a] = TOD_KEYS[i], [hb, b] = TOD_KEYS[i + 1];
  const t = hb > ha ? smooth01((h - ha) / (hb - ha)) : 0;
  const cfg = blendPresets(getPreset(a), getPreset(b), t);
  cfg.key.dir = sunDirection(h);
  cfg.sky.sunDir = cfg.key.dir.slice();
  cfg.hour = h;
  return overrides ? merge(cfg, overrides) : cfg;
}

/**
 * Blend two configs (t = 0 gives a, 1 gives b): colours mix, numbers lerp,
 * vectors lerp and renormalise, everything else snaps at t = 0.5.
 */
export function blendPresets(a, b, t) {
  const lerpAny = (x, y, k) => {
    if (isHex(x) && isHex(y)) return mixHex(x, y, t);
    if (typeof x === 'number' && typeof y === 'number') return x + (y - x) * t;
    if (Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v) => typeof v === 'number')) {
      const v = x.map((xv, i) => xv + (y[i] - xv) * t);
      return k === 'dir' || k === 'sunDir' ? normalize3(v) : v;
    }
    if (isObj(x) && isObj(y)) {
      const o = {};
      for (const kk of new Set([...Object.keys(x), ...Object.keys(y)])) o[kk] = kk in x && kk in y ? lerpAny(x[kk], y[kk], kk) : (t < 0.5 ? x[kk] : y[kk]) ?? x[kk] ?? y[kk];
      return o;
    }
    if (x == null || y == null) return t < 0.5 ? (x ?? y) : (y ?? x);
    return t < 0.5 ? clone(x) : clone(y);
  };
  const out = lerpAny(clone(a), clone(b), '');
  out.name = t < 0.5 ? a.name : b.name;
  return out;
}

// ------------------------------------------------------------------ colour maths (sRGB hex)
export const isHex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
export function hexToRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex([r, g, b]) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}
/** mix two hex colours, t = 0..1 */
export function mixHex(a, b, t) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}
/** lighten (amt > 0, toward white) or darken (amt < 0, toward black) */
export function shadeHex(hex, amt) {
  return amt >= 0 ? mixHex(hex, '#FFFFFF', amt) : mixHex(hex, '#000000', -amt);
}
export function rgba(hex, a = 1) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
/** relative luminance 0..1 (sRGB, approximate) */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const smooth01 = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
export const smoothstep = (a, b, x) => smooth01((x - a) / (b - a));
export const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------ tileable noise
/** integer hash -> [0, 1) */
export function hash2(x, y, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const wrap = (i, p) => ((i % p) + p) % p;

/**
 * Value noise that tiles over u, v in [0, 1): periods px, py lattice cells per tile.
 * Returns 0..1.
 */
// Lattices are cached per (period, seed): painting a 512 px texture samples
// noise millions of times, and a table lookup is far cheaper than a hash.
const LATTICES = new Map();
function lattice(px, py, seed) {
  const key = `${px}|${py}|${seed}`;
  let L = LATTICES.get(key);
  if (!L) {
    if (LATTICES.size > 256) LATTICES.clear();
    L = new Float32Array(px * py);
    for (let y = 0; y < py; y++) for (let x = 0; x < px; x++) L[y * px + x] = hash2(x, y, seed);
    LATTICES.set(key, L);
  }
  return L;
}

/**
 * A tileable value-noise sampler (u, v in [0,1) -> 0..1) with px x py lattice
 * cells per tile. Build it once, call it per pixel.
 */
export function noise2(px, py = px, seed = 0) {
  px = Math.max(1, px | 0); py = Math.max(1, py | 0);
  const L = lattice(px, py, seed);
  return (u, v) => {
    const x = u * px, y = v * py;
    const xi = Math.floor(x), yi = Math.floor(y);
    let tx = x - xi, ty = y - yi;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const x0 = ((xi % px) + px) % px, yw = ((yi % py) + py) % py;
    const x1 = x0 + 1 === px ? 0 : x0 + 1;
    const y0 = yw * px, y1 = (yw + 1 === py ? 0 : yw + 1) * px;
    const a = L[y0 + x0], b = L[y0 + x1], c = L[y1 + x0], d = L[y1 + x1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };
}

/** a tileable fractal-noise sampler, 0..1 (base periods px/py doubled each octave) */
export function fbm2(px, py = px, oct = 4, seed = 0) {
  const fs = [];
  let norm = 0, amp = 1;
  for (let o = 0; o < oct; o++) { fs.push([noise2(px << o, py << o, seed + o * 101), amp]); norm += amp; amp *= 0.5; }
  return (u, v) => {
    let s = 0;
    for (let o = 0; o < fs.length; o++) s += fs[o][0](u, v) * fs[o][1];
    return s / norm;
  };
}

/** one-off tileable noise sample (slow path: prefer noise2 in loops) */
export function tnoise(u, v, px, py = px, seed = 0) { return noise2(px, py, seed)(u, v); }
/** one-off tileable fbm sample (slow path: prefer fbm2 in loops) */
export function tfbm(u, v, px, py = px, oct = 4, seed = 0) { return fbm2(px, py, oct, seed)(u, v); }

const CELLS = new Map();
function cellTable(n, seed, jitter) {
  const key = `${n}|${seed}|${jitter}`;
  let C = CELLS.get(key);
  if (!C) {
    if (CELLS.size > 64) CELLS.clear();
    C = { ox: new Float32Array(n * n), oy: new Float32Array(n * n), id: new Float32Array(n * n) };
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = y * n + x;
      C.ox[i] = 0.5 + (hash2(x, y, seed) - 0.5) * jitter;
      C.oy[i] = 0.5 + (hash2(x, y, seed + 7) - 0.5) * jitter;
      C.id[i] = hash2(x, y, seed + 13);
    }
    CELLS.set(key, C);
  }
  return C;
}
const CELL_OUT = { f1: 0, f2: 0, id: 0, cx: 0, cy: 0 };

/**
 * Tileable cellular (Worley) noise over an n x n grid of jittered points.
 * @returns {{f1:number,f2:number,id:number,cx:number,cy:number}} distances in cell units,
 *   id 0..1 per cell, cx/cy the nearest feature point in cell units (unwrapped).
 *   The object is shared between calls: copy the fields you keep.
 */
export function tcell(u, v, n, seed = 0, jitter = 0.85) { return cell2(n, seed, jitter)(u, v); }

/** a tileable cellular sampler: build once, call per pixel (see tcell for the result) */
export function cell2(n, seed = 0, jitter = 0.85) {
  const C = cellTable(n, seed, jitter);
  return (u, v) => cellAt(C, n, u, v);
}
function cellAt(C, n, u, v) {
  const x = u * n, y = v * n;
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0, cx = 0, cy = 0;
  for (let dy = -1; dy <= 1; dy++) {
    const gy = yi + dy, wy = wrap(gy, n) * n;
    for (let dx = -1; dx <= 1; dx++) {
      const gx = xi + dx, i = wy + wrap(gx, n);
      const px = gx + C.ox[i], py = gy + C.oy[i];
      const ddx = px - x, ddy = py - y;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d < f1) { f2 = f1; f1 = d; id = C.id[i]; cx = px; cy = py; } else if (d < f2) f2 = d;
    }
  }
  CELL_OUT.f1 = f1; CELL_OUT.f2 = f2; CELL_OUT.id = id; CELL_OUT.cx = cx; CELL_OUT.cy = cy;
  return CELL_OUT;
}

/** plain (non-tiling) 2D value noise for world-space variation, 0..1 */
export function vnoise(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let tx = x - xi, ty = y - yi;
  tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

// ------------------------------------------------------------------ scatter placement
/**
 * Normalise an area: {x, z, w, d} (centre + size), {x, z, r} (disc),
 * or {minX, maxX, minZ, maxZ}. Returns { kind, x, z, w, d, r, contains(x,z) }.
 */
export function normalizeArea(a = {}) {
  if (typeof a === 'number') a = { w: a, d: a };
  if (Number.isFinite(a.r)) {
    const x = a.x ?? 0, z = a.z ?? 0, r = a.r;
    return { kind: 'disc', x, z, r, w: r * 2, d: r * 2, contains: (px, pz) => (px - x) ** 2 + (pz - z) ** 2 <= r * r };
  }
  if (Number.isFinite(a.minX)) {
    const w = a.maxX - a.minX, d = a.maxZ - a.minZ;
    return normalizeArea({ x: a.minX + w / 2, z: a.minZ + d / 2, w, d });
  }
  const x = a.x ?? 0, z = a.z ?? 0, w = a.w ?? a.size ?? 20, d = a.d ?? a.size ?? w;
  return { kind: 'rect', x, z, w, d, r: Math.hypot(w, d) / 2, contains: (px, pz) => Math.abs(px - x) <= w / 2 && Math.abs(pz - z) <= d / 2 };
}

/** true when (x, z) is inside any avoid shape ({x,z,r} discs, {x,z,w,d} rects, or a function) */
export function isAvoided(avoid, x, z, pad = 0) {
  if (!avoid) return false;
  if (typeof avoid === 'function') return !!avoid(x, z);
  for (const s of avoid) {
    if (typeof s === 'function') { if (s(x, z)) return true; continue; }
    if (Number.isFinite(s.r)) { if ((x - s.x) ** 2 + (z - s.z) ** 2 < (s.r + pad) ** 2) return true; continue; }
    if (Math.abs(x - s.x) < (s.w ?? 0) / 2 + pad && Math.abs(z - s.z) < (s.d ?? s.w ?? 0) / 2 + pad) return true;
  }
  return false;
}

/**
 * Seeded, deterministic placement for props.
 * @param {object} area      see normalizeArea
 * @param {object} [o]
 * @param {number} [o.count=20]
 * @param {number|string} [o.seed=1]
 * @param {Array|Function} [o.avoid]  shapes (or a predicate) to keep clear
 * @param {number} [o.minDist=0]     minimum spacing between points
 * @param {[number,number]} [o.scale=[0.8,1.25]]  random uniform scale range
 * @param {number[]} [o.weights]     one weight per item; picks `item` indices
 * @param {number} [o.pad=0]         extra clearance added to avoid shapes
 * @returns {{x:number,z:number,rot:number,scale:number,item:number}[]}
 */
export function scatterPoints(area, {
  count = 20, seed = 1, avoid = null, minDist = 0, scale = [0.8, 1.25], weights = [1], pad = 0, maxTries = 30,
} = {}) {
  const A = normalizeArea(area);
  const rng = createRng(typeof seed === 'string' ? seed : (seed >>> 0) + 0x9e37);
  const pts = [];
  const totalW = weights.reduce((s, w) => s + Math.max(0, w), 0) || 1;
  const md2 = minDist * minDist;
  for (let i = 0; i < count; i++) {
    let placed = null;
    for (let t = 0; t < maxTries && !placed; t++) {
      let x, z;
      if (A.kind === 'disc') {
        const a = rng.next() * Math.PI * 2, r = Math.sqrt(rng.next()) * A.r;
        x = A.x + Math.cos(a) * r; z = A.z + Math.sin(a) * r;
      } else {
        x = A.x + (rng.next() - 0.5) * A.w; z = A.z + (rng.next() - 0.5) * A.d;
      }
      if (isAvoided(avoid, x, z, pad)) continue;
      if (md2 > 0 && pts.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < md2)) continue;
      placed = { x, z };
    }
    if (!placed) continue;
    let pick = rng.next() * totalW, item = 0;
    for (; item < weights.length - 1; item++) { pick -= Math.max(0, weights[item]); if (pick < 0) break; }
    placed.rot = rng.next() * Math.PI * 2;
    placed.scale = scale[0] + rng.next() * (scale[1] - scale[0]);
    placed.item = item;
    pts.push(placed);
  }
  return pts;
}

/** how many times a texture covering `tile` world units repeats over `size` world units */
export function repeatFor(size, tile) {
  const [w, d] = Array.isArray(size) ? size : [size, size];
  return [Math.max(0.01, w / tile), Math.max(0.01, d / tile)];
}

/** FNV-1a over bytes (for determinism checks) */
export function hashBytes(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
