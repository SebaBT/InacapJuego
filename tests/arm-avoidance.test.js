import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { Float32BufferAttribute, Group, Uint16BufferAttribute, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  applyStreetPassArmAvoidance,
  applySwitchArmAvoidance,
  createArmAvoidanceState,
  resetArmAvoidanceState,
  sweepCircle2D
} from '../src/arm-avoidance.js';
import { hall, worldBounds } from '../src/layout.js';
import {
  applyStreetPassPose,
  applySwitchPose,
  computePlayerBodyPlacement,
  stripSwitchNeckAndCapCollar
} from '../src/player-body-pose.js';

function makePose(overrides = {}) {
  return {
    x: 0,
    y: 1.61,
    z: 0,
    yaw: 0,
    bodyYaw: 0,
    pitch: 0,
    vx: 0,
    vz: 0,
    bobPhase: 0,
    breathPhase: 0,
    offsetX: 0,
    offsetY: 0,
    exertion: 0,
    isSprinting: false,
    crouchAmount: 0,
    thirdPerson: true,
    thirdPersonBlend: 1,
    jump: {
      height: 0,
      velY: 0,
      grounded: true,
      landTimer: 1,
      landDuration: 0,
      landedHeavy: false
    },
    active: true,
    noclip: false,
    ...overrides
  };
}

async function loadRig(style) {
  const buf = fs.readFileSync('assets/models/miiBodyM_' + style + '.glb');
  const { scene } = await new GLTFLoader().parseAsync(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    ''
  );
  const root = new Group();
  const holder = new Group();
  root.add(holder);
  holder.add(scene);
  const bones = {};
  scene.traverse(obj => {
    if (obj.isBone) bones[obj.name] = obj;
    if (obj.isMesh && style === 'switch' && obj.name === 'body_m') {
      stripSwitchNeckAndCapCollar(obj, { Float32BufferAttribute, Uint16BufferAttribute });
    }
  });
  const state = createArmAvoidanceState();
  function update(poseOverrides, { obstacles = [], bounds = worldBounds, dt = 0, reducedMotion = false, snap = false } = {}) {
    const pose = makePose(poseOverrides);
    const pl = computePlayerBodyPlacement(pose, style);
    root.position.set(pl.x, 0, pl.z);
    root.rotation.y = pl.rotationY;
    holder.position.y = pl.y;
    holder.scale.set(pl.scaleX, pl.scaleY, pl.scaleZ);
    root.updateMatrixWorld(true);
    if (style === 'streetpass') {
      applyStreetPassPose(bones, pose);
      if (obstacles || bounds) {
        applyStreetPassArmAvoidance(bones, pose, state, { dt, obstacles, bounds, reducedMotion, snap });
      }
    } else {
      applySwitchPose(bones, pose);
      if (obstacles || bounds) {
        applySwitchArmAvoidance(bones, pose, state, { dt, obstacles, bounds, reducedMotion, snap });
      }
    }
    root.updateMatrixWorld(true);
    return measureArmVertices(scene, style);
  }
  return { root, holder, scene, bones, state, update };
}

function measureArmVertices(scene, style) {
  const mesh = scene.getObjectByName(style === 'streetpass' ? 'hands_m' : 'body_m');
  const si = mesh.geometry.attributes.skinIndex;
  const sb = mesh.skeleton.bones;
  const v = new Vector3();
  const bounds = {
    L: { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity },
    R: { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity }
  };
  for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
    const bn = sb[si.getX(i)].name;
    let bucket = null;
    if (style === 'streetpass') {
      if (bn.includes('L')) bucket = bounds.L;
      else if (bn.includes('R')) bucket = bounds.R;
    } else if (bn === 'arm_l1' || bn === 'arm_l2' || bn === 'elbow_l' || bn === 'wrist_l') {
      bucket = bounds.L;
    } else if (bn === 'arm_r1' || bn === 'arm_r2' || bn === 'elbow_r' || bn === 'wrist_r') {
      bucket = bounds.R;
    }
    if (!bucket) continue;
    mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
    bucket.minX = Math.min(bucket.minX, v.x);
    bucket.maxX = Math.max(bucket.maxX, v.x);
    bucket.minY = Math.min(bucket.minY, v.y);
    bucket.maxY = Math.max(bucket.maxY, v.y);
    bucket.minZ = Math.min(bucket.minZ, v.z);
    bucket.maxZ = Math.max(bucket.maxZ, v.z);
  }
  return bounds;
}

const leftWall = { x0: -hall.halfWidth - 0.17, x1: -hall.halfWidth, z0: -30, z1: 26 };
const rightWall = { x0: hall.halfWidth, x1: hall.halfWidth + 0.17, z0: -30, z1: 26 };
const frontWall = { x0: -hall.halfWidth, x1: hall.halfWidth, z0: -10.17, z1: -10 };
const backWall = { x0: -hall.halfWidth, x1: hall.halfWidth, z0: 10, z1: 10.17 };

test('sweepCircle2D detects rounded AABBs, segment door leaves, and respects obstacle height and active flags', () => {
  const wall = { x0: -1.17, x1: -1.0, z0: -5, z1: 5 };
  const hitWall = sweepCircle2D(0, 0, -2, 0, 0.6, 0.15, [wall], null, 0);
  assert.equal(hitWall.hit, true);
  assert.ok(Math.abs(hitWall.t - 0.425) < 1e-4, `expected hit at -0.85 (t=0.425), got ${hitWall.t}`);
  assert.ok(hitWall.nx > 0.99 && Math.abs(hitWall.nz) < 1e-4);

  // Overhead lintel above hand height and inactive obstacle are ignored
  const lintel = { x0: -1.17, x1: -1.0, z0: -5, z1: 5, bottom: 2.2, top: 3.1 };
  const inactive = { x0: -1.17, x1: -1.0, z0: -5, z1: 5, active: false };
  const stepUnderFoot = { x0: -1.17, x1: -1.0, z0: -5, z1: 5, top: 0.18, step: true };
  assert.equal(sweepCircle2D(0, 0, -2, 0, 0.6, 0.15, [lintel, inactive, stepUnderFoot], null, 0).hit, false);

  // Angled door leaf segment stops swept circle cleanly on the near side
  const leaf = { kind: 'segment', ax: -0.6, az: -1, bx: -0.6, bz: 1, halfThick: 0.034, active: true };
  const hitLeaf = sweepCircle2D(0, 0, -1, 0, 0.6, 0.15, [leaf], null, 0);
  assert.equal(hitLeaf.hit, true);
  assert.ok(Math.abs(hitLeaf.t - (0.6 - 0.184)) < 1e-3);
  assert.ok(hitLeaf.nx > 0.99);
});

test('both Mii styles leave arms untouched in open corridor and prevent clipping along left/right walls, crouch, and sprint', async () => {
  for (const style of ['streetpass', 'switch']) {
    const rig = await loadRig(style);
    const openNoObs = rig.update({ x: 0, z: 0 }, { obstacles: null, bounds: null });
    resetArmAvoidanceState(rig.state);
    const openWithWalls = rig.update({ x: 0, z: 0 }, { obstacles: [leftWall, rightWall] });
    assert.ok(Math.abs(openWithWalls.L.minX - openNoObs.L.minX) < 1e-4, `${style} left arm unchanged in open space`);
    assert.ok(Math.abs(openWithWalls.R.maxX - openNoObs.R.maxX) < 1e-4, `${style} right arm unchanged in open space`);

    // Flush against left wall (x = -3.60, player center at -3.355)
    resetArmAvoidanceState(rig.state);
    const leftFlush = rig.update({ x: -hall.halfWidth + 0.245, z: 0 }, { obstacles: [leftWall, rightWall] });
    assert.ok(leftFlush.L.minX > -hall.halfWidth + 0.015, `${style} left arm clears left wall (${leftFlush.L.minX})`);
    assert.ok(Math.abs((leftFlush.R.maxX - (-hall.halfWidth + 0.245)) - openNoObs.R.maxX) < 1e-3, `${style} free right arm stays natural`);

    // Flush against right wall (x = +3.60, player center at +3.355)
    resetArmAvoidanceState(rig.state);
    const rightFlush = rig.update({ x: hall.halfWidth - 0.245, z: 0 }, { obstacles: [leftWall, rightWall] });
    assert.ok(rightFlush.R.maxX < hall.halfWidth - 0.015, `${style} right arm clears right wall (${rightFlush.R.maxX})`);

    // Crouched against left wall
    resetArmAvoidanceState(rig.state);
    const crouched = rig.update({ x: -hall.halfWidth + 0.245, z: 0, crouchAmount: 1 }, { obstacles: [leftWall, rightWall] });
    assert.ok(crouched.L.minX > -hall.halfWidth + 0.015, `${style} crouched left arm clears left wall`);

    // Full sprint stride cycle pressed against left wall stays clear and never flips sides on StreetPass
    resetArmAvoidanceState(rig.state);
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i <= 32; i++) {
      const m = rig.update(
        { x: -hall.halfWidth + 0.245, z: 0, vz: -4.2, isSprinting: true, bobPhase: (i / 32) * Math.PI * 2 },
        { obstacles: [leftWall, rightWall], dt: 1 / 60 }
      );
      assert.ok(m.L.minX > -hall.halfWidth + 0.015, `${style} sprint step ${i} clears left wall (${m.L.minX})`);
      minZ = Math.min(minZ, m.L.minZ);
      maxZ = Math.max(maxZ, m.L.maxZ);
    }
    if (style === 'streetpass') {
      assert.ok(minZ > 0.15 && maxZ < 0.60, `StreetPass tucked hand stays consistently behind left hip without flipping or overshoot ([${minZ}, ${maxZ}])`);
    }
  }
});

test('both Mii styles prevent clipping in corners, narrow doorways, swinging door leaves, benches, and full 360 spins', async () => {
  const doorway = [
    { x0: 3.6, x1: 3.77, z0: 10, z1: 19.44 },
    { x0: 3.6, x1: 3.77, z0: 20.56, z1: 26 }
  ];
  const openLeaf = { kind: 'segment', ax: -3.2, az: 0, bx: -3.2, bz: -1.0, halfThick: 0.034, active: true };
  const benchBack = { x0: -hall.halfWidth, x1: -hall.halfWidth + 0.14, z0: 15, z1: 16.84, top: 0.78 };
  const benchSeat = { x0: -hall.halfWidth + 0.14, x1: -hall.halfWidth + 0.54, z0: 15, z1: 16.84, top: 0.48 };

  for (const style of ['streetpass', 'switch']) {
    const rig = await loadRig(style);

    // Front-left corner
    resetArmAvoidanceState(rig.state);
    const fl = rig.update({ x: -hall.halfWidth + 0.245, z: -10 + 0.245 }, { obstacles: [leftWall, frontWall] });
    assert.ok(fl.L.minX > -hall.halfWidth + 0.015, `${style} front-left corner clears left wall`);
    assert.ok(fl.L.minZ > -10 + 0.015, `${style} front-left corner clears front wall`);

    // Back-left corner (back wall forces StreetPass hand to wrap cleanly to front side instead)
    resetArmAvoidanceState(rig.state);
    const bl = rig.update({ x: -hall.halfWidth + 0.245, z: 10 - 0.245 }, { obstacles: [leftWall, backWall] });
    assert.ok(bl.L.minX > -hall.halfWidth + 0.015, `${style} back-left corner clears left wall`);
    assert.ok(bl.L.maxZ < 10 - 0.015, `${style} back-left corner clears back wall`);

    // Classroom doorway (walls on both sides)
    resetArmAvoidanceState(rig.state);
    const doorPass = rig.update({ x: 3.68, z: 20.0, yaw: -Math.PI / 2, bodyYaw: -Math.PI / 2 }, { obstacles: doorway });
    assert.ok(doorPass.L.minZ > 19.44 + 0.015, `${style} doorway clears north jamb`);
    assert.ok(doorPass.R.maxZ < 20.56 - 0.015, `${style} doorway clears south jamb`);

    // Swinging door leaf segment on the left
    resetArmAvoidanceState(rig.state);
    const leafPass = rig.update({ x: -2.92, z: -0.5 }, { obstacles: [openLeaf] });
    assert.ok(leafPass.L.minX > -3.2 + 0.034 + 0.015, `${style} clears swinging door leaf`);

    // Hallway bench on the left (low top: 0.48 / 0.78)
    resetArmAvoidanceState(rig.state);
    const benchPass = rig.update({ x: -hall.halfWidth + 0.54 + 0.245, z: 15.9 }, { obstacles: [leftWall, benchBack, benchSeat] });
    assert.ok(benchPass.L.minX > -hall.halfWidth + 0.54 + 0.01, `${style} clears hallway bench`);

    // Full 360-degree spin pressed flush against left wall
    resetArmAvoidanceState(rig.state);
    for (let i = 0; i <= 72; i++) {
      const yaw = (i / 72) * Math.PI * 2;
      const m = rig.update(
        { x: -hall.halfWidth + 0.245, z: 0, yaw, bodyYaw: yaw },
        { obstacles: [leftWall, rightWall], dt: 1 / 60 }
      );
      assert.ok(m.L.minX > -hall.halfWidth + 0.015 && m.R.minX > -hall.halfWidth + 0.015, `${style} angle ${i} clears wall`);
    }
  }
});

test('arm avoidance eases smoothly when approaching and leaving a wall without clipping, and yields to door handle grabbing', async () => {
  for (const style of ['streetpass', 'switch']) {
    const rig = await loadRig(style);
    const open = rig.update({ x: -2.2, z: 0 }, { obstacles: [leftWall], dt: 0 });

    // Rapid approach to left wall at 60fps: never penetrates wall on any frame
    for (let i = 1; i <= 30; i++) {
      const x = -2.2 - (i / 30) * (hall.halfWidth - 0.245 - 2.2);
      const m = rig.update({ x, z: 0, vx: -4.0 }, { obstacles: [leftWall], dt: 1 / 60 });
      assert.ok(m.L.minX > -hall.halfWidth + 0.015, `${style} approach frame ${i} never clips wall`);
    }

    // Step away to open space: first frame begins easing smoothly (doesn't snap instantly), settles back after ~0.8s
    const firstRetreat = rig.update({ x: -2.0, z: 0 }, { obstacles: [leftWall], dt: 1 / 60 });
    const nominalLeftX = open.L.minX + 0.2;
    assert.ok(firstRetreat.L.minX > nominalLeftX + 0.02, `${style} arm eases smoothly back out instead of snapping`);
    let settled = firstRetreat;
    for (let i = 0; i < 60; i++) {
      settled = rig.update({ x: -2.0, z: 0 }, { obstacles: [leftWall], dt: 1 / 60 });
    }
    assert.ok(Math.abs(settled.L.minX - nominalLeftX) < 0.01, `${style} arm returns cleanly to resting pose`);

    // Door handle grab on the right still reaches handle while left hand avoids an adjacent left wall
    resetArmAvoidanceState(rig.state);
    const playerX = -hall.halfWidth + 0.245;
    const handlePos = { x: playerX + 0.22, y: 1.05, z: -0.55 };
    const grabPose = {
      x: playerX,
      z: 0,
      yaw: 0,
      bodyYaw: 0,
      thirdPerson: false,
      thirdPersonBlend: 0,
      doorInteraction: {
        kind: 'grab',
        opening: true,
        progress: 0.35,
        intensity: 1,
        slamSide: 1,
        startSide: -1,
        handlePos
      }
    };
    const mGrab = rig.update(grabPose, { obstacles: [leftWall], dt: 0 });
    assert.ok(mGrab.L.minX > -hall.halfWidth + 0.015, `${style} free left arm avoids left wall during right-hand door grab`);
    const target = new Vector3(handlePos.x, handlePos.y, handlePos.z);
    if (style === 'streetpass') {
      const spHand = rig.bones.handRPs.getWorldPosition(new Vector3());
      assert.ok(spHand.distanceTo(target) < 0.06, 'StreetPass grabbing hand still locks onto door handle');
    } else {
      const wristWorld = rig.bones.wrist_r.getWorldPosition(new Vector3());
      const arm2World = rig.bones.arm_r2.getWorldPosition(new Vector3());
      const palmWorld = wristWorld.clone().addScaledVector(wristWorld.clone().sub(arm2World).normalize(), 3.5 * (1 / 7) * 0.118);
      assert.ok(palmWorld.distanceTo(target) < 0.06, 'Switch grabbing palm still locks onto door handle');
    }
  }
});
