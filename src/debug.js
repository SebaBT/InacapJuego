import { Box3Helper, Group } from 'three';

const directions = ['KeyW', 'KeyW', 'KeyS', 'KeyS', 'KeyA', 'KeyD', 'KeyA', 'KeyD'];
const sequence = [...directions, 'Space', 'Enter'];

export function bindDebugCode(game, panel, openPanel) {
  const keys = [], moves = [];
  function remember(history, key) {
    history.push(key);
    if (history.length > sequence.length) history.shift();
  }
  function matches(history, count) {
    const start = history.length - count;
    return start >= 0 && sequence.slice(0, count).every((key, i) => history[start + i] === key);
  }
  function clear() { keys.length = 0; moves.length = 0; }
  window.addEventListener('blur', clear);
  window.addEventListener('keydown', event => {
    if (panel.open) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) { clear(); return; }
    const key = event.code === 'NumpadEnter' ? 'Enter' : event.code;
    const touch = game.classList.contains('touch');
    if (!event.repeat) remember(keys, key);
    // On desktop, Space would otherwise click the focused start button while paused.
    if (!touch && key === 'Space' && matches(keys, sequence.length - 1)) event.preventDefault();
    if (event.repeat || !matches(keys, touch ? directions.length : sequence.length)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    clear();
    openPanel();
  }, true);

  return function recordStickDirection(key) {
    if (key === null) { moves.length = 0; return; }
    if (panel.open) return;
    remember(moves, key);
    if (matches(moves, directions.length)) {
      clear();
      openPanel();
    }
  };
}

export function setupDebug(scene, actor, walk, frameView, wake, playerBody, atmosphere = null, debris = null) {
  const panel = document.querySelector('#debug'), game = document.querySelector('#game');
  const views = panel.querySelectorAll('[data-view]');
  const boxes = new Group();
  for (const box of actor.collisions) {
    const helper = new Box3Helper(box, 0xffbd63);
    helper.material.depthTest = false;
    helper.renderOrder = 5;
    boxes.add(helper);
  }
  boxes.visible = false;
  scene.add(boxes);
  const height = (actor.bounds.max.y - actor.bounds.min.y).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const stats = panel.querySelector('#model-stats');
  const suitWear = panel.querySelector('#suit-wear');
  const slider = panel.querySelector('#wear-slider'), resume = panel.querySelector('#wear-auto');
  const expressions = panel.querySelectorAll('[data-expression]');
  const animButtons = panel.querySelectorAll('[data-animation]');
  const bodyButtons = panel.querySelectorAll('[data-player-body]');
  let expression = 'normal', previousExpression = 'normal', grabAutoScream = false;
  let lastTriangles = -1, lastWear = -1;
  function updateStats() {
    const wear = actor.face.previewing ? Math.round(actor.face.wear * 100) : Math.floor(actor.face.wear * 100);
    if (wear !== lastWear) {
      suitWear.textContent = wear + ' %';
      slider.value = String(wear);
      slider.setAttribute('aria-valuetext', wear + ' %');
      lastWear = wear;
    }
    const triangles = actor.triangles;
    if (triangles === lastTriangles) return;
    stats.textContent = height + ' m · ' + triangles.toLocaleString('es-CL') + ' triángulos';
    lastTriangles = triangles;
  }
  function updateMode() {
    resume.disabled = !actor.face.previewing;
    for (const b of expressions) b.setAttribute('aria-pressed', String(!actor.face.previewing && b.dataset.expression === expression));
    for (const b of animButtons) b.setAttribute('aria-pressed', String(b.dataset.animation === actor.animation));
    if (playerBody) {
      for (const b of bodyButtons) b.setAttribute('aria-pressed', String(b.dataset.playerBody === playerBody.style));
    }
    updateStats(); wake();
  }
  slider.addEventListener('input', () => {
    grabAutoScream = false;
    actor.face.setPreviewWear(slider.valueAsNumber / 100);
    updateMode();
  });
  resume.addEventListener('click', () => {
    actor.face.setPreviewWear(null);
    updateMode();
  });
  updateStats();
  for (const button of expressions) button.addEventListener('click', () => {
    expression = button.dataset.expression;
    grabAutoScream = false;
    actor.face.setExpression(expression);
    updateMode();
  });
  for (const button of animButtons) button.addEventListener('click', () => {
    const mode = button.dataset.animation;
    actor.setAnimation(mode);
    if (mode === 'grab') {
      if (!actor.face.previewing) {
        if (expression !== 'scream') {
          previousExpression = expression;
          expression = 'scream';
          grabAutoScream = true;
        }
        actor.face.setExpression('scream');
      }
    } else if (grabAutoScream) {
      grabAutoScream = false;
      if (!actor.face.previewing) {
        expression = previousExpression;
        actor.face.setExpression(expression);
      }
    }
    updateMode();
  });
  for (const button of bodyButtons) button.addEventListener('click', () => {
    playerBody?.setStyle(button.dataset.playerBody);
    updateMode();
  });
  const recordStickDirection = bindDebugCode(game, panel, () => {
    walk.pause();
    game.classList.add('inspecting');
    walk.refreshView?.();
    updateStats();
    panel.showModal();
  });
  panel.querySelector('#debug-close').addEventListener('click', () => panel.close());
  panel.addEventListener('close', () => {
    game.classList.remove('inspecting');
    for (const b of views) b.removeAttribute('aria-pressed');
    walk.refreshView?.();
    document.querySelector('#enter').focus({ preventScroll: true });
  });
  for (const button of views) button.addEventListener('click', () => {
    frameView(button.dataset.view);
    for (const b of views) b.setAttribute('aria-pressed', String(b === button));
  });
  panel.querySelector('#debug-wire').addEventListener('change', e => {
    actor.setWireframe(e.target.checked);
    playerBody?.setWireframe(e.target.checked);
    debris?.setWireframe(e.target.checked);
    wake();
  });
  panel.querySelector('#debug-bounds').addEventListener('change', e => { boxes.visible = e.target.checked; wake(); });
  const noclipHint = panel.querySelector('#noclip-hint');
  panel.querySelector('#debug-noclip').addEventListener('change', e => {
    walk.setNoclip(e.target.checked);
    e.target.checked = walk.noclip;
    noclipHint.hidden = !walk.noclip;
  });

  if (atmosphere) {
    const presetButtons = panel.querySelectorAll('[data-env-preset]');
    const lampButtons = panel.querySelectorAll('[data-lamp]');
    const surgeBtn = panel.querySelector('#env-surge');
    const flickerCheck = panel.querySelector('#env-flicker-enabled');
    const audioCheck = panel.querySelector('#env-audio-enabled');
    const lampModeNames = { auto: 'Auto', off: 'Apagado', on: 'Fijo', broken: 'Dañado' };
    const envBindings = [
      ['#env-flicker', '#env-flicker-val', 'flickerIntensity'],
      ['#env-speed', '#env-speed-val', 'flickerSpeed'],
      ['#env-ambient', '#env-ambient-val', 'ambient'],
      ['#env-lamps', '#env-lamps-val', 'lampPower'],
      ['#env-monster-light', '#env-monster-light-val', 'monsterLight'],
      ['#env-tint', '#env-tint-val', 'eerieTint'],
      ['#env-fog', '#env-fog-val', 'fogDensity'],
      ['#env-windows', '#env-windows-val', 'windowGlow'],
      ['#env-vignette', '#env-vignette-val', 'vignette']
    ].map(([inputSel, outSel, key]) => ({
      input: panel.querySelector(inputSel),
      out: panel.querySelector(outSel),
      key
    })).filter(b => b.input && b.out);

    function syncEnvUi(activePreset = atmosphere.state.preset) {
      for (const b of presetButtons) {
        b.setAttribute('aria-pressed', String(b.dataset.envPreset === activePreset));
      }
      for (const b of envBindings) {
        const pct = Math.round(atmosphere.state.settings[b.key] * 100);
        b.input.value = String(pct);
        b.out.textContent = pct + ' %';
      }
      for (const b of lampButtons) {
        const lamp = atmosphere.state.lamps[Number(b.dataset.lamp)];
        if (!lamp) continue;
        b.dataset.lampMode = lamp.mode;
        b.title = `Tubo ${lamp.index + 1}: ${lampModeNames[lamp.mode] || lamp.mode}`;
      }
      if (flickerCheck) flickerCheck.checked = atmosphere.state.flickerEnabled;
      if (audioCheck) audioCheck.checked = atmosphere.state.audioEnabled;
    }

    for (const button of presetButtons) {
      button.addEventListener('click', () => {
        atmosphere.setPreset(button.dataset.envPreset);
        syncEnvUi(button.dataset.envPreset);
        wake();
      });
    }
    for (const button of lampButtons) {
      button.addEventListener('click', () => {
        atmosphere.cycleLamp(Number(button.dataset.lamp));
        syncEnvUi(atmosphere.state.preset);
        wake();
      });
    }
    if (surgeBtn) {
      surgeBtn.addEventListener('click', () => {
        atmosphere.state.allowReducedMotionFlicker = true;
        atmosphere.surge();
        wake();
      });
    }
    for (const b of envBindings) {
      b.input.addEventListener('input', () => {
        const val = b.input.valueAsNumber / 100;
        atmosphere.state.settings[b.key] = val;
        if (b.key === 'flickerIntensity') {
          atmosphere.state.allowReducedMotionFlicker = val > 0;
        }
        b.out.textContent = Math.round(val * 100) + ' %';
        atmosphere.state.preset = 'custom';
        for (const btn of presetButtons) btn.setAttribute('aria-pressed', 'false');
        wake();
      });
    }
    if (flickerCheck) {
      flickerCheck.addEventListener('change', () => {
        atmosphere.state.flickerEnabled = flickerCheck.checked;
        atmosphere.state.allowReducedMotionFlicker = flickerCheck.checked;
        wake();
      });
    }
    if (audioCheck) {
      audioCheck.addEventListener('change', () => {
        atmosphere.state.audioEnabled = audioCheck.checked;
        if (audioCheck.checked) atmosphere.audio.unlock();
        else atmosphere.audio.silence();
      });
    }
    syncEnvUi();
  }

  if (debris) {
    const debrisSlider = panel.querySelector('#debris-density');
    const debrisOut = panel.querySelector('#debris-val');
    const debrisPresets = panel.querySelectorAll('[data-debris-preset]');

    function syncDebrisUi() {
      const pct = Math.round(debris.amount * 100);
      if (debrisSlider) {
        debrisSlider.value = String(pct);
        debrisSlider.setAttribute('aria-valuetext', pct + ' %');
      }
      if (debrisOut) debrisOut.textContent = pct + ' %';
      for (const btn of debrisPresets) {
        const target = Math.round(Number(btn.dataset.debrisPreset) * 100);
        btn.setAttribute('aria-pressed', String(target === pct));
      }
    }

    if (debrisSlider) {
      debrisSlider.addEventListener('input', () => {
        debris.setAmount(debrisSlider.valueAsNumber / 100);
        syncDebrisUi();
        wake();
      });
    }
    for (const btn of debrisPresets) {
      btn.addEventListener('click', () => {
        debris.setAmount(Number(btn.dataset.debrisPreset));
        syncDebrisUi();
        wake();
      });
    }
    syncDebrisUi();
  }

  return { recordStickDirection, refresh() { if (panel.open) updateStats(); } };
}
