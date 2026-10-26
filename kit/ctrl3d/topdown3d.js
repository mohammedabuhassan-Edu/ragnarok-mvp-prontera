// ctrl3d/topdown3d.js — top-down / isometric 8-way movement on a plane, with
// collision: the walker on flat ground, no jump, direction snapped to 8 ways,
// snappy start and stop, and stick-up = screen-up (moveFrame 'view' with the
// topDown rig's yaw).
//
//   const p = createTopdown3d({ collide: gridCollider((x, z) => map[z]?.[x] === '#', { cellSize: 1 }) });
//   const cam = topDown({ height: 12, pitch: 55 });
//   // update(dt):
//   //   const intent = intentFromInput(input);
//   //   intent.viewYaw = cam.yaw;                // screen up follows the camera (isometric: yaw = Math.PI / 4)
//   //   p.step(intent, dt);
//   //   game.state.player = p.state;             // state.dir8: 0..7, the facing in 45° steps
//   // render(alpha, frameDt): p.apply(heroRoot, alpha); cam.update(p.pose(alpha), frameDt); cam.apply(camera);

import { createWalker } from './walker.js';

export const TOPDOWN3D_DEFAULTS = Object.freeze({
  speed: 5, runSpeed: 7.5, accel: 60, decel: 70, airControl: 1,
  mode: 'turn', moveFrame: 'view', turnSpeed: 20, eightWay: true,
  canJump: false, gravity: 26, radius: 0.35, stepHeight: 0.25,
});

/**
 * @param {import('./walker.js').WalkerOptions} [o]  any walker option; eightWay: false gives free 360° movement
 */
export function createTopdown3d(o = {}) {
  return createWalker({ ...TOPDOWN3D_DEFAULTS, ...o, kind: 'topdown3d' });
}
