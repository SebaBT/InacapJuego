import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { PerspectiveCamera, Raycaster, ShaderMaterial, Vector3 } from 'three';
import { createAtmosphere } from '../src/atmosphere.js';
import { buildCorridor } from '../src/corridor.js';
import { generateDebrisPlacements } from '../src/debris.js';
import { createDoorController } from '../src/doors.js';
import {
  annex, benchZ, extraLights, furnishingBays, hall, hallClearHalfWidth, hallWindows, landing,
  lights, lightX, pairedFixtureOffset, plaza, plazaLights, returnAisleWidth, rooms, stairs, worldBounds
} from '../src/layout.js';
import { computeEscalation } from '../src/game-state.js';
import { makeMascot } from '../src/mascot.js';
import { capturePose, createMonsterHunt } from '../src/monster-hunt.js';
import { createMonsterNavigation } from '../src/monster-navigation.js';
import { createCaptureShot } from '../src/monster-capture.js';
import {
  createJumpState,
  createStaminaState,
  PLAYER_STAND_HEIGHT,
  SPRINT_SPEED,
  stepJump
} from '../src/player-motion.js';
import { castCameraRay } from '../src/third-person.js';
import { ceilingHeight, movePlayer, supportHeight } from '../src/walk.js';

let map, obstacles, floors, mascot;
before(() => {
  // Node has no Canvas2D. Only pixel painting is stubbed: the scene, batched
  // meshes, furniture, moving door leaves and mascot collision boxes are real.
  const noop = () => {};
  const gradient = () => ({ addColorStop: noop });
  const ctx = new Proxy({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createLinearGradient: gradient, createRadialGradient: gradient
  }, { get: (target, key) => target[key] ?? noop });
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ctx }) };
  try {
    function material(texture, options = {}) {
      const m = new ShaderMaterial();
      m.userData = { ...options, repeatMeters: options.repeat };
      return m;
    }
    map = buildCorridor(material);
    mascot = makeMascot(material);
    obstacles = [...map.obstacles, ...mascot.collisions.map(({ min, max }) => ({
      x0: min.x, x1: max.x, z0: min.z, z1: max.z
    }))];
    floors = map.scene.children.filter(m => m.material?.userData.floor);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test('Mothy opens all real passages, folds on the way in and out, and climbs the annex stairs', () => {
  const absent = { active: true, x: 80, z: 23, cameraY: 1.61, noiseRadius: 0 };
  const step = .06;
  for (const r of [...rooms, annex]) {
    const door = map.doors.find(d => d.id === r.id);
    door.open = door.targetOpen = 0;
    const ctrl = createDoorController({ doors: map.doors, audio: {} });
    const nx = r.id === '107' ? -1 : (r.side || 0), nz = r === annex ? -1 : 0;
    const start = { x: door.pos.x - nx * 2.3, z: door.pos.z - nz * 2.3, yaw: Math.atan2(nx, nz) };
    const dest = r === annex
      ? { x: (stairs.x0 + stairs.x1) / 2, z: landing.z1 - .85 }
      : r.id === '107'
        ? { x: (r.x0 + r.x1) / 2 + 1.1, z: r.doorZ - 1.5 }
        : { x: (r.x0 + r.x1) / 2, z: r.doorZ + 2.5 };
    const hunt = createMonsterHunt({ obstacles: map.obstacles, doors: map.doors, holdDoor: ctrl.holdForMonster,
      spawn: start, patrolPoints: [dest, start] });
    let entered = false, returned = false, oldSide = -1, crossings = 0, lastY = 0;
    const heights = new Set();
    for (let i = 0; i < 1600 && !returned; i++) {
      ctrl.update(step, null, false);
      const s = hunt.update(step, absent);
      const offset = (s.x - door.pos.x) * nx + (s.z - door.pos.z) * nz;
      const side = Math.sign(offset);
      if (side !== oldSide) { crossings++; oldSide = side; }
      if (Math.abs(offset) < .6) {
        assert.equal(s.fold, 1, r.id + ' crossed without folding');
        assert.ok(door.open >= .985 && !door.obstacle.active, r.id + ' crossed a shut door');
      }
      assert.ok(Math.abs(s.y - lastY) <= stairs.rise + .0001, 'skipped a tread');
      lastY = s.y; heights.add(Math.round(s.y / stairs.rise));
      if (Math.hypot(s.x - dest.x, s.z - dest.z) < .13) entered = true;
      if (entered && Math.hypot(s.x - start.x, s.z - start.z) < .13 && s.fold === 0) returned = true;
    }
    assert.ok(entered && returned, r.id + ' failed round trip: ' + JSON.stringify(hunt.state));
    assert.equal(crossings, 2);
    assert.equal(ctrl.consumeSlam(), null);
    assert.equal(ctrl.getInteractionState(absent), null);
    if (r === annex) assert.equal(heights.size, stairs.count + 1);
    ctrl.reset();
  }
});

test('the live stalk follows a silent player through a closed classroom door before walls become breakable', () => {
  const room = rooms[0], door = map.doors.find(d => d.id === room.id);
  const ctrl = createDoorController({ doors: map.doors, audio: {} });
  const spawn = { x: hall.halfWidth - 1.9, z: room.doorZ - 2.1, yaw: Math.PI };
  const hunt = createMonsterHunt({ obstacles: map.obstacles, doors: map.doors,
    holdDoor: ctrl.holdForMonster, closeDoor: ctrl.closeForMonster, spawn });
  const p = { x: hall.halfWidth + 3.6, z: room.doorZ, cameraY: .98, active: true, noiseRadius: 0 };
  for (const elapsed of [0, 65]) {
    ctrl.reset(); hunt.reset();
    const threat = computeEscalation({ elapsed });
    assert.equal(hunt.update(.05, p, threat).visible, false);
    let passedDoor = false;
    for (let i = 0; i < 680 && hunt.state.mode !== 'capture'; i++) {
      ctrl.update(.05, null, false);
      const s = hunt.update(.05, p, threat);
      assert.equal(s.smashedWall, null);
      assert.ok(s.mode === 'chase' || s.mode === 'capture');
      if (s.fold === 1 && door.open > .98) passedDoor = true;
    }
    assert.ok(passedDoor && hunt.state.mode === 'capture');
  }
  ctrl.reset();
});

test('sight and acoustics follow the real classroom opening and moving leaf', () => {
  const room = rooms[0], door = map.doors.find(d => d.id === room.id);
  door.open = door.targetOpen = 0;
  const ctrl = createDoorController({ doors: map.doors, audio: {} });
  const nav = createMonsterNavigation(map.obstacles, map.doors);
  const inside = { x: hall.halfWidth + 2.2, z: room.doorZ, y: 1.61 };
  const outside = { x: hall.halfWidth - 1.5, z: room.doorZ, y: 1.71 };
  const shutDistance = nav.acousticDistance(inside, outside);
  assert.equal(nav.visible(inside, outside), false);
  ctrl.holdForMonster(door);
  for (let i = 0; i < 12; i++) ctrl.update(.05, null, false);
  assert.equal(nav.visible(inside, outside), true);
  assert.ok(shutDistance - nav.acousticDistance(inside, outside) > 3);
  assert.equal(nav.visible({ ...inside, z: room.doorZ + 2 }, { ...outside, z: room.doorZ + 2 }), false);
  ctrl.reset();
  assert.equal(door.open, 0);
});

test('a noise behind the closed classroom door draws the monster inside, and a player cannot close it on the folded suit', () => {
  const r = rooms[0], door = map.doors.find(d => d.id === r.id);
  const ctrl = createDoorController({ doors: map.doors, audio: {} });
  const start = { x: hall.halfWidth - 2.3, z: r.doorZ, yaw: -Math.PI / 2 };
  const hunt = createMonsterHunt({ obstacles: map.obstacles, doors: map.doors, holdDoor: ctrl.holdForMonster, spawn: start, patrolPoints: [start] });
  const p = { x: hall.halfWidth + 4.8, z: r.doorZ, cameraY: 1.19, active: true, noiseRadius: 14 };
  const s = hunt.update(.05, p);
  assert.equal(s.mode, 'investigate');
  assert.equal(s.visible, false);
  p.noiseRadius = 0;
  let checked = false;
  for (let i = 0; i < 320 && s.mode !== 'capture'; i++) {
    ctrl.update(.05, null, false); hunt.update(.05, p);
    if (!checked && s.fold === 1 && Math.abs(s.x - door.pos.x) < .35) {
      // The hand is outside the threshold. Only the passing suit prevents closing.
      const result = ctrl.interact({ x: hall.halfWidth - 1.32, z: r.doorZ, cameraY: 1.61, yaw: -Math.PI / 2, pitch: -.25 });
      assert.equal(result.reason, 'blocked');
      assert.equal(door.targetOpen, 1);
      checked = true;
    }
  }
  assert.ok(checked);
  assert.equal(s.mode, 'capture');
  assert.ok(s.x > hall.halfWidth + 3);
  ctrl.reset();
});

test('the folded animated suit fits the jambs and lintel at each phase of its sideways gait', () => {
  const torso = mascot.root.getObjectByName('Torso'), vertex = new Vector3();
  mascot.place(0, 0, 0, 0);
  mascot.face.setPreviewWear(1);
  mascot.setAnimation('walk');
  for (const phase of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    for (let i = 0; i < 5; i++) {
      mascot.update(.06, Infinity, null, { stridePhase: phase, fold: 1, stoop: 0 });
    }
    let top = 0, front = -Infinity, back = Infinity;
    torso.traverseVisible(mesh => {
      if (!mesh.isMesh) return;
      const positions = mesh.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
        top = Math.max(top, vertex.y); front = Math.max(front, vertex.z); back = Math.min(back, vertex.z);
      }
    });
    assert.ok(top < 2.154, 'antenna under lowest lintel: ' + top);
    assert.ok(front < .51 && back > -.51, 'depth across classroom jambs: ' + back + ' to ' + front);
  }
  mascot.face.reset();
});

test('the suit never grabs during a door manoeuvre and resumes a normal capture at a threshold', () => {
  const r = rooms[0], door = map.doors.find(d => d.id === r.id);
  const ctrl = createDoorController({ doors: map.doors, audio: {} });
  ctrl.holdForMonster(door);
  for (let i = 0; i < 12; i++) ctrl.update(.05, null, false);
  ctrl.holdForMonster(null);
  const hunt = createMonsterHunt({ obstacles: map.obstacles, doors: map.doors, holdDoor: ctrl.holdForMonster,
    spawn: { x: hall.halfWidth + 4.2, z: r.doorZ, yaw: -Math.PI / 2 }, patrolPoints: [] });
  // The player waits in the middle of the doorway while the suit folds,
  // crosses and unfolds. It must neither grab nor kill until it is wide again.
  const p = { active: true, x: hall.halfWidth - .05, z: r.doorZ, cameraY: 1.61 };
  let wasFolded = false, folds = 0, grabbedWhileFolded = false, resumedHunt = false, capture = null;
  for (let i = 0; i < 400 && !capture; i++) {
    ctrl.update(.05, null, false);
    const s = hunt.update(.05, p);
    if (s.fold > 0 || s.maneuvering) {
      if (!wasFolded) { folds++; wasFolded = true; }
      if (s.mode === 'capture' || s.mode === 'dead') grabbedWhileFolded = true;
    } else if (wasFolded) {
      wasFolded = false;
    }
    if (folds && !wasFolded && (s.mode === 'chase' || s.mode === 'investigate')) resumedHunt = true;
    if (s.mode === 'capture') capture = { x: s.x, z: s.z, fold: s.fold, side: s.captureSide, maneuvering: s.maneuvering };
  }
  assert.ok(folds > 0, 'the suit folded to cross the doorway');
  assert.equal(grabbedWhileFolded, false, 'captured or killed while folded');
  assert.ok(resumedHunt, 'the hunt did not resume after unfolding');
  assert.ok(capture, 'the suit never caught the player waiting in the threshold');
  assert.equal(capture.fold, 0, 'normal capture must start unfolded');
  assert.equal(capture.maneuvering, false, 'normal capture must start after the door manoeuvre');
  assert.equal(capture.side, 0, 'normal capture uses both gloves, not the folded edge glove');
  assert.equal(folds, 1, 'the suit folded back and forth at the threshold');
  assert.ok(capture.x < door.pos.x, 'capture should happen from the corridor side after unfolding');
  assert.ok(door.open > .98, 'the doorway was not open for the capture');
  // The normal capture still advances its clock to the kill.
  for (let i = 0; i < 80 && hunt.state.mode === 'capture'; i++) hunt.update(.05, p);
  assert.equal(hunt.state.mode, 'dead');
  ctrl.reset();
});

test('capture geometry keeps eyes, mouth and inner creature clear with gloves at the sides', () => {
  const landmarks = ['Ojo derecho', 'Ojo izquierdo', 'Costura y forro interior', 'Máscara de ceniza', 'Boca interior']
    .map(name => [name, mascot.root.getObjectByName(name)]);
  for (const [, part] of landmarks) assert.ok(part, 'missing mascot landmark');
  const armMeshes = [];
  for (const side of ['D', 'I']) {
    const shoulder = mascot.root.getObjectByName('Hombro.' + side);
    shoulder.traverse(part => { if (part.isMesh) armMeshes.push(part); });
  }
  const palms = [mascot.root.getObjectByName('Palma.D'), mascot.root.getObjectByName('Palma.I')];
  const pose = { x: 0, z: 1.6, yaw: 0, bodyYaw: 0, cameraY: 1.61, thirdPersonBlend: 0, crouchAmount: 0,
    jump: { height: 0 }, vx: 0, vz: 0, wishVx: 0, wishVz: 0, offsetX: 0, initialX: 0 };
  const state = { yaw: 0, y: 0, captureSide: 0, captureYaw: 0 };
  const ray = new Raycaster();
  const world = new Vector3(), handPoints = [new Vector3(), new Vector3()];
  mascot.place(0, 0, 0, 0);
  mascot.setAnimation('grab');
  // One preview pose opens the mouth and brings the inner creature out.
  mascot.face.setPreviewWear(1);
  try {
    for (const third of [0, 1]) {
      for (const reduced of [false, true]) {
        for (const time of [1.0, 1.4, 1.9]) {
          const camera = new PerspectiveCamera(64, 16 / 9, .045, 100);
          camera.position.set(0, 1.61, 1.6 + 2 * third);
          camera.quaternion.identity();
          const shot = createCaptureShot(camera, { ...pose, thirdPersonBlend: third });
          const capture = capturePose(time);
          let victim = null;
          for (let i = 0; i < 5; i++) {
            mascot.update(.05, 1, new Vector3(0, 1.6, 0),
              { fold: 0, doorPress: 0, stridePhase: 0, stoop: 0, captureSide: 0, capture });
            victim = shot(mascot, state, capture, [], reduced);
          }
          mascot.root.updateMatrixWorld(true);
          camera.updateMatrixWorld(true);
          camera.updateProjectionMatrix();
          const label = `third=${third} reduced=${reduced} t=${time}`;
          assert.equal(victim.capture.hideBody, third < .15, label + ' body visibility');
          let mouthX = 0;
          for (const [name, part] of landmarks) {
            part.getWorldPosition(world);
            const projected = world.clone().project(camera);
            assert.ok(Math.abs(projected.x) < .8 && projected.y < .9 && projected.y > -.9,
              `${label}: ${name} outside the frame at ${projected.x}, ${projected.y}`);
            if (name === 'Boca interior') mouthX = projected.x;
            const distance = camera.position.distanceTo(world);
            ray.set(camera.position, world.clone().sub(camera.position).normalize());
            ray.far = distance - .01;
            assert.equal(ray.intersectObjects(armMeshes, true).length, 0,
              `${label}: a glove blocks ${name}`);
          }
          const eyeY = landmarks[0][1].getWorldPosition(world).clone().project(camera).y;
          for (let i = 0; i < 2; i++) {
            palms[i].localToWorld(handPoints[i].set(i === 0 ? -.12 : .12, 0, .004));
            const projected = handPoints[i].clone().project(camera);
            assert.ok(projected.y < eyeY, `${label}: glove ${i} is not below the eyes`);
            assert.ok(i === 0 ? projected.x < mouthX - .05 : projected.x > mouthX + .05,
              `${label}: glove ${i} crosses the mouth`);
          }
          for (const hand of handPoints) {
            assert.ok(Math.abs(hand.x) > .3 && hand.y > 1.35 && hand.y < 1.7,
              `${label}: glove is not gripping a shoulder/side at ${hand.x}, ${hand.y}`);
          }
        }
      }
    }
  } finally {
    mascot.face.reset();
    mascot.setAnimation('idle');
    mascot.place(0, 0, 0, 0);
  }
});

const near = (a, b, label) => assert.ok(Math.abs(a - b) < .0001, `${label}: ${a} != ${b}`);
const walker = (x, z) => ({ x, z, jump: createJumpState(), stamina: createStaminaState() });
const dt = 1 / 60;

function stride(p, dx, dz) {
  movePlayer(p, dx, dz, obstacles, p.jump.height, worldBounds);
  const floorHeight = supportHeight(p.x, p.z, p.jump.height, obstacles);
  stepJump(p.jump, p.stamina, { dt, floorHeight });
}

function runTo(p, x, z, flat = true) {
  const dx = x - p.x, dz = z - p.z;
  const frames = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (SPRINT_SPEED * dt)));
  for (let i = 0; i < frames; i++) {
    stride(p, dx / frames, dz / frames);
    if (flat) near(p.jump.height, 0, 'running surface');
  }
  near(p.x, x, 'route x'); near(p.z, z, 'route z');
  // Check that the visible floor exists too. Missing floor meshes would still
  // be walkable because supportHeight defaults to zero.
  const ray = new Raycaster(new Vector3(x, 2, z), new Vector3(0, -1, 0));
  const hit = ray.intersectObjects(floors)[0];
  assert.ok(hit, `no rendered floor at ${x}, ${z}`);
  if (flat) near(hit.point.y, 0, 'rendered floor');
}

function interact(ctrl, p, item) {
  const dx = item.pos.x - p.x, dz = item.pos.z - p.z;
  const eye = 1.61 + p.jump.height;
  const pose = { x: p.x, z: p.z, cameraY: eye, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(item.pos.y - eye, Math.hypot(dx, dz)) };
  const result = ctrl.interact(pose);
  assert.equal((result.door ?? result.switch)?.id, item.id);
  for (let i = 0; i < 40; i++) ctrl.update(dt, pose, true);
  return result;
}

test('real doorways connect both sprint lanes, internal room pairs, Mini Plaza Exterior, and Caseta 107', () => {
  const atmosphere = createAtmosphere(lights, extraLights);
  const ctrl = createDoorController({ ...map, atmosphere, audio: {} });
  const lane = hallClearHalfWidth - .45;
  const p = walker(lane, hall.near - .7);
  runTo(p, lane, hall.far + .75);
  runTo(p, -lane, hall.far + .75);
  runTo(p, -lane, hall.near - .7);

  for (const r of rooms.filter(rm => rm.side !== 0)) {
    const s = r.side, midX = (r.x0 + r.x1) / 2;
    const door = map.doors.find(d => d.id === r.id);
    const outside = map.switches.find(sw => sw.id === `sw-out-${r.id}`);
    const inside = map.switches.find(sw => sw.id === `sw-in-${r.id}`);
    const startLight = atmosphere.getRoomLight(r.lightId).switchedOn;
    runTo(p, p.x, r.doorZ);
    runTo(p, s * (hall.halfWidth - .90), r.doorZ);
    for (let i = 0; i < 24; i++) stride(p, s * SPRINT_SPEED * dt, 0);
    assert.ok(s * p.x < hall.halfWidth && s * p.x > hall.halfWidth - .30, `closed ${r.id}`);
    runTo(p, s * (hall.halfWidth - .90), outside.pos.z);
    assert.equal(interact(ctrl, p, outside).on, !startLight);
    runTo(p, p.x, r.doorZ);
    assert.equal(interact(ctrl, p, door).open, true);
    const entryX = s * (hall.halfWidth + 1.60);
    runTo(p, entryX, r.doorZ);
    runTo(p, entryX, inside.pos.z);
    assert.equal(interact(ctrl, p, inside).on, startLight);
    runTo(p, entryX, r.doorZ);

    runTo(p, midX, r.doorZ);
    runTo(p, midX, r.z1 - .85);
    runTo(p, midX, r.z0 + .85);
    runTo(p, midX, r.doorZ);
    runTo(p, s * lane, r.doorZ);
    assert.equal(interact(ctrl, p, door).open, false);
    assert.ok(door.obstacle.active);
  }

  // Test internal connecting loop 101 <-> 102
  const d101 = map.doors.find(d => d.id === '101');
  const d102 = map.doors.find(d => d.id === '102');
  const d101_102 = map.doors.find(d => d.id === '101-102');
  const mid101X = (rooms[0].x0 + rooms[0].x1) / 2;
  const mid102X = (rooms[1].x0 + rooms[1].x1) / 2;
  runTo(p, lane, p.z);
  runTo(p, lane, rooms[0].doorZ);
  assert.equal(interact(ctrl, p, d101).open, true);
  runTo(p, mid101X, rooms[0].doorZ);
  runTo(p, mid101X, 12.8);
  runTo(p, 10.2, 12.8);
  assert.equal(interact(ctrl, p, d101_102).open, true);
  runTo(p, 10.2, 11.2);
  runTo(p, mid102X, 11.2);
  runTo(p, mid102X, rooms[1].doorZ);
  runTo(p, hall.halfWidth + 1.1, rooms[1].doorZ);
  assert.equal(interact(ctrl, p, d102).open, true);
  runTo(p, lane, rooms[1].doorZ);
  runTo(p, lane, plaza.hallPortal.z - 2.2);
  runTo(p, -lane, plaza.hallPortal.z - 2.2);

  // Test Mini Plaza Exterior, Caseta 107 double-door pass-through, and locked Portón Exterior
  const dPlaza = map.doors.find(d => d.id === 'plaza');
  const d107N = map.doors.find(d => d.id === '107-norte');
  const d107E = map.doors.find(d => d.id === '107');
  const dPorton = map.doors.find(d => d.id === 'porton');
  runTo(p, -lane, plaza.hallPortal.z);
  assert.equal(interact(ctrl, p, dPlaza).open, true);
  runTo(p, -7.5, plaza.hallPortal.z);
  runTo(p, -7.5, 8.5);
  runTo(p, -22.0, 8.5);
  runTo(p, -22.0, 11.2);
  assert.equal(interact(ctrl, p, d107N).open, true);
  runTo(p, -22.0, 15.0);
  runTo(p, -19.5, 16.0);
  assert.equal(interact(ctrl, p, d107E).open, true);
  runTo(p, -16.0, 16.0);
  runTo(p, -16.0, 18.2);
  assert.equal(interact(ctrl, p, dPorton).reason, 'locked');
});

test('annex double doors, original seven walkable treads, landing and locked exits', () => {
  const ctrl = createDoorController({ ...map, audio: {} });
  const doors = Object.fromEntries(map.doors.map(d => [d.id, d]));
  const p = walker(0, hall.near - .9);
  assert.equal(interact(ctrl, p, doors.entrada).reason, 'locked');
  const lane = hallClearHalfWidth - .5;
  runTo(p, lane, p.z);
  runTo(p, lane, hall.far + 1.2);
  runTo(p, 0, p.z);
  for (let i = 0; i < 24; i++) stride(p, 0, -SPRINT_SPEED * dt);
  assert.ok(p.z > hall.far && p.z < hall.far + .30);
  runTo(p, 0, hall.far + 1);
  assert.equal(interact(ctrl, p, doors.anexo).open, true);
  runTo(p, 0, stairs.startZ + 1.4);
  const stairX = (stairs.x0 + stairs.x1) / 2;
  runTo(p, stairX, p.z);
  const treads = obstacles.filter(b => b.step).sort((a, b) => b.z1 - a.z1);
  assert.equal(treads.length, 8);
  for (const [i, tread] of treads.entries()) {
    // Toward the leading edge: the player radius already touches the next
    // riser at the geometric midpoint of a 0.48 m tread.
    runTo(p, stairX, tread.z1 - .10, false);
    near(p.jump.height, Math.min(i + 1, 7) * .18, 'stair elevation');
  }
  runTo(p, stairX, landing.z0 + 1, false);
  runTo(p, landing.doorX, p.z, false);
  near(p.jump.height, 1.26, 'landing');
  assert.equal(interact(ctrl, p, doors.azotea).reason, 'locked');
  runTo(p, stairX, p.z, false);
  runTo(p, stairX, stairs.startZ + 1.4, false);
  near(p.jump.height, 0, 'back at annex floor');
  runTo(p, 0, p.z);
  runTo(p, 0, hall.far + 1);
});

test('generated fluorescent banks and plaza streetlamps share switch circuits and sit inside matching bounds', () => {
  for (const [i, lamp] of [...lights, ...extraLights].entries()) {
    const meshes = map.scene.children.filter(m => m.material?.userData.lampIndex === i);
    assert.equal(meshes.length, 1);
    meshes[0].geometry.computeBoundingBox();
    const { min, max } = meshes[0].geometry.boundingBox;
    if (i < lights.length + rooms.length + 2) {
      const paired = i < lights.length + rooms.length;
      near((max.z + min.z) / 2, lamp.z, 'fixture center');
      assert.ok(Math.abs((max.x + min.x) / 2 - (lamp.x ?? lightX)) < .08);
      near((max.y + min.y) / 2, (paired ? hall.height : annex.height) - .121, 'tube height');
      near(max.z - min.z, 1.51 + (paired ? 2 * pairedFixtureOffset : 0), 'tube span');
    } else {
      near((max.x + min.x) / 2, lamp.x, 'streetlamp x');
      near((max.z + min.z) / 2, lamp.z, 'streetlamp z');
      near((max.y + min.y) / 2, 3.35, 'streetlamp lantern height');
    }
  }
  for (const w of hallWindows) {
    assert.ok(rooms.every(r => r.side !== w.side || w.z - w.w / 2 > r.z1 || w.z + w.w / 2 < r.z0));
  }
});

test('floor-standing furniture fits in its bay, including seats and overturned desks', () => {
  for (const r of rooms) {
    const bays = furnishingBays(r);
    const furniture = map.obstacles.filter(b => {
      const x = (b.x0 + b.x1) / 2, z = (b.z0 + b.z1) / 2;
      return b.active === undefined && !b.rounded && x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
    });
    assert.ok(furniture.length >= (r.kind === 'guardhouse' ? 2 : 8), r.id);
    for (const b of furniture) {
      assert.equal(b.top, undefined, 'furniture does not create a walkable platform');
      assert.ok(bays.some(a => b.x0 >= a.x0 && b.x1 <= a.x1 && b.z0 >= a.z0 && b.z1 <= a.z1),
        `furniture protrudes into a lane in ${r.id}: ${JSON.stringify(b)}`);
    }
  }
});

test('full-density debris stays out of running lanes and sits on the actual stair and landing supports', () => {
  const placements = generateDebrisPlacements(map.obstacles);
  assert.equal(placements.length, map.debris.totalPieces);
  for (const zone of ['corridor', ...rooms.map(r => `room-${r.id}`), 'annex', 'stairs', 'landing', 'plaza']) {
    assert.ok(placements.some(p => p.zone === zone), zone);
  }
  for (const p of placements.filter(p => p.y > 0)) {
    assert.ok(map.obstacles.some(b => b.step && Math.abs(b.top - p.y) < 1e-6 &&
      p.x > b.x0 && p.x < b.x1 && p.z > b.z0 && p.z < b.z1));
  }
  // Check the actual batched vertices, including the outer tips of slivers.
  const roomBays = rooms.map(r => [r, furnishingBays(r)]);
  for (const mesh of map.debris.root.children) {
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      if (z < hall.far) continue;
      if (Math.abs(x) <= hall.halfWidth) assert.ok(Math.abs(x) >= hallClearHalfWidth);
      else {
        const inRoomBay = roomBays.some(([r, bays]) => z >= r.z0 && z <= r.z1 &&
          bays.some(b => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1));
        const inPlaza = (x >= plaza.main.x0 && x <= plaza.main.x1 && z >= plaza.main.z0 && z <= plaza.main.z1) ||
          (x >= plaza.northPassage.x0 && x <= plaza.northPassage.x1 && z >= plaza.northPassage.z0 && z <= plaza.northPassage.z1);
        assert.ok(inRoomBay || inPlaza, `debris sliver out of bounds at ${x}, ${z}`);
      }
    }
  }
});

test('jumping on the corridor bench, landing, or under open doorframes never pierces ceilings or lintels', () => {
  const ctrl = createDoorController({ ...map, audio: {} });
  const r101 = rooms[0];
  const d101 = map.doors.find(d => d.id === r101.id);
  const dAnnex = map.doors.find(d => d.id === 'anexo');
  d101.open = 1; d101.targetOpen = 1;
  dAnnex.open = 1; dAnnex.targetOpen = 1;
  ctrl.update(0, { x: 0, y: 1.61, z: 0, yaw: 0, pitch: 0 }, false);

  function jumpPeakAt(x, z, startFootY) {
    const floor = supportHeight(x, z, startFootY, obstacles);
    const ceil = ceilingHeight(x, z, floor, obstacles);
    const jump = createJumpState();
    jump.height = floor;
    const stamina = createStaminaState();
    stepJump(jump, stamina, { wantJump: true, dt, floorHeight: floor, ceilingHeight: ceil });
    let peak = jump.height;
    for (let i = 0; i < 80 && !jump.grounded; i++) {
      stepJump(jump, stamina, { dt, floorHeight: floor, ceilingHeight: ceil });
      peak = Math.max(peak, jump.height);
    }
    return { floor, ceil, peak };
  }

  // Jumping from corridor bench backrest and directly beneath a ceiling crossbeam never pierces the ceiling.
  const benchOpen = jumpPeakAt(-hall.halfWidth + 0.25, benchZ + 0.4, 0.78);
  assert.equal(benchOpen.floor, 0.78);
  assert.ok(benchOpen.peak + PLAYER_STAND_HEIGHT <= hall.height + 1e-6);

  const benchOtherEnd = jumpPeakAt(-hall.halfWidth + 0.25, benchZ - 0.4, 0.78);
  assert.equal(benchOtherEnd.floor, 0.78);
  assert.ok(benchOtherEnd.peak + PLAYER_STAND_HEIGHT <= hall.height + 1e-6);

  const crossbeamZ = (lights[0].z + lights[1].z) / 2;
  const beamJump = jumpPeakAt(0, crossbeamZ, 0);
  assert.ok(beamJump.peak + PLAYER_STAND_HEIGHT <= hall.height - 0.12 + 1e-6);

  // Jumping on the Annex mezzanine landing stays under the Annex ceiling.
  const annexJump = jumpPeakAt(-2.2, (landing.z0 + landing.z1) / 2, landing.top);
  assert.equal(annexJump.floor, landing.top);
  assert.ok(annexJump.peak + PLAYER_STAND_HEIGHT <= annex.height + 1e-6);

  // Jumping inside open classroom and annex doorways stays beneath their steel headers / transoms.
  const roomDoorJump = jumpPeakAt(hall.halfWidth + 0.05, r101.doorZ, 0);
  assert.ok(roomDoorJump.peak + PLAYER_STAND_HEIGHT <= 2.222 + 1e-6);

  const annexDoorJump = jumpPeakAt(0, hall.far - 0.05, 0);
  assert.ok(annexDoorJump.peak + PLAYER_STAND_HEIGHT <= 2.154 + 1e-6);

  // Jumping high before an open doorway cannot clip horizontally through the header.
  const roomHopper = { x: hall.halfWidth - 0.5, z: r101.doorZ };
  movePlayer(roomHopper, 1.2, 0, obstacles, 0.65, worldBounds);
  assert.ok(roomHopper.x < hall.halfWidth - 0.25, 'high jump cannot pass through classroom doorframe header');

  const annexHopper = { x: 0, z: hall.far + 0.5 };
  movePlayer(annexHopper, 0, -1.2, obstacles, 0.65, worldBounds);
  assert.ok(annexHopper.z > hall.far + 0.25, 'high jump cannot pass through annex doorway transom');

  // Third-person camera passes freely at eye height through open doorway while blocked above the header.
  const eyeT = castCameraRay(
    { x: hall.halfWidth - 0.6, y: 1.5, z: r101.doorZ },
    { x: hall.halfWidth + 0.8, y: 1.5, z: r101.doorZ },
    obstacles,
    worldBounds
  );
  assert.equal(eyeT, 1, 'overhead doorway lintel does not block eye-height camera ray');
  const headerT = castCameraRay(
    { x: hall.halfWidth - 0.6, y: 2.35, z: r101.doorZ },
    { x: hall.halfWidth + 0.8, y: 2.35, z: r101.doorZ },
    obstacles,
    worldBounds
  );
  assert.ok(headerT < 0.5, 'overhead doorway lintel still blocks raised third-person camera');
  d101.open = 0; d101.targetOpen = 0;
  dAnnex.open = 0; dAnnex.targetOpen = 0;
  ctrl.update(0, { x: 0, y: 1.61, z: 0, yaw: 0, pitch: 0 }, false);
});

test('all six classroom door closers articulate smoothly from the moving leaf spindle to the header shoe', () => {
  const ctrl = createDoorController({ ...map, audio: {} });
  for (const r of rooms) {
    const door = map.doors.find(d => d.id === r.id);
    const pv = door.pivots[0];
    const cl = pv.closer;
    assert.ok(cl && typeof pv.updateCloser === 'function', `room ${r.id} has articulated closer`);
    for (const openVal of [0, 0.5, 1]) {
      door.open = openVal;
      door.targetOpen = openVal;
      ctrl.update(0, { x: 0, y: 1.61, z: 0, yaw: 0, pitch: 0 }, false);
      map.scene.updateMatrixWorld(true);
      const doorFrame = pv.group.parent;
      const spindleWorld = pv.group.localToWorld(new Vector3(cl.spindleLocalX, cl.spindleY, cl.spindleLocalZ));
      const shoeWorld = doorFrame.localToWorld(new Vector3(cl.shoeX, cl.shoeJointY, cl.shoeZ));
      const elbowWorld = cl.elbowPin.getWorldPosition(new Vector3());
      const a1Start = cl.arm1.localToWorld(new Vector3(0, -0.5, 0));
      const a1End = cl.arm1.localToWorld(new Vector3(0, 0.5, 0));
      const a2Start = cl.arm2.localToWorld(new Vector3(0, -0.5, 0));
      const a2End = cl.arm2.localToWorld(new Vector3(0, 0.5, 0));
      assert.ok(a1Start.distanceTo(spindleWorld) < 1e-6, `room ${r.id} open=${openVal} arm1 meets spindle`);
      assert.ok(a1End.distanceTo(elbowWorld) < 1e-6, `room ${r.id} open=${openVal} arm1 meets elbow`);
      assert.ok(a2Start.distanceTo(elbowWorld) < 1e-6, `room ${r.id} open=${openVal} arm2 meets elbow`);
      assert.ok(a2End.distanceTo(shoeWorld) < 1e-6, `room ${r.id} open=${openVal} arm2 meets header shoe`);
    }
    door.open = 0;
    door.targetOpen = 0;
  }
  ctrl.update(0, { x: 0, y: 1.61, z: 0, yaw: 0, pitch: 0 }, false);
});

test('all openable pavilion doors swing away from either approach side and align 3D handles & closers at swingSign = -1', () => {
  const openable = map.doors.filter(d => !d.locked && d.pivots?.some(p => typeof p.swingDirX === 'number'));
  assert.ok(openable.length >= 14, `expected at least 14 openable doors, got ${openable.length}`);
  for (const d of map.doors) {
    d.open = 0;
    d.targetOpen = 0;
    d.swingSign = 1;
    d.slam = 0;
    d.bounce = 0;
    d.rattle = 0;
  }
  const ctrl = createDoorController({ ...map, audio: {} });
  try {

    for (const door of openable) {
      const pv = door.pivots[0];
      const sx = pv.swingDirX;
      const sz = pv.swingDirZ;

      // Test approaching from -swingDir (opens +1) then from +swingDir (opens -1).
      for (const expectedSign of [1, -1]) {
        const approachSign = -expectedSign;
        const px = door.pos.x + approachSign * sx * 1.15;
        const pz = door.pos.z + approachSign * sz * 1.15;
        const lookYaw = Math.atan2(-(door.pos.x - px), -(door.pos.z - pz));
        const pose = { x: px, y: 1.61, z: pz, yaw: lookYaw, pitch: -0.25 };

        ctrl.update(0.016, pose, true);
        const res = ctrl.interact(pose);
        assert.equal(res.ok, true, `${door.id} interact ok from sign ${approachSign}`);
        assert.equal(door.swingSign, expectedSign, `${door.id} swings ${expectedSign} when pushed from ${approachSign}`);
        for (let i = 0; i < 30; i++) ctrl.update(0.03, pose, true);
        assert.equal(door.open, 1, `${door.id} expectedSign=${expectedSign} target=${door.targetOpen} res=${res.kind}:${res.door?.id || res.switch?.id}`);

        map.scene.updateMatrixWorld(true);
        for (const p of door.pivots) {
          const leaf = p.obstacle;
          assert.ok(leaf, `${door.id} pivot has segment obstacle`);
          // Segment vector from hinge must match expected swing side dot product < 0 with approach!
          const segDot = (leaf.bx - leaf.ax) * sx + (leaf.bz - leaf.az) * sz;
          assert.ok(segDot * expectedSign > 0.5, `${door.id} segment points into ${expectedSign} side (dot=${segDot})`);
        }
        if (door.handles?.length) {
          const hw = door.handles[0].getWorldPosition(new Vector3());
          const handleDot = (hw.x - door.pos.x) * sx + (hw.z - door.pos.z) * sz;
          assert.ok(handleDot * expectedSign > 0.3, `${door.id} 3D handle swung into ${expectedSign} side`);
        }
        if (pv.closer && typeof pv.updateCloser === 'function') {
          const doorFrame = pv.group.parent;
          const spindleWorld = pv.group.localToWorld(new Vector3(pv.closer.spindleLocalX, pv.closer.spindleY, pv.closer.spindleLocalZ));
          const shoeWorld = doorFrame.localToWorld(new Vector3(pv.closer.shoeX, pv.closer.shoeJointY, pv.closer.shoeZ));
          const elbowWorld = pv.closer.elbowPin.getWorldPosition(new Vector3());
          assert.ok(pv.closer.arm1.localToWorld(new Vector3(0, -0.5, 0)).distanceTo(spindleWorld) < 1e-5, `${door.id} closer arm1 meets spindle`);
          assert.ok(pv.closer.arm1.localToWorld(new Vector3(0, 0.5, 0)).distanceTo(elbowWorld) < 1e-5, `${door.id} closer arm1 meets elbow`);
          assert.ok(pv.closer.arm2.localToWorld(new Vector3(0, 0.5, 0)).distanceTo(shoeWorld) < 1e-5, `${door.id} closer arm2 meets shoe`);
        }

        // Close door cleanly without stepping on threshold before reversing approach side.
        door.open = 0;
        door.targetOpen = 0;
        ctrl.update(0, { x: 0, y: 1.61, z: 0, yaw: 0, pitch: 0 }, false);
      }
    }
  } finally {
    ctrl.reset();
  }
});

test('monster opens doors away from its direction of travel and spots behind-door pockets on negative swings', () => {
  const r101 = rooms.find(r => r.id === '101');
  const d101 = map.doors.find(d => d.id === '101');
  const ctrl = createDoorController({ doors: map.doors, switches: map.switches, audio: {} });
  const nav = createMonsterNavigation(map.obstacles, map.doors);

  try {
    // 1. Monster exiting Room 101 into the hallway pushes Door 101 out into the hallway (swingSign = -1).
    const hunt = createMonsterHunt({
      obstacles: map.obstacles,
      doors: map.doors,
      holdDoor: ctrl.holdForMonster,
      closeDoor: ctrl.closeForMonster,
      spawn: { x: 4.1, y: 0, z: r101.doorZ, yaw: Math.PI / 2 },
      patrolPoints: [{ x: 0, z: r101.doorZ }, { x: 4.1, z: r101.doorZ }]
    });
    const dummyPlayer = { x: -2, y: 1.61, z: -20, cameraY: 1.61, active: true, noiseRadius: 0 };
    let sawNegativeHold = false;
    for (let i = 0; i < 300; i++) {
      hunt.update(1 / 30, dummyPlayer);
      ctrl.update(1 / 30, null, false);
      if (d101.targetOpen === 1 && d101.swingSign === -1) sawNegativeHold = true;
      if (hunt.state.x < 1.2) break;
    }
    assert.equal(sawNegativeHold, true, 'monster exiting Room 101 swings Door 101 outward (-1) toward hallway');
    assert.ok(hunt.state.x < 1.2, `monster reached hallway via outward door (x=${hunt.state.x})`);

    // 2. Behind-open-door check recognizes player tucked behind a corridor-swung (swingSign = -1) door leaf.
    ctrl.reset();
    d101.swingSign = -1;
    d101.open = 1;
    d101.targetOpen = 1;
    ctrl.update(0, null, false);
    const leaf = d101.pivots[0].obstacle;
    // Pocket between hallway wall and leaf swung into hallway (away from doorway center).
    const pocketDir = Math.sign(leaf.az - d101.pos.z) || 1;
    const behindHallLeaf = {
      x: (leaf.ax + leaf.bx) * 0.5,
      z: (leaf.az + leaf.bz) * 0.5 + pocketDir * 0.35
    };
    const monsterInHall = { x: 0.6, z: r101.doorZ };
    const found = nav.blockingOpenDoor(monsterInHall, behindHallLeaf);
    assert.ok(found && found.door === d101, 'blockingOpenDoor detects player shielded by negative-swing door leaf');
  } finally {
    ctrl.reset();
  }
});
