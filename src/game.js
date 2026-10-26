// Prontera slice — walk, talk, Porings. Pure rules; movement is Kit createTopDown.

import { createTopDown, neutralIntent, overlap, createRng } from 'kit';

export function createLevel(data, world, spawn) {
  const T = data.tile;
  const mid = (tx, ty, w, h) => ({ x: tx * T + (T - w) / 2, y: ty * T + (T - h) / 2 });
  const npcs = (data.npcs || []).map((n) => ({
    ...n,
    ...mid(n.tx, n.ty, 12, 12),
    w: 12,
    h: 12,
  }));
  const mobs = (data.mobSpawns || []).map((m) => ({
    kind: m.kind || 'poring',
    ...mid(m.tx, m.ty, data.mob.w, data.mob.h),
  }));
  return {
    world,
    T,
    start: mid(spawn.tx, spawn.ty, data.hero.w, data.hero.h),
    npcs,
    mobSpawns: mobs,
    spawn,
  };
}

const centre = (s) => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });

export function createRun(data, level) {
  const T = level.T;
  const world = level.world;
  const rng = createRng(`${data.seed}:mobs`);
  const hero = createTopDown({ world, ...data.hero, ...level.start, dash: false });
  const mobs = level.mobSpawns.map((m) => ({
    kind: m.kind,
    ctrl: createTopDown({ world, ...data.mob, x: m.x, y: m.y }),
    dir: { x: 0, y: 0 },
    t: rng.range(0.5, 2),
  }));
  const run = {
    level,
    hero,
    mobs,
    talk: null,
    talkT: 0,
    result: null,
  };

  run.npcNear = () => {
    const c = centre(hero.state);
    let best = null;
    let bd = data.rules.useReach;
    for (const n of level.npcs) {
      const d = Math.hypot(n.x + 6 - c.x, n.y + 6 - c.y);
      if (d < bd && (!best || d < best.d)) best = { npc: n, d };
    }
    return best?.npc ?? null;
  };

  function mobIntent(m, dt) {
    m.t -= dt;
    if (m.t <= 0 || m.ctrl.events.some((e) => e.type === 'bumped')) {
      const a = rng.next() * Math.PI * 2;
      m.dir = rng.next() > 0.25 ? { x: Math.cos(a) * data.mob.wander, y: Math.sin(a) * data.mob.wander } : { x: 0, y: 0 };
      m.t = rng.range(1.2, 3.5);
    }
    return neutralIntent({ moveX: m.dir.x, moveY: m.dir.y });
  }

  run.step = (intent, dt) => {
    const out = [];
    if (run.result) return out;
    run.talkT = Math.max(0, run.talkT - dt);
    if (run.talkT <= 0) run.talk = null;

    hero.step(intent, dt);
    if (intent.action) {
      const n = run.npcNear();
      if (n) {
        run.talk = n;
        run.talkT = data.rules.talkDuration;
        out.push({ type: 'talk', id: n.id });
      } else {
        out.push({ type: 'nothing' });
      }
    }
    for (const m of mobs) m.ctrl.step(mobIntent(m, dt), dt);
    return out;
  };

  run.score = () => Math.floor(Math.hypot(hero.state.x - level.start.x, hero.state.y - level.start.y) / T);
  return run;
}

/** Simple bot: wander and occasionally talk if near NPC */
export function botIntent(run) {
  const h = run.hero.state;
  const n = run.npcNear();
  if (n && Math.random() < 0.02) return neutralIntent({ action: true });
  const a = Math.random() * Math.PI * 2;
  return neutralIntent({ moveX: Math.cos(a), moveY: Math.sin(a) });
}
