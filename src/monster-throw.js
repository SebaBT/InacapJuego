import { raycastAabb } from './third-person.js';
import { restingLift, throwableKinds } from './furniture.js';

// One fast clock drives the one-handed snatch, the lift, the backward fling
// and the recovery. The prop is released at the start of the hurl, less than a
// quarter of a second after the reach, so the chase never stalls.
export const throwDuration = .56;
export const throwRelease = .24;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ramp = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// `side` is the hand that performs the one-handed snatch/fling: 1 for the
// monster's right glove, -1 for the left.
export function throwPose(t, side = 1) {
  return {
    reach: ramp(0, .11, t),
    grip: ramp(.08, .18, t),
    lift: ramp(.12, .23, t),
    hurl: ramp(throwRelease, .42, t),
    recover: ramp(.40, throwDuration, t),
    released: t >= throwRelease,
    side: side >= 0 ? 1 : -1
  };
}

export function throwArcPoint(from, to, arc, t) {
  return {
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t + arc * 4 * t * (1 - t),
    z: from.z + (to.z - from.z) * t
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function propAhead(origin, prop) {
  const dx = prop.x - origin.x, dz = prop.z - origin.z;
  const d = Math.hypot(dx, dz) || 1;
  const yaw = origin.yaw ?? 0;
  return (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / d;
}

/**
 * Decide whether a free-standing desk or table is what stands between the
 * monster and the player. A prop qualifies when it is close, between the two,
 * roughly on the direct line, and the route around it does not reach the
 * player. A prop that forces a detour counts too: a crate parked on the chase
 * line is grabbed and thrown instead of being circled forever.
 */
export function findBlockingProp({ origin, player, nav, props = [], reach = 3.2, range = 8.5 }) {
  if (!nav || !props.length) return null;
  const dx = player.x - origin.x, dz = player.z - origin.z;
  const direct = Math.hypot(dx, dz);
  // Pressed against opposite sides of a crate the two are barely a half metre
  // apart, so the floor for the check has to be lower than a body width.
  if (direct < .45 || direct > range) return null;
  const route = nav.route(origin, player) ?? [];
  const last = route[route.length - 1];
  // Crossing a doorway comes first: the doorway is the obstacle, not furniture.
  if (Boolean(last?.portal)) return null;
  let routeLength = 0;
  let prev = origin;
  for (const step of route) {
    routeLength += distance(prev, step);
    prev = step;
  }
  // Direct pursuit is blocked when the route never reaches the player, or when
  // the graph has to walk a visibly longer line than the straight one.
  const endGap = last ? distance(last, player) : Infinity;
  const detoured = !last || endGap > .34 || (route.length > 1 && routeLength > direct + .35);
  const first = typeof nav.firstHit === 'function' ? nav.firstHit(origin, player, .08) : null;
  const directHitMovable = Boolean(first?.obstacle?.movable && first.t < .98);
  if (!detoured && !directHitMovable) return null;

  const boxDist = (p, box) => {
    const cx = clamp(p.x, box.x0, box.x1);
    const cz = clamp(p.z, box.z0, box.z1);
    return Math.hypot(p.x - cx, p.z - cz);
  };

  let best = null, bestDistance = Infinity, nearestEdge = Infinity;
  for (const prop of props) {
    if (!prop || prop.state !== 'rest' || prop.movable === false) continue;
    if (!throwableKinds.includes(prop.kind)) continue;
    const box = prop.collider;
    if (!box) continue;
    const px = prop.x - origin.x, pz = prop.z - origin.z;
    const d = Math.hypot(px, pz);
    const edgeDist = boxDist(origin, box);
    if (edgeDist < nearestEdge) nearestEdge = edgeDist;
    // Arm's length, or close enough that its near edge is within reach.
    if (d > reach && edgeDist > 1.65) continue;
    const t = (px * dx + pz * dz) / (direct * direct);
    if (t < -.12 || t > 1.18) continue;
    const lateral = Math.abs(px * dz - pz * dx) / direct;
    if (lateral > prop.radius + 1.05) continue;
    // Only a non-movable solid sitting in front of the prop rules it out; an
    // adjacent stool or a sibling desk is not "something else in the way".
    if (first && !first.obstacle?.movable && first.obstacle !== prop.collider &&
        first.t < t - .05) continue;
    if (d < bestDistance) { best = prop; bestDistance = d; }
  }
  if (best) return best;
  // Boxed in against furniture at arm's length: no route at all, or the prop is
  // already pressed against the suit. Take the one ahead and fling it.
  if (route.length === 0 || nearestEdge <= 1.15) {
    for (const prop of props) {
      if (!prop || prop.state !== 'rest' || prop.movable === false) continue;
      if (!throwableKinds.includes(prop.kind)) continue;
      const d = distance(origin, prop);
      if (d > 2.2 || propAhead(origin, prop) < -.25) continue;
      if (d < bestDistance) { best = prop; bestDistance = d; }
    }
  }
  return best;
}

function pointFree(x, z, radius, obstacles, ignore) {
  for (const o of obstacles) {
    if (!o || o === ignore || o.active === false || o.kind === 'segment') continue;
    if (o.bottom !== undefined && o.bottom > 1.9) continue;
    const top = o.top ?? o.sightTop ?? 20;
    if (top < .25) continue;
    if (x > o.x0 - radius && x < o.x1 + radius && z > o.z0 - radius && z < o.z1 + radius) return false;
  }
  return true;
}

// The arc clears ordinary low furniture; only walls, tall shelving, lockers and
// other full-height architecture stop a planned throw.
function flightLineFree(from, to, radius, obstacles, ignore) {
  const dx = to.x - from.x, dz = to.z - from.z;
  for (const o of obstacles) {
    if (!o || o === ignore || o.active === false || o.kind === 'segment' || o.step) continue;
    if (o.bottom !== undefined && o.bottom > 2.4) continue;
    const top = o.top ?? o.sightTop ?? 20;
    if (top < 1.55) continue;
    const hit = raycastAabb(from.x, 1.45, from.z, dx, 0, dz,
      o.x0 - radius, -1, o.z0 - radius, o.x1 + radius, 3, o.z1 + radius);
    if (hit < .999) return false;
  }
  return true;
}

/**
 * Pick a landing spot behind or beside the monster, never toward the player.
 * The desk is yanked and whipped backwards out of the chase line, so backwards
 * and diagonal-backwards directions are tried before the plain sideways ones.
 * Landing on architecture or on the player is refused rather than approximated,
 * with a second pass that ignores low furniture when a crowded lab leaves no
 * room between the benches.
 */
export function planThrow({ prop, origin, player, obstacles = [], bounds = null, groundAt = () => 0 }) {
  if (!prop || !prop.localBox) return null;
  const dx = player.x - prop.x, dz = player.z - prop.z;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len, uz = dz / len;
  const aim = (x, z) => {
    const d = Math.hypot(x, z) || 1;
    return { x: x / d, z: z / d };
  };
  // Backward-left, backward-right and straight backward first: the fling sends
  // the desk behind the monster, away from the chase. Wider backwards lanes,
  // then the plain sides, then one forward-sideways lane as the last resort.
  const directions = [
    aim(-ux - uz * .55, -uz + ux * .55),
    aim(-ux + uz * .55, -uz - ux * .55),
    { x: -ux, z: -uz },
    aim(-ux - uz * 1.15, -uz + ux * 1.15),
    aim(-ux + uz * 1.15, -uz - ux * 1.15),
    { x: -uz, z: ux },
    { x: uz, z: -ux },
    aim(ux * .35 - uz, uz * .35 + ux)
  ];
  const radius = prop.radius ?? .5;
  const yawNow = origin?.yaw ?? 0;

  const tryDirections = ({ minDist, maxDist, minPlayerDist, testObstacles, useFlightCheck }) => {
    for (const dir of directions) {
      for (let dist = maxDist; dist >= minDist; dist -= .33) {
        const tx = prop.x + dir.x * dist;
        const tz = prop.z + dir.z * dist;
        if (bounds && (tx < bounds.minX + radius + .1 || tx > bounds.maxX - radius - .1 ||
            tz < bounds.minZ + radius + .1 || tz > bounds.maxZ - radius - .1)) continue;
        if (Math.hypot(tx - player.x, tz - player.z) < minPlayerDist) continue;
        if (!pointFree(tx, tz, radius, testObstacles, prop.collider)) continue;
        if (useFlightCheck &&
            !flightLineFree({ x: prop.x, z: prop.z }, { x: tx, z: tz }, radius * .55,
              testObstacles, prop.collider)) continue;
        const ground = groundAt(tx, tz);
        const yaw = Math.atan2(tx - prop.x, tz - prop.z);
        const sideways = dir.x * uz - dir.z * ux;
        const rest = { x: 0, y: yaw, z: sideways >= 0 ? Math.PI / 2 : -Math.PI / 2, order: 'YXZ' };
        const travel = Math.hypot(tx - prop.x, tz - prop.z);
        const fromGround = groundAt(prop.x, prop.z);
        const from = { x: prop.x, y: fromGround + 1.15 + prop.size.y * .9, z: prop.z };
        // The grabbing hand is the one already on the fling side, so the arm can
        // snatch the desk at its own shoulder and whip it round without a pivot.
        // Local +x glove points along (cos yaw, -sin yaw) in world space.
        const handDot = Math.cos(yawNow) * dir.x - Math.sin(yawNow) * dir.z;
        return {
          propId: prop.id,
          from,
          to: { x: tx, y: ground + restingLift(prop.localBox, rest), z: tz },
          ground,
          yaw,
          rest,
          side: handDot >= 0 ? 1 : -1,
          // A snappy fling: the desk whips through the air and lands before the
          // monster has lost any ground, always dipping under the ceiling.
          arc: clamp(.48 + travel * .08, .58, 1.15),
          duration: clamp(.28 + travel * .048, .34, .58)
        };
      }
    }
    return null;
  };

  const open = tryDirections({
    minDist: 1.7, maxDist: 5.0, minPlayerDist: 1.85,
    testObstacles: obstacles, useFlightCheck: true
  });
  if (open) return open;

  // Crowded labs and storage rooms: benches and desks ring every side, so the
  // landing may sit beside low furniture. Walls, shelving and lockers still
  // rule a spot out, and it never lands on the player.
  const tall = obstacles.filter(o => o && o !== prop.collider && o.active !== false &&
    o.kind !== 'segment' && (o.top ?? o.sightTop ?? 20) >= 1.55);
  return tryDirections({
    minDist: 1.4, maxDist: 4.2, minPlayerDist: 1.35,
    testObstacles: tall, useFlightCheck: true
  });
}
