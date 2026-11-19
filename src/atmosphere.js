import { annex, extraLights as defaultExtraLights, hall, lights as defaultLights, lightX } from './layout.js';
import { soundState } from './sound.js';

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;

export const ATMOSPHERE_PRESETS = {
  tetrica: {
    label: 'Tétrica',
    ambient: 0.30,
    lampPower: 0.88,
    monsterLight: 1.45,
    flickerIntensity: 0.85,
    flickerSpeed: 1.0,
    blackoutRate: 0.35,
    eerieTint: 0.85,
    fogDensity: 0.96,
    windowGlow: 0.32,
    vignette: 0.28,
    grain: 0.42
  },
  falla: {
    label: 'Falla',
    ambient: 0.14,
    lampPower: 0.78,
    monsterLight: 1.65,
    flickerIntensity: 1.35,
    flickerSpeed: 1.35,
    blackoutRate: 0.72,
    eerieTint: 0.95,
    fogDensity: 1.35,
    windowGlow: 0.16,
    vignette: 0.37,
    grain: 0.62
  },
  apagon: {
    label: 'Apagón',
    ambient: 0.08,
    lampPower: 0.28,
    monsterLight: 1.85,
    flickerIntensity: 1.0,
    flickerSpeed: 0.85,
    blackoutRate: 0.90,
    eerieTint: 1.0,
    fogDensity: 1.65,
    windowGlow: 0.10,
    vignette: 0.44,
    grain: 0.75
  },
  normal: {
    label: 'Original',
    ambient: 1.0,
    lampPower: 1.0,
    monsterLight: 1.0,
    flickerIntensity: 0.0,
    flickerSpeed: 1.0,
    blackoutRate: 0.0,
    eerieTint: 0.0,
    fogDensity: 0.34,
    windowGlow: 1.0,
    vignette: 0.155,
    grain: 0.0
  }
};

// Individual ceiling ballast personalities (match layout.js lights order).
export const LAMP_PROFILES = [
  { faultiness: 0.36, stutterFreq: 1.10, deadBias: 0.08, seed: 11.3 },
  { faultiness: 0.64, stutterFreq: 1.42, deadBias: 0.18, seed: 27.7 },
  { faultiness: 1.00, stutterFreq: 1.92, deadBias: 0.68, seed: 43.1 },
  { faultiness: 0.74, stutterFreq: 1.25, deadBias: 0.26, seed: 61.9 },
  { faultiness: 0.86, stutterFreq: 1.65, deadBias: 0.44, seed: 79.4 },
  { faultiness: 0.92, stutterFreq: 1.36, deadBias: 0.52, seed: 97.2 }
];

function hash1(x) {
  const s = Math.sin(x * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function createAtmosphereState(fixtures = defaultLights, presetName = 'tetrica', extraFixtures = defaultExtraLights) {
  const preset = ATMOSPHERE_PRESETS[presetName] || ATMOSPHERE_PRESETS.tetrica;
  const lamps = fixtures.map((f, index) => {
    const profile = LAMP_PROFILES[index % LAMP_PROFILES.length];
    return {
      index,
      x: lightX,
      z: f.z,
      basePower: f.power,
      baseWarmth: f.warmth,
      mode: 'auto', // 'auto' | 'on' | 'broken' | 'off'
      phase: index === 2 ? 'dark' : 'steady',
      timer: 0.4 + hash1(profile.seed) * 2.2,
      power: f.power * preset.lampPower,
      warmth: f.warmth,
      level: f.power * preset.lampPower,
      spark: 0,
      profile
    };
  });

  const extraLamps = (extraFixtures || []).map((f, index) => {
    const faultiness = f.faultiness ?? 0.65;
    const profile = {
      faultiness,
      stutterFreq: 1.1 + (index % 4) * 0.22,
      deadBias: 0.14 + faultiness * 0.35,
      seed: 131.7 + index * 19.3
    };
    const defaultOn = f.defaultOn !== false;
    return {
      id: f.id || `extra-${index}`,
      index,
      x: f.x,
      z: f.z,
      basePower: f.power,
      baseWarmth: f.warmth,
      switchedOn: defaultOn,
      mode: defaultOn ? 'auto' : 'off',
      phase: defaultOn ? 'steady' : 'dark',
      timer: 0.4 + hash1(profile.seed) * 2.2,
      power: defaultOn ? f.power * preset.lampPower : 0,
      warmth: f.warmth,
      level: defaultOn ? f.power * preset.lampPower : 0,
      spark: 0,
      profile
    };
  });

  return {
    preset: presetName in ATMOSPHERE_PRESETS ? presetName : 'tetrica',
    settings: { ...preset },
    flickerEnabled: true,
    audioEnabled: true,
    allowReducedMotionFlicker: false,
    time: 0,
    surgeWave: -1,
    arcEnergy: 0,
    lamps,
    extraLamps
  };
}

export function applyAtmospherePreset(state, presetName) {
  const preset = ATMOSPHERE_PRESETS[presetName];
  if (!preset) return state;
  state.preset = presetName;
  state.settings = { ...preset };
  return state;
}

export function triggerAtmosphereSurge(state) {
  state.surgeWave = 0;
  for (const lamp of state.lamps) {
    if (lamp.mode === 'off') continue;
    lamp.phase = 'sputter';
    lamp.timer = 0.45 + hash1(state.time * 3.1 + lamp.profile.seed) * 0.65;
  }
  for (const lamp of state.extraLamps || []) {
    if (lamp.mode === 'off') continue;
    lamp.phase = 'sputter';
    lamp.timer = 0.45 + hash1(state.time * 3.1 + lamp.profile.seed) * 0.65;
  }
}

export function stepAtmosphere(state, dt = 0, { reducedMotion = false } = {}) {
  const safeDt = clamp(dt, 0, 0.1);
  const s = state.settings;
  state.time += safeDt;

  if (state.surgeWave >= 0) {
    state.surgeWave += safeDt * 1.45;
    if (state.surgeWave > 2.2) state.surgeWave = -1;
  }

  const speed = clamp(s.flickerSpeed, 0.1, 3.0);
  const globalFlicker = state.flickerEnabled ? clamp(s.flickerIntensity, 0, 2) : 0;
  const calmMotion = reducedMotion && !state.allowReducedMotionFlicker;
  let frameArc = 0;

  function stepLamp(lamp, isCorridor) {
    const prevLevel = lamp.level;
    const p = lamp.profile;

    if (lamp.mode === 'off') {
      const rate = 1 - Math.exp(-26 * safeDt);
      lamp.level = lerp(lamp.level, 0, rate);
      lamp.power = lamp.level;
      lamp.warmth = lamp.baseWarmth;
      lamp.spark = 0;
      return;
    }

    if (lamp.mode === 'on') {
      const target = lamp.basePower * s.lampPower;
      const rate = 1 - Math.exp(-22 * safeDt);
      lamp.level = lerp(lamp.level, target, rate);
      lamp.power = lamp.level;
      lamp.warmth = lamp.baseWarmth;
      lamp.spark = 0;
      return;
    }

    const modeFault = lamp.mode === 'broken' ? 1.15 : p.faultiness;
    const effectiveFlicker = globalFlicker * modeFault;
    const baseTarget = lamp.basePower * s.lampPower;

    // Optional rolling surge wave along the corridor Z axis.
    let waveImpulse = 0;
    if (state.surgeWave >= 0) {
      const normZ = clamp((hall.near - lamp.z) / (hall.near - annex.z0), 0, 1);
      const distWave = Math.abs(state.surgeWave - normZ);
      if (distWave < 0.24) {
        waveImpulse = 1 - distWave / 0.24;
      }
    }

    if (calmMotion || effectiveFlicker <= 0.001) {
      const gentle = calmMotion && effectiveFlicker > 0.01
        ? 1 - 0.14 * effectiveFlicker * (0.5 + 0.5 * Math.sin(state.time * 1.1 + p.seed))
        : 1;
      const target = baseTarget * gentle * (lamp.mode === 'broken' ? 0.35 : 1);
      const rate = 1 - Math.exp(-8 * safeDt);
      lamp.level = lerp(lamp.level, target, rate);
      lamp.power = lamp.level;
      lamp.warmth = clamp(lamp.baseWarmth + (1 - gentle) * 0.25, 0, 1);
      lamp.spark = 0;
      return;
    }

    lamp.timer -= safeDt * speed * (0.75 + 0.65 * effectiveFlicker);
    if (lamp.timer <= 0) {
      const r = hash1(state.time * 19.7 + p.seed + lamp.index * 5.3);
      const deadChance = clamp((p.deadBias * 0.55 + s.blackoutRate * 0.65) * clamp(effectiveFlicker, 0.2, 1.3), 0, 0.9);

      if (lamp.phase === 'steady') {
        if (r < deadChance * 0.48) {
          lamp.phase = 'dark';
          lamp.timer = 0.32 + hash1(r * 73.1 + p.seed) * (0.95 + s.blackoutRate * 1.1);
        } else if (r < deadChance * 0.48 + 0.58 * clamp(effectiveFlicker, 0.15, 1.2)) {
          lamp.phase = 'sputter';
          lamp.timer = 0.18 + hash1(r * 41.9 + p.seed) * 0.55;
        } else if (r > 0.88) {
          lamp.phase = 'surge';
          lamp.timer = 0.14 + hash1(r * 19.3 + p.seed) * 0.26;
        } else {
          lamp.timer = 0.6 + hash1(r * 59.3 + p.seed) * 1.9;
        }
      } else if (lamp.phase === 'dark') {
        if (r < 0.72) {
          lamp.phase = 'sputter';
          lamp.timer = 0.18 + hash1(r * 31.7 + p.seed) * 0.48;
        } else {
          lamp.phase = 'steady';
          lamp.timer = 0.7 + hash1(r * 23.9 + p.seed) * 2.2;
        }
      } else if (lamp.phase === 'sputter') {
        if (r < deadChance * 0.62) {
          lamp.phase = 'dark';
          lamp.timer = 0.25 + hash1(r * 89.1 + p.seed) * (0.85 + s.blackoutRate * 1.15);
        } else if (r > 0.85) {
          lamp.phase = 'surge';
          lamp.timer = 0.10 + hash1(r * 13.7 + p.seed) * 0.20;
        } else {
          lamp.phase = 'steady';
          lamp.timer = 0.8 + hash1(r * 47.3 + p.seed) * 2.6;
        }
      } else {
        lamp.phase = 'steady';
        lamp.timer = 0.9 + hash1(r * 37.1 + p.seed) * 2.2;
      }
    }

    const t = state.time * speed;
    const hum = 1 + Math.sin(t * (43 + lamp.index * 5.7) + p.seed) * 0.032 * clamp(effectiveFlicker, 0, 1.5);
    const stepTick = Math.floor(t * (17 + p.stutterFreq * 9));
    const n1 = hash1(stepTick * 1.37 + p.seed);
    const n2 = hash1(Math.floor(t * 7.5) * 2.13 + p.seed * 0.5);

    let factor = 1.0;
    let spark = 0;

    if (lamp.phase === 'steady') {
      const sag = n2 < 0.16 * clamp(effectiveFlicker, 0, 1.2) ? 0.68 + 0.25 * n1 : 1.0;
      factor = hum * sag;
      if (isCorridor && lamp.index === 2 && lamp.mode === 'auto') factor *= 0.85;
    } else if (lamp.phase === 'dark') {
      factor = n1 > 0.91 ? 0.26 + 0.22 * n2 : 0.03 + 0.05 * n1;
      spark = n1 > 0.91 ? 0.5 : 0;
    } else if (lamp.phase === 'sputter') {
      if (n1 < 0.34) {
        factor = 0.04 + 0.08 * n2;
      } else if (n1 < 0.66) {
        factor = 0.28 + 0.34 * n2;
        spark = 0.45;
      } else {
        factor = 0.95 + 0.42 * n2;
        spark = 0.9;
      }
    } else if (lamp.phase === 'surge') {
      factor = 1.18 + 0.32 * n1;
      spark = 0.7;
    }

    if (waveImpulse > 0.01) {
      const waveBurst = hash1(Math.floor(t * 28) + p.seed) > 0.42 ? 1.38 : 0.06;
      factor = lerp(factor, waveBurst, waveImpulse);
      spark = Math.max(spark, waveImpulse * 0.95);
    }

    const target = clamp(baseTarget * factor, 0, 1.85);
    const tau = target > lamp.level ? 42 : 24;
    const rate = 1 - Math.exp(-tau * safeDt);
    lamp.level = lerp(lamp.level, target, rate);
    lamp.power = lamp.level;
    lamp.spark = spark;

    const dimWarm = clamp((0.42 - factor) * 0.85, 0, 0.38);
    const surgeCool = clamp((factor - 1.08) * 0.45, 0, 0.25);
    lamp.warmth = clamp(lamp.baseWarmth + dimWarm - surgeCool, 0, 1);

    frameArc += Math.abs(lamp.level - prevLevel) + spark * 0.08;
  }

  for (const lamp of state.lamps) stepLamp(lamp, true);
  for (const lamp of state.extraLamps || []) stepLamp(lamp, false);

  state.arcEnergy = lerp(state.arcEnergy, clamp(frameArc * 0.45, 0, 1), 1 - Math.exp(-16 * safeDt));
  return state;
}

export function isAtmosphereAnimating(state, reducedMotion = false) {
  if (!state.flickerEnabled) return state.surgeWave >= 0;
  if (reducedMotion && !state.allowReducedMotionFlicker) return false;
  if (state.surgeWave >= 0) return true;
  if (state.settings.flickerIntensity > 0.005) {
    if (state.lamps.some(l => l.mode !== 'off' && l.mode !== 'on')) return true;
    if ((state.extraLamps || []).some(l => l.mode !== 'off' && l.mode !== 'on')) return true;
  }
  return false;
}

export function makeAtmosphereAudio(sound = soundState) {
  const AudioCtx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  let ctx = null;
  let master = null;
  let humGain = null;
  let buzzGain = null;
  let failed = false;
  let lastCrackle = 0;

  sound.subscribe(snap => {
    if (!ctx || !master) return;
    if (snap.effectiveVolume <= 0) {
      silence();
    }
  });

  function ensure() {
    if (failed || !AudioCtx) return false;
    if (!ctx) {
      try {
        ctx = new AudioCtx();
        master = ctx.createGain();
        master.gain.value = 0;
        master.connect(ctx.destination);

        // 100Hz mains ballast hum + 200Hz harmonic
        const osc1 = ctx.createOscillator();
        osc1.type = 'sawtooth';
        osc1.frequency.value = 100;

        const osc2 = ctx.createOscillator();
        osc2.type = 'triangle';
        osc2.frequency.value = 200;

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 210;
        filter.Q.value = 2.4;

        humGain = ctx.createGain();
        humGain.gain.value = 0.018;

        osc1.connect(filter);
        osc2.connect(filter);
        filter.connect(humGain);
        humGain.connect(master);

        osc1.start();
        osc2.start();

        // High-frequency fluorescent arc buzz noise
        const len = ctx.sampleRate;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

        const noise = ctx.createBufferSource();
        noise.buffer = buf;
        noise.loop = true;

        const arcBand = ctx.createBiquadFilter();
        arcBand.type = 'bandpass';
        arcBand.frequency.value = 2850;
        arcBand.Q.value = 3.2;

        buzzGain = ctx.createGain();
        buzzGain.gain.value = 0;

        noise.connect(arcBand);
        arcBand.connect(buzzGain);
        buzzGain.connect(master);
        noise.start();
      } catch {
        failed = true;
        return false;
      }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return true;
  }

  function update(state, { active = false, cameraX = 0, cameraZ = 0 } = {}) {
    if (!ctx || !master) return;
    const masterVol = sound.effectiveVolume;
    if (!active || !state.audioEnabled || masterVol <= 0) {
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      return;
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    // Find closest active ceiling lamp to weight ballast hum & crackle.
    let nearestPower = 0;
    let nearestSpark = 0;
    for (const lamp of state.lamps) {
      const dx = cameraX - (lamp.x ?? lightX);
      const dz = cameraZ - lamp.z;
      const prox = 1 / (1 + (dx * dx + dz * dz) * 0.045);
      nearestPower = Math.max(nearestPower, lamp.power * prox);
      nearestSpark = Math.max(nearestSpark, lamp.spark * prox);
    }
    for (const lamp of state.extraLamps || []) {
      if (lamp.mode === 'off') continue;
      const dx = cameraX - lamp.x;
      const dz = cameraZ - lamp.z;
      const prox = 1 / (1 + (dx * dx + dz * dz) * 0.055);
      nearestPower = Math.max(nearestPower, lamp.power * prox);
      nearestSpark = Math.max(nearestSpark, lamp.spark * prox);
    }

    const now = ctx.currentTime;
    const humLevel = state.settings.lampPower > 0.02 ? (0.012 + 0.020 * clamp(nearestPower, 0, 1)) : 0;
    master.gain.setTargetAtTime(humLevel > 0 ? masterVol : 0, now, 0.08);
    if (humGain) humGain.gain.setTargetAtTime(humLevel, now, 0.06);

    const buzzLevel = clamp(nearestSpark * 0.016 + state.arcEnergy * 0.012, 0, 0.026);
    if (buzzGain) buzzGain.gain.setTargetAtTime(buzzLevel, now, 0.02);

    if (nearestSpark > 0.65 && now - lastCrackle > 0.12) {
      lastCrackle = now;
      if (buzzGain) {
        buzzGain.gain.setValueAtTime(0.032, now);
        buzzGain.gain.exponentialRampToValueAtTime(0.002, now + 0.045);
      }
    }
  }

  function silence() {
    if (!ctx || !master) return;
    try {
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
    } catch { /* ignore */ }
  }

  return { unlock: ensure, update, silence };
}

export function createAtmosphere(fixtures = defaultLights, extraFixtures = defaultExtraLights) {
  const state = createAtmosphereState(fixtures, 'tetrica', extraFixtures);
  const audio = makeAtmosphereAudio();

  function apply(env) {
    if (!env) return;
    const s = state.settings;
    env.ambientLevel.value = s.ambient;
    env.eerieTint.value = s.eerieTint;
    env.fogDensity.value = s.fogDensity;
    env.windowGlow.value = s.windowGlow;
    env.vignetteAmount.value = s.vignette;
    env.grainAmount.value = s.grain;
    if (env.monsterLight) env.monsterLight.value = s.monsterLight;
    env.time.value = state.time;

    const strips = env.strips.value;
    for (let i = 0; i < state.lamps.length && i < strips.length; i++) {
      const lamp = state.lamps[i];
      strips[i].z = lamp.power;
      strips[i].w = lamp.warmth;
    }

    if (env.extraStrips) {
      const extraStrips = env.extraStrips.value;
      const extraLamps = state.extraLamps || [];
      for (let i = 0; i < extraLamps.length && i < extraStrips.length; i++) {
        const lamp = extraLamps[i];
        extraStrips[i].z = lamp.power;
        extraStrips[i].w = lamp.warmth;
      }
    }
  }

  function findExtraLamp(id) {
    return (state.extraLamps || []).find(l => l.id === id) || null;
  }

  function toggleRoomLight(id) {
    const lamp = findExtraLamp(id);
    if (!lamp) return false;
    lamp.switchedOn = !lamp.switchedOn;
    lamp.mode = lamp.switchedOn ? 'auto' : 'off';
    if (lamp.switchedOn) {
      lamp.phase = 'sputter';
      lamp.timer = 0.28;
    }
    return lamp.switchedOn;
  }

  return {
    state,
    audio,
    apply,
    setPreset(name) { applyAtmospherePreset(state, name); },
    surge() { triggerAtmosphereSurge(state); },
    cycleLamp(index) {
      const lamp = state.lamps[index];
      if (!lamp) return;
      const order = ['auto', 'off', 'on', 'broken'];
      lamp.mode = order[(order.indexOf(lamp.mode) + 1) % order.length];
    },
    toggleRoomLight,
    getRoomLight(id) { return findExtraLamp(id); },
    update(dt, { reducedMotion = false, active = false, cameraX = 0, cameraZ = 0 } = {}) {
      stepAtmosphere(state, dt, { reducedMotion });
      audio.update(state, { active, cameraX, cameraZ });
    },
    animating(reducedMotion = false) {
      return isAtmosphereAnimating(state, reducedMotion);
    }
  };
}

