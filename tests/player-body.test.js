import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { Box3, Float32BufferAttribute, Group, Uint16BufferAttribute, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createCameraMotionState, stepCameraMotion } from '../src/player-motion.js';
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
    z: 2,
    yaw: 0,
    pitch: -1.1,
    vx: 0,
    vz: 0,
    bobPhase: 0,
    breathPhase: 0,
    offsetX: 0,
    offsetY: 0,
    strafeRoll: 0,
    exertion: 0,
    isSprinting: false,
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

test('computePlayerBodyPlacement hides body when hidden, noclip, inspecting, or not started', () => {
  const pose = makePose();
  assert.equal(computePlayerBodyPlacement(pose, 'streetpass').visible, true);
  assert.equal(computePlayerBodyPlacement(pose, 'hidden').visible, false);
  assert.equal(computePlayerBodyPlacement(makePose({ noclip: true }), 'streetpass').visible, false);
  assert.equal(computePlayerBodyPlacement(pose, 'streetpass', { inspecting: true }).visible, false);
  assert.equal(computePlayerBodyPlacement(pose, 'streetpass', { hasStarted: false }).visible, false);
});

test('computePlayerBodyPlacement places slim body behind heading and lifts on jump', () => {
  const pose = makePose({ x: 1, z: 3, yaw: 0, jump: { height: 0.42, grounded: false } });
  const p = computePlayerBodyPlacement(pose, 'switch');
  assert.equal(p.visible, true);
  assert.ok(p.z > 3, 'When facing -Z (yaw=0), backward offset moves body to +Z');
  assert.ok(Math.abs(p.y - 0.42) < 1e-6);
  assert.ok(Math.abs(p.rotationY - Math.PI) < 1e-6);
  assert.ok(p.scaleX < p.scaleY && p.scaleZ < p.scaleY, 'Slimmer horizontal proportions');
});

test('StreetPass and Switch GLB models parse, expose expected skeleton bones, and strip Switch neck tube', async () => {
  const loader = new GLTFLoader();
  for (const [file, expectedBones] of [
    ['assets/models/miiBodyM_streetpass.glb', ['bodyPs', 'body_scalePs', 'handLPs', 'handRPs']],
    ['assets/models/miiBodyM_switch.glb', ['skl_root', 'chest', 'hip', 'arm_l1', 'arm_l2', 'arm_r1', 'arm_r2', 'foot_l1', 'foot_l2', 'ankle_l', 'foot_r1', 'foot_r2', 'ankle_r']]
  ]) {
    const buf = fs.readFileSync(file);
    const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
    const boneMap = {};
    gltf.scene.traverse(o => { if (o.isBone) boneMap[o.name] = o; });
    for (const name of expectedBones) {
      assert.ok(boneMap[name], `Missing bone ${name} in ${file}`);
    }
    if (file.includes('switch')) {
      const body = gltf.scene.getObjectByName('body_m');
      const centerIdx = stripSwitchNeckAndCapCollar(body, { Float32BufferAttribute, Uint16BufferAttribute });
      assert.ok(centerIdx > 0, 'Collar cap vertex created');
      const si = body.geometry.attributes.skinIndex;
      const idx = body.geometry.index;
      const headVerts = new Set();
      for (let i = 0; i < si.count; i++) {
        if (body.skeleton.bones[si.getX(i)]?.name === 'head') headVerts.add(i);
      }
      for (let i = 0; i < idx.count; i++) {
        assert.equal(headVerts.has(idx.getX(i)), false, 'No triangle should reference head neck vertices');
      }
    }
  }
});

async function loadPlayerRig(style) {
  const buf = fs.readFileSync('assets/models/miiBodyM_' + style + '.glb');
  const { scene } = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const root = new Group(), holder = new Group(), bones = {};
  root.add(holder);
  holder.add(scene);
  scene.traverse(obj => { if (obj.isBone) bones[obj.name] = obj; });
  if (style === 'switch') {
    stripSwitchNeckAndCapCollar(scene.getObjectByName('body_m'), { Float32BufferAttribute, Uint16BufferAttribute });
  }
  const apply = style === 'switch' ? applySwitchPose : applyStreetPassPose;
  function update(pose) {
    const p = computePlayerBodyPlacement(pose, style);
    root.position.set(p.x, 0, p.z);
    root.rotation.y = p.rotationY;
    holder.position.y = p.y;
    holder.scale.set(p.scaleX, p.scaleY, p.scaleZ);
    root.updateMatrixWorld(true);
    apply(bones, pose);
    root.updateMatrixWorld(true);
  }
  return { scene, bones, update };
}

function renderedBounds(mesh) {
  const box = new Box3(), vertex = new Vector3();
  for (const i of new Set(mesh.geometry.index.array)) {
    box.expandByPoint(mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld));
  }
  return box;
}

test('both Mii rigs lower their torso and hands, keep foot support, and clear the eye during jumps and heavy landings', async () => {
  const floor = 0.48;
  for (const style of ['streetpass', 'switch']) {
    const { scene, bones, update } = await loadPlayerRig(style);
    const hand = style === 'switch' ? bones.wrist_r : bones.handRPs;
    function sample(crouchAmount, jumpOverrides = {}) {
      const pose = makePose({ crouchAmount });
      Object.assign(pose.jump, { height: floor }, jumpOverrides);
      update(pose);
      const motion = createCameraMotionState();
      motion.crouchAmount = crouchAmount;
      stepCameraMotion(motion, { dt: 0, jump: pose.jump, isCrouching: crouchAmount === 1 });
      const top = renderedBounds(scene.getObjectByName('body_m')).max.y;
      assert.ok(pose.y + motion.offsetY - top > 0.045, style + ' collar clears the near plane');
      return { top, foot: renderedBounds(scene.getObjectByName('legs_m')).min.y, hand: hand.getWorldPosition(new Vector3()).y };
    }
    const standing = sample(0), halfway = sample(0.5), crouched = sample(1);
    assert.ok(crouched.top < halfway.top && halfway.top < standing.top);
    assert.ok(crouched.top < standing.top - 0.2 && crouched.hand < standing.hand - 0.15);
    assert.ok(crouched.foot >= floor - 0.005 && Math.abs(crouched.foot - standing.foot) < 0.05);
    const flying = sample(1, { height: floor + 0.7, grounded: false, velY: 0 });
    assert.ok(flying.foot >= floor + 0.69);
    sample(1, { landedHeavy: true, landTimer: 0.12, landDuration: 1.45, stumbleCooldown: 2.68 });
    assert.deepEqual(sample(0), standing, style + ' restores its original standing pose');
  }
});

function makeSwitchBones() {
  return {
    skl_root: new Group(),
    chest: new Group(),
    hip: new Group(),
    arm_l1: new Group(),
    arm_l2: new Group(),
    arm_r1: new Group(),
    arm_r2: new Group(),
    foot_l1: new Group(),
    foot_l2: new Group(),
    ankle_l: new Group(),
    foot_r1: new Group(),
    foot_r2: new Group(),
    ankle_r: new Group()
  };
}

test('applyStreetPassPose and applySwitchPose drive opposite-phase gait cleanly', () => {
  const spBones = {
    bodyPs: new Group(),
    body_scalePs: new Group(),
    handLPs: new Group(),
    handRPs: new Group()
  };
  applyStreetPassPose(spBones, makePose({ vz: -2.4, bobPhase: Math.PI / 2 }));
  assert.ok(spBones.handLPs.position.z > spBones.handRPs.position.z);

  const swBones = makeSwitchBones();
  applySwitchPose(swBones, makePose({ vz: -4.2, isSprinting: true, bobPhase: Math.PI / 2 }));
  assert.ok(swBones.foot_l1.rotation.x < 0, 'Left thigh swings forward (+Z) at bobPhase=PI/2');
  assert.ok(swBones.foot_r1.rotation.x > 0, 'Right thigh swings backward (-Z) at bobPhase=PI/2');
  assert.ok(swBones.arm_l1.rotation.x > 0 && swBones.arm_r1.rotation.x < 0, 'Arms swing opposite to legs');

  // Mid-swing bends the swinging knee noticeably more than the planted stance knee
  applySwitchPose(swBones, makePose({ vz: -2.45, bobPhase: 0 }));
  assert.ok(swBones.foot_l2.rotation.x > swBones.foot_r2.rotation.x + 0.4);
});

test('applySwitchPose adapts leg mechanics to backward walking, strafing, jumps, and heavy stumbles', () => {
  const swBones = makeSwitchBones();

  // Backward walking reverses sagittal stride direction
  applySwitchPose(swBones, makePose({ vz: 2.45, bobPhase: Math.PI / 2 }));
  assert.ok(swBones.foot_l1.rotation.x > 0, 'Backward walk reaches left leg behind at bobPhase=PI/2');
  assert.ok(swBones.foot_r1.rotation.x < 0, 'Backward walk leaves right leg forward at bobPhase=PI/2');

  // Lateral strafing abducts outward and lifts recovering knee; diagonal movement steers thigh yaw
  applySwitchPose(swBones, makePose({ vx: 2.45, vz: 0, bobPhase: 0 }));
  assert.ok(swBones.foot_l1.rotation.z > 0.10, 'Left leg abducts during strafe cycle');
  assert.ok(swBones.foot_l2.rotation.x > 0.35, 'Recovering knee bends during lateral strafe');

  applySwitchPose(swBones, makePose({ vx: 1.7, vz: -1.7, bobPhase: Math.PI / 2 }));
  assert.ok(swBones.foot_l1.rotation.y < -0.2, 'Diagonal forward-right movement steers leg stride yaw');

  // Jump rise tucks lead knee higher than descent brace
  applySwitchPose(swBones, makePose({ jump: { height: 0.35, velY: 4.5, grounded: false, landSide: -1 } }));
  const riseKnee = swBones.foot_l2.rotation.x;
  applySwitchPose(swBones, makePose({ jump: { height: 0.35, velY: -4.0, grounded: false, landSide: -1 } }));
  const fallKnee = swBones.foot_l2.rotation.x;
  assert.ok(riseKnee > fallKnee, 'Rising jump tucks lead knee deeper than descent brace');

  // Heavy low-stamina landing staggers legs asymmetrically and lowers pelvis kinematically
  applySwitchPose(swBones, makePose({
    jump: { height: 0, velY: 0, grounded: true, landedHeavy: true, landTimer: 0.25, landDuration: 1.45, landSide: 1, stumbleCooldown: 2.5 }
  }));
  assert.ok(swBones.foot_r1.rotation.x < -0.25 && swBones.foot_r2.rotation.x > 0.7, 'Right leg braces forward on stumble');
  assert.ok(swBones.skl_root.position.y < 46.5, 'Pelvis drops kinematically so braced shoe stays grounded');
});

test('door grab IK tracks moving door handle with Switch and StreetPass bodies, and sprint slams door shoulder-first', async () => {
  const { createDoorController } = await import('../src/doors.js');
  const sw = await loadPlayerRig('switch'), sp = await loadPlayerRig('streetpass');
  const bones = sw.bones;

  const handlePos = { x: 0.22, y: 1.05, z: 1.45 };
  const pose = makePose({
    x: 0,
    z: 2.0,
    yaw: 0,
    doorInteraction: {
      kind: 'grab',
      opening: true,
      progress: 0.35,
      intensity: 1,
      slamSide: 1,
      handlePos
    }
  });
  const target = new Vector3(handlePos.x, handlePos.y, handlePos.z);
  for (const crouchAmount of [0, 0.5, 1, 0]) {
    sw.update({ ...pose, crouchAmount });
    const wristWorld = bones.wrist_r.getWorldPosition(new Vector3());
    const arm2World = bones.arm_r2.getWorldPosition(new Vector3());
    const handDir = wristWorld.clone().sub(arm2World).normalize();
    const palmWorld = wristWorld.clone().addScaledVector(handDir, 3.5 * (1 / 7) * 0.118);
    assert.ok(palmWorld.distanceTo(target) < 0.06, 'Switch palm follows the handle while changing stance');
    assert.ok(bones.chest.rotation.x > 0.08 && bones.chest.rotation.y < -0.1, 'Torso leans and turns toward moving handle');
    sp.update({ ...pose, crouchAmount });
    const spHandWorld = sp.bones.handRPs.getWorldPosition(new Vector3());
    assert.ok(spHandWorld.distanceTo(target) < 0.06, 'StreetPass hand follows the handle while changing stance');
  }

  // Sprint body slam twists lead shoulder forward and clears door obstacle rapidly
  const slamPose = makePose({
    vz: -4.2,
    isSprinting: true,
    bobPhase: Math.PI / 2,
    doorInteraction: { kind: 'slam', opening: true, progress: 0.22, intensity: 1, slamSide: 1 }
  });
  applySwitchPose(bones, slamPose);
  assert.ok(bones.chest.rotation.y > 0.35 && bones.chest.rotation.x > 0.20, 'Shoulder slam twists and drives torso into door');

  // Door controller triggers slam when sprinting into a closed door
  const pivotGroup = { rotation: { y: 0 }, updateMatrixWorld() {} };
  const leverGroup = { rotation: { z: 0 } };
  const obstacle = { x0: 2.22, x1: 2.39, z0: -0.41, z1: 0.71, active: true };
  const door = {
    id: '101',
    label: 'Sala 101',
    locked: false,
    open: 0,
    targetOpen: 0,
    rattle: 0,
    slam: 0,
    bounce: 0,
    pos: { x: 2.31, y: 1.15, z: 0.15 },
    threshold: { x0: 2.08, x1: 2.53, z0: -0.41, z1: 0.71 },
    pivots: [{ group: pivotGroup, hand: 1, maxAngle: 1.76 }],
    leverPivots: [{ group: leverGroup, hand: 1 }],
    handles: [{ x: 2.20, y: 1.05, z: 0.55 }],
    obstacle
  };
  let slamSounds = 0;
  const ctrl = createDoorController({ doors: [door], audio: { playSlam: () => { slamSounds++; } } });
  const sprintApproach = makePose({ x: 1.85, z: 0.15, vx: 4.1, vz: 0, yaw: -Math.PI / 2, isSprinting: true });
  ctrl.update(0.03, sprintApproach, true);
  assert.equal(door.targetOpen, 1);
  assert.equal(slamSounds, 1);
  assert.equal(ctrl.consumeSlam()?.side !== undefined, true);
  assert.equal(ctrl.getInteractionState(sprintApproach)?.kind, 'slam');
  ctrl.update(0.04, sprintApproach, true);
  assert.equal(obstacle.active, false, 'Slammed door drops collision quickly so sprinting player bursts through');
});

test('auto-grabs knob on approach, waits until advancing, preserves dominant right hand, pushes on click, and releases on retreat', async () => {
  const { createDoorController } = await import('../src/doors.js');
  const { Vector3 } = await import('three');
  const loader = new GLTFLoader();
  const buf = fs.readFileSync('assets/models/miiBodyM_switch.glb');
  const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');

  const rigRoot = new Group();
  const rigHolder = new Group();
  rigRoot.add(rigHolder);
  rigHolder.add(gltf.scene);
  const bones = {};
  gltf.scene.traverse(o => { if (o.isBone) bones[o.name] = o; });

  const hingePivot = new Group();
  hingePivot.position.set(0.45, 0, 1.45);
  const handleAnchor = new Group();
  handleAnchor.position.set(-0.65, 1.05, 0);
  hingePivot.add(handleAnchor);
  hingePivot.updateMatrixWorld(true);

  const door = {
    id: '101',
    label: 'Sala 101',
    locked: false,
    open: 0,
    targetOpen: 0,
    rattle: 0,
    slam: 0,
    bounce: 0,
    pos: { x: 0, y: 1.15, z: 1.45 },
    pivots: [{ group: hingePivot, hand: -1, maxAngle: 1.76 }],
    handles: [handleAnchor],
    obstacle: { x0: -0.5, x1: 0.5, z0: 1.38, z1: 1.52, active: true }
  };

  const ctrl = createDoorController({ doors: [door], audio: {} });

  // 1. Walking close while looking at the door auto-grabs the knob without swinging the door yet
  const stillPose = makePose({ x: 0, z: 2.02, vx: 0, vz: 0, wishVx: 0, wishVz: 0, yaw: 0, pitch: -0.25 });
  ctrl.update(0.016, stillPose, true);
  let di = ctrl.getInteractionState(stillPose);
  assert.equal(di?.kind, 'grab', 'Auto-grabs knob when approaching while looking');
  assert.equal(di.startSide, -1, 'Selects dominant right hand');
  assert.equal(di.autoPush, false);

  // Standing still waits with the door closed under the player's hand
  for (let i = 0; i < 6; i++) ctrl.update(0.03, stillPose, true);
  assert.equal(door.open, 0, 'Door waits for player to advance or click instead of opening on its own');

  // 2. Advancing drives the door open while keeping the dominant right palm locked onto the knob
  const advancePose = makePose({ x: 0, z: 2.02, vx: 0, vz: -1.8, wishVx: 0, wishVz: -2.2, yaw: 0, pitch: -0.25 });
  for (let i = 0; i < 16; i++) {
    advancePose.z -= 0.050;
    ctrl.update(0.03, advancePose, true);
  }
  di = ctrl.getInteractionState(advancePose);
  assert.ok(door.open > 0.8, `Advancing opens door smoothly, got ${door.open}`);
  assert.ok(di && di.kind === 'grab' && !di.releasing && di.intensity > 0.7, 'Keeps holding knob while advancing');

  const plLate = computePlayerBodyPlacement(advancePose, 'switch');
  rigRoot.position.set(plLate.x, 0, plLate.z);
  rigRoot.rotation.y = plLate.rotationY;
  rigHolder.position.y = plLate.y;
  rigHolder.scale.set(plLate.scaleX, plLate.scaleY, plLate.scaleZ);
  rigRoot.updateMatrixWorld(true);
  applySwitchPose(bones, { ...advancePose, doorInteraction: di });
  rigRoot.updateMatrixWorld(true);
  const rWrist = bones.wrist_r.getWorldPosition(new Vector3());
  const rArm2 = bones.arm_r2.getWorldPosition(new Vector3());
  const rPalm = rWrist.clone().addScaledVector(rWrist.clone().sub(rArm2).normalize(), 3.5 * (1 / 7) * 0.118);
  assert.ok(rPalm.distanceTo(new Vector3(di.handlePos.x, di.handlePos.y, di.handlePos.z)) < 0.06, 'Dominant right palm stays locked on handle without switching hands');

  // 3. Backing away releases the knob cleanly
  const retreatPose = makePose({ x: advancePose.x, z: advancePose.z, vx: 0, vz: 1.4, wishVx: 0, wishVz: 1.8, yaw: 0 });
  ctrl.update(0.05, retreatPose, true);
  di = ctrl.getInteractionState(retreatPose);
  assert.equal(di?.releasing, true, 'Retreating triggers knob release');
  for (let i = 0; i < 6; i++) ctrl.update(0.05, retreatPose, true);
  assert.equal(ctrl.getInteractionState(retreatPose), null, 'Knob is fully released after retreating');

  // 4. Clicking while standing still triggers a forward push shove gesture
  door.open = 0;
  door.targetOpen = 0;
  for (let i = 0; i < 15; i++) ctrl.update(0.05, stillPose, true); // let retreatCooldown expire
  const clickRes = ctrl.interact(stillPose);
  assert.equal(clickRes.ok, true);
  ctrl.update(0.12, stillPose, true);
  const pushDi = ctrl.getInteractionState(stillPose);
  assert.equal(pushDi?.autoPush, true);
  assert.ok(pushDi.pushPulse > 0.4, 'Click in front of door drives forward push gesture');
  applySwitchPose(bones, { ...stillPose, doorInteraction: pushDi });
  assert.ok(bones.chest.rotation.x > 0.25, 'Push gesture leans torso forward into the door');
});
