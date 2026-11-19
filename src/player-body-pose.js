import { Matrix4, Quaternion, Vector3 } from 'three';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export const PLAYER_BODY_STYLES = ['streetpass', 'switch', 'hidden'];

export const PLAYER_BODY_CONFIG = {
  streetpass: {
    scaleX: 0.10,
    scaleY: 0.122,
    scaleZ: 0.10,
    baseY: -0.14,
    backOffset: 0.16,
    tpScale: 0.098,
    tpBaseY: -0.04,
    headScale: 0.72
  },
  switch: {
    scaleX: 0.094,
    scaleY: 0.118,
    scaleZ: 0.094,
    baseY: 0,
    backOffset: 0.21,
    tpScale: 0.095,
    tpBaseY: 0,
    headScale: 0.78
  }
};

export function computePlayerBodyPlacement(pose, style, { inspecting = false, hasStarted = true } = {}) {
  const cfg = PLAYER_BODY_CONFIG[style];
  const visible = Boolean(cfg) && hasStarted && !pose.noclip && !inspecting;
  const facingYaw = pose.bodyYaw ?? pose.yaw;
  const fx = -Math.sin(pose.yaw);
  const fz = -Math.cos(pose.yaw);
  const rx = Math.cos(pose.yaw);
  const rz = -Math.sin(pose.yaw);
  const tpBlend = clamp(pose.thirdPersonBlend ?? (pose.thirdPerson ? 1 : 0), 0, 1);
  const backOffset = cfg ? cfg.backOffset * (1 - tpBlend) : 0;
  const swayX = pose.offsetX * 0.35 * (1 - tpBlend);
  const baseY = cfg ? cfg.baseY + (cfg.tpBaseY - cfg.baseY) * tpBlend : 0;
  const jumpHeight = pose.jump ? pose.jump.height : 0;

  return {
    visible,
    x: pose.x - fx * backOffset + rx * swayX,
    y: baseY + jumpHeight,
    z: pose.z - fz * backOffset + rz * swayX,
    rotationY: facingYaw + Math.PI,
    scaleX: cfg ? cfg.scaleX + (cfg.tpScale - cfg.scaleX) * tpBlend : 1,
    scaleY: cfg ? cfg.scaleY + (cfg.tpScale - cfg.scaleY) * tpBlend : 1,
    scaleZ: cfg ? cfg.scaleZ + (cfg.tpScale - cfg.scaleZ) * tpBlend : 1
  };
}

const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

export function computeGaitMetrics(pose) {
  const facingYaw = pose.bodyYaw ?? pose.yaw;
  const fx = -Math.sin(facingYaw);
  const fz = -Math.cos(facingYaw);
  const rx = Math.cos(facingYaw);
  const rz = -Math.sin(facingYaw);
  const fwdVel = pose.vx * fx + pose.vz * fz;
  const sideVel = pose.vx * rx + pose.vz * rz;
  const speed = Math.hypot(pose.vx, pose.vz);
  const moveBlend = clamp(speed / 2.45, 0, 1.8);
  const moveUnit = Math.min(1, moveBlend);
  const speedSprint = clamp((speed - 2.65) / (4.35 - 2.65), 0, 1);
  const sprintBlend = pose.isSprinting
    ? Math.max(speedSprint, 0.35 + 0.65 * speedSprint)
    : speedSprint * 0.7;
  const exhausted = Boolean(pose.exhausted);
  const exhaustionBlend = clamp(
    Math.max(exhausted ? 0.85 : 0, ((pose.exertion || 0) - 0.45) / 0.55),
    0,
    1
  );

  const fwdDrive = clamp(fwdVel / 2.45, -1.2, 1.8);
  const sideDrive = clamp(sideVel / 2.45, -1.5, 1.5);
  const sagittalWeight = speed > 0.05 ? Math.abs(fwdVel) / speed : 1;
  const lateralWeight = speed > 0.05 ? Math.abs(sideVel) / speed : 0;
  const backBlend = fwdVel < 0 ? clamp(-fwdVel / Math.max(0.45, speed), 0, 1) : 0;

  const jump = pose.jump;
  const airborne = Boolean(jump && !jump.grounded);
  const velYNorm = jump ? clamp((jump.velY || 0) / 4.95, -1, 1) : 0;
  const landSide = jump && jump.landSide ? Math.sign(jump.landSide) : 1;
  let landDip = 0;
  let lightImpact = 0;
  let stumbleBrace = 0;
  let stumbleWobble = 0;
  if (jump && jump.grounded && jump.landDuration > 0 && jump.landTimer < jump.landDuration) {
    const t = jump.landTimer;
    const u = clamp(t / jump.landDuration, 0, 1);
    if (jump.landedHeavy) {
      const hit = smoothstep(0, 0.11, t);
      const fade = 1 - smoothstep(0.60, 1.0, u);
      stumbleBrace = hit * fade;
      stumbleWobble = stumbleBrace * Math.sin(t * 9.5) * Math.exp(-t * 2.1);
      landDip = 0.14 * Math.sin(u * Math.PI) * Math.exp(-u * 2.2);
    } else {
      lightImpact = Math.sin(Math.min(1, t / 0.24) * Math.PI) * Math.exp(-t * 6.8);
      landDip = 0.065 * lightImpact;
    }
  }
  const limpBlend = jump && jump.stumbleCooldown > 0
    ? clamp(jump.stumbleCooldown / 2.8, 0, 1)
    : 0;
  const turnRate = clamp(pose.turnRate || 0, -8, 8);

  return {
    fwdVel,
    sideVel,
    speed,
    moveBlend,
    moveUnit,
    sprintBlend,
    exhausted,
    exhaustionBlend,
    fwdDrive,
    sideDrive,
    sagittalWeight,
    lateralWeight,
    backBlend,
    landDip,
    lightImpact,
    stumbleBrace,
    stumbleWobble,
    limpBlend,
    landSide,
    velYNorm,
    airborne,
    turnRate
  };
}

const _vA = new Vector3();
const _vB = new Vector3();
const _vC = new Vector3();
const _vD = new Vector3();
const _vE = new Vector3();
const _vF = new Vector3();
const _m4 = new Matrix4();
const _qIK = new Quaternion();
const _vTarget = new Vector3();

export function analyzeDoorInteraction(pose) {
  const di = pose.doorInteraction;
  if (!di || !di.intensity || di.intensity <= 0.005) return null;
  const w = clamp(di.intensity, 0, 1);
  if (di.kind === 'slam') {
    const p = clamp(di.progress || 0, 0, 1);
    const slamHit = smoothstep(0, 0.14, p) * (1 - smoothstep(0.45, 1.0, p)) * w;
    if (slamHit <= 0.005) return null;
    return {
      kind: 'slam',
      slamHit,
      slamSide: di.slamSide >= 0 ? 1 : -1,
      grabBlend: 0
    };
  }
  if (!di.handlePos) return null;
  const facingYaw = pose.bodyYaw ?? pose.yaw ?? 0;
  const fx = -Math.sin(facingYaw);
  const fz = -Math.cos(facingYaw);
  const rx = Math.cos(facingYaw);
  const rz = -Math.sin(facingYaw);
  const hp = di.handlePos;
  const toHx = hp.x - (pose.x || 0);
  const toHz = hp.z - (pose.z || 0);
  const localRight = toHx * rx + toHz * rz;
  const localFwd = toHx * fx + toHz * fz;
  const horizDist = Math.hypot(localRight, localFwd);
  const handleAngle = clamp(Math.atan2(localRight, Math.max(0.18, localFwd)), -0.9, 0.9);
  const startSide = di.startSide === 1 || di.startSide === -1
    ? di.startSide
    : (localRight < -0.46 ? 1 : -1); // 1 = Left arm, -1 = Right arm (preserve dominant hand)
  const rightWeight = (startSide < 0 ? 1 : 0) * w;
  const leftWeight = (startSide > 0 ? 1 : 0) * w;
  const grabSide = startSide;
  const pushPulse = di.kind === 'grab' ? clamp(di.pushPulse || 0, 0, 1) * w : 0;
  const rattleShake = di.kind === 'locked' ? Math.sin((di.progress || 0) * 24) * 0.024 : 0;
  const unlatchTwist = di.kind === 'grab'
    ? Math.sin(clamp((di.progress || 0) * 1.9, 0, 1) * Math.PI) * 0.42
    : Math.sin((di.progress || 0) * 24) * 0.25;
  return {
    kind: di.kind,
    grabBlend: w,
    pushPulse,
    slamHit: 0,
    grabSide,
    leftWeight,
    rightWeight,
    localRight: localRight + rattleShake,
    localFwd,
    horizDist,
    handleAngle,
    unlatchTwist,
    handleWorld: { x: hp.x + rx * rattleShake, y: hp.y, z: hp.z + rz * rattleShake }
  };
}

export function solveSwitchArmIK(bones, side, targetLocal, blend, wristRoll = 0, poleOverride = null) {
  const arm1 = side > 0 ? bones.arm_l1 : bones.arm_r1;
  const arm2 = side > 0 ? bones.arm_l2 : bones.arm_r2;
  const wrist = side > 0 ? bones.wrist_l : bones.wrist_r;
  if (!arm1 || !arm2) return;

  const S = _vA.set(side * 8.4, 24.5, 0);
  const L1 = 16.8;
  const L2 = 20.3;
  const toTarget = _vB.copy(targetLocal).sub(S);
  const rawD = toTarget.length();
  const d = clamp(rawD, 6.0, L1 + L2 - 0.05);
  const dir = rawD > 1e-4 ? toTarget.divideScalar(rawD) : _vB.set(0, 0, 1);
  const targetClamped = _vC.copy(S).addScaledVector(dir, d);

  const cosElbow = clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -0.995, 0.995);
  const bend = Math.PI - Math.acos(cosElbow);
  const cosAlpha = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -0.995, 0.995);
  const alpha = Math.acos(cosAlpha);

  const pole = poleOverride
    ? _vD.set(poleOverride.x, poleOverride.y, poleOverride.z).normalize()
    : _vD.set(side * 0.45, -1.0, -0.35).normalize();
  const perp = pole.addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-5) perp.set(0, -1, 0);
  perp.normalize();

  const u = _vE.copy(dir).multiplyScalar(Math.cos(alpha)).addScaledVector(perp, Math.sin(alpha)).normalize();
  const elbowPos = _vF.copy(S).addScaledVector(u, L1);
  const forearmDir = targetClamped.sub(elbowPos).normalize();
  const e2 = forearmDir.addScaledVector(u, -forearmDir.dot(u));
  if (e2.lengthSq() < 1e-5) e2.set(0, 0, 1);
  e2.normalize();

  const xAxis = side > 0 ? u : _vF.copy(u).negate();
  const yAxis = _vD.crossVectors(e2, xAxis).normalize();
  _m4.makeBasis(xAxis, yAxis, e2);
  _qIK.setFromRotationMatrix(_m4);

  arm1.quaternion.slerp(_qIK, blend);
  const targetElbowY = -side * bend;
  arm2.rotation.y = lerp(arm2.rotation.y, targetElbowY, blend);
  if (wrist) {
    wrist.rotation.set(lerp(wrist.rotation.x, side * wristRoll, blend), 0, 0);
  }
}

export function applyStreetPassPose(bones, pose) {
  const { fwdVel, sideVel, moveUnit, sprintBlend, backBlend, landDip, airborne } = computeGaitMetrics(pose);
  const crouch = pose.crouchAmount ?? 0;
  const breathe = Math.sin(pose.breathPhase);
  const bob = pose.bobPhase;
  const dirSign = 1 - 2 * backBlend;
  const swing = Math.sin(bob) * moveUnit * (1 + sprintBlend * 0.45) * dirSign;
  const hop = Math.abs(Math.sin(bob)) * 2.2 * moveUnit * (1 + sprintBlend * 0.45);
  const door = analyzeDoorInteraction(pose);

  if (bones.bodyPs) {
    bones.bodyPs.rotation.order = 'YXZ';
    let rx = clamp(fwdVel * 0.055, -0.22, 0.22) + breathe * (0.015 + (pose.exertion || 0) * 0.025) + landDip * 1.1 + crouch * 0.14;
    let ry = 0;
    let rz = clamp(-sideVel * 0.05, -0.18, 0.18) + Math.cos(bob) * 0.045 * moveUnit;
    if (door?.kind === 'slam') {
      rx += 0.28 * door.slamHit;
      ry += door.slamSide * 0.50 * door.slamHit;
      rz += door.slamSide * 0.12 * door.slamHit;
    } else if (door && door.grabBlend > 0) {
      rx += clamp((door.horizDist - 0.35) * 0.32, 0.04, 0.24) * door.grabBlend + 0.18 * door.pushPulse;
      ry += -door.handleAngle * 0.42 * door.grabBlend + -door.grabSide * 0.18 * door.pushPulse;
    }
    bones.bodyPs.rotation.set(rx, ry, rz);
    bones.bodyPs.position.y = hop - landDip * 12 - crouch * 2;
  }

  const squash = landDip * 0.85;
  const stretch = airborne ? 0.05 : 0;
  const bodyScaleY = 1 - squash + stretch - crouch * 0.30;
  if (bones.body_scalePs) {
    // This rig shares a single bone for the torso and its unjointed legs.
    bones.body_scalePs.scale.set(
      1 + squash * 0.5 - stretch * 0.35,
      bodyScaleY,
      1 + squash * 0.5 - stretch * 0.35
    );
  }
  if (bones.Head) {
    const facingYaw = pose.bodyYaw ?? pose.yaw ?? 0;
    const pitchFollow = Math.max(0, Math.cos(facingYaw - (pose.yaw || 0)));
    bones.Head.position.y = 16 + 57 * bodyScaleY;
    bones.Head.rotation.order = 'YXZ';
    bones.Head.rotation.set(clamp(-(pose.pitch || 0) * 0.42 * pitchFollow, -0.50, 0.50), 0, 0);
  }

  const handLift = Math.abs(Math.cos(bob)) * 2.1 * moveUnit + (airborne ? 4.5 : 0) - landDip * 14 - crouch * 9;
  const handForward = 4.5 + crouch * 6;
  const maxHandY = 72 + crouch * 7;
  const handBreath = breathe * (0.65 + (pose.exertion || 0) * 1.1);

  if (bones.handLPs) {
    let lx = 38.85 + Math.abs(swing) * 1.2;
    let ly = 38.53 + handBreath + handLift;
    let lz = handForward + swing * 12.5;
    let lrx = -swing * 0.35;
    if (door?.kind === 'slam') {
      if (door.slamSide < 0) {
        lx = lerp(lx, 12.0, door.slamHit);
        ly = lerp(ly, 50.0, door.slamHit);
        lz = lerp(lz, 28.0, door.slamHit);
      } else {
        lz = lerp(lz, -16.0, door.slamHit);
      }
    } else if (door && door.leftWeight > 0.005) {
      let targetX, targetY, targetZ;
      if (bones.handLPs.parent && bones.rootPs?.parent) {
        bones.rootPs.parent.updateMatrixWorld(true);
        const loc = bones.handLPs.parent.worldToLocal(_vTarget.set(door.handleWorld.x, door.handleWorld.y, door.handleWorld.z));
        targetX = clamp(loc.x, -40, 62);
        targetY = clamp(loc.y, 18, maxHandY);
        targetZ = clamp(loc.z, -10, 64);
      } else {
        targetX = clamp(-door.localRight * 70, -10, 42);
        targetY = clamp((door.handleWorld.y - 0.14) * 58, 22, 62);
        targetZ = clamp(door.localFwd * 65, 16, 52);
      }
      lx = lerp(lx, targetX, door.leftWeight);
      ly = lerp(ly, targetY, door.leftWeight);
      lz = lerp(lz, targetZ, door.leftWeight);
      lrx = lerp(lrx, -0.45, door.leftWeight);
    }
    bones.handLPs.position.set(lx, ly, lz);
    bones.handLPs.rotation.set(lrx, 0, 0);
  }

  if (bones.handRPs) {
    let rx = -38.85 - Math.abs(swing) * 1.2;
    let ry = 38.53 + handBreath + handLift;
    let rz = handForward - swing * 12.5;
    let rrx = swing * 0.35;
    if (door?.kind === 'slam') {
      if (door.slamSide > 0) {
        rx = lerp(rx, -12.0, door.slamHit);
        ry = lerp(ry, 50.0, door.slamHit);
        rz = lerp(rz, 28.0, door.slamHit);
      } else {
        rz = lerp(rz, -16.0, door.slamHit);
      }
    } else if (door && door.rightWeight > 0.005) {
      let targetX, targetY, targetZ;
      if (bones.handRPs.parent && bones.rootPs?.parent) {
        bones.rootPs.parent.updateMatrixWorld(true);
        const loc = bones.handRPs.parent.worldToLocal(_vTarget.set(door.handleWorld.x, door.handleWorld.y, door.handleWorld.z));
        targetX = clamp(loc.x, -62, 40);
        targetY = clamp(loc.y, 18, maxHandY);
        targetZ = clamp(loc.z, -10, 64);
      } else {
        targetX = clamp(-door.localRight * 70, -42, 10);
        targetY = clamp((door.handleWorld.y - 0.14) * 58, 22, 62);
        targetZ = clamp(door.localFwd * 65, 16, 52);
      }
      rx = lerp(rx, targetX, door.rightWeight);
      ry = lerp(ry, targetY, door.rightWeight);
      rz = lerp(rz, targetZ, door.rightWeight);
      rrx = lerp(rrx, -0.45, door.rightWeight);
    } else if (pose.heldItem) {
      rx += 4.0;
      ry += 7.5;
      rz += 18.0;
      rrx -= 0.25;
    }
    bones.handRPs.position.set(rx, ry, rz);
    bones.handRPs.rotation.set(rrx, 0, 0);
  }
}

function solveSagittalLeg(phase, { strideAmp, backBlend, sprintBlend, exhaustionBlend, sagittalDrive }) {
  const s = Math.sin(phase);
  // Forward gait cycle: pi/2 = heel strike, pi = mid-stance, 3pi/2 = toe-off, 0/2pi = mid-swing
  const thighShape = s + 0.11 * Math.sin(2 * phase - 0.35);
  const thighFwd = -(thighShape * strideAmp + sprintBlend * 0.10 * sagittalDrive);
  const swingPeak = Math.max(0, Math.cos(phase + 0.28));
  const loadBump = Math.max(0, Math.sin(phase - 0.35)) * Math.max(0, -Math.cos(phase + 0.55));
  const kneeFwd = (
    swingPeak * (0.76 + 0.50 * sprintBlend - 0.24 * exhaustionBlend) +
    loadBump * (0.15 + 0.18 * sprintBlend) +
    0.04 * exhaustionBlend
  ) * sagittalDrive;
  const heelStrike = Math.max(0, Math.sin(phase + 0.25)) * Math.max(0, Math.cos(phase - 0.95));
  const pushOff = Math.pow(Math.max(0, -Math.sin(phase - 0.20)), 1.3);
  const desiredPitchFwd = (
    -0.24 * (1 - 0.38 * sprintBlend) * heelStrike +
    (0.62 + 0.22 * sprintBlend) * pushOff -
    0.14 * swingPeak
  ) * sagittalDrive;

  // Backward gait cycle: shorter stride, forefoot/toe reach behind, push from front sole
  const thighBack = (s + 0.08 * Math.sin(2 * phase + 0.30)) * strideAmp * 0.72;
  const backSwing = Math.max(0, Math.cos(phase - 0.22));
  const kneeBack = (backSwing * 0.54 + Math.max(0, s) * 0.18 + 0.05) * sagittalDrive;
  const desiredPitchBack = (
    0.26 * Math.max(0, s) -
    0.18 * Math.max(0, -s) -
    0.10 * backSwing
  ) * sagittalDrive;

  return {
    thigh: lerp(thighFwd, thighBack, backBlend),
    knee: lerp(kneeFwd, kneeBack, backBlend),
    desiredPitch: lerp(desiredPitchFwd, desiredPitchBack, backBlend)
  };
}

function computeSwitchLegReach(thigh, knee, ankle, abduct, ankleRoll, hipSocketY) {
  const cosAbduct = Math.cos(abduct);
  const ankleDrop = -hipSocketY + (15.4 * Math.cos(thigh) + 15.4 * Math.cos(thigh + knee)) * cosAbduct;
  const footPitch = thigh + knee + ankle;
  const rollExtend = 2.8 * Math.abs(Math.sin(abduct + ankleRoll));
  const heelDrop = 7.0 * Math.cos(footPitch) - 6.5 * Math.sin(footPitch);
  const toeDrop = 7.0 * Math.cos(footPitch) + 11.2 * Math.sin(footPitch);
  return ankleDrop + Math.max(heelDrop, toeDrop) + rollExtend;
}

export function applySwitchPose(bones, pose) {
  const m = computeGaitMetrics(pose);
  const crouch = pose.crouchAmount ?? 0;
  const {
    fwdVel, sideVel, speed, moveUnit, sprintBlend, exhaustionBlend,
    sagittalWeight, lateralWeight, backBlend,
    lightImpact, stumbleBrace, stumbleWobble, limpBlend, landSide,
    velYNorm, airborne, turnRate
  } = m;
  const breathe = Math.sin(pose.breathPhase);
  const bob = pose.bobPhase;
  const door = analyzeDoorInteraction(pose);

  const sagittalDrive = moveUnit * (0.20 + 0.80 * sagittalWeight);
  const strideAmp = (0.46 + 0.28 * sprintBlend - 0.12 * exhaustionBlend * (1 - sprintBlend)) * sagittalDrive;

  const legL = solveSagittalLeg(bob, { strideAmp, backBlend, sprintBlend, exhaustionBlend, sagittalDrive });
  const legR = solveSagittalLeg(bob + Math.PI, { strideAmp, backBlend, sprintBlend, exhaustionBlend, sagittalDrive });

  // Post-stumble limp asymmetry when walking while hurt/winded
  const limpFactorL = landSide < 0 ? 1 - 0.26 * limpBlend : 1 + 0.06 * limpBlend;
  const limpFactorR = landSide > 0 ? 1 - 0.26 * limpBlend : 1 + 0.06 * limpBlend;
  let thighL = legL.thigh * limpFactorL;
  let thighR = legR.thigh * limpFactorR;
  let kneeL = legL.knee * (landSide < 0 ? 1 - 0.18 * limpBlend : 1) + 0.06 + 0.08 * exhaustionBlend;
  let kneeR = legR.knee * (landSide > 0 ? 1 - 0.18 * limpBlend : 1) + 0.06 + 0.08 * exhaustionBlend;
  let desiredPitchL = legL.desiredPitch;
  let desiredPitchR = legR.desiredPitch;

  // Idle breathing weight shift & turning-in-place stance reaction
  const idleFactor = 1 - moveUnit;
  const turnMag = clamp(Math.abs(turnRate) / 4.5, 0, 1) * idleFactor;
  const breathShift = breathe * (0.014 + 0.020 * exhaustionBlend) * idleFactor;
  kneeL += Math.max(0, breathShift) + 0.11 * turnMag;
  kneeR += Math.max(0, -breathShift) + 0.11 * turnMag;

  // Lateral strafing stepping & diagonal yaw steering
  const yawSteer = speed > 0.08
    ? clamp(Math.atan2(sideVel, Math.abs(fwdVel) + 0.50), -0.62, 0.62) * (fwdVel < -0.1 ? -0.65 : 1) * moveUnit
    : 0;
  const legYaw = -yawSteer;

  const baseAbduct = 0.032 - 0.014 * sprintBlend + 0.018 * exhaustionBlend + 0.025 * turnMag;
  const latStepAmp = lateralWeight * moveUnit * (0.24 + 0.08 * sprintBlend);
  let abductL = baseAbduct + latStepAmp * (0.45 + 0.55 * Math.sin(bob));
  let abductR = -baseAbduct - latStepAmp * (0.45 - 0.55 * Math.sin(bob));

  // Pure/strong lateral strafe lifts recovering knee and adds subtle sagittal stagger
  const latKneeL = Math.max(0, Math.cos(bob)) * 0.50 * lateralWeight * moveUnit;
  const latKneeR = Math.max(0, -Math.cos(bob)) * 0.50 * lateralWeight * moveUnit;
  kneeL += latKneeL;
  kneeR += latKneeR;
  thighL += -Math.sin(bob) * 0.10 * lateralWeight * moveUnit;
  thighR += Math.sin(bob) * 0.10 * lateralWeight * moveUnit;

  // Door interaction leg bracing (follow-through stance on grab, lunge on slam)
  if (door?.kind === 'slam') {
    const leadL = door.slamSide < 0 ? 1 : 0;
    thighL += (leadL ? -0.22 : 0.20) * door.slamHit;
    thighR += (leadL ? 0.20 : -0.22) * door.slamHit;
    kneeL += (leadL ? 0.34 : 0.18) * door.slamHit;
    kneeR += (leadL ? 0.18 : 0.34) * door.slamHit;
    abductL += 0.06 * door.slamHit;
    abductR -= 0.06 * door.slamHit;
  } else if (door && door.grabBlend > 0) {
    const braceWeight = door.grabBlend * (1 - 0.55 * moveUnit);
    const stepForwardL = door.grabSide < 0 ? 1 : 0;
    thighL += (stepForwardL ? -0.18 : 0.14) * braceWeight;
    thighR += (stepForwardL ? 0.14 : -0.18) * braceWeight;
    kneeL += (stepForwardL ? 0.22 : 0.12) * braceWeight;
    kneeR += (stepForwardL ? 0.12 : 0.22) * braceWeight;
    abductL += 0.03 * braceWeight;
    abductR -= 0.03 * braceWeight;
  }

  // Airborne jump mechanics (rise tuck -> apex transition -> descent brace)
  if (airborne) {
    const rise = Math.max(0, velYNorm);
    const fall = Math.max(0, -velYNorm);
    const leadL = landSide < 0 ? 1 : 0;
    const airThighL = lerp(-0.24 - 0.34 * rise, -0.26 - 0.06 * fall, 1 - rise) * (0.65 + 0.35 * leadL);
    const airThighR = lerp(-0.24 - 0.34 * rise, -0.26 - 0.06 * fall, 1 - rise) * (0.65 + 0.35 * (1 - leadL));
    const airKneeL = (0.36 + 0.52 * rise + 0.08 * fall) * (0.70 + 0.30 * leadL);
    const airKneeR = (0.36 + 0.52 * rise + 0.08 * fall) * (0.70 + 0.30 * (1 - leadL));
    thighL = airThighL + (1 - rise) * clamp(-fwdVel * 0.03, -0.15, 0.15);
    thighR = airThighR + (1 - rise) * clamp(-fwdVel * 0.03, -0.15, 0.15);
    kneeL = airKneeL;
    kneeR = airKneeR;
    desiredPitchL = 0.16 * (1 - leadL) * rise - 0.12 * fall;
    desiredPitchR = 0.16 * leadL * rise - 0.12 * fall;
    abductL = baseAbduct + 0.03;
    abductR = -baseAbduct - 0.03;
  }

  // Light normal landing knee absorption
  if (lightImpact > 0.001) {
    thighL -= 0.24 * lightImpact;
    thighR -= 0.24 * lightImpact;
    kneeL += 0.50 * lightImpact;
    kneeR += 0.50 * lightImpact;
    desiredPitchL *= 1 - 0.7 * lightImpact;
    desiredPitchR *= 1 - 0.7 * lightImpact;
  }

  // Heavy low-stamina landing stagger & recovery
  if (stumbleBrace > 0.001) {
    const forwardIsLeft = landSide < 0;
    const braceThigh = -0.58 * stumbleBrace;
    const trailThigh = 0.32 * stumbleBrace;
    const braceKnee = 0.90 * stumbleBrace;
    const trailKnee = 0.56 * stumbleBrace;
    thighL += forwardIsLeft ? braceThigh : trailThigh;
    thighR += forwardIsLeft ? trailThigh : braceThigh;
    kneeL += forwardIsLeft ? braceKnee : trailKnee;
    kneeR += forwardIsLeft ? trailKnee : braceKnee;
    abductL += 0.07 * stumbleBrace;
    abductR -= 0.07 * stumbleBrace;
    desiredPitchL = lerp(desiredPitchL, forwardIsLeft ? -0.05 : 0.42, stumbleBrace);
    desiredPitchR = lerp(desiredPitchR, forwardIsLeft ? 0.42 : -0.05, stumbleBrace);
  }

  // Fold both legs before solving shoe contact. A tuck or stumble already bends the knees.
  const crouchBend = crouch * (airborne ? 0.86 : 1 - 0.18 * stumbleBrace);
  thighL -= 1.30 * crouchBend;
  thighR -= 1.30 * crouchBend;
  kneeL = Math.max(0.05, kneeL + 1.90 * crouchBend);
  kneeR = Math.max(0.05, kneeR + 1.90 * crouchBend);

  const ankleL = clamp(desiredPitchL - (thighL + kneeL), -0.68, 0.78);
  const ankleR = clamp(desiredPitchR - (thighR + kneeR), -0.68, 0.78);
  const ankleRollL = clamp(-abductL * 0.42, -0.22, 0.22);
  const ankleRollR = clamp(-abductR * 0.42, -0.22, 0.22);

  if (bones.foot_l1) {
    bones.foot_l1.rotation.order = 'YXZ';
    bones.foot_l1.rotation.set(thighL, legYaw, abductL);
  }
  if (bones.foot_r1) {
    bones.foot_r1.rotation.order = 'YXZ';
    bones.foot_r1.rotation.set(thighR, legYaw, abductR);
  }
  if (bones.foot_l2) bones.foot_l2.rotation.set(kneeL, 0, 0);
  if (bones.foot_r2) bones.foot_r2.rotation.set(kneeR, 0, 0);
  if (bones.ankle_l) bones.ankle_l.rotation.set(ankleL, 0, ankleRollL);
  if (bones.ankle_r) bones.ankle_r.rotation.set(ankleR, 0, ankleRollR);

  // Pelvis & torso counter-rotation, strafe bank, exhaustion slouch, stumble, and door follow-through
  const hipYawWave = Math.sin(bob) * (0.065 + 0.055 * sprintBlend) * moveUnit * sagittalWeight * (1 - 2 * backBlend);
  const hipTiltWave = -Math.cos(bob) * (0.038 + 0.025 * sprintBlend) * moveUnit;
  let hipPitch = 0.04 * exhaustionBlend + 0.14 * lightImpact + 0.22 * stumbleBrace;
  let hipYaw = -hipYawWave - 0.18 * landSide * stumbleBrace + clamp(-turnRate * 0.03, -0.12, 0.12) * idleFactor;
  let hipRoll = clamp(-sideVel * 0.035, -0.14, 0.14) + hipTiltWave - 0.10 * landSide * stumbleBrace;

  let chestPitch = clamp(fwdVel * 0.038, -0.14, 0.18) +
    breathe * (0.018 + (pose.exertion || 0) * 0.03) +
    0.07 * exhaustionBlend +
    0.16 * lightImpact +
    0.38 * stumbleBrace +
    0.06 * stumbleWobble +
    0.26 * crouch;
  let chestYaw = hipYawWave * 0.9 + 0.10 * landSide * stumbleBrace;
  let chestRoll = clamp(-sideVel * 0.025, -0.09, 0.09) + 0.04 * landSide * stumbleBrace;

  if (door?.kind === 'slam') {
    hipPitch += 0.14 * door.slamHit;
    hipYaw += door.slamSide * 0.22 * door.slamHit;
    chestPitch += 0.32 * door.slamHit;
    chestYaw += door.slamSide * 0.56 * door.slamHit;
    chestRoll += door.slamSide * 0.14 * door.slamHit;
  } else if (door && door.grabBlend > 0) {
    const reachDist = Math.max(0, door.horizDist - 0.30);
    const reachLean = clamp(reachDist * 1.15, 0.12, 0.42) * door.grabBlend;
    hipPitch += clamp(reachDist * 0.58, 0.08, 0.24) * door.grabBlend + 0.10 * door.pushPulse;
    hipYaw += -door.handleAngle * 0.30 * door.grabBlend;
    chestPitch += reachLean + 0.22 * door.pushPulse;
    chestYaw += -door.handleAngle * 0.62 * door.grabBlend + -door.grabSide * 0.18 * door.pushPulse;
    chestRoll += clamp(door.localRight * 0.22, -0.14, 0.14) * door.grabBlend;
  }

  if (bones.hip) {
    bones.hip.rotation.order = 'YXZ';
    bones.hip.rotation.set(hipPitch, hipYaw, hipRoll);
  }
  if (bones.chest) {
    bones.chest.rotation.order = 'YXZ';
    bones.chest.rotation.set(chestPitch, chestYaw, chestRoll);
  }
  if (bones.head) {
    const facingYaw = pose.bodyYaw ?? pose.yaw ?? 0;
    const pitchFollow = Math.max(0, Math.cos(facingYaw - (pose.yaw || 0)));
    bones.head.rotation.order = 'YXZ';
    bones.head.rotation.set(
      clamp(-(pose.pitch || 0) * 0.45 * pitchFollow - chestPitch * 0.35, -0.55, 0.55),
      -chestYaw * 0.35,
      -chestRoll * 0.25
    );
  }

  // Kinematic grounding: keep lowest stance shoe flush on floor (y = 0)
  if (bones.skl_root) {
    const hipY = -9.8 * Math.cos(hipRoll) * Math.cos(hipPitch);
    const hipL = hipY + 5.6 * Math.sin(hipRoll);
    const hipR = hipY - 5.6 * Math.sin(hipRoll);
    const reachL = computeSwitchLegReach(thighL + hipPitch, kneeL, ankleL, abductL + hipRoll, ankleRollL, hipL);
    const reachR = computeSwitchLegReach(thighR + hipPitch, kneeR, ankleR, abductR + hipRoll, ankleRollR, hipR);
    const groundedY = Math.max(reachL, reachR);
    const flightLift = airborne
      ? Math.max(0, 47.6 - groundedY) * 0.25 * (1 - crouch)
      : sprintBlend * moveUnit * sagittalWeight * 1.25 * Math.max(0, Math.abs(Math.cos(bob)) - 0.45);
    bones.skl_root.position.y = groundedY + flightLift;
    bones.skl_root.position.x = door && door.grabBlend > 0
      ? clamp(-door.localRight * 26, -13.0, 13.0) * door.grabBlend
      : 0;
    bones.skl_root.position.z = door && door.grabBlend > 0
      ? clamp((door.horizDist - 0.34) * 56, 0, 15.0) * door.grabBlend + 3.5 * door.pushPulse
      : 0;
  }

  // Arm swing synchronized with sagittal/backward/stumble/jump motion
  const armStride = Math.sin(bob) * moveUnit * (0.56 + sprintBlend * 0.26) * (1 - 2 * backBlend) * (0.35 + 0.65 * sagittalWeight);
  const armBreath = breathe * (0.025 + (pose.exertion || 0) * 0.04);
  const armStumble = 0.45 * stumbleBrace;
  if (bones.arm_l1) {
    bones.arm_l1.rotation.order = 'XYZ';
    bones.arm_l1.rotation.set(
      armStride - (airborne ? 0.35 : 0.08) + armBreath + (landSide < 0 ? armStumble : -armStumble * 0.5),
      0,
      -1.32 + 0.08 * stumbleBrace
    );
  }
  if (bones.arm_l2) {
    bones.arm_l2.rotation.set(
      0,
      -(0.32 + Math.max(0, -armStride) * 0.45 + sprintBlend * 0.22 * moveUnit + 0.35 * stumbleBrace),
      0
    );
  }
  if (bones.arm_r1) {
    bones.arm_r1.rotation.order = 'XYZ';
    bones.arm_r1.rotation.set(
      -armStride - (airborne ? 0.35 : 0.08) + armBreath + (landSide > 0 ? armStumble : -armStumble * 0.5),
      0,
      1.32 - 0.08 * stumbleBrace
    );
  }
  if (bones.arm_r2) {
    bones.arm_r2.rotation.set(
      0,
      0.32 + Math.max(0, armStride) * 0.45 + sprintBlend * 0.22 * moveUnit + 0.35 * stumbleBrace,
      0
    );
  }
  if (bones.wrist_l) bones.wrist_l.rotation.set(0, 0, 0);
  if (bones.wrist_r) bones.wrist_r.rotation.set(0, 0, 0);
  if (pose.heldItem && !door) {
    if (bones.arm_r1) bones.arm_r1.rotation.x = Math.min(bones.arm_r1.rotation.x, -0.42);
    if (bones.arm_r2) bones.arm_r2.rotation.y = Math.max(bones.arm_r2.rotation.y, 0.72);
  }

  // Door IK overlay: live handle grip or shoulder-ram forearm brace
  if (door?.kind === 'slam') {
    const leadSide = door.slamSide; // +1 = right shoulder, -1 = left shoulder
    const leadArmSide = leadSide > 0 ? -1 : 1; // -1 = arm_r, +1 = arm_l
    const guardTarget = _vTarget.set(-leadArmSide * 4.0, 20.5, 13.0);
    solveSwitchArmIK(bones, leadArmSide, guardTarget, door.slamHit, 0);
    // Trailing arm sweeps back for momentum
    const trailArm1 = leadArmSide > 0 ? bones.arm_r1 : bones.arm_l1;
    const trailArm2 = leadArmSide > 0 ? bones.arm_r2 : bones.arm_l2;
    if (trailArm1) trailArm1.rotation.x = lerp(trailArm1.rotation.x, 0.72, door.slamHit);
    if (trailArm2) trailArm2.rotation.y = lerp(trailArm2.rotation.y, leadArmSide * 0.65, door.slamHit);
  } else if (door && door.grabBlend > 0) {
    let targetLocal;
    if (bones.skl_root?.parent && bones.chest) {
      bones.skl_root.parent.updateMatrixWorld(true);
      targetLocal = bones.chest.worldToLocal(_vTarget.set(door.handleWorld.x, door.handleWorld.y, door.handleWorld.z));
    } else {
      // Fallback when bones are unparented in unit tests
      targetLocal = _vTarget.set(
        -door.localRight * 74,
        (door.handleWorld.y - 1.215) * 60 + 24.5,
        Math.max(8, door.localFwd * 74 - 11)
      );
    }
    const offBias = clamp(door.grabBlend - Math.min(door.leftWeight, door.rightWeight) * 2, 0, 1);
    if (door.leftWeight <= door.rightWeight) {
      if (bones.arm_l1 && offBias > 0.01) bones.arm_l1.rotation.x = lerp(bones.arm_l1.rotation.x, 0.24, offBias);
    } else {
      if (bones.arm_r1 && offBias > 0.01) bones.arm_r1.rotation.x = lerp(bones.arm_r1.rotation.x, 0.24, offBias);
    }
    if (door.leftWeight > 0.005) {
      solveSwitchArmIK(bones, 1, targetLocal, door.leftWeight, door.unlatchTwist);
    }
    if (door.rightWeight > 0.005) {
      solveSwitchArmIK(bones, -1, targetLocal, door.rightWeight, door.unlatchTwist);
    }
  }
}

export function stripSwitchNeckAndCapCollar(mesh, THREE_ATTRS) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const norm = g.attributes.normal;
  const si = g.attributes.skinIndex;
  const sw = g.attributes.skinWeight;
  const idx = g.index;
  if (!idx || !si || !sw || !mesh.isSkinnedMesh) return -1;

  const bones = mesh.skeleton.bones;
  const headVerts = new Set();
  for (let i = 0; i < pos.count; i++) {
    if (bones[si.getX(i)]?.name === 'head') headVerts.add(i);
  }
  if (headVerts.size === 0) return -1;

  const keptIndices = [];
  const rimSet = new Set();
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    const ha = headVerts.has(a), hb = headVerts.has(b), hc = headVerts.has(c);
    if (!ha && !hb && !hc) {
      keptIndices.push(a, b, c);
    } else {
      if (!ha) rimSet.add(a);
      if (!hb) rimSet.add(b);
      if (!hc) rimSet.add(c);
    }
  }
  if (rimSet.size < 3) {
    g.setIndex(keptIndices);
    return -1;
  }

  let cx = 0, cy = 0, cz = 0;
  for (const ri of rimSet) {
    cx += pos.getX(ri);
    cy += pos.getY(ri);
    cz += pos.getZ(ri);
  }
  cx /= rimSet.size;
  cy = cy / rimSet.size - 0.05;
  cz /= rimSet.size;

  const oldCount = pos.count;
  const centerIdx = oldCount;
  const newCount = oldCount + 1;

  const { Float32BufferAttribute, Uint16BufferAttribute } = THREE_ATTRS;
  const nextPos = new Float32Array(newCount * 3);
  nextPos.set(pos.array);
  nextPos[centerIdx * 3] = cx;
  nextPos[centerIdx * 3 + 1] = cy;
  nextPos[centerIdx * 3 + 2] = cz;
  g.setAttribute('position', new Float32BufferAttribute(nextPos, 3));

  const nextNorm = new Float32Array(newCount * 3);
  nextNorm.set(norm.array);
  nextNorm[centerIdx * 3] = 0;
  nextNorm[centerIdx * 3 + 1] = 1;
  nextNorm[centerIdx * 3 + 2] = 0;
  g.setAttribute('normal', new Float32BufferAttribute(nextNorm, 3));

  const sampleRim = [...rimSet][0];
  const nextSi = new Uint16Array(newCount * 4);
  nextSi.set(si.array);
  nextSi.set(si.array.subarray(sampleRim * 4, sampleRim * 4 + 4), centerIdx * 4);
  g.setAttribute('skinIndex', new Uint16BufferAttribute(nextSi, 4));

  const nextSw = new Float32Array(newCount * 4);
  nextSw.set(sw.array);
  nextSw.set(sw.array.subarray(sampleRim * 4, sampleRim * 4 + 4), centerIdx * 4);
  g.setAttribute('skinWeight', new Float32BufferAttribute(nextSw, 4));

  const sorted = [...rimSet].sort((a, b) =>
    Math.atan2(pos.getZ(a) - cz, pos.getX(a) - cx) - Math.atan2(pos.getZ(b) - cz, pos.getX(b) - cx)
  );
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[(i + 1) % sorted.length];
    const ax = pos.getX(a) - cx, az = pos.getZ(a) - cz;
    const bx = pos.getX(b) - cx, bz = pos.getZ(b) - cz;
    const crossY = bz * ax - bx * az;
    if (crossY >= 0) keptIndices.push(centerIdx, b, a);
    else keptIndices.push(centerIdx, a, b);
  }
  g.setIndex(keptIndices);
  return centerIdx;
}

