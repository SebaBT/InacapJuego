import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { createDoorController } from '../src/doors.js';
import { createMonsterNavigation } from '../src/monster-navigation.js';
import { captureDuration, capturePose, createMonsterHunt } from '../src/monster-hunt.js';
import { createCaptureShot } from '../src/monster-capture.js';
import { playerNoiseRadius } from '../src/player-motion.js';

const dt = 1 / 60;
const player = (x, z, extra) => ({ x, z, cameraY: 1.61, active: true, jump: { height: 0 }, ...extra });
const makeHunt = (obstacles = []) => createMonsterHunt({ spawn: { x: 0, z: 0, yaw: 0 },
  obstacles, doors: [], patrolPoints: [{ x: 0, z: 12 }] });

test('hearing uses discrete contacts, with short walks, longer sprints and landings, and silent crouching', () => {
  const walk = { stepEvent: .7 }, run = { ...walk, isSprinting: true };
  const radius = playerNoiseRadius(walk);
  assert.ok(radius > 2 && radius < 6);
  assert.equal(playerNoiseRadius({ isSprinting: true }), 0);
  for (const event of [run, { justJumped: true }, { justLanded: true }, { justLanded: true, landedHeavy: true }]) {
    assert.ok(playerNoiseRadius(event) > radius);
    assert.equal(playerNoiseRadius({ ...event, isCrouching: true }), 0);
  }
  function reaction(distance, event) {
    return makeHunt().update(dt, player(0, -distance, { noiseRadius: playerNoiseRadius(event) })).mode;
  }
  assert.equal(reaction(3, walk), 'investigate');
  assert.equal(reaction(7, walk), 'patrol');
  assert.equal(reaction(7, run), 'investigate');
  assert.equal(reaction(2, { ...run, isCrouching: true }), 'patrol');
});

test('sight starts a run and a cry, then an occluded silent player can leave the last known position', () => {
  const wall = { x0: -3.60, x1: 3.60, z0: 9, z1: 9.18 };
  const hunt = makeHunt([wall]), p = player(0, 8);
  const s = hunt.update(dt, p);
  assert.equal(s.mode, 'chase');
  assert.equal(s.scream, 'alert');
  assert.equal(s.animation, 'run');
  assert.deepEqual(s.lastKnown, { x: 0, z: 8 });
  Object.assign(p, { x: 2.4, z: 11 });
  hunt.update(dt, p);
  assert.equal(s.visible, false);
  assert.deepEqual(s.lastKnown, { x: 0, z: 8 });
  for (let i = 0; i < 660; i++) hunt.update(dt, p);
  assert.equal(s.mode, 'patrol');
  assert.equal(s.lastKnown, null);
  assert.ok(s.z < 9);
  assert.equal(makeHunt().update(dt, player(0, 20)).mode, 'patrol');
  assert.equal(makeHunt().update(dt, player(0, -6)).mode, 'patrol');
});

test('a reachable route goes around a furnished obstruction without cutting its corners', () => {
  const desk = { x0: -.55, x1: .55, z0: -.7, z1: .7, sightTop: .85 };
  const nav = createMonsterNavigation([desk], []);
  const start = { x: 0, z: -3 }, goal = { x: 0, z: 3 };
  const path = nav.route(start, goal);
  assert.ok(path.length >= 3);
  assert.deepEqual(path.at(-1), goal);
  let prev = start;
  for (const node of path) {
    for (let i = 0; i <= 30; i++) {
      const x = prev.x + (node.x - prev.x) * i / 30, z = prev.z + (node.z - prev.z) * i / 30;
      assert.ok(Math.abs(x) >= 1.25 || Math.abs(z) >= 1.4);
    }
    prev = node;
  }
  assert.equal(nav.visible({ ...start, y: 1.72 }, { ...goal, y: 1.61 }), true);
  assert.equal(nav.visible({ ...start, y: .72 }, { ...goal, y: .64 }), false);
});

test('running footfalls, capture, pause, death and retry advance once on the gameplay clock', () => {
  const hunt = makeHunt(), p = player(0, 7), s = hunt.state;
  let beats = 0, alerts = 0, screams = 0;
  for (let i = 0; i < 180 && s.mode !== 'capture'; i++) {
    hunt.update(dt, p); beats += Math.abs(s.stomp); alerts += Number(s.scream === 'alert');
  }
  assert.equal(s.mode, 'capture');
  assert.ok(beats >= 4);
  assert.equal(alerts, 1);
  const atContact = { x: s.x, z: s.z };
  for (const paused of [{ active: false }, { noclip: true }]) {
    hunt.update(.4, { ...p, ...paused });
    assert.equal(s.captureTime, 0);
  }
  for (let i = 0; i < 210; i++) {
    hunt.update(dt, p);
    screams += Number(s.scream === 'capture');
    assert.deepEqual({ x: s.x, z: s.z }, atContact);
    assert.equal(s.stomp, 0);
  }
  assert.equal(s.mode, 'dead');
  assert.equal(screams, 1);
  assert.equal(capturePose(s.captureTime).fade, 1);
  hunt.reset();
  assert.equal(s.mode, 'patrol');
  assert.equal(s.lastKnown, null);
  assert.equal(s.z, 0);
  assert.equal(s.fold + s.captureTime + s.stridePhase, 0);
  const wall = { x0: -3, x1: 3, z0: .32, z1: .39 };
  assert.notEqual(makeHunt([wall]).update(dt, player(0, .7)).mode, 'capture');
  assert.notEqual(makeHunt().update(dt, player(0, .7, { cameraY: 3, jump: { height: 1.4 } })).mode, 'capture');
});

test('capture pulls the victim to the moving gloves, frames both views and fades after the lift', () => {
  const actor = { gripCenter: out => out.set(0, 1.57, .65), facePosition: out => out.set(0, 1.76, .19) };
  for (const third of [0, 1]) {
    const p = player(0, .98, { yaw: 0, bodyYaw: 0, thirdPersonBlend: third, crouchAmount: 0 });
    const camera = new PerspectiveCamera(64), s = { yaw: 0, y: 0 };
    camera.position.set(0, 1.61, .98 + 2 * third);
    const shot = createCaptureShot(camera, p);
    const middle = capturePose(1.3);
    const victim = shot(actor, s, middle, [], false);
    assert.equal(middle.grip, 1);
    assert.equal(middle.fade, 0);
    // The third-person avatar is held at the fingertips, with its head
    // farther from the mask than the first-person camera.
    const expectedVictimZ = third ? .99 : .81;
    assert.ok(Math.abs(victim.z - expectedVictimZ) < 1e-6);
    assert.ok(victim.jump.height > .25);
    assert.equal(victim.headOpacity, third);
    const gaze = camera.getWorldDirection(new Vector3());
    assert.ok(gaze.dot(new Vector3(0, 1.76, .19).sub(camera.position).normalize()) > .94);
    assert.equal(capturePose(captureDuration).fade, 1);
  }
});

test('a player wedged into a 90-degree corner is approached and caught instead of stared at', () => {
  // A corridor pocket: a wall run above and a pier to the right, so the body
  // sits 0.25 m from both faces and every single-axis graph projection lands
  // back inside the perpendicular wall.
  const walls = [
    { x0: 0, x1: 3.6, z0: 10, z1: 10.6 },
    { x0: 3.4, x1: 4.0, z0: 6, z1: 10.6 }
  ];
  const p = player(3.15, 9.75);
  const hunt = createMonsterHunt({ spawn: { x: 0.5, z: 6.5, yaw: Math.atan2(2.65, 3.25) },
    obstacles: walls, doors: [], patrolPoints: [{ x: 0.5, z: 6.5 }] });
  const end = hunt.navigation.route(hunt.state, p).at(-1);
  assert.ok(end, 'the graph produced no route to the corner');
  assert.ok(Math.hypot(end.x - p.x, end.z - p.z) < 1.1,
    'the visibility graph never reaches the corner pocket: ' + JSON.stringify(end));

  const s = hunt.state, growls = [];
  let captured = -1;
  for (let i = 0; i < 600 && captured < 0; i++) {
    hunt.update(dt, p);
    if (s.growl) growls.push(s.growl);
    if (s.mode === 'capture') captured = i;
  }
  assert.ok(captured > 0, 'the monster stalled in front of the corner: ' +
    JSON.stringify({ x: s.x, z: s.z, mode: s.mode, animation: s.animation }));
  assert.ok(Math.hypot(s.x - p.x, s.z - p.z) <= 1.38);
  assert.ok(growls.includes('snarl'), 'the chase never growled');
});

test('a player hiding behind an open classroom leaf is flushed out by a door slam', () => {
  // The real classroom doorway at room 101, rebuilt without the rest of the
  // corridor: hinge at (3.703, 19.51), leaf swinging into the room.
  const doorObstacle = { x0: 3.6, x1: 3.77, z0: 19.44, z1: 20.56, active: false };
  const leaf = { kind: 'segment', ax: 3.703, az: 19.51, bx: 3.703, bz: 20.49, halfThick: .034,
    x0: 3.669, x1: 3.737, z0: 19.476, z1: 20.524, active: true };
  const door = {
    id: '101', label: 'Sala 101', locked: false, open: 1, targetOpen: 1, rattle: 0, slam: 0, bounce: 0,
    pos: { x: 3.69, y: 1.15, z: 20 }, threshold: { x0: 3.46, x1: 3.91, z0: 19.44, z1: 20.56 },
    pivots: [{
      group: { rotation: { y: 0 } }, hand: 1, maxAngle: 1.76,
      hx: 3.703, hz: 19.51, length: .98, closedDirX: 0, closedDirZ: 1, swingDirX: 1, swingDirZ: 0,
      obstacle: leaf
    }],
    handles: [], obstacle: doorObstacle
  };
  const obstacles = [
    { x0: 3.6, x1: 3.77, z0: 14.4, z1: 19.44 },
    { x0: 3.6, x1: 3.77, z0: 20.56, z1: 25.6 },
    doorObstacle, leaf
  ];
  const ctrl = createDoorController({ doors: [door], audio: {} });
  ctrl.update(dt, null, false);
  let slammed = 0, minOpen = 1;
  const hunt = createMonsterHunt({ obstacles, doors: [door], holdDoor: ctrl.holdForMonster,
    closeDoor: d => { if (ctrl.closeForMonster(d)) slammed++; },
    spawn: { x: 1.2, z: 20.3, yaw: Math.atan2(1.8, 0) }, patrolPoints: [{ x: 1.2, z: 20.3 }] });
  const p = player(3.0, 20.3);
  const s = hunt.state;
  hunt.update(dt, p);
  assert.equal(s.mode, 'chase');
  // Step into the pocket between the open leaf and the wall run.
  Object.assign(p, { x: 4.4, z: 19.2 });
  let captured = -1;
  // The suit is allowed to grab as soon as the leaf is mostly shut, so keep the
  // door controller running past the capture to prove the slam completes.
  for (let i = 0; i < 900 && !(captured >= 0 && i > captured + 90); i++) {
    ctrl.update(dt, null, false);
    hunt.update(dt, p);
    minOpen = Math.min(minOpen, door.open);
    if (s.mode === 'capture' && captured < 0) captured = i;
  }
  assert.ok(slammed >= 1, 'the suit never tried to shut the door');
  assert.ok(minOpen < .25, 'the leaf never slammed shut');
  assert.ok(captured > 0, 'the suit stayed in front of the hiding spot: ' +
    JSON.stringify({ x: s.x, z: s.z, mode: s.mode, animation: s.animation }));
  assert.ok(Math.hypot(s.x - p.x, s.z - p.z) <= 1.38);
});

test('a chase that follows the player into room 101 folds through the doorway instead of crossing the wall', () => {
  // The reported bug: the player hides behind room 101's open leaf and the
  // suit, still in the corridor, walked straight at the stand spot inside the
  // room, cutting through the corridor wall before it had folded.
  const r101 = { x0: 3.60, x1: 13.4, z0: 14.4, z1: 25.6, doorZ: 20 };
  const doorObstacle = { x0: 3.6, x1: 3.77, z0: 19.44, z1: 20.56, active: false };
  const leaf = { kind: 'segment', ax: 3.703, az: 19.51, bx: 3.703, bz: 20.49, halfThick: .034,
    x0: 3.669, x1: 3.737, z0: 19.476, z1: 20.524, active: true };
  const door = {
    id: '101', label: 'Sala 101', locked: false, open: 1, targetOpen: 1, rattle: 0, slam: 0, bounce: 0,
    pos: { x: 3.69, y: 1.15, z: 20 }, threshold: { x0: 3.46, x1: 3.91, z0: 19.44, z1: 20.56 },
    pivots: [{
      group: { rotation: { y: 0 } }, hand: 1, maxAngle: 1.76,
      hx: 3.703, hz: 19.51, length: .98, closedDirX: 0, closedDirZ: 1, swingDirX: 1, swingDirZ: 0,
      obstacle: leaf
    }],
    handles: [], obstacle: doorObstacle
  };
  const obstacles = [
    { x0: 3.6, x1: 3.77, z0: 14.4, z1: 19.44 },
    { x0: 3.6, x1: 3.77, z0: 20.56, z1: 25.6 },
    doorObstacle, leaf
  ];
  const ctrl = createDoorController({ doors: [door], audio: {} });
  ctrl.update(dt, null, false);
  let slammed = 0;
  const hunt = createMonsterHunt({ obstacles, doors: [door], holdDoor: ctrl.holdForMonster,
    closeDoor: d => { if (ctrl.closeForMonster(d)) slammed++; },
    spawn: { x: 1.2, z: 16.5, yaw: Math.atan2(1.2, 2.1) }, patrolPoints: [{ x: 1.2, z: 16.5 }] });
  const p = player(2.4, 18.6);
  const s = hunt.state;
  hunt.update(dt, p);
  assert.equal(s.mode, 'chase');
  // Run into room 101 and tuck into the pocket behind the open leaf.
  Object.assign(p, { x: 4.15, z: 19.35 });
  let folded = false, unfoldedInside = false, captured = -1;
  const prev = { x: s.x, z: s.z };
  for (let i = 0; i < 900 && captured < 0; i++) {
    Object.assign(prev, { x: s.x, z: s.z });
    ctrl.update(dt, null, false);
    hunt.update(dt, p);
    // The wall plane may only be crossed folded, through the open doorway.
    const wallBand = s.x > 3.60 - .35 && s.x < 3.77 + .35 && Math.abs(s.z - r101.doorZ) < .56;
    if (wallBand) {
      assert.equal(s.fold, 1, `the suit stood in the doorway wall unfolded at frame ${i}: ` +
        JSON.stringify({ x: s.x, z: s.z, fold: s.fold, mode: s.mode }));
    }
    // Even a step that skips over the 17 cm masonry must be folded and land
    // inside the opening, never somewhere along the blank corridor wall.
    if (Math.abs(s.x - prev.x) > 1e-9) {
      for (const plane of [3.60, 3.77]) {
        const between = (prev.x <= plane && s.x >= plane) || (prev.x >= plane && s.x <= plane);
        if (!between) continue;
        const z = prev.z + (s.z - prev.z) * ((plane - prev.x) / (s.x - prev.x));
        assert.equal(s.fold, 1, `the suit crossed the corridor wall unfolded at frame ${i}: ` +
          JSON.stringify({ x: s.x, z, fold: s.fold, mode: s.mode }));
        assert.ok(Math.abs(z - r101.doorZ) < .56,
          `the suit crossed the corridor wall outside the doorway at frame ${i}: ` +
          JSON.stringify({ x: plane, z, prev: { ...prev } }));
      }
    }
    if (s.fold === 1) folded = true;
    if (folded && s.fold === 0 && s.x > 3.77) unfoldedInside = true;
    if (s.mode === 'capture') captured = i;
  }
  assert.ok(folded, 'the suit never folded to use the doorway');
  assert.ok(unfoldedInside, 'the suit never unfolded inside room 101');
  assert.ok(slammed >= 1, 'the suit never slammed the open leaf shut');
  assert.ok(captured > 0, 'the suit never reached the pocket behind the door: ' +
    JSON.stringify({ x: s.x, z: s.z, mode: s.mode, fold: s.fold }));
  assert.ok(s.x > 3.77, 'the capture did not happen inside room 101');
  assert.ok(Math.hypot(s.x - p.x, s.z - p.z) <= 1.38);
});

test('walking the patrol, the search and the chase shakes the floor and growls', () => {
  // A pier behind the suit hides the player, so the noise is the only contact.
  const pier = { x0: -3.6, x1: 3.6, z0: -2.1, z1: -1.95 };
  const hunt = createMonsterHunt({ spawn: { x: 0, z: 0, yaw: 0 }, obstacles: [pier], doors: [],
    patrolPoints: [{ x: 0, z: 12 }] });
  const p = player(0, -6);
  const stomps = [], growls = [];
  for (let i = 0; i < 300; i++) {
    const s = hunt.update(dt, p);
    if (s.stomp) stomps.push(s.stomp);
    if (s.growl) growls.push(s.growl);
  }
  assert.equal(hunt.state.mode, 'patrol');
  assert.ok(stomps.length >= 3, 'the stalking suit made no footfalls');
  assert.ok(stomps.every(v => Math.abs(v) > 0), 'a stride reported no stomp');
  assert.ok(stomps.some(v => Math.abs(v) === .65), 'walking should land lighter than a run');
  assert.ok(growls.includes('prowl'), 'no prowl while walking: ' + growls.join(','));

  // A heard step pulls it into the investigation; it keeps talking to itself.
  p.noiseRadius = 30;
  hunt.update(dt, p);
  p.noiseRadius = 0;
  assert.equal(hunt.state.mode, 'investigate');
  growls.length = 0;
  for (let i = 0; i < 400; i++) {
    const s = hunt.update(dt, p);
    if (s.growl) growls.push(s.growl);
  }
  assert.ok(growls.includes('rasp'), 'no rasp while searching: ' + growls.join(','));
});

// A throwable prop shaped like the ones the real furniture hands to the hunt.
const movableProp = (id, kind, x, z, half = .45, height = .82) => {
  const collider = { x0: x - half, x1: x + half, z0: z - half, z1: z + half,
    sightTop: height, movable: true, propId: id };
  return {
    id, kind, collider,
    localBox: { x0: -half, x1: half, y0: 0, y1: height, z0: -half, z1: half },
    size: { x: half * 2, y: height, z: half * 2 },
    radius: Math.hypot(half * 2, half * 2) / 2,
    group: { rotation: { y: 0 }, position: { x, y: 0, z } },
    home: { position: { x, y: 0, z }, rotation: { y: 0 } },
    state: 'rest', x, y: 0, z
  };
};
// The smallest furniture owner the hunt talks to: props, grab and launch.
const furnitureOwner = list => {
  const owner = {
    props: list, held: null, grabs: 0,
    reset() { owner.held = null; for (const item of list) item.state = 'rest'; },
    grab(item) {
      if (!item || item.state !== 'rest') return null;
      item.state = 'held'; owner.held = item; owner.grabs++;
      return item;
    },
    launch(item) { if (item) item.state = 'rest'; owner.held = null; return null; }
  };
  return owner;
};
// A 3 m aisle: wide enough for the body, too narrow to pass a crate's padding.
const aisle = () => [
  { x0: -3.6, x1: -1.5, z0: .5, z1: 6.2 },
  { x0: 1.5, x1: 3.6, z0: .5, z1: 6.2 }
];

test('a crate blocking the only lane is snatched and thrown clear instead of circled', () => {
  // A chest-high crate dropped in the aisle: the padded body cannot squeeze
  // past it, so the route dead-ends before the player and the suit must clear
  // the lane with its hands rather than walking a long way round.
  const crate = movableProp('caja-1', 'caja', 0, 2.6, .45, .82);
  const furniture = furnitureOwner([crate]);
  const hunt = createMonsterHunt({ spawn: { x: 0, z: 0, yaw: 0 },
    obstacles: [...aisle(), crate.collider], doors: [], patrolPoints: [{ x: 0, z: 0 }], furniture });
  const p = player(0, 5);
  const s = hunt.state;
  let threw = false;
  for (let i = 0; i < 180; i++) {
    hunt.update(dt, p);
    if (s.throwing && s.throwPropId === 'caja-1') threw = true;
  }
  assert.ok(threw, 'the suit never picked the crate up: ' +
    JSON.stringify({ x: s.x, z: s.z, mode: s.mode }));
  assert.ok(furniture.grabs >= 1, 'the crate was never actually grabbed');
  assert.ok(Math.abs(s.x) < 1.5, 'the suit left the lane instead of clearing it');
});

test('a stool on the snatch line and a desk wedged beside the target never veto the throw', () => {
  // The route is dead-ended by the aisle crate, so the suit decides to clear
  // the line. A stool sits directly between it and the desk, and a baked desk
  // stands beside the throwable one: the long arms still take the desk.
  const blocker = { x0: -.45, x1: .45, z0: 2.15, z1: 3.05, sightTop: .82 };
  const stool = { x0: .18, x1: .42, z0: .43, z1: .67, sightTop: .45 };
  const neighbour = { x0: -1.4, x1: -.85, z0: .6, z1: 1.4, sightTop: .78 };
  const desk = movableProp('mesa-1', 'mesa', .55, 1.1, .35, .78);
  const furniture = furnitureOwner([desk]);
  const hunt = createMonsterHunt({ spawn: { x: 0, z: 0, yaw: 0 },
    obstacles: [...aisle(), blocker, stool, neighbour, desk.collider], doors: [],
    patrolPoints: [{ x: 0, z: 0 }], furniture });
  const p = player(0, 5);
  const s = hunt.state;
  hunt.update(dt, p);
  assert.equal(s.throwing, true, 'the stool vetoed the snatch: ' +
    JSON.stringify({ x: s.x, z: s.z, mode: s.mode, visible: s.visible }));
  assert.equal(s.throwPropId, 'mesa-1');
  for (let i = 0; i < 120; i++) hunt.update(dt, p);
  assert.ok(furniture.grabs >= 1, 'the desk was never actually grabbed');
});

test('a crouched body pressed against chest-high furniture stays visible at arm’s length', () => {
  const eye = { x: 0, y: 1.72, z: 0 };
  // Two metres away behind a 1.55 m shelf: the crouched eye ray and the head
  // ray both die on the rim, while her raised head/chest line clears it.
  const shelf = { x0: -1, x1: 1, z0: 1.1, z1: 1.5, sightTop: 1.55 };
  assert.equal(createMonsterNavigation([shelf], []).visible(eye, { x: 0, y: 1.19, z: 2 }),
    true, 'the close raised line did not find the crouched body');
  // Pressed right against the same furniture the last metre and a half ignores
  // anything under head height, so even a taller rim cannot hide her.
  const rim = { x0: -1, x1: 1, z0: .7, z1: 1.0, sightTop: 1.62 };
  const nav = createMonsterNavigation([rim], []);
  assert.equal(nav.visible(eye, { x: 0, y: 1.19, z: 1.2 }), true,
    'a chest-high rim hid a body pressed into it');
  // A full-height panel still hides her: the arms are not a wall-piercer.
  const panel = { x0: -1, x1: 1, z0: .7, z1: 1.0, sightTop: 1.9 };
  assert.equal(createMonsterNavigation([panel], []).visible(eye, { x: 0, y: 1.19, z: 1.2 }), false,
    'a full-height panel should still hide a crouched body');
});

test('a crouched player pressed against a crate is grabbed at arm’s length, never stood on', () => {
  // A low crate with a crouched body crushed against its far face. The body
  // must stop beside her instead of on top of her, and the grab must still land
  // over the crate once she can be taken.
  const crate = { x0: -.9, x1: .9, z0: 2.05, z1: 2.85, sightTop: .82 };
  const hunt = createMonsterHunt({ spawn: { x: 0, z: 4.8, yaw: Math.PI },
    obstacles: [crate], doors: [], patrolPoints: [{ x: 0, z: 4.8 }] });
  const p = player(0, 1.95, { cameraY: 1.19, crouchAmount: 1 });
  const s = hunt.state;
  let closest = Infinity;
  // Mid-hop she is out of reach for a moment: the body still may not walk into
  // the space she occupies while it rounds the crate.
  p.jump.height = 1.2;
  for (let i = 0; i < 90; i++) {
    hunt.update(dt, p);
    closest = Math.min(closest, Math.hypot(s.x - p.x, s.z - p.z));
  }
  assert.ok(closest >= .58, 'the suit walked into the crouched body: ' + closest.toFixed(3));
  // She lands: the grab happens on the spot, without a step over her.
  p.jump.height = 0;
  let captured = -1;
  for (let i = 0; i < 240 && captured < 0; i++) {
    hunt.update(dt, p);
    closest = Math.min(closest, Math.hypot(s.x - p.x, s.z - p.z));
    if (s.mode === 'capture') captured = i;
  }
  assert.ok(captured >= 0, 'the crouched player was never grabbed: ' +
    JSON.stringify({ x: s.x, z: s.z, mode: s.mode, visible: s.visible }));
  assert.equal(s.mode, 'capture');
  assert.ok(Math.hypot(s.x - p.x, s.z - p.z) <= 1.38);
  assert.ok(closest >= .58, 'the suit stood on the crouched body: ' + closest.toFixed(3));

  // Held off the grab for a moment, the body still may not walk through her:
  // the route ends on her exact point, so only the step guard keeps it clear.
  const open = createMonsterHunt({ spawn: { x: 0, z: 4.4, yaw: Math.PI },
    obstacles: [], doors: [], patrolPoints: [{ x: 0, z: 4.4 }] });
  const q = player(0, 2.2, { cameraY: 1.19, crouchAmount: 1, jump: { height: 1.3 } });
  const walker = open.state;
  let near = Infinity;
  for (let i = 0; i < 150; i++) {
    open.update(dt, q);
    near = Math.min(near, Math.hypot(walker.x - q.x, walker.z - q.z));
  }
  assert.ok(near >= .58, 'the suit stepped into the crouched body: ' + near.toFixed(3));
  q.jump.height = 0;
  let grabbed = -1;
  for (let i = 0; i < 60 && grabbed < 0; i++) {
    open.update(dt, q);
    if (walker.mode === 'capture') grabbed = i;
  }
  assert.ok(grabbed >= 0, 'the suit never grabbed the body it was leaning over');
});
