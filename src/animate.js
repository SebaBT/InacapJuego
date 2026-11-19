import { Matrix4, Vector3 } from 'three';
import { ease } from './emergence.js';

export const animations = ['idle', 'walk', 'run', 'grab'];

const blendDuration = .2;
const soleCorners = [
  new Vector3(-.145, 0, -.123),
  new Vector3(.145, 0, -.123),
  new Vector3(-.145, 0, .302),
  new Vector3(.145, 0, .302)
];

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function idlePose(time, still) {
  const t = still ? 0 : time;
  const p = t * 1.45;
  const breath = Math.sin(p);
  const sway = Math.sin(t * .63);
  const shift = Math.sin(t * .9 + .6);
  const tz = .016 * shift;
  const ty = .03 * sway;
  return {
    tx: .035 + .014 * breath,
    ty,
    tz,
    flightLift: 0,
    shadowScale: 1,
    legs: [-1, 1].map((s, i) => {
      const worldHipX = -.045 - .01 * breath + (i === 0 ? .025 : -.025);
      const kneeX = .07 + .015 * breath;
      return {
        worldHipX,
        hipY: -ty * .6,
        hipZ: -tz + s * .02,
        kneeX,
        ankleX: -(worldHipX + kneeX)
      };
    }),
    arms: [-1, 1].map((s, i) => ({
      rx: -.04 + .035 * Math.sin(p + i * .4),
      ry: s * .06,
      rz: -s * (1.37 + .025 * breath),
      elbowY: -s * (.22 + .04 * Math.sin(p - .5)),
      handX: 1.42,
      handY: -s * .08,
      handZ: s * .03 * breath,
      palmX: -.36
    })),
    wings: [-1, 1].map((side, i) => ({
      dz: side * (.015 + .015 * Math.sin(p - .4 + i * .2)),
      dy: -side * .01 * breath
    })),
    antennae: [-1, 1].map((s, i) => ({
      rx: .04 * Math.sin(p + .5),
      rz: s * .03 * Math.sin(t * 2.3 + i * 1.4)
    }))
  };
}

function walkPose(stridePhase, still) {
  const p0 = still ? .45 : stridePhase;
  const tz = .045 * Math.sin(p0);
  const ty = -.09 * Math.cos(p0);
  return {
    tx: .09 + .025 * Math.sin(2 * p0),
    ty,
    tz,
    flightLift: 0,
    shadowScale: 1,
    legs: [-1, 1].map((s, i) => {
      const p = p0 + i * Math.PI;
      const c = Math.cos(p), sn = Math.sin(p);
      const swing = Math.max(0, -sn), stance = Math.max(0, sn);
      const worldHipX = -.34 * c - .04;
      const kneeX = .08 + .62 * Math.pow(swing, .85) + .10 * Math.sin(Math.PI * stance);
      const toePush = .25 * Math.pow(Math.max(0, -c), 2);
      const heelStrike = -.14 * Math.pow(Math.max(0, c), 2) * (swing > 0 ? .5 : 1);
      return {
        worldHipX,
        hipY: -ty * .35,
        hipZ: -tz * .65 + s * .015,
        kneeX,
        ankleX: -(worldHipX + kneeX) + toePush + heelStrike
      };
    }),
    arms: [-1, 1].map((s, i) => {
      const p = p0 + i * Math.PI;
      const armSwing = -Math.cos(p); // +1 forward, -1 backward
      return {
        rx: -.04 - .38 * armSwing,
        ry: -s * .05 * armSwing,
        rz: -s * (1.35 - .02 * Math.abs(armSwing)),
        elbowY: -s * (.30 + .16 * Math.max(0, armSwing) - .12 * Math.max(0, -armSwing)),
        handX: 1.40,
        handY: -s * .10,
        handZ: s * .03 * armSwing,
        palmX: -.36
      };
    }),
    wings: [-1, 1].map(side => ({
      dz: side * (.04 + .045 * Math.sin(2 * p0 - .5)),
      dy: -side * (.02 + .02 * Math.cos(2 * p0))
    })),
    antennae: [-1, 1].map((s, i) => ({
      rx: -.06 + .08 * Math.sin(2 * p0 + .3 + i * .2),
      rz: s * .04 * Math.sin(p0)
    }))
  };
}

function runPose(stridePhase, still, reach = 0, aimYaw = 0, aimPitch = 0) {
  const p0 = still ? .55 : stridePhase;
  const tz = .065 * Math.sin(p0);
  const ty = -.16 * Math.cos(p0);
  const flight = Math.pow(Math.max(0, -Math.cos(2 * p0 - .5)), 1.4);
  const flightLift = still ? 0 : .075 * flight;
  return {
    tx: .25 + .045 * Math.sin(2 * p0),
    ty,
    tz,
    flightLift,
    shadowScale: 1 - .14 * flight,
    legs: [-1, 1].map((s, i) => {
      const p = p0 + i * Math.PI;
      const c = Math.cos(p), sn = Math.sin(p);
      const swing = Math.max(0, -sn), stance = Math.max(0, sn);
      const worldHipX = -.62 * c - .06;
      const kneeX = .14 + 1.05 * Math.pow(swing, .78) + .14 * stance;
      const toePush = .36 * Math.pow(Math.max(0, -c), 2);
      const heelStrike = -.18 * Math.pow(Math.max(0, c), 2);
      return {
        worldHipX,
        hipY: -ty * .4,
        hipZ: -tz * .75 + s * .02,
        kneeX,
        ankleX: -(worldHipX + kneeX) + toePush + heelStrike
      };
    }),
    arms: [-1, 1].map((s, i) => {
      const p = p0 + i * Math.PI;
      const armSwing = -Math.cos(p); // +1 forward, -1 backward
      const rxSwing = -.08 - .72 * armSwing;
      const rySwing = -s * (.06 + .12 * armSwing);
      const rzSwing = -s * (1.33 - .03 * armSwing);
      const elbowSwing = -s * (.95 + .22 * armSwing);
      const handXSwing = 1.35;
      const handYSwing = -s * .16;
      const handZSwing = s * .05 * armSwing;
      const palmXSwing = -.36 - .08 * Math.max(0, armSwing);

      const rxReach = -.46 - aimPitch + (still ? 0 : .04 * armSwing);
      const ryReach = -s * 1.34 + aimYaw - ty * .6;
      const rzReach = -s * .14;
      const elbowReach = -s * .14;
      const handXReach = .95;
      const handYReach = -s * (.14 + (still ? 0 : .05 * Math.sin(2 * p0 + i)));
      const handZReach = 0;
      const palmXReach = -.44;

      return {
        rx: lerp(rxSwing, rxReach, reach),
        ry: lerp(rySwing, ryReach, reach),
        rz: lerp(rzSwing, rzReach, reach),
        elbowY: lerp(elbowSwing, elbowReach, reach),
        handX: lerp(handXSwing, handXReach, reach),
        handY: lerp(handYSwing, handYReach, reach),
        handZ: lerp(handZSwing, handZReach, reach),
        palmX: lerp(palmXSwing, palmXReach, reach)
      };
    }),
    wings: [-1, 1].map(side => ({
      dz: side * (.14 + .08 * Math.sin(2 * p0 - .4)),
      dy: -side * (.06 + .04 * Math.cos(2 * p0))
    })),
    antennae: [-1, 1].map(s => ({
      rx: -.18 + .12 * Math.sin(2 * p0),
      rz: s * (.08 + .06 * Math.sin(p0))
    }))
  };
}

function grabPose(grabTime, grabAge, still) {
  const t = still ? 0 : grabTime;
  const shake = still ? 0 : 1;
  const lunge = still ? 1 : 1 - Math.exp(-grabAge * 10);
  const tz = .07 * Math.cos(t * 5.9) * shake + .03 * Math.sin(t * 23) * shake;
  const ty = .11 * Math.sin(t * 6.8) * shake + .04 * Math.sin(t * 27) * shake;
  return {
    tx: .28 + .06 * lunge + shake * (.045 * Math.sin(t * 19) + .025 * Math.cos(t * 7.3)),
    ty,
    tz,
    flightLift: 0,
    shadowScale: 1.03,
    legs: [-1, 1].map((s, i) => {
      const tremor = .035 * Math.sin(t * 8.5 + i * 1.3) * shake;
      const worldHipX = (i === 0 ? -.26 : .22) + tremor;
      const kneeX = (i === 0 ? .42 : .34) + .03 * Math.cos(t * 11 + i) * shake;
      return {
        worldHipX,
        hipY: -ty * .55,
        hipZ: -tz + s * .10,
        kneeX,
        ankleX: -(worldHipX + kneeX)
      };
    }),
    arms: [-1, 1].map((s, i) => {
      const reachJitter = .08 * Math.sin(t * 21 + i * 1.1) * shake;
      const clawPulse = .5 + .5 * Math.sin(t * 11 + i * .8) * shake;
      return {
        rx: -.56 + reachJitter,
        ry: -s * (1.36 + .06 * Math.sin(t * 9 + i) * shake),
        rz: -s * (.08 + .05 * Math.cos(t * 13) * shake),
        elbowY: -s * (.28 + .16 * clawPulse),
        handX: .78,
        handY: -s * (.24 + .18 * clawPulse),
        handZ: s * .08 * Math.sin(t * 18 + i) * shake,
        palmX: -.36 - .14 * clawPulse
      };
    }),
    wings: [-1, 1].map((side, i) => ({
      dz: side * (.36 + .10 * Math.sin(t * 24 + i * .7) * shake),
      dy: -side * (.14 + .05 * Math.cos(t * 19) * shake)
    })),
    antennae: [-1, 1].map((s, i) => ({
      rx: -.28 + .14 * Math.sin(t * 26 + i) * shake,
      rz: s * (.16 + .08 * Math.cos(t * 21) * shake)
    }))
  };
}

function blendPoses(entries) {
  const out = {
    tx: 0, ty: 0, tz: 0, flightLift: 0, shadowScale: 0,
    legs: [{ worldHipX: 0, hipY: 0, hipZ: 0, kneeX: 0, ankleX: 0 }, { worldHipX: 0, hipY: 0, hipZ: 0, kneeX: 0, ankleX: 0 }],
    arms: [
      { rx: 0, ry: 0, rz: 0, elbowY: 0, handX: 0, handY: 0, handZ: 0, palmX: 0 },
      { rx: 0, ry: 0, rz: 0, elbowY: 0, handX: 0, handY: 0, handZ: 0, palmX: 0 }
    ],
    wings: [{ dz: 0, dy: 0 }, { dz: 0, dy: 0 }],
    antennae: [{ rx: 0, rz: 0 }, { rx: 0, rz: 0 }]
  };
  for (const [w, p] of entries) {
    out.tx += w * p.tx;
    out.ty += w * p.ty;
    out.tz += w * p.tz;
    out.flightLift += w * p.flightLift;
    out.shadowScale += w * p.shadowScale;
    for (let i = 0; i < 2; i++) {
      out.legs[i].worldHipX += w * p.legs[i].worldHipX;
      out.legs[i].hipY += w * p.legs[i].hipY;
      out.legs[i].hipZ += w * p.legs[i].hipZ;
      out.legs[i].kneeX += w * p.legs[i].kneeX;
      out.legs[i].ankleX += w * p.legs[i].ankleX;
      out.arms[i].rx += w * p.arms[i].rx;
      out.arms[i].ry += w * p.arms[i].ry;
      out.arms[i].rz += w * p.arms[i].rz;
      out.arms[i].elbowY += w * p.arms[i].elbowY;
      out.arms[i].handX += w * p.arms[i].handX;
      out.arms[i].handY += w * p.arms[i].handY;
      out.arms[i].handZ += w * p.arms[i].handZ;
      out.arms[i].palmX += w * p.arms[i].palmX;
      out.wings[i].dz += w * p.wings[i].dz;
      out.wings[i].dy += w * p.wings[i].dy;
      out.antennae[i].rx += w * p.antennae[i].rx;
      out.antennae[i].rz += w * p.antennae[i].rz;
    }
  }
  return out;
}

function poseEncounter(pose, performance, phase) {
  const fold = performance.fold || 0, duck = Math.max(fold, performance.stoop || 0);
  if (duck > 0) {
    pose.tx = lerp(pose.tx, .025, duck);
    pose.ty *= 1 - fold;
    pose.tz *= 1 - fold;
    pose.flightLift *= 1 - duck;
    for (let i = 0; i < 2; i++) {
      const side = 2 * i - 1, beat = Math.sin(phase + i * Math.PI);
      const leg = pose.legs[i], arm = pose.arms[i];
      leg.worldHipX = lerp(leg.worldHipX, -.99 + .04 * beat, duck);
      leg.kneeX = lerp(leg.kneeX, 1.90 + .09 * beat, duck);
      leg.ankleX = lerp(leg.ankleX, -(leg.worldHipX + leg.kneeX), duck);
      leg.hipZ += fold * .24 * beat;
      arm.rx = lerp(arm.rx, -.08, fold);
      arm.ry = lerp(arm.ry, -side * .14, fold);
      arm.rz = lerp(arm.rz, -side * 1.60, fold);
      arm.elbowY = lerp(arm.elbowY, -side * .33, fold);
      pose.antennae[i].rz = lerp(pose.antennae[i].rz, -side * .98, duck);
      pose.antennae[i].rx *= 1 - fold;
    }
  }
  if (performance.doorPress) {
    const side = Math.sign(performance.doorPress), press = Math.abs(performance.doorPress);
    const leading = pose.arms[side > 0 ? 1 : 0];
    leading.rz = lerp(leading.rz, -side * .19, press);
    leading.elbowY = lerp(leading.elbowY, -side * .21, press);
    leading.handX = lerp(leading.handX, .48, press);
  }
  const th = performance.throw;
  if (th) {
    // A single glove snatches the desk: the body lunges down onto it, yanks it
    // up, then whips the torso and that one arm backwards to fling it clear.
    // The free glove flares forward and out as a counterbalance.
    const handSide = th.side >= 0 ? 1 : -1;
    const grab = Math.min(1, th.reach);
    const whip = (th.hurl || 0) * (1 - (th.recover || 0));
    const pitch = lerp(lerp(.34, -.26, th.lift), .30, th.hurl);
    pose.tx = lerp(pose.tx, pitch, grab);
    pose.ty = lerp(pose.ty * (1 - grab * .7), handSide * .52 * whip, grab);
    pose.tz = lerp(pose.tz, -handSide * .24 * whip, grab);
    for (let i = 0; i < 2; i++) {
      const s = i * 2 - 1, a = pose.arms[i], leg = pose.legs[i];
      if (s === handSide) {
        // Down and forward to snatch, up alongside the shoulder to yank, then
        // back and out and down to hurl the desk behind the monster.
        const rz = lerp(lerp(-s * 1.15, s * 1.50, th.lift), -s * .45, th.hurl);
        const ry = lerp(lerp(-s * 1.05, -s * .10, th.lift), s * 1.25, th.hurl);
        const rx = lerp(lerp(-.28, -.10, th.lift), -.52, th.hurl);
        a.rz = lerp(a.rz, rz, grab);
        a.ry = lerp(a.ry, ry, grab);
        a.rx = lerp(a.rx, rx, grab);
        a.elbowY = lerp(a.elbowY, -s * lerp(lerp(.58, .16, th.lift), .30, th.hurl), grab);
        a.handX = lerp(a.handX, .56, th.grip);
        a.palmX = lerp(a.palmX, -.46, th.grip);
        leg.kneeX += .18 * th.reach - .20 * th.lift + .22 * th.hurl;
      } else {
        // The free glove flares forward and outward, counter-balancing the yank.
        const flare = grab * .85;
        a.rz = lerp(a.rz, lerp(-s * .58, -s * .34, th.lift) - s * .18 * th.hurl, flare);
        a.ry = lerp(a.ry, lerp(-s * .46, -s * .30, th.lift), flare);
        a.rx = lerp(a.rx, -.20 + .12 * th.hurl, flare);
        a.elbowY = lerp(a.elbowY, -s * .34, flare);
        leg.kneeX += .09 * th.reach - .11 * th.lift + .12 * th.hurl;
      }
      leg.ankleX = -(leg.worldHipX + leg.kneeX);
      pose.wings[i].dz += s * (.10 * th.lift + .28 * th.hurl);
      pose.wings[i].dy -= s * .05 * th.hurl;
      pose.antennae[i].rx -= .10 * th.lift + .07 * th.hurl;
    }
  }
  const c = performance.capture;
  if (!c) return;
  // Plant, close both elbows around the upper arms, hoist, then buckle.
  // Rotate the articulated limbs. Glove and victim positions follow the rig.
  // Keep the hands at the sides of the victim's shoulders so both eyes, the
  // mouth and the inner creature stay readable while the suit grips.
  pose.tx = lerp(pose.tx, .17 - .32 * c.lift + .42 * c.drop, c.reach);
  pose.ty *= 1 - c.reach;
  pose.tz *= 1 - c.reach;
  for (let i = 0; i < 2; i++) {
    const s = i * 2 - 1, a = pose.arms[i], leg = pose.legs[i];
    a.rx = lerp(a.rx, -.13 - .17 * c.lift + .58 * c.drop, c.reach);
    a.ry = lerp(a.ry, -s * (1.30 + .28 * c.grip), c.reach);
    a.rz = lerp(a.rz, -s * (.12 + .03 * c.lift + .30 * c.drop), c.reach);
    a.elbowY = lerp(a.elbowY, -s * (.16 + .06 * c.grip), c.reach);
    a.handX = lerp(a.handX, .30, c.grip);
    a.palmX = lerp(a.palmX, -.30, c.grip);
    leg.kneeX += .31 * (c.reach - c.lift + c.drop);
    leg.ankleX = -(leg.worldHipX + leg.kneeX);
    // Panic in the wings and antennae while the gloves clamp down: the suit
    // flares wide on the grab, thrashes on the hoist and sags with the buckle.
    pose.wings[i].dz += s * (.24 * c.grip + .18 * c.lift - .10 * c.drop);
    pose.wings[i].dy -= s * (.09 * c.lift);
    pose.antennae[i].rx -= .16 * c.lift - .22 * c.drop;
    pose.antennae[i].rz += s * (.12 * c.grip + .10 * c.lift);
  }
}

export function makeAnimator({ torso, wings, antennae, arms, legs, shadow, footShadows }) {
  for (const arm of arms) arm.shoulder.rotation.order = 'XYZ';
  const wingBase = wings.map(() => ({ z: 0, y: 0 }));
  const legMatrix = new Matrix4();
  const corner = new Vector3();
  const footCenters = [new Vector3(), new Vector3()];
  const footFwd = new Vector3();
  const bodyCenter = new Vector3();
  const footSoleMinY = [0, 0];
  const footYaw = [0, 0];

  let current = 'idle';
  const weights = { idle: 1, walk: 0, run: 0, grab: 0 };
  let time = 0, stridePhase = 0, grabTime = 0, grabAge = 0;
  let reach = 0, targetReach = 0, aimYaw = 0, aimPitch = 0;
  let lastWings = wings.map(() => ({ z: 0, y: 0 }));
  let lastReducedMotion = false;
  let performance = null;

  function applyWings(wingOffsets) {
    let wingsMoved = false;
    for (let i = 0; i < wings.length; i++) {
      const fold = performance?.fold || 0, side = 2 * i - 1;
      const z = lerp(wingBase[i].z + wingOffsets[i].dz, -side * .48, fold);
      const y = lerp(wingBase[i].y + wingOffsets[i].dy, -side * .17, fold);
      if (wings[i].rotation.z !== z || wings[i].rotation.y !== y) {
        wings[i].rotation.z = z;
        wings[i].rotation.y = y;
        lastWings[i].z = z;
        lastWings[i].y = y;
        wingsMoved = true;
      }
    }
    return wingsMoved;
  }

  function sampleAndApply(still) {
    const active = [];
    const stillGait = still && !performance;
    if (weights.idle > .0001) active.push([weights.idle, idlePose(time, still)]);
    if (weights.walk > .0001) active.push([weights.walk, walkPose(stridePhase, stillGait)]);
    if (weights.run > .0001) active.push([weights.run, runPose(stridePhase, stillGait, reach, aimYaw, aimPitch)]);
    if (weights.grab > .0001) active.push([weights.grab, grabPose(grabTime, grabAge, still)]);
    const pose = blendPoses(active);
    if (performance) {
      if (still) { pose.flightLift = 0; pose.ty *= .32; pose.tz *= .28; }
      poseEncounter(pose, performance, stridePhase);
    }

    torso.rotation.set(pose.tx, pose.ty, pose.tz);
    torso.position.set(0, 0, 0);
    torso.updateMatrix();

    let minSoleY = Infinity;
    for (let i = 0; i < 2; i++) {
      const leg = legs[i], lp = pose.legs[i];
      leg.hip.rotation.set(lp.worldHipX - pose.tx, lp.hipY, lp.hipZ);
      leg.knee.rotation.x = lp.kneeX;
      leg.ankle.rotation.x = lp.ankleX;
      leg.hip.updateMatrix();
      leg.knee.updateMatrix();
      leg.ankle.updateMatrix();
      leg.foot.updateMatrix();
      legMatrix.multiplyMatrices(torso.matrix, leg.hip.matrix);
      legMatrix.multiply(leg.knee.matrix);
      legMatrix.multiply(leg.ankle.matrix);
      legMatrix.multiply(leg.foot.matrix);
      let legMinY = Infinity;
      for (const baseCorner of soleCorners) {
        corner.copy(baseCorner).applyMatrix4(legMatrix);
        if (corner.y < legMinY) legMinY = corner.y;
      }
      footSoleMinY[i] = legMinY;
      if (legMinY < minSoleY) minSoleY = legMinY;
      footCenters[i].set(0, .03, .095).applyMatrix4(legMatrix);
      footFwd.set(0, .03, .30).applyMatrix4(legMatrix);
      footYaw[i] = Math.atan2(footFwd.x - footCenters[i].x, footFwd.z - footCenters[i].z);
    }
    torso.position.y = -minSoleY + pose.flightLift;
    torso.updateMatrix();

    for (let i = 0; i < 2; i++) {
      const arm = arms[i], ap = pose.arms[i];
      arm.shoulder.rotation.set(ap.rx, ap.ry, ap.rz, 'XYZ');
      arm.elbow.rotation.y = ap.elbowY;
      arm.hand.rotation.set(ap.handX, ap.handY, ap.handZ);
      arm.palm.rotation.x = ap.palmX;
    }

    for (let i = 0; i < antennae.length; i++) {
      antennae[i].rotation.x = pose.antennae[i].rx;
      antennae[i].rotation.z = pose.antennae[i].rz;
    }

    if (shadow) {
      bodyCenter.set(0, .55, -.05).applyMatrix4(torso.matrix);
      shadow.position.set(bodyCenter.x * .45, .002, bodyCenter.z * .45);
      shadow.scale.set(pose.shadowScale, pose.shadowScale, 1);
    }
    if (footShadows) {
      for (let i = 0; i < 2; i++) {
        const fs = footShadows[i];
        if (!fs) continue;
        const lift = Math.max(0, footSoleMinY[i] + torso.position.y);
        const scale = Math.max(.72, 1 - lift * .75);
        fs.position.set(footCenters[i].x, .003, footCenters[i].z);
        fs.rotation.set(-Math.PI / 2, footYaw[i], 0, 'YXZ');
        fs.scale.set(scale, scale, 1);
        if (fs.material) fs.material.opacity = Math.max(.22, 1 - lift * 2.8);
      }
    }

    lastWings = pose.wings;
    applyWings(pose.wings);
  }

  sampleAndApply(false);

  return {
    get mode() { return current; },
    get reach() { return reach; },
    animating(reducedMotion = false) {
      return !reducedMotion || Boolean(performance?.throw) || weights[current] < .999 ||
        Math.abs(targetReach - reach) > .002 || reducedMotion !== lastReducedMotion;
    },
    setAnimation(name) {
      if (!animations.includes(name) || name === current) return;
      if (name === 'grab') grabAge = 0;
      if ((name === 'walk' || name === 'run') && weights.walk + weights.run < .001) {
        stridePhase = 0;
      }
      current = name;
    },
    setWingBase(index, z, y) {
      wingBase[index].z = z;
      wingBase[index].y = y;
      applyWings(lastWings);
    },
    update(dt, reducedMotion = false, distance = Infinity, target = null, encounter = null) {
      const previous = performance;
      performance = encounter;
      const step = Math.max(0, dt);
      const frontFactor = target ? ease(-.4, .4, target.z) : 1;
      targetReach = Number.isFinite(distance) ? (1 - ease(1.6, 6.5, distance)) * frontFactor : 0;
      const targetYaw = target && target.z > 0 ? clamp(Math.atan2(target.x, Math.max(.4, target.z)), -.45, .45) * frontFactor : 0;
      const targetPitch = target && target.z > 0
        ? clamp(Math.atan2(target.y - .18 - 1.30, Math.hypot(target.x, target.z)), -.25, .30) * frontFactor
        : 0;
      const wasSettled = weights[current] >= .999 && Math.abs(targetReach - reach) <= .002 && Math.abs(targetYaw - aimYaw) <= .002 && Math.abs(targetPitch - aimPitch) <= .002;
      const modeChanged = reducedMotion !== lastReducedMotion;
      lastReducedMotion = reducedMotion;
      if (step > 0) {
        const rate = step / blendDuration;
        let sum = 0;
        for (const mode of animations) {
          const goal = mode === current ? 1 : 0;
          const diff = goal - weights[mode];
          weights[mode] = Math.abs(diff) <= rate ? goal : weights[mode] + Math.sign(diff) * rate;
          sum += weights[mode];
        }
        if (sum > 0) for (const mode of animations) weights[mode] /= sum;

        const reachRate = Math.min(1, step * 6);
        reach += (targetReach - reach) * reachRate;
        if (Math.abs(targetReach - reach) < .002) reach = targetReach;
        aimYaw += (targetYaw - aimYaw) * reachRate;
        if (Math.abs(targetYaw - aimYaw) < .002) aimYaw = targetYaw;
        aimPitch += (targetPitch - aimPitch) * reachRate;
        if (Math.abs(targetPitch - aimPitch) < .002) aimPitch = targetPitch;

        if (performance) stridePhase = performance.stridePhase;
        if (!reducedMotion) {
          time += step;
          const locoWeight = weights.walk + weights.run;
          if (!performance && locoWeight > 0) {
            const omega = (weights.walk * (2 * Math.PI * 1.05) + weights.run * (2 * Math.PI * 1.9)) / locoWeight;
            stridePhase += step * omega;
          }
          if (weights.grab > 0) {
            grabTime += step;
            grabAge += step;
          }
        }
      }
      if (reducedMotion && step > 0 && wasSettled && !modeChanged &&
          !performance?.capture && !performance?.throw && previous?.throw === performance?.throw &&
          previous?.fold === performance?.fold && previous?.stoop === performance?.stoop &&
          previous?.stridePhase === performance?.stridePhase && previous?.doorPress === performance?.doorPress) return false;
      sampleAndApply(reducedMotion);
      return true;
    }
  };
}
