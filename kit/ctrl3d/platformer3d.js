// ctrl3d/platformer3d.js — a 3D platformer hero: the walker with platformer
// numbers plus a double jump, variable jump height (let go early = a short hop),
// heavier falling, and ledge forgiveness (coyote time, and a wall top just above
// the feet is climbed onto instead of bonking off it).
//
//   const boxes = [...platforms];             // solid boxes: walls AND platforms
//   const hero = createPlatformer3d({
//     collide: boxesCollider(boxes),
//     groundHeight: boxesGround(boxes, -Infinity),   // -Infinity: a fall below the lowest box is a pit
//     start: { x: 0, y: 1, z: 0 },
//   });
//   const cam = followChase({ distance: 7, height: 3 });
//   // update(dt):
//   //   const intent = intentFromInput(input);    // jumpHeld drives the variable height
//   //   intent.viewYaw = cam.yaw;
//   //   hero.step(intent, dt);
//   //   if (hero.state.y < -20) hero.reset(checkpoint);
//   // render(alpha, frameDt): hero.apply(heroRoot, alpha); cam.update(hero.pose(alpha), frameDt); cam.apply(camera);
//
// Every walker option works here (see walker.js); these are the defaults that differ.

import { createWalker } from './walker.js';

/**
 * @typedef {import('./walker.js').WalkerOptions} WalkerOptions
 */
export const PLATFORMER3D_DEFAULTS = Object.freeze({
  speed: 6, runSpeed: 9, accel: 45, decel: 50, airControl: 0.65,
  mode: 'turn', turnSpeed: 14,
  gravity: 32, fallGravityScale: 1.6, maxFallSpeed: 30,
  jumpSpeed: 11,          // apex about 1.9 m with a full hold
  airJumps: 1,            // double jump
  airJumpSpeed: 9.5,
  jumpCut: 0.45,          // releasing early cuts the rise: a short hop
  coyoteTime: 0.12, jumpBuffer: 0.12,
  ledgeAssist: 0.45,
  stepHeight: 0.3,
});

/**
 * @param {WalkerOptions} [o]  any walker option; see PLATFORMER3D_DEFAULTS for what changes
 */
export function createPlatformer3d(o = {}) {
  return createWalker({ ...PLATFORMER3D_DEFAULTS, ...o, kind: 'platformer3d' });
}
