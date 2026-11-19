import { Quaternion, Vector3 } from 'three';
import { worldBounds } from './layout.js';
import { castCameraRay, shortestAngleDiff } from './third-person.js';

const mix = (a, b, t) => a + (b - a) * t;

export function createCaptureShot(camera, pose) {
  // Esc can pause halfway through the shot. Keep the original view and jump
  // position independent of the walk controller's mutable camera and jump.
  const initial = { ...pose, jump: { ...pose.jump } };
  const start = camera.position.clone(), rotation = camera.quaternion.clone();
  const grip = new Vector3(), face = new Vector3(), eye = new Vector3();
  const wanted = new Vector3(), focus = new Vector3(), aim = new Quaternion();
  const third = initial.thirdPersonBlend, floor = initial.jump.height;
  return function frame(actor, state, c, obstacles, reducedMotion) {
    actor.gripCenter(grip);
    actor.facePosition(face);
    const heading = state.captureYaw ?? state.yaw;
    const fx = Math.sin(heading), fz = Math.cos(heading);
    // Place the visible avatar against the fingertips; its oversized head
    // needs clearance in front of the mask in the over-the-shoulder view.
    const gripOffset = .16 + third * .18;
    const x = mix(initial.x, grip.x + fx * gripOffset, c.grip), z = mix(initial.z, grip.z + fz * gripOffset, c.grip);
    const foot = mix(floor, Math.max(state.y, grip.y - 1.02), c.grip);
    eye.set(x + fx * .33 * c.grip, mix(initial.cameraY, grip.y + .28 - .20 * c.drop, c.grip),
      z + fz * .33 * c.grip);
    // Look over the victim's shoulder from behind in third person. Close
    // enough to read the face while the hands stay at the sides.
    wanted.set(eye.x + third * (fx * .28 + fz * 1.10),
      eye.y + third * .65, eye.z + third * (fz * .28 - fx * 1.10));
    const blend = reducedMotion ? 1 : c.reach;
    wanted.lerpVectors(start, wanted, blend);
    const origin = { x, y: Math.min(grip.y + .34, eye.y), z };
    const t = castCameraRay(origin, wanted, obstacles, worldBounds, .075);
    camera.position.set(mix(origin.x, wanted.x, t), mix(origin.y, wanted.y, t), mix(origin.z, wanted.z, t));
    focus.copy(face);
    focus.x += third * (.08 * fz + .10 * fx);
    focus.y -= .08 + third * .04;
    focus.z += third * (-.08 * fx + .10 * fz);
    // Elapsed struggle phase: the grab impact, the frantic hoist and the
    // final buckle each drive their own tremor so the shot never freezes.
    const strugglePhase = c.reach * 1.4 + c.lift * 2.8 + c.drop * 3.2;
    const grabShock = c.reach * (1 - c.lift);
    const struggle = c.grip * (1 - c.drop);
    if (!reducedMotion) {
      // A tight predatory shake keeps the mask and the emerging inner creature
      // vibrating threateningly in the player's face without losing the gaze.
      focus.x += .012 * Math.sin(strugglePhase * 41.3);
      focus.y += .010 * Math.sin(strugglePhase * 53.7 + 1.7);
      focus.z += .008 * Math.sin(strugglePhase * 47.1 + .6);
    }
    camera.lookAt(focus);
    aim.copy(camera.quaternion);
    camera.quaternion.slerpQuaternions(rotation, aim, blend);
    if (!reducedMotion) {
      camera.rotateZ(-.085 * c.drop
        + (grabShock * .11 * Math.sin(c.reach * 18)
          + struggle * .045 * Math.sin((c.lift + c.grip) * 26)));
    }
    const bodyYaw = initial.bodyYaw + shortestAngleDiff(initial.bodyYaw, heading) * c.grip;
    const headDistance = Math.hypot(camera.position.x - x, camera.position.z - z);
    return { ...initial, x, z, yaw: bodyYaw, bodyYaw, vx: 0, vz: 0, wishVx: 0, wishVz: 0,
      offsetX: 0, thirdPersonBlend: mix(third, 1, c.grip),
      headOpacity: third * Math.min(1, Math.max(0, (headDistance - .58) / .42)),
      pitch: .32 * c.lift - .74 * c.drop, isSprinting: false,
      crouchAmount: mix(initial.crouchAmount, .7 * c.drop, c.grip),
      jump: { ...initial.jump, height: foot, grounded: true, landDuration: 0, stumbleCooldown: 0 },
      fear: 1,
      capture: { ...c, hideBody: third < .15 || headDistance < .54, gripY: grip.y, floorY: state.y } };
  };
}
