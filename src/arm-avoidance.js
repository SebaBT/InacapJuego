import { Vector3 } from 'three';
import { worldBounds } from './layout.js';
import { analyzeDoorInteraction, solveSwitchArmIK } from './player-body-pose.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;

const STREETPASS_BASE_WORLD_SCALE = 0.098 * 0.15;
const STREETPASS_HAND_RADIUS = 0.175;
const STREETPASS_TORSO_ORBIT = 0.385;
const STREETPASS_HAND_SEP = 0.305;

const SWITCH_BASE_WORLD_SCALE = 0.095 / 7;
const SWITCH_HAND_RADIUS = 0.105;
const SWITCH_ELBOW_RADIUS = 0.085;

const _vA = new Vector3();
const _vB = new Vector3();
const _vC = new Vector3();
const _vD = new Vector3();
const _vLocal = new Vector3();

function makeStreetPassHandState() {
  return {
    initialized: false,
    blend: 0,
    relR: 0,
    relY: 0,
    relF: 0,
    wrapSign: 0
  };
}

function makeSwitchArmState() {
  return {
    initialized: false,
    blend: 0,
    tx: 0,
    ty: 0,
    tz: 0,
    px: 0,
    py: -1,
    pz: -0.35,
    wristRoll: 0
  };
}

export function createArmAvoidanceState() {
  return {
    streetpass: {
      left: makeStreetPassHandState(),
      right: makeStreetPassHandState()
    },
    switch: {
      left: makeSwitchArmState(),
      right: makeSwitchArmState()
    }
  };
}

export function resetArmAvoidanceState(state) {
  if (!state) return;
  for (const side of ['left', 'right']) {
    const sp = state.streetpass?.[side];
    if (sp) {
      sp.initialized = false;
      sp.blend = 0;
      sp.relR = 0;
      sp.relY = 0;
      sp.relF = 0;
      sp.wrapSign = 0;
    }
    const sw = state.switch?.[side];
    if (sw) {
      sw.initialized = false;
      sw.blend = 0;
      sw.tx = 0;
      sw.ty = 0;
      sw.tz = 0;
      sw.px = 0;
      sw.py = -1;
      sw.pz = -0.35;
      sw.wristRoll = 0;
    }
  }
}

function obstacleActiveAtHeight(b, y, radius, footY) {
  if (!b || b.active === false) return false;
  if (b.step && b.top !== undefined && b.top <= footY + 0.24) return false;
  const yMin = b.bottom !== undefined ? b.bottom : -10;
  const yMax = b.top !== undefined ? b.top : 20;
  if (y + radius <= yMin + 0.015) return false;
  if (y - radius >= yMax - 0.015) return false;
  return true;
}

/**
 * Exact 2D swept-circle cast from (ox, oz) to (tx, tz) with radius `radius` at height `y`
 * against rounded AABBs, capsule door segments, and outer worldBounds.
 * Returns { t, nx, nz, hit } where (nx, nz) is the unit outward normal at impact.
 */
export function sweepCircle2D(
  ox,
  oz,
  tx,
  tz,
  y,
  radius,
  obstacles = [],
  bounds = worldBounds,
  footY = 0
) {
  const dx = tx - ox;
  const dz = tz - oz;
  const segMinX = Math.min(ox, tx);
  const segMaxX = Math.max(ox, tx);
  const segMinZ = Math.min(oz, tz);
  const segMaxZ = Math.max(oz, tz);
  const moveLenSq = dx * dx + dz * dz;

  let bestT = 1;
  let bestNx = 0;
  let bestNz = 0;
  let hit = false;

  function recordHit(t, nx, nz) {
    const clampedT = t < 0 ? 0 : t;
    if (clampedT < bestT) {
      bestT = clampedT;
      bestNx = nx;
      bestNz = nz;
      hit = true;
    }
  }

  function testCircle(cx, cz, cr) {
    if (moveLenSq < 1e-12) return;
    const fx = ox - cx;
    const fz = oz - cz;
    const c = fx * fx + fz * fz - cr * cr;
    if (c <= 0) return; // origin-inside already handled before calling testCircle
    const b = 2 * (fx * dx + fz * dz);
    if (b >= 0) return; // moving away from circle center
    const disc = b * b - 4 * moveLenSq * c;
    if (disc < 0) return;
    const t = (-b - Math.sqrt(disc)) / (2 * moveLenSq);
    if (t >= 0 && t < bestT) {
      const hx = ox + dx * t;
      const hz = oz + dz * t;
      const invR = cr > 1e-9 ? 1 / cr : 0;
      recordHit(t, (hx - cx) * invR, (hz - cz) * invR);
    }
  }

  if (bounds) {
    const minX = bounds.minX + radius;
    const maxX = bounds.maxX - radius;
    const minZ = bounds.minZ + radius;
    const maxZ = bounds.maxZ - radius;
    if (ox < minX) recordHit(0, 1, 0);
    else if (tx < minX && dx < -1e-9) recordHit((minX - ox) / dx, 1, 0);
    if (ox > maxX) recordHit(0, -1, 0);
    else if (tx > maxX && dx > 1e-9) recordHit((maxX - ox) / dx, -1, 0);
    if (oz < minZ) recordHit(0, 0, 1);
    else if (tz < minZ && dz < -1e-9) recordHit((minZ - oz) / dz, 0, 1);
    if (oz > maxZ) recordHit(0, 0, -1);
    else if (tz > maxZ && dz > 1e-9) recordHit((maxZ - oz) / dz, 0, -1);
  }

  if (obstacles && obstacles.length) {
    for (let i = 0; i < obstacles.length; i++) {
      const b = obstacles[i];
      if (!obstacleActiveAtHeight(b, y, radius, footY)) continue;

      if (b.kind === 'segment') {
        const r = (b.halfThick ?? 0.034) + radius;
        const ax = b.ax, az = b.az, bx = b.bx, bz = b.bz;
        if (
          segMaxX < Math.min(ax, bx) - r ||
          segMinX > Math.max(ax, bx) + r ||
          segMaxZ < Math.min(az, bz) - r ||
          segMinZ > Math.max(az, bz) + r
        ) continue;

        const sx = bx - ax;
        const sz = bz - az;
        const sLenSq = sx * sx + sz * sz;
        const u0 = sLenSq > 1e-10 ? clamp(((ox - ax) * sx + (oz - az) * sz) / sLenSq, 0, 1) : 0;
        const cpx = ax + sx * u0;
        const cpz = az + sz * u0;
        const ex = ox - cpx;
        const ez = oz - cpz;
        const dSq = ex * ex + ez * ez;
        if (dSq < r * r - 1e-9) {
          if (dSq > 1e-10) {
            const d = Math.sqrt(dSq);
            recordHit(0, ex / d, ez / d);
          } else if (sLenSq > 1e-10) {
            const sLen = Math.sqrt(sLenSq);
            recordHit(0, -sz / sLen, sx / sLen);
          } else {
            recordHit(0, 1, 0);
          }
          continue;
        }

        testCircle(ax, az, r);
        testCircle(bx, bz, r);
        if (sLenSq > 1e-10) {
          const sLen = Math.sqrt(sLenSq);
          const snx = -sz / sLen;
          const snz = sx / sLen;
          const denom = dx * sz - dz * sx;
          if (Math.abs(denom) > 1e-9) {
            for (const sign of [-1, 1]) {
              const nx = snx * sign;
              const nz = snz * sign;
              if (dx * nx + dz * nz >= 0) continue;
              const px = ax + nx * r;
              const pz = az + nz * r;
              const qx = px - ox;
              const qz = pz - oz;
              const t = (qx * sz - qz * sx) / denom;
              const u = (qx * dz - qz * dx) / denom;
              if (t >= 0 && t < bestT && u >= 0 && u <= 1) {
                recordHit(t, nx, nz);
              }
            }
          }
        }
        continue;
      }

      const x0 = b.x0, x1 = b.x1, z0 = b.z0, z1 = b.z1;
      if (
        segMaxX < x0 - radius ||
        segMinX > x1 + radius ||
        segMaxZ < z0 - radius ||
        segMinZ > z1 + radius
      ) continue;

      // Origin already inside rounded AABB
      const cx = clamp(ox, x0, x1);
      const cz = clamp(oz, z0, z1);
      const ex = ox - cx;
      const ez = oz - cz;
      const dSq = ex * ex + ez * ez;
      if (dSq < radius * radius - 1e-9) {
        if (dSq > 1e-10) {
          const d = Math.sqrt(dSq);
          recordHit(0, ex / d, ez / d);
        } else {
          const dL = Math.abs(ox - x0);
          const dR = Math.abs(x1 - ox);
          const dT = Math.abs(oz - z0);
          const dB = Math.abs(z1 - oz);
          const m = Math.min(dL, dR, dT, dB);
          if (m === dL) recordHit(0, -1, 0);
          else if (m === dR) recordHit(0, 1, 0);
          else if (m === dT) recordHit(0, 0, -1);
          else recordHit(0, 0, 1);
        }
        continue;
      }

      // 4 flat faces of the rounded AABB
      if (dx > 1e-9) {
        const t = (x0 - radius - ox) / dx;
        if (t >= 0 && t < bestT) {
          const hz = oz + dz * t;
          if (hz >= z0 && hz <= z1) recordHit(t, -1, 0);
        }
      } else if (dx < -1e-9) {
        const t = (x1 + radius - ox) / dx;
        if (t >= 0 && t < bestT) {
          const hz = oz + dz * t;
          if (hz >= z0 && hz <= z1) recordHit(t, 1, 0);
        }
      }

      if (dz > 1e-9) {
        const t = (z0 - radius - oz) / dz;
        if (t >= 0 && t < bestT) {
          const hx = ox + dx * t;
          if (hx >= x0 && hx <= x1) recordHit(t, 0, -1);
        }
      } else if (dz < -1e-9) {
        const t = (z1 + radius - oz) / dz;
        if (t >= 0 && t < bestT) {
          const hx = ox + dx * t;
          if (hx >= x0 && hx <= x1) recordHit(t, 0, 1);
        }
      }

      // 4 corner arcs of radius `radius`
      testCircle(x0, z0, radius);
      testCircle(x1, z0, radius);
      testCircle(x0, z1, radius);
      testCircle(x1, z1, radius);
    }
  }

  return { t: bestT, nx: bestNx, nz: bestNz, hit };
}

function slideTargetAlongWalls(ax, az, tx, tz, y, radius, obstacles, bounds, footY) {
  const first = sweepCircle2D(ax, az, tx, tz, y, radius, obstacles, bounds, footY);
  if (!first.hit) {
    return {
      x: tx,
      z: tz,
      hit: false,
      t: 1,
      nx: 0,
      nz: 0,
      hx: tx,
      hz: tz,
      penetration: 0
    };
  }

  const dx = tx - ax;
  const dz = tz - az;
  const totalDist = Math.hypot(dx, dz);
  const hx = ax + dx * first.t;
  const hz = az + dz * first.t;
  const n1x = first.nx;
  const n1z = first.nz;

  // Slide desired target onto the hit plane with a tiny epsilon clearance.
  const into1 = (tx - hx) * n1x + (tz - hz) * n1z;
  let sx = tx - Math.min(0, into1) * n1x + n1x * 0.002;
  let sz = tz - Math.min(0, into1) * n1z + n1z * 0.002;

  const second = sweepCircle2D(ax, az, sx, sz, y, radius, obstacles, bounds, footY);
  if (second.hit) {
    const h2x = ax + (sx - ax) * second.t;
    const h2z = az + (sz - az) * second.t;
    const n2x = second.nx;
    const n2z = second.nz;
    const into2 = (sx - h2x) * n2x + (sz - h2z) * n2z;
    let cx = sx - Math.min(0, into2) * n2x + n2x * 0.002;
    let cz = sz - Math.min(0, into2) * n2z + n2z * 0.002;
    // Also keep outside plane 1 after sliding onto plane 2 (corner).
    const into1Again = (cx - hx) * n1x + (cz - hz) * n1z;
    if (into1Again < 0) {
      cx -= into1Again * n1x;
      cz -= into1Again * n1z;
    }
    const third = sweepCircle2D(ax, az, cx, cz, y, radius, obstacles, bounds, footY);
    if (third.hit) {
      sx = ax + (cx - ax) * third.t;
      sz = az + (cz - az) * third.t;
    } else {
      sx = cx;
      sz = cz;
    }
    // Average normal for corner guidance
    const avgX = n1x + n2x;
    const avgZ = n1z + n2z;
    const avgLen = Math.hypot(avgX, avgZ);
    return {
      x: sx,
      z: sz,
      hit: true,
      t: first.t,
      nx: avgLen > 1e-5 ? avgX / avgLen : n1x,
      nz: avgLen > 1e-5 ? avgZ / avgLen : n1z,
      wallNx: n1x,
      wallNz: n1z,
      hx,
      hz,
      penetration: Math.max((1 - first.t) * totalDist, Math.hypot(tx - sx, tz - sz))
    };
  }

  return {
    x: sx,
    z: sz,
    hit: true,
    t: first.t,
    nx: n1x,
    nz: n1z,
    wallNx: n1x,
    wallNz: n1z,
    hx,
    hz,
    penetration: Math.max((1 - first.t) * totalDist, Math.hypot(tx - sx, tz - sz))
  };
}

function resolveStreetPassHandTarget({
  side,
  anchorX,
  anchorZ,
  torsoX,
  torsoZ,
  desiredX,
  desiredY,
  desiredZ,
  fx,
  fz,
  rx,
  rz,
  handRadius,
  rOrbit,
  prevSign,
  obstacles,
  bounds,
  footY
}) {
  const slide = slideTargetAlongWalls(
    anchorX,
    anchorZ,
    desiredX,
    desiredZ,
    desiredY,
    handRadius,
    obstacles,
    bounds,
    footY
  );
  if (!slide.hit) {
    return { x: desiredX, y: desiredY, z: desiredZ, hit: false, wrapSign: 0 };
  }

  const wnx = slide.wallNx ?? slide.nx;
  const wnz = slide.wallNz ?? slide.nz;
  const sideDirX = -side * rx; // left arm (+1) -> -right; right arm (-1) -> +right
  const sideDirZ = -side * rz;
  const sideWallPush = wnx * (-sideDirX) + wnz * (-sideDirZ);
  const uN = (slide.hx - torsoX) * wnx + (slide.hz - torsoZ) * wnz;
  const dTorso = Math.hypot(slide.x - torsoX, slide.z - torsoZ);

  // If the wall does not intrude into the torso envelope on this hand's side (mild proximity,
  // pure front wall, or pure back wall), sliding along the wall plane keeps the hand outside both.
  const wallClipsTorsoSide = sideWallPush > 0.25 && Math.abs(uN) < rOrbit - 0.015;
  if (!wallClipsTorsoSide && dTorso >= rOrbit - 0.015) {
    const gentleLift = clamp(slide.penetration / 0.35, 0, 1) * 0.025;
    return { x: slide.x, y: desiredY + gentleLift, z: slide.z, hit: true, wrapSign: prevSign };
  }

  // Wall pushes hand inside torso envelope -> wrap smoothly along the wall around the torso.
  const wallIntrusion = Math.max(rOrbit - dTorso, rOrbit - Math.abs(uN));
  const tuckRatio = clamp(wallIntrusion / 0.32, 0, 1);
  const targetY = desiredY + 0.065 * tuckRatio;

  const bx = -fx;
  const bz = -fz;

  // Tangent pointing toward body-back (+B) so the tucked hand stays clearly visible from 3rd-person camera.
  let tBackX = -wnz;
  let tBackZ = wnx;
  if (tBackX * bx + tBackZ * bz < 0) {
    tBackX = -tBackX;
    tBackZ = -tBackZ;
  }

  const clampedUN = clamp(uN, -rOrbit, rOrbit);
  const uT = Math.sqrt(Math.max(0, rOrbit * rOrbit - clampedUN * clampedUN));
  const baseX = torsoX + wnx * (uN + 0.002);
  const baseZ = torsoZ + wnz * (uN + 0.002);

  // Subtle gait follow-through along the wall away from the torso without flipping sides on stride swings.
  const swingAlongBack = (desiredX - torsoX) * tBackX + (desiredZ - torsoZ) * tBackZ;
  const extraBack = clamp(swingAlongBack * 0.10, 0, 0.045);
  const extraFront = clamp(-swingAlongBack * 0.10, 0, 0.045);

  const backCand = {
    x: baseX + tBackX * (uT + extraBack),
    z: baseZ + tBackZ * (uT + extraBack),
    sign: 1
  };
  const frontCand = {
    x: baseX - tBackX * (uT + extraFront),
    z: baseZ - tBackZ * (uT + extraFront),
    sign: -1
  };

  // Decide wrap side from body orientation relative to the wall (independent of walking bob/crouch),
  // biased toward back-hip when parallel to a wall, with hysteresis to prevent spin flicker.
  const sideAlongBack = sideDirX * tBackX + sideDirZ * tBackZ;
  const preferBack = (sideAlongBack + 0.28 + prevSign * 0.16) >= 0;
  const ordered = preferBack ? [backCand, frontCand] : [frontCand, backCand];

  for (const cand of ordered) {
    const check = sweepCircle2D(
      anchorX,
      anchorZ,
      cand.x,
      cand.z,
      targetY,
      handRadius,
      obstacles,
      bounds,
      footY
    );
    if (!check.hit) {
      return { x: cand.x, y: targetY, z: cand.z, hit: true, wrapSign: cand.sign };
    }
  }

  // Tight corner / multi-wall squeeze: search a ring around the torso for the best clear point.
  const prefDirX = preferBack ? tBackX : -tBackX;
  const prefDirZ = preferBack ? tBackZ : -tBackZ;

  let best = null;
  let bestScore = -Infinity;
  const rings = [
    { rad: rOrbit, y: targetY, penalty: 0 },
    { rad: rOrbit * 0.86, y: desiredY + 0.16, penalty: 0.35 }
  ];

  for (const ring of rings) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const ux = Math.cos(a);
      const uz = Math.sin(a);
      const cx = torsoX + ux * ring.rad;
      const cz = torsoZ + uz * ring.rad;
      const check = sweepCircle2D(
        anchorX,
        anchorZ,
        cx,
        cz,
        ring.y,
        handRadius,
        obstacles,
        bounds,
        footY
      );
      const px = anchorX + (cx - anchorX) * check.t;
      const pz = anchorZ + (cz - anchorZ) * check.t;
      const distFromTorso = Math.hypot(px - torsoX, pz - torsoZ);
      const clearBonus = check.hit ? check.t * 1.5 : 3.0;
      const torsoClearBonus = clamp(distFromTorso / ring.rad, 0, 1) * 1.2;
      const prefAlign = ux * prefDirX + uz * prefDirZ;
      const sideAlign = ux * sideDirX + uz * sideDirZ;
      const score = clearBonus + torsoClearBonus + prefAlign * 0.45 + sideAlign * 0.25 - ring.penalty;
      if (score > bestScore) {
        bestScore = score;
        const alongBack = (px - torsoX) * tBackX + (pz - torsoZ) * tBackZ;
        best = {
          x: px,
          y: ring.y,
          z: pz,
          hit: true,
          wrapSign: alongBack >= 0 ? 1 : -1
        };
      }
    }
  }

  return best || { x: slide.x, y: targetY, z: slide.z, hit: true, wrapSign: prevSign };
}

function getDoorAvoidCap(door, side) {
  if (!door) return 1;
  if (door.kind === 'slam') return clamp(1 - (door.slamHit || 0), 0, 1);
  const w = side > 0 ? (door.leftWeight || 0) : (door.rightWeight || 0);
  return clamp(1 - w, 0, 1);
}

/**
 * Resolves StreetPass floating hands against nearby walls/obstacles and smooths transitions.
 * Must be called immediately after `applyStreetPassPose` while rigHolder holds current placement.
 */
export function applyStreetPassArmAvoidance(bones, pose, state, {
  dt = 0,
  obstacles = null,
  bounds = worldBounds,
  reducedMotion = false,
  snap = false
} = {}) {
  if (!bones || (!obstacles && !bounds)) return false;
  const rootParent = bones.rootPs?.parent || bones.bodyPs?.parent;
  if (!rootParent) return false;
  rootParent.updateMatrixWorld(true);

  const facingYaw = pose.bodyYaw ?? pose.yaw ?? 0;
  const fx = -Math.sin(facingYaw);
  const fz = -Math.cos(facingYaw);
  const rx = Math.cos(facingYaw);
  const rz = -Math.sin(facingYaw);

  const anchorX = pose.x ?? 0;
  const anchorZ = pose.z ?? 0;
  const footY = pose.jump ? pose.jump.height : 0;

  // Read actual torso world center and scale from the skeleton.
  bones.bodyPs.getWorldPosition(_vA);
  const torsoX = _vA.x;
  const torsoZ = _vA.z;
  bones.bodyPs.getWorldScale(_vB);
  const worldScale = _vB && Number.isFinite(_vB.x) && _vB.x > 0.001 ? _vB.x : STREETPASS_BASE_WORLD_SCALE;
  const scaleFactor = clamp(worldScale / STREETPASS_BASE_WORLD_SCALE, 0.5, 2.0);
  const handRadius = STREETPASS_HAND_RADIUS * scaleFactor;
  const rOrbit = STREETPASS_TORSO_ORBIT * scaleFactor;
  const minHandSep = STREETPASS_HAND_SEP * scaleFactor;

  const door = analyzeDoorInteraction(pose);
  const safeDt = Math.min(Math.max(0, dt), 0.08);
  const immediate = snap || reducedMotion || safeDt <= 0.0001;

  const spState = state?.streetpass;
  const resolved = {};

  for (const [key, side, bone] of [
    ['left', 1, bones.handLPs],
    ['right', -1, bones.handRPs]
  ]) {
    if (!bone || !bone.parent) continue;
    const hState = spState?.[key];
    const avoidCap = getDoorAvoidCap(door, side);
    bone.getWorldPosition(_vC);
    const desX = _vC.x;
    const desY = _vC.y;
    const desZ = _vC.z;

    let targetX = desX;
    let targetY = desY;
    let targetZ = desZ;
    let wrapSign = 0;
    let hit = false;

    if (avoidCap > 0.01) {
      const res = resolveStreetPassHandTarget({
        side,
        anchorX,
        anchorZ,
        torsoX,
        torsoZ,
        desiredX: desX,
        desiredY: desY,
        desiredZ: desZ,
        fx,
        fz,
        rx,
        rz,
        handRadius,
        rOrbit,
        prevSign: hState?.wrapSign || 0,
        obstacles,
        bounds,
        footY
      });
      hit = res.hit;
      wrapSign = res.wrapSign;
      targetX = lerp(desX, res.x, avoidCap);
      targetY = lerp(desY, res.y, avoidCap);
      targetZ = lerp(desZ, res.z, avoidCap);
    }

    // Smooth body-relative safe position and avoidance blend separately so gait arm swing
    // does not create lag or overshoot while running along a wall.
    const desRelX = desX - torsoX;
    const desRelZ = desZ - torsoZ;
    const desRelR = desRelX * rx + desRelZ * rz;
    const desRelY = desY - footY;
    const desRelF = desRelX * fx + desRelZ * fz;

    const tgtRelX = targetX - torsoX;
    const tgtRelZ = targetZ - torsoZ;
    const tgtRelR = tgtRelX * rx + tgtRelZ * rz;
    const tgtRelY = targetY - footY;
    const tgtRelF = tgtRelX * fx + tgtRelZ * fz;

    const activeHit = hit && avoidCap > 0.01;
    let useRelR = activeHit ? tgtRelR : desRelR;
    let useRelY = activeHit ? tgtRelY : desRelY;
    let useRelF = activeHit ? tgtRelF : desRelF;
    let activeBlend = activeHit ? 1 : 0;

    if (hState) {
      if (immediate || !hState.initialized) {
        hState.blend = activeHit ? 1 : 0;
        hState.relR = activeHit ? tgtRelR : desRelR;
        hState.relY = activeHit ? tgtRelY : desRelY;
        hState.relF = activeHit ? tgtRelF : desRelF;
        hState.initialized = true;
      } else if (activeHit) {
        const posAlpha = 1 - Math.exp(-22 * safeDt);
        if (hState.blend < 0.05) {
          hState.relR = desRelR;
          hState.relY = desRelY;
          hState.relF = desRelF;
        }
        hState.blend = 1;
        hState.relR += (tgtRelR - hState.relR) * posAlpha;
        hState.relY += (tgtRelY - hState.relY) * posAlpha;
        hState.relF += (tgtRelF - hState.relF) * posAlpha;
      } else {
        const relAlpha = 1 - Math.exp(-10 * safeDt);
        hState.blend = Math.max(0, hState.blend * (1 - relAlpha));
        if (hState.blend < 0.005) {
          hState.blend = 0;
          hState.relR = desRelR;
          hState.relY = desRelY;
          hState.relF = desRelF;
        }
      }
      hState.wrapSign = activeHit ? wrapSign : 0;
      activeBlend = hState.blend;
      useRelR = lerp(desRelR, hState.relR, activeBlend);
      useRelY = lerp(desRelY, hState.relY, activeBlend);
      useRelF = lerp(desRelF, hState.relF, activeBlend);
    }

    let finalX = torsoX + rx * useRelR + fx * useRelF;
    let finalY = footY + useRelY;
    let finalZ = torsoZ + rz * useRelR + fz * useRelF;

    // Hard anti-clipping safety clamp on the smoothed hand so fast strafes/turns never penetrate walls.
    if (avoidCap > 0.01) {
      const verify = sweepCircle2D(anchorX, anchorZ, finalX, finalZ, finalY, handRadius, obstacles, bounds, footY);
      if (verify.hit) {
        finalX = targetX;
        finalY = targetY;
        finalZ = targetZ;
        if (hState) {
          hState.blend = activeHit ? 1 : hState.blend;
          hState.relR = tgtRelR;
          hState.relY = tgtRelY;
          hState.relF = tgtRelF;
        }
      } else if (activeBlend > 0.01) {
        // Also keep the smoothed arc from slicing through the torso during rapid rotations.
        const dFromTorso = Math.hypot(finalX - torsoX, finalZ - torsoZ);
        const minArc = rOrbit - 0.02;
        if (dFromTorso < minArc && dFromTorso > 1e-4) {
          const pushScale = minArc / dFromTorso;
          const pushedX = torsoX + (finalX - torsoX) * pushScale;
          const pushedZ = torsoZ + (finalZ - torsoZ) * pushScale;
          const checkPush = sweepCircle2D(anchorX, anchorZ, pushedX, pushedZ, finalY, handRadius, obstacles, bounds, footY);
          if (!checkPush.hit) {
            finalX = pushedX;
            finalZ = pushedZ;
          }
        }
      }
    }

    resolved[key] = { bone, x: finalX, y: finalY, z: finalZ, hit: activeHit, activeBlend, avoidCap };
  }

  // Keep both hands from overlapping each other in ultra-narrow squeezes.
  if (resolved.left && resolved.right && (resolved.left.hit || resolved.right.hit)) {
    const lx = resolved.left.x, ly = resolved.left.y, lz = resolved.left.z;
    const rpx = resolved.right.x, rpy = resolved.right.y, rpz = resolved.right.z;
    const sepXZ = Math.hypot(lx - rpx, lz - rpz);
    if (sepXZ < minHandSep && Math.abs(ly - rpy) < 0.24) {
      const need = (minHandSep - sepXZ) * 0.52;
      const sx = sepXZ > 1e-4 ? (lx - rpx) / sepXZ : -rx;
      const sz = sepXZ > 1e-4 ? (lz - rpz) / sepXZ : -rz;
      const candLx = lx + sx * need;
      const candLz = lz + sz * need;
      const candRx = rpx - sx * need;
      const candRz = rpz - sz * need;
      if (!sweepCircle2D(anchorX, anchorZ, candLx, candLz, ly, handRadius, obstacles, bounds, footY).hit) {
        resolved.left.x = candLx;
        resolved.left.z = candLz;
      }
      if (!sweepCircle2D(anchorX, anchorZ, candRx, candRz, rpy, handRadius, obstacles, bounds, footY).hit) {
        resolved.right.x = candRx;
        resolved.right.z = candRz;
      }
      // If walls still pin them close together horizontally, stagger vertically slightly.
      if (Math.hypot(resolved.left.x - resolved.right.x, resolved.left.z - resolved.right.z) < minHandSep * 0.88) {
        resolved.left.y += 0.08;
        resolved.right.y -= 0.04;
      }
    }
  }

  let movedAny = false;
  for (const key of ['left', 'right']) {
    const entry = resolved[key];
    if (!entry) continue;
    if (entry.hit || entry.activeBlend > 0.005) {
      _vLocal.set(entry.x, entry.y, entry.z);
      entry.bone.parent.worldToLocal(_vLocal);
      entry.bone.position.copy(_vLocal);
      movedAny = true;
    }
  }

  if (movedAny) rootParent.updateMatrixWorld(true);
  return movedAny;
}

/**
 * Resolves Switch articulated arms (elbow + wrist/hand) against nearby walls/obstacles
 * using 2-bone IK with an inward-shifted elbow pole so neither forearm nor hand clips walls.
 */
export function applySwitchArmAvoidance(bones, pose, state, {
  dt = 0,
  obstacles = null,
  bounds = worldBounds,
  reducedMotion = false,
  snap = false
} = {}) {
  if (!bones || !bones.chest || (!obstacles && !bounds)) return false;
  const rootParent = bones.skl_root?.parent || bones.chest.parent;
  if (!rootParent) return false;
  rootParent.updateMatrixWorld(true);

  const facingYaw = pose.bodyYaw ?? pose.yaw ?? 0;
  const fx = -Math.sin(facingYaw);
  const fz = -Math.cos(facingYaw);
  const rx = Math.cos(facingYaw);
  const rz = -Math.sin(facingYaw);

  const anchorX = pose.x ?? 0;
  const anchorZ = pose.z ?? 0;
  const footY = pose.jump ? pose.jump.height : 0;

  bones.chest.getWorldScale(_vD);
  const worldScale = _vD && Number.isFinite(_vD.x) && _vD.x > 0.001 ? _vD.x : SWITCH_BASE_WORLD_SCALE;
  const scaleFactor = clamp(worldScale / SWITCH_BASE_WORLD_SCALE, 0.5, 2.0);
  const handRadius = SWITCH_HAND_RADIUS * scaleFactor;
  const elbowRadius = SWITCH_ELBOW_RADIUS * scaleFactor;

  const door = analyzeDoorInteraction(pose);
  const safeDt = Math.min(Math.max(0, dt), 0.08);
  const immediate = snap || reducedMotion || safeDt <= 0.0001;
  const swState = state?.switch;

  let movedAny = false;

  for (const [key, side, arm1, arm2, wrist] of [
    ['left', 1, bones.arm_l1, bones.arm_l2, bones.wrist_l],
    ['right', -1, bones.arm_r1, bones.arm_r2, bones.wrist_r]
  ]) {
    if (!arm1 || !arm2 || !wrist) continue;
    const aState = swState?.[key];
    const avoidCap = getDoorAvoidCap(door, side);

    arm1.getWorldPosition(_vA); // shoulder
    arm2.getWorldPosition(_vB); // elbow
    wrist.getWorldPosition(_vC); // wrist
    const elbowX = _vB.x, elbowY = _vB.y, elbowZ = _vB.z;

    // Palm/knuckle tip matches solveSwitchArmIK L2 = 20.3 (3.5 rig units past wrist at 16.8).
    const fdx = _vC.x - elbowX;
    const fdy = _vC.y - elbowY;
    const fdz = _vC.z - elbowZ;
    const fLen = Math.hypot(fdx, fdy, fdz);
    const tipExt = 0.045 * scaleFactor;
    const handX = _vC.x + (fLen > 1e-4 ? (fdx / fLen) * tipExt : 0);
    const handY = _vC.y + (fLen > 1e-4 ? (fdy / fLen) * tipExt : -tipExt);
    const handZ = _vC.z + (fLen > 1e-4 ? (fdz / fLen) * tipExt : 0);

    const handHit = avoidCap > 0.01
      ? sweepCircle2D(anchorX, anchorZ, handX, handZ, handY, handRadius, obstacles, bounds, footY)
      : { hit: false, t: 1, nx: 0, nz: 0 };
    const elbowHit = avoidCap > 0.01
      ? sweepCircle2D(anchorX, anchorZ, elbowX, elbowZ, elbowY, elbowRadius, obstacles, bounds, footY)
      : { hit: false, t: 1, nx: 0, nz: 0 };

    const blocked = handHit.hit || elbowHit.hit;

    // Nominal local target (used when easing out back to idle/gait).
    _vLocal.set(handX, handY, handZ);
    bones.chest.worldToLocal(_vLocal);
    let targetLx = _vLocal.x;
    let targetLy = _vLocal.y;
    let targetLz = _vLocal.z;
    let targetPx = side * 0.45;
    let targetPy = -1.0;
    let targetPz = -0.35;
    let targetRoll = 0;
    let targetBlend = 0;

    if (blocked) {
      const slide = slideTargetAlongWalls(
        anchorX,
        anchorZ,
        handX,
        handZ,
        handY,
        handRadius,
        obstacles,
        bounds,
        footY
      );
      const nx = slide.hit ? slide.nx : elbowHit.nx;
      const nz = slide.hit ? slide.nz : elbowHit.nz;

      // Measure how strongly the wall pushes inward from this arm's outer side.
      // Left arm (side=+1) inward is +Right; right arm (side=-1) inward is -Right.
      const inwardDot = nx * (side * rx) + nz * (side * rz);
      const sidePush = clamp(inwardDot, 0, 1);
      const backWallPush = clamp(nx * fx + nz * fz, 0, 1);

      const elbowPen = elbowHit.hit ? (1 - elbowHit.t) * Math.hypot(elbowX - anchorX, elbowZ - anchorZ) : 0;
      const pen = Math.max(slide.penetration, elbowPen);
      const wallClose = clamp(pen / 0.075, 0, 1);

      // Pull hand inside safe side of wall, with natural upward/forward elbow tuck along side walls.
      let wx = slide.x;
      let wz = slide.z;
      let wy = handY + (0.18 * sidePush + 0.05 * (1 - sidePush)) * wallClose;

      if (sidePush > 0.25 && wallClose > 0.05) {
        // Step slightly forward along the wall so the forearm bends neatly in front of the hip/chest.
        const fwdShift = 0.11 * sidePush * wallClose;
        const candX = wx + fx * fwdShift;
        const candZ = wz + fz * fwdShift;
        const fwdCheck = slideTargetAlongWalls(anchorX, anchorZ, candX, candZ, wy, handRadius, obstacles, bounds, footY);
        wx = fwdCheck.x;
        wz = fwdCheck.z;
      }

      // If only the elbow clipped (e.g. grazing wall with bent arm), nudge hand slightly inward too.
      if (!slide.hit && elbowHit.hit) {
        const pull = elbowPen + 0.02;
        const candX = handX + elbowHit.nx * pull;
        const candZ = handZ + elbowHit.nz * pull;
        const c = slideTargetAlongWalls(anchorX, anchorZ, candX, candZ, wy, handRadius, obstacles, bounds, footY);
        wx = c.x;
        wz = c.z;
      }

      _vLocal.set(wx, wy, wz);
      bones.chest.worldToLocal(_vLocal);
      targetLx = _vLocal.x;
      targetLy = _vLocal.y;
      targetLz = _vLocal.z;

      // Shift elbow pole inward away from side walls (and forward away from back walls).
      const inwardPole = lerp(side * 0.45, -side * 0.14, clamp(sidePush + (elbowHit.hit ? 0.5 : 0), 0, 1));
      targetPx = inwardPole;
      targetPy = -1.0;
      targetPz = lerp(-0.38, 0.30, backWallPush);
      targetRoll = 0.28 * sidePush * wallClose;
      targetBlend = avoidCap;
    }

    let useBlend = targetBlend;
    let useLx = targetLx, useLy = targetLy, useLz = targetLz;
    let usePx = targetPx, usePy = targetPy, usePz = targetPz;
    let useRoll = targetRoll;

    if (aState) {
      if (immediate || !aState.initialized) {
        aState.blend = targetBlend;
        aState.tx = targetLx;
        aState.ty = targetLy;
        aState.tz = targetLz;
        aState.px = targetPx;
        aState.py = targetPy;
        aState.pz = targetPz;
        aState.wristRoll = targetRoll;
        aState.initialized = true;
      } else {
        if (blocked && avoidCap > 0.5) {
          // Immediately engage IK weight when in contact (target itself ramps continuously from nominal hand).
          aState.blend = Math.max(aState.blend, targetBlend);
        } else {
          const blendRate = targetBlend > aState.blend ? 26 : 10;
          const bAlpha = 1 - Math.exp(-blendRate * safeDt);
          aState.blend += (targetBlend - aState.blend) * bAlpha;
        }
        const posRate = blocked ? 24 : 12;
        const pAlpha = 1 - Math.exp(-posRate * safeDt);
        aState.tx += (targetLx - aState.tx) * pAlpha;
        aState.ty += (targetLy - aState.ty) * pAlpha;
        aState.tz += (targetLz - aState.tz) * pAlpha;
        aState.px += (targetPx - aState.px) * pAlpha;
        aState.py += (targetPy - aState.py) * pAlpha;
        aState.pz += (targetPz - aState.pz) * pAlpha;
        aState.wristRoll += (targetRoll - aState.wristRoll) * pAlpha;

        // Hard anti-clipping clamp when actively blocked so rapid approach never penetrates.
        if (blocked && avoidCap > 0.5) {
          _vLocal.set(aState.tx, aState.ty, aState.tz);
          bones.chest.localToWorld(_vLocal);
          if (sweepCircle2D(anchorX, anchorZ, _vLocal.x, _vLocal.z, _vLocal.y, handRadius, obstacles, bounds, footY).hit) {
            aState.tx = targetLx;
            aState.ty = targetLy;
            aState.tz = targetLz;
            aState.px = targetPx;
            aState.py = targetPy;
            aState.pz = targetPz;
          }
        }
      }
      useBlend = aState.blend;
      useLx = aState.tx;
      useLy = aState.ty;
      useLz = aState.tz;
      usePx = aState.px;
      usePy = aState.py;
      usePz = aState.pz;
      useRoll = aState.wristRoll;
    }

    if (useBlend > 0.005) {
      _vLocal.set(useLx, useLy, useLz);
      _vD.set(usePx, usePy, usePz);
      solveSwitchArmIK(bones, side, _vLocal, useBlend, useRoll, _vD);
      movedAny = true;
    }
  }

  if (movedAny) rootParent.updateMatrixWorld(true);
  return movedAny;
}
