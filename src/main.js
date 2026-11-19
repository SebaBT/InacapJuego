import { PerspectiveCamera, Vector3 } from 'three';
import { makeRenderer } from './render.js';
import { buildCorridor } from './corridor.js';
import { firstPerson } from './walk.js';
import { computePlayerFear } from './player-motion.js';
import { makeMascot } from './mascot.js';
import { capturePose, createMonsterHunt } from './monster-hunt.js';
import { createCaptureShot } from './monster-capture.js';
import { makePlayerBody } from './player-body.js';
import { createAtmosphere } from './atmosphere.js';
import { createFurniture } from './furniture.js';
import { createScreenFx } from './screen-fx.js';
import { createDoorController } from './doors.js';
import { setupDebug } from './debug.js';
import { bindSoundControl, makeControlledDoorAudio, soundState } from './sound.js';
import { extraLights, hall, lights, monsterSpawn, playerSpawn, plazaLights, rooms, worldBounds } from './layout.js';

const canvas = document.querySelector('#view');
const status = document.querySelector('#message');
const interactPrompt = document.querySelector('#interact-prompt');
const interactBtn = document.querySelector('#interact-btn');
const menuCaption = document.querySelector('#menu-context');

function start() {
  const renderer = makeRenderer(canvas);
  const { minX, maxX, minZ, maxZ } = worldBounds;
  const sightRange = Math.max(135, Math.hypot(maxX - minX, maxZ - minZ, hall.height) * 1.6);
  const camera = new PerspectiveCamera(64, 1, .045, sightRange);
  const { scene, obstacles, doors, switches, debris, furniture: movableFurniture } = buildCorridor(renderer.material);
  const actor = makeMascot(renderer.material);
  scene.add(actor.root);
  const playerObstacles = [...obstacles];
  for (const { min, max } of actor.collisions) playerObstacles.push({
    get x0() { return min.x; }, get x1() { return max.x; },
    get z0() { return min.z; }, get z1() { return max.z; }
  });
  let scheduled = false, lastTime = 0, contextLost = false;
  function wake() {
    if (scheduled || contextLost) return;
    scheduled = true;
    requestAnimationFrame(frame);
  }
  const playerBody = makePlayerBody(renderer.material, wake);
  scene.add(playerBody.root);
  const atmosphere = createAtmosphere(lights, extraLights);
  const doorAudio = makeControlledDoorAudio(soundState);
  const doorCtrl = createDoorController({ doors, switches, atmosphere, audio: doorAudio });
  let hunt;
  const furniture = createFurniture({
    props: movableFurniture,
    obstacles,
    onChange: () => hunt?.invalidateNavigation()
  });
  hunt = createMonsterHunt({ obstacles, doors, holdDoor: doorCtrl.holdForMonster, closeDoor: doorCtrl.closeForMonster, furniture });
  const doorStates = [...rooms.map(r => r.id), 'anexo', 'anexo', ...plazaLights.map(() => 'plaza')]
    .map(id => doorCtrl.doors.find(d => d.id === id) || null);
  const game = document.querySelector('#game');
  const screenFx = createScreenFx(game);
  let preset = 'arrival', hasStarted = false;
  let captureShot = null, expression = null;
  const menuTitle = document.querySelector('#menu-title'), enterLabel = document.querySelector('#enter-label');
  const targetLocal = new Vector3();
  const walk = firstPerson(camera, playerObstacles, wake, {
    debris,
    isInspecting: () => Boolean(preset) || game.classList.contains('inspecting'),
    onBegin: () => {
      screenFx.reset();
      preset = null;
      expression = null;
      lastTime = 0;
      if (hasStarted && hunt.state.mode !== 'dead') return;
      if (hunt.state.mode === 'dead') {
        hunt.reset(); doorCtrl.reset(); actor.face.reset();
        captureShot = null;
        game.style.setProperty('--capture-fade', '0');
        menuTitle.textContent = 'Pabellón B';
      }
      hasStarted = true;
      walk.restartAt(playerSpawn.x, playerSpawn.z);
      if (menuCaption) menuCaption.textContent = 'Recorrido en pausa';
    },
    onPause: () => {
      doorAudio.silenceMonster();
      screenFx.reset();
      // Pausing mid-grab must not leave the final curtain behind the menu.
      // Death keeps its completed fade until the retry resets it.
      if (hunt.state.mode === 'capture') game.style.setProperty('--capture-fade', '0');
    },
    onStickDirection: key => debug.recordStickDirection(key),
    onInteract: () => {
      doorCtrl.interact(walk.pose);
      wake();
    }
  });
  const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  function unlockGameAudio() {
    if (soundState.effectiveVolume <= 0) return;
    if (atmosphere.state.audioEnabled) atmosphere.audio.unlock();
    doorAudio.unlock();
  }
  bindSoundControl(document, soundState, { onInteract: unlockGameAudio });
  document.querySelector('#enter')?.addEventListener('click', unlockGameAudio);
  canvas.addEventListener('pointerdown', unlockGameAudio);
  function frameView(view) {
    preset = view;
    // Inspection uses the original display spot and its own camera. The
    // player's position (including stairs) and the live hunt remain intact.
    actor.place(monsterSpawn.x, 0, monsterSpawn.z, monsterSpawn.yaw);
    if (view === 'face') {
      const distance = .27 + Math.max(.96, .51 / (Math.tan(camera.fov * Math.PI / 360) * camera.aspect));
      camera.position.set(0, 1.61, monsterSpawn.z + distance);
      camera.rotation.set(Math.atan2(.015, distance), 0, 0, 'YXZ');
      return;
    }
    const halfSpan = (actor.bounds.max.x - actor.bounds.min.x) / 2;
    const distance = Math.min(15, Math.max(2.83, .38 + (halfSpan + .16) / (Math.tan(camera.fov * Math.PI / 360) * camera.aspect)));
    const angle = { arrival: .36, front: 0, quarter: Math.PI / 4, back: Math.PI }[view];
    const x = Math.min(hall.halfWidth - .37, distance * Math.sin(angle));
    const dz = Math.sign(Math.cos(angle)) * Math.sqrt(distance * distance - x * x);
    const targetY = (actor.bounds.max.y + actor.bounds.min.y) / 2 + .055;
    camera.position.set(x, 1.61, monsterSpawn.z + dz);
    camera.lookAt(0, targetY, monsterSpawn.z);
  }
  const debug = setupDebug(scene, actor, walk, frameView, wake, playerBody, atmosphere, debris);

  function playEncounter(dt, pose) {
    const s = hunt.update(dt, pose);
    furniture.update(dt, s.carry);
    const caught = s.mode === 'capture' || s.mode === 'dead';
    if (caught && !captureShot) {
      captureShot = createCaptureShot(camera, pose);
      walk.setCaptured(true);
      doorAudio.silenceMonster();
      // The grab has its own monstrous vocal impact immediately, before the
      // full abyssal roar lands at ~0.78 s into the capture.
      doorAudio.monsterScream('alert', 0.95, 0);
    }
    actor.place(s.x, s.y, s.z, s.yaw);
    actor.setAnimation(s.animation);
    const nextExpression = caught ? 'scream' : s.mode === 'chase' ? 'chase' : 'normal';
    if (expression !== nextExpression) {
      actor.face.setExpression(nextExpression);
      expression = nextExpression;
    }
    const d = Math.hypot(pose.x - s.x, pose.z - s.z);
    const target = s.visible || caught ? actor.root.worldToLocal(targetLocal.set(pose.x, pose.cameraY, pose.z)) : null;
    const capture = caught ? capturePose(s.captureTime) : null;
    actor.update(dt, target ? d : Infinity, target, { fold: s.fold, doorPress: s.doorPress, stridePhase: s.stridePhase,
      stoop: Math.max(0, s.y - .72), captureSide: s.captureSide, capture, throw: s.throwPose });
    const pan = ((s.x - pose.x) * Math.cos(pose.yaw) - (s.z - pose.z) * Math.sin(pose.yaw)) / Math.max(.01, d);
    if (s.stomp) {
      // Signed float: ±1 while running, ±0.65 while stalking.
      const stepScale = Math.abs(s.stomp);
      const strength = ((Math.max(0, 1 - d / 22)) ** 1.25) * stepScale;
      walk.monsterStep(strength, Math.sign(s.stomp));
      doorAudio.monsterStomp(strength, pan);
    }
    if (s.impact) {
      // The thrown desk lands: a low thump and a short camera jolt, scaled by
      // distance, without the footstep cue used while running.
      const strength = Math.max(0, 1 - d / 18) ** 1.2;
      if (!reducedMotionQuery.matches) walk.triggerSlamImpact(pan < 0 ? -1 : 1, .35 + .35 * strength);
      doorAudio.monsterStomp(.45 + .35 * strength, pan);
    }
    if (s.scream) doorAudio.monsterScream(s.scream, Math.max(.12, 1 - d / 25), pan);
    if (s.growl) doorAudio.monsterGrowl?.(s.growl, Math.max(.08, (1 - d / 24) ** 1.2), pan);
    if (!capture) return pose;
    game.style.setProperty('--capture-fade', capture.fade.toFixed(3));
    const victim = captureShot(actor, s, capture, obstacles, reducedMotionQuery.matches);
    if (s.mode === 'dead') {
      walk.pause();
      menuCaption.textContent = 'La Veladora te atrapó';
      menuTitle.textContent = 'Has muerto';
      enterLabel.textContent = 'Volver a intentarlo';
    }
    return victim;
  }

  function frame(now) {
    scheduled = false;
    if (contextLost) return;
    const dt = lastTime ? Math.min(.08, (now - lastTime) / 1000) : 0;
    if (walk.active) walk.update(dt);
    else if (walk.animating) walk.stepTransition(dt);
    const approachPose = walk.pose;
    const controlling = walk.active && !captureShot;
    doorCtrl.update(walk.active ? dt : 0, controlling ? approachPose : null, controlling);
    const slam = doorCtrl.consumeSlam();
    if (slam && walk.active) walk.triggerSlamImpact(slam.side, slam.strength);
    const doorInteraction = controlling ? doorCtrl.getInteractionState(approachPose) : null;
    walk.applyDoorFollow(dt, doorInteraction);
    let pose = walk.pose;
    const inspecting = game.classList.contains('inspecting');
    const previewing = Boolean(preset) || inspecting || pose.noclip;
    if (walk.active && !previewing) pose = playEncounter(dt, pose);
    else if (previewing) {
      if (preset) frameView(preset);
      if (actor.update(dt, Infinity)) debug.refresh();
    } else if (captureShot && hunt.state.mode === 'capture') {
      pose = captureShot(actor, hunt.state, capturePose(hunt.state.captureTime), obstacles, reducedMotionQuery.matches);
    }
    // Seeing the monster nearby — or merely feeling her close — makes the
    // player tremble, pant, and panic.
    if (walk.active && !previewing) {
      const playerSeesMonster = hunt.navigation.visible(
        { x: pose.x, y: pose.cameraY, z: pose.z },
        { x: hunt.state.x, y: hunt.state.y + 1.55, z: hunt.state.z }
      );
      walk.setFear(computePlayerFear({
        playerX: pose.x,
        playerZ: pose.z,
        playerYaw: pose.yaw,
        monsterX: hunt.state.x,
        monsterZ: hunt.state.z,
        monsterVisible: hunt.state.visible,
        monsterMode: hunt.state.mode,
        playerSeesMonster
      }));
    }
    const screenFxFrame = screenFx.update({
      running: walk.active && !previewing,
      reducedMotion: reducedMotionQuery.matches,
      pose,
      monster: hunt.state
    }, dt);
    const openings = renderer.environment.doorOpenings?.value;
    if (openings) {
      for (let i = 0; i < doorStates.length && i < openings.length; i++) {
        if (doorStates[i]) openings[i].z = doorStates[i].open;
      }
    }
    const promptText = walk.active && !captureShot ? doorCtrl.prompt : '';
    if (interactPrompt) interactPrompt.textContent = promptText;
    if (interactBtn) interactBtn.hidden = !promptText;
    playerBody.update(dt, pose, {
      inspecting: inspecting || Boolean(preset),
      hasStarted,
      doorInteraction: captureShot ? null : doorInteraction,
      obstacles: playerObstacles,
      bounds: worldBounds,
      reducedMotion: reducedMotionQuery.matches
    });
    atmosphere.update(dt, {
      reducedMotion: reducedMotionQuery.matches,
      active: walk.active,
      cameraX: camera.position.x,
      cameraZ: camera.position.z
    });
    atmosphere.apply(renderer.environment);
    renderer.draw(scene, camera, screenFxFrame);
    if (walk.active || walk.animating || (previewing && actor.animating) || atmosphere.animating(reducedMotionQuery.matches)) {
      lastTime = now;
      wake();
    } else {
      lastTime = 0;
    }
  }
  function resize() { renderer.resize(camera); if (preset) frameView(preset); wake(); }
  window.addEventListener('resize', resize);
  reducedMotionQuery.addEventListener('change', wake);
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault();
    contextLost = true;
    walk.pause();
    document.querySelector('#enter').disabled = true;
    status.textContent = 'Recuperando la imagen del pasillo…';
  });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false;
    status.textContent = '';
    document.querySelector('#enter').disabled = false;
    resize();
  });
  resize();
}

try { start(); }
catch (error) {
  console.error(error);
  document.querySelector('#enter').disabled = true;
  status.textContent = 'No se pudo dibujar el pasillo. Abre el juego en un navegador con WebGL 2 y aceleración gráfica.';
}
