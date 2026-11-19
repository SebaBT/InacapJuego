import { capturePose } from './monster-hunt.js';

// The centre of the frame is deliberately left alone. Eyes and mouth must stay
// readable even while the edge of the image is closing in, so every mask starts
// outside this clear band. render.js interpolates the same values into GLSL.
export const SCREEN_FX_MASK = Object.freeze({
  inner: 0.40,
  outer: 1.22,
  xCompression: 0.76,
  gripOpen: 0.68,
  gripClosed: 0.40,
  gripOuter: 1.28
});

export const DANGER_RANGE = Object.freeze({ near: 1.35, far: 9.5, chaseFar: 13.5 });

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * Math.max(0, dt)));

// A near monster should be felt before it is seen. Distance is the real one
// between the player and the hunt state, not a scripted trigger. Attention is
// lower while the suit is unaware/patrolling and highest during a chase.
export function proximityTarget(distance, mode = 'patrol', visible = false) {
  const chasing = mode === 'chase';
  const near = chasing ? 0.9 : DANGER_RANGE.near;
  const far = chasing ? DANGER_RANGE.chaseFar : DANGER_RANGE.far;
  const amount = Math.pow(1 - smoothstep(near, far, distance), 1.6);
  const attention = chasing ? 1 : visible ? 0.86 : 0.58;
  return clamp(amount * attention, 0, 1);
}

// Pursuit holds a floor everywhere loss of sight is still unresolved, then
// deepens as the suit closes the distance.
export function chaseTarget(mode, distance) {
  if (mode !== 'chase') return 0;
  const closeness = 1 - smoothstep(2, 14, distance);
  return clamp(0.46 + 0.54 * closeness, 0, 1);
}

// Screen-space direction of the threat relative to the camera. The post shader
// uses it to place the chase lobe on the edge the suit is coming from.
export function threatBearing(pose, monster) {
  const dx = monster.x - pose.x;
  const dz = monster.z - pose.z;
  const yaw = pose.yaw || 0;
  const right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  const forward = -(dx * Math.sin(yaw) + dz * Math.cos(yaw));
  const length = Math.hypot(right, forward);
  if (length < 1e-5) return { x: 0, y: -1 };
  const azimuth = Math.atan2(right, forward);
  let x = Math.sin(azimuth);
  let y = -Math.cos(azimuth) * 0.72;
  const norm = Math.hypot(x, y) || 1;
  x /= norm;
  y /= norm;
  return { x, y };
}

// Raw dread, before smoothing. This is the channel that makes the player
// afraid rather than merely informed: it spikes when the suit is visible inside
// the view cone (eye contact) and keeps a low, wordless pressure when something
// unseen is breathing nearby. An authored pose.fear (scripted beat, jumpscare
// wind-up) always wins so the effect layer never fights the story.
export function fearTarget(pose, monster) {
  const authored = clamp(Number(pose?.fear) || 0, 0, 1);
  if (!pose || !monster) return authored;
  if (!Number.isFinite(monster.x) || !Number.isFinite(monster.z) ||
      !Number.isFinite(pose.x) || !Number.isFinite(pose.z)) return authored;

  const mode = monster.mode || 'patrol';
  const visible = Boolean(monster.visible);
  const chasing = mode === 'chase';
  const capturing = mode === 'capture';
  const distance = Math.hypot(monster.x - pose.x, monster.z - pose.z);
  // Looking at it is the thing that hurts. bearing.y runs negative in front of
  // the camera, so this is the same gate main.js uses for the reticle.
  const looking = threatBearing(pose, monster).y < -0.15;

  // Dread starts from real closeness. Pursuit is felt from further out than a
  // patrol, and a grab is already total.
  const nearness = Math.pow(1 - smoothstep(0.35, chasing || capturing ? 9.5 : 7.0, distance), 1.35);
  let fear = nearness * (visible ? 0.52 : 0.30);
  if (visible) {
    // Eye contact: the spike. A visible suit outside the cone still presses.
    fear += nearness * (looking ? 0.72 : 0.24);
    // Contact range fills the frame, cone or not.
    fear += Math.pow(1 - smoothstep(0.4, 2.6, distance), 1.7) * (looking ? 0.62 : 0.34);
  } else if (looking) {
    // Facing a shape you cannot resolve yet: the corridor knows before you do.
    fear += nearness * 0.18;
  }
  if (chasing) fear = Math.max(fear, nearness * 0.86);
  if (capturing) fear = Math.max(fear, 0.92);
  return clamp(Math.max(fear, authored), 0, 1);
}

export function createScreenFxState() {
  return {
    danger: 0,
    chase: 0,
    grip: 0,
    fear: 0,
    fade: 0,
    motion: 1,
    bearingX: 0,
    bearingY: -1,
    side: 0
  };
}

export function resetScreenFx(state) {
  state.danger = 0;
  state.chase = 0;
  state.grip = 0;
  state.fear = 0;
  state.fade = 0;
  state.motion = 1;
  state.bearingX = 0;
  state.bearingY = -1;
  state.side = 0;
  return state;
}

export function stepScreenFx(state, {
  running = false,
  reducedMotion = false,
  pose = null,
  monster = null
} = {}, dt = 0) {
  // Pause, inspection, noclip, retry and the death menu all stop the effect
  // immediately. A paused frame must not keep a tint, ring or bearing behind
  // the menu.
  if (!running || !monster || !pose ||
      !Number.isFinite(monster.x) || !Number.isFinite(monster.z) ||
      !Number.isFinite(pose.x) || !Number.isFinite(pose.z)) {
    resetScreenFx(state);
    return state;
  }

  const safeDt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
  const mode = monster.mode || 'patrol';
  const distance = Math.hypot(monster.x - pose.x, monster.z - pose.z);
  const capturing = mode === 'capture';
  const capture = capturing ? capturePose(Number(monster.captureTime) || 0) : null;

  let danger = proximityTarget(distance, mode, Boolean(monster.visible));
  let chase = chaseTarget(mode, distance);
  let grip = capture ? capture.grip : 0;
  const fade = capture ? capture.fade : 0;
  let fear = fearTarget(pose, monster);

  if (capturing) {
    // The grab is now the story. Keep the earlier pressure as a substrate so
    // the hand-off from pursuit to grip has no visual seam.
    danger *= 1 - grip * 0.55;
    chase = 0;
  }
  // The authored fade dissolves the remaining cues before the final blackout.
  danger *= 1 - fade;
  chase *= 1 - fade;
  fear *= 1 - fade;

  const dangerRate = danger > state.danger ? 3.2 : 2.1;
  const chaseRate = chase > state.chase ? 4.2 : 1.7;
  // Fear is the fast channel: it slams in when the suit is on you, and lets go
  // slowly enough that the corridor still feels unsafe after it walks away.
  const fearRate = fear > state.fear ? 5.0 : 1.8;
  state.danger = damp(state.danger, danger, dangerRate, safeDt);
  state.chase = damp(state.chase, chase, chaseRate, safeDt);
  state.fear = damp(state.fear, fear, fearRate, safeDt);
  // capturePose is already eased on the gameplay clock.
  state.grip = grip;
  state.fade = fade;

  const bearing = threatBearing(pose, monster);
  state.bearingX = damp(state.bearingX, bearing.x, 6.5, safeDt);
  state.bearingY = damp(state.bearingY, bearing.y, 6.5, safeDt);
  state.side = capturing ? (monster.captureSide || 0) : 0;
  state.motion = reducedMotion ? 0 : 1;
  return state;
}

export function snapshotScreenFx(state) {
  return {
    danger: state.danger,
    chase: state.chase,
    grip: state.grip,
    fear: state.fear,
    fade: state.fade,
    motion: state.motion,
    bearingX: state.bearingX,
    bearingY: state.bearingY,
    side: state.side
  };
}

// CSS gets the same envelope as the shader, but only as a soft peripheral
// wash. The pseudo-elements in style.css are masked away from the centre and
// are hard-disabled whenever the game is not playing. Always writing the three
// values also makes reset authoritative if anything else touched the root.
export function paintScreenFx(root, fx) {
  if (!root?.style || typeof root.style.setProperty !== 'function') return;
  root.style.setProperty('--hazard-danger', (fx?.danger ?? 0).toFixed(3));
  root.style.setProperty('--hazard-chase', (fx?.chase ?? 0).toFixed(3));
  root.style.setProperty('--hazard-grip', (fx?.grip ?? 0).toFixed(3));
}

export function createScreenFx(root = null) {
  const state = createScreenFxState();
  return {
    state,
    update(input, dt) {
      stepScreenFx(state, input, dt);
      paintScreenFx(root, state);
      return snapshotScreenFx(state);
    },
    paint() {
      paintScreenFx(root, state);
      return snapshotScreenFx(state);
    },
    reset() {
      resetScreenFx(state);
      paintScreenFx(root, state);
      return snapshotScreenFx(state);
    }
  };
}
