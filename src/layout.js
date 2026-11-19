// Escenario mejorado para terror arcade (partidas de 2 a 3 min)
// Mantiene convenciones en metros y agrega Mini Plaza Exterior + bucles de escape.

export const hall = { halfWidth: 3.60, near: 24.00, far: -28.00, height: 3.08 };
export const playerSpawn = Object.freeze({ x: 0, z: 21.60, yaw: Math.PI });
export const monsterSpawn = Object.freeze({ x: 0, z: -1.80, yaw: 0 });

export const classroomDoorWidth = 1.18;
export const internalDoorWidth = 1.18;
export const annexDoorWidth = 2.10;
export const plazaDoorWidth = 2.40;
export const wallThickness = .18;
export const switchOffset = classroomDoorWidth / 2 + .32;

// Salas mejoradas:
// - Este: pares interconectados (101<->102 y 104<->105) para romper persecuciones.
// - Oeste: 103 y 106 abren directo hacia la Mini Plaza Exterior.
// - Exterior: Caseta 107 con doble puerta de paso rápido.
export const rooms = [
  { id: '101', subject: 'DOCENCIA', kind: 'classroom', side: 1, hand: 1, doorZ: 17.2, depth: 9.6, length: 10.4,
    light: { power: 1.05, warmth: .68, defaultOn: true, faultiness: .20 },
    extraDoors: [{ wall: 'north', x: 10.2, z: 12.0, width: internalDoorWidth, to: '102' }] },
  { id: '102', subject: 'AULA EN DESUSO', kind: 'abandoned', side: 1, hand: -1, doorZ: 6.8, depth: 9.6, length: 10.4,
    light: { power: .86, warmth: .25, defaultOn: false, faultiness: .88 },
    extraDoors: [{ wall: 'south', x: 10.2, z: 12.0, width: internalDoorWidth, to: '101' }] },
  { id: '103', subject: 'DIBUJO TÉCNICO', kind: 'drafting', side: -1, hand: 1, doorZ: 17.0, depth: 10.0, length: 10.8,
    light: { power: .82, warmth: .22, defaultOn: false, faultiness: .65 },
    extraDoors: [{ wall: 'north', x: -8.6, z: 11.6, width: 1.30, to: 'plaza' }] },
  { id: '104', subject: 'INFORMÁTICA', kind: 'computerLab', side: 1, hand: 1, doorZ: -9.0, depth: 10.8, length: 11.6,
    light: { power: .62, warmth: .08, defaultOn: true, faultiness: .92 },
    extraDoors: [{ wall: 'north', x: 11.4, z: -14.8, width: internalDoorWidth, to: '105' }] },
  { id: '105', subject: 'BODEGA / GENERADOR', kind: 'storage', side: 1, hand: -1, doorZ: -20.8, depth: 10.4, length: 12.0,
    light: { power: .72, warmth: .35, defaultOn: false, faultiness: .78 },
    extraDoors: [{ wall: 'south', x: 11.4, z: -14.8, width: internalDoorWidth, to: '104' }] },
  { id: '106', subject: 'ELECTROTECNIA', kind: 'elecLab', side: -1, hand: -1, doorZ: -21.2, depth: 10.8, length: 12.0,
    light: { power: .68, warmth: .20, defaultOn: false, faultiness: .95 },
    extraDoors: [{ wall: 'south', x: -9.0, z: -15.2, width: 1.30, to: 'plaza' }] },
  { id: '107', subject: 'CASETA DE GUARDIA', kind: 'guardhouse', side: 0, hand: 1,
    x0: -25.6, x1: -18.4, z0: 12.4, z1: 19.6, doorZ: 16.0, depth: 7.2, length: 7.2,
    light: { power: .92, warmth: .78, defaultOn: true, faultiness: .45 },
    extraDoors: [
      { wall: 'north', x: -22.0, z: 12.4, width: 1.24, to: 'plaza' },
      { wall: 'east', x: -18.4, z: 16.0, width: 1.24, to: 'plaza' }
    ] }
].map(r => {
  const lab = r.kind === 'computerLab' || r.kind === 'elecLab';
  const hasExplicitBounds = typeof r.x0 === 'number';
  const inner = r.side * hall.halfWidth;
  const outer = inner + r.side * r.depth;
  return {
    ...r,
    lab,
    label: r.kind === 'guardhouse' ? `Caseta ${r.id}` : `${lab ? 'Lab.' : 'Sala'} ${r.id}`,
    lightId: r.id,
    x0: hasExplicitBounds ? r.x0 : Math.min(inner, outer),
    x1: hasExplicitBounds ? r.x1 : Math.max(inner, outer),
    z0: hasExplicitBounds ? r.z0 : r.doorZ - r.length / 2,
    z1: hasExplicitBounds ? r.z1 : r.doorZ + r.length / 2
  };
});

// Mini Plaza Exterior ("Patio Central") con cielo abierto, rotonda central y pasaje al Anexo
export const plaza = {
  id: 'plaza', label: 'Mini Plaza Exterior',
  main: { x0: -25.60, x1: -3.60, z0: -15.20, z1: 11.60 },
  northPassage: { x0: -25.60, x1: -14.40, z0: -33.20, z1: -15.20 },
  annexAlley: { x0: -14.40, x1: -3.90, z0: -33.20, z1: -27.20 },
  southWalkway: { x0: -18.40, x1: -13.60, z0: 11.60, z1: 19.60 },
  hallPortal: { x: -3.60, z: -1.80, width: plazaDoorWidth },
  exteriorGate: { x: -16.00, z: 19.60, width: 3.20, locked: true },
  fountain: { x: -14.60, z: -1.80, radius: 2.35, lowObstacle: true },
  planters: [
    { x0: -10.8, x1: -8.6, z0: 3.6, z1: 5.8 },
    { x0: -20.6, x1: -18.4, z0: 3.6, z1: 5.8 },
    { x0: -10.8, x1: -8.6, z0: -9.4, z1: -7.2 },
    { x0: -20.6, x1: -18.4, z0: -9.4, z1: -7.2 }
  ],
  pergola: { x0: -25.1, x1: -23.1, z0: -5.2, z1: 1.6 },
  bikeRack: { x0: -22.2, x1: -18.2, z0: -24.2, z1: -21.2 }
};

const gate = plaza.exteriorGate;
export const gateFixtures = {
  masterKey: { x: gate.x - gate.width / 2 - .18, y: 1.32, z: gate.z - .17, label: 'Cerradura' },
  boltCutters: { x: gate.x, y: 1.25, z: gate.z - .08, label: 'Cadena' },
  fuse: { x: gate.x + gate.width / 2 + .18, y: 1.38, z: gate.z - .17, label: 'Caja de fusibles' }
};

// Anexo mantiene las escaleras y agrega puerta lateral hacia el Pasaje Norte
export const annex = {
  id: 'anexo', label: 'Anexo y Escaleras', height: 3.74,
  x0: -3.90, x1: 3.90, z0: hall.far - 12.60, z1: hall.far,
  sideExit: { x: -3.90, z: -30.60, width: 1.44 }
};

export const stairs = {
  x0: annex.x0 + .04, x1: -1.62, startZ: annex.z1 - 7.00, count: 7, rise: .18, run: .48
};
export const landing = {
  x0: stairs.x0, x1: 1.05, z0: annex.z0, z1: stairs.startZ - stairs.count * stairs.run,
  top: stairs.count * stairs.rise, doorX: -1.25
};

export const roomAisleWidth = 2.2;
export const returnAisleWidth = 1.6;
export const hallClearHalfWidth = hall.halfWidth - 1.05;

// Respeta pasillos en cruz y despeja automáticamente el acceso frente a puertas extra
export function furnishingBays(r) {
  if (r.kind === 'guardhouse') {
    return [{ x0: r.x0 + .35, x1: r.x0 + 2.8, z0: r.z1 - 2.6, z1: r.z1 - .35 }];
  }
  const halfAisle = roomAisleWidth / 2;
  const midX = (r.x0 + r.x1) / 2;
  const bays = [
    { x0: r.x0 + wallThickness, x1: midX - halfAisle, z0: r.z0 + wallThickness, z1: r.doorZ - halfAisle },
    { x0: midX + halfAisle, x1: r.x1 - wallThickness, z0: r.z0 + wallThickness, z1: r.doorZ - halfAisle },
    { x0: r.x0 + wallThickness, x1: midX - halfAisle, z0: r.doorZ + halfAisle, z1: r.z1 - wallThickness },
    { x0: midX + halfAisle, x1: r.x1 - wallThickness, z0: r.doorZ + halfAisle, z1: r.z1 - wallThickness }
  ];
  return bays.map(b => {
    let { x0, x1, z0, z1 } = b;
    for (const d of (r.extraDoors || [])) {
      if (d.wall === 'north' && d.x > x0 - .8 && d.x < x1 + .8) z0 = Math.max(z0, r.z0 + 1.65);
      if (d.wall === 'south' && d.x > x0 - .8 && d.x < x1 + .8) z1 = Math.min(z1, r.z1 - 1.65);
    }
    return { x0, x1, z0, z1 };
  }).filter(b => (b.x1 - b.x0) > 1.1 && (b.z1 - b.z0) > 1.1);
}

// Ventanales panorámicos hacia la Mini Plaza + Ventana Este
export const hallWindows = [
  { side: -1, z: 5.20, w: 6.20, variant: 0, blinds: false },
  { side: -1, z: -8.80, w: 6.20, variant: 1, blinds: false },
  { side: 1, z: -0.80, w: 3.40, variant: 0, blinds: true }
];

export const lightX = -.13;
export const pairedFixtureOffset = .86;
export const lights = [
  { power: 1.05, warmth: .44 }, { power: .92, warmth: .12 }, { power: .34, warmth: .58 },
  { power: .98, warmth: .60 }, { power: .76, warmth: .18 }, { power: .85, warmth: .40 }
].map((l, i, arr) => ({ ...l, z: hall.near - (i + .5) * (hall.near - hall.far) / arr.length }));

export const plazaLights = [
  { id: 'farolSE', x: -9.7, z: 4.7, power: 1.08, warmth: .88, defaultOn: true, faultiness: .10 },
  { id: 'farolSO', x: -19.5, z: 4.7, power: 1.02, warmth: .85, defaultOn: true, faultiness: .15 },
  { id: 'farolNE', x: -9.7, z: -8.3, power: 0.96, warmth: .88, defaultOn: true, faultiness: .18 },
  { id: 'farolNO', x: -19.5, z: -8.3, power: 0.78, warmth: .80, defaultOn: true, faultiness: .28 },
  { id: 'farolNorte', x: -16.4, z: -30.6, power: 0.92, warmth: .82, defaultOn: true, faultiness: .20 }
];

export const extraLights = [
  ...rooms.map(r => ({ id: r.lightId, x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, ...r.light })),
  { id: 'anexo1', x: 0, z: annex.z1 - 4.40, power: .88, warmth: .45, defaultOn: true, faultiness: .72 },
  { id: 'anexo2', x: -1.8, z: annex.z1 - 9.80, power: .46, warmth: .68, defaultOn: true, faultiness: .95 },
  ...plazaLights
];

export const worldBounds = {
  minX: plaza.main.x0,
  maxX: Math.max(annex.x1, ...rooms.map(r => r.x1)),
  minZ: annex.z0,
  maxZ: hall.near
};

export const litClassroomZ = rooms[0].doorZ;
export const benchZ = 10.0;
