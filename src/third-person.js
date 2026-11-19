import { annex, annexDoorWidth, classroomDoorWidth, hall, plaza, rooms, wallThickness, worldBounds } from './layout.js';

export const THIRD_PERSON_DISTANCE = 2.25;
export const THIRD_PERSON_SHOULDER_RIGHT = 0.38;
export const THIRD_PERSON_PIVOT_DROP = 0.14;
export const THIRD_PERSON_CAMERA_RADIUS = 0.18;
export const THIRD_PERSON_MIN_HEAD_DIST = 0.62;
export const THIRD_PERSON_HEAD_FADE_END = 1.05;
export const THIRD_PERSON_TRANSITION_DURATION = 0.42;

const TAU = Math.PI * 2;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const smoothstep = t => t * t * (3 - 2 * t);
const smootherstep = t => t * t * t * (t * (t * 6 - 15) + 10);

function normalizeAngle(angle) {
  let a = angle % TAU;
  if (a > Math.PI) a -= TAU;
  if (a <= -Math.PI) a += TAU;
  return a;
}

export function shortestAngleDiff(from, to) {
  return normalizeAngle(to - from);
}

// Overhead walls above open doorways keep a raised third-person camera from clipping headers.
const DOORWAY_LINTELS = [
  ...rooms.filter(r => r.side !== 0).map(r => {
    const x0 = r.side > 0 ? hall.halfWidth - 0.063 : -hall.halfWidth - wallThickness;
    const x1 = r.side > 0 ? hall.halfWidth + wallThickness : -hall.halfWidth + 0.063;
    return {
      x0,
      x1,
      y0: 2.222,
      y1: hall.height,
      z0: r.doorZ - classroomDoorWidth / 2,
      z1: r.doorZ + classroomDoorWidth / 2
    };
  }),
  {
    x0: -annexDoorWidth / 2,
    x1: annexDoorWidth / 2,
    y0: 2.154,
    y1: annex.height,
    z0: hall.far - 0.17,
    z1: hall.far + 0.075
  },
  {
    x0: -hall.halfWidth - wallThickness,
    x1: -hall.halfWidth + 0.063,
    y0: 2.222,
    y1: hall.height,
    z0: plaza.hallPortal.z - plaza.hallPortal.width / 2,
    z1: plaza.hallPortal.z + plaza.hallPortal.width / 2
  },
  {
    x0: annex.x0 - wallThickness,
    x1: annex.x0 + 0.063,
    y0: 2.222,
    y1: annex.height,
    z0: annex.sideExit.z - annex.sideExit.width / 2,
    z1: annex.sideExit.z + annex.sideExit.width / 2
  },
  ...rooms.flatMap(r => (r.extraDoors || []).map(d => (
    d.wall === 'north' || d.wall === 'south'
      ? {
          x0: d.x - d.width / 2,
          x1: d.x + d.width / 2,
          y0: 2.222,
          y1: hall.height,
          z0: d.z - wallThickness,
          z1: d.z + wallThickness
        }
      : {
          x0: d.x - wallThickness,
          x1: d.x + wallThickness,
          y0: 2.222,
          y1: hall.height,
          z0: d.z - d.width / 2,
          z1: d.z + d.width / 2
        }
  )))
];

export function raycastAabb(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tMin = 0;
  let tMax = 1;

  if (Math.abs(dx) < 1e-9) {
    if (ox < x0 || ox > x1) return 1;
  } else {
    let t1 = (x0 - ox) / dx;
    let t2 = (x1 - ox) / dx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return 1;
  }

  if (Math.abs(dy) < 1e-9) {
    if (oy < y0 || oy > y1) return 1;
  } else {
    let t1 = (y0 - oy) / dy;
    let t2 = (y1 - oy) / dy;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return 1;
  }

  if (Math.abs(dz) < 1e-9) {
    if (oz < z0 || oz > z1) return 1;
  } else {
    let t1 = (z0 - oz) / dz;
    let t2 = (z1 - oz) / dz;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return 1;
  }

  return tMin;
}

function raycastCircle2D(ox, oz, dx, dz, cx, cz, radius) {
  const fx = ox - cx;
  const fz = oz - cz;
  const r2 = radius * radius;
  const c = fx * fx + fz * fz - r2;
  if (c <= 0) return 0;
  const a = dx * dx + dz * dz;
  if (a < 1e-12) return 1;
  const b = 2 * (fx * dx + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return 1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : 1;
}

export function raycastCapsule2D(ox, oz, dx, dz, ax, az, bx, bz, radius) {
  const sx = bx - ax;
  const sz = bz - az;
  const sLenSq = sx * sx + sz * sz;
  if (sLenSq < 1e-10) return raycastCircle2D(ox, oz, dx, dz, ax, az, radius);

  // Check if ray origin already starts inside the inflated capsule.
  const u0 = clamp(((ox - ax) * sx + (oz - az) * sz) / sLenSq, 0, 1);
  const cpx = ax + sx * u0;
  const cpz = az + sz * u0;
  if ((ox - cpx) * (ox - cpx) + (oz - cpz) * (oz - cpz) <= radius * radius) return 0;

  let best = Math.min(
    raycastCircle2D(ox, oz, dx, dz, ax, az, radius),
    raycastCircle2D(ox, oz, dx, dz, bx, bz, radius)
  );

  // Test intersection against both parallel offset sides of the capsule.
  const sLen = Math.sqrt(sLenSq);
  const nx = (-sz / sLen) * radius;
  const nz = (sx / sLen) * radius;
  const denom = dx * sz - dz * sx;
  if (Math.abs(denom) > 1e-9) {
    for (const sign of [-1, 1]) {
      const px = ax + nx * sign;
      const pz = az + nz * sign;
      const qx = px - ox;
      const qz = pz - oz;
      const t = (qx * sz - qz * sx) / denom;
      const u = (qx * dz - qz * dx) / denom;
      if (t >= 0 && t < best && u >= 0 && u <= 1) {
        best = t;
      }
    }
  }
  return best;
}

function clipRayPlane(o, d, limit, keepGreater) {
  if (keepGreater) {
    if (o < limit) return 0;
    if (o + d >= limit) return 1;
    if (Math.abs(d) < 1e-9) return 1;
    return clamp((limit - o) / d, 0, 1);
  }
  if (o > limit) return 0;
  if (o + d <= limit) return 1;
  if (Math.abs(d) < 1e-9) return 1;
  return clamp((limit - o) / d, 0, 1);
}

export function castCameraRay(
  origin,
  target,
  obstacles = [],
  bounds = worldBounds,
  radius = THIRD_PERSON_CAMERA_RADIUS
) {
  const ox = origin.x, oy = origin.y, oz = origin.z;
  const dx = target.x - ox, dy = target.y - oy, dz = target.z - oz;
  let bestT = 1;

  if (bounds) {
    bestT = Math.min(bestT, clipRayPlane(ox, dx, bounds.minX + radius, true));
    bestT = Math.min(bestT, clipRayPlane(ox, dx, bounds.maxX - radius, false));
    bestT = Math.min(bestT, clipRayPlane(oz, dz, bounds.minZ + radius, true));
    bestT = Math.min(bestT, clipRayPlane(oz, dz, bounds.maxZ - radius, false));
  }

  // Floor and ceiling planes.
  bestT = Math.min(bestT, clipRayPlane(oy, dy, radius, true));
  const inAnnex = oz < hall.far && target.z < hall.far && ox >= annex.x0 && ox <= annex.x1;
  const inIndoor = (oz >= hall.far && ox >= -hall.halfWidth && ox <= hall.halfWidth) ||
    (oz < hall.far && ox >= annex.x0 && ox <= annex.x1) ||
    rooms.some(r => ox >= r.x0 && ox <= r.x1 && oz >= r.z0 && oz <= r.z1);
  const ceiling = (inAnnex ? annex.height : inIndoor ? hall.height : 12) - radius;
  bestT = Math.min(bestT, clipRayPlane(oy, dy, ceiling, false));

  // If the ray starts inside the annex and moves back into the lower corridor ceiling, clip cleanly.
  if (oz < hall.far && target.z > hall.far && ox >= annex.x0 && ox <= annex.x1) {
    bestT = Math.min(bestT, raycastAabb(
      ox, oy, oz, dx, dy, dz,
      annex.x0, hall.height - radius, hall.far - radius,
      annex.x1, annex.height + radius, bounds.maxZ
    ));
  }

  // Doorway overhead headers (only block when the ray travels near the upper wall).
  for (const lintel of DOORWAY_LINTELS) {
    const hit = raycastAabb(
      ox, oy, oz, dx, dy, dz,
      lintel.x0 - radius, lintel.y0 - radius, lintel.z0 - radius,
      lintel.x1 + radius, lintel.y1 + radius, lintel.z1 + radius
    );
    if (hit < bestT) bestT = hit;
  }

  for (const b of obstacles) {
    if (b.active === false) continue;
    if (b.kind === 'segment') {
      const top = b.top !== undefined ? b.top + radius : 20;
      if (Math.min(oy, target.y) > top) continue;
      const hit = raycastCapsule2D(ox, oz, dx, dz, b.ax, b.az, b.bx, b.bz, (b.halfThick ?? 0.034) + radius);
      if (hit < bestT) bestT = hit;
      continue;
    }
    const yMin = b.bottom !== undefined ? b.bottom - radius : -10;
    const yMax = b.top !== undefined ? b.top + radius : 20;
    const hit = raycastAabb(
      ox, oy, oz, dx, dy, dz,
      b.x0 - radius, yMin, b.z0 - radius,
      b.x1 + radius, yMax, b.z1 + radius
    );
    if (hit < bestT) bestT = hit;
  }

  return clamp(bestT, 0, 1);
}

export function createThirdPersonState() {
  return {
    enabled: false,
    blend: 0,
    bodyYaw: 0,
    currentDistance: THIRD_PERSON_DISTANCE,
    currentShoulder: THIRD_PERSON_SHOULDER_RIGHT
  };
}

export function stepBodyFacing(state, {
  dt = 0,
  snap = false,
  reducedMotion = false,
  thirdPerson = false,
  yaw = 0,
  wishVx = 0,
  wishVz = 0,
  doorInteraction = null,
  playerX = 0,
  playerZ = 0
} = {}) {
  const safeDt = Math.min(Math.max(0, dt), 0.08);
  let targetYaw = null;
  let fast = false;

  if (!thirdPerson) {
    targetYaw = yaw;
    fast = true;
    if (state.blend <= 0.01) {
      state.bodyYaw = normalizeAngle(yaw);
      return state.bodyYaw;
    }
  } else if (
    doorInteraction &&
    doorInteraction.intensity > 0.05 &&
    (doorInteraction.kind === 'grab' || doorInteraction.kind === 'slam' || doorInteraction.kind === 'locked')
  ) {
    const dp = doorInteraction.doorPos || doorInteraction.handlePos;
    targetYaw = dp && Math.hypot(dp.x - playerX, dp.z - playerZ) > 0.05
      ? Math.atan2(-(dp.x - playerX), -(dp.z - playerZ))
      : yaw;
    fast = true;
  } else if (Math.hypot(wishVx, wishVz) > 0.12) {
    targetYaw = Math.atan2(-wishVx, -wishVz);
  }

  if (targetYaw === null) return state.bodyYaw;

  let diff = shortestAngleDiff(state.bodyYaw, targetYaw);
  // Break exact 180-degree turnarounds consistently toward the right shoulder so the turn sweeps cleanly into view.
  if (Math.abs(Math.abs(diff) - Math.PI) < 0.02) diff = -Math.PI;

  if (snap || reducedMotion || safeDt <= 0) {
    state.bodyYaw = normalizeAngle(targetYaw);
  } else {
    const rate = fast ? 14 + Math.abs(diff) * 6 : 6.5 + Math.abs(diff) * 4.5;
    const step = Math.min(Math.abs(diff), rate * safeDt);
    state.bodyYaw = normalizeAngle(state.bodyYaw + Math.sign(diff) * step);
  }
  return state.bodyYaw;
}

export function isThirdPersonTransitioning(state, { allowed = true, reducedMotion = false, yaw = 0 } = {}) {
  const targetBlend = state.enabled && allowed ? 1 : 0;
  if (reducedMotion) return false;
  if (Math.abs(state.blend - targetBlend) > 0.001) return true;
  if (targetBlend === 0 && Math.abs(shortestAngleDiff(state.bodyYaw, yaw)) > 0.005) return true;
  return false;
}

export function stepThirdPersonCamera(state, {
  dt = 0,
  snap = false,
  reducedMotion = false,
  allowed = true,
  position,
  eyeY,
  fpPos,
  yaw = 0,
  pitch = 0,
  crouchAmount = 0,
  baseOffsetY = 0,
  jumpHeight = 0,
  obstacles = [],
  bounds = worldBounds
}) {
  const want = Boolean(state.enabled && allowed);
  const targetBlend = want ? 1 : 0;

  if (snap || reducedMotion) {
    state.blend = targetBlend;
  } else if (dt > 0) {
    const step = Math.min(dt, 0.08) / THIRD_PERSON_TRANSITION_DURATION;
    const diff = targetBlend - state.blend;
    state.blend = Math.abs(diff) <= step ? targetBlend : state.blend + Math.sign(diff) * step;
  }

  const blend = smootherstep(clamp(state.blend, 0, 1));
  if (blend <= 0.0005) {
    state.currentDistance = THIRD_PERSON_DISTANCE;
    state.currentShoulder = THIRD_PERSON_SHOULDER_RIGHT;
    return {
      x: fpPos.x,
      y: fpPos.y,
      z: fpPos.z,
      blend: 0,
      distance: 0,
      fovOffset: 0,
      headOpacity: 0,
      showHead: false
    };
  }

  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);

  // Right vector and trailing back vector (opposite of look direction).
  const rx = cosYaw;
  const rz = -sinYaw;
  const backX = sinYaw * cosPitch;
  const backY = -sinPitch;
  const backZ = cosYaw * cosPitch;

  const pivotY = clamp(
    position.y + jumpHeight - 0.42 * crouchAmount - THIRD_PERSON_PIVOT_DROP + (reducedMotion ? 0 : baseOffsetY * 0.25),
    0.45,
    (position.z < hall.far ? annex.height : hall.height) - THIRD_PERSON_CAMERA_RADIUS - 0.04
  );

  // Stage 1: cast from player center to the right-shoulder pivot so walls never clip the pivot.
  const centerOrigin = { x: position.x, y: pivotY, z: position.z };
  const desiredShoulderPos = {
    x: position.x + rx * THIRD_PERSON_SHOULDER_RIGHT,
    y: pivotY,
    z: position.z + rz * THIRD_PERSON_SHOULDER_RIGHT
  };
  const shoulderT = castCameraRay(centerOrigin, desiredShoulderPos, obstacles, bounds);
  const hitShoulder = THIRD_PERSON_SHOULDER_RIGHT * shoulderT;

  if (snap || reducedMotion || hitShoulder < state.currentShoulder) {
    state.currentShoulder = hitShoulder;
  } else if (dt > 0) {
    const easeOut = 1 - Math.exp(-10 * Math.min(dt, 0.08));
    state.currentShoulder += (hitShoulder - state.currentShoulder) * easeOut;
  }

  // Arc the shoulder outward slightly ahead of the backward travel so the camera sweeps
  // smoothly around the right side of the Mii's head instead of slicing straight through it.
  const shoulderArc = smoothstep(clamp(state.blend / 0.72, 0, 1));
  const activeShoulder = state.currentShoulder * shoulderArc;
  const pivot = {
    x: position.x + rx * activeShoulder,
    y: fpPos.y + (pivotY - fpPos.y) * blend,
    z: position.z + rz * activeShoulder
  };

  // Stage 2: cast backward along the camera spring arm.
  const desiredCam = {
    x: pivot.x + backX * THIRD_PERSON_DISTANCE,
    y: pivot.y + backY * THIRD_PERSON_DISTANCE,
    z: pivot.z + backZ * THIRD_PERSON_DISTANCE
  };
  const armT = castCameraRay(pivot, desiredCam, obstacles, bounds);
  const hitDistance = THIRD_PERSON_DISTANCE * armT;

  if (snap || reducedMotion || hitDistance < state.currentDistance) {
    state.currentDistance = hitDistance;
  } else if (dt > 0) {
    const easeOut = 1 - Math.exp(-9 * Math.min(dt, 0.08));
    state.currentDistance += (hitDistance - state.currentDistance) * easeOut;
  }

  const activeDistance = state.currentDistance * blend;
  const x = pivot.x + (fpPos.x - position.x) * (1 - blend) + backX * activeDistance;
  const y = pivot.y + backY * activeDistance;
  const z = pivot.z + (fpPos.z - position.z) * (1 - blend) + backZ * activeDistance;

  const distance = Math.hypot(x - position.x, y - eyeY, z - position.z);
  const distFade = smoothstep(clamp(
    (distance - THIRD_PERSON_MIN_HEAD_DIST) / (THIRD_PERSON_HEAD_FADE_END - THIRD_PERSON_MIN_HEAD_DIST),
    0,
    1
  ));
  const headOpacity = clamp(distFade * smoothstep(clamp((blend - 0.08) / 0.28, 0, 1)), 0, 1);
  const showHead = headOpacity > 0.01;
  const fovOffset = reducedMotion ? 0 : Math.sin(blend * Math.PI) * 2.2;

  return {
    x,
    y,
    z,
    blend,
    distance,
    fovOffset,
    headOpacity,
    showHead
  };
}
