// 晴岛 · the gentle giant's water: spout mist, spray and splashes as soft lit particles (one draw call), and the
// white water, spreading rings and calm slicks it leaves on the sea, splatted into a coarse field texture that the
// water shader reads (water.js), so they lie exactly on the swell, take the sea's own light and glow blue at night.
// Nothing is drawn while nothing is alive; every buffer is made here, in create().
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, makeRng } from '../../lib/util.js';
import { LAYER_NO_REFLECT, whaleFieldUniforms, WHALE_FIELD_N, WHALE_FIELD_SIZE } from './shared.js';
import { puffTexture } from './textures.js';

const PVERT = /* glsl */`
attribute vec4 aP;   // centre xyz, size (m)
attribute vec4 aC;   // alpha, glow share, kind (0 mist puff, 1 spray), seed
attribute vec4 aV;   // velocity (m/s), stretch (s): spray is drawn as a streak along its motion
uniform float uPxScale;   // pixels per metre at distance 1 (0.5 x buffer height x projection[1][1])
varying vec2 vUv;
varying vec4 vC;
varying vec3 vW;
void main() {
  vec3 camDir = normalize(aP.xyz - cameraPosition);
  vec3 ax1, ax2;
  float len = 1.0;
  vec3 vv = aV.xyz - dot(aV.xyz, camDir) * camDir;   // motion across the view
  float sp = length(vv);
  if (aV.w > 0.0 && sp > 0.05) {
    ax1 = vv / sp;
    ax2 = normalize(cross(ax1, camDir));
    len = 1.0 + aV.w * sp;
  } else {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float a = aC.w * 6.2831853;
    float ca = cos(a), sa = sin(a);
    ax1 = up * ca + right * sa;
    ax2 = right * ca - up * sa;
  }
  vec3 wp = aP.xyz + (ax1 * position.y * len + ax2 * position.x) * aP.w;
  vec4 cc = projectionMatrix * viewMatrix * vec4(aP.xyz, 1.0);
  // smaller than ~1.5 px across: fade out instead of shrinking into a twinkling dot
  float px = aP.w * uPxScale / max(cc.w, 0.05);
  vC = aC;
  vC.x *= smoothstep(0.75, 1.5, px) / sqrt(len);
  vUv = uv;
  vW = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const PFRAG = /* glsl */`
uniform sampler2D tPuff;
uniform vec3 uSunDir, uSunCol, uAmb, uBack, uGlow, uHaze;
uniform float uHazeK;
varying vec2 vUv;
varying vec4 vC;
varying vec3 vW;
void main() {
  vec4 tx = texture2D(tPuff, vUv);
  vec2 d = vUv * 2.0 - 1.0;
  float disc = smoothstep(1.0, 0.25, length(d));
  float cov = mix(tx.a, disc * (0.75 + 0.25 * tx.a), vC.z);
  // soft where it meets the sea: the swell hides what is below (depth), this keeps the line from showing
  float a = cov * vC.x * smoothstep(-0.2, 0.45, vW.y);
  if (a < 0.003) discard;
  vec3 V = normalize(cameraPosition - vW);
  // lit mist: sky light all round, the key light on the near side, and a warm glow looking toward the sun
  // through it (forward scattering: spouts and splashes shine against a low sun)
  float fwd = pow(max(dot(-V, uSunDir), 0.0), 5.0);
  vec3 col = uAmb * (0.78 + 0.3 * tx.g) + uSunCol * (0.5 + 0.35 * tx.r) + uBack * fwd * (1.15 - 0.5 * tx.r);
  col += uGlow * vC.y;
  float dist = length(cameraPosition - vW);
  col = mix(col, uHaze, 1.0 - exp(-dist * uHazeK));
  gl_FragColor = vec4(col * a, a);
}
`;

export function createWhaleFx(env, { wind }) {
  const q = env.q;
  const group = new THREE.Group();
  group.name = 'whaleFx';
  // own random stream (never Math.random: other creatures' choices must not depend on how much spray there was)
  const R = makeRng(env.seed ^ 0x5a1e);
  const rnd = () => R.next();

  /* ---------------- particles ---------------- */
  const MAXP = Math.round(lerp(320, 700, q));
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  const aP = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 4), 4);
  const aC = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 4), 4);
  const aV = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 4), 4);
  aP.setUsage(THREE.DynamicDrawUsage); aC.setUsage(THREE.DynamicDrawUsage); aV.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aP', aP); geo.setAttribute('aC', aC); geo.setAttribute('aV', aV);
  geo.instanceCount = 0;
  const puff = puffTexture(env.seed ^ 0x77);
  const U = {
    tPuff: { value: puff },
    uPxScale: { value: 600 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color(1, 1, 1) },
    uAmb: { value: new THREE.Color(0.5, 0.55, 0.6) },
    uBack: { value: new THREE.Color(0, 0, 0) },
    uGlow: { value: new THREE.Color(0, 0, 0) },
    uHaze: { value: new THREE.Color(0.7, 0.8, 0.9) },
    uHazeK: { value: 1 / 1400 },
  };
  const mat = new THREE.ShaderMaterial({
    name: 'WhaleSpray',
    uniforms: U, vertexShader: PVERT, fragmentShader: PFRAG,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'whaleSpray';
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.layers.set(LAYER_NO_REFLECT);
  mesh.visible = false;
  group.add(mesh);

  // structure of arrays: position, velocity, age/life, size, look, forces
  const px = new Float32Array(MAXP), py = new Float32Array(MAXP), pz = new Float32Array(MAXP);
  const vx = new Float32Array(MAXP), vy = new Float32Array(MAXP), vz = new Float32Array(MAXP);
  const age = new Float32Array(MAXP), life = new Float32Array(MAXP).fill(-1);
  const s0 = new Float32Array(MAXP), s1 = new Float32Array(MAXP), a0 = new Float32Array(MAXP);
  const glow = new Float32Array(MAXP), kind = new Float32Array(MAXP), seed = new Float32Array(MAXP);
  const drag = new Float32Array(MAXP), grav = new Float32Array(MAXP), wk = new Float32Array(MAXP), fin = new Float32Array(MAXP), str = new Float32Array(MAXP);
  let cursor = 0, alive = 0;
  /**
   * One particle. delay > 0 holds it back (unseen) for that long, so a burst can unfold over a moment from a
   * single call. Velocities in m/s; drag pulls toward the wind (wk = how much it rides the wind).
   */
  function emit(x, y, z, ux, uy, uz, lf, sa, sb, al, k, gl, dr, gr, w, delay = 0, fadeIn = 0.12, stretch = 0) {
    const i = cursor; cursor = (cursor + 1) % MAXP;
    if (life[i] < 0) alive++;
    px[i] = x; py[i] = y; pz[i] = z; vx[i] = ux; vy[i] = uy; vz[i] = uz;
    age[i] = -delay; life[i] = lf; s0[i] = sa; s1[i] = sb; a0[i] = al;
    kind[i] = k; glow[i] = gl; drag[i] = dr; grav[i] = gr; wk[i] = w; fin[i] = fadeIn; seed[i] = rnd(); str[i] = stretch;
  }
  const jit = s => (rnd() - 0.5) * 2 * s;

  /**
   * A blow: a bushy column of breath and spray from the two nostrils. Puffs leave at different speeds, so they fill
   * the column from the sea up to ~5 m (narrow and dense low, wide and soft high), then drift off downwind; a few
   * drops arc up and fall back.
   */
  function spout(x, y, z, fx, fz, k = 1, gl = 0) {
    const l = Math.hypot(fx, fz) || 1, sx = -fz / l, sz = fx / l;
    const sk = Math.sqrt(k);
    const n = Math.round(22 + 26 * k);
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1, f = rnd();
      const up = lerp(3, 13, Math.pow(f, 0.55)) * sk, tilt = 0.05 + 0.1 * f + rnd() * 0.04;
      emit(x + sx * side * 0.2 * k, y + 0.05, z + sz * side * 0.2 * k,
        sx * side * up * tilt + jit(0.3 + 0.6 * f), up, sz * side * up * tilt + jit(0.3 + 0.6 * f),
        2.2 + 3.0 * f + rnd() * 0.8, 0.28 * k, (0.9 + 2.4 * f) * k, 0.5 + rnd() * 0.3,
        0, gl * 0.35, 2.3, -0.1, 1, rnd() * 0.75, 0.08);
    }
    for (let i = 0; i < Math.round(8 + 8 * k); i++) {
      emit(x + jit(0.25 * k), y + 0.1, z + jit(0.25 * k), jit(1.6), (9 + rnd() * 5) * sk, jit(1.6),
        1.2 + rnd() * 0.6, (0.14 + rnd() * 0.1) * k, 0.26 * k, 0.6, 1, gl * 0.5, 0.9, 9.8, 0.2, rnd() * 0.6, 0.05, 0.06);
    }
  }
  /** White water thrown up where the back cuts the surface. */
  function wash(x, y, z, ux, uz, k = 1, gl = 0) {
    if (rnd() < 0.6) {
      emit(x + jit(0.3 * k), y + 0.05, z + jit(0.3 * k), ux * 0.5 + jit(1.2), 1.0 + rnd() * 2.2, uz * 0.5 + jit(1.2),
        0.6 + rnd() * 0.5, (0.16 + rnd() * 0.14) * k, 0.3 * k, 0.65, 1, gl * 0.8, 0.4, 9.8, 0.1, 0, 0.06, 0.07);
    } else {
      emit(x + jit(0.3 * k), y + 0.1, z + jit(0.3 * k), ux * 0.4 + jit(0.6), 0.4 + rnd() * 0.8, uz * 0.4 + jit(0.6),
        0.9 + rnd() * 0.8, (0.4 + rnd() * 0.3) * k, (0.9 + rnd() * 0.5) * k, 0.35 + rnd() * 0.15, 0, gl * 0.8, 1.6, 2.5, 0.3, 0, 0.15);
    }
  }
  /** Water pouring off a surface moving at (ux, uy, uz): streaks that fall back. */
  function pour(x, y, z, ux, uy, uz, k = 1, gl = 0) {
    emit(x + jit(0.35 * k), y, z + jit(0.35 * k), ux * 0.82 + jit(1.0), uy * 0.82 + jit(0.8), uz * 0.82 + jit(1.0),
      0.9 + rnd() * 0.7, (0.2 + rnd() * 0.16) * k, (0.3 + rnd() * 0.2) * k, 0.6 + rnd() * 0.2, 1, gl * 0.8, 0.3, 9.8, 0.1, 0, 0.06, 0.08);
  }
  /** Drops streaming off the flukes' trailing edge. */
  function drip(x, y, z, ux, uy, uz, k = 1, gl = 0) {
    emit(x + jit(0.12 * k), y, z + jit(0.12 * k), ux + jit(0.25), uy - 0.5, uz + jit(0.25),
      0.7 + rnd() * 0.5, (0.12 + rnd() * 0.08) * k, (0.16 + rnd() * 0.08) * k, 0.6 + rnd() * 0.2, 1, gl * 0.7, 0.2, 9.8, 0.05, 0, 0.05, 0.1);
  }
  /**
   * A body falling flat into the sea along the line (cx, cz) + (ax, az) over len m: walls of spray thrown up and
   * out to both sides (streaks, the tallest from the middle), sheets of white water, and a low mist that spreads,
   * settles and thins out as the spray rains back.
   */
  function crown(cx, cz, ax, az, len, k = 1, gl = 0, mist = true) {
    const l = Math.hypot(ax, az) || 1, ux = ax / l, uz = az / l, nx = -uz, nz = ux;
    const sk = Math.sqrt(k);
    // spray: streaks thrown up and out to both sides, the tallest from the middle of the line
    const nDrop = Math.round((90 + 80 * q) * k);
    for (let i = 0; i < nDrop; i++) {
      const along = (rnd() - 0.5) * len, side = rnd() < 0.5 ? -1 : 1, mid = 1 - Math.abs(along) / (len * 0.5 + 1e-3) * 0.6;
      const f = Math.pow(rnd(), 0.8);
      const up = (4 + 14 * f * mid) * sk, out = (1 + 5.5 * rnd()) * sk;
      emit(cx + ux * along + nx * side * (0.5 + rnd()) * k, 0.1, cz + uz * along + nz * side * (0.5 + rnd()) * k,
        nx * side * out + ux * jit(1.2), up, nz * side * out + uz * jit(1.2),
        0.7 + up / 9.8 * 1.6 + rnd() * 0.3, (0.45 + rnd() * 0.5) * k, (0.8 + rnd() * 0.6) * k, 0.8 + rnd() * 0.15, 1, gl, 0.25, 9.8, 0.05, rnd() * 0.15, 0.05, 0.07);
    }
    // sheets of white water: big, soft, they rise as walls along both flanks and collapse
    for (let i = 0; i < Math.round((26 + 18 * q) * k); i++) {
      const along = (rnd() - 0.5) * len, side = rnd() < 0.5 ? -1 : 1;
      const up = (3 + 7 * rnd()) * sk;
      emit(cx + ux * along + nx * side * (0.8 + rnd()) * k, 0.3, cz + uz * along + nz * side * (0.8 + rnd()) * k,
        nx * side * (1.2 + 3 * rnd()) * sk, up, nz * side * (1.2 + 3 * rnd()) * sk,
        0.9 + up / 9.8 * 1.5, (2.0 + rnd() * 1.2) * k, (3.0 + rnd() * 1.5) * k, 0.55 + rnd() * 0.2, 1, gl, 0.4, 9.8, 0.05, rnd() * 0.12, 0.08, 0.03);
    }
    if (!mist) return;
    // the plume where the body went in, and a low mist that spreads, settles and thins out
    for (let i = 0; i < Math.round(8 * k); i++) {
      const along = (rnd() - 0.5) * len * 0.5;
      const up = (6 + 6 * rnd()) * sk;
      emit(cx + ux * along + jit(1) * k, 0.4, cz + uz * along + jit(1) * k, jit(1), up, jit(1),
        1.0 + up / 9.8 * 1.4, (2.2 + rnd()) * k, (3.4 + rnd() * 1.2) * k, 0.6, 1, gl, 0.5, 9.8, 0.05, rnd() * 0.1, 0.08, 0.02);
    }
    const nMist = Math.round((9 + 6 * q) * k);
    for (let i = 0; i < nMist; i++) {
      const along = (rnd() - 0.5) * len * 0.9, side = rnd() < 0.5 ? -1 : 1;
      emit(cx + ux * along + nx * side * rnd() * 1.5 * k, (0.6 + rnd()) * k, cz + uz * along + nz * side * rnd() * 1.5 * k,
        nx * side * (1 + rnd() * 2.2), 0.2 + rnd() * 0.8, nz * side * (1 + rnd() * 2.2),
        3.4 + rnd() * 1.8, (2.2 + rnd()) * k, (6 + rnd() * 3) * k, 0.32 + rnd() * 0.15, 0, gl * 0.6, 0.9, 0.08, 0.6, 0.35 + rnd() * 0.6, 0.5);
    }
  }

  /* ---------------- the field on the sea (white water, rings, calm slicks) ---------------- */
  const N = WHALE_FIELD_N, SIZE = WHALE_FIELD_SIZE, CELL = SIZE / N;
  const data = new Uint8Array(N * N * 4);
  const accR = new Float32Array(N * N), accG = new Float32Array(N * N);
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  whaleFieldUniforms.tWhaleFx.value = tex;
  const F = whaleFieldUniforms.uWhaleFx.value; // origin xy, 1 / size
  F.set(-SIZE / 2, -SIZE / 2, 1 / SIZE, 1 / SIZE);
  // kinds: 0 surfacing white water, 1 a breach's white water, 2 spreading ring, 3 calm slick (a fluke print)
  const MAXF = 24;
  const patches = [];
  for (let i = 0; i < MAXF; i++) patches.push({ on: false, kind: 0, x: 0, z: 0, rx: 1, rz: 1, ang: 0, age: 0, life: 1, a: 1, s1: 0, s2: 0 });
  let fCursor = 0, fieldTimer = 0, fieldDirty = false, fieldLive = 0;
  function patch(kind, x, z, rx, rz, ang, life, a = 1) {
    const p = patches[fCursor]; fCursor = (fCursor + 1) % MAXF;
    p.on = true; p.kind = kind; p.x = x; p.z = z; p.rx = rx; p.rz = rz; p.ang = ang; p.age = 0; p.life = life; p.a = a;
    p.s1 = rnd() * TAU; p.s2 = rnd() * TAU;
  }
  /** Centre the field on where the next pass will be (its contents are kept only while nothing is alive). */
  function centre(x, z) {
    if (fieldLive) return;
    F.x = Math.round((x - SIZE / 2) / CELL) * CELL; F.y = Math.round((z - SIZE / 2) / CELL) * CELL;
  }
  function splat(p) {
    const k = p.age / p.life;
    let rx = p.rx, rz = p.rz, reach;
    let ringR = 0, ringW = 1, vR = 0, vG = 0;
    if (p.kind === 0) {        // white water from a surfacing: blooms, then thins out to a calm patch
      const grow = 1 + 0.35 * smoothstep(0, 0.6, k);
      rx *= grow; rz *= grow;
      vR = p.a * smoothstep(0, 0.06, k) * (1 - smoothstep(0.25, 1, k));
      vG = p.a * 0.7 * smoothstep(0.1, 0.45, k) * (1 - smoothstep(0.6, 1, k));
    } else if (p.kind === 1) { // a breach: a great white boil that spreads and slowly breaks up
      const grow = 1 + 0.6 * (1 - Math.exp(-p.age * 0.35));
      rx *= grow; rz *= grow;
      vR = p.a * smoothstep(0, 0.02, k) * (1 - smoothstep(0.15, 1, k));
      vG = p.a * 0.8 * smoothstep(0.08, 0.4, k) * (1 - smoothstep(0.55, 1, k));
    } else if (p.kind === 2) { // ring: fast at first, slowing as it spreads
      ringR = rx * (1 - Math.exp(-p.age * 0.42));
      ringW = 0.8 + 0.07 * ringR;
      vR = p.a * smoothstep(0, 0.05, k) * Math.pow(1 - k, 1.6);
      rx = rz = ringR + ringW * 2.2;
    } else {                   // a fluke print: smooth water, no foam
      vG = p.a * smoothstep(0, 0.12, k) * (1 - smoothstep(0.55, 1, k));
    }
    if (vR < 0.002 && vG < 0.002) return;
    reach = Math.max(rx, rz) * 1.25;
    const ca = Math.cos(p.ang), sa = Math.sin(p.ang);
    const i0 = Math.max(1, Math.floor((p.x - reach - F.x) / CELL)), i1 = Math.min(N - 2, Math.ceil((p.x + reach - F.x) / CELL));
    const j0 = Math.max(1, Math.floor((p.z - reach - F.y) / CELL)), j1 = Math.min(N - 2, Math.ceil((p.z + reach - F.y) / CELL));
    for (let j = j0; j <= j1; j++) {
      const dz = F.y + (j + 0.5) * CELL - p.z;
      for (let i = i0; i <= i1; i++) {
        const dx = F.x + (i + 0.5) * CELL - p.x;
        const o = j * N + i;
        if (p.kind === 2) {
          const d = Math.hypot(dx, dz);
          const e = (d - ringR) / ringW;
          if (e > -2.5 && e < 2.5) accR[o] += vR * Math.exp(-e * e);
          continue;
        }
        const lx = (dx * ca + dz * sa) / rx, lz = (-dx * sa + dz * ca) / rz;
        let r = Math.hypot(lx, lz);
        if (r > 1.25) continue;
        // an uneven edge (a few slow lobes), the same for the patch's whole life
        const th = Math.atan2(lz, lx);
        r /= 1 + 0.16 * Math.sin(3 * th + p.s1) + 0.09 * Math.sin(5 * th + p.s2);
        const c = 1 - smoothstep(0.3, 1, r);
        if (c <= 0) continue;
        accR[o] += vR * c * (p.kind === 1 ? 1.25 - 0.25 * r : 1);
        accG[o] += vG * c;
      }
    }
  }
  function rebuildField() {
    accR.fill(0); accG.fill(0);
    for (const p of patches) if (p.on) splat(p);
    for (let o = 0; o < N * N; o++) {
      data[o * 4] = Math.round(clamp(accR[o], 0, 1) * 255);
      data[o * 4 + 1] = Math.round(clamp(accG[o], 0, 1) * 255);
    }
    tex.needsUpdate = true;
  }

  /* ---------------- per frame ---------------- */
  const wdir = wind.uniforms.uWindDir.value;
  function update(dt) {
    // particles
    if (alive) {
      const wx = wdir.x * 2.2, wz = wdir.y * 2.2;
      let n = 0, live = 0;
      for (let i = 0; i < MAXP; i++) {
        if (life[i] < 0) continue;
        if (age[i] < 0) { age[i] += dt; if (age[i] < 0) { live++; continue; } }
        else age[i] += dt;
        if (age[i] >= life[i] || (kind[i] > 0.5 && py[i] < -0.6)) { life[i] = -1; continue; }
        live++;
        const e = 1 - Math.exp(-drag[i] * dt), w = wk[i];
        vx[i] += (wx * w - vx[i]) * e; vz[i] += (wz * w - vz[i]) * e; vy[i] -= vy[i] * e;
        vy[i] -= grav[i] * dt;
        px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
        const k = age[i] / life[i];
        const size = s0[i] + (s1[i] - s0[i]) * Math.sqrt(k);
        // fade in over a moment, out smoothly (never on or off from one frame to the next)
        const a = a0[i] * smoothstep(0, fin[i], age[i]) * (1 - k) * (1 - k * 0.35);
        aP.setXYZW(n, px[i], py[i], pz[i], size);
        aC.setXYZW(n, a, glow[i], kind[i], seed[i]);
        aV.setXYZW(n, vx[i], vy[i], vz[i], str[i]);
        n++;
      }
      alive = live;
      geo.instanceCount = n;
      aP.needsUpdate = true; aC.needsUpdate = true; aV.needsUpdate = true;
      mesh.visible = n > 0;
    } else if (mesh.visible) { mesh.visible = false; geo.instanceCount = 0; }
    // field (rebuilt ~20 times a second while anything is on the water: it changes over seconds)
    let live = 0;
    for (const p of patches) {
      if (!p.on) continue;
      p.age += dt;
      if (p.age >= p.life) { p.on = false; continue; }
      live++;
    }
    if (live || fieldLive) {
      fieldTimer -= dt;
      if (fieldTimer <= 0 || !live) {
        fieldTimer = 0.05;
        rebuildField();
        fieldDirty = live > 0;
      }
    }
    fieldLive = live;
    whaleFieldUniforms.uWhaleFxOn.value = live || fieldDirty ? 1 : 0;
  }

  /** Lighting from the time of day (island.js). */
  function setLight(L) {
    U.uSunDir.value.copy(L.keyDir);
    U.uSunCol.value.copy(L.key).multiplyScalar(0.3);
    U.uAmb.value.copy(L.amb).multiplyScalar(0.55);
    U.uBack.value.copy(L.key).multiplyScalar(0.55 * L.backK);
    U.uGlow.value.copy(L.glow).multiplyScalar(0.55);
    U.uHaze.value.copy(L.haze);
  }
  function setView(bufH, proj) { U.uPxScale.value = 0.5 * bufH * proj.elements[5]; }

  return {
    group, emit, spout, wash, pour, drip, crown, patch, centre, update, setLight, setView,
    get busy() { return alive > 0 || fieldLive > 0; },
    dispose() { base.dispose(); geo.dispose(); mat.dispose(); puff.dispose(); tex.dispose(); whaleFieldUniforms.tWhaleFx.value = null; },
  };
}
