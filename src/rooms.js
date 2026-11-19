import { Box3, BoxGeometry, CylinderGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, PlaneGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { annex, furnishingBays, hall, landing, plaza, plazaLights, rooms, stairs, switchOffset, wallThickness } from './layout.js';
import { roomPlate } from './textures.js';

const { halfWidth: W, height: H } = hall;
const WHITE = 0xffffff;
const WALL_THICK = 0.18;
const UP = new Vector3(0, 1, 0);
const _linkDir = new Vector3();

function positionLink(mesh, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  mesh.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  mesh.scale.set(1, Math.max(1e-4, len), 1);
  if (len > 1e-6) {
    _linkDir.set(dx / len, dy / len, dz / len);
    mesh.quaternion.setFromUnitVectors(UP, _linkDir);
  }
}

function group(parent, x, z, angle = 0) {
  const g = new Group();
  g.position.set(x, 0, z);
  g.rotation.y = angle;
  parent.add(g);
  return g;
}

function group3(parent, x, y, z) {
  const g = new Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

function piece(parent, material, geometry, x, y, z, tint = WHITE) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.attributes.position, normal = g.attributes.normal;
  const meters = material.userData.repeatMeters;
  const color = new Float32Array(pos.count * 3);
  const rgb = [((tint >> 16) & 255) / 255, ((tint >> 8) & 255) / 255, (tint & 255) / 255];
  for (let i = 0; i < pos.count; i++) {
    color.set(rgb, i * 3);
    if (!meters) continue;
    const px = pos.getX(i) + x, py = pos.getY(i) + y, pz = pos.getZ(i) + z;
    const nx = normal.getX(i), ny = normal.getY(i), nz = normal.getZ(i);
    let u = px * Math.sign(nz), v = py;
    if (Math.abs(nx) > .7) u = -pz * Math.sign(nx);
    if (Math.abs(ny) > .7) { u = px; v = -pz * Math.sign(ny); }
    g.attributes.uv.setXY(i, u / meters[0], v / meters[1]);
  }
  g.setAttribute('color', new Float32BufferAttribute(color, 3));
  const mesh = new Mesh(g, material);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function box(p, m, x, y, z, width, height, depth, tint = WHITE) {
  return piece(p, m, new BoxGeometry(width, height, depth), x, y, z, tint);
}

function face(p, m, x, y, z, w, h, tint = WHITE) {
  return piece(p, m, new PlaneGeometry(w, h), x, y, z, tint);
}

function cylinder(p, m, x, y, z, top, bottom, height, tint = WHITE, sides = 8) {
  const g = new CylinderGeometry(top, bottom, height, sides).toNonIndexed();
  g.computeVertexNormals();
  return piece(p, m, g, x, y, z, tint);
}

function rod(p, m, start, end, radius, tint = WHITE) {
  const a = new Vector3(...start), b = new Vector3(...end);
  const dir = b.clone().sub(a), mid = a.addScaledVector(dir, .5);
  const mesh = cylinder(p, m, mid.x, mid.y, mid.z, radius, radius, dir.length(), tint, 6);
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
}

export function buildRooms({
  root,
  dynamicRoot,
  obstacles,
  switches,
  doors,
  materials,
  makeMaterial,
  art,
  movableFurniture = []
}) {
  const { solid, wood, paint, plaster, floorMat, ceilingMat, luminous } = materials;
  const doorWood = materials.doorWood || makeMaterial(art.wood, { repeat: [1.09, 2.17], shininess: .46 });
  const doorPaint = materials.doorPaint || makeMaterial(art.paint, { repeat: [2.24, 1.12], shininess: .40 });
  const doorTrim = materials.doorTrim || makeMaterial(art.white, { shininess: .68 });
  const doorGlass = materials.doorGlass || makeMaterial(art.glass, { emission: .08, shininess: .94, opacity: .40 });
  const plazaFloorMat = makeMaterial(art.plazaPavement, { floor: true, repeat: [3.2, 3.2] });
  const barkMat = makeMaterial(art.bark, { repeat: [1.1, 1.8] });
  const foliageMat = makeMaterial(art.foliage, { repeat: [1.2, 1.2] });
  const securityMat = makeMaterial(art.securityMonitor, { emission: 0.78 });
  const chalkMat = makeMaterial(art.chalkboard);
  const crtMat = makeMaterial(art.crtScreen, { emission: 0.72 });
  const breakerMat = makeMaterial(art.breakerPanel, { emission: 0.14 });
  const drawingMat = makeMaterial(art.drawingSheet);
  const scopeMat = makeMaterial(art.scopeScreen, { emission: .38 });
  const boardMat = makeMaterial(art.bulletin);
  const exitMat = makeMaterial(art.exit, { emission: 0.85 });
  const skyboxMat = makeMaterial(art.nightSky, { skybox: true });
  const sconceGlassMat = makeMaterial(art.amberGlass, { emission: 0.92, shininess: 0.78 });

  function wallStrip(x, z, length, angle, wallHeight = H) {
    if (length < .005) return null;
    const p = group(root, x, z, angle);
    box(p, paint, 0, 1.075 / 2, -WALL_THICK / 2, length, 1.075, WALL_THICK, WHITE);
    box(p, plaster, 0, (1.075 + wallHeight) / 2, -WALL_THICK / 2, length, wallHeight - 1.075, WALL_THICK, WHITE);
    for (const tz of [1, -1]) {
      const zOff = o => (tz > 0 ? o : -WALL_THICK - o);
      box(p, solid, 0, .046, zOff(.012), length, .092, .024, 0x45514b);
      box(p, solid, 0, .102, zOff(.010), length, .020, .020, 0x79867b);
      box(p, solid, 0, 1.068, zOff(.007), length, .018, .014, 0x526b61);
      box(p, solid, 0, 1.087, zOff(.007), length, .021, .014, 0xaab5a2);
      box(p, solid, 0, wallHeight - .024, zOff(.011), length, .047, .022, 0x939c8d);
    }
    return p;
  }

  function wallSegmentWithWindow(x, z, length, angle, winLocalX, winW, winBottom = 1.12, winTop = 2.48, wallHeight = H) {
    const p = group(root, x, z, angle);
    const leftEdge = -length / 2, rightEdge = length / 2;
    const wl = winLocalX - winW / 2, wr = winLocalX + winW / 2;
    function solidSeg(x0, x1, y0, y1) {
      if (x1 - x0 < .005 || y1 - y0 < .005) return;
      const w = x1 - x0, cx = (x0 + x1) / 2;
      const pTop = Math.min(y1, 1.075);
      if (pTop > y0) box(p, paint, cx, (y0 + pTop) / 2, -WALL_THICK / 2, w, pTop - y0, WALL_THICK, WHITE);
      const uBot = Math.max(y0, 1.075);
      if (y1 > uBot) box(p, plaster, cx, (uBot + y1) / 2, -WALL_THICK / 2, w, y1 - uBot, WALL_THICK, WHITE);
    }
    solidSeg(leftEdge, wl, 0, wallHeight);
    solidSeg(wr, rightEdge, 0, wallHeight);
    solidSeg(wl, wr, 0, winBottom);
    solidSeg(wl, wr, winTop, wallHeight);

    for (const tz of [1, -1]) {
      const zOff = o => (tz > 0 ? o : -WALL_THICK - o);
      box(p, solid, 0, .046, zOff(.012), length, .092, .024, 0x45514b);
      box(p, solid, 0, .102, zOff(.010), length, .020, .020, 0x79867b);
      box(p, solid, 0, wallHeight - .024, zOff(.011), length, .047, .022, 0x939c8d);
      for (const [sx0, sx1] of [[leftEdge, wl], [wr, rightEdge]]) {
        const sw = sx1 - sx0, scx = (sx0 + sx1) / 2;
        if (sw < .01) continue;
        box(p, solid, scx, 1.068, zOff(.007), sw, .018, .014, 0x526b61);
        box(p, solid, scx, 1.087, zOff(.007), sw, .021, .014, 0xaab5a2);
      }
    }

    const wh = winTop - winBottom, wy = (winBottom + winTop) / 2, trim = 0x777f76;
    box(p, doorGlass, winLocalX, wy, -WALL_THICK / 2, winW - .05, wh - .05, .016, WHITE);
    for (const s of [-1, 1]) {
      box(p, solid, winLocalX + s * (winW / 2 - .024), wy, -WALL_THICK / 2, .052, wh, WALL_THICK + .04, trim);
      box(p, solid, winLocalX, wy + s * (wh / 2 - .024), -WALL_THICK / 2, winW, .050, WALL_THICK + .04, trim);
    }
    box(p, solid, winLocalX, wy, -WALL_THICK / 2, .036, wh - .07, WALL_THICK + .01, 0x525f5b);
    box(p, solid, winLocalX, winBottom - .014, -WALL_THICK / 2, winW + .10, .046, WALL_THICK + .10, 0xacb1a2);
    return p;
  }

  function plaque(p, material, x, y, z, width, height, angle = 0) {
    const g = group(p, x, z, angle);
    box(g, solid, 0, y, .012, width + .025, height + .025, .025, 0x38443e);
    box(g, solid, 0, y, .037, width, height, .032, 0x879087);
    face(g, material, 0, y, .054, width - .009, height - .009);
  }

  function cutoutFrame(parent, mat, cx, yB, yT, width, depth, tint, gx, gy, holeW, holeH) {
    const left = cx - width / 2, right = cx + width / 2;
    const hx0 = gx - holeW / 2, hx1 = gx + holeW / 2;
    const hy0 = gy - holeH / 2, hy1 = gy + holeH / 2;
    box(parent, mat, cx, (yB + hy0) / 2, 0, width, hy0 - yB, depth, tint);
    box(parent, mat, cx, (hy1 + yT) / 2, 0, width, yT - hy1, depth, tint);
    box(parent, mat, (left + hx0) / 2, gy, 0, hx0 - left, holeH, depth, tint);
    box(parent, mat, (hx1 + right) / 2, gy, 0, right - hx1, holeH, depth, tint);
  }

  function visionWindow(parent, gx, gy, holeW, holeH, frameDepth, glassMat, glassTint) {
    const bar = .022, bBar = .012;
    const hx0 = gx - holeW / 2, hx1 = gx + holeW / 2;
    const hy0 = gy - holeH / 2, hy1 = gy + holeH / 2;
    box(parent, doorTrim, hx0 - bar / 2 + .004, gy, 0, bar, holeH + bar * 2 - .008, frameDepth, 0x3b433c);
    box(parent, doorTrim, hx1 + bar / 2 - .004, gy, 0, bar, holeH + bar * 2 - .008, frameDepth, 0x3b433c);
    box(parent, doorTrim, gx, hy0 - bar / 2 + .004, 0, holeW - .008, bar, frameDepth, 0x3b433c);
    box(parent, doorTrim, gx, hy1 + bar / 2 - .004, 0, holeW - .008, bar, frameDepth, 0x3b433c);
    const bz = frameDepth / 2 + .003;
    for (const s of [1, -1]) {
      box(parent, doorTrim, hx0 - bBar / 2 + .003, gy, s * bz, bBar, holeH + bBar * 2 - .006, .009, 0xa5a599);
      box(parent, doorTrim, hx1 + bBar / 2 - .003, gy, s * bz, bBar, holeH + bBar * 2 - .006, .009, 0xa5a599);
      box(parent, doorTrim, gx, hy0 - bBar / 2 + .003, s * bz, holeW - .006, bBar, .009, 0xa5a599);
      box(parent, doorTrim, gx, hy1 + bBar / 2 - .003, s * bz, holeW - .006, bBar, .009, 0xa5a599);
    }
    box(parent, glassMat, gx, gy, 0, holeW - .002, holeH - .002, .014, glassTint);
  }

  function addSingleDoor({
    id, label, wx, wz, width, swingX, swingZ, hand = 1,
    wallThick = WALL_THICK, wallHeight = H, woodTint = 0xf2ebd9, maxAngle = 1.72
  }) {
    const frameAngle = swingZ < -.5 ? 0 : swingZ > .5 ? Math.PI : swingX < -.5 ? Math.PI / 2 : -Math.PI / 2;
    const cosA = Math.round(Math.cos(frameAngle));
    const sinA = Math.round(Math.sin(frameAngle));
    const frameCenterX = wx - (wallThick / 2) * swingX;
    const frameCenterZ = wz - (wallThick / 2) * swingZ;

    const p = group(root, frameCenterX, frameCenterZ, frameAngle);
    const top = 2.28, dark = 0x38423b, steel = 0x78857b, handle = 0xc0c4b3;
    const leaf = width - .14, h = top - .076;
    const leafZ = -(wallThick - .077);

    // Wall header above doorway
    if (wallHeight > top) {
      box(p, plaster, 0, (top + wallHeight) / 2, -wallThick / 2, width, wallHeight - top, wallThick, WHITE);
      box(p, solid, 0, wallHeight - .024, .011, width, .047, .022, 0x939c8d);
      box(p, solid, 0, wallHeight - .024, -wallThick - .011, width, .047, .022, 0x939c8d);
    }
    for (const s of [-1, 1]) {
      box(p, doorTrim, s * (width / 2 - .027), top / 2, -wallThick / 2, .065, top, wallThick + .01, steel);
      box(p, doorTrim, s * (width / 2 + .003), top / 2, .016, .062, top + .025, .026, 0x8b968a);
      box(p, doorTrim, s * (width / 2 + .003), top / 2, -wallThick - .016, .062, top + .025, .026, 0x8b968a);
      box(p, doorTrim, s * (leaf / 2 + .009), h / 2, leafZ + .054, .018, h, .045, dark);
    }
    box(p, doorTrim, 0, top - .023, -wallThick / 2, width + .07, .07, wallThick + .02, steel);

    const doorFrame = group(dynamicRoot, frameCenterX, frameCenterZ, frameAngle);
    const hingeLocalX = -hand * (leaf / 2);
    const pivot = group(doorFrame, hingeLocalX, leafZ, 0);
    const cx = hand * (leaf / 2);
    const front = .031;

    const gx = cx - hand * leaf * .185, gy = 1.675;
    cutoutFrame(pivot, doorWood, cx, .025, h - .001, leaf, .058, woodTint, gx, gy, .224, .676);
    visionWindow(pivot, gx, gy, .224, .676, .076, doorGlass, WHITE);
    for (const s of [1, -1]) {
      box(pivot, doorTrim, cx, .20, s * (front + .005), leaf - .043, .265, .014, 0x869187);
      box(pivot, doorTrim, cx, .338, s * (front + .004), leaf - .043, .009, .012, 0xb2b5a4);
    }
    const hxLocal = cx + hand * (leaf / 2 - .107);
    const leverPivots = [];
    const handles = [];
    for (const s of [1, -1]) {
      const fz = s > 0 ? front : -front;
      box(pivot, doorTrim, hxLocal, 1.016, fz + s * .017, .068, .183, .032, steel);
      box(pivot, doorTrim, hxLocal, 1.049, fz + s * .052, .032, .035, .07, handle);
      const leverPivot = group3(pivot, hxLocal, 1.049, fz + s * .083);
      box(leverPivot, doorTrim, -hand * .055, 0, 0, .143, .027, .033, handle);
      const grip = group3(leverPivot, -hand * .078, 0, s * .004);
      leverPivots.push({ group: leverPivot, hand });
      handles.push(grip);
    }
    box(pivot, doorTrim, hxLocal, .985, front + .035, .01, .024, .006, dark);
    for (const y of [.24, 1.92]) box(pivot, doorTrim, hand * .011, y, front + .012, .022, .094, .025, steel);
    box(pivot, doorTrim, cx - hand * .23, h - .095, front + .029, .228, .061, .056, 0x59645d);

    const spindleLocalX = hand * .175;
    const spindleLocalZ = front + .029;
    const spindleY = h - .056;
    cylinder(pivot, doorTrim, spindleLocalX, h - .059, spindleLocalZ, .013, .015, .018, steel, 8);
    const shoeX = -hand * .24;
    const shoeZ = leafZ + .063;
    const shoeJointY = top - .073;
    box(p, doorTrim, shoeX, top - .064, shoeZ, .056, .014, .038, 0x59645d);
    const arm1 = cylinder(doorFrame, doorTrim, 0, 0, 0, .009, .009, 1, steel, 6);
    const arm2 = cylinder(doorFrame, doorTrim, 0, 0, 0, .008, .008, 1, 0x627068, 6);
    const elbowPin = cylinder(doorFrame, doorTrim, 0, 0, 0, .012, .012, .024, dark, 8);
    const closerLinkLen = .18;
    const closer = { spindleLocalX, spindleLocalZ, spindleY, shoeX, shoeJointY, shoeZ, arm1, arm2, elbowPin };
    function updateCloser(angle) {
      const theta = hand * angle;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const ax = hingeLocalX + spindleLocalX * c + spindleLocalZ * s;
      const az = leafZ - spindleLocalX * s + spindleLocalZ * c;
      const dx = shoeX - ax;
      const dz = shoeZ - az;
      const dist = Math.hypot(dx, dz);
      const halfD = Math.min(dist * 0.5, closerLinkLen - 1e-4);
      const bend = Math.sqrt(Math.max(0, closerLinkLen * closerLinkLen - halfD * halfD));
      const invD = dist > 1e-6 ? 1 / dist : 0;
      const nx = dist > 1e-6 ? -hand * dz * invD : 0;
      const nz = dist > 1e-6 ? hand * dx * invD : 1;
      const ex = (ax + shoeX) * 0.5 + nx * bend;
      const ey = (spindleY + shoeJointY) * 0.5;
      const ez = (az + shoeZ) * 0.5 + nz * bend;
      positionLink(arm1, ax, spindleY, az, ex, ey, ez);
      positionLink(arm2, ex, ey, ez, shoeX, shoeJointY, shoeZ);
      elbowPin.position.set(ex, ey, ez);
    }
    updateCloser(0);

    const hx = frameCenterX + hingeLocalX * cosA + leafZ * sinA;
    const hz = frameCenterZ - hingeLocalX * sinA + leafZ * cosA;
    const closedDirX = hand * cosA;
    const closedDirZ = -hand * sinA;
    const leafEndX = hx + closedDirX * leaf;
    const leafEndZ = hz + closedDirZ * leaf;
    const leafObstacle = {
      kind: 'segment',
      ax: hx,
      az: hz,
      bx: leafEndX,
      bz: leafEndZ,
      halfThick: .034,
      x0: Math.min(hx, leafEndX) - .034,
      x1: Math.max(hx, leafEndX) + .034,
      z0: Math.min(hz, leafEndZ) - .034,
      z1: Math.max(hz, leafEndZ) + .034,
      active: true
    };
    obstacles.push(leafObstacle);

    let doorObstacle, threshold;
    if (Math.abs(swingZ) > .5) {
      const zMin = Math.min(frameCenterZ, frameCenterZ + swingZ * wallThick);
      const zMax = Math.max(frameCenterZ, frameCenterZ + swingZ * wallThick);
      doorObstacle = { x0: wx - width / 2, x1: wx + width / 2, z0: zMin, z1: zMax, active: true, rounded: true };
      obstacles.push(doorObstacle);
      obstacles.push({
        x0: wx - width / 2,
        x1: wx + width / 2,
        z0: zMin - (swingZ < 0 ? 0 : .063),
        z1: zMax + (swingZ > 0 ? 0 : .063),
        bottom: 2.222,
        top: wallHeight,
        rounded: true
      });
      threshold = { x0: wx - width / 2, x1: wx + width / 2, z0: zMin - .14, z1: zMax + .14 };
    } else {
      const xMin = Math.min(frameCenterX, frameCenterX + swingX * wallThick);
      const xMax = Math.max(frameCenterX, frameCenterX + swingX * wallThick);
      doorObstacle = { x0: xMin, x1: xMax, z0: wz - width / 2, z1: wz + width / 2, active: true, rounded: true };
      obstacles.push(doorObstacle);
      obstacles.push({
        x0: xMin - (swingX < 0 ? 0 : .063),
        x1: xMax + (swingX > 0 ? 0 : .063),
        z0: wz - width / 2,
        z1: wz + width / 2,
        bottom: 2.222,
        top: wallHeight,
        rounded: true
      });
      threshold = { x0: xMin - .14, x1: xMax + .14, z0: wz - width / 2, z1: wz + width / 2 };
    }

    doors.push({
      id,
      label,
      locked: false,
      open: 0,
      targetOpen: 0,
      rattle: 0,
      slam: 0,
      bounce: 0,
      pos: { x: wx, y: 1.15, z: wz },
      openPos: {
        x: hx + closedDirX * .55 + swingX * .58,
        y: 1.15,
        z: hz + closedDirZ * .55 + swingZ * .58
      },
      threshold,
      pivots: [{
        group: pivot,
        hand,
        maxAngle,
        hx,
        hz,
        length: leaf,
        closedDirX,
        closedDirZ,
        swingDirX: swingX,
        swingDirZ: swingZ,
        obstacle: leafObstacle,
        closer,
        updateCloser
      }],
      leverPivots,
      handles,
      obstacle: doorObstacle
    });
  }

  function addWallSwitch(id, lightId, label, wx, wy, wz, faceAngle, sideCheck) {
    const p = group(dynamicRoot, wx, wz, faceAngle);
    box(p, solid, 0, wy, .012, .086, .116, .024, 0xb9b9a7);
    const rocker = box(p, solid, 0, wy + .003, .027, .039, .055, .016, 0xd1cebb);
    switches.push({
      id,
      lightId,
      label,
      pos: { x: wx, y: wy + .003, z: wz },
      rocker,
      sideCheck
    });
  }

  function blockFootprint(x, z, width, depth, sightTop, angle = 0) {
    const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
    const rx = (c * width + s * depth) / 2, rz = (s * width + c * depth) / 2;
    obstacles.push({ x0: x - rx, x1: x + rx, z0: z - rz, z1: z + rz, sightTop });
  }

  // Merge a finished prop by material so a movable desk costs two draw calls
  // instead of fifteen, while keeping its own transform for the throw.
  const inverse = new Matrix4();
  function mergeProp(g) {
    g.updateMatrixWorld(true);
    inverse.copy(g.matrixWorld).invert();
    const batches = new Map();
    g.traverse(object => {
      if (!object.isMesh) return;
      const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
      geometry.applyMatrix4(new Matrix4().multiplyMatrices(inverse, object.matrixWorld));
      const list = batches.get(object.material) || [];
      list.push(geometry);
      batches.set(object.material, list);
    });
    g.clear();
    for (const [material, geometries] of batches) {
      const merged = mergeGeometries(geometries);
      merged.computeBoundingSphere();
      g.add(new Mesh(merged, material));
      for (const geometry of geometries) geometry.dispose();
    }
  }

  // Register a free-standing desk or table as throwable. The local box is
  // measured with the group upright so a thrown prop tumbles and settles from
  // its real shape; the resting collider is the world AABB of the home pose.
  function registerProp(g, kind) {
    mergeProp(g);
    const homePosition = { x: g.position.x, y: g.position.y, z: g.position.z };
    const homeRotation = { x: g.rotation.x, y: g.rotation.y, z: g.rotation.z, order: g.rotation.order };
    g.position.set(0, 0, 0);
    g.rotation.set(0, 0, 0);
    g.updateMatrixWorld(true);
    const local = new Box3().setFromObject(g, true);
    const localBox = { x0: local.min.x, x1: local.max.x, y0: local.min.y, y1: local.max.y, z0: local.min.z, z1: local.max.z };
    g.position.set(homePosition.x, homePosition.y, homePosition.z);
    g.rotation.set(homeRotation.x, homeRotation.y, homeRotation.z, homeRotation.order);
    g.updateMatrixWorld(true);
    const box = new Box3().setFromObject(g, true);
    const id = `${kind}-${movableFurniture.length + 1}`;
    const collider = {
      x0: box.min.x, x1: box.max.x, z0: box.min.z, z1: box.max.z,
      sightTop: box.max.y, movable: true, propId: id
    };
    obstacles.push(collider);
    movableFurniture.push({
      id,
      kind,
      group: g,
      localBox,
      collider,
      size: { x: local.max.x - local.min.x, y: local.max.y - local.min.y, z: local.max.z - local.min.z },
      radius: Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) / 2,
      home: { position: homePosition, rotation: homeRotation }
    });
  }

  function addDesk(x, z, rotY = 0, overturned = false) {
    const g = group(dynamicRoot, x, z, rotY);
    if (overturned) {
      g.position.y = .34;
      g.rotation.z = 1.42;
      g.rotation.x = .18;
    }
    // Desk frame & top
    box(g, wood, 0, .72, 0, .74, .04, .52, 0xd9bf9a);
    for (const lx of [-.32, .32]) for (const lz of [-.21, .21]) {
      box(g, solid, lx, .36, lz, .035, .70, .035, 0x45504a);
    }
    box(g, solid, 0, .54, -.17, .62, .22, .025, 0x5c6860);
    // Chair tucked slightly behind (+Z)
    box(g, wood, 0, .43, .36, .40, .032, .38, 0xc49f74);
    box(g, wood, 0, .68, .53, .40, .24, .03, 0xc49f74);
    for (const lx of [-.17, .17]) for (const lz of [.20, .52]) {
      box(g, solid, lx, .22, lz, .028, .42, .028, 0x3b443e);
    }
    // The chair and the tipped tabletop both project beyond the desk legs.
    const bounds = new Box3().setFromObject(g, true);
    g.position.x += x - (bounds.min.x + bounds.max.x) / 2;
    g.position.z += z - (bounds.min.z + bounds.max.z) / 2;
    g.position.y -= bounds.min.y;
    registerProp(g, 'pupitre');
  }

  function addTeacherDesk(x, z, rotY = 0) {
    const g = group(dynamicRoot, x, z, rotY);
    box(g, wood, 0, .75, 0, 1.44, .05, .72, 0xc9a87c);
    box(g, solid, -.52, .37, 0, .34, .71, .64, 0x4c5851);
    box(g, solid, .64, .37, 0, .06, .71, .64, 0x4c5851);
    box(g, solid, .12, .56, -.28, 1.0, .36, .03, 0x5d6a62);
    // Stack of papers on desk
    box(g, solid, -.18, .79, .06, .24, .03, .30, 0xe8e4cf);
    registerProp(g, 'mesa');
  }

  function addChalkboard(x, y, z, angle, width = 3.1, height = 1.24) {
    const g = group(root, x, z, angle);
    box(g, wood, 0, y, .016, width + .10, height + .10, .032, 0x99734d);
    face(g, chalkMat, 0, y, .034, width, height, WHITE);
    box(g, wood, 0, y - height / 2 - .02, .055, width + .06, .03, .08, 0x8d6744);
  }

  function addShelf(x, z, w, files = false) {
    const d = .56, h = 2.05;
    const g = group(root, x, z);
    for (const sx of [-w / 2 + .03, w / 2 - .03]) for (const sz of [-d / 2 + .03, d / 2 - .03]) {
      box(g, solid, sx, h / 2, sz, .05, h, .05, 0x4b5751);
    }
    for (const [row, sy] of [.14, .74, 1.34, 1.94].entries()) {
      box(g, solid, 0, sy, 0, w, .035, d, 0x67746c);
      if (row === 3) break;
      const slots = Math.floor(w / .70);
      for (let i = 0; i < slots; i++) {
        const px = (i + .5) * w / slots - w / 2;
        if (files) {
          for (let j = -1; j <= 1; j++) {
            const spine = px + j * .14;
            box(g, solid, spine, sy + .20, 0, .13, .36, .33, [0x657365, 0x8a5948, 0x53676a][(i + j + row + 1) % 3]);
            box(g, solid, spine, sy + .25, .17, .065, .12, .008, 0xc8c5ad);
          }
        } else {
          const height = .25 + ((i + row) % 3) * .08;
          box(g, wood, px, sy + .018 + height / 2, 0, .54, height, .43, (i + row) % 2 ? 0xc7ab84 : 0xaf946e);
          box(g, solid, px - .12, sy + height * .60, .217, .15, .075, .008, 0xd3cdb1);
        }
      }
    }
    blockFootprint(x, z, w, d, 1.96);
  }

  function addLockerBank(x, z, angle, count = 4) {
    const w = count * 0.46;
    const g = group(root, x, z, angle);
    for (let i = 0; i < count; i++) {
      const lx = -w / 2 + 0.23 + i * 0.46;
      box(g, solid, lx, .98, 0, .44, 1.96, .48, i === 2 ? 0x485650 : 0x55645d);
      box(g, solid, lx, .98, .245, .40, 1.88, .015, 0x67776f);
      for (let v = 0; v < 4; v++) box(g, solid, lx, 1.70 - v * .045, .256, .24, .016, .01, 0x26302c);
      box(g, solid, lx + .14, 1.02, .26, .025, .10, .02, 0x2c3430);
    }
    blockFootprint(x, z, w, .54, 1.96, angle);
  }

  function addComputerBench(x, z, length = 3.2, pcs = 3, facingSign = -1) {
    // Each workstation is its own movable unit. Splitting the long bench keeps
    // every throwable prop inside the original bench + stool footprint, so the
    // merged AABB never protrudes into a running lane.
    const segLen = length / pcs;
    for (let i = 0; i < pcs; i++) {
      const wx = x - length / 2 + segLen * (i + 0.5);
      const g = group(dynamicRoot, wx, z, 0);
      box(g, wood, 0, .74, 0, segLen - .02, .05, .74, 0xc7c4b4);
      for (const edge of [-(segLen / 2 - .06), segLen / 2 - .06]) {
        box(g, solid, edge, .37, 0, .05, .72, .66, 0x3b4540);
      }
      // The monitor keeps the old bench-relative spacing, clamped so the CRT,
      // keyboard and PC tower stay strictly inside this segment.
      const pxWorldOffset = -length / 2 + 0.56 + i * ((length - 1.12) / Math.max(1, pcs - 1));
      const lx = Math.min(segLen / 2 - .39,
        Math.max(-segLen / 2 + .24, x + pxWorldOffset - wx));
      // CRT Monitor
      box(g, solid, lx, .98, -facingSign * .14, .44, .38, .34, 0xc9c6b4);
      box(g, solid, lx, .81, -facingSign * .14, .22, .05, .20, 0x8e9285);
      const screenFace = face(g, crtMat, lx, .99, facingSign * .035, .36, .27, WHITE);
      if (facingSign < 0) screenFace.rotation.y = Math.PI;
      // Keyboard
      box(g, solid, lx, .775, facingSign * .19, .38, .022, .14, 0xbab7a5);
      // PC Tower
      box(g, solid, lx + .26, .93, -facingSign * .08, .17, .36, .34, 0xb4b3a3);
      // Stool
      cylinder(g, solid, lx, .25, facingSign * .52, .04, .18, .44, 0x343d38, 6);
      box(g, solid, lx, .48, facingSign * .52, .34, .05, .34, 0x2f3a36);
      registerProp(g, 'mesa');
    }
  }

  function addDraftingTable(x, z) {
    const g = group(dynamicRoot, x, z);
    for (const legX of [-.44, .44]) {
      rod(g, solid, [legX, .03, -.32], [legX, .93, -.10], .035, 0x46544f);
      rod(g, solid, [legX, .03, .30], [legX, .89, -.10], .035, 0x46544f);
    }
    box(g, solid, 0, .32, -.22, .92, .04, .04, 0x4e5b55);
    const easel = group(g, 0, 0);
    easel.position.y = .90;
    easel.rotation.x = .26;
    box(easel, wood, 0, 0, 0, 1.12, .05, .76, 0xc4aa87);
    face(easel, drawingMat, -.07, .026, 0, .75, .53).rotation.x = -Math.PI / 2;
    box(easel, solid, .32, .037, 0, .027, .016, .72, 0x586762);
    cylinder(g, solid, 0, .24, .55, .045, .19, .46, 0x414d48);
    cylinder(g, wood, 0, .48, .55, .20, .20, .045, 0xaa916d);
    registerProp(g, 'mesa');
  }

  function addPlanChest(x, z) {
    const g = group(dynamicRoot, x, z, Math.PI);
    box(g, solid, 0, .52, 0, 1.80, 1.04, .83, 0x536861);
    for (let i = 0; i < 6; i++) {
      const y = .14 + i * .152;
      box(g, solid, 0, y, .421, 1.70, .135, .018, 0x829083);
      for (const s of [-.52, .52]) box(g, solid, s, y + .01, .446, .22, .032, .055, 0x414f48);
    }
    for (let i = 0; i < 4; i++) {
      const tube = cylinder(g, solid, 0, 1.10, -.25 + i * .12, .052, .052, 1.48 - i * .12, 0xd8d2b7);
      tube.rotation.z = Math.PI / 2;
    }
    registerProp(g, 'mesa');
  }

  function addServerRack(x, z) {
    const g = group(root, x, z, Math.PI);
    box(g, solid, 0, 1.02, 0, .82, 2.04, .78, 0x343f3c);
    for (let i = 0; i < 8; i++) {
      const y = .27 + i * .215;
      box(g, solid, 0, y, .397, .72, .17, .025, 0x526059);
      box(g, solid, -.11, y, .414, .34, .045, .014, 0x29342f);
      box(g, luminous, .25, y, .416, .042, .027, .012, i === 2 ? 0xc76c4e : 0x80b18e);
    }
    blockFootprint(x, z, .82, .85, 2.04);
  }

  function addCrates(x, z, tiers) {
    const g = group(dynamicRoot, x, z);
    let base = 0;
    for (let i = 0; i < tiers; i++) {
      const w = .78 - i * .09, d = .70 - i * .06, h = .52 - i * .04;
      box(g, wood, 0, base + h / 2, 0, w, h, d, i % 2 ? 0xbba07b : 0xa98c63);
      for (const strap of [-.28, .28]) box(g, solid, strap * w, base + h / 2, 0, .039, h + .008, d + .012, 0x605f50);
      base += h + .012;
    }
    registerProp(g, 'caja');
  }

  function addElectronicsBench(x, z, length, angle) {
    // Two half-length movable benches. Each half keeps the pedestals and its
    // own instrument so the throwable AABB fits the original length x 0.90 bay.
    const segLen = length / 2 - .02;
    for (let i = 0; i < 2; i++) {
      const cx = i === 0 ? -length / 4 : length / 4;
      const ux = x + cx * Math.cos(angle);
      const uz = z - cx * Math.sin(angle);
      const g = group(dynamicRoot, ux, uz, angle);
      box(g, wood, 0, .86, 0, segLen, .08, .90, 0xb59873);
      for (const s of [-1, 1]) {
        box(g, solid, s * (segLen / 2 - .18), .41, 0, .28, .82, .78, 0x52645c);
      }
      box(g, solid, 0, .913, .12, segLen * .72, .02, .45, 0x506c60);
      if (i === 0) {
        // Oscilloscope and probe lead on the left half.
        box(g, solid, 0, 1.12, -.08, .62, .42, .38, 0xa9ad9c);
        face(g, scopeMat, -.07, 1.14, .114, .32, .22);
        for (const y of [1.07, 1.21]) box(g, solid, .20, y, .123, .07, .065, .045, 0x45534e);
        rod(g, solid, [.20, .93, .15], [segLen / 2 - .22, .93, .29], .010, 0x8c5542);
      } else {
        // Bench power supply and lead on the right half.
        box(g, solid, 0, 1.045, -.12, .45, .28, .33, 0x626e65);
        for (const s of [-1, 1]) {
          box(g, solid, s * .10, 1.05, .057, .043, .044, .023, s > 0 ? 0xa65c45 : 0x293a35);
        }
        rod(g, solid, [-.12, .93, .15], [segLen / 2 - .22, .93, .29], .010, 0x8c5542);
      }
      registerProp(g, 'mesa');
    }
  }

  function addCableReel(x, z, radius) {
    const g = group(dynamicRoot, x, z);
    for (const s of [-1, 1]) {
      const flange = cylinder(g, wood, s * .25, radius, 0, radius, radius, .046, 0xba9870, 10);
      flange.rotation.z = Math.PI / 2;
    }
    for (let i = 0; i < 8; i++) {
      const winding = cylinder(g, solid, -.205 + i * .059, radius, 0, radius * .77, radius * .77, .053, i % 2 ? 0x504044 : 0x634d48, 10);
      winding.rotation.z = Math.PI / 2;
    }
    registerProp(g, 'caja');
  }

  const bayX = (b, t = .5) => b.x0 + (b.x1 - b.x0) * t;
  const bayZ = (b, t = .5) => b.z0 + (b.z1 - b.z0) * t;
  function furnish(r) {
    const bays = furnishingBays(r);
    if (r.kind === 'guardhouse') {
      // Guard desk with dual CRT security monitors & desk lamp inside bays[0] (max 3 materials in prop)
      const g = group(dynamicRoot, -24.35, 17.65, 0);
      box(g, wood, 0, .75, 0, 1.32, .05, .68, 0xb8966c);
      box(g, solid, -.48, .37, 0, .30, .71, .60, 0x45514b);
      box(g, solid, .58, .37, 0, .06, .71, .60, 0x45514b);
      box(g, solid, .10, .56, .26, .92, .34, .03, 0x56635b);
      // Dual CRT security monitors facing North (-Z) / East (+X) toward watchman windows
      for (const [mx, rot] of [[-.26, .18], [.22, -.24]]) {
        const mon = group(g, mx, -.12, rot);
        box(mon, solid, 0, .95, 0, .38, .32, .30, 0xb5b4a2);
        box(mon, solid, 0, .79, 0, .18, .04, .18, 0x767c72);
        const scr = face(mon, securityMat, 0, .96, -.154, .31, .23, WHITE);
        scr.rotation.y = Math.PI;
      }
      // Keyboard, logbook, and small desk lamp
      box(g, solid, -.02, .785, .14, .36, .02, .13, 0xa8a696);
      box(g, solid, .46, .785, .12, .22, .025, .26, 0xd8d3bc);
      box(g, solid, -.52, .80, .18, .11, .04, .11, 0x3b4540);
      box(g, solid, -.52, .94, .20, .025, .24, .025, 0x4b5751);
      box(g, solid, -.48, 1.05, .16, .14, .06, .12, 0x53665c);
      box(g, securityMat, -.48, 1.01, .16, .08, .02, .08, 0xffe4a8);
      registerProp(g, 'mesa');

      addCrates(-24.75, 18.78, 2);
      addCrates(-23.30, 18.78, 1);

      // Wall key rack & clipboard on West wall (pure visual)
      box(root, wood, -25.56, 1.54, 15.6, .04, .56, .84, 0x9b7954);
      for (let i = 0; i < 6; i++) {
        box(root, solid, -25.52, 1.66 - (i % 2) * .22, 15.32 + Math.floor(i / 2) * .26, .03, .08, .02, 0xb9b8a3);
      }
      return;
    }

    const [innerFar, outerFar, innerNear, outerNear] = r.side > 0 ? bays : [bays[1], bays[0], bays[3], bays[2]];
    const cx = (r.x0 + r.x1) / 2;
    switch (r.kind) {
      case 'classroom':
        addChalkboard(cx + .6, 1.62, r.z1 - .02, Math.PI, 4.0);
        addTeacherDesk(bayX(innerNear), bayZ(innerNear, .45), Math.PI);
        addShelf(bayX(innerNear), innerNear.z1 - .30, innerNear.x1 - innerNear.x0 - .45, true);
        for (const b of [innerFar, outerFar, outerNear]) {
          const rows = (b === outerNear || b === outerFar) ? [.26, .73] : [.18, .50, .82];
          for (const col of [.24, .76]) for (const row of rows) addDesk(bayX(b, col), bayZ(b, row), Math.PI);
        }
        break;
      case 'abandoned':
        addChalkboard(cx, 1.62, r.z0 + .02, 0, 3.4);
        addTeacherDesk(bayX(innerFar), bayZ(innerFar, .28), .23);
        addDesk(bayX(innerFar, .32), bayZ(innerFar, .72), -.48, true);
        addLockerBank(bayX(innerNear), innerNear.z1 - .30, Math.PI, 5);
        for (const b of [outerFar, innerNear, outerNear]) {
          addDesk(bayX(b, .30), bayZ(b, .27), -.43, b !== outerNear);
          addDesk(bayX(b, .70), bayZ(b, .66), .31, b !== innerNear);
        }
        addCrates(bayX(outerFar, .78), bayZ(outerFar, .19), 2);
        break;
      case 'drafting':
        addChalkboard(r.x0 + .02, 1.66, r.doorZ, Math.PI / 2, 3.6);
        addPlanChest(bayX(innerNear), r.z1 - .63);
        face(root, drawingMat, bayX(innerNear), 1.80, r.z1 - .026, 1.48, 1.11).rotation.y = Math.PI;
        addTeacherDesk(bayX(innerNear), bayZ(innerNear, .40));
        for (const b of [innerFar, outerFar, outerNear]) {
          const cols = b === outerNear ? [.50] : [.26, .74];
          for (const col of cols) for (const row of [.22, .70]) addDraftingTable(bayX(b, col), bayZ(b, row));
        }
        break;
      case 'computerLab':
        addChalkboard(r.x1 - .02, 1.66, r.doorZ, -Math.PI / 2, 3.4, 1.15);
        for (const b of [innerFar, outerFar]) {
          const length = b.x1 - b.x0 - .46;
          addComputerBench(bayX(b), bayZ(b, .20), length, 3, 1);
          addComputerBench(bayX(b), bayZ(b, .80), length, 3, -1);
        }
        for (const b of [innerNear, outerNear]) addComputerBench(bayX(b), bayZ(b, .38), b.x1 - b.x0 - .46, 2, 1);
        for (const col of [.22, .50, .78]) addServerRack(bayX(innerNear, col), innerNear.z1 - .45);
        break;
      case 'storage': {
        for (const b of [innerFar, outerFar, innerNear]) {
          const width = b.x1 - b.x0 - .45;
          addShelf(bayX(b), bayZ(b, .18), width);
          if (b === innerNear) addTeacherDesk(bayX(b), bayZ(b, .77), Math.PI);
          else addShelf(bayX(b), bayZ(b, .81), width);
          addCrates(bayX(b, .78), bayZ(b), 2);
        }
        for (const col of [.24, .76]) for (const row of [.23, .75]) {
          addCrates(bayX(outerNear, col), bayZ(outerNear, row), col === .24 ? 3 : 1);
        }
        // Wall-mounted backup generator switchgear & exhaust conduits on back wall (no floor obstacles)
        const swX = r.x1 - .06;
        for (const [i, sz] of [r.doorZ - .58, r.doorZ + .58].entries()) {
          box(root, solid, swX, 1.66, sz, .12, .96, .78, 0x3b4541);
          box(root, solid, swX - .066, 1.66, sz, .014, .88, .70, 0x4f5b55);
          if (i === 0) {
            face(root, breakerMat, swX - .075, 1.68, sz, .62, .78).rotation.y = -Math.PI / 2;
          } else {
            box(root, solid, swX - .075, 1.96, sz, .012, .08, .58, 0xc29834);
            box(root, solid, swX - .082, 1.72, sz - .14, .022, .20, .20, 0x262e2b);
            box(root, solid, swX - .094, 1.72, sz - .14, .008, .14, .14, 0xcac6ae);
            box(root, solid, swX - .090, 1.46, sz + .18, .04, .14, .05, 0x222926);
          }
          // Glowing amber/red/green generator status LEDs
          for (const [li, lcol] of [0xffa438, 0xe84836, 0x67c47a].entries()) {
            box(root, luminous, swX - .078, 1.90 - li * .12, sz + .24, .014, .032, .032, lcol);
          }
          // Vertical conduit risers up to ceiling header
          cylinder(root, solid, swX, 2.52, sz - .18, .026, .026, .78, 0x454f4b, 8);
          cylinder(root, solid, swX, 2.52, sz + .18, .022, .022, .78, 0x5c5346, 8);
        }
        // Horizontal exhaust manifold, silencer drum & pipe clamps
        const exhaust = cylinder(root, solid, swX - .05, 2.74, r.doorZ, .055, .055, 4.4, 0x363e3b, 8);
        exhaust.rotation.x = Math.PI / 2;
        const muffler = cylinder(root, solid, swX - .06, 2.74, r.doorZ, .13, .13, 1.12, 0x49524e, 10);
        muffler.rotation.x = Math.PI / 2;
        for (const bz of [r.doorZ - 1.8, r.doorZ - .9, r.doorZ + .9, r.doorZ + 1.8]) {
          box(root, solid, swX - .01, 2.74, bz, .12, .14, .06, 0x2a312e);
        }
        break;
      }
      case 'elecLab': {
        const panelX = r.x0 + .065;
        box(root, solid, panelX, 1.52, r.doorZ, .08, 1.18, .78, 0x3f4944);
        face(root, breakerMat, panelX + .042, 1.52, r.doorZ, .70, 1.08).rotation.y = Math.PI / 2;
        for (const b of [innerFar, outerFar, innerNear]) {
          const width = b.x1 - b.x0 - .54;
          addElectronicsBench(bayX(b), bayZ(b, .27), width, 0);
          if (b === outerFar) addLockerBank(bayX(b), bayZ(b, .83), Math.PI, 6);
          else addElectronicsBench(bayX(b), bayZ(b, .77), width, Math.PI);
        }
        addCableReel(bayX(outerNear, .30), bayZ(outerNear, .34), .51);
        addCableReel(bayX(outerNear, .72), bayZ(outerNear, .65), .37);
        break;
      }
    }
  }

  rooms.forEach(r => {
    const rw = r.x1 - r.x0;
    const rl = r.z1 - r.z0;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;

    // Room floor & ceiling
    box(root, floorMat, cx, -.066, cz, rw, .132, rl, WHITE);
    box(root, ceilingMat, cx, H + .054, cz, rw, .108, rl, WHITE);

    if (r.kind === 'guardhouse') {
      // Solid West & South walls
      wallStrip(r.x0, cz, rl + WALL_THICK * 2, Math.PI / 2);
      wallStrip(cx, r.z1, rw, Math.PI);
      obstacles.push(
        { x0: r.x0 - WALL_THICK, x1: r.x0, z0: r.z0 - WALL_THICK, z1: r.z1 + WALL_THICK },
        { x0: r.x0, x1: r.x1, z0: r.z1, z1: r.z1 + WALL_THICK }
      );

      // North wall split around '107-norte' (x: -22.0, width: 1.24) + watchman window at x = -20.0
      const nDoor = r.extraDoors.find(d => d.wall === 'north');
      const nd0 = nDoor.x - nDoor.width / 2, nd1 = nDoor.x + nDoor.width / 2;
      wallStrip((r.x0 + nd0) / 2, r.z0, nd0 - r.x0, 0);
      obstacles.push({ x0: r.x0, x1: nd0, z0: r.z0 - WALL_THICK, z1: r.z0, rounded: true });
      const nEastEnd = r.x1 + WALL_THICK;
      const nEastCX = (nd1 + nEastEnd) / 2;
      wallSegmentWithWindow(nEastCX, r.z0, nEastEnd - nd1, 0, -20.0 - nEastCX, 1.70, 1.08, 2.38);
      obstacles.push({ x0: nd1, x1: nEastEnd, z0: r.z0 - WALL_THICK, z1: r.z0, rounded: true });
      addSingleDoor({
        id: '107-norte',
        label: 'Caseta 107 (Norte)',
        wx: nDoor.x,
        wz: r.z0 - WALL_THICK / 2,
        width: nDoor.width,
        swingX: 0,
        swingZ: -1,
        hand: 1,
        wallThick: WALL_THICK
      });
      plaque(root, makeMaterial(roomPlate('107', false, r.subject)), -20.85, 1.71, r.z0 - WALL_THICK, .50, .25, Math.PI);

      // East wall split around '107' (z: 16.0, width: 1.24) + watchman window at z = 14.0
      const eDoor = r.extraDoors.find(d => d.wall === 'east');
      const ed0 = eDoor.z - eDoor.width / 2, ed1 = eDoor.z + eDoor.width / 2;
      const eNorthCZ = (r.z0 + ed0) / 2;
      wallSegmentWithWindow(r.x1, eNorthCZ, ed0 - r.z0, -Math.PI / 2, 14.0 - eNorthCZ, 1.70, 1.08, 2.38);
      obstacles.push({ x0: r.x1, x1: r.x1 + WALL_THICK, z0: r.z0, z1: ed0, rounded: true });
      const eSouthEnd = r.z1 + WALL_THICK;
      wallStrip(r.x1, (ed1 + eSouthEnd) / 2, eSouthEnd - ed1, -Math.PI / 2);
      obstacles.push({ x0: r.x1, x1: r.x1 + WALL_THICK, z0: ed1, z1: eSouthEnd, rounded: true });
      addSingleDoor({
        id: '107',
        label: 'Caseta 107 (Este)',
        wx: r.x1 + WALL_THICK / 2,
        wz: eDoor.z,
        width: eDoor.width,
        swingX: 1,
        swingZ: 0,
        hand: 1,
        wallThick: WALL_THICK
      });
      plaque(root, makeMaterial(roomPlate('107', false, r.subject)), r.x1 + WALL_THICK, 1.71, 16.94, .50, .25, Math.PI / 2);

      // Inside & outside light switches for Caseta 107
      addWallSwitch('sw-in-107', r.lightId, r.label, r.x1 - .002, 1.21, 16.94, -Math.PI / 2,
        pose => pose.x < r.x1 && pose.z > r.z0);
      addWallSwitch('sw-out-107', r.lightId, r.label, r.x1 + WALL_THICK + .002, 1.21, 16.94, Math.PI / 2,
        pose => pose.x > r.x1 - .02);

      furnish(r);
      return;
    }

    // Three outer walls for corridor rooms (back + two Z-end walls, split around extraDoors)
    const backX = r.side > 0 ? r.x1 : r.x0;
    wallStrip(backX, cz, rl + WALL_THICK * 2, r.side > 0 ? -Math.PI / 2 : Math.PI / 2);
    if (r.side > 0) obstacles.push({ x0: r.x1, x1: r.x1 + WALL_THICK, z0: r.z0 - WALL_THICK, z1: r.z1 + WALL_THICK });
    else obstacles.push({ x0: r.x0 - WALL_THICK, x1: r.x0, z0: r.z0 - WALL_THICK, z1: r.z1 + WALL_THICK });

    const northDoor = r.extraDoors?.find(d => d.wall === 'north');
    if (northDoor) {
      const d0 = northDoor.x - northDoor.width / 2, d1 = northDoor.x + northDoor.width / 2;
      const wLeftCX = (r.x0 + d0) / 2, wRightCX = (d1 + r.x1) / 2;
      if (r.id === '103') {
        wallSegmentWithWindow(wLeftCX, r.z0, d0 - r.x0, 0, 0, 2.20, 1.12, 2.48);
        wallSegmentWithWindow(wRightCX, r.z0, r.x1 - d1, 0, 0, 2.20, 1.12, 2.48);
      } else {
        wallStrip(wLeftCX, r.z0, d0 - r.x0, 0);
        wallStrip(wRightCX, r.z0, r.x1 - d1, 0);
      }
      obstacles.push(
        { x0: r.x0, x1: d0, z0: r.z0 - WALL_THICK, z1: r.z0, rounded: true },
        { x0: d1, x1: r.x1, z0: r.z0 - WALL_THICK, z1: r.z0, rounded: true }
      );
      if (northDoor.to === 'plaza') {
        addSingleDoor({
          id: `${r.id}-plaza`,
          label: `Puerta Plaza ${r.id}`,
          wx: northDoor.x,
          wz: r.z0 - WALL_THICK / 2,
          width: northDoor.width,
          swingX: 0,
          swingZ: -1,
          hand: -1,
          wallThick: WALL_THICK
        });
      } else {
        addSingleDoor({
          id: `${r.id}-${northDoor.to}`,
          label: `Puerta ${r.id}–${northDoor.to}`,
          wx: northDoor.x,
          wz: r.z0,
          width: northDoor.width,
          swingX: 0,
          swingZ: -1,
          hand: -1,
          wallThick: WALL_THICK * 2
        });
      }
    } else {
      wallStrip(cx, r.z0, rw, 0);
      obstacles.push({ x0: r.x0, x1: r.x1, z0: r.z0 - WALL_THICK, z1: r.z0 });
    }

    const southDoor = r.extraDoors?.find(d => d.wall === 'south');
    if (southDoor) {
      const d0 = southDoor.x - southDoor.width / 2, d1 = southDoor.x + southDoor.width / 2;
      const wLeftCX = (r.x0 + d0) / 2, wRightCX = (d1 + r.x1) / 2;
      if (r.id === '106') {
        wallSegmentWithWindow(wLeftCX, r.z1, d0 - r.x0, Math.PI, 0, 2.40, 1.12, 2.48);
        wallSegmentWithWindow(wRightCX, r.z1, r.x1 - d1, Math.PI, 0, 2.40, 1.12, 2.48);
        addSingleDoor({
          id: `${r.id}-plaza`,
          label: `Puerta Plaza ${r.id}`,
          wx: southDoor.x,
          wz: r.z1 + WALL_THICK / 2,
          width: southDoor.width,
          swingX: 0,
          swingZ: 1,
          hand: 1,
          wallThick: WALL_THICK
        });
      } else {
        wallStrip(wLeftCX, r.z1, d0 - r.x0, Math.PI);
        wallStrip(wRightCX, r.z1, r.x1 - d1, Math.PI);
        box(root, plaster, southDoor.x, (2.28 + H) / 2, r.z1 + WALL_THICK / 2, southDoor.width, H - 2.28, WALL_THICK, WHITE);
      }
      obstacles.push(
        { x0: r.x0, x1: d0, z0: r.z1, z1: r.z1 + WALL_THICK, rounded: true },
        { x0: d1, x1: r.x1, z0: r.z1, z1: r.z1 + WALL_THICK, rounded: true }
      );
    } else {
      wallStrip(cx, r.z1, rw, Math.PI);
      obstacles.push({ x0: r.x0, x1: r.x1, z0: r.z1, z1: r.z1 + WALL_THICK });
    }

    const switchZ = r.doorZ + r.side * r.hand * switchOffset;
    const switchX = r.side * (W + wallThickness + .002);
    addWallSwitch(
      `sw-in-${r.id}`,
      r.lightId,
      r.label,
      switchX,
      1.21,
      switchZ,
      r.side > 0 ? Math.PI / 2 : -Math.PI / 2,
      pose => (r.side > 0 ? pose.x > W + 0.05 : pose.x < -W - 0.05)
    );

    furnish(r);
  });

  // Existing annex and stairwell.
  const annexH = annex.height;
  const axMid = (annex.x0 + annex.x1) / 2;
  const azMid = (annex.z0 + annex.z1) / 2;
  const aw = annex.x1 - annex.x0;
  const al = annex.z1 - annex.z0;

  // Floor & higher Annex ceiling
  box(root, floorMat, axMid, -.066, azMid, aw, .132, al, WHITE);
  box(root, ceilingMat, axMid, annexH + .054, azMid, aw, .108, al, WHITE);

  // Outer Annex walls (West wall split around annex.sideExit)
  const sx0 = annex.sideExit.z - annex.sideExit.width / 2;
  const sx1 = annex.sideExit.z + annex.sideExit.width / 2;
  const westN0 = annex.z0 - WALL_THICK, westS1 = annex.z1 + WALL_THICK;
  wallStrip(annex.x0, (westN0 + sx0) / 2, sx0 - westN0, Math.PI / 2, annexH);
  wallStrip(annex.x0, (sx1 + westS1) / 2, westS1 - sx1, Math.PI / 2, annexH);
  addSingleDoor({
    id: 'anexo-plaza',
    label: 'Puerta Pasaje Norte',
    wx: annex.x0 - WALL_THICK / 2,
    wz: annex.sideExit.z,
    width: annex.sideExit.width,
    swingX: -1,
    swingZ: 0,
    hand: 1,
    wallThick: WALL_THICK,
    wallHeight: annexH
  });

  wallStrip(annex.x1, azMid, al + WALL_THICK * 2, -Math.PI / 2, annexH);
  wallStrip(axMid, annex.z0, aw, 0, annexH);

  // Close the two shoulders between the hall end wall and the wider annex.
  wallStrip((annex.x0 - W) / 2, annex.z1 - wallThickness, -W - annex.x0, Math.PI, H);
  wallStrip((annex.x1 + W) / 2, annex.z1 - wallThickness, annex.x1 - W, Math.PI, H);
  box(root, plaster, axMid, (H + annexH) / 2, annex.z1 - .08, aw, annexH - H, .18, WHITE);

  // Annex outer wall collisions
  obstacles.push(
    { x0: annex.x0 - WALL_THICK, x1: annex.x0, z0: westN0, z1: sx0, rounded: true },
    { x0: annex.x0 - WALL_THICK, x1: annex.x0, z0: sx1, z1: westS1, rounded: true },
    { x0: annex.x1, x1: annex.x1 + WALL_THICK, z0: annex.z0 - WALL_THICK, z1: annex.z1 + WALL_THICK },
    { x0: annex.x0 - WALL_THICK, x1: annex.x1 + WALL_THICK, z0: annex.z0 - WALL_THICK, z1: annex.z0 },
    { x0: annex.x0 - WALL_THICK, x1: -W, z0: annex.z1 - .18, z1: annex.z1 + .05 },
    { x0: W, x1: annex.x1 + WALL_THICK, z0: annex.z1 - .18, z1: annex.z1 + .05 }
  );

  // Light switches inside the Annex
  addWallSwitch(
    'sw-anexo-1',
    'anexo1',
    'Anexo',
    -1.42,
    1.21,
    annex.z1 - .175,
    Math.PI,
    pose => pose.z < annex.z1
  );
  addWallSwitch(
    'sw-anexo-2',
    'anexo2',
    'Escaleras',
    annex.x0 + .02,
    1.21,
    annex.z1 - 7.20,
    Math.PI / 2,
    pose => pose.z < annex.z1
  );

  // Lockers along East wall & bench (updated for annex.z1 = -28.00)
  addLockerBank(3.62, annex.z1 - 3.0, -Math.PI / 2, 6);
  box(root, wood, 3.60, .44, annex.z1 - 8.2, .48, .06, 1.9, 0xe7d6b8);
  for (const bz of [annex.z1 - 8.9, annex.z1 - 7.5]) box(root, solid, 3.60, .21, bz, .40, .42, .06, 0x3b4741);
  obstacles.push({ x0: 3.34, x1: 3.90, z0: -37.15, z1: -35.25, top: .47 });

  // Bulletin board on West wall
  box(root, wood, -3.86, 1.66, -34.0, .08, .96, 1.82, 0xc9c9b4);
  const annexBoard = face(root, boardMat, -3.81, 1.66, -34.0, 1.72, .86, WHITE);
  annexBoard.rotation.y = Math.PI / 2;

  // Walkable Staircase along West side leading up to Mezzanine Landing
  const { x0: stairX0, x1: stairX1, count: numSteps, rise: stepRise, run: stepDepth, startZ: stairStartZ } = stairs;
  const stairWidth = stairX1 - stairX0;
  const stairCX = (stairX0 + stairX1) / 2;

  for (let i = 0; i < numSteps; i++) {
    const topY = (i + 1) * stepRise;
    const z1 = stairStartZ - i * stepDepth;
    const z0 = z1 - stepDepth;
    box(root, floorMat, stairCX, topY / 2, (z0 + z1) / 2, stairWidth, topY, stepDepth, 0xd9d8cb);
    // Non-slip metal stair nosing
    box(root, solid, stairCX, topY + .006, z1 - .025, stairWidth - .02, .014, .05, 0x39433d);
    obstacles.push({ x0: stairX0, x1: stairX1, z0, z1, top: topY, step: true });
  }

  // Upper landing (mezzanine) at top of stairs
  const { top: landingY, z1: landingZ1, z0: landingZ0, x0: landingX0, x1: landingX1 } = landing;
  box(
    root,
    floorMat,
    (landingX0 + landingX1) / 2,
    landingY / 2,
    (landingZ0 + landingZ1) / 2,
    landingX1 - landingX0,
    landingY,
    landingZ1 - landingZ0,
    0xcac9bc
  );
  obstacles.push({
    x0: landingX0,
    x1: landingX1,
    z0: landingZ0,
    z1: landingZ1,
    top: landingY,
    step: true
  });

  // Handrails & guardrails so player stays safely on stairs/landing
  const railX = stairX1 + 0.04;
  rod(root, solid, [railX, .92, stairStartZ], [railX, landingY + .92, landingZ1], .024, 0x768379);
  for (let i = 0; i <= 3; i++) {
    const t = i / 3;
    const pz = stairStartZ + (landingZ1 - stairStartZ) * t;
    const py = landingY * t;
    box(root, solid, railX, py + .46, pz, .045, .92, .045, 0x56635b);
  }
  // Stair stringer barrier wall (prevents walking sideways under/into stairs)
  obstacles.push({ x0: stairX1 - .04, x1: stairX1 + .10, z0: landingZ1, z1: stairStartZ, sightTop: 0 });

  // Landing front guardrail (x from railX to landingX1) + east edge rail
  const guardW = landingX1 - railX;
  box(root, solid, (railX + landingX1) / 2, landingY + .92, landingZ1 + .04, guardW, .045, .045, 0x768379);
  box(root, solid, (railX + landingX1) / 2, landingY + .50, landingZ1 + .04, guardW, .03, .03, 0x56635b);
  for (const gx of [railX + .5, landingX1 - .04]) {
    box(root, solid, gx, landingY + .46, landingZ1 + .04, .045, .92, .045, 0x56635b);
  }
  box(root, solid, landingX1 - .04, landingY + .92, (landingZ0 + landingZ1) / 2, .045, .045, landingZ1 - landingZ0, 0x768379);
  box(root, solid, landingX1 - .04, landingY + .46, landingZ0 + .2, .045, .92, .045, 0x56635b);

  // Guardrail collisions (block stepping off elevated landing except down the stairs!)
  obstacles.push(
    { x0: railX - .04, x1: landingX1 + .08, z0: landingZ1 - .08, z1: landingZ1 + .12, sightTop: landingY },
    { x0: landingX1 - .08, x1: landingX1 + .10, z0: landingZ0, z1: landingZ1, sightTop: landingY }
  );

  // Locked rooftop / upper level shutter door on the landing
  const roofDoorZ = landingZ0 + 0.04;
  const roofDoorX = landing.doorX;
  const roofGroup = group(dynamicRoot, roofDoorX, roofDoorZ, 0);
  box(root, solid, roofDoorX, landingY + 1.12, landingZ0 + .03, 1.32, 2.24, .08, 0x3b4440);
  box(roofGroup, solid, 0, landingY + 1.08, .04, 1.16, 2.12, .05, 0x535e57);
  box(roofGroup, solid, .42, landingY + 1.02, .08, .08, .18, .05, 0xa8ab99);
  face(root, exitMat, roofDoorX, landingY + 2.38, landingZ0 + .05, .72, .20, WHITE);
  doors.push({
    id: 'azotea',
    label: 'Puerta Azotea',
    locked: true,
    open: 0,
    targetOpen: 0,
    rattle: 0,
    pos: { x: roofDoorX, y: landingY + 1.12, z: roofDoorZ + 0.12 },
    pivots: [{ group: roofGroup, hand: 1, maxAngle: 0.1 }],
    obstacle: null
  });

  // =====================================================================
  // MINI PLAZA EXTERIOR ("Patio Central")
  // =====================================================================
  const plazaSlabs = [
    plaza.main,
    { x0: -25.60, x1: -18.40, z0: 11.60, z1: 12.40 },
    plaza.southWalkway,
    plaza.northPassage,
    plaza.annexAlley
  ];
  for (const s of plazaSlabs) {
    box(root, plazaFloorMat, (s.x0 + s.x1) / 2, -.066, (s.z0 + s.z1) / 2, s.x1 - s.x0, .132, s.z1 - s.z0, WHITE);
  }

  // Close the small corner gap between Lab 106 (-27.20), Annex (-28.00), and annexAlley (x1 = -3.90)
  box(root, plaster, -3.75, H / 2, -27.60, .30, H, .80, 0xd4d7c9);
  box(root, paint, -3.75, 1.075 / 2, -27.60, .31, 1.075, .81, WHITE);
  obstacles.push({ x0: -3.90, x1: -3.60, z0: -28.00, z1: -27.20 });

  // 6-sided skybox enclosure spanning x: -58..+42, y: -2..+42, z: -68..+52
  const skyboxMesh = box(root, skyboxMat, -8, 20, -8, 100, 44, 120);
  skyboxMesh.name = 'skybox';

  // Exterior roof parapets, upper facades (y = 3.08..3.96), pilasters & downspouts
  function addDownspout(parent, lx, lz, topY = 3.82) {
    cylinder(parent, solid, lx, topY / 2, lz, .034, .034, topY - .06, 0x262e2b, 8);
    box(parent, solid, lx, topY - .08, lz, .13, .14, .11, 0x323c38);
    for (const sy of [.78, 1.92, 3.06]) {
      box(parent, solid, lx, sy, lz - .02, .09, .035, .07, 0x202724);
    }
    box(parent, solid, lx, .07, lz + .03, .08, .08, .10, 0x2a332f);
  }

  function addParapetRun(x0, z0, x1, z1, {
    yBase = H, yTop = 3.96, wallThick = WALL_THICK, pilasterStep = 4.2, downspouts = []
  } = {}) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const angle = Math.atan2(-dz, dx);
    // Outward normal is local +Z: (sin(angle), cos(angle))
    const p = group(root, (x0 + x1) / 2, (z0 + z1) / 2, angle);
    const copingH = .12;
    const friezeTop = yTop - copingH;
    const friezeH = friezeTop - yBase;
    if (friezeH > .01) {
      box(p, plaster, 0, (yBase + friezeTop) / 2, 0, len, friezeH, wallThick, 0xbec4b7);
      box(p, solid, 0, yBase + .03, wallThick / 2 + .005, len, .05, .016, 0x7b847a);
      box(p, solid, 0, friezeTop - .025, wallThick / 2 + .012, len, .05, .028, 0x8e978b);
    }
    // Overhanging stone coping cornice
    box(p, solid, 0, yTop - copingH / 2, .03, len + .08, copingH, wallThick + .12, 0x7d867a);
    box(p, solid, 0, yTop - .015, .03, len + .10, .03, wallThick + .14, 0x959e91);
    // Vertical upper facade pilasters
    const count = Math.max(2, Math.round(len / pilasterStep) + 1);
    for (let i = 0; i < count; i++) {
      const px = -len / 2 + .14 + (i / (count - 1)) * (len - .28);
      box(p, solid, px, (yBase + yTop - .03) / 2, wallThick / 2 + .022, .26, yTop - yBase - .03, .048, 0x8f988c);
      box(p, solid, px, yTop - .04, wallThick / 2 + .035, .30, .06, .06, 0x9ca598);
    }
    for (const dOff of downspouts) {
      addDownspout(p, dOff, wallThick / 2 + .045, yTop - copingH);
    }
  }

  // Dark roof decks so roofs read solid from above or angled courtyard views
  box(root, solid, -3.69 + 3.69, 3.16, -2.0, 7.56, .06, 52.0, 0x161b19);
  box(root, solid, -8.60, 3.16, 17.00, 10.18, .06, 11.16, 0x161b19);
  box(root, solid, -9.00, 3.16, -21.20, 10.98, .06, 12.36, 0x161b19);

  // Corridor West facade (x = -3.69, z: -15.20..11.60, outward -X)
  addParapetRun(-3.69, -15.02, -3.69, 11.42, { downspouts: [-12.6, 12.6] });
  // Lab 106 South, West, and North walls
  addParapetRun(-14.58, -15.11, -3.60, -15.11, { pilasterStep: 3.6 });
  addParapetRun(-14.49, -27.38, -14.49, -15.02, { pilasterStep: 4.0, downspouts: [-5.6, 5.6] });
  addParapetRun(-3.60, -27.29, -14.58, -27.29, { pilasterStep: 3.6 });
  // Small corner parapet between Lab 106 (-27.20) and Annex (-28.00)
  addParapetRun(-3.75, -28.00, -3.75, -27.20, { wallThick: .30, pilasterStep: 2.0 });
  // Sala 103 North and West walls
  addParapetRun(-3.60, 11.51, -13.78, 11.51, { pilasterStep: 3.4 });
  addParapetRun(-13.69, 11.42, -13.69, 22.58, { pilasterStep: 3.7, downspouts: [-4.8, 4.9] });
  // Annex West wall coping & upper pilasters (annex.height = 3.74)
  addParapetRun(-3.99, -40.78, -3.99, -27.82, {
    yBase: H, yTop: annex.height + .15, pilasterStep: 4.2, downspouts: [-4.8, 5.8]
  });

  // Caseta 107 roof & stepped guardhouse parapet (y = 3.08..3.65)
  const g107 = rooms.find(r => r.kind === 'guardhouse');
  const gCX = (g107.x0 + g107.x1) / 2, gCZ = (g107.z0 + g107.z1) / 2;
  const gW = g107.x1 - g107.x0 + WALL_THICK * 2, gL = g107.z1 - g107.z0 + WALL_THICK * 2;
  box(root, plaster, gCX, 3.27, gCZ, gW, .38, gL, 0xb8beb0);
  box(root, solid, gCX, 3.44, gCZ, gW - .32, .06, gL - .32, 0x1b211f);
  box(root, solid, gCX, 3.50, gCZ, gW + .10, .08, gL + .10, 0x46514b);
  box(root, solid, gCX, 3.595, gCZ, gW + .18, .11, gL + .18, 0x6d776e);
  for (const cx of [g107.x0 - WALL_THICK / 2, g107.x1 + WALL_THICK / 2]) {
    for (const cz of [g107.z0 - WALL_THICK / 2, g107.z1 + WALL_THICK / 2]) {
      box(root, solid, cx, 3.36, cz, .28, .56, .28, 0x8a9387);
    }
  }
  const g107Spout = group(root, g107.x1 + WALL_THICK + .04, g107.z0 - WALL_THICK - .04, 0);
  addDownspout(g107Spout, 0, 0, 3.52);

  // Exterior bulkhead cage sconces above courtyard doors (y = 2.52m)
  function bulkheadSconce(x, y, z, angle) {
    const s = group(root, x, z, angle);
    box(s, solid, 0, y, .016, .24, .18, .032, 0x2b3330);
    box(s, solid, 0, y + .08, .055, .25, .028, .09, 0x333c38);
    box(s, solid, 0, y, .042, .20, .14, .036, 0x3b4641);
    box(s, sconceGlassMat, 0, y, .070, .15, .09, .042, 0xffe3a8);
    box(s, luminous, 0, y, .064, .10, .045, .024, 0xfff3cf);
    for (const bx of [-.045, 0, .045]) {
      box(s, solid, bx, y, .093, .012, .11, .012, 0x1e2522);
    }
    box(s, solid, 0, y, .094, .165, .012, .012, 0x1e2522);
  }
  bulkheadSconce(-3.80, 2.52, plaza.hallPortal.z, -Math.PI / 2); // 'plaza'
  bulkheadSconce(-8.60, 2.52, 11.42, Math.PI);                  // '103-plaza'
  bulkheadSconce(-9.00, 2.52, -15.02, 0);                       // '106-plaza'
  bulkheadSconce(-18.22, 2.52, 16.00, Math.PI / 2);             // '107'
  bulkheadSconce(-22.00, 2.52, 12.22, Math.PI);                 // '107-norte'
  bulkheadSconce(-4.08, 2.52, annex.sideExit.z, -Math.PI / 2);  // 'anexo-plaza'
  // Portón overhead iron transom bar + bulkhead sconce at x = -16.00, z = 19.58
  box(root, solid, -16.00, 3.16, 19.66, 3.32, .08, .10, 0x242c29);
  box(root, solid, -16.00, 2.84, 19.60, .36, .66, .04, 0x262f2b);
  bulkheadSconce(-16.00, 2.52, 19.58, Math.PI);                 // 'porton'

  // Perimeter masonry + wrought-iron top fence (height = 3.80m)
  function perimeterFence(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const angle = Math.atan2(-dz, dx);
    const g = group(root, (x0 + x1) / 2, (z0 + z1) / 2, angle);
    // Masonry wall up to 2.66m + stone coping + pillars + wrought-iron top fencing up to 3.80m
    box(g, paint, 0, .55, 0, len, 1.10, .22, 0x6f7a73);
    box(g, plaster, 0, 1.88, 0, len, 1.56, .20, 0x8d9488);
    box(g, solid, 0, 2.71, 0, len + .04, .12, .28, 0x5c665f);
    box(g, solid, 0, 3.68, 0, len, .04, .05, 0x202725);
    box(g, solid, 0, 3.12, 0, len, .035, .04, 0x202725);
    const picketCount = Math.max(2, Math.floor(len / .22));
    for (let i = 1; i < picketCount; i++) {
      const px = -len / 2 + (i / picketCount) * len;
      box(g, solid, px, 3.24, 0, .022, .94, .022, 0x232a28);
      box(g, solid, px, 3.74, 0, .032, .09, .022, 0x2d3532);
    }
    const pillarCount = Math.max(2, Math.round(len / 4.2));
    for (let i = 0; i <= pillarCount; i++) {
      const px = -len / 2 + (i / pillarCount) * len;
      box(g, solid, px, 1.88, 0, .34, 3.76, .34, 0x56605a);
      box(g, solid, px, 3.79, 0, .42, .08, .42, 0x737d75);
    }
  }
  // West perimeter (x = -25.71, z: -33.31..12.40) and North perimeter (z = -33.31, x: -25.71..-3.90)
  perimeterFence(-25.71, -33.31, -25.71, 12.40);
  perimeterFence(-25.71, -33.31, -3.90, -33.31);
  obstacles.push(
    { x0: -25.82, x1: -25.60, z0: -33.42, z1: 12.40 },
    { x0: -25.82, x1: -3.90, z0: -33.42, z1: -33.20 }
  );

  // Portón Exterior (locked iron double gate at southWalkway z = 19.60)
  const gate = plaza.exteriorGate;
  const gHalf = gate.width / 2;
  perimeterFence(-18.40, 19.71, gate.x - gHalf, 19.71);
  perimeterFence(gate.x + gHalf, 19.71, -13.60, 19.71);
  const gateGroup = group(dynamicRoot, gate.x, 19.66, 0);
  for (const s of [-1, 1]) {
    box(gateGroup, solid, s * (gHalf / 2), 1.55, 0, gHalf - .06, .06, .06, 0x222927);
    box(gateGroup, solid, s * (gHalf / 2), .18, 0, gHalf - .06, .07, .06, 0x222927);
    box(gateGroup, solid, s * (gHalf / 2), 2.88, 0, gHalf - .06, .06, .06, 0x222927);
    for (let i = 0; i < 6; i++) {
      const bx = s * (.12 + i * ((gHalf - .24) / 5));
      box(gateGroup, solid, bx, 1.56, 0, .034, 2.90, .034, 0x28312e);
      box(gateGroup, solid, bx, 3.07, 0, .048, .12, .034, 0x3a433f);
    }
  }
  box(gateGroup, solid, 0, 1.24, -.04, .34, .06, .06, 0x4b4a42);
  box(gateGroup, solid, 0, 1.13, -.06, .12, .15, .06, 0x8f4034);
  const gateHandle = group3(gateGroup, 0, 1.15, -.08);
  obstacles.push({ x0: -18.40, x1: -13.60, z0: 19.60, z1: 19.82 });
  doors.push({
    id: 'porton',
    label: 'Portón Exterior',
    locked: true,
    open: 0,
    targetOpen: 0,
    rattle: 0,
    slam: 0,
    bounce: 0,
    pos: { x: gate.x, y: 1.15, z: 19.52 },
    threshold: { x0: -17.60, x1: -14.40, z0: 19.25, z1: 19.85 },
    pivots: [{ group: gateGroup, hand: 1, maxAngle: 0.05 }],
    handles: [gateHandle],
    obstacle: null
  });

  // Rotonda Árbol Central (stepped stone fountain + gnarled dead horror tree)
  const ft = plaza.fountain;
  cylinder(root, solid, ft.x, .10, ft.z, 2.42, 2.48, .20, 0x5f6861, 12);
  cylinder(root, solid, ft.x, .35, ft.z, 2.15, 2.25, .36, 0x6f7870, 12);
  cylinder(root, solid, ft.x, .54, ft.z, 2.26, 2.26, .08, 0x868f85, 12);
  cylinder(root, doorGlass, ft.x, .38, ft.z, 1.96, 1.96, .04, 0x1e3536, 12);
  cylinder(root, solid, ft.x, .48, ft.z, .64, .76, .74, 0x525b55, 8);
  // Twisted gnarled dead horror tree rising ~5.2m from center plinth
  const tree = group(root, ft.x, ft.z, .3);
  const trunk1 = cylinder(tree, barkMat, 0, 1.55, 0, .28, .44, 1.80, 0x8e8379, 7);
  trunk1.rotation.z = .08;
  const trunk2 = cylinder(tree, barkMat, -.09, 2.90, .04, .18, .29, 1.45, 0x82776e, 7);
  trunk2.rotation.z = -.16;
  trunk2.rotation.x = .09;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + .2;
    rod(tree, barkMat, [Math.cos(a) * .25, .86, Math.sin(a) * .25], [Math.cos(a) * .95, .42, Math.sin(a) * .95], .09, 0x766c63);
  }
  const branches = [
    [[-.12, 3.25, .06], [-1.35, 4.45, .55], .08],
    [[-1.35, 4.45, .55], [-2.05, 5.15, .95], .038],
    [[-.04, 3.40, .02], [1.20, 4.35, -.70], .075],
    [[1.20, 4.35, -.70], [1.95, 5.05, -1.05], .036],
    [[-.06, 3.48, .08], [.35, 4.75, 1.15], .068],
    [[.35, 4.75, 1.15], [.65, 5.25, 1.75], .034],
    [[-.14, 3.15, -.05], [-.75, 4.10, -1.25], .065],
    [[-.75, 4.10, -1.25], [-1.15, 4.85, -1.75], .032]
  ];
  for (const [a, b, rad] of branches) rod(tree, barkMat, a, b, rad, 0x7d7269);
  obstacles.push({ x0: -16.55, x1: -12.65, z0: -3.75, z1: 0.15, sightTop: 0.60 });

  // 4 Jardineras (stone curbs + dark soil + low horror bushes; streetlamp posts rise from center)
  for (const pl of plaza.planters) {
    const pcx = (pl.x0 + pl.x1) / 2, pcz = (pl.z0 + pl.z1) / 2;
    const pw = pl.x1 - pl.x0, pd = pl.z1 - pl.z0;
    box(root, solid, pcx, .24, pcz, pw, .48, pd, 0x677068);
    box(root, solid, pcx, .51, pcz, pw + .08, .07, pd + .08, 0x828a80);
    box(root, solid, pcx, .47, pcz, pw - .22, .06, pd - .22, 0x2c241e);
    for (const sx of [-.55, .55]) for (const sz of [-.55, .55]) {
      box(root, foliageMat, pcx + sx, .60, pcz + sz, .62, .26, .62, 0x798773);
      box(root, foliageMat, pcx + sx * .72, .72, pcz + sz * .72, .40, .18, .40, 0x62705e);
    }
    obstacles.push({ x0: pl.x0, x1: pl.x1, z0: pl.z0, z1: pl.z1, sightTop: 0.65 });
  }

  // Pérgola (corner posts, overhead rafters, and central park bench)
  const pg = plaza.pergola;
  const pgW = pg.x1 - pg.x0, pgL = pg.z1 - pg.z0;
  const pgCX = (pg.x0 + pg.x1) / 2, pgCZ = (pg.z0 + pg.z1) / 2;
  for (const px of [pg.x0 + .10, pg.x1 - .10]) for (const pz of [pg.z0 + .10, pg.z1 - .10]) {
    box(root, solid, px, 1.26, pz, .16, 2.52, .16, 0x3b443e);
    obstacles.push({ x0: px - .09, x1: px + .09, z0: pz - .09, z1: pz + .09 });
  }
  for (const px of [pg.x0 + .10, pg.x1 - .10]) {
    box(root, wood, px, 2.60, pgCZ, .14, .18, pgL, 0x7b5c3f);
  }
  const rafterCount = 9;
  for (let i = 0; i < rafterCount; i++) {
    const rz = pg.z0 + .15 + (i / (rafterCount - 1)) * (pgL - .30);
    box(root, wood, pgCX, 2.70, rz, pgW + .12, .12, .08, 0x6e5137);
  }
  obstacles.push({ x0: pg.x0, x1: pg.x1, z0: pg.z0, z1: pg.z1, bottom: 2.50, top: 2.76 });
  // Weathered park bench inside pergola
  const pBench = group(root, pgCX, pgCZ, Math.PI / 2);
  for (const bx of [-.65, .65]) {
    box(pBench, solid, bx, .22, -.16, .06, .42, .06, 0x313934);
    box(pBench, solid, bx, .22, .16, .06, .42, .06, 0x313934);
  }
  box(pBench, wood, 0, .44, 0, 1.80, .06, .52, 0x8e7251);
  box(pBench, wood, 0, .68, -.22, 1.80, .24, .05, 0x856a4b);
  obstacles.push({ x0: pgCX - .28, x1: pgCX + .28, z0: pgCZ - .92, z1: pgCZ + .92, top: .48 });

  // Bicicletero in northPassage (concrete pad + rusted U-loops + leaning dilapidated bike + corrugated metal shelter)
  const br = plaza.bikeRack;
  const brCX = (br.x0 + br.x1) / 2, brCZ = (br.z0 + br.z1) / 2;
  const brW = br.x1 - br.x0, brD = br.z1 - br.z0;
  box(root, solid, brCX, .03, brCZ, brW, .06, brD, 0x646b65);
  // Open-sided corrugated metal bike shelter roof (y = 2.45m) on corner steel posts inside br
  for (const px of [br.x0 + .16, br.x1 - .16]) for (const pz of [br.z0 + .16, br.z1 - .16]) {
    box(root, solid, px, 1.24, pz, .07, 2.38, .07, 0x3b4440);
  }
  for (const pz of [br.z0 + .16, br.z1 - .16]) {
    box(root, solid, brCX, 2.41, pz, brW - .14, .065, .065, 0x4b5650);
  }
  for (let i = 0; i < 4; i++) {
    const rx = br.x0 + .22 + (i / 3) * (brW - .44);
    box(root, solid, rx, 2.43, brCZ, .05, .05, brD + .14, 0x4b5650);
  }
  box(root, solid, brCX, 2.465, brCZ, brW + .28, .035, brD + .28, 0x4d5853);
  for (let i = 0; i < 14; i++) {
    const rz = br.z0 - .06 + (i / 13) * (brD + .12);
    box(root, solid, brCX, 2.49, rz, brW + .28, .022, .08, i % 2 ? 0x5c6761 : 0x68746d);
  }
  // Exterior industrial wall lamp on Lab 106's west wall (x = -14.58, z = -21.2, y = 2.65)
  const lamp106X = -14.58;
  box(root, solid, lamp106X - .02, 2.65, -21.2, .05, .16, .16, 0x2b3330);
  rod(root, solid, [lamp106X, 2.65, -21.2], [lamp106X - .26, 2.75, -21.2], .018, 0x333c38);
  rod(root, solid, [lamp106X - .26, 2.75, -21.2], [lamp106X - .36, 2.62, -21.2], .018, 0x333c38);
  cylinder(root, solid, lamp106X - .36, 2.55, -21.2, .06, .22, .12, 0x35443c, 10);
  cylinder(root, luminous, lamp106X - .36, 2.47, -21.2, .055, .048, .08, 0xffe4a6, 8);
  for (let i = 0; i < 4; i++) {
    const lx = br.x0 + .65 + i * .90;
    box(root, solid, lx, .42, brCZ - .45, .045, .74, .045, 0x56463b);
    box(root, solid, lx, .42, brCZ + .45, .045, .74, .045, 0x56463b);
    box(root, solid, lx, .79, brCZ, .045, .045, .94, 0x56463b);
  }
  const bike = group(root, brCX + .35, brCZ + .15, .35);
  bike.rotation.z = .24;
  for (const wx of [-.52, .52]) {
    cylinder(bike, solid, wx, .34, 0, .32, .32, .04, 0x262927, 10).rotation.x = Math.PI / 2;
  }
  rod(bike, solid, [-.52, .34, 0], [-.06, .34, 0], .02, 0x6d3b30);
  rod(bike, solid, [-.06, .34, 0], [-.18, .72, 0], .02, 0x6d3b30);
  rod(bike, solid, [-.18, .72, 0], [.36, .70, 0], .02, 0x6d3b30);
  rod(bike, solid, [-.06, .34, 0], [.36, .70, 0], .02, 0x6d3b30);
  rod(bike, solid, [.52, .34, 0], [.32, .84, 0], .02, 0x6d3b30);
  box(bike, solid, .32, .85, 0, .05, .03, .38, 0x3b403c);
  box(bike, solid, -.20, .76, 0, .18, .05, .10, 0x2e2a26);
  obstacles.push({ x0: br.x0, x1: br.x1, z0: br.z0, z1: br.z1, sightTop: 0.92 });
}
