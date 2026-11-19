import { makeControlledDoorAudio, soundState } from './sound.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export function lookDirection(yaw, pitch) {
  const cosPitch = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cosPitch
  };
}

export function playerOverlapsRect(pos, rect, padding = 0.25) {
  if (!pos || !rect) return false;
  return (
    pos.x > rect.x0 - padding &&
    pos.x < rect.x1 + padding &&
    pos.z > rect.z0 - padding &&
    pos.z < rect.z1 + padding
  );
}

function getThresholdPushApproach(door, pose, vx, vz, wishVx, wishVz, useWish) {
  const rect = door?.threshold;
  if (!rect || !pose) return -Infinity;
  const spanX = rect.x1 - rect.x0;
  const spanZ = rect.z1 - rect.z0;
  const padX = spanZ > spanX ? 0.34 : spanX > spanZ ? 0.02 : 0.34;
  const padZ = spanX > spanZ ? 0.34 : spanZ > spanX ? 0.02 : 0.34;
  if (
    pose.x <= rect.x0 - padX ||
    pose.x >= rect.x1 + padX ||
    pose.z <= rect.z0 - padZ ||
    pose.z >= rect.z1 + padZ
  ) {
    return -Infinity;
  }
  const cx = clamp(pose.x, rect.x0, rect.x1);
  const cz = clamp(pose.z, rect.z0, rect.z1);
  let dx = cx - pose.x;
  let dz = cz - pose.z;
  let dist = Math.hypot(dx, dz);
  if (dist < 0.01 && door.pos) {
    dx = door.pos.x - pose.x;
    dz = door.pos.z - pose.z;
    dist = Math.hypot(dx, dz);
  }
  if (dist < 0.01) return -Infinity;
  const actualApproach = (vx * dx + vz * dz) / dist;
  const wishApproach = (wishVx * dx + wishVz * dz) / dist;
  return useWish ? Math.max(actualApproach, wishApproach) : actualApproach;
}

export function poseDoorLeaf(pivot, angle) {
  if (pivot.group) pivot.group.rotation.y = (pivot.hand ?? 1) * angle;
  pivot.updateCloser?.(angle);
  if (pivot.obstacle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const len = pivot.length ?? 0.98;
    const pad = pivot.obstacle.halfThick ?? 0.034;
    const bx = pivot.hx + len * (pivot.closedDirX * c + pivot.swingDirX * s);
    const bz = pivot.hz + len * (pivot.closedDirZ * c + pivot.swingDirZ * s);
    pivot.obstacle.ax = pivot.hx;
    pivot.obstacle.az = pivot.hz;
    pivot.obstacle.bx = bx;
    pivot.obstacle.bz = bz;
    pivot.obstacle.x0 = Math.min(pivot.hx, bx) - pad;
    pivot.obstacle.x1 = Math.max(pivot.hx, bx) + pad;
    pivot.obstacle.z0 = Math.min(pivot.hz, bz) - pad;
    pivot.obstacle.z1 = Math.max(pivot.hz, bz) + pad;
  }
}

function getDoorSwingSign(door) {
  return (door?.swingSign ?? 1) < 0 ? -1 : 1;
}

function resolveSwingSign(door, actorPos, dirX = 0, dirZ = 0) {
  const current = getDoorSwingSign(door);
  const pivot = door?.pivots?.find(p => typeof p.swingDirX === 'number' && typeof p.swingDirZ === 'number');
  if (!pivot || !door?.pos || !actorPos) return current;
  const sx = pivot.swingDirX;
  const sz = pivot.swingDirZ;
  const dot = ((actorPos.x ?? 0) - door.pos.x) * sx + ((actorPos.z ?? 0) - door.pos.z) * sz;
  if (Math.abs(dot) > 0.02) return dot < 0 ? 1 : -1;
  const moveDot = dirX * sx + dirZ * sz;
  if (Math.abs(moveDot) > 0.05) return moveDot > 0 ? 1 : -1;
  return current;
}

function resolveSwingSignForPose(door, pose) {
  const yaw = pose?.yaw || 0;
  const wishX = pose?.wishVx ?? pose?.vx ?? 0;
  const wishZ = pose?.wishVz ?? pose?.vz ?? 0;
  const hasMove = Math.hypot(wishX, wishZ) > 0.05;
  return resolveSwingSign(
    door,
    pose,
    hasMove ? wishX : -Math.sin(yaw),
    hasMove ? wishZ : -Math.cos(yaw)
  );
}

function getOpenTargetPoints(door) {
  if (!door || (door.open ?? 0) <= 0.5) return [];
  const swingSign = getDoorSwingSign(door);
  const t = clamp(door.open, 0, 1);
  const eased = t * t * (3 - 2 * t);
  const pivotPts = [];
  for (const p of door.pivots || []) {
    if (typeof p.hx === 'number' && typeof p.closedDirX === 'number' && typeof p.swingDirX === 'number') {
      const angle = swingSign * eased * (p.maxAngle ?? 1.74);
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const len = p.length ?? 0.98;
      pivotPts.push({
        x: p.hx + len * 0.55 * (p.closedDirX * c + p.swingDirX * s),
        y: door.pos?.y ?? 1.15,
        z: p.hz + len * 0.55 * (p.closedDirZ * c + p.swingDirZ * s)
      });
    }
  }
  if (pivotPts.length) return pivotPts;
  if (!door.openPos) return [];
  return Array.isArray(door.openPos) ? door.openPos : [door.openPos];
}

function getLeafPushMatch(door, pose, vx, vz, wishVx, wishVz, useWish) {
  if (!door || !pose) return false;
  const openT = clamp(door.open || 0, 0, 1);
  const eased = openT * openT * (3 - 2 * openT);
  const swingSign = getDoorSwingSign(door);
  for (const pivot of door.pivots || []) {
    const obs = pivot.obstacle;
    if (!obs || obs.active === false) continue;
    if (typeof pivot.closedDirX !== 'number' || typeof pivot.swingDirX !== 'number') continue;
    const segX = obs.bx - obs.ax;
    const segZ = obs.bz - obs.az;
    const segLenSq = segX * segX + segZ * segZ;
    if (segLenSq < 1e-8) continue;
    const t = clamp(((pose.x - obs.ax) * segX + (pose.z - obs.az) * segZ) / segLenSq, 0, 1);
    if (t < 0.12) continue;
    const cx = obs.ax + segX * t;
    const cz = obs.az + segZ * t;
    const toX = cx - pose.x;
    const toZ = cz - pose.z;
    const dist = Math.hypot(toX, toZ);
    const contactRange = 0.245 + (obs.halfThick ?? 0.034) + 0.26;
    if (dist > contactRange || dist < 1e-4) continue;
    const nx = toX / dist;
    const nz = toZ / dist;
    const intoActual = vx * nx + vz * nz;
    const intoWish = wishVx * nx + wishVz * nz;
    const intoLeaf = useWish ? Math.max(intoActual, intoWish) : intoActual;
    if (intoLeaf < 1.35) continue;
    const angle = swingSign * eased * (pivot.maxAngle ?? 1.74);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const openDirX = swingSign * (-pivot.closedDirX * s + pivot.swingDirX * c);
    const openDirZ = swingSign * (-pivot.closedDirZ * s + pivot.swingDirZ * c);
    const openActual = vx * openDirX + vz * openDirZ;
    const openWish = wishVx * openDirX + wishVz * openDirZ;
    const openPush = useWish ? Math.max(openActual, openWish) : openActual;
    if (openPush >= 1.0) return true;
  }
  return false;
}

export function makeDoorAudio(sound = soundState, options = {}) {
  return makeControlledDoorAudio(sound, options);
}

function getClosestHandleInfo(door, pose) {
  if (!door) return null;
  for (const pivot of door.pivots || []) {
    pivot.group?.updateMatrixWorld?.(true);
  }
  const handles = door.handles;
  if (handles && handles.length) {
    let bestPos = null;
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < handles.length; i++) {
      const h = handles[i];
      let wx, wy, wz;
      if (typeof h.getWorldPosition === 'function') {
        const v = { x: 0, y: 0, z: 0, set(nx, ny, nz) { this.x = nx; this.y = ny; this.z = nz; return this; } };
        if (h.matrixWorld?.elements) {
          h.updateMatrixWorld?.(true);
          const e = h.matrixWorld.elements;
          wx = e[12]; wy = e[13]; wz = e[14];
        } else {
          h.getWorldPosition(v);
          wx = v.x; wy = v.y; wz = v.z;
        }
      } else if (typeof h.x === 'number') {
        wx = h.x; wy = h.y; wz = h.z;
      } else {
        continue;
      }
      const d = Math.hypot(wx - (pose?.x || 0), wz - (pose?.z || 0));
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
        bestPos = { x: wx, y: wy, z: wz };
      }
    }
    if (bestPos) return { pos: bestPos, index: bestIdx };
  }
  const openPts = getOpenTargetPoints(door);
  const fallback = openPts.length === 1 ? openPts[0] : door.pos;
  return fallback ? { pos: { x: fallback.x, y: 1.05, z: fallback.z }, index: -1 } : null;
}

function getHandleWorldPos(door, pose) {
  return getClosestHandleInfo(door, pose)?.pos ?? null;
}

function computeDoorOpensRight(door, pose, handleIndex = -1) {
  const yaw = pose?.yaw || 0;
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const pivots = door?.pivots || [];
  const h = handleIndex >= 0 ? door?.handles?.[handleIndex] : door?.handles?.[0];
  const swingSign = getDoorSwingSign(door);

  if (pivots.length && h && typeof h.getWorldPosition === 'function' && h.matrixWorld?.elements) {
    const saved = pivots.map(p => p.group?.rotation?.y || 0);
    const sample = openVal => {
      const eased = openVal * openVal * (3 - 2 * openVal);
      for (const p of pivots) {
        if (p.group?.rotation) p.group.rotation.y = (p.hand ?? 1) * swingSign * eased * (p.maxAngle ?? 1.74);
        p.group?.updateMatrixWorld?.(true);
      }
      h.updateMatrixWorld?.(true);
      const e = h.matrixWorld.elements;
      return { x: e[12], z: e[14] };
    };
    const pClosed = sample(0);
    const pOpen = sample(0.85);
    for (let i = 0; i < pivots.length; i++) {
      if (pivots[i].group?.rotation) pivots[i].group.rotation.y = saved[i];
      pivots[i].group?.updateMatrixWorld?.(true);
    }
    const deltaRight = (pOpen.x - pClosed.x) * rx + (pOpen.z - pClosed.z) * rz;
    if (Math.abs(deltaRight) > 0.05) return deltaRight > 0;
  }

  const openPt = getOpenTargetPoints({ ...door, open: 0.85 })[0];
  if (door?.pos && openPt) {
    const deltaRight = (openPt.x - door.pos.x) * rx + (openPt.z - door.pos.z) * rz;
    if (Math.abs(deltaRight) > 0.08) return deltaRight > 0;
  }
  return (pivots[0]?.hand ?? 0) * swingSign > 0;
}

export function createDoorController({ doors = [], switches = [], atmosphere = null, audio = null } = {}) {
  const sfx = audio || makeDoorAudio();
  let currentTarget = null;
  let noteText = '';
  let noteTimer = 0;
  let activeAction = null;
  let pendingSlam = null;
  let retreatCooldown = 0;
  let monsterDoor = null;
  const initialOpen = doors.map(d => d.open);
  const initialSwingSign = doors.map(d => getDoorSwingSign(d));

  function holdForMonster(door, actorPos = null) {
    monsterDoor = door && !door.locked ? door : null;
    if (!monsterDoor) return;
    if (activeAction?.door === door) activeAction = null;
    if (actorPos && (door.open ?? 0) <= 0.02) {
      const nextSign = resolveSwingSign(door, actorPos);
      if (getDoorSwingSign(door) !== nextSign) {
        door.swingSign = nextSign;
        if ((door.open ?? 0) > 0) door.open = 0;
        applyDoorPose(door);
      } else {
        door.swingSign = nextSign;
      }
    }
    if (door.targetOpen < 1) sfx.playDoor?.(true, door);
    door.targetOpen = 1;
  }

  // A door the suit deliberately slams shut from the outside. Unlike the
  // player action it ignores the threshold guard: the hunt owns the passage.
  function closeForMonster(door) {
    if (!door || door.locked) return false;
    if (monsterDoor === door) monsterDoor = null;
    if (activeAction?.door === door) activeAction = null;
    if (door.open <= 0.02 && door.targetOpen === 0) return false;
    door.targetOpen = 0;
    door.slam = 1;
    door.bounce = 0;
    if (sfx.playSlam) sfx.playSlam(door);
    else sfx.playDoor?.(false, door);
    return true;
  }

  function reset() {
    monsterDoor = activeAction = pendingSlam = currentTarget = null;
    noteTimer = retreatCooldown = 0;
    noteText = '';
    doors.forEach((door, i) => {
      door.open = door.targetOpen = initialOpen[i];
      door.swingSign = initialSwingSign[i];
      door.slam = door.bounce = door.rattle = 0;
      applyDoorPose(door);
    });
  }
  function showNote(text, duration = 2.0) {
    noteText = text;
    noteTimer = duration;
  }

  function findTarget(pose) {
    if (!pose) return null;
    const dir = lookDirection(pose.yaw || 0, pose.pitch || 0);
    const camY = pose.cameraY ?? ((pose.y ?? 1.61) + (pose.jump?.height ?? 0));
    let best = null;
    let bestScore = Infinity;

    for (const sw of switches) {
      if (sw.sideCheck && !sw.sideCheck(pose)) continue;
      const dx = sw.pos.x - pose.x;
      const dy = sw.pos.y - camY;
      const dz = sw.pos.z - pose.z;
      const dist = Math.hypot(dx, dy, dz);
      const maxRange = sw.range ?? 2.25;
      if (dist > maxRange || dist < 0.15) continue;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / dist;
      const miss = Math.sqrt(Math.max(0, 1 - dot * dot)) * dist;
      if (dot < 0.78 || miss > 0.34) continue;
      const score = dist * 0.45 + miss * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = { kind: 'switch', item: sw, dist };
      }
    }

    for (const door of doors) {
      if (door.breached) continue;
      const openPts = door.open > 0.5 ? getOpenTargetPoints(door) : [];
      const points = openPts.length ? [door.pos, ...openPts] : [door.pos];
      for (const pt of points) {
        const dx = pt.x - pose.x;
        const dy = pt.y - camY;
        const dz = pt.z - pose.z;
        const dist = Math.hypot(dx, dy, dz);
        const maxRange = door.range ?? 2.55;
        if (dist > maxRange || dist < 0.15) continue;
        const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / dist;
        const miss = Math.sqrt(Math.max(0, 1 - dot * dot)) * dist;
        if (dot < 0.56 || miss > 0.68) continue;
        const score = dist * 0.55 + miss * 1.4;
        if (score < bestScore) {
          bestScore = score;
          best = { kind: 'door', item: door, dist };
        }
      }
    }

    return best;
  }

  function formatPrompt(target) {
    if (!target) return '';
    if (target.kind === 'switch') {
      const sw = target.item;
      const lamp = atmosphere?.getRoomLight?.(sw.lightId);
      const isOn = lamp ? lamp.switchedOn : false;
      return `[E] ${isOn ? 'Apagar' : 'Encender'} luz · ${sw.label}`;
    }
    const door = target.item;
    if (door.locked) return `[E] ${door.label} (Cerrada)`;
    const isAutoHolding = activeAction?.kind === 'grab' && activeAction.door === door && !activeAction.autoPush;
    const willClose = isAutoHolding ? door.open > 0.85 : door.targetOpen > 0.72;
    return willClose ? `[E] Cerrar ${door.label}` : `[E] Abrir ${door.label}`;
  }

  function applyDoorPose(door) {
    const t = clamp(door.open, 0, 1);
    const eased = t * t * (3 - 2 * t);
    const swingSign = getDoorSwingSign(door);
    const rattleOffset = door.rattle > 0 ? Math.sin(door.rattle * 44) * 0.025 * Math.min(1, door.rattle * 3) : 0;
    const bounceOffset = door.bounce > 0
      ? -Math.abs(Math.sin((0.42 - door.bounce) * 20)) * 0.095 * (door.bounce / 0.42)
      : 0;
    for (const pivot of door.pivots || []) {
      const maxAngle = pivot.maxAngle ?? 1.74;
      const angle = swingSign * (eased * maxAngle + bounceOffset) + rattleOffset;
      poseDoorLeaf(pivot, angle);
    }
    if (door.leverPivots && door.leverPivots.length) {
      let leverAngle = 0;
      const isGrabbingThisDoor = activeAction?.kind === 'grab' && activeAction.door === door && !activeAction.releasing;
      if (door.rattle > 0) {
        leverAngle = Math.sin(door.rattle * 44) * 0.24 * Math.min(1, door.rattle * 3);
      } else if (Math.abs(door.targetOpen - door.open) > 0.005 && !(door.slam > 0)) {
        const progress = door.targetOpen > 0.5 ? t : 1 - t;
        leverAngle = Math.sin(clamp(progress * 1.9, 0, 1) * Math.PI) * 0.36;
      } else if (isGrabbingThisDoor) {
        leverAngle = t < 0.35 ? 0.24 : 0.14;
      }
      for (const lp of door.leverPivots) {
        lp.group.rotation.z = (lp.hand ?? 1) * leverAngle;
      }
    }
    if (door.obstacle) {
      const isGrabbingThisDoor = activeAction?.kind === 'grab' && activeAction.door === door && !activeAction.releasing;
      door.obstacle.active = door.open < (door.slam > 0 ? 0.16 : isGrabbingThisDoor ? 0.35 : 0.72);
    }
  }

  function computeSlamSide(door, pose) {
    const yaw = pose?.yaw || 0;
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const hp = getHandleWorldPos(door, pose) || door.pos;
    const sideDot = ((hp?.x || 0) - (pose?.x || 0)) * rx + ((hp?.z || 0) - (pose?.z || 0)) * rz;
    return sideDot >= 0 ? 1 : -1;
  }

  function triggerDoor(door, nextOpen, isSlam, pose, { autoPush = true } = {}) {
    let startOpen = clamp(door.open || 0, 0, 1);
    if (nextOpen === 1 && startOpen <= 0.02) {
      const nextSign = resolveSwingSignForPose(door, pose);
      if (getDoorSwingSign(door) !== nextSign) {
        door.swingSign = nextSign;
        if (startOpen > 0) {
          door.open = 0;
          startOpen = 0;
        }
        applyDoorPose(door);
      } else {
        door.swingSign = nextSign;
      }
    }
    if (autoPush || nextOpen === 0 || isSlam) {
      door.targetOpen = nextOpen;
    } else {
      door.targetOpen = door.open;
    }
    if (isSlam) {
      door.slam = 1;
      door.bounce = 0;
      const slamSide = computeSlamSide(door, pose);
      if (sfx.playSlam) sfx.playSlam(door);
      else sfx.playDoor?.(true, door);
      activeAction = {
        kind: 'slam',
        door,
        opening: true,
        timer: 0,
        duration: 0.44,
        slamSide
      };
      pendingSlam = { side: slamSide, strength: clamp(1 - startOpen * 0.45, 0.55, 1) };
    } else {
      door.slam = 0;
      if (autoPush) sfx.playDoor?.(nextOpen === 1, door);
      else sfx.playGrab?.(door);
      const handleInfo = getClosestHandleInfo(door, pose);
      const yaw = pose?.yaw || 0;
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const hp = handleInfo?.pos || door.pos;
      const startLocalRight = hp && pose ? (hp.x - pose.x) * rx + (hp.z - pose.z) * rz : 0;
      // Preserve dominant right hand unless handle is clearly far to the left
      const startSide = startLocalRight < -0.46 ? 1 : -1;
      const opensRight = computeDoorOpensRight(door, pose, handleInfo?.index ?? -1);
      let doorDirX = fx;
      let doorDirZ = fz;
      if (door?.pos && pose) {
        const dx = door.pos.x - pose.x;
        const dz = door.pos.z - pose.z;
        const dLen = Math.hypot(dx, dz);
        if (dLen > 0.05) {
          doorDirX = dx / dLen;
          doorDirZ = dz / dLen;
        }
      }
      activeAction = {
        kind: 'grab',
        door,
        opening: nextOpen === 1,
        autoPush,
        playedCreak: Boolean(autoPush),
        timer: 0,
        pushTimer: 0,
        duration: 0.56,
        slamSide: computeSlamSide(door, pose),
        startSide,
        opensRight,
        doorDirX,
        doorDirZ,
        releasing: false,
        releaseTimer: 0,
        releaseDuration: 0.20
      };
    }
  }

  function interact(pose) {
    sfx.unlock?.();
    const target = findTarget(pose);
    currentTarget = target;
    if (!target) return { ok: false };

    if (target.kind === 'switch') {
      const sw = target.item;
      const on = atmosphere ? atmosphere.toggleRoomLight(sw.lightId) : true;
      if (sw.rocker) {
        sw.rocker.rotation.x = on ? -0.32 : 0.32;
      }
      sfx.playSwitch?.(on);
      return { ok: true, kind: 'switch', switch: sw, on };
    }

    const door = target.item;
    const speed = Math.hypot(pose?.vx || 0, pose?.vz || 0);
    const isSprinting = Boolean(pose?.isSprinting) || speed >= 2.85;

    if (door.locked) {
      door.rattle = isSprinting ? 0.46 : 0.34;
      sfx.playLocked?.(door, { slam: isSprinting });
      showNote('Cerrada con llave', 1.8);
      const slamSide = computeSlamSide(door, pose);
      activeAction = {
        kind: 'locked',
        door,
        opening: false,
        timer: 0,
        duration: door.rattle,
        slamSide
      };
      if (isSprinting) pendingSlam = { side: slamSide, strength: 0.65 };
      return { ok: false, kind: 'door', door, reason: 'locked', slam: isSprinting };
    }

    const isAutoHoldingThisDoor = activeAction?.kind === 'grab' && activeAction.door === door && !activeAction.autoPush;
    const nextOpen = isAutoHoldingThisDoor
      ? (door.open > 0.85 ? 0 : 1)
      : (door.targetOpen > 0.72 ? 0 : 1);
    if (nextOpen === 0 && (door === monsterDoor || (door.threshold && playerOverlapsRect(pose, door.threshold, 0.27)))) {
      if (sfx.playBlocked) sfx.playBlocked(door);
      else sfx.playLocked?.(door, { blocked: true });
      showNote('Despeja el umbral para cerrar', 1.6);
      return { ok: false, kind: 'door', door, reason: 'blocked' };
    }

    const isSlam = nextOpen === 1 && isSprinting;
    triggerDoor(door, nextOpen, isSlam, pose, { autoPush: true });
    return { ok: true, kind: 'door', door, open: nextOpen === 1, slam: isSlam };
  }

  function update(dt, pose, active = true) {
    const safeDt = clamp(dt, 0, 0.1);
    if (activeAction?.door?.breached) activeAction = null;
    if (retreatCooldown > 0) retreatCooldown = Math.max(0, retreatCooldown - safeDt);
    if (noteTimer > 0) {
      noteTimer = Math.max(0, noteTimer - safeDt);
      if (noteTimer === 0) noteText = '';
    }

    // Auto body-slam when sprinting into a closed or semi-open door
    if (active && pose) {
      const vx = pose.vx || 0;
      const vz = pose.vz || 0;
      const wishVx = pose.wishVx ?? vx;
      const wishVz = pose.wishVz ?? vz;
      const actualSpeed = Math.hypot(vx, vz);
      const wishSpeed = Math.hypot(wishVx, wishVz);
      const useWish = Boolean(pose.isSprinting);
      const driveSpeed = useWish ? Math.max(actualSpeed, wishSpeed) : actualSpeed;
      if ((useWish || actualSpeed >= 2.85) && driveSpeed > 1.8) {
        for (const door of doors) {
          if (door.breached) continue;
          if (door === monsterDoor) continue;
          if (door.locked) {
            if (door.open >= 0.22 || !door.threshold) continue;
            const approach = getThresholdPushApproach(door, pose, vx, vz, wishVx, wishVz, useWish);
            if (approach < 1.65) continue;
            if ((door.rattle || 0) <= 0.05) {
              door.rattle = 0.46;
              sfx.playLocked?.(door, { slam: true });
              showNote('Cerrada con llave', 1.8);
              const slamSide = computeSlamSide(door, pose);
              activeAction = {
                kind: 'locked',
                door,
                opening: false,
                timer: 0,
                duration: 0.46,
                slamSide
              };
              pendingSlam = { side: slamSide, strength: 0.75 };
            }
            break;
          }
          if (door.open >= 0.88 || (door.slam || 0) > 0) continue;
          const thresholdBlocked = door.open < 0.72 || door.targetOpen < 0.95;
          const thresholdApproach = thresholdBlocked
            ? getThresholdPushApproach(door, pose, vx, vz, wishVx, wishVz, useWish)
            : -Infinity;
          const hitThreshold = thresholdApproach >= 1.65;
          const hitLeaf = !hitThreshold && door.open > 0.02
            ? getLeafPushMatch(door, pose, vx, vz, wishVx, wishVz, useWish)
            : false;
          if (!hitThreshold && !hitLeaf) continue;
          triggerDoor(door, 1, true, pose);
          break;
        }
      }
    }

    // Auto-grab the knob when approaching and looking at an unlocked door
    if (active && pose && !activeAction && retreatCooldown <= 0) {
      const speed = Math.hypot(pose.vx || 0, pose.vz || 0);
      if (!pose.isSprinting && speed < 2.85) {
        const lookTarget = findTarget(pose);
        if (lookTarget && lookTarget.kind === 'door' && lookTarget.item !== monsterDoor && !lookTarget.item.locked && lookTarget.item.open < 0.90) {
          const hp = getHandleWorldPos(lookTarget.item, pose);
          const handleDist = hp ? Math.hypot(hp.x - pose.x, hp.z - pose.z) : lookTarget.dist;
          const fx = -Math.sin(pose.yaw || 0);
          const fz = -Math.cos(pose.yaw || 0);
          const moveX = pose.wishVx ?? pose.vx ?? 0;
          const moveZ = pose.wishVz ?? pose.vz ?? 0;
          const fwdInput = moveX * fx + moveZ * fz;
          if ((handleDist <= 1.05 || lookTarget.dist <= 1.15) && fwdInput >= -0.05) {
            triggerDoor(lookTarget.item, 1, false, pose, { autoPush: false });
          }
        }
      }
    }

    if (activeAction && activeAction.kind === 'grab' && !activeAction.releasing && pose) {
      const actVx = pose.vx || 0;
      const actVz = pose.vz || 0;
      const wishVx = pose.wishVx ?? actVx;
      const wishVz = pose.wishVz ?? actVz;
      const yaw = pose.yaw || 0;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const actFwd = actVx * fx + actVz * fz;
      const wishFwd = wishVx * fx + wishVz * fz;
      const approachVel = Math.max(actVx * activeAction.doorDirX + actVz * activeAction.doorDirZ, wishVx * activeAction.doorDirX + wishVz * activeAction.doorDirZ);
      const actualApproach = actVx * activeAction.doorDirX + actVz * activeAction.doorDirZ;
      const hp = getHandleWorldPos(activeAction.door, pose);
      const dist = hp ? Math.hypot(hp.x - pose.x, hp.z - pose.z) : 0.6;
      const localFwd = hp ? (hp.x - pose.x) * fx + (hp.z - pose.z) * fz : 0.5;
      const isRetreating = wishFwd < -0.18 || actFwd < -0.22 || actualApproach < -0.28;
      const passedThrough = localFwd < -0.28 || dist > 1.38;

      if (activeAction.opening) {
        if (isRetreating || passedThrough) {
          activeAction.releasing = true;
          sfx.playRelease?.(activeAction.door);
          if (isRetreating) retreatCooldown = 0.65;
        } else if (!activeAction.autoPush) {
          const push = Math.max(0, wishFwd, actFwd, approachVel);
          if (push > 0.15 && activeAction.door.open < 1) {
            const prevManualOpen = activeAction.door.open;
            const advanceStep = Math.min(2.45, 0.85 + push * 0.65) * safeDt;
            activeAction.door.open = clamp(activeAction.door.open + advanceStep, 0, 1);
            activeAction.door.targetOpen = activeAction.door.open;
            if (!activeAction.playedCreak && activeAction.door.open > 0.03) {
              activeAction.playedCreak = true;
              sfx.playDoor?.(true, activeAction.door);
            }
            if (prevManualOpen < 0.995 && activeAction.door.open >= 0.995) {
              sfx.playOpenStop?.(activeAction.door);
            }
          } else {
            activeAction.door.targetOpen = activeAction.door.open;
          }
        }
      } else {
        const closedSettled = Math.abs(activeAction.door.targetOpen - activeAction.door.open) <= 0.005 && activeAction.timer >= 0.55;
        if ((actFwd < -0.50 && dist > 1.05) || dist > 1.45 || closedSettled) {
          activeAction.releasing = true;
          sfx.playRelease?.(activeAction.door);
        }
      }
    }

    for (const door of doors) {
      if (door.breached) continue;
      const prevOpen = door.open;
      const diff = door.targetOpen - door.open;
      const isGrabbingDoor = activeAction?.kind === 'grab' && activeAction.door === door && !activeAction.releasing;
      let swingSpeed = (door.slam || 0) > 0 ? 7.6 : 2.35;
      if (isGrabbingDoor && pose) {
        const actVx = pose.vx || 0;
        const actVz = pose.vz || 0;
        const wishVx = pose.wishVx ?? actVx;
        const wishVz = pose.wishVz ?? actVz;
        const yaw = pose.yaw || 0;
        const fx = -Math.sin(yaw);
        const fz = -Math.cos(yaw);
        const push = Math.max(
          0,
          actVx * fx + actVz * fz,
          wishVx * fx + wishVz * fz,
          wishVx * activeAction.doorDirX + wishVz * activeAction.doorDirZ
        );
        swingSpeed = push > 0.15 ? 2.15 + Math.min(1.65, push * 0.68) : 2.15;
      }
      if (Math.abs(diff) > 0.001) {
        const step = Math.sign(diff) * Math.min(Math.abs(diff), safeDt * swingSpeed);
        door.open = clamp(door.open + step, 0, 1);
        if (door.targetOpen === 0 && prevOpen > 0.005 && door.open <= 0.005) {
          sfx.playCloseLatch?.(door);
        } else if (door.targetOpen === 1 && (door.slam || 0) <= 0 && prevOpen < 0.995 && door.open >= 0.995) {
          sfx.playOpenStop?.(door);
        }
        if (door.slam > 0 && door.open >= 0.995 && door.bounce <= 0) {
          door.bounce = 0.42;
        }
      } else {
        door.open = door.targetOpen;
      }
      if (door.bounce > 0) {
        door.bounce = Math.max(0, door.bounce - safeDt);
      }
      if (door.slam > 0 && door.open >= 0.995 && door.bounce <= 0.12) {
        door.slam = Math.max(0, door.slam - safeDt * 3.5);
      }
      if (door.rattle > 0) {
        door.rattle = Math.max(0, door.rattle - safeDt);
      }
      applyDoorPose(door);
    }

    if (activeAction) {
      activeAction.timer += safeDt;
      if (activeAction.kind === 'grab') {
        if (activeAction.autoPush) activeAction.pushTimer += safeDt;
        if (activeAction.releasing) {
          activeAction.releaseTimer += safeDt;
          if (activeAction.releaseTimer >= activeAction.releaseDuration) {
            activeAction = null;
          }
        }
      } else if (activeAction.timer >= activeAction.duration) {
        activeAction = null;
      }
    }

    currentTarget = active ? findTarget(pose) : null;
  }

  function getInteractionState(pose) {
    if (!activeAction) return null;
    const {
      kind, door, opening, autoPush, timer, pushTimer, duration, slamSide,
      startSide, opensRight, releasing, releaseTimer, releaseDuration
    } = activeAction;
    const handlePos = getHandleWorldPos(door, pose);
    const doorOpen = clamp(door.open, 0, 1);
    let progress = 0;
    let intensity = 1;
    let pushPulse = 0;
    if (kind === 'grab') {
      progress = opening ? doorOpen : 1 - doorOpen;
      const dist = handlePos && pose
        ? Math.hypot(handlePos.x - pose.x, handlePos.z - pose.z)
        : 0.7;
      if (dist > 1.55) return null;
      const distFade = 1 - clamp((dist - 1.15) / 0.40, 0, 1);
      const releaseFade = releasing
        ? 1 - clamp(releaseTimer / Math.max(0.05, releaseDuration), 0, 1)
        : 1;
      intensity = distFade * releaseFade;
      if (intensity <= 0.01) return null;
      if (autoPush && opening && pushTimer < 0.48) {
        pushPulse = Math.sin(clamp(pushTimer / 0.44, 0, 1) * Math.PI);
      }
    } else if (kind === 'slam') {
      progress = clamp(timer / duration, 0, 1);
      intensity = 1 - smoothstep01(0.55, 1.0, progress);
    } else if (kind === 'locked') {
      progress = clamp(timer / duration, 0, 1);
      intensity = Math.sin(progress * Math.PI);
    }
    return {
      kind,
      opening,
      autoPush: Boolean(autoPush),
      pushPulse,
      progress,
      doorOpen,
      intensity,
      slamSide,
      startSide,
      opensRight,
      releasing: Boolean(releasing),
      handlePos,
      doorPos: door.pos ? { x: door.pos.x, y: door.pos.y, z: door.pos.z } : handlePos
    };
  }

  function consumeSlam() {
    const s = pendingSlam;
    pendingSlam = null;
    return s;
  }

  function isAnimating() {
    const actionActive = Boolean(
      activeAction && (
        activeAction.kind !== 'grab' ||
        activeAction.releasing ||
        Math.abs(activeAction.door.targetOpen - activeAction.door.open) > 0.005
      )
    );
    return (
      noteTimer > 0 ||
      actionActive ||
      doors.some(
        d =>
          Math.abs(d.targetOpen - d.open) > 0.001 ||
          (d.rattle || 0) > 0 ||
          (d.bounce || 0) > 0 ||
          (d.slam || 0) > 0
      )
    );
  }

  // Initialize door & switch visual/obstacle states immediately.
  for (const door of doors) applyDoorPose(door);
  for (const sw of switches) {
    const lamp = atmosphere?.getRoomLight?.(sw.lightId);
    if (sw.rocker && lamp) sw.rocker.rotation.x = lamp.switchedOn ? -0.32 : 0.32;
  }

  return {
    doors,
    switches,
    holdForMonster,
    closeForMonster,
    reset,
    interact,
    update,
    findTarget,
    getInteractionState,
    consumeSlam,
    get currentTarget() { return currentTarget; },
    get prompt() {
      if (noteText) return noteText;
      return formatPrompt(currentTarget);
    },
    get note() { return noteText; },
    get animating() { return isAnimating(); }
  };
}

function smoothstep01(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
