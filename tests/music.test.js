import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMusicState } from '../src/music.js';
import { GAME_PHASES, OUTCOMES } from '../src/game-state.js';
import { BPM, STATE_CONFIG, STATE_ORDER } from '../music/score-engine.js';

const playing = {
  phase: GAME_PHASES.PLAYING,
  threatStage: 0,
  mode: 'patrol',
  distance: 30,
  outcome: null
};

test('menu and intro use the menu piece', () => {
  assert.equal(resolveMusicState({ ...playing, phase: GAME_PHASES.MENU }), 'menu');
  assert.equal(resolveMusicState({ ...playing, phase: GAME_PHASES.INTRO }), 'menu');
});

test('pause is an overlay on the current piece', () => {
  assert.equal(resolveMusicState({ ...playing, phase: GAME_PHASES.PAUSED }), 'paused');
});

test('endings pick victory, complete victory or defeat', () => {
  assert.equal(resolveMusicState({ ...playing, phase: GAME_PHASES.ENDING, outcome: OUTCOMES.VICTORY }), 'win');
  assert.equal(resolveMusicState({ ...playing, phase: GAME_PHASES.ENDING, outcome: OUTCOMES.VICTORY_COMPLETE }), 'truewin');
  assert.equal(resolveMusicState({ ...playing, phase: GAME_PHASES.ENDING, outcome: OUTCOMES.DEFEAT_CAPTURE }), 'lose');
  assert.equal(resolveMusicState({ ...playing, phase: GAME_PHASES.ENDING, outcome: OUTCOMES.DEFEAT_TIMEOUT }), 'lose');
});

test('escape and lockdown keep the chase running', () => {
  assert.equal(resolveMusicState({ ...playing, phase: GAME_PHASES.ESCAPING }), 'chase');
  assert.equal(resolveMusicState({ ...playing, phase: GAME_PHASES.LOCKDOWN }), 'chase');
});

test('the Roid relief drops the chase even if the monster is close', () => {
  assert.equal(resolveMusicState({ ...playing, mode: 'flee', distance: 1 }), 'ambient');
  assert.equal(resolveMusicState({ ...playing, mode: 'stunned', distance: 1 }), 'ambient');
});

test('near overrides ambient and chase', () => {
  assert.equal(resolveMusicState({ ...playing, distance: 3 }), 'near');
  assert.equal(resolveMusicState({ ...playing, threatStage: 3, distance: 3 }), 'near');
});

test('hunt stage forces the chase, but a far walker stays ambient', () => {
  assert.equal(resolveMusicState({ ...playing, threatStage: 2, distance: 30 }), 'chase');
  assert.equal(resolveMusicState({ ...playing, threatStage: 1, mode: 'chase', distance: 10 }), 'chase');
  assert.equal(resolveMusicState({ ...playing, threatStage: 0, mode: 'chase', distance: 20 }), 'ambient');
  assert.equal(resolveMusicState({ ...playing, threatStage: 0, mode: 'chase', distance: 7 }), 'chase');
});

test('hysteresis keeps chase and near from flapping at the threshold', () => {
  assert.equal(resolveMusicState({ ...playing, mode: 'chase', distance: 10, current: 'ambient' }), 'ambient');
  assert.equal(resolveMusicState({ ...playing, mode: 'chase', distance: 10, current: 'chase' }), 'chase');
  assert.equal(resolveMusicState({ ...playing, distance: 5, current: 'ambient' }), 'ambient');
  assert.equal(resolveMusicState({ ...playing, distance: 5, current: 'near' }), 'near');
});

test('the chase is faster than the ambient piece and has more layers', () => {
  assert.ok(BPM * STATE_CONFIG.chase.tempo > BPM * STATE_CONFIG.ambient.tempo * 1.5);
  const active = Object.values(STATE_CONFIG.chase.mix).filter(value => value > 0.02).length;
  assert.ok(active >= 15, `chase should use at least 15 layers, got ${active}`);
});

test('the eight game states are present in the engine', () => {
  assert.deepEqual([...STATE_ORDER], ['menu', 'paused', 'ambient', 'chase', 'near', 'lose', 'win', 'truewin']);
});
