import {
  BufferGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute,
  Group, Mesh, SphereGeometry, Vector2, Vector3
} from 'three';
import { add, ellipsoid, hose } from './model-parts.js';

const TAU = 2 * Math.PI;
const segments = 64;
const lerp = (a, b, t) => a + (b - a) * t;
export function ease(a, b, t) {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
}

function rod(parent, name, material, color, top, bottom, sides = 10) {
  return add(parent, name, new CylinderGeometry(top, bottom, 1, sides), material, color);
}
const up = new Vector3(0, 1, 0);
function connect(mesh, a, b) {
  const delta = new Vector3().subVectors(b, a);
  const length = delta.length();
  mesh.position.copy(a).lerp(b, .5);
  mesh.scale.y = length;
  if (length > .00001) mesh.quaternion.setFromUnitVectors(up, delta.divideScalar(length));
}

function gleam(mesh, r, g, b) {
  const c = mesh.geometry.attributes.color;
  for (let i = 0; i < c.count; i++) c.setXYZ(i, r, g, b);
}

function sculptedPart(target, name, mat, tint, at, radii, wSeg, hSeg, sculpt) {
  const g = new SphereGeometry(1, wSeg, hSeg);
  const p = g.attributes.position, n = g.attributes.normal;
  const count = p.count, colors = new Float32Array(count * 3);
  const rgb = [((tint >> 16) & 255) / 255, ((tint >> 8) & 255) / 255, (tint & 255) / 255];
  const v = new Vector3();
  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(p, i);
    const tone = sculpt(v);
    p.setXYZ(i, v.x * radii[0], v.y * radii[1], v.z * radii[2]);
    colors[i * 3] = rgb[0] * tone;
    colors[i * 3 + 1] = rgb[1] * tone;
    colors[i * 3 + 2] = rgb[2] * tone;
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  for (let i = 0; i < count; i++) {
    const shade = .86 + .12 * n.getY(i) - .10 * n.getX(i) + .08 * n.getZ(i);
    colors[i * 3] *= shade;
    colors[i * 3 + 1] *= shade;
    colors[i * 3 + 2] *= shade;
  }
  g.attributes.color.needsUpdate = true;
  const mesh = new Mesh(g, mat);
  mesh.name = name;
  mesh.position.set(...at);
  target.add(mesh);
  return mesh;
}

function shadedHose(parent, name, material, stations, ringColors, sides = 10) {
  const mesh = hose(parent, name, material, ringColors[0], stations, sides);
  const color = mesh.geometry.attributes.color;
  const ringCount = stations.length;
  for (let i = 0; i < ringCount; i++) {
    const tint = ringColors[Math.min(i, ringColors.length - 1)];
    const r = ((tint >> 16) & 255) / 255, g = ((tint >> 8) & 255) / 255, b = (tint & 255) / 255;
    for (let j = 0; j < sides; j++) color.setXYZ(i * sides + j, r, g, b);
  }
  // End caps match first and last station colors.
  const cap0 = ringCount * sides;
  const last = ringColors[ringColors.length - 1];
  const r0 = ((ringColors[0] >> 16) & 255) / 255, g0 = ((ringColors[0] >> 8) & 255) / 255, b0 = (ringColors[0] & 255) / 255;
  const r1 = ((last >> 16) & 255) / 255, g1 = ((last >> 8) & 255) / 255, b1 = (last & 255) / 255;
  for (let k = cap0; k < cap0 + sides + 1; k++) color.setXYZ(k, r0, g0, b0);
  for (let k = cap0 + sides + 1; k < color.count; k++) color.setXYZ(k, r1, g1, b1);
  color.needsUpdate = true;
  return mesh;
}

// The head is set back inside the cavity. The two hands find the lip before
// the neck extends, so the creature appears to pull its own weight through.
function innerCreature(parent, mat) {
  mat.defines.INNER_CREATURE = 1;
  mat.uniforms.lightThroughSeam = { value: .18 };
  const parts = new Group(), head = new Group();
  parts.name = 'Habitante del traje'; parts.add(head); parent.add(parts);
  function lobe(target, name, x, y, z, rx, ry, rz, tint, tilt = 0, wSeg = 20, hSeg = 14) {
    const part = ellipsoid(target, name, mat, tint, [0,0,0], [rx,ry,rz], wSeg, hSeg);
    // Painted values on the planes of the skull survive the dim hallway light.
    const normals=part.geometry.attributes.normal, colors=part.geometry.attributes.color;
    for (let i=0;i<colors.count;i++) {
      const shade=.83+.15*normals.getY(i)-.12*normals.getX(i)+.06*normals.getZ(i);
      colors.setXYZ(i,colors.getX(i)*shade,colors.getY(i)*shade,colors.getZ(i)*shade);
    }
    part.position.set(x,y,z); part.rotation.z = tilt;
    return part;
  }

  // Unified high-definition sculpted cranium: brow ridges, deep eye sockets,
  // skeletal nose bridge & nasal cavity, sharp cheekbones, and gaunt hollows
  // are carved directly into one seamless mesh rather than stacked blobs.
  sculptedPart(head, 'Nuca', mat, 0x2c2633, [0, .022, -.044], [.095, .148, .086], 28, 20, v => {
    const sideHollow = Math.exp(-(((Math.abs(v.x) - .82) / .22) ** 2 + ((v.y - .10) / .35) ** 2));
    const ridge = Math.exp(-((v.x / .16) ** 2)) * Math.max(0, -v.z);
    v.x -= Math.sign(v.x) * .12 * sideHollow;
    v.z -= .08 * ridge;
    return 1 - .25 * sideHollow;
  });
  sculptedPart(head, 'Máscara de ceniza', mat, 0xa2968a, [0, .036, .006], [.093, .114, .076], 48, 36, v => {
    const x = v.x, y = v.y, z = v.z, front = Math.max(0, z);
    // Narrow gaunt skull silhouette at temples and lower jaw.
    const temple = Math.max(0, y - .12) * Math.max(0, Math.abs(x) - .42);
    v.x *= 1 - .18 * temple + .05 * Math.max(0, y - .48);
    // Sharp furrowed supraorbital brow ridge slanting down toward the glabella.
    const browY = .21 + .11 * Math.abs(x);
    const brow = Math.exp(-(((y - browY) / .095) ** 2)) * Math.exp(-(((Math.abs(x) - .39) / .34) ** 2)) * front;
    v.z += .19 * brow; v.y += .015 * brow;
    const frown = Math.exp(-(((x - .04) / .065) ** 2)) * Math.exp(-(((y - .26) / .20) ** 2)) * front;
    const frown2 = Math.exp(-(((x + .09) / .055) ** 2)) * Math.exp(-(((y - .30) / .18) ** 2)) * front;
    v.z -= .11 * (frown + .8 * frown2);
    // Deep, crisp orbital eye sockets carved directly into bone.
    const dL = Math.hypot((x - .42) / .23, (y - .02) / .175);
    const dR = Math.hypot((x + .42) / .23, (y + .005) / .175);
    const socket = Math.max(Math.exp(-dL * dL * 1.45), Math.exp(-dR * dR * 1.45)) * front;
    v.z -= .48 * socket;
    // Narrow skeletal nasal bridge terminating in a carved piriform nasal cavity.
    const bridge = Math.exp(-(((x / .085) ** 2) + ((y - .06) / .15) ** 2)) * front;
    v.z += .14 * bridge;
    const noseWidth = .115 + .055 * Math.max(0, -.04 - y);
    const nasalHole = Math.exp(-(((x / noseWidth) ** 2) + ((y + .16) / .125) ** 2)) * front;
    v.z -= .38 * nasalHole;
    // High, angular zygomatic cheekbones dropping into gaunt sub-malar hollows.
    const cheek = Math.exp(-(((Math.abs(x) - .67) / .19) ** 2 + ((y + .15) / .115) ** 2)) * Math.max(0, z + .25);
    v.x += Math.sign(x) * .15 * cheek; v.z += .15 * cheek;
    const hollow = Math.exp(-(((Math.abs(x) - .53) / .22) ** 2 + ((y + .38) / .16) ** 2)) * Math.max(0, z + .15);
    v.x -= Math.sign(x) * .25 * hollow; v.z -= .24 * hollow;
    // Upper maxilla & fluted alveolar tooth-root ridge.
    const maxilla = Math.exp(-(((x / .42) ** 2) + ((y + .56) / .15) ** 2)) * front;
    const flutes = .026 * Math.cos(x * 34) * Math.exp(-(((y + .60) / .085) ** 2));
    v.z += .11 * maxilla + flutes * front;
    if (y < -.64) v.z -= (-y - .64) * .50;
    // Fine cranial cracks across forehead and temples.
    const crack = Math.exp(-(((x - .06 * Math.sin(y * 12)) / .035) ** 2)) * Math.max(0, y - .30) * front;
    v.z -= .06 * crack;
    return Math.max(.16, 1 - .74 * socket - .72 * nasalHole - .34 * hollow - .30 * frown - .28 * crack + .14 * brow + .12 * cheek);
  });

  // Recessed nasal septum blade and deep dark throat cavity.
  lobe(head,'Tabique',0,.016,.056,.0025,.017,.010,0x493f46,0,10,8);
  lobe(head,'Boca interior',0,-.068,.024,.050,.080,.046,0x0c0911,0,22,16);

  for (const s of [-1,1]) {
    // Deep-set eye inside the carved orbital cavity (recessed behind the brow/cheek rim).
    lobe(head,'Cuenca',s*.040,.037,.048,.025,.020,.012,0x100c15,s*.22,20,14);
    lobe(head,'Globo hundido',s*.040,.037,.054,.0155,.0145,.0105,0x554944,0,22,16);
    lobe(head,'Iris hundido',s*(.040+.002),.036+(s<0?.0015:-.001),.0605,.0095,.009,.0055,0x22181f,0,20,14);
    const pupil = lobe(head,'Ascua',s*(.040+.0025),.036+(s<0?.002:-.001),.0635,.0045,.0045,.0035,0xffb070,0,16,12);
    gleam(pupil, 2.2, 1.32, .62);
    // Thin desiccated eyelids hugging the eyeball inside the socket.
    shadedHose(head,'Párpado superior',mat,[
      [s*.022,.034,.056,.0024],[s*.040,.049,.059,.0030],[s*.058,.038,.050,.0022]
    ],[0x463b40,0x675b5c,0x463b40],8);
    shadedHose(head,'Párpado inferior',mat,[
      [s*.023,.031,.056,.0020],[s*.040,.024,.059,.0026],[s*.057,.032,.051,.0020]
    ],[0x3c3238,0x564b4e,0x3c3238],8);
    // Secondary larval ocelli clustered asymmetrically at the temples.
    for (const [k,[ox,oy,oz,or]] of [
      [.064,.062,.040,.0042], [.073,.046,.030,.0034], [.056,.076,.035,.0030]
    ].entries()) {
      if (s > 0 && k === 2) continue;
      lobe(head,'Cuenca secundaria',s*ox,oy,oz,or*1.45,or*1.35,or*.9,0x17131d,0,14,10);
      const ocellus = lobe(head,'Ocelo',s*ox,oy,oz+or*.45,or,or,or*.75,0xffb77c,0,14,10);
      gleam(ocellus, 1.45, .86, .42);
    }
    // Swept-back chitinous horns emerging smoothly from the temples.
    shadedHose(head,'Cuerno larvario',mat,[
      [s*.052,.106,.004,.014],[s*.078,.148,-.032,.010],[s*.086,.176,-.074,.0055],[s*.070,.160,-.106,.0015]
    ],[0x3a323b,0x4d434a,0x625658,0x7d6e68],10);
  }

  // Sculpted, hinged lower jawbone with angular gonial corners and sharp cleft chin.
  const jawGroup = new Group();
  jawGroup.name = 'Mandíbula articulada';
  jawGroup.position.set(0, -.036, -.012);
  head.add(jawGroup);
  sculptedPart(jawGroup, 'Mandíbula caída', mat, 0x7a6f6c, [0, -.054, .034], [.060, .080, .052], 30, 20, v => {
    const x = v.x, y = v.y, front = Math.max(0, v.z);
    v.x *= .82 - .28 * Math.max(0, -y);
    const gonial = Math.exp(-(((Math.abs(x) - .74) / .22) ** 2 + ((y - .14) / .22) ** 2));
    v.x += Math.sign(x) * .16 * gonial;
    if (y > -.15 && v.z > -.2) v.y -= .32 * Math.exp(-(((x / .52) ** 2)));
    const chin = Math.max(0, -y - .50) * front;
    v.z += .18 * chin - .08 * Math.exp(-(((x / .09) ** 2))) * chin;
    const flutes = .022 * Math.cos(x * 30) * Math.exp(-(((y + .35) / .12) ** 2)) * front;
    v.z += flutes;
    return Math.max(.22, 1 - .32 * Math.max(0, -v.z) - .20 * gonial);
  });
  lobe(jawGroup,'Cavidad inferior',0,-.042,.044,.038,.054,.030,0x100c16,0,20,14);
  for (const s of [-1,1]) {
    // Labial palps twitching inside the corners of the mouth.
    shadedHose(jawGroup,'Palpo',mat,[
      [s*.042,-.018,.042,.0065],[s*.036,-.036,.066,.0055],[s*.022,-.024,.080,.0035],[s*.015,-.009,.076,.0012]
    ],[0x463941,0x584950,0x6e5c60,0x8a7772],8);
  }

  // Curved, staggered needle-fangs rooted along the sculpted maxilla & mandible curves.
  for (let i = -4; i <= 4; i++) {
    const u = i / 4.2, x = u * .044 + Math.sin(i * 3.1) * .0015;
    const archZ = .066 - .016 * u * u;
    const fang = Math.abs(i) === 2;
    const upperLen = fang ? .028 : .015 + (4 - Math.abs(i)) * .002;
    shadedHose(head, 'Diente superior', mat, [
      [x, -.032, archZ, .0048],
      [x + Math.sin(i * 2) * .0015, -.032 - upperLen * .55, archZ + .0015, .0032],
      [x + Math.sin(i * 2) * .002, -.032 - upperLen, archZ - .0035, .0006]
    ], [0x6e6058, fang ? 0xd9cbb0 : 0xc2b5a2, 0xf2e7d2], 8);
  }
  for (let i = -3; i <= 3; i++) {
    const u = i / 3.4, x = u * .038 + Math.cos(i * 2.7) * .0015;
    const archZ = .061 - .013 * u * u;
    const lowerLen = Math.abs(i) === 1 ? .023 : .014 + (i % 2 ? .003 : 0);
    shadedHose(jawGroup, 'Diente inferior', mat, [
      [x, -.088 + .003 * Math.abs(i), archZ, .0044],
      [x - Math.cos(i * 2.3) * .002, -.088 + lowerLen * .55 + .003 * Math.abs(i), archZ + .002, .0028],
      [x - Math.cos(i * 2.3) * .003, -.088 + lowerLen + .003 * Math.abs(i), archZ - .003, .0006]
    ], [0x5e524c, 0xb7aa98, 0xe8dcc6], 8);
  }
  for (const [x,y,z,len] of [[-.020,-.040,.048,.015],[.018,-.042,.046,.014],[-.012,-.082,.044,.013],[.014,-.083,.045,.013]]) {
    const inner = rod(head, 'Diente faríngeo', mat, 0x9b8e80, .0036, .0008, 8);
    connect(inner, new Vector3(x * .8, y - len, z + .005), new Vector3(x, y, z));
  }

  // Glistening sinew strands bridging the opening mouth.
  const mouthStrands = [-.032, .004, .034].map(sx => ({
    sx,
    mesh: rod(head, 'Hebra de la boca', mat, 0x9c8e82, .0011, .0015, 6)
  }));

  // Outer chitinous mandibles crafted as continuous curved hoses.
  const mandibles=[-1,1].map(s=>{
    const jaw=new Group(); head.add(jaw);
    jaw.position.set(s*.065,-.038,.020);
    shadedHose(jaw,'Mandíbula de la larva',mat,[
      [0,0,0,.021],[s*.032,-.018,.024,.017],[s*.052,-.042,.048,.015],
      [s*.056,-.094,.086,.011],[s*.020,-.138,.112,.0012]
    ],[0x544849,0x6e605d,0x8d7967,0xc7b18e,0xefe0be],10);
    const heel = new Vector3(s*.052,-.064,.065);
    connect(rod(jaw,'Espolón mandibular',mat,0xc9b492,.0008,.0060,8),heel,heel.clone().add(new Vector3(-s*.018,-.015,.016)));
    return jaw;
  });

  // Segmented cervical vertebrae and taut neck tendons.
  const vertebrae = Array.from({ length: 5 }, (_, i) => {
    const v = new Group();
    parts.add(v);
    const r = .043 - i * .003;
    lobe(v, 'Vértebra cervical', 0, 0, 0, r, .022, r * .92, i % 2 ? 0x453f49 : 0x574e55, 0, 16, 10);
    const spine = rod(v, 'Apófisis cervical', mat, 0x7c706a, .0012, .007, 8);
    connect(spine, new Vector3(0, .004, -r * .7), new Vector3(0, -.012, -r * 1.65));
    return v;
  });
  const neckTendons = [-1, 1].flatMap(s => [
    { s, ox: s * .048, oy: -.242, oz: -.145, hx: s * .054, hy: -.038, hz: -.012, mesh: rod(parts, 'Tendón del cuello', mat, 0x6b585b, .0045, .0075, 8) },
    { s, ox: s * .026, oy: -.252, oz: -.165, hx: s * .066, hy: .018, hz: -.038, mesh: rod(parts, 'Músculo cervical', mat, 0x4b424c, .005, .009, 8) }
  ]);

  // Continuous, sinewy grasping hands: sculpted palm + single-mesh multi-jointed
  // fingers (no ball-joint beads on sticks) tapering into curved talons.
  const hands = [-1,1].map(s => {
    const hand = new Group(); parts.add(hand);
    const palm = sculptedPart(hand, 'Palma interior', mat, 0x574d54, [0, 0, 0], [.046, .038, .020], 20, 14, v => {
      v.x *= .86 + .16 * Math.max(0, s * v.x);
      v.z *= .76 + .20 * Math.exp(-(((s * v.x - .6) / .35) ** 2));
      const rib = Math.exp(-(((v.y / .22) ** 2))) * .08 * Math.sin(v.y * 16);
      v.z += rib * Math.max(0, v.z);
      return .92 + .12 * Math.max(0, s * v.x);
    });
    palm.rotation.z = s * .24;
    for (let m = -1; m <= 1; m++) {
      shadedHose(hand, 'Metacarpo', mat, [
        [s*.004, m*.013, .013, .0045], [s*.022, m*.016, .015, .0055], [s*.038, m*.019, .011, .0040]
      ], [0x584e55, 0x7b6f6e, 0x64585c], 8);
    }
    const fingers = [];
    for (let i = 0; i < 5; i++) {
      const thumb = i === 4;
      const spread = thumb ? -1.45 : i - 1.5;
      const y = thumb ? -.032 : spread * .0165;
      const reach = thumb ? .078 : i === 1 || i === 2 ? .134 : .108;
      const fg = new Group(); hand.add(fg);
      const knuckle = [s * (thumb ? .012 : .034), y, .006];
      const mid1 = [s * (reach - .044), y + (thumb ? -.012 : .032 + spread * .013), .039];
      const mid2 = [s * reach, y + (thumb ? -.002 : .017 + spread * .023), .063];
      const tip = [s * (reach + (thumb ? .008 : .014)), y - (thumb ? -.018 : .024 - spread * .025), .036];
      const lerpPt = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
      shadedHose(fg, 'Dedo interior', mat, [
        [...knuckle, .0095],
        [...lerpPt(knuckle, mid1, .5), .0076],
        [...mid1, .0088],
        [...lerpPt(mid1, mid2, .5), .0066],
        [...mid2, .0076],
        [...lerpPt(mid2, tip, .55), .0052],
        [...tip, .0008]
      ], [0x60555c, 0x7c6f73, 0x918480, 0xa2948e, 0xb1a49a, 0xd8c8a6, 0xefe2c4], 9);
      fingers.push(fg);
    }
    const wrist = rod(parts,'Antebrazo interior',mat,0x3f3a45,.020,.027,10);
    const forearmRidge = rod(parts,'Cresta cubital',mat,0x6e6366,.006,.009,8);
    const armTendon = rod(parts,'Tendón del antebrazo',mat,0x5f4e54,.0035,.005,7);
    return {s,hand,fingers,wrist,forearmRidge,armTendon};
  });

  const neckBase = new Vector3(-.024,-.248,-.16);
  return (t, push) => {
    parts.visible = t > .28;
    if (!parts.visible) return;
    mat.uniforms.lightThroughSeam.value = .18 + .82*ease(.40,.90,t);
    const rise = ease(.50,.97,t), lunge = ease(.72,.86,t) * (1-ease(.86,1,t));
    const tremor = push * Math.sin(t * 27);
    head.position.set(
      -.025 + .012*Math.sin(rise*Math.PI) + .004*tremor,
      -.184 + .041*rise,
      lerp(-.181,.078,rise)+.022*lunge+.019*push
    );
    head.rotation.set(lerp(.42,-.10,rise), lerp(-.33,.14,rise) + .04*tremor, lerp(.23,-.135,rise));

    // Unhinge lower jaw and stretch saliva/sinew strands across the gape.
    const jawAngle = lerp(.05, .56, ease(.44, .92, t)) + .08 * push;
    jawGroup.rotation.x = jawAngle;
    const cosJ = Math.cos(jawAngle), sinJ = Math.sin(jawAngle);
    for (const { sx, mesh } of mouthStrands) {
      const ly = -.068, lz = .058;
      const lowerPt = new Vector3(sx * .92, -.036 + ly * cosJ - lz * sinJ, -.012 + ly * sinJ + lz * cosJ);
      connect(mesh, new Vector3(sx, -.042, .063), lowerPt);
    }
    mandibles.forEach((jaw,i)=>{
      jaw.rotation.z=(2*i-1)*lerp(-.65,.47,ease(.63,.86,t));
      jaw.rotation.x = .18 * ease(.55, .95, t) + .10 * push;
    });

    // Articulate curved cervical spine and lateral tendons.
    const neckTop = head.position.clone().add(new Vector3(0, -.015, -.045));
    const neckMid = neckBase.clone().lerp(neckTop, .5).add(new Vector3(-.006, -.026*(1-rise), -.022));
    for (let i = 0; i < vertebrae.length; i++) {
      const u = (i + .5) / vertebrae.length, m = 1 - u;
      vertebrae[i].position.set(
        m*m*neckBase.x + 2*m*u*neckMid.x + u*u*neckTop.x,
        m*m*neckBase.y + 2*m*u*neckMid.y + u*u*neckTop.y,
        m*m*neckBase.z + 2*m*u*neckMid.z + u*u*neckTop.z
      );
      vertebrae[i].rotation.x = lerp(.45, .15, u);
    }
    for (const tendon of neckTendons) {
      connect(tendon.mesh, new Vector3(tendon.ox, tendon.oy, tendon.oz), head.position.clone().add(new Vector3(tendon.hx, tendon.hy, tendon.hz)));
    }

    for (const {s,hand,fingers,wrist,forearmRidge,armTendon} of hands) {
      const reach = ease(s<0 ? .31 : .39, s<0 ? .59 : .67, t);
      const pull = ease(.58,.84,t);
      hand.position.set(-.023+s*(.067+.085*reach+.016*pull),-.171+s*.042+.043*reach,lerp(-.16,.041,reach)+.015*pull+.028*push);
      hand.rotation.set(.17*(1-reach),s*lerp(-.75,.16,reach),s*lerp(.5,-.18,pull));
      for (const [fi, fg] of fingers.entries()) {
        fg.rotation.y = s * (.14 * pull + .08 * push * (fi % 2 ? 1 : -1));
      }
      const rootArm = new Vector3(-.02+s*.055,-.214,-.12+.035*pull);
      connect(wrist, rootArm, hand.position);
      connect(forearmRidge, rootArm.clone().add(new Vector3(s*.012,.010,-.016)), hand.position.clone().add(new Vector3(s*.008,.012,-.014)));
      connect(armTendon, rootArm.clone().add(new Vector3(-s*.014,-.012,.010)), hand.position.clone().add(new Vector3(-s*.010,-.010,.016)));
    }
  };
}

const ringScale = [1.19,1.13,1.07,1.02,.96,.89,.78,.62,.38,.035];
const closedColors = [0x3a2531,0x382631,0x34232e,0x30212b,0x2c202b,0x251b25,0x211923,0x1c1721,0x17151f,0x15131c];
const tornColors = [0xab936f,0x9a8066,0x927960,0xbda17a,0xe0c698,0x8f745c,0x695653,0x392f38,0x211d2a,0x15131d];
function channel(color,shift) { return ((color >> shift) & 255)/255; }

// At each run in the seam a triangular piece of the shell stays attached
// at its base. Its free lip turns forward and exposes the pale foam backing.
const splits = [[8,.037],[24,.064],[37,.070],[46,.057],[58,.029]];
function tornFlaps(parent, mat, edge) {
  const group=new Group(); group.name='Retazos de fieltro'; parent.add(group);
  const rows=4, cols=5, positions=[], colors=[], uv=[], indices=[];
  const dyes=[0xb9a280,0xd2b28a,0x826955,0xd7bc96];
  for (let f=0;f<splits.length;f++) for(let row=0;row<rows;row++) for(let col=0;col<cols;col++) {
    const k=positions.length/3, dye=dyes[row];
    positions.push(0,0,0); colors.push(channel(dye,16),channel(dye,8),channel(dye,0)); uv.push(col/4,row/3);
    if(row<rows-1 && col<cols-1) indices.push(k,k+1,k+cols,k+1,k+cols+1,k+cols);
  }
  const g=new BufferGeometry(), p=new Float32BufferAttribute(positions,3);
  g.setAttribute('position',p); g.setAttribute('color',new Float32BufferAttribute(colors,3));
  g.setAttribute('uv',new Float32BufferAttribute(uv,2)); g.setIndex(indices);
  const mesh=new Mesh(g,mat); mesh.frustumCulled=false; group.add(mesh);
  return (wear, rip, push) => {
    group.visible=rip>.015;
    if(!group.visible) return;
    for(let f=0;f<splits.length;f++) {
      const [i,length]=splits[f], a=i*TAU/segments, nx=Math.cos(a), ny=Math.sin(a);
      const fold=ease(.18+.028*f,.91+.015*f,wear);
      const base=edge[i];
      for(let col=0;col<cols;col++) {
        const u=col/4, bulge=Math.sin(u*Math.PI);
        const seam=edge[(segments+i+col-2)%segments];
        const free=(.018+length*.74)*(1-.48*Math.abs(u-.62))*fold;
        const tip=col===3 ? .018*fold : 0;
        const x=lerp(seam.x,base.x,.14), y=lerp(seam.y,base.y,.14);
        for(let row=0;row<rows;row++) {
          const width=[.012,.004,-free-tip,-free-tip-.006*fold][row];
          const lift = fold*(.33+.67*bulge)*(1+.42*push);
          const z=[.003,.013+.033*fold*bulge,.010+.082*lift,.008+.073*lift][row];
          p.setXYZ((f*rows+row)*cols+col,x+nx*width-ny*fold*.010*row/3,y+ny*width+nx*fold*.010*row/3,z);
        }
      }
    }
    p.needsUpdate=true; g.computeVertexNormals();
  };
}

function toothMesh(parent, name, material, tint, top, bottom) {
  const g = new CylinderGeometry(top, bottom, 1, 8);
  g.scale(1, 1, .52);
  return add(parent, name, g, material, tint);
}

function chaseTeethSet(parent, mat, edge) {
  const group = new Group();
  group.name = 'Dientes de persecución';
  parent.add(group);
  const upperTeeth = [], lowerTeeth = [];
  for (let i = 0; i < 8; i++) {
    const k = i - 3.5;
    const canine = Math.abs(k) === 2.5;
    const shade = Math.abs(k) === 3.5 ? 0xe4dac8 : 0xfbf4e8;
    const mesh = toothMesh(group, 'Diente superior de persecución', mat, shade, canine ? .0128 : .0116, .0016);
    upperTeeth.push({ k, canine, mesh });
  }
  for (let i = 0; i < 7; i++) {
    const k = i - 3;
    const canine = Math.abs(k) === 2;
    const shade = Math.abs(k) === 3 ? 0xd2c7b6 : 0xeee5d5;
    const mesh = toothMesh(group, 'Diente inferior de persecución', mat, shade, .0016, canine ? .0114 : .0102);
    lowerTeeth.push({ k, canine, mesh });
  }
  return (open, rip) => {
    const reveal = ease(.05, .82, open);
    group.visible = reveal > .01;
    if (!group.visible) return;
    const place = (list, dir) => {
      for (const { k, canine, mesh } of list) {
        const u = k / 5, angle = Math.acos(u);
        const sample = (dir > 0 ? angle : TAU - angle) * segments / TAU;
        const index = Math.floor(sample), fraction = sample - index;
        const a = edge[index], b = edge[(index + 1) % segments];
        const x = lerp(a.x, b.x, fraction), lipY = lerp(a.y, b.y, fraction);
        const archZ = -.006 - .007 * u * u - .014 * (1 - open) + .033 * rip;
        const baseLen = dir > 0 ? .045 : .040;
        const len = (baseLen - .005 * Math.abs(u) + (canine ? .007 : 0)) * reveal;
        const root = new Vector3(x, lipY + dir * .001, archZ);
        const tip = new Vector3(x * .97, lipY + dir * (.001 - len), archZ - .004);
        if (dir > 0) connect(mesh, tip, root); else connect(mesh, root, tip);
      }
    };
    place(upperTeeth, 1);
    place(lowerTeeth, -1);
  };
}

export function makeEmergence(anchor, mat, front, innerMat) {
  const geometry = new BufferGeometry(), indices = [];
  const count = ringScale.length * segments;
  const pos = new Float32BufferAttribute(new Float32Array(count*3),3);
  const color = new Float32BufferAttribute(new Float32Array(count*3),3);
  const uv = new Float32BufferAttribute(new Float32Array(count*2),2);
  for (let r=0; r<ringScale.length; r++) for (let i=0; i<segments; i++) {
    const k=r*segments+i, j=r*segments+(i+1)%segments;
    uv.setXY(k,i/segments,r/(ringScale.length-1));
    if (r<ringScale.length-1) indices.push(k,j,k+segments,j,j+segments,k+segments);
    else if (i>0 && i<segments-1) indices.push(r*segments,k,j);
  }
  geometry.setIndex(indices); geometry.setAttribute('position',pos); geometry.setAttribute('color',color); geometry.setAttribute('uv',uv);
  const mouth = new Mesh(geometry,mat);
  mouth.name = 'Costura y forro interior'; mouth.frustumCulled = false; anchor.add(mouth);
  mat.side = DoubleSide;
  const edge = Array.from({length:segments},()=>new Vector2());
  front.defines.FELT_CUT = segments;
  front.uniforms.cutOrigin = {value:new Vector2(anchor.position.x, anchor.position.y)};
  front.uniforms.cutEdge = {value:edge};
  front.needsUpdate = true;
  const chaseTeeth = chaseTeethSet(anchor, mat, edge);
  const creature = innerCreature(anchor, innerMat);
  const flaps=tornFlaps(anchor,mat,edge);
  const cracks = new Map(splits);
  const fibres = new Group(); fibres.name = 'Puntadas desgarradas'; anchor.add(fibres);
  const stitches = [10,14,19,24].map((i,j) => ({
    i, snap:.37+j*.065,
    upper:rod(fibres,'Hilo superior',mat,0xd3ad89,.0017,.0021,6),
    lower:rod(fibres,'Hilo inferior',mat,0xcaa487,.0018,.0020,6)
  }));
  return (scream, chase = 0, wear = scream, push = 0) => {
    const open = chase * (1 - ease(.12, .62, scream));
    const tension=ease(.02,.44,wear);
    const rip=ease(.14,1,wear)*(.57+.43*ease(.05,.86,scream));
    const tug=ease(.51,.64,scream)*(1-ease(.66,.85,scream));
    const smileW = .104 + .036 * open + .045 * tension * (1 - .45 * open);
    const smileH = .014 + .038 * open + .006 * tension;
    for (let i=0; i<segments; i++) {
      const a=i*TAU/segments, x=Math.cos(a), y=Math.sin(a);
      const jag = .48*Math.sin(9*a+.8) + .32*Math.sin(15*a-.6) + .20*Math.cos(5*a);
      const flap = Math.max(0,Math.cos(5*a+.4))**5;
      const cx=-.024*rip, cy=lerp(-.017-(1-x*x)*(.078+.018*open-.029*tension),-.206,rip);
      const crack=(cracks.get(i) ?? 0)*ease(.24,1,wear);
      const dx=(lerp(smileW,.185+.022*y+.013*jag+.015*tug,rip)+crack)*x;
      const dy=(lerp(smileH,.211+.014*jag,rip)+crack)*y + .013*x*rip;
      edge[i].set(cx+dx,cy+dy);
      const peak=(.043+.062*flap+.02*tug+.046*push*flap)*rip;
      const depths=[.002,.006+.005*rip,.009+.009*rip,.013+.85*peak,.013+peak,.011+peak,.006+.48*peak,-.024-.036*rip,-.120-.045*rip,-.190-.045*rip];
      for (let r=0; r<ringScale.length; r++) {
        const k=r*segments+i, radius=ringScale[r];
        pos.setXYZ(k,cx+dx*radius,cy+dy*radius,depths[r]);
        const c=tornColors[r], old=closedColors[r], f=rip*(.96+.04*jag);
        color.setXYZ(k,lerp(channel(old,16),channel(c,16),f),lerp(channel(old,8),channel(c,8),f),lerp(channel(old,0),channel(c,0),f));
      }
    }
    pos.needsUpdate = color.needsUpdate = true; geometry.computeVertexNormals();
    chaseTeeth(open, rip);
    fibres.visible = wear > .14;
    if (fibres.visible) for (const stitch of stitches) {
      const hi=edge[stitch.i], lo=edge[segments-stitch.i];
      const a=new Vector3(hi.x,hi.y,.015+.054*rip), b=new Vector3(lo.x,lo.y,.015+.054*rip);
      const mid=a.clone().lerp(b,.45);
      const broken=ease(stitch.snap,stitch.snap+.065,wear);
      const length=ease(.14,.25,wear);
      const upEnd=mid.clone().lerp(a.clone().add(new Vector3(.008,-.024,.012)),broken);
      const lowEnd=mid.clone().lerp(b.clone().add(new Vector3(-.011,.018,.014)),broken);
      connect(stitch.upper,a,a.clone().lerp(upEnd,length));
      connect(stitch.lower,b,b.clone().lerp(lowEnd,length));
    }
    // Late in the chase the lining admits a glimpse of the occupant. The
    // hands gaining purchase and the head coming outside belong to the scream.
    const peek=.40*ease(.40,.85,wear);
    flaps(wear,rip,push);
    creature(peek+(1-peek)*scream, push);
  };
}
