import {
  createHorrorScore,
  STATE_CONFIG,
  STATE_ORDER,
  LAYER_INFO,
  LAYER_KEYS,
  BPM,
  BARS
} from './score-engine.js';

const PAUSE_INFO = {
  label: 'Pausa',
  tagline: 'El estado anterior detrás de una puerta.',
  blurb: 'El estado anterior detrás de una puerta: el filtro baja a 680 Hz, el pulso se apaga y todo pierde peso.'
};

const TOUR = [
  ['menu', 9000],
  ['ambient', 11000],
  ['chase', 10000],
  ['near', 9000],
  ['ambient', 7000],
  ['paused', 6000],
  ['win', 9000],
  ['truewin', 9000],
  ['lose', 8000]
];

const engine = createHorrorScore({ volume: 0.72, state: 'menu' });

const elements = {
  power: document.getElementById('power'),
  powerLabel: document.getElementById('power-label'),
  alert: document.getElementById('alert'),
  tour: document.getElementById('tour'),
  volume: document.getElementById('volume'),
  nowName: document.getElementById('now-name'),
  nowBlurb: document.getElementById('now-blurb'),
  nowMeta: document.getElementById('now-meta'),
  hint: document.getElementById('hint'),
  states: document.getElementById('states'),
  matrix: document.getElementById('matrix'),
  meter: document.getElementById('meter')
};

const stateButtons = new Map();
let tourIndex = 0;
let tourTimer = 0;
let started = false;

// --- construcción de la interfaz ------------------------------------------

function pad(index) {
  return String(index + 1).padStart(2, '0');
}

function stateInfo(name) {
  if (name === 'paused') return PAUSE_INFO;
  return STATE_CONFIG[name];
}

function miniStrip(name) {
  const config = name === 'paused' ? null : STATE_CONFIG[name];
  const strip = document.createElement('span');
  strip.className = 'state-layers';
  strip.setAttribute('aria-hidden', 'true');
  for (const key of LAYER_KEYS) {
    const tick = document.createElement('span');
    tick.className = 'state-tick';
    const value = config ? (config.mix[key] || 0) : 0;
    tick.style.setProperty('--v', String(value));
    strip.append(tick);
  }
  return strip;
}

function buildStates() {
  STATE_ORDER.forEach((name, index) => {
    const info = stateInfo(name);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'state';
    button.dataset.state = name;
    button.setAttribute('aria-pressed', 'false');

    const number = document.createElement('span');
    number.className = 'state-index';
    number.textContent = pad(index);

    const body = document.createElement('span');
    body.className = 'state-body';

    const label = document.createElement('span');
    label.className = 'state-name';
    label.textContent = info.label;
    if (name === 'paused') {
      const tag = document.createElement('span');
      tag.className = 'state-tag';
      tag.textContent = 'tratamiento';
      label.append(tag);
    }

    const blurb = document.createElement('span');
    blurb.className = 'state-blurb';
    blurb.textContent = info.blurb;

    body.append(label, blurb, miniStrip(name));
    button.append(number, body);

    const layerCount = name === 'paused'
      ? 'hereda las capas'
      : `${LAYER_KEYS.filter(key => (STATE_CONFIG[name].mix[key] || 0) > 0.02).length} capas activas`;
    const meta = document.createElement('span');
    meta.className = 'state-meta';
    meta.textContent = layerCount;
    body.append(meta);

    button.addEventListener('click', () => {
      stopTour();
      ensureStarted();
      engine.setState(name);
    });

    elements.states.append(button);
    stateButtons.set(name, button);
  });
}

function buildMatrix() {
  const columns = STATE_ORDER.filter(name => name !== 'paused');
  const template = `180px repeat(${columns.length}, minmax(58px, 1fr))`;

  const head = document.createElement('div');
  head.className = 'matrix-row matrix-head';
  head.style.gridTemplateColumns = template;
  const corner = document.createElement('div');
  corner.className = 'matrix-cell layer';
  corner.textContent = 'Capa';
  head.append(corner);
  for (const name of columns) {
    const cell = document.createElement('div');
    cell.className = 'matrix-cell';
    cell.textContent = name === 'truewin' ? 'Verdad.' : STATE_CONFIG[name].label;
    head.append(cell);
  }
  elements.matrix.append(head);

  for (const layer of LAYER_INFO) {
    const row = document.createElement('div');
    row.className = 'matrix-row';
    row.style.gridTemplateColumns = template;
    const label = document.createElement('div');
    label.className = 'matrix-cell layer';
    const name = document.createElement('span');
    name.textContent = layer.name;
    const hint = document.createElement('span');
    hint.className = 'matrix-hint';
    hint.textContent = layer.hint;
    label.append(name, hint);
    row.append(label);

    for (const state of columns) {
      const cell = document.createElement('div');
      cell.className = 'matrix-cell';
      const value = STATE_CONFIG[state].mix[layer.key] || 0;
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.setProperty('--v', String(value));
      dot.title = `${layer.name} en ${STATE_CONFIG[state].label}: ${Math.round(value * 100)} %`;
      cell.append(dot);
      row.append(cell);
    }
    elements.matrix.append(row);
  }
}

// --- estado visible --------------------------------------------------------

function ensureStarted() {
  if (engine.isRunning()) return;
  try {
    engine.start();
    started = true;
  } catch (error) {
    elements.hint.textContent = 'Este navegador no pudo iniciar WebAudio.';
    console.error(error);
  }
}

function renderNow(payload = engine.getState()) {
  const name = payload.state;
  const info = stateInfo(name);
  const running = engine.isRunning();
  const config = name === 'paused' ? STATE_CONFIG[payload.baseState] : STATE_CONFIG[name];

  elements.nowName.textContent = info.label;
  elements.nowBlurb.textContent = info.tagline || info.blurb;
  elements.hint.hidden = running;
  elements.powerLabel.textContent = running ? 'Detener' : 'Comenzar';
  elements.power.setAttribute('aria-pressed', String(running));
  elements.power.classList.toggle('is-on', running);
  document.body.classList.toggle('is-running', running);

  if (name === 'paused') {
    elements.nowMeta.textContent = `filtro 680 Hz · sobre ${STATE_CONFIG[payload.baseState].label.toLowerCase()}`;
  } else {
    const bpm = Math.round(BPM * (config.tempo || 1));
    elements.nowMeta.textContent = `${bpm} BPM · ${config.mode === 'major' ? 'La mayor' : 'La menor'}`;
  }

  for (const [key, button] of stateButtons) {
    const active = key === name;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

// --- medidor ---------------------------------------------------------------

const meter = {
  canvas: elements.meter,
  ctx: elements.meter.getContext('2d'),
  wave: [],
  samples: null,
  raf: 0,
  width: 0,
  height: 0,
  dpr: 1
};

const reducedMotion = typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    const sample = meter.samples
      ? meter.samples[Math.floor((index / (points - 1)) * (meter.samples.length - 1))]
      : 0;
    const target = centre + Math.tanh(sample * 7.2) * height * 0.42;
    const smooth = meter.wave[index] + (target - meter.wave[index]) * 0.35;
    meter.wave[index] = smooth;
    const x = (index / (points - 1)) * width;
    if (index === 0) pen.moveTo(x, smooth);
    else pen.lineTo(x, smooth);
  }

  // Cuerpo tenue bajo la onda, del centro hacia la línea.
  pen.save();
  pen.lineTo(width, centre);
  pen.lineTo(0, centre);
  pen.closePath();
  pen.fillStyle = 'rgba(201, 164, 92, .045)';
  pen.fill();
  pen.restore();

  pen.beginPath();
  for (let index = 0; index < points; index++) {
    const x = (index / (points - 1)) * width;
    if (index === 0) pen.moveTo(x, meter.wave[index]);
    else pen.lineTo(x, meter.wave[index]);
  }

  pen.lineJoin = 'round';
  pen.lineCap = 'round';
  pen.strokeStyle = 'rgba(201, 164, 92, .14)';
  pen.lineWidth = 6 * meter.dpr;
  pen.stroke();
  pen.strokeStyle = 'rgba(201, 164, 92, .78)';
  pen.lineWidth = 1.4 * meter.dpr;
  pen.stroke();

  pen.strokeStyle = 'rgba(233, 227, 214, 0.09)';
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

// --- recorrido -------------------------------------------------------------

function stopTour() {
  if (tourTimer) clearTimeout(tourTimer);
  tourTimer = 0;
  if (elements.tour.getAttribute('aria-pressed') === 'true') {
    elements.tour.setAttribute('aria-pressed', 'false');
    elements.tour.classList.remove('is-on');
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
  elements.tour.setAttribute('aria-pressed', 'true');
  elements.tour.classList.add('is-on');
  tourStep();
}

// --- eventos ---------------------------------------------------------------

elements.power.addEventListener('click', () => {
  if (engine.isRunning()) {
    stopTour();
    engine.stop();
  } else {
    ensureStarted();
  }
});

elements.tour.addEventListener('click', () => {
  if (tourTimer) {
    stopTour();
  } else {
    startTour();
  }
});

elements.alert.addEventListener('click', () => {
  ensureStarted();
  engine.alert(3);
});

elements.volume.style.setProperty('--fill', `${Number(elements.volume.value) * 100}%`);

elements.volume.addEventListener('input', () => {
  const value = Number(elements.volume.value);
  elements.volume.style.setProperty('--fill', `${value * 100}%`);
  engine.setVolume(value);
});

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLElement && /input|textarea|select/i.test(event.target.tagName)) return;
  if (event.code === 'Space') {
    event.preventDefault();
    elements.power.click();
    return;
  }
  if (event.key.toLowerCase() === 'a') {
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

window.addEventListener('resize', () => {
  sizeMeter();
  if (reducedMotion) drawMeter();
});

engine.subscribe(renderNow);

// --- arranque --------------------------------------------------------------

buildStates();
buildMatrix();
renderNow();
startMeter();

// Para QA desde la consola o un navegador automatizado.
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
