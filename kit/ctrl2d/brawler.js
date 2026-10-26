// brawler.js — a beat-'em-up on a depth plane. Pure logic: no DOM.
//
// Every fighter lives at (x, y, z): x along the street, y the DEPTH lane
// (bounds.minY far .. bounds.maxY near; screen-down = nearer), z the jump
// height (>= 0). Draw a fighter at screen (x, groundY + y - z), sorted by y.
//
// Damage ONLY comes from a hit: an attack's active hitbox overlapping a
// target's hurtbox, a grab knee or a throw landing. There is no contact or
// idle damage anywhere.
//
//   const fight = createBrawler({ bounds: { minX: 0, maxX: 900, minY: 0, maxY: 56 }, player: { x: 80, y: 30 } });
//   fight.addEnemy({ x: 260, y: 20 });
//   createInput(canvas, inputOptions('brawler'));        // attack / jump / special / grab buttons
//   function update(dt) {
//     fight.step(intentFromInput(input), dt);
//     for (const e of fight.events) if (e.type === 'hit') { spawnSpark(e.x, e.y, e.z); camera.shake(0.25); }
//     const p = fight.player;
//     game.state.player = { x: p.x, y: p.y, z: p.z, facing: p.facing, hp: p.hp };
//   }
//   game.lastAction = fight.lastAction;
//
// Fighter: { id, team, x, y, z, vx, vy, vz, facing, hp, maxHp, state, move, combo, invuln, data }
//   state: idle | walk | jump | attack | hitstun | knockdown | down | grabbing | grabbed | thrown | throwing | dead
// events: attack {id, move}, hit {attacker, target, move, damage, x, y, z, knockdown, killed, combo, hitstop},
//         whiff {id, move}, jumped, landed, grabbed, released, thrown, ko, getup, token {id, got}
//
// Moves are data: { startup, active, recovery, damage, hitstun, knockback,
//   hitbox: { x: forward offset, w, z: height of the box bottom, h, d: depth half-thickness },
//   knockdown?, lunge? (forward speed during startup+active), next? (chain), chainWindow? }.
// Light attacks chain light1 > light2 > light3 when pressed again during a
// move or within its chainWindow afterwards; special is the heavy.
// Enemies must hold an attack TOKEN to start an attack: at most
// maxAttackers enemies attack at once.

import { createRng } from '../loop.js';
import { approach, clamp, createEvents, readIntent, sign, withDefaults } from './common.js';

export const PLAYER_MOVES = {
  light1: { startup: 0.05, active: 0.07, recovery: 0.12, damage: 4, hitstun: 0.3, knockback: 30, hitbox: { x: 8, w: 22, z: 24, h: 14, d: 9 }, next: 'light2', chainWindow: 0.3 },
  light2: { startup: 0.05, active: 0.07, recovery: 0.14, damage: 5, hitstun: 0.3, knockback: 35, hitbox: { x: 8, w: 22, z: 24, h: 14, d: 9 }, next: 'light3', chainWindow: 0.3 },
  light3: { startup: 0.08, active: 0.08, recovery: 0.28, damage: 9, hitstun: 0.45, knockback: 170, knockdown: true, lunge: 60, hitbox: { x: 8, w: 26, z: 18, h: 20, d: 10 } },
  heavy: { startup: 0.16, active: 0.09, recovery: 0.32, damage: 12, hitstun: 0.5, knockback: 200, knockdown: true, lunge: 80, hitbox: { x: 6, w: 30, z: 10, h: 26, d: 10 } },
  jumpAttack: { startup: 0.04, active: 0.3, recovery: 0, damage: 8, hitstun: 0.4, knockback: 120, knockdown: true, hitbox: { x: 4, w: 24, z: 4, h: 24, d: 10 } },
  knee: { damage: 5 },
};

export const ENEMY_MOVES = {
  jab: { startup: 0.3, active: 0.08, recovery: 0.45, damage: 6, hitstun: 0.3, knockback: 50, hitbox: { x: 6, w: 20, z: 24, h: 14, d: 8 } },
};

export const BRAWLER_DEFAULTS = {
  bounds: { minX: 0, maxX: 640, minY: 0, maxY: 60 },
  player: { x: 60, y: 30 },
  walkSpeed: 95,           // px/s along x
  depthSpeed: 60,          // px/s along the depth lane
  accel: 2400,             // full walk speed in 40 ms (a stick nudge ~ a key tap)
  friction: 2400,          // a released stick stops in ~2 px
  airControl: 0.4,
  gravity: 1500,
  jumpSpeed: 430,
  body: { w: 22, d: 7, h: 46 },   // hurtbox: width, depth half-thickness, height
  hp: 100,
  invulnOnHit: 0.4,        // player i-frames after taking a hit
  getupInvuln: 1.0,        // i-frames after getting up
  downTime: 0.7,
  launch: 240,             // vz of a knockdown
  hitstop: 0.05,           // attacker and target freeze this long on a hit (0 = off)
  comboWindow: 1.0,        // hits closer than this count as one combo
  grab: { rangeX: 28, rangeY: 10, hold: 1.6, hits: 3, dist: 18 },
  throw: { damage: 14, vx: 240, vz: 260, hitsOthers: true, otherDamage: 8, recovery: 0.25 },
  moves: PLAYER_MOVES,
  enemy: { hp: 40, walkSpeed: 60, depthSpeed: 40, moves: ENEMY_MOVES, attackRange: 30, waitRange: 72, cooldown: [0.7, 1.5], tokenTimeout: 3, invulnOnHit: 0 },
  maxAttackers: 2,         // the attack-token limit
  separation: 24,          // px between enemies on the same lane
  laneSpacing: 14,         // px between waiting enemies' depth lanes
  ai: true,
  seed: 1,
};

export function createBrawler(o = {}) {
  const C = withDefaults(BRAWLER_DEFAULTS, o);
  C.enemy = { ...BRAWLER_DEFAULTS.enemy, ...(o.enemy || {}) };
  const ev = createEvents(o.onEvent);
  let rng = createRng(C.seed);
  let nextId = 1;
  let enemies = [];
  let player = null;
  const holders = new Set();
  let time = 0;

  // ------------------------------------------------------------ fighters
  function makeFighter(team, spec = {}) {
    const isP = team === 'player';
    const E = C.enemy;
    return {
      id: spec.id ?? (isP ? 'player' : `e${nextId++}`),
      team,
      x: spec.x ?? 0, y: spec.y ?? 0, z: 0, vx: 0, vy: 0, vz: 0,
      facing: spec.facing ?? (isP ? 1 : -1),
      hp: spec.hp ?? (isP ? C.hp : E.hp), maxHp: spec.hp ?? (isP ? C.hp : E.hp),
      state: 'idle', stateT: 0, move: null, moveHits: new Set(), queued: false,
      chainNext: null, chainT: 0, hitstun: 0, invuln: 0, freeze: 0,
      airMove: null, airMoveT: 0, airUsed: false,
      holding: null, grabbedBy: null, grabT: 0, knees: 0, thrower: null, throwHits: new Set(),
      combo: 0, comboT: 0, cooldown: isP ? 0 : rng.range(0.2, 0.8), tokenT: 0,
      walkSpeed: spec.walkSpeed ?? (isP ? C.walkSpeed : E.walkSpeed),
      depthSpeed: spec.depthSpeed ?? (isP ? C.depthSpeed : E.depthSpeed),
      body: { ...C.body, ...(spec.body || {}) },
      moves: spec.moves ?? (isP ? C.moves : E.moves),
      invulnOnHit: spec.invulnOnHit ?? (isP ? C.invulnOnHit : E.invulnOnHit),
      ai: isP ? false : spec.ai ?? C.ai,
      lane: 0, side: 0,
      data: spec.data ?? {},
    };
  }

  const alive = (f) => f && f.state !== 'dead' && f.hp > 0;
  const hittable = (t) => alive(t) && t.invuln <= 0 && t.state !== 'down' && t.state !== 'grabbed' && t.state !== 'thrown' && !(t.state === 'knockdown');
  const opponents = (f) => (f.team === 'player' ? enemies : [player]);
  const moveTotal = (m) => (m.startup || 0) + (m.active || 0) + (m.recovery || 0);
  const firstMove = (f) => (f.moves.light1 ? 'light1' : Object.keys(f.moves).find((k) => f.moves[k].hitbox) || null);

  function hurtbox(f) {
    const b = f.body;
    return { x0: f.x - b.w / 2, x1: f.x + b.w / 2, y: f.y, d: b.d, z0: f.z, z1: f.z + b.h };
  }
  function hitboxOf(f, hb) {
    const a = f.facing >= 0 ? f.x + hb.x : f.x - hb.x - hb.w;
    return { x0: a, x1: a + hb.w, y: f.y, d: hb.d, z0: f.z + hb.z, z1: f.z + hb.z + hb.h };
  }
  const overlap3 = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && Math.abs(a.y - b.y) <= a.d + b.d && a.z0 < b.z1 && a.z1 > b.z0;

  // ------------------------------------------------------------ tokens
  function takeToken(f) {
    if (f.team !== 'enemy') return true;
    if (holders.has(f.id)) return true;
    if (holders.size >= C.maxAttackers) return false;
    holders.add(f.id); f.tokenT = 0;
    ev.emit('token', { id: f.id, got: true });
    return true;
  }
  function dropToken(f, cool = true) {
    if (f.team !== 'enemy' || !holders.has(f.id)) return;
    holders.delete(f.id);
    if (cool) f.cooldown = rng.range(C.enemy.cooldown[0], C.enemy.cooldown[1]);
    ev.emit('token', { id: f.id, got: false });
  }

  // ------------------------------------------------------------ damage (the only place hp goes down)
  function hurt(att, t, moveName, damage, dir, { knockback = 0, knockdown = false, hitstun = 0.3, keepGrab = false, at = null } = {}) {
    t.hp = Math.max(0, t.hp - Math.max(0, damage));
    const killed = t.hp <= 0;
    if (!keepGrab || killed) {
      if (t.holding) release(t, false);
      if (t.grabbedBy) { const g = t.grabbedBy; g.holding = null; t.grabbedBy = null; if (g.state === 'grabbing') setState(g, 'idle'); }
    }
    dropToken(t);
    if (att) {
      att.combo = att.comboT > 0 ? att.combo + 1 : 1;
      att.comboT = C.comboWindow;
    }
    if (killed || knockdown || (t.z > 0.5 && !keepGrab)) { // a hit in the air always knocks down
      setState(t, 'knockdown');
      t.vz = C.launch * (killed ? 1.1 : 1); t.z = Math.max(t.z, 0.01);
      t.vx = dir * Math.max(knockback, 60); t.vy = 0;
    } else if (!keepGrab) {
      setState(t, 'hitstun');
      t.hitstun = hitstun; t.vx = dir * knockback; t.vy = 0;
    }
    t.move = null; t.airMove = null;
    if (!keepGrab) t.facing = -dir || t.facing;
    t.invuln = Math.max(t.invuln, t.invulnOnHit || 0);
    const stop = C.hitstop > 0 ? C.hitstop : 0;
    if (stop) { t.freeze = stop; if (att) att.freeze = stop; }
    const p = at || { x: (t.x + (att ? att.x : t.x)) / 2, y: t.y, z: t.z + t.body.h * 0.6 };
    ev.emit('hit', {
      attacker: att ? att.id : null, target: t.id, move: moveName, damage, x: p.x, y: p.y, z: p.z,
      knockdown: killed || knockdown, killed, combo: att ? att.combo : 0, hitstop: stop, team: t.team,
    });
    if (att && att.team === 'player') ev.act('hit-' + moveName);
    if (t.team === 'player') ev.act('hurt');
    if (killed) ev.emit('ko', { id: t.id, team: t.team, x: t.x, y: t.y });
  }

  function tryHits(f, m, name) {
    if (!m.hitbox) return;
    const hb = hitboxOf(f, m.hitbox);
    for (const t of opponents(f)) {
      if (!t || f.moveHits.has(t.id) || !hittable(t)) continue;
      const hu = hurtbox(t);
      if (!overlap3(hb, hu)) continue;
      f.moveHits.add(t.id);
      const x = (Math.max(hb.x0, hu.x0) + Math.min(hb.x1, hu.x1)) / 2;
      const z = (Math.max(hb.z0, hu.z0) + Math.min(hb.z1, hu.z1)) / 2;
      hurt(f, t, name, m.damage || 0, sign(t.x - f.x) || f.facing, {
        knockback: m.knockback || 0, knockdown: !!m.knockdown, hitstun: m.hitstun ?? 0.3, at: { x, y: (f.y + t.y) / 2, z },
      });
    }
  }

  // ------------------------------------------------------------ states
  function setState(f, st) { f.state = st; f.stateT = 0; }

  function startMove(f, name) {
    const m = name && f.moves[name];
    if (!m || !m.hitbox) return false;
    if (!takeToken(f)) return false;
    setState(f, 'attack');
    f.move = name; f.moveHits = new Set(); f.queued = false; f.chainNext = null; f.chainT = 0;
    ev.emit('attack', { id: f.id, team: f.team, move: name, x: f.x, y: f.y });
    if (f.team === 'player') ev.act('attack-' + name);
    return true;
  }

  function tryGrab(f) {
    const G = C.grab;
    let best = null, bd = Infinity;
    if (f.z < 2) {
      for (const t of opponents(f)) {
        if (!alive(t) || t.invuln > 0 || t.z >= 2 || !['idle', 'walk', 'hitstun', 'attack'].includes(t.state)) continue;
        const dx = Math.abs(t.x - f.x), dy = Math.abs(t.y - f.y);
        if (dx <= G.rangeX && dy <= G.rangeY && dx + dy < bd) { best = t; bd = dx + dy; }
      }
    }
    if (!best) {
      ev.emit('whiff', { id: f.id, move: 'grab', x: f.x, y: f.y });
      if (f.team === 'player') ev.act('grab-miss');
      return false;
    }
    f.facing = sign(best.x - f.x) || f.facing;
    setState(f, 'grabbing'); f.holding = best; f.grabT = 0; f.knees = 0; f.vx = f.vy = 0;
    dropToken(best, true);
    setState(best, 'grabbed'); best.grabbedBy = f; best.move = null; best.vx = best.vy = best.vz = 0; best.z = 0;
    best.facing = -f.facing;
    ev.emit('grabbed', { id: f.id, target: best.id, x: best.x, y: best.y });
    if (f.team === 'player') ev.act('grab');
    return true;
  }

  function release(f, emit = true) {
    const t = f.holding;
    f.holding = null;
    if (f.state === 'grabbing') setState(f, 'idle');
    if (!t) return;
    t.grabbedBy = null;
    if (t.state === 'grabbed') { setState(t, 'idle'); t.vx = f.facing * 80; t.invuln = Math.max(t.invuln, 0.3); }
    if (emit) ev.emit('released', { id: f.id, target: t.id });
  }

  function doThrow(f, dir) {
    const t = f.holding, T = C.throw;
    if (!t) return;
    f.holding = null; t.grabbedBy = null;
    setState(f, 'throwing'); f.facing = dir;
    setState(t, 'thrown');
    t.thrower = f; t.throwHits = new Set(); t.vx = dir * T.vx; t.vz = T.vz; t.z = 0.01; t.vy = 0;
    t.facing = -dir;
    ev.emit('thrown', { id: f.id, target: t.id, dir, x: t.x, y: t.y });
    if (f.team === 'player') ev.act('throw');
  }

  function moveToward(f, I, dt, control = 1) {
    const tx = I.moveX * f.walkSpeed, ty = I.moveY * f.depthSpeed;
    const ax = (I.moveX !== 0 ? C.accel : C.friction) * control * dt;
    const ay = (I.moveY !== 0 ? C.accel : C.friction) * control * dt;
    f.vx = approach(f.vx, tx, ax);
    f.vy = approach(f.vy, ty, ay);
  }
  function brake(f, dt, mul = 1) { f.vx = approach(f.vx, 0, C.friction * mul * dt); f.vy = approach(f.vy, 0, C.friction * mul * dt); }

  function stepFighter(f, I, dt) {
    if (f.freeze > 0) { f.freeze = Math.max(0, f.freeze - dt); return; }
    f.stateT += dt;
    f.invuln = Math.max(0, f.invuln - dt);
    f.comboT -= dt; f.chainT -= dt;
    if (f.team === 'enemy') { f.cooldown -= dt; if (holders.has(f.id)) f.tokenT += dt; }
    let air = false;
    switch (f.state) {
      case 'idle': case 'walk': {
        if (I.jump) {
          setState(f, 'jump'); f.vz = C.jumpSpeed; f.z = 0.01; f.airUsed = false; f.airMove = null;
          ev.emit('jumped', { id: f.id, x: f.x, y: f.y });
          if (f.team === 'player') ev.act('jump');
        } else if (I.grab && f.team === 'player') tryGrab(f);
        else if (I.special && f.moves.heavy) startMove(f, 'heavy');
        else if (I.attack) startMove(f, f.chainT > 0 && f.chainNext ? f.chainNext : firstMove(f));
        if (f.state === 'idle' || f.state === 'walk') {
          moveToward(f, I, dt);
          if (I.face) f.facing = sign(I.face) || f.facing;
          else if (Math.abs(I.moveX) > 0.2) f.facing = I.moveX > 0 ? 1 : -1;
          f.state = Math.abs(f.vx) + Math.abs(f.vy) > 1 ? 'walk' : 'idle';
        }
        break;
      }
      case 'jump': {
        moveToward(f, I, dt, C.airControl);
        if (I.attack && !f.airUsed && f.moves.jumpAttack) {
          f.airUsed = true; f.airMove = 'jumpAttack'; f.airMoveT = 0; f.moveHits = new Set();
          ev.emit('attack', { id: f.id, team: f.team, move: 'jumpAttack', x: f.x, y: f.y });
          if (f.team === 'player') ev.act('attack-jumpAttack');
        }
        if (f.airMove) {
          const m = f.moves[f.airMove];
          f.airMoveT += dt;
          if (f.airMoveT >= m.startup && f.airMoveT < m.startup + m.active) tryHits(f, m, f.airMove);
        }
        air = true;
        break;
      }
      case 'attack': {
        const m = f.moves[f.move];
        if (!m) { setState(f, 'idle'); break; }
        if (m.lunge && f.stateT < m.startup + m.active) { f.vx = f.facing * m.lunge; f.vy = approach(f.vy, 0, C.friction * dt); } else brake(f, dt);
        if (I.attack && m.next) f.queued = true;
        if (f.stateT >= m.startup && f.stateT < m.startup + m.active) tryHits(f, m, f.move);
        if (f.stateT >= moveTotal(m)) {
          const next = m.next;
          if (f.queued && next && f.moves[next]) {
            if (!startMove(f, next)) setState(f, 'idle');
          } else {
            setState(f, 'idle');
            f.chainNext = next || null; f.chainT = next ? m.chainWindow ?? 0.3 : 0;
            dropToken(f);
          }
          if (f.state === 'idle') f.move = null;
        }
        break;
      }
      case 'hitstun':
        brake(f, dt, 0.25);
        if (f.stateT >= f.hitstun) setState(f, 'idle');
        break;
      case 'knockdown': case 'thrown': {
        air = true;
        if (f.state === 'thrown' && C.throw.hitsOthers) {
          for (const t of (f.team === 'enemy' ? enemies : [player])) {
            if (t === f || f.throwHits.has(t.id) || !hittable(t)) continue;
            if (overlap3(hurtbox(f), hurtbox(t))) {
              f.throwHits.add(t.id);
              hurt(f.thrower, t, 'throw-hit', C.throw.otherDamage, sign(f.vx) || 1, { knockback: 120, knockdown: true });
            }
          }
        }
        break;
      }
      case 'down':
        brake(f, dt);
        if (f.hp <= 0) { setState(f, 'dead'); break; }
        if (f.stateT >= C.downTime) {
          setState(f, 'idle'); f.invuln = Math.max(f.invuln, C.getupInvuln);
          ev.emit('getup', { id: f.id });
        }
        break;
      case 'grabbing': {
        const t = f.holding;
        f.grabT += dt; f.vx = f.vy = 0;
        if (!t || t.state !== 'grabbed') { release(f, false); break; }
        if (I.attack) {
          f.knees++;
          const kn = f.moves.knee || PLAYER_MOVES.knee;
          hurt(f, t, 'knee', kn.damage || 0, f.facing, { keepGrab: true });
          if (t.hp > 0 && f.knees >= C.grab.hits) doThrow(f, f.facing);
        } else if (I.grab || I.special || I.jump) {
          doThrow(f, Math.abs(I.moveX) > 0.3 ? sign(I.moveX) : f.facing);
        } else if (f.grabT >= C.grab.hold) release(f, true);
        break;
      }
      case 'grabbed':
        f.vx = f.vy = 0;
        if (!f.grabbedBy || f.grabbedBy.state !== 'grabbing') { f.grabbedBy = null; setState(f, 'idle'); }
        break;
      case 'throwing':
        brake(f, dt);
        if (f.stateT >= C.throw.recovery) setState(f, 'idle');
        break;
      default: // dead
        brake(f, dt);
    }

    // ---- integrate
    if (f.state !== 'grabbed' && f.state !== 'grabbing') {
      f.x += f.vx * dt;
      f.y += f.vy * dt;
    }
    if (air) {
      const vz0 = f.vz;
      f.vz -= C.gravity * dt;
      f.z += ((vz0 + f.vz) / 2) * dt;
      if (f.z <= 0) {
        f.z = 0; f.vz = 0;
        if (f.state === 'jump') {
          setState(f, 'idle'); f.airMove = null;
          ev.emit('landed', { id: f.id, x: f.x, y: f.y });
        } else {
          const thrown = f.state === 'thrown';
          f.vx = 0;
          if (thrown) {
            const by = f.thrower; f.thrower = null;
            setState(f, 'down');
            hurt(by, f, 'throw', C.throw.damage, -f.facing || 1, { knockdown: false, keepGrab: true, at: { x: f.x, y: f.y, z: 0 } });
            if (f.state !== 'dead') setState(f, f.hp <= 0 ? 'dead' : 'down');
            f.z = 0; f.vz = 0; f.vx = 0;
          } else setState(f, f.hp <= 0 ? 'dead' : 'down');
          ev.emit('landed', { id: f.id, x: f.x, y: f.y, heavy: true });
        }
      }
    }
    const B = C.bounds;
    f.x = clamp(f.x, B.minX, B.maxX);
    f.y = clamp(f.y, B.minY, B.maxY);
    if (![f.x, f.y, f.z, f.vx, f.vy, f.vz].every(Number.isFinite)) { f.vx = f.vy = f.vz = 0; f.z = 0; f.x = clamp(B.minX, B.minX, B.maxX); f.y = B.minY; }
  }

  // ------------------------------------------------------------ enemy AI (approach, wait in lane, attack with a token)
  function laneOffset(i) {
    const k = Math.ceil(i / 2) * (i % 2 ? -1 : 1);
    return k * C.laneSpacing;
  }
  function aiIntent(e, dt) {
    const I = { moveX: 0, moveY: 0, attack: false, face: 0 };
    const P = player;
    if (!['idle', 'walk'].includes(e.state)) return I;
    if (!alive(P)) return I;
    const E = C.enemy, B = C.bounds;
    if (!e.side) e.side = e.x < P.x ? -1 : 1;
    // switch sides only when well past the player
    if (e.x < P.x - 40) e.side = -1; else if (e.x > P.x + 40) e.side = 1;
    const pReady = P.state !== 'down' && P.state !== 'dead' && P.invuln <= 0.05;
    let has = holders.has(e.id);
    if (has && e.tokenT > E.tokenTimeout) { dropToken(e); has = false; }
    if (!has && pReady && e.cooldown <= 0 && Math.abs(P.x - e.x) < E.waitRange + 60) has = takeToken(e);
    let tx, ty;
    if (has) { tx = P.x + e.side * E.attackRange * 0.75; ty = P.y; } else {
      tx = P.x + e.side * (E.waitRange + (e.lane < 0 ? 10 : 0));
      ty = clamp(P.y + e.lane, B.minY, B.maxY);
    }
    const dx = tx - e.x, dy = ty - e.y;
    I.moveX = Math.abs(dx) < 2 ? 0 : clamp(dx / 14, -1, 1);
    I.moveY = Math.abs(dy) < 1.5 ? 0 : clamp(dy / 10, -1, 1);
    I.face = sign(P.x - e.x) || e.facing;
    if (has && pReady && e.cooldown <= 0 && Math.abs(P.x - e.x) <= E.attackRange && Math.abs(P.y - e.y) <= 5) {
      I.attack = true; I.moveX = 0; I.moveY = 0;
    }
    return I;
  }

  function separate() {
    const S = C.separation;
    const ground = (f) => alive(f) && f.z === 0 && (f.state === 'idle' || f.state === 'walk');
    for (let i = 0; i < enemies.length; i++) {
      for (let j = i + 1; j < enemies.length; j++) {
        const a = enemies[i], b = enemies[j];
        if (!ground(a) || !ground(b)) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        if (Math.abs(dy) >= 10 || Math.abs(dx) >= S) continue;
        const push = (S - Math.abs(dx)) / 2;
        const sx = dx === 0 ? (a.id < b.id ? 1 : -1) : sign(dx);
        a.x -= sx * push * 0.5; b.x += sx * push * 0.5;
        // nudge them toward different depth lanes too
        const sy = dy === 0 ? (a.id < b.id ? 1 : -1) : sign(dy);
        a.y = clamp(a.y - sy * 0.5, C.bounds.minY, C.bounds.maxY); b.y = clamp(b.y + sy * 0.5, C.bounds.minY, C.bounds.maxY);
      }
    }
  }

  // ------------------------------------------------------------ public
  function reset() {
    rng = createRng(C.seed);
    nextId = 1;
    holders.clear();
    enemies = [];
    time = 0;
    player = makeFighter('player', C.player);
    ev.reset();
  }
  reset();

  function step(intent, dt) {
    ev.clear();
    if (!(dt > 0)) return;
    time += dt;
    const I = readIntent(intent);
    stepFighter(player, I, dt);
    const neutral = readIntent(null);
    for (const e of enemies) {
      let ei = neutral;
      if (typeof o.enemyIntent === 'function') ei = readIntent(o.enemyIntent(e, api, dt) || null);
      else if (e.ai) ei = { ...neutral, ...aiIntent(e, dt) };
      stepFighter(e, ei, dt);
    }
    // a held fighter rides in front of the grabber
    for (const f of [player, ...enemies]) {
      const t = f.holding;
      if (t && f.state === 'grabbing') { t.x = clamp(f.x + f.facing * C.grab.dist, C.bounds.minX, C.bounds.maxX); t.y = f.y; t.z = 0; }
    }
    separate();
  }

  const api = {
    get state() { return { player, enemies, time, attackers: holders.size }; },
    get player() { return player; },
    get enemies() { return enemies; },
    get events() { return ev.events; },
    step,
    reset,
    lastAction: () => ev.last(),
    /** add an enemy: { x, y, hp, moves, ai, walkSpeed, body, data } */
    addEnemy(spec = {}) {
      const e = makeFighter('enemy', spec);
      e.lane = laneOffset(enemies.length);
      enemies.push(e);
      return e;
    },
    removeEnemy(e) { dropToken(e, false); enemies = enemies.filter((x) => x !== e); },
    /** drop every dead enemy (call after its KO animation) */
    clearDead() { enemies = enemies.filter((e) => e.state !== 'dead'); },
    /** lock the fight to an arena (a wave) */
    setBounds(b) { Object.assign(C.bounds, b); },
    /** the attack-token holders (at most maxAttackers) */
    get tokens() { return { max: C.maxAttackers, holders: [...holders] }; },
    attackingNow: () => enemies.filter((e) => e.state === 'attack').length,
    /** active hitboxes this step (for debug drawing): [{owner, x0, x1, y, d, z0, z1}] */
    hitboxes() {
      const out = [];
      for (const f of [player, ...enemies]) {
        const name = f.state === 'attack' ? f.move : f.state === 'jump' ? f.airMove : null;
        const m = name && f.moves[name];
        if (!m || !m.hitbox) continue;
        const t = f.state === 'attack' ? f.stateT : f.airMoveT;
        if (t >= m.startup && t < m.startup + m.active) out.push({ owner: f.id, ...hitboxOf(f, m.hitbox) });
      }
      return out;
    },
    hurtbox,
    /** where to draw (x, y, z) on screen, for a ground line at groundY */
    toScreen: (x, y, z = 0, groundY = 0) => ({ x, y: groundY + y - z }),
    /** draw order: farther (smaller y) first */
    drawOrder: () => [player, ...enemies].slice().sort((a, b) => a.y - b.y),
    options: C,
  };
  return api;
}

/** Optional debug view: hurtboxes (blue) and live hitboxes (red), on a ground line at groundY. */
export function drawBrawlerDebug(ctx, fight, groundY = 0) {
  ctx.save();
  ctx.lineWidth = 1;
  for (const f of [fight.player, ...fight.enemies]) {
    const h = fight.hurtbox(f);
    ctx.strokeStyle = f.invuln > 0 ? 'rgba(255,255,255,.5)' : 'rgba(80,160,255,.9)';
    ctx.strokeRect(h.x0, groundY + h.y - h.z1, h.x1 - h.x0, h.z1 - h.z0);
  }
  ctx.strokeStyle = 'rgba(255,60,60,.95)';
  for (const b of fight.hitboxes()) ctx.strokeRect(b.x0, groundY + b.y - b.z1, b.x1 - b.x0, b.z1 - b.z0);
  ctx.restore();
}
