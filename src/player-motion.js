export const WALK_SPEED = 2.45;
export const CROUCH_SPEED = 1.15;
export const CROUCH_EYE_DROP = 0.42;
export const PLAYER_STAND_HEIGHT = 1.92;
export const PLAYER_CROUCH_HEIGHT_DROP = 0.24;
export const SPRINT_SPEED = 4.35;
export function playerNoiseRadius({ isCrouching, justJumped, justLanded, landedHeavy, stepEvent, isSprinting, scuffEvent }) {
  if (isCrouching) return 0;
  return Math.max(justJumped ? 8 : 0, justLanded ? (landedHeavy ? 17 : 11) : 0,
    stepEvent > 0 ? (isSprinting ? 14 : 4.5) : 0, scuffEvent > 0 ? 7 : 0);
}
export const EXHAUSTED_WALK_SPEED = 2.08;
export const BASE_FOV = 64;
export const SPRINT_FOV = 70;
export const EXHAUSTED_FOV = 62.6;
export const EXHAUSTION_RECOVER_THRESHOLD = 0.30;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export function createStaminaState() {
  return {
    stamina: 1,
    exhausted: false,
    recoveryDelay: 0,
    recoveryTime: 0,
    exertion: 0,
    justExhausted: false,
    isSprinting: false,
    speedLimit: WALK_SPEED,
    hudVisibleTimer: 0
  };
}

export function stepStamina(state, { sprinting = false, crouching = false, moving = false, dt = 0, adrenaline = false } = {}) {
  const safeDt = Math.max(0, dt);
  if (adrenaline) state.exhausted = false;
  const canSprint = !crouching && (adrenaline || (!state.exhausted && state.stamina > 0));
  const activeSprint = Boolean(sprinting && moving && canSprint);

  state.justExhausted = false;
  state.isSprinting = activeSprint;

  if (activeSprint && !adrenaline) {
    state.stamina = Math.max(0, state.stamina - 0.125 * safeDt);
    state.recoveryDelay = 0.40;
    state.recoveryTime = 0;
    state.hudVisibleTimer = 0.9;
    if (state.stamina === 0) {
      state.exhausted = true;
      state.justExhausted = true;
      state.isSprinting = false;
      state.recoveryDelay = 0.85;
    }
    state.exertion = clamp(state.exertion + 0.42 * safeDt, 0, 1);
  } else {
    let regenDt = safeDt;
    if (state.recoveryDelay > 0 && !adrenaline) {
      regenDt = Math.max(0, safeDt - state.recoveryDelay);
      state.recoveryDelay = Math.max(0, state.recoveryDelay - safeDt);
    } else if (adrenaline) {
      state.recoveryDelay = 0;
    }
    if (regenDt > 0 && state.stamina < 1) {
      const baseRate = (moving ? 0.095 : 0.145) * (state.exhausted ? 0.85 : 1) * (adrenaline ? 1.45 : 1);
      const expK = 0.65;
      const maxBoostTime = 3.2;
      const t0 = Math.min(state.recoveryTime, maxBoostTime);
      const t1 = Math.min(state.recoveryTime + regenDt, maxBoostTime);
      const boostDt = t1 - t0;
      const tailDt = Math.max(0, state.recoveryTime + regenDt - maxBoostTime) - Math.max(0, state.recoveryTime - maxBoostTime);
      const effectiveTime = (boostDt > 0 ? (Math.exp(expK * t1) - Math.exp(expK * t0)) / expK : 0) + tailDt * Math.exp(expK * maxBoostTime);
      state.recoveryTime += regenDt;
      state.stamina = Math.min(1, state.stamina + baseRate * effectiveTime);
      if (state.exhausted && state.stamina >= EXHAUSTION_RECOVER_THRESHOLD) {
        state.exhausted = false;
      }
      if (state.stamina >= 1) {
        state.recoveryTime = 0;
      }
    } else if (state.stamina >= 1) {
      state.recoveryTime = 0;
    }

    if (adrenaline || state.stamina < 0.999 || state.exhausted) {
      state.hudVisibleTimer = 0.85;
    } else {
      state.hudVisibleTimer = Math.max(0, state.hudVisibleTimer - safeDt);
    }

    const exertionTarget = state.exhausted
      ? Math.max(0.76, 1 - state.stamina)
      : (activeSprint ? 0.45 : moving ? 0.15 : 0);
    const rate = exertionTarget > state.exertion ? 0.55 : 0.34;
    const diff = exertionTarget - state.exertion;
    const step = rate * safeDt;
    state.exertion = Math.abs(diff) <= step ? exertionTarget : state.exertion + Math.sign(diff) * step;
  }

  if (crouching) {
    state.speedLimit = CROUCH_SPEED;
  } else if (state.isSprinting) {
    state.speedLimit = adrenaline ? SPRINT_SPEED * 1.12 : SPRINT_SPEED;
  } else if (state.exhausted) {
    const recoveryRatio = clamp(state.stamina / EXHAUSTION_RECOVER_THRESHOLD, 0, 1);
    state.speedLimit = EXHAUSTED_WALK_SPEED + (WALK_SPEED - EXHAUSTED_WALK_SPEED) * recoveryRatio;
  } else {
    state.speedLimit = adrenaline ? WALK_SPEED * 1.08 : WALK_SPEED;
  }

  return state;
}

/**
 * Instantaneous target fear in [0, 1] for a player near the monster.
 * Proximity dread is felt whenever she is close — even while merely patrolling
 * out of sight — while direct eye contact spikes it into full terror.
 */
export function computePlayerFear({
  playerX = 0,
  playerZ = 0,
  playerYaw = 0,
  monsterX = NaN,
  monsterZ = NaN,
  monsterVisible = false,
  monsterMode = 'patrol',
  playerSeesMonster = false
} = {}) {
  if (!Number.isFinite(monsterX) || !Number.isFinite(monsterZ)) return 0;
  if (!Number.isFinite(playerX) || !Number.isFinite(playerZ) || !Number.isFinite(playerYaw)) return 0;

  const dx = monsterX - playerX;
  const dz = monsterZ - playerZ;
  const d = Math.hypot(dx, dz);

  if (monsterMode === 'capture') return 1;

  const fx = -Math.sin(playerYaw);
  const fz = -Math.cos(playerYaw);
  const facing = (fx * dx + fz * dz) / Math.max(1e-5, d);

  // Proximity fear: always active within 11.5 m, regardless of mode or sight.
  // A patrolling monster still makes the player dread being close to it.
  const closeRamp = smoothstep(11.5, 1.5, d);
  const proximityScale = monsterMode === 'chase'
    ? 0.92
    : (monsterMode === 'investigate' || monsterMode === 'search') ? 0.82 : 0.74;
  let fear = Math.pow(closeRamp, 1.2) * proximityScale;

  // Direct sight / eye-contact fear spikes when the monster is within view.
  if ((monsterVisible || playerSeesMonster) && facing > 0.18 && d < 15) {
    const sightRamp = smoothstep(15, 1.8, d);
    const facingBoost = 0.65 + 0.35 * clamp((facing - 0.18) / 0.82, 0, 1);
    const modeScale = monsterMode === 'chase' ? 1.0 : 0.88;
    fear = Math.max(fear, sightRamp * facingBoost * modeScale);
  }

  return clamp(fear, 0, 1);
}

export function createBlinkState(randomFn = Math.random) {
  return {
    timer: 6.0 + randomFn() * 5.0,
    elapsed: -1,
    duration: 0.12,
    amount: 0,
    heavy: false
  };
}

export function stepBlink(
  state,
  dt = 0,
  {
    exhausted = false,
    justExhausted = false,
    exertion = 0,
    fear = 0,
    reducedMotion = false,
    manualTrigger = false
  } = {},
  randomFn = Math.random
) {
  const safeDt = Math.max(0, dt);
  const fearBlink = clamp(Number.isFinite(fear) ? fear : 0, 0, 1) > 0.35
    ? clamp(fear, 0, 1)
    : 0;

  if ((justExhausted || manualTrigger) && state.elapsed < 0) {
    state.elapsed = 0;
    state.heavy = Boolean(justExhausted || exhausted);
    state.duration = state.heavy ? 0.28 : 0.12;
  }

  if (state.elapsed >= 0) {
    state.elapsed += safeDt;
    const p = state.elapsed / Math.max(state.duration, 0.001);
    if (p >= 1) {
      state.elapsed = -1;
      state.amount = 0;
      state.heavy = false;
      state.timer = (exhausted ? 1.6 : 6.2) + randomFn() * (exhausted ? 1.8 : 5.3);
    } else {
      let curve;
      if (p < 0.32) curve = smoothstep(0, 0.32, p);
      else if (p < 0.46) curve = 1;
      else curve = 1 - smoothstep(0.46, 1.0, p);
      const strength = state.heavy ? 1 : 0.42;
      state.amount = curve * strength * (reducedMotion ? 0.4 : 1);
    }
  } else {
    // Terrified players blink faster and more nervously.
    state.timer -= safeDt * (1 + exertion * (exhausted ? 0.5 : 0.18) + fearBlink * 1.4);
    if (state.timer <= 0) {
      state.elapsed = 0;
      state.heavy = Boolean(exhausted);
      state.duration = exhausted ? 0.24 : 0.12;
      state.amount = 0;
    }
  }

  return state;
}

export function createJumpState() {
  return {
    height: 0,
    velY: 0,
    grounded: true,
    airborneLowStamina: false,
    justJumped: false,
    justLanded: false,
    landedHeavy: false,
    landTimer: 1,
    landDuration: 0,
    landSide: 1,
    stumbleCooldown: 0
  };
}

export function stumbleSpeedFactor(jump) {
  if (!jump || jump.stumbleCooldown <= 0) return 1;
  const progress = 1 - clamp(jump.stumbleCooldown / 2.8, 0, 1);
  return 0.30 + 0.70 * (progress * progress);
}

export function playerHeadHeight(crouchAmount = 0) {
  return PLAYER_STAND_HEIGHT - PLAYER_CROUCH_HEIGHT_DROP * clamp(crouchAmount, 0, 1);
}

export function stepJump(
  jump,
  stamina,
  {
    wantJump = false,
    dt = 0,
    sideInput = 0,
    floorHeight = 0,
    ceilingHeight = Infinity,
    playerHeight = PLAYER_STAND_HEIGHT
  } = {}
) {
  const safeDt = Math.max(0, dt);
  jump.justJumped = false;
  jump.justLanded = false;
  const maxHeight = Number.isFinite(ceilingHeight)
    ? Math.max(floorHeight, ceilingHeight - playerHeight)
    : Infinity;

  if (jump.stumbleCooldown > 0) {
    jump.stumbleCooldown = Math.max(0, jump.stumbleCooldown - safeDt);
  }
  if (jump.grounded && jump.landTimer < jump.landDuration) {
    jump.landTimer = Math.min(jump.landDuration, jump.landTimer + safeDt);
  }

  if (jump.grounded && floorHeight < jump.height - 0.01) {
    jump.grounded = false;
    jump.velY = 0;
    jump.airborneLowStamina = false;
  } else if (jump.grounded && floorHeight > jump.height) {
    jump.height = floorHeight;
  }

  if (jump.grounded && wantJump) {
    if (maxHeight <= floorHeight + 1e-4) {
      return jump;
    }
    const lowStamina = stamina.exhausted || stamina.stamina < EXHAUSTION_RECOVER_THRESHOLD;
    jump.grounded = false;
    jump.airborneLowStamina = lowStamina;
    jump.velY = lowStamina ? 4.25 : 4.95;
    jump.justJumped = true;
    jump.landTimer = 0;
    jump.landDuration = 0;
    jump.landSide = Math.abs(sideInput) > 0.1 ? Math.sign(sideInput) : -jump.landSide;

    stamina.stamina = Math.max(0, stamina.stamina - 0.085);
    stamina.recoveryDelay = Math.max(stamina.recoveryDelay, 0.40);
    stamina.recoveryTime = 0;
    stamina.hudVisibleTimer = Math.max(stamina.hudVisibleTimer, 0.9);
    stamina.exertion = clamp(stamina.exertion + 0.14, 0, 1);
    if (stamina.stamina === 0 && !stamina.exhausted) {
      stamina.exhausted = true;
      stamina.justExhausted = true;
      stamina.isSprinting = false;
      stamina.recoveryDelay = 0.85;
    }
    return jump;
  }

  if (!jump.grounded) {
    jump.velY -= 15.2 * safeDt;
    jump.height += jump.velY * safeDt;
    if (jump.height > maxHeight) {
      jump.height = maxHeight;
      if (jump.velY > 0) jump.velY = 0;
    }
    if (jump.velY <= 0 && jump.height <= floorHeight) {
      jump.height = floorHeight;
      jump.velY = 0;
      jump.grounded = true;
      jump.justLanded = true;
      const landedLow = jump.airborneLowStamina || stamina.exhausted || stamina.stamina < EXHAUSTION_RECOVER_THRESHOLD;
      jump.landedHeavy = landedLow;
      jump.landTimer = 0;
      jump.landDuration = landedLow ? 1.45 : 0.32;
      if (landedLow) {
        jump.stumbleCooldown = 2.8;
        stamina.exertion = clamp(stamina.exertion + 0.32, 0, 1);
      }
    }
  }

  return jump;
}

export function createCameraMotionState() {
  return {
    crouchAmount: 0,
    bobPhase: 0,
    prevStepIndex: 0,
    breathPhase: 0,
    breathSpeed: 1.65,
    baseOffsetY: 0,
    offsetY: 0,
    offsetX: 0,
    pitchOffset: 0,
    rollOffset: 0,
    yawOffset: 0,
    strafeRoll: 0,
    lookRoll: 0,
    fov: BASE_FOV,
    stepEvent: 0,
    sprintCloud: 0,
    headBlurX: 0,
    headBlurY: 0,
    fear: 0,
    fearPhase: 0,
    fearBlur: 0
  };
}

export function stepCameraMotion(
  state,
  {
    dt = 0,
    moveSpeed = 0,
    isSprinting = false,
    isCrouching = false,
    sideInput = 0,
    lookDeltaX = 0,
    lookYawDelta = 0,
    lookPitchDelta = 0,
    exertion = 0,
    exhausted = false,
    jump = null,
    reducedMotion = false,
    fear = 0
  } = {}
) {
  const safeDt = Math.max(0, dt);
  const fearTarget = clamp(Number.isFinite(fear) ? fear : 0, 0, 1);
  // Fear rises fast (panic spike) and decays more slowly (residual dread).
  if (safeDt === 0) {
    state.fear = fearTarget;
  } else {
    const fearRate = fearTarget > state.fear ? 5.5 : 1.8;
    state.fear += (fearTarget - state.fear) * (1 - Math.exp(-fearRate * safeDt));
  }
  state.fear = clamp(state.fear, 0, 1);
  const fearAmount = state.fear;
  state.fearPhase = (state.fearPhase + safeDt * (14 + fearAmount * 10)) % (Math.PI * 20);

  // Scared breathing: faster, shallower, and shaky.
  const breathRate = 1.65 + exertion * 2.95 + (exhausted ? 0.55 : 0) + fearAmount * 3.4;
  state.breathSpeed = breathRate;
  state.breathPhase = (state.breathPhase + breathRate * safeDt) % (Math.PI * 2);

  const grounded = jump ? jump.grounded : true;
  const cadence = isSprinting ? 3.55 : 2.85;
  if (grounded) {
    state.bobPhase += moveSpeed * cadence * safeDt;
    const stepIndex = Math.floor(state.bobPhase / Math.PI);
    if (moveSpeed > 0.45 && stepIndex !== state.prevStepIndex) {
      state.stepEvent = isSprinting ? 1 : clamp(moveSpeed / WALK_SPEED, 0.35, 0.8);
    } else {
      state.stepEvent = 0;
    }
    state.prevStepIndex = stepIndex;
  } else {
    state.stepEvent = 0;
  }

  const jumpHeight = jump ? jump.height : 0;
  const stanceBlend = reducedMotion ? 1 : 1 - Math.exp(-12 * safeDt);
  state.crouchAmount += (Number(isCrouching) - state.crouchAmount) * stanceBlend;
  const eyeDrop = CROUCH_EYE_DROP * state.crouchAmount;

  if (reducedMotion) {
    state.baseOffsetY = 0;
    state.offsetY = jumpHeight - eyeDrop;
    state.offsetX = 0;
    state.pitchOffset = 0;
    state.rollOffset = 0;
    state.yawOffset = 0;
    state.strafeRoll = 0;
    state.lookRoll = 0;
    state.fov = BASE_FOV;
    state.sprintCloud = 0;
    state.headBlurX = 0;
    state.headBlurY = 0;
    state.fearBlur = 0;
    return state;
  }

  const dampSlow = 1 - Math.exp(-8 * safeDt);
  const dampStrafe = 1 - Math.exp(-10.5 * safeDt);
  const dampFast = 1 - Math.exp(-14 * safeDt);

  const moveRatio = clamp(moveSpeed / WALK_SPEED, 0, 1.85);
  const sprintBlend = isSprinting ? 1 : 0;
  const sideClamped = clamp(sideInput, -1, 1);
  const sideMag = Math.abs(sideClamped);

  // Breathing motion (idle chest rise, stronger heavy panting when fatigued, ragged scared panting)
  const breathWave = Math.sin(state.breathPhase);
  const fearWobble = 1 + Math.sin(state.breathPhase * 3) * 0.12 * fearAmount;
  const breathAmpY = (0.0075 + exertion * 0.017 + (exhausted ? 0.007 : 0) + fearAmount * 0.006) * fearWobble;
  const breathPitchAmp = (0.0038 + exertion * 0.011 + (exhausted ? 0.0045 : 0) + fearAmount * 0.0042) * fearWobble;
  const breathY = breathWave * breathAmpY;
  const breathPitch = breathWave * breathPitchAmp;

  // Gait head-bob (two vertical dips per full left-right stride; paused mid-air)
  const stepMotion = clamp(moveRatio, 0, 1) + sprintBlend * 0.65;
  const bobAmpY = 0.015 * stepMotion + sprintBlend * sideMag * 0.014;
  const bobAmpX = 0.011 * clamp(moveRatio, 0, 1) + sprintBlend * (0.024 + sideMag * 0.016);
  const movingOnGround = grounded && moveSpeed > 0.08;
  const targetBobY = movingOnGround ? -Math.abs(Math.sin(state.bobPhase)) * bobAmpY + bobAmpY * 0.45 : 0;
  const targetBobX = movingOnGround ? Math.cos(state.bobPhase) * bobAmpX : 0;
  const targetBobPitch = movingOnGround ? Math.sin(state.bobPhase * 2) * (0.003 + sprintBlend * 0.0055) * clamp(moveRatio, 0, 1) : 0;
  const targetBobRoll = movingOnGround ? Math.cos(state.bobPhase) * (0.0045 + sprintBlend * (0.017 + sideMag * 0.012)) * clamp(moveRatio, 0, 1) : 0;

  // Strafe body lean & head drop from torso tilt + knee bend
  const targetStrafeRoll = -sideClamped * (0.026 + sprintBlend * 0.052);
  const targetStrafeShift = sideClamped * (0.010 + sprintBlend * 0.032);
  const strafeDropY = movingOnGround ? -sideMag * (0.012 + sprintBlend * 0.048) : 0;
  state.strafeRoll += (targetStrafeRoll - state.strafeRoll) * dampStrafe;

  const impulseRoll = clamp(-lookDeltaX * 0.00045, -0.014, 0.014);
  state.lookRoll = clamp(state.lookRoll + impulseRoll, -0.018, 0.018);
  state.lookRoll += (0 - state.lookRoll) * dampFast;

  // Jump mid-air tilt & landing camera reaction (drastic downward slump when low stamina vs light head shake)
  let landY = 0;
  let landPitch = 0;
  let landRoll = 0;
  let landYaw = 0;
  if (jump && !jump.grounded) {
    landPitch = clamp(jump.velY * 0.007, -0.025, 0.025);
  } else if (jump && jump.landDuration > 0 && jump.landTimer < jump.landDuration) {
    const t = jump.landTimer;
    if (jump.landedHeavy) {
      const u = clamp(t / jump.landDuration, 0, 1);
      const hit = smoothstep(0, 0.11, t);
      const fade = 1 - smoothstep(0.74, 1.0, u);
      const strain = 1 + 0.12 * Math.sin(t * 9.5) * Math.exp(-t * 2.1);
      const hold = Math.exp(-Math.max(0, t - 0.16) * 1.55);
      landY = -0.38 * hit * Math.exp(-t * 1.75) * fade;
      landPitch = -0.78 * hit * hold * strain * fade;
      landRoll = jump.landSide * 0.115 * hit * Math.sin(t * 7.2 + 0.35) * Math.exp(-t * 2.0) * fade;
      landYaw = jump.landSide * 0.06 * hit * Math.sin(t * 5.8) * Math.exp(-t * 2.1) * fade;
    } else {
      landY = -0.048 * Math.sin(Math.min(1, t / 0.24) * Math.PI) * Math.exp(-t * 6.8);
      landPitch = -0.036 * Math.sin(Math.min(1, t / 0.22) * Math.PI) * Math.exp(-t * 7.5);
      landRoll = jump.landSide * 0.026 * Math.sin(t * 30) * Math.exp(-t * 12.0);
      landYaw = jump.landSide * 0.014 * Math.sin(t * 27) * Math.exp(-t * 12.5);
    }
  }

  // Trembling (temblar): subtle framerate-independent nervous shiver when the monster is close.
  // Target offsets feed into the damped channels instead of accumulating each frame,
  // and only camera offsets are touched — never the player's real yaw/pitch aim.
  let fearOffsetX = 0;
  let fearOffsetY = 0;
  let fearPitch = 0;
  let fearRoll = 0;
  let fearYaw = 0;
  let fearBlurX = 0;
  let fearBlurY = 0;
  if (fearAmount > 0.01) {
    const fearTremor = fearAmount * fearAmount;
    const tremorWave = Math.sin(state.fearPhase * 1.45) + 0.45 * Math.cos(state.fearPhase * 2.35);
    const shake = tremorWave * fearTremor;
    fearPitch = shake * 0.011;
    fearRoll = shake * 0.009;
    fearYaw = shake * 0.0032;
    fearOffsetX = Math.cos(state.fearPhase * 1.9) * fearTremor * 0.013;
    fearOffsetY = shake * 0.0022;
    fearBlurX = Math.cos(state.fearPhase * 2.1) * fearTremor * 0.0036;
    fearBlurY = Math.sin(state.fearPhase * 2.6) * fearTremor * 0.0036;
  }

  state.baseOffsetY += (breathY + targetBobY + strafeDropY - state.baseOffsetY) * dampFast;
  // Bent knees have less travel left to absorb a landing.
  const landingDrop = landY * (1 - 0.75 * state.crouchAmount);
  state.offsetY = Math.max(-0.55, jumpHeight + landingDrop + state.baseOffsetY + fearOffsetY) - eyeDrop;
  state.offsetX += (targetBobX + targetStrafeShift + fearOffsetX - state.offsetX) * dampFast;
  state.pitchOffset += (breathPitch + targetBobPitch + landPitch + fearPitch - state.pitchOffset) * dampFast;
  state.rollOffset += (state.strafeRoll + state.lookRoll + targetBobRoll + landRoll + fearRoll - state.rollOffset) * dampStrafe;
  state.yawOffset = landYaw + fearYaw;

  // Dynamic FOV for sprinting and subtle exhaustion pulse, plus a gentle heartbeat throb.
  let targetFov = BASE_FOV;
  if (isSprinting) {
    targetFov = SPRINT_FOV;
  } else if (exhausted) {
    targetFov = EXHAUSTED_FOV + breathWave * 1.1;
  }
  targetFov += Math.sin(state.breathPhase * 2) * 0.72 * fearAmount;
  state.fov += (targetFov - state.fov) * dampSlow;

  // Clouded peripheral vision while sprinting or panicking
  const fearCloud = fearAmount * 0.72;
  state.fearBlur = fearCloud;
  const cloudTarget = isSprinting ? 1 : 0;
  const cloudRate = 1 - Math.exp(-(isSprinting ? 2.4 : 2.1) * safeDt);
  state.sprintCloud += (cloudTarget - state.sprintCloud) * cloudRate;
  state.sprintCloud = Math.max(state.sprintCloud, fearCloud);

  // Motion blur only on forceful/abrupt head turns (ignores normal mouse aiming)
  const yawVel = safeDt > 0.0001 ? lookYawDelta / safeDt : 0;
  const pitchVel = safeDt > 0.0001 ? lookPitchDelta / safeDt : 0;
  const angSpeed = Math.hypot(yawVel, pitchVel);
  const speedThreshold = 8.5;
  const rawExcess = clamp((angSpeed - speedThreshold) / 9.5, 0, 1);
  const excess = Math.pow(rawExcess, 1.3);
  const targetBlurX = angSpeed > 0.0001 ? (yawVel / angSpeed) * excess * 0.032 : 0;
  const targetBlurY = angSpeed > 0.0001 ? (pitchVel / angSpeed) * excess * 0.032 : 0;
  const targetMag = Math.hypot(targetBlurX, targetBlurY);
  const currentMag = Math.hypot(state.headBlurX, state.headBlurY);
  const blurDamp = 1 - Math.exp(-(targetMag > currentMag ? 22 : 14) * safeDt);
  state.headBlurX += (targetBlurX + fearBlurX - state.headBlurX) * blurDamp;
  state.headBlurY += (targetBlurY + fearBlurY - state.headBlurY) * blurDamp;

  return state;
}
