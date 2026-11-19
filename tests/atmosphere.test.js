import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector4 } from 'three';
import {
  ATMOSPHERE_PRESETS,
  applyAtmospherePreset,
  createAtmosphere,
  createAtmosphereState,
  isAtmosphereAnimating,
  stepAtmosphere,
  triggerAtmosphereSurge
} from '../src/atmosphere.js';
import { lights } from '../src/layout.js';

test('presets switch cleanly between tetrica, falla, apagon, and normal', () => {
  const state = createAtmosphereState(lights, 'tetrica');
  assert.equal(state.preset, 'tetrica');
  assert.ok(state.settings.ambient < ATMOSPHERE_PRESETS.normal.ambient);
  assert.ok(state.settings.eerieTint > 0.7);
  assert.ok(state.settings.flickerIntensity > 0.5);

  applyAtmospherePreset(state, 'apagon');
  assert.equal(state.preset, 'apagon');
  assert.ok(state.settings.lampPower < 0.4);
  assert.ok(state.settings.fogDensity > ATMOSPHERE_PRESETS.tetrica.fogDensity);

  applyAtmospherePreset(state, 'normal');
  assert.equal(state.preset, 'normal');
  assert.equal(state.settings.flickerIntensity, 0);
  assert.equal(state.settings.eerieTint, 0);
});

test('ceiling lamps flicker dynamically and respect manual off/on modes', () => {
  const state = createAtmosphereState(lights, 'tetrica');
  const samples = Array.from({ length: lights.length }, () => ({ min: Infinity, max: -Infinity }));

  for (let i = 0; i < 360; i++) {
    stepAtmosphere(state, 1 / 60, { reducedMotion: false });
    for (let k = 0; k < state.lamps.length; k++) {
      samples[k].min = Math.min(samples[k].min, state.lamps[k].power);
      samples[k].max = Math.max(samples[k].max, state.lamps[k].power);
    }
  }

  // At least several failing ceiling lamps vary meaningfully over 6 seconds.
  const fluctuating = samples.filter(s => s.max - s.min > 0.25);
  assert.ok(fluctuating.length >= 3, 'multiple ceiling lamps should flicker noticeably');

  // Manual off and on overrides clamp cleanly without flicker.
  state.lamps[0].mode = 'off';
  state.lamps[1].mode = 'on';
  for (let i = 0; i < 30; i++) stepAtmosphere(state, 1 / 60, { reducedMotion: false });
  assert.ok(state.lamps[0].power < 0.01);
  const steadyOn = state.lamps[1].power;
  for (let i = 0; i < 20; i++) stepAtmosphere(state, 1 / 60, { reducedMotion: false });
  assert.ok(Math.abs(state.lamps[1].power - steadyOn) < 1e-4);
});

test('surge triggers rolling overload and reducedMotion suppresses rapid strobing unless allowed', () => {
  const state = createAtmosphereState(lights, 'tetrica');
  assert.equal(isAtmosphereAnimating(state, true), false);
  assert.equal(isAtmosphereAnimating(state, false), true);

  triggerAtmosphereSurge(state);
  assert.ok(state.surgeWave >= 0);

  // Under reducedMotion without override, rapid jumps are damped.
  let maxJump = 0;
  for (let i = 0; i < 90; i++) {
    const prev = state.lamps.map(l => l.power);
    stepAtmosphere(state, 1 / 60, { reducedMotion: true });
    for (let k = 0; k < prev.length; k++) {
      maxJump = Math.max(maxJump, Math.abs(state.lamps[k].power - prev[k]));
    }
  }
  assert.ok(maxJump < 0.12, 'reducedMotion avoids abrupt strobe jumps');
});

test('createAtmosphere applies settings and lamp powers to renderer environment uniforms', () => {
  const atmo = createAtmosphere(lights);
  const env = {
    strips: { value: lights.map(l => new Vector4(-0.13, l.z, l.power, l.warmth)) },
    ambientLevel: { value: 1 },
    eerieTint: { value: 0 },
    fogDensity: { value: 0 },
    windowGlow: { value: 1 },
    vignetteAmount: { value: 0 },
    grainAmount: { value: 0 },
    monsterLight: { value: 0 },
    time: { value: 0 }
  };

  atmo.update(0.05, { reducedMotion: false, active: false, cameraZ: 0 });
  atmo.apply(env);

  assert.equal(env.ambientLevel.value, atmo.state.settings.ambient);
  assert.equal(env.eerieTint.value, atmo.state.settings.eerieTint);
  assert.equal(env.fogDensity.value, atmo.state.settings.fogDensity);
  assert.equal(env.windowGlow.value, atmo.state.settings.windowGlow);
  assert.equal(env.vignetteAmount.value, atmo.state.settings.vignette);
  assert.equal(env.grainAmount.value, atmo.state.settings.grain);
  assert.equal(env.monsterLight.value, atmo.state.settings.monsterLight);
  assert.ok(env.time.value > 0);
  for (let i = 0; i < lights.length; i++) {
    assert.equal(env.strips.value[i].z, atmo.state.lamps[i].power);
    assert.equal(env.strips.value[i].w, atmo.state.lamps[i].warmth);
  }
});

import { extraLights } from '../src/layout.js';

test('extra room/annex lights simulate and toggle via toggleRoomLight', () => {
  const atmo = createAtmosphere(lights, extraLights);
  const env = {
    strips: { value: lights.map(l => new Vector4(-0.13, l.z, l.power, l.warmth)) },
    extraStrips: { value: extraLights.map(l => new Vector4(l.x, l.z, l.defaultOn ? l.power : 0, l.warmth)) },
    ambientLevel: { value: 1 },
    eerieTint: { value: 0 },
    fogDensity: { value: 0 },
    windowGlow: { value: 1 },
    vignetteAmount: { value: 0 },
    grainAmount: { value: 0 },
    monsterLight: { value: 0 },
    time: { value: 0 }
  };

  assert.equal(atmo.getRoomLight('102').switchedOn, false);
  assert.equal(atmo.getRoomLight('101').switchedOn, true);

  atmo.toggleRoomLight('102');
  assert.equal(atmo.getRoomLight('102').switchedOn, true);
  for (let i = 0; i < 40; i++) atmo.update(0.03, { reducedMotion: false, active: false, cameraX: 5, cameraZ: -7 });
  atmo.apply(env);

  const idx102 = extraLights.findIndex(l => l.id === '102');
  assert.ok(env.extraStrips.value[idx102].z > 0.02, 'room 102 light powers up after toggle');

  atmo.toggleRoomLight('102');
  for (let i = 0; i < 40; i++) atmo.update(0.03, { reducedMotion: false, active: false, cameraX: 5, cameraZ: -7 });
  atmo.apply(env);
  assert.ok(env.extraStrips.value[idx102].z < 0.01, 'room 102 light fades to off');
});

