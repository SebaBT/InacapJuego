(() => {
  // music/score-engine.js
  var BPM = 72;
  var STEPS_PER_BEAT = 4;
  var STEP_SECONDS = 60 / BPM / STEPS_PER_BEAT;
  var BARS = 8;
  var LOOP_STEPS = BARS * STEPS_PER_BEAT * 4;
  var A4 = 440;
  var SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function noteFrequency(name) {
    const match = /^([A-G])([#b]?)(-?\d)$/.exec(String(name || "").trim());
    if (!match) return 0;
    const [, letter, accidental, octave] = match;
    const accidentalOffset = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
    const midi = (Number(octave) + 1) * 12 + SEMITONES[letter] + accidentalOffset;
    return A4 * Math.pow(2, (midi - 69) / 12);
  }
  var clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
  var MELODY = [
    [0, 0, "A4", 6],
    [0, 6, "C5", 2],
    [0, 8, "E5", 8],
    [1, 0, "D5", 4],
    [1, 4, "C5", 2],
    [1, 6, "B4", 2],
    [1, 8, "A4", 8],
    [2, 0, "F4", 8],
    [2, 8, "A4", 4],
    [2, 12, "C5", 4],
    [3, 0, "E5", 8],
    [3, 8, "D5", 4],
    [3, 12, "B4", 4],
    [4, 0, "A4", 6],
    [4, 6, "C5", 2],
    [4, 8, "E5", 8],
    [5, 0, "B4", 4],
    [5, 4, "C5", 4],
    [5, 8, "D5", 8],
    [6, 0, "F5", 4],
    [6, 4, "E5", 4],
    [6, 8, "C5", 8],
    [7, 0, "B4", 8],
    [7, 8, "A4", 8]
  ];
  var MAJOR_SHARPS = { C: "C#", F: "F#", G: "G#" };
  function toMajor(name) {
    const match = /^([A-G])([#b]?)(-?\d)$/.exec(name);
    if (!match) return name;
    const sharp = MAJOR_SHARPS[match[1]];
    return sharp ? `${sharp}${match[3]}` : name;
  }
  var BASS_MINOR = ["A2", "A2", "F2", "F2", "D2", "D2", "E2", "E2"];
  var BASS_MAJOR = ["A2", "A2", "F#2", "F#2", "D2", "D2", "E2", "E2"];
  var CHORDS_MINOR = [
    { bar: 0, notes: ["A3", "C4", "E4"] },
    { bar: 2, notes: ["F3", "A3", "C4"] },
    { bar: 4, notes: ["D3", "F3", "A3"] },
    { bar: 6, notes: ["E3", "G3", "B3"] }
  ];
  var CHORDS_MAJOR = [
    { bar: 0, notes: ["A3", "C#4", "E4"] },
    { bar: 2, notes: ["F#3", "A3", "C#4"] },
    { bar: 4, notes: ["D3", "F#3", "A3"] },
    { bar: 6, notes: ["E3", "G#3", "B3"] }
  ];
  function chordForBar(bar, mode) {
    const chords = mode === "major" ? CHORDS_MAJOR : CHORDS_MINOR;
    let current = chords[0];
    for (const entry of chords) {
      if (entry.bar <= bar) current = entry;
    }
    return current;
  }
  var CHASE_LEAD = [
    [1, 0, "E5", 8],
    [1, 8, "F5", 8],
    [2, 0, "E5", 8],
    [2, 8, "D5", 8],
    [3, 0, "C5", 8],
    [3, 8, "B4", 8],
    [4, 0, "C5", 8],
    [4, 8, "E5", 8],
    [5, 0, "F5", 8],
    [5, 8, "E5", 8],
    [6, 0, "D5", 8],
    [6, 8, "B4", 8],
    [7, 0, "A4", 16]
  ];
  var LEAD_BY_STEP = (() => {
    const map = /* @__PURE__ */ new Map();
    for (const [bar, step, note, length] of CHASE_LEAD) {
      const absolute = bar * 16 + step;
      if (!map.has(absolute)) map.set(absolute, []);
      map.get(absolute).push({ note, length });
    }
    return map;
  })();
  var ARP_PATTERN = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3];
  var BELLS = {
    none: [],
    sparse: [[4, 8, "A5"]],
    win: [[4, 8, "E6"], [6, 0, "C#6"], [7, 0, "A5"], [7, 8, "E6"]],
    true: [[2, 8, "A5"], [4, 0, "E6"], [5, 4, "C#6"], [6, 8, "A5"], [7, 0, "E6"], [7, 8, "A6"]]
  };
  var mix = (values) => Object.freeze({
    drone: 0,
    box: 0,
    bass: 0,
    pad: 0,
    strings: 0,
    stringsMajor: 0,
    tick: 0,
    heart: 0,
    drum: 0,
    drive: 0,
    roll: 0,
    arp: 0,
    choir: 0,
    lead: 0,
    sub: 0,
    siren: 0,
    horn: 0,
    bell: 0,
    air: 0,
    breath: 0,
    ...values
  });
  var STATE_CONFIG = Object.freeze({
    menu: {
      label: "Men\xFA",
      tagline: "Caja de m\xFAsica, aire y un bajo que apenas se mueve.",
      blurb: "La pieza se presenta sola: caja de m\xFAsica, aire y un bajo que apenas se mueve.",
      mix: mix({ drone: 0.52, box: 0.56, pad: 0.3, strings: 0.06, bell: 0.06, air: 0.22 }),
      boxFilter: "all",
      boxBars: null,
      mode: "minor",
      warp: 0,
      tempo: 1,
      filter: 12e3,
      bass: "none",
      tick: "none",
      heart: "none",
      bell: "sparse"
    },
    ambient: {
      label: "Ambiente",
      tagline: "Pulso y bajo pizzicato; nada tiene prisa todav\xEDa.",
      blurb: "Entran el pulso y el bajo pizzicato. Nada tiene prisa todav\xEDa.",
      mix: mix({ drone: 0.6, box: 0.5, bass: 0.26, pad: 0.33, strings: 0.1, heart: 0.16, bell: 0.05, air: 0.3, breath: 0.05 }),
      boxFilter: "strong",
      boxBars: null,
      mode: "minor",
      warp: 0,
      tempo: 1,
      filter: 12e3,
      bass: "whole",
      tick: "none",
      heart: "slow",
      bell: "sparse"
    },
    chase: {
      label: "Persecuci\xF3n",
      tagline: "160 BPM: clave, redoblante, coro y metales.",
      blurb: "La pieza sube a 160 BPM: arpegio de clave, redoblante, tambores, galope, coro, theremin, sirena y metales. Ya no insin\xFAa correr: corre.",
      mix: mix({
        drone: 0.42,
        box: 0.2,
        bass: 0.55,
        pad: 0.16,
        strings: 0.18,
        tick: 0.45,
        heart: 0.42,
        drum: 0.52,
        drive: 0.38,
        roll: 0.5,
        arp: 0.52,
        choir: 0.28,
        lead: 0.38,
        sub: 0.2,
        siren: 0.18,
        horn: 0.32,
        air: 0.26,
        breath: 0.08
      }),
      boxFilter: "all",
      boxBars: [0, 1, 4, 7],
      mode: "minor",
      warp: 0,
      tempo: 2.2222,
      boost: 1.3,
      filter: 16e3,
      bass: "eighths",
      tick: "run",
      heart: "beat",
      drum: "run",
      drive: "run",
      roll: "run",
      arp: "run",
      choir: "run",
      lead: "run",
      horn: "swell",
      crash: "run",
      bell: "none"
    },
    near: {
      label: "Al lado",
      tagline: "148 BPM, coraz\xF3n, coro y sirena.",
      blurb: "La pieza se queda a 148 BPM: coraz\xF3n, subgraves, coro, sirena y una segunda menor. El aire se espesa y el galope se acerca.",
      mix: mix({
        drone: 0.7,
        box: 0.22,
        bass: 0.34,
        pad: 0.28,
        strings: 0.4,
        tick: 0.5,
        heart: 0.8,
        drum: 0.32,
        drive: 0.22,
        roll: 0.28,
        arp: 0.24,
        choir: 0.22,
        lead: 0.16,
        sub: 0.6,
        siren: 0.24,
        horn: 0.1,
        air: 0.4,
        breath: 0.4
      }),
      boxFilter: "strong",
      boxBars: [0, 1, 7],
      mode: "minor",
      warp: -30,
      tempo: 2.0556,
      boost: 1.15,
      filter: 12e3,
      bass: "eighths",
      tick: "eighths",
      heart: "beat",
      drum: "run",
      drive: "run",
      roll: "run",
      arp: "run",
      choir: "run",
      lead: "run",
      horn: "none",
      crash: "none",
      bell: "none"
    },
    lose: {
      label: "Derrota",
      tagline: "La caja se desafina y el filtro se cierra.",
      blurb: "Todo cae una octava. La caja se desafina, la sirena se apaga y el filtro se cierra.",
      mix: mix({ drone: 0.55, box: 0.4, bass: 0.12, pad: 0.22, strings: 0.18, sub: 0.25, siren: 0.05, air: 0.3, breath: 0.15 }),
      boxFilter: "all",
      boxBars: null,
      mode: "minor",
      warp: -55,
      tempo: 0.9,
      filter: 850,
      bass: "none",
      tick: "none",
      heart: "none",
      bell: "none"
    },
    win: {
      label: "Victoria",
      tagline: "La misma melod\xEDa, en modo mayor.",
      blurb: "La misma melod\xEDa, en modo mayor. Las campanas resuelven.",
      mix: mix({ drone: 0.38, box: 0.6, bass: 0.26, pad: 0.38, stringsMajor: 0.3, bell: 0.28, air: 0.2 }),
      boxFilter: "all",
      boxBars: null,
      mode: "major",
      warp: 0,
      tempo: 1,
      filter: 14e3,
      bass: "halves",
      tick: "none",
      heart: "none",
      bell: "win"
    },
    truewin: {
      label: "Victoria verdadera",
      tagline: "Campanas, cuerdas y coro.",
      blurb: "Se suman campanas, cuerdas y coro. La pieza respira completa.",
      mix: mix({ drone: 0.42, box: 0.68, bass: 0.34, pad: 0.5, stringsMajor: 0.45, bell: 0.5, air: 0.24 }),
      boxFilter: "all",
      boxBars: null,
      mode: "major",
      warp: 0,
      tempo: 1,
      filter: 16e3,
      bass: "halves",
      tick: "none",
      heart: "none",
      bell: "true"
    }
  });
  var STATE_ORDER = Object.freeze(["menu", "paused", "ambient", "chase", "near", "lose", "win", "truewin"]);
  var LAYER_INFO = Object.freeze([
    { key: "drone", name: "Drone", hint: "A1\u2013E2 sostenido" },
    { key: "box", name: "Caja de m\xFAsica", hint: "la melod\xEDa" },
    { key: "bass", name: "Bajo pizzicato", hint: "ra\xEDces del acorde" },
    { key: "pad", name: "Pad de cuerdas", hint: "acordes largos" },
    { key: "strings", name: "Cluster menor", hint: "segunda menor" },
    { key: "stringsMajor", name: "Cluster mayor", hint: "resoluci\xF3n" },
    { key: "tick", name: "Tic-tac", hint: "corcheas secas" },
    { key: "heart", name: "Pulso", hint: "latido grave" },
    { key: "drum", name: "Tambores", hint: "carrera" },
    { key: "drive", name: "Galope", hint: "cuerdas en 16" },
    { key: "roll", name: "Redoblante", hint: "redoble militar" },
    { key: "arp", name: "Clave", hint: "arpegio en 16" },
    { key: "choir", name: "Coro", hint: "voces sin palabras" },
    { key: "lead", name: "Theremin", hint: "contracanto" },
    { key: "sub", name: "Subgraves", hint: "presi\xF3n" },
    { key: "siren", name: "Alerta", hint: "sirena lejana" },
    { key: "horn", name: "Metales", hint: "peso grave" },
    { key: "bell", name: "Campanas", hint: "ornamentos" },
    { key: "air", name: "Aire", hint: "ruido filtrado" },
    { key: "breath", name: "Aliento", hint: "presencia cercana" }
  ]);
  var LAYER_KEYS = Object.freeze(LAYER_INFO.map((layer) => layer.key));
  var MELODY_BY_STEP = (() => {
    const map = /* @__PURE__ */ new Map();
    MELODY.forEach((entry, order) => {
      const [bar, step, note, length] = entry;
      const absolute = bar * 16 + step;
      if (!map.has(absolute)) map.set(absolute, []);
      map.get(absolute).push({ note, length, order, bar, step });
    });
    return map;
  })();
  var BELLS_BY_STEP = (() => {
    const map = /* @__PURE__ */ new Map();
    for (const [name, events] of Object.entries(BELLS)) {
      for (const [bar, step, note] of events) {
        const absolute = bar * 16 + step;
        if (!map.has(absolute)) map.set(absolute, []);
        map.get(absolute).push({ pattern: name, note });
      }
    }
    return map;
  })();
  var LOOKAHEAD = 0.28;
  var PUMP_MS = 30;
  function centsToRatio(cents) {
    return Math.pow(2, cents / 1200);
  }
  function createHorrorScore(options = {}) {
    const {
      audioContext: providedContext = null,
      destination: providedDestination = null,
      volume = 0.7,
      state = "menu",
      reverb = true
    } = options;
    let ctx = providedContext || null;
    const ownsContext = !providedContext;
    let graph = null;
    let disposed = false;
    let running = false;
    let timer = 0;
    let baseState = STATE_CONFIG[state] ? state : "menu";
    let paused = false;
    let masterVolume = clamp(Number(volume) || 0, 0, 1);
    let nextStepIndex = 0;
    let nextStepTime = 0;
    let leadLastFreq = 0;
    let filterTarget = STATE_CONFIG[baseState].filter;
    const listeners = /* @__PURE__ */ new Set();
    const AudioCtor = () => {
      if (typeof window === "undefined") return null;
      return window.AudioContext || window.webkitAudioContext || null;
    };
    function makeGain(value = 0) {
      const node = ctx.createGain();
      node.gain.value = value;
      return node;
    }
    function makePanner(pan = 0) {
      if (typeof ctx.createStereoPanner !== "function") return null;
      const node = ctx.createStereoPanner();
      node.pan.value = clamp(pan, -1, 1);
      return node;
    }
    function route(source, destinationNode, pan = 0) {
      if (Math.abs(pan) < 0.01) {
        source.connect(destinationNode);
        return;
      }
      const panner = makePanner(pan);
      if (!panner) {
        source.connect(destinationNode);
        return;
      }
      source.connect(panner);
      panner.connect(destinationNode);
    }
    function buildImpulse(seconds = 3.4, decay = 2.6) {
      const rate = ctx.sampleRate;
      const length = Math.max(1, Math.floor(rate * seconds));
      const buffer = ctx.createBuffer(2, length, rate);
      for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < length; i++) {
          const t = i / length;
          const envelope = Math.pow(1 - t, decay);
          data[i] = (Math.random() * 2 - 1) * envelope;
        }
      }
      return buffer;
    }
    function build() {
      if (graph) return graph;
      ctx = ctx || new (AudioCtor())();
      if (!ctx) throw new Error("WebAudio no est\xE1 disponible en este navegador.");
      const scoreBus = makeGain(0.62);
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = filterTarget;
      lowpass.Q.value = 0.6;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -9;
      limiter.knee.value = 18;
      limiter.ratio.value = 3;
      limiter.attack.value = 8e-3;
      limiter.release.value = 0.28;
      const master = makeGain(masterVolume);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.82;
      scoreBus.connect(lowpass);
      lowpass.connect(limiter);
      limiter.connect(master);
      master.connect(analyser);
      analyser.connect(providedDestination || ctx.destination);
      const reverbNode = ctx.createConvolver();
      reverbNode.buffer = buildImpulse();
      const wet = makeGain(reverb ? 0.34 : 1e-4);
      reverbNode.connect(wet);
      wet.connect(scoreBus);
      const layers = {};
      for (const key of LAYER_KEYS) {
        const gain = makeGain(0);
        gain.connect(scoreBus);
        layers[key] = gain;
        const sendAmount = {
          drone: 0.18,
          box: 0.52,
          bass: 0.22,
          pad: 0.58,
          strings: 0.4,
          stringsMajor: 0.4,
          tick: 0.12,
          heart: 0.05,
          drum: 0.06,
          drive: 0.22,
          roll: 0.1,
          arp: 0.3,
          choir: 0.55,
          lead: 0.45,
          sub: 0.04,
          siren: 0.48,
          horn: 0.38,
          bell: 0.62,
          air: 0.5,
          breath: 0.55
        }[key] ?? 0;
        if (sendAmount > 0) {
          const send = makeGain(sendAmount);
          gain.connect(send);
          send.connect(reverbNode);
        }
      }
      const noiseBuffer = (() => {
        const length = Math.floor(ctx.sampleRate * 2);
        const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
        return buffer;
      })();
      const start2 = ctx.currentTime + 0.06;
      {
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 210;
        filter.Q.value = 0.8;
        filter.connect(layers.drone);
        const tones = [
          { type: "sine", freq: 55, gain: 0.2, detune: 0 },
          { type: "sine", freq: 55, gain: 0.13, detune: 7 },
          { type: "triangle", freq: 110, gain: 0.05, detune: -5 },
          { type: "sine", freq: 82.5, gain: 0.07, detune: 2 },
          { type: "sine", freq: 27.5, gain: 0.1, detune: 0 }
        ];
        for (const tone of tones) {
          const osc = ctx.createOscillator();
          osc.type = tone.type;
          osc.frequency.value = tone.freq;
          osc.detune.value = tone.detune;
          const gain = makeGain(tone.gain);
          osc.connect(gain);
          gain.connect(filter);
          osc.start(start2);
        }
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.06;
        const lfoGain = makeGain(55);
        lfo.connect(lfoGain);
        lfoGain.connect(filter.frequency);
        lfo.start(start2);
      }
      const buildStrings = (bus, freqs) => {
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 1050;
        filter.Q.value = 0.5;
        filter.connect(bus);
        for (const freq of freqs) {
          for (const detune of [-7, 7]) {
            const osc = ctx.createOscillator();
            osc.type = "sawtooth";
            osc.frequency.value = freq;
            osc.detune.value = detune;
            const gain = makeGain(0.043);
            osc.connect(gain);
            gain.connect(filter);
            osc.start(start2);
            const vibrato = ctx.createOscillator();
            vibrato.frequency.value = 0.17 + Math.random() * 0.08;
            const vibratoGain = makeGain(3.5);
            vibrato.connect(vibratoGain);
            vibratoGain.connect(osc.detune);
            vibrato.start(start2);
          }
        }
      };
      buildStrings(layers.strings, [220, 233.08, 329.63]);
      buildStrings(layers.stringsMajor, [220, 277.18, 329.63]);
      {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = 55;
        const osc2 = ctx.createOscillator();
        osc2.type = "sine";
        osc2.frequency.value = 36.7;
        const gain = makeGain(0.17);
        const gain2 = makeGain(0.05);
        osc.connect(gain);
        gain.connect(layers.sub);
        osc2.connect(gain2);
        gain2.connect(layers.sub);
        osc.start(start2);
        osc2.start(start2);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 1.05;
        const depth = makeGain(0.06);
        lfo.connect(depth);
        depth.connect(gain.gain);
        lfo.start(start2);
      }
      {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        src.loop = true;
        const band = ctx.createBiquadFilter();
        band.type = "bandpass";
        band.frequency.value = 420;
        band.Q.value = 0.65;
        const gain = makeGain(0.032);
        src.connect(band);
        band.connect(gain);
        gain.connect(layers.air);
        src.start(start2);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.07;
        const depth = makeGain(0.015);
        lfo.connect(depth);
        depth.connect(gain.gain);
        lfo.start(start2);
      }
      {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        src.loop = true;
        const band = ctx.createBiquadFilter();
        band.type = "bandpass";
        band.frequency.value = 820;
        band.Q.value = 1.6;
        const high = ctx.createBiquadFilter();
        high.type = "highpass";
        high.frequency.value = 380;
        const gain = makeGain(0.028);
        src.connect(band);
        band.connect(high);
        high.connect(gain);
        gain.connect(layers.breath);
        src.start(start2);
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.05;
        const depth = makeGain(0.022);
        lfo.connect(depth);
        depth.connect(gain.gain);
        lfo.start(start2);
      }
      {
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 1250;
        filter.Q.value = 0.7;
        filter.connect(layers.siren);
        const lfo = ctx.createOscillator();
        lfo.type = "sine";
        lfo.frequency.value = 0.62;
        const tones = [
          { freq: 220, gain: 0.34, depth: 0.34 },
          { freq: 233.08, gain: 0.34, depth: -0.34 },
          { freq: 440, gain: 0.07, depth: 0.07 }
        ];
        for (const tone of tones) {
          const osc = ctx.createOscillator();
          osc.type = "sine";
          osc.frequency.value = tone.freq;
          const gain = makeGain(tone.gain);
          osc.connect(gain);
          gain.connect(filter);
          osc.start(start2);
          const depth = makeGain(tone.depth);
          lfo.connect(depth);
          depth.connect(gain.gain);
        }
        lfo.start(start2);
      }
      graph = { scoreBus, lowpass, limiter, master, analyser, layers, noiseBuffer, reverbNode, wet };
      applyMix(STATE_CONFIG[baseState].mix, 0.01);
      lowpass.frequency.setTargetAtTime(filterTarget, ctx.currentTime, 0.2);
      return graph;
    }
    function musicBox(time, frequency, steps, cfg, stepSeconds = STEP_SECONDS) {
      if (!frequency) return;
      const layers = graph.layers;
      const duration = Math.max(0.3, steps * stepSeconds * 1.9);
      const frequencySafe = frequency * centsToRatio(cfg.warp || 0);
      const pan = (Math.round(frequencySafe) % 7 - 3) * 0.05;
      const partials = [
        { ratio: 1, gain: 0.085, decay: duration },
        { ratio: 2.001, gain: 0.028, decay: duration * 0.62 },
        { ratio: 3.007, gain: 0.012, decay: duration * 0.42 },
        { ratio: 4.98, gain: 6e-3, decay: duration * 0.28 }
      ];
      for (const partial of partials) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = frequencySafe * partial.ratio;
        osc.detune.value = (Math.random() * 2 - 1) * 3;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(1e-4, time);
        gain.gain.exponentialRampToValueAtTime(partial.gain, time + 6e-3);
        gain.gain.exponentialRampToValueAtTime(1e-4, time + partial.decay);
        osc.connect(gain);
        route(gain, layers.box, pan);
        osc.start(time);
        osc.stop(time + partial.decay + 0.05);
      }
      const src = ctx.createBufferSource();
      src.buffer = graph.noiseBuffer;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 2600;
      band.Q.value = 3;
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.012, time);
      noiseGain.gain.exponentialRampToValueAtTime(1e-4, time + 0.035);
      src.connect(band);
      band.connect(noiseGain);
      route(noiseGain, layers.box, pan);
      src.start(time, Math.random() * 1.5, 0.06);
    }
    function pizzicato(time, frequency, gainAmount = 1, decay = 0.42) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = frequency;
      const sub = ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.value = frequency * 0.5;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 460;
      const gain = ctx.createGain();
      const peak = 0.24 * gainAmount;
      gain.gain.setValueAtTime(1e-4, time);
      gain.gain.linearRampToValueAtTime(peak, time + 0.012);
      gain.gain.exponentialRampToValueAtTime(1e-4, time + decay);
      const subGain = makeGain(0.22);
      osc.connect(filter);
      sub.connect(subGain);
      subGain.connect(filter);
      filter.connect(gain);
      gain.connect(graph.layers.bass);
      osc.start(time);
      sub.start(time);
      osc.stop(time + decay + 0.08);
      sub.stop(time + decay + 0.08);
    }
    function padChord(time, notes, beats = 8, cfg, stepSeconds = STEP_SECONDS) {
      const duration = beats * stepSeconds * 4 + 0.6;
      const holdEnd = Math.max(time + 0.5, time + duration - 0.8);
      for (const name of notes) {
        const frequency = noteFrequency(name) * centsToRatio((cfg.warp || 0) * 0.25);
        for (const detune of [-6, 6]) {
          const osc = ctx.createOscillator();
          osc.type = "sawtooth";
          osc.frequency.value = frequency;
          osc.detune.value = detune;
          const filter = ctx.createBiquadFilter();
          filter.type = "lowpass";
          filter.frequency.value = 760;
          filter.Q.value = 0.4;
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(1e-4, time);
          gain.gain.linearRampToValueAtTime(0.052, time + Math.min(1.2, duration * 0.35));
          gain.gain.setValueAtTime(0.052, holdEnd);
          gain.gain.exponentialRampToValueAtTime(1e-4, time + duration);
          osc.connect(filter);
          filter.connect(gain);
          gain.connect(graph.layers.pad);
          osc.start(time);
          osc.stop(time + duration + 0.05);
        }
      }
    }
    function tick(time, accent = false) {
      const src = ctx.createBufferSource();
      src.buffer = graph.noiseBuffer;
      const high = ctx.createBiquadFilter();
      high.type = "highpass";
      high.frequency.value = 2600;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = accent ? 4200 : 3600;
      band.Q.value = 7;
      const gain = ctx.createGain();
      const peak = accent ? 0.085 : 0.05;
      gain.gain.setValueAtTime(1e-4, time);
      gain.gain.linearRampToValueAtTime(peak, time + 2e-3);
      gain.gain.exponentialRampToValueAtTime(1e-4, time + 0.045);
      src.connect(high);
      high.connect(band);
      band.connect(gain);
      gain.connect(graph.layers.tick);
      src.start(time, Math.random() * 1.2, 0.08);
    }
    function heartbeat(time, gainAmount = 1) {
      const thump = (offset, scale) => {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(62, time + offset);
        osc.frequency.exponentialRampToValueAtTime(38, time + offset + 0.14);
        const gain = ctx.createGain();
        const peak = 0.3 * scale * gainAmount;
        gain.gain.setValueAtTime(1e-4, time + offset);
        gain.gain.linearRampToValueAtTime(peak, time + offset + 0.012);
        gain.gain.exponentialRampToValueAtTime(1e-4, time + offset + 0.22);
        osc.connect(gain);
        gain.connect(graph.layers.heart);
        osc.start(time + offset);
        osc.stop(time + offset + 0.26);
      };
      thump(0, 1);
      thump(0.17, 0.62);
    }
    function drive(time, frequency, gainAmount = 1) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = frequency;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1250;
      filter.Q.value = 0.7;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(1e-4, time);
      gain.gain.linearRampToValueAtTime(0.075 * gainAmount, time + 8e-3);
      gain.gain.exponentialRampToValueAtTime(1e-4, time + 0.12);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(graph.layers.drive);
      osc.start(time);
      osc.stop(time + 0.14);
    }
    function tom(time, gainAmount = 1, ghost = false) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(ghost ? 128 : 96, time);
      osc.frequency.exponentialRampToValueAtTime(ghost ? 72 : 46, time + 0.12);
      const gain = ctx.createGain();
      const peak = (ghost ? 0.075 : 0.19) * gainAmount;
      gain.gain.setValueAtTime(1e-4, time);
      gain.gain.linearRampToValueAtTime(peak, time + 6e-3);
      gain.gain.exponentialRampToValueAtTime(1e-4, time + (ghost ? 0.12 : 0.2));
      osc.connect(gain);
      gain.connect(graph.layers.drum);
      osc.start(time);
      osc.stop(time + 0.22);
    }
    function snare(time, gainAmount = 1, layer = graph.layers.drum) {
      const src = ctx.createBufferSource();
      src.buffer = graph.noiseBuffer;
      const high = ctx.createBiquadFilter();
      high.type = "highpass";
      high.frequency.value = 1200;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = 2100;
      band.Q.value = 1.1;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(1e-4, time);
      gain.gain.linearRampToValueAtTime(0.1 * gainAmount, time + 3e-3);
      gain.gain.exponentialRampToValueAtTime(1e-4, time + 0.08);
      src.connect(high);
      high.connect(band);
      band.connect(gain);
      gain.connect(layer);
      src.start(time, Math.random() * 1.2, 0.1);
    }
    function arpNote(time, frequency, gainAmount = 1, pan = 0) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = frequency;
      const octave = ctx.createOscillator();
      octave.type = "sine";
      octave.frequency.value = frequency * 2.004;
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = 280;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(1e-4, time);
      gain.gain.linearRampToValueAtTime(0.05 * gainAmount, time + 4e-3);
      gain.gain.exponentialRampToValueAtTime(1e-4, time + 0.11);
      const octaveGain = makeGain(0.32);
      osc.connect(filter);
      octave.connect(octaveGain);
      octaveGain.connect(filter);
      filter.connect(gain);
      route(gain, graph.layers.arp, pan);
      osc.start(time);
      octave.start(time);
      osc.stop(time + 0.13);
      octave.stop(time + 0.13);
    }
    function choirChord(time, notes, duration, cfg) {
      const attack = Math.min(0.6, duration * 0.22);
      const hold = Math.max(time + attack + 0.2, time + duration - 0.9);
      for (const name of notes) {
        const frequency = noteFrequency(name) * centsToRatio((cfg.warp || 0) * 0.2);
        for (const detune of [-9, 9]) {
          const osc = ctx.createOscillator();
          osc.type = "sawtooth";
          osc.frequency.value = frequency;
          osc.detune.value = detune;
          const formant = ctx.createBiquadFilter();
          formant.type = "bandpass";
          formant.frequency.value = 720;
          formant.Q.value = 1.3;
          const low = ctx.createBiquadFilter();
          low.type = "lowpass";
          low.frequency.value = 1900;
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(1e-4, time);
          gain.gain.linearRampToValueAtTime(0.03, time + attack);
          gain.gain.setValueAtTime(0.03, hold);
          gain.gain.exponentialRampToValueAtTime(1e-4, time + duration);
          osc.connect(formant);
          formant.connect(low);
          low.connect(gain);
          gain.connect(graph.layers.choir);
          osc.start(time);
          osc.stop(time + duration + 0.05);
        }
      }
    }
    function leadNote(time, frequency, steps, stepSeconds) {
      const duration = Math.max(0.45, steps * stepSeconds);
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      const octave = ctx.createOscillator();
      octave.type = "sine";
      octave.detune.value = 4;
      const vibrato = ctx.createOscillator();
      vibrato.frequency.value = 5.3;
      const vibratoGain = makeGain(6);
      vibrato.connect(vibratoGain);
      vibratoGain.connect(osc.detune);
      vibratoGain.connect(octave.detune);
      const startFrequency = leadLastFreq > 0 ? leadLastFreq : frequency;
      for (const voice of [osc, octave]) {
        voice.frequency.setValueAtTime(startFrequency, time);
        voice.frequency.exponentialRampToValueAtTime(frequency, time + 0.08);
      }
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 2400;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(1e-4, time);
      gain.gain.linearRampToValueAtTime(0.075, time + 0.07);
      gain.gain.setValueAtTime(0.075, time + Math.max(0.2, duration - 0.25));
      gain.gain.exponentialRampToValueAtTime(1e-4, time + duration + 0.3);
      osc.connect(filter);
      octave.connect(filter);
      filter.connect(gain);
      const panner = makePanner(0.18);
      if (panner) {
        gain.connect(panner);
        panner.connect(graph.layers.lead);
      } else {
        gain.connect(graph.layers.lead);
      }
      osc.start(time);
      octave.start(time);
      vibrato.start(time);
      osc.stop(time + duration + 0.35);
      octave.stop(time + duration + 0.35);
      vibrato.stop(time + duration + 0.35);
      leadLastFreq = frequency;
    }
    function brassStab(time, frequency) {
      for (const [ratio, level] of [[1, 0.05], [1.5, 0.028]]) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = frequency * ratio;
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 780;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(1e-4, time);
        gain.gain.linearRampToValueAtTime(level, time + 0.01);
        gain.gain.exponentialRampToValueAtTime(1e-4, time + 0.2);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(graph.layers.horn);
        osc.start(time);
        osc.stop(time + 0.22);
      }
    }
    function crash(time) {
      const src = ctx.createBufferSource();
      src.buffer = graph.noiseBuffer;
      const high = ctx.createBiquadFilter();
      high.type = "highpass";
      high.frequency.value = 3200;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(1e-4, time);
      gain.gain.linearRampToValueAtTime(0.07, time + 0.01);
      gain.gain.exponentialRampToValueAtTime(1e-4, time + 1.1);
      src.connect(high);
      high.connect(gain);
      gain.connect(graph.layers.drum);
      src.start(time, Math.random() * 0.5, 1.2);
    }
    function drumFill(time) {
      [0, 0.11, 0.22, 0.33].forEach((offset, index) => {
        tom(time + offset, 0.65 + index * 0.08, index > 1);
      });
      snare(time + 0.4, 0.5);
    }
    function hornSwell(time, frequency) {
      const duration = 2.6;
      for (const [ratio, level] of [[1, 0.045], [1.5, 0.03], [2, 0.018]]) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = frequency * ratio;
        osc.detune.value = ratio === 1 ? -4 : 4;
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 520;
        filter.Q.value = 0.6;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(1e-4, time);
        gain.gain.linearRampToValueAtTime(level, time + 0.35);
        gain.gain.setValueAtTime(level, time + duration - 0.7);
        gain.gain.exponentialRampToValueAtTime(1e-4, time + duration);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(graph.layers.horn);
        osc.start(time);
        osc.stop(time + duration + 0.05);
      }
    }
    function bell(time, frequency, gainAmount = 1) {
      const partials = [
        { ratio: 1, gain: 0.09 },
        { ratio: 2.01, gain: 0.035 },
        { ratio: 4.16, gain: 0.012 }
      ];
      for (const partial of partials) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = frequency * partial.ratio;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(1e-4, time);
        gain.gain.exponentialRampToValueAtTime(partial.gain * gainAmount, time + 0.01);
        gain.gain.exponentialRampToValueAtTime(1e-4, time + 3.2);
        osc.connect(gain);
        route(gain, graph.layers.bell, Math.sin(time * 1.7) * 0.18);
        osc.start(time);
        osc.stop(time + 3.3);
      }
    }
    function breathSwell(time, length = 2.2) {
      const src = ctx.createBufferSource();
      src.buffer = graph.noiseBuffer;
      src.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.setValueAtTime(500, time);
      band.frequency.linearRampToValueAtTime(1100, time + length);
      band.Q.value = 1.8;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(1e-4, time);
      gain.gain.linearRampToValueAtTime(0.05, time + length * 0.6);
      gain.gain.exponentialRampToValueAtTime(1e-4, time + length);
      src.connect(band);
      band.connect(gain);
      gain.connect(graph.layers.breath);
      src.start(time, Math.random() * 0.6, length + 0.1);
    }
    function lowBoom(time) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(68, time);
      osc.frequency.exponentialRampToValueAtTime(28, time + 1.4);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(1e-4, time);
      gain.gain.linearRampToValueAtTime(0.24, time + 0.02);
      gain.gain.exponentialRampToValueAtTime(1e-4, time + 2.2);
      osc.connect(gain);
      gain.connect(graph.layers.sub);
      osc.start(time);
      osc.stop(time + 2.3);
    }
    function alertTone(time, frequency, gainAmount = 1) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(frequency, time);
      osc.frequency.linearRampToValueAtTime(frequency * 1.004, time + 0.2);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 2400;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(1e-4, time);
      gain.gain.linearRampToValueAtTime(0.095 * gainAmount, time + 0.012);
      gain.gain.exponentialRampToValueAtTime(1e-4, time + 0.36);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(graph.scoreBus);
      osc.start(time);
      osc.stop(time + 0.4);
    }
    function alert(level = 2) {
      if (!graph || !running) return false;
      const time = ctx.currentTime + 0.04;
      const steps = clamp(Math.round(level), 1, 4);
      for (let index = 0; index < steps; index++) {
        const note = index % 2 === 0 ? "A4" : "E5";
        alertTone(time + index * 0.3, noteFrequency(note), 0.8 + index * 0.06);
      }
      if (steps >= 3) heartbeat(time + 0.05, 0.55);
      if (steps >= 4) lowBoom(time + 0.1);
      return true;
    }
    function shouldPlayBox(cfg, note) {
      if (cfg.boxBars && !cfg.boxBars.includes(note.bar)) return false;
      if (cfg.boxFilter === "strong" && note.step % 8 !== 0) return false;
      return true;
    }
    function scheduleStep(stepIndex, time) {
      const step = (stepIndex % LOOP_STEPS + LOOP_STEPS) % LOOP_STEPS;
      const bar = Math.floor(step / 16);
      const inBar = step % 16;
      const cfg = STATE_CONFIG[baseState] || STATE_CONFIG.ambient;
      const mode = cfg.mode || "minor";
      const stepSeconds = STEP_SECONDS / (cfg.tempo || 1);
      const bassDecay = Math.min(0.42, Math.max(0.16, stepSeconds * 1.9));
      const roots = mode === "major" ? BASS_MAJOR : BASS_MINOR;
      const root = noteFrequency(roots[bar]);
      const chord = chordForBar(bar, mode);
      const notes = MELODY_BY_STEP.get(step);
      if (notes) {
        for (const note of notes) {
          if (!shouldPlayBox(cfg, note)) continue;
          const name = mode === "major" ? toMajor(note.note) : note.note;
          musicBox(time, noteFrequency(name), note.length, cfg, stepSeconds);
        }
      }
      if (cfg.bass !== "none") {
        if (cfg.bass === "whole" && (inBar === 0 || inBar === 10)) {
          pizzicato(time, root, inBar === 0 ? 1 : 0.72, bassDecay);
        } else if (cfg.bass === "halves" && (inBar === 0 || inBar === 8)) {
          pizzicato(time, root, 0.9, bassDecay);
        } else if (cfg.bass === "eighths" && inBar % 2 === 0) {
          const accent = inBar === 0 ? 1 : 0.72;
          const push = inBar === 12 ? Math.pow(2, 7 / 12) : 1;
          pizzicato(time, root * push, accent, bassDecay);
        }
      }
      if (inBar === 0 && chord.bar === bar) {
        padChord(time, chord.notes, 8, cfg, stepSeconds);
      }
      if (cfg.heart === "slow" && inBar === 0 && bar % 2 === 0) heartbeat(time, 0.8);
      else if (cfg.heart === "half" && (inBar === 0 || inBar === 8)) heartbeat(time, inBar === 0 ? 1 : 0.75);
      else if (cfg.heart === "beat" && inBar % 4 === 0) heartbeat(time, inBar === 0 ? 1 : 0.7);
      if (cfg.tick === "offbeat" && inBar % 4 === 2) tick(time, inBar % 8 === 6);
      else if (cfg.tick === "eighths" && inBar % 2 === 0) tick(time, inBar % 4 === 0);
      else if (cfg.tick === "run" && (inBar % 2 === 0 || inBar === 15)) {
        tick(time, inBar % 4 === 0);
      } else if (cfg.tick === "sixteenths") {
        tick(time, inBar % 4 === 0);
      }
      if (cfg.drum === "run") {
        if (inBar % 2 === 0) {
          const accent = inBar % 8 === 0 ? 1 : inBar % 4 === 0 ? 0.72 : 0.5;
          tom(time, accent, inBar % 4 !== 0);
        }
        if (inBar === 7 || inBar === 15) tom(time, 0.36, true);
        if (inBar === 4 || inBar === 12) snare(time, 0.85);
        if (inBar === 15) snare(time, 0.3);
      }
      if (cfg.drive === "run" && (inBar % 2 === 0 || inBar === 15)) {
        const eighths = inBar % 2 === 0;
        const offsets = [0, 0, 7, 0, 0, 7, 0, 0];
        const offset = eighths ? offsets[inBar / 2 | 0] : 12;
        const gain = eighths ? inBar % 4 === 0 ? 1 : 0.7 : 0.35;
        drive(time, root * 2 * Math.pow(2, offset / 12), gain);
      }
      if (cfg.roll === "run" && [0, 1, 4, 5, 7].includes(bar)) {
        snare(time, inBar % 4 === 0 ? 0.55 : 0.28, graph.layers.roll);
      }
      if (cfg.arp === "run" && bar !== 6) {
        const base = chord.notes.map(noteFrequency);
        const freqs = [base[0], base[1], base[2], base[0] * 2];
        arpNote(
          time,
          freqs[ARP_PATTERN[inBar]] * 2,
          inBar % 4 === 0 ? 1 : 0.7,
          inBar % 2 === 0 ? -0.22 : 0.22
        );
      }
      if (cfg.choir === "run" && inBar === 0 && [0, 2, 6].includes(bar)) {
        choirChord(time, chord.notes, 32 * stepSeconds + 0.8, cfg);
      }
      if (cfg.lead === "run") {
        const events = LEAD_BY_STEP.get(step);
        if (events) {
          for (const event of events) {
            leadNote(time, noteFrequency(event.note), event.length, stepSeconds);
          }
        }
      }
      if (cfg.horn === "swell") {
        if (inBar === 0 && bar % 4 === 0) hornSwell(time, root);
        if (bar >= 2 && inBar % 4 === 2) brassStab(time, root);
      }
      if (cfg.crash === "run" && (bar === 0 || bar === 4) && inBar === 0) {
        crash(time);
        if (bar === 0) lowBoom(time);
      }
      if (cfg.bell !== "none") {
        const events = BELLS_BY_STEP.get(step);
        if (events) {
          for (const event of events) {
            if (event.pattern === cfg.bell) {
              bell(time, noteFrequency(event.note), cfg.bell === "true" ? 1 : 0.8);
            }
          }
        }
      }
    }
    function pump() {
      if (!running || !ctx) return;
      const horizon = ctx.currentTime + LOOKAHEAD;
      const stepSeconds = STEP_SECONDS / ((STATE_CONFIG[baseState] || STATE_CONFIG.ambient).tempo || 1);
      let guard = 0;
      while (nextStepTime < horizon && guard++ < 96) {
        scheduleStep(nextStepIndex, nextStepTime);
        nextStepIndex++;
        nextStepTime += stepSeconds;
      }
      if (nextStepTime < ctx.currentTime - 0.18) {
        const skip = Math.ceil((ctx.currentTime - nextStepTime) / stepSeconds);
        nextStepIndex += skip;
        nextStepTime += skip * stepSeconds;
      }
    }
    function applyMix(targetMix, fade = 0.9) {
      if (!graph) return;
      const now = ctx.currentTime;
      const duck = paused ? 0.55 : 1;
      const boost = STATE_CONFIG[baseState] && STATE_CONFIG[baseState].boost || 1;
      for (const key of LAYER_KEYS) {
        const value = clamp((targetMix[key] || 0) * duck * boost, 0, 1);
        graph.layers[key].gain.setTargetAtTime(value, now, Math.max(0.02, fade * 0.5));
      }
      if (graph.master) {
        graph.master.gain.setTargetAtTime(masterVolume * (paused ? 0.78 : 1), now, 0.18);
      }
    }
    function applyFilter(cutoff, fade = 0.5) {
      if (!graph) return;
      filterTarget = cutoff;
      graph.lowpass.frequency.setTargetAtTime(cutoff, ctx.currentTime, Math.max(0.05, fade * 0.5));
    }
    function stinger(name, time) {
      if (name === "win") {
        const notes = ["A4", "C#5", "E5", "A5"];
        notes.forEach((note, index) => bell(time + index * 0.16, noteFrequency(note), 0.7));
      } else if (name === "truewin") {
        const notes = ["A3", "C#4", "E4", "A4", "C#5", "E5", "A5"];
        notes.forEach((note, index) => bell(time + index * 0.13, noteFrequency(note), 0.75));
        breathSwell(time, 3.4);
      } else if (name === "lose") {
        lowBoom(time);
        musicBox(time + 0.1, noteFrequency("A4") * centsToRatio(-70), 8, STATE_CONFIG.lose);
      } else if (name === "chase") {
        alert(2);
        drumFill(time);
      } else if (name === "near") {
        alert(3);
        breathSwell(time, 1.6);
        heartbeat(time + 0.05, 1.1);
      }
    }
    function emit() {
      const payload = { state: paused ? "paused" : baseState, baseState, paused, running };
      for (const listener of listeners) {
        try {
          listener(payload);
        } catch {
        }
      }
    }
    function setState(name) {
      if (disposed) return getState();
      if (name === "paused") {
        if (!paused) {
          paused = true;
          applyMix(STATE_CONFIG[baseState].mix, 0.5);
          applyFilter(680, 0.5);
          emit();
        }
        return getState();
      }
      const cfg = STATE_CONFIG[name];
      if (!cfg) return getState();
      const wasPaused = paused;
      paused = false;
      const changed = baseState !== name || wasPaused;
      if (baseState !== name) leadLastFreq = 0;
      baseState = name;
      filterTarget = cfg.filter;
      applyFilter(cfg.filter, name === "lose" ? 1.6 : 0.6);
      applyMix(cfg.mix, name === "lose" ? 1.4 : 0.9);
      if (changed && graph && running) stinger(name, (ctx.currentTime || 0) + 0.05);
      emit();
      return getState();
    }
    function getState() {
      return {
        state: paused ? "paused" : baseState,
        baseState,
        paused,
        running,
        config: STATE_CONFIG[baseState]
      };
    }
    function start() {
      if (disposed) return false;
      build();
      if (!running) {
        running = true;
        nextStepIndex = 0;
        nextStepTime = ctx.currentTime + 0.08;
        timer = setInterval(pump, PUMP_MS);
        pump();
        applyMix(STATE_CONFIG[baseState].mix, 0.8);
        applyFilter(filterTarget, 0.4);
        emit();
      }
      try {
        ctx.resume?.();
      } catch {
      }
      return true;
    }
    function stop() {
      running = false;
      if (timer) clearInterval(timer);
      timer = 0;
      if (graph) {
        graph.master.gain.setTargetAtTime(1e-4, ctx.currentTime, 0.08);
      }
      emit();
      return true;
    }
    function setVolume(value) {
      masterVolume = clamp(Number(value) || 0, 0, 1);
      if (graph) {
        graph.master.gain.setTargetAtTime(masterVolume, ctx.currentTime, 0.05);
      }
      emit();
      return masterVolume;
    }
    function subscribe(listener) {
      if (typeof listener !== "function") return () => {
      };
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      running = false;
      if (timer) clearInterval(timer);
      timer = 0;
      listeners.clear();
      if (graph) {
        try {
          graph.analyser.disconnect();
        } catch {
        }
        try {
          graph.wet.disconnect();
        } catch {
        }
      }
      if (ownsContext && ctx && typeof ctx.close === "function") {
        try {
          ctx.close();
        } catch {
        }
      }
      ctx = null;
      graph = null;
    }
    return {
      start,
      stop,
      setState,
      alert,
      getState,
      setVolume,
      getVolume: () => masterVolume,
      subscribe,
      dispose,
      isRunning: () => running,
      getAnalyser: () => graph ? graph.analyser : null,
      getContext: () => ctx
    };
  }

  // music/demo.js
  var PAUSE_INFO = {
    label: "Pausa",
    tagline: "El estado anterior detr\xE1s de una puerta.",
    blurb: "El estado anterior detr\xE1s de una puerta: el filtro baja a 680 Hz, el pulso se apaga y todo pierde peso."
  };
  var TOUR = [
    ["menu", 9e3],
    ["ambient", 11e3],
    ["chase", 1e4],
    ["near", 9e3],
    ["ambient", 7e3],
    ["paused", 6e3],
    ["win", 9e3],
    ["truewin", 9e3],
    ["lose", 8e3]
  ];
  var engine = createHorrorScore({ volume: 0.72, state: "menu" });
  var elements = {
    power: document.getElementById("power"),
    powerLabel: document.getElementById("power-label"),
    alert: document.getElementById("alert"),
    tour: document.getElementById("tour"),
    volume: document.getElementById("volume"),
    nowName: document.getElementById("now-name"),
    nowBlurb: document.getElementById("now-blurb"),
    nowMeta: document.getElementById("now-meta"),
    hint: document.getElementById("hint"),
    states: document.getElementById("states"),
    matrix: document.getElementById("matrix"),
    meter: document.getElementById("meter")
  };
  var stateButtons = /* @__PURE__ */ new Map();
  var tourIndex = 0;
  var tourTimer = 0;
  var started = false;
  function pad(index) {
    return String(index + 1).padStart(2, "0");
  }
  function stateInfo(name) {
    if (name === "paused") return PAUSE_INFO;
    return STATE_CONFIG[name];
  }
  function miniStrip(name) {
    const config = name === "paused" ? null : STATE_CONFIG[name];
    const strip = document.createElement("span");
    strip.className = "state-layers";
    strip.setAttribute("aria-hidden", "true");
    for (const key of LAYER_KEYS) {
      const tick = document.createElement("span");
      tick.className = "state-tick";
      const value = config ? config.mix[key] || 0 : 0;
      tick.style.setProperty("--v", String(value));
      strip.append(tick);
    }
    return strip;
  }
  function buildStates() {
    STATE_ORDER.forEach((name, index) => {
      const info = stateInfo(name);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "state";
      button.dataset.state = name;
      button.setAttribute("aria-pressed", "false");
      const number = document.createElement("span");
      number.className = "state-index";
      number.textContent = pad(index);
      const body = document.createElement("span");
      body.className = "state-body";
      const label = document.createElement("span");
      label.className = "state-name";
      label.textContent = info.label;
      if (name === "paused") {
        const tag = document.createElement("span");
        tag.className = "state-tag";
        tag.textContent = "tratamiento";
        label.append(tag);
      }
      const blurb = document.createElement("span");
      blurb.className = "state-blurb";
      blurb.textContent = info.blurb;
      body.append(label, blurb, miniStrip(name));
      button.append(number, body);
      const layerCount = name === "paused" ? "hereda las capas" : `${LAYER_KEYS.filter((key) => (STATE_CONFIG[name].mix[key] || 0) > 0.02).length} capas activas`;
      const meta = document.createElement("span");
      meta.className = "state-meta";
      meta.textContent = layerCount;
      body.append(meta);
      button.addEventListener("click", () => {
        stopTour();
        ensureStarted();
        engine.setState(name);
      });
      elements.states.append(button);
      stateButtons.set(name, button);
    });
  }
  function buildMatrix() {
    const columns = STATE_ORDER.filter((name) => name !== "paused");
    const template = `180px repeat(${columns.length}, minmax(58px, 1fr))`;
    const head = document.createElement("div");
    head.className = "matrix-row matrix-head";
    head.style.gridTemplateColumns = template;
    const corner = document.createElement("div");
    corner.className = "matrix-cell layer";
    corner.textContent = "Capa";
    head.append(corner);
    for (const name of columns) {
      const cell = document.createElement("div");
      cell.className = "matrix-cell";
      cell.textContent = name === "truewin" ? "Verdad." : STATE_CONFIG[name].label;
      head.append(cell);
    }
    elements.matrix.append(head);
    for (const layer of LAYER_INFO) {
      const row = document.createElement("div");
      row.className = "matrix-row";
      row.style.gridTemplateColumns = template;
      const label = document.createElement("div");
      label.className = "matrix-cell layer";
      const name = document.createElement("span");
      name.textContent = layer.name;
      const hint = document.createElement("span");
      hint.className = "matrix-hint";
      hint.textContent = layer.hint;
      label.append(name, hint);
      row.append(label);
      for (const state of columns) {
        const cell = document.createElement("div");
        cell.className = "matrix-cell";
        const value = STATE_CONFIG[state].mix[layer.key] || 0;
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.style.setProperty("--v", String(value));
        dot.title = `${layer.name} en ${STATE_CONFIG[state].label}: ${Math.round(value * 100)} %`;
        cell.append(dot);
        row.append(cell);
      }
      elements.matrix.append(row);
    }
  }
  function ensureStarted() {
    if (engine.isRunning()) return;
    try {
      engine.start();
      started = true;
    } catch (error) {
      elements.hint.textContent = "Este navegador no pudo iniciar WebAudio.";
      console.error(error);
    }
  }
  function renderNow(payload = engine.getState()) {
    const name = payload.state;
    const info = stateInfo(name);
    const running = engine.isRunning();
    const config = name === "paused" ? STATE_CONFIG[payload.baseState] : STATE_CONFIG[name];
    elements.nowName.textContent = info.label;
    elements.nowBlurb.textContent = info.tagline || info.blurb;
    elements.hint.hidden = running;
    elements.powerLabel.textContent = running ? "Detener" : "Comenzar";
    elements.power.setAttribute("aria-pressed", String(running));
    elements.power.classList.toggle("is-on", running);
    document.body.classList.toggle("is-running", running);
    if (name === "paused") {
      elements.nowMeta.textContent = `filtro 680 Hz \xB7 sobre ${STATE_CONFIG[payload.baseState].label.toLowerCase()}`;
    } else {
      const bpm = Math.round(BPM * (config.tempo || 1));
      elements.nowMeta.textContent = `${bpm} BPM \xB7 ${config.mode === "major" ? "La mayor" : "La menor"}`;
    }
    for (const [key, button] of stateButtons) {
      const active = key === name;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }
  var meter = {
    canvas: elements.meter,
    ctx: elements.meter.getContext("2d"),
    wave: [],
    samples: null,
    raf: 0,
    width: 0,
    height: 0,
    dpr: 1
  };
  var reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function sizeMeter() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(meter.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(meter.canvas.clientHeight * dpr));
    if (width === meter.canvas.width && height === meter.canvas.height) return;
    meter.canvas.width = width;
    meter.canvas.height = height;
    meter.width = width;
    meter.height = height;
    meter.dpr = dpr;
  }
  function drawMeter() {
    const { ctx: pen, width, height } = meter;
    if (!width || !height) return;
    pen.clearRect(0, 0, width, height);
    const centre = height / 2;
    const analyser = engine.getAnalyser();
    if (analyser) {
      if (!meter.samples || meter.samples.length !== analyser.fftSize) {
        meter.samples = new Float32Array(analyser.fftSize);
      }
      analyser.getFloatTimeDomainData(meter.samples);
    }
    const points = Math.max(90, Math.min(260, Math.round(width / (2.4 * meter.dpr))));
    if (meter.wave.length !== points) {
      meter.wave = new Array(points).fill(centre);
    }
    pen.beginPath();
    for (let index = 0; index < points; index++) {
      const sample = meter.samples ? meter.samples[Math.floor(index / (points - 1) * (meter.samples.length - 1))] : 0;
      const target = centre + Math.tanh(sample * 7.2) * height * 0.42;
      const smooth = meter.wave[index] + (target - meter.wave[index]) * 0.35;
      meter.wave[index] = smooth;
      const x = index / (points - 1) * width;
      if (index === 0) pen.moveTo(x, smooth);
      else pen.lineTo(x, smooth);
    }
    pen.save();
    pen.lineTo(width, centre);
    pen.lineTo(0, centre);
    pen.closePath();
    pen.fillStyle = "rgba(201, 164, 92, .045)";
    pen.fill();
    pen.restore();
    pen.beginPath();
    for (let index = 0; index < points; index++) {
      const x = index / (points - 1) * width;
      if (index === 0) pen.moveTo(x, meter.wave[index]);
      else pen.lineTo(x, meter.wave[index]);
    }
    pen.lineJoin = "round";
    pen.lineCap = "round";
    pen.strokeStyle = "rgba(201, 164, 92, .14)";
    pen.lineWidth = 6 * meter.dpr;
    pen.stroke();
    pen.strokeStyle = "rgba(201, 164, 92, .78)";
    pen.lineWidth = 1.4 * meter.dpr;
    pen.stroke();
    pen.strokeStyle = "rgba(233, 227, 214, 0.09)";
    pen.lineWidth = Math.max(1, meter.dpr * 0.75);
    pen.beginPath();
    pen.moveTo(0, centre);
    pen.lineTo(width, centre);
    pen.stroke();
    if (reducedMotion) return;
    meter.raf = requestAnimationFrame(drawMeter);
  }
  function startMeter() {
    sizeMeter();
    if (reducedMotion) {
      drawMeter();
      return;
    }
    if (!meter.raf) meter.raf = requestAnimationFrame(drawMeter);
  }
  function stopTour() {
    if (tourTimer) clearTimeout(tourTimer);
    tourTimer = 0;
    if (elements.tour.getAttribute("aria-pressed") === "true") {
      elements.tour.setAttribute("aria-pressed", "false");
      elements.tour.classList.remove("is-on");
    }
  }
  function tourStep() {
    const [name, duration] = TOUR[tourIndex % TOUR.length];
    tourIndex += 1;
    ensureStarted();
    engine.setState(name);
    tourTimer = setTimeout(tourStep, duration);
  }
  function startTour() {
    tourIndex = 0;
    elements.tour.setAttribute("aria-pressed", "true");
    elements.tour.classList.add("is-on");
    tourStep();
  }
  elements.power.addEventListener("click", () => {
    if (engine.isRunning()) {
      stopTour();
      engine.stop();
    } else {
      ensureStarted();
    }
  });
  elements.tour.addEventListener("click", () => {
    if (tourTimer) {
      stopTour();
    } else {
      startTour();
    }
  });
  elements.alert.addEventListener("click", () => {
    ensureStarted();
    engine.alert(3);
  });
  elements.volume.style.setProperty("--fill", `${Number(elements.volume.value) * 100}%`);
  elements.volume.addEventListener("input", () => {
    const value = Number(elements.volume.value);
    elements.volume.style.setProperty("--fill", `${value * 100}%`);
    engine.setVolume(value);
  });
  window.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLElement && /input|textarea|select/i.test(event.target.tagName)) return;
    if (event.code === "Space") {
      event.preventDefault();
      elements.power.click();
      return;
    }
    if (event.key.toLowerCase() === "a") {
      ensureStarted();
      engine.alert(3);
      return;
    }
    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= STATE_ORDER.length) {
      const name = STATE_ORDER[digit - 1];
      stopTour();
      ensureStarted();
      engine.setState(name);
    }
  });
  window.addEventListener("resize", () => {
    sizeMeter();
    if (reducedMotion) drawMeter();
  });
  engine.subscribe(renderNow);
  buildStates();
  buildMatrix();
  renderNow();
  startMeter();
  window.__musicScore = {
    engine,
    STATE_CONFIG,
    STATE_ORDER,
    start: ensureStarted,
    select: (name) => engine.setState(name),
    alert: (level = 3) => engine.alert(level),
    stop: () => engine.stop(),
    state: () => engine.getState()
  };
})();
