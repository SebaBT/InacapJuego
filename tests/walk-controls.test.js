import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera } from 'three';
import { bindDebugCode } from '../src/debug.js';
import { createDoorController } from '../src/doors.js';
import { BASE_FOV, CROUCH_EYE_DROP, CROUCH_SPEED, SPRINT_SPEED, WALK_SPEED } from '../src/player-motion.js';
import { firstPerson } from '../src/walk.js';

function makeElement() {
  const classes = new Set(), attributes = new Map(), captured = new Set();
  return Object.assign(new EventTarget(), {
    classList: {
      add: name => classes.add(name),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle: (name, on) => on ? classes.add(name) : classes.delete(name)
    },
    setAttribute: (key, value) => attributes.set(key, value),
    getAttribute: key => attributes.get(key),
    setPointerCapture: id => captured.add(id),
    hasPointerCapture: id => captured.has(id),
    releasePointerCapture: id => captured.delete(id),
    focus() { document.activeElement = this; },
    style: { setProperty() {} },
    firstElementChild: { style: {} }
  });
}

function setupWalk(t, { reducedMotion = false, coarse = true, obstacles = [], onInteract, onStickDirection, onStartRequest } = {}) {
  const ids = ['game', 'view', 'enter', 'enter-label', 'message', 'stick', 'pause', 'interact-btn', 'crouch-btn', 'jump-btn'];
  const elements = new Map(ids.map(id => ['#' + id, makeElement()]));
  const padRect = { left: 18, top: 230, width: 128, height: 128 };
  elements.get('#stick').getBoundingClientRect = () => padRect;
  let time = 0;
  t.mock.method(performance, 'now', () => time);
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { querySelector: selector => elements.get(selector) });
  globalThis.matchMedia = query => ({ matches: query === '(pointer: coarse)' ? coarse : reducedMotion });
  t.after(() => {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.matchMedia;
  });

  const camera = new PerspectiveCamera(BASE_FOV);
  const walk = firstPerson(camera, obstacles, () => {}, { onInteract, onStickDirection, onStartRequest });
  walk.setView(0, 0, 0, 0);
  function key(type, code, repeat = false) {
    const event = Object.assign(new Event(type, { cancelable: true }), { code, repeat });
    window.dispatchEvent(event);
    return event;
  }
  function touch(id, type, x = 0, y = 0, finger = 1) {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      pointerId: finger, pointerType: 'touch', button: 0,
      clientX: padRect.left + (1 + x) * padRect.width / 2,
      clientY: padRect.top + (1 + y) * padRect.height / 2
    });
    elements.get('#' + id).dispatchEvent(event);
  }
  function frames(count = 1, frameMs = 1000 / 60) {
    for (let i = 0; i < count; i++) {
      time += frameMs;
      walk.update(Math.min(0.08, frameMs / 1000));
    }
  }
  return {
    walk, camera, frames, touch,
    canvas: elements.get('#view'),
    button: elements.get('#crouch-btn'),
    click: (id, detail = 0) => elements.get('#' + id).dispatchEvent(Object.assign(new Event('click'), { detail })),
    down: (code, repeat) => key('keydown', code, repeat),
    up: code => key('keyup', code)
  };
}

test('the match starts only from the explicit Entrar button, never from a stray canvas click', t => {
  const { walk, canvas, click } = setupWalk(t, { coarse: false });
  const pressCanvas = () => canvas.dispatchEvent(Object.assign(new Event('pointerdown', { cancelable: true }), {
    button: 0, pointerType: 'mouse', pointerId: 1, clientX: 40, clientY: 40
  }));
  pressCanvas();
  assert.equal(walk.active, false, 'clicking the corridor behind the menu must not start');
  click('enter');
  assert.equal(walk.active, true);
  walk.pause();
  assert.equal(walk.active, false);
  pressCanvas();
  assert.equal(walk.active, false, 'clicking the paused scene must not resume by accident');
  click('enter');
  assert.equal(walk.active, true, 'the explicit button still starts the match');
});

test('the content warning can hold the start and then release it from its own button', t => {
  let requested = 0, allowed = false;
  const { walk, click } = setupWalk(t, {
    coarse: false,
    onStartRequest: () => { requested++; return allowed; }
  });
  click('enter');
  assert.equal(requested, 1);
  assert.equal(walk.active, false, 'the warning gate must postpone the match');
  allowed = true;
  walk.requestStart();
  assert.equal(requested, 2);
  assert.equal(walk.active, true, 'the explicit continue request starts the cinematic flow');
});

test('real movement emits discrete hearing cues while crouch and stationary sprint stay silent', t => {
  const { walk, click, down, up, frames } = setupWalk(t, { reducedMotion: true });
  click('enter');
  function radii(n) {
    const values = new Set();
    for (let i = 0; i < n; i++) { frames(); values.add(walk.pose.noiseRadius); }
    return [...values].sort((a, b) => a - b);
  }
  down('ShiftLeft');
  assert.deepEqual(radii(40), [0]);
  up('ShiftLeft'); down('KeyW');
  assert.deepEqual(radii(80), [0, 4.5]);
  down('ShiftLeft');
  assert.deepEqual(radii(70), [0, 14]);
  down('KeyC'); down('Space');
  assert.deepEqual(radii(75), [0]);
  up('KeyC'); up('KeyW'); up('ShiftLeft'); up('Space');
  frames(40);
  down('Space');
  assert.deepEqual(radii(70), [0, 8, 11]);
});

for (const reducedMotion of [false, true]) {
  test('monster footfalls affect the view, preserve aim and obey reduced motion = ' + reducedMotion, t => {
    let uses = 0;
    const { walk, camera, click, down, frames } = setupWalk(t, { reducedMotion, onInteract: () => uses++ });
    click('enter');
    for (const third of [false, true]) {
      walk.setThirdPerson(third);
      frames(80);
      const base = { x: camera.position.x, y: camera.position.y, fov: camera.fov };
      walk.monsterStep(1, -1);
      frames(2);
      const s = walk.pose;
      assert.equal(s.yaw, 0);
      assert.equal(s.pitch, 0);
      assert.equal(s.x, 0);
      assert.equal(s.z, 0);
      if (reducedMotion) {
        assert.equal(camera.rotation.z, 0);
        assert.equal(camera.position.x, base.x);
        assert.equal(camera.position.y, base.y);
        assert.equal(camera.fov, base.fov);
      } else {
        assert.ok(camera.rotation.z < -.008, 'a heavy footfall rolls the camera hard');
        assert.ok(Math.abs(camera.position.x - base.x) > .004, 'the seismic shockwave shifts the camera sideways');
        assert.ok(Math.abs(camera.position.y - base.y) > .01, 'the floor compresses under the footfall');
        assert.ok(camera.fov > base.fov + .5, 'the impact pulses the FOV');
      }
    }
    walk.setCaptured(true);
    down('KeyW'); down('KeyE'); down('Space'); down('KeyV');
    click('interact-btn'); click('crouch-btn');
    frames(40);
    assert.equal(uses, 0);
    assert.equal(walk.pose.z, 0);
    assert.equal(walk.pose.jump.height, 0);
    assert.equal(walk.pose.isCrouching, false);
    assert.equal(walk.thirdPerson, true);
    walk.restartAt(0, 24.4);
    down('KeyW'); frames(10);
    assert.ok(walk.pose.z < 24.4);
  });
}

test('holding C cuts a diagonal sprint before interaction and releasing C restores movement', t => {
  const door = { open: 0, targetOpen: 0, pos: { x: 0, y: 1, z: 0 } };
  const doors = createDoorController({ doors: [door], audio: {} });
  let result;
  const { walk, camera, button, click, down, up, frames } = setupWalk(t, {
    onInteract: () => { result = doors.interact(walk.pose); }
  });
  click('enter');
  down('KeyW');
  down('KeyD');
  down('ShiftLeft');
  frames(60);
  assert.equal(walk.pose.isSprinting, true);
  assert.ok(Math.hypot(walk.pose.vx, walk.pose.vz) > 4);
  door.pos = { x: walk.pose.x, y: camera.position.y, z: walk.pose.z - 0.8 };

  down('KeyC');
  down('KeyC', true);
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(walk.pose.isSprinting, false);
  assert.ok(Math.hypot(walk.pose.vx, walk.pose.vz) <= CROUCH_SPEED + 1e-9);
  down('KeyE');
  assert.equal(result.open, true);
  assert.equal(result.slam, false);

  frames();
  assert.ok(walk.pose.crouchAmount > 0 && walk.pose.crouchAmount < 1);
  assert.equal(walk.pose.cameraY, camera.position.y);
  frames(60);
  assert.ok(Math.abs(camera.position.y - (1.61 - CROUCH_EYE_DROP)) < 0.04);
  assert.ok(Math.abs(Math.hypot(walk.pose.vx, walk.pose.vz) - CROUCH_SPEED) < 1e-6);
  assert.ok(walk.pose.vx > 0 && Math.abs(walk.pose.vx + walk.pose.vz) < 1e-9);

  up('KeyC');
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  frames();
  assert.equal(walk.pose.isSprinting, true);
  assert.ok(walk.pose.crouchAmount > 0 && walk.pose.crouchAmount < 1);
  up('ShiftLeft');
  frames(60);
  assert.ok(Math.abs(Math.hypot(walk.pose.vx, walk.pose.vz) - WALK_SPEED) < 1e-6);
  assert.ok(Math.abs(camera.position.y - 1.61) < 0.04);
});

test('the touch toggle and held key release independently and clear on pause or a view reset', t => {
  const { walk, camera, button, click, down, up, frames } = setupWalk(t);
  const pressed = () => button.getAttribute('aria-pressed');
  assert.equal(button.disabled, true);
  click('crouch-btn');
  down('KeyC');
  assert.equal(pressed(), 'false');

  click('enter');
  assert.equal(button.disabled, false);
  button.focus();
  click('crouch-btn', 1);
  assert.equal(document.activeElement, document.querySelector('#view'));
  down('KeyC');
  up('KeyC');
  assert.equal(pressed(), 'true');
  down('KeyC');
  click('crouch-btn');
  assert.equal(pressed(), 'true');
  up('KeyC');
  assert.equal(pressed(), 'false');

  click('crouch-btn');
  down('KeyC');
  frames(20);
  window.dispatchEvent(new Event('blur'));
  assert.equal(walk.active, false);
  assert.equal(button.disabled, true);
  assert.equal(pressed(), 'false');
  click('crouch-btn');
  frames();
  assert.equal(camera.position.y, 1.61);

  click('enter');
  down('KeyC', true);
  assert.equal(walk.pose.isCrouching, false);
  up('KeyC');
  down('KeyC');
  assert.equal(pressed(), 'true');
  walk.setView(0, 2, 0, 0);
  assert.equal(pressed(), 'false');
  assert.equal(walk.pose.crouchAmount, 0);
});

test('C descends in noclip and a held descent does not become a crouch on exiting flight', t => {
  const { walk, button, click, down, up, frames } = setupWalk(t);
  click('enter');
  click('crouch-btn');
  down('KeyC');
  frames(20);
  const crouchedY = walk.pose.cameraY;
  walk.setNoclip(true);
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(walk.pose.crouchAmount, 0);
  const flightStart = walk.pose.cameraY;
  assert.equal(flightStart, crouchedY);
  click('crouch-btn');
  frames(15);
  assert.ok(walk.pose.cameraY < flightStart - 0.4);
  assert.equal(walk.pose.isCrouching, false);
  walk.setNoclip(false);
  down('KeyC', true);
  frames();
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.ok(walk.pose.cameraY >= 1.60);
  up('KeyC');
  down('KeyC');
  assert.equal(walk.pose.isCrouching, true);
});

test('reduced motion keeps crouched aim aligned with the camera across a jump and raised landing', t => {
  const floor = 0.18, crouchedEye = 1.61 - CROUCH_EYE_DROP;
  const light = { pos: { x: 0, y: floor + crouchedEye, z: -1 } };
  const doors = createDoorController({ switches: [light], audio: {} });
  let result;
  const { walk, camera, click, down, up, frames } = setupWalk(t, {
    obstacles: [{ x0: -1, x1: 1, z0: -1, z1: 1, top: floor, step: true }],
    reducedMotion: true,
    onInteract: () => { result = doors.interact(walk.pose); }
  });
  function checkEye(heightAboveFeet) {
    assert.equal(walk.pose.cameraY, camera.position.y);
    assert.ok(Math.abs(camera.position.y - walk.pose.jump.height - heightAboveFeet) < 1e-9);
    assert.equal(camera.rotation.z, 0);
    assert.equal(camera.fov, BASE_FOV);
  }
  click('enter');
  frames();
  checkEye(1.61);
  assert.equal(doors.findTarget(walk.pose), null);
  down('KeyC');
  frames();
  checkEye(crouchedEye);
  click('interact-btn');
  assert.equal(result.switch, light);

  down('Space');
  frames();
  assert.equal(walk.pose.jump.justJumped, true);
  frames(6);
  checkEye(crouchedEye);
  up('KeyC');
  frames();
  checkEye(1.61);
  assert.equal(walk.pose.jump.grounded, false);
  click('crouch-btn');
  down('Space');
  frames();
  checkEye(crouchedEye);
  assert.equal(walk.pose.jump.justJumped, false);
  assert.equal(doors.findTarget(walk.pose), null);

  let apex = walk.pose.jump.height;
  for (let i = 0; i < 60 && !walk.pose.jump.grounded; i++) {
    frames();
    checkEye(crouchedEye);
    apex = Math.max(apex, walk.pose.jump.height);
  }
  assert.ok(apex > floor + 0.7);
  assert.equal(walk.pose.jump.justLanded, true);
  assert.equal(walk.pose.jump.height, floor);
  assert.equal(walk.pose.isCrouching, true);
  assert.equal(doors.findTarget(walk.pose)?.item, light);
});

test('pausing on a raised landing preserves the floor under the player', t => {
  const { walk, camera, click, down, up, frames } = setupWalk(t, {
    obstacles: [
      { x0: -1, x1: 1, z0: -1, z1: 0, top: 0.18, step: true },
      { x0: -1, x1: 1, z0: -2, z1: -1, top: 0.36, step: true },
      { x0: -1, x1: 1, z0: -6, z1: -2, top: 0.54, step: true }
    ],
    reducedMotion: true
  });
  click('enter');
  down('KeyW');
  frames(90);
  up('KeyW');
  click('crouch-btn');
  frames();
  assert.equal(walk.pose.jump.height, 0.54);
  assert.equal(walk.pose.isCrouching, true);

  click('pause');
  assert.equal(walk.pose.isCrouching, false);
  assert.equal(camera.position.y, 1.61 + 0.54);
  click('enter');
  frames();
  assert.equal(walk.pose.jump.height, 0.54);
  assert.equal(walk.pose.jump.grounded, true);
});

test('holding at or beyond the visible ring walks until the finger crosses the breakaway distance', t => {
  const { walk, frames, click, touch } = setupWalk(t);
  const pad = document.querySelector('#stick');
  const radius = pad.getBoundingClientRect().width / 2;
  const thumbY = () => Math.abs(parseFloat(pad.firstElementChild.style.transform.split(',')[1]));
  click('enter');
  touch('stick', 'pointerdown');
  touch('stick', 'pointermove', 0, -0.48);
  frames(60);
  assert.ok(Math.abs(walk.pose.vz + WALK_SPEED) < 0.001);
  const walkTravel = thumbY();

  touch('stick', 'pointermove', 0, -1);
  const rimTravel = thumbY();
  frames(180);
  assert.equal(walk.pose.isSprinting, false);
  assert.equal(thumbY(), rimTravel);
  assert.ok(rimTravel > walkTravel);
  touch('stick', 'pointermove', 0, -1.49);
  const loadedTravel = thumbY();
  frames(180);
  assert.equal(walk.pose.isSprinting, false);
  assert.equal(walk.pose.wishVz, -WALK_SPEED);
  assert.equal(thumbY(), loadedTravel);
  assert.ok(loadedTravel > rimTravel && loadedTravel - rimTravel < 0.10 * radius);
  touch('stick', 'pointermove', 0, -1.51);
  frames();
  assert.equal(walk.pose.isSprinting, true);
  assert.ok(thumbY() - loadedTravel > 0.10 * radius);
  assert.ok(thumbY() < radius);
  assert.ok(pad.classList.contains('running'));
  assert.equal(walk.pose.wishVz, -SPRINT_SPEED);

  touch('stick', 'pointermove', 0.85, -0.85);
  frames();
  assert.equal(walk.pose.isSprinting, true);
  assert.ok(Math.abs(walk.pose.wishVx + walk.pose.wishVz) < 1e-9);
  touch('stick', 'pointermove', 1, 0);
  frames();
  assert.equal(walk.pose.isSprinting, false);
  assert.equal(walk.pose.wishVx, WALK_SPEED);
  touch('stick', 'pointermove', 0.99, -0.99);
  frames();
  assert.equal(walk.pose.isSprinting, false);
  touch('stick', 'pointermove', 1.08, -1.08);
  frames();
  assert.equal(walk.pose.isSprinting, true);
  assert.ok(Math.abs(Math.hypot(walk.pose.wishVx, walk.pose.wishVz) - SPRINT_SPEED) < 1e-9);
  touch('stick', 'pointerup');
  frames();
  assert.equal(walk.pose.wishVx, 0);
  assert.equal(thumbY(), 0);
});

test('rim touches must start a new push from inside, and interrupted drags release sprint', t => {
  const { walk, frames, click, touch } = setupWalk(t);
  const pad = document.querySelector('#stick');
  click('enter');
  touch('stick', 'pointerdown', 1, 0);
  touch('stick', 'pointermove', 1.7, 0);
  frames(30);
  assert.equal(walk.pose.wishVx, WALK_SPEED);
  for (const event of ['pointercancel', 'lostpointercapture']) {
    touch('stick', 'pointermove', 0.5, 0);
    touch('stick', 'pointermove', 1.46, 0);
    frames(5);
    touch('stick', 'pointermove', 0.5, 0);
    frames(15);
    assert.equal(walk.pose.isSprinting, false);
    touch('stick', 'pointermove', 1.55, 0);
    frames();
    assert.equal(walk.pose.isSprinting, true);
    touch('stick', event);
    frames(15);
    assert.equal(walk.pose.wishVx, 0);
    assert.equal(pad.hasPointerCapture(1), false);
    touch('stick', 'pointerdown');
  }
  touch('stick', 'pointermove', 1.6, 0);
  frames(6);
  click('pause');
  click('enter');
  touch('stick', 'pointermove', 1.6, 0);
  frames(30);
  assert.equal(walk.pose.wishVx, 0);
  assert.equal(walk.pose.isSprinting, false);
});

test('the ring follows the same crouch and exhaustion limits as keyboard sprint', t => {
  const { walk, frames, click, touch } = setupWalk(t);
  const pad = document.querySelector('#stick');
  click('enter');
  click('crouch-btn');
  touch('stick', 'pointerdown');
  touch('stick', 'pointermove', 0, -1.55);
  frames(1, 210);
  assert.equal(walk.pose.wishVz, -CROUCH_SPEED);
  assert.equal(pad.classList.contains('running'), false);
  click('crouch-btn');
  frames();
  assert.equal(walk.pose.isSprinting, true);
  frames(485);
  assert.equal(walk.pose.exhausted, true);
  assert.equal(pad.classList.contains('running'), false);
});

test('a second finger jumps on contact while running and release cannot jump a second time', t => {
  const { walk, frames, click, touch } = setupWalk(t);
  const jump = document.querySelector('#jump-btn');
  assert.equal(jump.disabled, true);
  click('enter');
  assert.equal(jump.disabled, false);
  touch('stick', 'pointerdown');
  touch('stick', 'pointermove', 0, -1.55);
  frames(20);
  touch('jump-btn', 'pointerdown', 0, 0, 2);
  frames();
  assert.equal(walk.pose.jump.justJumped, true);
  assert.equal(walk.pose.isSprinting, true);
  assert.ok(walk.pose.wishVz < 0);
  frames(80);
  assert.equal(walk.pose.jump.grounded, true);
  touch('jump-btn', 'pointerup', 0, 0, 2);
  click('jump-btn', 1);
  frames();
  assert.equal(walk.pose.jump.grounded, true);
  click('jump-btn');
  frames();
  assert.equal(walk.pose.jump.justJumped, true);
  walk.setNoclip(true);
  assert.equal(jump.disabled, true);
  touch('jump-btn', 'pointerdown', 0, 0, 2);
  walk.setNoclip(false);
  frames();
  assert.equal(walk.pose.jump.grounded, true);
});

test('the touch debug code accepts lifts or a return to center and ignores held or diagonal noise', t => {
  let record;
  const { walk, frames, click, touch } = setupWalk(t, { onStickDirection: key => record?.(key) });
  const panel = { open: false };
  record = bindDebugCode(document.querySelector('#game'), panel, () => { walk.pause(); panel.open = true; });
  click('enter');
  const move = (x, y) => touch('stick', 'pointermove', x, y);
  touch('stick', 'pointerdown');
  move(0, -0.6);
  for (let i = 0; i < 8; i++) move(0.04, -0.64);
  move(0, 0.6); move(0, 0); move(0, 0.6);
  move(-0.6, 0); move(0.6, 0); move(-0.6, 0); move(0.6, 0);
  assert.equal(panel.open, false);
  touch('stick', 'pointerup');

  touch('stick', 'pointerdown', 0, -0.7);
  touch('stick', 'pointerup');
  touch('stick', 'pointerdown', 0, -0.7);
  move(0.6, 0.6); move(0, 0.7); move(0, 0); move(0, 0.7);
  move(-0.7, 0); move(0.7, 0); move(-0.7, 0);
  assert.equal(panel.open, false);
  move(0.7, 0);
  assert.equal(panel.open, true);
  assert.equal(walk.active, false);
  panel.open = false;
  click('enter');
  frames();
  assert.equal(walk.pose.wishVx, 0);
});

test('the desktop debug code still requires Space and Enter after the eight directions', t => {
  const { click, down } = setupWalk(t, { coarse: false });
  const panel = { open: false };
  bindDebugCode(document.querySelector('#game'), panel, () => { panel.open = true; });
  click('enter');
  for (const key of ['KeyW', 'KeyW', 'KeyS', 'KeyS', 'KeyA', 'KeyD', 'KeyA', 'KeyD']) down(key);
  assert.equal(panel.open, false);
  assert.ok(down('Space').defaultPrevented);
  assert.equal(panel.open, false);
  down('NumpadEnter');
  assert.equal(panel.open, true);
  click('pause');
});
