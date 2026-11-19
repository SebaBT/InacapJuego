import { monsterSpawn, worldBounds } from './layout.js';
import { createDestruction } from './destruction.js';
import { shortestAngleDiff } from './third-person.js';
import { createMonsterNavigation } from './monster-navigation.js';
import {
  findBlockingProp, planThrow, throwDuration, throwPose, throwRelease
} from './monster-throw.js';

const defaultSightRange = 17, viewCos = Math.cos(58 * Math.PI / 180);
const closeViewCos = Math.cos(88 * Math.PI / 180);
const catchRange = 1.38, baseChaseSpeed = 3.85;
const basePatrolSpeed = 1.06, baseInvestigateSpeed = 1.74;
const defaultLostTimeout = 1.35;
// The suit never shares a footprint with the body it is hunting. Its arms are
// longer than that anyway, so the last half metre is walked with the gloves,
// not with the hem.
const minSeparation = .62;
export const captureDuration = 2.85;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const turn = (a, b, amount) => a + clamp(shortestAngleDiff(a, b), -amount, amount);
const point = p => ({ x: p.x, z: p.z });
function ramp(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// One clock drives the gloves, the victim, the vocal cue and the blackout.
export function capturePose(t) {
  return {
    reach: ramp(0, .28, t), grip: ramp(.16, .52, t),
    lift: ramp(.45, 1.14, t), drop: ramp(1.88, 2.49, t),
    fade: ramp(1.96, 2.68, t)
  };
}

export function createMonsterHunt({ obstacles, doors, holdDoor = () => {}, closeDoor = () => {},
  spawn = monsterSpawn, patrolPoints = null, furniture = null, destruction = null }) {
  const nav = createMonsterNavigation(obstacles, doors);
  const terrain = destruction ?? createDestruction(obstacles, doors);
  const state = {};
  // The live round always tracks its player. An explicitly authored patrol
  // can still be used for a scripted sequence.
  const tracksPlayer = patrolPoints === null;
  let pursuitSpeed = 0;
  let route, plannedGoal, crossing, patrolIndex, replanIn, lostTime, searchTime, searchYaw, cryCooldown, searchGoal;
  let crossingGrace, growlCooldown, slamDoor;
  let throwCheck, throwCooldown, throwProp, clearing, throwOrigin, pickupSpot;
  let stunTime = 0, activeThreat = resolveThreat(null);
  let activePlayer = null;
  function resolveThreat(threat = null) {
    return {
      chaseSpeed: threat?.chaseSpeed ?? baseChaseSpeed,
      patrolSpeed: threat?.patrolSpeed ?? basePatrolSpeed,
      investigateSpeed: threat?.investigateSpeed ?? baseInvestigateSpeed,
      sightRange: threat?.sightRange ?? defaultSightRange,
      hearingMult: threat?.hearingMult ?? 1,
      lostTimeout: threat?.lostTimeout ?? defaultLostTimeout,
      crossingSpeedMult: threat?.crossingSpeedMult ?? 1,
      throwCooldownMult: threat?.throwCooldownMult ?? 1,
      frenzy: Boolean(threat?.frenzy),
      decoy: threat?.decoy ?? null
    };
  }
  function reset() {
    terrain.reset();
    pursuitSpeed = 0;
    nav.invalidate();
    Object.assign(state, { ...spawn, y: nav.floorAt(spawn), mode: tracksPlayer ? 'chase' : 'patrol', visible: false, lastKnown: null,
      speed: 0, stridePhase: 0, fold: 0, doorPress: 0, captureTime: 0, captureSide: 0, captureYaw: spawn.yaw,
      maneuvering: false, stomp: 0, scream: null, growl: null, animation: 'idle',
      throwing: false, throwTime: 0, throwTotal: throwDuration, throwYaw: spawn.yaw, throwSide: 1,
      throwFacingYaw: spawn.yaw, throwPropId: null, throwPlan: null,
      throwPose: null, carry: null, impact: 0, impactDone: false, released: false,
      stunned: 0, frenzy: false, smashedWall: null, smashedProp: null, smashedDecoy: null });
    route = []; plannedGoal = crossing = null;
    patrolIndex = 0; replanIn = lostTime = searchTime = cryCooldown = crossingGrace = growlCooldown = 0;
    searchGoal = null; slamDoor = null;
    throwCheck = throwCooldown = 0; throwProp = null; clearing = 0; throwOrigin = pickupSpot = null;
    stunTime = 0; activeThreat = resolveThreat(null);
    activePlayer = null;
    holdDoor(null);
    furniture?.reset();
  }
  function releaseThrow() {
    if (!state.throwing || !throwProp || !furniture) return;
    if (furniture.held === throwProp) {
      furniture.launch(throwProp, {
        from: state.carry ?? { x: throwProp.x, y: throwProp.y, z: throwProp.z },
        to: { x: throwProp.x, z: throwProp.z },
        arc: .22,
        duration: .22,
        yaw: state.yaw
      });
    }
    state.throwing = false;
    state.throwPose = null;
    state.carry = null;
    state.throwPropId = null;
    state.throwPlan = null;
    throwProp = null;
    pickupSpot = null;
  }
  function stun(duration = 3.2) {
    if (state.mode === 'capture' || state.mode === 'dead') return false;
    const prev = stunTime;
    stunTime = Math.max(stunTime, Math.max(0.25, duration));
    state.stunned = stunTime;
    releaseThrow();
    if (crossing) {
      crossing = null;
      state.fold = 0;
      state.doorPress = 0;
      holdDoor(null);
    }
    slamDoor = null;
    route = [];
    plannedGoal = null;
    if (prev <= 0) state.scream = 'stun';
    return true;
  }
  reset();
  // A player waiting in a threshold is reachable from either side of the
  // opening. On the near side, snap to the closest edge so the suit can grab
  // without reusing the portal; from the far side the folded crossing is the
  // only safe way over.
  function thresholdGoal(p) {
    if (!p || crossing) return p;
    for (const door of doors || []) {
      const t = door.threshold;
      if (!t) continue;
      if (p.x < t.x0 || p.x > t.x1 || p.z < t.z0 || p.z > t.z1) continue;
      const acrossX = t.x1 - t.x0 < t.z1 - t.z0;
      const center = acrossX ? (t.x0 + t.x1) / 2 : (t.z0 + t.z1) / 2;
      const mine = acrossX ? state.x : state.z;
      const theirs = acrossX ? p.x : p.z;
      // Same side: snap to the near edge and grab without reusing the portal.
      // Opposite side: the player is behind the doorway and only the folded
      // crossing may bring the suit over, so keep the real point.
      if (Math.sign(mine - center) * Math.sign(theirs - center) < 0) return p;
      if (acrossX) {
        const side = state.x < center ? -1 : 1;
        return { x: side < 0 ? t.x0 : t.x1, z: p.z };
      }
      const side = state.z < center ? -1 : 1;
      return { x: p.x, z: side < 0 ? t.z0 : t.z1 };
    }
    return p;
  }
  function perceive(p, dt) {
    const dx = p.x - state.x, dz = p.z - state.z, d = Math.hypot(dx, dz);
    const eye = { x: state.x, y: state.y + 1.72 - state.fold * .27, z: state.z };
    const target = { x: p.x, y: p.cameraY, z: p.z };
    const forward = Math.sin(state.yaw) * dx + Math.cos(state.yaw) * dz;
    // Up close, or once the hunt is already running, the suit does not need the
    // player inside a narrow cone: a body pressed into the corner beside it is
    // still seen.
    const effViewCos = (d < 3.2 || state.mode === 'chase' || state.mode === 'investigate' ||
      state.mode === 'search' || activeThreat.frenzy) ? closeViewCos : viewCos;
    const wasVisible = state.visible;
    const lineOfSight = nav.visible(eye, target);
    state.visible = d <= activeThreat.sightRange && forward >= d * effViewCos && lineOfSight;
    if (!state.visible && d < (activeThreat.frenzy ? 2.6 : 1.85) && lineOfSight) state.visible = true;
    const heard = !tracksPlayer && p.noiseRadius > 0 &&
      nav.acousticDistance(state, p) <= p.noiseRadius * activeThreat.hearingMult;
    const decoy = activeThreat.frenzy ? null : activeThreat.decoy;
    let decoyHeard = false;
    if (decoy) {
      const decoyDist = distance(state, decoy);
      if (decoyDist < 1.15 && !state.maneuvering) {
        state.smashedDecoy = decoy.id;
        state.impact = 1;
        if (state.lastKnown?.decoyId === decoy.id) state.lastKnown = null;
      } else if (!state.visible && decoy.radius > 0) {
        const dAcoustic = nav.acousticDistance(state, decoy);
        const reach = Number.isFinite(dAcoustic) ? dAcoustic : decoyDist;
        decoyHeard = reach <= decoy.radius * activeThreat.hearingMult;
      }
    }
    if (state.visible) {
      if ((state.mode !== 'chase' || (tracksPlayer && !wasVisible)) && cryCooldown <= 0) {
        state.scream = 'alert';
        cryCooldown = activeThreat.frenzy ? 3.0 : 4.5;
      }
      state.mode = 'chase';
      lostTime = 0;
    } else if (decoyHeard) {
      state.mode = 'investigate';
      state.lastKnown = { x: decoy.x, z: decoy.z, decoyId: decoy.id };
      searchGoal = null;
    } else if (tracksPlayer || activeThreat.frenzy) {
      state.mode = 'chase';
      state.lastKnown = point(p);
      searchGoal = null;
      lostTime = 0;
    } else if (state.mode === 'chase') {
      lostTime += dt;
      if (lostTime > activeThreat.lostTimeout) state.mode = 'investigate';
    } else if (heard) {
      state.mode = 'investigate';
    }
    if (state.visible || (heard && !decoyHeard)) {
      state.lastKnown = point(p);
      searchGoal = null;
    } else if (!tracksPlayer && !decoyHeard && (state.mode === 'chase' || state.mode === 'investigate') &&
      d < 4.5 && nav.blockingOpenDoor?.(state, p)) {
      // The open leaf hides the body from the corridor, but the suit knows the
      // player ducked into the pocket behind it. Keep the trail alive so the
      // hunt walks to the doorway and folds through it instead of giving up.
      state.lastKnown = point(p);
      lostTime = 0;
      searchGoal = null;
    }
    // The folded suit cannot grab or kill at any point of the door manoeuvre:
    // folding, bracing, crossing or unfolding. The hunt resumes once the body
    // is back to its normal width.
    if (state.visible) tryCapture(p);
  }
  // The same grab test is reused at the bottom of the frame, after the walk and
  // the corner lunge: a step that ends within reach is grabbed on that frame
  // instead of idling beside the player or pushing through her.
  function tryCapture(p) {
    if (!p || state.maneuvering || state.mode === 'capture') return false;
    const dx = p.x - state.x, dz = p.z - state.z;
    if (Math.hypot(dx, dz) > catchRange) return false;
    if (Math.abs((p.jump?.height ?? 0) - state.y) >= 1.15) return false;
    // Read the line from where the body stands now: the lunge may have closed
    // the distance after perception ran on the old stance.
    const eye = { x: state.x, y: state.y + 1.72 - state.fold * .27, z: state.z };
    const target = { x: p.x, y: p.cameraY, z: p.z };
    if (!nav.visible(eye, target)) return false;
    if (!nav.canReach({ ...eye, y: state.y + 1.32 },
        { ...target, y: Math.max(state.y + .85, p.cameraY - .18) })) return false;
    state.mode = 'capture';
    state.captureYaw = Math.atan2(dx, dz);
    state.captureSide = 0;
    state.doorPress = 0;
    state.captureTime = state.speed = 0;
    state.animation = 'grab';
    state.scream = null;
    return true;
  }
  // Never let a walk end with the suit standing inside the player. The step is
  // undone along the way it came (or slid around her body when a wall is in the
  // way), and the grab happens from arm's length instead.
  function keepOffPlayer(fromX, fromZ) {
    const p = activePlayer;
    if (crossing || !p || !p.active || state.mode === 'capture') return;
    let dx = state.x - p.x, dz = state.z - p.z, d = Math.hypot(dx, dz);
    if (d >= minSeparation) return;
    if (d < 1e-6) {
      dx = fromX - p.x; dz = fromZ - p.z; d = Math.hypot(dx, dz);
    }
    if (d < 1e-6) {
      dx = -Math.sin(state.yaw); dz = -Math.cos(state.yaw); d = 1;
    }
    const base = Math.atan2(dz, dx);
    let best = null, bestGap = -Infinity;
    for (const offset of [0, Math.PI / 5, -Math.PI / 5, Math.PI / 2.5, -Math.PI / 2.5,
      Math.PI * .75, -Math.PI * .75]) {
      const angle = base + offset;
      const spot = { x: p.x + Math.cos(angle) * minSeparation,
        z: p.z + Math.sin(angle) * minSeparation };
      const settled = nav.clampToSolids ? nav.clampToSolids(state, spot, .42) : spot;
      const gap = Math.hypot(settled.x - p.x, settled.z - p.z);
      if (gap >= minSeparation - 1e-3) { best = settled; break; }
      if (gap > bestGap) { bestGap = gap; best = settled; }
    }
    if (best) { state.x = best.x; state.z = best.z; }
  }
  function moveToward(next, speed, dt) {
    const dx = next.x - state.x, dz = next.z - state.z, d = Math.hypot(dx, dz);
    const step = Math.min(d, dt * speed);
    const fromX = state.x, fromZ = state.z;
    if (d > 0) {
      state.x += dx * step / d;
      state.z += dz * step / d;
    }
    if (step === d) { state.x = next.x; state.z = next.z; }
    keepOffPlayer(fromX, fromZ);
    state.y = nav.floorAt(state);
    state.speed = dt > 0 ? step / dt : 0;
    return step === d;
  }
  // The suit keeps talking to itself while it moves: a low prowl on patrol, a
  // wet rasp while searching, a snarl once the chase is on.
  function emitGrowl(dt) {
    growlCooldown -= dt;
    if (growlCooldown > 0 || state.scream) return;
    if (state.speed > .05 || state.mode === 'chase' ||
      state.mode === 'investigate' || state.mode === 'search') {
      state.growl = state.mode === 'chase' ? 'snarl'
        : (state.mode === 'investigate' || state.mode === 'search') ? 'rasp' : 'prowl';
      growlCooldown = state.mode === 'chase' ? 1.4 : 2.3;
    }
  }
  function pursue(target, dt) {
    const dx = target.x - state.x, dz = target.z - state.z;
    const dist = Math.hypot(dx, dz);
    if (!dist) return;
    const ux = dx / dist, uz = dz / dist;
    state.yaw = turn(state.yaw, Math.atan2(dx, dz), dt * 8);
    const ahead = length => ({ x: state.x + ux * length, z: state.z + uz * length });
    const radius = .53;
    const walkSpeed = Math.min(2.05, activeThreat.patrolSpeed + .30);
    // Sight of a wall lengthens the stride. Only contact by this frame's
    // moving body breaks it; the look-ahead itself never changes the world.
    const probe = Math.min(dist, Math.max(2.3, activeThreat.chaseSpeed * dt));
    const { t, obstacle } = nav.firstHit(state, ahead(probe), radius, state.y);
    const contact = obstacle ? probe * t : Infinity;
    const rush = activeThreat.frenzy ? 1 : 1 - ramp(0, 2.3, contact);
    const desired = walkSpeed + (activeThreat.chaseSpeed - walkSpeed) * rush;
    if (!pursuitSpeed) pursuitSpeed = walkSpeed;
    pursuitSpeed += (desired - pursuitSpeed) * (1 - Math.exp(-dt * (desired > pursuitSpeed ? 8 : 2.6)));
    let step = Math.min(dist, pursuitSpeed * dt);
    if (obstacle && contact <= step) {
      const center = ahead(contact);
      let x = clamp(center.x, obstacle.x0, obstacle.x1), z = clamp(center.z, obstacle.z0, obstacle.z1);
      if (obstacle.kind === 'segment') {
        const vx = obstacle.bx - obstacle.ax, vz = obstacle.bz - obstacle.az;
        const along = clamp(((center.x - obstacle.ax) * vx + (center.z - obstacle.az) * vz) /
          (vx * vx + vz * vz || 1), 0, 1);
        x = obstacle.ax + along * vx; z = obstacle.az + along * vz;
      }
      const prop = obstacle.movable && furniture?.byId(obstacle.propId);
      if (prop) {
        furniture.launch(prop, { to: { x: prop.x + uz * 2.8, z: prop.z - ux * 2.8 },
          arc: .95, duration: .48, yaw: state.yaw });
        state.smashedProp = { x, z };
      } else if (terrain.breach(x, z, state.y, obstacle)) {
        if (obstacle.movable) state.smashedProp = { x, z };
        else state.smashedWall = { x, z, y: state.y, dx: ux, dz: uz };
      }
      if (state.smashedProp || state.smashedWall) {
        nav.invalidate();
        state.impact = 1;
      }
      // A second collider, or the locked exit gate, may still occupy the
      // remainder. Spend the same stride up to that surface.
      step *= nav.firstHit(state, ahead(step), radius, state.y).t;
    }
    moveToward(ahead(step), pursuitSpeed, dt);
  }
  function passDoor(next, goal, dt) {
    const { portal } = next;
    const cMult = activeThreat.crossingSpeedMult;
    if (!crossing) {
      if (portal.door.locked) { route = []; plannedGoal = null; return false; }
      const heading = Math.atan2(next.x - state.x, next.z - state.z);
      crossing = { phase: 'fold', heading, side: Math.sign(Math.sin(heading - portal.sideYaw)),
        brace: { x: portal.center.x - 1.22 * Math.sin(heading), z: portal.center.z - 1.22 * Math.cos(heading) } };
      lostTime = 0;
    }
    if (crossing.phase === 'fold') {
      state.fold = Math.min(1, state.fold + dt * cMult / .44);
      state.yaw = turn(state.yaw, portal.sideYaw, dt * 5.6 * cMult);
      if (state.fold === 1 && Math.abs(shortestAngleDiff(state.yaw, portal.sideYaw)) < .01) crossing.phase = 'approach';
    } else if (crossing.phase === 'approach') {
      const braced = moveToward(crossing.brace, 1.28 * cMult, dt);
      state.doorPress = crossing.side * (1 - portal.door.open) * (1 - ramp(0, .72, distance(state, crossing.brace)));
      if (braced) { holdDoor(portal.door, state); crossing.phase = 'cross'; }
    } else if (crossing.phase === 'cross') {
      state.doorPress = crossing.side * (1 - portal.door.open);
      if (portal.door.open >= .985 && moveToward(next, 1.48 * cMult, dt)) crossing.phase = 'unfold';
      if (state.mode !== 'patrol' && distance(portal.center, goal) < 1.65 && distance(state, goal) < .72) {
        crossing.visited = point(goal);
      }
    } else {
      state.fold = Math.max(0, state.fold - dt * cMult / .44);
      state.yaw = turn(state.yaw, crossing.heading, dt * 4.8 * cMult);
      if (state.fold === 0) {
        const reached = crossing.visited && distance(goal, crossing.visited) < .72;
        crossing = plannedGoal = null; route = [];
        lostTime = 0;
        // Keep hunting after the door instead of immediately giving up on a
        // player who is behind the unfolded suit.
        crossingGrace = 1.1;
        holdDoor(null);
        return Boolean(reached);
      }
    }
    return false;
  }
  function travel(goal, dt) {
    if (!crossing && (!plannedGoal || (replanIn <= 0 && distance(goal, plannedGoal) > .48))) {
      route = nav.route(state, goal);
      plannedGoal = point(goal);
      replanIn = activeThreat.frenzy ? .16 : .24;
    }
    const next = route[0];
    if (!next) return true;
    if (next.portal) {
      return passDoor(next, goal, dt);
    }
    const angle = Math.atan2(next.x - state.x, next.z - state.z);
    const chasing = state.mode === 'chase';
    state.yaw = turn(state.yaw, angle, dt * (chasing ? 6.8 : 3.9));
    const facing = Math.max(.1, Math.cos(shortestAngleDiff(state.yaw, angle)));
    const speed = chasing ? activeThreat.chaseSpeed
      : state.mode === 'patrol' ? activeThreat.patrolSpeed : activeThreat.investigateSpeed;
    if (moveToward(next, speed * facing, dt)) route.shift();
    return route.length === 0;
  }
  function beginSearch() {
    if (activeThreat.frenzy) {
      state.mode = 'chase';
      plannedGoal = null;
      return;
    }
    state.mode = 'search'; plannedGoal = null;
    searchTime = 0; searchYaw = state.yaw;
  }
  function search(dt) {
    if (activeThreat.frenzy) {
      state.mode = 'chase';
      searchGoal = null;
      plannedGoal = null;
      return;
    }
    searchTime += dt;
    state.yaw = searchYaw + 1.13 * Math.sin(searchTime * 1.7);
    if (searchTime < 3.1) return;
    // If the trail ended near any unlocked doorway, push just past the far side once.
    const door = !searchGoal && state.lastKnown && (doors || []).find(d =>
      !d.locked && d.pos && distance(state.lastKnown, d.pos) < 2.4
    );
    if (door) {
      const t = door.threshold;
      const acrossX = t ? (t.x1 - t.x0) < (t.z1 - t.z0) : true;
      const nx = acrossX ? 1 : 0;
      const nz = acrossX ? 0 : 1;
      const mine = (state.x - door.pos.x) * nx + (state.z - door.pos.z) * nz;
      const oppSide = mine >= 0 ? -1 : 1;
      const candidate = { x: door.pos.x + nx * oppSide * 2.4, z: door.pos.z + nz * oppSide * 2.4 };
      if (!nav.areaAt || nav.areaAt(candidate)) {
        searchGoal = candidate;
        state.mode = 'investigate';
        plannedGoal = null;
        return;
      }
    }
    state.mode = 'patrol'; state.lastKnown = searchGoal = null;
    plannedGoal = null;
  }
  function beginThrow(prop, plan) {
    // Approach the nearest reachable edge before moving any geometry. A stool
    // dropped in the aisle, or a desk pushed against this one, must not veto the
    // snatch: the long arms only need a clear line to the prop's own edge.
    const box = prop.collider;
    const edgeX = clamp(state.x, box.x0, box.x1);
    const edgeZ = clamp(state.z, box.z0, box.z1);
    if (!nav.canReach({ x: state.x, y: state.y + 1.32, z: state.z },
        { x: edgeX, y: state.y + 1.0, z: edgeZ })) return false;
    const edgeDist = Math.hypot(state.x - edgeX, state.z - edgeZ);
    if (edgeDist > 2.6) return false;
    if (edgeDist <= 1.15) {
      // Already at arm's length: plant the gloves there and throw from the spot.
      pickupSpot = null;
    } else {
      const rawSpot = {
        x: edgeX + ((state.x - edgeX) / edgeDist) * .72,
        z: edgeZ + ((state.z - edgeZ) / edgeDist) * .72
      };
      pickupSpot = nav.clampToSolids ? nav.clampToSolids(state, rawSpot, .42) : rawSpot;
    }
    throwProp = prop;
    throwOrigin = { x: prop.x, y: prop.y, z: prop.z, yaw: prop.group.rotation.y };
    state.throwing = true;
    state.throwTime = 0;
    state.released = false;
    state.impactDone = false;
    state.throwPropId = prop.id;
    state.throwYaw = plan.yaw;
    state.throwPlan = plan;
    state.throwSide = plan.side ?? 1;
    // Remember the pursuit heading: the body keeps chasing while only the
    // torso whips toward the fling, so the monster never turns its back.
    state.throwFacingYaw = state.yaw;
    // Keep the follow-through alive until the desk actually lands, even for a
    // long throw that outlasts the arm animation.
    state.throwTotal = Math.max(throwDuration, throwRelease + (plan.duration ?? .45) + .06);
    state.throwPose = null;
    state.carry = null;
    state.speed = 0;
    state.animation = 'idle';
    crossing = null;
    route = []; plannedGoal = null;
    return true;
  }
  function updateThrow(dt) {
    if (pickupSpot) {
      // Walking over to the desk must never mean walking over the player. Look
      // first: a crouched body pressed against the desk is caught where it is,
      // and the throw is abandoned.
      if (activePlayer) {
        perceive(activePlayer, dt);
        if (state.mode === 'capture') {
          state.throwing = false;
          pickupSpot = null;
          throwProp = null;
          state.throwPropId = null;
          state.throwPlan = null;
          state.throwPose = null;
          return state;
        }
      }
      const towardProp = Math.atan2(throwProp.x - state.x, throwProp.z - state.z);
      state.yaw = turn(state.yaw, towardProp, dt * 6);
      // Close the distance at full sprint speed: the monster must not slow-walk
      // up to the desk it is about to snatch.
      const arrived = moveToward(pickupSpot, activeThreat.chaseSpeed, dt);
      const oldBeat = Math.floor(state.stridePhase / Math.PI);
      state.stridePhase += state.speed * dt * Math.PI / .72;
      const beat = Math.floor(state.stridePhase / Math.PI);
      if (state.speed > .05 && oldBeat !== beat) state.stomp = beat % 2 ? 1 : -1;
      emitGrowl(dt);
      state.animation = arrived ? 'idle' : 'run';
      if (arrived && Math.abs(shortestAngleDiff(state.yaw, towardProp)) < .45) pickupSpot = null;
      return state;
    }
    const total = state.throwTotal ?? throwDuration;
    state.throwTime = Math.min(total, state.throwTime + dt);
    state.speed = 0;
    const pose = throwPose(state.throwTime, state.throwSide);
    state.throwPose = pose;
    // No 180-degree pivot away from the player: the body keeps its pursuit
    // heading and only whips the torso/yaw toward the fling side for an instant.
    const side = state.throwSide ?? 1;
    const facing = state.throwFacingYaw ?? state.yaw;
    const whip = (pose.hurl ?? 0) * (1 - (pose.recover ?? 0));
    const whipYaw = facing + shortestAngleDiff(facing, state.throwYaw) * .18 * whip;
    state.yaw = turn(state.yaw, whipYaw, dt * 11);
    if (pose.grip > 0 && !state.released && !furniture.held) furniture.grab(throwProp);
    const lift = pose.lift, hurl = pose.hurl, attach = pose.grip;
    const sin = Math.sin(state.yaw), cos = Math.cos(state.yaw);
    // The single glove snatches the desk at the monster's own side and just in
    // front of it, yanks it up, then whips it back along the fling vector.
    const lateral = .38 + .10 * hurl;
    const forward = .46 - .34 * lift;
    const sweepX = Math.sin(state.throwYaw), sweepZ = Math.cos(state.throwYaw);
    const hx = state.x + sin * forward + cos * side * lateral + sweepX * (.62 * hurl);
    const hz = state.z + cos * forward - sin * side * lateral + sweepZ * (.62 * hurl);
    const hy = state.y + .10 + 1.22 * lift - .52 * hurl;
    const origin = throwOrigin ?? { x: hx, y: hy, z: hz };
    state.carry = {
      x: origin.x + (hx - origin.x) * attach,
      y: origin.y + (hy - origin.y) * attach,
      z: origin.z + (hz - origin.z) * attach,
      yaw: origin.yaw + shortestAngleDiff(origin.yaw, state.yaw) * attach,
      roll: .12 * lift - .35 * hurl
    };
    const plan = state.throwPlan;
    if (!state.released && pose.released && throwProp) {
      state.released = true;
      const resolved = furniture.launch(throwProp, { ...plan, from: { ...state.carry } });
      if (resolved) state.throwPlan = { ...plan, ...resolved };
    }
    if (!state.impactDone && plan && state.throwTime >= throwRelease + plan.duration) {
      state.impactDone = true;
      state.impact = 1;
    }
    if (state.throwTime >= total) {
      state.throwing = false;
      state.throwPose = null;
      state.carry = null;
      state.throwPropId = null;
      state.throwPlan = null;
      // Resume the chase immediately: a short cooldown, no long clearing hold.
      state.yaw = facing;
      throwProp = null;
      plannedGoal = null; replanIn = 0;
      throwCooldown = .35 * activeThreat.throwCooldownMult;
      clearing = .18;
    }
    state.animation = 'idle';
    return state;
  }
  function update(dt, p, threat = null) {
    activePlayer = p || null;
    activeThreat = resolveThreat(threat);
    state.stomp = 0; state.scream = null; state.growl = null; state.impact = 0;
    state.smashedWall = null; state.smashedProp = null; state.smashedDecoy = null;
    state.frenzy = activeThreat.frenzy;
    state.maneuvering = Boolean(crossing) || state.fold > .001 ||
      Boolean(slamDoor && (slamDoor.open ?? 0) > .55);
    if (!p.active || p.noclip || dt <= 0 || state.mode === 'dead') return state;
    if (state.mode === 'capture') {
      const prev = state.captureTime;
      if (!state.captureSide) {
        state.yaw = turn(state.yaw, state.captureYaw, dt * 7.8);
        state.fold = Math.max(0, state.fold - dt * 2.2);
      }
      state.captureTime = Math.min(captureDuration, prev + dt);
      if (prev < .78 && state.captureTime >= .78) state.scream = 'capture';
      if (state.captureTime === captureDuration) state.mode = 'dead';
      return state;
    }
    if (stunTime > 0) {
      stunTime = Math.max(0, stunTime - dt);
      state.stunned = stunTime;
      state.speed = 0;
      state.animation = 'idle';
      state.maneuvering = false;
      state.doorPress = 0;
      return state;
    }
    state.stunned = 0;
    if (state.throwing) {
      if (!tracksPlayer && !activeThreat.frenzy) return updateThrow(dt);
      releaseThrow();
    }
    state.speed = 0;
    cryCooldown -= dt; replanIn -= dt;
    throwCooldown -= dt; throwCheck -= dt;
    clearing = Math.max(0, clearing - dt);
    crossingGrace = Math.max(0, crossingGrace - dt);
    perceive(p, dt);
    if (state.mode === 'capture') return state;
    // A desk or table parked across the chase is picked up and thrown clear
    // instead of leaving the suit planted and staring at the player. A player
    // crouched behind it at close range still counts: the investigation is the
    // chase in all but name once the two are inside a room's length.
    const charging = tracksPlayer || activeThreat.frenzy;
    if (charging) {
      if (crossing || slamDoor) holdDoor(null);
      crossing = slamDoor = plannedGoal = null;
      route = [];
      state.fold = 0;
      state.maneuvering = false;
      state.doorPress = 0;
    }
    const closeInvestigation = state.mode === 'investigate' && distance(state, p) < 4.5;
    if (!charging && furniture && state.visible && !crossing && throwCooldown <= 0 && throwCheck <= 0 &&
        (state.mode === 'chase' || closeInvestigation)) {
      throwCheck = .32;
      const prop = findBlockingProp({ origin: state, player: p, nav, props: furniture.props });
      const plan = prop ? planThrow({
        prop, origin: state, player: p, obstacles, bounds: worldBounds,
        groundAt: (x, z) => nav.floorAt({ x, z })
      }) : null;
      if (plan && beginThrow(prop, plan)) return state;
      // A found prop that could not be reached yet is retried after a short
      // step; with nothing on the line the check can wait a full beat.
      throwCooldown = (prop ? .55 : 1.6) * activeThreat.throwCooldownMult;
    }
    if (slamDoor && (slamDoor.open ?? 0) <= .25) {
      slamDoor = null;
      state.doorPress = 0;
    }
    // The player is tucked behind an open leaf. Walk around to the door, slam
    // it shut and step into the corner it was shielding.
    let closingDoor = false;
    if (!charging && !crossing && (state.mode === 'chase' || state.mode === 'investigate')) {
      const behind = nav.blockingOpenDoor?.(state, p);
      // Slamming only makes sense once the suit stands on the player's side of
      // the doorway. From the corridor (or from the room while the player is
      // still in it) the walk has to use the folded passage: a straight line to
      // the stand spot cuts clean through the wall between the two areas.
      const sameSide = Boolean(behind) && Boolean(nav.sameArea?.(state, p));
      if (behind && sameSide && behind.door !== slamDoor) {
        closingDoor = true;
        state.yaw = turn(state.yaw, Math.atan2(behind.standSpot.x - state.x, behind.standSpot.z - state.z), dt * 6.8);
        // Reach the slam spot over the room's own graph; the desk bays and the
        // painted wall corners are not a straight line.
        travel(behind.standSpot, dt);
        if (distance(state, behind.standSpot) < .45 || distance(state, behind.door.pos) < 1.75) {
          state.doorPress = 1;
          slamDoor = behind.door;
          // The suit saw where the body went. Keep that point as the goal so
          // the hunt carries on through the closing door instead of giving
          // up and searching the corridor.
          state.lastKnown = point(p);
          lostTime = 0;
          holdDoor(null);
          closeDoor(behind.door);
          nav.invalidate();
          route = [];
          plannedGoal = null;
        } else {
          state.doorPress = 0;
        }
      }
    }
    if (charging) {
      pursue(state.lastKnown?.decoyId ? state.lastKnown : p, dt);
    } else if (!closingDoor) {
      if (state.mode === 'search') {
        search(dt);
      } else {
        const goal = state.mode === 'patrol' ? patrolPoints[patrolIndex]
          : thresholdGoal(searchGoal ?? state.lastKnown);
        if (travel(goal, dt)) {
          if (state.mode === 'patrol') {
            patrolIndex = (patrolIndex + 1) % patrolPoints.length;
            plannedGoal = null;
          } else if (state.visible && (state.mode === 'chase' || state.mode === 'investigate')) {
            // The route ends at the closest padded graph point to the corner.
            // Press straight in so the contact test can fire instead of
            // standing in idle, staring at the player wedged beside a wall.
            // Only inside the same room, and the step is swept against the
            // solids so the lunge can never clip a wall or a partition.
            const d = distance(state, p);
            const shared = nav.sameArea ? nav.sameArea(state, p) : true;
            if (shared && d > catchRange * .85 && d < 2.2 &&
                nav.canReach({ x: state.x, y: state.y + 1.32, z: state.z },
                  { x: p.x, y: p.cameraY - .15, z: p.z })) {
              state.yaw = turn(state.yaw, Math.atan2(p.x - state.x, p.z - state.z), dt * 6.8);
              const step = nav.clampToSolids ? nav.clampToSolids(state, p, .42) : p;
              moveToward(step, activeThreat.chaseSpeed * .85, dt);
            }
          } else if (state.lastKnown?.decoyId && state.mode === 'investigate') {
            state.smashedDecoy = state.lastKnown.decoyId;
            state.impact = 1;
            state.lastKnown = null;
            if (activeThreat.frenzy) {
              state.mode = 'chase';
              state.lastKnown = point(p);
            } else {
              beginSearch();
            }
          } else if (!state.visible && crossingGrace <= 0) beginSearch();
          else if (clearing > 0) state.yaw = turn(state.yaw, Math.atan2(p.x - state.x, p.z - state.z), dt * 4);
          else state.yaw = turn(state.yaw, Math.atan2(p.x - state.x, p.z - state.z), dt * 6);
        }
      }
    }
    const running = state.mode === 'chase' && state.speed > 2.1 && !crossing;
    state.animation = state.speed < .02 ? 'idle' : running ? 'run' : 'walk';
    const oldBeat = Math.floor(state.stridePhase / Math.PI);
    state.stridePhase += state.speed * dt * Math.PI / (crossing ? .42 : running ? 1.10 : .72);
    const beat = Math.floor(state.stridePhase / Math.PI);
    // Every stride beat shakes the floor, at full weight in a run and lighter
    // while stalking, so the player can hear where the suit is walking.
    if (state.speed > .05 && oldBeat !== beat) {
      state.stomp = (beat % 2 ? 1 : -1) * (running ? 1 : .65);
    }
    emitGrowl(dt);
    // The walk or the corner lunge may have closed the last metre on this very
    // frame: grab now instead of waiting a tick and stepping over the body.
    if (state.mode !== 'capture') tryCapture(p);
    return state;
  }
  function invalidateNavigation() {
    nav.invalidate();
    plannedGoal = null;
    replanIn = 0;
  }
  return { state, update, reset, stun, navigation: nav, invalidateNavigation };
}
