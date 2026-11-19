import { soundState } from './sound.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function makeGameplayAudio(sound = soundState, { AudioContext: CustomAudioCtx } = {}) {
  const AudioCtx = CustomAudioCtx || (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext));
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let droneGain = null;
  let droneOsc = null;
  let failed = false;
  let beatTimer = 0;

  function syncMaster() {
    if (!ctx || !master) return;
    try {
      master.gain.setTargetAtTime(sound.effectiveVolume, ctx.currentTime, 0.02);
    } catch { /* ignore */ }
  }

  sound.subscribe(syncMaster);

  function ensure() {
    if (failed || !AudioCtx) return null;
    if (!ctx) {
      try {
        ctx = new AudioCtx();
        master = ctx.createGain();
        master.gain.value = sound.effectiveVolume;
        master.connect(ctx.destination);

        if (typeof ctx.createBuffer === 'function') {
          const sr = ctx.sampleRate || 44100;
          const len = Math.floor(sr * 0.5);
          noiseBuffer = ctx.createBuffer(1, len, sr);
          const d = noiseBuffer.getChannelData(0);
          for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        }

        droneOsc = ctx.createOscillator();
        droneOsc.type = 'sawtooth';
        droneOsc.frequency.value = 46;
        const droneFilter = ctx.createBiquadFilter();
        droneFilter.type = 'lowpass';
        droneFilter.frequency.value = 110;
        droneGain = ctx.createGain();
        droneGain.gain.value = 0;
        droneOsc.connect(droneFilter);
        droneFilter.connect(droneGain);
        droneGain.connect(master);
        droneOsc.start();
      } catch {
        failed = true;
        return null;
      }
    }
    if (ctx.state === 'suspended') ctx.resume?.()?.catch?.(() => {});
    return ctx;
  }

  function tone(type, f0, f1, dur, gainPeak, delay = 0, pan = 0) {
    if (sound.effectiveVolume <= 0) return;
    const c = ensure();
    if (!c || !master) return;
    const t = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, f0), t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(18, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gainPeak, t + Math.min(0.015, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (Math.abs(pan) > 0.02 && typeof c.createStereoPanner === 'function') {
      const p = c.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      osc.connect(g); g.connect(p); p.connect(master);
    } else {
      osc.connect(g); g.connect(master);
    }
    osc.start(t);
    osc.stop(t + dur + 0.01);
  }

  function noise(freq, q, dur, gainPeak, delay = 0) {
    if (sound.effectiveVolume <= 0) return;
    const c = ensure();
    if (!c || !master || !noiseBuffer) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gainPeak, t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.01);
  }

  function playPickup(category = 'tool') {
    if (category === 'key') {
      tone('triangle', 520, 780, 0.14, 0.08, 0);
      tone('sine', 780, 1040, 0.20, 0.06, 0.08);
    } else if (category === 'lore') {
      tone('sine', 420, 390, 0.12, 0.07, 0);
      tone('triangle', 630, 590, 0.22, 0.05, 0.09);
      tone('sine', 840, 810, 0.35, 0.04, 0.18);
    } else {
      tone('triangle', 460, 690, 0.11, 0.07, 0);
    }
  }

  function playEquip() {
    tone('triangle', 320, 440, 0.045, 0.03);
  }

  function playEnergy() {
    tone('square', 1100, 360, 0.05, 0.05, 0);
    noise(2400, 1.8, 0.22, 0.05, 0.04);
    tone('sine', 240, 680, 0.36, 0.07, 0.10);
  }

  function playHolster() {
    noise(760, 1.2, 0.06, 0.025, 0);
    tone('triangle', 280, 190, 0.07, 0.026, 0.01);
  }

  function playRoidSpray(hit = false) {
    noise(3200, 0.85, 0.4, 0.075, 0);
    noise(1500, 0.7, 0.5, 0.04, 0.05);
    if (hit) {
      tone('sine', 940, 260, 0.34, 0.045, 0.12);
      tone('triangle', 220, 130, 0.24, 0.035, 0.2);
    }
  }

  function playFlash() {
    tone('sine', 1800, 2900, 0.06, 0.09, 0);
    noise(1900, 0.9, 0.16, 0.13, 0.02);
    tone('triangle', 980, 180, 0.28, 0.07, 0.03);
  }

  function playLockInstall(kind) {
    if (kind === 'fuse') {
      tone('sawtooth', 120, 240, 0.24, 0.07, 0);
      tone('sine', 880, 1320, 0.16, 0.06, 0.12);
    } else if (kind === 'masterKey') {
      tone('square', 720, 420, 0.05, 0.06, 0);
      tone('triangle', 540, 960, 0.14, 0.07, 0.09);
    } else {
      tone('square', 460, 140, 0.08, 0.09, 0);
      tone('triangle', 1240, 620, 0.18, 0.06, 0.05);
      noise(1600, 2.2, 0.12, 0.07, 0.03);
    }
  }

  function playGateOpen() {
    tone('sawtooth', 95, 58, 0.85, 0.09, 0);
    tone('triangle', 150, 92, 0.90, 0.07, 0.05);
    noise(380, 1.4, 0.65, 0.06, 0.06);
  }

  function playPointOfNoReturn() {
    noise(1400, 0.8, 0.45, 0.16, 0);
    tone('sawtooth', 160, 34, 1.25, 0.16, 0.02);
    tone('square', 440, 210, 0.65, 0.08, 0.12);
    tone('sawtooth', 92, 54, 1.6, 0.12, 0.35);
  }

  function playThreatRise(stage) {
    if (stage === 3) { playPointOfNoReturn(); return; }
    const notes = stage === 1 ? [220, 277] : [220, 277, 349];
    notes.forEach((f, i) => tone('triangle', f, f * .98, .26, .09, i * .22));
  }

  function playWallSmash(level = 0.85, pan = 0) {
    const amt = clamp(level, 0.15, 1);
    tone('triangle', 125, 28, 0.34, 0.19 * amt, 0, pan);
    noise(420, 0.85, 0.38, 0.16 * amt, 0);
    noise(1150, 1.4, 0.24, 0.10 * amt, 0.04);
  }

  function playTimeoutLockdown() {
    tone('sawtooth', 196, 98, 1.5, 0.13, 0);
    tone('sine', 98, 32, 2.1, 0.16, 0.05);
    noise(280, 0.9, 0.9, 0.12, 0.1);
  }

  function playVictory(complete = false) {
    const notes = complete ? [261.6, 329.6, 392.0, 493.9, 587.3] : [220.0, 261.6, 329.6, 392.0];
    notes.forEach((f, i) => {
      tone('triangle', f, f * 1.003, 1.6, 0.055, i * 0.14);
    });
  }

  function updateAmbience(dt, { active = false, fear = 0, escalation = 0, frenzy = false } = {}) {
    if (!ctx || !master || !droneGain) return;
    if (!active || sound.effectiveVolume <= 0) {
      droneGain.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
      return;
    }
    const tension = clamp(Math.max(fear * 0.85, escalation * 0.65, frenzy ? 0.92 : 0), 0, 1);
    const droneLevel = 0.014 + tension * 0.042;
    droneGain.gain.setTargetAtTime(droneLevel, ctx.currentTime, 0.12);
    if (droneOsc) {
      droneOsc.frequency.setTargetAtTime(42 + tension * 18, ctx.currentTime, 0.15);
    }

    if (tension > 0.25) {
      const interval = lerpInterval(1.15, 0.46, tension);
      beatTimer -= Math.max(0, dt || 0);
      if (beatTimer <= 0) {
        beatTimer = interval;
        const beatGain = 0.045 * tension;
        tone('sine', 64, 34, 0.11, beatGain, 0);
        tone('sine', 56, 30, 0.10, beatGain * 0.7, 0.14);
      }
    } else {
      beatTimer = 0.2;
    }
  }

  function silence() {
    if (!ctx || !droneGain) return;
    try {
      droneGain.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
    } catch { /* ignore */ }
  }

  return {
    unlock: ensure,
    playPickup,
    playEquip,
    playHolster,
    playEnergy,
    playRoidSpray,
    playFlash,
    playLockInstall,
    playGateOpen,
    playPointOfNoReturn,
    playThreatRise,
    playWallSmash,
    playTimeoutLockdown,
    playVictory,
    updateAmbience,
    silence
  };
}

function lerpInterval(a, b, t) {
  return a + (b - a) * clamp(t, 0, 1);
}
