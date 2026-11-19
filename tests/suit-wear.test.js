import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, Mesh, ShaderMaterial } from 'three';
import { suitPerformance } from '../src/suit-wear.js';
import { abdomenTears, hoodTears, wingTears } from '../src/cloth-tears.js';
import { makeBodyDamage } from '../src/body-damage.js';

function advance(suit, seconds, distance) {
  for (let i=0; i<Math.round(seconds*60); i++) suit.update(1/60, distance);
}

test('chase opens moderate tears, then time and proximity increase lasting damage', () => {
  const far = suitPerformance(), near = suitPerformance();
  advance(far, 1, .5);
  assert.equal(far.wear, 0);
  for (const suit of [near, far]) {
    suit.setExpression('chase');
    advance(suit, .65, 12);
    assert.ok(suit.wear >= .3 && suit.wear < .4);
  }
  advance(near, 4, .8); advance(far, 4, 12);
  assert.ok(near.wear > far.wear + .25);
  const reached = near.wear, distant = far.wear;
  near.setExpression('chase');
  advance(near, 15, 12); advance(far, 15, 12);
  assert.equal(near.wear, reached);
  assert.ok(far.wear > distant && far.wear < reached);
  assert.ok(reached < 1);
});

test('a scream continues from the worn suit and reaches maximum only at the end', () => {
  for (const distance of [.8, 15]) {
    const suit = suitPerformance();
    suit.setExpression('chase');
    advance(suit, 3, distance);
    let previous = suit.wear;
    suit.setExpression('scream');
    assert.equal(suit.wear, previous);
    for (let i=0; i<158; i++) {
      suit.update(1/60);
      assert.ok(suit.wear >= previous && suit.wear < 1);
      previous = suit.wear;
    }
    advance(suit, .2);
    assert.equal(suit.wear, 1);
    assert.equal(suit.needsFrame(), false);
    suit.setExpression('normal');
    advance(suit, 4, .5);
    assert.equal(suit.wear, 0);
    suit.setExpression('chase');
    advance(suit, 1, 15);
    assert.ok(suit.wear < .36);
  }
});

test('a still reduced-motion preview can resume tearing when the player approaches', () => {
  const suit = suitPerformance();
  suit.setExpression('chase');
  for (let i=0; i<900; i++) suit.update(1/60, 12, false);
  const distant = suit.wear;
  assert.equal(suit.needsFrame(false), false);
  assert.equal(suit.update(1/60, 12, false), false);
  assert.equal(suit.update(1/60, 1, false), true);
  assert.ok(suit.wear > distant && suit.needsFrame(false));
});

test('the hood, abdomen and both layers of each wing open in stages and reset on inspection', () => {
  const parent = new Group(), mat = new ShaderMaterial(), hood = new ShaderMaterial();
  const parts = [[hood, hoodTears(parent, hood, mat, .231)]];
  for (const side of [-1,1]) for (const hind of [true,false]) {
    const panel = new ShaderMaterial();
    parts.push([panel, wingTears(panel, side, hind)]);
  }
  const abdomen = new ShaderMaterial();
  parts.push([abdomen, abdomenTears(abdomen)]);
  function widths(wear) {
    return parts.map(([panel, pose]) => {
      pose(wear);
      return panel.uniforms.tearRows.value.reduce((sum,row) => sum + row.z, 0);
    });
  }
  const fresh = widths(0), moderate = widths(.34), near = widths(.84), scream = widths(1);
  assert.deepEqual(fresh, [0,0,0,0,0,0]);
  assert.ok(moderate[0]>0 && moderate[2]>0 && moderate[4]>0 && moderate[5]>0);
  assert.equal(moderate[1]+moderate[3], 0);
  near.forEach((value,i) => assert.ok(value > moderate[i] && scream[i] > value));
  assert.deepEqual(widths(0), fresh);
  assert.equal(parent.children[0].visible, false);
});

test('the wear slider freezes automatic progression and restores it when cleared', () => {
  const suit = suitPerformance();
  suit.setExpression('chase');
  advance(suit, 1, 10);
  const liveWear = suit.wear;
  suit.setPreviewWear(.9);
  assert.equal(suit.previewing, true);
  assert.equal(suit.wear, .9);
  assert.equal(suit.needsFrame(true), false);
  assert.equal(suit.update(1, .5), false);
  assert.equal(suit.wear, .9);
  suit.setPreviewWear(null);
  assert.equal(suit.previewing, false);
  assert.equal(suit.wear, liveWear);
  assert.equal(suit.needsFrame(true), true);
});

test('body damage splits limb covers, reveals inner chitin and flaps, and resets cleanly', () => {
  const torso = new Group(), abdomen = new Group();
  const part = (parent, name) => {
    const m = new Mesh(new BoxGeometry(.1, .1, .1));
    m.name = name;
    parent.add(m);
    return m;
  };
  const arms = [0, 1].map(() => {
    const shoulder = new Group(), elbow = new Group(), hand = new Group(), palm = new Group();
    part(shoulder, 'Brazo'); part(elbow, 'Antebrazo');
    for (const name of ['Guante', 'Índice', 'Medio', 'Meñique', 'Pulgar']) part(palm, name);
    return { shoulder, elbow, hand, palm };
  });
  const legs = [0, 1].map(() => {
    const hip = new Group(), knee = new Group(), foot = new Group();
    part(hip, 'Muslo'); part(knee, 'Pierna'); part(foot, 'Puntera y empeine');
    return { hip, knee, foot };
  });
  const felt = new ShaderMaterial(), fabric = new ShaderMaterial();
  const hoodMaterials = [new ShaderMaterial(), new ShaderMaterial(), new ShaderMaterial()];
  const damage = makeBodyDamage(torso, abdomen, arms, legs, felt, fabric, hoodMaterials);
  assert.equal(fabric.defines.TORN_SLEEVE, 1);
  for (const m of hoodMaterials) assert.equal(m.defines.TORN_HEM, 1);
  assert.equal(arms[0].shoulder.getObjectByName('Brazo').material, fabric);
  assert.ok(arms[0].shoulder.getObjectByName('Brazo').geometry.attributes.tearCoord);

  damage.pose(0, 0);
  assert.equal(torso.getObjectByName('Coraza bajo el cierre dorsal').visible, false);
  assert.equal(abdomen.getObjectByName('Faldón de terciopelo').visible, false);
  for (const tip of damage.tips) assert.equal(tip.visible, false);

  damage.pose(1, 0);
  assert.equal(fabric.uniforms.garmentWear.value, 1);
  assert.equal(torso.getObjectByName('Coraza bajo el cierre dorsal').visible, true);
  assert.equal(abdomen.getObjectByName('Faldón de terciopelo').visible, true);
  assert.equal(arms[0].shoulder.getObjectByName('Húmero de quitina').visible, true);
  assert.equal(legs[0].hip.getObjectByName('Fémur del habitante').visible, true);
  for (const tip of damage.tips) assert.equal(tip.visible, true);

  damage.pose(0, 0);
  assert.equal(torso.getObjectByName('Coraza bajo el cierre dorsal').visible, false);
  assert.equal(abdomen.getObjectByName('Faldón de terciopelo').visible, false);
  for (const tip of damage.tips) assert.equal(tip.visible, false);
});

