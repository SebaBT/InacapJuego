import assert from 'node:assert/strict';
import test from 'node:test';
import { benchZ, hall, landing, rooms, stairs } from '../src/layout.js';
import { createDoorController } from '../src/doors.js';
import { SURFACE_PROFILES, detectFloorSurface, makePlayerAudio } from '../src/player-audio.js';
import { bindSoundControl, createSoundState, getDoorSoundKind, makeControlledDoorAudio } from '../src/sound.js';

function makeMockAudioContext({ panner = true, shaper = true, compressor = true } = {}) {
  const oscillators = [];
  const noiseSources = [];
  const filters = [];
  const gains = [];
  const panners = [];
  const shapers = [];
  const compressors = [];

  function makeParam(initial = 0) {
    return {
      value: initial,
      events: [],
      cancelScheduledValues(t) { this.events.push(['cancel', t]); },
      setValueAtTime(v, t) { this.value = v; this.events.push(['set', v, t]); },
      linearRampToValueAtTime(v, t) { this.value = v; this.events.push(['linear', v, t]); },
      exponentialRampToValueAtTime(v, t) { this.value = v; this.events.push(['exp', v, t]); },
      setTargetAtTime(v, t, k) { this.value = v; this.events.push(['target', v, t, k]); }
    };
  }

  class MockAudioContext {
    constructor() {
      this.currentTime = 0;
      this.sampleRate = 22050;
      this.state = 'running';
      this.destination = {};
    }
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
    createGain() {
      const node = {
        gain: makeParam(1),
        connect() {},
        disconnect() {}
      };
      gains.push(node);
      return node;
    }
    createOscillator() {
      const node = {
        type: 'sine',
        frequency: makeParam(440),
        connect() {},
        disconnect() {},
        start(t) { this.startedAt = t; },
        stop(t) { this.stoppedAt = t; }
      };
      oscillators.push(node);
      return node;
    }
    createBiquadFilter() {
      const node = {
        type: 'bandpass',
        frequency: makeParam(1000),
        Q: makeParam(1),
        gain: makeParam(0),
        connect() {},
        disconnect() {}
      };
      filters.push(node);
      return node;
    }
    createBuffer(channels, length, sampleRate) {
      const data = new Float32Array(length);
      return {
        duration: length / sampleRate,
        getChannelData() { return data; }
      };
    }
    createBufferSource() {
      const node = {
        buffer: null,
        loop: false,
        connect() {},
        disconnect() {},
        start(t, offset, duration) {
          this.startedAt = t;
          this.offset = offset;
          this.duration = duration;
        },
        stop(t) { this.stoppedAt = t; }
      };
      noiseSources.push(node);
      return node;
    }
  }

  if (panner) {
    MockAudioContext.prototype.createStereoPanner = function () {
      const node = { pan: makeParam(0), connect() {}, disconnect() {} };
      panners.push(node);
      return node;
    };
  }
  if (shaper) {
    MockAudioContext.prototype.createWaveShaper = function () {
      const node = { curve: null, oversample: 'none', connect() {}, disconnect() {} };
      shapers.push(node);
      return node;
    };
  }
  if (compressor) {
    MockAudioContext.prototype.createDynamicsCompressor = function () {
      const node = {
        threshold: makeParam(-24),
        knee: makeParam(30),
        ratio: makeParam(12),
        attack: makeParam(.003),
        release: makeParam(.25),
        connect() {},
        disconnect() {}
      };
      compressors.push(node);
      return node;
    };
  }

  return { MockAudioContext, oscillators, noiseSources, filters, gains, panners, shapers, compressors };
}

function makeMemoryStorage() {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); }
  };
}

test('createSoundState clamps volume, handles mute/unmute, and persists to storage', () => {
  const storage = makeMemoryStorage();
  const state = createSoundState({ storage });

  assert.equal(state.volume, 1);
  assert.equal(state.muted, false);
  assert.equal(state.effectiveVolume, 1);

  const events = [];
  const off = state.subscribe(snap => events.push(snap));

  state.setVolume(0.4);
  assert.equal(state.volume, 0.4);
  assert.equal(state.effectiveVolume, 0.4);

  state.toggleMute();
  assert.equal(state.muted, true);
  assert.equal(state.volume, 0.4);
  assert.equal(state.effectiveVolume, 0);

  // Increasing volume while muted automatically unmutes.
  state.setVolume(0.65);
  assert.equal(state.muted, false);
  assert.equal(state.effectiveVolume, 0.65);

  // Dragging to 0 silences and toggling mute restores previous non-zero volume.
  state.setVolume(0);
  assert.equal(state.effectiveVolume, 0);
  state.toggleMute();
  assert.equal(state.muted, false);
  assert.equal(state.volume, 0.65);
  assert.equal(state.effectiveVolume, 0.65);

  state.setMuted(true);
  assert.equal(events.at(-1).effectiveVolume, 0);
  off();

  // Reloading from storage preserves volume and mute flag.
  const reloaded = createSoundState({ storage });
  assert.equal(reloaded.volume, 0.65);
  assert.equal(reloaded.muted, true);
  assert.equal(reloaded.effectiveVolume, 0);
});

test('bindSoundControl syncs pause menu elements and responds to toggle and slider input', () => {
  function makeElement() {
    const attrs = new Map();
    const listeners = new Map();
    return {
      dataset: {},
      value: '',
      textContent: '',
      title: '',
      get valueAsNumber() { return Number(this.value); },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.get(k) ?? null; },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      },
      removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
      dispatch(type) {
        for (const fn of listeners.get(type) || []) fn();
      }
    };
  }

  const container = makeElement();
  const toggle = makeElement();
  const slider = makeElement();
  const readout = makeElement();
  const root = {
    querySelector(sel) {
      return {
        '#sound-control': container,
        '#sound-toggle': toggle,
        '#sound-volume': slider,
        '#sound-volume-val': readout
      }[sel] || null;
    }
  };

  const sound = createSoundState({ storage: null, initialVolume: 0.8, initialMuted: false });
  let interacted = 0;
  const unbind = bindSoundControl(root, sound, { onInteract: () => { interacted++; } });

  assert.equal(container.dataset.soundLevel, 'high');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(slider.value, '80');
  assert.equal(readout.textContent, '80 %');

  toggle.dispatch('click');
  assert.equal(sound.muted, true);
  assert.equal(container.dataset.soundLevel, 'muted');
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  assert.equal(toggle.getAttribute('aria-label'), 'Activar sonido');
  assert.equal(readout.textContent, 'Silencio');
  assert.equal(interacted, 0);

  slider.value = '35';
  slider.dispatch('input');
  assert.equal(sound.muted, false);
  assert.equal(sound.volume, 0.35);
  assert.equal(container.dataset.soundLevel, 'low');
  assert.equal(readout.textContent, '35 %');
  assert.equal(interacted, 1);

  unbind();
});

test('detectFloorSurface identifies corridor tile, rooms, benches, annex concrete, stairs, landing, and active debris', () => {
  const obstacles = [
    { x0: -hall.halfWidth, x1: -hall.halfWidth + 0.54, z0: benchZ - 0.92, z1: benchZ + 0.92, top: 0.48 },
    { x0: 3.34, x1: 3.90, z0: -40.35, z1: -38.45, top: 0.47 },
    { x0: stairs.x0, x1: stairs.x1, z0: stairs.startZ - stairs.run, z1: stairs.startZ, top: 0.18, step: true },
    { x0: landing.x0, x1: landing.x1, z0: landing.z0, z1: landing.z1, top: landing.top, step: true }
  ];

  // Main corridor ceramic tiles
  assert.equal(detectFloorSurface(0, 0, 0, obstacles).surface, 'tile');

  // Elevated corridor wooden bench & annex wooden bench
  assert.equal(detectFloorSurface(-hall.halfWidth + 0.25, benchZ, 0.48, obstacles).surface, 'wood');
  assert.equal(detectFloorSurface(3.60, -39.4, 0.47, obstacles).surface, 'wood');

  // All 6 rooms map to their corresponding floor material
  const r101 = rooms.find(r => r.id === '101');
  const r102 = rooms.find(r => r.id === '102');
  const r103 = rooms.find(r => r.id === '103');
  const r104 = rooms.find(r => r.id === '104');
  const r105 = rooms.find(r => r.id === '105');
  const r106 = rooms.find(r => r.id === '106');
  assert.equal(detectFloorSurface((r101.x0 + r101.x1) / 2, r101.doorZ, 0, obstacles).surface, 'linoleum');
  assert.equal(detectFloorSurface((r102.x0 + r102.x1) / 2, r102.doorZ, 0, obstacles).surface, 'gravel');
  assert.equal(detectFloorSurface((r103.x0 + r103.x1) / 2, r103.doorZ, 0, obstacles).surface, 'linoleum');
  assert.equal(detectFloorSurface((r104.x0 + r104.x1) / 2, r104.doorZ, 0, obstacles).surface, 'lab');
  assert.equal(detectFloorSurface((r105.x0 + r105.x1) / 2, r105.doorZ, 0, obstacles).surface, 'wood');
  assert.equal(detectFloorSurface((r106.x0 + r106.x1) / 2, r106.doorZ, 0, obstacles).surface, 'lab');

  // Annex ground floor concrete, stair treads with metal nosing, and upper landing
  assert.equal(detectFloorSurface(0, hall.far - 3.0, 0, obstacles).surface, 'concrete');
  assert.equal(detectFloorSurface((stairs.x0 + stairs.x1) / 2, stairs.startZ - 0.24, 0.18, obstacles).surface, 'stairs');
  assert.equal(detectFloorSurface(-1.25, landing.z0 + 1.0, landing.top, obstacles).surface, 'landing');

  // Active debris placements under the player's feet are detected at matching elevation
  const placements = [
    { kind: 'glassShard', x: 1.2, y: 0, z: -4.0, scale: 1 },
    { kind: 'paperSheet', x: -1.25, y: landing.top, z: landing.z0 + 1.0, scale: 1 }
  ];
  assert.equal(detectFloorSurface(1.25, -4.05, 0, obstacles, placements).debris, 'glassShard');
  assert.equal(detectFloorSurface(1.25, -4.05, 0.48, obstacles, placements).debris, null, 'elevated foot ignores floor debris below');
  assert.equal(detectFloorSurface(-1.25, landing.z0 + 1.0, landing.top, obstacles, placements).debris, 'paperSheet');
});

test('monster footfalls and both roars stay deep, controlled, and use the volume-controlled bus', () => {
  const {
    MockAudioContext, oscillators, noiseSources, filters, gains, panners, shapers, compressors
  } = makeMockAudioContext();
  const sound = createSoundState({ storage: null, initialVolume: 1 });
  const audio = makeControlledDoorAudio(sound, { AudioContext: MockAudioContext });
  const scheduledPeak = gain => Math.max(...gain.gain.events
    .filter(e => e[0] === 'set' || e[0] === 'linear')
    .map(e => e[1]));

  // Footfall: a sub drop, a body knock and a low filtered sole. It must land
  // with mass, pan to the suit's side and release quickly for the next step.
  const gainsBeforeStomp = gains.length;
  audio.monsterStomp(.72, -.5);
  const stompOsc = oscillators.slice(0, 3);
  assert.equal(stompOsc.length, 3, 'footfall layers sub, weight and body knock');
  for (const osc of stompOsc) {
    assert.ok(osc.frequency.events[0][1] <= 220, 'footfall starts low');
    assert.ok(osc.frequency.value <= 60, 'footfall sweeps into sub weight');
    assert.ok(osc.stoppedAt <= .4, 'footfall releases before the next step');
  }
  const stompFilters = filters.filter(f => f.type !== 'highpass');
  assert.ok(stompFilters.every(f => f.frequency.value <= 720), 'footfall texture stays warm');
  assert.ok(noiseSources.length >= 1, 'sole scrapes through the supplied noise');
  assert.equal(panners.at(-1).pan.value, -.5);
  assert.ok(scheduledPeak(gains[gainsBeforeStomp]) <= .4, 'footfall keeps amplitude headroom');

  // Alert at distance: long low call, broad formants, no whistle band.
  const alertOscStart = oscillators.length, alertFilterStart = filters.length;
  const alertGainStart = gains.length, alertShaperStart = shapers.length;
  audio.monsterScream('alert', .6, -.3);
  const alertOsc = oscillators.slice(alertOscStart);
  const alertFilterSet = filters.slice(alertFilterStart);
  const alertFilters = alertFilterSet.filter(f => f.type === 'bandpass');
  assert.ok(alertOsc.length >= 6, 'alert layers chest, throat, sub, false cords, vibrato and growl');
  assert.ok(alertOsc.every(o => o.frequency.events[0][1] <= 200), 'alert starts in the chest register');
  assert.ok(alertOsc.every(o => Math.max(...o.frequency.events.map(e => e[1])) <= 240), 'alert never reaches a shriek');
  const alertStop = Math.max(...alertOsc.map(o => o.stoppedAt));
  assert.ok(alertStop <= 1.5, 'alert is a single carrying call');
  assert.ok(alertFilters.length >= 3, 'alert has chest, mouth and presence resonances');
  assert.ok(alertFilters.every(f => f.Q.value <= 3), 'resonances stay broad instead of whistling');
  assert.ok(alertFilters.every(f => f.frequency.value <= 1800), 'no formant sits in the whistle band');
  const alertEq = alertFilterSet.find(f => f.type === 'peaking');
  assert.ok(alertEq && alertEq.gain.value > 0 && alertEq.gain.value <= 6, 'alert adds a restrained chest lift');
  assert.ok(alertEq.Q.value <= 1, 'chest lift stays broad');
  const alertPeak = scheduledPeak(gains[alertGainStart]);
  assert.ok(alertPeak > .1 && alertPeak <= .5, 'alert stays below the shared ceiling');
  assert.equal(panners.at(-1).pan.value, -.3);
  const alertShapers = shapers.slice(alertShaperStart);
  assert.ok(alertShapers.length >= 2, 'alert saturates the false cords and the final mix');
  const alertCurve = alertShapers.at(-1).curve;
  assert.ok(alertCurve && alertCurve.length >= 1024);
  assert.ok(alertShapers.every(s => s.curve.every(v => Math.abs(v) <= 1)), 'saturation curves are normalized');

  // Capture roar: longer, harder, with a downward plunge and a ragged swell.
  const captureOscStart = oscillators.length, captureFilterStart = filters.length;
  const captureGainStart = gains.length, captureShaperStart = shapers.length;
  audio.monsterScream('capture', 1, 0);
  const captureOsc = oscillators.slice(captureOscStart);
  const captureFilterSet = filters.slice(captureFilterStart);
  const captureFilters = captureFilterSet.filter(f => f.type === 'bandpass');
  assert.ok(captureOsc.length >= 6, 'capture keeps the same organic layers');
  assert.ok(captureOsc.every(o => Math.max(...o.frequency.events.map(e => e[1])) <= 240), 'capture stays guttural');
  assert.ok(captureOsc.every(o => o.frequency.value <= 100), 'capture bottoms out in the sub register');
  const captureStop = Math.max(...captureOsc.map(o => o.stoppedAt));
  assert.ok(captureStop > alertStop + .5, 'capture roars appreciably longer than the alert');
  assert.ok(captureFilters.length >= 3);
  assert.ok(captureFilters.every(f => f.Q.value <= 3 && f.frequency.value <= 1800));
  const captureEq = captureFilterSet.find(f => f.type === 'peaking');
  assert.ok(captureEq && captureEq.gain.value > alertEq.gain.value && captureEq.gain.value <= 8,
    'capture opens a wider but still controlled chest');
  const capturePeak = scheduledPeak(gains[captureGainStart]);
  assert.ok(capturePeak > alertPeak, 'capture is the louder close cue');
  assert.ok(capturePeak <= .65, 'capture still leaves headroom');
  const captureSwells = gains[captureGainStart].gain.events
    .filter(e => e[0] === 'linear').map(e => e[1]);
  assert.ok(captureSwells.length >= 4 && captureSwells.some(v => v < capturePeak * .8),
    'capture breathes through a mid-roar dip and second swell');
  assert.equal(panners.at(-1).pan.value, 0);
  const captureShapers = shapers.slice(captureShaperStart);
  assert.ok(captureShapers.length >= 2, 'capture saturates both the throat and the final mix');
  assert.equal(captureShapers.at(-1).oversample, '2x', 'capture saturates harder without aliasing');
  assert.equal(compressors.length, 1, 'one shared monster limiter');
  assert.ok(compressors[0].threshold.value <= -6 && compressors[0].ratio.value >= 2.5,
    'limiter catches overlapping stomps and roars');
  alertOsc.concat(captureOsc).forEach(o => assert.ok(o.stoppedAt <= captureStop + .01));

  // Volume changes reach the master bus, and mute prevents any new synthesis.
  sound.setVolume(.35);
  assert.ok(gains[0].gain.events.some(e => e[0] === 'target' && Math.abs(e[1] - .35) < .001),
    'volume slider reaches the shared master gain');
  const beforeMuteOsc = oscillators.length, beforeMuteNoise = noiseSources.length;
  sound.setMuted(true);
  audio.monsterStomp(1, 0);
  audio.monsterScream('capture', 1, 0);
  assert.equal(oscillators.length, beforeMuteOsc);
  assert.equal(noiseSources.length, beforeMuteNoise);

  // Pause/capture extinction fades every live voice and releases its sources.
  audio.silenceMonster();
  const cancelled = gains.filter(g => g.gain.events.some(e => e[0] === 'cancel'));
  assert.equal(cancelled.length, 3, 'stomp, alert and capture each own one envelope');
  assert.ok(cancelled.every(g => g.gain.events.some(e => e[0] === 'target' && e[1] === 0)));
  assert.ok(oscillators.every(o => o.stoppedAt <= .1), 'silence stops scheduled oscillators');
  assert.ok(noiseSources.every(n => n.stoppedAt <= .1), 'silence stops scheduled noise');
});

test('monster voice falls back when panner, saturation and compression are unavailable', () => {
  const {
    MockAudioContext, oscillators, noiseSources, filters, panners, shapers, compressors
  } = makeMockAudioContext({ panner: false, shaper: false, compressor: false });
  const sound = createSoundState({ storage: null, initialVolume: 1 });
  const audio = makeControlledDoorAudio(sound, { AudioContext: MockAudioContext });

  assert.doesNotThrow(() => {
    audio.monsterStomp(1, .7);
    audio.monsterScream('alert', .8, .2);
    audio.monsterScream('capture', 1, -.2);
    audio.silenceMonster();
  });
  assert.ok(oscillators.length >= 15);
  assert.ok(noiseSources.length >= 3);
  assert.ok(filters.some(f => f.type === 'bandpass'));
  assert.equal(panners.length, 0);
  assert.equal(shapers.length, 0);
  assert.equal(compressors.length, 0);
});

test('makePlayerAudio synthesizes distinct floor-matched footsteps, sprint, crouch, jump, landing, and skid scuff', () => {
  const { MockAudioContext, oscillators, noiseSources, filters } = makeMockAudioContext();
  const sound = createSoundState({ storage: null, initialVolume: 1 });
  const playerAudio = makePlayerAudio(sound, { AudioContext: MockAudioContext });

  // Walking step on ceramic tile vs wooden bench vs metallic stairs vs gravel
  const surfaceFreqs = {};
  for (const surface of ['tile', 'wood', 'stairs', 'gravel', 'concrete', 'linoleum', 'lab', 'landing']) {
    const profile = SURFACE_PROFILES[surface];
    assert.ok(profile.heelGain >= 0.14, `${surface} has strong audible footstep volume`);
    assert.ok(profile.clickFreq <= 420 && profile.scuffSprintFreq <= 700, `${surface} keeps frequencies warm and non-shrill`);
    const beforeOsc = oscillators.length;
    playerAudio.triggerStep(0.75, false, { surface });
    assert.ok(oscillators.length > beforeOsc, `oscillators created for ${surface}`);
    for (let i = beforeOsc; i < oscillators.length; i++) {
      assert.ok(oscillators[i].frequency.events[0][1] < 650, `step oscillator on ${surface} stays below 650 Hz`);
    }
    const heelOsc = oscillators[beforeOsc];
    surfaceFreqs[surface] = heelOsc.frequency.events[0][1];
    assert.equal(playerAudio.lastEvent.type, 'step');
    assert.equal(playerAudio.lastEvent.surface, surface);
  }

  // Wood plank fundamental is higher/warmer than raw concrete; stairs create metallic harmonic oscillators
  assert.ok(surfaceFreqs.wood > surfaceFreqs.concrete * 1.5);
  assert.notEqual(surfaceFreqs.tile, surfaceFreqs.linoleum);

  // Left and right footsteps alternate footSide and pitch
  playerAudio.triggerStep(0.7, false, { surface: 'tile' });
  const firstStep = playerAudio.lastEvent;
  playerAudio.triggerStep(0.7, false, { surface: 'tile' });
  const secondStep = playerAudio.lastEvent;
  assert.notEqual(firstStep.footSide, secondStep.footSide);

  // Sprinting vs crouch-walking on gravel with glassShard debris
  const beforeSprintOsc = oscillators.length;
  const beforeSprintNoise = noiseSources.length;
  playerAudio.update({
    active: true,
    stepEvent: 1.0,
    isSprinting: true,
    isCrouching: false,
    surface: 'gravel',
    debris: 'glassShard'
  });
  assert.equal(playerAudio.lastEvent.type, 'step');
  assert.equal(playerAudio.lastEvent.isSprinting, true);
  assert.equal(playerAudio.lastEvent.surface, 'gravel');
  assert.equal(playerAudio.lastEvent.debris, 'glassShard');
  const sprintOscCreated = oscillators.length - beforeSprintOsc;
  const sprintNoiseCreated = noiseSources.length - beforeSprintNoise;
  assert.ok(sprintOscCreated >= 4, 'glassShard debris adds crystalline high-frequency ping oscillators');
  assert.ok(sprintNoiseCreated >= 4, 'gravel sprint + glassShard layers multi-grain crunch bursts');

  // Crouch-walking suppresses sharp click transient and records crouching step
  const beforeCrouchOsc = oscillators.length;
  playerAudio.update({
    active: true,
    stepEvent: 0.45,
    isSprinting: false,
    isCrouching: true,
    crouchChanged: true,
    surface: 'wood'
  });
  assert.equal(playerAudio.lastEvent.type, 'step');
  assert.equal(playerAudio.lastEvent.isCrouching, true);
  assert.ok(playerAudio.events.some(e => e.type === 'crouch' && e.surface === 'wood'));
  assert.ok(oscillators.length > beforeCrouchOsc);

  // Jump takeoff, sprint brake scuff, and heavy landing on wood/stairs
  playerAudio.update({ active: true, justJumped: true, surface: 'stairs', debris: 'paperSheet' });
  assert.ok(playerAudio.events.some(e => e.type === 'jump' && e.surface === 'stairs' && e.debris === 'paperSheet'));

  playerAudio.update({ active: true, scuffEvent: 0.85, surface: 'tile' });
  assert.equal(playerAudio.lastEvent.type, 'scuff');
  assert.equal(playerAudio.lastEvent.surface, 'tile');

  const beforeLandFilter = filters.length;
  playerAudio.update({ active: true, justLanded: true, landedHeavy: true, surface: 'wood' });
  assert.ok(playerAudio.events.some(e => e.type === 'land' && e.heavy === true && e.surface === 'wood'));
  assert.ok(filters.length > beforeLandFilter);
});

test('door controller and door audio play handle grab, creak, open stop, release, close latch, slam, and locked sounds by door type', () => {
  const { MockAudioContext, oscillators } = makeMockAudioContext();
  const sound = createSoundState({ storage: null, initialVolume: 1 });
  const doorAudio = makeControlledDoorAudio(sound, { AudioContext: MockAudioContext });

  assert.equal(getDoorSoundKind({ id: '101' }), 'wood');
  assert.equal(getDoorSoundKind({ id: 'anexo' }), 'double');
  assert.equal(getDoorSoundKind({ id: 'azotea' }), 'metal');

  const roomDoor = {
    id: '101',
    label: 'Sala 101',
    locked: false,
    open: 0,
    targetOpen: 0,
    rattle: 0,
    pos: { x: 2.31, y: 1.15, z: 0.15 },
    openPos: { x: 2.80, y: 1.15, z: -0.40 },
    threshold: { x0: 2.08, x1: 2.53, z0: -0.41, z1: 0.71 },
    pivots: [{ group: { rotation: { y: 0 } }, hand: 1, maxAngle: 1.76 }],
    handles: [{ x: 2.25, y: 1.05, z: 0.15 }],
    obstacle: { x0: 2.22, x1: 2.39, z0: -0.41, z1: 0.71, active: true }
  };
  const annexDoor = {
    id: 'anexo',
    label: 'Puertas del Anexo',
    locked: false,
    open: 0,
    targetOpen: 0,
    rattle: 0,
    pos: { x: 0, y: 1.15, z: -31.2 },
    threshold: { x0: -1.01, x1: 1.01, z0: -31.46, z1: -31.04 },
    pivots: [{ group: { rotation: { y: 0 } }, hand: 1, maxAngle: 1.68 }],
    obstacle: { x0: -1.01, x1: 1.01, z0: -31.37, z1: -31.18, active: true }
  };

  const ctrl = createDoorController({ doors: [roomDoor, annexDoor], audio: doorAudio });

  // 1. Approaching classroom door auto-grabs handle (playGrab) without opening yet
  const approachPose = { x: 1.35, y: 1.61, z: 0.15, yaw: -Math.PI / 2, pitch: -0.25, vx: 0, vz: 0 };
  ctrl.update(0.016, approachPose, true);
  assert.equal(doorAudio.lastEvent?.type, 'grab');
  assert.equal(doorAudio.lastEvent?.doorKind, 'wood');

  // 2. Advancing pushes door open (playDoor) and retreating releases handle (playRelease)
  ctrl.update(0.05, { ...approachPose, vx: 1.4, wishVx: 1.4 }, true);
  assert.ok(doorAudio.events.some(e => e.type === 'door' && e.opening === true && e.doorId === '101'));

  ctrl.update(0.05, { ...approachPose, vx: -1.2, wishVx: -1.2 }, true);
  assert.equal(doorAudio.lastEvent?.type, 'release');

  // 3. Pressing [E] opens fully (playOpenStop) and pressing [E] again swings shut and latches (playCloseLatch)
  ctrl.interact(approachPose);
  for (let i = 0; i < 30; i++) ctrl.update(0.03, approachPose, true);
  assert.equal(roomDoor.open, 1);
  assert.ok(doorAudio.events.some(e => e.type === 'openStop' && e.doorId === '101'));

  ctrl.interact(approachPose);
  assert.ok(doorAudio.events.some(e => e.type === 'door' && e.opening === false && e.doorId === '101'));
  for (let i = 0; i < 30; i++) ctrl.update(0.03, approachPose, true);
  assert.equal(roomDoor.open, 0);
  assert.ok(doorAudio.events.some(e => e.type === 'closeLatch' && e.doorId === '101'));

  // 4. Sprinting into Annex double doors triggers double-door panic-bar slam (playSlam)
  const beforeSlamOsc = oscillators.length;
  ctrl.update(0.016, {
    x: 0,
    y: 1.61,
    z: -30.95,
    yaw: 0,
    pitch: 0,
    vx: 0,
    vz: -4.2,
    wishVx: 0,
    wishVz: -4.35,
    isSprinting: true
  }, true);
  assert.equal(doorAudio.lastEvent?.type, 'slam');
  assert.equal(doorAudio.lastEvent?.doorKind, 'double');
  assert.ok(oscillators.length - beforeSlamOsc >= 6);
});

import { PerspectiveCamera } from 'three';
import { firstPerson } from '../src/walk.js';

test('firstPerson dynamically adapts walking, sprinting, braking, jumping, and landing sounds to the floor under the player', t => {
  function makeEl() {
    const classes = new Set(), attrs = new Map();
    return Object.assign(new EventTarget(), {
      classList: {
        add: n => classes.add(n),
        remove: (...ns) => ns.forEach(n => classes.delete(n)),
        contains: n => classes.has(n),
        toggle: (n, on) => on ? classes.add(n) : classes.delete(n)
      },
      setAttribute: (k, v) => attrs.set(k, v),
      getAttribute: k => attrs.get(k),
      focus() {},
      style: { setProperty() {} },
      firstElementChild: { style: {} },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 120, height: 120 })
    });
  }

  const ids = ['game', 'view', 'enter', 'enter-label', 'message', 'stick', 'pause', 'interact-btn', 'crouch-btn', 'jump-btn', 'camera-btn', 'sprint', 'sprint-fill'];
  const els = new Map(ids.map(id => ['#' + id, makeEl()]));
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { querySelector: sel => els.get(sel) || null });
  globalThis.matchMedia = () => ({ matches: false });
  t.after(() => {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.matchMedia;
  });

  const { MockAudioContext } = makeMockAudioContext();
  const sound = createSoundState({ storage: null, initialVolume: 1 });
  const playerAudio = makePlayerAudio(sound, { AudioContext: MockAudioContext });

  const benchObs = { x0: -hall.halfWidth, x1: -hall.halfWidth + 0.54, z0: benchZ - 0.92, z1: benchZ + 0.92, top: 0.48 };
  const stair1 = { x0: stairs.x0, x1: stairs.x1, z0: stairs.startZ - stairs.run, z1: stairs.startZ, top: 0.18, step: true };
  const stair2 = { x0: stairs.x0, x1: stairs.x1, z0: stairs.startZ - 2 * stairs.run, z1: stairs.startZ - stairs.run, top: 0.36, step: true };
  const obstacles = [benchObs, stair1, stair2];
  const debris = [{ kind: 'glassShard', x: 0, y: 0, z: -2.2, scale: 1 }];

  const camera = new PerspectiveCamera(64);
  const walk = firstPerson(camera, obstacles, () => {}, { debris, audio: playerAudio });
  walk.setView(0, 0, 0, 0);
  els.get('#enter').dispatchEvent(new Event('click'));

  const key = (type, code) => window.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code, repeat: false }));
  const stepFrames = (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) walk.update(dt); };

  // 1. Sprinting down the corridor triggers tile footsteps, glassShard debris crunch, and brake scuff
  key('keydown', 'KeyW');
  key('keydown', 'ShiftLeft');
  stepFrames(55);
  assert.equal(walk.pose.surface, 'tile');
  assert.ok(playerAudio.events.some(e => e.type === 'step' && e.surface === 'tile' && e.isSprinting === true));
  assert.ok(playerAudio.events.some(e => e.type === 'step' && e.debris === 'glassShard'));

  key('keyup', 'KeyW');
  key('keyup', 'ShiftLeft');
  stepFrames(10);
  assert.ok(playerAudio.events.some(e => e.type === 'scuff' && e.surface === 'tile'));

  // 2. Walking inside abandoned classroom 102 triggers gravel footsteps
  const r102 = rooms.find(r => r.id === '102');
  walk.setView((r102.x0 + r102.x1) / 2, r102.doorZ, 0, 0);
  key('keydown', 'KeyW');
  stepFrames(45);
  key('keyup', 'KeyW');
  assert.equal(walk.pose.surface, 'gravel');
  assert.ok(playerAudio.events.some(e => e.type === 'step' && e.surface === 'gravel'));

  // 3. Jumping and landing on the wooden bench triggers wood landing and wood steps
  walk.setView(-hall.halfWidth + 0.25, benchZ, 0, 0);
  walk.pose.jump.height = 0.48;
  stepFrames(2);
  assert.equal(walk.pose.surface, 'wood');
  key('keydown', 'Space');
  stepFrames(1);
  key('keyup', 'Space');
  assert.ok(playerAudio.events.some(e => e.type === 'jump' && e.surface === 'wood'));
  stepFrames(65);
  assert.ok(playerAudio.events.some(e => e.type === 'land' && e.surface === 'wood'));

  // 4. Climbing Annex stairs triggers concrete and metallic stair footsteps
  walk.setView((stairs.x0 + stairs.x1) / 2, stairs.startZ + 0.35, 0, 0);
  key('keydown', 'KeyW');
  stepFrames(45);
  key('keyup', 'KeyW');
  assert.equal(walk.pose.surface, 'stairs');
  assert.ok(playerAudio.events.some(e => e.type === 'step' && e.surface === 'stairs'));
});

test('fear makes the player pant louder, higher and shakier at zero exertion, and a terror spike triggers a gasp', () => {
  const { MockAudioContext, filters, gains } = makeMockAudioContext();
  const sound = createSoundState({ storage: null, initialVolume: 1 });
  const playerAudio = makePlayerAudio(sound, { AudioContext: MockAudioContext });
  playerAudio.unlock();

  const breathPhase = 0.4; // mid-inhale, inside the breathing envelope
  playerAudio.update({ active: true, breathPhase, exertion: 0, isSprinting: false, isCrouching: false });
  const calm = { ...playerAudio.breath };
  assert.equal(playerAudio.fear, 0);
  assert.ok(calm.gain > 0, 'idle breathing still makes a soft sound');

  playerAudio.update({ active: true, breathPhase, exertion: 0, isSprinting: false, isCrouching: false, fear: 0.9 });
  const scared = { ...playerAudio.breath };
  assert.equal(playerAudio.fear, 0.9);
  assert.ok(scared.gain > calm.gain * 1.8,
    `scared pant is much louder even standing still (${scared.gain} vs ${calm.gain})`);
  assert.ok(scared.freq > calm.freq * 1.1,
    `scared breath sits higher (${scared.freq} vs ${calm.freq})`);
  assert.ok(scared.q > calm.q, 'tighter formant reads as a shaky gasp');
  assert.ok(scared.low > calm.low, 'air escapes through a brighter filter');

  // The scheduled WebAudio params follow the telemetry (master gain is first, breath gain second).
  const breathGain = gains[1];
  const breathBand = filters.find(f => f.type === 'bandpass');
  assert.ok(breathGain.gain.value > calm.gain * 1.8);
  assert.ok(breathBand.frequency.value > 900, `breath band rises, got ${breathBand.frequency.value}`);

  // Trembling quiver: same fear, different breath phases, different gain.
  playerAudio.update({ active: true, breathPhase: 0.75, exertion: 0, fear: 0.9 });
  const wobbleA = playerAudio.breath.gain;
  playerAudio.update({ active: true, breathPhase: 0.95, exertion: 0, fear: 0.9 });
  const wobbleB = playerAudio.breath.gain;
  assert.notEqual(wobbleA, wobbleB);

  // Spotting the monster up close tears out a gasp, once the caller flags it.
  const gaspsBefore = playerAudio.events.filter(e => e.type === 'gasp').length;
  playerAudio.update({ active: true, breathPhase, exertion: 0, fear: 0.9, justTerrified: true });
  assert.equal(playerAudio.events.filter(e => e.type === 'gasp').length, gaspsBefore + 1);
  assert.equal(playerAudio.lastEvent.type, 'gasp');

  // Calming down drops the fear state back to zero.
  playerAudio.update({ active: true, breathPhase, exertion: 0, fear: 0 });
  assert.equal(playerAudio.fear, 0);
  assert.ok(playerAudio.breath.gain < scared.gain);
});

test('monster growls synthesize state-specific walking voices and respect mute and silence', () => {
  const {
    MockAudioContext, oscillators, noiseSources, filters, gains, panners, shapers
  } = makeMockAudioContext();
  const sound = createSoundState({ storage: null, initialVolume: 1 });
  const audio = makeControlledDoorAudio(sound, { AudioContext: MockAudioContext });
  audio.unlock();
  const scheduledPeak = gain => Math.max(...gain.gain.events
    .filter(e => e[0] === 'set' || e[0] === 'linear')
    .map(e => e[1]));

  const specs = [['prowl', .86], ['rasp', .94], ['snarl', .74]];
  for (const [kind, duration] of specs) {
    const oscStart = oscillators.length, noiseStart = noiseSources.length;
    const filterStart = filters.length, gainStart = gains.length;
    audio.monsterGrowl(kind, .8, -.4);
    assert.equal(audio.lastEvent.type, 'monsterGrowl');
    assert.equal(audio.lastEvent.kind, kind);
    assert.equal(audio.lastEvent.level, .8);
    assert.equal(audio.lastEvent.pan, -.4);

    const growlOsc = oscillators.slice(oscStart);
    assert.ok(growlOsc.length >= 3, `${kind} layers throat, sub and flutter`);
    for (const osc of growlOsc) {
      assert.ok(osc.frequency.events[0][1] <= 140, `${kind} starts in the monster register`);
      assert.ok(Math.max(...osc.frequency.events.map(e => e[1])) <= 200, `${kind} never shrieks`);
    }
    assert.ok(growlOsc.some(osc => osc.type === 'sawtooth'), `${kind} has a saw throat`);
    const stop = Math.max(...growlOsc.map(osc => osc.stoppedAt));
    assert.ok(Math.abs(stop - duration) < .05, `${kind} lasts about ${duration}s`);

    const growlFilters = filters.slice(filterStart);
    const formants = growlFilters.filter(f => f.type === 'bandpass');
    assert.ok(formants.length >= 2, `${kind} shapes throat and mouth formants`);
    assert.ok(formants.every(f => f.frequency.value <= 760), `${kind} formants stay below the whistle band`);
    assert.ok(noiseSources.length > noiseStart, `${kind} breathes through the supplied noise`);

    const peak = scheduledPeak(gains[gainStart]);
    assert.ok(peak > .05 && peak <= .5, `${kind} stays below the shared ceiling`);
    assert.equal(panners.at(-1).pan.value, -.4, `${kind} pans to the suit`);
  }

  // The walking rumble sits deeper than the searching rasp, which sits deeper
  // than the saturated chase snarl.
  const lowOf = (kind, pan) => {
    const start = oscillators.length;
    audio.monsterGrowl(kind, 1, pan);
    return Math.min(...oscillators.slice(start)
      .filter(o => o.type === 'sine')
      .map(o => o.frequency.events[0][1]));
  };
  const prowlLow = lowOf('prowl', 0), raspLow = lowOf('rasp', 0), snarlLow = lowOf('snarl', 0);
  assert.ok(prowlLow < raspLow && raspLow < snarlLow, 'the rumble stays the heaviest voice');

  // Snarl saturation is registered when the host supports it, and stays normalized.
  const snarlShaperStart = shapers.length;
  audio.monsterGrowl('snarl', 1, 0);
  const snarlShapers = shapers.slice(snarlShaperStart);
  assert.ok(snarlShapers.length >= 1, 'snarl saturates the throat');
  assert.ok(snarlShapers.every(s => s.curve.every(v => Math.abs(v) <= 1)), 'saturation stays normalized');

  // Footfall and roar telemetry keeps the story readable alongside the growls.
  audio.monsterStomp(.7, .25);
  assert.equal(audio.lastEvent.type, 'monsterStomp');
  assert.equal(audio.lastEvent.pan, .25);
  audio.monsterScream('alert', .7, -.2);
  assert.equal(audio.lastEvent.type, 'monsterScream');
  assert.equal(audio.lastEvent.kind, 'alert');

  // Mute records the intent but never synthesizes a voice.
  sound.setMuted(true);
  const mutedOsc = oscillators.length, mutedNoise = noiseSources.length;
  audio.monsterGrowl('snarl', 1, 0);
  assert.equal(oscillators.length, mutedOsc, 'muted growl schedules no oscillators');
  assert.equal(noiseSources.length, mutedNoise, 'muted growl schedules no noise');
  assert.equal(audio.lastEvent.type, 'monsterGrowl');
  sound.setMuted(false);

  // Silence fades every growl still alive, exactly like stomps and screams.
  audio.monsterGrowl('prowl', 1, 0);
  audio.monsterGrowl('rasp', 1, 0);
  audio.silenceMonster();
  const cancelled = gains.filter(g => g.gain.events.some(e => e[0] === 'cancel'));
  assert.ok(cancelled.length >= 2, 'each live growl owns an envelope');
  assert.ok(cancelled.every(g => g.gain.events.some(e => e[0] === 'target' && e[1] === 0)));
  assert.ok(oscillators.every(o => o.stoppedAt <= .1), 'silence stops growling oscillators');
  assert.ok(noiseSources.every(n => n.stoppedAt <= .1), 'silence stops growling breath');
});

test('capture scream rips a terrified human cry and respects mute and volume', () => {
  const {
    MockAudioContext, oscillators, noiseSources, filters, gains
  } = makeMockAudioContext();
  const sound = createSoundState({ storage: null, initialVolume: 1 });
  const playerAudio = makePlayerAudio(sound, { AudioContext: MockAudioContext });
  playerAudio.unlock();

  const oscStart = oscillators.length, noiseStart = noiseSources.length;
  const filterStart = filters.length, gainStart = gains.length;
  playerAudio.triggerCaptureScream();
  assert.equal(playerAudio.lastEvent.type, 'captureScream');

  const screamOsc = oscillators.slice(oscStart);
  assert.equal(screamOsc.length, 3, 'the cry layers saw, triangle edge and vibrato');
  const cry = screamOsc.find(o => o.type === 'sawtooth');
  assert.ok(cry, 'sawtooth carries the cry');
  const cryFreqs = cry.frequency.events.map(e => e[1]);
  assert.equal(cryFreqs[0], 235, 'the cry starts in a strained chest register');
  assert.ok(Math.max(...cryFreqs) >= 385, 'terror pitches the cry up');
  assert.ok(Math.min(...cryFreqs.slice(1)) <= 175, 'then it chokes down');
  assert.ok(screamOsc.some(o => o.type === 'triangle'), 'a triangle edge thickens the cry');
  const vibrato = screamOsc.find(o => o.frequency.value === 7.2);
  assert.ok(vibrato, 'a 7.2 Hz nervous vibrato shakes the pitch');

  const screamFilters = filters.slice(filterStart);
  assert.ok(
    screamFilters.some(f => f.type === 'bandpass' && f.frequency.value === 760 && f.Q.value === 2.4),
    'chest/mouth formant at 760 Hz'
  );
  assert.ok(
    screamFilters.some(f => f.type === 'bandpass' && f.frequency.value === 1520 && f.Q.value === 2.8),
    'frightened forward formant at 1520 Hz'
  );
  assert.ok(
    screamFilters.some(f => f.type === 'bandpass' && f.frequency.value === 1100),
    'ragged breath tears through the vowel'
  );
  assert.equal(noiseSources.length, noiseStart + 3, 'gasp, ragged breath and choked exhale');

  const screamGains = gains.slice(gainStart);
  const peak = Math.max(...screamGains.flatMap(g => g.gain.events
    .filter(e => e[0] === 'set' || e[0] === 'linear')
    .map(e => e[1])));
  assert.ok(peak >= .44 && peak <= .5, `the scream peaks around .46, got ${peak}`);
  const stops = screamOsc.map(o => o.stoppedAt);
  assert.ok(Math.max(...stops) <= 1.25, 'the cry chokes out by 1.22s');
  assert.ok(Math.min(...stops) >= 1.22, 'nothing is cut off before the exhale');

  // Muting stops the scream from being synthesized or recorded at all.
  sound.setMuted(true);
  const mutedOsc = oscillators.length, mutedNoise = noiseSources.length;
  const mutedEvents = playerAudio.events.filter(e => e.type === 'captureScream').length;
  playerAudio.triggerCaptureScream();
  assert.equal(oscillators.length, mutedOsc, 'muted scream schedules no oscillators');
  assert.equal(noiseSources.length, mutedNoise, 'muted scream schedules no noise');
  assert.equal(playerAudio.events.filter(e => e.type === 'captureScream').length, mutedEvents,
    'muted scream records nothing');

  // A zero-volume slider behaves the same way.
  sound.setVolume(0);
  assert.equal(sound.effectiveVolume, 0);
  playerAudio.triggerCaptureScream();
  assert.equal(oscillators.length, mutedOsc);
  assert.equal(noiseSources.length, mutedNoise);
});

