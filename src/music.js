import { createHorrorScore } from '../music/score-engine.js';
import { GAME_PHASES, OUTCOMES } from './game-state.js';
import { soundState as defaultSound } from './sound.js';

const MUSIC_GAIN = 0.7;
export const NEAR_DISTANCE = 4.6;

export function resolveMusicState({ phase, threatStage = 0, mode = 'patrol', distance = Infinity, outcome = null, current = '' }) {
  if (phase === GAME_PHASES.PAUSED) return 'paused';
  if (phase === GAME_PHASES.MENU || phase === GAME_PHASES.INTRO) return 'menu';
  if (phase === GAME_PHASES.ENDING) {
    if (outcome === OUTCOMES.VICTORY_COMPLETE) return 'truewin';
    if (outcome === OUTCOMES.VICTORY) return 'win';
    return 'lose';
  }
  if (phase === GAME_PHASES.ESCAPING || phase === GAME_PHASES.LOCKDOWN) return 'chase';
  if (mode === 'flee' || mode === 'stunned') return 'ambient';

  // Histéresis: no cortar la persecución sólo porque el monstruo roce el umbral.
  const nearLimit = current === 'near' ? NEAR_DISTANCE + 1 : NEAR_DISTANCE;
  const chaseLimit = current === 'chase' ? 11 : 9;
  const alertLimit = current === 'chase' ? 16 : 14;

  if (distance < nearLimit) return 'near';
  if (threatStage >= 2) return 'chase';
  if (threatStage >= 1 && (mode === 'chase' || distance < alertLimit)) return 'chase';
  if (mode === 'chase' && distance < chaseLimit) return 'chase';
  return 'ambient';
}

/**
 * Une el marcador procedural con las fases del juego. No crea audio hasta que
 * el jugador interactúa; el volumen sigue al control de sonido existente.
 */
export function createGameMusic({ sound = defaultSound, gain = MUSIC_GAIN } = {}) {
  const score = createHorrorScore({ volume: 0, state: 'menu' });
  let armed = false;
  let started = false;
  let paused = false;
  let current = '';
  let lastState = 'menu';
  let lastError = null;

  function targetVolume() {
    const volume = Number(sound.effectiveVolume);
    return Math.max(0, Math.min(1, Number.isFinite(volume) ? volume * gain : 0));
  }

  function applyVolume() {
    const volume = targetVolume();
    if (armed && !started && volume > 0.001) {
      try {
        score.start();
        started = true;
      } catch (error) {
        lastError = error;
        console.warn('Pabellón B · música:', error);
      }
    }
    if (started) score.setVolume(volume);
  }

  function set(state) {
    if (!state) return;
    if (state === 'paused') {
      pause();
      return;
    }
    paused = false;
    lastState = state;
    if (state !== current) {
      current = state;
      score.setState(state);
    }
  }

  function pause() {
    if (paused) return;
    paused = true;
    current = 'paused';
    score.setState('paused');
  }

  function resume() {
    if (!paused) return;
    paused = false;
    current = lastState;
    score.setState(lastState);
  }

  function sync({ phase, threatStage = 0, mode = 'patrol', distance = Infinity, outcome = null }) {
    const desired = resolveMusicState({ phase, threatStage, mode, distance, outcome, current });
    if (desired === 'paused') pause();
    else set(desired);
  }

  function unlock() {
    armed = true;
    if (!started) {
      try {
        score.start();
        started = true;
      } catch (error) {
        lastError = error;
        console.warn('Pabellón B · música:', error);
      }
    } else {
      try { score.start(); } catch { /* ignore */ }
    }
    applyVolume();
  }

  const unsubscribe = sound.subscribe(applyVolume);

  return {
    unlock,
    sync,
    set,
    pause,
    resume,
    getState: () => score.getState(),
    getScore: () => score,
    getError: () => lastError,
    dispose() {
      unsubscribe();
      score.dispose();
    }
  };
}

export default createGameMusic;
