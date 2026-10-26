// brand.js — the Brand Kit (spec §5.5): BrainDaemon placed naturally in the game world.
//
//   const brand = createBrand({ THREE, scene, camera });     // 3D games
//   const brand = createBrand({ ctx2d });                    // 2D / pixel games
//   brand.neonSign({ position: [0, 4, -10] });
//   brand.update(dt);                                        // animate (wave, flicker, orbit)
//   brand.count(); brand.visibleAtStart(camera);             // self-test hooks
//
// Every world helper registers itself. introCard()/endCard() are screens, not
// placements, and are not counted. three.js is passed in (never imported) so a
// 2D game does not load it.
//
// Textures are painted on canvases: the mark comes from assets/brand/core-mark-256.png
// when it is small enough to draw without upscaling, otherwise from the official
// vector geometry (same art, crisp at billboard size), plus the wordmark text.

import {
  WORDMARK, SITE, COLORS, FONT, rgba, tint, roundRect, drawMark, MARK_ASPECT, drawWordmark,
  fitWordmark, neonPasses, drawPixelMark, PIXEL_MARK_SIZE, drawPixelText, pixelTextWidth,
} from './brand-art.js';
import { tr, detectLang } from './shell.js';

const DEFAULT_ASSETS = (() => {
  try { return new URL('../assets/brand/', import.meta.url).href; } catch { return 'assets/brand/'; }
})();
const HOME_URL = 'https://braindaemon.com';

/**
 * @param {object} [o]
 * @param {object} [o.THREE]   the three.js namespace (needed for 3D helpers)
 * @param {object} [o.scene]   default parent for 3D helpers
 * @param {object} [o.camera]  default camera for visibleAtStart()
 * @param {CanvasRenderingContext2D} [o.ctx2d]  for pixelSign / pixelBanner
 * @param {{x,y,w,h}} [o.view] 2D view rect for visibleAtStart (default: the ctx2d canvas)
 * @param {string} [o.lang]    en|ar|ru|zh for the cards (default ?lang=)
 * @param {string} [o.url]     "Make your own" link
 * @param {number} [o.res=1]   texture resolution scale (use 0.5 on the low tier)
 * @param {string} [o.assets]  base URL of the brand PNGs (core-mark-256.png). Default: `../assets/brand/`
 *   next to this file, so a Blueprint ships `assets/brand/` (a copy of game-kit/assets/brand) beside `kit/`.
 *   Pass your own URL when the PNGs live elsewhere; without them the vector mark is drawn instead.
 */
export function createBrand({
  THREE, scene, camera, ctx2d, view, lang, url = HOME_URL, res = 1, assets = DEFAULT_ASSETS, anisotropy = 8,
} = {}) {
  const L = lang || detectLang();
  const hasDom = typeof document !== 'undefined' && !!document.createElement;
  const items = [];        // registered placements
  const repaints = [];     // canvas textures to repaint once the PNG mark arrives
  const texCache = new Map();
  let markImg = null;
  let time = 0;

  if (hasDom && typeof Image !== 'undefined') {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { markImg = img; for (const fn of repaints) fn(); };
    img.src = assets + 'core-mark-256.png';
  }

  function register(kind, data) {
    const it = { kind, ...data };
    items.push(it);
    return it;
  }
  function need3D(name) {
    if (!THREE) throw new Error(`brand.${name}() needs { THREE } in createBrand()`);
  }

  // ------------------------------------------------------------------ canvas -> texture
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(w * res));
    c.height = Math.max(2, Math.round(h * res));
    return c;
  }
  let scratch = null;
  function measureCtx() {
    if (!scratch) scratch = makeCanvas(8, 8).getContext('2d');
    return scratch;
  }

  /** paint(ctx, w, h) in logical pixels; repainted when the PNG mark loads */
  function canvasTexture(key, w, h, paint, { repeat = false } = {}) {
    if (key && texCache.has(key)) return texCache.get(key);
    const c = makeCanvas(w, h);
    const g = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = anisotropy;
    if (repeat) tex.wrapS = THREE.RepeatWrapping;
    const draw = () => {
      g.setTransform(c.width / w, 0, 0, c.height / h, 0, 0);
      g.clearRect(0, 0, w, h);
      g.save();      // painters change fonts/alignment; keep repaints independent
      paint(g, w, h);
      g.restore();
      tex.needsUpdate = true;
    };
    draw();
    repaints.push(draw);
    const out = { tex, aspect: w / h };
    if (key) texCache.set(key, out);
    return out;
  }

  const markOpts = (o = {}) => ({ img: markImg, ...o });

  // ------------------------------------------------------------------ painters
  function neonTexture(text, color, withMark) {
    const H = 320, fs = 150, pad = 70, gap = 46;
    const m = measureCtx();
    m.font = `600 ${fs}px ${FONT}`;
    const tw = m.measureText(text).width;
    const mh = H * 0.66, mw = withMark ? mh * MARK_ASPECT : 0;
    const W = Math.ceil(pad * 2 + mw + (withMark ? gap : 0) + tw);
    return canvasTexture(`neon:${text}:${color}:${withMark}`, W, H, (g) => {
      if (withMark) neonPasses(g, color, 7, (c) => drawMark(c, pad + mw / 2, H / 2, mh, { style: 'neon' }));
      neonPasses(g, color, 7, (c) => {
        c.font = `600 ${fs}px ${FONT}`;
        c.textBaseline = 'middle';
        c.fillText(text, pad + mw + (withMark ? gap : 0), H / 2 + 6);
      });
    });
  }

  function glowTexture() {
    return canvasTexture('glow', 256, 256, (g) => {
      const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.25, 'rgba(255,255,255,.55)');
      grd.addColorStop(0.6, 'rgba(255,255,255,.14)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    }).tex;
  }

  // vertical fade for light beams. 'up': bright at the bottom (rises from a base);
  // 'down': bright at the top (falls from a lamp).
  function beamTexture(dir = 'up') {
    return canvasTexture('beam:' + dir, 32, 256, (g) => {
      const grd = dir === 'up' ? g.createLinearGradient(0, 256, 0, 0) : g.createLinearGradient(0, 0, 0, 256);
      grd.addColorStop(0, 'rgba(255,255,255,.75)');
      grd.addColorStop(0.35, 'rgba(255,255,255,.22)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 32, 256);
    }).tex;
  }

  function billboardTexture(headline, tagline) {
    const W = 2048, H = 1024;
    return canvasTexture(`bb:${headline}:${tagline}`, W, H, (g) => {
      const bg = g.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, '#0A0F1F'); bg.addColorStop(0.55, '#132457'); bg.addColorStop(1, '#0E1322');
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      // soft key light behind the mark
      const glow = g.createRadialGradient(H * 0.52, H * 0.5, 10, H * 0.52, H * 0.5, H * 0.62);
      glow.addColorStop(0, rgba(COLORS.ear, 0.42)); glow.addColorStop(1, rgba(COLORS.ear, 0));
      g.fillStyle = glow; g.fillRect(0, 0, W, H);
      // diagonal light streaks
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 5; i++) {
        g.strokeStyle = rgba(COLORS.light, 0.04 + i * 0.012);
        g.lineWidth = 60 - i * 9;
        g.beginPath(); g.moveTo(W * 0.45 + i * 170, H + 40); g.lineTo(W * 0.78 + i * 170, -40); g.stroke();
      }
      g.restore();
      // inner border
      g.strokeStyle = rgba(COLORS.light, 0.22); g.lineWidth = 4;
      roundRect(g, 22, 22, W - 44, H - 44, 28); g.stroke();

      drawMark(g, H * 0.52, H * 0.5, H * 0.66, markOpts());
      const tx = H * 1.0, maxW = W - tx - 110;
      const fs = fitWordmark(g, maxW, 250);
      drawWordmark(g, tx, H * 0.4, fs, { shadow: { color: 'rgba(0,0,0,.45)', blur: 24, y: 6 } });
      const bar = g.createLinearGradient(tx, 0, tx + 420, 0);
      bar.addColorStop(0, COLORS.ear); bar.addColorStop(1, COLORS.violet);
      g.fillStyle = bar; roundRect(g, tx + 6, H * 0.4 + fs * 0.5 + 18, 420, 12, 6); g.fill();
      g.font = `600 ${Math.round(fs * 0.4)}px ${FONT}`;
      g.textBaseline = 'middle'; g.fillStyle = COLORS.light;
      g.fillText(tagline, tx + 6, H * 0.4 + fs * 0.5 + 18 + 12 + fs * 0.36);
      g.font = `600 44px ${FONT}`; g.textAlign = 'right'; g.fillStyle = rgba(COLORS.hi, 0.55);
      g.fillText(headline || SITE, W - 80, H - 86);
    });
  }

  /**
   * mark + wordmark side by side; bg: null (transparent) | 'dark' | 'light'.
   * ink: 'light' (pale wordmark, for dark surfaces) | 'dark' (navy wordmark, for light surfaces);
   * by default it follows bg (dark ink only on the light panel).
   */
  function logoTexture(bg = null, W = 2048, H = 512, ink = bg === 'light' ? 'dark' : 'light') {
    return canvasTexture(`logo:${bg}:${ink}:${W}x${H}`, W, H, (g) => {
      if (bg) {
        const grd = g.createLinearGradient(0, 0, 0, H);
        if (bg === 'dark') { grd.addColorStop(0, '#16224A'); grd.addColorStop(1, '#0B1020'); }
        else { grd.addColorStop(0, '#FFFFFF'); grd.addColorStop(1, '#DCE7FF'); }
        g.fillStyle = grd; roundRect(g, 8, 8, W - 16, H - 16, H * 0.18); g.fill();
      }
      const mh = H * 0.74, mw = mh * MARK_ASPECT, gap = H * 0.12;
      const fs = fitWordmark(g, W * 0.86 - mw - gap, H * 0.44);
      const tw = drawWordmark(g, 0, 0, fs, { measureOnly: true });
      const x0 = (W - (mw + gap + tw)) / 2;
      drawMark(g, x0 + mw / 2, H / 2, mh, markOpts());
      const darkInk = ink === 'dark';
      drawWordmark(g, x0 + mw + gap, H / 2 + fs * 0.04, fs, {
        a: darkInk ? COLORS.tile : COLORS.hi, b: darkInk ? COLORS.blue : COLORS.light,
        shadow: bg ? null : darkInk ? { color: 'rgba(255,255,255,.55)', blur: 10, y: 0 } : { color: 'rgba(0,0,0,.5)', blur: 18, y: 4 },
      });
    });
  }

  function markTexture(style = 'color', color = COLORS.ear) {
    return canvasTexture(`mark:${style}:${color}`, 512, 512, (g) => {
      if (style === 'holo') {
        g.save();
        g.shadowColor = color; g.shadowBlur = 26;
        drawMark(g, 256, 256, 440, { style: 'mono', color: tint(color, 0.35) });
        g.restore();
        // scanlines: knock out every 4th row for the projected look
        g.globalCompositeOperation = 'destination-out';
        g.fillStyle = 'rgba(0,0,0,.55)';
        for (let y = 0; y < 512; y += 6) g.fillRect(0, y, 512, 2);
        g.globalCompositeOperation = 'source-over';
      } else {
        drawMark(g, 256, 256, 460, markOpts({ style }));
      }
    });
  }

  function flagTexture() {
    const W = 1024, H = 640;
    return canvasTexture('flag', W, H, (g) => {
      const grd = g.createLinearGradient(0, 0, W, H);
      grd.addColorStop(0, '#1B3F9E'); grd.addColorStop(1, '#0E1322');
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      g.fillStyle = COLORS.goldLight; g.fillRect(0, 0, W * 0.05, H);
      g.fillStyle = rgba(COLORS.light, 0.12);
      for (let i = 0; i < 6; i++) g.fillRect(W * 0.05, H * (0.1 + i * 0.16), W, H * 0.04);
      drawMark(g, W * 0.52, H * 0.4, H * 0.52, markOpts());
      const fs = fitWordmark(g, W * 0.78, H * 0.16);
      drawWordmark(g, W * 0.52, H * 0.82, fs, { align: 'center', shadow: { color: 'rgba(0,0,0,.4)', blur: 10, y: 3 } });
    });
  }

  function shopTexture(text, sub) {
    const W = 1024, H = 512;
    return canvasTexture(`shop:${text}:${sub}`, W, H, (g) => {
      const grd = g.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, '#1A2A5E'); grd.addColorStop(1, '#0B1020');
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      g.strokeStyle = COLORS.light; g.lineWidth = 10; roundRect(g, 26, 26, W - 52, H - 52, 40); g.stroke();
      g.strokeStyle = rgba(COLORS.light, 0.3); g.lineWidth = 3; roundRect(g, 46, 46, W - 92, H - 92, 28); g.stroke();
      const mh = H * 0.5;
      drawMark(g, W / 2, H * 0.36, mh, markOpts());
      const fs = fitWordmark(g, W * 0.76, H * 0.17, 800, text);
      drawWordmark(g, W / 2, H * 0.72, fs, { align: 'center', text });
      if (sub) {
        g.font = `700 ${Math.round(H * 0.06)}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillStyle = COLORS.goldLight; g.fillText(sub.toUpperCase(), W / 2, H * 0.84);
      }
    });
  }

  function bannerTexture() {
    const W = 512, H = 1536;
    return canvasTexture('bannerV', W, H, (g) => {
      // cloth with a V notch at the bottom (transparent, cut by alphaTest)
      g.beginPath();
      g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(W, H); g.lineTo(W / 2, H - W * 0.32); g.lineTo(0, H); g.closePath();
      const grd = g.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, '#2A63EE'); grd.addColorStop(0.6, '#1B3F9E'); grd.addColorStop(1, '#0E1322');
      g.fillStyle = grd; g.fill();
      g.save(); g.clip();
      g.fillStyle = COLORS.goldLight; g.fillRect(0, 0, W, 22); g.fillRect(0, 34, W, 6);
      g.fillStyle = rgba(COLORS.hi, 0.9); g.fillRect(W * 0.08, 0, 6, H); g.fillRect(W * 0.92 - 6, 0, 6, H);
      g.restore();
      // mark on a soft disc
      g.fillStyle = rgba(COLORS.tile, 0.55);
      g.beginPath(); g.arc(W / 2, W * 0.62, W * 0.4, 0, Math.PI * 2); g.fill();
      drawMark(g, W / 2, W * 0.62, W * 0.62, markOpts());
      // vertical wordmark, reading bottom-to-top
      g.save();
      g.translate(W / 2, H * 0.6);
      g.rotate(-Math.PI / 2);
      const fs = fitWordmark(g, H * 0.52, W * 0.34);
      drawWordmark(g, 0, 0, fs, { align: 'center', shadow: { color: 'rgba(0,0,0,.4)', blur: 10, y: 3 } });
      g.restore();
    });
  }

  // W follows the panel's aspect so the mark and text are never stretched
  function archTexture(aspect) {
    const H = 320, W = Math.min(4096, Math.round(H * aspect));
    return canvasTexture('arch:' + W, W, H, (g) => {
      g.fillStyle = '#0B1020'; g.fillRect(0, 0, W, H);
      // checkered ends
      const sq = H / 4;
      for (const x0 of [0, W - sq * 5]) {
        for (let cx = 0; cx < 5; cx++) for (let cy = 0; cy < 4; cy++) {
          g.fillStyle = (cx + cy) % 2 ? '#AEB9D0' : '#111522';
          g.fillRect(x0 + cx * sq, cy * sq, sq, sq);
        }
      }
      g.fillStyle = COLORS.ear; g.fillRect(0, 0, W, 10); g.fillRect(0, H - 10, W, 10);
      const mh = H * 0.72, mw = mh * MARK_ASPECT, gap = 40;
      const fs = fitWordmark(g, W - sq * 10 - mw - gap - 160, H * 0.5);
      const tw = drawWordmark(g, 0, 0, fs, { measureOnly: true });
      const x0 = (W - (mw + gap + tw)) / 2;
      drawMark(g, x0 + mw / 2, H / 2, mh, markOpts());
      drawWordmark(g, x0 + mw + gap, H / 2 + 6, fs, { shadow: { color: rgba(COLORS.ear, 0.7), blur: 26 } });
    });
  }

  function ringTexture(color) {
    const W = 2048, H = 128;
    return canvasTexture(`ring:${color}`, W, H, (g) => {
      g.font = `800 76px ${FONT}`; g.textBaseline = 'middle';
      g.shadowColor = color; g.shadowBlur = 18; g.fillStyle = tint(color, 0.4);
      const unit = `${WORDMARK.toUpperCase()}   •   `;
      const uw = g.measureText(unit).width;
      for (let x = 0; x < W; x += uw) g.fillText(unit, x, H / 2);
    }, { repeat: true });
  }

  // ------------------------------------------------------------------ 3D helpers
  const v3 = (p) => (Array.isArray(p) ? p : p ? [p.x, p.y, p.z] : [0, 0, 0]);
  function place(kind, obj, opts, update) {
    const [x, y, z] = v3(opts.position);
    obj.position.set(x, y, z);
    if (opts.rotationY != null) obj.rotation.y = opts.rotationY;
    if (opts.scale != null) obj.scale.setScalar(opts.scale);
    obj.name = `brand:${kind}`;
    const parent = opts.parent || scene;
    if (parent) parent.add(obj);
    register(kind, { obj, update });
    return obj;
  }

  let sharedMats = null;
  function mats() {
    if (sharedMats) return sharedMats;
    sharedMats = {
      metal: new THREE.MeshStandardMaterial({ color: 0x1b2232, metalness: 0.75, roughness: 0.38 }),
      steel: new THREE.MeshStandardMaterial({ color: 0xc4cddd, metalness: 0.85, roughness: 0.3 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x0b0f1c, metalness: 0.3, roughness: 0.7 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xf4b60a, metalness: 0.9, roughness: 0.25, emissive: 0x3a2400 }),
    };
    return sharedMats;
  }
  /** 'normal' | 'additive' | a three.js blending constant -> the constant */
  const blendOf = (b) => (typeof b === 'number' ? b : b === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending);
  const glowMat = (color, opacity) => new THREE.MeshBasicMaterial({
    map: glowTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false,
  });
  const lit = (color, intensity = 2.2) => new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: color, emissiveIntensity: intensity, toneMapped: false,
  });
  // A panel that reads well at night: its picture is also its emissive map (backlit print).
  const panelMat = (tex, glow = 0.6, extra = {}) => new THREE.MeshStandardMaterial({
    map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: glow, roughness: 0.55, metalness: 0.05, ...extra,
  });

  // Deterministic flicker pattern for the neon power-on.
  const FLICK = [1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1];

  const api = {
    /** glowing neon tubes on a dark backing, with an additive halo sprite */
    neonSign(opts = {}) {
      need3D('neonSign');
      const { text = WORDMARK, color = COLORS.ear, width = 6, mark = true, backing = true, flicker = true, light = false } = opts;
      const { tex, aspect } = neonTexture(text, color, mark);
      const h = width / aspect;
      const g = new THREE.Group();
      if (backing) {
        const back = new THREE.Mesh(new THREE.BoxGeometry(width * 1.04, h * 1.08, 0.1), mats().dark);
        back.position.z = -0.07;
        g.add(back);
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
          const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 8), mats().steel);
          bolt.rotation.x = Math.PI / 2;
          bolt.position.set(sx * width * 0.48, sy * h * 0.44, 0);
          g.add(bolt);
        }
      }
      const wash = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.35, h * 2.2), glowMat(color, 0.2));
      wash.position.z = -0.015;
      const tubeMat = new THREE.MeshStandardMaterial({
        color: 0x000000, map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.15,
        transparent: true, depthWrite: false, toneMapped: false,
      });
      const tubes = new THREE.Mesh(new THREE.PlaneGeometry(width, h), tubeMat);
      tubes.renderOrder = 2;
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false,
      }));
      halo.scale.set(width * 1.25, h * 2.6, 1);
      halo.position.z = 0.15;
      g.add(wash, tubes, halo);
      let pl = null;
      if (light) { pl = new THREE.PointLight(color, 3, width * 2.2, 2); pl.position.set(0, 0, 1); g.add(pl); }
      let t = 0, next = 6 + Math.random() * 6;
      return place('neonSign', g, opts, (dt) => {
        if (!flicker) return;
        t += dt;
        let on = 1;
        if (t < 1.2) on = FLICK[Math.floor(t * 13) % FLICK.length];       // power-on stutter
        else if (t > next) { on = Math.random() < 0.5 ? 0.35 : 1; if (t > next + 0.18) next = t + 5 + Math.random() * 9; }
        tubeMat.emissiveIntensity = 0.1 + 1.05 * on;
        wash.material.opacity = 0.2 * on;
        halo.material.opacity = 0.12 * on;
        if (pl) pl.intensity = 3 * on;
      });
    },

    /** framed, backlit billboard on posts with three lamps */
    billboard(opts = {}) {
      need3D('billboard');
      const { width = 8, height = width / 2, posts = true, postHeight = height * 0.8 } = opts;
      const headline = opts.headline || SITE;
      const tagline = opts.tagline || tr(L, 'makeOwn');
      const { tex } = billboardTexture(headline, tagline);
      const g = new THREE.Group();
      const baseY = posts ? postHeight + height / 2 : 0;
      const box = new THREE.Mesh(new THREE.BoxGeometry(width + 0.3, height + 0.3, 0.3), mats().metal);
      box.position.y = baseY;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), panelMat(tex, 0.62));
      face.position.set(0, baseY, 0.152);
      g.add(box, face);
      if (posts) {
        for (const sx of [-1, 1]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, postHeight, 0.28), mats().metal);
          post.position.set(sx * width * 0.3, postHeight / 2, -0.05);
          g.add(post);
        }
        const walk = new THREE.Mesh(new THREE.BoxGeometry(width + 0.4, 0.06, 0.7), mats().metal);
        walk.position.set(0, baseY - height / 2 - 0.2, 0.3);
        g.add(walk);
      }
      // lamps: arm + glowing head + soft additive beam washing down the face
      const beamMat = new THREE.MeshBasicMaterial({
        map: beamTexture('down'), color: 0xfff1d6, transparent: true, opacity: 0.1, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      });
      for (const i of [-1, 0, 1]) {
        const x = i * width / 3;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.8), mats().metal);
        arm.position.set(x, baseY + height / 2 + 0.2, 0.42);
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.1, 0.2), lit(0xfff1d6, 2.5));
        head.position.set(x, baseY + height / 2 + 0.18, 0.84);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, width * 0.2, height * 0.95, 20, 1, true), beamMat);
        beam.position.set(x, baseY + height / 2 - height * 0.47, 0.55);
        g.add(arm, head, beam);
      }
      return place('billboard', g, opts);
    },

    /** airship with the logo wrapped on both flanks; optional orbit */
    blimp(opts = {}) {
      need3D('blimp');
      const { length = 22, orbit = { radius: 0, speed: 0.04 }, bodyColor = 0xe9eef8 } = opts;
      const R = length / 6.5;
      const g = new THREE.Group();
      const ship = new THREE.Group();
      g.add(ship);
      const body = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24),
        new THREE.MeshStandardMaterial({ color: bodyColor, metalness: 0.15, roughness: 0.42 }));
      body.scale.set(length / 2, R, R);
      ship.add(body);
      // Logo patches: a slice of a slightly larger ellipsoid, so the print hugs the hull.
      // dark rounded panel so the light wordmark reads on the white hull
      const { tex } = logoTexture('dark', 2048, 440);
      const logoMat = new THREE.MeshStandardMaterial({
        map: tex, transparent: true, roughness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.7,
        polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false,
      });
      const a = 0.78, b = 0.46; // half-angles along the hull and up/down (keeps the logo's aspect)
      for (const phiC of [Math.PI / 2, Math.PI * 1.5]) {
        const patch = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 10, phiC - a, a * 2, Math.PI / 2 - b, b * 2), logoMat);
        patch.scale.set(length / 2 * 1.006, R * 1.006, R * 1.006);
        ship.add(patch);
      }
      // tail fins, gondola, nose cap
      const finMat = new THREE.MeshStandardMaterial({ color: COLORS.blue, metalness: 0.3, roughness: 0.4 });
      for (let i = 0; i < 4; i++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(length * 0.16, R * 0.9, 0.12), finMat);
        const ang = (i * Math.PI) / 2;
        fin.position.set(-length * 0.41, Math.cos(ang) * R * 0.62, Math.sin(ang) * R * 0.62);
        fin.rotation.x = ang;
        ship.add(fin);
      }
      const gondola = new THREE.Mesh(new THREE.CapsuleGeometry(R * 0.22, length * 0.14, 6, 14), mats().metal);
      gondola.rotation.z = Math.PI / 2;
      gondola.position.set(length * 0.05, -R * 1.02, 0);
      ship.add(gondola);
      const windowStrip = new THREE.Mesh(new THREE.BoxGeometry(length * 0.13, R * 0.08, R * 0.46), lit(0xfff1d6, 1.6));
      windowStrip.position.set(length * 0.05, -R * 1.02, 0);
      ship.add(windowStrip);
      // a blue band around the hull near the nose (hull radius there: R*sqrt(1-0.66^2))
      const stripe = new THREE.Mesh(new THREE.TorusGeometry(R * Math.sqrt(1 - 0.66 * 0.66) * 1.01, R * 0.03, 8, 48), finMat);
      stripe.rotation.y = Math.PI / 2; stripe.position.x = length * 0.33;
      ship.add(stripe);
      // blinking nav lights
      const red = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), lit(0xff3b3b, 4));
      const green = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), lit(0x3bff7a, 4));
      red.position.set(-length * 0.47, R * 0.55, -0.1); green.position.set(-length * 0.47, -R * 0.55, 0.1);
      ship.add(red, green);
      const [cx, cy, cz] = v3(opts.position);
      let t = Math.random() * 10;
      const radius = orbit.radius || 0, speed = orbit.speed || 0.04;
      const upd = (dt) => {
        t += dt;
        const blink = (t % 1.6) < 0.12 ? 4 : 0.2;
        red.material.emissiveIntensity = blink; green.material.emissiveIntensity = blink;
        ship.position.y = Math.sin(t * 0.6) * 0.35;
        ship.rotation.z = Math.sin(t * 0.45) * 0.025;
        if (radius > 0) {
          const ang = t * speed;
          g.position.set(cx + Math.cos(ang) * radius, cy, cz + Math.sin(ang) * radius);
          g.rotation.y = -ang - Math.PI / 2 * Math.sign(speed); // nose along the path
        }
      };
      place('blimp', g, opts, upd);
      upd(0);
      return g;
    },

    /**
     * the mark floating in the sky like a moon, with a soft halo.
     * opacity: the mark's opacity (default 1; the halo scales with it);
     * blending: 'normal' (default) | 'additive' (the mark glows into a nebula) or a three.js blending constant;
     * renderOrder: draw order of both sprites (e.g. -3 to sit behind the scenery).
     */
    skyLogo(opts = {}) {
      need3D('skyLogo');
      const { size = 18, color = COLORS.ear, opacity = 1, blending = 'normal', renderOrder } = opts;
      const k = Math.max(0, Math.min(1, opacity));
      const g = new THREE.Group();
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color, transparent: true, opacity: 0.5 * k, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false, fog: false,
      }));
      halo.scale.set(size * 2.6, size * 2.6, 1);
      const mark = new THREE.Sprite(new THREE.SpriteMaterial({
        map: markTexture('color').tex, transparent: true, opacity: k, blending: blendOf(blending),
        depthWrite: false, fog: false, toneMapped: false,
      }));
      mark.scale.set(size, size, 1);
      if (renderOrder != null) halo.renderOrder = mark.renderOrder = renderOrder;
      g.add(halo, mark);
      let t = 0;
      return place('skyLogo', g, opts, (dt) => {
        t += dt;
        mark.position.y = Math.sin(t * 0.4) * size * 0.03;
        halo.material.opacity = (0.42 + Math.sin(t * 1.1) * 0.08) * k;
      });
    },

    /**
     * the mark drawn as a star constellation (two ears, the ring, the pupil star) with additive glow,
     * in world space (origin = its centre, facing +z). opacity 0..1 (fade it in at night with
     * obj.setOpacity(a)); size = height in world units; lines: draw the connecting lines.
     */
    constellation(opts = {}) {
      need3D('constellation');
      const { size = 20, color = '#FFF1C8', lineColor = COLORS.goldLight, opacity = 1, lines = true, twinkle = true, renderOrder } = opts;
      const pts = [], segs = [];
      // the mark's own geometry (brand-art.js, 256 box, centre 128,121), scaled to height 1
      const S = 1 / 154, cx = 128, cy = 121;
      const ear = [[0, -58], [9, -36], [10, -10], [0, 24], [-10, -10], [-9, -36]];
      for (const [ex, deg] of [[107, -23], [149, 23]]) {
        const a = (deg * Math.PI) / 180, base = pts.length;
        for (const [x, y] of ear) {
          const rx = ex + x * Math.cos(a) - y * Math.sin(a), ry = 102 + x * Math.sin(a) + y * Math.cos(a);
          pts.push([(rx - cx) * S, -(ry - cy) * S]);
        }
        for (let i = 0; i < ear.length; i++) segs.push(base + i, base + ((i + 1) % ear.length));
      }
      const ringBase = pts.length, ringN = 10;
      for (let i = 0; i < ringN; i++) {
        const a = (i / ringN) * Math.PI * 2 + 0.2;
        pts.push([(128 + Math.cos(a) * 52 - cx) * S, -(140 + Math.sin(a) * 52 - cy) * S]);
        segs.push(ringBase + i, ringBase + ((i + 1) % ringN));
      }
      pts.push([(131 - cx) * S, -(145 - cy) * S]); // the pupil: the brightest star
      const g = new THREE.Group();
      const n = pts.length;
      const pos = new Float32Array(n * 3);
      pts.forEach(([x, y], i) => { pos[i * 3] = x * size; pos[i * 3 + 1] = y * size; pos[i * 3 + 2] = 0; });
      const starGeo = new THREE.BufferGeometry();
      starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const starMat = new THREE.PointsMaterial({
        map: glowTexture(), color, size: size * 0.09, sizeAttenuation: true, transparent: true, opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false,
      });
      const stars = new THREE.Points(starGeo, starMat);
      // the pupil gets its own bigger sprite
      const pupil = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color, transparent: true, opacity, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false, fog: false,
      }));
      pupil.position.set(pos[(n - 1) * 3], pos[(n - 1) * 3 + 1], 0.01);
      pupil.scale.setScalar(size * 0.2);
      g.add(stars, pupil);
      let lineMat = null;
      if (lines) {
        const lp = new Float32Array(segs.length * 3);
        segs.forEach((k, i) => { lp[i * 3] = pos[k * 3]; lp[i * 3 + 1] = pos[k * 3 + 1]; lp[i * 3 + 2] = -0.01; });
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
        lineMat = new THREE.LineBasicMaterial({
          color: lineColor, transparent: true, opacity: opacity * 0.45, blending: THREE.AdditiveBlending,
          depthWrite: false, toneMapped: false, fog: false,
        });
        g.add(new THREE.LineSegments(lg, lineMat));
      }
      if (renderOrder != null) g.traverse((o) => { o.renderOrder = renderOrder; });
      for (const o of g.children) o.frustumCulled = false;
      let level = Math.max(0, Math.min(1, opacity));
      let t = Math.random() * 10;
      g.setOpacity = (a) => { level = Math.max(0, Math.min(1, a)); };
      const upd = (dt) => {
        t += dt;
        const tw = twinkle ? 0.85 + Math.sin(t * 2.3) * 0.15 : 1;
        starMat.opacity = level * tw;
        pupil.material.opacity = level * (twinkle ? 0.8 + Math.sin(t * 1.7 + 1) * 0.2 : 1);
        if (lineMat) lineMat.opacity = level * 0.45;
      };
      upd(0);
      return place('constellation', g, opts, upd);
    },

    /** waving cloth flag on a pole (origin = pole base) */
    flag(opts = {}) {
      need3D('flag');
      const { poleHeight = 6, width = 3, height = width * 0.625 } = opts;
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, poleHeight, 12), mats().steel);
      pole.position.y = poleHeight / 2;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), mats().gold);
      ball.position.y = poleHeight + 0.08;
      const geo = new THREE.PlaneGeometry(width, height, 24, 10);
      geo.translate(width / 2, 0, 0);
      const base = geo.attributes.position.array.slice();
      const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        map: flagTexture().tex, side: THREE.DoubleSide, roughness: 0.82,
        emissive: 0xffffff, emissiveMap: flagTexture().tex, emissiveIntensity: 0.18,
      }));
      cloth.position.set(0.06, poleHeight - height / 2 - 0.15, 0);
      g.add(pole, ball, cloth);
      let t = Math.random() * 5, frame = 0;
      return place('flag', g, opts, (dt) => {
        t += dt;
        const p = geo.attributes.position.array;
        for (let i = 0; i < p.length; i += 3) {
          const x = base[i], y = base[i + 1], k = x / width; // 0 at the pole
          p[i + 2] = (Math.sin(x * 2.1 - t * 4.6) * 0.17 + Math.sin(x * 4.3 - t * 7.1 + y * 1.7) * 0.05) * k;
          p[i + 1] = y - k * k * 0.06;
        }
        geo.attributes.position.needsUpdate = true;
        if ((frame++ & 1) === 0) geo.computeVertexNormals();
      });
    },

    /**
     * a logo decal attached to an existing mesh (sail, tent, car door, hull).
     * offset/normal are in the mesh's local space; offset should sit just above the surface.
     * bothSides: also print it on the back (sails, flags), readable from either side.
     * theme (kind 'logo'): 'dark' (default: pale wordmark for a dark surface) | 'light' (navy wordmark
     * for parchment, sails, white hulls).
     */
    sailDecal(mesh, opts = {}) {
      need3D('sailDecal');
      const { size = 1, offset = [0, 0, 0], normal = [0, 0, 1], kind = 'logo', opacity = 1, bothSides = false, lift = 0.01, theme = 'dark' } = opts;
      const t = kind === 'mark' ? markTexture('color') : logoTexture(null, 2048, 512, theme === 'light' ? 'dark' : 'light');
      const mat = new THREE.MeshStandardMaterial({
        map: t.tex, transparent: true, opacity, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, depthWrite: false,
      });
      const geo = new THREE.PlaneGeometry(size * t.aspect, size);
      const g = new THREE.Group();
      g.add(new THREE.Mesh(geo, mat));
      if (bothSides) {
        const back = new THREE.Mesh(geo, mat);
        back.position.z = -2 * lift;
        back.rotation.y = Math.PI;
        g.add(back);
      }
      g.position.set(...v3(offset));
      g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...v3(normal)).normalize());
      if (opts.spin) g.rotateZ(opts.spin);
      g.name = 'brand:sailDecal';
      mesh.add(g);
      register('sailDecal', { obj: g });
      return g;
    },
    /** hanging lightbox shop sign with a blue rim (origin = sign centre) */
    shopSign(opts = {}) {
      need3D('shopSign');
      const { width = 2.4, text = WORDMARK, sub = 'Game Studio' } = opts;
      const { tex, aspect } = shopTexture(text, sub);
      const h = width / aspect;
      const g = new THREE.Group();
      const face = panelMat(tex, 0.9);
      const board = new THREE.Mesh(new THREE.BoxGeometry(width, h, 0.14),
        [mats().metal, mats().metal, mats().metal, mats().metal, face, face]);
      const rim = new THREE.Mesh(new THREE.BoxGeometry(width + 0.08, h + 0.08, 0.1), lit(COLORS.ear, 2));
      const bar = new THREE.Mesh(new THREE.BoxGeometry(width + 0.5, 0.07, 0.07), mats().metal);
      bar.position.set(-0.1, h / 2 + 0.38, 0);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.3), mats().metal);
      plate.position.set(-(width / 2 + 0.35), h / 2 + 0.3, 0);
      g.add(board, rim, bar, plate);
      for (const sx of [-1, 1]) {
        const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.36, 6), mats().steel);
        chain.position.set(sx * width * 0.38, h / 2 + 0.2, 0);
        g.add(chain);
      }
      let t = Math.random() * 3;
      return place('shopSign', g, opts, (dt) => { t += dt; board.rotation.x = rim.rotation.x = Math.sin(t * 1.3) * 0.02; });
    },

    /**
     * vertical cloth banner on a lamp post (origin = post base), gently swaying.
     * pole: false hangs the cloth alone (a wall banner); its origin is then the cloth's
     * BOTTOM edge (anchor 'base', the default), or anchor: 'center' / 'top'.
     */
    banner(opts = {}) {
      need3D('banner');
      const { width = 1.2, height = width * 3, pole = true, anchor = 'base' } = opts;
      const { tex } = bannerTexture();
      const g = new THREE.Group();
      const poleH = height + 2.6;
      const top = pole ? poleH - 0.35 : anchor === 'center' ? height / 2 : anchor === 'top' ? 0 : height;
      const pivot = new THREE.Group();
      pivot.position.set(pole ? width / 2 + 0.18 : 0, top, 0);
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 2, 8), new THREE.MeshStandardMaterial({
        map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85,
        emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.3,
      }));
      cloth.position.y = -height / 2;
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, width + 0.2, 8), mats().steel);
      rod.rotation.z = Math.PI / 2;
      pivot.add(cloth, rod);
      g.add(pivot);
      if (pole) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, poleH, 12), mats().metal);
        post.position.y = poleH / 2;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(width + 0.4, 0.05, 0.05), mats().metal);
        arm.position.set(width / 2 + 0.18, top + 0.06, 0);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 10), lit(0xfff1d6, 2.2));
        lamp.position.y = poleH + 0.1;
        g.add(post, arm, lamp);
      }
      let t = Math.random() * 4;
      return place('banner', g, opts, (dt) => {
        t += dt;
        pivot.rotation.x = Math.sin(t * 1.15) * 0.05;
        pivot.rotation.y = Math.sin(t * 0.7) * 0.06;
      });
    },

    /** projector base, light cone, spinning holographic mark and a text ring */
    hologram(opts = {}) {
      need3D('hologram');
      const { size = 3, color = '#5FD4FF' } = opts;
      const g = new THREE.Group();
      const add = (m) => (g.add(m), m);
      const base = add(new THREE.Mesh(new THREE.CylinderGeometry(size * 0.42, size * 0.52, size * 0.16, 40), mats().metal));
      base.position.y = size * 0.08;
      const ring = add(new THREE.Mesh(new THREE.TorusGeometry(size * 0.4, size * 0.022, 8, 64), lit(color, 3)));
      ring.rotation.x = Math.PI / 2; ring.position.y = size * 0.165;
      const additive = (map, opacity, repeat) => {
        const m = new THREE.MeshBasicMaterial({
          map, color, transparent: true, opacity, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
          depthWrite: false, toneMapped: false,
        });
        if (repeat) { m.map = map.clone(); m.map.repeat.set(repeat, 1); m.map.needsUpdate = true; }
        return m;
      };
      const beam = add(new THREE.Mesh(new THREE.CylinderGeometry(size * 0.6, size * 0.38, size * 1.5, 40, 1, true), additive(beamTexture(), 0.35)));
      beam.position.y = size * 0.17 + size * 0.75;
      const mark = add(new THREE.Mesh(new THREE.PlaneGeometry(size * 0.95, size * 0.95), additive(markTexture('holo', color).tex, 0.95)));
      mark.position.y = size * 1.05;
      const text = add(new THREE.Mesh(new THREE.CylinderGeometry(size * 0.66, size * 0.66, size * 0.15, 64, 1, true), additive(ringTexture(color).tex, 0.9, 2)));
      text.position.y = size * 0.42;
      let t = Math.random() * 6;
      return place('hologram', g, opts, (dt) => {
        t += dt;
        mark.rotation.y += dt * 0.9;
        mark.position.y = size * 1.05 + Math.sin(t * 1.6) * size * 0.04;
        text.rotation.y -= dt * 0.45;
        const glitch = Math.random() < 0.03 ? 0.45 : 1;
        mark.material.opacity = 0.95 * glitch;
        beam.material.opacity = 0.3 + Math.sin(t * 3) * 0.05;
      });
    },

    /** start/finish arch across a track (origin = ground centre) */
    trackArch(opts = {}) {
      need3D('trackArch');
      const { width = 14, height = 6, depth = 1.2, color = COLORS.ear } = opts;
      const g = new THREE.Group();
      const pw = 1.1, beamH = 1.6;
      for (const sx of [-1, 1]) {
        const pillar = new THREE.Mesh(new THREE.BoxGeometry(pw, height + beamH, depth), mats().metal);
        pillar.position.set(sx * (width / 2 + pw / 2), (height + beamH) / 2, 0);
        g.add(pillar);
        for (const sz of [-1, 1]) {
          const strip = new THREE.Mesh(new THREE.BoxGeometry(0.08, height, 0.08), lit(color, 2.6));
          strip.position.set(sx * (width / 2 + 0.02), height / 2, sz * (depth / 2 - 0.06));
          g.add(strip);
        }
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(width + pw * 2, beamH, depth), mats().metal);
      beam.position.y = height + beamH / 2;
      g.add(beam);
      const pwid = width + pw * 1.6, phei = beamH * 0.86;
      const { tex } = archTexture(pwid / phei);
      for (const side of [1, -1]) {
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(pwid, phei), panelMat(tex, 0.55));
        panel.position.set(0, height + beamH / 2, side * (depth / 2 + 0.01));
        if (side < 0) panel.rotation.y = Math.PI;
        g.add(panel);
      }
      const under = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, 0.08), lit(color, 2.6));
      under.position.y = height + 0.02;
      g.add(under);
      // chase lights along the top
      const bulbs = [];
      const n = 14;
      for (let i = 0; i < n; i++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), lit(COLORS.goldLight, 1));
        b.position.set(-width / 2 + (i + 0.5) * (width / n), height + beamH + 0.12, 0);
        g.add(b); bulbs.push(b);
      }
      let t = 0;
      return place('trackArch', g, opts, (dt) => {
        t += dt;
        const head = (t * 10) % n;
        bulbs.forEach((b, i) => {
          const d = Math.min(Math.abs(i - head), n - Math.abs(i - head));
          b.material.emissiveIntensity = 0.4 + Math.max(0, 3 - d) * 1.2;
        });
      });
    },

    // ---------------------------------------------------------------- 2D / pixel helpers
    /** framed pixel sign: 16x16 mark + "BRAINDAEMON" (rect in screen px, top-left) */
    pixelSign(opts = {}) {
      const { x = 0, y = 0, scale = 2, text = 'BRAINDAEMON', mark = true } = opts;
      const ctx = opts.ctx || ctx2d;
      const pad = 3, gap = mark ? 4 : 0;
      const lw = pad * 2 + (mark ? PIXEL_MARK_SIZE : 0) + gap + pixelTextWidth(text);
      const lh = PIXEL_MARK_SIZE + pad * 2;
      const split = text.toUpperCase() === 'BRAINDAEMON' ? 5 : Infinity;
      const paint = (g, ox, oy, s) => {
        g.fillStyle = COLORS.tile; g.fillRect(ox, oy, lw * s, lh * s);
        g.fillStyle = COLORS.ear;
        g.fillRect(ox, oy, lw * s, s); g.fillRect(ox, oy + (lh - 1) * s, lw * s, s);
        g.fillRect(ox, oy, s, lh * s); g.fillRect(ox + (lw - 1) * s, oy, s, lh * s);
        g.fillStyle = '#1C2A50'; g.fillRect(ox + s, oy + s, (lw - 2) * s, s);
        g.fillStyle = COLORS.goldLight;
        for (const [cx, cy] of [[1, 1], [lw - 2, 1], [1, lh - 2], [lw - 2, lh - 2]]) g.fillRect(ox + cx * s, oy + cy * s, s, s);
        if (mark) drawPixelMark(g, ox + pad * s, oy + pad * s, s);
        drawPixelText(g, text, ox + (pad + (mark ? PIXEL_MARK_SIZE + gap : 0)) * s, oy + (pad + 5) * s, s, COLORS.hi, COLORS.light, split);
      };
      return add2d('pixelSign', ctx, { x, y, w: lw * scale, h: lh * scale }, lw, lh, scale, paint);
    },

    /** wide pixel banner with bunting: mark + "BRAINDAEMON" centred */
    pixelBanner(opts = {}) {
      const { x = 0, y = 0, w = 200, scale = 2, text = 'BRAINDAEMON' } = opts;
      const ctx = opts.ctx || ctx2d;
      const minW = PIXEL_MARK_SIZE + 4 + pixelTextWidth(text) + 12;
      const lw = Math.max(minW, Math.floor(w / scale));
      const lh = 23;
      const split = text.toUpperCase() === 'BRAINDAEMON' ? 5 : Infinity;
      const paint = (g, ox, oy, s) => {
        const R = (cx, cy, cw, ch, col) => { g.fillStyle = col; g.fillRect(ox + cx * s, oy + cy * s, cw * s, ch * s); };
        R(0, 0, lw, 18, COLORS.blue);
        R(0, 0, lw, 1, COLORS.light);
        R(0, 16, lw, 2, COLORS.ring);
        R(0, 0, 1, 18, COLORS.tile); R(lw - 1, 0, 1, 18, COLORS.tile);
        // bunting triangles under the cloth
        const cols = [COLORS.goldLight, COLORS.hi, COLORS.ear];
        for (let i = 0, k = 0; i + 5 <= lw; i += 7, k++) {
          const c = cols[k % cols.length];
          R(i + 1, 18, 5, 1, c); R(i + 2, 19, 3, 1, c); R(i + 2, 20, 3, 1, c); R(i + 3, 21, 1, 2, c);
        }
        const cw = PIXEL_MARK_SIZE + 4 + pixelTextWidth(text);
        const cx = Math.floor((lw - cw) / 2);
        drawPixelMark(g, ox + cx * s, oy + 1 * s, s);
        drawPixelText(g, text, ox + (cx + PIXEL_MARK_SIZE + 4) * s, oy + 5 * s, s, COLORS.hi, COLORS.tile, split);
      };
      return add2d('pixelBanner', ctx, { x, y, w: lw * scale, h: lh * scale }, lw, lh, scale, paint);
    },

    /** draw every 2D placement (call each frame after clearing, under your world transform) */
    draw2d(ctx = ctx2d) { for (const it of items) if (it.draw) it.draw(ctx); },

    // ---------------------------------------------------------------- screens
    /** "Made with BrainDaemon" splash. Resolves when it is gone (tap skips). */
    introCard({ duration = 1900 } = {}) {
      if (!hasDom) return Promise.resolve();
      injectCardCss();
      return new Promise((resolve) => {
        const el = document.createElement('div');
        el.className = 'gk-brand-intro';
        el.dir = L === 'ar' ? 'rtl' : 'ltr';
        el.innerHTML = `<img alt="" src="${assets}core-mark-256.png"><div class="gk-bi-made"></div><div class="gk-bi-word"><b>Brain</b><span>Daemon</span></div>`;
        el.querySelector('.gk-bi-made').textContent = tr(L, 'madeWith');
        let done = false;
        const finish = () => {
          if (done) return; done = true;
          el.classList.add('gk-out');
          setTimeout(() => { el.remove(); resolve(); }, 380);
        };
        el.addEventListener('pointerdown', finish);
        document.body.appendChild(el);
        setTimeout(finish, duration);
      });
    },

    /** "Make your own game" card for game over / win screens */
    endCard({ onMakeOwn, link = url } = {}) {
      if (!hasDom) return { el: null, hide() {} };
      injectCardCss();
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'gk-brand-end';
      el.dir = L === 'ar' ? 'rtl' : 'ltr';
      el.innerHTML = `<img alt="" src="${assets}core-mark-256.png"><span class="gk-be-txt"><small></small><b></b><em></em></span><span class="gk-be-go">→</span>`;
      el.querySelector('small').textContent = `${tr(L, 'madeWith')} BrainDaemon`;
      el.querySelector('b').textContent = tr(L, 'makeOwn');
      el.querySelector('em').textContent = tr(L, 'makeOwnSub');
      if (L === 'ar') el.querySelector('.gk-be-go').textContent = '←';
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onMakeOwn) return onMakeOwn(link);
        const tg = globalThis.Telegram?.WebApp;
        if (tg?.openLink) tg.openLink(link); else globalThis.open?.(link, '_blank', 'noopener');
      });
      document.body.appendChild(el);
      requestAnimationFrame(() => el.classList.add('gk-on'));
      return { el, hide() { el.classList.remove('gk-on'); setTimeout(() => el.remove(), 300); } };
    },

    // ---------------------------------------------------------------- registry
    count() { return items.length; },
    list() { return items.map((i) => i.kind); },
    /** animate placements (wave, flicker, orbit). Call once per frame with seconds. */
    update(dt) { time += dt; for (const it of items) if (it.update) it.update(dt, time); },
    /**
     * true when at least one placement is in view: 3D items are frustum-checked
     * against the camera; 2D items are checked against the view rect.
     */
    visibleAtStart(cam = camera) {
      if (cam && cam.isCamera && THREE) {
        cam.updateMatrixWorld();
        const m = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        const fr = new THREE.Frustum().setFromProjectionMatrix(m);
        const box = new THREE.Box3();
        for (const it of items) {
          if (!it.obj || !shown(it.obj)) continue;
          it.obj.updateWorldMatrix(true, true);
          box.setFromObject(it.obj);
          if (!box.isEmpty() && fr.intersectsBox(box)) return true;
        }
      }
      const vr = (cam && !cam.isCamera && cam.w != null) ? cam : viewRect();
      if (vr) for (const it of items) if (it.rect && overlaps(it.rect, vr)) return true;
      return false;
    },
  };

  function viewRect() {
    if (view) return view;
    const c = ctx2d && ctx2d.canvas;
    return c ? { x: 0, y: 0, w: c.width, h: c.height } : null;
  }

  // 2D placement: cached to an offscreen canvas in the browser (one drawImage per
  // frame), painted pixel by pixel when there is no DOM (tests).
  function add2d(kind, ctx, rect, lw, lh, scale, paint) {
    let cache = null;
    if (hasDom) {
      cache = document.createElement('canvas');
      cache.width = lw; cache.height = lh;
      paint(cache.getContext('2d'), 0, 0, 1);
    }
    const it = register(kind, {
      rect,
      draw(g = ctx) {
        if (!g) return;
        if (cache) {
          const prev = g.imageSmoothingEnabled;
          g.imageSmoothingEnabled = false;
          g.drawImage(cache, rect.x, rect.y, rect.w, rect.h);
          g.imageSmoothingEnabled = prev;
        } else paint(g, rect.x, rect.y, scale);
      },
    });
    if (ctx) it.draw(ctx);
    return it;
  }

  return api;
}

function shown(o) {
  for (let p = o; p; p = p.parent) if (p.visible === false) return false;
  return true;
}
function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

const CARD_CSS = `
.gk-brand-intro{position:fixed;inset:0;z-index:60;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
  background:radial-gradient(90% 70% at 50% 45%,#16224A 0,#0B1020 55%,#05070D 100%);color:#EAF2FF;
  font-family:${FONT};transition:opacity .38s ease;-webkit-user-select:none;user-select:none}
.gk-brand-intro.gk-out{opacity:0}
.gk-brand-intro img{width:min(30vw,132px);height:auto;filter:drop-shadow(0 0 28px rgba(76,134,255,.65));animation:gkPop .7s cubic-bezier(.2,1.4,.4,1) both}
.gk-bi-made{font-size:13px;letter-spacing:.24em;text-transform:uppercase;opacity:.7;margin-top:10px;animation:gkUp .5s .25s both}
.gk-bi-word{font-size:clamp(30px,8vw,46px);font-weight:800;letter-spacing:-.01em;animation:gkUp .5s .35s both}
.gk-bi-word span{color:#86B4FF}
@keyframes gkPop{from{transform:scale(.55);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes gkUp{from{transform:translateY(10px);opacity:0}to{transform:none;opacity:1}}
.gk-brand-end{position:fixed;z-index:45;left:50%;bottom:calc(18px + env(safe-area-inset-bottom));transform:translate(-50%,24px);opacity:0;
  display:flex;align-items:center;gap:12px;width:min(380px,calc(100vw - 32px));box-sizing:border-box;padding:10px 14px 10px 10px;padding-inline:10px 14px;border-radius:20px;cursor:pointer;
  border:1px solid rgba(134,180,255,.4);background:linear-gradient(180deg,rgba(26,42,94,.88),rgba(11,16,32,.92));color:#EAF2FF;
  box-shadow:0 14px 40px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.04) inset;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
  font-family:${FONT};text-align:start;transition:transform .35s cubic-bezier(.2,1.2,.4,1),opacity .3s}
.gk-brand-end.gk-on{transform:translate(-50%,0);opacity:1}
.gk-brand-end:active{transform:translate(-50%,0) scale(.97)}
.gk-brand-end img{width:46px;height:46px;flex:none;filter:drop-shadow(0 0 10px rgba(76,134,255,.5))}
.gk-be-txt{flex:1;display:flex;flex-direction:column;gap:2px;line-height:1.25;min-width:0}
.gk-be-txt small{font-size:11px;opacity:.65;letter-spacing:.04em}
.gk-be-txt b{font-size:16px;font-weight:800}
.gk-be-txt em{font-style:normal;font-size:12px;color:#86B4FF}
.gk-be-go{flex:none;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:linear-gradient(180deg,#4C86FF,#2A63EE);font-weight:800}
`;
function injectCardCss() {
  if (document.getElementById('gk-brand-css')) return;
  const s = document.createElement('style');
  s.id = 'gk-brand-css';
  s.textContent = CARD_CSS;
  document.head.appendChild(s);
}
