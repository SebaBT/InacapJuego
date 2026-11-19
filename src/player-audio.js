import { annex, benchZ, hall, landing, plaza, rooms } from './layout.js';
import { sampleDebrisAt } from './debris.js';
import { soundState } from './sound.js';

const BASE_MASTER_GAIN = 0.95;
const PLAYER_RADIUS = 0.245;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export const SURFACE_PROFILES = {
  tile: {
    id: 'tile',
    label: 'Baldosa cerámica',
    heelStart: 84,
    heelEnd: 34,
    heelDur: 0.075,
    heelGain: 0.165,
    heelWave: 'triangle',
    bodyFreq: 165,
    bodyEnd: 82,
    bodyGain: 0.088,
    bodyWave: 'sine',
    clickFreq: 340,
    clickEnd: 155,
    clickGain: 0.068,
    clickDur: 0.028,
    scuffFreq: 460,
    scuffSprintFreq: 590,
    scuffQ: 1.35,
    scuffGain: 0.082,
    scuffDur: 0.052
  },
  linoleum: {
    id: 'linoleum',
    label: 'Linóleo de aula',
    heelStart: 76,
    heelEnd: 31,
    heelDur: 0.068,
    heelGain: 0.150,
    heelWave: 'triangle',
    bodyFreq: 145,
    bodyEnd: 72,
    bodyGain: 0.078,
    bodyWave: 'sine',
    clickFreq: 275,
    clickEnd: 128,
    clickGain: 0.054,
    clickDur: 0.026,
    scuffFreq: 390,
    scuffSprintFreq: 500,
    scuffQ: 1.25,
    scuffGain: 0.074,
    scuffDur: 0.048
  },
  concrete: {
    id: 'concrete',
    label: 'Hormigón del anexo',
    heelStart: 64,
    heelEnd: 26,
    heelDur: 0.092,
    heelGain: 0.205,
    heelWave: 'triangle',
    bodyFreq: 124,
    bodyEnd: 56,
    bodyGain: 0.110,
    bodyWave: 'sine',
    clickFreq: 235,
    clickEnd: 108,
    clickGain: 0.062,
    clickDur: 0.032,
    scuffFreq: 350,
    scuffSprintFreq: 460,
    scuffQ: 1.15,
    scuffGain: 0.096,
    scuffDur: 0.064,
    gritFreq: 620,
    gritGain: 0.058
  },
  gravel: {
    id: 'gravel',
    label: 'Escombros y polvo',
    heelStart: 70,
    heelEnd: 29,
    heelDur: 0.082,
    heelGain: 0.175,
    heelWave: 'triangle',
    bodyFreq: 136,
    bodyEnd: 64,
    bodyGain: 0.092,
    bodyWave: 'triangle',
    clickFreq: 295,
    clickEnd: 135,
    clickGain: 0.065,
    clickDur: 0.032,
    scuffFreq: 520,
    scuffSprintFreq: 680,
    scuffQ: 1.05,
    scuffGain: 0.115,
    scuffDur: 0.080,
    crunchGrains: 3,
    gritFreq: 740,
    gritGain: 0.092
  },
  wood: {
    id: 'wood',
    label: 'Madera',
    heelStart: 104,
    heelEnd: 44,
    heelDur: 0.095,
    heelGain: 0.210,
    heelWave: 'triangle',
    bodyFreq: 186,
    bodyEnd: 94,
    bodyGain: 0.135,
    bodyWave: 'triangle',
    clickFreq: 250,
    clickEnd: 118,
    clickGain: 0.085,
    clickDur: 0.035,
    scuffFreq: 330,
    scuffSprintFreq: 430,
    scuffQ: 1.4,
    scuffGain: 0.076,
    scuffDur: 0.055,
    creakFreq: 190,
    creakGain: 0.068
  },
  lab: {
    id: 'lab',
    label: 'Piso técnico de laboratorio',
    heelStart: 88,
    heelEnd: 37,
    heelDur: 0.072,
    heelGain: 0.160,
    heelWave: 'triangle',
    bodyFreq: 198,
    bodyEnd: 102,
    bodyGain: 0.086,
    bodyWave: 'sine',
    clickFreq: 380,
    clickEnd: 175,
    clickGain: 0.070,
    clickDur: 0.026,
    scuffFreq: 490,
    scuffSprintFreq: 630,
    scuffQ: 1.45,
    scuffGain: 0.078,
    scuffDur: 0.046,
    metalFreq: 320,
    metalHarmonic: 485,
    metalGain: 0.042,
    metalDur: 0.058
  },
  stairs: {
    id: 'stairs',
    label: 'Escalera con cantonera metálica',
    heelStart: 78,
    heelEnd: 33,
    heelDur: 0.082,
    heelGain: 0.188,
    heelWave: 'triangle',
    bodyFreq: 158,
    bodyEnd: 76,
    bodyGain: 0.096,
    bodyWave: 'triangle',
    clickFreq: 320,
    clickEnd: 148,
    clickGain: 0.078,
    clickDur: 0.030,
    scuffFreq: 440,
    scuffSprintFreq: 570,
    scuffQ: 1.3,
    scuffGain: 0.088,
    scuffDur: 0.058,
    metalFreq: 380,
    metalHarmonic: 575,
    metalGain: 0.068,
    metalDur: 0.078
  },
  landing: {
    id: 'landing',
    label: 'Entrepiso y baranda metálica',
    heelStart: 72,
    heelEnd: 30,
    heelDur: 0.086,
    heelGain: 0.192,
    heelWave: 'triangle',
    bodyFreq: 146,
    bodyEnd: 70,
    bodyGain: 0.098,
    bodyWave: 'sine',
    clickFreq: 290,
    clickEnd: 136,
    clickGain: 0.070,
    clickDur: 0.028,
    scuffFreq: 410,
    scuffSprintFreq: 530,
    scuffQ: 1.25,
    scuffGain: 0.084,
    scuffDur: 0.056,
    metalFreq: 310,
    metalHarmonic: 465,
    metalGain: 0.052,
    metalDur: 0.082
  }
};

export const DEBRIS_PROFILES = {
  glassShard: {
    id: 'glassShard',
    bandFreq: 980,
    bandQ: 1.6,
    noiseGain: 0.072,
    noiseDur: 0.062,
    pings: [680, 920]
  },
  paperSheet: {
    id: 'paperSheet',
    bandFreq: 640,
    bandQ: 1.2,
    noiseGain: 0.076,
    noiseDur: 0.078,
    rustleFreq: 460
  },
  woodSliver: {
    id: 'woodSliver',
    bandFreq: 480,
    bandQ: 1.4,
    noiseGain: 0.078,
    noiseDur: 0.058,
    snapFreq: 280
  },
  metalScrap: {
    id: 'metalScrap',
    bandFreq: 620,
    bandQ: 1.7,
    noiseGain: 0.070,
    noiseDur: 0.062,
    pings: [390, 580]
  },
  plasterSlab: {
    id: 'plasterSlab',
    bandFreq: 520,
    bandQ: 1.15,
    noiseGain: 0.084,
    noiseDur: 0.070,
    snapFreq: 165
  },
  rubbleChunk: {
    id: 'rubbleChunk',
    bandFreq: 460,
    bandQ: 1.1,
    noiseGain: 0.088,
    noiseDur: 0.074,
    snapFreq: 140
  },
  crumbCluster: {
    id: 'crumbCluster',
    bandFreq: 580,
    bandQ: 1.2,
    noiseGain: 0.074,
    noiseDur: 0.062
  }
};

export function detectFloorSurface(x = 0, z = 0, footY = 0, obstacles = [], debris = null) {
  let surface = 'tile';

  if (footY > 0.05) {
    let matchedSupport = null;
    if (Array.isArray(obstacles)) {
      for (const b of obstacles) {
        if (b.active === false || b.kind === 'segment' || b.bottom !== undefined || b.top === undefined) continue;
        if (Math.abs(footY - b.top) > 0.085) continue;
        if (x <= b.x0 - PLAYER_RADIUS || x >= b.x1 + PLAYER_RADIUS) continue;
        if (z <= b.z0 - PLAYER_RADIUS || z >= b.z1 + PLAYER_RADIUS) continue;
        if (!matchedSupport || b.top > matchedSupport.top) {
          matchedSupport = b;
        }
      }
    }

    if (matchedSupport?.surface && SURFACE_PROFILES[matchedSupport.surface]) {
      surface = matchedSupport.surface;
    } else if (matchedSupport && !matchedSupport.step && matchedSupport.top >= 0.35 && matchedSupport.top <= 0.90) {
      surface = 'wood';
    } else if (footY >= landing.top - 0.08) {
      surface = 'landing';
    } else if (
      !matchedSupport?.step &&
      footY >= 0.35 &&
      footY <= 0.85 &&
      ((x <= -hall.halfWidth + 0.85 && Math.abs(z - benchZ) <= 1.25) ||
        (x >= 3.0 && z >= annex.z0 && z <= annex.z1))
    ) {
      surface = 'wood';
    } else {
      surface = 'stairs';
    }
  } else if (Math.abs(x) > hall.halfWidth + 0.05) {
    let room = null;
    for (const r of rooms) {
      if (x >= r.x0 - 0.25 && x <= r.x1 + 0.25 && z >= r.z0 - 0.25 && z <= r.z1 + 0.25) {
        room = r;
        break;
      }
    }
    if (room) {
      if (room.kind === 'abandoned') surface = 'gravel';
      else if (room.kind === 'storage') surface = 'wood';
      else if (room.kind === 'computerLab' || room.kind === 'elecLab') surface = 'lab';
      else surface = 'linoleum';
    } else if (x < plaza.main.x1 - 0.05) {
      surface = 'concrete';
    } else if (z < hall.far - 0.04) {
      surface = 'concrete';
    }
  } else if (z < hall.far - 0.04) {
    surface = 'concrete';
  }

  let debrisKind = null;
  if (typeof debris?.sampleAt === 'function') {
    debrisKind = debris.sampleAt(x, z, footY);
  } else if (Array.isArray(debris)) {
    debrisKind = sampleDebrisAt(debris, debris.length, x, z, footY);
  } else if (Array.isArray(debris?.placements)) {
    debrisKind = sampleDebrisAt(debris.placements, debris.activePieces ?? debris.placements.length, x, z, footY);
  }

  return { surface, debris: debrisKind };
}

export function makePlayerAudio(sound = soundState, { AudioContext: CustomAudioCtx } = {}) {
  const AudioCtx = CustomAudioCtx || (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext));
  let ctx = null;
  let master = null;
  let breathGain = null;
  let breathBand = null;
  let breathLow = null;
  let noiseBuffer = null;
  let failed = false;
  let stepCount = 0;
  let lastEvent = null;
  let fearLevel = 0;
  let breathTelemetry = { gain: 0, freq: 0, q: 0, low: 0, fear: 0 };
  const events = [];

  function recordEvent(evt) {
    lastEvent = evt;
    events.push(evt);
    if (events.length > 64) events.shift();
  }

  function syncMasterGain() {
    if (!ctx || !master) return;
    try {
      master.gain.setTargetAtTime(BASE_MASTER_GAIN * sound.effectiveVolume, ctx.currentTime, 0.02);
    } catch { /* ignore */ }
  }

  sound.subscribe(syncMasterGain);

  function ensureContext() {
    if (failed || !AudioCtx) return false;
    if (!ctx) {
      try {
        ctx = new AudioCtx();
        master = ctx.createGain();
        master.gain.value = BASE_MASTER_GAIN * sound.effectiveVolume;
        master.connect(ctx.destination);

        // 2-second pink-ish noise buffer for organic breath, shoe scrape & debris crunch
        const sampleRate = ctx.sampleRate || 44100;
        const length = sampleRate * 2;
        noiseBuffer = ctx.createBuffer(1, length, sampleRate);
        const data = noiseBuffer.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < length; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.99765 * b0 + white * 0.099046;
          b1 = 0.96300 * b1 + white * 0.2965164;
          b2 = 0.57000 * b2 + white * 1.0526913;
          data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.22;
        }

        const source = ctx.createBufferSource();
        source.buffer = noiseBuffer;
        source.loop = true;

        const high = ctx.createBiquadFilter();
        high.type = 'highpass';
        high.frequency.value = 150;

        breathBand = ctx.createBiquadFilter();
        breathBand.type = 'bandpass';
        breathBand.frequency.value = 680;
        breathBand.Q.value = 1.35;

        breathLow = ctx.createBiquadFilter();
        breathLow.type = 'lowpass';
        breathLow.frequency.value = 2100;

        breathGain = ctx.createGain();
        breathGain.gain.value = 0;

        source.connect(high);
        high.connect(breathBand);
        breathBand.connect(breathLow);
        breathLow.connect(breathGain);
        breathGain.connect(master);
        source.start();
      } catch {
        failed = true;
        return false;
      }
    }
    if (ctx.state === 'suspended') {
      ctx.resume?.()?.catch?.(() => {});
    }
    return true;
  }

  function playTone(type, freqStart, freqEnd, startTime, duration, peakGain) {
    if (!ctx || !master || peakGain <= 0.0001) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freqStart), startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(18, freqEnd), startTime + duration);
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + Math.min(0.007, duration * 0.20));
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.008);
  }

  function playNoiseBurst(bandFreq, bandQ, startTime, duration, peakGain, freqEnd = null) {
    if (!ctx || !master || !noiseBuffer || peakGain <= 0.0001) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(Math.max(55, bandFreq), startTime);
    if (freqEnd && freqEnd !== bandFreq) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(55, freqEnd), startTime + duration);
    }
    filter.Q.value = bandQ;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + Math.min(0.007, duration * 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    const offset = ((stepCount * 0.27) % 1.4);
    src.start(startTime, offset, duration + 0.01);
  }

  function playWoodCreak(startTime, baseFreq, peakGain, duration = 0.105) {
    if (!ctx || !master || peakGain <= 0.0001) return;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(baseFreq * 0.90, startTime);
    osc.frequency.linearRampToValueAtTime(baseFreq * 1.08, startTime + duration * 0.45);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.82, startTime + duration);
    filter.type = 'bandpass';
    filter.frequency.value = baseFreq * 1.45;
    filter.Q.value = 3.6;
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + duration * 0.28);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.01);
  }

  function triggerDebris(debrisKind, intensity = 1, timeOffset = 0) {
    const profile = DEBRIS_PROFILES[debrisKind];
    if (!profile || !ctx || !master) return;
    const now = ctx.currentTime + timeOffset;
    const scale = clamp(intensity, 0.35, 1.5);

    playNoiseBurst(profile.bandFreq, profile.bandQ, now + 0.004, profile.noiseDur, profile.noiseGain * scale);
    if (profile.rustleFreq) {
      playNoiseBurst(profile.rustleFreq, 1.3, now + 0.022, profile.noiseDur * 0.85, profile.noiseGain * 0.82 * scale);
    }
    if (profile.snapFreq) {
      playTone('triangle', profile.snapFreq * 1.1, profile.snapFreq * 0.45, now + 0.003, 0.042, 0.068 * scale);
    }
    if (profile.pings) {
      profile.pings.forEach((freq, idx) => {
        const at = now + 0.005 + idx * 0.014;
        playTone('triangle', freq, freq * 0.68, at, 0.045, 0.046 * scale);
      });
    }
  }

  function triggerGasp() {
    if (sound.effectiveVolume <= 0) return;
    recordEvent({ type: 'gasp' });
    if (!ensureContext() || !noiseBuffer) return;
    try {
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(920, now);
      filter.frequency.exponentialRampToValueAtTime(410, now + 0.48);
      filter.Q.value = 1.95;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.54, now + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.56);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start(now);
      src.stop(now + 0.6);
    } catch { /* ignore audio errors */ }
  }

  // The gloves clamp on: a sharp intake gasp, then a strained human cry that
  // pitches up in terror and chokes down into a ragged exhale. Pure fear, no gore.
  function triggerCaptureScream() {
    if (sound.effectiveVolume <= 0) return;
    recordEvent({ type: 'captureScream' });
    if (!ensureContext() || !noiseBuffer) return;
    try {
      const now = ctx.currentTime;
      const start = now + .06, cryEnd = now + 1.18;

      // 1. Sharp intake gasp through a tightening throat.
      const gasp = ctx.createBufferSource();
      gasp.buffer = noiseBuffer;
      const gaspBand = ctx.createBiquadFilter();
      gaspBand.type = 'bandpass';
      gaspBand.frequency.setValueAtTime(950, now);
      gaspBand.frequency.exponentialRampToValueAtTime(620, now + .09);
      gaspBand.Q.value = 1.7;
      const gaspGain = ctx.createGain();
      gaspGain.gain.setValueAtTime(0.0001, now);
      gaspGain.gain.linearRampToValueAtTime(0.30, now + 0.022);
      gaspGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      gasp.connect(gaspBand);
      gaspBand.connect(gaspGain);
      gaspGain.connect(master);
      gasp.start(now);
      gasp.stop(now + .14);

      // 2. The cry itself: sawtooth body plus a triangle edge.
      const sum = ctx.createGain();
      sum.gain.value = 1;

      const cry = ctx.createOscillator();
      cry.type = 'sawtooth';
      cry.frequency.setValueAtTime(235, start);
      cry.frequency.exponentialRampToValueAtTime(385, start + .18);
      cry.frequency.exponentialRampToValueAtTime(310, start + .58);
      cry.frequency.exponentialRampToValueAtTime(175, start + 1.04);
      const cryGain = ctx.createGain();
      cryGain.gain.value = .52;
      cry.connect(cryGain);
      cryGain.connect(sum);

      const edge = ctx.createOscillator();
      edge.type = 'triangle';
      edge.frequency.setValueAtTime(237.5, start);
      edge.frequency.exponentialRampToValueAtTime(388, start + .18);
      edge.frequency.exponentialRampToValueAtTime(312, start + .58);
      edge.frequency.exponentialRampToValueAtTime(177, start + 1.04);
      const edgeGain = ctx.createGain();
      edgeGain.gain.value = .26;
      edge.connect(edgeGain);
      edgeGain.connect(sum);

      // Nervous vibrato: the tremble of a person who cannot catch their breath.
      const vibrato = ctx.createOscillator();
      vibrato.type = 'sine';
      vibrato.frequency.setValueAtTime(7.2, start);
      const vibratoDepth = ctx.createGain();
      vibratoDepth.gain.value = 16;
      vibrato.connect(vibratoDepth);
      vibratoDepth.connect(cry.frequency);
      vibratoDepth.connect(edge.frequency);

      // Two vocal formants: chest/mouth body then a forward, frightened edge.
      const out = ctx.createGain();
      const f1 = ctx.createBiquadFilter();
      f1.type = 'bandpass';
      f1.frequency.value = 760;
      f1.Q.value = 2.4;
      const f1Gain = ctx.createGain();
      f1Gain.gain.value = .52;
      sum.connect(f1);
      f1.connect(f1Gain);
      f1Gain.connect(out);

      const f2 = ctx.createBiquadFilter();
      f2.type = 'bandpass';
      f2.frequency.value = 1520;
      f2.Q.value = 2.8;
      const f2Gain = ctx.createGain();
      f2Gain.gain.value = .26;
      sum.connect(f2);
      f2.connect(f2Gain);
      f2Gain.connect(out);

      // Ragged breath tearing through the cry.
      const breath = ctx.createBufferSource();
      breath.buffer = noiseBuffer;
      breath.loop = true;
      const breathBand = ctx.createBiquadFilter();
      breathBand.type = 'bandpass';
      breathBand.frequency.value = 1100;
      breathBand.Q.value = 1.4;
      const breathGain = ctx.createGain();
      breathGain.gain.setValueAtTime(0.0001, start);
      breathGain.gain.linearRampToValueAtTime(.11, start + .12);
      breathGain.gain.linearRampToValueAtTime(.07, start + .6);
      breathGain.gain.exponentialRampToValueAtTime(0.0001, cryEnd);
      breath.connect(breathBand);
      breathBand.connect(breathGain);
      breathGain.connect(out);

      // Choked exhale as the throat closes.
      const exhale = ctx.createBufferSource();
      exhale.buffer = noiseBuffer;
      const exhaleBand = ctx.createBiquadFilter();
      exhaleBand.type = 'bandpass';
      exhaleBand.frequency.setValueAtTime(700, now + 1.0);
      exhaleBand.frequency.exponentialRampToValueAtTime(420, now + 1.24);
      exhaleBand.Q.value = 1.55;
      const exhaleGain = ctx.createGain();
      exhaleGain.gain.setValueAtTime(0.0001, now + 1.0);
      exhaleGain.gain.linearRampToValueAtTime(.16, now + 1.06);
      exhaleGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.26);
      exhale.connect(exhaleBand);
      exhaleBand.connect(exhaleGain);
      exhaleGain.connect(master);
      exhale.start(now + 1.0);
      exhale.stop(now + 1.28);

      out.connect(master);

      // The terror peaks early, sags, swells once more and chokes away.
      out.gain.setValueAtTime(0.0001, start);
      out.gain.linearRampToValueAtTime(.46, start + .1);
      out.gain.linearRampToValueAtTime(.36, start + .34);
      out.gain.linearRampToValueAtTime(.44, start + .52);
      out.gain.linearRampToValueAtTime(.2, start + .88);
      out.gain.exponentialRampToValueAtTime(0.0001, now + 1.22);

      cry.start(start); cry.stop(now + 1.24);
      edge.start(start); edge.stop(now + 1.24);
      vibrato.start(start); vibrato.stop(now + 1.22);
      breath.start(start);
      breath.stop(now + 1.22);
    } catch { /* ignore audio errors */ }
  }

  function triggerStep(intensity = 0.75, isSprinting = false, options = {}) {
    if (sound.effectiveVolume <= 0) return;
    const opts = typeof isSprinting === 'object' && isSprinting !== null
      ? isSprinting
      : { isSprinting: Boolean(isSprinting), ...options };
    const sprinting = Boolean(opts.isSprinting);
    const crouching = Boolean(opts.isCrouching);
    const surfaceId = SURFACE_PROFILES[opts.surface] ? opts.surface : 'tile';
    const debrisKind = DEBRIS_PROFILES[opts.debris] ? opts.debris : null;
    const profile = SURFACE_PROFILES[surfaceId];

    stepCount++;
    const footSide = stepCount % 2 === 0 ? 'right' : 'left';
    const parity = stepCount % 2 === 0 ? 1 : -1;
    const level = clamp(intensity, 0.35, 1.3);

    recordEvent({
      type: 'step',
      surface: surfaceId,
      debris: debrisKind,
      isSprinting: sprinting,
      isCrouching: crouching,
      intensity: level,
      footSide
    });

    if (!ensureContext() || !noiseBuffer) return;
    try {
      const now = ctx.currentTime + (opts.timeOffset || 0);
      const pitchShift = (1 + parity * 0.032) * (sprinting ? 1.09 : crouching ? 0.86 : 1.0);
      const modeScale = sprinting ? 1.55 : crouching ? 0.52 : 1.12;
      const gainScale = level * modeScale;

      // 1. Deep heel strike fundamental thud
      playTone(
        profile.heelWave,
        profile.heelStart * pitchShift,
        profile.heelEnd * pitchShift,
        now,
        profile.heelDur * (sprinting ? 0.95 : crouching ? 1.15 : 1.0),
        profile.heelGain * gainScale
      );

      // 2. Warm low-mid floor resonance / body formant
      playTone(
        profile.bodyWave,
        profile.bodyFreq * pitchShift,
        profile.bodyEnd * pitchShift,
        now + 0.002,
        profile.heelDur * 1.12,
        profile.bodyGain * gainScale
      );

      // 3. Low-mid sole attack (no high-pitched click; suppressed when crouch-walking)
      if (!crouching) {
        playTone(
          'triangle',
          profile.clickFreq * pitchShift,
          profile.clickEnd * pitchShift,
          now,
          profile.clickDur,
          profile.clickGain * gainScale * (sprinting ? 1.2 : 0.95)
        );
      }

      // 4. Forefoot / toe settle & warm low-mid sole brush
      const toeDelay = sprinting ? 0.017 : crouching ? 0.035 : 0.027;
      const scuffFreq = (sprinting ? profile.scuffSprintFreq : profile.scuffFreq) * (1 + parity * 0.035);
      playNoiseBurst(
        scuffFreq,
        profile.scuffQ,
        now + toeDelay,
        profile.scuffDur * (sprinting ? 1.18 : 1.05),
        profile.scuffGain * gainScale
      );
      playTone(
        profile.heelWave,
        profile.heelStart * 0.82 * pitchShift,
        profile.heelEnd * 0.92 * pitchShift,
        now + toeDelay,
        profile.heelDur * 0.78,
        profile.heelGain * 0.62 * gainScale
      );

      // 5. Surface-specific character layers (kept in warm low-mid register)
      if (profile.metalFreq) {
        const metalScale = gainScale * (sprinting ? 1.25 : 0.95);
        playTone('triangle', profile.metalFreq * pitchShift, profile.metalFreq * 0.62, now + 0.004, profile.metalDur, profile.metalGain * metalScale);
        if (profile.metalHarmonic) {
          playTone('sine', profile.metalHarmonic * pitchShift, profile.metalHarmonic * 0.68, now + 0.007, profile.metalDur * 0.8, profile.metalGain * 0.65 * metalScale);
        }
      }

      if (profile.creakFreq && (sprinting || level > 0.50)) {
        playWoodCreak(now + 0.015, profile.creakFreq * (1 + parity * 0.04), profile.creakGain * gainScale, sprinting ? 0.095 : 0.115);
      }

      if (profile.crunchGrains) {
        const grains = sprinting ? profile.crunchGrains + 1 : profile.crunchGrains;
        for (let g = 0; g < grains; g++) {
          const grainAt = now + 0.006 + g * 0.016;
          const grainFreq = profile.gritFreq * (0.84 + ((stepCount + g) % 3) * 0.12);
          playNoiseBurst(grainFreq, 1.35, grainAt, 0.032, profile.gritGain * gainScale * (1 - g * 0.16));
        }
      } else if (profile.gritFreq) {
        playNoiseBurst(profile.gritFreq, 1.3, now + 0.012, 0.038, profile.gritGain * gainScale);
      }

      if (sprinting) {
        // Warm low-mid clothing / shoe friction during sprint stride
        playNoiseBurst(360, 1.15, now + 0.01, 0.060, 0.032 * level);
      }

      // 6. Localized floor debris crunch / rustle
      if (debrisKind) {
        triggerDebris(debrisKind, gainScale, 0.005);
      }
    } catch { /* ignore audio errors */ }
  }

  function triggerJump(surface = 'tile', debris = null) {
    if (sound.effectiveVolume <= 0) return;
    const surfaceId = SURFACE_PROFILES[surface] ? surface : 'tile';
    const debrisKind = DEBRIS_PROFILES[debris] ? debris : null;
    const profile = SURFACE_PROFILES[surfaceId];

    recordEvent({ type: 'jump', surface: surfaceId, debris: debrisKind });
    if (!ensureContext() || !noiseBuffer) return;
    try {
      const now = ctx.currentTime;
      triggerStep(0.92, false, { surface: surfaceId, debris: debrisKind });
      playNoiseBurst(340, 1.2, now + 0.015, 0.090, 0.055, 520);
      if (profile.creakFreq) {
        playWoodCreak(now + 0.01, profile.creakFreq * 1.04, profile.creakGain * 1.25, 0.095);
      }
    } catch { /* ignore audio errors */ }
  }

  function triggerLand(heavy = false, surface = 'tile', debris = null) {
    if (sound.effectiveVolume <= 0) return;
    const surfaceId = SURFACE_PROFILES[surface] ? surface : 'tile';
    const debrisKind = DEBRIS_PROFILES[debris] ? debris : null;
    const profile = SURFACE_PROFILES[surfaceId];

    recordEvent({ type: 'land', heavy: Boolean(heavy), surface: surfaceId, debris: debrisKind });
    if (!ensureContext() || !noiseBuffer) return;
    try {
      const now = ctx.currentTime;
      const impactScale = heavy ? 1.65 : 1.18;

      // Dual-foot touchdown
      triggerStep(heavy ? 1.25 : 0.98, true, { surface: surfaceId, debris: debrisKind, timeOffset: 0 });
      triggerStep(heavy ? 1.12 : 0.88, false, { surface: surfaceId, debris: debrisKind, timeOffset: heavy ? 0.028 : 0.018 });

      // Deep sub-bass floor impact thump
      playTone(
        profile.heelWave,
        profile.heelStart * (heavy ? 0.82 : 0.94),
        Math.max(22, profile.heelEnd * 0.72),
        now,
        heavy ? 0.145 : 0.095,
        (heavy ? 0.30 : 0.18) * (profile.heelGain / 0.165)
      );

      if (profile.creakFreq) {
        playWoodCreak(now + 0.02, profile.creakFreq * 0.92, profile.creakGain * 1.6 * impactScale, 0.145);
      }

      if (profile.metalFreq) {
        playTone('triangle', profile.metalFreq * 0.95, profile.metalFreq * 0.58, now + 0.006, 0.115, profile.metalGain * 1.45 * impactScale);
      }

      if (heavy) {
        triggerStep(0.82, false, { surface: surfaceId, debris: debrisKind, timeOffset: 0.14 });

        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(520, now);
        filter.frequency.exponentialRampToValueAtTime(280, now + 0.28);
        filter.Q.value = 1.75;

        const grunt = ctx.createGain();
        grunt.gain.setValueAtTime(0.0001, now);
        grunt.gain.linearRampToValueAtTime(0.42, now + 0.035);
        grunt.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);

        src.connect(filter);
        filter.connect(grunt);
        grunt.connect(master);
        src.start(now);
        src.stop(now + 0.34);
      }
    } catch { /* ignore audio errors */ }
  }

  function triggerScuff(surface = 'tile', debris = null, intensity = 0.85) {
    if (sound.effectiveVolume <= 0) return;
    const surfaceId = SURFACE_PROFILES[surface] ? surface : 'tile';
    const debrisKind = DEBRIS_PROFILES[debris] ? debris : null;
    const profile = SURFACE_PROFILES[surfaceId];
    const level = clamp(intensity, 0.4, 1.25);

    recordEvent({ type: 'scuff', surface: surfaceId, debris: debrisKind, intensity: level });
    if (!ensureContext() || !noiseBuffer) return;
    try {
      const now = ctx.currentTime;
      // Low-mid shoe sole drag & weight transfer thud
      playNoiseBurst(
        profile.scuffSprintFreq,
        profile.scuffQ,
        now,
        0.115,
        profile.scuffGain * 1.45 * level,
        profile.scuffFreq * 0.78
      );
      playTone(
        profile.heelWave,
        profile.heelStart * 0.92,
        profile.heelEnd * 0.88,
        now,
        0.070,
        profile.heelGain * 0.75 * level
      );
      if (profile.creakFreq) {
        playWoodCreak(now + 0.01, profile.creakFreq, profile.creakGain * 1.15 * level, 0.105);
      }
      if (profile.metalFreq) {
        playTone('triangle', profile.metalFreq, profile.metalFreq * 0.65, now + 0.005, 0.065, profile.metalGain * level);
      }
      if (debrisKind) {
        triggerDebris(debrisKind, level, 0.004);
      }
    } catch { /* ignore audio errors */ }
  }

  function triggerCrouch(crouching = true, surface = 'tile') {
    if (sound.effectiveVolume <= 0) return;
    const surfaceId = SURFACE_PROFILES[surface] ? surface : 'tile';
    const profile = SURFACE_PROFILES[surfaceId];

    recordEvent({ type: 'crouch', crouching: Boolean(crouching), surface: surfaceId });
    if (!ensureContext() || !noiseBuffer) return;
    try {
      const now = ctx.currentTime;
      playNoiseBurst(crouching ? 440 : 320, 1.25, now, 0.088, 0.042, crouching ? 290 : 480);
      playNoiseBurst(profile.scuffFreq, profile.scuffQ, now + 0.015, 0.042, profile.scuffGain * 0.65);
      if (profile.creakFreq) {
        playWoodCreak(now + 0.012, profile.creakFreq * 0.92, profile.creakGain * 0.75, 0.080);
      }
    } catch { /* ignore audio errors */ }
  }

  function update({
    breathPhase = 0,
    exertion = 0,
    exhausted = false,
    justExhausted = false,
    fear = 0,
    justTerrified = false,
    stepEvent = 0,
    isSprinting = false,
    isCrouching = false,
    justJumped = false,
    justLanded = false,
    landedHeavy = false,
    scuffEvent = 0,
    crouchChanged = false,
    surface = 'tile',
    debris = null,
    active = false
  } = {}) {
    if (!active || sound.effectiveVolume <= 0) {
      silence();
      return;
    }

    if (justExhausted) triggerGasp();
    // Spotting the monster up close rips a frightened gasp out of the player.
    if (justTerrified) triggerGasp();
    if (crouchChanged) triggerCrouch(isCrouching, surface);
    if (justJumped) triggerJump(surface, debris);
    if (justLanded) triggerLand(landedHeavy, surface, debris);
    if (scuffEvent > 0 && !justJumped && !justLanded) triggerScuff(surface, debris, scuffEvent);
    if (stepEvent > 0 && !justJumped && !justLanded) {
      triggerStep(stepEvent, isSprinting, { isCrouching, surface, debris });
    }

    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume?.()?.catch?.(() => {});

    const now = ctx.currentTime;
    const wave = Math.sin(breathPhase);
    const isInhale = wave >= 0;
    const env = isInhale ? Math.pow(wave, 0.68) : Math.pow(-wave, 1.25) * 0.92;

    fearLevel = clamp(Number.isFinite(fear) ? fear : 0, 0, 1);
    const scared = fearLevel > 0.02;
    // Shaky, hyperventilating quiver even while standing perfectly still.
    const quiver = 1 + 0.28 * fearLevel * Math.sin(breathPhase * 6.0);

    let baseLevel = exhausted
      ? 0.58
      : 0.045 + exertion * 0.34;
    if (scared) baseLevel = Math.max(baseLevel, 0.08 + fearLevel * 0.48);
    const targetGain = baseLevel * env * quiver;
    const baseFreq = isInhale ? (exhausted ? 1050 : 890) : (exhausted ? 500 : 590);
    const fearFreqLift = 1 + fearLevel * (isInhale ? 0.18 : 0.12);
    const targetFreq = baseFreq * fearFreqLift * quiver;
    const targetQ = (exhausted ? 2.1 : 1.5) + fearLevel * 0.85;
    const targetLow = (exhausted ? 2900 : 2350) + fearLevel * 420;

    breathTelemetry = { gain: targetGain, freq: targetFreq, q: targetQ, low: targetLow, fear: fearLevel };

    breathGain.gain.setTargetAtTime(targetGain, now, scared ? 0.018 : 0.03);
    breathBand.frequency.setTargetAtTime(targetFreq, now, scared ? 0.022 : 0.04);
    breathBand.Q.setTargetAtTime(targetQ, now, 0.05);
    breathLow.frequency.setTargetAtTime(targetLow, now, 0.05);
  }

  function silence() {
    if (!ctx || !breathGain) return;
    try {
      breathGain.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
    } catch { /* ignore */ }
  }

  return {
    unlock: ensureContext,
    update,
    silence,
    triggerStep,
    triggerJump,
    triggerLand,
    triggerScuff,
    triggerCrouch,
    triggerGasp,
    triggerCaptureScream,
    get lastEvent() { return lastEvent; },
    get events() { return events; },
    get fear() { return fearLevel; },
    get breath() { return breathTelemetry; }
  };
}
