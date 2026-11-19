/*
 * Pabellón B — marcador de terror suave.
 *
 * Una sola pieza de 8 compases. Los ocho estados no son canciones distintas:
 * son mezclas de las mismas capas. La melodía nunca se reinicia al cambiar de
 * estado, sólo entran y salen instrumentos, igual que en Balatro. Persecución
 * y cercanía suben el tempo (160 y 148 BPM); al salir, la pieza vuelve a 72.
 *
 * Sin samples ni archivos de audio: todo se sintetiza con WebAudio.
 */

export const BPM = 72;
export const STEPS_PER_BEAT = 4;
export const STEP_SECONDS = 60 / BPM / STEPS_PER_BEAT;
export const BARS = 8;
export const LOOP_STEPS = BARS * STEPS_PER_BEAT * 4;

const A4 = 440;

const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function noteFrequency(name) {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(String(name || '').trim());
  if (!match) return 0;
  const [, letter, accidental, octave] = match;
  const accidentalOffset = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  const midi = (Number(octave) + 1) * 12 + SEMITONES[letter] + accidentalOffset;
  return A4 * Math.pow(2, (midi - 69) / 12);
}

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

// ---------------------------------------------------------------------------
// La partitura
// ---------------------------------------------------------------------------

// [compás, paso de 1/16, nota, duración en pasos]
const MELODY = [
  [0, 0, 'A4', 6], [0, 6, 'C5', 2], [0, 8, 'E5', 8],
  [1, 0, 'D5', 4], [1, 4, 'C5', 2], [1, 6, 'B4', 2], [1, 8, 'A4', 8],
  [2, 0, 'F4', 8], [2, 8, 'A4', 4], [2, 12, 'C5', 4],
  [3, 0, 'E5', 8], [3, 8, 'D5', 4], [3, 12, 'B4', 4],
  [4, 0, 'A4', 6], [4, 6, 'C5', 2], [4, 8, 'E5', 8],
  [5, 0, 'B4', 4], [5, 4, 'C5', 4], [5, 8, 'D5', 8],
  [6, 0, 'F5', 4], [6, 4, 'E5', 4], [6, 8, 'C5', 8],
  [7, 0, 'B4', 8], [7, 8, 'A4', 8]
];

const MAJOR_SHARPS = { C: 'C#', F: 'F#', G: 'G#' };

function toMajor(name) {
  const match = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!match) return name;
  const sharp = MAJOR_SHARPS[match[1]];
  return sharp ? `${sharp}${match[3]}` : name;
}

const BASS_MINOR = ['A2', 'A2', 'F2', 'F2', 'D2', 'D2', 'E2', 'E2'];
const BASS_MAJOR = ['A2', 'A2', 'F#2', 'F#2', 'D2', 'D2', 'E2', 'E2'];

const CHORDS_MINOR = [
  { bar: 0, notes: ['A3', 'C4', 'E4'] },
  { bar: 2, notes: ['F3', 'A3', 'C4'] },
  { bar: 4, notes: ['D3', 'F3', 'A3'] },
  { bar: 6, notes: ['E3', 'G3', 'B3'] }
];

const CHORDS_MAJOR = [
  { bar: 0, notes: ['A3', 'C#4', 'E4'] },
  { bar: 2, notes: ['F#3', 'A3', 'C#4'] },
  { bar: 4, notes: ['D3', 'F#3', 'A3'] },
  { bar: 6, notes: ['E3', 'G#3', 'B3'] }
];

function chordForBar(bar, mode) {
  const chords = mode === 'major' ? CHORDS_MAJOR : CHORDS_MINOR;
  let current = chords[0];
  for (const entry of chords) {
    if (entry.bar <= bar) current = entry;
  }
  return current;
}

// Contracanto de persecución: notas largas, como un theremin sobre el galope.
const CHASE_LEAD = [
  [1, 0, 'E5', 8], [1, 8, 'F5', 8],
  [2, 0, 'E5', 8], [2, 8, 'D5', 8],
  [3, 0, 'C5', 8], [3, 8, 'B4', 8],
  [4, 0, 'C5', 8], [4, 8, 'E5', 8],
  [5, 0, 'F5', 8], [5, 8, 'E5', 8],
  [6, 0, 'D5', 8], [6, 8, 'B4', 8],
  [7, 0, 'A4', 16]
];

const LEAD_BY_STEP = (() => {
  const map = new Map();
  for (const [bar, step, note, length] of CHASE_LEAD) {
    const absolute = bar * 16 + step;
    if (!map.has(absolute)) map.set(absolute, []);
    map.get(absolute).push({ note, length });
  }
  return map;
})();

const ARP_PATTERN = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3];

const BELLS = {
  none: [],
  sparse: [[4, 8, 'A5']],
  win: [[4, 8, 'E6'], [6, 0, 'C#6'], [7, 0, 'A5'], [7, 8, 'E6']],
  true: [[2, 8, 'A5'], [4, 0, 'E6'], [5, 4, 'C#6'], [6, 8, 'A5'], [7, 0, 'E6'], [7, 8, 'A6']]
};

// ---------------------------------------------------------------------------
// Mezclas por estado. La suma de capas es la composición.
// ---------------------------------------------------------------------------

const mix = (values) => Object.freeze({
  drone: 0, box: 0, bass: 0, pad: 0, strings: 0, stringsMajor: 0,
  tick: 0, heart: 0, drum: 0, drive: 0, roll: 0, arp: 0, choir: 0, lead: 0,
  sub: 0, siren: 0, horn: 0, bell: 0, air: 0, breath: 0, ...values
});

export const STATE_CONFIG = Object.freeze({
  menu: {
    label: 'Menú',
    tagline: 'Caja de música, aire y un bajo que apenas se mueve.',
    blurb: 'La pieza se presenta sola: caja de música, aire y un bajo que apenas se mueve.',
    mix: mix({ drone: .52, box: .56, pad: .30, strings: .06, bell: .06, air: .22 }),
    boxFilter: 'all', boxBars: null, mode: 'minor', warp: 0, tempo: 1,
    filter: 12000, bass: 'none', tick: 'none', heart: 'none', bell: 'sparse'
  },
  ambient: {
    label: 'Ambiente',
    tagline: 'Pulso y bajo pizzicato; nada tiene prisa todavía.',
    blurb: 'Entran el pulso y el bajo pizzicato. Nada tiene prisa todavía.',
    mix: mix({ drone: .60, box: .50, bass: .26, pad: .33, strings: .10, heart: .16, bell: .05, air: .30, breath: .05 }),
    boxFilter: 'strong', boxBars: null, mode: 'minor', warp: 0, tempo: 1,
    filter: 12000, bass: 'whole', tick: 'none', heart: 'slow', bell: 'sparse'
  },
  chase: {
    label: 'Persecución',
    tagline: '160 BPM: clave, redoblante, coro y metales.',
    blurb: 'La pieza sube a 160 BPM: arpegio de clave, redoblante, tambores, galope, coro, theremin, sirena y metales. Ya no insinúa correr: corre.',
    mix: mix({
      drone: .42, box: .20, bass: .55, pad: .16, strings: .18,
      tick: .45, heart: .42, drum: .52, drive: .38, roll: .50,
      arp: .52, choir: .28, lead: .38, sub: .20, siren: .18,
      horn: .32, air: .26, breath: .08
    }),
    boxFilter: 'all', boxBars: [0, 1, 4, 7], mode: 'minor', warp: 0, tempo: 2.2222, boost: 1.3,
    filter: 16000, bass: 'eighths', tick: 'run', heart: 'beat', drum: 'run',
    drive: 'run', roll: 'run', arp: 'run', choir: 'run', lead: 'run',
    horn: 'swell', crash: 'run', bell: 'none'
  },
  near: {
    label: 'Al lado',
    tagline: '148 BPM, corazón, coro y sirena.',
    blurb: 'La pieza se queda a 148 BPM: corazón, subgraves, coro, sirena y una segunda menor. El aire se espesa y el galope se acerca.',
    mix: mix({
      drone: .70, box: .22, bass: .34, pad: .28, strings: .40,
      tick: .50, heart: .80, drum: .32, drive: .22, roll: .28,
      arp: .24, choir: .22, lead: .16, sub: .60, siren: .24,
      horn: .10, air: .40, breath: .40
    }),
    boxFilter: 'strong', boxBars: [0, 1, 7], mode: 'minor', warp: -30, tempo: 2.0556, boost: 1.15,
    filter: 12000, bass: 'eighths', tick: 'eighths', heart: 'beat', drum: 'run',
    drive: 'run', roll: 'run', arp: 'run', choir: 'run', lead: 'run',
    horn: 'none', crash: 'none', bell: 'none'
  },
  lose: {
    label: 'Derrota',
    tagline: 'La caja se desafina y el filtro se cierra.',
    blurb: 'Todo cae una octava. La caja se desafina, la sirena se apaga y el filtro se cierra.',
    mix: mix({ drone: .55, box: .40, bass: .12, pad: .22, strings: .18, sub: .25, siren: .05, air: .30, breath: .15 }),
    boxFilter: 'all', boxBars: null, mode: 'minor', warp: -55, tempo: 0.9,
    filter: 850, bass: 'none', tick: 'none', heart: 'none', bell: 'none'
  },
  win: {
    label: 'Victoria',
    tagline: 'La misma melodía, en modo mayor.',
    blurb: 'La misma melodía, en modo mayor. Las campanas resuelven.',
    mix: mix({ drone: .38, box: .60, bass: .26, pad: .38, stringsMajor: .30, bell: .28, air: .20 }),
    boxFilter: 'all', boxBars: null, mode: 'major', warp: 0, tempo: 1,
    filter: 14000, bass: 'halves', tick: 'none', heart: 'none', bell: 'win'
  },
  truewin: {
    label: 'Victoria verdadera',
    tagline: 'Campanas, cuerdas y coro.',
    blurb: 'Se suman campanas, cuerdas y coro. La pieza respira completa.',
    mix: mix({ drone: .42, box: .68, bass: .34, pad: .50, stringsMajor: .45, bell: .50, air: .24 }),
    boxFilter: 'all', boxBars: null, mode: 'major', warp: 0, tempo: 1,
    filter: 16000, bass: 'halves', tick: 'none', heart: 'none', bell: 'true'
  }
});

export const STATE_ORDER = Object.freeze(['menu', 'paused', 'ambient', 'chase', 'near', 'lose', 'win', 'truewin']);

export const LAYER_INFO = Object.freeze([
  { key: 'drone', name: 'Drone', hint: 'A1–E2 sostenido' },
  { key: 'box', name: 'Caja de música', hint: 'la melodía' },
  { key: 'bass', name: 'Bajo pizzicato', hint: 'raíces del acorde' },
  { key: 'pad', name: 'Pad de cuerdas', hint: 'acordes largos' },
  { key: 'strings', name: 'Cluster menor', hint: 'segunda menor' },
  { key: 'stringsMajor', name: 'Cluster mayor', hint: 'resolución' },
  { key: 'tick', name: 'Tic-tac', hint: 'corcheas secas' },
  { key: 'heart', name: 'Pulso', hint: 'latido grave' },
  { key: 'drum', name: 'Tambores', hint: 'carrera' },
  { key: 'drive', name: 'Galope', hint: 'cuerdas en 16' },
  { key: 'roll', name: 'Redoblante', hint: 'redoble militar' },
  { key: 'arp', name: 'Clave', hint: 'arpegio en 16' },
  { key: 'choir', name: 'Coro', hint: 'voces sin palabras' },
  { key: 'lead', name: 'Theremin', hint: 'contracanto' },
  { key: 'sub', name: 'Subgraves', hint: 'presión' },
  { key: 'siren', name: 'Alerta', hint: 'sirena lejana' },
  { key: 'horn', name: 'Metales', hint: 'peso grave' },
  { key: 'bell', name: 'Campanas', hint: 'ornamentos' },
  { key: 'air', name: 'Aire', hint: 'ruido filtrado' },
  { key: 'breath', name: 'Aliento', hint: 'presencia cercana' }
]);

export const LAYER_KEYS = Object.freeze(LAYER_INFO.map(layer => layer.key));

// Índice de notas por paso para no recorrer la melodía entera en cada paso.
const MELODY_BY_STEP = (() => {
  const map = new Map();
  MELODY.forEach((entry, order) => {
    const [bar, step, note, length] = entry;
    const absolute = bar * 16 + step;
    if (!map.has(absolute)) map.set(absolute, []);
    map.get(absolute).push({ note, length, order, bar, step });
  });
  return map;
})();

const BELLS_BY_STEP = (() => {
  const map = new Map();
  for (const [name, events] of Object.entries(BELLS)) {
    for (const [bar, step, note] of events) {
      const absolute = bar * 16 + step;
      if (!map.has(absolute)) map.set(absolute, []);
      map.get(absolute).push({ pattern: name, note });
    }
  }
  return map;
})();

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

const LOOKAHEAD = 0.28;
const PUMP_MS = 30;

function centsToRatio(cents) {
  return Math.pow(2, cents / 1200);
}

export function createHorrorScore(options = {}) {
  const {
    audioContext: providedContext = null,
    destination: providedDestination = null,
    volume = 0.7,
    state = 'menu',
    reverb = true
  } = options;

  let ctx = providedContext || null;
  const ownsContext = !providedContext;
  let graph = null;
  let disposed = false;
  let running = false;
  let timer = 0;
  let baseState = STATE_CONFIG[state] ? state : 'menu';
  let paused = false;
  let masterVolume = clamp(Number(volume) || 0, 0, 1);
  let nextStepIndex = 0;
  let nextStepTime = 0;
  let leadLastFreq = 0;
  let filterTarget = STATE_CONFIG[baseState].filter;
  const listeners = new Set();

  const AudioCtor = () => {
    if (typeof window === 'undefined') return null;
    return window.AudioContext || window.webkitAudioContext || null;
  };

  function makeGain(value = 0) {
    const node = ctx.createGain();
    node.gain.value = value;
    return node;
  }

  function makePanner(pan = 0) {
    if (typeof ctx.createStereoPanner !== 'function') return null;
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
    if (!ctx) throw new Error('WebAudio no está disponible en este navegador.');

    const scoreBus = makeGain(0.62);
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = filterTarget;
    lowpass.Q.value = 0.6;

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -9;
    limiter.knee.value = 18;
    limiter.ratio.value = 3;
    limiter.attack.value = 0.008;
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
    const wet = makeGain(reverb ? 0.34 : 0.0001);
    reverbNode.connect(wet);
    wet.connect(scoreBus);

    const layers = {};
    for (const key of LAYER_KEYS) {
      const gain = makeGain(0);
      gain.connect(scoreBus);
      layers[key] = gain;
      const sendAmount = {
        drone: .18, box: .52, bass: .22, pad: .58, strings: .40, stringsMajor: .40,
        tick: .12, heart: .05, drum: .06, drive: .22, roll: .10, arp: .30,
        choir: .55, lead: .45, sub: .04, siren: .48, horn: .38, bell: .62,
        air: .50, breath: .55
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

    // --- capas continuas -----------------------------------------------------
    const start = ctx.currentTime + 0.06;

    // Drone: dos afinaciones casi iguales, un quinto y un sub.
    {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 210;
      filter.Q.value = 0.8;
      filter.connect(layers.drone);
      const tones = [
        { type: 'sine', freq: 55, gain: .20, detune: 0 },
        { type: 'sine', freq: 55, gain: .13, detune: 7 },
        { type: 'triangle', freq: 110, gain: .05, detune: -5 },
        { type: 'sine', freq: 82.5, gain: .07, detune: 2 },
        { type: 'sine', freq: 27.5, gain: .10, detune: 0 }
      ];
      for (const tone of tones) {
        const osc = ctx.createOscillator();
        osc.type = tone.type;
        osc.frequency.value = tone.freq;
        osc.detune.value = tone.detune;
        const gain = makeGain(tone.gain);
        osc.connect(gain);
        gain.connect(filter);
        osc.start(start);
      }
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.06;
      const lfoGain = makeGain(55);
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      lfo.start(start);
    }

    // Cuerdas: cluster menor y su versión mayor comparten filtro.
    const buildStrings = (bus, freqs) => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1050;
      filter.Q.value = 0.5;
      filter.connect(bus);
      for (const freq of freqs) {
        for (const detune of [-7, 7]) {
          const osc = ctx.createOscillator();
          osc.type = 'sawtooth';
          osc.frequency.value = freq;
          osc.detune.value = detune;
          const gain = makeGain(0.043);
          osc.connect(gain);
          gain.connect(filter);
          osc.start(start);
          const vibrato = ctx.createOscillator();
          vibrato.frequency.value = 0.17 + Math.random() * 0.08;
          const vibratoGain = makeGain(3.5);
          vibrato.connect(vibratoGain);
          vibratoGain.connect(osc.detune);
          vibrato.start(start);
        }
      }
    };
    buildStrings(layers.strings, [220, 233.08, 329.63]);
    buildStrings(layers.stringsMajor, [220, 277.18, 329.63]);

    // Subgraves con pulso lento.
    {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 55;
      const osc2 = ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.value = 36.7;
      const gain = makeGain(.17);
      const gain2 = makeGain(.05);
      osc.connect(gain);
      gain.connect(layers.sub);
      osc2.connect(gain2);
      gain2.connect(layers.sub);
      osc.start(start);
      osc2.start(start);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 1.05;
      const depth = makeGain(.06);
      lfo.connect(depth);
      depth.connect(gain.gain);
      lfo.start(start);
    }

    // Aire: ruido muy filtrado que respira.
    {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 420;
      band.Q.value = 0.65;
      const gain = makeGain(.032);
      src.connect(band);
      band.connect(gain);
      gain.connect(layers.air);
      src.start(start);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      const depth = makeGain(.015);
      lfo.connect(depth);
      depth.connect(gain.gain);
      lfo.start(start);
    }

    // Aliento: una banda más aguda, casi una voz sin voz.
    {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 820;
      band.Q.value = 1.6;
      const high = ctx.createBiquadFilter();
      high.type = 'highpass';
      high.frequency.value = 380;
      const gain = makeGain(.028);
      src.connect(band);
      band.connect(high);
      high.connect(gain);
      gain.connect(layers.breath);
      src.start(start);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05;
      const depth = makeGain(.022);
      lfo.connect(depth);
      depth.connect(gain.gain);
      lfo.start(start);
    }

    // Alerta: dos tonos a un semitono que se turnan lentamente. Suena a una
    // sirena de emergencia oída desde otro pasillo, no a una alarma de fábrica.
    {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1250;
      filter.Q.value = 0.7;
      filter.connect(layers.siren);
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.62;
      const tones = [
        { freq: 220, gain: .34, depth: .34 },
        { freq: 233.08, gain: .34, depth: -.34 },
        { freq: 440, gain: .07, depth: .07 }
      ];
      for (const tone of tones) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = tone.freq;
        const gain = makeGain(tone.gain);
        osc.connect(gain);
        gain.connect(filter);
        osc.start(start);
        const depth = makeGain(tone.depth);
        lfo.connect(depth);
        depth.connect(gain.gain);
      }
      lfo.start(start);
    }

    graph = { scoreBus, lowpass, limiter, master, analyser, layers, noiseBuffer, reverbNode, wet };
    applyMix(STATE_CONFIG[baseState].mix, 0.01);
    lowpass.frequency.setTargetAtTime(filterTarget, ctx.currentTime, 0.2);
    return graph;
  }

  // --- voces ---------------------------------------------------------------

  function musicBox(time, frequency, steps, cfg, stepSeconds = STEP_SECONDS) {
    if (!frequency) return;
    const layers = graph.layers;
    const duration = Math.max(0.3, steps * stepSeconds * 1.9);
    const frequencySafe = frequency * centsToRatio(cfg.warp || 0);
    const pan = ((Math.round(frequencySafe) % 7) - 3) * 0.05;
    const partials = [
      { ratio: 1, gain: .085, decay: duration },
      { ratio: 2.001, gain: .028, decay: duration * 0.62 },
      { ratio: 3.007, gain: .012, decay: duration * 0.42 },
      { ratio: 4.98, gain: .006, decay: duration * 0.28 }
    ];
    for (const partial of partials) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequencySafe * partial.ratio;
      osc.detune.value = (Math.random() * 2 - 1) * 3;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(partial.gain, time + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + partial.decay);
      osc.connect(gain);
      route(gain, layers.box, pan);
      osc.start(time);
      osc.stop(time + partial.decay + 0.05);
    }
    // pequeño ruido mecánico del martillo
    const src = ctx.createBufferSource();
    src.buffer = graph.noiseBuffer;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2600;
    band.Q.value = 3;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.012, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.035);
    src.connect(band);
    band.connect(noiseGain);
    route(noiseGain, layers.box, pan);
    src.start(time, Math.random() * 1.5, 0.06);
  }

  function pizzicato(time, frequency, gainAmount = 1, decay = 0.42) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = frequency;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = frequency * 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 460;
    const gain = ctx.createGain();
    const peak = 0.24 * gainAmount;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + decay);
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
        osc.type = 'sawtooth';
        osc.frequency.value = frequency;
        osc.detune.value = detune;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 760;
        filter.Q.value = 0.4;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.linearRampToValueAtTime(0.052, time + Math.min(1.2, duration * 0.35));
        gain.gain.setValueAtTime(0.052, holdEnd);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
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
    high.type = 'highpass';
    high.frequency.value = 2600;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = accent ? 4200 : 3600;
    band.Q.value = 7;
    const gain = ctx.createGain();
    const peak = accent ? 0.085 : 0.05;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
    src.connect(high);
    high.connect(band);
    band.connect(gain);
    gain.connect(graph.layers.tick);
    src.start(time, Math.random() * 1.2, 0.08);
  }

  function heartbeat(time, gainAmount = 1) {
    const thump = (offset, scale) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(62, time + offset);
      osc.frequency.exponentialRampToValueAtTime(38, time + offset + 0.14);
      const gain = ctx.createGain();
      const peak = 0.3 * scale * gainAmount;
      gain.gain.setValueAtTime(0.0001, time + offset);
      gain.gain.linearRampToValueAtTime(peak, time + offset + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + offset + 0.22);
      osc.connect(gain);
      gain.connect(graph.layers.heart);
      osc.start(time + offset);
      osc.stop(time + offset + 0.26);
    };
    thump(0, 1);
    thump(0.17, 0.62);
  }

  // Galope: cuerdas cortas en semicorcheas. Es lo que empuja a correr.
  function drive(time, frequency, gainAmount = 1) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = frequency;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1250;
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.075 * gainAmount, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(graph.layers.drive);
    osc.start(time);
    osc.stop(time + 0.14);
  }

  function tom(time, gainAmount = 1, ghost = false) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(ghost ? 128 : 96, time);
    osc.frequency.exponentialRampToValueAtTime(ghost ? 72 : 46, time + 0.12);
    const gain = ctx.createGain();
    const peak = (ghost ? 0.075 : 0.19) * gainAmount;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + (ghost ? 0.12 : 0.2));
    osc.connect(gain);
    gain.connect(graph.layers.drum);
    osc.start(time);
    osc.stop(time + 0.22);
  }

  function snare(time, gainAmount = 1, layer = graph.layers.drum) {
    const src = ctx.createBufferSource();
    src.buffer = graph.noiseBuffer;
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 1200;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2100;
    band.Q.value = 1.1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.1 * gainAmount, time + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.08);
    src.connect(high);
    high.connect(band);
    band.connect(gain);
    gain.connect(layer);
    src.start(time, Math.random() * 1.2, 0.1);
  }

  // Clave: arpegio de pluma, brillante y corto, sobre el acorde del compás.
  function arpNote(time, frequency, gainAmount = 1, pan = 0) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = frequency;
    const octave = ctx.createOscillator();
    octave.type = 'sine';
    octave.frequency.value = frequency * 2.004;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 280;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.05 * gainAmount, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.11);
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

  // Coro: voces sin palabras, con formante, sostenidas sobre el acorde.
  function choirChord(time, notes, duration, cfg) {
    const attack = Math.min(0.6, duration * 0.22);
    const hold = Math.max(time + attack + 0.2, time + duration - 0.9);
    for (const name of notes) {
      const frequency = noteFrequency(name) * centsToRatio((cfg.warp || 0) * 0.2);
      for (const detune of [-9, 9]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = frequency;
        osc.detune.value = detune;
        const formant = ctx.createBiquadFilter();
        formant.type = 'bandpass';
        formant.frequency.value = 720;
        formant.Q.value = 1.3;
        const low = ctx.createBiquadFilter();
        low.type = 'lowpass';
        low.frequency.value = 1900;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, time);
        gain.gain.linearRampToValueAtTime(0.03, time + attack);
        gain.gain.setValueAtTime(0.03, hold);
        gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
        osc.connect(formant);
        formant.connect(low);
        low.connect(gain);
        gain.connect(graph.layers.choir);
        osc.start(time);
        osc.stop(time + duration + 0.05);
      }
    }
  }

  // Theremin: contracanto con vibrato y un pequeño portamento entre notas.
  function leadNote(time, frequency, steps, stepSeconds) {
    const duration = Math.max(0.45, steps * stepSeconds);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    const octave = ctx.createOscillator();
    octave.type = 'sine';
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
    filter.type = 'lowpass';
    filter.frequency.value = 2400;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.075, time + 0.07);
    gain.gain.setValueAtTime(0.075, time + Math.max(0.2, duration - 0.25));
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration + 0.3);
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
      osc.type = 'sawtooth';
      osc.frequency.value = frequency * ratio;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 780;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(level, time + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.2);
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
    high.type = 'highpass';
    high.frequency.value = 3200;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.07, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 1.1);
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
      osc.type = 'sawtooth';
      osc.frequency.value = frequency * ratio;
      osc.detune.value = ratio === 1 ? -4 : 4;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 520;
      filter.Q.value = 0.6;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(level, time + 0.35);
      gain.gain.setValueAtTime(level, time + duration - 0.7);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(graph.layers.horn);
      osc.start(time);
      osc.stop(time + duration + 0.05);
    }
  }

  function bell(time, frequency, gainAmount = 1) {
    const partials = [
      { ratio: 1, gain: .09 },
      { ratio: 2.01, gain: .035 },
      { ratio: 4.16, gain: .012 }
    ];
    for (const partial of partials) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency * partial.ratio;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(partial.gain * gainAmount, time + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + 3.2);
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
    band.type = 'bandpass';
    band.frequency.setValueAtTime(500, time);
    band.frequency.linearRampToValueAtTime(1100, time + length);
    band.Q.value = 1.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.05, time + length * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + length);
    src.connect(band);
    band.connect(gain);
    gain.connect(graph.layers.breath);
    src.start(time, Math.random() * 0.6, length + 0.1);
  }

  function lowBoom(time) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(68, time);
    osc.frequency.exponentialRampToValueAtTime(28, time + 1.4);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.24, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 2.2);
    osc.connect(gain);
    gain.connect(graph.layers.sub);
    osc.start(time);
    osc.stop(time + 2.3);
  }

  // Aviso de peligro: dos tonos alternos, cortos, por encima de la mezcla.
  // No cambia de estado; sirve para subrayar un cambio de dificultad.
  function alertTone(time, frequency, gainAmount = 1) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(frequency, time);
    osc.frequency.linearRampToValueAtTime(frequency * 1.004, time + 0.2);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2400;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.095 * gainAmount, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.36);
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
      const note = index % 2 === 0 ? 'A4' : 'E5';
      alertTone(time + index * 0.3, noteFrequency(note), 0.8 + index * 0.06);
    }
    if (steps >= 3) heartbeat(time + 0.05, 0.55);
    if (steps >= 4) lowBoom(time + 0.1);
    return true;
  }

  // --- secuenciador --------------------------------------------------------

  function shouldPlayBox(cfg, note) {
    if (cfg.boxBars && !cfg.boxBars.includes(note.bar)) return false;
    if (cfg.boxFilter === 'strong' && note.step % 8 !== 0) return false;
    return true;
  }

  function scheduleStep(stepIndex, time) {
    const step = ((stepIndex % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS;
    const bar = Math.floor(step / 16);
    const inBar = step % 16;
    const cfg = STATE_CONFIG[baseState] || STATE_CONFIG.ambient;
    const mode = cfg.mode || 'minor';
    const stepSeconds = STEP_SECONDS / (cfg.tempo || 1);
    const bassDecay = Math.min(0.42, Math.max(0.16, stepSeconds * 1.9));
    const roots = mode === 'major' ? BASS_MAJOR : BASS_MINOR;
    const root = noteFrequency(roots[bar]);
    const chord = chordForBar(bar, mode);

    // Melodía
    const notes = MELODY_BY_STEP.get(step);
    if (notes) {
      for (const note of notes) {
        if (!shouldPlayBox(cfg, note)) continue;
        const name = mode === 'major' ? toMajor(note.note) : note.note;
        musicBox(time, noteFrequency(name), note.length, cfg, stepSeconds);
      }
    }

    // Bajo
    if (cfg.bass !== 'none') {
      if (cfg.bass === 'whole' && (inBar === 0 || inBar === 10)) {
        pizzicato(time, root, inBar === 0 ? 1 : 0.72, bassDecay);
      } else if (cfg.bass === 'halves' && (inBar === 0 || inBar === 8)) {
        pizzicato(time, root, .9, bassDecay);
      } else if (cfg.bass === 'eighths' && inBar % 2 === 0) {
        const accent = inBar === 0 ? 1 : 0.72;
        const push = inBar === 12 ? Math.pow(2, 7 / 12) : 1;
        pizzicato(time, root * push, accent, bassDecay);
      }
    }

    // Acordes largos
    if (inBar === 0 && chord.bar === bar) {
      padChord(time, chord.notes, 8, cfg, stepSeconds);
    }

    // Pulso
    if (cfg.heart === 'slow' && inBar === 0 && bar % 2 === 0) heartbeat(time, .8);
    else if (cfg.heart === 'half' && (inBar === 0 || inBar === 8)) heartbeat(time, inBar === 0 ? 1 : .75);
    else if (cfg.heart === 'beat' && inBar % 4 === 0) heartbeat(time, inBar === 0 ? 1 : .7);

    // Tic-tac
    if (cfg.tick === 'offbeat' && inBar % 4 === 2) tick(time, inBar % 8 === 6);
    else if (cfg.tick === 'eighths' && inBar % 2 === 0) tick(time, inBar % 4 === 0);
    else if (cfg.tick === 'run' && (inBar % 2 === 0 || inBar === 15)) {
      tick(time, inBar % 4 === 0);
    } else if (cfg.tick === 'sixteenths') {
      tick(time, inBar % 4 === 0);
    }

    // Tambores de carrera: corcheas con acentos, caja en 2 y 4, codos al final.
    if (cfg.drum === 'run') {
      if (inBar % 2 === 0) {
        const accent = inBar % 8 === 0 ? 1 : (inBar % 4 === 0 ? 0.72 : 0.5);
        tom(time, accent, inBar % 4 !== 0);
      }
      if (inBar === 7 || inBar === 15) tom(time, 0.36, true);
      if (inBar === 4 || inBar === 12) snare(time, 0.85);
      if (inBar === 15) snare(time, 0.3);
    }

    // Galope de cuerdas: corcheas con pickup al final del compás.
    if (cfg.drive === 'run' && (inBar % 2 === 0 || inBar === 15)) {
      const eighths = inBar % 2 === 0;
      const offsets = [0, 0, 7, 0, 0, 7, 0, 0];
      const offset = eighths ? offsets[(inBar / 2) | 0] : 12;
      const gain = eighths ? (inBar % 4 === 0 ? 1 : 0.7) : 0.35;
      drive(time, root * 2 * Math.pow(2, offset / 12), gain);
    }

    // Redoblante militar: semicorcheas en los compases de tensión.
    if (cfg.roll === 'run' && [0, 1, 4, 5, 7].includes(bar)) {
      snare(time, inBar % 4 === 0 ? 0.55 : 0.28, graph.layers.roll);
    }

    // Clave: arpegio de semicorcheas sobre el acorde, una octava arriba.
    if (cfg.arp === 'run' && bar !== 6) {
      const base = chord.notes.map(noteFrequency);
      const freqs = [base[0], base[1], base[2], base[0] * 2];
      arpNote(
        time,
        freqs[ARP_PATTERN[inBar]] * 2,
        inBar % 4 === 0 ? 1 : 0.7,
        inBar % 2 === 0 ? -0.22 : 0.22
      );
    }

    // Coro: entra en los compases fuertes del arco, no en todos.
    if (cfg.choir === 'run' && inBar === 0 && [0, 2, 6].includes(bar)) {
      choirChord(time, chord.notes, 32 * stepSeconds + 0.8, cfg);
    }

    // Theremin: contracanto de notas largas desde el compás 2.
    if (cfg.lead === 'run') {
      const events = LEAD_BY_STEP.get(step);
      if (events) {
        for (const event of events) {
          leadNote(time, noteFrequency(event.note), event.length, stepSeconds);
        }
      }
    }

    // Metales: swell cada cuatro compases y stabs en contratiempos.
    if (cfg.horn === 'swell') {
      if (inBar === 0 && bar % 4 === 0) hornSwell(time, root);
      if (bar >= 2 && inBar % 4 === 2) brassStab(time, root);
    }

    // Crash al empezar los bloques de cuatro compases; boom grave al abrir la vuelta.
    if (cfg.crash === 'run' && (bar === 0 || bar === 4) && inBar === 0) {
      crash(time);
      if (bar === 0) lowBoom(time);
    }

    // Campanas
    if (cfg.bell !== 'none') {
      const events = BELLS_BY_STEP.get(step);
      if (events) {
        for (const event of events) {
          if (event.pattern === cfg.bell) {
            bell(time, noteFrequency(event.note), cfg.bell === 'true' ? 1 : .8);
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
    // Si el navegador durmió la pestaña, saltamos al presente sin repetir notas.
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
    const boost = (STATE_CONFIG[baseState] && STATE_CONFIG[baseState].boost) || 1;
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
    if (name === 'win') {
      const notes = ['A4', 'C#5', 'E5', 'A5'];
      notes.forEach((note, index) => bell(time + index * 0.16, noteFrequency(note), .7));
    } else if (name === 'truewin') {
      const notes = ['A3', 'C#4', 'E4', 'A4', 'C#5', 'E5', 'A5'];
      notes.forEach((note, index) => bell(time + index * 0.13, noteFrequency(note), .75));
      breathSwell(time, 3.4);
    } else if (name === 'lose') {
      lowBoom(time);
      musicBox(time + 0.1, noteFrequency('A4') * centsToRatio(-70), 8, STATE_CONFIG.lose);
    } else if (name === 'chase') {
      alert(2);
      drumFill(time);
    } else if (name === 'near') {
      alert(3);
      breathSwell(time, 1.6);
      heartbeat(time + 0.05, 1.1);
    }
  }

  function emit() {
    const payload = { state: paused ? 'paused' : baseState, baseState, paused, running };
    for (const listener of listeners) {
      try { listener(payload); } catch { /* ignore */ }
    }
  }

  function setState(name) {
    if (disposed) return getState();
    if (name === 'paused') {
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
    applyFilter(cfg.filter, name === 'lose' ? 1.6 : 0.6);
    applyMix(cfg.mix, name === 'lose' ? 1.4 : 0.9);
    if (changed && graph && running) stinger(name, (ctx.currentTime || 0) + 0.05);
    emit();
    return getState();
  }

  function getState() {
    return {
      state: paused ? 'paused' : baseState,
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
    try { ctx.resume?.(); } catch { /* ignore */ }
    return true;
  }

  function stop() {
    running = false;
    if (timer) clearInterval(timer);
    timer = 0;
    if (graph) {
      graph.master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08);
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
    if (typeof listener !== 'function') return () => {};
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
      try { graph.analyser.disconnect(); } catch { /* ignore */ }
      try { graph.wet.disconnect(); } catch { /* ignore */ }
    }
    if (ownsContext && ctx && typeof ctx.close === 'function') {
      try { ctx.close(); } catch { /* ignore */ }
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
    getAnalyser: () => (graph ? graph.analyser : null),
    getContext: () => ctx
  };
}

export default createHorrorScore;
