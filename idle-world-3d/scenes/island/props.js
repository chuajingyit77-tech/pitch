// 晴岛 cozy props: wooden dock with a lantern, a thatched beach hut, a little rowboat.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, lerp, patchMaterial } from '../../lib/util.js';
import { addUnderwater } from './shared.js';
import { woodTexture, thatchTexture } from './textures.js';

const V3 = THREE.Vector3;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new V3(), _p = new V3(), _e = new THREE.Euler();
const UP = new V3(0, 1, 0);

/** Damp, algae-dark wood below the splash line. */
function wetWood(material, key) {
  patchMaterial(material, {
    key: 'wetwood' + key,
    vertexHeader: 'varying float vWwY;',
    fragmentHeader: 'varying float vWwY;',
    vertex: { '#include <fog_vertex>': '$&\n vWwY = ((mvPosition.xyz - viewMatrix[3].xyz) * mat3(viewMatrix)).y;' },
    fragment: {
      '#include <color_fragment>': `$&
        float ww = 1.0 - smoothstep(0.05, 0.42, vWwY);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.42, 0.5, 0.36), ww);`,
      '#include <roughnessmap_fragment>': '$&\n roughnessFactor = mix(roughnessFactor, 0.35, ww * step(-0.05, vWwY));',
    },
  });
  return addUnderwater(material, { key });
}

/** Layout only (positions), so the flora can keep clear of the dock and hut. */
export function planProps(terrain, rng) {
  const a = terrain.dockAng;
  const dir = new V3(Math.cos(a), 0, Math.sin(a));
  const perp = new V3(-Math.sin(a), 0, Math.cos(a));
  const start = terrain.pointAt(a, 2.4);
  const length = rng.range(12.5, 14.5);
  const end = start.clone().addScaledVector(dir, length);
  end.y = 0;
  const hutSide = rng.sign();
  const ha = a + hutSide * (5.2 / terrain.R0);
  const hut = terrain.pointAt(ha, 6.2);
  const hutYaw = Math.atan2(Math.cos(ha), Math.sin(ha)); // door faces the sea
  const reserved = [];
  for (let s = -1; s <= length + 2; s += 1.2) {
    const p = start.clone().addScaledVector(dir, s);
    reserved.push({ x: p.x, z: p.z, r: 1.6 });
  }
  reserved.push({ x: hut.x, z: hut.z, r: 2.9 });
  const front = hut.clone().addScaledVector(new V3(Math.cos(ha), 0, Math.sin(ha)), 2.2);
  reserved.push({ x: front.x, z: front.z, r: 1.6 });
  return { a, dir, perp, start, end, length, hut, hutYaw, ha, hutSide, reserved, deckY: 0.88, width: 1.9 };
}

export function createProps(env, rng, terrain, plan) {
  const group = new THREE.Group();
  group.name = 'props';
  const disposables = [];
  const H = terrain.height;
  const { dir, perp, start, length, deckY, width } = plan;
  const yaw = Math.atan2(-dir.z, dir.x); // rotation that maps +X onto dir

  /* ---------------- dock ---------------- */
  const plankTex = woodTexture(rng.int(1, 1e6), { base: [150, 112, 76], planks: 1 });
  const woodMat = new THREE.MeshStandardMaterial({ map: plankTex, roughness: 0.82, color: 0xf0e2d0 });
  wetWood(woodMat, 'deck');
  const postTex = woodTexture(rng.int(1, 1e6), { base: [104, 80, 58], planks: 1 });
  const postMat = new THREE.MeshStandardMaterial({ map: postTex, roughness: 0.9 });
  wetWood(postMat, 'post');
  disposables.push(plankTex, woodMat, postTex, postMat);

  const plankGeo = new THREE.BoxGeometry(0.27, 0.06, 1, 1, 1, 1);
  const platform = 3.6;
  const plankSites = [];
  const totalLen = length + platform;
  for (let s = 0; s < totalLen; s += 0.3) {
    const onPlat = s > length;
    const w = onPlat ? platform : width;
    plankSites.push({ s, w, off: onPlat ? 0 : 0 });
  }
  const planks = new THREE.InstancedMesh(plankGeo, woodMat, plankSites.length);
  const prng = rng.fork('planks');
  const tint = new THREE.Color();
  plankSites.forEach((pk, i) => {
    const c = start.clone().addScaledVector(dir, pk.s);
    _e.set(prng.range(-0.015, 0.015), yaw + prng.range(-0.02, 0.02), prng.range(-0.02, 0.02));
    _q.setFromEuler(_e);
    _m.compose(_p.set(c.x, deckY + prng.range(-0.012, 0.012), c.z), _q, _s.set(1, 1, pk.w * prng.range(0.97, 1.02)));
    planks.setMatrixAt(i, _m);
    const k = prng.range(0.78, 1.08);
    planks.setColorAt(i, tint.setRGB(k, k * prng.range(0.96, 1.02), k * prng.range(0.92, 1.0)));
  });
  planks.castShadow = true; planks.receiveShadow = true;
  group.add(planks);
  disposables.push(plankGeo);

  // stringers
  const strGeo = new THREE.BoxGeometry(1, 0.16, 0.12);
  const stringers = new THREE.InstancedMesh(strGeo, postMat, 4);
  [-0.75, 0.75].forEach((o, i) => {
    const c = start.clone().addScaledVector(dir, length / 2).addScaledVector(perp, o);
    _q.setFromAxisAngle(UP, yaw);
    _m.compose(_p.set(c.x, deckY - 0.11, c.z), _q, _s.set(length, 1, 1));
    stringers.setMatrixAt(i, _m);
  });
  [-1.6, 1.6].forEach((o, i) => {
    const c = start.clone().addScaledVector(dir, length + platform / 2).addScaledVector(perp, o);
    _q.setFromAxisAngle(UP, yaw);
    _m.compose(_p.set(c.x, deckY - 0.11, c.z), _q, _s.set(platform, 1, 1));
    stringers.setMatrixAt(2 + i, _m);
  });
  stringers.castShadow = true;
  group.add(stringers);
  disposables.push(strGeo);

  // posts
  const postGeo = new THREE.CylinderGeometry(0.1, 0.11, 1, 9);
  postGeo.translate(0, 0.5, 0);
  const posts = [];
  const perches = [];
  const addPost = (c, top) => {
    const bottom = Math.min(H(c.x, c.z), -0.2) - 0.4;
    posts.push({ x: c.x, z: c.z, y0: bottom, h: top - bottom });
    if (H(c.x, c.z) < 0.15) terrain.addObstacle(c.x, c.z, 0.16, 0.85);
  };
  for (let s = 1.0; s <= length; s += 2.25) {
    for (const o of [-1, 1]) addPost(start.clone().addScaledVector(dir, s).addScaledVector(perp, o * (width / 2 + 0.05)), deckY - 0.03);
  }
  // tall bollards at the platform corners (gull perches)
  for (const [ds, o] of [[length + 0.1, -1], [length + 0.1, 1], [length + platform - 0.15, -1], [length + platform - 0.15, 1]]) {
    const c = start.clone().addScaledVector(dir, ds).addScaledVector(perp, o * (platform / 2 - 0.08));
    const top = deckY + 0.75;
    addPost(c, top);
    perches.push(new V3(c.x, top + 0.02, c.z));
  }
  const postMesh = new THREE.InstancedMesh(postGeo, postMat, posts.length);
  posts.forEach((p, i) => {
    _q.setFromAxisAngle(UP, prng.range(0, TAU));
    _m.compose(_p.set(p.x, p.y0, p.z), _q, _s.set(1, p.h, 1));
    postMesh.setMatrixAt(i, _m);
  });
  postMesh.castShadow = true; postMesh.receiveShadow = true;
  group.add(postMesh);
  disposables.push(postGeo);

  // crates + barrel on the platform
  const crateGeo = new THREE.BoxGeometry(0.62, 0.5, 0.62);
  crateGeo.translate(0, 0.25, 0);
  const crates = new THREE.InstancedMesh(crateGeo, woodMat, 2);
  const platC = start.clone().addScaledVector(dir, length + platform * 0.5);
  [[0.9, -1.05, 0.3], [0.35, -1.25, -0.4]].forEach(([ds, o, r], i) => {
    const c = platC.clone().addScaledVector(dir, ds).addScaledVector(perp, o);
    _q.setFromAxisAngle(UP, yaw + r);
    _m.compose(_p.set(c.x, deckY + 0.03 + (i ? 0 : 0), c.z), _q, _s.setScalar(i ? 0.8 : 1));
    crates.setMatrixAt(i, _m);
  });
  crates.castShadow = true;
  group.add(crates);
  disposables.push(crateGeo);
  const barrelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.75, 14, 3);
  {
    const p = barrelGeo.attributes.position;
    for (let i = 0; i < p.count; i++) { const k = 1 + 0.12 * Math.cos(p.getY(i) / 0.375 * Math.PI / 2); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
    barrelGeo.computeVertexNormals();
  }
  const barrel = new THREE.Mesh(barrelGeo, postMat);
  const bc = platC.clone().addScaledVector(dir, -0.6).addScaledVector(perp, -1.15);
  barrel.position.set(bc.x, deckY + 0.4, bc.z);
  barrel.castShadow = true;
  group.add(barrel);
  disposables.push(barrelGeo);

  /* ---------------- lantern ---------------- */
  const lanternBase = platC.clone().addScaledVector(dir, platform / 2 - 0.35).addScaledVector(perp, 1.35);
  const lpGeo = new THREE.CylinderGeometry(0.06, 0.07, 2.1, 8);
  lpGeo.translate(0, 1.05, 0);
  const armGeo = new THREE.BoxGeometry(0.55, 0.06, 0.06);
  armGeo.translate(0.22, 2.02, 0);
  const lpole = new THREE.Mesh(mergeGeometries([lpGeo, armGeo]), postMat);
  lpole.position.set(lanternBase.x, deckY, lanternBase.z);
  lpole.rotation.y = Math.atan2(perp.z, -perp.x); // arm toward the dock centre
  lpole.castShadow = true;
  group.add(lpole);
  lpGeo.dispose(); armGeo.dispose();
  disposables.push(lpole.geometry);
  const armDir = new V3(1, 0, 0).applyAxisAngle(UP, lpole.rotation.y);
  const lanternPos = new V3(lanternBase.x, deckY + 1.72, lanternBase.z).addScaledVector(armDir, 0.42);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.5, metalness: 0.6 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffa040, emissiveIntensity: 0, roughness: 0.2 });
  const lantern = new THREE.Group();
  const cage = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.22), glassMat);
  const capGeo = new THREE.ConeGeometry(0.19, 0.14, 4);
  capGeo.rotateY(Math.PI / 4);
  const cap = new THREE.Mesh(capGeo, frameMat);
  cap.position.y = 0.22;
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.26), frameMat);
  base.position.y = -0.17;
  lantern.add(cage, cap, base);
  lantern.position.copy(lanternPos);
  group.add(lantern);
  disposables.push(cage.geometry, capGeo, base.geometry, frameMat, glassMat);
  const lanternLight = new THREE.PointLight(0xffa850, 0, 16, 2);
  lanternLight.position.copy(lanternPos).add(new V3(0, -0.05, 0));
  group.add(lanternLight);

  /* ---------------- hut ---------------- */
  const hut = new THREE.Group();
  const hp = plan.hut;
  hut.position.set(hp.x, H(hp.x, hp.z) - 0.05, hp.z);
  hut.rotation.y = plan.hutYaw;
  const wallTex = woodTexture(rng.int(1, 1e6), { base: [168, 126, 84], planks: 6 });
  wallTex.rotation = Math.PI / 2; wallTex.center.set(0.5, 0.5);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85 });
  const thatchTex = thatchTexture(rng.int(1, 1e6));
  thatchTex.repeat.set(2, 1.4);
  const thatchMat = new THREE.MeshStandardMaterial({ map: thatchTex, roughness: 0.97, side: THREE.DoubleSide });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x5b4130, roughness: 0.8 });
  const winMat = new THREE.MeshStandardMaterial({ color: 0x2b2e33, emissive: 0xffb060, emissiveIntensity: 0, roughness: 0.3 });
  disposables.push(wallTex, wallMat, thatchTex, thatchMat, trimMat, winMat);
  const W = 2.7, D = 2.3, Hh = 1.95, plat = 0.32;
  const add = (geo, mat, x, y, z, ry = 0, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.y = ry;
    m.castShadow = cast; m.receiveShadow = true;
    hut.add(m); disposables.push(geo);
    return m;
  };
  add(new THREE.BoxGeometry(W + 1.0, 0.14, D + 1.5), wallMat, 0, plat, 0.45);          // platform + porch
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(new THREE.CylinderGeometry(0.08, 0.09, plat + 0.6, 7), trimMat, x * (W + 0.9) / 2, plat / 2 - 0.3, z * (D + 1.4) / 2 + 0.45);
  add(new THREE.BoxGeometry(W, Hh, D), wallMat, 0, plat + Hh / 2 + 0.07, -0.2);
  // corner beams
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(new THREE.BoxGeometry(0.14, Hh + 0.05, 0.14), trimMat, x * W / 2, plat + Hh / 2 + 0.07, -0.2 + z * D / 2);
  // door + windows (front = +z)
  add(new THREE.BoxGeometry(0.78, 1.38, 0.06), trimMat, -0.5, plat + 0.76, -0.2 + D / 2 + 0.02, 0, false);
  const winGeo = new THREE.BoxGeometry(0.52, 0.46, 0.06);
  add(winGeo, winMat, 0.68, plat + 1.18, -0.2 + D / 2 + 0.02, 0, false);
  add(new THREE.BoxGeometry(0.06, 0.46, 0.52), winMat, W / 2 + 0.02, plat + 1.18, -0.2, 0, false);
  add(new THREE.BoxGeometry(0.06, 0.46, 0.52), winMat, -W / 2 - 0.02, plat + 1.18, -0.2, 0, false);
  // porch posts
  for (const x of [-1, 1]) add(new THREE.CylinderGeometry(0.07, 0.07, Hh + 0.2, 7), trimMat, x * (W / 2 + 0.3), plat + (Hh + 0.2) / 2, -0.2 + D / 2 + 1.05);
  // thatched hip roof with a deep overhang
  const roofGeo = new THREE.ConeGeometry(2.75, 1.6, 4, 3, true);
  roofGeo.rotateY(Math.PI / 4);
  roofGeo.scale(1.06, 1, 1.2);
  const roof = add(roofGeo, thatchMat, 0, plat + Hh + 0.85, 0.25);
  roof.castShadow = true;
  const roofTop = new V3(0, plat + Hh + 1.68, 0.25);
  add(new THREE.SphereGeometry(0.16, 8, 6), trimMat, roofTop.x, roofTop.y - 0.05, roofTop.z);
  // little bench + surfboard-ish plank leaning on the wall
  add(new THREE.BoxGeometry(1.1, 0.08, 0.36), trimMat, 0.75, plat + 0.45, -0.2 + D / 2 + 0.5);
  hut.updateMatrixWorld(true);
  perches.push(hut.localToWorld(roofTop.clone().add(new V3(0, 0.12, 0))));
  group.add(hut);
  const hutWindowPos = hut.localToWorld(new V3(0.68, plat + 1.18, -0.2 + D / 2 + 0.6));

  /* ---------------- rowboat ---------------- */
  const boat = buildBoat(rng, postMat, woodMat, disposables);
  const bc2 = start.clone().addScaledVector(dir, length - 2.4).addScaledVector(perp, -(width / 2 + 0.95));
  boat.position.set(bc2.x, 0, bc2.z);
  boat.rotation.y = yaw + 0.12;
  group.add(boat);
  terrain.addObstacle(bc2.x, bc2.z, 0.75, 0.5);
  const boatBase = { x: bc2.x, z: bc2.z, yaw: boat.rotation.y };

  // dock walk points for hungry crabs / gulls
  const dockBase = start.clone();
  const dockEnd = start.clone().addScaledVector(dir, length + platform * 0.5); dockEnd.y = deckY;

  return {
    group, perches, lanternLight, glassMat, winMat, lanternPos, hutWindowPos, boat, boatBase,
    dockBase, dockEnd, deckY, dockDir: dir, dockPerp: perp, dockLen: length + platform, platform, dockStart: start,
    /** Is (x,z) on the dock deck? */
    onDock(x, z) {
      const dx = x - start.x, dz = z - start.z;
      const along = dx * dir.x + dz * dir.z, across = dx * perp.x + dz * perp.z;
      if (along < -0.2 || along > length + platform) return false;
      return Math.abs(across) < (along > length ? platform / 2 : width / 2);
    },
    dispose() { disposables.forEach(d => d.dispose && d.dispose()); },
  };
}

function buildBoat(rng, hullMat, seatMat, disposables) {
  const L = 2.6, Wd = 0.95, Dp = 0.42;
  const nu = 18, nv = 8;
  const pos = [], idx = [];
  for (let i = 0; i <= nu; i++) {
    const u = i / nu, x = (u - 0.5) * L;
    const taper = Math.pow(Math.sin(Math.PI * (0.06 + u * 0.88)), 0.55) * (u > 0.5 ? 1 - Math.pow((u - 0.5) * 2, 3) * 0.35 : 1);
    const sheer = Dp * (1 + Math.pow(Math.abs(u - 0.5) * 2, 2) * 0.35);
    for (let j = 0; j <= nv; j++) {
      const a = j / nv * Math.PI; // 0..π across the bottom
      const z = Math.cos(a) * Wd / 2 * taper;
      const y = sheer - Math.sin(a) * Dp * (0.6 + 0.4 * taper) - Dp * 0.6;
      pos.push(x, y + 0.25, z);
    }
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * (nv + 1) + j, b = a + 1, c = a + nv + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hull.setIndex(idx);
  hull.computeVertexNormals();
  const uv = new Float32Array(pos.length / 3 * 2);
  for (let k = 0; k < pos.length / 3; k++) { uv[k * 2] = pos[k * 3] / L + 0.5; uv[k * 2 + 1] = pos[k * 3 + 1] * 2; }
  hull.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const paint = new THREE.MeshStandardMaterial({ color: 0x2f7fa8, roughness: 0.6 });
  const inner = new THREE.MeshStandardMaterial({ color: 0xd8c6a2, roughness: 0.8, side: THREE.BackSide });
  addUnderwater(paint, { key: 'boat' });
  const g = new THREE.Group();
  const outer = new THREE.Mesh(hull, paint); outer.castShadow = true;
  const inside = new THREE.Mesh(hull, inner);
  g.add(outer, inside);
  const seatGeo = new THREE.BoxGeometry(0.22, 0.05, 0.85);
  for (const x of [-0.45, 0.4]) { const s = new THREE.Mesh(seatGeo, seatMat); s.position.set(x, 0.33, 0); s.castShadow = true; g.add(s); }
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 5, 40), new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.6 }));
  rim.scale.set(L * 0.5, Wd * 0.5, 1); rim.rotation.x = Math.PI / 2; rim.position.y = 0.43;
  g.add(rim);
  disposables.push(hull, paint, inner, seatGeo, rim.geometry, rim.material);
  return g;
}
