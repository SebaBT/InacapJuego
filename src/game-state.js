export const MATCH_MAX_SECONDS = 180;
export const POINT_OF_NO_RETURN_SECONDS = 120;

export const KEY_ITEMS = Object.freeze(['fuse', 'masterKey', 'boltCutters']);
export const LORE_ITEMS = Object.freeze(['tape1', 'tape2', 'tape3']);
export const TOOL_ITEMS = Object.freeze(['energy', 'roid', 'flash']);

export const THREAT_STAGES = [
  { name: 'Acecho', effect: 'Mothy sigue tus pasos.' },
  { name: 'Alerta', effect: 'Se acerca más rápido.' },
  { name: 'Cacería', effect: 'Ya puede romper muros.' },
  { name: 'Frenesí', effect: 'Corre sin descanso y rompe todo a su paso.' }
];

export const GAME_PHASES = Object.freeze({
  MENU: 'menu',
  INTRO: 'intro',
  PLAYING: 'playing',
  PAUSED: 'paused',
  ESCAPING: 'escaping',
  LOCKDOWN: 'lockdown',
  ENDING: 'ending'
});

export const OUTCOMES = Object.freeze({
  VICTORY: 'victory',
  VICTORY_COMPLETE: 'victory_complete',
  DEFEAT_CAPTURE: 'defeat_capture',
  DEFEAT_TIMEOUT: 'defeat_timeout'
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function createMatchState() {
  return {
    phase: GAME_PHASES.MENU,
    elapsed: 0,
    pointOfNoReturn: false,
    pointOfNoReturnJustTriggered: false,
    outcome: null,
    gateLocks: {
      fuse: false,
      masterKey: false,
      boltCutters: false
    },
    gateUnlocked: false,
    tapesCollected: 0,
    keysCollected: 0,
    breakerSurged: false,
    cameraPingCooldown: 0
  };
}

export function resetMatchState(state) {
  state.phase = GAME_PHASES.MENU;
  state.elapsed = 0;
  state.pointOfNoReturn = false;
  state.pointOfNoReturnJustTriggered = false;
  state.outcome = null;
  state.gateLocks.fuse = false;
  state.gateLocks.masterKey = false;
  state.gateLocks.boltCutters = false;
  state.gateUnlocked = false;
  state.tapesCollected = 0;
  state.keysCollected = 0;
  state.breakerSurged = false;
  state.cameraPingCooldown = 0;
  return state;
}

export function allGateLocksUnlocked(gateLocks) {
  return KEY_ITEMS.every(key => Boolean(gateLocks?.[key]));
}

export function countGateLocksUnlocked(gateLocks) {
  return KEY_ITEMS.reduce((sum, key) => sum + (gateLocks?.[key] ? 1 : 0), 0);
}

/**
 * Computes aggressive monster escalation metrics from elapsed time (0..180s)
 * and collected key objectives (0..3).
 */
export function computeEscalation({ elapsed = 0, keysCollected = 0, pointOfNoReturn = false } = {}) {
  const preFrenzyTime = clamp(elapsed / POINT_OF_NO_RETURN_SECONDS, 0, 1);
  const keyRatio = clamp(keysCollected / KEY_ITEMS.length, 0, 1);
  const frenzy = Boolean(pointOfNoReturn || elapsed >= POINT_OF_NO_RETURN_SECONDS);
  const frenzyRatio = frenzy
    ? clamp((elapsed - POINT_OF_NO_RETURN_SECONDS) / (MATCH_MAX_SECONDS - POINT_OF_NO_RETURN_SECONDS), 0, 1)
    : 0;
  const level = frenzy
    ? clamp(0.82 + 0.18 * frenzyRatio, 0, 1)
    : clamp(preFrenzyTime * 0.48 + keyRatio * 0.34, 0, 0.82);

  const stage = frenzy ? 3 : level >= .44 ? 2 : level >= .22 ? 1 : 0;
  return {
    level, stage,
    canBreakWalls: stage >= 2,
    frenzy,
    frenzyRatio,
    patrolSpeed: frenzy ? 2.85 : 1.18 + 0.92 * level,
    investigateSpeed: frenzy ? 3.95 + 0.35 * frenzyRatio : 1.85 + 1.25 * level,
    chaseSpeed: frenzy ? 4.52 + 0.26 * frenzyRatio : 3.65 + 0.72 * level,
    sightRange: frenzy ? 28 + 6 * frenzyRatio : 17 + 8 * level,
    hearingMult: frenzy ? 1.85 : 1 + 0.55 * level,
    lostTimeout: frenzy ? 3.5 : 1.35 + 1.2 * level,
    crossingSpeedMult: frenzy ? 1.85 : 1 + 0.65 * level,
    throwCooldownMult: frenzy ? 0.35 : 1 - 0.55 * level,
    suitWearMin: frenzy ? 0.92 : clamp(preFrenzyTime * 0.45 + keyRatio * 0.35, 0, 0.78)
  };
}

export function stepMatchTimer(state, dt) {
  state.pointOfNoReturnJustTriggered = false;
  if (state.phase !== GAME_PHASES.PLAYING) {
    return { hitPointOfNoReturn: false, hitTimeout: false };
  }
  const safeDt = Math.max(0, Math.min(0.1, dt || 0));
  if (state.cameraPingCooldown > 0) {
    state.cameraPingCooldown = Math.max(0, state.cameraPingCooldown - safeDt);
  }
  state.elapsed = Math.min(MATCH_MAX_SECONDS, state.elapsed + safeDt);

  let hitPointOfNoReturn = false;
  if (!state.pointOfNoReturn && state.elapsed >= POINT_OF_NO_RETURN_SECONDS) {
    state.pointOfNoReturn = true;
    state.pointOfNoReturnJustTriggered = true;
    hitPointOfNoReturn = true;
  }

  let hitTimeout = false;
  if (state.elapsed >= MATCH_MAX_SECONDS) {
    hitTimeout = true;
  }

  return { hitPointOfNoReturn, hitTimeout };
}

export function formatCountdown(elapsed = 0) {
  const remaining = Math.max(0, Math.ceil(MATCH_MAX_SECONDS - elapsed));
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatElapsedClock(elapsed = 0) {
  const total = Math.max(0, Math.min(MATCH_MAX_SECONDS, Math.round(elapsed)));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function resolveEscapeOutcome(tapesCollected = 0) {
  return tapesCollected >= LORE_ITEMS.length ? OUTCOMES.VICTORY_COMPLETE : OUTCOMES.VICTORY;
}
