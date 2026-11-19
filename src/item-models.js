import {
  BoxGeometry, CylinderGeometry, ExtrudeGeometry, Float32BufferAttribute, Group,
  Mesh, PlaneGeometry, Shape, SphereGeometry, TorusGeometry, Vector3
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture } from './textures.js';

const steel = 0xb9c5c6, rubber = 0x232d30, brass = 0xe6ae42, ivory = 0xf2edda;
const up = new Vector3(0, 1, 0);

// The Mii's resting hand is a closed ball. Replace its skin at the wrist
// while carrying, so the thumb and fingertips wrap around the actual handle.
export function createCarryingHand(makeMaterial, white) {
  const mat = makeMaterial(white, { emission: .19 });
  const root = new Group(), fingers = new Group(), sleeve = new Group();
  root.add(fingers, sleeve);
  function form(parent, geo, tint, x, y, z) {
    const rgb = [tint >> 16, (tint >> 8) & 255, tint & 255].map(v => v / 255);
    const colors = new Float32Array(geo.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set(rgb, i);
    geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
    const m = new Mesh(geo, mat);
    m.position.set(x, y, z); parent.add(m);
    return m;
  }
  const skin = 0xe0ac8d;
  function pad(parent, x, y, z, rx, ry, rz, roll = 0, tint = skin) {
    const m = form(parent, new SphereGeometry(1, 14, 10), tint, x, y, z);
    m.scale.set(rx, ry, rz); m.rotation.z = roll;
    return m;
  }
  // Palm and thenar pad, four bent fingers on the near face, opposing thumb.
  pad(root, .037,-.016,-.012, .035,.047,.026,-.18);
  pad(root, .035,.001,.003, .027,.034,.023,.4);
  for (let i = 0; i < 4; i++) {
    const y = .022 - i * .016, length = 1 - i * .075;
    pad(fingers, .029,y,-.004, .014,.010,.029 * length,.08);
    pad(fingers, .012,y-.002,.019, .026 * length,.009,.012,-.12);
    pad(fingers,-.010 * length,y-.003,.016, .011,.0085,.013,-.2);
  }
  pad(root,.016,.029,-.016, .027,.012,.015,.5);
  pad(root,-.004,.031,-.007, .014,.012,.020,-.34);
  const wrist = pad(root, .055,-.052,-.004, .030,.042,.027,.58);
  wrist.rotation.x = -.25;
  const elbow = new Vector3(.158, -.228, .19), cuff = new Vector3(.062, -.065, .009);
  const axis = elbow.clone().sub(cuff), center = cuff.clone().lerp(elbow, .5);
  const cloth = form(sleeve, new CylinderGeometry(.060,.034,axis.length(),14),
    0xb33a38, center.x,center.y,center.z);
  cloth.quaternion.setFromUnitVectors(up,axis.normalize());
  const hem = form(sleeve,new CylinderGeometry(.036,.034,.023,14),0x702e30,cuff.x,cuff.y,cuff.z);
  hem.quaternion.copy(cloth.quaternion);
  // The StreetPass body has separate hands and no arm mesh. In third person
  // its sleeve has to connect the animated shoulder to the actual cuff.
  const arm = new Group();
  root.add(arm);
  const shirt = 0xbc3937;
  const upper = form(arm, new CylinderGeometry(.060,.073,1,14),shirt,0,0,0);
  const lower = form(arm, new CylinderGeometry(.035,.058,1,14),shirt,0,0,0);
  const joint = pad(arm,0,0,0,.059,.058,.059,0,shirt);
  const start = new Vector3(), bend = new Vector3(), along = new Vector3();
  function segment(mesh, a, b) {
    along.subVectors(b, a);
    mesh.position.lerpVectors(a, b, .5);
    mesh.scale.y = Math.max(.001, along.length());
    mesh.quaternion.setFromUnitVectors(up, along.normalize());
  }
  function reachShoulder(shoulder) {
    arm.visible = Boolean(shoulder);
    if (!shoulder) return;
    arm.worldToLocal(start.copy(shoulder));
    bend.lerpVectors(start, cuff, .52);
    bend.y -= .095;
    bend.z -= .04;
    segment(upper, start, bend);
    segment(lower, bend, cuff);
    joint.position.copy(bend);
  }
  arm.visible = false;
  return { root, sleeve, reachShoulder, fit(kind) {
    const wide = kind === 'energy' || kind === 'decoy' || kind === 'flash';
    fingers.position.z = wide ? .017 : 0;
    root.position.x = wide ? .008 : 0;
  } };
}

// Local metres, with the origin at the grip and the printed face toward +Z.
// Floor pickups, the student's hand and thrown alarms share the same geometry.
export function createItemModels(makeMaterial, white) {
  const solid = makeMaterial(white, { emission: .46, shininess: .35 });
  const metal = makeMaterial(white, { emission: .48, shininess: .86 });
  const lamp = makeMaterial(white, { emission: .98 });
  const cache = new Map();

  function build(kind) {
    const parts = new Group();
    function part(geo, x, y, z, tint, mat = solid) {
      const mesh = new Mesh(geo.index ? geo.toNonIndexed() : geo, mat);
      const rgb = [(tint >> 16 & 255) / 255, (tint >> 8 & 255) / 255, (tint & 255) / 255];
      const colors = new Float32Array(mesh.geometry.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) colors.set(rgb, i);
      mesh.geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
      mesh.position.set(x, y, z);
      parts.add(mesh);
      return mesh;
    }
    const box = (x, y, z, w, h, d, tint, mat) => part(new BoxGeometry(w, h, d), x, y, z, tint, mat);
    const drum = (x, y, z, rt, rb, h, tint, mat) =>
      part(new CylinderGeometry(rt, rb, h, 20), x, y, z, tint, mat);
    const ring = (x, y, z, r, thick, tint) =>
      part(new TorusGeometry(r, thick, 8, 24), x, y, z, tint, metal);
    function rod(ax, ay, bx, by, z, radius, tint, mat) {
      const dir = new Vector3(bx - ax, by - ay, 0);
      const m = drum((ax + bx) / 2, (ay + by) / 2, z, radius, radius, dir.length(), tint, mat);
      m.quaternion.setFromUnitVectors(up, dir.normalize());
    }
    function plate(points, depth, z, tint, mat) {
      const s = new Shape();
      s.moveTo(...points[0]);
      for (const pt of points.slice(1)) s.lineTo(...pt);
      s.closePath();
      return part(new ExtrudeGeometry(s, { depth, bevelEnabled: false }), 0, 0, z, tint, mat);
    }
    function stamp(text, x, y, z, w, h, ink, paper) {
      const tex = canvasTexture(192, 64, c => {
        c.fillStyle = paper; c.fillRect(0, 0, 192, 64);
        c.fillStyle = ink; c.font = 'bold 46px Arial'; c.textAlign = 'center';
        c.textBaseline = 'middle'; c.fillText(text, 96, 34, 180);
      });
      part(new PlaneGeometry(w, h), x, y, z, 0xffffff, makeMaterial(tex, { emission: .7 }));
    }

    if (kind === 'boltCutters') {
      const cx = -.054;
      for (const s of [-1, 1]) {
        rod(cx + s * .067, -.051, cx + s * .016, .188, 0, .012, 0xbb3328, metal);
        rod(cx + s * .067, -.054, cx + s * .048, .039, 0, .018, rubber);
        rod(cx + s * .050, .03, cx + s * .048, .042, 0, .020, 0xf75935);
        rod(cx + s * .016, .173, cx - s * .024, .221, s * .005, .012, steel, metal);
        plate([[cx + s * .027, .208], [cx + s * .035, .244], [cx + s * .018, .28],
          [cx + s * .004, .285], [cx + s * .003, .251], [cx + s * .013, .222]], .019, -.010, 0x748387, metal);
        drum(cx + s * .018, .213, .011, .012, .012, .012, steel, metal).rotation.x = Math.PI / 2;
      }
      box(cx, .207, -.012, .071, .021, .010, rubber);
    } else if (kind === 'fuse') {
      drum(0, .056, 0, .033, .033, .107, ivory);
      for (const y of [-.006, .117]) {
        drum(0, y, 0, .037, .037, .024, 0xb4814a, metal);
        box(0, y < 0 ? -.035 : .147, 0, .030, .048, .009, brass, metal);
      }
      for (const y of [.018, .09]) drum(0, y, 0, .034, .034, .006, 0xcb6023);
      stamp('32 A', 0, .057, .034, .047, .027, '#292c27', '#eee7cf');
    } else if (kind === 'masterKey') {
      ring(0, .036, 0, .032, .009, brass);
      plate([[-.008,.07], [.009,.07], [.009,.17], [0,.18], [-.024,.168],
        [-.024,.155], [-.012,.155], [-.012,.147], [-.021,.147], [-.021,.135], [-.008,.135]],
        .009, -.0045, brass, metal);
      box(.005,.119,.005,.004,.086,.002,ivory,metal);
      ring(.03,.014,.002,.013,.0035,steel);
      box(.051,-.009,0,.036,.05,.007,0x276963).rotation.z = -.36;
    } else if (kind === 'energy') {
      drum(0,.047,0,.039,.039,.126,0x138f83,metal);
      drum(0,.114,0,.033,.039,.012,steel,metal);
      drum(0,-.02,0,.039,.032,.012,steel,metal);
      for (const y of [.122,-.026]) ring(0,y,0,.033,.003,steel).rotation.x = Math.PI / 2;
      ring(0,.122,.005,.008,.0035,rubber).rotation.x = Math.PI / 2;
      drum(0,.083,0,.0395,.0395,.008,0xa2f277);
      stamp('VOLTA',0,.053,.040,.057,.021,'#f7fadc','#087c73');
      plate([[-.003,.036],[.010,.036],[.002,.020],[.012,.020],[-.010,-.001],[-.004,.015],[-.012,.015]],
        .001,.039,0xffe56b,lamp);
    } else if (kind === 'decoy') {
      drum(0,.059,0,.061,.061,.054,0xd27324,metal).rotation.x = Math.PI/2;
      drum(0,.059,.030,.055,.055,.007,ivory).rotation.x = Math.PI/2;
      ring(0,.059,.034,.054,.004,brass);
      for (let i=0;i<12;i++) {
        const a = i*Math.PI/6;
        box(Math.sin(a)*.044,.059+Math.cos(a)*.044,.036,.003,.008,.003,rubber).rotation.z = -a;
      }
      rod(0,.059,-.018,.074,.039,.003,rubber);
      rod(0,.059,.013,.092,.039,.002,0xab3023);
      for (const s of [-1,1]) {
        rod(s*.03,.108,s*.043,.134,0,.004,steel,metal);
        drum(s*.044,.134,0,.008,.029,.021,0xe48224,metal).rotation.z = -s*.48;
        rod(s*.03,.014,s*.042,-.01,0,.005,rubber);
      }
      rod(0,.116,.003,.142,0,.003,steel,metal);
      box(.003,.142,0,.024,.009,.013,rubber);
    } else if (kind === 'flash') {
      box(0,.032,0,.064,.113,.043,rubber);
      for (const y of [.008,.022,.036]) box(0,y,.023,.053,.004,.005,0x586769);
      box(0,.102,0,.114,.060,.055,0x41545c);
      box(0,.104,.031,.099,.041,.008,steel,metal);
      box(0,.104,.036,.089,.031,.005,0xd5f7ff,lamp);
      for (let i=-3;i<=3;i++) box(i*.012,.104,.040,.002,.029,.002,0x86b8ca);
      box(.035,.052,0,.008,.016,.020,0xf39d43);
      stamp('FLASH',0,.061,.023,.05,.013,'#dce8e7','#34434a');
    } else {
      const n = kind.slice(-1);
      box(0,.049,0,.148,.094,.020,0x303735);
      box(0,.055,.011,.133,.066,.004,0xd9ceaa);
      box(0,.045,.014,.11,.025,.004,0x282d2b);
      stamp('CINTA 0' + n,0,.075,.015,.112,.021,'#542f2b','#edcaa8');
      for (const s of [-1,1]) {
        ring(s*.035,.045,.019,.010,.0035,ivory);
        for (let i=0;i<3;i++)
          box(s*.035,.045,.018,.002,.016,.003,ivory).rotation.z = i*Math.PI/3;
        ring(s*.040,.012,.012,.004,.002,steel);
        for (const y of [.008,.089]) box(s*.068,y,.012,.004,.004,.002,steel);
      }
    }
    parts.updateMatrixWorld(true);
    const batches = new Map(), model = new Group();
    for (const m of parts.children) {
      if (!batches.has(m.material)) batches.set(m.material, []);
      batches.get(m.material).push(m.geometry.applyMatrix4(m.matrixWorld));
    }
    for (const [mat, gs] of batches) {
      model.add(new Mesh(mergeGeometries(gs), mat));
      gs.forEach(g => g.dispose());
    }
    model.name = 'Objeto · ' + kind;
    return model;
  }
  return kind => {
    if (!cache.has(kind)) cache.set(kind, build(kind));
    return cache.get(kind).clone();
  };
}
