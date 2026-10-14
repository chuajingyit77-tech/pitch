// Sky dome, volumetric light shafts, floating motes, fireflies, glowing spores, rain and low mist.
import * as THREE from 'three';
import { TAU, clamp, lerp, makeRng, GLSL } from '../../lib/util.js';
import { JG_GLSL, JG_PNOISE, JG_FBMP, JG_PERIOD } from './shading.js';
import { VISTA_GLSL } from './far.js';

/* ------------------------------------------------------------------ */
/* Sky                                                                  */
/* ------------------------------------------------------------------ */
export function buildSky(shared, vistaU) {
  const geo = new THREE.SphereGeometry(400, 32, 16);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...shared, ...vistaU,
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color() }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uNight: shared.uNight, uSimplexDrift: shared.uSimplexDrift,
      uOvercast: { value: 0 }, uFogColor: shared.uFogColor, uDay: { value: 1 }, uStarPh: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir; varying vec3 vWorldP;
      void main(){ vDir = normalize(position); vWorldP = (modelMatrix * vec4(position, 1.0)).xyz; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */`
      ${JG_GLSL}
      ${VISTA_GLSL}
      ${GLSL.noise}
      ${JG_FBMP}
      uniform vec3 uZenith, uHorizon, uSunDir, uSunCol, uMoonDir;
      uniform vec4 uSimplexDrift; // .x cloud drift, .y cloud evolution (wrapped to 867, the noise's period)
      uniform float uOvercast, uDay, uStarPh;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, -0.2, 1.0);
        vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.55));
        // humid haze toward the horizon
        col = mix(col, uFogColor * 1.1, (1.0 - smoothstep(0.0, 0.35, h)) * 0.65);
        float sd = max(dot(d, uSunDir), 0.0);
        col += uSunCol * (pow(sd, 900.0) * 30.0 + pow(sd, 12.0) * 0.6 + pow(sd, 3.0) * 0.12) * (1.0 - uOvercast * 0.85) * uDay;
        // clouds
        vec2 cp = d.xz / max(d.y + 0.15, 0.05) * 1.3 + vec2(uSimplexDrift.x, 0.0);
        float c = smoothstep(0.42, 0.85, fbmP(vec3(cp, uSimplexDrift.y)) * 0.5 + 0.5 + uOvercast * 0.45);
        vec3 cloudCol = mix(vec3(1.0, 0.98, 0.95) * (0.5 + uDay * 0.9), vec3(0.62, 0.66, 0.66) * (0.3 + uDay * 0.7), uOvercast);
        cloudCol = mix(cloudCol, vec3(0.08, 0.1, 0.16), uNight * 0.9);
        col = mix(col, cloudCol, c * smoothstep(0.02, 0.25, h) * (0.85 + uOvercast * 0.15));
        // night: stars and moon
        if (uNight > 0.01) {
          vec3 sp = d * 300.0;
          // a soft round star inside its cell (the whole cell used to light up as a square of ~1 px that hopped
          // between pixels as the camera drifted), faded out where cells shrink below ~2 px
          vec2 sc = sp.xz + sp.y * 7.1;
          vec2 cell = floor(sc);
          float fw = max(fwidth(sc.x), fwidth(sc.y));
          float st = smoothstep(0.985, 1.0, hash12(cell)) * smoothstep(0.1, 0.4, h);
          st *= (1.0 - smoothstep(0.12, 0.42, length(fract(sc) - 0.5))) * (1.0 - smoothstep(0.45, 0.9, fw)) * 1.6;
          st *= 0.6 + 0.4 * sin(uStarPh + hash12(cell + 17.0) * 30.0);
          col += vec3(0.8, 0.9, 1.0) * st * uNight * (1.0 - c) * (1.0 - uOvercast) * 1.4;
          float md = max(dot(d, uMoonDir), 0.0);
          col += vec3(0.75, 0.85, 1.0) * (pow(md, 1600.0) * 14.0 + pow(md, 40.0) * 0.25) * uNight * (1.0 - uOvercast * 0.7);
        }
        // the vista's mist curtains stand in front of the sky too (far.js), so they read as one layered haze
        col = vistaMist(col, 1e6, normalize(vWorldP - cameraPosition));
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    extensions: { derivatives: true },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* God rays: camera-facing strips from lit ground spots back toward the light */
/* ------------------------------------------------------------------ */
export function buildGodRays(shared, anchors, rng) {
  const n = anchors.length;
  const base = new THREE.PlaneGeometry(1, 1, 1, 12);
  base.translate(0, -0.5, 0); // y in [-1, 0]: along = -y, 0 at the ground spot, 1 at the sky end
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  const a = new Float32Array(n * 4), b = new Float32Array(n * 4);
  anchors.forEach((p, i) => {
    a[i * 4] = p.x; a[i * 4 + 1] = p.y; a[i * 4 + 2] = p.z; a[i * 4 + 3] = p.w; // width
    b[i * 4] = rng.next(); b[i * 4 + 1] = p.len; b[i * 4 + 2] = p.k; b[i * 4 + 3] = rng.range(0.6, 1.3);
  });
  geo.setAttribute('aAnchor', new THREE.InstancedBufferAttribute(a, 4));
  geo.setAttribute('aPrm', new THREE.InstancedBufferAttribute(b, 4));
  geo.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...shared, uRayCol: { value: new THREE.Color() }, uRayAmt: { value: 1 } },
    vertexShader: /* glsl */`
      ${JG_GLSL}
      attribute vec4 aAnchor; attribute vec4 aPrm;
      varying vec2 vUv; varying float vSeed; varying float vK; varying float vAlong;
      void main(){
        vec3 L = normalize(vec3(uLightDirW.x, max(uLightDirW.y, 0.22), uLightDirW.z));
        float along = -position.y;
        vec3 c = aAnchor.xyz + L * along * aPrm.y;
        vec3 toCam = normalize(cameraPosition - c);
        vec3 sideV = cross(L, toCam);
        float sl = length(sideV);
        vec3 side = sl > 1e-5 ? sideV / sl : vec3(1.0, 0.0, 0.0); // never normalize(0): NaN on real GPUs
        float w = aAnchor.w * (0.75 + along * 0.5) * (1.0 + 0.1 * sin(uTime * 0.25 + aPrm.x * 20.0));
        vec3 p = c + side * position.x * w;
        // only where the canopy lets the light through to this spot
        float ck = (jgCookie(aAnchor.xyz) - uCookieMin) / max(1.0 - uCookieMin, 1e-3);
        float open = smoothstep(0.45, 0.9, ck);
        // shafts out in the vista (beyond the cliff) fall through open air: no canopy test, a little stronger
        float farA = step(60.0, length(aAnchor.xz - vec2(1.4, -3.6)));
        open = mix(open, 1.25, farA);
        vWorldP = p; vUv = uv; vSeed = aPrm.x; vK = aPrm.z * aPrm.w * open; vAlong = along;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      ${JG_GLSL}
      ${GLSL.noise}
      ${JG_PNOISE}
      uniform vec3 uRayCol; uniform float uRayAmt;
      uniform vec4 uNoiseDrift; // drifts wrapped to 256, the noise's period
      varying vec2 vUv; varying float vSeed; varying float vK; varying float vAlong;
      void main(){
        if (vK < 0.002) discard;
        float x = vUv.x * 2.0 - 1.0;
        float edgeN = vnoiseP(vec2(vAlong * 3.0 + vSeed * 30.0, uNoiseDrift.x)) * 0.35;
        float across = pow(max(1.0 - x * x * (1.0 + edgeN), 0.0), 2.6);
        float ends = smoothstep(0.02, 0.3, vAlong) * (1.0 - smoothstep(0.35, 0.95, vAlong));
        float streak = 0.6 + 0.4 * vnoiseP(vec2(x * 2.5 + vSeed * 50.0, vAlong * 1.5 - uNoiseDrift.y));
        streak *= 0.75 + 0.25 * vnoiseP(vec2(x * 7.0 + uNoiseDrift.z, vSeed * 11.0));
        vec3 V = normalize(vWorldP - cameraPosition);
        float fwd = mix(0.35, 1.0, pow(max(dot(V, -uLightDirW), 0.0), 2.0));
        float camFade = smoothstep(3.0, 9.0, length(vWorldP - cameraPosition));
        float a = across * ends * streak * fwd * camFade * vK * uRayAmt;
        gl_FragColor = vec4(uRayCol * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* Point particles (motes, fireflies, spores)                           */
/* ------------------------------------------------------------------ */
function pointsMaterial(shared, sprite, kind) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, tSprite: { value: sprite }, uAmt: { value: 1 }, uColor: { value: new THREE.Color(1, 1, 1) }, uScale: { value: 400 }, uAmb: { value: new THREE.Color(0.2, 0.25, 0.2) } },
    vertexShader: /* glsl */`
      ${JG_GLSL}
      uniform float uScale, uAmt; uniform vec3 uAmb;
      uniform vec4 uSimplexDrift; // .zw: firefly drifts, wrapped to 867 (simplex noise repeats there)
      attribute vec4 aPrm;
      varying float vA; varying vec3 vCol;
      ${GLSL.noise}
      // per-particle rates snapped to whole cycles in the wrapped clock's period (rad/s: 1/200; cycles/s: 1/JG_PERIOD)
      float radRate(float w) { return floor(w * 200.0 + 0.5) / 200.0; }
      float cycRate(float r) { return floor(r * ${JG_PERIOD.toFixed(6)} + 0.5) / ${JG_PERIOD.toFixed(6)}; }
      void main(){
        vec3 p = position;
        float t = uTime;
        float ph = aPrm.x * 6.2831;
        float bright = 1.0;
        #if ${kind === 'motes' ? 1 : 0}
          p += vec3(sin(t * radRate(0.13 * aPrm.y) + ph) * 1.2, sin(t * 0.09 + ph * 1.3) * 0.6, cos(t * radRate(0.11 * aPrm.y) + ph) * 1.2);
          p.y += sin(t * 0.21 + ph) * 0.25;
          vWorldP = p;
          float lit = jgCookie(p);
          lit = smoothstep(0.45, 1.0, lit);
          lit *= lit;
          vCol = uLightCol * lit * 1.1 + uAmb * 0.05;
          bright = 0.5 + 0.5 * sin(t * 1.7 + ph * 3.0);
          vA = (0.35 + 0.65 * bright) * uAmt;
        #elif ${kind === 'fireflies' ? 1 : 0}
          p += vec3(snoise(vec3(aPrm.x * 10.0, uSimplexDrift.z, 0.0)) * 1.6, snoise(vec3(aPrm.x * 10.0, uSimplexDrift.w, 5.0)) * 0.7, snoise(vec3(aPrm.x * 10.0, uSimplexDrift.z, 9.0)) * 1.6);
          float blink = pow(max(sin(t * radRate(0.9 + aPrm.y * 0.8) + ph), 0.0), 6.0);
          blink = max(blink, 0.12 * (0.5 + 0.5 * sin(t * 3.1 + ph)));
          vCol = vec3(0.85, 1.0, 0.35) * 2.6;
          vA = blink * uAmt;
          vWorldP = p;
        #else
          float life = fract(t * cycRate(0.035 * aPrm.y) + aPrm.x);
          p += vec3(sin(t * 0.4 + ph) * 0.4 * life, life * 4.5, cos(t * 0.33 + ph) * 0.4 * life);
          vCol = vec3(0.3, 1.0, 0.9) * 2.2;
          // each spore breathes slowly (a ~5 s swell of light), never a blink
          vA = sin(life * 3.14159) * (0.55 + 0.45 * sin(t * 1.2 + ph)) * uAmt;
          vWorldP = p;
        #endif
        vec4 mv = viewMatrix * vec4(p, 1.0);
        // Points smaller than a pixel used to be drawn as one full-strength pixel that snapped from pixel to
        // pixel as they drifted (bloom turned that into blinking). Draw them at least 2.5 px wide and soft,
        // with the same total light as before (0.226 = coverage of the soft sprite).
        float ps = uScale * aPrm.z / max(-mv.z, 0.01);
        float psd = clamp(ps, 2.5, 26.0);
        vA *= min(1.0, max(1.0, 0.226 * ps * ps) / (0.226 * psd * psd));
        gl_PointSize = psd;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tSprite;
      varying float vA; varying vec3 vCol;
      void main(){
        float s = texture2D(tSprite, gl_PointCoord).r;
        float a = s * vA;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vCol * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function buildPoints(shared, sprite, kind, positions, rng, sizeRange) {
  const n = positions.length;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), prm = new Float32Array(n * 4);
  positions.forEach((p, i) => {
    pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
    prm[i * 4] = rng.next(); prm[i * 4 + 1] = rng.range(0.6, 1.4); prm[i * 4 + 2] = rng.range(sizeRange[0], sizeRange[1]); prm[i * 4 + 3] = rng.next();
  });
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPrm', new THREE.BufferAttribute(prm, 4));
  const pts = new THREE.Points(geo, pointsMaterial(shared, sprite, kind));
  pts.frustumCulled = false;
  pts.renderOrder = 7;
  return pts;
}

/* ------------------------------------------------------------------ */
/* Rain streaks                                                         */
/* ------------------------------------------------------------------ */
export function buildRain(shared, q, rng, center) {
  const n = Math.round(4200 * q);
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  const prm = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { prm[i * 4] = rng.next(); prm[i * 4 + 1] = rng.next(); prm[i * 4 + 2] = rng.next(); prm[i * 4 + 3] = rng.range(0.7, 1.3); }
  geo.setAttribute('aPrm', new THREE.InstancedBufferAttribute(prm, 4));
  geo.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    // uRainT: the clock wrapped in JS to rain.userData.period; uPxK: world size of one pixel at 1 m
    uniforms: { ...shared, uRain: { value: 0 }, uRainT: { value: 0 }, uPxK: { value: 0.001 }, uCenter: { value: center.clone() }, uAmb: { value: new THREE.Color(0.3, 0.3, 0.3) }, uBox: { value: new THREE.Vector3(34, 16, 30) } },
    vertexShader: /* glsl */`
      uniform float uRainT, uRain, uPxK; uniform vec3 uCenter, uBox;
      attribute vec4 aPrm;
      varying vec2 vUv; varying float vA; varying vec3 vWorldP;
      void main(){
        // fall speeds sit on a 1/16 grid, so every streak's cycle repeats exactly after uBox.y * 16 / 9 seconds
        // and the clock can be wrapped there (a raw uTime of many hours lost the precision to place the drops)
        float w = floor(aPrm.w * 16.0 + 0.5) / 16.0;
        float y = fract(aPrm.y - uRainT * 9.0 * w / uBox.y);
        vec3 c = uCenter + vec3((aPrm.x - 0.5) * uBox.x, y * uBox.y - 1.0, (aPrm.z - 0.5) * uBox.z);
        c.x += (1.0 - y) * 0.6; // slight wind slant
        vec3 D = normalize(vec3(0.06, -1.0, 0.0));
        vec3 toC = cameraPosition - c;
        float dc = length(toC);
        vec3 sideV = cross(D, toC);
        float sl = length(sideV);
        vec3 side = sl > 1e-5 ? sideV / sl : vec3(1.0, 0.0, 0.0);
        // at least about a pixel wide (thinner streaks break up into crawling dots, worst without MSAA),
        // dimmed by the same factor so the shower keeps its weight
        float wd = max(0.012, dc * uPxK);
        float len = 0.55 * w;
        vec3 p = c + side * position.x * wd - D * position.y * len;
        vWorldP = p; vUv = uv;
        // each streak fades in as the shower builds (they used to pop on one by one), fades at both ends of its
        // fall, and fades out within a few metres of the lens: a drop passing the camera flashed a pale bar across
        // the screen, and the nearest streaks sweep ~15 px per frame (pure flicker; real rain that close is a blur)
        float th = aPrm.x * 0.9;
        vA = smoothstep(th, th + 0.1, uRain) * smoothstep(0.0, 0.08, y) * (1.0 - smoothstep(0.92, 1.0, y)) * smoothstep(1.5, 5.0, dc) * (0.012 / wd);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      ${JG_GLSL}
      uniform vec3 uAmb;
      varying vec2 vUv; varying float vA;
      void main(){
        float x = abs(vUv.x * 2.0 - 1.0);
        // soft at both ends like a motion-blurred drop (a hard tail made each pixel jump up and down in two frames)
        float a = (1.0 - x) * smoothstep(0.0, 0.4, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y)) * vA * 0.32;
        if (a < 0.003) discard;
        vec3 col = uAmb * 2.2 + uLightCol * 0.2;
        col = jgFog(col, vWorldP);
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  mesh.userData.period = mat.uniforms.uBox.value.y * 16 / 9;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* Low mist sheets drifting over the pond / forest floor                */
/* ------------------------------------------------------------------ */
export function buildMistSheets(shared, rng, sheets) {
  const geos = [];
  const pos = [], uv = [], prm = [], idx = [];
  let base = 0;
  for (const s of sheets) {
    const seg = 1;
    for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) {
      pos.push(s.x + (i - 0.5) * s.w, s.y, s.z + (j - 0.5) * s.d);
      uv.push(i, j);
      prm.push(rng.next());
    }
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    base += 4;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(prm, 1));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...shared, uAmt: { value: 0.5 }, uAmb: { value: new THREE.Color(0.4, 0.45, 0.42) } },
    vertexShader: /* glsl */`
      attribute float aSeed;
      varying vec2 vUv; varying vec3 vWorldP; varying float vSeed;
      void main(){ vUv = uv; vSeed = aSeed; vec4 wp = modelMatrix * vec4(position, 1.0); vWorldP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */`
      ${JG_GLSL}
      ${GLSL.noise}
      uniform float uAmt; uniform vec3 uAmb;
      uniform vec4 uMistScroll; // texture scrolls wrapped to 1 in JS (the cookie texture repeats)
      varying vec2 vUv; varying float vSeed;
      void main(){
        vec2 e = min(vUv, 1.0 - vUv);
        float edge = smoothstep(0.0, 0.3, e.x) * smoothstep(0.0, 0.3, e.y);
        vec2 p = vWorldP.xz * 0.035 + vSeed;
        float n = texture2D(uCookieTex, p + uMistScroll.xy).b * 0.65 + texture2D(uCookieTex, p * 2.7 + uMistScroll.zw).r * 0.35;
        float a = smoothstep(0.35, 0.85, n) * edge * uAmt;
        vec3 V = normalize(vWorldP - cameraPosition);
        float soft = smoothstep(1.0, 6.0, length(vWorldP - cameraPosition));
        a *= soft * smoothstep(0.04, 0.3, abs(V.y));
        if (a < 0.003) discard;
        float cookie = jgCookie(vWorldP);
        float fwd = pow(max(dot(V, uLightDirW), 0.0), 3.0);
        vec3 col = uAmb * 1.2 + uLightCol * cookie * (0.25 + fwd) * smoothstep(-0.1, 0.1, uLightDirW.y + 0.1);
        gl_FragColor = vec4(jgFog(col, vWorldP), a);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return mesh;
}
