import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { PerspectiveCamera, Raycaster, Scene, ShaderMaterial, Vector3 } from 'three';
import { createAtmosphere } from '../src/atmosphere.js';
import { createCinematics } from '../src/cinematics.js';
import { buildCorridor } from '../src/corridor.js';
import {
  allGateLocksUnlocked,
  computeEscalation,
  countGateLocksUnlocked,
  createMatchState,
  formatCountdown,
  GAME_PHASES,
  KEY_ITEMS,
  LORE_ITEMS,
  MATCH_MAX_SECONDS,
  OUTCOMES,
  POINT_OF_NO_RETURN_SECONDS,
  resetMatchState,
  resolveEscapeOutcome,
  stepMatchTimer
} from '../src/game-state.js';
import {
  createHandViewModel,
  createInventory,
  createWorldItems,
  EQUIP_SLOTS,
  ITEM_CATALOG,
  WORLD_ITEM_PLACEMENTS
} from '../src/items.js';
import { createObjectiveGuide } from '../src/objectives.js';
import { movePlayer } from '../src/walk.js';
import { landing, stairs, worldBounds } from '../src/layout.js';
import { createDestruction } from '../src/destruction.js';
import { createMonsterHunt } from '../src/monster-hunt.js';
import { createStaminaState, SPRINT_SPEED, stepStamina } from '../src/player-motion.js';
import { makeTexturesAsync } from '../src/textures.js';

function withCanvasStub(fn) {
  const noop = () => {};
  const gradient = () => ({ addColorStop: noop });
  const ctx = new Proxy({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createLinearGradient: gradient,
    createRadialGradient: gradient
  }, { get: (target, key) => target[key] ?? noop });
  const prev = globalThis.document;
  globalThis.document = {
    createElement: () => ({ width: 1, height: 1, getContext: () => ctx })
  };
  const restore = () => {
    globalThis.document = prev;
  };
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      return res.finally(restore);
    }
    restore();
    return res;
  } catch (err) {
    restore();
    throw err;
  }
}

function stubMaterial(texture, options = {}) {
  const m = new ShaderMaterial();
  m.userData = { ...options, repeatMeters: options.repeat };
  return m;
}

test('match state enforces 2:00 Point of No Return and hard 3:00 maximum limit', () => {
  assert.equal(POINT_OF_NO_RETURN_SECONDS, 120);
  assert.equal(MATCH_MAX_SECONDS, 180);

  const match = createMatchState();
  assert.equal(stepMatchTimer(match, 10).hitPointOfNoReturn, false);
  assert.equal(match.elapsed, 0);

  match.phase = GAME_PHASES.PLAYING;
  for (let i = 0; i < 1195; i++) {
    stepMatchTimer(match, 0.1);
  }
  assert.equal(match.pointOfNoReturn, false);

  let ponr = { hitPointOfNoReturn: false };
  for (let i = 0; i < 6 && !ponr.hitPointOfNoReturn; i++) {
    ponr = stepMatchTimer(match, 0.1);
  }
  assert.equal(ponr.hitPointOfNoReturn, true);
  assert.equal(match.pointOfNoReturn, true);
  assert.equal(formatCountdown(120), '01:00');

  for (let i = 0; i < 650; i++) {
    stepMatchTimer(match, 0.1);
  }
  assert.equal(match.elapsed, 180);
  assert.equal(formatCountdown(match.elapsed), '00:00');
  const fin = stepMatchTimer(match, 0.1);
  assert.equal(fin.hitTimeout, true);

  resetMatchState(match);
  assert.equal(match.elapsed, 0);
  assert.equal(match.pointOfNoReturn, false);
});

test('aggressive difficulty curve escalates speed, vision, wear and unlocks 2 ending tiers', () => {
  const startEsc = computeEscalation({ elapsed: 0, keysCollected: 0, pointOfNoReturn: false });
  const midEsc = computeEscalation({ elapsed: 65, keysCollected: 2, pointOfNoReturn: false });
  const frenzyEsc = computeEscalation({ elapsed: 135, keysCollected: 2, pointOfNoReturn: true });

  assert.equal(startEsc.frenzy, false);
  assert.ok(midEsc.chaseSpeed > startEsc.chaseSpeed);
  assert.ok(midEsc.sightRange > startEsc.sightRange);
  assert.ok(midEsc.suitWearMin > startEsc.suitWearMin);

  assert.deepEqual([startEsc.stage, computeEscalation({ elapsed: 60 }).stage, midEsc.stage, frenzyEsc.stage], [0, 1, 2, 3]);
  assert.equal(frenzyEsc.frenzy, true);
  assert.ok(frenzyEsc.chaseSpeed >= 4.5);
  assert.ok(frenzyEsc.sightRange >= 28);
  assert.ok(frenzyEsc.hearingMult >= 1.8);

  assert.equal(resolveEscapeOutcome(0), OUTCOMES.VICTORY);
  assert.equal(resolveEscapeOutcome(2), OUTCOMES.VICTORY);
  assert.equal(resolveEscapeOutcome(LORE_ITEMS.length), OUTCOMES.VICTORY_COMPLETE);

  const locks = { fuse: true, masterKey: true, boltCutters: false };
  assert.equal(countGateLocksUnlocked(locks), 2);
  assert.equal(allGateLocksUnlocked(locks), false);
  locks.boltCutters = true;
  assert.equal(allGateLocksUnlocked(locks), true);
});

test('all physical items exist inside worldBounds, populate equipable inventory, and drive adrenaline stamina', () => withCanvasStub(() => {
  assert.equal(WORLD_ITEM_PLACEMENTS.length, 12);
  for (const k of KEY_ITEMS) {
    assert.ok(WORLD_ITEM_PLACEMENTS.some(p => p.kind === k));
  }
  for (const t of LORE_ITEMS) {
    assert.ok(WORLD_ITEM_PLACEMENTS.some(p => p.kind === t));
  }
  for (const p of WORLD_ITEM_PLACEMENTS) {
    assert.ok(p.x >= worldBounds.minX && p.x <= worldBounds.maxX);
    assert.ok(p.z >= worldBounds.minZ && p.z <= worldBounds.maxZ);
    assert.ok(ITEM_CATALOG[p.kind]);
  }

  const scene = new Scene();
  const world = createWorldItems({ scene, makeMaterial: stubMaterial });
  const hand = createHandViewModel({ scene, makeMaterial: stubMaterial });
  const inv = createInventory();

  assert.equal(inv.slots.length, EQUIP_SLOTS.length);
  const fuseItem = world.items.find(it => it.kind === 'fuse');
  const aimAtFuse = {
    x: fuseItem.x,
    cameraY: 1.6,
    z: fuseItem.z + 1.4,
    yaw: 0,
    pitch: Math.atan2(fuseItem.y + 0.08 - 1.6, 1.4)
  };
  const hit = world.findTarget(aimAtFuse);
  assert.equal(hit?.item.id, fuseItem.id);

  assert.equal(world.collect(fuseItem), true);
  assert.equal(fuseItem.collected, true);
  assert.equal(fuseItem.group.visible, false);

  inv.add('fuse');
  inv.add('energy');
  inv.add('tape1');
  assert.equal(inv.tapesCount, 1);
  assert.equal(inv.equipKind('fuse'), true);
  hand.setItem(inv.equipped);
  assert.equal(hand.currentKind, 'fuse');

  assert.equal(inv.cycle(1), EQUIP_SLOTS.indexOf('energy'));
  assert.equal(inv.equipped, 'energy');
  hand.triggerUse('energy');
  assert.equal(inv.consume('energy'), true);
  assert.equal(inv.equipped, 'fuse');
  hand.setItem(inv.equipped);
  assert.equal(hand.update(.3).kind, 'energy');
  assert.equal(hand.update(.5).kind, 'energy');
  assert.equal(hand.update(.016).kind, 'fuse');
  hand.inspect('tape1');
  assert.equal(hand.update(1.7).kind, 'tape1');
  assert.equal(hand.update(.016).kind, 'fuse');

  const stamina = createStaminaState();
  stamina.stamina = 0.25;
  stamina.exhausted = true;
  stepStamina(stamina, { sprinting: true, moving: true, dt: 0.5, adrenaline: true });
  assert.equal(stamina.exhausted, false);
  assert.ok(stamina.stamina >= 0.25);
  assert.ok(stamina.speedLimit > SPRINT_SPEED);

  world.reset();
  assert.equal(fuseItem.collected, false);
  assert.equal(fuseItem.group.visible, true);
}));

test('guidance identifies the next physical doorway, both stair approaches, and the gate after out-of-order pickups', () => withCanvasStub(() => {
  const map = buildCorridor(stubMaterial);
  const { navigation } = createMonsterHunt({ obstacles: map.obstacles, doors: map.doors, destruction: map.destruction });
  const guide = createObjectiveGuide(navigation), inventory = createInventory();
  const locks = createMatchState().gateLocks;
  const route = (x, z, yaw = 0) => guide.update({ x, z, yaw }, inventory, locks);
  const latch = map.scene.getObjectByName('Cerrojo del portón');
  const gate = map.specials.gateControl;
  assert.ok(Math.hypot(latch.position.x - gate.door.pos.x, latch.position.z - gate.door.pos.z) < .2);
  assert.ok(latch.position.y > 1);
  gate.setLatch(1);
  assert.equal(latch.visible, false);
  gate.reset();
  assert.ok(latch.visible);
  const start = route(0, 21.6);
  assert.equal(start.destination, 'Caseta 107');
  assert.equal(start.next, 'Sala 103');
  assert.ok(start.meters > 1 && start.meters < 12 && start.angle < 0);
  const away = route(0, 21.6, Math.PI);
  assert.ok(Math.abs(Math.abs(away.angle - start.angle) - Math.PI) < 1e-5);
  inventory.add('fuse');
  assert.equal(route(0, 21.6).destination, 'Caseta 107');
  inventory.add('masterKey');
  const stairX = (stairs.x0 + stairs.x1) / 2;
  assert.match(route(0, stairs.startZ + 2).next, /pie de la escalera/);
  assert.match(route(stairX, stairs.startZ).next, /Sube hasta el descanso/);
  assert.match(route(stairX, landing.z1 - .7).next, /Recoge cortapernos/);
  locks.masterKey = true;
  inventory.consume('masterKey');
  inventory.add('boltCutters');
  assert.equal(route(-16, 15).title, 'Abre el portón exterior');
  assert.equal(route(-16, 15).next, 'Usa las tres piezas');
  guide.reset(); inventory.reset(); locks.masterKey = false;
  assert.equal(route(0, 21.6).next, 'Sala 103');
}));

test('an acquired target changes the charge heading mid-pursuit, including beyond a second wall', () => {
  const walls = [-2, -5].map(z => ({ x0: -3.6, x1: 3.6, z0: z - .13, z1: z + .13 }));
  const hunt = createMonsterHunt({ obstacles: walls, doors: [], destruction: createDestruction(walls, []),
    spawn: { x: 0, z: 1.8, yaw: Math.PI } });
  const player = { x: 0, z: -.8, cameraY: 1.61, active: true };
  hunt.update(1/60, player);
  assert.equal(hunt.state.mode, 'chase');
  player.x = 1.4; player.z = -11.8;
  const breaches = [];
  for (let i = 0; i < 600 && hunt.state.mode !== 'capture'; i++) {
    const before = { x: hunt.state.x, z: hunt.state.z };
    const s = hunt.update(1/60, player, { lostTimeout: .1 });
    const dx = player.x - before.x, dz = player.z - before.z;
    assert.ok(Math.abs((s.x-before.x)*dz - (s.z-before.z)*dx) < 1e-4);
    if (s.smashedWall) {
      breaches.push(s.smashedWall.z);
      if (breaches.length === 1) player.x = -.6;
    }
  }
  assert.equal(hunt.state.mode, 'capture');
  assert.equal(breaches.length, 2);
  assert.ok(Math.abs(breaches[0]+2) < .2 && Math.abs(breaches[1]+5) < .2);
});

test('the live hunt walks after an unseen silent player and breaks walls on the moving contact frame', () => {
  for (const hz of [30, 120]) {
    const walls = [5, -1].map(z => ({ x0: -7, x1: 7, z0: z, z1: z + .18 }));
    const hunt = createMonsterHunt({ obstacles: walls, doors: [], spawn: { x: 0, z: 12, yaw: 0 } });
    const target = { x: 0, z: -9, cameraY: .96, isCrouching: true, noiseRadius: 0, active: true };
    const dt = 1 / hz;
    let hits = 0;
    for (let frame = 0; frame < hz * 20 && hunt.state.mode !== 'capture'; frame++) {
      const before = { x: hunt.state.x, z: hunt.state.z, phase: hunt.state.stridePhase };
      const s = hunt.update(dt, target);
      if (frame === 0) {
        assert.equal(s.visible, false);
        assert.equal(s.animation, 'walk');
        assert.equal(s.mode, 'chase');
      }
      if (s.mode === 'capture') break;
      const dx = s.x - before.x, dz = s.z - before.z;
      assert.ok(dx * (target.x - before.x) + dz * (target.z - before.z) > 0, 'every step closes on the live target');
      assert.ok(Math.abs(dx * (target.z - before.z) - dz * (target.x - before.x)) < .00001);
      assert.ok(s.stridePhase > before.phase && s.doorPress === 0);
      if (s.smashedWall) {
        const wall = walls[hits++];
        assert.equal(wall.active, false);
        assert.ok(before.z > wall.z1 + .53 - .001, 'wall stood until the leading edge reached it');
        assert.ok(s.z <= wall.z1 + .53 + .001, 'the impact happened during this stride');
        assert.ok(s.speed > 2.1 && s.animation === 'run', 'the impact carries through at a run');
        if (hits === 1) target.x = 2;
      }
    }
    assert.equal(hits, 2);
    assert.equal(hunt.state.mode, 'capture');
    hunt.reset();
    assert.notEqual(walls[0].active, false);
    assert.equal(hunt.update(dt, target).animation, 'walk');
  }
});

test('a deliberate decoy diverts the walking hunt, then the player immediately becomes its target again', () => {
  const walls = [{ x0: -6, x1: 6, z0: 2, z1: 2.2 }];
  const hunt = createMonsterHunt({ obstacles: walls, doors: [], spawn: { x: 0, z: 6, yaw: 0 } });
  const p = { x: 0, z: -3, cameraY: 1.6, active: true };
  const decoy = { id: 'ring', x: 3, z: 6, radius: 28 };
  assert.equal(hunt.update(.05, p, { decoy }).lastKnown.decoyId, decoy.id);
  assert.ok(hunt.state.x > 0);
  const s = hunt.update(.05, p);
  assert.deepEqual(s.lastKnown, { x: p.x, z: p.z });
  assert.equal(s.mode, 'chase');
  assert.ok(s.z < 6);
  assert.equal(hunt.update(.05, p, { decoy, frenzy: true }).mode, 'chase');
});

test('Point of No Return blacks out lights, tints sky crimson, and enables relentless frenzy wall-breaking', () => withCanvasStub(() => {
  const atmosphere = createAtmosphere();
  atmosphere.triggerPointOfNoReturn();
  assert.equal(atmosphere.state.targetBloodSky, 1);
  for (const lamp of atmosphere.state.lamps) {
    assert.equal(lamp.mode, 'off');
  }
  atmosphere.triggerDawnVictory();
  assert.equal(atmosphere.state.targetBloodSky, 0);

  const map = buildCorridor(stubMaterial);
  const initialCount = map.obstacles.length;
  for (const [name, sx, sz, px, pz, cx, cz, axis] of [
    ['hall window', -.85, 4.55, -6.35, 5.85, -3.69, 5.22, 'x'],
    ['double classroom partition', 8.38, 15.45, 8.38, 8.25, 8.38, 12, 'z'],
    ['guardhouse wall', -16, 14.35, -21.3, 14.35, -18.3, 14.35, 'x'],
    ['annex outer wall', -6.5, -32.65, -.35, -32.65, -4.0, -32.65, 'x']
  ]) {
    const hunt = createMonsterHunt({ obstacles: map.obstacles, doors: map.doors, destruction: map.destruction,
      spawn: { x: sx, z: sz, yaw: 0 } });
    const player = { x: px, z: pz, cameraY: 1.61, active: true, jump: { height: 0 } };
    const dir = axis === 'x' ? new Vector3(1,0,0) : new Vector3(0,0,1);
    const start = new Vector3(cx,1.52,cz).addScaledVector(dir,-.45);
    const ray = new Raycaster(start, dir, 0, .9);
    const wallVisible = () => ray.intersectObjects(map.scene.children.filter(o => o.isMesh), false).length > 0;
    assert.ok(wallVisible(), name + ' begins intact');
    hunt.stun(.25);
    assert.equal(hunt.update(.1, player, { frenzy: true }).speed, 0);
    let hit = false;
    for (let i = 0; i < 480 && hunt.state.mode !== 'capture'; i++) {
      const m = hunt.update(1/60, player, { frenzy: true, chaseSpeed: 4.6 });
      assert.ok(Math.abs((m.x-sx)*(pz-sz)-(m.z-sz)*(px-sx)) < .001, name + ' detour');
      if (m.smashedWall) hit = true;
    }
    assert.ok(hit, name + ' was struck');
    assert.equal(hunt.state.mode, 'capture', name + ' led to a capture');
    assert.equal(wallVisible(), false, name + ' geometry actually opened');
    const walker = { x: start.x, z: start.z };
    movePlayer(walker, dir.x*.9, dir.z*.9, map.obstacles, 0, worldBounds);
    assert.ok(Math.hypot(walker.x-start.x,walker.z-start.z) > .87, name + ' opening is traversable');
    hunt.reset();
    assert.equal(map.obstacles.length, initialCount, name + ' collider count after replay');
    assert.ok(wallVisible(), name + ' geometry restored');
  }

  // Decoy lures monster toward decoy location when player stays unseen
  const openHunt = createMonsterHunt({ obstacles: [], doors: [], spawn: { x: 0, z: 0, yaw: 0 }, patrolPoints: [{ x: 0, z: -10 }] });
  const wallObstacle = { x0: -4, x1: 4, z0: 4, z1: 4.2 };
  const decoyHunt = createMonsterHunt({ obstacles: [wallObstacle], doors: [], spawn: { x: 0, z: 0, yaw: 0 }, patrolPoints: [{ x: 0, z: -10 }] });
  const lured = decoyHunt.update(1 / 60,
    { x: 0, z: 8, cameraY: 1.61, active: true, jump: { height: 0 }, noiseRadius: 0 },
    { decoy: { id: 'd1', x: 2.5, z: -3.5, radius: 34 } }
  );
  assert.equal(lured.mode, 'investigate');
  assert.equal(lured.lastKnown.decoyId, 'd1');
  assert.ok(openHunt);
}));

test('animated cutscenes drive intro slam, expanded exterior escape, dawn complete ending, and 3:00 defeat', () => {
  const camera = new PerspectiveCamera(64, 1.5, 0.05, 200);
  const door = {
    id: 'porton',
    locked: true,
    swingSign: -1,
    open: 0,
    targetOpen: 0,
    pivots: [{ group: { rotation: { y: 0 }, updateMatrixWorld() {} }, hand: -1, maxAngle: 1.58, obstacle: { active: true } }],
    obstacle: { active: true }
  };
  const lockCalls = [];
  const actorState = { x: 0, y: 0, z: 0, yaw: 0, anim: 'idle', expr: 'normal' };
  const actor = {
    place(x, y, z, yaw) { Object.assign(actorState, { x, y, z, yaw }); },
    setAnimation(a) { actorState.anim = a; },
    face: {
      reset() {},
      setExpression(e) { actorState.expr = e; }
    },
    update() {}
  };
  let ponrCalled = false, dawnCalled = false;
  const atmosphere = {
    triggerPointOfNoReturn() { ponrCalled = true; },
    triggerDawnVictory() { dawnCalled = true; }
  };
  let lockCount = 0, slams = 0, steps = 0;
  const walk = {
    audio: { triggerStep() { steps++; } },
    setCutsceneLock(v) { lockCount += v ? 1 : -1; },
    restartAt() {}
  };

  const cines = createCinematics({
    camera,
    actor,
    gateControl: { door, setLockVisual: k => lockCalls.push(k) },
    atmosphere,
    gameplayAudio: {},
    doorAudio: { playSlam(d) { assert.equal(d, door); slams++; } },
    walk,
    navigation: null
  });

  // 1) Intro cutscene slams gate shut & hands over cleanly
  let introDone = false;
  cines.startIntro(() => { introDone = true; });
  assert.equal(cines.active, true);
  assert.ok(door.open > 0.5);
  const chapters = [];
  for (let i = 0; i < 1800; i++) {
    cines.update(1 / 60, false);
    if (chapters.at(-1) !== cines.chapter) chapters.push(cines.chapter);
  }
  assert.deepEqual(chapters, ['Portón exterior', 'Caseta 107', 'Bodega 105',
    'Anexo · descanso de la escalera', 'Pasillo principal']);
  assert.equal(introDone, false);
  assert.equal(slams, 1);
  assert.ok(cines.awaitingStart);
  assert.ok(cines.skip());
  assert.equal(introDone, true);
  assert.equal(cines.active, false);
  assert.equal(door.open, 0);

  // 2) Complete Escape cutscene swings gates open & runs student along expanded exterior avenue + dawn lighting
  let escapeOutcome = null;
  cines.startEscape({ isComplete: true }, res => { escapeOutcome = res.outcome; });
  assert.equal(dawnCalled, true);
  cines.update(2.2, false);
  assert.ok(door.open > .9);
  assert.ok(cines.playerPose.z < 19.6);
  cines.update(3, false);
  assert.ok(cines.playerPose.z > 19.6 && actorState.z < 19.6);
  assert.equal(door.open, 0);
  assert.equal(escapeOutcome, null);
  cines.update(7, false);
  assert.equal(escapeOutcome, 'escape');
  assert.equal(slams, 2);
  assert.ok(steps > 0);
  assert.equal(door.open, 0);
  assert.ok(cines.playerPose.z > 30);
  assert.ok(cines.fade < 0.35);

  // 3) 3:00 Timeout defeat cutscene activates Point of No Return & looms monster smoothly
  cines.stop();
  let timeoutOutcome = null;
  cines.startTimeoutDefeat({ x: 0, cameraY: 1.66, z: 12, yaw: 0, pitch: 0 }, res => { timeoutOutcome = res.outcome; });
  assert.equal(ponrCalled, true);
  for (let i = 0; i < 360; i++) cines.update(1 / 60, false);
  assert.equal(timeoutOutcome, 'timeoutDefeat');
  assert.ok(cines.fade > 0.3 && cines.fade < 0.7);
  assert.ok(lockCount >= 0);
});

test('preloader async textures and minimalist transparent UI contracts stay intact', async () => {
  await withCanvasStub(async () => {
    const ticks = [];
    const art = await makeTexturesAsync(p => ticks.push(p), () => Promise.resolve());
    assert.ok(ticks.length >= 4);
    assert.equal(ticks.at(-1), 1);
    assert.ok(art.white && art.floor && art.windows.length > 0);
  });

  const root = path.resolve(import.meta.dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

  // Preloader & minimalist HUD markers
  assert.match(html, /id="loader"/);
  assert.match(html, /id="loader-fill"/);
  assert.match(html, /id="hud-timer"/);
  assert.match(html, /id="mission-route"/);
  assert.doesNotMatch(html, /id="held-purpose"|id="hud-objectives"|class="inv-slot"/);
  assert.match(html, /id="inventory"/);
  assert.match(html, /id="use-btn"/);
  assert.match(html, /id="sprint"/);
  assert.match(html, /id="stick"/);
  assert.match(html, /id="camera-btn"/);
  assert.match(html, /3\.ª persona/);
  assert.match(html, /<kbd[^>]*>V<\/kbd>/);

  // Transparent floating menu & HUD (no opaque .menu-sheet card)
  assert.doesNotMatch(html, /class="menu-sheet"/);
  assert.match(css, /\.menu-cover\s*\{[\s\S]*background:\s*transparent/);
  assert.match(css, /#interact-btn, #skip-hint, \.equipment button, \.touch-actions button\s*\{\s*background: transparent/);
  assert.match(css, /#game\.point-of-no-return::before/);
});
