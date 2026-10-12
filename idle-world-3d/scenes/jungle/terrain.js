// Ground, pond basin, the waterfall cliff (with plateau), boulders and fallen logs.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, createNoise, makeRng } from '../../lib/util.js';

export const WATER_Y = -0.25;
export const POND = { cx: 0.3, cz: -3.3, rx: 6.7, rzFront: 4.3, rzBack: 5.9 };
export const FALL = { x: -0.4, lipY: 9.1, lipZ: -9.55, width: 2.6 };

export function createLayout(seed) {
  const n = createNoise(seed);
  const n2 = createNoise(seed + 77);
  const cliffZ = x => -9.0 + 0.032 * x * x + 0.45 * n.noise2(x * 0.14, 3.3);
  const cliffH = x => {
    let h = 9.0 - 0.009 * x * x + 1.0 * n.fbm2(x * 0.09, 8.1, 3);
    h -= 1.25 * Math.exp(-Math.pow((x - FALL.x) / 1.9, 2)); // waterfall notch
    return Math.max(h, 3.5);
  };
  // the waterfall lip sits on the rim of the notch
  FALL.lipY = cliffH(FALL.x) - 0.28;
  FALL.lipZ = cliffZ(FALL.x) - 0.08;
  const pondD = (x, z) => {
    const dx = (x - POND.cx) / POND.rx;
    const dz = (z - POND.cz) / (z < POND.cz ? POND.rzBack : POND.rzFront);
    const a = Math.atan2(dz, dx);
    const rr = 1 + 0.09 * n2.noise2(Math.cos(a) * 1.4 + 5, Math.sin(a) * 1.4 + 5) + 0.04 * Math.sin(a * 3 + 1);
    return Math.hypot(dx, dz) / rr;
  };
  const groundH = (x, z) => {
    let h = n.fbm2(x * 0.07 + 11, z * 0.07 - 4, 3) * 0.4 + n.noise2(x * 0.35, z * 0.35) * 0.06;
    const side = Math.max(0, Math.abs(x) - 12);
    h += side * side * 0.035;
    h += Math.max(0, z - 14) * 0.12;
    // low bank ridge around the pond
    const d = pondD(x, z);
    h += 0.18 * Math.exp(-Math.pow((d - 1.18) / 0.15, 2));
    const s = smoothstep(0.45, 1.12, d);
    const bottom = WATER_Y - 1.35 + n.fbm2(x * 0.25, z * 0.25, 2) * 0.3;
    h = lerp(bottom, h, s);
    // plunge pool under the waterfall
    const px = x - FALL.x, pz = z - (FALL.lipZ + 2.1);
    h -= 1.0 * Math.exp(-(px * px * 0.12 + pz * pz * 0.25)) * (1 - s * 0.5);
    // dip under the cliff so water meets the rock face
    const cz = cliffZ(x);
    if (z < cz + 1.5 && Math.abs(x - FALL.x) < 7) h = Math.min(h, lerp(WATER_Y - 0.6, h, smoothstep(cz - 0.5, cz + 1.5, z) * smoothstep(3, 7, Math.abs(x - FALL.x))));
    return h;
  };
  /** Is (x,z) open water (with margin)? */
  const inPond = (x, z, margin = 0) => groundH(x, z) < WATER_Y - margin;
  return { noise: n, cliffZ, cliffH, pondD, groundH, inPond };
}

/* ------------------------------------------------------------------ */
/* Terrain mesh                                                         */
/* ------------------------------------------------------------------ */
export function buildTerrain(L, q, rng) {
  const W = 84, D = 48, x0 = -42, z0 = -17;
  const sx = Math.round(168 * Math.sqrt(q)), sz = Math.round(96 * Math.sqrt(q));
  const geo = new THREE.PlaneGeometry(W, D, sx, sz);
  geo.rotateX(-Math.PI / 2);
  geo.translate(x0 + W / 2, 0, z0 + D / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const uv = geo.attributes.uv;
  const n = L.noise;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = L.groundH(x, z);
    pos.setY(i, h);
    uv.setXY(i, x / 3.2, z / 3.2);
    // vertex tint: mossy patches, wet mud at the shore, darker pebbly bottom
    const m = n.fbm2(x * 0.18 + 40, z * 0.18, 3) * 0.5 + 0.5;
    let r = 1, g = 1, b = 1;
    const moss = smoothstep(0.45, 0.7, m);
    r = lerp(r, 0.62, moss); g = lerp(g, 1.2, moss); b = lerp(b, 0.45, moss);
    // mossy carpet on the damp ground around the pond
    const dP = L.pondD(x, z);
    const damp = Math.exp(-Math.pow((dP - 1.35) / 0.35, 2)) * smoothstep(0.3, 0.6, m + 0.2);
    r = lerp(r, 0.55, damp * 0.85); g = lerp(g, 1.25, damp * 0.85); b = lerp(b, 0.4, damp * 0.85);
    const shore = Math.exp(-Math.pow((h - WATER_Y - 0.05) / 0.18, 2));
    r = lerp(r, 0.55, shore * 0.7); g = lerp(g, 0.5, shore * 0.7); b = lerp(b, 0.42, shore * 0.7);
    if (h < WATER_Y) {
      const dep = WATER_Y - h;
      const peb = n.noise2(x * 2.3, z * 2.3) * 0.5 + 0.5;
      r = lerp(0.85, 0.55, smoothstep(0, 1.2, dep)) * (0.85 + peb * 0.3);
      g = lerp(0.85, 0.62, smoothstep(0, 1.2, dep)) * (0.85 + peb * 0.3);
      b = lerp(0.62, 0.48, smoothstep(0, 1.2, dep)) * (0.85 + peb * 0.3);
    }
    col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/* ------------------------------------------------------------------ */
/* Cliff with a plateau on top                                          */
/* ------------------------------------------------------------------ */
export function buildCliff(L, q, seed) {
  const n = createNoise(seed + 3);
  const NX = Math.round(150 * Math.sqrt(q)), NF = Math.round(56 * Math.sqrt(q)), NT = 14;
  const xMin = -25, xMax = 25;
  const rows = NF + NT + 1;
  const cols = NX + 1;
  const pos = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  const colr = new Float32Array(rows * cols * 3);
  const base = -1.8;
  for (let i = 0; i < cols; i++) {
    const u = i / NX;
    const x0 = lerp(xMin, xMax, u);
    const cz = L.cliffZ(x0), H = L.cliffH(x0);
    // outward direction of the arc (toward the clearing), from the derivative of cliffZ
    const dzdx = (L.cliffZ(x0 + 0.1) - L.cliffZ(x0 - 0.1)) / 0.2;
    const nxo = -dzdx, nzo = 1; const nl = Math.hypot(nxo, nzo);
    const ox = nxo / nl, oz = nzo / nl;
    const nearFall = Math.exp(-Math.pow((x0 - FALL.x) / 3.0, 2));
    let arc = 0, crev = 0;
    for (let j = 0; j < rows; j++) {
      crev = 0;
      const k = (j * cols + i);
      let x, y, z, vv;
      if (j <= NF) {
        const t = j / NF;
        y = base + t * (H - base);
        // face displacement: big bulges, fracture columns, strata ledges, blocky chunks, overhang at the top
        const big = n.fbm2(x0 * 0.1, y * 0.1, 3) * 1.25;
        const fxc = x0 * 0.62 + n.noise2(x0 * 0.21, y * 0.07) * 0.9;
        const colv = Math.abs(Math.sin(fxc * Math.PI));
        const columns = Math.pow(colv, 0.3) * 0.5;
        const strata = y * 0.42 + n.noise2(x0 * 0.13, y * 0.2) * 0.7;
        const fr = strata - Math.floor(strata);
        const ledge = smoothstep(0.72, 0.97, fr) * 0.55;
        const blocks = Math.floor((n.noise2(x0 * 0.28, y * 0.22) * 0.5 + 0.5) * 4) / 4 * 0.45;
        const ridge = (1 - Math.abs(n.noise2(x0 * 0.7, y * 0.16))) * 0.18;
        const top = smoothstep(H - 2.2, H, y);
        let d = big + columns + ledge + blocks + ridge + top * 0.55 - 0.75;
        d -= nearFall * 1.2 * smoothstep(-1, 2, y); // recess behind the falling water
        d -= t * 0.6; // slight backward lean
        crev = (1 - Math.pow(colv, 0.5)) * 0.8 + (1 - smoothstep(0.0, 0.25, fr)) * 0.35;
        x = x0 + ox * d; z = cz + oz * d; vv = y;
        if (j === NF) arc = 0;
      } else {
        // plateau going back from the rim
        const tt = (j - NF) / NT;
        const back = Math.pow(tt, 1.4) * 26;
        const yTop = H + 0.25 * smoothstep(0, 0.15, tt) + n.fbm2(x0 * 0.1, back * 0.1 + 20, 3) * 0.8 * smoothstep(0, 0.3, tt) + back * 0.05;
        const dRim = 0.6 - 0.7 * nearFall;
        x = x0 + ox * (dRim - back); z = cz + oz * (dRim - back); y = yTop;
        vv = H + back;
        // the stream feeding the waterfall: a shallow channel at the notch
        y -= 0.45 * Math.exp(-Math.pow((x0 - FALL.x) / 1.3, 2)) * smoothstep(0.0, 0.08, tt);
      }
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      uv[k * 2] = x0 / 3.5; uv[k * 2 + 1] = vv / 3.5;
      // vertex color: wet dark near the waterfall and base, water stains, darker crevices, warm/cool rock
      const wet = Math.max(nearFall * smoothstep(H + 1, 0, y) * 0.9, smoothstep(1.2, -0.5, y) * 0.55);
      const stain = smoothstep(0.55, 0.9, n.noise2(x0 * 1.3, y * 0.05 + 40) * 0.5 + 0.5) * smoothstep(H, H - 4, y) * 0.5;
      const warm = n.noise2(x0 * 0.08 + 9, y * 0.1) * 0.5 + 0.5;
      const v = (0.95 + n.noise2(x0 * 0.3, y * 0.4) * 0.15) * (1 - clamp(crev, 0, 1) * 0.55) * (1 - stain * 0.5);
      colr[k * 3] = v * lerp(0.95, 1.08, warm) * lerp(1.0, 0.42, wet); colr[k * 3 + 1] = v * lerp(0.98, 0.98, warm) * lerp(1.0, 0.47, wet); colr[k * 3 + 2] = v * lerp(1.02, 0.86, warm) * lerp(1.0, 0.5, wet);
    }
  }
  const idx = [];
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Sample points on the cliff face with their outward normals (for plants and vines). */
export function sampleCliff(geo, rng, count, { minY = 0.5, maxNy = 0.6, minNy = -0.2 } = {}) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const out = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 60) {
    const i = Math.floor(rng.next() * pos.count);
    const y = pos.getY(i), ny = nor.getY(i);
    if (y < minY || ny > maxNy || ny < minNy) continue;
    if (Math.abs(pos.getX(i) - FALL.x) < 2.2 && y < FALL.lipY + 0.5) continue;
    out.push({ p: new THREE.Vector3(pos.getX(i), y, pos.getZ(i)), n: new THREE.Vector3(nor.getX(i), ny, nor.getZ(i)).normalize() });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Boulders                                                             */
/* ------------------------------------------------------------------ */
export function buildBoulder(seed, detail = 3, { flat = 0.35, rough = 0.28 } = {}) {
  const n = createNoise(seed);
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const d = 1 + n.fbm3(v.x * 1.3, v.y * 1.3, v.z * 1.3, 4) * rough + (1 - Math.abs(n.noise3(v.x * 3, v.y * 3, v.z * 3))) * 0.06;
    v.multiplyScalar(d);
    v.y *= v.y < 0 ? flat * 0.6 : 1 - flat;
    // facet-ish flattening for a weathered look
    pos.setXYZ(i, v.x * 1.15, v.y, v.z);
  }
  geo.deleteAttribute('uv');
  // planar uv
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { uvs[i * 2] = pos.getX(i) * 0.6 + pos.getZ(i) * 0.4; uvs[i * 2 + 1] = pos.getY(i) * 0.6; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return geo;
}

/* ------------------------------------------------------------------ */
/* Fallen log                                                           */
/* ------------------------------------------------------------------ */
export function buildLog(seed, { length = 7, r0 = 0.55, r1 = 0.42 } = {}) {
  const n = createNoise(seed);
  const NS = 40, NR = 22;
  const pos = [], uv = [], col = [], idx = [];
  for (let j = 0; j <= NS; j++) {
    const t = j / NS;
    const x = (t - 0.5) * length;
    const r = lerp(r0, r1, t) * (1 + 0.08 * n.noise2(t * 6, 1));
    const sag = Math.sin(t * Math.PI) * 0.12;
    for (let i = 0; i <= NR; i++) {
      const a = (i / NR) * TAU;
      const bump = 1 + n.noise2(t * 14, i * 0.7) * 0.06 + (1 - Math.abs(Math.sin(a * 5 + t * 3))) * 0.03;
      // broken jagged ends
      let rr = r * bump;
      const endT = Math.min(t, 1 - t);
      if (endT < 0.03) rr *= 0.7 + 0.3 * Math.abs(n.noise2(i * 0.9, t * 30));
      pos.push(x, Math.sin(a) * rr - sag, Math.cos(a) * rr);
      uv.push(i / NR * 2, t * length / 2.5);
      const top = Math.max(0, Math.sin(a));
      col.push(lerp(1, 0.75, top), lerp(1, 1.1, top), lerp(1, 0.6, top));
    }
  }
  for (let j = 0; j < NS; j++) for (let i = 0; i < NR; i++) {
    const a = j * (NR + 1) + i, b = a + 1, c = a + NR + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // end caps (rough rings)
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}
