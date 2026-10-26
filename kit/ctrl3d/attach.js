// ctrl3d/attach.js — put a library GLB character on a controller: feet on the
// ground, scaled to a height, facing the movement, and the animation clip picked
// from the controller state (idle / walk / run / jump / fall / attack / hit / die)
// with a crossfade.
//
//   import * as THREE from 'three';
//   import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
//   import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
//   const gltf = await new GLTFLoader().loadAsync('./assets/characters/knight.glb');
//   const hero = attachCharacter({
//     THREE, model: SkeletonUtils.clone(gltf.scene), animations: gltf.animations,
//     height: 1.8, clips: LIBRARY_CLIPS.adventurer, runSpeed: 6,
//   });
//   scene.add(hero.root);
//   // render(alpha, frameDt):  hero.update(Math.min(frameDt, 0.1), walker, alpha);
//   // an attack:               hero.oneShot('attack');
//
// Library facts (blueprint-factory/references/characters.md): the models stand
// on y = 0 at their origin and face +Z; never use gltf.scene itself for more
// than one instance (SkeletonUtils.clone gives each its own bones).
// The box is measured anyway, so a model whose origin is not at its feet still
// stands on the ground (no floating, no standing in a hole).
//
// Never let a missing asset stop the game: load the GLB with loadCharacterSafe(),
// which gives the same { scene, animations } and, when the file does not load (a
// 404, a bad file, a timeout), a placeholder figure with stand-in clips instead,
// after one console.warn. The game still boots, runs its self-test and shows the brand.
//   const gltf = await loadCharacterSafe(new GLTFLoader(), './assets/characters/knight.glb',
//     { THREE, clips: LIBRARY_CLIPS.adventurer });
//   // gltf.placeholder is true when the stand-in is used

import { wrapAngle } from './common.js';
import { assetWarn, withTimeout } from '../safe-load.js';

/** our clip names -> the real clip names of the library characters */
export const LIBRARY_CLIPS = Object.freeze({
  /** knight, barbarian and the skeleton-warrior / -minion foes */
  adventurer: { idle: 'Idle', walk: 'Walking_A', run: 'Running_A', jump: 'Jump_Full_Short', attack: '1H_Melee_Attack_Chop', hit: 'Hit_A', die: 'Death_A' },
  mage: { idle: 'Idle', walk: 'Walking_A', run: 'Running_A', jump: 'Jump_Full_Short', attack: 'Spellcast_Shoot', hit: 'Hit_A', die: 'Death_A' },
  ranger: { idle: 'Idle', walk: 'Walking_A', run: 'Running_A', jump: 'Jump_Full_Short', attack: '1H_Ranged_Shoot', hit: 'Hit_A', die: 'Death_A' },
  /** hooded-rogue, skeleton-rogue */
  rogue: { idle: 'Idle', walk: 'Walking_A', run: 'Running_A', jump: 'Jump_Full_Short', attack: '1H_Melee_Attack_Stab', hit: 'Hit_A', die: 'Death_A' },
  /** sporty, officer, scientist, pilot */
  small: { idle: 'idle', walk: 'walk', run: 'sprint', jump: 'jump', fall: 'fall', attack: 'attack-melee-right', die: 'die' },
  /** ninja, pirate, robot, crash-dummy, zombie (no jump, no hit clip) */
  blocky: { idle: 'idle', walk: 'walk', run: 'sprint', attack: 'attack-melee-right', die: 'die' },
});

/** when a clip is missing, try these in order */
export const CLIP_FALLBACKS = Object.freeze({
  idle: [],
  walk: ['run', 'idle'],
  run: ['walk', 'idle'],
  jump: ['fall', 'idle'],
  fall: ['jump', 'idle'],
  attack: ['idle'],
  hit: ['idle'],
  die: ['idle'],
});

/**
 * Feet-on-the-ground math: the scale and offset that make a box of the model
 * stand on y = 0 at the target height.
 * @param {{min:{x:number,y:number,z:number}, max:{x:number,y:number,z:number}}} box  the model's box at scale 1
 * @param {number} targetHeight
 * @param {object} [o]
 * @param {boolean} [o.center=false]  also centre it on x / z (the library models are already centred)
 * @returns {{scale:number, offsetX:number, offsetY:number, offsetZ:number, height:number}}
 *   put the model at scale `scale` and position (offsetX, offsetY, offsetZ) inside its parent
 */
export function feetOffset(box, targetHeight, { center = false } = {}) {
  const h = box.max.y - box.min.y;
  if (!(h > 1e-6) || !Number.isFinite(h)) return { scale: 1, offsetX: 0, offsetY: 0, offsetZ: 0, height: 0 };
  const scale = targetHeight / h;
  return {
    scale,
    offsetX: center ? -((box.min.x + box.max.x) / 2) * scale : 0,
    offsetY: -box.min.y * scale,
    offsetZ: center ? -((box.min.z + box.max.z) / 2) * scale : 0,
    height: h,
  };
}

/**
 * The clip a controller state asks for (our names: idle, walk, run, jump, fall, attack, hit, die).
 * Reads state.dead, state.hurt, state.attacking, state.grounded, state.vy, and the
 * ground speed (state.speed, or the length of vx / vz).
 * @param {object} state  a controller state
 * @param {object} [o]
 * @param {number} [o.idleBelow=0.2]  m/s under this is idle
 * @param {number} [o.runAbove=3.5]   m/s over this is run (between: walk)
 */
export function clipFor(state, { idleBelow = 0.2, runAbove = 3.5 } = {}) {
  if (state.dead) return 'die';
  if (state.hurt) return 'hit';
  if (state.attacking) return 'attack';
  if (state.grounded === false) return (state.vy ?? 0) > 0.5 ? 'jump' : 'fall';
  const sp = Math.abs(Number.isFinite(state.vx) && Number.isFinite(state.vz) ? Math.hypot(state.vx, state.vz) : state.speed ?? 0);
  if (sp < idleBelow) return 'idle';
  return sp < runAbove ? 'walk' : 'run';
}

/** our name -> the name that exists (fallbacks), or null */
export function resolveClip(name, has) {
  if (has(name)) return name;
  for (const alt of CLIP_FALLBACKS[name] || ['idle']) if (has(alt)) return alt;
  return null;
}

/**
 * @param {object} o
 * @param {object} o.THREE         the three.js module (the Kit never imports three itself)
 * @param {object} o.model         the character's scene: SkeletonUtils.clone(gltf.scene) per instance
 * @param {object[]} [o.animations]  gltf.animations
 * @param {number} [o.height=1.8]  world height of the character
 * @param {Record<string,string|null>} [o.clips]  our names -> clip names (LIBRARY_CLIPS.adventurer, or the index's clips)
 * @param {number} [o.units]       the library's heightUnits: used only when the box cannot be measured
 * @param {boolean} [o.center=false]  centre the box on x / z too
 * @param {number} [o.faceOffset=0]   rad added to the facing (a model that does not face +Z: Math.PI)
 * @param {number} [o.turnSpeed=0]    rad/s easing of the facing; 0 = follow the controller's yaw exactly
 *   (the controllers already ease their yaw)
 * @param {number} [o.fade=0.15]   crossfade seconds
 * @param {number} [o.idleBelow=0.2]
 * @param {number} [o.runAbove=3.5]
 * @param {number} [o.walkSpeed]   m/s at which the walk clip's feet do not slide (scales its timeScale); unset = 1
 * @param {number} [o.runSpeed]    the same for the run clip
 * @param {boolean} [o.follow=true]  update() also moves root to the controller's pose
 * @param {boolean} [o.shadows=true] castShadow on the meshes
 */
export function attachCharacter(o) {
  const {
    THREE, model, animations = [], height = 1.8, clips = LIBRARY_CLIPS.adventurer, units, center = false,
    faceOffset = 0, turnSpeed = 0, fade = 0.15, idleBelow = 0.2, runAbove = 3.5, walkSpeed, runSpeed,
    follow = true, shadows = true,
  } = o;
  const root = new THREE.Group();      // the controller moves this (feet)
  const pivot = new THREE.Group();     // facing
  root.add(pivot);
  pivot.add(model);

  model.traverse((m) => {
    if (m.isMesh) {
      if (shadows) m.castShadow = true;
      m.frustumCulled = false;         // skinned meshes: bind-pose bounds cull animated poses
    }
  });

  /** measure the model and put its feet on y = 0 at `h` (call again after changing the model) */
  function fit(h = height) {
    model.position.set(0, 0, 0);
    model.scale.setScalar(1);
    pivot.updateWorldMatrix(true, true);
    // skinned meshes: bone matrices are only filled by a render; fill them now (bind pose)
    model.traverse((m) => { if (m.isSkinnedMesh && m.skeleton) { m.skeleton.update(); m.boundingBox = null; } });
    const box = new THREE.Box3().setFromObject(model);
    // world box -> the pivot's space (wherever root stands, however it is turned about y)
    if (!box.isEmpty()) box.applyMatrix4(new THREE.Matrix4().copy(pivot.matrixWorld).invert());
    let f = feetOffset(box.isEmpty() ? { min: { y: 0 }, max: { y: 0 } } : box, h, { center });
    if (!(f.height > 1e-4) && units > 0) f = { scale: h / units, offsetX: 0, offsetY: 0, offsetZ: 0, height: units };
    model.scale.setScalar(f.scale);
    model.position.set(f.offsetX, f.offsetY, f.offsetZ);
    model.updateMatrixWorld(true);
    return f;
  }

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const [ours, name] of Object.entries(clips || {})) {
    const clip = name && THREE.AnimationClip.findByName(animations, name);
    if (clip) actions[ours] = mixer.clipAction(clip);
  }
  for (const k of ['jump', 'attack', 'hit', 'die']) {
    const a = actions[k];
    if (a) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
  }
  const has = (n) => !!actions[n];
  let current = null, currentName = null, shot = null;

  /** crossfade to one of our clip names (with fallbacks); returns the name that plays */
  function play(name, f = fade) {
    const n = resolveClip(name, has);
    if (!n) return null;
    const next = actions[n];
    if (next === current) return n;
    next.reset().setEffectiveWeight(1).fadeIn(f).play();
    if (current) current.fadeOut(f);
    current = next; currentName = n;
    return n;
  }
  /** a one-shot (attack, hit, a cheer): plays to its end, then the state clip takes over again */
  function oneShot(name, f = fade) {
    const n = play(name, f);
    if (n && n !== 'idle') shot = n;
    return n;
  }
  mixer.addEventListener('finished', (e) => {
    if (shot && e.action === actions[shot]) shot = null;
  });

  let facing = null;
  /**
   * Per render frame.
   * @param {number} dt  frame seconds (clamp it: Math.min(frameDt, 0.1))
   * @param {object} src a controller (pose(alpha) + state) or a plain state { x, y, z, yaw, ... }
   * @param {number} [alpha=1]
   */
  function update(dt, src, alpha = 1) {
    if (src) {
      const st = src.state || src;
      const p = typeof src.pose === 'function' ? src.pose(alpha) : st;
      if (follow) root.position.set(p.x, p.y, p.z);
      const want = (p.yaw ?? st.yaw ?? 0) + faceOffset;
      if (facing === null || !(turnSpeed > 0)) facing = want;
      else {
        const d = wrapAngle(want - facing);
        const m = turnSpeed * dt;
        facing += Math.max(-m, Math.min(m, d));
      }
      pivot.rotation.y = facing;
      if (!shot || st.dead) {
        const n = play(clipFor(st, { idleBelow, runAbove }));
        const sp = Math.abs(Number.isFinite(st.vx) && Number.isFinite(st.vz) ? Math.hypot(st.vx, st.vz) : st.speed ?? 0);
        if (n === 'walk' && walkSpeed > 0) actions.walk.timeScale = Math.max(0.5, Math.min(1.8, sp / walkSpeed));
        if (n === 'run' && runSpeed > 0) actions.run.timeScale = Math.max(0.6, Math.min(1.8, sp / runSpeed));
      }
    }
    mixer.update(dt);
  }

  const fitted = fit(height);
  play('idle', 0);
  return {
    root, pivot, model, mixer, actions, fit, fitted,
    play, oneShot, update, has,
    get current() { return currentName; },
  };
}

// ---------------------------------------------------------------- a missing GLB never stops the game

/** the stand-in motion per our clip name: [seconds, yaw keyframes in rad] (yaw only: the box height never changes) */
const PLACEHOLDER_MOTION = Object.freeze({
  idle: [2, [0, 0.06, 0, -0.06, 0]],
  walk: [0.8, [0, 0.18, 0, -0.18, 0]],
  run: [0.5, [0, 0.28, 0, -0.28, 0]],
  jump: [0.5, [0, 0.4, 0]],
  fall: [0.6, [0, -0.15, 0]],
  attack: [0.4, [0, 0.7, 0]],
  hit: [0.3, [0, -0.35, 0]],
  die: [0.8, [0, Math.PI / 2, Math.PI]],
});

/** the name of the part placeholderCharacter's clips turn */
export const PLACEHOLDER_PART = 'placeholderBody';

/**
 * A stand-in for a character that did not load: a capsule body, a head and a visor (so the
 * facing shows), standing on y = 0 and facing +Z like the library models, `height` tall.
 * Given `clips` (our names -> clip names, as attachCharacter takes them), it also carries a
 * short clip under each of those clip names, so attachCharacter plays and reports
 * idle / walk / attack ... on it exactly as on the real model.
 * @param {object} THREE  the three.js module
 * @param {object} [o]
 * @param {Record<string,string|null>} [o.clips]  our names -> clip names (LIBRARY_CLIPS.adventurer, ...)
 * @param {number} [o.height=1.8]
 * @param {string|number} [o.color='#7C8CA8']
 * @returns {{scene: object, animations: object[], placeholder: true}}
 */
export function placeholderCharacter(THREE, { clips, height = 1.8, color = '#7C8CA8' } = {}) {
  if (!THREE || typeof THREE.Group !== 'function') throw new TypeError('placeholderCharacter: pass the three.js module');
  const H = height > 0 ? height : 1.8;
  const scene = new THREE.Group();
  scene.name = 'placeholder-character';
  const part = new THREE.Group();
  part.name = PLACEHOLDER_PART;
  scene.add(part);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
  const r = 0.17 * H;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(r, 0.68 * H - 2 * r, 4, 12), mat);
  body.position.y = 0.34 * H;                                    // feet at 0, shoulders at 0.68 H
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16 * H, 16, 12), mat);
  head.position.y = 0.84 * H;                                    // the top at H
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2 * H, 0.06 * H, 0.06 * H), new THREE.MeshStandardMaterial({ color: '#1A1F2B', roughness: 0.4 }));
  visor.position.set(0, 0.86 * H, 0.14 * H);                     // faces +Z
  for (const m of [body, head, visor]) { m.castShadow = true; part.add(m); }

  const animations = [];
  const made = new Set();
  for (const [ours, name] of Object.entries(clips || {})) {
    if (typeof name !== 'string' || !name || made.has(name)) continue;
    made.add(name);
    const [dur, yaws] = PLACEHOLDER_MOTION[ours] || PLACEHOLDER_MOTION.idle;
    const times = yaws.map((_, i) => (dur * i) / (yaws.length - 1));
    const values = yaws.flatMap((a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)]);
    animations.push(new THREE.AnimationClip(name, dur, [new THREE.QuaternionKeyframeTrack(`${PLACEHOLDER_PART}.quaternion`, times, values)]));
  }
  return { scene, animations, placeholder: true };
}

/**
 * Load a character GLB without ever stopping the game. Success: { scene, animations } as
 * the loader gave them (placeholder: false). Any failure (404, network, a bad file, no
 * answer in `timeout` ms): one console.warn and placeholderCharacter(THREE, o) instead
 * (placeholder: true, error). Use the result exactly like a gltf:
 *   const gltf = await loadCharacterSafe(loader, CHARS + 'knight.glb', { THREE, clips: LIBRARY_CLIPS.adventurer });
 *   const body = attachCharacter({ THREE, model: SkeletonUtils.clone(gltf.scene), animations: gltf.animations, clips: LIBRARY_CLIPS.adventurer });
 * @param {{loadAsync?: (url:string) => Promise<any>, load?: Function}} loader  a three.js GLTFLoader
 * @param {string} url
 * @param {object} o
 * @param {object} o.THREE  the three.js module (for the placeholder)
 * @param {Record<string,string|null>} [o.clips]  the clips the game asks attachCharacter for
 * @param {number} [o.height]  the placeholder's height (attachCharacter rescales it anyway)
 * @param {string|number} [o.color]  the placeholder's colour
 * @param {number} [o.timeout=30000]  ms before a hanging load counts as failed
 * @returns {Promise<{scene: object, animations: object[], placeholder: boolean, error?: Error}>}
 */
export async function loadCharacterSafe(loader, url, o = {}) {
  const { THREE, timeout = 30000 } = o;
  if (!THREE || typeof THREE.Group !== 'function') throw new TypeError('loadCharacterSafe: pass { THREE } (the three.js module)');
  try {
    if (!loader) throw new Error('no loader');
    const p = typeof loader.loadAsync === 'function'
      ? loader.loadAsync(url)
      : new Promise((res, rej) => loader.load(url, res, undefined, rej));
    const gltf = await withTimeout(p, timeout, url);
    if (!gltf || !gltf.scene) throw new Error('the file has no scene');
    return { ...gltf, scene: gltf.scene, animations: gltf.animations || [], placeholder: false };
  } catch (error) {
    assetWarn(url, error, 'a placeholder figure stands in');
    return { ...placeholderCharacter(THREE, o), error };
  }
}
