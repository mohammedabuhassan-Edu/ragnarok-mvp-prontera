import {
  game, installSelfTest, createLoop, createInput, createQuality, createAudio, createShell, createBrand, detectLang,
  layoutFor, bindController, intentFromInput2d, neutralIntent, createCamera2d, createTopDown, canvasLook as look,
  fitCanvas, loadSheetSafe, drawFrame, loadJsonSafe, createRng,
} from 'kit';
import { createLevel, createRun, botIntent } from './game.js';
import { loadGatSlice } from './gat-world.js';
import { loadRoSprites } from './ro-sprites.js';
import DEFAULTS from './defaults.js';

// window.__game (Kit): verify reads state.phase "play", canLose, hazards, fps.
// Keyboard: KeyW KeyA KeyS KeyD ArrowLeft Space (Kit createInput).

const checks = [];
installSelfTest({ checks, autoRun: false, delay: 1200 });

const data = await loadJsonSafe('./data/game.json', DEFAULTS);
const LANG = detectLang();
const TXT = { ...data.text.en, ...(data.text[LANG] || {}) };
const stress = new URLSearchParams(location.search).has('stress');

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const quality = createQuality(null, { target: 50 });
const PAL = 'ro-town';
const grass = look.tilePainter('stone', { size: 32, palette: PAL, seed: 3 });
const cobble = look.tilePainter('brick', { size: 32, palette: PAL, seed: 9 });

let mapData = null;
let run = null;
let link = null;
let cam = null;
let k = 1;
let roSprites = {};
let fallbackSheet = null;
const CH = { sheet: './assets/characters/pixel-crew', scale: 0.45, hero: ['human-0', 'human-1'], foes: { p: ['critter-0', 'critter-1'] } };

async function bootMap() {
  try {
    mapData = await loadGatSlice(data.assetBase, data.mapName, { tileSize: data.tile, ...data.mapSlice });
    if (stress) {
      const rng = createRng('stress-mobs');
      const w = mapData.world;
      for (let i = 0; i < (data.stressMobs || 6); i++) {
        const tx = rng.range(40, w.cols - 40) | 0;
        const ty = rng.range(40, w.rows - 40) | 0;
        if (!w.solidAt(tx, ty)) data.mobSpawns.push({ tx, ty });
      }
      mapData.spawn.tx = 48;
      mapData.spawn.ty = 50;
    }
    const level = createLevel(data, mapData.world, mapData.spawn);
    run = createRun(data, level);
    link = bindController(run.hero);
    const W0 = level.world;
    cam = createCamera2d({
      ...data.camera,
      view: { w: 200, h: 120 },
      bounds: { x: 0, y: 0, w: W0.width, h: W0.height },
      pixelSnap: true,
    });
    cam.jumpTo(run.hero.center());
    brand = createBrand({ ctx2d: ctx, view: cam.state, lang: LANG });
    game.brand = brand;
    for (const b of data.brand || []) {
      if (b.kind === 'banner') brand.pixelBanner({ x: b.x, y: b.y, w: b.w, scale: data.view.texel });
      else brand.pixelSign({ x: b.x, y: b.y, scale: data.view.texel });
    }
    resize();
    roSprites = await loadRoSprites(data.assetBase, data.sprites);
    fallbackSheet = await loadSheetSafe(CH.sheet, { names: [...CH.hero, ...CH.foes.p], size: [24, 24], color: '#8fbc8f' });
    return true;
  } catch (e) {
    console.warn('map load', e);
    return false;
  }
}

function resize() {
  if (!cam) return;
  const v = fitCanvas(canvas, quality.dpr, data.view.min, data.view.texel);
  k = v.k;
  cam.setView(v.w, v.h);
}
addEventListener('resize', resize);
quality.onChange(resize);

let brand = null;

const audio = createAudio();
game.audio = audio;
let music = null;
const input = createInput(canvas, layoutFor('topdown'));
let endCard = null;

const shell = createShell({
  title: TXT.title,
  subtitle: TXT.subtitle,
  lang: LANG,
  hint: { touch: TXT.touchHint, keys: TXT.keysHint },
  onStart: () => startRun(),
  onRetry: () => startRun(),
  onPause: (p) => {
    if (p && S.phase === 'play') S.phase = 'paused';
    else if (!p && S.phase === 'paused') S.phase = 'play';
    loop.pause(p);
    input.setActive(!p && S.phase === 'play');
    audio.sfx('click');
  },
  onSound: (on) => audio.mute(!on),
});

const S = game.state;
S.phase = 'loading';
const bot = { on: false };
const fx = { animT: 0 };

function startRun() {
  if (!run) return;
  shell.hideTitle();
  link.unbind();
  link = bindController(run.hero);
  const level = createLevel(data, mapData.world, mapData.spawn);
  run = createRun(data, level);
  link = bindController(run.hero);
  cam.jumpTo(run.hero.center());
  game.score = 0;
  S.phase = 'play';
  input.setActive(true);
  audio.unlock();
  if (!music) music = audio.music(data.music);
  loop.pause(false);
}

function update(dt) {
  const playing = S.phase === 'play';
  if (!playing || !run) return;
  const intent = bot.on ? botIntent(run) : intentFromInput2d(input);
  const evs = run.step(intent, dt);
  if (intent.dash) link.act('dash');
  if (intent.action) {
    const n = run.npcNear();
    link.act(n ? 'use:talk' : 'use:none');
  }
  for (const e of evs) {
    if (e.type === 'talk') {
      audio.sfx('powerup');
      const line = e.id && run.talk?.lines?.[LANG] || run.talk?.lines?.en || '';
      shell.toast(line, 3200);
    } else if (e.type === 'nothing') audio.sfx('click');
  }
  for (const e of run.hero.events) {
    if (e.type === 'dashed') { audio.sfx('boost'); cam.shake(0.12); }
  }
  const s = run.hero.state;
  cam.follow({ x: s.x + s.w / 2, y: s.y + s.h / 2, vx: s.vx, facing: s.facing.x }, dt);
  game.score = run.score();
  game.hazards = run.mobs.length;
  game.drawCalls = 40 + run.mobs.length * 2;
  fx.animT += dt;
}

function drawRo(ctx, key, x, y, flip) {
  const sp = roSprites[key];
  if (sp) sp.draw(ctx, x, y, { flip, scale: 0.55, feetY: true });
  else drawFrame(ctx, fallbackSheet, CH.hero[0], x, y, { scale: CH.scale, flip });
}

function render(alpha, frameDt) {
  quality.sample(frameDt);
  game.fps = Math.round(quality.fps);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0f2818';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (S.phase === 'loading') {
    look.hudText(ctx, TXT.loading, canvas.width / (2 * quality.dpr), canvas.height / (2 * quality.dpr), { size: 14, color: '#c9e4b8' });
    return;
  }
  if (!run || !cam) return;

  const dt = Math.min(frameDt, 0.1);
  const T = data.tile;
  const world = run.level.world;
  const v = cam.apply(ctx, k);
  ctx.imageSmoothingEnabled = false;

  const c0 = Math.max(0, Math.floor(v.x / T));
  const c1 = Math.min(world.cols - 1, Math.ceil((v.x + v.w) / T));
  const r0 = Math.max(0, Math.floor(v.y / T));
  const r1 = Math.min(world.rows - 1, Math.ceil((v.y + v.h) / T));
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const solid = world.solidAt(c, r);
      const x = c * T;
      const y = r * T;
      if (solid) cobble.draw(ctx, x, y, cobble.variantAt(c, r), T / 32);
      else grass.draw(ctx, x, y, grass.variantAt(c, r), T / 32);
    }
  }

  brand?.draw2d(ctx);

  const shadow = (x, y, w) => {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(x, y, w, 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
  };

  const actors = [];
  for (const m of run.mobs) actors.push({ kind: 'mob', s: m.ctrl.state, flip: m.ctrl.state.vx < 0 });
  for (const n of run.level.npcs) actors.push({ kind: 'npc', s: { x: n.x, y: n.y, w: n.w, h: n.h, vx: 0 }, sprite: n.sprite, flip: false });
  actors.push({ kind: 'hero', s: run.hero.state, flip: run.hero.state.facing.x < 0 });
  actors.sort((a, b) => a.s.y - b.s.y);

  for (const a of actors) {
    const s = a.s;
    const cx = s.x + s.w / 2;
    const feet = s.y + s.h;
    if (!cam.sees(s, 20)) continue;
    shadow(cx, feet, a.kind === 'hero' ? 5 : 4);
    const moving = Math.hypot(s.vx, s.vy) > 8;
    if (a.kind === 'hero') {
      drawRo(ctx, moving ? 'heroWalk' : 'heroIdle', cx, feet, a.flip);
    } else if (a.kind === 'mob') {
      drawRo(ctx, 'poring', cx, feet, a.flip);
    } else {
      drawRo(ctx, a.sprite, cx, feet, a.flip);
    }
    if (a.kind === 'npc' && run.npcNear()?.id === run.level.npcs.find((n) => n.sprite === a.sprite)?.id) {
      look.hudText(ctx, '?', cx, s.y - 6, { size: 8, color: '#ffd966' });
    }
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawHud();
}

function drawHud() {
  if (S.phase !== 'play') return;
  const u = quality.dpr * Math.min(1, innerWidth / 420 + 0.15);
  const p = look.hudPanel(ctx, { x: 12 * u, y: 12 * u, w: 200 * u, h: 36 * u }, { palette: PAL, radius: 12 * u, pad: 8 * u });
  look.hudText(ctx, `Prontera · ${game.score}m`, p.x, p.y + p.h / 2, { size: 13 * u, palette: PAL });
  if (run?.talk && run.talkT > 0) {
    const line = run.talk.lines[LANG] || run.talk.lines.en;
    look.hudText(ctx, line, canvas.width / (2 * quality.dpr), canvas.height - 28 * u, { size: 12 * u, color: '#ffd966', align: 'center' });
  }
}

const loop = createLoop({ update, render });
loop.start();
input.setActive(false);

const ok = await bootMap();
if (ok) {
  S.phase = 'title';
  shell.showTitle();
  brand.introCard();
} else {
  S.phase = 'title';
  shell.showTitle({ subtitle: TXT.loadFail });
}

checks.push(
  { name: 'map-loaded', run: () => !!mapData && mapData.rows.length === data.mapSlice.height },
  { name: 'hero-moves', run: () => { const r = createRun(data, createLevel(data, mapData.world, mapData.spawn)); const x0 = r.hero.state.x; for (let i = 0; i < 20; i++) r.step(neutralIntent({ moveX: 1 }), 1 / 60); return r.hero.state.x > x0; } },
  { name: 'text-4-languages', run: () => ['ar', 'ru', 'zh'].every((l) => typeof data.text[l]?.title === 'string') },
);

Object.assign(game, {
  canLose: false,
  start: () => { if (S.phase !== 'play' && run) startRun(); },
  autoplay: (on) => { bot.on = !!on; },
  progress: () => (game.score || 0) + (S.phase === 'play' ? Math.floor(loop.t) : 0),
});
game.ready();
