// 芒原 · atmosphere: time-of-day palette, analytic height fog, painted sky dome, layered mountains.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, patchMaterial } from '../../lib/util.js';

/* ------------------------------------------------------------------ */
/* Palette keyed by sun elevation (deg). sRGB hex, converted to linear */
/* ------------------------------------------------------------------ */
const NIGHT = { zen: '#050b22', hor: '#17254c', glow: '#1e2c56', mistC: '#1a2648', sun: '#8aa0d8', sunI: 0, hemiS: '#2a3866', hemiG: '#0b0d16', hemiI: 0.42, haze: 0.0016, mist: 0.006, cl: '#3a4668', cd: '#0e1428', halo: '#16203e', exp: 1.32 };
const DAY_HI = { zen: '#2a62b4', hor: '#b0c8de', glow: '#f2e8d6', mistC: '#dfe6ea', sun: '#fff6ea', sunI: 3.1, hemiS: '#a9c3e6', hemiG: '#857150', hemiI: 0.82, haze: 0.0010, mist: 0.0, cl: '#ffffff', cd: '#a3afc4', halo: '#fff4e0', exp: 0.8 };
const DAY_MID = { zen: '#2e68ba', hor: '#bccfdf', glow: '#f7e4c4', mistC: '#e2e4e2', sun: '#fff0dc', sunI: 3.0, hemiS: '#a6bcdc', hemiG: '#826e4c', hemiI: 0.8, haze: 0.0012, mist: 0.0, cl: '#fffaf0', cd: '#a0a9bc', halo: '#ffeccc', exp: 0.82 };

const EVENING = [
  [-90, NIGHT], [-25, NIGHT],
  [-10, { zen: '#0d1840', hor: '#2c3a68', glow: '#464a7a', mistC: '#2a3460', sun: '#8aa0d8', sunI: 0, hemiS: '#2e3c68', hemiG: '#121420', hemiI: 0.42, haze: 0.0018, mist: 0.008, cl: '#4a5478', cd: '#182034', halo: '#303868', exp: 1.28 }],
  [-5, { zen: '#172656', hor: '#66689a', glow: '#b06a72', mistC: '#5a6088', sun: '#6070b0', sunI: 0, hemiS: '#46527e', hemiG: '#1e1e2c', hemiI: 0.46, haze: 0.0021, mist: 0.010, cl: '#8a6a8c', cd: '#2a2a46', halo: '#a05a5a', exp: 1.18 }],
  [-1, { zen: '#223a72', hor: '#cc7a6a', glow: '#ff7440', mistC: '#b07a78', sun: '#ff6a34', sunI: 0.7, hemiS: '#6a5a82', hemiG: '#3a2a2a', hemiI: 0.46, haze: 0.0025, mist: 0.008, cl: '#ff7c62', cd: '#4a3a5c', halo: '#ff6a30', exp: 1.05 }],
  [2, { zen: '#2a4886', hor: '#ee9868', glow: '#ff9444', mistC: '#e8a888', sun: '#ff9442', sunI: 2.1, hemiS: '#8a6e92', hemiG: '#583a28', hemiI: 0.52, haze: 0.0025, mist: 0.006, cl: '#ffa070', cd: '#6a4c6c', halo: '#ff8a3a', exp: 0.98 }],
  [6, { zen: '#30579c', hor: '#eeb47e', glow: '#ffb35a', mistC: '#f0c8a0', sun: '#ffb766', sunI: 2.6, hemiS: '#9a8aa2', hemiG: '#6c4a2e', hemiI: 0.6, haze: 0.0021, mist: 0.004, cl: '#ffcf9c', cd: '#8a6c86', halo: '#ffb050', exp: 0.92 }],
  [14, { zen: '#3466b0', hor: '#dcd2bc', glow: '#ffd79c', mistC: '#e8dcc8', sun: '#ffe1b0', sunI: 2.8, hemiS: '#a4acc4', hemiG: '#7c6444', hemiI: 0.7, haze: 0.0016, mist: 0.002, cl: '#fff0d6', cd: '#9a98a8', halo: '#ffd8a0', exp: 0.86 }],
  [30, DAY_MID], [90, DAY_HI],
];
const MORNING = [
  [-90, NIGHT], [-25, NIGHT],
  [-10, { zen: '#0e1a44', hor: '#2c3866', glow: '#3c3e6c', mistC: '#303a64', sun: '#8aa0d8', sunI: 0, hemiS: '#2e3c68', hemiG: '#121420', hemiI: 0.42, haze: 0.0018, mist: 0.012, cl: '#46507a', cd: '#182034', halo: '#2a3060', exp: 1.28 }],
  [-5, { zen: '#1c2c60', hor: '#8a7ca2', glow: '#c48c96', mistC: '#8a86a8', sun: '#9a8ab0', sunI: 0, hemiS: '#5a5a8a', hemiG: '#282430', hemiI: 0.46, haze: 0.0020, mist: 0.022, cl: '#b88ca4', cd: '#3c3c5c', halo: '#c08080', exp: 1.12 }],
  [-1, { zen: '#33508c', hor: '#e6a8a2', glow: '#ffb094', mistC: '#d8b4b8', sun: '#ff9c74', sunI: 0.6, hemiS: '#8a80aa', hemiG: '#4a3a3c', hemiI: 0.52, haze: 0.0026, mist: 0.030, cl: '#ffb4a2', cd: '#6c6284', halo: '#ffa070', exp: 1.02 }],
  [3, { zen: '#4a70b0', hor: '#f2c4b2', glow: '#ffcfa6', mistC: '#f0d8d0', sun: '#ffb68c', sunI: 1.8, hemiS: '#a8a2c2', hemiG: '#6a5a4a', hemiI: 0.62, haze: 0.0028, mist: 0.032, cl: '#ffd8c4', cd: '#8c8ca4', halo: '#ffc090', exp: 0.95 }],
  [8, { zen: '#5a84c6', hor: '#eed8ca', glow: '#ffe0c2', mistC: '#f2e6e0', sun: '#ffcfa6', sunI: 2.3, hemiS: '#b0b6ce', hemiG: '#7a6a50', hemiI: 0.7, haze: 0.0024, mist: 0.022, cl: '#fff2e4', cd: '#a2a4b8', halo: '#ffd8b0', exp: 0.9 }],
  [16, { zen: '#4a80c8', hor: '#d6dee4', glow: '#fbe8d2', mistC: '#e6eaea', sun: '#ffe6c8', sunI: 2.7, hemiS: '#a8bed8', hemiG: '#807050', hemiI: 0.75, haze: 0.0016, mist: 0.006, cl: '#fffaf2', cd: '#a4aec0', halo: '#ffecd0', exp: 0.86 }],
  [30, DAY_MID], [90, DAY_HI],
];
const prep = tbl => tbl.map(([el, o]) => {
  const k = { el };
  for (const [n, v] of Object.entries(o)) k[n] = typeof v === 'string' ? new THREE.Color(v) : v;
  return k;
});
const TBL_EVE = prep(EVENING), TBL_MORN = prep(MORNING);

export function samplePalette(el, morning, out = {}) {
  const tbl = morning ? TBL_MORN : TBL_EVE;
  let i = 0;
  while (i < tbl.length - 2 && el > tbl[i + 1].el) i++;
  const a = tbl[i], b = tbl[i + 1];
  const t = clamp((el - a.el) / (b.el - a.el), 0, 1);
  for (const n in a) {
    if (n === 'el') continue;
    const va = a[n], vb = b[n];
    if (va && va.isColor) (out[n] || (out[n] = new THREE.Color())).copy(va).lerp(vb, t);
    else out[n] = lerp(va, vb, t);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Height fog shared by every material in the world                    */
/* ------------------------------------------------------------------ */
export function makeFogUniforms() {
  return {
    uFogColor: { value: new THREE.Color('#b0c8de') },
    uFogSunColor: { value: new THREE.Color('#f2e8d6') },
    uFogMistColor: { value: new THREE.Color('#dfe6ea') },
    uFogSunDir: { value: new THREE.Vector3(0, 0.2, -1).normalize() },
    uFogHaze: { value: 0.0012 },
    uFogHazeFall: { value: 1 / 140 },
    uFogMist: { value: 0 },
    uFogMistFall: { value: 0.32 },
    uFogBase: { value: -1.0 },
  };
}

export const FOG_GLSL = /* glsl */`
uniform vec3 uFogColor, uFogSunColor, uFogMistColor, uFogSunDir;
uniform float uFogHaze, uFogHazeFall, uFogMist, uFogMistFall, uFogBase;
float fogLayer(vec3 ro, vec3 rd, float dist, float dens, float fall){
  float fy = rd.y * fall;
  float h0 = exp(-fall * (ro.y - uFogBase));
  float integ = abs(fy) > 1e-4 ? h0 * (1.0 - exp(-dist * fy)) / fy : h0 * dist;
  return 1.0 - exp(-max(integ, 0.0) * dens);
}
float sunScatter(vec3 rd){ float s = max(dot(rd, uFogSunDir), 0.0); return clamp(pow(s, 5.0) * 0.75 + pow(s, 36.0) * 0.5, 0.0, 1.0); }
vec3 fogTint(vec3 rd){ return mix(uFogColor, uFogSunColor, sunScatter(rd)); }
vec3 applyMeadowFog(vec3 col, vec3 wp){
  vec3 rd = wp - cameraPosition; float dist = length(rd); rd /= max(dist, 1e-4);
  float sc = sunScatter(rd);
  float haze = fogLayer(cameraPosition, rd, dist, uFogHaze, uFogHazeFall);
  col = mix(col, mix(uFogColor, uFogSunColor, sc), haze);
  float mist = fogLayer(cameraPosition, rd, dist, uFogMist, uFogMistFall);
  col = mix(col, mix(uFogMistColor, uFogSunColor, sc * 0.6), mist);
  return col;
}
`;

/** Replace three's fog with the meadow height fog (works on any built-in material). */
export function addFog(material, U, key = 'mfog') {
  return patchMaterial(material, {
    key,
    uniforms: U,
    vertexHeader: 'varying vec3 vFogWorld;',
    fragmentHeader: 'varying vec3 vFogWorld;\n' + FOG_GLSL,
    vertex: { '#include <fog_vertex>': 'vFogWorld = cameraPosition + (mvPosition.xyz * mat3(viewMatrix));' },
    fragment: { '#include <fog_fragment>': 'gl_FragColor.rgb = applyMeadowFog(gl_FragColor.rgb, vFogWorld);' },
  });
}

/* ------------------------------------------------------------------ */
/* Sky dome: gradient, sun halo + disk, painted clouds, moon, stars    */
/* ------------------------------------------------------------------ */
export function createSkyMaterial(fogU) {
  const uniforms = {
    ...fogU,
    uZenith: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 0.2, -1) },
    uSunHalo: { value: new THREE.Color() },
    uSunDisk: { value: new THREE.Color() },
    uMoonDir: { value: new THREE.Vector3(0, 0.4, -1).normalize() },
    uMoonAmt: { value: 0 },
    uStars: { value: 0 },
    uCloudLit: { value: new THREE.Color() },
    uCloudDark: { value: new THREE.Color() },
    uCloudCover: { value: 0.52 },
    uCloudAmt: { value: 1 },
    uCloudOff: { value: new THREE.Vector2() },
    uTime: { value: 0 },
  };
  return new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.9999; }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform vec3 uZenith, uSunDir, uSunHalo, uSunDisk, uMoonDir, uCloudLit, uCloudDark;
      uniform float uTime, uStars, uMoonAmt, uCloudCover, uCloudAmt;
      uniform vec2 uCloudOff;
      ${FOG_GLSL}
      float sh12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      float sh13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
      float svn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(sh12(i), sh12(i+vec2(1.0,0.0)), u.x), mix(sh12(i+vec2(0.0,1.0)), sh12(i+vec2(1.0,1.0)), u.x), u.y); }
      float sfbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * svn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
      float cloudDen(vec2 p){
        vec2 w = vec2(sfbm(p * 0.55 + vec2(0.0, uTime * 0.003)), sfbm(p * 0.55 + vec2(5.2, 1.3)));
        float n = sfbm(p + w * 1.3 + uCloudOff);
        // streaky cirrus on top
        float ci = sfbm(vec2(p.x * 0.35, p.y * 2.4) + uCloudOff * 0.5 + 20.0);
        return clamp(smoothstep(uCloudCover, uCloudCover + 0.26, n) + smoothstep(0.58, 0.8, ci) * 0.35, 0.0, 1.0);
      }
      void main(){
        vec3 d = normalize(vDir);
        float y = d.y;
        vec3 hz = fogTint(d);
        float g = pow(smoothstep(-0.02, 0.62, y), 0.72);
        vec3 col = mix(hz, uZenith, g);
        float sd = dot(d, uSunDir);
        float s = max(sd, 0.0);
        col += uSunHalo * (pow(s, 4.0) * 0.16 + pow(s, 28.0) * 0.35 + pow(s, 400.0) * 1.4);
        float cden = 0.0;
        if (y > 0.0) {
          vec2 cp = d.xz / (y + 0.085) * 0.75;
          float c1 = cloudDen(cp);
          vec2 toSun = normalize(uSunDir.xz + vec2(1e-4)) * 0.2;
          float c2 = cloudDen(cp + toSun);
          float lit = clamp(0.6 + (c1 - c2) * 1.8, 0.0, 1.0);
          vec3 cc = mix(uCloudDark, uCloudLit, lit);
          cc += uSunHalo * pow(s, 5.0) * (1.25 - c1) * 1.2;
          float fade = smoothstep(0.0, 0.09, y);
          cden = c1 * fade * uCloudAmt;
          col = mix(col, cc, cden);
        }
        if (uStars > 0.001 && y > 0.0) {
          vec3 sp = d * 210.0;
          vec3 cell = floor(sp);
          float r = sh13(cell);
          vec3 f = fract(sp) - 0.5;
          float star = step(0.991, r) * smoothstep(0.32, 0.0, length(f));
          float b = (r - 0.991) / 0.009;
          float tw = 0.6 + 0.4 * sin(uTime * (1.3 + b * 4.0) + r * 80.0);
          float vis = uStars * smoothstep(0.02, 0.3, y) * (1.0 - cden);
          col += mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.9, 0.78), fract(r * 37.0)) * star * tw * (0.5 + 4.0 * b * b) * vis;
          vec3 bandN = normalize(vec3(0.55, 0.42, 0.72));
          float bd = dot(d, bandN);
          float band = exp(-bd * bd * 14.0);
          float mw = sfbm(vec2(atan(d.x, d.z) * 3.0, d.y * 6.0) + 40.0);
          col += vec3(0.42, 0.48, 0.7) * band * smoothstep(0.35, 0.8, mw) * 0.09 * vis;
        }
        if (uMoonAmt > 0.001) {
          float md = dot(d, uMoonDir);
          float mr = 0.99978;
          float disk = smoothstep(mr - 0.00003, mr + 0.00002, md);
          vec3 mx = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
          vec3 my = cross(mx, uMoonDir);
          vec2 mp = vec2(dot(d, mx), dot(d, my)) / sqrt(1.0 - mr * mr);
          float maria = sfbm(mp * 2.2 + 3.0);
          vec3 mcol = vec3(1.0, 0.97, 0.9) * (0.62 + 0.45 * smoothstep(0.38, 0.62, maria)) * (1.0 - 0.25 * dot(mp, mp));
          col = mix(col, mcol * 3.0, disk * uMoonAmt * (1.0 - cden * 0.85));
          float mh = max(md, 0.0);
          col += vec3(0.5, 0.62, 0.95) * (pow(mh, 900.0) * 0.6 + pow(mh, 60.0) * 0.08 + pow(mh, 8.0) * 0.03) * uMoonAmt;
        }
        float disk = smoothstep(0.99985, 0.99992, sd);
        col += uSunDisk * disk * (1.0 - cden * 0.92);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/* ------------------------------------------------------------------ */
/* Layered mountain ridges (misty, fading into the haze)               */
/* ------------------------------------------------------------------ */
export function buildMountains({ noise, rng, fogU, sunsetAz }) {
  const group = new THREE.Group();
  const layers = [
    { R: 330, hmin: 6, hmax: 44, base: '#2e3a2a', alt: '#5a3420', a0: -1.95, a1: 1.95, seg: 260 },
    { R: 520, hmin: 18, hmax: 95, base: '#34443e', alt: '#4a3a30', a0: -2.0, a1: 2.0, seg: 220 },
    { R: 800, hmin: 40, hmax: 170, base: '#3c4c56', alt: '#3c4c56', a0: -2.05, a1: 2.05, seg: 200 },
    { R: 1250, hmin: 80, hmax: 300, base: '#46566a', alt: '#46566a', a0: -2.1, a1: 2.1, seg: 160 },
  ];
  const ridgeAt = [];
  layers.forEach((L, li) => {
    const rows = 7;
    const pos = [], col = [], idx = [];
    const cA = new THREE.Color(L.base), cB = new THREE.Color(L.alt), c = new THREE.Color();
    const ph = rng.range(0, 100);
    const ridge = [];
    for (let j = 0; j <= L.seg; j++) {
      const a = L.a0 + (L.a1 - L.a0) * j / L.seg;
      let n = noise.ridged2(a * (2.2 + li * 0.6) + ph, li * 7.3, 5);
      n = Math.pow(n, 1.6);
      let h = lerp(L.hmin, L.hmax, n);
      // low saddle where the sun sets, taller shoulders around it
      const dA = a - sunsetAz;
      h *= 1 - 0.78 * Math.exp(-(dA * dA) / (2 * 0.16 * 0.16));
      h *= 0.75 + 0.5 * smoothstep(0.2, 1.4, Math.abs(dA));
      ridge.push(h);
    }
    ridgeAt.push({ R: L.R, a0: L.a0, a1: L.a1, ridge });
    for (let j = 0; j <= L.seg; j++) {
      const a = L.a0 + (L.a1 - L.a0) * j / L.seg;
      const sx = Math.sin(a), sz = -Math.cos(a);
      for (let i = 0; i <= rows; i++) {
        const v = i / rows;
        const h = ridge[j];
        const y = lerp(-45 - li * 10, h, Math.pow(v, 0.85)) + noise.noise2(a * 30 + li, v * 3) * h * 0.06 * (1 - v);
        const r = L.R - (1 - v) * (h * 2.2 + 60) + noise.noise2(a * 18 + 3 + li, v * 4) * 14;
        pos.push(sx * r, y, sz * r);
        const tex = noise.fbm2(a * 40 + li * 5, v * 6, 3) * 0.5 + 0.5;
        c.copy(cA).lerp(cB, smoothstep(0.55, 0.85, tex) * 0.7).multiplyScalar(0.8 + 0.4 * tex);
        c.multiplyScalar(lerp(0.75, 1.1, v));
        col.push(c.r, c.g, c.b);
      }
    }
    const R1 = rows + 1;
    for (let j = 0; j < L.seg; j++) for (let i = 0; i < rows; i++) {
      const a = j * R1 + i, b = (j + 1) * R1 + i;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    addFog(mat, fogU, 'mfogMtn');
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = -1 + li * 0.01;
    mesh.frustumCulled = false;
    group.add(mesh);
  });
  /** Elevation angle (rad) of the highest ridge seen from the origin toward azimuth a. */
  group.userData.horizonAt = a => {
    let best = -1;
    for (const r of ridgeAt) {
      const t = (a - r.a0) / (r.a1 - r.a0);
      if (t < 0 || t > 1) continue;
      const h = r.ridge[Math.round(t * (r.ridge.length - 1))];
      best = Math.max(best, Math.atan2(h - 4, r.R));
    }
    return best;
  };
  return group;
}
