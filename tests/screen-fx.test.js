import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {
  DANGER_RANGE,
  SCREEN_FX_MASK,
  chaseTarget,
  createScreenFx,
  createScreenFxState,
  fearTarget,
  paintScreenFx,
  proximityTarget,
  resetScreenFx,
  stepScreenFx,
  threatBearing
} from '../src/screen-fx.js';
import { capturePose } from '../src/monster-hunt.js';

const dt = 1 / 60;
const player = (x = 0, z = 0, yaw = 0) => ({ x, z, yaw });
const monster = (mode, x = 0, z = -2, extra = {}) => ({
  x, z, mode, visible: true, captureTime: 0, captureSide: 0, ...extra
});
const input = (overrides = {}) => ({
  running: true,
  reducedMotion: false,
  pose: player(),
  monster: monster('chase'),
  ...overrides
});

function fakeRoot() {
  const values = {};
  return {
    values,
    style: {
      setProperty(name, value) { values[name] = value; }
    }
  };
}

test('proximity danger follows real distance, awareness and pursuit without jumping to full', () => {
  const far = proximityTarget(12, 'patrol', false);
  const middle = proximityTarget(4, 'patrol', false);
  const near = proximityTarget(1.5, 'patrol', false);

  assert.equal(far, 0);
  assert.ok(middle > 0.2 && middle < near, 'danger should ramp rather than step');
  assert.ok(near > 0.4 && near <= 1);
  assert.ok(DANGER_RANGE.far > DANGER_RANGE.near);
  assert.ok(proximityTarget(4, 'chase') > proximityTarget(4, 'patrol'));
  assert.ok(proximityTarget(4, 'patrol', true) > proximityTarget(4, 'patrol', false));
  for (const distance of [-2, 0, 0.5, 3, 8, 50]) {
    const value = proximityTarget(distance, 'chase', true);
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
  }

  assert.equal(chaseTarget('patrol', 1), 0);
  assert.ok(chaseTarget('chase', 12) > 0.45);
  assert.ok(chaseTarget('chase', 1) > chaseTarget('chase', 12));
});

test('pursuit intensity eases in incrementally and never overshoots', () => {
  const state = createScreenFxState();
  const chase = input();

  stepScreenFx(state, chase, dt);
  assert.ok(state.danger > 0 && state.danger < 0.15, 'first frame is only a hint');
  assert.ok(state.chase > 0 && state.chase < 0.15);

  let previousDanger = state.danger;
  let previousChase = state.chase;
  for (let i = 0; i < 90; i++) {
    stepScreenFx(state, chase, dt);
    assert.ok(state.danger >= previousDanger - 1e-9, 'danger rises monotonically');
    assert.ok(state.chase >= previousChase - 1e-9, 'chase rises monotonically');
    assert.ok(state.danger - previousDanger < 0.1, 'no single-frame jump');
    assert.ok(state.chase - previousChase < 0.1, 'no single-frame jump');
    previousDanger = state.danger;
    previousChase = state.chase;
  }
  assert.ok(state.danger > 0.85);
  assert.ok(state.chase > 0.9);
});

test('the threat bearing follows the real camera yaw', () => {
  let bearing = threatBearing(player(0, 0, 0), { x: 2, z: -2 });
  assert.ok(bearing.x > 0.3 && bearing.y < 0, 'right and ahead sits on the upper-right edge');

  bearing = threatBearing(player(0, 0, 0), { x: -2, z: -2 });
  assert.ok(bearing.x < -0.3, 'left target sits on the left edge');

  bearing = threatBearing(player(0, 0, 0), { x: 0, z: 2 });
  assert.ok(bearing.y > 0.5, 'a target behind falls to the lower edge');

  bearing = threatBearing(player(0, 0, -Math.PI / 2), { x: 2, z: 0 });
  assert.ok(Math.abs(bearing.x) < 0.01 && bearing.y < -0.9, 'bearing is camera-relative');
});

test('pause or inspection clears every channel immediately and repaints a clean frame', () => {
  const root = fakeRoot();
  const fx = createScreenFx(root);
  for (let i = 0; i < 120; i++) fx.update(input(), dt);
  assert.ok(fx.state.danger > 0.5);
  assert.ok(fx.state.chase > 0.5);
  assert.notEqual(root.values['--hazard-danger'], '0.000');

  const paused = fx.update(input({ running: false }), dt);
  assert.deepEqual(
    { danger: paused.danger, chase: paused.chase, grip: paused.grip, fade: paused.fade },
    { danger: 0, chase: 0, grip: 0, fade: 0 }
  );
  assert.equal(paused.bearingX, 0);
  assert.equal(paused.bearingY, -1);
  assert.equal(paused.side, 0);
  assert.equal(root.values['--hazard-danger'], '0.000');
  assert.equal(root.values['--hazard-chase'], '0.000');
  assert.equal(root.values['--hazard-grip'], '0.000');

  for (const blocked of [
    { running: false },
    { pose: null },
    { monster: null },
    { monster: { mode: 'chase' } },
    { pose: { x: NaN, z: 0, yaw: 0 } }
  ]) {
    const state = createScreenFxState();
    stepScreenFx(state, input({ danger: 1, ...blocked }), 0.4);
    assert.equal(state.danger + state.chase + state.grip + state.fade, 0);
  }
  assert.doesNotThrow(() => paintScreenFx(null, paused));
});

test('grab uses the authored capture clock and hands off into the final fade', () => {
  const state = createScreenFxState();
  const pose = player();
  const capture = time => input({
    pose,
    monster: monster('capture', 0, -1, { captureTime: time, captureSide: -1 })
  });

  stepScreenFx(state, capture(0), dt);
  assert.equal(state.grip, capturePose(0).grip);
  assert.equal(state.fade, 0);
  assert.equal(state.side, -1);
  assert.equal(state.chase, 0);

  stepScreenFx(state, capture(1.3), dt);
  assert.equal(state.grip, capturePose(1.3).grip);
  assert.equal(state.fade, 0);

  const beforeFade = state.danger;
  stepScreenFx(state, capture(2.85), dt);
  assert.equal(state.grip, capturePose(2.85).grip);
  assert.equal(state.fade, capturePose(2.85).fade);
  assert.equal(state.fade, 1);
  assert.ok(state.danger <= beforeFade);
  assert.equal(state.chase, 0);
  for (const channel of ['danger', 'chase', 'grip', 'fade', 'motion', 'bearingX', 'bearingY', 'side']) {
    assert.ok(Number.isFinite(state[channel]), channel + ' must stay finite');
  }
});

test('reduced motion freezes the time-based movement channel but keeps intensity', () => {
  const moving = createScreenFxState();
  const calm = createScreenFxState();
  for (let i = 0; i < 40; i++) {
    stepScreenFx(moving, input({ reducedMotion: false }), dt);
    stepScreenFx(calm, input({ reducedMotion: true }), dt);
  }
  assert.equal(moving.motion, 1);
  assert.equal(calm.motion, 0, 'shader must receive a zero motion multiplier');
  assert.ok(Math.abs(moving.danger - calm.danger) < 1e-9);
  assert.ok(Math.abs(moving.chase - calm.chase) < 1e-9);
});

test('CSS paint stays peripheral, bounded and zero after reset', () => {
  const root = fakeRoot();
  const fx = createScreenFx(root);
  for (let i = 0; i < 60; i++) fx.update(input({
    monster: monster('capture', 0, -1, { captureTime: 1.3, captureSide: 1 })
  }), dt);

  assert.deepEqual(Object.keys(root.values).sort(), ['--hazard-chase', '--hazard-danger', '--hazard-grip']);
  for (const name of ['--hazard-danger', '--hazard-chase', '--hazard-grip']) {
    const value = Number(root.values[name]);
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, name + ' must be bounded');
  }

  fx.reset();
  assert.equal(root.values['--hazard-danger'], '0.000');
  assert.equal(root.values['--hazard-chase'], '0.000');
  assert.equal(root.values['--hazard-grip'], '0.000');
});

test('the shader and CSS read the same clear-centre mask and hard pause gate', () => {
  assert.ok(SCREEN_FX_MASK.inner >= 0.3, 'the central face band must stay clear');
  assert.ok(SCREEN_FX_MASK.outer > SCREEN_FX_MASK.inner);
  assert.ok(SCREEN_FX_MASK.gripClosed >= SCREEN_FX_MASK.inner);

  const renderSrc = fs.readFileSync(new URL('../src/render.js', import.meta.url), 'utf8');
  assert.match(renderSrc, /import \{ SCREEN_FX_MASK \} from '\.\/screen-fx\.js'/);
  assert.match(renderSrc, /uniform float hazardDanger/);
  assert.match(renderSrc, /uniform float hazardChase/);
  assert.match(renderSrc, /uniform float hazardGrip/);
  assert.match(renderSrc, /uniform float hazardFade/);
  assert.match(renderSrc, /uniform float hazardMotion/);
  assert.match(renderSrc, /HZ_INNER/);
  assert.match(renderSrc, /hazardMotion > 0\.001/);

  const css = fs.readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  assert.match(css, /--hazard-danger/);
  assert.match(css, /#game::before/);
  assert.match(css, /#game::after/);
  assert.match(css, /mask-image: radial-gradient/);
  assert.match(css, /#game:not\(\.playing\)::before/);

  const mainSrc = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(mainSrc, /createScreenFx\(game\)/);
  assert.match(mainSrc, /running: walk\.active && !previewing/);
  assert.match(mainSrc, /renderer\.draw\(scene, camera, screenFxFrame, playerBody\.visibleHeadSurfaces\)/);
});

test('fear spikes on eye contact, spares the far and honours authored fear', () => {
  const far = fearTarget(player(0, 0, 0), monster('patrol', 0, -60, { visible: false }));
  assert.equal(far, 0, 'a hidden suit across the school is not fear yet');

  const seen = fearTarget(player(), monster('patrol', 0, -1.5));
  const behind = fearTarget(player(), monster('patrol', 0, 1.5));
  const hidden = fearTarget(player(), monster('patrol', 0, -1.5, { visible: false }));

  assert.ok(seen > 0.9, 'eye contact at contact range is a spike');
  assert.ok(seen > behind, 'a shape behind the player is less terrifying than eye contact');
  assert.ok(behind > hidden, 'visible dread outranks the same distance unseen');
  assert.ok(hidden > 0.1 && hidden < seen, 'unseen proximity still presses');

  const authored = { ...player(), fear: 0.7 };
  assert.equal(
    fearTarget(authored, monster('patrol', 0, -60, { visible: false })),
    0.7,
    'a scripted pose.fear is a floor, not a ceiling'
  );
  assert.equal(fearTarget(null, null), 0);
  assert.equal(fearTarget(player(NaN, 0), monster('patrol', 0, -1.5)), 0);

  for (const distance of [-5, 0, 0.5, 4, 30]) {
    const value = fearTarget(player(), monster('chase', 0, distance));
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 1, 'fear stays bounded at ' + distance);
  }
});

test('fear ramps in fast, lets go slowly and clears completely on reset', () => {
  const state = createScreenFxState();
  const close = input({ monster: monster('patrol', 0, -1.2) });

  assert.equal(state.fear, 0);
  stepScreenFx(state, close, dt);
  assert.ok(state.fear > 0 && state.fear < 0.2, 'first frame is only a shockwave');

  for (let i = 0; i < 60; i++) stepScreenFx(state, close, dt);
  assert.ok(state.fear > 0.9, 'a suit in the frame keeps the channel pinned high');

  const peak = state.fear;
  const away = input({ monster: monster('patrol', 0, -200, { visible: false }) });
  stepScreenFx(state, away, dt);
  assert.ok(state.fear < peak, 'fear starts draining once the suit is gone');
  for (let i = 0; i < 12; i++) stepScreenFx(state, away, dt);
  assert.ok(state.fear > 0.55, 'decay is slower than onset so the corridor stays unsafe');

  const snapshot = createScreenFx(null).update(close, dt);
  assert.ok(Number.isFinite(snapshot.fear), 'snapshot exposes the fear channel');

  resetScreenFx(state);
  assert.equal(state.fear, 0, 'pause and invalid input must not leave fear behind');

  const blocked = createScreenFxState();
  blocked.fear = 0.8;
  stepScreenFx(blocked, input({ running: false }), 0.4);
  assert.equal(blocked.fear, 0);
  stepScreenFx(blocked, input({ pose: { x: NaN, z: 0, yaw: 0 } }), 0.4);
  assert.equal(blocked.fear, 0);
});

test('the capture fade dissolves fear before the blackout', () => {
  const state = createScreenFxState();
  const grab = time => input({
    monster: monster('capture', 0, -1, { captureTime: time, captureSide: 1 })
  });

  for (let i = 0; i < 90; i++) stepScreenFx(state, grab(0.6), dt);
  assert.ok(state.fear > 0.85, 'being held is total dread');

  const beforeFade = state.fear;
  stepScreenFx(state, grab(2.85), dt);
  assert.equal(capturePose(2.85).fade, 1);
  assert.ok(state.fear < beforeFade, 'the authored fade drains the fear channel');
  for (let i = 0; i < 120; i++) stepScreenFx(state, grab(2.85), dt);
  assert.ok(state.fear < 0.05, 'fear is gone by the final blackout');
});

test('the shader receives hazardFear from the screen-fx snapshot', () => {
  const renderSrc = fs.readFileSync(new URL('../src/render.js', import.meta.url), 'utf8');
  assert.match(renderSrc, /uniform float hazardFear/);
  assert.match(renderSrc, /hazardFear\.value = screenFx\?\.fear \|\| 0;/);
  assert.match(renderSrc, /hazardDanger \+ hazardChase \+ hazardGrip \+ hazardFade \+ hazardFear > 0\.002/);
  assert.match(renderSrc, /hazardDanger \* 0\.65 \+ hazardChase \* 0\.85 \+ hazardFear \* 1\.15/);
  assert.match(renderSrc, /sin\(time \* 5\.8\)/);
  assert.match(renderSrc, /sin\(time \* 11\.6/);
  assert.match(renderSrc, /sin\(coord\.y \* 55\.0 \+ time \* 19\.0\)/);

  const fxSrc = fs.readFileSync(new URL('../src/screen-fx.js', import.meta.url), 'utf8');
  assert.match(fxSrc, /export function fearTarget/);
});
