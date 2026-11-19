import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { Group, PerspectiveCamera, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createDoorController } from '../src/doors.js';
import { hall, rooms, worldBounds } from '../src/layout.js';
import { applyStreetPassPose, applySwitchPose, computeGaitMetrics, computePlayerBodyPlacement, PLAYER_BODY_CONFIG } from '../src/player-body-pose.js';
import { BASE_FOV, CROUCH_EYE_DROP } from '../src/player-motion.js';
import {
  castCameraRay,
  createThirdPersonState,
  shortestAngleDiff,
  stepBodyFacing,
  stepThirdPersonCamera,
  THIRD_PERSON_CAMERA_RADIUS,
  THIRD_PERSON_DISTANCE,
  THIRD_PERSON_MIN_HEAD_DIST,
  THIRD_PERSON_SHOULDER_RIGHT
} from '../src/third-person.js';
import { firstPerson } from '../src/walk.js';

function makeElement() {
  const classes = new Set(), attributes = new Map(), captured = new Set(), props = new Map();
  return Object.assign(new EventTarget(), {
    disabled: false,
    title: '',
    classList: {
      add: name => classes.add(name),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle: (name, on) => on ? classes.add(name) : classes.delete(name)
    },
    setAttribute: (key, value) => attributes.set(key, String(value)),
    getAttribute: key => attributes.get(key) ?? null,
    setPointerCapture: id => captured.add(id),
    hasPointerCapture: id => captured.has(id),
    releasePointerCapture: id => captured.delete(id),
    focus() { document.activeElement = this; },
    style: {
      setProperty: (key, value) => props.set(key, value),
      getProperty: key => props.get(key)
    },
    firstElementChild: { style: {} }
  });
}

function setupWalk(t, { reducedMotion = false, coarse = false, obstacles = [], onInteract, isInspecting } = {}) {
  const ids = ['game', 'view', 'enter', 'enter-label', 'message', 'stick', 'pause', 'interact-btn', 'crouch-btn', 'jump-btn', 'camera-btn'];
  const elements = new Map(ids.map(id => ['#' + id, makeElement()]));
  elements.get('#stick').getBoundingClientRect = () => ({ left: 18, top: 230, width: 128, height: 128 });
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { querySelector: selector => elements.get(selector) });
  globalThis.matchMedia = query => ({ matches: query === '(pointer: coarse)' ? coarse : reducedMotion });
  t.after(() => {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.matchMedia;
  });

  const camera = new PerspectiveCamera(BASE_FOV);
  const walk = firstPerson(camera, obstacles, () => {}, { onInteract, isInspecting });
  walk.setView(0, 0, 0, 0);

  function key(type, code, repeat = false) {
    const event = Object.assign(new Event(type, { cancelable: true }), { code, repeat });
    window.dispatchEvent(event);
    return event;
  }
  function frames(count = 1, dt = 1 / 60) {
    for (let i = 0; i < count; i++) walk.update(dt);
  }
  return {
    walk,
    camera,
    frames,
    game: elements.get('#game'),
    cameraBtn: elements.get('#camera-btn'),
    click: (id, detail = 0) => elements.get('#' + id).dispatchEvent(Object.assign(new Event('click'), { detail })),
    down: (code, repeat) => key('keydown', code, repeat),
    up: code => key('keyup', code)
  };
}

test('camera button and V key toggle third-person camera behind player and keep interactions aligned', t => {
  const switchItem = { id: 'sw-1', lightId: '101', label: 'Sala 101', pos: { x: 0, y: 1.61, z: -1.4 } };
  const doors = createDoorController({ switches: [switchItem], audio: {} });
  let interacted = null;
  const { walk, camera, frames, game, cameraBtn, click, down } = setupWalk(t, {
    onInteract: () => { interacted = doors.interact(walk.pose); }
  });

  assert.equal(walk.thirdPerson, false);
  assert.equal(cameraBtn.getAttribute('aria-pressed'), 'false');
  assert.equal(camera.position.z, 0);

  click('enter');
  frames();
  assert.equal(camera.position.z, 0);
  assert.equal(walk.pose.showPlayerHead, false);

  // Clicking the camera button activates third-person and refocuses the canvas so Space still jumps.
  cameraBtn.focus();
  click('camera-btn', 1);
  assert.equal(walk.thirdPerson, true);
  assert.equal(cameraBtn.getAttribute('aria-pressed'), 'true');
  assert.equal(game.classList.contains('third-person'), true);
  assert.equal(document.activeElement, document.querySelector('#view'));

  frames(45);
  assert.ok(walk.pose.thirdPersonBlend > 0.99);
  assert.ok(camera.position.z > THIRD_PERSON_DISTANCE - 0.15, 'camera trails behind player facing -Z');
  assert.ok(camera.position.x > THIRD_PERSON_SHOULDER_RIGHT - 0.05, 'camera sits slightly over right shoulder');
  assert.equal(walk.pose.showPlayerHead, true);
  assert.ok(Math.abs(walk.pose.cameraY - 1.61) < 0.05, 'pose.cameraY remains player eye height for targeting');

  // Door/switch interaction still targets from player position & eye height in third person.
  down('KeyE');
  assert.equal(interacted?.ok, true);
  assert.equal(interacted?.switch, switchItem);

  // Blink vignette CSS variable is suppressed in third person.
  down('KeyB');
  frames(4);
  assert.equal(Number(game.style.getProperty('--blink')), 0);

  // KeyV toggles back to first person smoothly.
  down('KeyV');
  assert.equal(walk.thirdPerson, false);
  assert.equal(cameraBtn.getAttribute('aria-pressed'), 'false');
  frames(45);
  assert.ok(Math.abs(camera.position.z) < 0.01);
  assert.equal(walk.pose.showPlayerHead, false);
});

test('reduced motion snaps third-person transition immediately and noclip suspends third person', t => {
  const { walk, camera, frames, cameraBtn, click } = setupWalk(t, { reducedMotion: true });
  click('enter');
  click('camera-btn');
  assert.equal(walk.pose.thirdPersonBlend, 1);
  assert.ok(camera.position.z > THIRD_PERSON_DISTANCE - 0.05);

  // Noclip disables the camera button and returns camera to player position.
  walk.setNoclip(true);
  assert.equal(cameraBtn.disabled, true);
  assert.equal(walk.pose.thirdPerson, false);
  assert.equal(walk.pose.showPlayerHead, false);
  assert.ok(Math.abs(camera.position.z) < 1e-6);

  // Exiting noclip restores third-person view.
  walk.setNoclip(false);
  assert.equal(cameraBtn.disabled, false);
  assert.equal(walk.pose.thirdPerson, true);
  frames();
  assert.ok(camera.position.z > THIRD_PERSON_DISTANCE - 0.05);
});

test('inspecting presets bypass third-person offset and restoring resumes third person', t => {
  let inspecting = true;
  const { walk, camera, click } = setupWalk(t, {
    reducedMotion: true,
    isInspecting: () => inspecting
  });

  // Toggling third person on the title screen stores preference without moving the framing shot.
  click('camera-btn');
  assert.equal(walk.thirdPerson, true);
  assert.equal(camera.position.z, 0);

  // Starting clears inspection; refreshView / begin immediately positions third-person camera behind player.
  inspecting = false;
  click('enter');
  assert.ok(camera.position.z > THIRD_PERSON_DISTANCE - 0.05);
});

test('spring-arm raycast stops cleanly before walls, spawn entrance door, open door leaves, floor, ceiling, and lintels', () => {
  const entranceWall = { x0: -hall.halfWidth, x1: hall.halfWidth, z0: hall.near - 0.02, z1: hall.near + 0.18 };
  const rightWall = { x0: hall.halfWidth, x1: hall.halfWidth + 0.17, z0: hall.far, z1: hall.near };
  const openLeaf = {
    kind: 'segment',
    ax: 0.9,
    az: 1.0,
    bx: -0.9,
    bz: 1.0,
    halfThick: 0.036,
    active: true
  };

  // 1. Spawn point is 2.0 m from the entrance wall: trailing camera stops cleanly inside the wall.
  const state = createThirdPersonState();
  state.enabled = true;
  const spawnCam = stepThirdPersonCamera(state, {
    snap: true,
    position: { x: 0, y: 1.61, z: hall.near - 2 },
    eyeY: 1.61,
    fpPos: { x: 0, y: 1.61, z: hall.near - 2 },
    yaw: 0,
    pitch: 0,
    obstacles: [entranceWall],
    bounds: worldBounds
  });
  assert.ok(spawnCam.z <= hall.near - 0.02 - THIRD_PERSON_CAMERA_RADIUS + 1e-6, 'camera stays inside entrance wall');
  assert.ok(spawnCam.z > hall.near - 2 + 1.5, 'camera still pulls well behind player at spawn');

  // 2. Standing near right wall pulls shoulder offset inward instead of clipping wall.
  const wallCam = stepThirdPersonCamera(state, {
    snap: true,
    position: { x: hall.halfWidth - 0.25, y: 1.61, z: 0 },
    eyeY: 1.61,
    fpPos: { x: hall.halfWidth - 0.25, y: 1.61, z: 0 },
    yaw: 0,
    pitch: 0,
    obstacles: [rightWall],
    bounds: worldBounds
  });
  assert.ok(wallCam.x <= hall.halfWidth - THIRD_PERSON_CAMERA_RADIUS + 1e-6, 'shoulder offset never clips right wall');

  // 3. Open door leaf segment blocks camera ray from passing through the leaf.
  const leafT = castCameraRay({ x: 0, y: 1.4, z: 0 }, { x: 0, y: 1.4, z: 2.2 }, [openLeaf], worldBounds);
  assert.ok(leafT * 2.2 <= 1.0 - 0.036 - THIRD_PERSON_CAMERA_RADIUS + 1e-6, 'camera stops before open door leaf');

  // 4. Looking steeply up never clips below floor; looking steeply down never clips above ceiling.
  const lookUpCam = stepThirdPersonCamera(state, {
    snap: true,
    position: { x: 0, y: 1.61, z: 0 },
    eyeY: 1.61,
    fpPos: { x: 0, y: 1.61, z: 0 },
    yaw: 0,
    pitch: 1.35,
    obstacles: [],
    bounds: worldBounds
  });
  assert.ok(lookUpCam.y >= THIRD_PERSON_CAMERA_RADIUS - 1e-6, 'camera never clips below floor');

  const lookDownCam = stepThirdPersonCamera(state, {
    snap: true,
    position: { x: 0, y: 1.61, z: 0 },
    eyeY: 1.61,
    fpPos: { x: 0, y: 1.61, z: 0 },
    yaw: 0,
    pitch: -1.35,
    obstacles: [],
    bounds: worldBounds
  });
  assert.ok(lookDownCam.y <= hall.height - THIRD_PERSON_CAMERA_RADIUS + 1e-6, 'camera never clips above ceiling');

  // 5. Doorway header blocks a high camera passing above an open classroom doorway.
  const r101 = rooms[0];
  const lintelT = castCameraRay(
    { x: hall.halfWidth - 0.8, y: 2.55, z: r101.doorZ },
    { x: hall.halfWidth + 1.0, y: 2.55, z: r101.doorZ },
    [],
    worldBounds
  );
  assert.ok(lintelT < 0.5, 'doorway lintel blocks high camera above 2.28 m');

  // 6. Being pinned right against a back wall hides the player head so it cannot clip near plane.
  const cornerWall = { x0: -2, x1: 2, z0: 0.25, z1: 0.45 };
  const squeezedCam = stepThirdPersonCamera(state, {
    snap: true,
    position: { x: 0, y: 1.61, z: 0 },
    eyeY: 1.61,
    fpPos: { x: 0, y: 1.61, z: 0 },
    yaw: 0,
    pitch: 0,
    obstacles: [cornerWall],
    bounds: worldBounds
  });
  assert.ok(squeezedCam.distance < THIRD_PERSON_MIN_HEAD_DIST);
  assert.equal(squeezedCam.showHead, false);
});

test('third-person centers player body on collision origin and articulates head bone across crouch and pitch', async () => {
  const basePose = {
    x: 1, y: 1.61, z: 2, yaw: 0, pitch: 0.5, vx: 0, vz: 0,
    bobPhase: 0, breathPhase: 0, offsetX: 0.1, offsetY: 0, exertion: 0,
    isSprinting: false, crouchAmount: 0,
    jump: { height: 0, velY: 0, grounded: true, landTimer: 1, landDuration: 0 }
  };

  const fpPlace = computePlayerBodyPlacement(basePose, 'switch');
  const tpPlace = computePlayerBodyPlacement({ ...basePose, thirdPerson: true, thirdPersonBlend: 1 }, 'switch');
  assert.ok(fpPlace.z > 2.15, 'first-person offsets body backward');
  assert.equal(tpPlace.x, 1, 'third-person centers X on player position without camera-bob drift');
  assert.equal(tpPlace.z, 2, 'third-person centers Z directly on player position');
  assert.equal(tpPlace.scaleX, tpPlace.scaleY, 'third-person uses uniform Mii body scale without vertical stretching');
  assert.equal(tpPlace.scaleY, tpPlace.scaleZ);

  // Verify StreetPass Head tracks crouch squash and tilts with pitch.
  const loader = new GLTFLoader();
  for (const [style, boneName] of [['streetpass', 'Head'], ['switch', 'head']]) {
    const buf = fs.readFileSync(`assets/models/miiBodyM_${style}.glb`);
    const gltf = await loader.parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
    const root = new Group(), holder = new Group(), bones = {};
    root.add(holder); holder.add(gltf.scene);
    gltf.scene.traverse(o => { if (o.isBone) bones[o.name] = o; });
    const apply = style === 'switch' ? applySwitchPose : applyStreetPassPose;

    const pStand = computePlayerBodyPlacement({ ...basePose, thirdPersonBlend: 1 }, style);
    root.position.set(pStand.x, 0, pStand.z); root.rotation.y = pStand.rotationY;
    holder.position.y = pStand.y; holder.scale.set(pStand.scaleX, pStand.scaleY, pStand.scaleZ);
    apply(bones, { ...basePose, pitch: 0.6, crouchAmount: 0 });
    root.updateMatrixWorld(true);
    const standHeadY = bones[boneName].getWorldPosition(new Vector3()).y;
    const upTilt = bones[boneName].rotation.x;
    assert.ok(upTilt < -0.15, `${style} head tilts upward when looking up`);

    apply(bones, { ...basePose, pitch: -0.6, crouchAmount: 1 });
    root.updateMatrixWorld(true);
    const crouchHeadY = bones[boneName].getWorldPosition(new Vector3()).y;
    assert.ok(crouchHeadY < standHeadY - 0.18, `${style} head lowers with crouching body`);
    assert.ok(bones[boneName].rotation.x > upTilt + 0.3, `${style} head tilts downward when looking down`);

    // When turned around facing the camera (bodyYaw = PI), camera pitch does not awkwardly invert the head tilt.
    apply(bones, { ...basePose, bodyYaw: Math.PI, pitch: 0.8, crouchAmount: 0 });
    assert.ok(Math.abs(bones[boneName].rotation.x) < 0.05, `${style} head stays level when turned toward camera`);
  }
});

test('walking backwards in third person turns the character around without changing camera perspective', t => {
  const { walk, camera, frames, click, down, up } = setupWalk(t);
  click('enter');
  click('camera-btn');
  frames(45);

  const initialYaw = walk.pose.yaw;
  const initialCamRotY = camera.rotation.y;
  assert.ok(Math.abs(shortestAngleDiff(walk.pose.bodyYaw, 0)) < 0.01);

  // Hold S to walk backwards: character turns 180 degrees to face the camera while camera keeps facing forward.
  down('KeyS');
  frames(35);
  assert.equal(walk.pose.yaw, initialYaw, 'camera yaw does not change when walking backwards');
  assert.ok(Math.abs(camera.rotation.y - initialCamRotY) < 0.05, 'camera perspective remains facing forward');
  assert.ok(Math.abs(shortestAngleDiff(walk.pose.bodyYaw, Math.PI)) < 0.05, 'character turned around 180 degrees');
  assert.ok(walk.pose.vz > 1.5, 'player moves backward in world space');

  // Gait metrics read the turned-around character as walking FORWARD (no moonwalking).
  const gait = computeGaitMetrics(walk.pose);
  assert.ok(gait.fwdVel > 1.5, 'turned-around character walks forward along its own facing direction');
  assert.equal(gait.backBlend, 0, 'backpedal blend is zero once character turns around');
  const place = computePlayerBodyPlacement(walk.pose, 'switch');
  assert.ok(Math.abs(shortestAngleDiff(place.rotationY, 0)) < 0.05, 'Mii rig (+Z front) faces +Z toward camera');

  // Releasing S keeps the character facing the camera instead of snapping away.
  up('KeyS');
  frames(20);
  assert.ok(Math.abs(shortestAngleDiff(walk.pose.bodyYaw, Math.PI)) < 0.05, 'character stays facing camera when stopped');

  // Walking diagonally forward-right turns smoothly toward movement direction without affecting camera yaw.
  down('KeyW');
  down('KeyD');
  frames(30);
  assert.equal(walk.pose.yaw, initialYaw);
  assert.ok(Math.abs(shortestAngleDiff(walk.pose.bodyYaw, -Math.PI / 4)) < 0.08);
  up('KeyW');
  up('KeyD');

  // Interacting with a door while facing away smoothly turns the character toward the door.
  down('KeyS');
  frames(30);
  up('KeyS');
  assert.ok(Math.abs(shortestAngleDiff(walk.pose.bodyYaw, Math.PI)) < 0.05);
  for (let i = 0; i < 20; i++) {
    walk.applyDoorFollow(1 / 60, {
      kind: 'grab',
      intensity: 1,
      releasing: false,
      autoPush: false,
      doorPos: { x: walk.pose.x, y: 1.15, z: walk.pose.z - 1.0 }
    });
  }
  assert.ok(Math.abs(shortestAngleDiff(walk.pose.bodyYaw, 0)) < 0.08, 'door interaction faces character toward the door');

  // Returning to first person realigns bodyYaw with camera yaw.
  down('KeyS');
  frames(30);
  up('KeyS');
  down('KeyV');
  frames(45);
  assert.ok(Math.abs(shortestAngleDiff(walk.pose.bodyYaw, walk.pose.yaw)) < 0.01);
});

test('bundled authentic Mii head GLB contains official FFL face, nose, hair, and facial feature mask meshes', () => {
  const buf = fs.readFileSync(new URL('../assets/models/miiHead.glb', import.meta.url));
  assert.equal(buf.subarray(0, 4).toString('ascii'), 'glTF');
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const meshNames = new Set((json.meshes || []).map(m => m.name));
  for (const required of ['OpaFaceline', 'OpaNose', 'OpaHair', 'XluMask', 'XluNoseLine']) {
    assert.ok(meshNames.has(required), `miiHead.glb missing official FFL mesh ${required}`);
  }
  assert.ok((json.images || []).length >= 2, 'miiHead.glb embeds Mii facial feature textures');
  assert.ok(PLAYER_BODY_CONFIG.streetpass.headScale > 0.6 && PLAYER_BODY_CONFIG.switch.headScale > 0.6);
});

test('first-to-third and third-to-first transitions animate smoothly across frames, reverse mid-flight, and work while paused', t => {
  const { walk, camera, frames, click, down } = setupWalk(t);
  click('enter');
  frames();
  assert.equal(walk.pose.thirdPersonBlend, 0);
  assert.equal(walk.animating, false);

  // Toggling third person begins a smooth glide rather than snapping on frame 0.
  click('camera-btn');
  assert.equal(walk.thirdPerson, true);
  assert.equal(walk.animating, true);
  assert.equal(walk.pose.thirdPersonBlend, 0, 'does not snap immediately on click');
  assert.equal(camera.position.z, 0);

  // Sample transition over ~0.42 s: camera distance and blend advance monotonically.
  let prevZ = camera.position.z;
  let sawMidBlend = false;
  let sawHeadCrossfade = false;
  let sawFovPulse = false;
  for (let i = 0; i < 30; i++) {
    frames(1, 1 / 60);
    assert.ok(camera.position.z >= prevZ - 1e-6, 'camera glides monotonically backward');
    prevZ = camera.position.z;
    if (walk.pose.thirdPersonBlend > 0.25 && walk.pose.thirdPersonBlend < 0.75) sawMidBlend = true;
    if (walk.pose.headOpacity > 0.05 && walk.pose.headOpacity < 0.95) sawHeadCrossfade = true;
    if (camera.fov > BASE_FOV + 0.8) sawFovPulse = true;
  }
  assert.equal(sawMidBlend, true, 'transition passes smoothly through intermediate positions');
  assert.equal(sawHeadCrossfade, true, 'Mii head fades in smoothly instead of popping');
  assert.equal(sawFovPulse, true, 'transition applies subtle lens FOV glide pulse');
  assert.equal(walk.pose.thirdPersonBlend, 1);
  assert.equal(walk.pose.headOpacity, 1);
  assert.ok(Math.abs(camera.fov - BASE_FOV) < 0.02, 'FOV settles back to base at end of glide');
  assert.equal(walk.animating, false);

  // Reversing mid-transition smoothly glides back to first person without jumping.
  down('KeyV');
  frames(10, 1 / 60);
  const midReturnBlend = walk.pose.thirdPersonBlend;
  assert.ok(midReturnBlend > 0.15 && midReturnBlend < 0.9);
  down('KeyV'); // reverse back toward third person mid-flight
  frames(2, 1 / 60);
  assert.ok(walk.pose.thirdPersonBlend > midReturnBlend, 'reversing mid-flight reverses smoothly');
  frames(30, 1 / 60);
  assert.equal(walk.pose.thirdPersonBlend, 1);

  // While paused, clicking the button still runs a smooth transition via stepTransition(dt).
  walk.pause();
  assert.equal(walk.active, false);
  click('camera-btn');
  assert.equal(walk.thirdPerson, false);
  assert.equal(walk.animating, true);
  assert.equal(walk.pose.thirdPersonBlend, 1, 'paused toggle does not snap immediately');
  let sawPausedMid = false;
  for (let i = 0; i < 35 && walk.animating; i++) {
    walk.stepTransition(1 / 60);
    if (walk.pose.thirdPersonBlend > 0.2 && walk.pose.thirdPersonBlend < 0.8) sawPausedMid = true;
  }
  assert.equal(sawPausedMid, true, 'paused transition animates smoothly frame by frame');
  assert.equal(walk.animating, false);
  assert.equal(walk.pose.thirdPersonBlend, 0);
  assert.equal(walk.pose.headOpacity, 0);
  assert.ok(Math.abs(camera.position.z) < 1e-6);
});

test('index.html exposes the third-person button and V keybinding', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="camera-btn"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /3\.ª persona/);
  assert.match(html, /<kbd[^>]*>V<\/kbd>/);
});
