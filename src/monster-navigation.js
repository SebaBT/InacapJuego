import { annex, hall, plaza, rooms, worldBounds } from './layout.js';
import { castCameraRay, raycastAabb, raycastCapsule2D } from './third-person.js';

// Regular paths give the hood clearance on both sides. Doors are separate
// edges: only the animated, folded suit can use them.
const clearance = .71;
const margin = .003;
const hallArea = { id: 'hall', x0: -hall.halfWidth, x1: hall.halfWidth, z0: hall.far, z1: hall.near };
const plazaStrip107 = { x0: -25.60, x1: -18.40, z0: 11.60, z1: 12.40 };
const plazaRects = [plaza.main, plazaStrip107, plaza.southWalkway, plaza.northPassage, plaza.annexAlley];
const inside = (p, b) => p.x >= b.x0 && p.x <= b.x1 && p.z >= b.z0 && p.z <= b.z1;
const inPlaza = p => plazaRects.some(r => inside(p, r));
const plazaCutouts = [
  { x0: -14.40, x1: -3.60, z0: -27.20, z1: -15.20 },
  { x0: -3.90, x1: -3.60, z0: -33.20, z1: -27.20 },
  { x0: -25.60, x1: -18.40, z0: 12.40, z1: 19.60 },
  { x0: -13.60, x1: -3.60, z0: 11.60, z1: 19.60 }
];
const plazaArea = {
  id: 'plaza',
  x0: plaza.main.x0,
  x1: plaza.main.x1,
  z0: plaza.northPassage.z0,
  z1: plaza.southWalkway.z1,
  contains: inPlaza,
  cutouts: plazaCutouts
};
const areas = [...rooms, hallArea, annex, plazaArea];
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const overlap = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.z0 <= b.z1 && a.z1 >= b.z0;

function areaAt(p) {
  return areas.find(area => (area.contains ? area.contains(p) : inside(p, area)));
}

function pad(b, r) {
  return { x0: b.x0 - r, x1: b.x1 + r, z0: b.z0 - r, z1: b.z1 + r };
}

function closestOnSegment(p, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len = dx * dx + dz * dz;
  if (len < 1e-9) return { x: ax, z: az };
  const t = clamp(((p.x - ax) * dx + (p.z - az) * dz) / len, 0, 1);
  return { x: ax + dx * t, z: az + dz * t };
}

function pointSegmentDistance(p, ax, az, bx, bz) {
  const c = closestOnSegment(p, ax, az, bx, bz);
  return Math.hypot(p.x - c.x, p.z - c.z);
}

// Two 2D segments: when they do not cross, the shortest gap is always reached
// from one endpoint, so four endpoint projections cover the exact distance.
function segmentDistance(a, b, ax, az, bx, bz) {
  return Math.min(
    pointSegmentDistance(a, ax, az, bx, bz),
    pointSegmentDistance(b, ax, az, bx, bz),
    pointSegmentDistance({ x: ax, z: az }, a.x, a.z, b.x, b.z),
    pointSegmentDistance({ x: bx, z: bz }, a.x, a.z, b.x, b.z)
  );
}

// Visibility graph of convex obstacle corners. Edges are swept against the
// expanded footprints, so even a long diagonal cannot cut a desk or a jamb.
function makeFloorGraph(area, solids) {
  const bounds = pad(area, -clearance);
  const rawBoxes = area.cutouts ? [...solids, ...area.cutouts] : solids;
  const boxes = rawBoxes.map(b => pad(b, clearance)).filter(b => overlap(b, bounds));
  const free = p => inside(p, bounds) && !boxes.some(b => inside(p, b));
  function clear(a, b) {
    return !boxes.some(box => raycastAabb(a.x, 0, a.z, b.x - a.x, 0, b.z - a.z,
      box.x0, -1, box.z0, box.x1, 1, box.z1) < 1);
  }
  const vertices = [];
  const addVertex = (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    if (free({ x, z }) && !vertices.some(v => Math.abs(v.x - x) < 1e-4 && Math.abs(v.z - z) < 1e-4)) {
      vertices.push({ x, z });
    }
  };
  for (const b of boxes) {
    for (const x of [b.x0 - margin, b.x1 + margin]) {
      for (const z of [b.z0 - margin, b.z1 + margin]) addVertex(x, z);
    }
  }
  // The room and corridor corners are not obstacle corners: a wall grid ends
  // exactly at the padded bounds. Without these nodes the visibility graph can
  // never route right up to a 90-degree pocket.
  for (const x of [bounds.x0, bounds.x1]) {
    for (const z of [bounds.z0, bounds.z1]) addVertex(x, z);
  }
  for (const b of boxes) {
    for (const x of [b.x0 - margin, b.x1 + margin]) {
      addVertex(x, bounds.z0);
      addVertex(x, bounds.z1);
    }
    for (const z of [b.z0 - margin, b.z1 + margin]) {
      addVertex(bounds.x0, z);
      addVertex(bounds.x1, z);
    }
  }
  let links;
  function buildLinks() {
    links = vertices.map(() => []);
    for (let i = 0; i < vertices.length; i++) {
      for (let j = 0; j < i; j++) {
        if (!clear(vertices[i], vertices[j])) continue;
        const cost = distance(vertices[i], vertices[j]);
        links[i].push([j, cost]);
        links[j].push([i, cost]);
      }
    }
  }
  function nearestFree(target) {
    const p = { x: clamp(target.x, bounds.x0, bounds.x1), z: clamp(target.z, bounds.z0, bounds.z1) };
    if (free(p)) return p;
    // A player can fit closer to a desk or wall than the monster. Approach
    // the nearest reachable face instead of walking into it.
    const choices = [...vertices];
    for (const b of boxes) {
      if (!inside(p, b)) continue;
      for (const x of [b.x0 - margin, b.x1 + margin]) choices.push({ x, z: p.z });
      for (const z of [b.z0 - margin, b.z1 + margin]) choices.push({ x: p.x, z });
    }
    // A body wedged into a 90-degree corner sits inside two padded faces at
    // once, so each single-axis projection still lands inside the
    // perpendicular wall. Pair every nearby face line with every other one,
    // then fan radial samples around the target, and one of them always clears
    // both walls and lets the graph reach the pocket.
    const near = { x0: target.x - 1.2, x1: target.x + 1.2, z0: target.z - 1.2, z1: target.z + 1.2 };
    const xCandidates = [bounds.x0, bounds.x1];
    const zCandidates = [bounds.z0, bounds.z1];
    for (const b of boxes) {
      if (!overlap(b, near)) continue;
      xCandidates.push(b.x0 - margin, b.x1 + margin);
      zCandidates.push(b.z0 - margin, b.z1 + margin);
    }
    for (const x of xCandidates) {
      for (const z of zCandidates) choices.push({ x, z });
    }
    const radii = [.15, .30, .45, .60, .72, .85, .98, 1.12];
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8;
      for (const r of radii) {
        choices.push({
          x: clamp(target.x + Math.cos(angle) * r, bounds.x0, bounds.x1),
          z: clamp(target.z + Math.sin(angle) * r, bounds.z0, bounds.z1)
        });
      }
    }
    return choices.filter(free).sort((a, b) => distance(a, target) - distance(b, target))[0];
  }
  const route = (start, destination) => {
    const end = nearestFree(destination);
    // A body that stepped into a padded wall box still gets a route: recover to
    // the nearest walkable point instead of reporting "no path", which used to
    // make the hunt fall through to a straight lunge into the masonry.
    const origin = free(start) ? start : nearestFree(start);
    if (!end || !origin) return [];
    const path = origin === start ? [] : [origin];
    if (clear(origin, end)) { path.push(end); return path; }
    if (!links) buildLinks();
    const n = vertices.length, goal = n;
    const costs = new Float64Array(n + 1).fill(Infinity);
    const parent = new Int32Array(n + 1).fill(-1);
    const open = new Set();
    for (let i = 0; i < n; i++) {
      if (!clear(origin, vertices[i])) continue;
      costs[i] = distance(origin, vertices[i]);
      open.add(i);
    }
    let closest = -1, leastDistance = distance(origin, end);
    while (open.size) {
      let current = -1, best = Infinity;
      for (const i of open) {
        const f = costs[i] + (i === goal ? 0 : distance(vertices[i], end));
        if (f < best) { best = f; current = i; }
      }
      if (current === goal) { closest = goal; break; }
      open.delete(current);
      const remaining = distance(vertices[current], end);
      if (remaining < leastDistance) { closest = current; leastDistance = remaining; }
      function relax(next, weight) {
        const cost = costs[current] + weight;
        if (cost + 1e-8 >= costs[next]) return;
        costs[next] = cost;
        parent[next] = current;
        open.add(next);
      }
      if (clear(vertices[current], end)) relax(goal, remaining);
      for (const [next, weight] of links[current]) relax(next, weight);
    }
    const nodes = [];
    for (let i = closest; i >= 0; i = parent[i]) nodes.push(i === goal ? end : vertices[i]);
    nodes.reverse();
    return path.concat(nodes);
  };
  route.isFree = free;
  route.nearestFree = nearestFree;
  return route;
}

function pathLength(origin, path) {
  let total = 0, prev = origin;
  for (const step of path) {
    total += distance(prev, step);
    prev = step;
  }
  return total;
}

export function createMonsterNavigation(obstacles, doors) {
  const steps = obstacles.filter(b => b.step);
  const portals = [];
  const areaEdges = new Map();
  const addEdge = (area, edge) => {
    let list = areaEdges.get(area);
    if (!list) { list = []; areaEdges.set(area, list); }
    list.push(edge);
  };
  for (const door of doors || []) {
    if (door.locked || !door.obstacle || !door.threshold) continue;
    const t = door.threshold;
    const pos = door.pos ?? { x: (t.x0 + t.x1) / 2, z: (t.z0 + t.z1) / 2 };
    const acrossX = (t.x1 - t.x0) < (t.z1 - t.z0);
    const nx = acrossX ? 1 : 0;
    const nz = acrossX ? 0 : 1;
    const probe = 1.35;
    const areaNeg = areaAt({ x: pos.x - nx * probe, z: pos.z - nz * probe });
    const areaPos = areaAt({ x: pos.x + nx * probe, z: pos.z + nz * probe });
    if (!areaNeg || !areaPos || areaNeg === areaPos) continue;
    const room = rooms.find(r => r.id === door.id && r.side !== 0);
    // The hinge and handle occupy one edge of a single-leaf corridor opening.
    const center = { x: pos.x, z: pos.z + (room ? .045 * room.side * room.hand : 0) };
    const sideYaw = room ? (room.side * room.hand > 0 ? Math.PI : 0) : (acrossX ? 0 : Math.PI / 2);
    const portal = { door, nx, nz, areaNeg, areaPos, center, sideYaw };
    portals.push(portal);
    addEdge(areaNeg, { portal, fromSide: -1, toSide: 1, toArea: areaPos });
    addEdge(areaPos, { portal, fromSide: 1, toSide: -1, toArea: areaNeg });
  }
  let solids = [];
  let sight = [];
  const graphs = new Map();
  const mouthCache = new Map();
  // Furniture moves. Rebuilding the visibility graph and the sight volumes is
  // cheap next to a chase that keeps running into the same thrown desk.
  function invalidate() {
    solids = obstacles.filter(b => b.active !== false && !b.step && b.bottom === undefined && b.kind !== 'segment');
    // Door leaves and threshold blockers can become active again without a
    // furniture change. Keep their live objects in the raycast list.
    sight = obstacles.filter(b => !b.movable || b.active !== false)
      .map(b => b.sightTop === undefined ? b : { ...b, top: b.sightTop });
    graphs.clear();
    mouthCache.clear();
  }
  invalidate();
  function getGraph(area) {
    let g = graphs.get(area);
    if (!g) {
      g = makeFloorGraph(area, solids);
      graphs.set(area, g);
    }
    return g;
  }
  function getMouth(portal, sideSign) {
    let entry = mouthCache.get(portal);
    if (!entry) {
      entry = {};
      mouthCache.set(portal, entry);
    }
    const key = sideSign < 0 ? 'neg' : 'pos';
    if (entry[key] !== undefined) return entry[key];
    const area = sideSign < 0 ? portal.areaNeg : portal.areaPos;
    const graph = getGraph(area);
    let resolved = null;
    for (const dist of [1.85, 1.55, 1.30, 1.10, 0.92, 0.80]) {
      const p = {
        x: portal.center.x + sideSign * portal.nx * dist,
        z: portal.center.z + sideSign * portal.nz * dist
      };
      if (graph.isFree(p)) { resolved = p; break; }
    }
    if (!resolved) {
      resolved = graph.nearestFree({
        x: portal.center.x + sideSign * portal.nx * 1.85,
        z: portal.center.z + sideSign * portal.nz * 1.85
      }) ?? null;
    }
    entry[key] = resolved;
    return resolved;
  }
  function firstHit(a, b, radius = .02, footY = 0) {
    const dx = b.x - a.x, dz = b.z - a.z;
    let best = 1, obstacle = null, point = null;
    for (const o of obstacles) {
      if (o.active === false || o.step || (o.bottom ?? 0) > footY + 2.05 || (o.top ?? Infinity) <= footY + .04) continue;
      const segment = o.kind === 'segment';
      let t = segment
        ? raycastCapsule2D(a.x, a.z, dx, dz, o.ax, o.az, o.bx, o.bz, radius + (o.halfThick ?? .035))
        : raycastAabb(a.x, 1.1, a.z, dx, 0, dz, o.x0 - radius, -10, o.z0 - radius, o.x1 + radius, 20, o.z1 + radius);
      if (t >= best) continue;
      const center = { x: a.x + dx * t, z: a.z + dz * t };
      const face = segment ? closestOnSegment(center, o.ax, o.az, o.bx, o.bz) :
        { x: clamp(center.x, o.x0, o.x1), z: clamp(center.z, o.z0, o.z1) };
      const nx = center.x - face.x, nz = center.z - face.z;
      const gapSq = nx * nx + nz * nz;
      // At a rectangular corner the expanded AABB is only a broad phase:
      // wait for the round body to actually reach the corner.
      if (!segment && gapSq > radius * radius + 1e-8) {
        t = raycastCapsule2D(a.x, a.z, dx, dz, face.x, face.z, face.x, face.z, radius);
        if (t >= best) continue;
      }
      // Touching a protected gate must still allow a tangential or retreating step.
      if (t <= 1e-8 && gapSq > 1e-10 && nx * dx + nz * dz >= 0) continue;
      best = t; obstacle = o; point = face;
    }
    return { t: best, obstacle, point };
  }
  function route(start, goal) {
    const from = areaAt(start), to = areaAt(goal);
    if (!from || !to) return [];
    const local = getGraph(from);
    if (from === to) {
      const path = local(start, goal);
      const nearEdge = (areaEdges.get(from) || []).find(({ portal }) => {
        if (portal.door.locked || distance(goal, portal.center) > 1.65) return false;
        const lateral = Math.abs((goal.x - portal.center.x) * portal.nz - (goal.z - portal.center.z) * portal.nx);
        const width = Math.max(portal.door.threshold.x1 - portal.door.threshold.x0, portal.door.threshold.z1 - portal.door.threshold.z0);
        return lateral <= width / 2 && distance(path[path.length - 1] ?? start, goal) >= .85;
      });
      if (!nearEdge) return path;
      // The target is in the leaf's swing, beyond the standing suit's
      // clearance. Approach it along the folded passage even from this side.
      const entry = getMouth(nearEdge.portal, nearEdge.fromSide);
      const exit = getMouth(nearEdge.portal, nearEdge.toSide);
      if (!entry || !exit) return path;
      const entryPath = local(start, entry);
      if (entryPath.length && distance(entryPath[entryPath.length - 1], entry) < .01) {
        entryPath.push({ ...exit, portal: nearEdge.portal });
      }
      return entryPath;
    }

    // Multi-area Dijkstra across unlocked doorway portals.
    const bestCost = new Map();
    const queue = [];
    for (const edge of areaEdges.get(from) || []) {
      if (edge.portal.door.locked) continue;
      const entry = getMouth(edge.portal, edge.fromSide);
      const exit = getMouth(edge.portal, edge.toSide);
      if (!entry || !exit) continue;
      const entryPath = local(start, entry);
      if (!entryPath.length || distance(entryPath[entryPath.length - 1], entry) >= .01) continue;
      const maneuver = 1.5 + 1.5 * (1 - (edge.portal.door.open ?? 0));
      const cost = pathLength(start, entryPath) + distance(entry, exit) + maneuver;
      const firstStep = { entryPath, exit, portal: edge.portal };
      bestCost.set(edge, cost);
      queue.push({ area: edge.toArea, pos: exit, edge, cost, firstStep });
    }

    let bestTotal = Infinity;
    let bestFirst = null;
    const toGraph = getGraph(to);

    while (queue.length) {
      let bestIdx = 0;
      for (let i = 1; i < queue.length; i++) {
        if (queue[i].cost < queue[bestIdx].cost) bestIdx = i;
      }
      const cur = queue.splice(bestIdx, 1)[0];
      if (cur.cost >= bestTotal) break;
      if (cur.cost > (bestCost.get(cur.edge) ?? Infinity) + 1e-8) continue;

      if (cur.area === to) {
        const finalPath = toGraph(cur.pos, goal);
        if (finalPath.length) {
          const endPt = finalPath[finalPath.length - 1];
          const total = cur.cost + pathLength(cur.pos, finalPath) + distance(endPt, goal);
          if (total < bestTotal) {
            bestTotal = total;
            bestFirst = cur.firstStep;
          }
          if (distance(endPt, goal) < .01) continue;
        }
      }

      for (const edge of areaEdges.get(cur.area) || []) {
        if (edge.portal === cur.edge.portal || edge.portal.door.locked) continue;
        const entry = getMouth(edge.portal, edge.fromSide);
        const exit = getMouth(edge.portal, edge.toSide);
        if (!entry || !exit) continue;
        const leg = getGraph(cur.area)(cur.pos, entry);
        if (!leg.length || distance(leg[leg.length - 1], entry) >= .01) continue;
        const maneuver = 1.5 + 1.5 * (1 - (edge.portal.door.open ?? 0));
        const nextCost = cur.cost + pathLength(cur.pos, leg) + distance(entry, exit) + maneuver;
        if (nextCost >= bestTotal) continue;
        if (nextCost + 1e-6 < (bestCost.get(edge) ?? Infinity)) {
          bestCost.set(edge, nextCost);
          queue.push({ area: edge.toArea, pos: exit, edge, cost: nextCost, firstStep: cur.firstStep });
        }
      }
    }

    if (!bestFirst) return [];
    const result = bestFirst.entryPath.slice();
    result.push({ ...bestFirst.exit, portal: bestFirst.portal });
    return result;
  }
  // A direct step (a corner lunge, a slam approach) is swept against the live
  // solids before it is taken. The fat body must never cut a wall or a
  // partition, however tempting the straight line to the player looks.
  function clampToSolids(from, to, radius = .42) {
    if (!from || !to) return to;
    const here = areaAt(from);
    const target = { x: to.x, z: to.z };
    const there = areaAt(to);
    let portalStep = false;
    if (here) {
      if (there && there !== here) {
        for (const portal of portals) {
          if (portal.door.locked) continue;
          if ((portal.areaNeg === here && portal.areaPos === there) ||
              (portal.areaPos === here && portal.areaNeg === there)) { portalStep = true; break; }
        }
      }
      // The straight step stays inside the walkable shell unless it is the
      // folded passage through a doorway.
      if (!portalStep) {
        target.x = clamp(target.x, here.x0, here.x1);
        target.z = clamp(target.z, here.z0, here.z1);
      }
    }
    const dx = target.x - from.x, dz = target.z - from.z;
    let t = 1;
    const blockList = here?.cutouts && !portalStep ? [...solids, ...here.cutouts] : solids;
    for (const o of blockList) {
      const hit = raycastAabb(from.x, 0, from.z, dx, 0, dz,
        o.x0 - radius, -1, o.z0 - radius, o.x1 + radius, 1, o.z1 + radius);
      // Already inside this padded face: the only useful move is away from it.
      if (hit > 1e-4 && hit < t) t = Math.max(0, hit - .01);
    }
    return { x: from.x + dx * t, z: from.z + dz * t };
  }
  function acousticDistance(a, b) {
    const from = areaAt(a), to = areaAt(b);
    if (!from || !to) return Infinity;
    if (from === to) return distance(a, b);
    const bestCost = new Map();
    const queue = [];
    for (const edge of areaEdges.get(from) || []) {
      if (edge.portal.door.locked) continue;
      const doorClosedPenalty = 3.5 * (1 - (edge.portal.door.open ?? 0));
      const cost = distance(a, edge.portal.center) + doorClosedPenalty;
      bestCost.set(edge, cost);
      queue.push({ area: edge.toArea, pos: edge.portal.center, edge, cost });
    }
    let best = Infinity;
    while (queue.length) {
      let bestIdx = 0;
      for (let i = 1; i < queue.length; i++) {
        if (queue[i].cost < queue[bestIdx].cost) bestIdx = i;
      }
      const cur = queue.splice(bestIdx, 1)[0];
      if (cur.cost >= best) break;
      if (cur.cost > (bestCost.get(cur.edge) ?? Infinity) + 1e-8) continue;
      if (cur.area === to) {
        best = Math.min(best, cur.cost + distance(cur.pos, b));
        continue;
      }
      for (const edge of areaEdges.get(cur.area) || []) {
        if (edge.portal === cur.edge.portal) continue;
        if (edge.portal.door.locked) continue;
        const doorClosedPenalty = 3.5 * (1 - (edge.portal.door.open ?? 0));
        const nextCost = cur.cost + distance(cur.pos, edge.portal.center) + doorClosedPenalty;
        if (nextCost < best && nextCost + 1e-8 < (bestCost.get(edge) ?? Infinity)) {
          bestCost.set(edge, nextCost);
          queue.push({ area: edge.toArea, pos: edge.portal.center, edge, cost: nextCost });
        }
      }
    }
    return best;
  }
  // A player pressed behind an open leaf is invisible from the doorway and the
  // grave suit cannot walk through the panel. Find the pocket, return a stand
  // spot beside the leaf and let the hunt slam the door shut instead of
  // standing in front of it staring at the paint.
  function blockingOpenDoor(monster, player) {
    if (!monster || !player) return null;
    for (const door of doors || []) {
      if (door.breached || door.locked || (door.open ?? 0) <= .25) continue;
      if (!door.pos) continue;
      for (const pivot of door.pivots || []) {
        if (typeof pivot.hx !== 'number' || typeof pivot.hz !== 'number') continue;
        const leaf = pivot.obstacle;
        let ax = pivot.hx, az = pivot.hz, bx, bz;
        if (leaf && typeof leaf.ax === 'number' && typeof leaf.bx === 'number') {
          ax = leaf.ax; az = leaf.az; bx = leaf.bx; bz = leaf.bz;
        } else {
          const swingSign = (door.swingSign ?? 1) < 0 ? -1 : 1;
          const angle = swingSign * door.open * door.open * (3 - 2 * door.open) * (pivot.maxAngle ?? 1.74);
          const c = Math.cos(angle), s = Math.sin(angle);
          const length = pivot.length ?? .98;
          bx = pivot.hx + length * (pivot.closedDirX * c + pivot.swingDirX * s);
          bz = pivot.hz + length * (pivot.closedDirZ * c + pivot.swingDirZ * s);
        }
        const sx = bx - ax, sz = bz - az;
        const span = Math.hypot(sx, sz);
        if (span < .05) continue;
        if (distance(player, { x: pivot.hx, z: pivot.hz }) >= 1.65) continue;
        const nx = -sz / span, nz = sx / span;
        const closest = closestOnSegment(player, ax, az, bx, bz);
        const playerSide = (player.x - closest.x) * nx + (player.z - closest.z) * nz;
        const doorSide = (door.pos.x - closest.x) * nx + (door.pos.z - closest.z) * nz;
        const monsterSide = (monster.x - closest.x) * nx + (monster.z - closest.z) * nz;
        // The doorway centre is on the open side of the leaf. The wall pocket
        // is the opposite side, where a body can tuck out of the sight line.
        const pocket = Math.abs(doorSide) > .05 ? -Math.sign(doorSide) : 0;
        const separates = Math.abs(monsterSide) > .05 && playerSide * monsterSide < 0;
        const tucked = Math.abs(playerSide) <= .95 &&
          (pocket ? playerSide * pocket > 0 : separates);
        const inThreshold = door.threshold ? inside(monster, door.threshold) : false;
        const shielded = separates && segmentDistance(monster, player, ax, az, bx, bz) < .55;
        if (!tucked && !(shielded && !inThreshold)) continue;
        // Past the leaf tip and just off its line on the suit's side: outside
        // the whole closing sweep, within slamming distance of the doorway.
        const ux = sx / span, uz = sz / span;
        const side = Math.sign(monsterSide) || (pocket ? -pocket : 1);
        const raw = {
          x: ax + ux * 1.15 + nx * side * .35,
          z: az + uz * 1.15 + nz * side * .35
        };
        // Standing in the pocket must never mean standing in the masonry. Snap
        // the spot to the walkable interior of whichever area holds it, so the
        // walk over there cannot grind the suit through a wall.
        const area = areaAt(raw);
        let standSpot = raw;
        if (area) {
          const settled = getGraph(area).nearestFree?.(raw);
          if (settled) standSpot = settled;
        }
        return { door, pivot, standSpot };
      }
    }
    return null;
  }
  return {
    route, acousticDistance, invalidate, firstHit, blockingOpenDoor, clampToSolids,
    areaAt, portals,
    sameArea(a, b) { return Boolean(areaAt(a) && areaAt(a) === areaAt(b)); },
    floorAt(p) { return steps.reduce((y, b) => inside(p, b) ? Math.max(y, b.top) : y, 0); },
    visible(a, b) {
      if (castCameraRay(a, b, sight, worldBounds, .008) >= .9999) return true;
      // Cornered eyes drop a few centimetres and the padded wall corners can
      // graze the centre ray. A tighter ray at head height reads the same line
      // without letting a grazing jamb hide a body pressed into the corner.
      if (castCameraRay(a, { x: b.x, y: b.y + .14, z: b.z }, sight, worldBounds, .004) >= .9999) return true;
      // At arm's length a body crouched under the hem is impossible to miss. The
      // crouched eye ray drops to the desk line, where a table edge or a crate
      // rim can hide it for good; the head and chest of that same body are still
      // above the furniture, so read the raised line as well. Inside the last
      // metre and a half even a tall crate beside the two of them is ignored:
      // the suit can simply look and reach over it.
      if (distance(a, b) >= 2.2) return false;
      if (!(areaAt(a) && areaAt(a) === areaAt(b))) return false;
      const raised = { x: b.x, y: Math.max(b.y + .35, 1.48), z: b.z };
      if (castCameraRay(a, raised, sight, worldBounds, .004) >= .9999) return true;
      if (distance(a, b) >= 1.45) return false;
      return castCameraRay(a, raised, sight.filter(o => (o.top ?? 20) >= 1.65),
        worldBounds, .004) >= .9999;
    },
    canReach(a, b) {
      // Only full-height architecture stops the arms. A low desk, a bench, a
      // crate or any movable prop must never keep the suit from grabbing a
      // player pressed against it: La Veladora's long arms reach over them.
      const tall = obstacles.filter(o => o.active !== false && !o.step && !o.movable &&
        (o.top ?? o.sightTop ?? 20) >= 1.75);
      // Grazing a wall corner beside or behind a crouched body still counts as
      // reachable, while a wall running between the two stays an impassable
      // chord.
      const hit = castCameraRay(a, b, tall, worldBounds, .015);
      return hit >= .92;
    }
  };
}
