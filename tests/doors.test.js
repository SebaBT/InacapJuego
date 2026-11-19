import assert from 'node:assert/strict';
import test from 'node:test';
import { createDoorController } from '../src/doors.js';
import { movePlayer, projectVelocityAfterMove, supportHeight } from '../src/walk.js';
import { createAtmosphere } from '../src/atmosphere.js';
import { extraLights, lights, worldBounds } from '../src/layout.js';

function makeDoorFixture(overrides = {}) {
  const pivotGroup = { rotation: { y: 0 } };
  const obstacle = { x0: 2.22, x1: 2.39, z0: -0.41, z1: 0.71, active: true };
  return {
    id: '101',
    label: 'Sala 101',
    locked: false,
    open: 0,
    targetOpen: 0,
    rattle: 0,
    pos: { x: 2.31, y: 1.15, z: 0.15 },
    openPos: { x: 2.80, y: 1.15, z: -0.40 },
    threshold: { x0: 2.08, x1: 2.53, z0: -0.41, z1: 0.71 },
    pivots: [{ group: pivotGroup, hand: 1, maxAngle: 1.76 }],
    obstacle,
    ...overrides
  };
}

test('door controller opens targeted door, swings pivot, and unlocks collision obstacle', () => {
  const door = makeDoorFixture();
  const ctrl = createDoorController({ doors: [door], audio: {} });
  const pose = { x: 1.15, y: 1.61, z: 0.15, yaw: -Math.PI / 2, pitch: -0.35 };

  ctrl.update(0.016, pose, true);
  assert.equal(ctrl.currentTarget?.kind, 'door');
  assert.match(ctrl.prompt, /Abrir Sala 101/);

  const res = ctrl.interact(pose);
  assert.equal(res.ok, true);
  assert.equal(res.open, true);

  for (let i = 0; i < 30; i++) ctrl.update(0.03, pose, true);
  assert.equal(door.open, 1);
  assert.ok(Math.abs(door.pivots[0].group.rotation.y - 1.76) < 1e-6);
  assert.equal(door.obstacle.active, false);
  assert.match(ctrl.prompt, /Cerrar Sala 101/);

  // Can also target the swung-open door leaf from inside the classroom.
  const insidePose = { x: 3.35, y: 1.61, z: 0.15, yaw: Math.atan2(0.55, 0.55), pitch: -0.45 };
  ctrl.update(0.016, insidePose, true);
  assert.equal(ctrl.currentTarget?.kind, 'door');
});

test('door refuses to close while player stands inside the doorway threshold', () => {
  const door = makeDoorFixture({ open: 1, targetOpen: 1 });
  const ctrl = createDoorController({ doors: [door], audio: {} });
  const standingInDoorway = { x: 2.00, y: 1.61, z: 0.15, yaw: -Math.PI / 2, pitch: -0.75 };

  ctrl.update(0.016, standingInDoorway, true);
  const res = ctrl.interact(standingInDoorway);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'blocked');
  assert.equal(door.targetOpen, 1);
  assert.match(ctrl.prompt, /Despeja/);
});

test('locked door rattles and reports Cerrada con llave without opening', () => {
  const door = makeDoorFixture({
    id: 'entrada',
    label: 'Salida principal',
    locked: true,
    pos: { x: 0, y: 1.15, z: 5.72 },
    pivots: []
  });
  const ctrl = createDoorController({ doors: [door], audio: {} });
  const pose = { x: 0, y: 1.61, z: 4.5, yaw: Math.PI, pitch: -0.25 };

  ctrl.update(0.016, pose, true);
  assert.match(ctrl.prompt, /Cerrada/);
  const res = ctrl.interact(pose);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'locked');
  assert.ok(door.rattle > 0.2);
  assert.equal(ctrl.prompt, 'Cerrada con llave');
});

test('light switches respect sideCheck and toggle extraLights in atmosphere', () => {
  const atmo = createAtmosphere(lights, extraLights);
  assert.equal(atmo.getRoomLight('102').switchedOn, false);

  const rocker = { rotation: { x: 0 } };
  const swOut = {
    id: 'sw-out-102',
    lightId: '102',
    label: 'Sala 102',
    pos: { x: 2.193, y: 1.213, z: -8.05 },
    rocker,
    sideCheck: pose => pose.x < 2.24
  };
  const ctrl = createDoorController({ switches: [swOut], atmosphere: atmo, audio: {} });

  // Looking from inside the room cannot trigger the exterior corridor switch.
  const insidePose = { x: 3.1, y: 1.61, z: -8.05, yaw: Math.PI / 2, pitch: -0.4 };
  ctrl.update(0.016, insidePose, true);
  assert.equal(ctrl.currentTarget, null);

  // Looking from the corridor toggles Sala 102 light ON.
  const hallPose = { x: 1.3, y: 1.61, z: -8.05, yaw: -Math.PI / 2, pitch: -0.4 };
  ctrl.update(0.016, hallPose, true);
  assert.equal(ctrl.currentTarget?.kind, 'switch');
  assert.match(ctrl.prompt, /Encender luz/);

  const res = ctrl.interact(hallPose);
  assert.equal(res.ok, true);
  assert.equal(res.on, true);
  assert.equal(atmo.getRoomLight('102').switchedOn, true);
  assert.ok(rocker.rotation.x < 0);
  ctrl.update(0.016, hallPose, true);
  assert.match(ctrl.prompt, /Apagar luz/);
});

test('player stops at closed door, walks into room once open, and climbs annex stair steps', () => {
  const doorObstacle = { x0: 2.22, x1: 2.39, z0: -0.41, z1: 0.71, active: true };
  const wallNorth = { x0: 2.22, x1: 2.39, z0: -5.0, z1: -0.41 };
  const wallSouth = { x0: 2.22, x1: 2.39, z0: 0.71, z1: 5.0 };
  const stairs = [
    { x0: -3.88, x1: -1.62, z0: -38.98, z1: -38.50, top: 0.18, step: true },
    { x0: -3.88, x1: -1.62, z0: -39.46, z1: -38.98, top: 0.36, step: true }
  ];
  const obstacles = [wallNorth, doorObstacle, wallSouth, ...stairs];

  const p = { x: 1.5, z: 0.15 };
  movePlayer(p, 1.5, 0, obstacles, 0, worldBounds);
  assert.ok(p.x <= 2.22 - 0.245 + 1e-6, 'closed door blocks entry into classroom');

  doorObstacle.active = false;
  movePlayer(p, 1.5, 0, obstacles, 0, worldBounds);
  assert.ok(p.x > 2.8, 'open door allows walking into classroom');

  // Walk onto Annex stairs smoothly without jumping.
  const walker = { x: -2.75, z: -38.1 };
  let footY = 0;
  for (let i = 0; i < 6; i++) {
    movePlayer(walker, 0, -0.2, obstacles, footY, worldBounds);
    footY = supportHeight(walker.x, walker.z, footY, obstacles);
  }
  assert.equal(footY, 0.36, 'player climbs consecutive 0.18m stair steps');
});

import fs from 'node:fs';
import { rooms } from '../src/layout.js';

test('door shader uniforms and glossy/transparent door materials align with rooms and extraLights', () => {
  assert.equal(rooms.length, 7);
  assert.equal(extraLights.length, 14);
  for (let i = 0; i < rooms.length; i++) {
    assert.equal(rooms[i].lightId, extraLights[i].id);
  }

  const renderSrc = fs.readFileSync(new URL('../src/render.js', import.meta.url), 'utf8');
  assert.match(renderSrc, /uniform vec4 doorOpenings\[DOOR_COUNT\]/);
  assert.match(renderSrc, /uniform float shininess/);
  assert.match(renderSrc, /uniform float opacity/);
  assert.match(renderSrc, /transparent:\s*opacity < 1/);
  assert.match(renderSrc, /hallPortal/);
  assert.match(renderSrc, /surfaceGloss/);
  assert.doesNotMatch(renderSrc, /classroomZ.*room101Lit/);

  const corridorSrc = fs.readFileSync(new URL('../src/corridor.js', import.meta.url), 'utf8');
  assert.match(corridorSrc, /doorWood/);
  assert.match(corridorSrc, /doorTrim/);
  assert.match(corridorSrc, /doorGlass/);
  assert.match(corridorSrc, /cutoutFrame/);
  assert.match(corridorSrc, /visionWindow/);
  assert.match(corridorSrc, /group3\(pivot,\s*hx,\s*1\.049/);
  assert.match(corridorSrc, /group3\(leafMount,\s*lx\s*-\s*s\s*\*\s*\.14,\s*1\.02/);
});

import { Group, Vector3 } from 'three';

test('open classroom door leaf blocks player from walking through it and matches 3D pivot geometry', () => {
  const leaf = 0.98;
  const W = 2.22;
  const zDoor = 0.15;
  const side = 1;
  const hand = 1;

  const doorFrame = new Group();
  doorFrame.position.set(side * W, 0, 0);
  doorFrame.rotation.y = -side * Math.PI / 2;
  const pivotGroup = new Group();
  pivotGroup.position.set(side * zDoor - hand * (leaf / 2), 0, -0.103);
  doorFrame.add(pivotGroup);

  const hx = side * (W + 0.103);
  const hz = zDoor - side * hand * (leaf / 2);
  const leafObstacle = {
    kind: 'segment',
    ax: hx,
    az: hz,
    bx: hx,
    bz: hz + side * hand * leaf,
    halfThick: 0.034,
    x0: hx - 0.034,
    x1: hx + 0.034,
    z0: Math.min(hz, hz + side * hand * leaf) - 0.034,
    z1: Math.max(hz, hz + side * hand * leaf) + 0.034,
    active: true
  };
  const doorObstacle = { x0: 2.22, x1: 2.39, z0: -0.41, z1: 0.71, active: true };
  const door = makeDoorFixture({
    obstacle: doorObstacle,
    pivots: [{
      group: pivotGroup,
      hand,
      maxAngle: 1.76,
      hx,
      hz,
      length: leaf,
      closedDirX: 0,
      closedDirZ: side * hand,
      swingDirX: side,
      swingDirZ: 0,
      obstacle: leafObstacle
    }]
  });

  const ctrl = createDoorController({ doors: [door], audio: {} });
  const pose = { x: 1.15, y: 1.61, z: zDoor, yaw: -Math.PI / 2, pitch: -0.35 };
  ctrl.update(0.016, pose, true);
  ctrl.interact(pose);
  for (let i = 0; i < 40; i++) ctrl.update(0.03, pose, true);
  assert.equal(door.open, 1);

  // Verify 2D segment endpoints match actual 3D hinge and latch-edge world positions.
  doorFrame.updateMatrixWorld(true);
  const hingeWorld = pivotGroup.localToWorld(new Vector3(0, 0, 0));
  const tipWorld = pivotGroup.localToWorld(new Vector3(hand * leaf, 0, 0));
  assert.ok(Math.hypot(hingeWorld.x - leafObstacle.ax, hingeWorld.z - leafObstacle.az) < 1e-6);
  assert.ok(Math.hypot(tipWorld.x - leafObstacle.bx, tipWorld.z - leafObstacle.bz) < 1e-6);

  const obstacles = [
    { x0: 2.22, x1: 2.39, z0: -5.0, z1: -0.41 },
    doorObstacle,
    { x0: 2.22, x1: 2.39, z0: 0.71, z1: 5.0 },
    leafObstacle
  ];

  // Player can walk freely through the open doorway into the classroom center.
  const passer = { x: 1.5, z: 0.18 };
  movePlayer(passer, 1.5, 0, obstacles, 0, worldBounds);
  assert.ok(passer.x > 2.8, 'player passes through the clear doorway');

  // Inside the room, trying to walk straight through the open door leaf is blocked (no tunneling).
  const midLeafZ = (leafObstacle.az + leafObstacle.bz) / 2;
  const startZ = midLeafZ + 0.55;
  const walker = { x: 2.80, z: startZ };
  movePlayer(walker, 0, -1.2, obstacles, 0, worldBounds);
  assert.ok(walker.z > midLeafZ + 0.24, 'open classroom door leaf blocks player from crossing through it');
});

test('open annex double door leaves block player from walking through either leaf', () => {
  const farZ = -31.2;
  const leafLen = 0.918;
  const leafContainer = new Group();
  leafContainer.position.set(0, 0, farZ);

  const pivots = [];
  const leafObstacles = [];
  for (const s of [-1, 1]) {
    const hx = s * 0.927;
    const hz = farZ - 0.044;
    const leafMount = new Group();
    leafMount.position.set(hx, 0, -0.044);
    leafContainer.add(leafMount);

    const leafObstacle = {
      kind: 'segment',
      ax: hx,
      az: hz,
      bx: hx - s * leafLen,
      bz: hz,
      halfThick: 0.036,
      x0: Math.min(hx, hx - s * leafLen) - 0.036,
      x1: Math.max(hx, hx - s * leafLen) + 0.036,
      z0: hz - 0.036,
      z1: hz + 0.036,
      active: true
    };
    leafObstacles.push(leafObstacle);
    pivots.push({
      group: leafMount,
      hand: -s,
      maxAngle: 1.68,
      hx,
      hz,
      length: leafLen,
      closedDirX: -s,
      closedDirZ: 0,
      swingDirX: 0,
      swingDirZ: -1,
      obstacle: leafObstacle
    });
  }

  const centerBlocker = { x0: -1.01, x1: 1.01, z0: farZ - 0.17, z1: farZ + 0.02, active: true };
  const door = makeDoorFixture({
    id: 'anexo',
    label: 'Puertas del Anexo',
    pos: { x: 0, y: 1.15, z: farZ },
    openPos: [{ x: -0.98, y: 1.15, z: farZ - 0.50 }, { x: 0.98, y: 1.15, z: farZ - 0.50 }],
    threshold: { x0: -1.01, x1: 1.01, z0: farZ - 0.26, z1: farZ + 0.16 },
    pivots,
    obstacle: centerBlocker
  });

  const ctrl = createDoorController({ doors: [door], audio: {} });
  const pose = { x: 0, y: 1.61, z: farZ + 1.1, yaw: 0, pitch: -0.3 };
  ctrl.update(0.016, pose, true);
  ctrl.interact(pose);
  for (let i = 0; i < 40; i++) ctrl.update(0.03, pose, true);
  assert.equal(door.open, 1);

  leafContainer.updateMatrixWorld(true);
  for (let idx = 0; idx < 2; idx++) {
    const s = idx === 0 ? -1 : 1;
    const tip = pivots[idx].group.localToWorld(new Vector3(-s * leafLen, 0, 0));
    assert.ok(Math.hypot(tip.x - leafObstacles[idx].bx, tip.z - leafObstacles[idx].bz) < 1e-6);
  }

  const obstacles = [
    { x0: -2.22, x1: -1.01, z0: farZ - 0.17, z1: farZ + 0.02 },
    centerBlocker,
    { x0: 1.01, x1: 2.22, z0: farZ - 0.17, z1: farZ + 0.02 },
    ...leafObstacles
  ];

  // Trying to walk sideways across the right open Annex door leaf is blocked.
  const walker = { x: 0.1, z: farZ - 0.55 };
  movePlayer(walker, 1.5, 0, obstacles, 0, { minX: -4.2, maxX: 4.2, minZ: -44, maxZ: 6 });
  assert.ok(walker.x < 0.85, 'open annex double door leaf blocks horizontal passage through it');
});

test('walking at a slight angle into an open classroom or annex door slides along the leaf without getting stuck', () => {
  // 1. Classroom 101 partially open leaf (~50% open) + rounded jambs.
  const hx = 2.323;
  const hz = -0.34;
  const leaf = 0.98;
  const angle = 0.9;
  const roomObstacles = [
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
  const pRoom = { x: 2.05, z: 0.30 };
  let vx = 2.4 * Math.cos(0.25);
  let vz = -2.4 * Math.sin(0.25);
  const dt = 0.016;
  for (let i = 0; i < 45; i++) {
    vx += (2.4 * Math.cos(0.25) - vx) * 0.2;
    vz += (-2.4 * Math.sin(0.25) - vz) * 0.2;
    const ox = pRoom.x;
    const oz = pRoom.z;
    movePlayer(pRoom, vx * dt, vz * dt, roomObstacles, 0, { minX: -2.22, maxX: 5.5, minZ: -5, maxZ: 5 });
    [vx, vz] = projectVelocityAfterMove(vx, vz, pRoom.x - ox, pRoom.z - oz, dt);
  }
  assert.ok(pRoom.x > 2.75, `expected player to slide past angled classroom leaf into room, got x=${pRoom.x}`);

  // 2. Annex door with rounded jambs and angled leaves.
  const farZ = -31.2;
  const annexAngle = 1.1;
  const annexLeaf = 0.918;
  const annexObstacles = [
    { x0: -2.22, x1: -1.01, z0: farZ - 0.17, z1: farZ + 0.02, rounded: true },
    { x0: 1.01, x1: 2.22, z0: farZ - 0.17, z1: farZ + 0.02, rounded: true },
    {
      kind: 'segment',
      ax: 0.927,
      az: farZ - 0.044,
      bx: 0.927 - Math.cos(annexAngle) * annexLeaf,
      bz: farZ - 0.044 - Math.sin(annexAngle) * annexLeaf,
      halfThick: 0.036,
      active: true
    }
  ];
  const pAnnex = { x: 0.65, z: farZ + 0.55 };
  vx = 2.4 * Math.sin(0.25);
  vz = -2.4 * Math.cos(0.25);
  for (let i = 0; i < 50; i++) {
    vx += (2.4 * Math.sin(0.25) - vx) * 0.2;
    vz += (-2.4 * Math.cos(0.25) - vz) * 0.2;
    const ox = pAnnex.x;
    const oz = pAnnex.z;
    movePlayer(pAnnex, vx * dt, vz * dt, annexObstacles, 0, { minX: -4.2, maxX: 4.2, minZ: -44, maxZ: 6 });
    [vx, vz] = projectVelocityAfterMove(vx, vz, pAnnex.x - ox, pAnnex.z - oz, dt);
  }
  assert.ok(pAnnex.z < farZ - 0.5, `expected player to slide cleanly through angled annex door, got z=${pAnnex.z}`);
});

test('sprinting into a semi-open door pushes it open even from a standstill against the blocker', () => {
  const hx = 2.323;
  const hz = -0.34;
  const leaf = 0.98;
  const leafObstacle = {
    kind: 'segment',
    ax: hx,
    az: hz,
    bx: hx,
    bz: hz + leaf,
    halfThick: 0.034,
    active: true
  };
  const doorObstacle = { x0: 2.22, x1: 2.39, z0: -0.41, z1: 0.71, active: true, rounded: true };
  const door = makeDoorFixture({
    open: 0.45,
    targetOpen: 0.45,
    obstacle: doorObstacle,
    pivots: [{
      group: { rotation: { y: 0 } },
      hand: 1,
      maxAngle: 1.76,
      hx,
      hz,
      length: leaf,
      closedDirX: 0,
      closedDirZ: 1,
      swingDirX: 1,
      swingDirZ: 0,
      obstacle: leafObstacle
    }]
  });
  let slams = 0;
  const ctrl = createDoorController({ doors: [door], audio: { playSlam: () => { slams++; } } });
  assert.equal(doorObstacle.active, true, 'semi-open door starts blocking threshold');

  const obstacles = [
    { x0: 2.22, x1: 2.39, z0: -5.0, z1: -0.41, rounded: true },
    doorObstacle,
    { x0: 2.22, x1: 2.39, z0: 0.71, z1: 5.0, rounded: true },
    leafObstacle
  ];

  // Player starts stopped right against the semi-open door and presses sprint forward.
  const player = { x: 1.975, z: 0.15 };
  let vx = 0;
  let vz = 0;
  const dt = 0.016;
  for (let i = 0; i < 35; i++) {
    vx += (4.35 - vx) * (1 - Math.exp(-12.5 * dt));
    const ox = player.x;
    const oz = player.z;
    movePlayer(player, vx * dt, vz * dt, obstacles, 0, { minX: -2.22, maxX: 5.5, minZ: -5, maxZ: 5 });
    [vx, vz] = projectVelocityAfterMove(vx, vz, player.x - ox, player.z - oz, dt);
    ctrl.update(dt, {
      x: player.x,
      y: 1.61,
      z: player.z,
      yaw: -Math.PI / 2,
      pitch: 0,
      vx,
      vz,
      wishVx: 4.35,
      wishVz: 0,
      isSprinting: true
    }, true);
  }
  assert.equal(slams, 1, 'semi-open door triggers one sprint push instead of staying stuck or re-triggering');
  assert.equal(door.targetOpen, 1);
  assert.equal(door.open, 1);
  assert.equal(doorObstacle.active, false);
  assert.ok(player.x > 2.9, `expected sprinting player to burst through semi-open door into room, got x=${player.x}`);

  // Also works when left past 50% (e.g. open = 0.65, targetOpen = 0.65).
  door.open = 0.65;
  door.targetOpen = 0.65;
  door.slam = 0;
  door.bounce = 0;
  ctrl.update(0.016, { x: 0, y: 1.61, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, isSprinting: false }, true);
  assert.equal(doorObstacle.active, true);
  ctrl.update(0.016, {
    x: 1.85,
    y: 1.61,
    z: 0.15,
    yaw: -Math.PI / 2,
    pitch: 0,
    vx: 4.1,
    vz: 0,
    wishVx: 4.35,
    wishVz: 0,
    isSprinting: true
  }, true);
  assert.equal(door.targetOpen, 1);
  assert.equal(doorObstacle.active, false);
});

test('sprinting into an angled semi-open leaf pushes it open, while wall-hugging parallel sprint or back-side contact does not', () => {
  const hx = 2.323;
  const hz = -0.34;
  const leaf = 0.98;
  const leafObstacle = {
    kind: 'segment',
    ax: hx,
    az: hz,
    bx: hx,
    bz: hz + leaf,
    halfThick: 0.034,
    active: true
  };
  const door = makeDoorFixture({
    open: 0.78,
    targetOpen: 0.78,
    pivots: [{
      group: { rotation: { y: 0 } },
      hand: 1,
      maxAngle: 1.76,
      hx,
      hz,
      length: leaf,
      closedDirX: 0,
      closedDirZ: 1,
      swingDirX: 1,
      swingDirZ: 0,
      obstacle: leafObstacle
    }]
  });
  const ctrl = createDoorController({ doors: [door], audio: {} });

  // Running strictly parallel along the corridor wall right past the doorway does not slam it.
  ctrl.update(0.016, {
    x: 1.975,
    y: 1.61,
    z: 0.15,
    yaw: 0,
    pitch: 0,
    vx: 0,
    vz: -4.35,
    wishVx: 0,
    wishVz: -4.35,
    isSprinting: true
  }, true);
  assert.equal(door.targetOpen, 0.78, 'parallel corridor sprint does not falsely slam classroom door');

  // Running into the back side of the leaf from behind the hinge does not slam it open.
  ctrl.update(0.016, {
    x: 2.75,
    y: 1.61,
    z: -0.62,
    yaw: Math.PI,
    pitch: 0,
    vx: 0,
    vz: 4.35,
    wishVx: 0,
    wishVz: 4.35,
    isSprinting: true
  }, true);
  assert.equal(door.targetOpen, 0.78, 'contact on back of leaf does not falsely slam it open');

  // Running from the push side into the angled semi-open leaf slams it the rest of the way open.
  ctrl.update(0.016, {
    x: 2.65,
    y: 1.61,
    z: 0.08,
    yaw: -0.9,
    pitch: 0,
    vx: 2.2,
    vz: -3.6,
    wishVx: 2.2,
    wishVz: -3.6,
    isSprinting: true
  }, true);
  assert.equal(door.targetOpen, 1, 'pushing the front of a semi-open leaf while sprinting opens it fully');
});

test('sprinting off-center into semi-open annex double doors pushes them open, and [E] finishes opening a blocking semi-open door', () => {
  const farZ = -31.2;
  const annexDoor = makeDoorFixture({
    id: 'anexo',
    label: 'Puertas del Anexo',
    open: 0.50,
    targetOpen: 0.50,
    pos: { x: 0, y: 1.15, z: farZ },
    threshold: { x0: -1.01, x1: 1.01, z0: farZ - 0.26, z1: farZ + 0.16 },
    obstacle: { x0: -1.01, x1: 1.01, z0: farZ - 0.17, z1: farZ + 0.02, active: true },
    pivots: []
  });
  const ctrl = createDoorController({ doors: [annexDoor], audio: {} });

  // Before sprinting: semi-open door at 0.60 still blocks threshold, so [E] offers Abrir instead of Cerrar.
  annexDoor.open = 0.60;
  annexDoor.targetOpen = 0.60;
  const lookPose = { x: 0, y: 1.61, z: farZ + 1.2, yaw: 0, pitch: -0.35 };
  ctrl.update(0.016, lookPose, true);
  assert.match(ctrl.prompt, /Abrir Puertas del Anexo/);
  const res = ctrl.interact(lookPose);
  assert.equal(res.ok, true);
  assert.equal(res.open, true);

  // Reset to semi-open 0.50 and sprint straight into the right leaf at x = 0.75.
  annexDoor.open = 0.50;
  annexDoor.targetOpen = 0.50;
  annexDoor.slam = 0;
  ctrl.update(0.016, {
    x: 0.75,
    y: 1.61,
    z: farZ + 0.28,
    yaw: 0,
    pitch: 0,
    vx: 0,
    vz: -4.2,
    wishVx: 0,
    wishVz: -4.35,
    isSprinting: true
  }, true);
  assert.equal(annexDoor.targetOpen, 1, 'off-center sprint into semi-open double door pushes it open');
  assert.equal(annexDoor.obstacle.active, false);
});

test('doors open away from whichever side the player approaches, track negative-swing obstacles, and reset cleanly', () => {
  const leafObstacle = {
    kind: 'segment',
    ax: 2.31,
    az: -0.41,
    bx: 2.31,
    bz: 0.61,
    halfThick: 0.034,
    x0: 2.276,
    x1: 2.344,
    z0: -0.444,
    z1: 0.644,
    active: true
  };
  const door = makeDoorFixture({
    pivots: [{
      group: { rotation: { y: 0 } },
      hand: 1,
      maxAngle: 1.76,
      hx: 2.31,
      hz: -0.41,
      length: 1.02,
      closedDirX: 0,
      closedDirZ: 1,
      swingDirX: 1,
      swingDirZ: 0,
      obstacle: leafObstacle
    }]
  });
  const ctrl = createDoorController({ doors: [door], audio: {} });

  // From the corridor (-swingDir side), interacting swings +swingDir into the room.
  const corridorPose = { x: 1.15, y: 1.61, z: 0.15, yaw: -Math.PI / 2, pitch: -0.35 };
  ctrl.update(0.016, corridorPose, true);
  assert.equal(ctrl.interact(corridorPose).ok, true);
  for (let i = 0; i < 30; i++) ctrl.update(0.03, corridorPose, true);
  assert.equal(door.swingSign, 1);
  assert.equal(door.open, 1);
  assert.ok(door.pivots[0].group.rotation.y > 1.7);
  assert.ok(leafObstacle.bx > 3.1, `positive swing opens leaf into room (bx=${leafObstacle.bx})`);

  // Closing keeps positive swingSign and settles shut.
  assert.equal(ctrl.interact(corridorPose).ok, true);
  for (let i = 0; i < 30; i++) ctrl.update(0.03, corridorPose, true);
  assert.equal(door.open, 0);

  // From inside the room (+swingDir side), interacting swings -swingDir into the corridor!
  const roomPose = { x: 3.45, y: 1.61, z: 0.15, yaw: Math.PI / 2, pitch: -0.35 };
  ctrl.update(0.016, roomPose, true);
  const resRoom = ctrl.interact(roomPose);
  assert.equal(resRoom.ok, true);
  for (let i = 0; i < 30; i++) ctrl.update(0.03, roomPose, true);
  assert.equal(door.swingSign, -1);
  assert.equal(door.open, 1);
  assert.ok(Math.abs(door.pivots[0].group.rotation.y + 1.76) < 1e-6, 'negative swing rotates pivot negatively');
  assert.ok(leafObstacle.bx < 1.5, `negative swing opens leaf into corridor (bx=${leafObstacle.bx})`);

  // Looking at the open leaf out in the corridor targets it for [E] Cerrar.
  const openCorridorPose = { x: 1.80, y: 1.61, z: -0.20, yaw: Math.PI / 4, pitch: -0.25 };
  ctrl.update(0.016, openCorridorPose, true);
  assert.equal(ctrl.currentTarget?.kind, 'door');
  assert.match(ctrl.prompt, /Cerrar Sala 101/);

  // Closing from corridor keeps negative swingSign (no snapping across frame), then re-sprinting from room slams -1 again.
  assert.equal(ctrl.interact(openCorridorPose).ok, true);
  assert.equal(door.swingSign, -1);
  for (let i = 0; i < 30; i++) ctrl.update(0.03, openCorridorPose, true);
  assert.equal(door.open, 0);

  // Sprint-pushing into semi-open negative-swing leaf continues slamming it open toward -1.
  door.open = 0.45;
  door.targetOpen = 0.45;
  door.swingSign = -1;
  ctrl.update(0, roomPose, false);
  const midX = (leafObstacle.ax + leafObstacle.bx) * 0.5;
  const midZ = (leafObstacle.az + leafObstacle.bz) * 0.5;
  ctrl.update(0.016, {
    x: midX + 0.24,
    y: 1.61,
    z: midZ + 0.22,
    yaw: 0,
    pitch: 0,
    vx: -3.4,
    vz: -3.0,
    wishVx: -3.6,
    wishVz: -3.2,
    isSprinting: true
  }, true);
  assert.equal(door.targetOpen, 1, `semi-open negative leaf continues opening on sprint hit (bx=${leafObstacle.bx}, bz=${leafObstacle.bz})`);
  assert.equal(door.swingSign, -1);

  ctrl.reset();
  assert.equal(door.swingSign, 1);
  assert.equal(door.open, 0);
});

