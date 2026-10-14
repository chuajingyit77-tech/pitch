// 杜若 (kakitsubata, Iris laevigata) at the pond's edge: the iris of Kōrin's screens and of every stroll garden's
// shallows. A flowering stem carries one open flower and the next bud beside it in the same green spathe:
//  - three broad falls arch out from the centre and droop, each with a white signal line down its haft;
//  - three narrow standards stand up between them, three pale style arms lie over the falls' hafts.
// Younger stems carry a bud alone. Each kind of stem is one geometry with its origin at the foot, so the wind
// (lib/util.js addWind) bends stem and flower together, as it does the leaves. The petals take each flower's colour
// from its instance colour (aTint 1); the signal line, stem and spathe keep their own (aTint 0).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, lerp, smoothstep, patchMaterial, addWind } from '../../lib/util.js';

export const IRIS_STEM = 0.7;      // m, foot to flower of the bloom geometry (instances scale it)
export const IRIS_BUD_STEM = 0.62; // m, foot to spathe of the bud geometry

// linear colours (THREE.Color converts the sRGB hex)
const GREEN = new THREE.Color('#4a7431'), GREEN_PALE = new THREE.Color('#86a24c'), PAPER = new THREE.Color('#a89c6c');
const SIGNAL = new THREE.Color('#ece6cc'), THROAT = new THREE.Color('#d6bd52');

const UP = new THREE.Vector3(0, 1, 0);
const _o = new THREE.Vector3(), _sd = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();
const _col = new THREE.Color(), _sig = new THREE.Color();

/** n + 1 rows from 0 to 1, packed towards 1 where the rounded tips need them. */
const rows = n => Array.from({ length: n + 1 }, (_, i) => Math.sin((i / n) * Math.PI / 2));

/**
 * A petal-like surface. Its centreline leaves `base` along azimuth `phi` at elevation theta(s), s = 0..1 of `len`;
 * across it t = -1..1 spans the width w(s), and the edges lift by cup(s)·t² along the surface normal (positive: a
 * channel, negative: edges rolled down). paint(s, t, color) sets the colour and returns the tint.
 */
function petal({ base, phi, len, w, theta, cup = () => 0, ss, ts, paint, lod = null }) {
  _o.set(Math.cos(phi), 0, Math.sin(phi));
  _sd.set(Math.sin(phi), 0, -Math.cos(phi)); // o × side = up: the top face winds counter-clockwise
  const nu = ss.length, nv = ts.length;
  const pos = new Float32Array(nu * nv * 3), col = new Float32Array(nu * nv * 3), tint = new Float32Array(nu * nv), far = new Float32Array(nu * nv * 2);
  _c.copy(base);
  let prev = 0;
  for (let i = 0; i < nu; i++) {
    const s = ss[i];
    for (let k = 0; k < 4; k++) { // midpoint steps along the centreline
      const a = prev + (s - prev) * (k + 0.5) / 4, th = theta(a), ds = (s - prev) * len / 4;
      _c.addScaledVector(_o, Math.cos(th) * ds).addScaledVector(UP, Math.sin(th) * ds);
    }
    prev = s;
    const th = theta(s), half = Math.max(w(s), 0.0003) / 2, lift = cup(s); // no zero-width tip: no degenerate triangles
    _n.copy(_o).multiplyScalar(-Math.sin(th)).addScaledVector(UP, Math.cos(th));
    for (let j = 0; j < nv; j++) {
      const t = ts[j], k = i * nv + j, e = lift * t * t;
      pos[k * 3] = _c.x + _sd.x * t * half + _n.x * e;
      pos[k * 3 + 1] = _c.y + _n.y * e;
      pos[k * 3 + 2] = _c.z + _sd.z * t * half + _n.z * e;
      tint[k] = paint(s, t, _col);
      col[k * 3] = _col.r; col[k * 3 + 1] = _col.g; col[k * 3 + 2] = _col.b;
      if (lod) { const [shade, size] = lod(s, t); far[k * 2] = shade; far[k * 2 + 1] = size; }
    }
  }
  const idx = [];
  for (let i = 0; i < nu - 1; i++) for (let j = 0; j < nv - 1; j++) {
    const a = i * nv + j, b = a + nv;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
  g.setAttribute('aStem', new THREE.BufferAttribute(new Float32Array(nu * nv), 1));
  g.setAttribute('aLod', new THREE.BufferAttribute(far, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A surface of revolution about +y from [radius, y] pairs (bottom to top); paint(y, color) returns the tint.
 * A stem keeps its radius in aStem, for the material to widen it where it would be thinner than a pixel.
 */
function lathe(profile, segs, paint, isStem = false) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs);
  g.deleteAttribute('uv');
  const p = g.attributes.position, n = p.count;
  const col = new Float32Array(n * 3), tint = new Float32Array(n), stem = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    tint[i] = paint(p.getY(i), _col);
    col[i * 3] = _col.r; col[i * 3 + 1] = _col.g; col[i * 3 + 2] = _col.b;
    if (isStem) stem[i] = Math.hypot(p.getX(i), p.getZ(i));
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
  g.setAttribute('aStem', new THREE.BufferAttribute(stem, 1));
  g.setAttribute('aLod', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

/** Tilt a part standing on the origin by `tilt` rad towards azimuth `phi`, then move its foot to `at`. */
function stand(g, phi, tilt, at) {
  g.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.sin(phi), 0, -Math.cos(phi)), tilt));
  g.translate(at.x, at.y, at.z);
  return g;
}

/** Stem from below the ground to `top`, swelling into the ovary when it carries a flower. */
function stem(top, ovary) {
  const pts = [[0.0056, -0.04], [0.0053, 0.12], [0.005, 0.26], [0.0047, 0.4], [0.0045, 0.54]];
  if (ovary) pts.push([0.0043, top - 0.026], [0.006, top - 0.015], [0.0054, top - 0.005], [0.003, top + 0.002], [0, top + 0.004]);
  else pts.push([0.0044, top - 0.01], [0.0036, top], [0, top + 0.004]);
  return lathe(pts, 6, (y, c) => { c.copy(GREEN).lerp(GREEN_PALE, smoothstep(top - 0.03, top - 0.01, y) * 0.5); return 0; }, true);
}

/** The spathe: two green bracts sheathing the stem from `y0`, their tips papery. */
function spathe(y0, r0, len, wrap) {
  return [0.4, 0.4 + Math.PI].map(phi => petal({
    base: new THREE.Vector3(Math.cos(phi) * r0, y0, Math.sin(phi) * r0), phi, len,
    w: s => 0.017 * (1 - Math.pow(s, 1.5)) + 0.0008,
    theta: s => 1.48 - 0.32 * s * s,
    cup: s => wrap * (1 - s),
    ss: rows(5), ts: [-1, -0.4, 0.4, 1],
    paint: (s, t, c) => { c.copy(GREEN).multiplyScalar(lerp(0.9, 1.05, s)).lerp(PAPER, smoothstep(0.72, 1, s)); return 0; },
  }));
}

/** A furled bud of length `len` and girth `r`: green at the foot, deep violet above. */
function bud(len, r) {
  const pts = [[r * 0.5, 0], [r * 0.8, len * 0.17], [r, len * 0.36], [r * 0.97, len * 0.55], [r * 0.78, len * 0.72], [r * 0.46, len * 0.87], [0, len]];
  return lathe(pts, 6, (y, c) => {
    const v = smoothstep(len * 0.16, len * 0.3, y), sh = lerp(0.62, 0.78, smoothstep(0.3, 0.6, y / len)) * lerp(1, 0.7, smoothstep(0.75, 1, y / len));
    c.copy(GREEN).lerp(_sig.setScalar(sh), v);
    return v;
  });
}

const fallW = s => 0.034 * (0.2 + 0.8 * Math.pow(Math.sin(Math.min(s / 0.62, 1) * Math.PI / 2), 1.5)) *
  (s > 0.62 ? Math.sqrt(Math.max(0, 1 - ((s - 0.62) / 0.38) ** 2)) : 1);
const stdW = s => 0.015 * (0.3 + 0.7 * Math.sin(Math.min(s / 0.6, 1) * Math.PI / 2)) *
  (s > 0.6 ? Math.sqrt(Math.max(0, 1 - ((s - 0.6) / 0.4) ** 2)) : 1);

const FLOWER = 1.2; // the flower's size: about 13 cm across the falls

/**
 * The signal: a narrow line down the middle of a fall, creamy yellow in the throat, about 4 mm wide on the haft and
 * 2 mm where it runs out on the blade (haloed by deeper violet veining in the paint).
 */
/** A fall's own shading, without the signal and veining: deeper in the haft, a little darker at the edges and tip. */
const fallShade = (s, t) => lerp(0.72, 1, smoothstep(0, 0.42, s)) * lerp(1, 0.9, smoothstep(0.55, 1, Math.abs(t))) * (1 - 0.1 * smoothstep(0.82, 1, s));

function fallSignal(s, t) {
  const tw = lerp(0.0021, 0.001, smoothstep(0.2, 0.5, s)) / (fallW(s) / 2);
  return (1 - smoothstep(tw * 0.5, tw * 1.6, Math.abs(t))) * smoothstep(0.03, 0.12, s) * (1 - smoothstep(0.38, 0.56, s));
}

/** The open flower on top of a stem at height `y`. */
function flower(y) {
  const parts = [];
  for (let k = 0; k < 3; k++) {
    const phi = k * TAU / 3, ps = phi + Math.PI / 3;
    // fall: a channelled haft rising from the centre, then a broad blade arching over and down
    parts.push(petal({
      base: new THREE.Vector3(Math.cos(phi) * 0.002, y + 0.003, Math.sin(phi) * 0.002), phi, len: 0.062, w: fallW,
      theta: s => 0.38 - 1.5 * Math.pow(s, 1.35),
      cup: s => fallW(s) / 2 * (0.8 * (1 - smoothstep(0, 0.4, s)) - 0.22 * smoothstep(0.4, 0.85, s)),
      ss: rows(10), ts: [-1, -0.6, -0.3, -0.14, -0.05, 0, 0.05, 0.14, 0.3, 0.6, 1],
      paint: (s, t, c) => {
        const at = Math.abs(t), sig = fallSignal(s, t);
        const halo = (1 - smoothstep(0.1, 0.45, at)) * (1 - smoothstep(0.3, 0.62, s));
        c.setScalar(fallShade(s, t) * (1 - 0.32 * halo)).lerp(_sig.copy(THROAT).lerp(SIGNAL, smoothstep(0.12, 0.32, s)), sig);
        return 1 - sig;
      },
      // from afar: the plain fall, a touch lighter where the signal was (the line and its veining are 3-8 mm)
      lod: (s, t) => [fallShade(s, t) * (1 + 0.12 * fallSignal(s, t)), 0.005],
    }));
    // standard: narrow, upright, cupped towards the centre
    parts.push(petal({
      base: new THREE.Vector3(Math.cos(ps) * 0.0015, y + 0.004, Math.sin(ps) * 0.0015), phi: ps, len: 0.046, w: stdW,
      theta: s => 1.3 - 0.22 * s,
      cup: s => stdW(s) / 2 * 0.35,
      ss: rows(7), ts: [-1, -0.5, 0, 0.5, 1],
      paint: (s, t, c) => { c.setScalar(lerp(0.74, 1, smoothstep(0, 0.5, s)) * lerp(1, 0.88, smoothstep(0.6, 1, Math.abs(t)))); return 1; },
    }));
    // style arm: pale and keeled, lying over the fall's haft
    parts.push(petal({
      base: new THREE.Vector3(Math.cos(phi) * 0.0015, y + 0.007, Math.sin(phi) * 0.0015), phi, len: 0.03,
      w: s => 0.0095 * (0.6 + 0.4 * s) * (s > 0.75 ? Math.sqrt(Math.max(0, 1 - ((s - 0.75) / 0.25) ** 2)) : 1),
      theta: s => 0.55 - 0.45 * s,
      cup: s => -0.0015 * (0.6 + 0.4 * s),
      ss: rows(5), ts: [-1, 0, 1],
      paint: (s, t, c) => { c.setScalar(lerp(1.08, 1.2, s)); return 0.78; },
      lod: () => [0.92, 0.011],
    }));
  }
  for (const g of parts) g.translate(0, -y, 0).scale(FLOWER, FLOWER, FLOWER).translate(0, y, 0);
  return parts;
}

function bloomGeometry() {
  const H = IRIS_STEM;
  const parts = [stem(H, true), ...spathe(H - 0.085, 0.0045, 0.07, 0.006), ...flower(H)];
  // the next bud stands up out of the spathe under a standard, clear of the falls
  parts.push(stand(bud(0.046, 0.0063), Math.PI / 3, 0.2, new THREE.Vector3(Math.cos(Math.PI / 3) * 0.0035, H - 0.052, Math.sin(Math.PI / 3) * 0.0035)));
  const g = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  g.computeBoundingSphere();
  return g;
}

function budGeometry() {
  const H = IRIS_BUD_STEM;
  const parts = [stem(H - 0.055, false), ...spathe(H - 0.075, 0.0085, 0.07, 0.004),
    stand(bud(0.07, 0.0075), 0, 0.05, new THREE.Vector3(0, H - 0.06, 0))];
  const g = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  g.computeBoundingSphere();
  return g;
}

/**
 * The flowering and budding stems as two instanced meshes on one material.
 * blooms / buds: [{ matrix, color }] (the colour tints the petals only).
 */
export function createIrisFlowers({ wind, blooms, buds }) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.72 });
  // Fine things are kept to what a pixel can show. uIrisH is 2 / the drawing buffer's height, so the size of a pixel
  // one metre in front of this draw's camera is uIrisH / projectionMatrix[1][1] (the same value in every pass of a
  // frame, so a pass that skips re-uploading it can never be left with another pass's):
  //  - a stem is about a centimetre thick, barely a pixel from the usual distance, and a line thinner than a pixel
  //    breaks into dots that crawl as it sways: each stem is drawn at least 1.5 px wide (its true width up close);
  //  - the petals' fine markings (the signal line and its veining, 3-8 mm; the pale style arms, 11 mm) fade into
  //    the plain petal once they would be under about a pixel and a half, as they do to the eye, instead of
  //    twinkling as the view drifts (the reason textures are mip-mapped).
  const uH = { value: 0.002 };
  patchMaterial(mat, {
    key: 'irisTint',
    uniforms: { uIrisH: uH },
    vertexHeader: 'attribute float aTint, aStem;\nattribute vec2 aLod;\nuniform float uIrisH;\n' +
      'float irisPx(vec3 p){\n#ifdef USE_INSTANCING\n p = (instanceMatrix * vec4(p, 1.0)).xyz;\n#endif\n' +
      ' return uIrisH / projectionMatrix[1][1] * max(-(modelViewMatrix * vec4(p, 1.0)).z, 0.0); }',
    vertex: {
      '#include <begin_vertex>': /* glsl */`$&
        if (aStem > 0.0) transformed += objectNormal * max(0.0, 0.75 * irisPx(transformed) - aStem);`,
      '#include <color_vertex>': /* glsl */`
        vColor = vec3(1.0);
        float irisTint = aTint;
        #ifdef USE_COLOR
          vec3 irisCol = color;
          if (aLod.y > 0.0) {
            float lodF = smoothstep(0.4, 1.0, irisPx(position) / aLod.y);
            irisCol = mix(irisCol, vec3(aLod.x), lodF);
            irisTint = mix(irisTint, 1.0, lodF);
          }
          vColor *= irisCol;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vColor *= mix(vec3(1.0), instanceColor, irisTint);
        #endif`,
    },
  });
  // stiffer than the leaves (key 'iris' in koi.js: 0.08, 1.8), on the same wind
  addWind(mat, wind, { height: 0.8, amount: 0.06, stiffness: 2, key: 'irisFlower' });
  const buf = new THREE.Vector2();
  const setPx = renderer => { const h = renderer.getDrawingBufferSize(buf).y; if (h > 0) uH.value = 2 / h; };
  return [[bloomGeometry(), blooms, 'irisBlooms'], [budGeometry(), buds, 'irisBuds']].map(([geo, list, name]) => {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    im.name = name;
    im.onBeforeRender = setPx;
    list.forEach((o, i) => { im.setMatrixAt(i, o.matrix); im.setColorAt(i, o.color); });
    im.count = list.length;
    im.computeBoundingSphere();
    return im;
  });
}
