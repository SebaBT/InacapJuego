import { makeMonsterVoice } from './monster-audio.js';

const STORAGE_KEY = 'pabellon-b:sound';
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

function getBrowserStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch { /* ignore storage access errors */ }
  return null;
}

export function createSoundState({ storage = getBrowserStorage(), initialVolume = 1, initialMuted = false } = {}) {
  let volume = clamp(Number.isFinite(initialVolume) ? initialVolume : 1, 0, 1);
  let muted = Boolean(initialMuted);
  let lastNonZeroVolume = volume > 0 ? volume : 0.85;

  if (storage) {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.volume === 'number' && Number.isFinite(parsed.volume)) {
          volume = clamp(parsed.volume, 0, 1);
          if (volume > 0) lastNonZeroVolume = volume;
        }
        if (typeof parsed?.muted === 'boolean') {
          muted = parsed.muted;
        }
      }
    } catch { /* ignore malformed storage */ }
  }

  const listeners = new Set();

  function persist() {
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ volume, muted }));
    } catch { /* ignore quota or private mode errors */ }
  }

  function snapshot() {
    const effectiveVolume = muted ? 0 : volume;
    return {
      volume,
      muted,
      effectiveVolume
    };
  }

  function notify() {
    persist();
    const snap = snapshot();
    for (const listener of listeners) {
      try { listener(snap); } catch { /* ignore listener errors */ }
    }
  }

  function setVolume(next) {
    if (!Number.isFinite(next)) return;
    const clamped = clamp(next, 0, 1);
    const changed = clamped !== volume || (clamped > 0 && muted);
    volume = clamped;
    if (clamped > 0) {
      lastNonZeroVolume = clamped;
      muted = false;
    }
    if (changed) notify();
  }

  function setMuted(next) {
    const target = Boolean(next);
    if (target === muted && !(target === false && volume === 0)) return;
    muted = target;
    if (!muted && volume === 0) {
      volume = lastNonZeroVolume > 0 ? lastNonZeroVolume : 0.85;
    }
    notify();
  }

  function toggleMute() {
    if (muted || volume === 0) {
      setMuted(false);
    } else {
      setMuted(true);
    }
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    get volume() { return volume; },
    get muted() { return muted; },
    get effectiveVolume() { return muted ? 0 : volume; },
    setVolume,
    setMuted,
    toggleMute,
    subscribe
  };
}

export const soundState = createSoundState();

export function getDoorSoundKind(door) {
  const id = typeof door === 'string' ? door : door?.id;
  if (id === 'anexo' || id === 'entrada') return 'double';
  if (id === 'azotea') return 'metal';
  return 'wood';
}

export function makeControlledDoorAudio(sound = soundState, { AudioContext: CustomAudioCtx } = {}) {
  const AudioCtx = CustomAudioCtx || (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext));
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let monsterVoice = null;
  let failed = false;
  let lastEvent = null;
  const events = [];

  function recordEvent(evt) {
    lastEvent = evt;
    events.push(evt);
    if (events.length > 64) events.shift();
  }

  function syncGain() {
    if (!ctx || !master) return;
    try {
      master.gain.setTargetAtTime(sound.effectiveVolume, ctx.currentTime, 0.015);
    } catch { /* ignore */ }
  }

  sound.subscribe(syncGain);

  function ensure() {
    if (failed || !AudioCtx) return null;
    if (!ctx) {
      try {
        ctx = new AudioCtx();
        master = ctx.createGain();
        master.gain.value = sound.effectiveVolume;
        master.connect(ctx.destination);

        if (typeof ctx.createBuffer === 'function') {
          const sampleRate = ctx.sampleRate || 44100;
          const len = Math.floor(sampleRate * 0.6);
          noiseBuffer = ctx.createBuffer(1, len, sampleRate);
          const data = noiseBuffer.getChannelData(0);
          let prev = 0;
          for (let i = 0; i < len; i++) {
            const white = Math.random() * 2 - 1;
            prev = 0.82 * prev + 0.18 * white;
            data[i] = (white * 0.55 + prev * 0.45) * 0.25;
          }
        }
        monsterVoice = makeMonsterVoice(ctx, master, noiseBuffer);
      } catch {
        failed = true;
        return null;
      }
    }
    if (ctx.state === 'suspended') ctx.resume?.()?.catch?.(() => {});
    return ctx;
  }

  function playTone(c, type, freqStart, freqEnd, startTime, duration, peakGain) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freqStart), startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(18, freqEnd), startTime + duration);
    gain.gain.setValueAtTime(Math.max(0.0001, peakGain), startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.008);
  }

  function playNoise(c, bandFreq, bandQ, startTime, duration, peakGain) {
    if (!noiseBuffer || typeof c.createBufferSource !== 'function' || typeof c.createBiquadFilter !== 'function') return;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = bandFreq;
    filter.Q.value = bandQ;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + Math.min(0.015, duration * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(startTime, 0, duration + 0.01);
  }

  function playSwitch(on = true) {
    if (sound.effectiveVolume <= 0) return;
    recordEvent({ type: 'switch', on: Boolean(on) });
    const c = ensure();
    if (!c || !master) return;
    const now = c.currentTime;
    playTone(c, 'square', on ? 880 : 620, on ? 420 : 280, now, 0.038, 0.055);
    playTone(c, 'triangle', on ? 1640 : 1220, on ? 820 : 580, now + 0.004, 0.018, 0.024);
  }

  function playGrab(door = null) {
    if (sound.effectiveVolume <= 0) return;
    const doorKind = getDoorSoundKind(door);
    const doorId = typeof door === 'string' ? door : door?.id || null;
    recordEvent({ type: 'grab', doorKind, doorId });
    const c = ensure();
    if (!c || !master) return;
    const now = c.currentTime;
    if (doorKind === 'double' || doorKind === 'metal') {
      // Metallic panic/push bar contact clack
      playTone(c, 'square', 580, 290, now, 0.034, 0.036);
      playTone(c, 'sine', 1260, 840, now + 0.004, 0.042, 0.022);
    } else {
      // Classroom lever handle grasp & spring depress
      playTone(c, 'triangle', 440, 230, now, 0.036, 0.032);
      playNoise(c, 1380, 2.2, now + 0.003, 0.035, 0.016);
    }
  }

  function playRelease(door = null) {
    if (sound.effectiveVolume <= 0) return;
    const doorKind = getDoorSoundKind(door);
    const doorId = typeof door === 'string' ? door : door?.id || null;
    recordEvent({ type: 'release', doorKind, doorId });
    const c = ensure();
    if (!c || !master) return;
    const now = c.currentTime;
    playTone(c, 'triangle', 270, doorKind === 'double' ? 510 : 440, now, 0.030, 0.022);
  }

  function playLocked(door = null, { slam = false, blocked = false } = {}) {
    if (sound.effectiveVolume <= 0) return;
    const doorKind = getDoorSoundKind(door);
    const doorId = typeof door === 'string' ? door : door?.id || null;
    recordEvent({ type: 'locked', doorKind, doorId, slam: Boolean(slam), blocked: Boolean(blocked) });
    const c = ensure();
    if (!c || !master) return;
    const now = c.currentTime;

    if (blocked) {
      playTone(c, 'triangle', 210, 105, now, 0.048, 0.055);
      playTone(c, 'triangle', 180, 92, now + 0.065, 0.045, 0.042);
      return;
    }

    if (slam) {
      // Heavy shoulder thud against locked exit or rooftop door
      playTone(c, 'triangle', 118, 35, now, 0.14, 0.19);
    }

    const metalHi = doorKind === 'metal' ? 1140 : doorKind === 'double' ? 920 : 680;
    for (const offset of [0, 0.09]) {
      playTone(c, 'triangle', 165, 75, now + offset, 0.062, slam ? 0.12 : 0.09);
      playTone(c, 'square', metalHi, metalHi * 0.42, now + offset + 0.005, 0.044, slam ? 0.048 : 0.032);
    }
  }

  function playBlocked(door = null) {
    playLocked(door, { blocked: true });
  }

  function playDoor(opening = true, door = null) {
    if (sound.effectiveVolume <= 0) return;
    const doorKind = getDoorSoundKind(door);
    const doorId = typeof door === 'string' ? door : door?.id || null;
    recordEvent({ type: 'door', opening: Boolean(opening), doorKind, doorId });
    const c = ensure();
    if (!c || !master) return;
    const now = c.currentTime;

    if (doorKind === 'double') {
      // Dual panic-bar latch clicks for the two Annex leaves
      playTone(c, 'square', opening ? 490 : 330, 155, now, 0.045, 0.048);
      playTone(c, 'square', opening ? 540 : 365, 170, now + 0.022, 0.042, 0.038);

      // Dual-leaf heavy hinge & painted frame sweep
      for (const [idx, base] of [[0, 112], [1, 164]]) {
        const creak = c.createOscillator();
        const filter = c.createBiquadFilter();
        const creakGain = c.createGain();
        creak.type = idx === 0 ? 'sawtooth' : 'triangle';
        creak.frequency.setValueAtTime(opening ? base : base * 1.26, now + 0.035 + idx * 0.015);
        creak.frequency.linearRampToValueAtTime(opening ? base * 1.32 : base * 0.84, now + 0.42);
        filter.type = 'bandpass';
        filter.frequency.value = idx === 0 ? 440 : 620;
        filter.Q.value = 3.8;
        creakGain.gain.setValueAtTime(0.001, now + 0.03);
        creakGain.gain.linearRampToValueAtTime(idx === 0 ? 0.030 : 0.022, now + 0.12);
        creakGain.gain.exponentialRampToValueAtTime(0.001, now + 0.46);
        creak.connect(filter);
        filter.connect(creakGain);
        creakGain.connect(master);
        creak.start(now + 0.03);
        creak.stop(now + 0.48);
      }
      playNoise(c, 320, 1.4, now + 0.04, 0.36, 0.022);
      return;
    }

    // Classroom / Lab wooden door latch click
    playTone(c, 'square', opening ? 520 : 340, 150, now, 0.048, 0.045);

    // Hinge creak / wood sweep + overhead hydraulic scissor door-closer pneumatic hiss
    const creak = c.createOscillator();
    const filter = c.createBiquadFilter();
    const creakGain = c.createGain();
    creak.type = 'sawtooth';
    creak.frequency.setValueAtTime(opening ? 132 : 168, now + 0.04);
    creak.frequency.linearRampToValueAtTime(opening ? 174 : 108, now + 0.36);
    filter.type = 'bandpass';
    filter.frequency.value = opening ? 540 : 460;
    filter.Q.value = 4.5;
    creakGain.gain.setValueAtTime(0.001, now + 0.03);
    creakGain.gain.linearRampToValueAtTime(0.032, now + 0.11);
    creakGain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
    creak.connect(filter);
    filter.connect(creakGain);
    creakGain.connect(master);
    creak.start(now + 0.03);
    creak.stop(now + 0.44);

    // Hydraulic scissor closer arm sweep
    playNoise(c, opening ? 1180 : 940, 2.4, now + 0.04, 0.34, 0.015);
  }

  function playCloseLatch(door = null) {
    if (sound.effectiveVolume <= 0) return;
    const doorKind = getDoorSoundKind(door);
    const doorId = typeof door === 'string' ? door : door?.id || null;
    recordEvent({ type: 'closeLatch', doorKind, doorId });
    const c = ensure();
    if (!c || !master) return;
    const now = c.currentTime;

    // Physical door leaf meeting the steel frame stop
    const thudStart = doorKind === 'double' ? 94 : 116;
    const thudEnd = doorKind === 'double' ? 30 : 38;
    playTone(c, 'triangle', thudStart, thudEnd, now, 0.105, doorKind === 'double' ? 0.11 : 0.085);

    // Latch bolt snapping into the strike plate
    playTone(c, 'square', doorKind === 'double' ? 620 : 720, 230, now + 0.018, 0.038, 0.042);
    if (doorKind === 'double') {
      playTone(c, 'sine', 1480, 920, now + 0.022, 0.045, 0.020);
    }
  }

  function playOpenStop(door = null) {
    if (sound.effectiveVolume <= 0) return;
    const doorKind = getDoorSoundKind(door);
    const doorId = typeof door === 'string' ? door : door?.id || null;
    recordEvent({ type: 'openStop', doorKind, doorId });
    const c = ensure();
    if (!c || !master) return;
    const now = c.currentTime;
    // Soft hydraulic closer check / doorstop cushion at maximum opening angle
    playTone(c, 'triangle', doorKind === 'double' ? 84 : 96, 40, now, 0.072, 0.032);
  }

  function playSlam(door = null) {
    if (sound.effectiveVolume <= 0) return;
    const doorKind = getDoorSoundKind(door);
    const doorId = typeof door === 'string' ? door : door?.id || null;
    recordEvent({ type: 'slam', doorKind, doorId });
    const c = ensure();
    if (!c || !master) return;
    const now = c.currentTime;

    // Heavy body-to-door thud
    playTone(c, 'triangle', doorKind === 'double' ? 110 : 128, 34, now, 0.155, 0.23);

    if (doorKind === 'double') {
      // Annex metallic panic-bar crash
      playTone(c, 'square', 890, 310, now + 0.008, 0.065, 0.075);
      playTone(c, 'sine', 1680, 1080, now + 0.012, 0.085, 0.042);
    }

    // Wired-glass vision panel rattle inside frame
    playTone(c, 'sine', 1860, 1380, now + 0.026, 0.065, 0.026);
    playTone(c, 'sine', 1780, 1320, now + 0.135, 0.075, 0.024);

    // Doorstop wall bang ~0.12s later + rebound hinge groan
    playTone(c, 'sawtooth', 162, 42, now + 0.12, 0.175, 0.145);
    playTone(c, 'triangle', 195, 118, now + 0.16, 0.14, 0.048);
  }

  return {
    unlock: ensure,
    monsterStomp(level, pan) {
      if (level > .005 && sound.effectiveVolume > 0) {
        recordEvent({ type: 'monsterStomp', level, pan });
        if (ensure()) monsterVoice.stomp(level, pan);
      }
    },
    monsterScream(kind, level, pan) {
      if (level > .005 && sound.effectiveVolume > 0) {
        recordEvent({ type: 'monsterScream', kind, level, pan });
        if (ensure()) monsterVoice.scream(kind, level, pan);
      }
    },
    monsterGrowl(kind = 'prowl', level = .5, pan = 0) {
      if (!(level > .005)) return;
      recordEvent({ type: 'monsterGrowl', kind, level, pan });
      if (sound.effectiveVolume > 0 && ensure()) monsterVoice.growl(kind, level, pan);
    },
    silenceMonster() { monsterVoice?.silence(); },
    playSwitch,
    playGrab,
    playRelease,
    playLocked,
    playBlocked,
    playDoor,
    playCloseLatch,
    playOpenStop,
    playSlam,
    get lastEvent() { return lastEvent; },
    get events() { return events; }
  };
}

export function bindSoundControl(root = typeof document !== 'undefined' ? document : null, sound = soundState, { onInteract } = {}) {
  if (!root) return () => {};
  const container = root.querySelector('#sound-control');
  const toggle = root.querySelector('#sound-toggle');
  const slider = root.querySelector('#sound-volume');
  const readout = root.querySelector('#sound-volume-val');
  if (!container || !toggle || !slider || !readout) return () => {};

  function syncUi() {
    const pct = Math.round(sound.volume * 100);
    const isMuted = sound.muted || pct === 0;
    const level = isMuted ? 'muted' : pct < 50 ? 'low' : 'high';
    container.dataset.soundLevel = level;

    toggle.setAttribute('aria-pressed', String(isMuted));
    const toggleLabel = isMuted ? 'Activar sonido' : 'Silenciar sonido';
    toggle.setAttribute('aria-label', toggleLabel);
    toggle.title = toggleLabel;

    slider.value = String(pct);
    const valueText = isMuted ? 'Silencio' : `${pct} %`;
    slider.setAttribute('aria-valuetext', valueText);
    readout.textContent = valueText;
  }

  function handleToggle() {
    sound.toggleMute();
    if (sound.effectiveVolume > 0) onInteract?.();
  }

  function handleInput() {
    sound.setVolume(slider.valueAsNumber / 100);
    if (sound.effectiveVolume > 0) onInteract?.();
  }

  toggle.addEventListener('click', handleToggle);
  slider.addEventListener('input', handleInput);
  const unsubscribe = sound.subscribe(syncUi);
  syncUi();

  return () => {
    toggle.removeEventListener('click', handleToggle);
    slider.removeEventListener('input', handleInput);
    unsubscribe();
  };
}
