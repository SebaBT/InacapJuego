import { annex, hall, worldBounds } from './layout.js';
import {
  BASE_FOV,
  CROUCH_SPEED,
  PLAYER_STAND_HEIGHT,
  createBlinkState,
  createCameraMotionState,
  createJumpState,
  createStaminaState,
  playerHeadHeight,
  playerNoiseRadius,
  stepBlink,
  stepCameraMotion,
  stepJump,
  stepStamina,
  stumbleSpeedFactor
} from './player-motion.js';
import { detectFloorSurface, makePlayerAudio } from './player-audio.js';
import { createThirdPersonState, isThirdPersonTransitioning, stepBodyFacing, stepThirdPersonCamera } from './third-person.js';
import { bindTouchStick } from './touch-stick.js';

const eyeHeight = 1.61;
const radius = .245;
const cameraCeilingMargin = .12;
const overheadClearanceTolerance = .005;
// Mirroring a shoe can move its computed world-space bounds by a few ULPs.
const contactTolerance = 1e-7;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export function flyDirection(yaw, pitch, forward, side, lift) {
  const cosPitch = Math.cos(pitch), sinPitch = Math.sin(pitch);
  const sinYaw = Math.sin(yaw), cosYaw = Math.cos(yaw);
  return {
    x: cosYaw * side - sinYaw * cosPitch * forward,
    y: sinPitch * forward + lift,
    z: -sinYaw * side - cosYaw * cosPitch * forward
  };
}

export function supportHeight(x, z, footY, obstacles) {
  let height = 0;
  for (const b of obstacles) {
    if (b.active === false || b.kind === 'segment' || b.bottom !== undefined) continue;
    const stepSlack = b.step ? 0.22 : 0.06;
    if (b.top === undefined || footY < b.top - stepSlack) continue;
    if (x <= b.x0 - radius + contactTolerance || x >= b.x1 + radius - contactTolerance) continue;
    if (z <= b.z0 - radius + contactTolerance || z >= b.z1 + radius - contactTolerance) continue;
    height = Math.max(height, b.top);
  }
  return height;
}

export function ceilingHeight(x, z, footY = 0, obstacles = []) {
  let ceiling = z + radius <= hall.far ? annex.height : hall.height;
  for (const b of obstacles) {
    if (b.active === false || b.kind === 'segment' || b.bottom === undefined) continue;
    if (b.top !== undefined && footY >= b.top - contactTolerance) continue;
    if (x <= b.x0 - radius + contactTolerance || x >= b.x1 + radius - contactTolerance) continue;
    if (z <= b.z0 - radius + contactTolerance || z >= b.z1 + radius - contactTolerance) continue;
    ceiling = Math.min(ceiling, b.bottom);
  }
  return ceiling;
}

function resolveAabbs(prevX, prevZ, candX, candZ, obstacles, footY, area, headY) {
  let x = clamp(candX, area.minX + radius, area.maxX - radius);
  for (const b of obstacles) {
    if (b.active === false || b.kind === 'segment' || b.rounded) continue;
    const stepClear = b.step ? 0.20 : 0.03;
    if (b.top !== undefined && footY >= b.top - stepClear) continue;
    if (b.bottom !== undefined && headY <= b.bottom + overheadClearanceTolerance) continue;
    if (prevZ <= b.z0 - radius + contactTolerance || prevZ >= b.z1 + radius - contactTolerance) continue;
    if (prevX <= b.x0 - radius) x = Math.min(x, b.x0 - radius);
    if (prevX >= b.x1 + radius) x = Math.max(x, b.x1 + radius);
  }
  let z = clamp(candZ, area.minZ + radius, area.maxZ - radius);
  for (const b of obstacles) {
    if (b.active === false || b.kind === 'segment' || b.rounded) continue;
    const stepClear = b.step ? 0.20 : 0.03;
    if (b.top !== undefined && footY >= b.top - stepClear) continue;
    if (b.bottom !== undefined && headY <= b.bottom + overheadClearanceTolerance) continue;
    if (x <= b.x0 - radius + contactTolerance || x >= b.x1 + radius - contactTolerance) continue;
    if (prevZ <= b.z0 - radius) z = Math.min(z, b.z0 - radius);
    if (prevZ >= b.z1 + radius) z = Math.max(z, b.z1 + radius);
  }
  return [x, z];
}

function resolveRoundedAabbs(x, z, prevX, prevZ, obstacles, footY, headY) {
  for (const b of obstacles) {
    if (b.active === false || b.kind === 'segment' || !b.rounded) continue;
    const stepClear = b.step ? 0.20 : 0.03;
    if (b.top !== undefined && footY >= b.top - stepClear) continue;
    if (b.bottom !== undefined && headY <= b.bottom + overheadClearanceTolerance) continue;
    const cx = clamp(x, b.x0, b.x1);
    const cz = clamp(z, b.z0, b.z1);
    const offX = x - cx;
    const offZ = z - cz;
    const distSq = offX * offX + offZ * offZ;
    if (distSq >= radius * radius - contactTolerance) continue;
    const dist = Math.sqrt(distSq);
    if (dist > 1e-6) {
      x = cx + (offX / dist) * radius;
      z = cz + (offZ / dist) * radius;
    } else {
      const dL = Math.abs(prevX - b.x0);
      const dR = Math.abs(b.x1 - prevX);
      const dT = Math.abs(prevZ - b.z0);
      const dB = Math.abs(b.z1 - prevZ);
      const m = Math.min(dL, dR, dT, dB);
      if (m === dL) x = b.x0 - radius;
      else if (m === dR) x = b.x1 + radius;
      else if (m === dT) z = b.z0 - radius;
      else z = b.z1 + radius;
    }
  }
  return [x, z];
}

function resolveSegments(x, z, prevX, prevZ, obstacles, footY, headY) {
  for (const b of obstacles) {
    if (b.active === false || b.kind !== 'segment') continue;
    if (b.top !== undefined && footY >= b.top - 0.03) continue;
    if (b.bottom !== undefined && headY <= b.bottom + overheadClearanceTolerance) continue;
    const segX = b.bx - b.ax;
    const segZ = b.bz - b.az;
    const segLenSq = segX * segX + segZ * segZ;
    if (segLenSq < 1e-10) continue;
    const t = clamp(((x - b.ax) * segX + (z - b.az) * segZ) / segLenSq, 0, 1);
    const cx = b.ax + segX * t;
    const cz = b.az + segZ * t;
    const offX = x - cx;
    const offZ = z - cz;
    const dist = Math.hypot(offX, offZ);
    const minDist = radius + (b.halfThick ?? 0.034);
    if (dist >= minDist - contactTolerance) continue;
    if (dist > 1e-6) {
      x = cx + (offX / dist) * minDist;
      z = cz + (offZ / dist) * minDist;
    } else {
      const segLen = Math.sqrt(segLenSq);
      let nx = -segZ / segLen;
      let nz = segX / segLen;
      if ((prevX - cx) * nx + (prevZ - cz) * nz < 0) {
        nx = -nx;
        nz = -nz;
      }
      x = cx + nx * minDist;
      z = cz + nz * minDist;
    }
  }
  return [x, z];
}

export function projectVelocityAfterMove(vx, vz, dx, dz, dt) {
  if (dt <= 0) return [vx, vz];
  const rx = vx * dt - dx;
  const rz = vz * dt - dz;
  const rLen = Math.hypot(rx, rz);
  if (rLen <= 1e-6) return [vx, vz];
  if (Math.abs(rz) <= 1e-6) return [0, vz];
  if (Math.abs(rx) <= 1e-6) return [vx, 0];
  const nx = rx / rLen;
  const nz = rz / rLen;
  const into = vx * nx + vz * nz;
  if (into > 0) {
    return [vx - into * nx, vz - into * nz];
  }
  return [vx, vz];
}

export function movePlayer(p, dx, dz, obstacles, footY = 0, bounds = null, playerHeight = PLAYER_STAND_HEIGHT) {
  const area = bounds || { minX: -hall.halfWidth, maxX: hall.halfWidth, minZ: hall.far, maxZ: hall.near };
  const headY = footY + playerHeight;
  const hasComplex = obstacles.some(b => b.active !== false && (b.kind === 'segment' || b.rounded));
  if (!hasComplex) {
    [p.x, p.z] = resolveAabbs(p.x, p.z, p.x + dx, p.z + dz, obstacles, footY, area, headY);
    return;
  }
  const dist = Math.hypot(dx, dz);
  const steps = dist > 0.08 ? Math.min(32, Math.ceil(dist / 0.08)) : 1;
  const stepDx = dx / steps;
  const stepDz = dz / steps;
  let curX = p.x;
  let curZ = p.z;
  for (let i = 0; i < steps; i++) {
    const startX = curX;
    const startZ = curZ;
    [curX, curZ] = resolveAabbs(startX, startZ, startX + stepDx, startZ + stepDz, obstacles, footY, area, headY);
    for (let iter = 0; iter < 3; iter++) {
      [curX, curZ] = resolveRoundedAabbs(curX, curZ, startX, startZ, obstacles, footY, headY);
      [curX, curZ] = resolveSegments(curX, curZ, startX, startZ, obstacles, footY, headY);
      [curX, curZ] = resolveAabbs(startX, startZ, curX, curZ, obstacles, footY, area, headY);
    }
  }
  p.x = curX;
  p.z = curZ;
}

export function firstPerson(camera, obstacles, wake, { onBegin, onPause, onInteract, onStickDirection, isInspecting = () => false, debris = null, audio: customAudio = null } = {}) {
  const game = document.querySelector('#game'), canvas = document.querySelector('#view');
  const enter = document.querySelector('#enter'), label = document.querySelector('#enter-label');
  const message = document.querySelector('#message'), stick = document.querySelector('#stick');
  const crouchBtn = document.querySelector('#crouch-btn'), jumpBtn = document.querySelector('#jump-btn');
  const cameraBtn = document.querySelector('#camera-btn');
  const sprintBar = document.querySelector('#sprint'), sprintFill = document.querySelector('#sprint-fill');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = matchMedia('(pointer: coarse)');
  game.classList.toggle('touch', coarse.matches);
  const position = { x: 0, y: eyeHeight, z: 0 };
  let yaw = 0, pitch = 0, vx = 0, vy = 0, vz = 0;
  let active = false, locked = false, dragMode = false, noclip = false;
  let captured = false, noiseRadius = 0;
  let stompAge = 1, stompStrength = 0, stompSide = 1;
  let touchCrouch = false, isCrouching = false, prevCrouching = false;
  let lookId = null, lastX = 0, lastY = 0, messageTimer;
  let lookDeltaX = 0, lookYawDelta = 0, lookPitchDelta = 0, manualBlink = false, jumpQueued = false;
  let slamTimer = 0, slamSide = 1, slamStrength = 0, doorStepVx = 0, doorStepVz = 0, wishVx = 0, wishVz = 0;
  let lastEyeY = eyeHeight, prevMoveSpeed = 0, prevVx = 0, prevVz = 0, stepClimbCooldown = 0, scuffCooldown = 0;
  let currentSurface = { surface: 'tile', debris: null };
  let fear = 0, fearArmed = true, fearGaspCooldown = 0;

  const stamina = createStaminaState();
  const jump = createJumpState();
  const blink = createBlinkState();
  const motion = createCameraMotionState();
  const thirdPersonState = createThirdPersonState();
  let lastCam = { x: 0, y: eyeHeight, z: 0, blend: 0, distance: 0, fovOffset: 0, headOpacity: 0, showHead: false };
  const audio = customAudio || makePlayerAudio();
  const touchStick = bindTouchStick(stick, {
    isActive: () => active && !captured,
    onPress: () => audio.unlock(),
    onDirection: onStickDirection
  });

  const keys = new Set();
  const movement = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  const sprintKeys = new Set(['ShiftLeft', 'ShiftRight']);
  camera.rotation.order = 'YXZ';

  function syncCrouch() {
    isCrouching = active && !captured && !noclip && (touchCrouch || keys.has('KeyC'));
    if (isCrouching) {
      stamina.isSprinting = false;
      // Door interactions can read velocity between input and the next frame.
      const speed = Math.hypot(vx, vz);
      if (speed > CROUCH_SPEED) {
        vx *= CROUCH_SPEED / speed;
        vz *= CROUCH_SPEED / speed;
      }
    }
    if (crouchBtn) {
      crouchBtn.disabled = !active || noclip || captured;
      crouchBtn.setAttribute('aria-pressed', String(isCrouching));
    }
    jumpBtn.disabled = !active || noclip || captured;
    syncCameraBtn();
  }

  function syncCameraBtn() {
    if (cameraBtn) {
      cameraBtn.disabled = noclip || captured;
      cameraBtn.setAttribute('aria-pressed', String(thirdPersonState.enabled));
      const labelText = thirdPersonState.enabled ? 'Volver a primera persona' : 'Cambiar a tercera persona';
      cameraBtn.setAttribute('aria-label', labelText);
      cameraBtn.title = labelText + ' (V)';
    }
    game.classList.toggle('third-person', thirdPersonState.enabled && !noclip);
  }

  function clearInputs() {
    keys.clear();
    touchStick.reset();
    touchCrouch = false;
    syncCrouch();
  }

  function resetEffects(keepJump = false) {
    noiseRadius = stompStrength = 0;
    stamina.isSprinting = false;
    motion.crouchAmount = 0;
    motion.baseOffsetY = 0;
    motion.offsetX = 0;
    motion.offsetY = keepJump ? jump.height : 0;
    motion.pitchOffset = 0;
    motion.rollOffset = 0;
    motion.yawOffset = 0;
    motion.strafeRoll = 0;
    motion.lookRoll = 0;
    motion.fov = BASE_FOV;
    motion.stepEvent = 0;
    motion.sprintCloud = 0;
    motion.headBlurX = 0;
    motion.headBlurY = 0;
    motion.fear = 0;
    motion.fearPhase = 0;
    motion.fearBlur = 0;
    fear = 0;
    fearArmed = true;
    fearGaspCooldown = 0;
    if (!keepJump) {
      jump.height = 0;
      jump.velY = 0;
      jump.grounded = true;
      jump.justJumped = false;
      jump.justLanded = false;
      jump.landedHeavy = false;
      jump.landTimer = 1;
      jump.landDuration = 0;
      jump.stumbleCooldown = 0;
    }
    jumpQueued = false;
    blink.elapsed = -1;
    blink.amount = 0;
    lookDeltaX = 0;
    lookYawDelta = 0;
    lookPitchDelta = 0;
    manualBlink = false;
    slamTimer = 0;
    slamStrength = 0;
    doorStepVx = 0;
    doorStepVz = 0;
    wishVx = 0;
    wishVz = 0;
    prevMoveSpeed = 0;
    prevVx = 0;
    prevVz = 0;
    stepClimbCooldown = 0;
    scuffCooldown = 0;
    prevCrouching = isCrouching;
    currentSurface = detectFloorSurface(position.x, position.z, jump.height, obstacles, debris);
    camera.userData.postFx = { sprintCloud: 0, headBlurX: 0, headBlurY: 0 };
    game.style.setProperty('--blink', '0');
    game.style.setProperty('--breath-vignette', '0');
    if (sprintBar) sprintBar.classList.remove('visible', 'exhausted');
    audio.silence();
  }

  function updateHud() {
    stick.classList.toggle('running', touchStick.wantsSprint && stamina.isSprinting);
    if (sprintBar && sprintFill) {
      const showBar = active && !noclip && (stamina.hudVisibleTimer > 0 || stamina.isSprinting || stamina.exhausted);
      sprintBar.classList.toggle('visible', showBar);
      sprintBar.classList.toggle('exhausted', active && !noclip && stamina.exhausted);
      sprintFill.style.transform = 'scaleX(' + stamina.stamina.toFixed(4) + ')';
    }
    const showFx = active && !noclip;
    const blinkVal = showFx ? blink.amount * (1 - lastCam.blend) : 0;
    game.style.setProperty('--blink', blinkVal.toFixed(4));
    let vignette = 0;
    if (showFx) {
      const breathPulse = 0.5 + 0.5 * Math.sin(motion.breathPhase);
      if (stamina.exhausted) {
        vignette = 0.34 + 0.36 * breathPulse;
      } else if (stamina.exertion > 0.45) {
        vignette = ((stamina.exertion - 0.45) / 0.55) * 0.28 * (0.45 + 0.55 * breathPulse);
      }
      // Panic vignette pulsing with the player's terrified breathing.
      const fearPanic = motion.fear * (0.28 + 0.34 * breathPulse);
      vignette = Math.min(0.88, Math.max(vignette, fearPanic));
      if (reducedMotion.matches) vignette *= 0.5;
    }
    game.style.setProperty('--breath-vignette', vignette.toFixed(4));
  }

  function applyPose(dt = 0, snap = false) {
    let slamPitch = 0;
    let slamRoll = 0;
    if (slamTimer > 0 && !reducedMotion.matches) {
      const elapsed = 0.28 - slamTimer;
      const kick = Math.sin(Math.min(1, elapsed / 0.14) * Math.PI) * Math.exp(-elapsed * 8.5) * slamStrength;
      slamPitch = kick * 0.045;
      slamRoll = -slamSide * kick * 0.075;
    }
    const ceilLimit = ceilingHeight(position.x, position.z, jump.height, obstacles) - cameraCeilingMargin;
    const camY = noclip
      ? position.y + motion.offsetY
      : clamp(position.y + motion.offsetY, 0.35, Math.max(0.35, ceilLimit));
    lastEyeY = camY;
    const fpPos = {
      x: position.x + Math.cos(yaw) * motion.offsetX,
      y: camY,
      z: position.z - Math.sin(yaw) * motion.offsetX
    };
    lastCam = stepThirdPersonCamera(thirdPersonState, {
      dt,
      snap,
      reducedMotion: reducedMotion.matches,
      allowed: !noclip && !isInspecting(),
      position,
      eyeY: camY,
      fpPos,
      yaw,
      pitch,
      crouchAmount: motion.crouchAmount,
      baseOffsetY: motion.baseOffsetY,
      jumpHeight: jump.height,
      obstacles,
      bounds: worldBounds
    });
    const rotDamp = 1 - 0.78 * lastCam.blend;
    const slamDamp = 1 - 0.35 * lastCam.blend;
    const stomping = !reducedMotion.matches && !captured && !noclip && active && stompStrength > 0.001;
    let stompPitch = 0;
    let stompYaw = 0;
    let stompRoll = 0;
    let stompFov = 0;
    camera.position.set(lastCam.x, lastCam.y, lastCam.z);
    if (stomping) {
      // Two-part seismic shockwave: the floor compresses under the impact, then
      // resonates with a brief decaying tremor so footsteps feel weighty without jolting aim.
      const impactDip = -stompStrength * 0.044 * Math.exp(-stompAge * 11) * Math.sin(Math.min(1, stompAge / 0.085) * Math.PI);
      const tremor = stompStrength * Math.exp(-stompAge * 8.5) * (Math.sin(stompAge * 34) + 0.32 * Math.cos(stompAge * 54));
      camera.position.x += Math.cos(yaw) * tremor * stompSide * 0.011;
      camera.position.y += impactDip + tremor * 0.018;
      camera.position.z -= Math.sin(yaw) * tremor * stompSide * 0.011;
      stompPitch = impactDip * 0.20 + tremor * 0.011;
      stompYaw = tremor * stompSide * 0.004 * rotDamp;
      stompRoll = (tremor * 0.014 - impactDip * 0.16) * stompSide;
      stompFov = Math.abs(tremor) * 1.05;
    }
    camera.rotation.set(
      clamp(pitch + motion.pitchOffset * rotDamp + slamPitch * slamDamp + stompPitch, -1.48, 1.48),
      yaw + motion.yawOffset * rotDamp + stompYaw,
      motion.rollOffset * rotDamp + slamRoll * slamDamp + stompRoll,
      'YXZ'
    );
    const targetFov = motion.fov + (lastCam.fovOffset || 0) + stompFov;
    if (Math.abs(camera.fov - targetFov) > 0.01) {
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
    }
  }
  function setThirdPerson(enabled) {
    if (captured) return;
    const next = Boolean(enabled);
    if (thirdPersonState.enabled === next) return;
    thirdPersonState.enabled = next;
    const snap = isInspecting() || reducedMotion.matches;
    if ((next && thirdPersonState.blend <= 0.01) || snap) {
      thirdPersonState.bodyYaw = yaw;
    }
    syncCameraBtn();
    applyPose(0, snap);
    updateHud();
    wake();
  }
  function toggleThirdPerson() {
    setThirdPerson(!thirdPersonState.enabled);
  }
  function stepTransition(dt) {
    if (active || noclip || captured || isInspecting()) return;
    stepBodyFacing(thirdPersonState, {
      dt,
      reducedMotion: reducedMotion.matches,
      thirdPerson: thirdPersonState.enabled,
      yaw,
      wishVx: 0,
      wishVz: 0
    });
    applyPose(dt, false);
    updateHud();
  }
  function refreshView() {
    applyPose(0, true);
    updateHud();
    wake();
  }
  function setView(x, z, heading, tilt) {
    position.x = x; position.y = eyeHeight; position.z = z; yaw = heading; pitch = tilt;
    thirdPersonState.bodyYaw = heading;
    vx = 0; vy = 0; vz = 0; clearInputs();
    resetEffects();
    applyPose(0, true); wake();
  }
  function setCaptured(value) {
    const wasCaptured = captured;
    captured = value;
    vx = vy = vz = wishVx = wishVz = 0;
    clearInputs(); lookId = null; jumpQueued = false;
    stompStrength = noiseRadius = 0;
    game.classList.toggle('captured', value);
    if (value) {
      game.style.setProperty('--blink', '0');
      game.style.setProperty('--breath-vignette', '0');
      camera.userData.postFx = { sprintCloud: 0, headBlurX: 0, headBlurY: 0 };
      if (!wasCaptured) {
        // The grab lands as pure terror: the continuous breath cuts out and a
        // terrified scream tears out of the player's chest.
        fear = 1;
        motion.fear = 1;
        audio.silence();
        audio.triggerCaptureScream?.();
      } else {
        audio.silence();
      }
    }
  }
  function restartAt(x, z) {
    setCaptured(false);
    Object.assign(stamina, createStaminaState());
    Object.assign(jump, createJumpState());
    Object.assign(blink, createBlinkState());
    Object.assign(motion, createCameraMotionState());
    setView(x, z, 0, 0);
  }
  function monsterStep(strength, side) {
    if (!active || noclip || captured || reducedMotion.matches) return;
    stompAge = 0; stompStrength = clamp(strength, 0, 1.25); stompSide = side >= 0 ? 1 : -1;
  }
  function setFear(amount) {
    fear = clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
  }
  function setNoclip(enabled) {
    if (captured || noclip === Boolean(enabled)) return;
    noclip = Boolean(enabled);
    thirdPersonState.bodyYaw = yaw;
    touchCrouch = false;
    if (!noclip) keys.delete('KeyC');
    syncCrouch();
    vx = 0; vy = 0; vz = 0;
    if (!noclip) {
      position.x = clamp(position.x, worldBounds.minX + radius, worldBounds.maxX - radius);
      position.z = clamp(position.z, worldBounds.minZ + radius, worldBounds.maxZ - radius);
      // The flight camera can be at crouched eye height above a raised surface.
      jump.height = supportHeight(position.x, position.z, position.y, obstacles);
      jump.grounded = true;
      position.y = eyeHeight;
      motion.offsetY = jump.height;
    } else {
      position.y += motion.offsetY;
      resetEffects();
    }
    applyPose(0, true); wake();
  }

  function queueJump() {
    if (!active || noclip || captured) return;
    jumpQueued = true;
    audio.unlock();
  }
  function fallback() {
    if (!active || locked || game.classList.contains('touch')) return;
    dragMode = true;
    game.classList.add('drag-look');
    message.textContent = 'Mantén presionado el botón del mouse y arrastra para mirar.';
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => { message.textContent = ''; }, 3500);
  }
  function begin(event) {
    if (active || enter.disabled) return;
    if (event?.pointerType === 'touch') game.classList.add('touch');
    active = true;
    const wasInspecting = isInspecting();
    onBegin?.();
    syncCrouch();
    applyPose(0, wasInspecting);
    game.classList.add('playing');
    enter.disabled = true;
    audio.unlock();
    canvas.focus({ preventScroll: true });
    wake();
    if (game.classList.contains('touch')) return;
    try {
      if (!canvas.requestPointerLock) { fallback(); return; }
      const request = canvas.requestPointerLock();
      if (request) request.catch(fallback);
    } catch { fallback(); }
  }
  function pause() {
    if (!active) return;
    active = false; dragMode = false; vx = 0; vy = 0; vz = 0;
    onPause?.();
    clearInputs(); lookId = null;
    resetEffects(!noclip);
    game.classList.remove('playing', 'drag-look');
    message.textContent = '';
    clearTimeout(messageTimer);
    label.textContent = 'Continuar recorrido';
    enter.disabled = false;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    enter.focus();
    applyPose(0, false);
    wake();
  }
  function look(dx, dy, speed) {
    if (captured) return;
    const oldPitch = pitch;
    const dYaw = -dx * speed;
    yaw = (yaw + dYaw) % (Math.PI * 2);
    pitch = clamp(pitch - dy * speed, -1.43, 1.43);
    lookDeltaX += dx;
    lookYawDelta += dYaw;
    lookPitchDelta += pitch - oldPitch;
  }
  enter.addEventListener('click', begin);
  document.querySelector('#pause').addEventListener('click', pause);
  jumpBtn.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    queueJump();
  });
  // Keyboard and assistive activation have no preceding pointer press.
  jumpBtn.addEventListener('click', e => { if (e.detail === 0) queueJump(); });
  crouchBtn?.addEventListener('click', e => {
    if (!active || noclip || captured) return;
    touchCrouch = !touchCrouch;
    syncCrouch();
    if (e.detail > 0) canvas.focus({ preventScroll: true });
    audio.unlock();
  });
  cameraBtn?.addEventListener('click', e => {
    if (noclip) return;
    toggleThirdPerson();
    if (active && e.detail > 0) canvas.focus({ preventScroll: true });
  });
  document.querySelector('#interact-btn')?.addEventListener('click', () => {
    if (active && !captured) {
      audio.unlock();
      onInteract?.();
    }
  });
  document.addEventListener('pointerlockerror', fallback);
  document.addEventListener('pointerlockchange', () => {
    const ownsLock = document.pointerLockElement === canvas;
    if (ownsLock && !active) { document.exitPointerLock(); return; }
    if (!ownsLock && locked) pause();
    locked = ownsLock;
    if (locked) {
      dragMode = false;
      game.classList.remove('drag-look');
      message.textContent = '';
    }
  });
  document.addEventListener('mousemove', e => {
    if (active && locked) look(e.movementX, e.movementY, .00205);
  });
  window.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.target.closest?.('dialog[open]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!active && (e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) {
      if (e.target.closest?.('button, input, select, textarea, summary, a[href], [contenteditable]')) return;
      e.preventDefault();
      enter.click();
      return;
    }
    if (active && e.code === 'Escape') { e.preventDefault(); pause(); return; }
    if (captured) return;
    if (active && e.code === 'KeyE' && !e.repeat) { e.preventDefault(); audio.unlock(); onInteract?.(); return; }
    if (active && !noclip && e.code === 'KeyV' && !e.repeat) { e.preventDefault(); toggleThirdPerson(); return; }
    if (active && e.code === 'KeyB' && !e.repeat) { manualBlink = true; return; }
    if (active && !noclip && e.code === 'Space') {
      if (e.target.closest?.('button')) return;
      e.preventDefault();
      if (!e.repeat) queueJump();
      return;
    }
    if (active && (movement.has(e.code) || sprintKeys.has(e.code) || e.code === 'KeyC' || (noclip && e.code === 'Space'))) {
      e.preventDefault();
      if (e.code === 'KeyC' && e.repeat) return;
      keys.add(e.code);
      if (e.code === 'KeyC') syncCrouch();
      audio.unlock();
    }
  });
  window.addEventListener('keyup', e => {
    if (keys.delete(e.code) && e.code === 'KeyC') syncCrouch();
  });
  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if (!active) begin(e);
    else {
      audio.unlock();
      if (locked && !captured) onInteract?.();
    }
    if (lookId !== null || (!dragMode && e.pointerType !== 'touch')) return;
    lookId = e.pointerId; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(lookId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!active || locked || e.pointerId !== lookId) return;
    look(e.clientX - lastX, e.clientY - lastY, e.pointerType === 'touch' ? .0044 : .0037);
    lastX = e.clientX; lastY = e.clientY;
  });
  function finishPointer(e) {
    if (e.pointerId === lookId) lookId = null;
  }
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(event, finishPointer);
  }

  function update(dt) {
    if (!active || captured) return;
    stompAge += dt;
    doorStepVx = 0;
    doorStepVz = 0;
    if (slamTimer > 0) slamTimer = Math.max(0, slamTimer - dt);

    const keyTurn = (Number(keys.has('ArrowLeft')) - Number(keys.has('ArrowRight'))) * 1.6 * dt;
    yaw += keyTurn;
    const forward = Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')) - touchStick.y;
    const side = Number(keys.has('KeyD')) - Number(keys.has('KeyA')) + touchStick.x;
    const inputMag = Math.hypot(forward, side);
    const wantsSprint = touchStick.wantsSprint || keys.has('ShiftLeft') || keys.has('ShiftRight');

    if (noclip) {
      const damping = 1 - Math.exp(-16 * dt);
      const lift = Number(keys.has('Space')) - Number(keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('KeyC'));
      const dir = flyDirection(yaw, pitch, forward, side, lift);
      const flySpeed = 4.2 / Math.max(1, Math.hypot(dir.x, dir.y, dir.z));
      vx += (dir.x * flySpeed - vx) * damping;
      vy += (dir.y * flySpeed - vy) * damping;
      vz += (dir.z * flySpeed - vz) * damping;
      position.x += vx * dt;
      position.y += vy * dt;
      position.z += vz * dt;
      resetEffects();
      applyPose();
      updateHud();
      return;
    }

    stepStamina(stamina, {
      sprinting: wantsSprint && jump.stumbleCooldown <= 0.6,
      crouching: isCrouching,
      moving: inputMag > 0.05,
      dt
    });

    // A sudden terror spike (spotting the monster up close) tears out a gasp,
    // then holds fire for a few seconds so the sound does not machine-gun.
    if (fearGaspCooldown > 0) fearGaspCooldown = Math.max(0, fearGaspCooldown - dt);
    if (fear < 0.3) fearArmed = true;
    let justTerrified = false;
    if (fear > 0.55 && fearArmed && fearGaspCooldown <= 0) {
      justTerrified = true;
      fearArmed = false;
      fearGaspCooldown = 4.5;
    }

    const speed = (stamina.speedLimit * stumbleSpeedFactor(jump)) / Math.max(1, inputMag);
    const targetX = (Math.cos(yaw) * side - Math.sin(yaw) * forward) * speed;
    const targetZ = (-Math.sin(yaw) * side - Math.cos(yaw) * forward) * speed;
    wishVx = inputMag > 0.05 ? targetX : 0;
    wishVz = inputMag > 0.05 ? targetZ : 0;
    const accelRate = inputMag > 0.05 ? (stamina.isSprinting ? 12.5 : 14) : 16.5;
    const damping = 1 - Math.exp(-accelRate * dt);
    vx += (targetX - vx) * damping; vy = 0; vz += (targetZ - vz) * damping;

    const stanceBlend = reducedMotion.matches ? 1 : 1 - Math.exp(-12 * Math.max(0, dt));
    const nextCrouch = motion.crouchAmount + (Number(isCrouching) - motion.crouchAmount) * stanceBlend;
    const playerHeight = playerHeadHeight(Math.min(motion.crouchAmount, nextCrouch));
    const oldX = position.x, oldZ = position.z;
    movePlayer(position, vx * dt, vz * dt, obstacles, jump.height, worldBounds, playerHeight);
    const dx = position.x - oldX, dz = position.z - oldZ;
    // Discard only the velocity component into a barrier so angled door leaves
    // and rounded doorway jambs slide smoothly while keeping axis-aligned suit behavior.
    [vx, vz] = projectVelocityAfterMove(vx, vz, dx, dz, dt);

    const floorHeight = supportHeight(position.x, position.z, jump.height, obstacles);
    const ceilHeight = ceilingHeight(position.x, position.z, jump.height, obstacles);
    const prevFootY = jump.height;
    const prevGrounded = jump.grounded;
    stepJump(jump, stamina, {
      wantJump: jumpQueued && jump.stumbleCooldown <= 1.2,
      dt,
      sideInput: clamp(side, -1, 1),
      floorHeight,
      ceilingHeight: ceilHeight,
      playerHeight
    });
    jumpQueued = false;

    if (stepClimbCooldown > 0) stepClimbCooldown = Math.max(0, stepClimbCooldown - dt);
    if (scuffCooldown > 0) scuffCooldown = Math.max(0, scuffCooldown - dt);

    const distance = Math.hypot(dx, dz);
    const moveSpeed = dt > 0.0001 ? distance / dt : 0;
    currentSurface = detectFloorSurface(position.x, position.z, jump.height, obstacles, debris);

    stepCameraMotion(motion, {
      dt,
      moveSpeed,
      isSprinting: stamina.isSprinting,
      isCrouching,
      sideInput: clamp(side, -1, 1),
      lookDeltaX: lookDeltaX - keyTurn * 240,
      lookYawDelta: lookYawDelta + keyTurn,
      lookPitchDelta,
      exertion: stamina.exertion,
      exhausted: stamina.exhausted,
      jump,
      reducedMotion: reducedMotion.matches,
      fear
    });
    lookDeltaX = 0;
    lookYawDelta = 0;
    lookPitchDelta = 0;
    camera.userData.postFx = {
      sprintCloud: motion.sprintCloud,
      headBlurX: motion.headBlurX,
      headBlurY: motion.headBlurY
    };

    stepBlink(blink, dt, {
      exhausted: stamina.exhausted,
      justExhausted: stamina.justExhausted,
      exertion: stamina.exertion,
      fear,
      reducedMotion: reducedMotion.matches,
      manualTrigger: manualBlink
    });
    manualBlink = false;

    let effectiveStepEvent = motion.stepEvent;
    if (
      effectiveStepEvent === 0 &&
      prevGrounded &&
      jump.grounded &&
      Math.abs(jump.height - prevFootY) >= 0.10 &&
      stepClimbCooldown <= 0
    ) {
      effectiveStepEvent = stamina.isSprinting ? 0.95 : 0.72;
      stepClimbCooldown = 0.14;
    }

    let scuffEvent = 0;
    if (jump.grounded && !isCrouching && scuffCooldown <= 0 && prevMoveSpeed > 3.05) {
      const hardBrake = inputMag < 0.12 && moveSpeed > 2.2;
      const sharpReverse = inputMag > 0.4 && (prevVx * wishVx + prevVz * wishVz) < -4.0;
      if (hardBrake || sharpReverse) {
        scuffEvent = clamp(prevMoveSpeed / 4.35, 0.45, 1.0);
        scuffCooldown = 0.36;
      }
    }

    const crouchChanged = isCrouching !== prevCrouching;
    prevCrouching = isCrouching;
    prevMoveSpeed = moveSpeed;
    prevVx = vx;
    prevVz = vz;

    const soundEvents = {
      breathPhase: motion.breathPhase,
      exertion: stamina.exertion,
      exhausted: stamina.exhausted,
      justExhausted: stamina.justExhausted,
      stepEvent: effectiveStepEvent,
      isSprinting: stamina.isSprinting,
      isCrouching,
      justJumped: jump.justJumped,
      justLanded: jump.justLanded,
      landedHeavy: jump.landedHeavy,
      scuffEvent,
      crouchChanged,
      surface: currentSurface.surface,
      debris: currentSurface.debris,
      fear,
      justTerrified,
      active
    };
    noiseRadius = playerNoiseRadius(soundEvents);
    audio.update(soundEvents);

    stepBodyFacing(thirdPersonState, {
      dt,
      reducedMotion: reducedMotion.matches,
      thirdPerson: thirdPersonState.enabled && !noclip && !isInspecting(),
      yaw,
      wishVx,
      wishVz
    });

    applyPose(dt, false);
    updateHud();
  }

  function triggerSlamImpact(side = 1, strength = 1) {
    slamSide = side >= 0 ? 1 : -1;
    slamStrength = clamp(strength, 0.2, 1.4);
    slamTimer = 0.28;
    vx *= 0.85;
    vz *= 0.85;
    applyPose();
  }

  function applyDoorFollow(dt, doorInteraction) {
    if (!active || noclip || captured || dt <= 0.0001) return;
    if (doorInteraction && thirdPersonState.enabled && !isInspecting()) {
      stepBodyFacing(thirdPersonState, {
        dt,
        reducedMotion: reducedMotion.matches,
        thirdPerson: true,
        yaw,
        wishVx,
        wishVz,
        doorInteraction,
        playerX: position.x,
        playerZ: position.z
      });
    }
    if (reducedMotion.matches) return;
    if (!doorInteraction || doorInteraction.kind !== 'grab' || doorInteraction.releasing || !doorInteraction.autoPush || !doorInteraction.handlePos) return;
    if (doorInteraction.intensity <= 0.2 || Math.hypot(vx, vz) >= 0.35 || Math.hypot(wishVx, wishVz) >= 0.25) return;

    const hp = doorInteraction.handlePos;
    const toX = hp.x - position.x;
    const toZ = hp.z - position.z;
    const dist = Math.hypot(toX, toZ);
    const desiredDist = 0.42;
    if (dist >= 1.45 || dist < 0.05) return;
    const delta = dist - desiredDist;
    if (Math.abs(delta) <= 0.03) return;

    const maxStep = dt * (isCrouching ? CROUCH_SPEED : 1.50) * doorInteraction.intensity;
    const pull = delta > 0
      ? Math.min(delta, maxStep)
      : -Math.min(-delta, maxStep * 0.85);
    const stepX = (toX / dist) * pull;
    const stepZ = (toZ / dist) * pull;
    const oldX = position.x;
    const oldZ = position.z;
    movePlayer(position, stepX, stepZ, obstacles, jump.height, worldBounds, playerHeadHeight(motion.crouchAmount));
    const movedX = position.x - oldX;
    const movedZ = position.z - oldZ;
    const moved = Math.hypot(movedX, movedZ);
    if (moved > 1e-5) {
      doorStepVx = movedX / dt;
      doorStepVz = movedZ / dt;
      motion.bobPhase += (moved / dt) * 2.85 * dt;
      const stepIndex = Math.floor(motion.bobPhase / Math.PI);
      if (jump.grounded && stepIndex !== motion.prevStepIndex) {
        motion.prevStepIndex = stepIndex;
        noiseRadius = Math.max(noiseRadius, playerNoiseRadius({ isCrouching, stepEvent: 1 }));
        currentSurface = detectFloorSurface(position.x, position.z, jump.height, obstacles, debris);
        audio.triggerStep?.(isCrouching ? 0.42 : 0.55, false, {
          isCrouching,
          surface: currentSurface.surface,
          debris: currentSurface.debris
        });
      }
      applyPose();
    }
  }

  enter.disabled = false;
  syncCrouch();
  return {
    audio,
    get active() { return active; },
    get noclip() { return noclip; },
    get thirdPerson() { return thirdPersonState.enabled; },
    get animating() {
      return !captured && isThirdPersonTransitioning(thirdPersonState, {
        allowed: !noclip && !isInspecting(),
        reducedMotion: reducedMotion.matches,
        yaw
      });
    },
    get pose() {
      return {
        x: position.x,
        y: position.y,
        cameraY: lastEyeY,
        z: position.z,
        yaw,
        bodyYaw: thirdPersonState.bodyYaw,
        pitch,
        vx: vx + doorStepVx,
        vz: vz + doorStepVz,
        wishVx,
        wishVz,
        bobPhase: motion.bobPhase,
        breathPhase: motion.breathPhase,
        offsetX: motion.offsetX,
        offsetY: motion.offsetY,
        strafeRoll: motion.strafeRoll,
        exertion: stamina.exertion,
        isSprinting: stamina.isSprinting,
        isCrouching,
        noiseRadius,
        crouchAmount: motion.crouchAmount,
        exhausted: stamina.exhausted,
        fear: motion.fear,
        jump,
        surface: currentSurface.surface,
        debris: currentSurface.debris,
        active,
        noclip,
        thirdPerson: thirdPersonState.enabled && !noclip,
        thirdPersonBlend: lastCam.blend,
        cameraDistance: lastCam.distance,
        headOpacity: lastCam.headOpacity,
        showPlayerHead: lastCam.showHead
      };
    },
    setNoclip,
    setThirdPerson,
    toggleThirdPerson,
    stepTransition,
    refreshView,
    update,
    triggerSlamImpact,
    monsterStep,
    setFear,
    setCaptured,
    restartAt,
    applyDoorFollow,
    pause,
    setView
  };
}
