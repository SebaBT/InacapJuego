// La Veladora's voice. A sub-bass chest carries the vowel, a loose saw throat
// supplies the growl, and low-passed breath glues the layers together. Every
// band stays below the whistle range so a phone speaker feels weight, not a
// shriek, and both calls share one gentle ceiling.
const MIN = .0001;
const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

export function makeMonsterVoice(ctx, master, noise) {
  const active = new Set();
  const curves = new Map();
  let output = master;

  function saturationCurve(drive) {
    if (typeof ctx.createWaveShaper !== 'function') return null;
    const cached = curves.get(drive);
    if (cached) return cached;
    const count = 2048, curve = new Float32Array(count), norm = Math.tanh(drive);
    for (let i = 0; i < count; i++) {
      const x = i / (count - 1) * 2 - 1;
      curve[i] = Math.tanh(x * drive) / norm;
    }
    curves.set(drive, curve);
    return curve;
  }

  // A shared soft ceiling lets a footfall and a roar overlap without clipping,
  // while a distant call stays below the threshold and keeps its level.
  if (typeof ctx.createDynamicsCompressor === 'function') {
    try {
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.knee.value = 12;
      limiter.ratio.value = 3;
      limiter.attack.value = .003;
      limiter.release.value = .18;
      limiter.connect(master);
      output = limiter;
    } catch { /* keep the dry path when the host has no compressor */ }
  }

  function voice(pan) {
    const gain = ctx.createGain();
    const nodes = [gain], sources = [];
    const panner = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = clamp(pan, -1, 1);
      gain.connect(panner);
      panner.connect(output);
      nodes.push(panner);
    } else gain.connect(output);
    const bus = { gain, nodes, sources, done: false };
    active.add(bus);
    bus.track = node => (nodes.push(node), node);
    bus.source = node => (nodes.push(node), sources.push(node), node);
    bus.finish = () => {
      if (bus.done) return;
      bus.done = true;
      active.delete(bus);
      for (const node of nodes) {
        try { node.disconnect(); } catch { /* already released */ }
      }
    };
    return bus;
  }

  function setSweep(param, points, t) {
    param.setValueAtTime(Math.max(20, points[0][1]), t);
    for (let i = 1; i < points.length; i++) {
      param.exponentialRampToValueAtTime(Math.max(20, points[i][1]), t + points[i][0]);
    }
  }

  // The weight of the suit landing: four low layers (a sub drop, a body
  // knock, a long seismic tail and a filtered sole) rather than a click with
  // no mass. The floor should feel like it moves under the player.
  function stomp(level, pan) {
    const amount = clamp(level, 0, 1);
    const t = ctx.currentTime + .002;
    const bus = voice(pan);
    const wobble = .94 + Math.random() * .12;

    // Heavy body punch: the whole mass arrives at once and drops fast.
    const weight = bus.source(ctx.createOscillator());
    weight.type = 'sine';
    weight.frequency.setValueAtTime(108 * wobble, t);
    weight.frequency.exponentialRampToValueAtTime(28, t + .26);
    const weightGain = bus.track(ctx.createGain());
    weightGain.gain.value = .72;
    weight.connect(weightGain);
    weightGain.connect(bus.gain);

    // Deep sub-bass drop under the punch.
    const sub = bus.source(ctx.createOscillator());
    sub.type = 'sine';
    sub.frequency.setValueAtTime(62 * wobble, t);
    sub.frequency.exponentialRampToValueAtTime(21, t + .34);
    const subGain = bus.track(ctx.createGain());
    subGain.gain.value = .44;
    sub.connect(subGain);
    subGain.connect(bus.gain);

    const knock = bus.source(ctx.createOscillator());
    knock.type = 'triangle';
    knock.frequency.setValueAtTime(196 * wobble, t);
    knock.frequency.exponentialRampToValueAtTime(58, t + .19);
    const knockFilter = bus.track(ctx.createBiquadFilter());
    knockFilter.type = 'lowpass';
    knockFilter.frequency.value = 700;
    knockFilter.Q.value = .6;
    const knockGain = bus.track(ctx.createGain());
    knockGain.gain.value = .42;
    knock.connect(knockFilter);
    knockFilter.connect(knockGain);
    knockGain.connect(bus.gain);

    // The seismic tail keeps rolling through the slab after the foot lands.
    const tail = bus.source(ctx.createOscillator());
    tail.type = 'sine';
    tail.frequency.setValueAtTime(44 * wobble, t + .02);
    tail.frequency.exponentialRampToValueAtTime(19, t + .40);
    const tailFilter = bus.track(ctx.createBiquadFilter());
    tailFilter.type = 'lowpass';
    tailFilter.frequency.value = 380;
    tailFilter.Q.value = .55;
    const tailGain = bus.track(ctx.createGain());
    tailGain.gain.value = .18;
    tail.connect(tailFilter);
    tailFilter.connect(tailGain);
    tailGain.connect(bus.gain);

    if (noise) {
      const sole = bus.source(ctx.createBufferSource());
      sole.buffer = noise;
      const tile = bus.track(ctx.createBiquadFilter());
      tile.type = 'bandpass';
      tile.frequency.setValueAtTime(225, t);
      tile.Q.value = .7;
      const soleBody = bus.track(ctx.createBiquadFilter());
      soleBody.type = 'lowpass';
      soleBody.frequency.value = 700;
      soleBody.Q.value = .5;
      const soleGain = bus.track(ctx.createGain());
      soleGain.gain.value = .55;
      sole.connect(tile);
      tile.connect(soleBody);
      soleBody.connect(soleGain);
      soleGain.connect(bus.gain);
      sole.start(t, .02, .12);
    }

    const peak = .48 * amount;
    bus.gain.gain.setValueAtTime(MIN, t);
    bus.gain.gain.linearRampToValueAtTime(peak, t + .014);
    bus.gain.gain.linearRampToValueAtTime(peak * .7, t + .08);
    bus.gain.gain.exponentialRampToValueAtTime(MIN, t + .42);

    weight.start(t); weight.stop(t + .30);
    sub.start(t); sub.stop(t + .38);
    knock.start(t); knock.stop(t + .22);
    tail.start(t + .02); tail.stop(t + .44); tail.onended = bus.finish;
  }

  // `alert` is the carrying call heard across the corridor: slower, cleaner
  // and a little shorter. `capture` is the close roar: wider vowel, harder
  // saturation, a downward plunge and a ragged second swell.
  function scream(kind, level, pan) {
    const close = kind === 'capture';
    const amount = clamp(level, 0, 1);
    const t = ctx.currentTime + .008;
    const duration = close ? 2.05 : 1.42;
    const end = t + duration;
    const bus = voice(pan);
    const variation = .97 + Math.random() * .06;

    const sum = bus.track(ctx.createGain());
    sum.gain.value = 1;
    const dry = bus.track(ctx.createGain());
    dry.gain.value = close ? .42 : .52;
    const pre = bus.track(ctx.createGain());
    pre.gain.value = close ? 1.02 : .96;
    sum.connect(dry);
    dry.connect(pre);

    // A broad chest EQ keeps the audible low-mid present on a phone speaker.
    // It is wide enough to read as body, not as a resonant pitch.
    const chestEq = bus.track(ctx.createBiquadFilter());
    chestEq.type = 'peaking';
    chestEq.frequency.value = close ? 380 : 420;
    chestEq.Q.value = .8;
    if (chestEq.gain) chestEq.gain.value = close ? 5 : 3;
    pre.connect(chestEq);

    // False-cord distortion before the formants: it fills the chest and
    // mouth bands even when the fundamental has plunged into the sub register.
    const formantCurve = saturationCurve(close ? 3.4 : 2);
    let formantInput = sum;
    if (formantCurve) {
      const formantDrive = bus.track(ctx.createGain());
      formantDrive.gain.value = close ? 1.35 : 1.05;
      const grit = bus.track(ctx.createWaveShaper());
      grit.curve = formantCurve;
      grit.oversample = close ? '2x' : 'none';
      sum.connect(formantDrive);
      formantDrive.connect(grit);
      formantInput = grit;
    }

    // Broad, low formants: F1 chest, F2 open mouth, F3 only a trace of
    // presence. The Q stays low so no single harmonic sings out.
    const vowels = close
      ? [[330, 620, 285, 1.9, 1.7], [750, 1160, 610, 2.2, .75], [1470, 1770, 1080, 2.4, .22]]
      : [[350, 520, 300, 2.1, 1.2], [745, 1010, 645, 2.4, .48], [1450, 1650, 1160, 2.6, .14]];
    for (const [startHz, midHz, endHz, q, levelHz] of vowels) {
      const formant = bus.track(ctx.createBiquadFilter());
      formant.type = 'bandpass';
      formant.frequency.setValueAtTime(startHz * variation, t);
      formant.frequency.linearRampToValueAtTime(midHz * variation, t + duration * .34);
      formant.frequency.linearRampToValueAtTime(endHz * variation, t + duration * .86);
      formant.Q.value = q;
      const mix = bus.track(ctx.createGain());
      mix.gain.value = levelHz;
      formantInput.connect(formant);
      formant.connect(mix);
      mix.connect(pre);
    }

    const f0 = close
      ? [[0, 68], [.075, 116], [.24, 78], [.58, 58], [1.18, 52], [duration, 46]]
      : [[0, 58], [.22, 86], [.62, 80], [1.06, 56], [duration, 50]];

    const chest = bus.source(ctx.createOscillator());
    chest.type = 'sine';
    setSweep(chest.frequency, f0, t);
    const chestGain = bus.track(ctx.createGain());
    chestGain.gain.value = close ? .68 : .62;
    chest.connect(chestGain);
    chestGain.connect(sum);

    const throat = bus.source(ctx.createOscillator());
    throat.type = 'sawtooth';
    setSweep(throat.frequency, f0.map(([at, hz]) => [at, hz + (close ? 3.2 : 2.1)]), t);
    const throatFilter = bus.track(ctx.createBiquadFilter());
    throatFilter.type = 'lowpass';
    throatFilter.frequency.value = close ? 1500 : 1200;
    throatFilter.Q.value = .7;
    const throatGain = bus.track(ctx.createGain());
    throatGain.gain.value = close ? .7 : .5;
    throat.connect(throatFilter);
    throatFilter.connect(throatGain);
    throatGain.connect(sum);

    const falseCords = bus.source(ctx.createOscillator());
    falseCords.type = 'triangle';
    setSweep(falseCords.frequency, f0.map(([at, hz]) => [at, Math.min(360, hz * 2)]), t);
    const falseFilter = bus.track(ctx.createBiquadFilter());
    falseFilter.type = 'lowpass';
    falseFilter.frequency.value = close ? 1500 : 1300;
    falseFilter.Q.value = .6;
    const falseGain = bus.track(ctx.createGain());
    falseGain.gain.value = close ? .34 : .24;
    falseCords.connect(falseFilter);
    falseFilter.connect(falseGain);
    falseGain.connect(sum);

    const sub = bus.source(ctx.createOscillator());
    sub.type = 'sine';
    setSweep(sub.frequency, f0.map(([at, hz]) => [at, hz * .5]), t);
    const subGain = bus.track(ctx.createGain());
    subGain.gain.value = close ? .1 : .12;
    sub.connect(subGain);
    subGain.connect(dry);

    const vibrato = bus.source(ctx.createOscillator());
    vibrato.type = 'sine';
    vibrato.frequency.setValueAtTime((close ? 4.7 : 5.2) + (Math.random() - .5), t);
    vibrato.frequency.linearRampToValueAtTime(close ? 6.5 : 5.9, end);
    const vibratoDepth = bus.track(ctx.createGain());
    vibratoDepth.gain.value = close ? 5 : 3;
    vibrato.connect(vibratoDepth);
    vibratoDepth.connect(chest.frequency);
    vibratoDepth.connect(throat.frequency);

    // Sub-audio amplitude modulation: the false-cord flutter that makes a
    // sustained roar feel muscular instead of synthetic.
    const growl = bus.source(ctx.createOscillator());
    growl.type = 'sine';
    growl.frequency.setValueAtTime((close ? 33 : 24) + Math.random() * 2, t);
    growl.frequency.linearRampToValueAtTime(close ? 42 : 29, end);
    const growlDepth = bus.track(ctx.createGain());
    growlDepth.gain.value = close ? .2 : .12;
    growl.connect(growlDepth);
    growlDepth.connect(pre.gain);
    growlDepth.connect(throatGain.gain);

    if (noise) {
      const rasp = bus.source(ctx.createBufferSource());
      rasp.buffer = noise;
      rasp.loop = true;
      const raspBand = bus.track(ctx.createBiquadFilter());
      raspBand.type = 'bandpass';
      raspBand.frequency.setValueAtTime(close ? 520 : 460, t);
      raspBand.frequency.linearRampToValueAtTime(close ? 760 : 620, t + duration * .7);
      raspBand.Q.value = close ? 1.25 : 1.1;
      const raspAir = bus.track(ctx.createBiquadFilter());
      raspAir.type = 'lowpass';
      raspAir.frequency.value = close ? 1850 : 1550;
      raspAir.Q.value = .5;
      const raspGain = bus.track(ctx.createGain());
      const raspLevel = close ? .35 : .18;
      raspGain.gain.setValueAtTime(MIN, t);
      raspGain.gain.linearRampToValueAtTime(raspLevel, t + (close ? .08 : .12));
      raspGain.gain.linearRampToValueAtTime(raspLevel * .62, t + duration * .82);
      raspGain.gain.exponentialRampToValueAtTime(MIN, end);
      rasp.connect(raspBand);
      raspBand.connect(raspAir);
      raspAir.connect(raspGain);
      raspGain.connect(pre);

      // Wet chest rattle under the vowel.
      const rattle = bus.track(ctx.createBiquadFilter());
      rattle.type = 'bandpass';
      rattle.frequency.setValueAtTime(128, t);
      rattle.frequency.linearRampToValueAtTime(close ? 168 : 146, t + duration * .8);
      rattle.Q.value = 1.5;
      const rattleGain = bus.track(ctx.createGain());
      const rattleLevel = close ? .14 : .08;
      rattleGain.gain.setValueAtTime(MIN, t);
      rattleGain.gain.linearRampToValueAtTime(rattleLevel, t + .1);
      rattleGain.gain.exponentialRampToValueAtTime(MIN, end);
      rasp.connect(rattle);
      rattle.connect(rattleGain);
      rattleGain.connect(pre);
      rasp.start(t, .02);
      rasp.stop(end + .01);
    }

    // Saturation adds organic harmonics, then the mouth closes over the tail
    // so the roar darkens instead of turning into a bright scream.
    const tone = bus.track(ctx.createBiquadFilter());
    tone.type = 'lowpass';
    tone.frequency.setValueAtTime(close ? 1850 : 1550, t);
    tone.frequency.linearRampToValueAtTime(close ? 1050 : 960, end);
    tone.Q.value = .55;
    const guard = bus.track(ctx.createBiquadFilter());
    guard.type = 'highpass';
    guard.frequency.value = close ? 28 : 32;
    guard.Q.value = .6;
    const curve = saturationCurve(close ? 1.95 : 1.35);
    if (curve) {
      const shaper = bus.track(ctx.createWaveShaper());
      shaper.curve = curve;
      shaper.oversample = close ? '2x' : 'none';
      chestEq.connect(shaper);
      shaper.connect(tone);
    } else chestEq.connect(tone);
    tone.connect(guard);
    guard.connect(bus.gain);

    const peak = (close ? .6 : .5) * amount;
    bus.gain.gain.setValueAtTime(MIN, t);
    bus.gain.gain.linearRampToValueAtTime(peak, t + (close ? .055 : .1));
    if (close) {
      bus.gain.gain.linearRampToValueAtTime(peak * .76, t + .34);
      bus.gain.gain.linearRampToValueAtTime(peak * .9, t + .64);
      bus.gain.gain.linearRampToValueAtTime(peak * .52, t + 1.48);
    } else {
      bus.gain.gain.linearRampToValueAtTime(peak * .8, t + .54);
      bus.gain.gain.linearRampToValueAtTime(peak * .6, t + duration * .82);
    }
    bus.gain.gain.exponentialRampToValueAtTime(MIN, end);

    chest.start(t); chest.stop(end + .02); chest.onended = bus.finish;
    throat.start(t); throat.stop(end + .02);
    falseCords.start(t); falseCords.stop(end + .02);
    sub.start(t); sub.stop(end + .02);
    vibrato.start(t); vibrato.stop(end);
    growl.start(t); growl.stop(end);
  }

  // The walk-along voice. `prowl` is the low sub-throat rumble that trails a
  // footfall on patrol, `rasp` is the hollow predatory breath while it
  // searches, and `snarl` is the saturated hunting growl of a chase. All three
  // stay below the whistle band so they read as a body, not a siren.
  function growl(kind = 'prowl', level = .5, pan = 0) {
    const shape = kind === 'snarl' ? 'snarl' : kind === 'rasp' ? 'rasp' : 'prowl';
    const amount = clamp(level, 0, 1);
    const t = ctx.currentTime + .006;
    const duration = shape === 'snarl' ? .74 : shape === 'rasp' ? .94 : .86;
    const end = t + duration;
    const bus = voice(pan);
    const variation = .96 + Math.random() * .08;

    const sum = bus.track(ctx.createGain());
    sum.gain.value = 1;

    // Chest lift: the mass of the throat sits in the low-mid band.
    const chestEq = bus.track(ctx.createBiquadFilter());
    chestEq.type = 'peaking';
    chestEq.frequency.value = shape === 'snarl' ? 320 : shape === 'rasp' ? 300 : 240;
    chestEq.Q.value = .85;
    if (chestEq.gain) chestEq.gain.value = shape === 'snarl' ? 6.5 : 3.6;
    sum.connect(chestEq);

    // The snarl drives the whole vowel into saturation before the formants.
    let voiceInput = chestEq;
    if (shape === 'snarl') {
      const curve = saturationCurve(2.4);
      if (curve) {
        const shaper = bus.track(ctx.createWaveShaper());
        shaper.curve = curve;
        shaper.oversample = 'none';
        chestEq.connect(shaper);
        voiceInput = shaper;
      }
    }

    // The fundamental: a throat that sags down after each swell.
    const body = bus.source(ctx.createOscillator());
    body.type = 'sawtooth';
    const bodyPoints = shape === 'snarl'
      ? [[0, 68], [.26, 104], [duration, 54]]
      : shape === 'rasp'
        ? [[0, 56], [.34, 82], [duration, 46]]
        : [[0, 48], [.32, 58], [duration, 41]];
    setSweep(body.frequency, bodyPoints, t);
    const throat = bus.track(ctx.createBiquadFilter());
    throat.type = 'lowpass';
    throat.frequency.value = shape === 'snarl' ? 820 : shape === 'rasp' ? 760 : 680;
    throat.Q.value = .7;
    const bodyGain = bus.track(ctx.createGain());
    bodyGain.gain.value = shape === 'snarl' ? .60 : .52;
    body.connect(throat);
    throat.connect(bodyGain);
    bodyGain.connect(voiceInput);

    // Two broad formants shape a throat and a mouth, never a resonant pitch.
    const formantPoints = shape === 'snarl' ? [340, 700] : shape === 'rasp' ? [300, 620] : [260, 540];
    for (const [index, hz] of formantPoints.entries()) {
      const formant = bus.track(ctx.createBiquadFilter());
      formant.type = 'bandpass';
      formant.frequency.setValueAtTime(hz * variation, t);
      formant.frequency.linearRampToValueAtTime(hz * (1 + (shape === 'snarl' ? .18 : .08)) * variation, t + duration * .42);
      formant.frequency.linearRampToValueAtTime(hz * .92 * variation, end);
      formant.Q.value = 2.6 + index;
      const mix = bus.track(ctx.createGain());
      mix.gain.value = index === 0 ? .40 : .22;
      throat.connect(formant);
      formant.connect(mix);
      mix.connect(voiceInput);
    }

    // The sub register under the vowel: what a phone speaker feels as size.
    const sub = bus.source(ctx.createOscillator());
    sub.type = 'sine';
    const subPoints = shape === 'snarl'
      ? [[0, 34], [.30, 52], [duration, 27]]
      : shape === 'rasp'
        ? [[0, 28], [.38, 33], [duration, 22]]
        : [[0, 24], [.34, 29], [duration, 20]];
    setSweep(sub.frequency, subPoints, t);
    const subGain = bus.track(ctx.createGain());
    subGain.gain.value = shape === 'snarl' ? .40 : .34;
    sub.connect(subGain);
    subGain.connect(sum);

    // False cords: a triangle partial for the rasp, a second octave for the snarl.
    if (shape !== 'prowl') {
      const falseCords = bus.source(ctx.createOscillator());
      falseCords.type = 'triangle';
      setSweep(falseCords.frequency, bodyPoints.map(([at, hz]) => [at, Math.min(360, hz * 1.9)]), t);
      const falseFilter = bus.track(ctx.createBiquadFilter());
      falseFilter.type = 'lowpass';
      falseFilter.frequency.value = shape === 'rasp' ? 900 : 1100;
      falseFilter.Q.value = .6;
      const falseGain = bus.track(ctx.createGain());
      falseGain.gain.value = shape === 'rasp' ? .16 : .22;
      falseCords.connect(falseFilter);
      falseFilter.connect(falseGain);
      falseGain.connect(voiceInput);
      falseCords.start(t); falseCords.stop(end + .02);
    }

    // Sub-audio flutter: the muscular tremble of a growl held in the chest.
    const flutter = bus.source(ctx.createOscillator());
    flutter.type = 'sine';
    flutter.frequency.setValueAtTime(shape === 'snarl' ? 31 : shape === 'rasp' ? 24 : 19, t);
    flutter.frequency.linearRampToValueAtTime(shape === 'snarl' ? 34 : shape === 'rasp' ? 26 : 21, end);
    const flutterDepth = bus.track(ctx.createGain());
    flutterDepth.gain.value = shape === 'snarl' ? .19 : .15;
    flutter.connect(flutterDepth);
    flutterDepth.connect(sum.gain);

    if (noise) {
      const rasp = bus.source(ctx.createBufferSource());
      rasp.buffer = noise;
      rasp.loop = true;
      const raspBand = bus.track(ctx.createBiquadFilter());
      raspBand.type = 'bandpass';
      if (shape === 'rasp') {
        raspBand.frequency.setValueAtTime(380 * variation, t);
        raspBand.frequency.exponentialRampToValueAtTime(640 * variation, end);
        raspBand.Q.value = 1.15;
      } else {
        raspBand.frequency.setValueAtTime(shape === 'snarl' ? 520 : 240, t);
        raspBand.frequency.linearRampToValueAtTime(shape === 'snarl' ? 760 : 420, t + duration * .7);
        raspBand.Q.value = 1.05;
      }
      const raspAir = bus.track(ctx.createBiquadFilter());
      raspAir.type = 'lowpass';
      raspAir.frequency.value = shape === 'snarl' ? 1700 : 1400;
      raspAir.Q.value = .5;
      const raspGain = bus.track(ctx.createGain());
      const raspLevel = shape === 'snarl' ? .17 : .11;
      raspGain.gain.setValueAtTime(MIN, t);
      raspGain.gain.linearRampToValueAtTime(raspLevel, t + .07);
      raspGain.gain.linearRampToValueAtTime(raspLevel * .7, t + duration * .62);
      raspGain.gain.exponentialRampToValueAtTime(MIN, end);
      rasp.connect(raspBand);
      raspBand.connect(raspAir);
      raspAir.connect(raspGain);
      raspGain.connect(voiceInput);
      rasp.start(t, .02);
      rasp.stop(end + .01);
    }

    // The mouth closes over the tail so the growl sags away instead of cutting.
    const tone = bus.track(ctx.createBiquadFilter());
    tone.type = 'lowpass';
    tone.frequency.setValueAtTime(shape === 'snarl' ? 1500 : 1200, t);
    tone.frequency.linearRampToValueAtTime(shape === 'snarl' ? 900 : 760, end);
    tone.Q.value = .55;
    const guard = bus.track(ctx.createBiquadFilter());
    guard.type = 'highpass';
    guard.frequency.value = 26;
    guard.Q.value = .6;
    voiceInput.connect(tone);
    tone.connect(guard);
    guard.connect(bus.gain);

    const peak = (shape === 'snarl' ? .46 : shape === 'rasp' ? .40 : .42) * amount;
    bus.gain.gain.setValueAtTime(MIN, t);
    bus.gain.gain.linearRampToValueAtTime(peak, t + (shape === 'snarl' ? .05 : .075));
    bus.gain.gain.linearRampToValueAtTime(peak * .74, t + duration * .46);
    bus.gain.gain.linearRampToValueAtTime(peak * .5, t + duration * .8);
    bus.gain.gain.exponentialRampToValueAtTime(MIN, end);

    body.start(t); body.stop(end + .02); body.onended = bus.finish;
    sub.start(t); sub.stop(end + .02);
    flutter.start(t); flutter.stop(end);
  }

  function silence() {
    const t = ctx.currentTime;
    for (const bus of active) {
      try {
        bus.gain.gain.cancelScheduledValues(t);
        bus.gain.gain.setTargetAtTime(0, t, .012);
      } catch { /* param already released */ }
      for (const source of bus.sources) {
        try { source.stop(t + .09); } catch { /* already stopped */ }
      }
    }
  }

  return { stomp, scream, growl, silence };
}
