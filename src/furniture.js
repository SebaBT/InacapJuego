import { Euler, Quaternion, Vector3 } from 'three';
import { raycastAabb } from './third-person.js';

// Only free-standing school furniture is throwable. Desks, benches and tables
// (pupitre/mesa) plus the free-standing crates and cable reels (caja) can be
// handed to the monster. Everything that is part of the building (chalkboards,
// wall-bolted shelves, lockers and server racks) stays in the baked
// architecture and is never thrown.
export const throwableKinds = Object.freeze(['pupitre', 'mesa', 'caja']);

export const furnitureState = Object.freeze({
  rest: 'rest',
  held: 'held',
  flying: 'flying',
  settling: 'settling'
});

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const scratch = new Vector3();

function eulerOf(rotation) {
  return new Euler(rotation.x || 0, rotation.y || 0, rotation.z || 0, rotation.order || 'YXZ');
}

// Axis-aligned bounds of the prop's local box under `rotation` and `position`.
export function furnitureBounds(localBox, rotation, position) {
  const e = eulerOf(rotation);
  const xs = [localBox.x0, localBox.x1];
  const ys = [localBox.y0, localBox.y1];
  const zs = [localBox.z0, localBox.z1];
  let x0 = Infinity, x1 = -Infinity;
  let y0 = Infinity, y1 = -Infinity;
  let z0 = Infinity, z1 = -Infinity;
  for (const x of xs) for (const y of ys) for (const z of zs) {
    scratch.set(x, y, z).applyEuler(e);
    const wx = scratch.x + (position?.x || 0);
    const wy = scratch.y + (position?.y || 0);
    const wz = scratch.z + (position?.z || 0);
    if (wx < x0) x0 = wx;
    if (wx > x1) x1 = wx;
    if (wy < y0) y0 = wy;
    if (wy > y1) y1 = wy;
    if (wz < z0) z0 = wz;
    if (wz > z1) z1 = wz;
  }
  return { x0, x1, y0, y1, z0, z1 };
}

// World-space height the group origin needs so the rotated prop touches ground.
export function restingLift(localBox, rotation) {
  return -furnitureBounds(localBox, rotation, { x: 0, y: 0, z: 0 }).y0;
}

export function furnitureSize(localBox) {
  return {
    x: localBox.x1 - localBox.x0,
    y: localBox.y1 - localBox.y0,
    z: localBox.z1 - localBox.z0
  };
}

// The landing floor for thrown props. Mirrors the floor lookup used by the
// monster navigation so a desk can land on the mezzanine landing.
export function floorHeightAt(x, z, obstacles = []) {
  let y = 0;
  for (const b of obstacles) {
    if (!b.step || b.active === false) continue;
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
    if (b.top !== undefined) y = Math.max(y, b.top);
  }
  return y;
}

function segmentHit(ax, az, bx, bz, y, radius, obstacles, ignore) {
  const dx = bx - ax, dz = bz - az;
  if (Math.abs(dx) + Math.abs(dz) < 1e-9) return 1;
  let best = 1;
  for (const o of obstacles) {
    if (!o || o === ignore || o.active === false || o.kind === 'segment') continue;
    const yMin = o.bottom !== undefined ? o.bottom : -10;
    // Architectural blocks have no top; furniture and low walls report the
    // height a thrown desk can clear.
    const yMax = o.top !== undefined ? o.top : (o.sightTop !== undefined ? o.sightTop : 20);
    if (y > yMax + radius || y < yMin - radius) continue;
    const hit = raycastAabb(ax, y, az, dx, 0, dz,
      o.x0 - radius, yMin, o.z0 - radius, o.x1 + radius, yMax, o.z1 + radius);
    if (hit < best) best = hit;
  }
  return best;
}

function setCollider(item, box, active) {
  const c = item.collider;
  c.x0 = box.x0;
  c.x1 = box.x1;
  c.z0 = box.z0;
  c.z1 = box.z1;
  c.sightTop = box.y1;
  if (active) delete c.active;
  else c.active = false;
}

function place(item, rotation, position) {
  item.group.position.set(position.x, position.y, position.z);
  item.group.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0, rotation.order || 'YXZ');
  item.x = position.x;
  item.y = position.y;
  item.z = position.z;
}

/**
 * Physics and lifecycle for the movable furniture. Props arrive already built
 * (rooms.js owns the geometry); this module owns their resting footprint, the
 * carry pose, the ballistic throw, the settle and the reset back to home.
 */
export function createFurniture({ props = [], obstacles = [], onChange = () => {} }) {
  const items = props.map((raw, index) => {
    const localBox = raw.localBox;
    const item = {
      id: raw.id ?? `mueble-${index + 1}`,
      kind: raw.kind ?? 'mesa',
      group: raw.group,
      collider: raw.collider,
      localBox,
      size: raw.size ?? furnitureSize(localBox),
      radius: raw.radius ?? Math.hypot(localBox.x1 - localBox.x0, localBox.z1 - localBox.z0) * .5,
      home: {
        position: { ...raw.home.position },
        rotation: { ...raw.home.rotation }
      },
      state: furnitureState.rest,
      x: raw.home.position.x,
      y: raw.home.position.y,
      z: raw.home.position.z,
      flight: null,
      settle: null,
      restTime: 0
    };
    item.homeBox = furnitureBounds(localBox, item.home.rotation, item.home.position);
    setCollider(item, item.homeBox, true);
    return item;
  });
  const byId = new Map(items.map(item => [item.id, item]));
  let held = null;

  function notify() { onChange(); }

  function grab(prop) {
    const item = typeof prop === 'string' ? byId.get(prop) : prop;
    if (!item || item.state !== furnitureState.rest) return null;
    item.state = furnitureState.held;
    item.flight = item.settle = null;
    setCollider(item, item.homeBox, false);
    held = item;
    notify();
    return item;
  }

  function carry(next) {
    if (!held || !next) return;
    place(held, { x: 0, y: next.yaw || 0, z: next.roll || 0, order: 'YXZ' },
      { x: next.x, y: next.y, z: next.z });
  }

  function land(item, position) {
    const rest = item.flight?.rest ?? { x: 0, y: item.group.rotation.y, z: Math.PI / 2, order: 'YXZ' };
    const ground = floorHeightAt(position.x, position.z, obstacles);
    item.state = furnitureState.settling;
    item.settle = {
      elapsed: 0,
      duration: .28,
      from: { ...position },
      to: { x: position.x, y: ground + restingLift(item.localBox, rest), z: position.z },
      fromQuat: item.group.quaternion.clone(),
      toQuat: new Quaternion().setFromEuler(eulerOf(rest)),
      rest
    };
    item.flight = null;
  }

  function launch(prop, plan) {
    const item = typeof prop === 'string' ? byId.get(prop) : prop;
    if (!item || !plan?.to) return null;
    const from = plan.from ?? { x: item.x, y: item.y, z: item.z };
    const rest = plan.rest ?? { x: 0, y: plan.yaw || 0, z: Math.PI / 2, order: 'YXZ' };
    const ground = plan.ground ?? floorHeightAt(plan.to.x, plan.to.z, obstacles);
    const to = { x: plan.to.x, y: ground + restingLift(item.localBox, rest), z: plan.to.z };
    const duration = Math.max(.2, plan.duration ?? .8);
    item.state = furnitureState.flying;
    item.flight = {
      from: { ...from },
      to,
      arc: plan.arc ?? 1.2,
      duration,
      elapsed: 0,
      rest,
      qFrom: item.group.quaternion.clone(),
      previous: { x: item.x, y: item.y, z: item.z }
    };
    item.settle = null;
    setCollider(item, item.homeBox, false);
    if (held === item) held = null;
    notify();
    return { from: { ...from }, to: { ...to }, arc: item.flight.arc, duration, yaw: rest.y };
  }

  function finishSettle(item) {
    const { to, rest } = item.settle;
    place(item, rest, to);
    item.state = furnitureState.rest;
    item.restTime = 0;
    item.settle = null;
    setCollider(item, furnitureBounds(item.localBox, rest, to), true);
    notify();
  }

  function update(dt, nextCarry = null) {
    const step = Math.max(0, dt);
    if (held && nextCarry) carry(nextCarry);
    for (const item of items) {
      if (item.state === furnitureState.rest) item.restTime += step;
      if (item.state === furnitureState.flying) {
        const f = item.flight;
        f.elapsed += step;
        const t = clamp(f.elapsed / f.duration, 0, 1);
        const x = lerp(f.from.x, f.to.x, t);
        const y = lerp(f.from.y, f.to.y, t) + f.arc * 4 * t * (1 - t);
        const z = lerp(f.from.z, f.to.z, t);
        const hit = segmentHit(f.previous.x, f.previous.z, x, z, y, item.radius * .72, obstacles, item.collider);
        if (hit < 1) {
          // Stop at the wall face and drop from there instead of clipping.
          land(item, {
            x: lerp(f.previous.x, x, hit),
            y,
            z: lerp(f.previous.z, z, hit)
          });
          continue;
        }
        const turns = t * (Math.PI * 2.15);
        const axis = new Vector3(-(f.to.z - f.from.z), 0, f.to.x - f.from.x);
        if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0); else axis.normalize();
        item.group.quaternion.setFromAxisAngle(axis, turns).multiply(f.qFrom);
        item.group.position.set(x, y, z);
        item.x = x;
        item.y = y;
        item.z = z;
        f.previous = { x, y, z };
        if (t >= 1) land(item, f.to);
      } else if (item.state === furnitureState.settling) {
        const s = item.settle;
        s.elapsed += step;
        const t = clamp(s.elapsed / s.duration, 0, 1);
        const e = smooth(t);
        const x = lerp(s.from.x, s.to.x, e);
        const z = lerp(s.from.z, s.to.z, e);
        const y = lerp(s.from.y, s.to.y, e) - .035 * Math.sin(Math.PI * t) * (1 - t);
        item.group.position.set(x, y, z);
        item.group.quaternion.slerpQuaternions(s.fromQuat, s.toQuat, e);
        item.x = x;
        item.y = y;
        item.z = z;
        if (t >= 1) finishSettle(item);
      }
    }
  }

  function restAll() {
    held = null;
    let changed = false;
    for (const item of items) {
      item.state = furnitureState.rest;
      item.flight = item.settle = null;
      item.restTime = 0;
      place(item, item.home.rotation, item.home.position);
      setCollider(item, item.homeBox, true);
      changed = true;
    }
    if (changed) notify();
    return changed;
  }

  return {
    props: items,
    get held() { return held; },
    candidates() { return items.filter(item => item.state === furnitureState.rest); },
    byId: id => byId.get(id) ?? null,
    grab,
    launch,
    update,
    reset: restAll,
    get flying() { return items.find(item => item.state === furnitureState.flying) ?? null; }
  };
}
