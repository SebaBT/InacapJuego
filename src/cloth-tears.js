import { BufferGeometry, Float32BufferAttribute, Mesh, Vector3 } from 'three';
import { ease } from './emergence.js';

// Each row describes a cross-section of a rip in panel space: x, y and
// relative half-width. The rip travels from the first row toward the last.
const cheekSeams = [
  { start: .035, width: .064, rows: [
    [-.182,.878,.04],[-.258,.885,.89],[-.321,.850,.67],[-.390,.936,1],[-.468,.912,.53],[-.557,1.012,0]
  ] },
  { start: .16, width: .074, rows: [
    [.188,.823,.03],[.267,.833,.91],[.330,.783,.78],[.398,.836,1],[.453,.812,.55],[.545,.927,0]
  ] },
  { start: .52, width: .043, rows: [
    [-.128,1.319,0],[-.062,1.349,.72],[.014,1.311,1],[.067,1.340,.56],[.153,1.308,.78],[.240,1.354,0]
  ] }
];

function wingSeams(side, hind) {
  const late = side < 0 ? 0 : .11;
  const seams = hind ? [
    { start: .39 + late, width: .142, rows: [
      [.66,-.97,1],[.594,-.936,.90],[.53,-.961,.74],[.459,-.851,.94],[.388,-.878,.48],[.267,-.708,0]
    ] }
  ] : [
    { start: .04 + late, width: .149, rows: [
      [.815,-.755,1.18],[.76,-.735,1],[.683,-.745,.61],[.62,-.641,.96],[.536,-.659,.52],[.407,-.502,0]
    ] },
    { start: .32 + late, width: .098, rows: [
      [.747,-.974,1.1],[.687,-.890,.92],[.614,-.902,.66],[.561,-.824,1],[.507,-.822,.45],[.397,-.706,0]
    ] },
    { start: .52 + late, width: .090, rows: [
      [.797,-.52,1.08],[.721,-.531,.82],[.654,-.464,.91],[.594,-.485,.76],[.533,-.404,.54],[.379,-.376,0]
    ] }
  ];
  for (const { rows } of seams) for (const row of rows) {
    row[0] *= side;
    if (side > 0) row[1] += hind ? .044 : .081 * (1 - Math.abs(row[0]) / .82);
  }
  return seams;
}

// Small irregularities between the main folds keep the two torn edges
// matched when shut and give individual fibres purchase when they open.
function raggedRows(seam, index) {
  const rows = [];
  seam.rows.forEach((b, i) => {
    if (i) {
      const a = seam.rows[i - 1], grain = Math.sin(i * 7.19 + index * 4.3);
      const u = .50 + .16 * grain;
      rows.push([a[0] + (b[0]-a[0])*u, a[1] + (b[1]-a[1])*u + grain*seam.width*.19,
        (a[2] + (b[2]-a[2])*u) * (.87 + .20*grain)]);
    }
    rows.push(b);
  });
  return { ...seam, rows };
}

// A recessed lining and two turned-out lips share the same opening as the
// fragment cut. Looking along the hood reveals the thickness of the felt.
function hoodLining(parent, material, z, seams) {
  // Offset across the cut, height relative to its half-width, cloth colour.
  const layers = [
    [-1.36,.03,0x987e65],[-1.07,.85,0xc8a67e],[-.95,.68,0xeccea0],[-.81,-.12,0x65505a],
    [-.38,-.54,0x322631],[.06,-.38,0x54404a],[.53,-.53,0x302530],
    [.91,.05,0x756271],[1,.40,0xd3b592],[1.31,.025,0x92775e]
  ];
  const positions = [], colors = [], uvs = [], indices = [];
  for (const { rows } of seams) {
    const ascending = rows[1][0] > rows[0][0];
    for (let j = 0; j < rows.length; j++) for (let b = 0; b < layers.length; b++) {
      const k = positions.length / 3, tint = layers[b][2];
      positions.push(0, 0, 0);
      const light = .89 + .11 * Math.cos(j*2.31 + b*.57);
      colors.push((tint >> 16) / 255 * light, ((tint >> 8) & 255) / 255 * light, (tint & 255) / 255 * light);
      uvs.push(j / 3, b / 3);
      if (j + 1 === rows.length || b + 1 === layers.length) continue;
      const next = k + layers.length;
      if (ascending) indices.push(k,next,k+1, k+1,next,next+1);
      else indices.push(k,k+1,next, k+1,next+1,next);
    }
  }
  // Each cross-stitch consists of two ribbons whose tips meet until it snaps.
  const ties = [];
  for (const [s, seam] of seams.entries()) {
    for (let j = 1; j < seam.rows.length - 1; j++) {
      const fraction = .42 + .28*Math.sin(j*5.45 + s);
      ties.push({ row: s*seam.rows.length+j, fraction, snap: .32+.048*j+.14*s, bias: .004*Math.cos(j+s) });
      for (const side of [-1,1]) {
        const k = positions.length / 3;
        for (let i=0; i<6; i++) {
          positions.push(0,0,0); uvs.push(i%2, Math.floor(i/2)*.5);
          const shade = i%2 ? .75 : .98;
          colors.push(shade, shade*.83, shade*.65);
        }
        for (const n of [k,k+2]) {
          if (side < 0) indices.push(n,n+1,n+2, n+2,n+1,n+3);
          else indices.push(n,n+2,n+1, n+2,n+3,n+1);
        }
      }
    }
  }
  const geometry = new BufferGeometry(), position = new Float32BufferAttribute(positions, 3);
  geometry.setAttribute('position', position);
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'Forro bajo las costuras de la capucha';
  mesh.frustumCulled = false;
  parent.add(mesh);
  return (edges, wear, push) => {
    mesh.visible = wear > seams[0].start;
    if (!mesh.visible) return;
    let k = 0;
    for (const [i, row] of edges.entries()) {
      const lift = 1 + .27 * Math.sin(i * 4.7) + push * (.65 + .35 * Math.cos(i * 2.1));
      const bulge = Math.max(0, Math.cos(i*1.81)) ** 3 * push;
      for (const [offset, depth] of layers) {
        const underCloth = Math.max(0, 1 - Math.abs(offset)*1.8);
        position.setXYZ(k++, row.x, row.y + row.z * offset, z + .0016 + row.z * (depth*lift + 1.4*bulge*underCloth));
      }
    }
    for (const { row, fraction, snap, bias } of ties) {
      const a=edges[row], b=edges[row+1];
      const x=a.x+(b.x-a.x)*fraction, y=a.y+(b.y-a.y)*fraction, gap=a.z+(b.z-a.z)*fraction;
      const broken=ease(snap, snap+.055, wear), thickness=.0021*ease(.001,.012,gap);
      for (const side of [-1,1]) for (const along of [0,.58,1]) {
        const rootY = side * gap * 1.08, endY = side * gap * (.49 + Math.abs(bias)*35) * broken;
        const cx = x + side*bias*(1-along) + along*broken*(bias+side*.004);
        const cy = y + rootY + (endY-rootY)*along;
        const height = (side<0?.93:.56)*(1-along) + .88*along + .27*Math.sin(Math.PI*along) + broken*.37*along;
        const cz = z + .0035 + gap*height*(1+.52*push);
        const half = thickness * (1 - .55*along*broken);
        position.setXYZ(k++, cx-half, cy, cz);
        position.setXYZ(k++, cx+half, cy, cz);
      }
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  };
}

function panelTears(material, seams, lining) {
  const rows = seams.flatMap(seam => seam.rows.map(([x,y]) => new Vector3(x,y,0)));
  material.defines.CLOTH_TEARS = seams.length;
  material.defines.TEAR_ROWS = seams[0].rows.length;
  material.uniforms.tearRows = { value: rows };
  material.uniforms.showTears = { value: 0 };
  material.needsUpdate = true;
  let lastWear = -1, lastPush = -1;
  return (wear, push = 0) => {
    if (wear !== lastWear) {
      let k = 0;
      material.uniforms.showTears.value = Number(wear > seams[0].start);
      for (const seam of seams) {
        const progress = Math.max(0, (wear - seam.start) / (1 - seam.start));
        for (const [i, row] of seam.rows.entries()) {
          const onset = .61 * i / (seam.rows.length - 1);
          const open = ease(onset, onset + .39, progress);
          rows[k++].z = seam.width * row[2] * open * (.64 + .36 * progress);
        }
      }
    }
    if (lining && (wear !== lastWear || push !== lastPush)) lining(rows, wear, push);
    lastWear = wear; lastPush = push;
  };
}

export function hoodTears(parent, front, felt, z) {
  const seams = cheekSeams.map(raggedRows);
  return panelTears(front, seams, hoodLining(parent, felt, z, seams));
}

export function abdomenTears(material) {
  // This seam runs down through the horizontal velvet rings. Read its rows
  // from collar to hem in (height, lateral offset) coordinates.
  material.defines.VERTICAL_TEAR = 1;
  return panelTears(material, [raggedRows({ start: .025, width: .302, rows: [
    [.521,-.047,.62],[.415,-.042,1.08],[.327,.014,.87],[.254,-.032,1.04],
    [.168,.029,.95],[.091,-.015,.85],[-.026,.065,.59]
  ] }, 2)]);
}

export function backTears(material) {
  material.defines.VERTICAL_TEAR = 1;
  return panelTears(material, [raggedRows({ start: .12, width: .256, rows: [
    [1.39,-.012,0],[1.27,-.053,.86],[1.09,.035,1.1],[.971,-.049,.98],
    [.801,.018,.83],[.668,-.033,.87],[.497,.047,.61],[.387,.012,.19]
  ] }, 1)]);
}

export function wingTears(material, side, hind) {
  return panelTears(material, wingSeams(side, hind).map(raggedRows));
}
