import assert from 'node:assert/strict';
import test from 'node:test';
import { ceilingHeight, flyDirection, movePlayer, projectVelocityAfterMove, supportHeight } from '../src/walk.js';
import {
  BASE_FOV,
  CROUCH_EYE_DROP,
  CROUCH_SPEED,
  EXHAUSTED_WALK_SPEED,
  EXHAUSTION_RECOVER_THRESHOLD,
  PLAYER_STAND_HEIGHT,
  SPRINT_FOV,
  SPRINT_SPEED,
  WALK_SPEED,
  computePlayerFear,
  createBlinkState,
  createCameraMotionState,
  createJumpState,
  createStaminaState,
  playerHeadHeight,
  stepBlink,
  stepCameraMotion,
  stepJump,
  stepStamina,
  stumbleSpeedFactor
} from '../src/player-motion.js';

test('the player can slide across the front of both mirrored shoes after touching one', () => {
  const shoes = [
    { x0: -.58, x1: -.24, z0: -.14, z1: .33 },
    { x0: .44, x1: .78, z0: -.14, z1: .330000000000006 }
  ];
  const p = { x: 0, z: 1 };
  movePlayer(p, 0, -.8, shoes);
  assert.equal(p.z, shoes[0].z1 + .245);
  movePlayer(p, 1.2, 0, shoes);
  assert.equal(p.x, 1.2);
});

test('flyDirection follows camera pitch and vertical lift in noclip', () => {
  const upLook = flyDirection(0, Math.PI / 4, 1, 0, 0);
  assert.ok(Math.abs(upLook.x) < 1e-12);
  assert.ok(Math.abs(upLook.y - Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(upLook.z + Math.SQRT1_2) < 1e-12);

  const verticalOnly = flyDirection(1.2, -.5, 0, 0, -1);
  assert.ok(verticalOnly.x === 0 && verticalOnly.y === -1 && verticalOnly.z === 0);
});

test('sprint drains stamina only while moving and enters exhaustion at zero until recovery threshold', () => {
  const s = createStaminaState();

  // Holding shift while stationary does not drain stamina.
  stepStamina(s, { sprinting: true, moving: false, dt: 1.0 });
  assert.equal(s.stamina, 1);
  assert.equal(s.isSprinting, false);

  // Sprinting while moving increases speedLimit and drains stamina.
  stepStamina(s, { sprinting: true, moving: true, dt: 0.5 });
  assert.equal(s.isSprinting, true);
  assert.equal(s.speedLimit, SPRINT_SPEED);
  assert.ok(s.stamina < 1 && s.stamina > 0.8);

  // Drain until exhausted (~8 s of continuous sprint).
  let steps = 0;
  while (!s.exhausted && steps < 200) {
    stepStamina(s, { sprinting: true, moving: true, dt: 0.05 });
    steps++;
  }
  assert.ok(steps >= 140, 'sprint lasts noticeably longer before exhausting');
  assert.equal(s.exhausted, true);
  assert.equal(s.justExhausted, true);
  assert.equal(s.stamina, 0);
  assert.equal(s.speedLimit, EXHAUSTED_WALK_SPEED);

  // Cannot immediately sprint again while exhausted even if holding shift.
  stepStamina(s, { sprinting: true, moving: true, dt: 0.1 });
  assert.equal(s.justExhausted, false);
  assert.equal(s.isSprinting, false);
  assert.ok(s.exertion > 0.7);

  // Recover while standing still until exhaustion clears.
  for (let i = 0; i < 100 && s.exhausted; i++) {
    stepStamina(s, { sprinting: false, moving: false, dt: 0.05 });
  }
  assert.equal(s.exhausted, false);
  assert.ok(s.stamina >= EXHAUSTION_RECOVER_THRESHOLD);
  assert.equal(s.speedLimit, WALK_SPEED);
});

test('crouching lets stamina recover with sprint held and preserves exhaustion on standing', () => {
  const stamina = createStaminaState();
  const input = { sprinting: true, moving: true, dt: 0.05 };
  for (let i = 0; i < 40; i++) stepStamina(stamina, input);
  const afterSprint = stamina.stamina;
  for (let i = 0; i < 20; i++) {
    stepStamina(stamina, { ...input, crouching: true });
    assert.equal(stamina.isSprinting, false);
    assert.equal(stamina.speedLimit, CROUCH_SPEED);
  }
  assert.ok(stamina.stamina > afterSprint);
  stamina.stamina = 0;
  stamina.exhausted = true;
  stepStamina(stamina, { ...input, crouching: true });
  stepStamina(stamina, input);
  assert.equal(stamina.isSprinting, false);
  assert.equal(stamina.exhausted, true);
});

test('stamina regenerates faster when standing still than when walking and grows exponentially without spending', () => {
  const idleRecover = createStaminaState();
  const walkRecover = createStaminaState();
  idleRecover.stamina = 0.2;
  walkRecover.stamina = 0.2;

  const idleDeltas = [];
  for (let sec = 0; sec < 2; sec++) {
    const before = idleRecover.stamina;
    for (let i = 0; i < 10; i++) {
      stepStamina(idleRecover, { sprinting: false, moving: false, dt: 0.05 });
      stepStamina(walkRecover, { sprinting: false, moving: true, dt: 0.05 });
    }
    idleDeltas.push(idleRecover.stamina - before);
  }
  assert.ok(idleRecover.stamina > walkRecover.stamina);
  assert.ok(idleDeltas[1] > idleDeltas[0] * 1.3, 'second recovery window gains significantly more stamina than first');

  // Spending stamina via sprint resets exponential momentum back to base rate.
  stepStamina(idleRecover, { sprinting: true, moving: true, dt: 0.1 });
  assert.equal(idleRecover.recoveryTime, 0);
  //Wait out recovery delay, then first recovery chunk matches base pace rather than boosted pace.
  for (let i = 0; i < 8; i++) {
    stepStamina(idleRecover, { sprinting: false, moving: false, dt: 0.05 });
  }
  const beforeResetGain = idleRecover.stamina;
  for (let i = 0; i < 10; i++) {
    stepStamina(idleRecover, { sprinting: false, moving: false, dt: 0.05 });
  }
  const resetFirstGain = idleRecover.stamina - beforeResetGain;
  assert.ok(Math.abs(resetFirstGain - idleDeltas[0]) < 0.005);
});

test('stepBlink keeps default blinks subtle and exaggerates blinks only on stamina exhaustion', () => {
  const b = createBlinkState(() => 0.5);
  assert.equal(b.amount, 0);

  // Exhaustion triggers an immediate full-closure heavy blink.
  let heavyPeak = 0;
  stepBlink(b, 0.05, { exhausted: true, justExhausted: true, exertion: 1 }, () => 0.5);
  assert.equal(b.heavy, true);
  heavyPeak = Math.max(heavyPeak, b.amount);
  for (let i = 0; i < 12; i++) {
    stepBlink(b, 0.03, { exhausted: true, justExhausted: false, exertion: 1 }, () => 0.5);
    heavyPeak = Math.max(heavyPeak, b.amount);
  }
  assert.ok(heavyPeak > 0.85, 'exhaustion blink closes eyes fully');
  assert.equal(b.amount, 0);
  assert.equal(b.elapsed, -1);

  // Default natural blink stays subtle and less frequent.
  let normalPeak = 0;
  for (let i = 0; i < 420; i++) {
    stepBlink(b, 0.03, { exhausted: false, justExhausted: false, exertion: 0 }, () => 0.25);
    normalPeak = Math.max(normalPeak, b.amount);
  }
  assert.ok(normalPeak > 0.25 && normalPeak <= 0.45, 'default blink stays light');
});

test('stepCameraMotion drives idle breathing, sprint FOV/roll/bob, and respects reducedMotion', () => {
  const m = createCameraMotionState();

  // Idle breathing moves camera slightly vertically and pitches smoothly.
  stepCameraMotion(m, { dt: 0.3, moveSpeed: 0, isSprinting: false, exertion: 0 });
  assert.ok(Math.abs(m.offsetY) > 0);
  assert.ok(Math.abs(m.pitchOffset) > 0);

  // Sprinting widens FOV, tilts on strafe, and fires footstep events.
  let stepsTriggered = 0;
  for (let i = 0; i < 40; i++) {
    stepCameraMotion(m, {
      dt: 0.03,
      moveSpeed: SPRINT_SPEED,
      isSprinting: true,
      sideInput: 1,
      lookDeltaX: 25,
      exertion: 0.9
    });
    if (m.stepEvent > 0) stepsTriggered++;
  }
  assert.ok(stepsTriggered > 0);
  assert.ok(m.fov > BASE_FOV + 2 && m.fov <= SPRINT_FOV);
  assert.ok(m.rollOffset < -0.05, 'sprinting laterally tilts camera strongly to reflect body lean');

  const walkStrafe = createCameraMotionState();
  for (let i = 0; i < 40; i++) {
    stepCameraMotion(walkStrafe, { dt: 0.03, moveSpeed: WALK_SPEED, isSprinting: false, sideInput: 1 });
  }
  assert.ok(Math.abs(m.rollOffset) > Math.abs(walkStrafe.rollOffset) * 2.2);

  const straightSprint = createCameraMotionState();
  const sideSprint = createCameraMotionState();
  let straightAvgY = 0;
  let sideAvgY = 0;
  for (let i = 0; i < 40; i++) {
    stepCameraMotion(straightSprint, { dt: 0.03, moveSpeed: SPRINT_SPEED, isSprinting: true, sideInput: 0 });
    stepCameraMotion(sideSprint, { dt: 0.03, moveSpeed: SPRINT_SPEED, isSprinting: true, sideInput: 1 });
    straightAvgY += straightSprint.offsetY;
    sideAvgY += sideSprint.offsetY;
  }
  assert.ok(sideAvgY / 40 < straightAvgY / 40 - 0.03, 'running sideways lowers head height due to body lean');

  // Reduced motion suppresses camera offsets and keeps base FOV.
  stepCameraMotion(m, {
    dt: 0.05,
    moveSpeed: SPRINT_SPEED,
    isSprinting: true,
    sideInput: 1,
    lookDeltaX: 20,
    lookYawDelta: 0.4,
    exertion: 1,
    reducedMotion: true
  });
  assert.equal(m.offsetX, 0);
  assert.equal(m.offsetY, 0);
  assert.equal(m.rollOffset, 0);
  assert.equal(m.fov, BASE_FOV);
  assert.equal(m.sprintCloud, 0);
  assert.equal(m.headBlurX, 0);
  assert.equal(m.headBlurY, 0);
});

test('sprint clouds vision and forceful head whips apply directional blur without blurring normal mouse movement', () => {
  const m = createCameraMotionState();

  // Normal and brisk mouse looking (~5 rad/s) stays below threshold -> no blur.
  stepCameraMotion(m, {
    dt: 0.05,
    moveSpeed: WALK_SPEED,
    isSprinting: false,
    lookYawDelta: 0.25,
    lookPitchDelta: 0.04
  });
  assert.equal(m.headBlurX, 0);
  assert.equal(m.headBlurY, 0);
  assert.equal(m.sprintCloud, 0);

  // Sprinting clouds vision progressively.
  for (let i = 0; i < 15; i++) {
    stepCameraMotion(m, {
      dt: 0.04,
      moveSpeed: SPRINT_SPEED,
      isSprinting: true
    });
  }
  assert.ok(m.sprintCloud > 0.6);

  // Forceful whip (~16 rad/s over consecutive frames) triggers horizontal blur.
  for (let i = 0; i < 3; i++) {
    stepCameraMotion(m, {
      dt: 0.016,
      moveSpeed: WALK_SPEED,
      isSprinting: false,
      lookYawDelta: 0.26,
      lookPitchDelta: 0.02
    });
  }
  assert.ok(Math.abs(m.headBlurX) > Math.abs(m.headBlurY));
  assert.ok(Math.hypot(m.headBlurX, m.headBlurY) > 0.005);

  // Decays smoothly back toward 0 when head stops turning and sprint ends.
  for (let i = 0; i < 60; i++) {
    stepCameraMotion(m, { dt: 0.05, moveSpeed: 0, isSprinting: false });
  }
  assert.ok(Math.hypot(m.headBlurX, m.headBlurY) < 0.0005);
  assert.ok(m.sprintCloud < 0.02);
});

test('normal jump lands with a light head shake while low-stamina jump causes a heavy stumble landing', () => {
  const normalStamina = createStaminaState();
  const normalJump = createJumpState();
  const normalCam = createCameraMotionState();

  stepJump(normalJump, normalStamina, { wantJump: true, dt: 0.016, sideInput: 0 });
  assert.equal(normalJump.grounded, false);
  assert.equal(normalJump.justJumped, true);
  assert.ok(normalStamina.stamina < 1);

  let maxHeight = 0;
  let landedNormal = false;
  for (let i = 0; i < 60 && !landedNormal; i++) {
    stepJump(normalJump, normalStamina, { dt: 0.02 });
    maxHeight = Math.max(maxHeight, normalJump.height);
    if (normalJump.justLanded) landedNormal = true;
  }
  assert.ok(maxHeight > 0.7 && maxHeight < 0.95);
  assert.equal(landedNormal, true);
  assert.equal(normalJump.landedHeavy, false);
  assert.equal(normalJump.stumbleCooldown, 0);

  let normalMinPitch = 0;
  let normalMaxYaw = 0;
  for (let i = 0; i < 10; i++) {
    stepJump(normalJump, normalStamina, { dt: 0.025 });
    stepCameraMotion(normalCam, { dt: 0.025, moveSpeed: 0, jump: normalJump });
    normalMinPitch = Math.min(normalMinPitch, normalCam.pitchOffset);
    normalMaxYaw = Math.max(normalMaxYaw, Math.abs(normalCam.yawOffset));
  }
  assert.ok(normalMaxYaw > 0.002, 'normal landing triggers subtle head shake');

  // Low-stamina jump triggers heavy landing with drastic drop and multi-second slow recovery.
  const lowStamina = createStaminaState();
  lowStamina.stamina = 0.18;
  const lowJump = createJumpState();
  const lowCam = createCameraMotionState();

  stepJump(lowJump, lowStamina, { wantJump: true, dt: 0.016, sideInput: 1 });
  let landedLow = false;
  for (let i = 0; i < 60 && !landedLow; i++) {
    stepJump(lowJump, lowStamina, { dt: 0.02 });
    if (lowJump.justLanded) landedLow = true;
  }
  assert.equal(landedLow, true);
  assert.equal(lowJump.landedHeavy, true);
  assert.ok(lowJump.stumbleCooldown >= 2.5);
  assert.ok(stumbleSpeedFactor(lowJump) <= 0.35, 'initial recovery speed is heavily slowed');

  let heavyMinY = 0;
  let heavyMinPitch = 0;
  let heavyMaxRoll = 0;
  for (let i = 0; i < 24; i++) {
    stepJump(lowJump, lowStamina, { dt: 0.025 });
    stepCameraMotion(lowCam, { dt: 0.025, moveSpeed: 0, jump: lowJump, exertion: lowStamina.exertion });
    heavyMinY = Math.min(heavyMinY, lowCam.offsetY);
    heavyMinPitch = Math.min(heavyMinPitch, lowCam.pitchOffset);
    heavyMaxRoll = Math.max(heavyMaxRoll, Math.abs(lowCam.rollOffset));
  }
  assert.ok(heavyMinY < -0.22, 'heavy landing drops camera deeply');
  assert.ok(heavyMinY > -0.55, 'camera drop stays safely above floor without accumulating');
  assert.ok(heavyMinPitch < -0.50, 'head pitches strongly toward the floor and resists lifting');
  assert.ok(heavyMinPitch < normalMinPitch * 8);
  assert.ok(heavyMaxRoll > 0.04, 'heavy landing stumbles roll drastically');

  // After ~1.4s total, player is still moving slowly before reaching full recovery at 2.8s.
  for (let i = 0; i < 32; i++) {
    stepJump(lowJump, lowStamina, { dt: 0.025 });
  }
  assert.ok(stumbleSpeedFactor(lowJump) < 0.7, 'still recovering speed mid-way');
  for (let i = 0; i < 70; i++) {
    stepJump(lowJump, lowStamina, { dt: 0.025 });
  }
  assert.equal(stumbleSpeedFactor(lowJump), 1);
});

test('a crouched heavy landing keeps its impact and stumble without stacking two full camera drops', () => {
  const stamina = createStaminaState();
  stamina.stamina = 0.16;
  const jump = createJumpState();
  const standing = createCameraMotionState(), crouched = createCameraMotionState();
  stepCameraMotion(crouched, { isCrouching: true, reducedMotion: true });
  stepJump(jump, stamina, { wantJump: true });

  let landed = false, standingDip = 0, crouchedDip = 0;
  for (let i = 0; i < 90; i++) {
    stepJump(jump, stamina, { dt: 1 / 60 });
    stepCameraMotion(standing, { jump, dt: 1 / 60 });
    stepCameraMotion(crouched, { jump, dt: 1 / 60, isCrouching: true });
    if (jump.justLanded) {
      landed = true;
      assert.equal(jump.landedHeavy, true);
      assert.ok(stumbleSpeedFactor(jump) < 0.35);
    }
    if (!landed) {
      assert.ok(Math.abs(standing.offsetY - crouched.offsetY - CROUCH_EYE_DROP) < 1e-9);
      assert.equal(crouched.stepEvent, 0);
    } else {
      standingDip = Math.min(standingDip, standing.offsetY);
      crouchedDip = Math.min(crouchedDip, crouched.offsetY + CROUCH_EYE_DROP);
    }
  }
  assert.equal(landed, true);
  assert.ok(crouchedDip < -0.03 && crouchedDip > standingDip);
});

test('player can jump onto the hallway bench and drops back down when walking off', () => {
  const benchObstacles = [
    { x0: -2.22, x1: -2.08, z0: -2.07, z1: -0.23, top: 0.78 },
    { x0: -2.08, x1: -1.68, z0: -2.07, z1: -0.23, top: 0.48 }
  ];
  const p = { x: -1.35, z: -1.15 };
  const stamina = createStaminaState();
  const jump = createJumpState();

  // At floor height, walking into the bench stops at its front edge.
  movePlayer(p, -0.5, 0, benchObstacles, jump.height);
  assert.equal(p.x, -1.68 + 0.245);

  // Jump and move onto the bench seat once above 0.48 m.
  stepJump(jump, stamina, { wantJump: true, dt: 0.016, floorHeight: 0 });
  for (let i = 0; i < 16; i++) {
    stepJump(jump, stamina, { dt: 0.02, floorHeight: supportHeight(p.x, p.z, jump.height, benchObstacles) });
    movePlayer(p, -0.025, 0, benchObstacles, jump.height);
  }
  assert.ok(p.x < -1.55, 'player moves over the bench seat while airborne');

  // Continue falling until landing cleanly on top of the bench at y = 0.48 m.
  for (let i = 0; i < 40 && !jump.grounded; i++) {
    const floorH = supportHeight(p.x, p.z, jump.height, benchObstacles);
    stepJump(jump, stamina, { dt: 0.02, floorHeight: floorH });
  }
  assert.equal(jump.grounded, true);
  assert.equal(jump.height, 0.48);

  // Walking off the bench makes the player fall back down to the corridor floor (0 m).
  movePlayer(p, 0.6, 0, benchObstacles, jump.height);
  for (let i = 0; i < 40; i++) {
    const floorH = supportHeight(p.x, p.z, jump.height, benchObstacles);
    stepJump(jump, stamina, { dt: 0.02, floorHeight: floorH });
  }
  assert.equal(jump.grounded, true);
  assert.equal(jump.height, 0);
});

test('projectVelocityAfterMove preserves tangential velocity on angled barriers without altering axis-aligned stops', () => {
  const dt = 1 / 60;
  // Unobstructed move keeps full velocity.
  assert.deepEqual(projectVelocityAfterMove(2, -1, 2 * dt, -1 * dt, dt), [2, -1]);

  // Purely X-blocked move zeros vx and keeps vz.
  assert.deepEqual(projectVelocityAfterMove(2, -1.5, 0, -1.5 * dt, dt), [0, -1.5]);

  // Angled barrier at 45° deflects (2, 0) along (1, -1): residual is along (1, 1) -> tangential (1, -1) survives.
  const [vx, vz] = projectVelocityAfterMove(2, 0, 1 * dt, -1 * dt, dt);
  assert.ok(Math.abs(vx - 1) < 1e-9, `expected vx ~ 1, got ${vx}`);
  assert.ok(Math.abs(vz + 1) < 1e-9, `expected vz ~ -1, got ${vz}`);
});

test('player slides smoothly past a rounded doorway jamb and angled door leaf instead of wedging', () => {
  const angle = 0.85;
  const hx = 2.323;
  const hz = -0.34;
  const leaf = 0.98;
  const obstacles = [
    { x0: 2.22, x1: 2.39, z0: -5.0, z1: -0.41, rounded: true },
    { x0: 2.22, x1: 2.39, z0: 0.71, z1: 5.0, rounded: true },
    {
      kind: 'segment',
      ax: hx,
      az: hz,
      bx: hx + Math.sin(angle) * leaf,
      bz: hz + Math.cos(angle) * leaf,
      halfThick: 0.034,
      active: true
    }
  ];

  // Walking along the corridor slightly angled toward the right wall past the open doorway.
  const p = { x: 1.975, z: 0.25 };
  let vx = 0.28;
  let vz = -2.4;
  const dt = 0.016;
  for (let i = 0; i < 60; i++) {
    vx += (0.28 - vx) * 0.2;
    vz += (-2.4 - vz) * 0.2;
    const oldX = p.x;
    const oldZ = p.z;
    movePlayer(p, vx * dt, vz * dt, obstacles, 0, { minX: -2.22, maxX: 5.5, minZ: -5, maxZ: 5 });
    [vx, vz] = projectVelocityAfterMove(vx, vz, p.x - oldX, p.z - oldZ, dt);
  }
  assert.ok(p.z < -0.9, `expected player to slide past doorway jamb to z < -0.9, got z=${p.z}`);
});

test('overhead ceilings and doorway headers cap jump height and block mid-air horizontal clipping', () => {
  const doorwayLintel = {
    x0: 3.537,
    x1: 3.77,
    z0: -0.56,
    z1: 0.56,
    bottom: 2.222,
    top: 3.08,
    rounded: true
  };
  const benchBackrest = { x0: -3.60, x1: -3.46, z0: 16.58, z1: 18.42, top: 0.78 };
  const crossBeam = { x0: -3.60, x1: 3.60, z0: 16.675, z1: 16.925, bottom: 2.96, top: 3.08 };
  const obstacles = [doorwayLintel, benchBackrest, crossBeam];

  // Overhead lintels/beams never act as walkable supports.
  assert.equal(supportHeight(3.65, 0, 3.5, obstacles), 0);

  // Jumping from the bench backrest stays below the corridor ceiling (3.08 m) and crossbeam (2.96 m).
  for (const [z, expectedCeil] of [[17.6, 3.08], [16.8, 2.96]]) {
    const ceil = ceilingHeight(-3.35, z, 0.78, obstacles);
    assert.equal(ceil, expectedCeil);
    const stamina = createStaminaState();
    const jump = createJumpState();
    jump.height = 0.78;
    stepJump(jump, stamina, { wantJump: true, dt: 1 / 60, floorHeight: 0.78, ceilingHeight: ceil });
    let peak = jump.height;
    for (let i = 0; i < 60 && !jump.grounded; i++) {
      stepJump(jump, stamina, { dt: 1 / 60, floorHeight: 0.78, ceilingHeight: ceil });
      peak = Math.max(peak, jump.height);
    }
    assert.ok(peak + PLAYER_STAND_HEIGHT <= expectedCeil + 1e-9, 'head stays below ceiling');
    assert.equal(jump.grounded, true);
    assert.equal(jump.height, 0.78);
  }

  // Jumping directly under a doorway header caps cleanly below 2.222 m.
  const underCeil = ceilingHeight(3.65, 0, 0, obstacles);
  assert.equal(underCeil, 2.222);
  const doorStamina = createStaminaState();
  const doorJump = createJumpState();
  stepJump(doorJump, doorStamina, { wantJump: true, dt: 1 / 60, floorHeight: 0, ceilingHeight: underCeil });
  let doorPeak = 0;
  for (let i = 0; i < 60 && !doorJump.grounded; i++) {
    stepJump(doorJump, doorStamina, { dt: 1 / 60, floorHeight: 0, ceilingHeight: underCeil });
    doorPeak = Math.max(doorPeak, doorJump.height);
  }
  assert.ok(doorPeak + PLAYER_STAND_HEIGHT <= 2.222 + 1e-9, 'head stays below classroom doorway header');

  // Walking horizontally while standing on the floor clears the doorway header.
  const bounds = { minX: -3.6, maxX: 8, minZ: -5, maxZ: 20 };
  const walking = { x: 3.1, z: 0 };
  movePlayer(walking, 1.2, 0, obstacles, 0, bounds);
  assert.ok(walking.x > 4.0, 'standing walk passes cleanly beneath doorway lintel');

  // Jumping high before the doorway blocks horizontal entry through the header until dropping back under it.
  const highJump = { x: 3.1, z: 0 };
  movePlayer(highJump, 1.2, 0, obstacles, 0.65, bounds);
  assert.ok(highJump.x <= doorwayLintel.x0 - 0.245 + 1e-6, 'mid-air jump is blocked by doorway header');

  // Crouched height clears slightly higher mid-air jumps than standing.
  assert.ok(playerHeadHeight(1) < playerHeadHeight(0));
});

test('computePlayerFear spikes strongly from proximity even while patrolling out of sight, and jumps with sight', () => {
  // Unknown monster position means no fear at all.
  assert.equal(computePlayerFear({ playerX: 0, playerZ: 0, playerYaw: 0 }), 0);
  assert.equal(computePlayerFear({ playerX: 0, playerZ: 0, playerYaw: 0, monsterX: NaN, monsterZ: 2 }), 0);
  assert.equal(computePlayerFear({ playerX: 0, playerZ: 0, playerYaw: 0, monsterX: 2, monsterZ: Infinity }), 0);

  // Capture is absolute terror.
  assert.equal(computePlayerFear({
    playerX: 0, playerZ: 0, playerYaw: 0,
    monsterX: 0, monsterZ: -2, monsterMode: 'capture'
  }), 1);

  // Proximity dread is felt with NO line of sight and while merely patrolling,
  // including when the monster is behind the player.
  const hiddenClose = computePlayerFear({
    playerX: 0, playerZ: 0, playerYaw: 0,
    monsterX: 0, monsterZ: -2, monsterVisible: false, monsterMode: 'patrol'
  });
  const hiddenBehind = computePlayerFear({
    playerX: 0, playerZ: 0, playerYaw: 0,
    monsterX: 0, monsterZ: 2, monsterVisible: false, monsterMode: 'patrol'
  });
  const hiddenMid = computePlayerFear({
    playerX: 0, playerZ: 0, playerYaw: 0,
    monsterX: 0, monsterZ: -8, monsterVisible: false, monsterMode: 'patrol'
  });
  const hiddenEdge = computePlayerFear({
    playerX: 0, playerZ: 0, playerYaw: 0,
    monsterX: 0, monsterZ: -11.4, monsterVisible: false, monsterMode: 'patrol'
  });
  assert.ok(hiddenClose > 0.7, `a patrolling monster 2 m away is terrifying, got ${hiddenClose}`);
  assert.ok(hiddenBehind > 0.7, `proximity fear ignores facing, got ${hiddenBehind}`);
  assert.ok(hiddenMid > 0.1 && hiddenMid < hiddenClose, 'dread fades with distance');
  assert.ok(hiddenEdge > 0 && hiddenEdge < 0.01, 'almost no fear at the 11.5 m edge');
  assert.equal(computePlayerFear({
    playerX: 0, playerZ: 0, playerYaw: 0,
    monsterX: 0, monsterZ: -11.6, monsterVisible: false, monsterMode: 'patrol'
  }), 0);
  assert.equal(computePlayerFear({
    playerX: 0, playerZ: 0, playerYaw: 0,
    monsterX: 0, monsterZ: -20, monsterVisible: true, monsterMode: 'chase'
  }), 0);

  // Looking straight at the monster: forward is -Z at yaw 0.
  // Direct eye contact spikes the same proximity into a much higher fear.
  const seenUpClose = computePlayerFear({
    playerX: 0, playerZ: 0, playerYaw: 0,
    monsterX: 0, monsterZ: -2, monsterVisible: true, monsterMode: 'patrol'
  });
  const playerSees = computePlayerFear({
    playerX: 0, playerZ: 0, playerYaw: 0,
    monsterX: 0, monsterZ: -2, monsterVisible: false, monsterMode: 'patrol', playerSeesMonster: true
  });
  assert.ok(seenUpClose > hiddenClose, 'seeing her up close spikes the fear beyond proximity alone');
  assert.ok(playerSees > hiddenClose, 'the player\'s own line-of-sight check also spikes fear');

  const near = computePlayerFear({
    playerX: 0, playerZ: 0, playerYaw: 0,
    monsterX: 0, monsterZ: -2, monsterVisible: true, monsterMode: 'chase'
  });
  const mid = computePlayerFear({
    playerX: 0, playerZ: 0, playerYaw: 0,
    monsterX: 0, monsterZ: -8, monsterVisible: true, monsterMode: 'chase'
  });
  const far = computePlayerFear({
    playerX: 0, playerZ: 0, playerYaw: 0,
    monsterX: 0, monsterZ: -13, monsterVisible: true, monsterMode: 'chase'
  });
  assert.ok(near > 0.9, `close monster should terrify, got ${near}`);
  assert.ok(mid > 0.35 && mid < 0.7, `mid-range chase fear, got ${mid}`);
  assert.ok(far < mid && far > 0, `far sight still carries some dread, got ${far}`);
  assert.ok(near <= 1 && mid >= 0);

  // A chase is scarier than a patrol at the same proximity.
  const chaseSameRange = computePlayerFear({
    playerX: 0, playerZ: 0, playerYaw: 0,
    monsterX: 0, monsterZ: -2, monsterVisible: false, monsterMode: 'chase'
  });
  assert.ok(chaseSameRange > hiddenClose, 'a close chase adds pressure over a patrol');
  assert.ok(computePlayerFear({
    playerX: 0, playerZ: 0, playerYaw: 0,
    monsterX: 0, monsterZ: -2, monsterVisible: false, monsterMode: 'investigate'
  }) > hiddenClose);
});

test('fear hyperventilates the camera, adds visible trembling and panic vignette distortion', () => {
  const calm = createCameraMotionState();
  const scared = createCameraMotionState();
  assert.equal(calm.fear, 0);
  assert.equal(scared.fear + scared.fearPhase + scared.fearBlur, 0);

  for (let i = 0; i < 30; i++) {
    stepCameraMotion(calm, { dt: 0.016 });
    stepCameraMotion(scared, { dt: 0.016, fear: 1 });
  }
  assert.ok(scared.fear > 0.9, `fear damps up quickly, got ${scared.fear}`);
  assert.ok(scared.breathSpeed > calm.breathSpeed * 2.5,
    `terror makes breathing much faster (${scared.breathSpeed} vs ${calm.breathSpeed})`);

  // Trembling is visible as high-frequency offsets that idle breathing never produces.
  let calmMaxYaw = 0, scaredMaxYaw = 0;
  let calmMaxX = 0, scaredMaxX = 0;
  let calmMaxPitch = 0, scaredMaxPitch = 0;
  let maxFovDeviation = 0;
  let maxBlur = 0;
  for (let i = 0; i < 60; i++) {
    stepCameraMotion(calm, { dt: 0.016 });
    stepCameraMotion(scared, { dt: 0.016, fear: 1 });
    calmMaxYaw = Math.max(calmMaxYaw, Math.abs(calm.yawOffset));
    scaredMaxYaw = Math.max(scaredMaxYaw, Math.abs(scared.yawOffset));
    calmMaxX = Math.max(calmMaxX, Math.abs(calm.offsetX));
    scaredMaxX = Math.max(scaredMaxX, Math.abs(scared.offsetX));
    calmMaxPitch = Math.max(calmMaxPitch, Math.abs(calm.pitchOffset));
    scaredMaxPitch = Math.max(scaredMaxPitch, Math.abs(scared.pitchOffset));
    maxFovDeviation = Math.max(maxFovDeviation, Math.abs(scared.fov - BASE_FOV));
    maxBlur = Math.max(maxBlur, Math.hypot(scared.headBlurX, scared.headBlurY));
  }
  assert.equal(calmMaxYaw, 0);
  assert.ok(scaredMaxYaw > 0.003, `head trembles while staring at the monster, got ${scaredMaxYaw}`);
  assert.ok(scaredMaxX > 0.003, `hands/body shake sideways, got ${scaredMaxX}`);
  assert.ok(scaredMaxPitch > calmMaxPitch * 2, `head pitches with fear tremors, got ${scaredMaxPitch}`);
  assert.ok(maxFovDeviation > 0.25, `nervous heartbeat pulses the FOV, got ${maxFovDeviation}`);
  assert.ok(scared.sprintCloud > 0.5, 'panic clouds the periphery');
  assert.ok(scared.fearBlur > 0.5);
  assert.ok(maxBlur > 0.0005, `peripheral blur jitters, got ${maxBlur}`);

  // Fear decays slowly once the monster leaves the view.
  stepCameraMotion(scared, { dt: 0.05, fear: 0 });
  assert.ok(scared.fear > 0.85 && scared.fear < 1, `slow dread decay, got ${scared.fear}`);
  for (let i = 0; i < 120; i++) stepCameraMotion(scared, { dt: 0.05, fear: 0 });
  assert.ok(scared.fear < 0.05);
  assert.ok(scared.sprintCloud < 0.05);
});

test('reduced motion keeps fear tracked but suppresses trembling, FOV throb and panic blur', () => {
  const m = createCameraMotionState();
  for (let i = 0; i < 20; i++) {
    stepCameraMotion(m, { dt: 0.05, fear: 1, reducedMotion: true });
  }
  assert.ok(m.fear > 0.9, `audio/HUD can still read fear, got ${m.fear}`);
  assert.equal(m.offsetX, 0);
  assert.equal(m.offsetY, 0);
  assert.equal(m.pitchOffset, 0);
  assert.equal(m.rollOffset, 0);
  assert.equal(m.yawOffset, 0);
  assert.equal(m.fov, BASE_FOV);
  assert.equal(m.sprintCloud, 0);
  assert.equal(m.headBlurX, 0);
  assert.equal(m.headBlurY, 0);
  assert.equal(m.fearBlur, 0);

  // dt 0 snaps the fear target so a paused frame still carries the exact state.
  const snap = createCameraMotionState();
  stepCameraMotion(snap, { dt: 0, fear: 0.72 });
  assert.equal(snap.fear, 0.72);
});

test('a terrified player blinks faster and more nervously than a calm one', () => {
  const calm = createBlinkState(() => 0.5);
  const scared = createBlinkState(() => 0.5);
  calm.timer = 1.2;
  scared.timer = 1.2;

  let calmBlinked = false, scaredBlinked = false;
  for (let i = 0; i < 14; i++) {
    stepBlink(calm, 0.05, { exertion: 0, fear: 0 }, () => 0.5);
    if (calm.elapsed >= 0 || calm.amount > 0) calmBlinked = true;
    stepBlink(scared, 0.05, { exertion: 0, fear: 0.9 }, () => 0.5);
    if (scared.elapsed >= 0 || scared.amount > 0) scaredBlinked = true;
  }
  assert.equal(calmBlinked, false, 'calm player has not blinked yet');
  assert.equal(scaredBlinked, true, 'terrified player blinks much sooner');
});

test('fear camera tremor stays subtle, bounded, and framerate-independent across 60 and 120 FPS', () => {
  const peaks = fps => {
    const m = createCameraMotionState();
    const dt = 1 / fps;
    let maxPitch = 0;
    let maxRoll = 0;
    let maxX = 0;
    for (let i = 0; i < fps * 2; i++) {
      stepCameraMotion(m, { dt, fear: 1 });
      if (i >= fps / 2) {
        maxPitch = Math.max(maxPitch, Math.abs(m.pitchOffset));
        maxRoll = Math.max(maxRoll, Math.abs(m.rollOffset));
        maxX = Math.max(maxX, Math.abs(m.offsetX));
      }
    }
    return { maxPitch, maxRoll, maxX };
  };

  const p60 = peaks(60);
  const p120 = peaks(120);
  assert.ok(p60.maxPitch < 0.018 && p120.maxPitch < 0.018, 'pitch tremble stays gentle');
  assert.ok(p60.maxRoll < 0.008 && p120.maxRoll < 0.008, 'roll tremble stays gentle');
  assert.ok(p60.maxX < 0.008 && p120.maxX < 0.008, 'horizontal sway stays subtle');
  assert.ok(Math.abs(p120.maxPitch - p60.maxPitch) < 0.002, '120 FPS does not amplify pitch tremor');
  assert.ok(Math.abs(p120.maxRoll - p60.maxRoll) < 0.001, '120 FPS does not amplify roll tremor');
});


