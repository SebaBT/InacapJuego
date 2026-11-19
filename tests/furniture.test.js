import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { Group, ShaderMaterial, Vector3 } from 'three';
import { makeAnimator } from '../src/animate.js';
import { buildCorridor } from '../src/corridor.js';
import { createFurniture, furnitureState, furnitureBounds, throwableKinds } from '../src/furniture.js';
import { rooms } from '../src/layout.js';
import { createMonsterHunt } from '../src/monster-hunt.js';
import {
  findBlockingProp, planThrow, throwArcPoint, throwDuration, throwPose, throwRelease
} from '../src/monster-throw.js';

const dt = 1 / 60;
const player = (x, z, extra) => ({ x, z, cameraY: 1.61, active: true, jump: { height: 0 }, ...extra });

function makeProp(id, x, z, width = 1.3, depth = .85, height = .8) {
  const group = new Group();
  group.position.set(x, 0, z);
  const localBox = { x0: -width / 2, x1: width / 2, y0: 0, y1: height, z0: -depth / 2, z1: depth / 2 };
  const collider = { x0: x - width / 2, x1: x + width / 2, z0: z - depth / 2, z1: z + depth / 2,
    sightTop: height, movable: true, propId: id };
  return {
    id, kind: 'pupitre', group, localBox, collider,
    size: { x: width, y: height, z: depth },
    radius: Math.hypot(width, depth) / 2,
    home: { position: { x, y: 0, z }, rotation: { x: 0, y: 0, z: 0, order: 'YXZ' } }
  };
}

// A 1.9 m gap between two low bulkheads: the monster's 0.71 m clearance fits
// through when the desk is gone, but not when the desk sits in it.
function bottleneck() {
  return [
    { x0: -3.6, x1: -.95, z0: 5, z1: 5.2, sightTop: 1.1 },
    { x0: .95, x1: 3.6, z0: 5, z1: 5.2, sightTop: 1.1 },
    { x0: -3.7, x1: -3.6, z0: -5, z1: 12 },
    { x0: 3.6, x1: 3.7, z0: -5, z1: 12 }
  ];
}

const bounds = { minX: -3.9, maxX: 3.9, minZ: -31.2, maxZ: 26.4 };
const inside = (o, x, z) => x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1;

let map, built;
before(() => {
  // Node has no Canvas2D. Only the texture painting is stubbed; the pavilion,
  // its merged desks and the real colliders are the ones the game ships.
  const noop = () => {};
  const gradient = () => ({ addColorStop: noop });
  const ctx = new Proxy({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createLinearGradient: gradient,
    createRadialGradient: gradient
  }, { get: (target, key) => target[key] ?? noop });
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ctx }) };
  try {
    map = buildCorridor((texture, options = {}) => {
      const material = new ShaderMaterial();
      material.userData = { ...options, repeatMeters: options.repeat };
      return material;
    });
    built = createFurniture({ props: map.furniture, obstacles: map.obstacles });
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test('the real pavilion exposes only free-standing furniture as movable, all merged and re-homed', () => {
  assert.ok(map.furniture.length >= 24, 'the pavilion has free-standing furniture');
  for (const prop of map.furniture) {
    assert.ok(throwableKinds.includes(prop.kind), `${prop.id} is throwable furniture`);
    assert.ok(prop.group.children.length <= 3, `${prop.id} is merged by material`);
    assert.ok(prop.group.children.every(child => child.isMesh));
    assert.equal(prop.collider.movable, true);
    assert.ok(map.obstacles.includes(prop.collider));
    assert.ok(prop.size.x > .4 && prop.size.y > .3 && prop.size.z > .3, `${prop.id} has real extent`);
  }
  const kinds = new Set(map.furniture.map(prop => prop.kind));
  for (const kind of throwableKinds) assert.ok(kinds.has(kind), `${kind} props are movable`);
  const movable = new Set(map.furniture.map(prop => prop.collider));
  for (const obstacle of map.obstacles) {
    if (movable.has(obstacle)) continue;
    assert.notEqual(obstacle.movable, true, 'architecture is never registered as throwable');
  }
  assert.equal(map.obstacles.filter(obstacle => obstacle.movable).length, map.furniture.length);
  assert.equal(built.props.length, map.furniture.length);
  assert.ok(built.props.every(item => item.state === furnitureState.rest));

  // Every room now holds movable furniture, and the labs/storage picked up the
  // benches, crates and reels that used to be baked architecture.
  const roomOf = prop => {
    const x = (prop.collider.x0 + prop.collider.x1) / 2;
    const z = (prop.collider.z0 + prop.collider.z1) / 2;
    return rooms.find(r => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) ?? null;
  };
  const propsIn = id => map.furniture.filter(prop => roomOf(prop)?.id === id);
  for (const room of rooms) {
    assert.ok(propsIn(room.id).length > 0, `Room ${room.id} has movable props`);
  }
  const lab = propsIn('104');
  assert.ok(lab.length >= 10, 'Room 104 computer benches are movable workstations');
  assert.ok(lab.every(prop => prop.kind === 'mesa'), 'Room 104 exposes the benches as tables');
  const storage = propsIn('105');
  assert.ok(storage.filter(prop => prop.kind === 'caja').length >= 4, 'Room 105 crates are throwable');
  const elec = propsIn('106');
  assert.ok(elec.filter(prop => prop.kind === 'mesa').length >= 6, 'Room 106 electronics benches split into movable tables');
  assert.ok(elec.filter(prop => prop.kind === 'caja').length >= 2, 'Room 106 cable reels are throwable');
});

test('the real pavilion furniture returns to its exact home footprint after a throw and a restart', () => {
  const item = built.props.find(prop => prop.kind === 'pupitre');
  assert.ok(item);
  const home = { ...item.home.position };
  const homeCollider = { ...item.collider };
  assert.ok(built.grab(item));
  assert.equal(item.collider.active, false);
  const plan = {
    from: { x: home.x, y: 1.5, z: home.z },
    to: { x: home.x, y: 0, z: home.z },
    ground: 0,
    arc: .8,
    duration: .6,
    yaw: 0,
    rest: { x: 0, y: 0, z: Math.PI / 2, order: 'YXZ' }
  };
  assert.ok(built.launch(item, plan));
  for (let i = 0; i < 120 && item.state !== furnitureState.rest; i++) built.update(dt);
  assert.equal(item.state, furnitureState.rest);
  assert.notEqual(item.group.rotation.z, 0);
  built.reset();
  assert.equal(item.state, furnitureState.rest);
  assert.deepEqual(item.group.position.toArray(), [home.x, home.y, home.z]);
  for (const key of ['x0', 'x1', 'z0', 'z1', 'sightTop']) {
    assert.equal(item.collider[key], homeCollider[key], `real collider.${key} restored`);
  }
  assert.equal(item.collider.active, undefined);
  assert.ok(built.props.every(prop => Math.abs(prop.x - prop.home.position.x) < 1e-9 &&
    Math.abs(prop.z - prop.home.position.z) < 1e-9 && prop.state === furnitureState.rest));
});

test('inside classroom 101 the monster hurls a blocking desk out of a bay to capture a player hiding between rows', () => {
  let hunt;
  const furniture = createFurniture({
    props: map.furniture,
    obstacles: map.obstacles,
    onChange: () => hunt?.invalidateNavigation()
  });
  const r101 = rooms[0];
  hunt = createMonsterHunt({
    obstacles: map.obstacles,
    doors: map.doors,
    furniture,
    patrolPoints: [],
    spawn: { x: 5.58, z: r101.doorZ, yaw: Math.PI }
  });
  const p = player(5.58, r101.doorZ - 2.8);
  assert.equal(routeReaches(hunt.navigation, hunt.state, p), false, 'desk rows block the wide suit from entering the bay');
  let threwId = null, impacted = false;
  for (let i = 0; i < 420 && hunt.state.mode !== 'capture'; i++) {
    hunt.update(dt, p);
    furniture.update(dt, hunt.state.carry);
    if (hunt.state.throwing && hunt.state.throwPropId) threwId = hunt.state.throwPropId;
    if (hunt.state.impact) impacted = true;
  }
  const thrown = threwId ? furniture.byId(threwId) : null;
  assert.ok(thrown, 'the monster selected and threw a real classroom desk');
  assert.equal(impacted, true, 'the thrown desk signalled landing impact');
  assert.equal(hunt.state.mode, 'capture', 'clearing the bay lets the monster reach and grab the player');
  hunt.reset();
  assert.equal(thrown.state, furnitureState.rest);
  assert.equal(thrown.x, thrown.home.position.x);
  assert.equal(thrown.z, thrown.home.position.z);
});

function huntWithFurniture({ prop, obstacles, spawn = { x: 0, z: 2, yaw: 0 } }) {
  let hunt;
  const furniture = createFurniture({
    props: [prop],
    obstacles,
    onChange: () => hunt?.invalidateNavigation()
  });
  hunt = createMonsterHunt({
    obstacles, doors: [], spawn,
    patrolPoints: [{ x: spawn.x, z: spawn.z }],
    furniture
  });
  return { hunt, furniture };
}

function routeReaches(nav, from, to) {
  const path = nav.route(from, to);
  const last = path[path.length - 1];
  return Boolean(last) && Math.hypot(last.x - to.x, last.z - to.z) < .45;
}

test('only the free-standing desk in the chase gap is selected, never the architecture', () => {
  const obstacles = bottleneck();
  const prop = makeProp('mesa-1', 0, 5);
  obstacles.push(prop.collider);
  let hunt;
  const furniture = createFurniture({ props: [prop], obstacles, onChange: () => hunt?.invalidateNavigation() });
  hunt = createMonsterHunt({ obstacles, doors: [], spawn: { x: 0, z: 2, yaw: 0 }, patrolPoints: [], furniture });
  const p = player(0, 7.5);
  const nav = hunt.navigation;
  assert.equal(routeReaches(nav, { x: 0, z: 2 }, p), false, 'the desk blocks the only gap');
  const chosen = findBlockingProp({ origin: { x: 0, z: 2, yaw: 0 }, player: p, nav, props: furniture.props });
  assert.equal(chosen?.id, 'mesa-1');
  // A wall course without any furniture is never a throw candidate.
  assert.equal(findBlockingProp({ origin: { x: 0, z: 2, yaw: 0 }, player: p, nav, props: [] }), null);
  // A prop behind the monster or far away is not selected either.
  assert.equal(findBlockingProp({ origin: { x: 0, z: 8, yaw: Math.PI }, player: p, nav, props: furniture.props }), null);
});

test('the monster grabs the blocking desk, throws it away from the player and the chase resumes', () => {
  const obstacles = bottleneck();
  const prop = makeProp('mesa-1', 0, 5);
  obstacles.push(prop.collider);
  const { hunt, furniture } = huntWithFurniture({ prop, obstacles });
  const p = player(0, 7.5);
  const s = hunt.state;
  assert.equal(routeReaches(hunt.navigation, { x: 0, z: 2 }, p), false);

  let sawThrow = false, sawFlight = false, sawAim = false, plan = null;
  let minFacing = 1, throwFrames = 0, longestThrow = 0, throwEnded = false;
  let approachSpeed = 0, approachRun = false;
  for (let i = 0; i < 240; i++) {
    hunt.update(dt, p);
    furniture.update(dt, s.carry);
    if (!s.throwing) {
      if (sawThrow) throwEnded = true;
      longestThrow = Math.max(longestThrow, throwFrames);
      throwFrames = 0;
      continue;
    }
    sawThrow = true;
    if (s.throwTime === 0) {
      // Closing on the desk must be a sprint, not a slow walk.
      approachSpeed = Math.max(approachSpeed, s.speed);
      approachRun = approachRun || s.animation === 'run';
      continue;
    }
    throwFrames++;
    if (s.throwPlan) {
      sawAim = true;
      plan = s.throwPlan;
    }
    if (furniture.props[0].state === furnitureState.flying) sawFlight = true;
    if (s.throwTime > throwRelease + .05) {
      const d = Math.hypot(p.x - s.x, p.z - s.z);
      const facing = (Math.sin(s.yaw) * (p.x - s.x) + Math.cos(s.yaw) * (p.z - s.z)) / d;
      // The one-handed fling keeps the chase heading: she whips a glove and a
      // slice of torso backwards instead of turning her back on the player.
      minFacing = Math.min(minFacing, facing);
    }
  }
  assert.ok(sawThrow, 'the blocked chase starts a throw');
  assert.ok(sawAim, 'the throw telegraphs a visible plan before the release');
  assert.ok(sawFlight, 'the desk actually flies');
  assert.ok(throwEnded, 'the one-handed throw finishes');
  assert.ok(approachSpeed > 3.5 && approachRun, 'she closes on the desk at sprint speed');
  longestThrow = Math.max(longestThrow, throwFrames);
  assert.ok(longestThrow * dt < 1.2, 'the snatch and fling is fast, not a slow two-handed lift');
  assert.ok(minFacing > .55, 'she keeps facing the chase, only whipping the torso toward the fling');
  assert.ok(plan.side === 1 || plan.side === -1, 'the plan picks the throwing glove');
  assert.ok(plan && Math.hypot(plan.to.x - prop.home.position.x, plan.to.z - prop.home.position.z) > 2,
    'the landing clears the gap');
  assert.ok(plan.to.z < 1.5, 'the clearing throw goes away from the player');
  assert.equal(furniture.props[0].state, furnitureState.rest);
  assert.equal(furniture.props[0].collider.active, undefined);
  assert.ok(Math.hypot(furniture.props[0].x, furniture.props[0].z - 5) > 2);
  assert.equal(routeReaches(hunt.navigation, { x: 0, z: 2 }, p), true, 'navigation sees the cleared gap');
  assert.ok(s.mode === 'chase' || s.mode === 'capture');
  assert.ok(s.z > 2.4, 'the monster moves on after the throw');
});

test('restarting restores every thrown prop to its home footprint and blocks the gap again', () => {
  const obstacles = bottleneck();
  const prop = makeProp('mesa-1', 0, 5);
  obstacles.push(prop.collider);
  const { hunt, furniture } = huntWithFurniture({ prop, obstacles });
  const p = player(0, 7.5);
  const s = hunt.state;
  const homeCollider = { ...prop.collider };
  const home = { ...prop.home.position };
  for (let i = 0; i < 210; i++) {
    hunt.update(dt, p);
    furniture.update(dt, s.carry);
  }
  assert.ok(Math.hypot(furniture.props[0].x - home.x, furniture.props[0].z - home.z) > 1);

  hunt.reset();
  const restored = furniture.props[0];
  assert.equal(s.throwing, false);
  assert.equal(s.carry, null);
  assert.equal(restored.state, furnitureState.rest);
  assert.equal(restored.x, home.x);
  assert.equal(restored.y, home.y);
  assert.equal(restored.z, home.z);
  assert.deepEqual(restored.group.position.toArray(), [home.x, home.y, home.z]);
  assert.deepEqual(restored.group.rotation.toArray().slice(0, 3), [0, 0, 0]);
  for (const key of ['x0', 'x1', 'z0', 'z1', 'sightTop']) {
    assert.equal(restored.collider[key], homeCollider[key], `collider.${key} restored`);
  }
  assert.equal(restored.collider.active, undefined);
  assert.equal(routeReaches(hunt.navigation, { x: 0, z: 2 }, p), false, 'the desk blocks the gap again');
  // A second run must be able to throw it again, not leave it locked.
  let threwAgain = false;
  for (let i = 0; i < 240 && !threwAgain; i++) {
    hunt.update(dt, p);
    furniture.update(dt, s.carry);
    threwAgain = s.throwing;
  }
  assert.ok(threwAgain, 'the restored furniture can block and be thrown again');
});

test('a throw collides with architecture and settles instead of clipping through it', () => {
  const wall = { x0: 1, x1: 1.2, z0: -2, z1: 2 };
  const prop = makeProp('pupitre-1', 0, 0, 1.2, .7, .8);
  const obstacles = [wall, prop.collider];
  const furniture = createFurniture({ props: [prop], obstacles });
  const item = furniture.props[0];
  const plan = {
    from: { x: 0, y: 1.6, z: 0 },
    to: { x: 3, y: .4, z: 0 },
    ground: 0,
    arc: .9,
    duration: .7,
    yaw: Math.PI / 2,
    rest: { x: 0, y: Math.PI / 2, z: Math.PI / 2, order: 'YXZ' }
  };
  const resolved = furniture.launch(item, plan);
  assert.ok(resolved);
  assert.equal(item.state, furnitureState.flying);
  for (let i = 0; i < 180 && item.state !== furnitureState.rest; i++) furniture.update(dt);
  assert.equal(item.state, furnitureState.rest, 'the desk comes to rest');
  assert.ok(item.x < wall.x0, 'the desk stopped on the near side of the wall');
  assert.equal(item.collider.active, undefined);
  assert.ok(item.collider.x1 <= wall.x0 + 1e-6, 'its resting collider does not penetrate the wall');
});

test('the planned landing is clear of architecture, away from the player, and the arc peaks under the ceiling', () => {
  const raw = makeProp('pupitre-1', 0, 5);
  const obstacles = [...bottleneck(), raw.collider];
  const furniture = createFurniture({ props: [raw], obstacles });
  const prop = furniture.props[0];
  const plan = planThrow({ prop, origin: { x: 0, z: 2.5 }, player: player(0, 7.5),
    obstacles, bounds, groundAt: () => 0 });
  assert.ok(plan);
  for (const obstacle of obstacles) {
    assert.equal(inside(obstacle, plan.to.x, plan.to.z), false, 'never lands inside a collider');
  }
  assert.ok(Math.hypot(plan.to.x - 0, plan.to.z - 7.5) >= 2);
  assert.ok(plan.ground === 0);
  const peak = throwArcPoint(plan.from, plan.to, plan.arc, .5).y;
  assert.ok(peak < 3.08, 'the arc passes under the corridor ceiling');
  assert.ok(peak > 1.8, 'the desk is released from the lifted carry height');
  assert.ok(plan.duration > .33 && plan.duration < .6, 'the fling is snappy');
  assert.ok(plan.side === 1 || plan.side === -1, 'one glove is chosen for the snatch');
  // Release timing is a single fast clock shared by animation and physics.
  assert.equal(throwPose(0).released, false);
  assert.equal(throwPose(throwRelease).released, true);
  assert.ok(throwPose(throwRelease + .05).hurl > 0);
  assert.equal(throwPose(throwDuration).hurl, 1);
  assert.ok(throwPose(throwDuration).recover === 1);
  assert.ok(throwPose(.2).lift > throwPose(.1).lift);
  // The chosen hand follows the sign of the fling side.
  assert.equal(throwPose(0, 1).side, 1);
  assert.equal(throwPose(0, -1).side, -1);
  // Home bounds are recoverable from the local box for a listed prop.
  const home = furnitureBounds(raw.localBox, raw.home.rotation, raw.home.position);
  assert.ok(Math.abs(home.x0 - raw.collider.x0) < 1e-6);
  assert.ok(Math.abs(home.z1 - raw.collider.z1) < 1e-6);
  assert.equal(prop.state, furnitureState.rest);
});

function makeRig() {
  const root = new Group();
  root.position.z = -15;
  const torso = new Group();
  torso.position.set(0, .69, 0);
  root.add(torso);
  const wings = [-1, 1].map(s => {
    const wing = new Group();
    wing.position.set(s * .22, 1.04, -.186);
    torso.add(wing);
    return wing;
  });
  const antennae = [-1, 1].map(s => {
    const antenna = new Group();
    antenna.position.set(s * .31, 1.33, -.018);
    torso.add(antenna);
    return antenna;
  });
  const arms = [-1, 1].map(s => {
    const shoulder = new Group();
    shoulder.position.set(s * .51, .62, -.055);
    const elbow = new Group();
    elbow.position.set(s * .275, -.012, 0);
    const hand = new Group();
    hand.position.set(s * .246, .014, .012);
    const palm = new Group();
    palm.rotation.x = -.36;
    const tip = new Group();
    tip.position.set(s * .32, 0, 0);
    palm.add(tip);
    hand.add(palm);
    elbow.add(hand);
    shoulder.add(elbow);
    torso.add(shoulder);
    return { shoulder, elbow, hand, palm, tip };
  });
  const legs = [-1, 1].map(s => {
    const hip = new Group();
    hip.position.set(s * .237, .026, -.008);
    const knee = new Group();
    knee.position.set(s * .013, -.255, -.008);
    const ankle = new Group();
    ankle.position.set(s * .026, .205 - (.69 + .026 - .255), .018);
    const foot = new Group();
    foot.position.set(0, -.205, 0);
    foot.rotation.y = s * .17;
    ankle.add(foot);
    knee.add(ankle);
    hip.add(knee);
    torso.add(hip);
    return { hip, knee, ankle, foot };
  });
  const shadow = new Group();
  shadow.position.y = .002;
  root.add(shadow);
  const footShadows = [0, 1].map(() => {
    const footShadow = new Group();
    footShadow.material = { opacity: 1 };
    root.add(footShadow);
    return footShadow;
  });
  return { root, torso, arms, legs, animator: makeAnimator({ torso, wings, antennae, arms, legs, shadow, footShadows }) };
}

const soleCorners = [
  new Vector3(-.145, 0, -.123), new Vector3(.145, 0, -.123),
  new Vector3(-.145, 0, .302), new Vector3(.145, 0, .302)
];

test('the one-handed snatch-and-fling pose dips, yanks and whips the desk backwards', () => {
  const rig = makeRig();
  const hand = new Vector3(), shoulder = new Vector3();
  const active = 1; // the right glove performs the snatch
  let minSole = Infinity;
  function sample(t, side = 1) {
    const pose = throwPose(t, side);
    for (let i = 0; i < 12; i++) {
      rig.animator.update(1 / 60, false, Infinity, null, { stridePhase: 0, throw: pose });
    }
    rig.root.updateMatrixWorld(true);
    for (const leg of rig.legs) {
      for (const corner of soleCorners) {
        minSole = Math.min(minSole, leg.foot.localToWorld(corner.clone()).y);
      }
    }
    rig.arms[active].hand.getWorldPosition(hand);
    rig.arms[active].shoulder.getWorldPosition(shoulder);
    return { dy: hand.y - shoulder.y, dz: hand.z - shoulder.z };
  }
  const grab = sample(.12);
  const lift = sample(.22);
  const hurl = sample(.36);
  assert.ok(grab.dy < -.15, 'the single glove lunges down onto the desk');
  assert.ok(grab.dz > 0, 'and reaches forward to snatch it');
  assert.ok(lift.dy > .20, 'the desk is yanked up beside the shoulder');
  assert.ok(hurl.dz < -.2, 'the hurl whips the throwing glove backwards');
  assert.ok(hurl.dy < lift.dy - .4, 'and back down through the fling');
  assert.ok(minSole >= -1e-5, 'the throw never sinks the shoes');
  assert.equal(rig.root.position.z, -15);
  assert.equal(rig.torso.position.x, 0);
  assert.equal(rig.torso.position.z, 0);
  // The off-hand counter-balances forward instead of helping with the yank.
  rig.root.updateMatrixWorld(true);
  const offHand = rig.arms[0].hand.getWorldPosition(new Vector3());
  const offShoulder = rig.arms[0].shoulder.getWorldPosition(new Vector3());
  assert.ok(offHand.z > offShoulder.z + .1, 'the free glove flares forward as a counterweight');
  // The left-handed fling mirrors the right-handed one.
  sample(.36, -1);
  rig.root.updateMatrixWorld(true);
  const leftHand = rig.arms[0].hand.getWorldPosition(new Vector3());
  const leftShoulder = rig.arms[0].shoulder.getWorldPosition(new Vector3());
  assert.ok(leftHand.z - leftShoulder.z < -.2, 'the left glove can hurl it too');
  // Reduced motion keeps sampling the throw instead of freezing the gloves.
  const hurlPose = throwPose(.36);
  assert.equal(rig.animator.animating(true), true);
  for (let i = 0; i < 10; i++) {
    rig.animator.update(1 / 60, true, Infinity, null, { stridePhase: 0, throw: hurlPose });
  }
  rig.root.updateMatrixWorld(true);
  const hurlHand = rig.arms[active].hand.getWorldPosition(new Vector3());
  const hurlShoulder = rig.arms[active].shoulder.getWorldPosition(new Vector3());
  assert.ok(hurlHand.z < hurlShoulder.z - .2, 'reduced motion still shows the backward fling');
});
