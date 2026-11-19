import { ease } from './emergence.js';

const chaseTime = .52, screamDuration = 2.65;
const endTime = chaseTime + screamDuration;
const escalationTime = 14;
const initialChaseWear = .34, maxChaseWear = .84;
const poses = new Map([['normal', 0], ['chase', chaseTime], ['scream', endTime]]);

export function suitPerformance() {
  let time = 0, target = 0, age = 0, closest = Infinity, extraWear = 0, desired = 0;
  let chase = 0, scream = 0, wear = 0, push = 0;
  let preview = null, screamFrom = maxChaseWear;

  function sample() {
    chase = ease(0, chaseTime, time);
    scream = Math.max(0, (time - chaseTime) / screamDuration);
    const chaseWear = chase * (initialChaseWear + extraWear);
    wear = chaseWear + (1 - chaseWear) * ease(0, 1, scream);
    // Two uneven shoves under the felt. Only the loose cloth springs back.
    const struggleTime = age + scream * screamDuration;
    const beat = .5 - .5 * Math.cos(struggleTime * 4.4);
    push = beat ** 3 * (.72 + .28 * Math.sin(struggleTime * 2.2)) * wear * chase * (1 - ease(0, .56, scream));
  }

  function needsFrame(showStruggle = true) {
    return preview === null && (time !== target || (target === chaseTime && (showStruggle || age < escalationTime || extraWear < desired)));
  }

  return {
    get chase() { return preview === null ? chase : Math.min(1, preview / initialChaseWear); },
    get scream() {
      if (preview === null) return scream;
      if (preview <= screamFrom) return 0;
      if (preview === 1) return 1;
      // Invert the smoothstep used by the live scream so scrubbing advances the same pose.
      const fraction = (preview - screamFrom) / (1 - screamFrom);
      return .5 - Math.sin(Math.asin(1 - 2 * fraction) / 3);
    },
    get wear() { return preview ?? wear; },
    get push() { return preview === null ? push : 0; },
    get previewing() { return preview !== null; },
    needsFrame,
    setPreviewWear(value) {
      if (value !== null && !Number.isFinite(value)) return;
      if (preview === null) screamFrom = time > chaseTime ? initialChaseWear + extraWear : maxChaseWear;
      preview = value === null ? null : Math.max(0, Math.min(1, value));
    },
    setExpression(name) {
      if (!poses.has(name)) return;
      preview = null;
      if (name === 'scream' && time === endTime && target === endTime) time = chaseTime;
      target = poses.get(name);
      sample();
    },
    update(dt, distance = Infinity, showStruggle = true) {
      const closer = target === chaseTime && distance < closest;
      if (preview !== null || dt <= 0 || (!needsFrame(showStruggle) && !closer)) return false;
      const remaining = target - time;
      time = Math.abs(remaining) <= dt ? target : time + Math.sign(remaining) * dt;
      if (target === chaseTime) {
        age += dt;
        closest = Math.min(closest, distance);
        const proximity = 1 - ease(.95, 6, closest);
        const elapsed = .70 * ease(.8, escalationTime, age);
        const pressure = proximity + (1 - proximity) * elapsed;
        desired = (maxChaseWear - initialChaseWear) * pressure * ease(.45, 2.2, age);
        extraWear = Math.min(desired, extraWear + .25 * dt);
      } else if (time === 0) {
        age = extraWear = desired = 0;
        closest = Infinity;
      }
      sample();
      return true;
    }
  };
}
