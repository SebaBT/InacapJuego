import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Vector3 } from 'three';
import { makeAnimator } from '../src/animate.js';

function makeRig() {
  const root = new Group();
  root.position.z = -15;
  const torso = new Group();
  torso.position.set(0, .69, 0);
  root.add(torso);

  const wings = [-1, 1].map(s => {
    const w = new Group();
    w.position.set(s * .22, 1.04, -.186);
    torso.add(w);
    return w;
  });

  const antennae = [-1, 1].map(s => {
    const a = new Group();
    a.position.set(s * .31, 1.33, -.018);
    torso.add(a);
    return a;
  });

  const arms = [-1, 1].map(s => {
    const shoulder = new Group();
    shoulder.position.set(s * .51, .62, -.055);
    const elbow = new Group();
    elbow.position.set(s * .275, -.012, 0);
    const hand = new Group();
    hand.position.set(s * .246, .014, .012);
    const palm = new Group();
    palm.rotation.x = -.36;
    const tip = new Group();
    tip.position.set(s * .32, 0, 0);
    palm.add(tip);
    hand.add(palm);
    elbow.add(hand);
    shoulder.add(elbow);
    torso.add(shoulder);
    return { shoulder, elbow, hand, palm, tip };
  });

  const legs = [-1, 1].map(s => {
    const hip = new Group();
    hip.position.set(s * .237, .026, -.008);
    const knee = new Group();
    knee.position.set(s * .013, -.255, -.008);
    const ankle = new Group();
    ankle.position.set(s * .026, .205 - (.69 + .026 - .255), .018);
    const foot = new Group();
    foot.position.set(0, -.205, 0);
    foot.rotation.y = s * .17;
    ankle.add(foot);
    knee.add(ankle);
    hip.add(knee);
    torso.add(hip);
    return { hip, knee, ankle, foot };
  });

  const shadow = new Group();
  shadow.position.y = .002;
  root.add(shadow);

  const footShadows = [0, 1].map(() => {
    const fs = new Group();
    fs.material = { opacity: 1 };
    root.add(fs);
    return fs;
  });

  const animator = makeAnimator({ torso, wings, antennae, arms, legs, shadow, footShadows });
  return { root, torso, wings, antennae, arms, legs, shadow, footShadows, animator };
}

const soleCorners = [
  new Vector3(-.145, 0, -.123),
  new Vector3(.145, 0, -.123),
  new Vector3(-.145, 0, .302),
  new Vector3(.145, 0, .302)
];

function minSoleY(rig) {
  rig.root.updateMatrixWorld(true);
  let minY = Infinity;
  const p = new Vector3();
  for (const leg of rig.legs) {
    for (const corner of soleCorners) {
      p.copy(corner);
      leg.foot.localToWorld(p);
      if (p.y < minY) minY = p.y;
    }
  }
  return minY;
}

function worldPos(obj) {
  return obj.getWorldPosition(new Vector3());
}

test('idle lowers arms naturally from T-pose and keeps shoes grounded at y = 0', () => {
  const rig = makeRig();
  assert.equal(rig.animator.mode, 'idle');
  assert.equal(rig.root.position.z, -15);
  assert.equal(rig.torso.position.x, 0);
  assert.equal(rig.torso.position.z, 0);
  assert.ok(Math.abs(minSoleY(rig)) < 1e-5);

  rig.root.updateMatrixWorld(true);
  for (const [i, arm] of rig.arms.entries()) {
    const s = i * 2 - 1;
    const sPos = worldPos(arm.shoulder);
    const hPos = worldPos(arm.hand);
    assert.ok(hPos.y < sPos.y - .35, 'arms should hang well below shoulders in idle');
    assert.ok(Math.abs(hPos.x) < .68, 'arms should hang alongside the torso rather than flaring out');
    const palmDir = new Vector3(0, 0, 1).applyMatrix4(arm.palm.matrixWorld).sub(hPos).normalize();
    assert.ok(palmDir.x * s < -.5, 'palms should face inward toward the body in idle');
  }
});

test('all four modes stay in place and never sink shoes below the floor', () => {
  const rig = makeRig();
  for (const mode of ['idle', 'walk', 'run', 'grab', 'idle']) {
    rig.animator.setAnimation(mode);
    for (let i = 0; i < 60; i++) {
      rig.animator.update(1 / 60, false);
      assert.equal(rig.root.position.z, -15);
      assert.equal(rig.torso.position.x, 0);
      assert.equal(rig.torso.position.z, 0);
      const y = minSoleY(rig);
      assert.ok(y >= -1e-5, `${mode} frame ${i} sank below floor: ${y}`);
      if (mode !== 'run') {
        assert.ok(y <= .015, `${mode} frame ${i} floated unnecessarily: ${y}`);
      }
    }
  }
});

test('walk and run articulate opposite legs and arms with run having deeper lean and airborne lift', () => {
  const rig = makeRig();
  rig.animator.setAnimation('walk');
  for (let i = 0; i < 20; i++) rig.animator.update(1 / 60, false);

  let maxWalkFootSpread = 0;
  let maxWalkLean = 0;
  for (let i = 0; i < 60; i++) {
    rig.animator.update(1 / 60, false);
    rig.root.updateMatrixWorld(true);
    const f0 = worldPos(rig.legs[0].foot).z;
    const f1 = worldPos(rig.legs[1].foot).z;
    maxWalkFootSpread = Math.max(maxWalkFootSpread, Math.abs(f0 - f1));
    maxWalkLean = Math.max(maxWalkLean, rig.torso.rotation.x);
  }
  assert.ok(maxWalkFootSpread > .25, 'walk should separate feet along Z during stride');

  rig.animator.setAnimation('run');
  for (let i = 0; i < 20; i++) rig.animator.update(1 / 60, false);

  let maxRunFootSpread = 0;
  let maxRunLean = 0;
  let maxAirborneY = 0;
  for (let i = 0; i < 60; i++) {
    rig.animator.update(1 / 60, false);
    rig.root.updateMatrixWorld(true);
    const f0 = worldPos(rig.legs[0].foot).z;
    const f1 = worldPos(rig.legs[1].foot).z;
    maxRunFootSpread = Math.max(maxRunFootSpread, Math.abs(f0 - f1));
    maxRunLean = Math.max(maxRunLean, rig.torso.rotation.x);
    maxAirborneY = Math.max(maxAirborneY, minSoleY(rig));
  }
  assert.ok(maxRunFootSpread > maxWalkFootSpread, 'run stride should exceed walk stride');
  assert.ok(maxRunLean > maxWalkLean + .10, 'run should lean farther forward than walk');
  assert.ok(maxAirborneY > .03, 'run should include an airborne phase');
});

test('grab lunges forward, reaches both arms toward +Z, and composes wing base spread', () => {
  const rig = makeRig();
  rig.animator.setWingBase(0, -.3, .04);
  rig.animator.setWingBase(1, .3, -.04);
  rig.animator.setAnimation('grab');
  for (let i = 0; i < 25; i++) rig.animator.update(1 / 60, false);
  rig.root.updateMatrixWorld(true);

  assert.ok(rig.torso.rotation.x > .20, 'grab should lunge torso forward');
  for (const [i, arm] of rig.arms.entries()) {
    const s = i * 2 - 1;
    const sPos = worldPos(arm.shoulder);
    const hPos = worldPos(arm.hand);
    const tPos = worldPos(arm.tip);
    assert.ok(hPos.z > sPos.z + .35, 'grab hands should reach forward toward +Z');
    assert.ok(hPos.y > sPos.y - .05, 'grab hands should stay raised near shoulder/chest height');
    assert.ok(hPos.x * s > .15, 'grab hands should frame the player without crossing past center');
    assert.ok(tPos.z > hPos.z + .15, 'grab fingers should extend forward');
  }
  assert.ok(rig.wings[0].rotation.z < -.5, 'right wing should flare on top of base spread');
  assert.ok(rig.wings[1].rotation.z > .5, 'left wing should flare on top of base spread');
});

test('reducedMotion settles to a static pose and stops requesting frames', () => {
  const rig = makeRig();
  rig.animator.setAnimation('grab');
  assert.equal(rig.animator.animating(true), true);
  for (let i = 0; i < 20; i++) rig.animator.update(1 / 60, true);
  assert.equal(rig.animator.animating(true), false);
  assert.equal(rig.animator.update(1 / 60, true), false);
  rig.root.updateMatrixWorld(true);
  for (const arm of rig.arms) {
    assert.ok(worldPos(arm.hand).z > worldPos(arm.shoulder).z + .35);
  }
});

test('run extends arms forward toward an approaching player instead of swinging', () => {
  const rig = makeRig();
  rig.animator.setAnimation('run');

  // Far away: normal running arm swing (hands swing behind shoulders part of the cycle).
  let minFarHandOffset = Infinity;
  for (let i = 0; i < 60; i++) {
    rig.animator.update(1 / 60, false, 10, { x: 0, y: 1.61, z: 10 });
    rig.root.updateMatrixWorld(true);
    minFarHandOffset = Math.min(minFarHandOffset, worldPos(rig.arms[0].hand).z - worldPos(rig.arms[0].shoulder).z);
  }
  assert.equal(rig.animator.reach, 0);
  assert.ok(minFarHandOffset < .15, 'far running arm should swing back during stride');

  // Close in front: arms stay extended toward the player throughout the run cycle.
  for (let i = 0; i < 45; i++) {
    rig.animator.update(1 / 60, false, 1.5, { x: 0, y: 1.61, z: 1.5 });
  }
  assert.ok(rig.animator.reach > .95);
  for (let i = 0; i < 40; i++) {
    rig.animator.update(1 / 60, false, 1.5, { x: 0, y: 1.61, z: 1.5 });
    rig.root.updateMatrixWorld(true);
    for (const arm of rig.arms) {
      const sPos = worldPos(arm.shoulder);
      const hPos = worldPos(arm.hand);
      const tPos = worldPos(arm.tip);
      assert.ok(hPos.z > sPos.z + .40, 'close running arm should stay extended forward');
      assert.ok(tPos.z > hPos.z + .24, 'extended arm should straighten toward the player');
    }
  }

  // Player to the left (+X): extended hands track toward +X.
  const centerHandX = worldPos(rig.arms[0].hand).x;
  for (let i = 0; i < 45; i++) {
    rig.animator.update(1 / 60, false, 2.0, { x: 1.2, y: 1.61, z: 1.6 });
  }
  rig.root.updateMatrixWorld(true);
  assert.ok(worldPos(rig.arms[0].hand).x > centerHandX + .08, 'extended arms should aim toward player X');

  // Player behind (-Z): reach smoothly drops back to 0.
  for (let i = 0; i < 60; i++) {
    rig.animator.update(1 / 60, false, 2.0, { x: 0, y: 1.61, z: -2.0 });
  }
  assert.equal(rig.animator.reach, 0);
});

test('foot shadows stay aligned beneath each shoe across all animations', () => {
  const rig = makeRig();
  const shoeMid = new Vector3();
  for (const mode of ['idle', 'walk', 'run', 'grab']) {
    rig.animator.setAnimation(mode);
    for (let i = 0; i < 45; i++) {
      rig.animator.update(1 / 60, false);
      rig.root.updateMatrixWorld(true);
      for (let legIdx = 0; legIdx < 2; legIdx++) {
        shoeMid.set(0, .03, .095);
        rig.legs[legIdx].foot.localToWorld(shoeMid);
        const fsWorld = worldPos(rig.footShadows[legIdx]);
        assert.ok(Math.hypot(fsWorld.x - shoeMid.x, fsWorld.z - shoeMid.z) < 1e-4,
          `${mode} foot shadow ${legIdx} drifted from shoe`);
      }
    }
  }
});
