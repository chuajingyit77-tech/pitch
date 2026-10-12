// 芒原 · built props: Myōjin torii, hokora shrine, Kasuga stone lanterns, rocks, fried tofu.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, clamp, lerp, smoothstep, patchMaterial } from '../../lib/util.js';
import { addFog } from './sky.js';

const shadowed = (m, cast = true, receive = true) => { m.castShadow = cast; m.receiveShadow = receive; return m; };

/** Box with many segments along X, bent upward at the ends (sori) and optionally flared at the top. */
function soriBox(L, H, D, { sori = 0.12, pow = 2.4, topFlare = 1.0, endSlant = 0.0, seg = 32 } = {}) {
  const g = new THREE.BoxGeometry(L, H, D, seg, 2, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const top = (y + H / 2) / H; // 0 bottom .. 1 top
    z *= lerp(1, topFlare, top);
    if (Math.abs(Math.abs(x) - L / 2) < 1e-4) x *= 1 + endSlant * (top - 0.5);
    y += sori * Math.pow(Math.abs(x) / (L / 2), pow);
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

export function makeStoneMaterial(maps, fogU, tint = '#a39d90') {
  const m = new THREE.MeshStandardMaterial({ color: tint, map: maps.map, normalMap: maps.normalMap, roughness: 0.92, metalness: 0, envMapIntensity: 0.35 });
  m.normalScale.set(1.4, 1.4);
  // moss / lichen on upward faces
  patchMaterial(m, {
    key: 'stoneMoss',
    vertexHeader: 'varying vec3 vWN;',
    fragmentHeader: 'varying vec3 vWN;',
    vertex: { '#include <beginnormal_vertex>': '$&\n vWN = normalize(mat3(modelMatrix) * objectNormal);' },
    fragment: { '#include <map_fragment>': '$&\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.3, 0.16), smoothstep(0.8, 0.99, vWN.y) * 0.3);' },
  });
  return addFog(m, fogU, 'mfogStone');
}

/* ------------------------------------------------------------------ */
/* Torii (Myōjin style, vermilion with black kasagi)                   */
/* ------------------------------------------------------------------ */
export function buildTorii({ fogU, lacquerMap, plaqueMap, stoneMat, heightAt }) {
  const g = new THREE.Group();
  const red = addFog(new THREE.MeshStandardMaterial({ color: '#c8361e', roughness: 0.4, metalness: 0, map: lacquerMap, envMapIntensity: 0.8 }), fogU, 'mfogRed');
  const black = addFog(new THREE.MeshStandardMaterial({ color: '#16110f', roughness: 0.34, metalness: 0, envMapIntensity: 0.7 }), fogU, 'mfogBlk');
  const plaqueMat = addFog(new THREE.MeshStandardMaterial({ color: '#ffffff', map: plaqueMap, roughness: 0.35, envMapIntensity: 0.6, emissive: '#000000', emissiveMap: plaqueMap }), fogU, 'mfogPlq');
  const span = 2.75, base = 0.32, pillarH = 3.55, rB = 0.175, rT = 0.148, lean = 0.022;
  const yTop = base + pillarH;
  const redGeos = [], blackGeos = [];
  const put = (geo, x, y, z, rz = 0, ry = 0, rx = 0) => { geo.rotateX(rx); geo.rotateZ(rz); geo.rotateY(ry); geo.translate(x, y, z); return geo; };
  for (const s of [-1, 1]) {
    const x = s * span / 2;
    const gy = heightAt ? heightAt(x, 0) : 0;
    // pillar from below ground to the top, leaning inward
    const h = pillarH + base - gy + 0.3;
    const pg = new THREE.CylinderGeometry(rT, rB, h, 32, 1);
    pg.translate(0, h / 2, 0);
    pg.rotateZ(s * lean);
    pg.translate(x + s * Math.sin(lean) * 0, gy - 0.3, 0);
    redGeos.push(pg);
    // black nemaki band and stone base
    blackGeos.push(put(new THREE.CylinderGeometry(rB + 0.028, rB + 0.034, 0.5, 32), x, gy + base + 0.25, 0));
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.36, 0.5, 8), stoneMat);
    st.position.set(x, gy + base - 0.25 + 0.02, 0);
    g.add(shadowed(st));
    // daiwa ring at the top
    const topX = x - s * Math.sin(lean) * (yTop - gy + 0.3);
    redGeos.push(put(new THREE.CylinderGeometry(rT + 0.04, rT + 0.04, 0.16, 32), topX, yTop - 0.06, 0));
    // kusabi wedges on the nuki
    blackGeos.push(put(new THREE.BoxGeometry(0.07, 0.22, 0.16), x - s * Math.sin(lean) * (2.82 - gy) + s * (rB + 0.05), 2.82, 0));
  }
  // nuki (tie beam), passes through the pillars
  redGeos.push(put(new THREE.BoxGeometry(span + 0.9, 0.2, 0.13, 8, 1, 1), 0, 2.82, 0));
  // shimaki (vermilion) and kasagi (black) with upswept ends
  redGeos.push(put(soriBox(span + 1.35, 0.22, 0.3, { sori: 0.12, pow: 2.2, seg: 40 }), 0, yTop + 0.13, 0));
  blackGeos.push(put(soriBox(span + 2.05, 0.25, 0.42, { sori: 0.22, pow: 2.3, topFlare: 1.14, endSlant: 0.12, seg: 48 }), 0, yTop + 0.36, 0));
  blackGeos.push(put(soriBox(span + 2.15, 0.05, 0.47, { sori: 0.24, pow: 2.3, seg: 48 }), 0, yTop + 0.505, 0));
  // gakuzuka (centre strut)
  const gH = (yTop + 0.02) - (2.92);
  redGeos.push(put(new THREE.BoxGeometry(0.2, gH, 0.12), 0, 2.92 + gH / 2, 0));
  const redMesh = shadowed(new THREE.Mesh(mergeGeometries(redGeos), red));
  const blackMesh = shadowed(new THREE.Mesh(mergeGeometries(blackGeos), black));
  g.add(redMesh, blackMesh);
  // plaque (gaku)
  const plaque = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.54, 0.05), [black, black, black, black, plaqueMat, black]);
  plaque.position.set(0, 2.92 + gH / 2 + 0.02, 0.1);
  plaque.rotation.x = -0.1;
  g.add(shadowed(plaque));
  g.userData.plaqueMat = plaqueMat;
  g.userData.pillars = [-span / 2, span / 2];
  return g;
}

/* ------------------------------------------------------------------ */
/* Hokora: small wooden shrine on a stone plinth, with shimenawa       */
/* ------------------------------------------------------------------ */
export function buildHokora({ fogU, woodMap, roofMap, stoneMat, shideMap }) {
  const g = new THREE.Group();
  const wood = addFog(new THREE.MeshStandardMaterial({ map: woodMap, color: '#b8a898', roughness: 0.85, envMapIntensity: 0.4 }), fogU, 'mfogWood');
  const roof = addFog(new THREE.MeshStandardMaterial({ map: roofMap, color: '#d0c8c0', roughness: 0.9, envMapIntensity: 0.35 }), fogU, 'mfogRoof');
  const red = addFog(new THREE.MeshStandardMaterial({ color: '#b8301c', roughness: 0.5, envMapIntensity: 0.6 }), fogU, 'mfogRed2');
  const door = addFog(new THREE.MeshStandardMaterial({ color: '#1a120e', roughness: 0.6, emissive: '#ff9a40', emissiveIntensity: 0 }), fogU, 'mfogDoor');
  const straw = addFog(new THREE.MeshStandardMaterial({ color: '#c9b27a', roughness: 0.95, envMapIntensity: 0.3 }), fogU, 'mfogStraw');
  const paper = addFog(new THREE.MeshLambertMaterial({ map: shideMap, alphaTest: 0.5, side: THREE.DoubleSide, color: '#ffffff' }), fogU, 'mfogPaper');
  const add = (geo, mat, x, y, z) => { const m = shadowed(new THREE.Mesh(geo, mat)); m.position.set(x, y, z); g.add(m); return m; };
  add(new THREE.BoxGeometry(1.5, 0.7, 1.25), stoneMat, 0, 0.0, 0);
  add(new THREE.BoxGeometry(1.15, 0.2, 0.95), stoneMat, 0, 0.45, 0);
  add(new THREE.BoxGeometry(0.78, 0.72, 0.6), wood, 0, 0.91, 0);
  // front posts and door
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.07, 0.78, 0.07), red, s * 0.37, 0.94, 0.31);
  add(new THREE.BoxGeometry(0.62, 0.06, 0.06), red, 0, 1.3, 0.32);
  add(new THREE.BoxGeometry(0.6, 0.06, 0.06), red, 0, 0.6, 0.32);
  const doorM = add(new THREE.BoxGeometry(0.52, 0.54, 0.02), door, 0, 0.94, 0.305);
  for (let i = -2; i <= 2; i++) add(new THREE.BoxGeometry(0.018, 0.54, 0.03), red, i * 0.1, 0.94, 0.315);
  // nagare-zukuri roof: long front slope, short back slope
  const front = add(new THREE.BoxGeometry(1.12, 0.06, 0.78), roof, 0, 1.43, 0.3);
  front.rotation.x = 0.42;
  const back = add(new THREE.BoxGeometry(1.12, 0.06, 0.5), roof, 0, 1.47, -0.2);
  back.rotation.x = -0.5;
  add(new THREE.BoxGeometry(1.2, 0.08, 0.1), wood, 0, 1.58, 0.0);
  for (const s of [-1, 1]) { const k = add(new THREE.CylinderGeometry(0.035, 0.035, 0.34, 8), wood, s * 0.3, 1.64, 0); k.rotation.x = Math.PI / 2; }
  // shimenawa rope and shide
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.42, 1.3, 0.38), new THREE.Vector3(0, 1.22, 0.42), new THREE.Vector3(0.42, 1.3, 0.38)]);
  add(new THREE.TubeGeometry(curve, 16, 0.035, 8, false), straw, 0, 0, 0);
  for (const x of [-0.22, 0, 0.22]) {
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.22), paper);
    sh.position.set(x, 1.11, 0.43);
    g.add(sh);
  }
  g.userData.doorMat = door;
  void doorM;
  return g;
}

/* ------------------------------------------------------------------ */
/* Kasuga-style stone lantern (tōrō)                                    */
/* ------------------------------------------------------------------ */
export function buildLantern({ stoneMat, windowMat }) {
  const g = new THREE.Group();
  const add = (geo, mat, y) => { const m = shadowed(new THREE.Mesh(geo, mat)); m.position.y = y; g.add(m); return m; };
  add(new THREE.CylinderGeometry(0.3, 0.35, 0.3, 6), stoneMat, 0.0);
  add(new THREE.CylinderGeometry(0.2, 0.29, 0.1, 6), stoneMat, 0.2);
  add(new THREE.CylinderGeometry(0.085, 0.105, 0.64, 14), stoneMat, 0.57);
  add(new THREE.CylinderGeometry(0.27, 0.16, 0.14, 6), stoneMat, 0.95);
  const box = add(new THREE.CylinderGeometry(0.175, 0.175, 0.3, 6, 1), [windowMat, stoneMat, stoneMat], 1.17);
  box.castShadow = false;
  // roof with upturned corners
  const roofG = new THREE.CylinderGeometry(0.05, 0.4, 0.2, 6, 2);
  const p = roofG.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), r = Math.hypot(p.getX(i), p.getZ(i));
    if (y < -0.05 && r > 0.3) p.setY(i, y + 0.06);
  }
  roofG.computeVertexNormals();
  add(roofG, stoneMat, 1.42);
  add(new THREE.CylinderGeometry(0.07, 0.09, 0.06, 8), stoneMat, 1.55);
  const hj = add(new THREE.SphereGeometry(0.075, 12, 8), stoneMat, 1.63);
  hj.scale.y = 1.25;
  add(new THREE.ConeGeometry(0.04, 0.07, 8), stoneMat, 1.72);
  return g;
}

/* ------------------------------------------------------------------ */
/* Rocks: noise-displaced, flattened, merged into one mesh             */
/* ------------------------------------------------------------------ */
export function buildRocks({ rng, noise, list, heightAt, stoneMat }) {
  const geos = [];
  for (const r of list) {
    const geo = new THREE.IcosahedronGeometry(1, 3);
    const p = geo.attributes.position;
    const ph = rng.range(0, 100);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const d = 1 + noise.fbm3(x * 1.3 + ph, y * 1.3, z * 1.3, 4) * 0.35 + Math.abs(noise.noise3(x * 3 + ph, y * 3, z * 3)) * 0.08;
      p.setXYZ(i, x * d, Math.max(y * d, -0.35), z * d);
    }
    geo.computeVertexNormals();
    geo.scale(r.s * rng.range(0.9, 1.25), r.s * rng.range(0.6, 0.95), r.s * rng.range(0.8, 1.1));
    geo.rotateY(rng.range(0, TAU));
    geo.translate(r.x, heightAt(r.x, r.z) + r.s * 0.12, r.z);
    // planar-ish uv for the tiling stone texture
    const uv = [];
    for (let i = 0; i < p.count; i++) uv.push(p.getX(i) * 0.5 + p.getY(i) * 0.3, p.getZ(i) * 0.5 + p.getY(i) * 0.2);
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geos.push(geo);
  }
  const mesh = shadowed(new THREE.Mesh(mergeGeometries(geos), stoneMat));
  return mesh;
}

/* ------------------------------------------------------------------ */
/* Fried tofu (aburaage) offering                                      */
/* ------------------------------------------------------------------ */
export function makeTofuFactory({ maps, fogU }) {
  const geo = new RoundedBoxGeometry(0.27, 0.11, 0.17, 3, 0.04);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const puff = 1 + 0.12 * (1 - Math.min(1, (x * x) / 0.018 + (z * z) / 0.0072));
    p.setY(i, y > 0 ? y * puff : y);
  }
  geo.computeVertexNormals();
  const mat = addFog(new THREE.MeshStandardMaterial({ map: maps.map, bumpMap: maps.bumpMap, bumpScale: 2.0, color: '#ffffff', roughness: 0.48, metalness: 0, envMapIntensity: 0.9, emissive: '#ff9a30', emissiveIntensity: 0.0 }), fogU, 'mfogTofu');
  return { geo, mat, make: () => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; } };
}
