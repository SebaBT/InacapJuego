import { poseDoorLeaf } from './doors.js';
import { monsterSpawn, playerSpawn, plaza } from './layout.js';
import { ITEM_CATALOG, WORLD_ITEM_PLACEMENTS } from './items.js';
import { capturePose } from './monster-hunt.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);
const smooth = t => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

function shortestAngleDiff(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function lerpYaw(a, b, t) {
  return a + shortestAngleDiff(a, b) * clamp(t, 0, 1);
}

export function setGateOpenVisual(door, openAmount) {
  if (!door) return;
  const open = door.locked ? 0 : clamp(openAmount, 0, 1);
  door.open = door.targetOpen = open;
  for (const pivot of door.pivots || []) {
    poseDoorLeaf(pivot, (door.swingSign ?? 1) * smooth(open) * (pivot.maxAngle ?? 1.58));
  }
  if (door.obstacle) door.obstacle.active = open < .72;
}

function lookYaw(fromX, fromZ, toX, toZ) {
  return Math.atan2(-(toX - fromX), -(toZ - fromZ));
}

function findClearLoomSpot(pose, navigation) {
  const origin = { x: pose.x, y: pose.cameraY ?? 1.66, z: pose.z };
  const area = navigation?.areaAt?.(origin);
  const dirs = [
    pose.yaw + Math.PI * 0.85,
    pose.yaw,
    pose.yaw + Math.PI * 0.5,
    pose.yaw - Math.PI * 0.5,
    0,
    Math.PI
  ];
  for (const ang of dirs) {
    for (const dist of [3.4, 2.7, 2.1]) {
      const candidate = {
        x: pose.x - Math.sin(ang) * dist,
        z: pose.z - Math.cos(ang) * dist
      };
      if (area && navigation?.areaAt?.(candidate) !== area) continue;
      const clamped = navigation?.clampToSolids?.(origin, candidate, 0.45) ?? candidate;
      const d = Math.hypot(clamped.x - pose.x, clamped.z - pose.z);
      if (d >= 1.65 && navigation?.visible?.({ x: clamped.x, y: 1.58, z: clamped.z }, origin)) {
        return { x: clamped.x, z: clamped.z };
      }
    }
  }
  return { x: monsterSpawn.x, z: monsterSpawn.z };
}

/**
 * Coordinates animated 3D cutscenes (`intro`, `escape`, `timeoutDefeat`)
 * driving the camera, exterior iron gate, Mii runner, and Mothy
 * with smooth visual transitions and zero abrupt cuts to black.
 */
export function createCinematics({
  camera,
  actor,
  gateControl,
  atmosphere,
  gameplayAudio,
  doorAudio,
  walk,
  navigation
}) {
  let active = false;
  let kind = null;
  let elapsed = 0;
  let duration = 0;
  let holding = false;
  let onComplete = null;
  let completed = false;
  let whisper = '', chapter = '', awaitingStart = false;
  let fade = 0;
  let playerPose = null;
  let gateSlammed = false;
  let scareTriggered = false;
  let isCompleteVictory = false;
  let escapeSfxFired = false;
  let escapeStep = 0;
  let timeoutAnchor = null;

  function clearVisuals() {
    chapter = whisper = '';
    awaitingStart = false;
    fade = 0;
    playerPose = null;
  }

  function finish(skipped = false) {
    if (!active || completed) return;
    completed = true;
    const cb = onComplete;
    const finishedKind = kind;
    onComplete = null;
    if (finishedKind === 'intro') {
      active = false;
      kind = null;
      holding = false;
      clearVisuals();
      setGateOpenVisual(gateControl?.door, 0);
      walk.setCutsceneLock?.(false);
      walk.restartAt?.(playerSpawn.x, playerSpawn.z);
      camera.fov = 72;
      camera.updateProjectionMatrix();
      cb?.({ skipped });
      return;
    }
    holding = true;
    cb?.({ outcome: finishedKind });
  }

  function startIntro(cb) {
    active = true;
    kind = 'intro';
    elapsed = 0;
    duration = 25;
    awaitingStart = false;
    holding = false;
    completed = false;
    gateSlammed = false;
    scareTriggered = false;
    onComplete = cb || null;
    chapter = 'Portón exterior';
    whisper = 'Tienes tres minutos para abrir este portón.';
    fade = 0.32;
    playerPose = {
      x: -16.0,
      y: 1.66,
      cameraY: 1.66,
      z: 24.4,
      yaw: 0,
      pitch: 0,
      thirdPersonBlend: 0,
      noclip: true
    };
    walk.setCutsceneLock?.(true);
    setGateOpenVisual(gateControl?.door, 0);
    actor.place(monsterSpawn.x, 0, monsterSpawn.z, 0);
    actor.setAnimation('idle');
    actor.face.reset?.();
    actor.face.setExpression('normal');
  }

  function startEscape({ isComplete = false } = {}, cb) {
    active = true;
    kind = 'escape';
    elapsed = 0;
    duration = 11.8;
    gateSlammed = false;
    holding = false;
    completed = false;
    escapeSfxFired = false;
    escapeStep = 0;
    isCompleteVictory = Boolean(isComplete);
    onComplete = cb || null;
    whisper = '';
    fade = 0;
    walk.setCutsceneLock?.(true);
    doorAudio?.silenceMonster?.();
    if (gateControl?.door) {
      gateControl.door.locked = false;
    }
    setGateOpenVisual(gateControl?.door, 0);
    actor.place(-16.0, 0, 14.5, 0);
    actor.setAnimation('idle');
    actor.face.setExpression('chase');
    gameplayAudio?.playGateOpen?.();
    if (isCompleteVictory) {
      atmosphere?.triggerDawnVictory?.();
    }
  }

  function startTimeoutDefeat(pose, cb) {
    active = true;
    kind = 'timeoutDefeat';
    elapsed = 0;
    duration = 5.6;
    chapter = 'Cierre de seguridad';
    holding = false;
    completed = false;
    scareTriggered = false;
    onComplete = cb || null;
    whisper = '';
    fade = 0;
    walk.setCutsceneLock?.(true);
    doorAudio?.silenceMonster?.();
    atmosphere?.triggerPointOfNoReturn?.();
    gameplayAudio?.playTimeoutLockdown?.();
    const base = {
      x: pose?.x ?? playerSpawn.x,
      cameraY: pose?.cameraY ?? 1.66,
      z: pose?.z ?? playerSpawn.z,
      yaw: pose?.yaw ?? 0,
      pitch: pose?.pitch ?? 0
    };
    const loom = findClearLoomSpot(base, navigation);
    const yawToMonster = lookYaw(base.x, base.z, loom.x, loom.z);
    const monsterFacing = Math.atan2(base.x - loom.x, base.z - loom.z);
    timeoutAnchor = {
      px: base.x,
      py: base.cameraY,
      pz: base.z,
      startYaw: base.yaw,
      startPitch: base.pitch,
      mx: loom.x,
      mz: loom.z,
      yawToMonster,
      monsterFacing
    };
    playerPose = {
      x: base.x,
      y: base.cameraY,
      cameraY: base.cameraY,
      z: base.z,
      yaw: base.yaw,
      pitch: base.pitch,
      thirdPersonBlend: 0,
      noclip: true
    };
    actor.place(loom.x, 0, loom.z, monsterFacing);
    actor.setAnimation('run');
    actor.face.setExpression('scream');
  }

  function skip() {
    if (!active || kind !== 'intro') return false;
    setGateOpenVisual(gateControl?.door, 0);
    finish(!awaitingStart);
    return true;
  }

  function stop() {
    active = false;
    kind = null;
    holding = false;
    completed = false;
    onComplete = null;
    timeoutAnchor = null;
    clearVisuals();
    walk.setCutsceneLock?.(false);
    camera.fov = 72;
    camera.updateProjectionMatrix();
  }

  const briefings = [
    { kind: 'masterKey', eye: [-24.12, 1.58, 15.9] },
    { kind: 'fuse', eye: [12.39, 1.53, -20.55] },
    { kind: 'boltCutters', eye: [-1.05, 1.91, -38.65] }
  ].map(b => ({ ...b, item: WORLD_ITEM_PLACEMENTS.find(p => p.kind === b.kind) }));

  function frameShot(x, y, z, tx, ty, tz, fov) {
    camera.position.set(x, y, z);
    camera.lookAt(tx, ty, tz);
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }
  function dissolve(t, length) {
    return Math.max(0, 1 - t / .36, 1 - (length - t) / .36) * .5;
  }
  function updateIntro(dt, reducedMotion) {
    const t = elapsed;
    if (t < 5.5) {
      frameShot(-16.48, 1.52, 16.9 + (reducedMotion ? 0 : .28 * smooth(t / 5.5)), -16, 1.34, 19.6, 57);
      fade = dissolve(t, 5.5);
    } else if (t < 22) {
      setGateOpenVisual(gateControl?.door, 0);
      const i = Math.floor((t - 5.5) / 5.5);
      const local = t - 5.5 * (i + 1);
      const { kind: k, item, eye } = briefings[i], def = ITEM_CATALOG[k];
      const dolly = reducedMotion ? 0 : smooth(local / 5.5) * .11;
      frameShot(lerp(eye[0], item.x, dolly), eye[1], lerp(eye[2], item.z, dolly),
        item.x, item.y + .13, item.z, 46);
      chapter = def.location;
      whisper = def.label + '. ' + def.purpose;
      fade = dissolve(local, 5.5);
    } else {
      chapter = 'Pasillo principal';
      whisper = 'Cruza la sala 103. La llave está en la caseta 107.';
      frameShot(playerSpawn.x, 1.61, playerSpawn.z, 0, 1.61, monsterSpawn.z, 72);
      fade = Math.max(0, 1 - (t - 22) / .45) * .5;
      if (!scareTriggered) {
        scareTriggered = true;
        actor.face.setExpression('chase');
        doorAudio?.monsterGrowl?.('rasp', .48, 0);
      }
      awaitingStart = t >= duration;
    }
    actor.update(dt, 20);
  }

  function updateEscape(dt, reducedMotion) {
    const t = elapsed, gx = plaza.exteriorGate.x, gz = plaza.exteriorGate.z;
    // Release the bolt, run through, then drop the gate between the two bodies.
    const opening = smooth((t - .65) / 1.35);
    const closing = smooth((t - 4.45) / .68);
    setGateOpenVisual(gateControl?.door, opening * (1 - closing));
    gateControl?.setLatch?.(smooth(t / .65) * (1 - smooth((t - 5.13) / .32)));
    if (!gateSlammed && t >= 5.13) {
      gateSlammed = true;
      doorAudio?.playSlam?.(gateControl?.door);
      doorAudio?.monsterGrowl?.('snarl', .85, 0);
    }
    if (!escapeSfxFired && t >= 6.25) {
      escapeSfxFired = true;
      gameplayAudio?.playVictory?.(isCompleteVictory);
    }
    if (isCompleteVictory && atmosphere?.state) atmosphere.state.dawn = smooth((t - 5.8) / 3.6);
    const run = clamp((t - 1.35) / 5.15, 0, 1);
    const runnerZ = gz - 1.65 + 13.3 * smooth(run);
    const speed = 13.3 * 6 * run * (1 - run) / 5.15;
    const step = Math.floor((runnerZ - gz + 1.65) / .87);
    if (step > escapeStep) {
      escapeStep = step;
      walk.audio?.triggerStep?.(Math.min(.95, .4 + speed * .1), speed > 2.8, { surface: 'concrete' });
    }
    const turn = smooth((t - 6.4) / 1.05);
    const lunge = smooth((t - 4.55) / .52);
    const recoil = smooth((t - 5.13) / .68);
    const monsterZ = gz - 6.4 + 4.9 * smooth((t - 1.9) / 2.9) + .95 * lunge - .48 * recoil;
    actor.place(gx + .24, 0, monsterZ, 0);
    actor.setAnimation(t < 1.9 || t >= 5.85 ? 'idle' : t < 4.55 ? 'run' : 'grab');
    actor.update(dt, 7, null, { stridePhase: t * 11, doorPress: lunge * (1 - .75 * recoil),
      capture: t > 4.55 && t < 5.85 ? capturePose(.52 * lunge * (1 - recoil)) : null });
    playerPose = {
      x: gx, z: runnerZ, y: 1.61, cameraY: 1.61, yaw: Math.PI * (1 - turn),
      bodyYaw: Math.PI * (1 - turn), pitch: 0, vx: 0, vz: speed, wishVx: 0, wishVz: speed,
      bobPhase: (runnerZ - gz + 1.65) * 4.2, breathPhase: t * 3.6, offsetX: 0, offsetY: 0,
      strafeRoll: 0, exertion: 1 - .65 * turn, isSprinting: speed > 2.8, crouchAmount: 0,
      fear: .25, jump: { height: 0, grounded: true }, thirdPerson: true, thirdPersonBlend: 1,
      headOpacity: 1, showPlayerHead: true, active: true, noclip: false,
      evidence: isCompleteVictory ? smooth((t - 7.4) / 1.25) : 0
    };
    if (t < 1.8) {
      chapter = 'Portón exterior';
      whisper = '';
      frameShot(gx - .68, 1.41, gz - 1.30, gx, 1.26, gz, 42);
      fade = dissolve(t, 1.8);
    } else if (t < 6.25) {
      chapter = 'Pasaje de salida';
      whisper = '';
      const jolt = reducedMotion ? 0 : Math.sin((t - 5.13) * 41) * .045 * Math.exp(-Math.max(0, t - 5.13) * 7);
      frameShot(gx + 2.25, 1.65 + (gateSlammed ? jolt : 0), gz + 5.2, gx, 1.15, gz - .85, 60);
      fade = dissolve(t - 1.8, 4.45);
    } else {
      const settle = reducedMotion ? 1 : smooth((t - 6.25) / 3.5);
      chapter = isCompleteVictory ? 'Amanecer' : 'Avenida del campus';
      whisper = isCompleteVictory ? 'Las tres cintas salieron contigo.'
        : 'Por fin puedes dejar de correr.';
      const distance = isCompleteVictory ? 1.85 : 3.1;
      frameShot(gx + lerp(2.65, -.33, settle), lerp(1.48, 1.38, settle),
        runnerZ - lerp(3.8, distance, settle), gx + .11, 1.12, runnerZ, 48);
      fade = Math.max(0, 1 - (t - 6.25) / .38) * .45;
    }
    if (t >= duration) finish();
  }

  function updateTimeoutDefeat(dt, reducedMotion) {
    const a = timeoutAnchor;
    if (!a) return;
    const t = elapsed;
    const turnT = smooth(t / 1.05);
    const loomT = smooth(clamp((t - 0.35) / 2.8, 0, 1));
    const lungeT = clamp((t - 2.3) / 1.7, 0, 1);

    const mx = lerp(a.mx, a.px, loomT * 0.56);
    const mz = lerp(a.mz, a.pz, loomT * 0.56);
    const mDist = Math.hypot(a.px - mx, a.pz - mz);

    const dropY = lerp(a.py, 1.16, smooth(clamp((t - 0.8) / 2.2, 0, 1)));
    const shake = (!reducedMotion && t > 1.2)
      ? Math.sin(t * 28) * 0.022 * loomT
      : 0;
    const camYaw = lerpYaw(a.startYaw, lookYaw(a.px, a.pz, mx, mz), turnT);
    const camPitch = lerp(a.startPitch, 0.22, smooth(clamp((t - 0.5) / 2.2, 0, 1)));

    camera.position.set(a.px + shake, dropY, a.pz);
    camera.rotation.set(camPitch, camYaw, (reducedMotion ? 0 : -0.11 * loomT), 'YXZ');
    camera.fov = lerp(72, 62, loomT);
    camera.updateProjectionMatrix();

    if (!scareTriggered && t >= 1.45) {
      scareTriggered = true;
      doorAudio?.monsterScream?.('capture', 0.96, 0);
    }

    actor.place(mx, navigation?.floorAt?.({ x: mx, z: mz }) ?? 0, mz, a.monsterFacing);
    actor.setAnimation(lungeT > 0.1 ? 'grab' : 'run');
    actor.update(dt, mDist, null, {
      capture: lungeT > 0 ? capturePose(lungeT * 1.15) : null,
      stridePhase: t * 9.0
    });

    whisper = t < 2.2 ? 'El portón quedó sellado.' : 'Te encontró en el apagón.';
    // Deep crimson atmospheric fade without hard cut to solid black
    fade = smooth(clamp((t - 2.1) / 2.0, 0, 1)) * 0.58;

    if (!holding && t >= duration) {
      finish();
    }
  }

  function update(dt, reducedMotion = false) {
    if (!active) return null;
    if (holding) return playerPose;
    elapsed = Math.min(duration, elapsed + Math.max(0, dt));

    if (kind === 'intro') {
      updateIntro(dt, reducedMotion);
    } else if (kind === 'escape') {
      updateEscape(dt, reducedMotion);
    } else if (kind === 'timeoutDefeat') {
      updateTimeoutDefeat(dt, reducedMotion);
    }
    return playerPose;
  }

  return {
    get active() { return active; },
    get kind() { return kind; },
    get holding() { return holding; },
    get whisper() { return whisper; },
    get fade() { return fade; },
    get chapter() { return chapter; },
    get awaitingStart() { return awaitingStart; },
    get canSkip() { return active && kind === 'intro' && !completed; },
    get playerPose() { return playerPose; },
    startIntro,
    startEscape,
    startTimeoutDefeat,
    skip,
    stop,
    update
  };
}
