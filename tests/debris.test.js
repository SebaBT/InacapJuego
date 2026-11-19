import assert from 'node:assert/strict';
import test from 'node:test';
import { MeshBasicMaterial } from 'three';
import { buildDebris, generateDebrisPlacements } from '../src/debris.js';
import { benchZ, hall, rooms } from '../src/layout.js';

function makeDummyMaterial() {
  return new MeshBasicMaterial({ vertexColors: true });
}

const dummyArt = {
  plaster: {},
  glass: {}
};

test('generateDebrisPlacements covers corridor, all 6 rooms, annex, landing, and stairs', () => {
  const obstacles = [
    { x0: -hall.halfWidth, x1: -hall.halfWidth + 0.54, z0: benchZ - 0.92, z1: benchZ + 0.92, top: 0.48 },
    { x0: 4.0, x1: 5.5, z0: 0.5, z1: 2.0 }
  ];
  const placements = generateDebrisPlacements(obstacles);
  assert.ok(placements.length >= 1200, 'should generate rich debris across the entire map');

  const zones = new Set(placements.map(p => p.zone));
  assert.ok(zones.has('corridor'));
  for (const r of rooms) {
    assert.ok(zones.has(`room-${r.id}`), `missing debris in room ${r.id}`);
  }
  assert.ok(zones.has('annex'));
  assert.ok(zones.has('landing'));
  assert.ok(zones.has('stairs'));

  // None placed inside the blocking obstacle footprint or mascot center.
  for (const p of placements) {
    const insideStatic = p.x > 4.0 && p.x < 5.5 && p.z > 0.5 && p.z < 2.0;
    assert.equal(insideStatic, false, 'debris must not spawn inside static obstacles');
    const insideMascot = Math.abs(p.x) < 0.8 && Math.abs(p.z - (hall.far + hall.near) / 2) < 0.8;
    assert.equal(insideMascot, false, 'debris must not clip into mascot center');
  }
});

test('buildDebris scales active pieces and drawRange cleanly from 0% to 100% and toggles wireframe', () => {
  const debris = buildDebris(makeDummyMaterial, dummyArt, [], 0.5);
  assert.equal(debris.amount, 0.5);
  assert.equal(debris.root.visible, true);
  assert.equal(debris.activePieces, Math.round(debris.totalPieces * 0.5));
  const halfTris = debris.activeTriangles;
  assert.ok(halfTris > 0);

  // Increasing amount adds triangles & pieces monotonically.
  assert.equal(debris.setAmount(1), true);
  assert.equal(debris.activePieces, debris.totalPieces);
  assert.ok(debris.activeTriangles > halfTris);

  // Clearing to 0 hides debris and sets drawRange count to 0.
  assert.equal(debris.setAmount(0), true);
  assert.equal(debris.activePieces, 0);
  assert.equal(debris.activeTriangles, 0);
  assert.equal(debris.root.visible, false);
  for (const mesh of debris.root.children) {
    assert.equal(mesh.geometry.drawRange.count, 0);
  }

  // Wireframe propagates to both opaque and glass materials.
  debris.setWireframe(true);
  for (const mesh of debris.root.children) {
    assert.equal(mesh.material.wireframe, true);
  }
  debris.setWireframe(false);
  for (const mesh of debris.root.children) {
    assert.equal(mesh.material.wireframe, false);
  }
});
