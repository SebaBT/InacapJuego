import { gateFixtures, landing, plaza, stairs } from './layout.js';
import { ITEM_CATALOG, WORLD_ITEM_PLACEMENTS } from './items.js';

const order = ['masterKey', 'fuse', 'boltCutters'];
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Door thresholds come from the actual level. Courtyard corners are necessary
// because a straight chord between the guardhouse and annex cuts through 106.
export function createObjectiveGuide(nav) {
  const nodes = [];
  function add(x, z, area, label) {
    const n = { x, z, area, label, edges: [] };
    nodes.push(n);
    return n;
  }
  for (const portal of nav.portals) {
    const { door, center, nx, nz, areaNeg, areaPos } = portal;
    const label = door.label;
    const a = add(center.x - nx * .8, center.z - nz * .8, areaNeg.id, label);
    const b = add(center.x + nx * .8, center.z + nz * .8, areaPos.id, label);
    a.edges.push(b); b.edges.push(a);
  }
  for (const [x, z, label] of [
    [-16, 10.4, 'Pasaje de la caseta'], [-22, 10.7, 'Caseta de guardia'],
    [-16.2, -13.7, 'Pasaje norte'], [-16.2, -30.4, 'Acceso lateral al anexo'],
    [-10.7, -1.8, 'Rodea la fuente'], [-18.9, -1.8, 'Rodea la fuente'],
    [-14.6, 2.2, 'Rodea la fuente'], [-14.6, -5.8, 'Rodea la fuente']
  ]) add(x, z, 'plaza', label);

  function connected(a, b) {
    if (a.area !== b.area) return false;
    if (a.area !== 'plaza') return true;
    const steps = Math.ceil(distance(a, b) / .6);
    for (let i = 1; i < steps; i++) {
      const p = { x: a.x + (b.x - a.x) * i / steps, z: a.z + (b.z - a.z) * i / steps };
      if (nav.areaAt(p)?.id !== 'plaza' || distance(p, plaza.fountain) < plaza.fountain.radius + .45) return false;
    }
    return true;
  }
  for (const [i, a] of nodes.entries()) {
    for (const b of nodes.slice(i + 1)) {
      if (connected(a, b)) { a.edges.push(b); b.edges.push(a); }
    }
  }
  function plan(start, goal) {
    const queue = [start], cost = new Map([[start, 0]]), prev = new Map();
    while (queue.length) {
      queue.sort((a,b) => cost.get(b) - cost.get(a));
      const a = queue.pop();
      if (a === goal) break;
      const next = a === start ? nodes.filter(b => connected(a, b)) : a.edges;
      for (const b of connected(a, goal) ? [...next, goal] : next) {
        const total = cost.get(a) + distance(a, b);
        if (total >= (cost.get(b) ?? Infinity)) continue;
        cost.set(b, total); prev.set(b, a); queue.push(b);
      }
    }
    const path = [];
    for (let p = goal; p && p !== start; p = prev.get(p)) path.unshift(p);
    return path;
  }

  let lastPlan = null, route = [];
  function update(pose, inventory, locks) {
    const kind = order.find(k => !locks[k] && !inventory.has(k));
    const def = ITEM_CATALOG[kind];
    const nextLock = order.find(k => !locks[k]);
    const fixture = gateFixtures[nextLock];
    const site = kind ? WORLD_ITEM_PLACEMENTS.find(p => p.kind === kind) : fixture ?? plaza.exteriorGate;
    const area = nav.areaAt(pose)?.id;
    const title = kind ? 'Busca ' + ({ masterKey: 'la llave maestra', fuse: 'el fusible', boltCutters: 'el cortapernos' })[kind]
      : 'Abre el portón exterior';
    const destination = kind ? def.location : 'Plaza · portón exterior';
    let goal = { x: site.x, z: kind ? site.z : site.z - 1, area: nav.areaAt(site)?.id ?? 'plaza',
      label: kind ? 'Recoge ' + def.short.toLowerCase() : fixture?.label ?? 'Portón exterior' };
    if (kind === 'boltCutters' && area === 'anexo' && !(pose.z < landing.z1 && pose.x < landing.x1 + .1)) {
      const stairX = (stairs.x0 + stairs.x1) / 2;
      const onStairs = pose.x >= stairs.x0 && pose.x <= stairs.x1 && pose.z < stairs.startZ + 1.1;
      goal = { area, x: stairX, z: onStairs ? landing.z1 - .65 : stairs.startZ + .65,
        label: onStairs ? 'Sube hasta el descanso' : 'Ve al pie de la escalera' };
    }
    if (!lastPlan || area !== lastPlan.area || goal.x !== lastPlan.gx || goal.z !== lastPlan.gz ||
        distance(lastPlan, pose) > 2) {
      const start = { x: pose.x, z: pose.z, area };
      route = plan(start, goal);
      lastPlan = { ...start, gx: goal.x, gz: goal.z };
    }
    while (route.length > 1 && distance(pose, route[0]) < 1.15) route.shift();
    const next = route[0] ?? goal;
    const dx = next.x - pose.x, dz = next.z - pose.z;
    const angle = Math.atan2(dx * Math.cos(pose.yaw) - dz * Math.sin(pose.yaw),
      -dx * Math.sin(pose.yaw) - dz * Math.cos(pose.yaw));
    const atItem = kind && next.x === site.x && next.z === site.z;
    const areaLabel = kind ? destination.split(' · ')[0] : 'Plaza';
    const item = (def?.short ?? 'Portón') + ' · ' + areaLabel;
    return { title, destination, item, next: next.label,
      landmark: atItem ? 'Recoger' : next.label, meters: Math.round(distance(pose, next)), angle };
  }
  return { update, reset() { lastPlan = null; route = []; } };
}
