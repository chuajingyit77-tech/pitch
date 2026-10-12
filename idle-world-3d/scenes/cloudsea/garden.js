// 云海 · 蟠桃园: floating karst islets with velvet lawns, the immortal peach tree, a tai-chi
// terrace, pavilion, tower, gate and bridge, mist-falls, and shan-shui peaks in the haze.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, clamp, lerp, smoothstep, createNoise, addWind, canvasTexture } from '../../lib/util.js';
import { patchStd, SHARED_GLSL, CLOUD_TOP } from './common.js';
import { Builder, archMaterials, pavilion, tower, gate, bridge, balustrade, plaqueGeometry, createLanterns, roofGeometry, paint, xf, COL } from './arch.js';

const _c = new THREE.Color(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */
const ROCK_HEADER = /* glsl */`
uniform sampler2D tRock;
uniform float uBump, uBumpScale, uMossAmt, uStrata;
float triRock(vec3 p, vec3 n, out vec3 wn){
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  vec3 q = p * uBumpScale;
  vec4 tx = texture2D(tRock, q.zy * vec2(1.0, 0.45)), ty = texture2D(tRock, q.xz), tz = texture2D(tRock, q.xy * vec2(1.0, 0.45));
  vec3 nx = vec3((tx.xy * 2.0 - 1.0) * uBump, 1.0), ny = vec3((ty.xy * 2.0 - 1.0) * uBump, 1.0), nz = vec3((tz.xy * 2.0 - 1.0) * uBump, 1.0);
  nx = vec3(nx.xy + n.zy, abs(nx.z) * n.x);
  ny = vec3(ny.xy + n.xz, abs(ny.z) * n.y);
  nz = vec3(nz.xy + n.xy, abs(nz.z) * n.z);
  wn = normalize(nx.zyx * w.x + ny.xzy * w.y + nz.xyz * w.z);
  return tx.a * w.x + ty.a * w.y + tz.a * w.z;
}
`;
/** Karst rock / bark: vertex colours + triplanar normal map (vertically stretched), strata, moss. */
export function rockMaterial(shared, tex, { bump = 0.8, scale = 0.1, moss = 0.5, strata = 1, roughness = 0.92, key = 'rock' } = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0 });
  return patchStd(m, shared, {
    key,
    uniforms: { tRock: { value: tex.rock }, uBump: { value: bump }, uBumpScale: { value: scale }, uMossAmt: { value: moss }, uStrata: { value: strata } },
    fragmentHeader: ROCK_HEADER,
    fragment: {
      '#include <color_fragment>': /* glsl */`$&
        vec3 wN0 = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
        vec3 rockN;
        float rh = triRock(vWPos, wN0, rockN);
        float band = sin(vWPos.y * 1.6 + rh * 3.0) * 0.5 + 0.5;
        diffuseColor.rgb *= mix(1.0, 0.84 + 0.26 * band, uStrata * (1.0 - abs(wN0.y))) * (0.78 + 0.44 * rh);
        float mossy = smoothstep(0.45, 0.85, rockN.y + (rh - 0.5) * 0.6) * uMossAmt;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.26, 0.37, 0.18) * (0.7 + 0.6 * rh), mossy * 0.75);
      `,
      '#include <normal_fragment_maps>': /* glsl */`$&
        normal = normalize((viewMatrix * vec4(rockN, 0.0)).xyz);
      `,
      '#include <lights_fragment_end>': /* glsl */`$&
        reflectedLight.indirectDiffuse += diffuseColor.rgb * uBounce * 0.35 * max(-wN0.y, 0.0);
      `,
    },
  });
}

/** Velvet lawn: soft colour patches, a fuzzy sheen at grazing angles, gentle undulation. */
function lawnMaterial(shared, tex) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0, envMapIntensity: 1.6 });
  return patchStd(m, shared, {
    key: 'lawn',
    uniforms: { tNoise: { value: tex.noise }, tDetail: { value: tex.detail.tex } },
    fragmentHeader: 'uniform sampler2D tNoise; uniform sampler2D tDetail;',
    fragment: {
      '#include <color_fragment>': /* glsl */`$&
        vec4 nz = texture2D(tNoise, vWPos.xz * 0.045);
        vec4 nz2 = texture2D(tNoise, vWPos.xz * 0.21);
        float patchv = nz.r * 0.6 + nz2.g * 0.4;
        vec3 lawnA = vec3(0.25, 0.43, 0.16), lawnB = vec3(0.42, 0.58, 0.22), lawnC = vec3(0.68, 0.68, 0.32);
        vec3 lawn = mix(lawnA, lawnB, smoothstep(0.25, 0.8, patchv));
        lawn = mix(lawn, lawnC, smoothstep(0.62, 0.92, nz2.b) * 0.35);
        // vertex colours are linear: lawn ~(0.08,0.2,0.03), soil ~(0.16,0.1,0.06)
        float isLawn = smoothstep(0.03, 0.11, vColor.g - vColor.r * 0.6);
        diffuseColor.rgb = mix(diffuseColor.rgb, lawn * (0.85 + 0.3 * vColor.g), isLawn);
      `,
      '#include <normal_fragment_maps>': /* glsl */`$&
        {
          vec4 d = texture2D(tDetail, vWPos.xz * 0.22);
          vec3 wn = normalize(vec3(-(d.g - 0.5) * 0.9, 1.0, -(d.b - 0.5) * 0.9));
          vec3 vn = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
          normal = normalize(mix(normal, vn, 0.5 * isLawn));
        }
      `,
      '#include <lights_fragment_end>': /* glsl */`$&
        {
          vec3 Vw = normalize(cameraPosition - vWPos);
          vec3 Nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          float sheen = pow(1.0 - clamp(dot(Nw, Vw), 0.0, 1.0), 3.0);
          float lit = clamp(dot(Nw, uLightDir) * 0.7 + 0.3, 0.0, 1.0);
          float back = pow(max(dot(-Vw, uLightDir), 0.0), 3.0);
          // velvet: a soft bright fuzz at grazing angles, warm glow through the blades against the sun
          reflectedLight.indirectDiffuse += diffuseColor.rgb * uLightCol * (sheen * 1.4 * lit + back * 1.1 + 0.12) * isLawn;
          reflectedLight.indirectDiffuse += vec3(0.9, 1.0, 0.7) * (uAmbient * (sheen * 0.8 + 0.3) + uBounce * 0.15) * isLawn;
          // soft sky fill so shaded lawn stays a gentle blue-green instead of going black
          reflectedLight.indirectDiffuse += diffuseColor.rgb * (uAmbient * 1.2 + uBounce * 0.45) * isLawn;
        }
      `,
    },
  });
}

/** Foliage-like translucent material (tufts, blossoms). */
function softMaterial(shared, opts, { key = 'soft', trans = 0.6, wrap = 0.35 } = {}) {
  const m = new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.9, metalness: 0 }, opts));
  return patchStd(m, shared, {
    key,
    fragment: {
      '#include <lights_fragment_end>': /* glsl */`$&
        {
          vec3 Vw = normalize(cameraPosition - vWPos);
          vec3 Nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          float bl = pow(max(dot(-Vw, uLightDir), 0.0), 2.5);
          float wr = clamp((dot(Nw, uLightDir) + ${wrap.toFixed(2)}) / ${(1 + wrap).toFixed(2)}, 0.0, 1.0);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * uLightCol * (bl * ${trans.toFixed(2)} + wr * 0.18);
        }
      `,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Islets: lawn top + karst underside                                  */
/* ------------------------------------------------------------------ */
export function makeIslet(rng, { radius = 10, depth = 18, nT = 44, nA = 88, lobes = 3, rock = ['#aaa596', '#848c88', '#5c6470'] } = {}) {
  const noise = createNoise(rng.int(1, 1e9));
  const ph = rng.range(0, TAU), ph2 = rng.range(0, TAU);
  const rimR = a => radius * (1 + 0.08 * Math.sin(a * 2 + ph) + 0.05 * Math.sin(a * 3 + ph2) + 0.05 * noise.noise2(Math.cos(a) * 1.3, Math.sin(a) * 1.3));
  const topY = (x, z) => {
    const r = Math.hypot(x, z) / radius;
    return 0.3 * (1 - r * r) + 0.22 * noise.fbm2(x * 0.08, z * 0.08, 3);
  };
  const tTop = 0.36, tRim = 0.46, lip = Math.min(1.0, radius * 0.1);
  const lobePh = rng.range(0, TAU);
  const lawn = new THREE.Color('#4f7a2c'), lawnEdge = new THREE.Color('#5d7a34'), soil = new THREE.Color('#6e5a46');
  const rockA = new THREE.Color(rock[0]), rockB = new THREE.Color(rock[1]), rockC = new THREE.Color(rock[2]);
  const grid = [];  // [ring][a] -> {x,y,z,c}
  for (let i = 0; i <= nT; i++) {
    const t = i / nT, row = [];
    for (let j = 0; j < nA; j++) {
      const a = (j / nA) * TAU, R = rimR(a), ca = Math.cos(a), sa = Math.sin(a);
      const lob = Math.pow(Math.max(0, Math.cos(lobes * a + lobePh)), 2);
      let r, y; const c = new THREE.Color();
      if (t <= tTop) {
        r = (t / tTop) * R; y = topY(ca * r, sa * r);
        c.copy(lawn).lerp(lawnEdge, smoothstep(0.7, 1, t / tTop));
      } else if (t <= tRim) {
        const s = (t - tTop) / (tRim - tTop), ang = s * Math.PI * 0.5;
        r = R + Math.sin(ang) * lip * 0.3; y = topY(ca * R, sa * R) - (1 - Math.cos(ang)) * lip;
        c.copy(lawnEdge).lerp(soil, smoothstep(0.35, 0.95, s));
      } else {
        const s = (t - tRim) / (1 - tRim);
        const depthHere = depth * (0.7 + 0.42 * lob) * (0.9 + 0.2 * noise.noise2(ca * 2, sa * 2));
        const prof = Math.pow(1 - s, 0.8 + 0.6 * lob) * (1 + 0.1 * Math.sin(s * Math.PI));
        r = (R + lip * 0.3) * prof * (1 - 0.2 * (1 - lob) * s);
        y = topY(ca * R, sa * R) - lip - s * depthHere;
        const n3 = noise.fbm3(ca * 2.2, y * 0.15, sa * 2.2, 4);
        const gully = Math.abs(noise.noise2(a * 7, y * 0.04));
        r *= 1 + 0.15 * n3 - 0.08 * gully + 0.035 * Math.sin(y * 1.7 + n3 * 3);
        const band = 0.5 + 0.5 * Math.sin(y * 1.1 + n3 * 4);
        c.copy(rockA).lerp(rockB, band * 0.6).lerp(rockC, smoothstep(0.2, 1.0, s) * 0.8);
        c.lerp(soil, smoothstep(0.1, 0.0, s) * 0.6);
      }
      row.push({ x: ca * r, y, z: sa * r, c });
    }
    grid.push(row);
  }
  function build(i0, i1, withCenter, withTip) {
    const pos = [], col = [], idx = [];
    let base = 0;
    if (withCenter) { pos.push(0, topY(0, 0), 0); col.push(lawn.r, lawn.g, lawn.b); base = 1; }
    for (let i = i0; i <= i1; i++) for (const v of grid[i]) { pos.push(v.x, v.y, v.z); col.push(v.c.r, v.c.g, v.c.b); }
    if (withCenter) for (let j = 0; j < nA; j++) idx.push(0, base + (j + 1) % nA, base + j);
    for (let i = 0; i < i1 - i0; i++) {
      const a0 = base + i * nA, a1 = base + (i + 1) * nA;
      for (let j = 0; j < nA; j++) { const j1 = (j + 1) % nA; idx.push(a0 + j, a0 + j1, a1 + j, a0 + j1, a1 + j1, a1 + j); }
    }
    if (withTip) {
      const tip = pos.length / 3; pos.push(0, -depth * 1.02, 0); col.push(rockC.r, rockC.g, rockC.b);
      const last = base + (i1 - i0) * nA;
      for (let j = 0; j < nA; j++) idx.push(last + j, last + (j + 1) % nA, tip);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  const iTop = Math.round(tRim * nT);
  const top = build(1, iTop, true, false);
  const side = build(iTop, nT, false, true);
  return { top, side, topY, rimR, radius, depth };
}

/* ------------------------------------------------------------------ */
/* Gnarled tubes                                                       */
/* ------------------------------------------------------------------ */
function gnarledTube(noise, pts, r0, r1, { radial = 9, segs = 12, flare = 0, twist = 1.5, lobe = 0.16, seed = 0, barkA, barkB, lichen } = {}) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], col = [], idx = [];
  const P = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, P);
    let r = lerp(r0, r1, Math.pow(t, 0.75)) * (1 + flare * Math.exp(-t * 9));
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * TAU + t * twist;
      const n = noise.noise2(Math.cos(a) * 1.2 + seed, t * 4 + Math.sin(a) * 1.2 + seed);
      const k = 1 + lobe * (n + 0.35 * Math.sin(3 * a + seed)) + (flare ? flare * 0.5 * Math.exp(-t * 12) * Math.pow(Math.max(0, Math.sin(4 * a + seed)), 2) : 0);
      const rr = r * k;
      pos.push(P.x + (N.x * Math.cos(a) + B.x * Math.sin(a)) * rr, P.y + (N.y * Math.cos(a) + B.y * Math.sin(a)) * rr, P.z + (N.z * Math.cos(a) + B.z * Math.sin(a)) * rr);
      const ridge = 0.5 + 0.5 * Math.sin(a * 7 + t * 9 + n * 3);
      _c.copy(barkA).lerp(barkB, ridge * 0.6 + n * 0.2);
      if (lichen) _c.lerp(lichen, smoothstep(0.35, 0.8, noise.noise2(a * 1.5 + seed * 3, t * 6)) * 0.45);
      col.push(_c.r, _c.g, _c.b);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * radial + j, b = i * radial + (j + 1) % radial, c = (i + 1) * radial + j, d = (i + 1) * radial + (j + 1) % radial;
    idx.push(a, c, b, b, c, d);
  }
  // cap the end
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, curve };
}

/* ------------------------------------------------------------------ */
/* Textures                                                            */
/* ------------------------------------------------------------------ */
function blossomTexture(seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  return canvasTexture(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const flower = (x, y, r, rot, open) => {
      for (let k = 0; k < 5; k++) {
        const a = rot + (k / 5) * TAU;
        g.save(); g.translate(x, y); g.rotate(a);
        const grd = g.createRadialGradient(0, -r * 0.2, r * 0.05, 0, -r * 0.55, r * 0.75);
        grd.addColorStop(0, '#d9416b'); grd.addColorStop(0.35, '#f59ab4'); grd.addColorStop(1, '#ffe8ef');
        g.fillStyle = grd;
        g.beginPath(); g.ellipse(0, -r * 0.55 * open, r * 0.42, r * 0.58, 0, 0, TAU); g.fill();
        g.restore();
      }
      g.fillStyle = '#b8204e'; g.beginPath(); g.arc(x, y, r * 0.16, 0, TAU); g.fill();
      for (let k = 0; k < 9; k++) {
        const a = rnd() * TAU, d = r * (0.18 + rnd() * 0.22);
        g.strokeStyle = 'rgba(250,210,120,0.9)'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); g.stroke();
        g.fillStyle = '#ffd65a'; g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 1.8, 0, TAU); g.fill();
      }
    };
    // a small twig with flowers and buds
    g.strokeStyle = '#4a2c24'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(30, 230); g.quadraticCurveTo(110, 150, 220, 40); g.stroke();
    const spots = [[70, 180, 34], [128, 128, 40], [178, 82, 34], [96, 104, 28], [168, 160, 30], [210, 52, 22], [52, 132, 22]];
    for (const [x, y, r] of spots) flower(x, y, r, rnd() * TAU, 0.95 + rnd() * 0.1);
    for (let k = 0; k < 4; k++) { const x = 40 + rnd() * 180, y = 40 + rnd() * 180; g.fillStyle = '#e0507a'; g.beginPath(); g.ellipse(x, y, 7, 10, rnd() * 3, 0, TAU); g.fill(); }
  }, { srgb: true });
}

function taijiTexture() {
  return canvasTexture(512, 512, (g, w) => {
    const c = w / 2;
    g.fillStyle = '#e9e3d4'; g.fillRect(0, 0, w, w);
    // carved rings
    g.strokeStyle = '#b9b1a0'; g.lineWidth = 6;
    for (const r of [248, 236, 168, 150]) { g.beginPath(); g.arc(c, c, r, 0, TAU); g.stroke(); }
    // trigrams (八卦)
    const tri = ['111', '011', '101', '001', '110', '010', '100', '000'];
    g.fillStyle = '#54606a';
    for (let i = 0; i < 8; i++) {
      g.save(); g.translate(c, c); g.rotate((i / 8) * TAU);
      for (let k = 0; k < 3; k++) {
        const y = -224 + k * 20;
        if (tri[i][k] === '1') g.fillRect(-34, y, 68, 12);
        else { g.fillRect(-34, y, 29, 12); g.fillRect(5, y, 29, 12); }
      }
      g.restore();
    }
    // yin-yang
    const R = 140;
    g.fillStyle = '#e9e3d4'; g.beginPath(); g.arc(c, c, R, 0, TAU); g.fill();
    g.fillStyle = '#3d4a52';
    g.beginPath(); g.arc(c, c, R, -Math.PI / 2, Math.PI / 2); g.arc(c, c + R / 2, R / 2, Math.PI / 2, -Math.PI / 2, true); g.arc(c, c - R / 2, R / 2, Math.PI / 2, -Math.PI / 2, false); g.fill();
    g.fillStyle = '#e9e3d4'; g.beginPath(); g.arc(c, c + R / 2, R / 7, 0, TAU); g.fill();
    g.fillStyle = '#3d4a52'; g.beginPath(); g.arc(c, c - R / 2, R / 7, 0, TAU); g.fill();
    g.strokeStyle = '#c9a24a'; g.lineWidth = 5; g.beginPath(); g.arc(c, c, R + 3, 0, TAU); g.stroke();
  });
}

/* ------------------------------------------------------------------ */
/* Peach tree                                                          */
/* ------------------------------------------------------------------ */
function peachTree(rng, noise, origin) {
  const barkA = new THREE.Color('#3f2f28'), barkB = new THREE.Color('#6d5a4c'), lichen = new THREE.Color('#7d8a62');
  const tubes = [], clusters = [], perches = [], tips = [];
  const O = origin;
  // trunk: short, massive, twisting, with buttress roots
  const tp = [];
  let p = new THREE.Vector3(0, -0.6, 0);
  let dir = new THREE.Vector3(rng.range(-0.2, 0.2), 1, rng.range(-0.2, 0.2)).normalize();
  for (let i = 0; i <= 5; i++) {
    tp.push(p.clone());
    dir.x += rng.range(-0.35, 0.35); dir.z += rng.range(-0.35, 0.35); dir.y = 1; dir.normalize();
    p.addScaledVector(dir, 0.46);
  }
  const trunk = gnarledTube(noise, tp.map(v => v.clone().add(O)), 0.95, 0.6, { radial: 16, segs: 16, flare: 1.1, twist: 3.2, lobe: 0.28, seed: rng.range(0, 50), barkA, barkB, lichen });
  tubes.push(trunk.geo);
  // roots spreading over the lawn
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + rng.range(-0.3, 0.3);
    const pts = [new THREE.Vector3(0, 0.35, 0), new THREE.Vector3(Math.cos(a) * 0.9, 0.05, Math.sin(a) * 0.9), new THREE.Vector3(Math.cos(a) * 1.8, -0.12, Math.sin(a) * 1.8 + rng.range(-0.3, 0.3))].map(v => v.add(O));
    tubes.push(gnarledTube(noise, pts, 0.32, 0.06, { radial: 7, segs: 6, lobe: 0.18, seed: rng.range(0, 50), barkA, barkB }).geo);
  }
  const top = tp[tp.length - 1].clone().add(O);
  function grow(start, d, len, r0, r1, depth) {
    const pts = [start.clone()];
    const q = start.clone(), dd = d.clone();
    const n = 4;
    for (let i = 1; i <= n; i++) {
      dd.x += rng.range(-0.35, 0.35); dd.z += rng.range(-0.35, 0.35); dd.y += rng.range(-0.2, 0.25) - (depth === 0 ? 0.06 : 0.02);
      dd.normalize();
      q.addScaledVector(dd, len / n);
      pts.push(q.clone());
    }
    const tb = gnarledTube(noise, pts, r0, r1, { radial: depth === 0 ? 10 : depth === 1 ? 7 : 5, segs: depth === 0 ? 10 : 7, twist: 1.2, lobe: depth === 0 ? 0.16 : 0.1, seed: rng.range(0, 50), barkA, barkB, lichen: depth < 2 ? lichen : null });
    tubes.push(tb.geo);
    if (depth === 1) for (let k = 1; k <= 3; k++) perches.push(tb.curve.getPointAt(0.25 + k * 0.2).add(new THREE.Vector3(0, r0 * 0.8, 0)));
    if (depth < 2) {
      const kids = depth === 0 ? rng.int(2, 3) : rng.int(2, 3);
      for (let k = 0; k < kids; k++) {
        const t = rng.range(depth === 0 ? 0.45 : 0.5, 1.0);
        const s = tb.curve.getPointAt(t);
        const side = new THREE.Vector3().crossVectors(dd, new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(rng.sign() * rng.range(0.5, 1.1));
        const nd = dd.clone().add(side).add(new THREE.Vector3(0, rng.range(0.15, 0.6), 0)).normalize();
        grow(s, nd, len * rng.range(0.5, 0.68), lerp(r0, r1, t) * 0.85, r1 * 0.4, depth + 1);
      }
      if (depth === 1) clusters.push({ c: pts[pts.length - 1].clone().add(new THREE.Vector3(0, 0.2, 0)), r: rng.range(0.9, 1.25) });
    } else {
      clusters.push({ c: pts[pts.length - 1].clone().add(new THREE.Vector3(0, 0.15, 0)), r: rng.range(0.75, 1.15) });
      tips.push(pts[pts.length - 1]);
    }
  }
  const limbs = rng.int(4, 5);
  const a0 = rng.range(0, TAU);
  for (let i = 0; i < limbs; i++) {
    const a = a0 + (i / limbs) * TAU + rng.range(-0.3, 0.3);
    const el = rng.range(0.25, 0.7);
    const d = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
    grow(top.clone().add(new THREE.Vector3(0, rng.range(-0.6, 0), 0)), d, rng.range(3.6, 4.8), 0.5, 0.17, 0);
  }
  // a crown cluster above the fork
  clusters.push({ c: top.clone().add(new THREE.Vector3(0, 2.2, 0)), r: 1.5 });
  return { bark: mergeGeometries(tubes), clusters, perches, tips, top };
}

/* ------------------------------------------------------------------ */
/* Build the garden                                                    */
/* ------------------------------------------------------------------ */
export function createGarden(env, shared, tex, wind) {
  const rng = env.rng.fork('garden');
  const q = env.q;
  const group = new THREE.Group();
  const noise = createNoise(rng.int(1, 1e9));
  const pickables = [], colliders = [], casters = [], bobbers = [];
  const walk = [];              // walkable islets: { obj (Object3D or null), islet, pos: Vector3 }
  const shadows = env.shadows;

  const rockMat = rockMaterial(shared, tex, { key: 'karst', bump: 0.9, scale: 0.075, moss: 0.55 });
  const barkMat = rockMaterial(shared, tex, { key: 'bark', bump: 1.0, scale: 0.55, moss: 0.25, strata: 0, roughness: 0.95 });
  const lawnMat = lawnMaterial(shared, tex);
  const am = archMaterials(shared, tex);

  /* ---- main islet ---- */
  const MAIN_R = 12.5;
  const main = makeIslet(rng, { radius: MAIN_R, depth: 22, nT: Math.round(lerp(32, 56, q)), nA: Math.round(lerp(64, 120, q)), lobes: 3 });
  const mainTop = new THREE.Mesh(main.top, lawnMat), mainSide = new THREE.Mesh(main.side, rockMat);
  for (const m of [mainTop, mainSide]) { m.castShadow = shadows; m.receiveShadow = shadows; group.add(m); pickables.push(m); }
  walk.push({ islet: main, pos: new THREE.Vector3(), main: true });
  colliders.push({ c: new THREE.Vector3(0, -5, 0), r: MAIN_R + 2.5 }, { c: new THREE.Vector3(0, -15, 0), r: MAIN_R * 0.6 + 2 });
  casters.push(new THREE.Vector4(0, -7, 0, MAIN_R * 0.95));
  const tY = (x, z) => main.topY(x, z);

  const reserved = [];
  const B = new Builder();

  // the immortal peach tree
  const treePos = new THREE.Vector3(-2.2, 0, 0.9); treePos.y = tY(treePos.x, treePos.z);
  const tree = peachTree(rng, noise, treePos);
  const treeMesh = new THREE.Mesh(tree.bark, barkMat);
  treeMesh.castShadow = shadows; treeMesh.receiveShadow = shadows;
  group.add(treeMesh);
  reserved.push({ x: treePos.x, z: treePos.z, r: 2.2 });
  colliders.push({ c: tree.top.clone().add(new THREE.Vector3(0, 2, 0)), r: 5.2 });

  // tai-chi terrace in front of the tree
  const taiji = new THREE.Vector3(2.7, 0, 0.1); taiji.y = tY(taiji.x, taiji.z) + 0.02;
  const terrace = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.45, 0.32, 48), am.jadeMat);
  paint(terrace.geometry, COL.jade, { ao: 0.3 });
  terrace.position.set(taiji.x, taiji.y + 0.08, taiji.z);
  terrace.receiveShadow = shadows;
  group.add(terrace);
  const taijiTex = taijiTexture();
  const taijiMat = patchStd(new THREE.MeshStandardMaterial({ map: taijiTex, roughness: 0.88 }), shared, { key: 'taiji' });
  const taijiTop = new THREE.Mesh(new THREE.CircleGeometry(2.28, 48).rotateX(-Math.PI / 2), taijiMat);
  taijiTop.position.set(taiji.x, taiji.y + 0.245, taiji.z);
  taijiTop.rotation.y = 0;
  taijiTop.receiveShadow = shadows;
  group.add(taijiTop);
  const taijiFloor = taiji.y + 0.25;
  reserved.push({ x: taiji.x, z: taiji.z, r: 2.7 });
  pickables.push(terrace);

  // stone lanterns flanking the terrace
  const stoneLanternGlow = [];
  for (const s of [-1, 1]) {
    const x = taiji.x + 1.2, z = taiji.z + s * 3.2, y = tY(x, z);
    B.push(x, y, z, 0);
    B.add('jade', xf(paint(new THREE.BoxGeometry(0.62, 0.22, 0.62), '#bdb8aa', { ao: 0.3 }), 0, 0.11, 0));
    B.add('jade', xf(paint(new THREE.CylinderGeometry(0.12, 0.16, 0.9, 8), '#c4bfb1'), 0, 0.67, 0));
    B.add('jade', xf(paint(new THREE.BoxGeometry(0.5, 0.1, 0.5), '#bdb8aa'), 0, 1.15, 0));
    for (const k of [[0.2, 0.2], [-0.2, 0.2], [0.2, -0.2], [-0.2, -0.2]]) B.add('jade', xf(paint(new THREE.BoxGeometry(0.08, 0.36, 0.08), '#c4bfb1'), k[0], 1.38, k[1]));
    const r = roofGeometry([[-0.42, -0.42], [0.42, -0.42], [0.42, 0.42], [-0.42, 0.42]].reverse(), { height: 0.32, K: 5, lift: 0.12, flare: 0.06, seg: 4, thick: 0.06, tile: '#b9b4a6', under: '#8d887c', fascia: '#a8a396' });
    r.roof.translate(0, 1.56, 0);
    B.add('roof', r.roof);
    B.add('jade', xf(paint(new THREE.SphereGeometry(0.09, 10, 8), '#c4bfb1'), 0, 1.98, 0));
    stoneLanternGlow.push(B.point(0, 1.37, 0));
    B.pop();
    reserved.push({ x, z, r: 0.7 });
  }

  // the pavilion on the far side, opening toward the centre
  const pavPos = new THREE.Vector3(-5.6, 0, -6.6); pavPos.y = tY(pavPos.x, pavPos.z) - 0.1;
  const pavOpen = Math.atan2(-pavPos.x, -pavPos.z);
  B.push(pavPos.x, pavPos.y, pavPos.z, 0);
  const pav = pavilion(B, { openAngle: pavOpen });
  B.pop();
  reserved.push({ x: pavPos.x, z: pavPos.z, r: 4.2 });
  colliders.push({ c: new THREE.Vector3(pavPos.x, pavPos.y + 4, pavPos.z), r: 4.5 });

  // white-jade balustrade along part of the rim (the scenic edge)
  const rimPts = [];
  const rimA0 = rng.range(-1.2, -0.7);
  for (let i = 0; i <= 10; i++) {
    const a = rimA0 + i * 0.13, R = main.rimR(a) - 0.7;
    const x = Math.cos(a) * R, z = Math.sin(a) * R;
    rimPts.push(new THREE.Vector3(x, tY(x, z) - 0.05, z));
    reserved.push({ x, z, r: 0.6 });
  }
  balustrade(B, rimPts, { h: 0.78, every: 1.1 });

  // red lanterns hanging from the lower boughs of the peach tree
  {
    const ps = tree.perches.slice().sort((p1, p2) => p1.y - p2.y);
    const picked = [];
    for (const pp of ps) { if (picked.length >= 5) break; if (picked.every(o => o.distanceTo(pp) > 2.2) && pp.y > treePos.y + 2.4) picked.push(pp); }
    for (const pp of picked) B.lantern(pp.x, pp.y - 0.15, pp.z, 0.75);
  }

  /* ---- tower islet, joined by an arched bridge ---- */
  const islA = makeIslet(rng, { radius: 6.8, depth: 14, nT: Math.round(lerp(22, 36, q)), nA: Math.round(lerp(40, 72, q)), lobes: 2 });
  const aDir = rng.range(2.35, 2.75);
  const A = new THREE.Vector3(Math.cos(aDir) * 27, rng.range(-0.5, 1.5), Math.sin(aDir) * 27);
  const aTop = new THREE.Mesh(islA.top, lawnMat), aSide = new THREE.Mesh(islA.side, rockMat);
  for (const m of [aTop, aSide]) { m.position.copy(A); m.castShadow = shadows; m.receiveShadow = shadows; group.add(m); pickables.push(m); }
  walk.push({ islet: islA, pos: A });
  colliders.push({ c: A.clone().add(new THREE.Vector3(0, -3, 0)), r: 9.5 }, { c: A.clone().add(new THREE.Vector3(0, 6, 0)), r: 6.5 });
  casters.push(new THREE.Vector4(A.x, A.y - 4, A.z, 6.5));
  const towerOpen = Math.atan2(-A.x, -A.z);
  B.push(A.x, A.y + islA.topY(0, 0) - 0.1, A.z, 0);
  tower(B, { openAngle: towerOpen });
  B.pop();
  // bridge between rims
  const dirMA = new THREE.Vector3(A.x, 0, A.z).normalize();
  const angM = Math.atan2(dirMA.z, dirMA.x), angA = Math.atan2(-dirMA.z, -dirMA.x);
  const bA = dirMA.clone().multiplyScalar(main.rimR(angM) - 1.2); bA.y = tY(bA.x, bA.z) + 0.05;
  const bB = A.clone().addScaledVector(dirMA, -(islA.rimR(angA) - 1.0)); bB.y = A.y + islA.topY(-dirMA.x * 5.5, -dirMA.z * 5.5) + 0.05;
  bridge(B, bA, bB, { width: 1.8, rise: 2.4 });
  for (let i = 0; i < 6; i++) { const t = i / 5; reserved.push({ x: lerp(bA.x, bB.x, t * 0.25), z: lerp(bA.z, bB.z, t * 0.25), r: 1.6 }); }

  /* ---- gate islet, reached by floating stepping stones ---- */
  const islB = makeIslet(rng, { radius: 5.2, depth: 11, nT: Math.round(lerp(20, 32, q)), nA: Math.round(lerp(36, 64, q)), lobes: 2 });
  const bDir = aDir + rng.range(1.7, 2.2);
  const Bp = new THREE.Vector3(Math.cos(bDir) * 26, rng.range(2.5, 4.5), Math.sin(bDir) * 26);
  const bTop = new THREE.Mesh(islB.top, lawnMat), bSide = new THREE.Mesh(islB.side, rockMat);
  for (const m of [bTop, bSide]) { m.position.copy(Bp); m.castShadow = shadows; m.receiveShadow = shadows; group.add(m); pickables.push(m); }
  walk.push({ islet: islB, pos: Bp });
  colliders.push({ c: Bp.clone().add(new THREE.Vector3(0, -2, 0)), r: 7.5 }, { c: Bp.clone().add(new THREE.Vector3(0, 4, 0)), r: 5 });
  casters.push(new THREE.Vector4(Bp.x, Bp.y - 3, Bp.z, 5));
  const plaque = plaqueGeometry();
  const gateYaw = Math.atan2(-Bp.x, -Bp.z);
  B.push(Bp.x, Bp.y + islB.topY(0, 0) - 0.05, Bp.z, gateYaw);
  gate(B, plaque.geo);
  B.pop();
  // stepping stones arcing from the main islet toward the gate
  const dirMB = new THREE.Vector3(Bp.x, 0, Bp.z).normalize();
  const sStart = dirMB.clone().multiplyScalar(main.rimR(Math.atan2(dirMB.z, dirMB.x)) + 0.6); sStart.y = tY(sStart.x * 0.9, sStart.z * 0.9) - 0.15;
  const sEnd = Bp.clone().addScaledVector(dirMB, -(islB.rimR(Math.atan2(-dirMB.z, -dirMB.x)) + 0.5)); sEnd.y = Bp.y + islB.topY(0, 0) - 0.15;
  const stepStones = [];
  const nSteps = 8;
  for (let i = 0; i < nSteps; i++) {
    const t = (i + 0.5) / nSteps;
    const pnt = sStart.clone().lerp(sEnd, t);
    pnt.y += Math.sin(t * Math.PI) * 0.8;
    const side = new THREE.Vector3(-dirMB.z, 0, dirMB.x).multiplyScalar(Math.sin(t * TAU * 1.5) * 0.6);
    pnt.add(side);
    stepStones.push({ p: pnt, ph: rng.range(0, TAU), s: rng.range(0.85, 1.15) });
  }

  // step stones (instanced, bobbing)
  let stoneGeo = new THREE.CylinderGeometry(0.75, 0.55, 0.45, 10, 1);
  stoneGeo = paint(stoneGeo, '#b8b2a3', { ao: 0.4 });
  const stepMesh = new THREE.InstancedMesh(stoneGeo, am.jadeMat, nSteps);
  stepMesh.castShadow = shadows;
  group.add(stepMesh);

  /* ---- mist falls ---- */
  const mistFalls = [];
  const fallA = rng.range(-0.55, -0.25);
  const fallDir = new THREE.Vector3(Math.cos(fallA), 0, Math.sin(fallA));
  const lip = fallDir.clone().multiplyScalar(main.rimR(fallA) + 0.15); lip.y = tY(fallDir.x * (MAIN_R - 1), fallDir.z * (MAIN_R - 1)) - 0.12;
  mistFalls.push({ lip, dir: fallDir, height: 36, w0: 1.4, w1: 8 });
  const fallB = angA + rng.range(0.9, 1.4);
  const fbDir = new THREE.Vector3(Math.cos(fallB), 0, Math.sin(fallB));
  const lipB = A.clone().addScaledVector(fbDir, islA.rimR(fallB) + 0.1); lipB.y = A.y + islA.topY(fbDir.x * 6, fbDir.z * 6) - 0.1;
  mistFalls.push({ lip: lipB, dir: fbDir, height: 28, w0: 1.0, w1: 5.5 });
  // a small spring channel feeding the main fall
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1.35, 32).rotateX(-Math.PI / 2), patchStd(new THREE.MeshStandardMaterial({ color: '#4a7f86', roughness: 0.08, metalness: 0.0, envMapIntensity: 1.3 }), shared, { key: 'pool' }));
  const poolC = fallDir.clone().multiplyScalar(main.rimR(fallA) - 2.6); poolC.y = tY(poolC.x, poolC.z) + 0.06;
  pool.position.copy(poolC);
  group.add(pool);
  reserved.push({ x: poolC.x, z: poolC.z, r: 2.0 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU + rng.range(-0.08, 0.08);
    if (Math.cos(a - fallA) > 0.9) continue; // the spill gap toward the edge
    const r = 1.45 + rng.range(-0.05, 0.08);
    B.add('jade', xf(paint(new THREE.IcosahedronGeometry(rng.range(0.22, 0.34), 1), '#b9b4a6', { ao: 0.3 }), poolC.x + Math.cos(a) * r, poolC.y + 0.02, poolC.z + Math.sin(a) * r, 0, rng.range(0, 3), 0, 1.3, 0.7, 1.1));
  }
  const lotusParts = [];
  for (let i = 0; i < 6; i++) {
    const a = rng.range(0, TAU), r = rng.range(0.2, 1.0);
    const pad = new THREE.CircleGeometry(rng.range(0.16, 0.26), 12, 0.3, TAU - 0.4).rotateX(-Math.PI / 2).rotateY(rng.range(0, TAU));
    lotusParts.push(paint(pad, '#3f7a35').translate(poolC.x + Math.cos(a) * r, poolC.y + 0.03, poolC.z + Math.sin(a) * r));
    if (i < 3) {
      for (let k = 0; k < 7; k++) {
        const pg = new THREE.SphereGeometry(0.07, 8, 6); pg.scale(0.55, 1.5, 0.3); pg.translate(0, 0.08, 0.04); pg.rotateX(-0.35 - (k % 2) * 0.35); pg.rotateY((k / 7) * TAU);
        lotusParts.push(paint(pg, k % 2 ? '#ffd6e2' : '#f7a8c0').translate(poolC.x + Math.cos(a) * r, poolC.y + 0.05, poolC.z + Math.sin(a) * r));
      }
    }
  }
  group.add(new THREE.Mesh(mergeGeometries(lotusParts), softMaterial(shared, { vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }, { key: 'lotus', trans: 0.6 })));

  /* ---- merged architecture meshes ---- */
  const archMeshes = [];
  for (const [bucket, mat] of [['paint', am.paintMat], ['jade', am.jadeMat], ['roof', am.roofMat], ['gold', am.goldMat]]) {
    if (!B.b[bucket].length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(B.b[bucket]), mat);
    mesh.castShadow = shadows; mesh.receiveShadow = shadows;
    group.add(mesh); archMeshes.push(mesh); pickables.push(mesh);
  }
  for (const ex of B.extras) {
    const mesh = new THREE.Mesh(ex.geo, patchStd(new THREE.MeshStandardMaterial({ map: plaque.tex, roughness: 0.45, emissive: new THREE.Color('#ffd27a'), emissiveMap: plaque.tex, emissiveIntensity: 0.15 }), shared, { key: 'plaque' }));
    mesh.applyMatrix4(ex.matrix);
    group.add(mesh);
  }
  const lanterns = createLanterns(shared, B.lanterns);
  for (const m of lanterns.meshes) group.add(m);
  // stone lantern flames
  const flameGeo = mergeGeometries(stoneLanternGlow.map(p => new THREE.BoxGeometry(0.24, 0.24, 0.24).translate(p.x, p.y, p.z)));
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.6, 0.25) });
  group.add(new THREE.Mesh(flameGeo, flameMat));
  /* ---- soft lawn dressing: moss tufts and flowers ---- */
  function scatter(islet, ox, oy, oz, count, minR, accept) {
    const out = [];
    for (let k = 0; k < count * 6 && out.length < count; k++) {
      const a = rng.range(0, TAU), rr = Math.sqrt(rng.next()) * islet.rimR(a) * 0.93;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (accept && !accept(x, z)) continue;
      out.push(new THREE.Vector3(x + ox, islet.topY(x, z) + oy, z + oz));
    }
    return out;
  }
  const freeMain = (x, z) => !reserved.some(r => Math.hypot(r.x - x, r.z - z) < r.r);
  // tufts: rounded moss cushions
  let tuftGeo;
  {
    const lumps = [];
    for (const [x, z, r] of [[0, 0, 1], [0.7, 0.25, 0.72], [-0.55, 0.45, 0.68], [0.1, -0.7, 0.62], [-0.45, -0.4, 0.55]]) {
      let g = new THREE.IcosahedronGeometry(r, q >= 0.9 ? 2 : 1);
      g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mergeVertices(g);
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        _p.fromBufferAttribute(p, i);
        const k = 1 + 0.12 * noise.noise3(_p.x * 3 + x, _p.y * 3, _p.z * 3 + z);
        p.setXYZ(i, _p.x * k + x, Math.max(_p.y, -0.2 * r) * 0.78 * k + 0.16 * r, _p.z * k + z);
      }
      lumps.push(g);
    }
    tuftGeo = mergeGeometries(lumps);
    const p = tuftGeo.getAttribute('position'), col = new Float32Array(p.count * 3);
    const base = new THREE.Color('#3a6326'), tip = new THREE.Color('#9cbc54');
    for (let i = 0; i < p.count; i++) {
      _c.copy(base).lerp(tip, smoothstep(0.0, 0.95, p.getY(i)));
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    }
    tuftGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    tuftGeo.computeVertexNormals();
  }
  const tuftMat = softMaterial(shared, { vertexColors: true, roughness: 0.95 }, { key: 'tuft', trans: 0.35, wrap: 0.4 });
  addWind(tuftMat, wind, { height: 0.6, amount: 0.03, stiffness: 1.5, key: 'tuftwind' });
  // tufts gather around the feet of things (stones, roots, rails) and in a few soft drifts
  const nearThings = (x, z) => {
    if (!freeMain(x, z)) return false;
    let best = 1e9;
    for (const r of reserved) best = Math.min(best, Math.hypot(r.x - x, r.z - z) - r.r);
    const rim = Math.hypot(x, z) > main.rimR(Math.atan2(z, x)) * 0.86;
    return best < 0.9 || rim || noise.noise2(x * 0.2 + 7, z * 0.2) > 0.55;
  };
  const tuftPts = [
    ...scatter(main, 0, 0, 0, Math.round(140 * q + 50), 0, nearThings),
    ...scatter(islA, A.x, A.y, A.z, Math.round(30 * q + 10), 0, (x, z) => Math.hypot(x, z) > 3.6),
    ...scatter(islB, Bp.x, Bp.y, Bp.z, Math.round(20 * q + 8), 0, (x, z) => Math.abs(x) > 1.0 || Math.abs(z) > 3.8),
  ];
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, tuftPts.length);
  tuftPts.forEach((p, i) => {
    const s = rng.range(0.13, 0.3) * (rng.chance(0.12) ? 1.5 : 1);
    _q.setFromEuler(_e.set(0, rng.range(0, TAU), 0));
    _m.compose(_p.set(p.x, p.y - 0.05, p.z), _q, _s.set(s * rng.range(0.9, 1.3), s * rng.range(0.9, 1.25), s * rng.range(0.9, 1.3)));
    tufts.setMatrixAt(i, _m);
    _c.setHSL(rng.range(0.16, 0.3), rng.range(0.25, 0.45), rng.range(0.78, 0.95));
    tufts.setColorAt(i, _c);
  });
  tufts.receiveShadow = shadows;
  group.add(tufts);
  // flowers: little five-petal blooms on short stems
  const petal = new THREE.CircleGeometry(0.05, 8); petal.scale(0.75, 1.2, 1); petal.translate(0, 0.05, 0);
  const fparts = [];
  for (let k = 0; k < 5; k++) { const g = petal.clone(); g.rotateX(-1.15); g.rotateY((k / 5) * TAU); fparts.push(paint(g, '#ffffff')); }
  fparts.push(paint(new THREE.SphereGeometry(0.022, 8, 6), '#ffcf4a').translate(0, 0.02, 0));
  const flowerGeo = mergeGeometries(fparts.map(g => g.translate(0, 0.16, 0)).concat([paint(new THREE.CylinderGeometry(0.006, 0.008, 0.16, 4), '#4f7a2c').translate(0, 0.08, 0)]));
  const flowerMat = softMaterial(shared, { vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }, { key: 'flower', trans: 0.7, wrap: 0.6 });
  addWind(flowerMat, wind, { height: 0.25, amount: 0.05, stiffness: 1.2, key: 'flowerwind' });
  // flowers bloom in soft drifts
  const drifts = (x, z) => freeMain(x, z) && noise.noise2(x * 0.16 + 3, z * 0.16) > -0.15;
  const flowerPts = scatter(main, 0, 0, 0, Math.round(260 * q + 80), 0, drifts).concat(scatter(islA, A.x, A.y, A.z, Math.round(36 * q + 8), 0, (x, z) => Math.hypot(x, z) > 3.8), scatter(islB, Bp.x, Bp.y, Bp.z, Math.round(20 * q + 6), 0, (x, z) => Math.abs(z) > 1.5));
  const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerPts.length);
  const fcols = ['#ffffff', '#ffd0de', '#fff0a8', '#e2d4ff', '#ffb8cc', '#fffaf0'].map(c => new THREE.Color(c));
  flowerPts.forEach((p, i) => {
    // flowers grow in drifts
    const s = rng.range(0.7, 1.35);
    _q.setFromEuler(_e.set(rng.range(-0.2, 0.2), rng.range(0, TAU), rng.range(-0.2, 0.2)));
    _m.compose(_p.set(p.x, p.y - 0.02, p.z), _q, _s.set(s, s, s));
    flowers.setMatrixAt(i, _m);
    const ci = Math.floor((noise.noise2(p.x * 0.15, p.z * 0.15) * 0.5 + 0.5) * fcols.length * 0.999);
    flowers.setColorAt(i, fcols[clamp(ci, 0, fcols.length - 1)]);
  });
  group.add(flowers);

  /* ---- blossoms & peaches on the tree ---- */
  const coreParts = [];
  const cardCount = Math.round(lerp(900, 2200, clamp((q - 0.45) / 0.55, 0, 1)));
  const perCluster = Math.max(10, Math.floor(cardCount / tree.clusters.length));
  const cardPos = [], cardNrm = [];
  const pinkA = new THREE.Color('#e88aa6'), pinkB = new THREE.Color('#ffd2de');
  for (const cl of tree.clusters) {
    const r = cl.r;
    let g = new THREE.IcosahedronGeometry(r * 0.78, 1);
    g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mergeVertices(g);
    const p = g.getAttribute('position'), col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      _p.fromBufferAttribute(p, i);
      const k = 1 + 0.22 * noise.noise3(_p.x * 1.4 + cl.c.x, _p.y * 1.4, _p.z * 1.4 + cl.c.z);
      p.setXYZ(i, _p.x * k + cl.c.x, _p.y * k * 0.78 + cl.c.y, _p.z * k + cl.c.z);
      _c.copy(pinkA).lerp(pinkB, smoothstep(-r, r, _p.y)).multiplyScalar(0.62 + 0.38 * smoothstep(-r, r, _p.y));
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    coreParts.push(g);
    for (let k = 0; k < perCluster; k++) {
      const d = new THREE.Vector3().randomDirection();
      d.y = d.y * 0.8 + 0.15; d.normalize();
      const rr = r * rng.range(0.72, 1.08);
      cardPos.push(cl.c.clone().addScaledVector(d, rr).setY(cl.c.y + d.y * rr * 0.8));
      cardNrm.push(d);
    }
  }
  const coreMat = softMaterial(shared, { vertexColors: true, roughness: 0.85 }, { key: 'blossomcore', trans: 0.65, wrap: 0.6 });
  const cores = new THREE.Mesh(mergeGeometries(coreParts), coreMat);
  cores.castShadow = shadows; cores.receiveShadow = shadows;
  group.add(cores);
  const blossomTex = blossomTexture(env.seed);
  const cardGeo = new THREE.PlaneGeometry(0.62, 0.62);
  const aN = new Float32Array(cardPos.length * 3);
  cardNrm.forEach((n, i) => { aN[i * 3] = n.x; aN[i * 3 + 1] = n.y; aN[i * 3 + 2] = n.z; });
  cardGeo.setAttribute('aCardN', new THREE.InstancedBufferAttribute(aN, 3));
  const cardMat = new THREE.MeshStandardMaterial({ map: blossomTex, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.8 });
  addWind(cardMat, wind, { height: 1, amount: 0.035, stiffness: 1.0, flutter: 0.012, key: 'cardwind' });
  patchStd(cardMat, shared, {
    key: 'blossomcard',
    vertexHeader: 'attribute vec3 aCardN;',
    // light every card with its cluster's outward direction (world space), ignoring the card's own spin
    vertex: { '#include <defaultnormal_vertex>': 'vec3 transformedNormal = normalize(normalMatrix * aCardN);' },
    fragment: {
      '#include <normal_fragment_begin>': '$&\n normal = normalize(vNormal);',
      '#include <lights_fragment_end>': /* glsl */`$&
        {
          vec3 Vw = normalize(cameraPosition - vWPos);
          float bl = pow(max(dot(-Vw, uLightDir), 0.0), 2.5);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * (uLightCol * (bl * 0.8 + 0.12) + uAmbient * 0.3);
        }
      `,
    },
  });
  const cards = new THREE.InstancedMesh(cardGeo, cardMat, cardPos.length);
  cardPos.forEach((p, i) => {
    _q.setFromEuler(_e.set(rng.range(0, TAU), rng.range(0, TAU), rng.range(0, TAU)));
    const s = rng.range(0.75, 1.25);
    _m.compose(p, _q, _s.set(s, s, s));
    cards.setMatrixAt(i, _m);
  });
  cards.castShadow = shadows;
  group.add(cards);
  // fruit hanging among the blossoms
  const peachSpots = [];
  for (const cl of tree.clusters) {
    const n = rng.chance(0.75) ? rng.int(1, 2) : 0;
    for (let k = 0; k < n; k++) {
      const a = rng.range(0, TAU);
      peachSpots.push(cl.c.clone().add(new THREE.Vector3(Math.cos(a) * cl.r * 0.75, -cl.r * rng.range(0.45, 0.8), Math.sin(a) * cl.r * 0.75)));
    }
  }

  /* ---- decorative floating islets (bobbing) ---- */
  const nSmall = q >= 0.7 ? 6 : 4;
  const baseAng = rng.range(0, TAU);
  for (let i = 0; i < nSmall; i++) {
    const a = baseAng + (i / nSmall) * TAU + rng.range(-0.3, 0.3);
    if (Math.abs(Math.atan2(Math.sin(a - aDir), Math.cos(a - aDir))) < 0.4 || Math.abs(Math.atan2(Math.sin(a - bDir), Math.cos(a - bDir))) < 0.4) continue;
    const dist = i < 2 ? rng.range(40, 60) : rng.range(70, 160);
    const R = i < 2 ? rng.range(2.4, 4) : rng.range(4, 8);
    const isl = makeIslet(rng, { radius: R, depth: R * rng.range(1.6, 2.4), nT: Math.round(lerp(16, 26, q)), nA: Math.round(lerp(26, 44, q)), lobes: rng.int(1, 3) });
    const holder = new THREE.Group();
    holder.position.set(Math.cos(a) * dist, rng.range(-10, 16), Math.sin(a) * dist);
    holder.add(new THREE.Mesh(isl.top, lawnMat), new THREE.Mesh(isl.side, rockMat));
    const kind = rng.pick(['pine', 'peach', 'rocks', 'peach', 'pine']);
    if (kind === 'peach') {
      const t = peachTree(rng, noise, new THREE.Vector3(0, isl.topY(0, 0), 0));
      holder.add(new THREE.Mesh(t.bark, barkMat));
      const parts = t.clusters.map(cl => new THREE.IcosahedronGeometry(cl.r * 0.95, 1).translate(cl.c.x, cl.c.y, cl.c.z));
      const g = paint(mergeGeometries(parts.map(p => { p.deleteAttribute('uv'); return p; })), '#f2a8bc');
      holder.add(new THREE.Mesh(g, coreMat));
      holder.scale.setScalar(0.55);
    } else if (kind === 'pine') {
      // a windswept pine: trunk + layered flat canopies (classic shan-shui)
      const pts = [new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0.4, 1.5, 0.1), new THREE.Vector3(1.4, 2.6, 0.3), new THREE.Vector3(2.4, 3.1, 0.2)];
      const tb = gnarledTube(noise, pts.map(v => v.add(new THREE.Vector3(0, isl.topY(0, 0), 0))), 0.22, 0.08, { radial: 7, segs: 8, lobe: 0.12, seed: rng.range(0, 9), barkA: new THREE.Color('#4a3a30'), barkB: new THREE.Color('#7a6655') });
      holder.add(new THREE.Mesh(tb.geo, barkMat));
      const pads = [];
      for (let k = 0; k < 4; k++) {
        const c = tb.curve.getPointAt(0.45 + k * 0.18);
        const g = new THREE.CylinderGeometry(rng.range(0.8, 1.3), rng.range(1.0, 1.5), 0.35, 9);
        g.translate(c.x + rng.range(-0.2, 0.4), c.y + 0.25, c.z + rng.range(-0.3, 0.3));
        pads.push(paint(g, '#2f5a36', { ao: 0.5, aoH: 1 }));
      }
      holder.add(new THREE.Mesh(mergeGeometries(pads), softMaterial(shared, { vertexColors: true, roughness: 0.9 }, { key: 'pine', trans: 0.3 })));
    } else {
      const rocks = [];
      for (let k = 0; k < 3; k++) { let g = new THREE.IcosahedronGeometry(rng.range(0.5, 1.1), 1); g = paint(g, '#9a9a90'); g.scale(1, rng.range(1.2, 2.2), 1); g.translate(rng.range(-1.5, 1.5), isl.topY(0, 0) + 0.6, rng.range(-1.5, 1.5)); rocks.push(g); }
      holder.add(new THREE.Mesh(mergeGeometries(rocks), rockMat));
    }
    group.add(holder);
    bobbers.push({ obj: holder, base: holder.position.y, amp: rng.range(0.3, 0.7), speed: rng.range(0.12, 0.25), phase: rng.range(0, TAU) });
    colliders.push({ c: holder.position.clone().add(new THREE.Vector3(0, -R * 0.5, 0)), r: R * 1.6 + 2 });
  }

  /* ---- shan-shui scenery in the haze: karst peaks, a pagoda, the heavenly palace ---- */
  const farB = new Builder();
  const farRng = rng.fork('far');
  const farRock = [];
  const farA0 = farRng.range(0, TAU);
  const nPeaks = q >= 0.7 ? 14 : 9;
  for (let i = 0; i < nPeaks; i++) {
    const a = farA0 + (i / nPeaks) * TAU + farRng.range(-0.18, 0.18);
    const d = farRng.range(650, 2100);
    const H = farRng.range(110, 330) * (d / 900 + 0.45) * 0.75;
    const R = H * farRng.range(0.16, 0.26);
    const pts = [];
    for (let k = 0; k <= 14; k++) {
      const t = k / 14;
      const ledge = 1 + 0.1 * Math.sin(t * 11 + i * 1.7) + 0.06 * Math.sin(t * 23 + i);
      const r = R * (1 - Math.pow(t, 3.0) * 0.72) * ledge * (t > 0.95 ? 0.6 : 1);
      pts.push(new THREE.Vector2(Math.max(r, 0.01), t * H));
    }
    pts.push(new THREE.Vector2(0.01, H * 1.01));
    let g = new THREE.LatheGeometry(pts, 14);
    g = paint(g, '#6c7878', { ao: 0.35, aoH: 0.5 });
    const pp = g.getAttribute('position');
    const sd = farRng.range(0, 99);
    for (let k = 0; k < pp.count; k++) {
      _p.fromBufferAttribute(pp, k);
      const ang = Math.atan2(_p.z, _p.x);
      const f = 1 + 0.16 * noise.noise2(ang * 2 + sd, _p.y * 0.02) + 0.06 * Math.sin(ang * 9 + sd);
      pp.setXYZ(k, _p.x * f, _p.y, _p.z * f);
    }
    g.computeVertexNormals();
    g.translate(Math.cos(a) * d, CLOUD_TOP - 40, Math.sin(a) * d);
    farRock.push(g);
    // pines on top
    for (let k = 0; k < 3; k++) {
      const pg = paint(new THREE.ConeGeometry(R * 0.16, R * 0.32, 6), '#24402f');
      pg.translate(Math.cos(a) * d + farRng.range(-R, R) * 0.3, CLOUD_TOP - 40 + H + R * 0.1, Math.sin(a) * d + farRng.range(-R, R) * 0.3);
      farRock.push(pg);
    }
    if (i === 2 || i === 7) {
      // a pagoda on this peak
      farB.push(Math.cos(a) * d, CLOUD_TOP - 40 + H * 0.99, Math.sin(a) * d, 0, R * 0.06);
      for (let k = 0; k < 7; k++) {
        const s = 1 - k * 0.09, y = k * 3.0;
        farB.add('paint', xf(paint(new THREE.CylinderGeometry(2.2 * s, 2.3 * s, 2.4, 8), COL.red), 0, y + 1.2, 0));
        const r = roofGeometry(regularPoly8(3.6 * s), { height: 1.4, vMax: 0.55, K: 4, lift: 0.5, flare: 0.3, seg: 3, thick: 0.15 });
        r.roof.translate(0, y + 2.4, 0);
        farB.add('roof', r.roof);
      }
      farB.pop();
    }
  }
  // heavenly palace on a far cloud bank, catching the light with golden roofs
  const palA = farA0 + farRng.range(0.2, 0.6), palD = 1500;
  const palC = new THREE.Vector3(Math.cos(palA) * palD, CLOUD_TOP + 60, Math.sin(palA) * palD);
  const palYaw = Math.atan2(-palC.x, -palC.z);
  for (let k = -2; k <= 2; k++) {
    const s = k === 0 ? 1.6 : 1.0;
    farB.push(palC.x + Math.cos(palYaw) * k * 60, palC.y + (k === 0 ? 30 : 0) - Math.abs(k) * 6, palC.z - Math.sin(palYaw) * k * 60, palYaw, 6 * s);
    farB.add('paint', xf(paint(new THREE.BoxGeometry(7, 3.2, 4.4), COL.red, { ao: 0.3 }), 0, 1.6, 0));
    farB.add('jade', xf(paint(new THREE.BoxGeometry(8.4, 1, 5.8), COL.jade), 0, -0.4, 0));
    const r = roofGeometry([[-4.8, -3.2], [4.8, -3.2], [4.8, 3.2], [-4.8, 3.2]].reverse(), { height: 2.6, K: 6, lift: 0.7, flare: 0.5, seg: 4, thick: 0.25, tile: COL.tileGold });
    r.roof.translate(0, 3.2, 0);
    farB.add('roof', r.roof);
    farB.pop();
  }
  const farGroup = new THREE.Group();
  const farRockMat = rockMaterial(shared, tex, { key: 'farrock', bump: 0.5, scale: 0.02, moss: 0.25, strata: 0.6 });
  farGroup.add(new THREE.Mesh(mergeGeometries(farRock), farRockMat));
  for (const [bucket, mat] of [['paint', am.paintMat], ['jade', am.jadeMat], ['roof', am.roofMat]]) if (farB.b[bucket].length) farGroup.add(new THREE.Mesh(mergeGeometries(farB.b[bucket]), mat));
  group.add(farGroup);

  // spots where cranes may land (on lawns, away from clutter)
  const landSpots = [];
  for (const p of scatter(main, 0, 0, 0, 14, 0, (x, z) => freeMain(x, z) && Math.hypot(x, z) < MAIN_R * 0.8)) landSpots.push(p);
  for (const p of scatter(islA, A.x, A.y, A.z, 4, 0, (x, z) => Math.hypot(x, z) > 4.2)) landSpots.push(p);
  for (const p of scatter(islB, Bp.x, Bp.y, Bp.z, 3, 0, (x, z) => Math.abs(z) > 1.5)) landSpots.push(p);

  /** Height of a walkable lawn under (x,z), or null. */
  function groundAt(x, z) {
    for (const w of walk) {
      const lx = x - w.pos.x, lz = z - w.pos.z;
      const a = Math.atan2(lz, lx);
      if (Math.hypot(lx, lz) < w.islet.rimR(a) * 0.94) return w.pos.y + w.islet.topY(lx, lz);
    }
    return null;
  }
  const mainGround = (x, z) => (Math.hypot(x, z) < main.rimR(Math.atan2(z, x)) * 0.94 ? tY(x, z) : null);

  const stepM = new THREE.Matrix4();
  return {
    group, pickables, colliders, casters, main, islA, islB, A, Bp,
    treePos, tree, peachSpots, perches: tree.perches, taiji, taijiFloor, pavPos, pav, landSpots,
    mistFalls, lanterns, groundAt, mainGround, poolC, reserved, stoneLanternGlow,
    update(dt, t, tod) {
      for (const b of bobbers) b.obj.position.y = b.base + Math.sin(t * b.speed + b.phase) * b.amp;
      for (let i = 0; i < stepStones.length; i++) {
        const st = stepStones[i];
        _q.setFromEuler(_e.set(Math.sin(t * 0.4 + st.ph) * 0.04, st.ph, Math.cos(t * 0.35 + st.ph) * 0.04));
        stepM.compose(_p.set(st.p.x, st.p.y + Math.sin(t * 0.5 + st.ph) * 0.12, st.p.z), _q, _s.set(st.s, st.s, st.s));
        stepMesh.setMatrixAt(i, stepM);
      }
      stepMesh.instanceMatrix.needsUpdate = true;
      lanterns.update(t, tod.night);
      const fl = 0.85 + 0.1 * Math.sin(t * 8.1) + 0.05 * Math.sin(t * 19.7);
      flameMat.color.setRGB(1, 0.58, 0.22).multiplyScalar(lerp(0.6, 7, tod.night) * fl);
    },
  };
}

function regularPoly8(R) {
  const out = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; out.push([Math.cos(a) * R, Math.sin(a) * R]); }
  return out; // cos/sin ordering is counter-clockwise (positive area)
}
