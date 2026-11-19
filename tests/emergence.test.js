import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, ShaderMaterial } from 'three';
import { makeEmergence } from '../src/emergence.js';

test('the seam opens around the emerging head and returns to the same intact smile', () => {
  const anchor = new Group(), front = new ShaderMaterial();
  const pose = makeEmergence(anchor, new ShaderMaterial(), front, new ShaderMaterial());
  const opening = front.uniforms.cutEdge.value;
  const creature = anchor.getObjectByName('Habitante del traje');
  const skull = anchor.getObjectByName('Máscara de ceniza').parent;
  pose(0);
  const smile = opening.map(point => point.toArray());
  assert.equal(creature.visible, false);
  pose(.42);
  assert.equal(creature.visible, true);
  assert.ok(skull.position.z < 0);
  pose(1);
  assert.ok(skull.position.z > 0);
  assert.ok(Math.min(...opening.map(p => p.y)) < -.40);
  assert.ok(anchor.getObjectByName('Retazos de fieltro').visible);
  pose(.55);
  pose(0);
  assert.deepEqual(opening.map(point => point.toArray()), smile);
  assert.equal(creature.visible, false);
  assert.equal(anchor.getObjectByName('Retazos de fieltro').visible, false);
});

test('the chase expression opens the smile to show teeth without revealing the inner creature', () => {
  const anchor = new Group(), front = new ShaderMaterial();
  const pose = makeEmergence(anchor, new ShaderMaterial(), front, new ShaderMaterial());
  const opening = front.uniforms.cutEdge.value;
  const teeth = anchor.getObjectByName('Dientes de persecución');
  const creature = anchor.getObjectByName('Habitante del traje');
  pose(0, 0);
  const normalSpan = Math.max(...opening.map(p => p.y)) - Math.min(...opening.map(p => p.y));
  assert.equal(teeth.visible, false);
  pose(0, 1);
  const chaseSpan = Math.max(...opening.map(p => p.y)) - Math.min(...opening.map(p => p.y));
  assert.equal(teeth.visible, true);
  assert.equal(creature.visible, false);
  assert.ok(chaseSpan > normalSpan + .05);
  pose(1, 1);
  assert.equal(teeth.visible, false);
  assert.equal(creature.visible, true);
});

test('the occupant pushes against the worn chase seam before it can emerge', () => {
  const anchor = new Group(), front = new ShaderMaterial();
  const pose = makeEmergence(anchor, new ShaderMaterial(), front, new ShaderMaterial());
  const edge = front.uniforms.cutEdge.value;
  const span = () => Math.max(...edge.map(p=>p.y)) - Math.min(...edge.map(p=>p.y));
  const occupant = anchor.getObjectByName('Habitante del traje');
  const head = anchor.getObjectByName('Máscara de ceniza').parent;
  pose(0, 1, .34);
  const initial = span();
  assert.equal(occupant.visible, false);
  pose(0, 1, .84);
  const close = span(), restingZ = head.position.z;
  assert.ok(close > initial && occupant.visible && restingZ < 0);
  pose(0, 1, .84, .8);
  assert.ok(head.position.z > restingZ && head.position.z < 0);
  assert.equal(span(), close);
  pose(1, 1, 1);
  assert.ok(span() > close && head.position.z > 0);
});

test('the emerging monster articulates an unhinged jaw, curved vertebrae, strands, and ocelli', () => {
  const anchor = new Group(), front = new ShaderMaterial();
  const pose = makeEmergence(anchor, new ShaderMaterial(), front, new ShaderMaterial());
  const occupant = anchor.getObjectByName('Habitante del traje');
  const jaw = occupant.getObjectByName('Mandíbula articulada');
  const strands = occupant.getObjectsByProperty('name', 'Hebra de la boca');
  const vertebrae = occupant.getObjectsByProperty('name', 'Vértebra cervical');
  const ocelli = occupant.getObjectsByProperty('name', 'Ocelo');
  assert.equal(vertebrae.length, 5);
  assert.equal(strands.length, 3);
  assert.ok(ocelli.length >= 4);

  pose(.42, 1, .84);
  const closedJaw = jaw.rotation.x;
  const closedStrandLen = strands[0].scale.y;
  pose(1, 1, 1, .5);
  assert.ok(jaw.rotation.x > closedJaw + .3);
  assert.ok(strands[0].scale.y > closedStrandLen);
  for (const v of vertebrae) assert.ok(Number.isFinite(v.parent.position.z));

  const skull = occupant.getObjectByName('Máscara de ceniza');
  const lowerJaw = occupant.getObjectByName('Mandíbula caída');
  assert.ok(skull.geometry.index.count / 3 >= 1000);
  assert.ok(lowerJaw.geometry.index.count / 3 >= 500);
  for (const attr of [skull.geometry.attributes.position, skull.geometry.attributes.normal, skull.geometry.attributes.color]) {
    for (let i = 0; i < attr.array.length; i++) assert.ok(Number.isFinite(attr.array[i]));
  }
});
