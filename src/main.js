import { PerspectiveCamera, Vector3 } from 'three';
import { makeRenderer } from './render.js';
import { makeTexturesAsync } from './textures.js';
import { buildCorridor } from './corridor.js';
import { firstPerson } from './walk.js';
import { bindTap } from './touch-tap.js';
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
import {
  extraLights, gateFixtures, hall, lights, monsterSpawn, playerSpawn, plazaLights, rooms, worldBounds
} from './layout.js';
import {
  allGateLocksUnlocked,
  computeEscalation,
  countGateLocksUnlocked,
  createMatchState,
  formatCountdown,
  formatElapsedClock,
  GAME_PHASES,
  KEY_ITEMS,
  LORE_ITEMS,
  OUTCOMES,
  resetMatchState,
  resolveEscapeOutcome,
  stepMatchTimer, THREAT_STAGES
} from './game-state.js';
import {
  createBreakableDebris,
  createHandViewModel,
  createInventory,
  createRoidSpray,
  createWorldItems,
  ITEM_CATALOG, ENERGY_SECONDS, FLASH_SECONDS, ROID_FLEE_SECONDS
} from './items.js';
import { createItemModels } from './item-models.js';
import { createObjectiveGuide } from './objectives.js';
import { makeGameplayAudio } from './gameplay-audio.js';
import { createGameMusic } from './music.js';
import { createCinematics, setGateOpenVisual } from './cinematics.js';

const SUMMARY_ICONS = {
  keys: '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><circle cx="7" cy="10" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.2 10h6.6v2.4M14 10v2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  tapes: '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><rect x="2.8" y="5" width="14.4" height="10" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="10" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="13" cy="10" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>',
  time: '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><circle cx="10" cy="10.5" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 6.8v3.9l2.6 1.6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>'
};

const yieldFrame = () => new Promise(resolve => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
  else setTimeout(resolve, 0);
});

const game = document.querySelector('#game');
const canvas = document.querySelector('#view');
const status = document.querySelector('#message');
const interactPrompt = document.querySelector('#interact-prompt');
const interactBtn = document.querySelector('#interact-btn');
const useBtn = document.querySelector('#use-btn');
const holsterBtn = document.querySelector('#holster-btn');
const skipHint = document.querySelector('#skip-hint');
const cineWhisper = document.querySelector('#cine-whisper');
const menuCaption = document.querySelector('#menu-context');
const menuTitle = document.querySelector('#menu-title');
const menuSummary = document.querySelector('#menu-summary');
const sumKeys = document.querySelector('#sum-keys');
const sumTapes = document.querySelector('#sum-tapes');
const sumTime = document.querySelector('#sum-time');
const enterBtn = document.querySelector('#enter');
const enterLabel = document.querySelector('#enter-label');
const loaderEl = document.querySelector('#loader');
const loaderFill = document.querySelector('#loader-fill');
const loaderPct = document.querySelector('#loader-pct');
const menuBrief = document.querySelector('#menu-brief');
const contentWarning = document.querySelector('#content-warning');
const warningContinue = document.querySelector('#warning-continue');
const warningBack = document.querySelector('#warning-back');
const ui = Object.fromEntries(['mission', 'mission-title', 'mission-route', 'bearing-arrow', 'threat-level', 'threat-notice',
  'held-readout', 'held-name', 'held-action', 'equip-slots', 'tape-count', 'cine-chapter', 'skip-label']
  .map(id => [id, document.getElementById(id)]));
function write(el, value) { if (el && el.textContent !== value) el.textContent = value; }
const hudTimer = document.querySelector('#hud-timer');
const hudClock = document.querySelector('#hud-clock');

function setLoadProgress(fraction) {
  const pct = Math.max(0, Math.min(1, fraction));
  if (loaderFill) loaderFill.style.transform = `scaleX(${pct.toFixed(4)})`;
  if (loaderPct) loaderPct.textContent = `${Math.round(pct * 100)} %`;
}

function lookingAt(pose, target, maxDist, minDot = 0.45) {
  if (!pose || !target) return null;
  const dx = target.x - pose.x;
  const dy = (target.y ?? 1.2) - (pose.cameraY ?? 1.61);
  const dz = target.z - pose.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist > maxDist || dist < 0.05) return null;
  const cosP = Math.cos(pose.pitch || 0);
  const dirX = -Math.sin(pose.yaw || 0) * cosP;
  const dirY = Math.sin(pose.pitch || 0);
  const dirZ = -Math.cos(pose.yaw || 0) * cosP;
  const dot = (dx * dirX + dy * dirY + dz * dirZ) / dist;
  if (dot < minDot) return null;
  return { dist, dot };
}

async function start() {
  setLoadProgress(0.04);
  const renderer = makeRenderer(canvas);
  const { minX, maxX, minZ, maxZ } = worldBounds;
  const sightRange = Math.max(135, Math.hypot(maxX - minX, maxZ - minZ, hall.height) * 1.6);
  const camera = new PerspectiveCamera(64, 1, .045, sightRange);

  const art = await makeTexturesAsync(p => setLoadProgress(0.04 + p * 0.44), yieldFrame);
  setLoadProgress(0.50);

  const { scene, obstacles, doors, switches, debris, furniture: movableFurniture, destruction, specials } =
    buildCorridor(renderer.material, art);
  await yieldFrame();
  setLoadProgress(0.64);

  const actor = makeMascot(renderer.material);
  scene.add(actor.root);
  const actorObstacles = actor.collisions.map(({ min, max }) => ({
    get x0() { return min.x; }, get x1() { return max.x; },
    get z0() { return min.z; }, get z1() { return max.z; }
  }));
  const playerObstacles = [];
  function syncTerrain() {
    playerObstacles.length = 0;
    playerObstacles.push(...obstacles, ...actorObstacles);
  }
  syncTerrain();
  const models = createItemModels(renderer.material, art.white);
  const worldItems = createWorldItems({ scene, makeMaterial: renderer.material, whiteTex: art.white, models,
    visible: (p, item) => hunt.navigation.canReach({ x: p.x, y: p.cameraY, z: p.z },
      { x: item.x, y: item.y + .14, z: item.z }) });
  const handView = createHandViewModel({ models, makeMaterial: renderer.material, whiteTex: art.white });
  const roidSpray = createRoidSpray({ scene });
  const smashDebris = createBreakableDebris({ scene, makeMaterial: renderer.material, whiteTex: art.white });
  const inventory = createInventory();
  const slotButtons = inventory.slots.map(({ kind }, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inv-slot';
    button.dataset.slot = kind;
    button.innerHTML = `<span class="slot-key" aria-hidden="true">${index + 1}</span>
      <svg class="hud-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-${kind}"/></svg>
      <span class="slot-count" aria-hidden="true"></span>`;
    bindTap(button, () => { unlockGameAudio(); selectEquipment(index); });
    ui['equip-slots'].append(button);
    return button;
  });
  const match = createMatchState();
  setLoadProgress(0.74);

  let scheduled = false, lastTime = 0, contextLost = false, readyToDraw = false;
  function wake() {
    if (!readyToDraw || scheduled || contextLost) return;
    scheduled = true;
    requestAnimationFrame(frame);
  }

  const playerBody = makePlayerBody(renderer.material, wake);
  scene.add(playerBody.root);
  await playerBody.ready;
  setLoadProgress(0.88);

  const atmosphere = createAtmosphere(lights, extraLights);
  const doorAudio = makeControlledDoorAudio(soundState);
  const gameplayAudio = makeGameplayAudio(soundState);
  const gameMusic = createGameMusic({ sound: soundState });
  function setMusic(state) {
    gameMusic.set(state);
    game.dataset.music = gameMusic.getState().state;
  }
  const doorCtrl = createDoorController({ doors, switches, atmosphere, audio: doorAudio });
  let hunt;
  const furniture = createFurniture({
    props: movableFurniture,
    obstacles,
    onChange: () => hunt?.invalidateNavigation()
  });
  hunt = createMonsterHunt({
    obstacles,
    doors,
    holdDoor: doorCtrl.holdForMonster,
    closeDoor: doorCtrl.closeForMonster,
    destruction, furniture
  });
  const doorStates = [...rooms.map(r => r.id), 'anexo', 'anexo', ...plazaLights.map(() => 'plaza')]
    .map(id => doorCtrl.doors.find(d => d.id === id) || null);
  const guide = createObjectiveGuide(hunt.navigation);
  const screenFx = createScreenFx(game);

  let preset = 'arrival', hasStarted = false, pausedPhase = GAME_PHASES.PLAYING;
  let captureShot = null, expression = null;
  let transientWhisper = '', whisperTimer = 0;
  let flashBurstLevel = 0, torchPower = 0.22;
  let threatStage = 0, noticeUntil = 0;
  const targetLocal = new Vector3();
  const torchDir = new Vector3();
  const roidDir = new Vector3();
  const roidOffset = new Vector3();

  function setWhisper(text, secs = 2.6) {
    transientWhisper = text;
    whisperTimer = secs;
  }

  function updateSummaryChips() {
    if (!menuSummary) return;
    const keysDone = inventory.keysFoundCount;
    if (sumKeys) sumKeys.innerHTML = `${SUMMARY_ICONS.keys}<span>${keysDone}/3</span>`;
    if (sumTapes) sumTapes.innerHTML = `${SUMMARY_ICONS.tapes}<span>${inventory.tapesCount}/${LORE_ITEMS.length}</span>`;
    if (sumTime) sumTime.innerHTML = `${SUMMARY_ICONS.time}<span>${formatElapsedClock(match.elapsed)}</span>`;
  }

  function syncLiveHud(pose = walk.pose) {
    write(hudClock, formatCountdown(match.elapsed));
    const stage = THREAT_STAGES[threatStage];
    write(ui['threat-level'], stage.name);
    game.dataset.threat = String(threatStage);
    hudTimer.dataset.phase = threatStage === 3 ? 'frenzy' : threatStage ? 'warning' : 'normal';
    if (match.phase === GAME_PHASES.PLAYING && !captureShot) {
      const goal = guide.update(pose, inventory, match.gateLocks);
      write(ui['mission-title'], goal.item);
      write(ui['mission-route'], goal.landmark + ' · ' + goal.meters + ' m');
      const routeLabel = goal.title + ' · ' + goal.destination + '. ' + goal.next;
      if (ui.mission.title !== routeLabel) {
        ui.mission.title = routeLabel;
        ui.mission.setAttribute('aria-label', routeLabel);
      }
      ui['bearing-arrow'].style.transform = 'rotate(' + goal.angle.toFixed(2) + 'rad)';
    }
    if (match.elapsed >= noticeUntil) write(ui['threat-notice'], '');
    const showingFilm = cinematics.active && !cinematics.holding && match.phase !== GAME_PHASES.PAUSED;
    game.classList.toggle('in-cutscene', showingFilm);
    if (skipHint) skipHint.hidden = !showingFilm || !cinematics.canSkip;
    const skipText = cinematics.awaitingStart ? 'Comenzar' : 'Omitir';
    write(ui['skip-label'], skipText);
    skipHint.setAttribute('aria-label', skipText);
    write(ui['cine-chapter'], showingFilm ? cinematics.chapter : '');
    write(cineWhisper, showingFilm ? cinematics.whisper : match.phase === GAME_PHASES.PLAYING ? transientWhisper : '');
    game.classList.toggle('adrenaline-active', inventory.adrenalineActive);
    game.classList.toggle('point-of-no-return', match.pointOfNoReturn);
  }

  function syncHud() {
    const equipped = inventory.equipped, def = ITEM_CATALOG[equipped];
    inventory.slots.forEach(({ kind, count, usedOnGate }, i) => {
      const button = slotButtons[i], item = ITEM_CATALOG[kind];
      button.disabled = !count;
      button.classList.toggle('installed', usedOnGate);
      button.classList.toggle('stowed', Boolean(count) && equipped !== kind);
      button.setAttribute('aria-pressed', String(equipped === kind));
      const label = item.label + (usedOnGate ? ' · Instalado' : count ? ' ×' + count : ' · Vacío') +
        '. ' + item.purpose + (equipped === kind ? ' Pulsa otra vez para guardarlo y dejar las manos libres.' : '');
      button.title = label;
      button.setAttribute('aria-label', label);
      write(button.lastElementChild, usedOnGate ? '✓' : count > 1 ? String(count) : '');
    });
    write(ui['tape-count'], inventory.tapesCount + '/' + LORE_ITEMS.length);
    handView.setItem(equipped);
    if (ui['held-readout']) ui['held-readout'].hidden = false;
    ui['held-readout']?.classList.toggle('hands-free', !def);
    write(ui['held-name'], def ? def.short : 'Manos libres');
    ui['held-name'].title = def
      ? def.purpose + ' · X para guardarlo'
      : 'Tienes las manos libres. Pulsa 1–6 o X para volver a equipar.';
    useBtn.hidden = def?.category !== 'tool';
    holsterBtn.hidden = !def;
    if (def) {
      write(ui['held-action'], def.action);
      useBtn.setAttribute('aria-label', def.action + '. ' + def.purpose);
      holsterBtn.setAttribute('aria-label', 'Guardar ' + def.short + ' y dejar las manos libres (X)');
      holsterBtn.title = 'Guardar ' + def.short + ' · X';
    }
    syncLiveHud();
  }

  let walk;
  let cinematics;
  let contentWarningAcknowledged = false;
  let contentWarningOpen = false;

  // Shown after Entrar but before the intro cinematic. The warning is a real
  // modal, so the monster loop cannot start behind it and the camera keeps the
  // user gesture for pointer lock when the player accepts.
  function gateContentWarning() {
    if (contentWarningAcknowledged) return true;
    if (!contentWarning?.showModal) {
      contentWarningAcknowledged = true;
      return true;
    }
    if (contentWarningOpen) return false;
    contentWarningOpen = true;
    try {
      contentWarning.showModal();
    } catch {
      contentWarningOpen = false;
      contentWarningAcknowledged = true;
      return true;
    }
    warningContinue?.focus();
    return false;
  }

  function showEnding(outcome) {
    match.phase = GAME_PHASES.ENDING;
    match.outcome = outcome;
    transientWhisper = '';
    whisperTimer = 0;
    game.classList.remove('in-cutscene');
    const isWin = outcome === OUTCOMES.VICTORY || outcome === OUTCOMES.VICTORY_COMPLETE;
    setMusic(outcome === OUTCOMES.VICTORY_COMPLETE ? 'truewin' : isWin ? 'win' : 'lose');
    game.classList.toggle('outcome-victory', isWin);
    game.classList.toggle('outcome-defeat', !isWin);
    if (walk.active) walk.pause();
    if (outcome === OUTCOMES.VICTORY_COMPLETE) {
      if (menuCaption) menuCaption.textContent = 'Final completo · Amanecer';
      if (menuTitle) menuTitle.textContent = 'Verdad revelada';
    } else if (outcome === OUTCOMES.VICTORY) {
      if (menuCaption) menuCaption.textContent = 'Salida desbloqueada';
      if (menuTitle) menuTitle.textContent = 'Sobreviviste';
    } else if (outcome === OUTCOMES.DEFEAT_TIMEOUT) {
      if (menuCaption) menuCaption.textContent = '03:00 · Tiempo agotado';
      if (menuTitle) menuTitle.textContent = 'Encerrado';
    } else {
      if (menuCaption) menuCaption.textContent = 'Mothy te atrapó';
      if (menuTitle) menuTitle.textContent = 'Has caído';
    }
    write(menuBrief, isWin ? (outcome === OUTCOMES.VICTORY_COMPLETE
      ? 'Las tres cintas llegaron al otro lado del portón.' : 'Lograste salir antes del cierre. Las tres cintas revelan el final completo.')
      : outcome === OUTCOMES.DEFEAT_TIMEOUT ? 'El cierre de seguridad bloqueó el pabellón.'
      : 'Mothy te alcanzó. Un flash puede darte tiempo para escapar.');
    updateSummaryChips();
    if (menuSummary) menuSummary.hidden = false;
    if (enterLabel) enterLabel.textContent = 'Reintentar';
    if (interactPrompt) interactPrompt.textContent = '';
    if (interactBtn) interactBtn.hidden = true;
    syncHud();
    wake();
  }

  function resetFullMatch() {
    resetMatchState(match);
    inventory.reset();
    worldItems.reset();
    roidSpray.reset();
    smashDebris.reset();
    specials.gateControl?.reset();
    hunt.reset();
    syncTerrain();
    guide.reset();
    handView.reset();
    hunt.invalidateNavigation();
    doorCtrl.reset();
    atmosphere.reset();
    actor.face.reset();
    cinematics.stop();
    captureShot = null;
    expression = null;
    transientWhisper = '';
    whisperTimer = 0;
    flashBurstLevel = 0;
    torchPower = 0.22;
    threatStage = 0; noticeUntil = 0;
    setMusic('menu');
    write(ui['threat-notice'], '');
    game.style.setProperty('--capture-fade', '0');
    game.style.setProperty('--cine-fade', '0');
    game.classList.remove('outcome-victory', 'outcome-defeat', 'point-of-no-return', 'adrenaline-active', 'in-cutscene', 'roid-ready');
    if (menuSummary) menuSummary.hidden = true;
    syncHud();
  }

  function beginIntroSequence() {
    match.phase = GAME_PHASES.INTRO;
    screenFx.reset();
    preset = null;
    expression = null;
    lastTime = 0;
    hasStarted = true;
    setMusic('menu');
    game.classList.add('in-cutscene');
    cinematics.startIntro(() => {
      match.phase = GAME_PHASES.PLAYING;
      game.classList.remove('in-cutscene');
      write(menuBrief, 'Reúne la llave, el fusible y el cortapernos. El portón está en la plaza.');
      if (menuCaption) menuCaption.textContent = 'Recorrido en pausa';
      if (menuTitle) menuTitle.textContent = 'Pabellón B';
      if (enterLabel) enterLabel.textContent = 'Continuar';
      syncHud();
      wake();
    });
    syncHud();
  }

  function triggerEscapeSequence() {
    if (match.phase === GAME_PHASES.ESCAPING || match.phase === GAME_PHASES.ENDING) return;
    match.gateUnlocked = true;
    handView.reset();
    match.phase = GAME_PHASES.ESCAPING;
    setMusic('chase');
    const outcome = resolveEscapeOutcome(inventory.tapesCount);
    match.outcome = outcome;
    game.classList.add('in-cutscene');
    cinematics.startEscape({ isComplete: outcome === OUTCOMES.VICTORY_COMPLETE }, () => {
      showEnding(outcome);
    });
    syncHud();
    wake();
  }

  function installGateLock(kind) {
    if (!kind || match.gateLocks[kind] || !inventory.has(kind)) return false;
    inventory.consume(kind);
    handView.triggerUse(kind);
    match.gateLocks[kind] = true;
    specials.gateControl?.setLockVisual?.(kind, true);
    gameplayAudio.playLockInstall(kind);
    const unlockedCount = countGateLocksUnlocked(match.gateLocks);
    if (allGateLocksUnlocked(match.gateLocks)) {
      triggerEscapeSequence();
    } else {
      setWhisper(ITEM_CATALOG[kind].result + ` · ${unlockedCount}/3`, 3.2);
    }
    syncHud();
    return true;
  }

  function findGateLockTarget(pose) {
    const gateDoor = specials.gateControl?.door;
    if (!gateDoor || !gateDoor.locked || !pose) return null;
    if (pose.z > gateDoor.pos.z + .12) return null;
    let best = null;
    for (const [key, fixture] of Object.entries(gateFixtures)) {
      const hit = lookingAt(pose, fixture, 2.7, .68);
      if (!hit) continue;
      const miss = hit.dist * Math.sqrt(Math.max(0, 1 - hit.dot * hit.dot));
      if (miss < .52 && (!best || miss < best.miss)) best = { key, fixture, miss };
    }
    return best;
  }

  function computePromptText(pose) {
    if (!walk.active || captureShot || cinematics.active || match.phase !== GAME_PHASES.PLAYING) return '';
    const pickup = worldItems.findTarget(pose);
    if (pickup) return `[E] Recoger ${pickup.item.def.label.toLowerCase()}\n${pickup.item.def.purpose}`;
    const gateTarget = findGateLockTarget(pose);
    if (gateTarget) {
      const { key, fixture } = gateTarget;
      if (match.gateLocks[key]) return ITEM_CATALOG[key].result;
      return inventory.has(key) ? '[E] ' + ITEM_CATALOG[key].action : fixture.label + ' · Falta ' + ITEM_CATALOG[key].short.toLowerCase();
    }
    if (!match.breakerSurged && specials.breaker && lookingAt(pose, specials.breaker.pos, 2.3, 0.45)) {
      return '[E] Sobrecargar tablero';
    }
    if (specials.monitor && lookingAt(pose, specials.monitor.pos, 2.4, 0.45)) {
      return match.cameraPingCooldown > 0
        ? `Radar ${Math.ceil(match.cameraPingCooldown)}s`
        : '[E] Localizar a Mothy';
    }
    return doorCtrl.prompt;
  }

  function handleInteract() {
    if (!walk.active || captureShot || cinematics.active || match.phase !== GAME_PHASES.PLAYING) return false;
    const pose = walk.pose;
    const pickup = worldItems.findTarget(pose);
    if (pickup) {
      const { kind, def } = pickup.item;
      if (!inventory.add(kind)) return false;
      worldItems.collect(pickup.item);
      match.keysCollected = inventory.keysFoundCount;
      match.tapesCollected = inventory.tapesCount;
      gameplayAudio.playPickup(def.category);
      if (def.category === 'lore') {
        handView.inspect(kind);
        setWhisper(`Cintas · ${match.tapesCollected}/${LORE_ITEMS.length}`, 3.3);
      } else if (kind === 'roid') {
        setWhisper('ROID · apunta a Mothy y rocía con F', 4.4);
      }
      syncHud();
      wake();
      return true;
    }

    const gateTarget = findGateLockTarget(pose);
    if (gateTarget?.key) {
      const ok = installGateLock(gateTarget.key);
      wake();
      return ok;
    }

    if (!match.breakerSurged && specials.breaker && lookingAt(pose, specials.breaker.pos, 2.3, 0.45)) {
      match.breakerSurged = true;
      atmosphere.surge();
      gameplayAudio.playFlash();
      flashBurstLevel = Math.max(flashBurstLevel, 0.35);
      const md = Math.hypot(hunt.state.x - specials.breaker.pos.x, hunt.state.z - specials.breaker.pos.z);
      if (md < 20) hunt.stun(2.5);
      setWhisper('SOBRECARGA EN EL PABELLÓN', 2.4);
      wake();
      return true;
    }

    if (specials.monitor && lookingAt(pose, specials.monitor.pos, 2.4, 0.45)) {
      if (match.cameraPingCooldown <= 0) {
        match.cameraPingCooldown = 14;
        const dist = Math.round(Math.hypot(hunt.state.x - pose.x, hunt.state.z - pose.z));
        const sector = hunt.state.x < -3.6 ? 'PLAZA' : hunt.state.z < -8 ? 'NORTE' : 'SUR';
        gameplayAudio.playEquip();
        setWhisper(`RADAR · ${sector} · ${dist}M`, 3.0);
        wake();
        return true;
      }
      return false;
    }

    const doorDone = doorCtrl.interact(pose);
    wake();
    return Boolean(doorDone);
  }

  function findRoidTarget(pose) {
    const s = hunt.state;
    if (!pose || s.mode === 'capture' || s.mode === 'dead') return null;
    camera.updateMatrixWorld();
    camera.getWorldDirection(roidDir);
    roidOffset.set(s.x - camera.position.x, s.y + 1.08 - camera.position.y, s.z - camera.position.z);
    const dist = roidOffset.length();
    if (dist > 11 || dist < .35) return null;
    if (roidOffset.divideScalar(dist).dot(roidDir) < .74) return null;
    const eye = { x: pose.x, y: pose.cameraY, z: pose.z };
    if (!hunt.navigation.visible(eye, { x: s.x, y: s.y + 1.15, z: s.z })) return null;
    return { dist };
  }

  function handleUseItem() {
    if (!walk.active || captureShot || cinematics.active || match.phase !== GAME_PHASES.PLAYING) return false;
    const pose = walk.pose;
    const equipped = inventory.equipped;
    if (!equipped || handView.using) return false;

    if (equipped === 'energy') {
      if (inventory.consume('energy')) {
        inventory.adrenalineTimer = ENERGY_SECONDS;
        walk.refillStamina();
        walk.setAdrenaline(true);
        handView.triggerUse('energy');
        gameplayAudio.playEnergy();
        setWhisper('Aguante recuperado · 8 s', 2.6);
        syncHud();
        wake();
        return true;
      }
    } else if (equipped === 'roid') {
      const roidHit = findRoidTarget(pose);
      if (inventory.consume('roid')) {
        handView.triggerUse('roid');
        roidSpray.burst(camera, pose, Boolean(roidHit));
        gameplayAudio.playRoidSpray(Boolean(roidHit));
        if (roidHit) {
          hunt.repel(ROID_FLEE_SECONDS);
          setWhisper('ROID · Mothy huye', 3.4);
        } else {
          setWhisper('ROID · apunta a Mothy', 2.8);
        }
        syncHud();
        wake();
        return true;
      }
    } else if (equipped === 'flash') {
      if (inventory.consume('flash')) {
        handView.triggerUse('flash');
        gameplayAudio.playFlash();
        flashBurstLevel = 1.0;
        const dx = hunt.state.x - pose.x;
        const dz = hunt.state.z - pose.z;
        const d = Math.hypot(dx, dz) || 0.01;
        const facingDot = (-Math.sin(pose.yaw) * dx - Math.cos(pose.yaw) * dz) / d;
        const los = hunt.navigation.visible(
          { x: pose.x, y: pose.cameraY, z: pose.z },
          { x: hunt.state.x, y: hunt.state.y + 1.5, z: hunt.state.z }
        );
        if (d < 16.5 && los && facingDot > .2) {
          hunt.stun(FLASH_SECONDS);
          setWhisper('Aturdida · 4 s', 2.8);
        } else setWhisper('Fuera de alcance', 2.4);
        syncHud();
        wake();
        return true;
      }
    } else if (KEY_ITEMS.includes(equipped)) {
      const gateTarget = findGateLockTarget(pose);
      if (gateTarget?.key === equipped && !match.gateLocks[equipped] && inventory.has(equipped)) {
        return installGateLock(equipped);
      }
      setWhisper(gateFixtures[equipped].label + ' · Portón exterior', 3.2);
      return false;
    }
    return false;
  }

  walk = firstPerson(camera, playerObstacles, wake, {
    debris,
    isInspecting: () => Boolean(preset) || game.classList.contains('inspecting'),
    onStartRequest: gateContentWarning,
    onBegin: () => {
      if (match.phase === GAME_PHASES.ENDING) {
        resetFullMatch();
        beginIntroSequence();
        return;
      }
      if (match.phase === GAME_PHASES.MENU || !hasStarted || hunt.state.mode === 'dead') {
        resetFullMatch();
        beginIntroSequence();
        return;
      }
      if (match.phase === GAME_PHASES.PAUSED) {
        match.phase = pausedPhase;
        gameMusic.resume();
        game.dataset.music = gameMusic.getState().state;
        screenFx.reset();
        preset = null;
        lastTime = 0;
        syncHud();
        wake();
      }
    },
    onPause: () => {
      doorAudio.silenceMonster();
      gameplayAudio.silence();
      gameMusic.pause();
      game.dataset.music = gameMusic.getState().state;
      screenFx.reset();
      if (match.phase !== GAME_PHASES.ENDING) {
        pausedPhase = match.phase;
        match.phase = GAME_PHASES.PAUSED;
        write(menuCaption, pausedPhase === GAME_PHASES.INTRO ? 'Introducción en pausa' : 'Recorrido en pausa');
        write(menuTitle, 'Pabellón B');
        write(enterLabel, 'Continuar');
        if (cinematics.active) {
          write(menuBrief, cinematics.whisper);
          menuSummary.hidden = true;
        } else {
          const goal = guide.update(walk.pose, inventory, match.gateLocks);
          write(menuBrief, goal.title + ' · ' + goal.destination + '.');
          updateSummaryChips();
          menuSummary.hidden = false;
        }
      }
      if (hunt.state.mode === 'capture') game.style.setProperty('--capture-fade', '0');
      syncHud();
    },
    onStickDirection: key => debug.recordStickDirection(key),
    onInteract: handleInteract,
    onUseItem: handleUseItem,
    onSelectSlot: selectEquipment,
    onCycleSlot: cycleEquipment,
    onToggleHolster: toggleHandsFree,
    onSkipCinematic: () => {
      if (cinematics.skip()) wake();
    }
  });
  warningContinue?.addEventListener('click', e => {
    e.stopPropagation();
    contentWarningAcknowledged = true;
    contentWarningOpen = false;
    contentWarning?.close();
    walk.requestStart();
  });
  warningBack?.addEventListener('click', e => {
    e.stopPropagation();
    contentWarningOpen = false;
    contentWarning?.close();
    enterBtn?.focus();
  });
  contentWarning?.addEventListener('close', () => { contentWarningOpen = false; });
  contentWarning?.addEventListener('cancel', () => { contentWarningOpen = false; });
  if (enterBtn) enterBtn.disabled = true;

  cinematics = createCinematics({
    camera,
    actor,
    gateControl: specials.gateControl,
    atmosphere,
    gameplayAudio,
    doorAudio,
    walk,
    navigation: hunt.navigation
  });

  function cycleEquipment(direction) {
    if (match.phase !== GAME_PHASES.PLAYING || captureShot) return;
    inventory.cycle(direction);
    if (inventory.equipped) gameplayAudio.playEquip();
    syncHud();
    wake();
  }
  function selectEquipment(index) {
    if (match.phase !== GAME_PHASES.PLAYING || captureShot) return;
    // Pressing the slot that is already in hand stows it without throwing it
    // away. A second press, or X, brings it back.
    if (inventory.selectedIndex === index && inventory.equipped) {
      inventory.unequip();
      gameplayAudio.playHolster();
      syncHud();
      wake();
      return;
    }
    if (!inventory.equip(index)) return;
    gameplayAudio.playEquip();
    syncHud();
    wake();
  }
  function toggleHandsFree() {
    if (match.phase !== GAME_PHASES.PLAYING || captureShot) return;
    const wasEquipped = Boolean(inventory.equipped);
    if (!inventory.toggleHolster()) return;
    if (wasEquipped) gameplayAudio.playHolster(); else gameplayAudio.playEquip();
    syncHud();
    wake();
  }
  bindTap(useBtn, () => {
    unlockGameAudio();
    handleUseItem();
  }, { stopPropagation: true });
  bindTap(holsterBtn, () => {
    unlockGameAudio();
    toggleHandsFree();
  }, { stopPropagation: true });
  skipHint?.addEventListener('click', e => {
    e.stopPropagation();
    unlockGameAudio();
    if (cinematics.skip()) wake();
  });

  const reducedMotionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  function unlockGameAudio() {
    if (soundState.effectiveVolume <= 0) return;
    if (atmosphere.state.audioEnabled) atmosphere.audio.unlock();
    doorAudio.unlock();
    gameplayAudio.unlock();
    gameMusic.unlock();
  }
  bindSoundControl(document, soundState, { onInteract: unlockGameAudio });
  enterBtn?.addEventListener('click', unlockGameAudio);
  canvas.addEventListener('pointerdown', unlockGameAudio);

  function frameView(view) {
    preset = view;
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

  function playEncounter(dt, pose, escalation) {
    const threat = escalation ? { ...escalation } : null;
    const s = hunt.update(dt, pose, threat);
    furniture.update(dt, s.carry);
    const d = Math.hypot(pose.x - s.x, pose.z - s.z);
    const pan = ((s.x - pose.x) * Math.cos(pose.yaw) - (s.z - pose.z) * Math.sin(pose.yaw)) / Math.max(.01, d);

    if (s.smashedWall) {
      syncTerrain();
      const { x, y, z, dx, dz } = s.smashedWall;
      smashDebris.burst(x, y + .72, z, 0xa5ac9e, 18, dx, dz);
      gameplayAudio.playWallSmash(Math.max(0.25, 1 - d / 26), pan);
      if (!reducedMotionQuery.matches) walk.triggerSlamImpact(pan < 0 ? -1 : 1, .85 * Math.max(0, 1 - d / 20));
    }
    if (s.smashedProp) {
      smashDebris.burst(s.smashedProp.x ?? s.x, 0.55, s.smashedProp.z ?? s.z, 0x8d6e4c, 10);
      gameplayAudio.playWallSmash(Math.max(0.2, 1 - d / 24) * 0.72, pan);
    }

    const caught = s.mode === 'capture' || s.mode === 'dead';
    if (caught && !captureShot) {
      captureShot = createCaptureShot(camera, pose);
      walk.setCaptured(true);
      doorAudio.silenceMonster();
      gameplayAudio.silence();
      doorAudio.monsterScream('alert', 0.95, 0);
      setWhisper('Mothy te atrapó.', 2.65);
    }
    actor.place(s.x, s.y, s.z, s.yaw);
    actor.setAnimation(s.animation);
    const nextExpression = caught ? 'scream'
      : (s.stunned > 0 ? 'scream' : (s.mode === 'chase' || escalation?.frenzy) ? 'chase' : 'normal');
    if (expression !== nextExpression) {
      actor.face.setExpression(nextExpression);
      expression = nextExpression;
    }
    const target = s.visible || caught ? actor.root.worldToLocal(targetLocal.set(pose.x, pose.cameraY, pose.z)) : null;
    const capture = caught ? capturePose(s.captureTime) : null;
    actor.update(dt, target ? d : Infinity, target, {
      fold: s.fold, doorPress: s.doorPress, stridePhase: s.stridePhase,
      stoop: s.stunned > 0 ? 0.35 : Math.max(0, s.y - .72),
      captureSide: s.captureSide, capture, throw: s.throwPose
    });

    if (s.stomp) {
      const stepScale = Math.abs(s.stomp);
      const strength = ((Math.max(0, 1 - d / 22)) ** 1.25) * stepScale;
      walk.monsterStep(strength, Math.sign(s.stomp));
      doorAudio.monsterStomp(strength, pan);
    }
    if (s.impact && !s.smashedWall) {
      const strength = Math.max(0, 1 - d / 18) ** 1.2;
      if (!reducedMotionQuery.matches) walk.triggerSlamImpact(pan < 0 ? -1 : 1, .35 + .35 * strength);
      doorAudio.monsterStomp(.45 + .35 * strength, pan);
    }
    if (s.scream) doorAudio.monsterScream(s.scream === 'stun' ? 'alert' : s.scream, Math.max(.18, 1 - d / 25), pan);
    if (s.growl) doorAudio.monsterGrowl?.(s.growl, Math.max(.08, (1 - d / 24) ** 1.2), pan);
    if (!capture) return pose;
    game.style.setProperty('--capture-fade', (capture.fade * 0.68).toFixed(3));
    const victim = captureShot(actor, s, capture, obstacles, reducedMotionQuery.matches);
    if (s.mode === 'dead') {
      showEnding(OUTCOMES.DEFEAT_CAPTURE);
    }
    return victim;
  }

  function frame(now) {
    scheduled = false;
    if (contextLost) return;
    const dt = lastTime ? Math.min(.08, (now - lastTime) / 1000) : 0;
    roidSpray.update(dt);

    if (whisperTimer > 0) {
      whisperTimer = Math.max(0, whisperTimer - dt);
      if (whisperTimer === 0) transientWhisper = '';
    }
    if (flashBurstLevel > 0) {
      flashBurstLevel = Math.max(0, flashBurstLevel - dt * 3.8);
    }

    const inspecting = game.classList.contains('inspecting');
    const previewing = Boolean(preset) || inspecting || walk.noclip;

    if (cinematics.active) {
      if (match.phase === GAME_PHASES.PAUSED) {
        renderer.draw(scene, camera, null, playerBody.visibleHeadSurfaces);
        lastTime = 0;
        return;
      }
      const cinePose = cinematics.update(dt, reducedMotionQuery.matches);
      game.style.setProperty('--cine-fade', cinematics.fade.toFixed(3));
      const pForBody = cinePose || walk.pose;
      worldItems.update(dt, atmosphere.state.time, reducedMotionQuery.matches);
      const evidence = pForBody.evidence > 0 ? 'tape3' : null;
      handView.setItem(evidence);
      const hand = handView.update(dt, reducedMotionQuery.matches);
      playerBody.update(dt, { ...pForBody, heldItem: evidence }, {
        hand: evidence ? hand : null, camera,
        inspecting: false,
        hasStarted: true,
        doorInteraction: null,
        obstacles: playerObstacles,
        bounds: worldBounds,
        reducedMotion: reducedMotionQuery.matches
      });
      atmosphere.update(dt, {
        reducedMotion: reducedMotionQuery.matches,
        active: true,
        cameraX: camera.position.x,
        cameraZ: camera.position.z
      });
      atmosphere.apply(renderer.environment);
      if (renderer.environment.playerTorchPower) {
        renderer.environment.playerTorchPos.value.copy(camera.position);
        camera.getWorldDirection(torchDir);
        renderer.environment.playerTorchDir.value.copy(torchDir);
        renderer.environment.playerTorchPower.value =
          cinematics.kind === 'escape' ? 0.12 : cinematics.kind === 'timeoutDefeat' ? 0.48 : 0.32;
      }
      if (renderer.environment.flashBurst) renderer.environment.flashBurst.value = flashBurstLevel;
      if (renderer.environment.adrenalineFx) renderer.environment.adrenalineFx.value = 0;
      renderer.draw(scene, camera, null, playerBody.visibleHeadSurfaces);
      syncLiveHud();
      if ((cinematics.active && !cinematics.holding) || atmosphere.animating(reducedMotionQuery.matches)) {
        lastTime = now;
        wake();
      } else {
        lastTime = 0;
      }
      return;
    }

    game.style.setProperty('--cine-fade', '0');

    if (walk.active) walk.update(dt);
    else if (walk.animating) walk.stepTransition(dt);

    const approachPose = walk.pose;
    const controlling = walk.active && !captureShot && match.phase === GAME_PHASES.PLAYING;
    doorCtrl.update(walk.active ? dt : 0, controlling ? approachPose : null, controlling);
    const slam = doorCtrl.consumeSlam();
    if (slam && walk.active) walk.triggerSlamImpact(slam.side, slam.strength);
    const doorInteraction = controlling ? doorCtrl.getInteractionState(approachPose) : null;
    walk.applyDoorFollow(dt, doorInteraction);
    let pose = walk.pose;

    let esc = null;
    if (walk.active && !previewing && match.phase === GAME_PHASES.PLAYING && !captureShot) {
      const timerRes = stepMatchTimer(match, dt);
      if (timerRes.hitPointOfNoReturn) {
        atmosphere.triggerPointOfNoReturn();
        if (!reducedMotionQuery.matches) walk.triggerSlamImpact(0, 1.0);
      }
      if (timerRes.hitTimeout) {
        match.phase = GAME_PHASES.LOCKDOWN;
        match.outcome = OUTCOMES.DEFEAT_TIMEOUT;
        setMusic('lose');
        cinematics.startTimeoutDefeat(pose, () => showEnding(OUTCOMES.DEFEAT_TIMEOUT));
        syncHud();
        lastTime = now;
        wake();
        return;
      }
      inventory.update(dt);
      walk.setAdrenaline(inventory.adrenalineActive);
      worldItems.update(dt, atmosphere.state.time, reducedMotionQuery.matches);
      smashDebris.update(dt);
      esc = computeEscalation({
        elapsed: match.elapsed,
        keysCollected: inventory.keysFoundCount,
        pointOfNoReturn: match.pointOfNoReturn
      });
      if (esc.stage > threatStage) {
        threatStage = esc.stage;
        noticeUntil = match.elapsed + 3.5;
        write(ui['threat-notice'], THREAT_STAGES[threatStage].effect);
        gameplayAudio.playThreatRise(threatStage);
      }
    }

    if (walk.active && !previewing) {
      pose = playEncounter(dt, pose, esc);
    } else if (previewing) {
      if (preset) frameView(preset);
      if (actor.update(dt, Infinity)) debug.refresh();
    } else if (captureShot && hunt.state.mode === 'capture') {
      pose = captureShot(actor, hunt.state, capturePose(hunt.state.captureTime), obstacles, reducedMotionQuery.matches);
    }

    const musicDistance = walk.active && !previewing
      ? Math.hypot(pose.x - hunt.state.x, pose.z - hunt.state.z)
      : Infinity;
    gameMusic.sync({
      phase: match.phase,
      threatStage,
      mode: hunt.state.mode,
      distance: musicDistance,
      outcome: match.outcome
    });
    game.dataset.music = gameMusic.getState().state;
    game.dataset.musicRunning = String(gameMusic.getState().running);

    if (walk.active && !previewing) {
      const playerSeesMonster = hunt.navigation.visible(
        { x: pose.x, y: pose.cameraY, z: pose.z },
        { x: hunt.state.x, y: hunt.state.y + 1.55, z: hunt.state.z }
      );
      const computedFear = computePlayerFear({
        playerX: pose.x,
        playerZ: pose.z,
        playerYaw: pose.yaw,
        monsterX: hunt.state.x,
        monsterZ: hunt.state.z,
        monsterVisible: hunt.state.visible,
        monsterMode: hunt.state.mode,
        playerSeesMonster
      });
      walk.setFear(computedFear);
      gameplayAudio.updateAmbience(dt, {
        active: !captureShot && match.phase === GAME_PHASES.PLAYING,
        fear: computedFear,
        escalation: esc?.level ?? 0,
        frenzy: Boolean(esc?.frenzy)
      });
    } else {
      gameplayAudio.updateAmbience(dt, { active: false });
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

    const promptText = computePromptText(pose);
    const touch = game.classList.contains('touch');
    // The touch button is small: keep only the action ("Recoger botiquín")
    // and drop the explanatory second line that fits under the desktop reticle.
    write(interactPrompt, touch
      ? promptText.replace('[E] ', '').split('\n')[0]
      : promptText.replace('[E] ', 'E · '));
    if (interactBtn) interactBtn.hidden = !promptText;

    const hand = handView.update(dt, reducedMotionQuery.matches);
    const roidAim = inventory.equipped === 'roid' && walk.active && !previewing &&
      match.phase === GAME_PHASES.PLAYING && !captureShot ? findRoidTarget(pose) : null;
    game.classList.toggle('roid-ready', Boolean(roidAim));
    const heldKind = walk.active && !captureShot && !previewing ? hand.kind : null;
    playerBody.update(dt, { ...pose, heldItem: heldKind }, {
      inspecting: inspecting || Boolean(preset),
      hasStarted,
      heldItem: heldKind, hand: heldKind ? hand : null, camera,
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

    const targetTorch = match.pointOfNoReturn ? 1.0 : (walk.active && !previewing ? 0.24 : 0);
    torchPower += (targetTorch - torchPower) * Math.min(1, dt * 5.0 + 0.12);
    if (renderer.environment.playerTorchPower) {
      renderer.environment.playerTorchPos.value.copy(camera.position);
      camera.getWorldDirection(torchDir);
      renderer.environment.playerTorchDir.value.copy(torchDir);
      renderer.environment.playerTorchPower.value = torchPower;
    }
    if (renderer.environment.flashBurst) renderer.environment.flashBurst.value = flashBurstLevel;
    if (renderer.environment.adrenalineFx) {
      renderer.environment.adrenalineFx.value = inventory.adrenalineActive ? 0.85 : 0;
    }

    syncLiveHud(pose);
    renderer.draw(scene, camera, screenFxFrame, playerBody.visibleHeadSurfaces);

    if (walk.active || walk.animating || (previewing && actor.animating) ||
        atmosphere.animating(reducedMotionQuery.matches) || flashBurstLevel > 0.005) {
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
    if (enterBtn) enterBtn.disabled = true;
    if (status) status.textContent = 'Recuperando la imagen del pasillo…';
  });
  canvas.addEventListener('webglcontextrestored', () => {
    contextLost = false;
    if (status) status.textContent = '';
    if (enterBtn) enterBtn.disabled = false;
    resize();
  });

  readyToDraw = true;
  setGateOpenVisual(specials.gateControl?.door, 0);
  syncHud();
  resize();
  atmosphere.apply(renderer.environment);
  frameView(preset);
  renderer.compile(scene, camera);
  setLoadProgress(1);
  await yieldFrame();
  loaderEl?.classList.add('done');
  if (enterBtn) enterBtn.disabled = false;
  wake();
}

start().catch(error => {
  console.error(error);
  loaderEl?.classList.add('done');
  if (enterBtn) enterBtn.disabled = true;
  if (status) {
    status.textContent = 'No se pudo dibujar el pasillo. Abre el juego en un navegador con WebGL 2 y aceleración gráfica.';
  }
});
