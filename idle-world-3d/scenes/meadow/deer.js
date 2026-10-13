// 芒原 · the day's gentle giants: a small herd of sika deer (梅花鹿) crossing the far side of the field.
//
// Procedural bodies (quad.js): slender legs on small black hooves, a russet coat with rows of pale spots, a dark
// dorsal line, a cream belly, and the white rump patch edged in black that flares when they are alarmed; a stag with
// four-tined antlers and a heavy autumn neck, hinds, and a fawn. The whole herd is one skinned mesh (one draw).
// They walk in a loose group to the grazing lawn on the knoll, graze heads-down, lift their heads to look round and
// flick their ears, drift on, and leave on the far side. An offering landing near them sends them bounding away,
// calmly: a few springy trotting leaps, then a walk.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, damp, angleDelta, makeRng, canvasTexture, patchMaterial } from '../../lib/util.js';
import { addFog } from './sky.js';
import { SkinGeo, SegRig, Animal } from './quad.js';

/* ------------------------------------------------------------------ */
/* Body plan (a hind; metres, bind pose facing +z, hooves on y = 0)    */
/* ------------------------------------------------------------------ */
const HIND = {
  spine: { P: [0.77, -0.34], M: [0.76, 0.0], C: [0.77, 0.32], N1: [0.88, 0.47], N2: [1.06, 0.58], H: [1.215, 0.64], S: [1.125, 0.985] },
  sections: [
    [-0.54, 0.83, 0.04, 0.04, 0.04, 0],
    [-0.49, 0.83, 0.1, 0.075, 0.1, 0],
    [-0.4, 0.815, 0.135, 0.09, 0.15, 0.05],
    [-0.26, 0.795, 0.145, 0.105, 0.16, 0.08],
    [-0.08, 0.78, 0.135, 0.11, 0.155, 0.1],
    [0.08, 0.765, 0.145, 0.125, 0.18, 0.2],
    [0.22, 0.765, 0.142, 0.135, 0.195, 0.28],
    [0.34, 0.79, 0.12, 0.13, 0.18, 0.34],
    [0.44, 0.86, 0.1, 0.115, 0.145, 0.3],
    [0.52, 0.96, 0.085, 0.095, 0.11, 0.2],
    [0.575, 1.05, 0.075, 0.082, 0.09, 0.15],
    [0.615, 1.14, 0.07, 0.074, 0.08, 0.12],
    [0.645, 1.205, 0.068, 0.07, 0.07, 0.12],
    [0.7, 1.235, 0.07, 0.066, 0.07, 0.25],
    [0.77, 1.215, 0.064, 0.06, 0.064, 0.32],
    [0.85, 1.185, 0.05, 0.05, 0.056, 0.3],
    [0.92, 1.155, 0.04, 0.042, 0.048, 0.2],
    [0.96, 1.135, 0.033, 0.035, 0.037, 0.1],
    [0.985, 1.125, 0.01, 0.01, 0.01, 0],
  ],
  bodyRings: 34, segBody: 16, headDense: 1.3,
  pawH: 0.035,
  legs: {
    F: { hip: [0.068, 0.6, 0.33], foot: [0.075, 0.35], L: [0.2, 0.25, 0.19, 0.065], alpha: 0.1, flex: 1.2, curl: 1.0, align: 0.7, scap: 0.05,
      r: [0.05, 0.048, 0.04, 0.028, 0.022, 0.017, 0.0135, 0.015], seg: 8, topUp: 0.06,
      paw: { w: 0.02, h: 0.03, back: 0.012, lift: 0.5, seg: 6, prof: [0.55, 1, 0.95, 0.75, 0.3] } },
    H: { hip: [0.07, 0.68, -0.34], foot: [0.075, -0.36], L: [0.22, 0.28, 0.27, 0.065], alpha: 0.22, flex: 0.4, curl: 0.8, align: 0.6,
      r: [0.1, 0.088, 0.06, 0.033, 0.024, 0.018, 0.014, 0.015], seg: 8, topUp: 0.08,
      paw: { w: 0.02, h: 0.03, back: 0.012, lift: 0.5, seg: 6, prof: [0.55, 1, 0.95, 0.75, 0.3] } },
  },
  ears: { base: [0.04, 0.045, 0.0], tip: [0.13, 0.088, -0.05], w: 0.036, d: 0.011, turn: 0.25,
    shape: f => Math.sin(Math.PI * Math.min(1, 0.22 + f * 0.86)) * (1 - 0.25 * f) + 0.02 },
  tail: { root: [0.84, -0.52], len: 0.13, pitch: -1.2, w: 0.034, d: 0.016 },
  graze: { n1: -1.1, n2: -1.4, h: -1.95 },
  gait: { duty: 0.66, L0: 0.78, vRef: 0.9, swingH: 0.1, off: [0, 0.25, 0.5, 0.75], tMin: 0.18, tMax: 0.45 },
};
// trot (diagonal pairs) for the flight: LH, LF, RH, RF
const TROT_OFF = [0, 0.5, 0.5, 1.0];

function scaleSpec(spec, k, { neck = 1, head = 1 } = {}) {
  const S = JSON.parse(JSON.stringify(spec, (key, v) => (typeof v === 'function' ? undefined : v)));
  S.ears.shape = spec.ears.shape;
  for (const key in S.spine) S.spine[key] = S.spine[key].map(x => x * k);
  const zN0 = spec.spine.N1[1] - 0.05, zH0 = spec.spine.H[1] - 0.02;
  S.sections = spec.sections.map(s => {
    const f = s[0] >= zH0 ? head : s[0] >= zN0 ? neck : 1;
    return [s[0] * k, s[1] * k, s[2] * k * f, s[3] * k * f, s[4] * k * f, s[5]];
  });
  S.pawH *= k;
  for (const L of [S.legs.F, S.legs.H]) {
    L.hip = L.hip.map(x => x * k); L.foot = L.foot.map(x => x * k); L.L = L.L.map(x => x * k); L.r = L.r.map(x => x * k);
    L.topUp *= k; L.scap = (L.scap || 0) * k;
    L.paw.w *= k; L.paw.h *= k; L.paw.back *= k;
  }
  S.ears.base = S.ears.base.map(x => x * k * head); S.ears.tip = S.ears.tip.map(x => x * k * head); S.ears.w *= k * head; S.ears.d *= k * head;
  S.tail.root = S.tail.root.map(x => x * k); S.tail.len *= k; S.tail.w *= k; S.tail.d *= k;
  S.gait.L0 *= k; S.gait.swingH *= k; S.gait.vRef *= Math.sqrt(k);
  return S;
}

// sika antlers (one side; mirrored): main beam sweeping up and back, brow tine, trez tine, a forked crown
const ANTLERS = {
  branches: [
    { pts: [[0.03, 0.07, 0.04], [0.06, 0.16, 0.02], [0.1, 0.28, -0.04], [0.13, 0.4, -0.06], [0.15, 0.48, -0.05]], r0: 0.016, r1: 0.006, rings: 8, u0: 0, u1: 1 },
    { pts: [[0.04, 0.1, 0.035], [0.055, 0.13, 0.1], [0.06, 0.17, 0.15]], r0: 0.009, r1: 0.004, rings: 4, u0: 0.3, u1: 1 },
    { pts: [[0.1, 0.28, -0.035], [0.12, 0.33, 0.02], [0.13, 0.37, 0.05]], r0: 0.008, r1: 0.004, rings: 4, u0: 0.5, u1: 1 },
    { pts: [[0.135, 0.41, -0.06], [0.16, 0.47, -0.12], [0.17, 0.5, -0.16]], r0: 0.007, r1: 0.003, rings: 4, u0: 0.7, u1: 1 },
  ],
};

/* ------------------------------------------------------------------ */
/* Coat atlas (u along the body from rump to nose, v round it)         */
/* ------------------------------------------------------------------ */
function coatTexture(anim, seed, { spots = 1, dark = 0 } = {}) {
  const curve = anim.bodyCurve;
  const uAt = z => { let best = 0, bd = 1e9; for (let i = 0; i <= 300; i++) { const p = curve.getPointAt(i / 300); const d = Math.abs(p.z - z); if (d < bd) { bd = d; best = i / 300; } } return best; };
  const b = anim.b;
  const uHip = uAt(b.P.z - 0.05), uSh = uAt(b.C.z + 0.02), uNeck = uAt(b.N1.z), uHead = uAt(b.H.z), uEye = uAt(b.H.z + 0.12 * (b.S.z - b.H.z) / 0.34), uMuz = uAt(b.S.z - 0.08), uTail = uAt(b.P.z - 0.2);
  const rng = makeRng(seed);
  return { tex: canvasTexture(512, 256, (g, W, H) => {
    const X = u => u * W, Y = v => v * H;
    // base: russet flanks, darker back, cream belly (soft vertical gradient in v, mirrored about the belly)
    for (let y = 0; y < H; y++) {
      const v = y / H, d = Math.min(v, 1 - v);                 // 0 at the dorsal line, 0.5 at the belly
      const back = 1 - smoothstep(0.0, 0.12, d), belly = smoothstep(0.33, 0.42, d);
      const r = lerp(lerp(150, 92, back), 226, belly) * (1 - dark * 0.25), gg = lerp(lerp(96, 60, back), 214, belly) * (1 - dark * 0.22), bb = lerp(lerp(60, 40, back), 190, belly) * (1 - dark * 0.15);
      g.fillStyle = `rgb(${r | 0},${gg | 0},${bb | 0})`;
      g.fillRect(0, y, W, 1);
    }
    // dorsal line, from the neck to the tail
    const dl = g.createLinearGradient(0, 0, 0, 6);
    dl.addColorStop(0, 'rgba(48,30,20,0.9)'); dl.addColorStop(1, 'rgba(48,30,20,0)');
    g.fillStyle = dl; g.fillRect(X(uTail), 0, X(uNeck) - X(uTail), 6);
    const dl2 = g.createLinearGradient(0, H, 0, H - 6);
    dl2.addColorStop(0, 'rgba(48,30,20,0.9)'); dl2.addColorStop(1, 'rgba(48,30,20,0)');
    g.fillStyle = dl2; g.fillRect(X(uTail), H - 6, X(uNeck) - X(uTail), 6);
    // neck and head a little greyer
    const ng = g.createLinearGradient(X(uSh), 0, X(uHead), 0);
    ng.addColorStop(0, 'rgba(110,96,84,0)'); ng.addColorStop(1, 'rgba(110,96,84,0.35)');
    g.fillStyle = ng; g.fillRect(X(uSh), 0, X(1) - X(uSh), H);
    // rows of pale spots along each flank (sika: "plum blossom")
    const spot = (u, v, r) => {
      const grd = g.createRadialGradient(X(u), Y(v), 0, X(u), Y(v), r);
      grd.addColorStop(0, `rgba(242,232,210,${0.85 * spots})`); grd.addColorStop(0.6, `rgba(242,232,210,${0.6 * spots})`); grd.addColorStop(1, 'rgba(242,232,210,0)');
      g.fillStyle = grd; g.beginPath(); g.arc(X(u), Y(v), r, 0, TAU); g.fill();
    };
    for (const side of [1, -1]) {
      const vv = v => (side > 0 ? v : 1 - v);
      for (const [v0, n0] of [[0.075, 15], [0.115, 17], [0.16, 14], [0.205, 10]]) {
        for (let i = 0; i < n0; i++) {
          const u = lerp(uHip - 0.04, uSh + 0.02, (i + 0.5 + rng.range(-0.25, 0.25)) / n0);
          spot(u, vv(v0 + rng.range(-0.008, 0.008)), rng.range(2.2, 3.3));
        }
      }
    }
    // face: pale eye ring and a dark eye, light muzzle with a dark nose, white throat
    for (const side of [1, -1]) {
      const vv = v => (side > 0 ? v : 1 - v);
      spot(uEye, vv(0.19), 4.5);
      g.fillStyle = 'rgb(18,12,10)'; g.beginPath(); g.ellipse(X(uEye), Y(vv(0.19)), 2.6, 2.2, 0, 0, TAU); g.fill();
    }
    const mz = g.createLinearGradient(X(uMuz), 0, X(1), 0);
    mz.addColorStop(0, 'rgba(200,180,160,0)'); mz.addColorStop(0.5, 'rgba(200,180,160,0.7)'); mz.addColorStop(0.85, 'rgba(36,26,22,0.95)'); mz.addColorStop(1, 'rgba(20,14,12,1)');
    g.fillStyle = mz; g.fillRect(X(uMuz), 0, X(1) - X(uMuz), H);
    const th = g.createRadialGradient(X(uHead + 0.02), Y(0.5), 0, X(uHead + 0.02), Y(0.5), 14);
    th.addColorStop(0, 'rgba(236,228,214,0.9)'); th.addColorStop(1, 'rgba(236,228,214,0)');
    g.fillStyle = th; g.fillRect(X(uHead - 0.06), Y(0.35), 40, Y(0.3));
  }, { srgb: false }), uTail, uHip };
}

/* ------------------------------------------------------------------ */
/* Material: Lambert with the coat, procedural extremities, soft rim   */
/* ------------------------------------------------------------------ */
function deerMaterial({ tex, fogU, n, uRumpEdge }) {
  const U = {
    tCoat: { value: tex }, uMinW: { value: 0.0006 }, uRim: { value: new THREE.Color(0, 0, 0) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uFill: { value: new THREE.Color(0, 0, 0) },
    uFlare: { value: new Array(8).fill(0) }, uTint: { value: Array.from({ length: 8 }, () => new THREE.Vector3(1, 1, 1)) },
    uRumpEdge: { value: uRumpEdge },
  };
  const m = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  patchMaterial(m, {
    key: 'sikaDeer',
    uniforms: U,
    vertexHeader: `attribute vec4 aAux; uniform float uMinW; uniform float uFlare[8]; uniform vec3 uTint[8];
      varying vec2 vCoatUv; varying vec4 vAux; varying float vFlare; varying vec3 vTint; varying vec3 vWN;`,
    fragmentHeader: `uniform sampler2D tCoat; uniform vec3 uRim, uSunDir, uFill; uniform float uRumpEdge;
      varying vec2 vCoatUv; varying vec4 vAux; varying float vFlare; varying vec3 vTint; varying vec3 vWN;`,
    vertex: {
      '#include <skinning_vertex>': `$&
        {
          // thin legs and antler tines keep a minimum width on screen (no sub-pixel crawl at a distance)
          vec4 wq = modelMatrix * vec4(transformed, 1.0);
          float dist = length(wq.xyz - cameraPosition);
          transformed += normalize(objectNormal) * max(uMinW * dist - aAux.z, 0.0);
          int di = int(mod(aAux.w, 8.0) + 0.5);
          vFlare = uFlare[di]; vTint = uTint[di];
          vCoatUv = uv; vAux = aAux;
        }`,
      '#include <defaultnormal_vertex>': '$&\n vWN = normalize(mat3(modelMatrix) * objectNormal);',
    },
    fragment: {
      '#include <map_fragment>': `$&
        {
          float part = vAux.x;
          vec3 c = texture2D(tCoat, vCoatUv).rgb;
          c *= c;                                   // the atlas is painted in sRGB
          float body = step(part, 0.5);
          // white rump patch around the tail, edged black; it flares (spreads) when the deer is alarmed
          float vTop = min(vCoatUv.y, 1.0 - vCoatUv.y);
          float edge = uRumpEdge + vFlare * 0.035;
          float rump = body * (1.0 - smoothstep(edge - 0.012, edge, vCoatUv.x)) * (1.0 - smoothstep(0.3 + 0.05 * vFlare, 0.36 + 0.05 * vFlare, vTop));
          float rim = body * (1.0 - smoothstep(edge, edge + 0.014, vCoatUv.x)) * smoothstep(edge - 0.02, edge - 0.006, vCoatUv.x) * (1.0 - smoothstep(0.3, 0.38, vTop));
          c = mix(c, vec3(0.86, 0.84, 0.8), rump);
          c = mix(c, vec3(0.025, 0.02, 0.018), rim * 0.85);
          // legs: the coat's russet above, paler grey-tan from the knee and hock down; the white rump patch
          // continues down the back of the hind thighs
          float leg = step(0.5, part) * step(part, 1.5), hindLeg = step(1.1, part) * step(part, 1.4);
          vec3 legC = mix(vec3(0.33, 0.14, 0.055), vec3(0.24, 0.18, 0.125), smoothstep(0.32, 0.55, vCoatUv.x));
          legC = mix(legC, vec3(0.1, 0.07, 0.05), smoothstep(0.86, 0.95, vCoatUv.x));
          float thighBack = hindLeg * (1.0 - smoothstep(0.16, 0.26, vCoatUv.x)) * (1.0 - smoothstep(0.12, 0.2 + 0.04 * vFlare, abs(vCoatUv.y - 0.5)));
          legC = mix(legC, vec3(0.86, 0.84, 0.8), thighBack);
          c = mix(c, legC, leg);
          // hooves, antlers (dark at the burr, pale at the tips), ears (russet, pale inside, dark-rimmed tips), tail
          c = mix(c, vec3(0.03, 0.025, 0.022), step(4.5, part) * step(part, 5.5));
          c = mix(c, mix(vec3(0.24, 0.17, 0.1), vec3(0.78, 0.72, 0.62), smoothstep(0.1, 0.85, vAux.y)), step(3.5, part) * step(part, 4.5));
          float ear = step(2.5, part) * step(part, 3.5);
          float earR = step(1.5, vCoatUv.x), frontL = 1.0 - smoothstep(0.16, 0.3, abs(vCoatUv.y - 0.5));
          float inner = mix(frontL, 1.0 - frontL, earR);
          vec3 earC = mix(vec3(0.3, 0.15, 0.07), vec3(0.62, 0.56, 0.48), inner * (1.0 - smoothstep(0.55, 0.85, vAux.y)));
          earC = mix(earC, vec3(0.05, 0.035, 0.03), smoothstep(0.82, 0.96, vAux.y));
          c = mix(c, earC, ear);
          float tailp = step(5.5, part);
          c = mix(c, mix(vec3(0.8, 0.78, 0.74), vec3(0.04, 0.03, 0.025), 1.0 - smoothstep(0.06, 0.14, min(vCoatUv.y, 1.0 - vCoatUv.y))), tailp);
          diffuseColor.rgb = c * vTint;
        }`,
      '#include <opaque_fragment>': `{
          // a soft rim of light on the fur; seen against the sun the edges glow and the ears shine through
          vec3 V = normalize(cameraPosition - vFogWorld);
          float fr = 1.0 - clamp(abs(dot(normalize(vWN), V)), 0.0, 1.0);
          float back = max(dot(-V, uSunDir), 0.0);
          back *= back;
          outgoingLight += uRim * (fr * fr * (0.3 + 3.2 * back) * (diffuseColor.rgb + 0.15) + step(2.5, vAux.x) * step(vAux.x, 3.5) * back * 0.5 * diffuseColor.rgb);
          // skylight in the fur: the side away from the sun is never a flat dark cut-out
          outgoingLight += uFill * diffuseColor.rgb * (0.6 + 0.4 * normalize(vWN).y);
        }
        $&`,
    },
  });
  addFog(m, fogU, 'mfogDeer');
  m.userData.U = U;
  return m;
}

/* ------------------------------------------------------------------ */
/* The herd                                                            */
/* ------------------------------------------------------------------ */
const STAG = 0, HIND_K = 1, FAWN = 2;
export class DeerHerd {
  constructor({ env, scene, heightAt, fogU, seed, obstacles }) {
    this.env = env; this.heightAt = heightAt; this.obstacles = obstacles || [];
    const rng = this.rng = makeRng(seed ^ 0xd33f);
    const q = env.q;
    const n = clamp(3 + Math.round(3 * q), 3, 6);         // 4 on the iPad, 6 on a desktop
    const kinds = [STAG, HIND_K, HIND_K, FAWN, HIND_K, HIND_K].slice(0, n);
    const geo = new SkinGeo(), rig = new SegRig();
    this.deer = [];
    let coatInfo = null;
    kinds.forEach((kind, i) => {
      const k = kind === STAG ? rng.range(1.1, 1.14) : kind === FAWN ? rng.range(0.74, 0.78) : rng.range(0.96, 1.03);
      const spec = scaleSpec(HIND, k, kind === STAG ? { neck: 1.35 } : kind === FAWN ? { head: 1.1 } : {});
      if (kind === STAG) spec.antlers = ANTLERS;
      const a = new Animal(spec, geo, rig, { idx: i, heightAt });
      if (!coatInfo) coatInfo = a;
      const anchor = new THREE.Object3D();
      anchor.name = 'deer' + i;
      scene.add(anchor);
      this.deer.push({
        a, kind, k, anchor, i,
        pos: new THREE.Vector3(), heading: 0, hp: 0, speed: 0, turnV: 0,
        P: new THREE.Vector3(), C: new THREE.Vector3(), vP: new THREE.Vector3(), vC: new THREE.Vector3(), pPrev: new THREE.Vector3(), cPrev: new THREE.Vector3(),
        slot: { back: 0, side: 0 }, wander: new THREE.Vector2(), mode: 'walk', timer: 0, down: 0, downT: 0, look: 0, lookT: 0, ear: [0, 0], earT: rng.range(1, 4), earSide: 0,
        tail: 0, tailT: rng.range(2, 6), flare: 0, alertT: 0, gait: { ...spec.gait, off: spec.gait.off.slice() }, nod: 0,
        rng: rng.fork('deer' + i), labelPos: new THREE.Vector3(),
      });
    });
    // the same atlas fits every body (the bodies share their proportions); tints set them apart
    const coat = coatTexture(coatInfo, seed, { spots: 1 });
    this.tex = coat.tex;
    this.skeleton = rig.skeleton();
    this.geometry = geo.build();
    this.mat = deerMaterial({ tex: this.tex, fogU, n, uRumpEdge: coat.uTail + 0.085 });
    const U = this.mat.userData.U;
    this.deer.forEach(d => {
      const t = U.uTint.value[d.i];
      if (d.kind === STAG) t.set(0.78, 0.74, 0.72);        // the stag's darker autumn coat
      else if (d.kind === FAWN) t.set(1.08, 1.0, 0.94);
      else t.set(rng.range(0.92, 1.04), rng.range(0.9, 1.0), rng.range(0.88, 0.98));
    });
    this.bones = new THREE.Group();
    this.bones.name = 'deerBones';
    for (const b of this.skeleton.bones) this.bones.add(b);
    scene.add(this.bones);
    this.mesh = new THREE.SkinnedMesh(this.geometry, this.mat);
    this.mesh.bind(this.skeleton, new THREE.Matrix4());
    this.mesh.name = 'deerHerd';
    this.sphere = new THREE.Sphere(new THREE.Vector3(), 6);
    this.mesh.boundingSphere = this.sphere;
    this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.active = false;
    this.tmp = new THREE.Vector3(); this.tmp2 = new THREE.Vector3();
    this.anchorPos = new THREE.Vector3(); this.anchorDir = new THREE.Vector3();
  }

  setPath(pts) {
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p.x, 0, p.z)), false, 'centripetal');
    const N = 500;
    this.pathPts = curve.getSpacedPoints(N);
    this.pathLen = curve.getLength();
    this.pathStep = this.pathLen / N;
  }
  at(s, out, dir) {
    const P = this.pathPts, N = P.length - 1;
    const f = clamp(s / this.pathStep, 0, N - 1e-6), i = Math.floor(f), t = f - i;
    out.set(lerp(P[i].x, P[i + 1].x, t), 0, lerp(P[i].z, P[i + 1].z, t));
    if (s < 0) { const a = P[0], b = P[1], k = s / this.pathStep; out.set(a.x + (b.x - a.x) * k, 0, a.z + (b.z - a.z) * k); }
    if (s > this.pathLen) { const a = P[N - 1], b = P[N], k = (s - this.pathLen) / this.pathStep; out.set(b.x + (b.x - a.x) * k, 0, b.z + (b.z - a.z) * k); }
    if (dir) { const j = Math.min(i, N - 1); dir.set(P[j + 1].x - P[j].x, 0, P[j + 1].z - P[j].z).normalize(); }
    return out;
  }

  /** route = { pts: [{x, z}], graze: index of the grazing point, grazeFor (s), speed } */
  begin(route) {
    this.setPath(route.pts);
    const gp = route.pts[route.graze];
    let best = 0, bd = 1e9;
    this.pathPts.forEach((p, i) => { const d = (p.x - gp.x) ** 2 + (p.z - gp.z) ** 2; if (d < bd) { bd = d; best = i; } });
    this.sGraze = best * this.pathStep;
    this.grazeFor = route.grazeFor; this.vHerd = route.speed;
    this.s = 0; this.v = route.speed; this.phase = 'arrive'; this.grazeT = 0; this.flee = 0; this.fleeDir = 1;
    this.active = true;
    const r = this.rng;
    // loose group: slots behind the lead along the path and to either side
    const slots = [[0, 0.3], [1.6, -1.4], [2.4, 1.3], [3.6, -0.2], [4.6, 1.9], [5.2, -2.0]];
    r.shuffle(slots);
    this.deer.forEach((d, i) => {
      const sl = slots[i];
      d.slot.back = sl[0] + r.range(-0.4, 0.4) + (d.kind === STAG ? 1.0 : 0);
      d.slot.side = sl[1] + r.range(-0.3, 0.3);
      if (d.kind === FAWN) { const m = this.deer.find(x => x.kind === HIND_K); if (m) { d.slot.back = m.slot.back + 0.7; d.slot.side = m.slot.side + 0.8; } }
      this.slotPos(d, this.tmp);
      d.pos.copy(this.tmp);
      this.at(this.s - d.slot.back, this.tmp2, this.anchorDir);
      d.heading = d.hp = Math.atan2(this.anchorDir.x, this.anchorDir.z);
      d.speed = this.v; d.turnV = 0;
      d.mode = 'walk'; d.down = 0.15; d.downT = 0.15; d.flare = 0; d.look = 0; d.lookT = 0;
      d.gait.duty = d.a.spec.gait.duty; d.gait.off = d.a.spec.gait.off.slice(); d.gait.swingH = d.a.spec.gait.swingH;
      this.body(d, 0);
      d.cPrev.copy(d.C); d.pPrev.copy(d.P); d.vC.set(0, 0, 0); d.vP.set(0, 0, 0);
      d.a.plant(d.P, d.C, d.speed);
    });
    this.mesh.visible = true;
    this.bones.matrixWorldAutoUpdate = true;
  }
  slotPos(d, out) {
    this.at(this.s - d.slot.back, out, this.anchorDir);
    out.x += this.anchorDir.z * d.slot.side + d.wander.x;
    out.z += -this.anchorDir.x * d.slot.side + d.wander.y;
    return out;
  }
  body(d, dt) {
    const a = d.a, T = a.T, hx = Math.sin(d.heading), hz = Math.cos(d.heading), px = Math.sin(d.hp), pz = Math.cos(d.hp);
    d.C.set(d.pos.x + hx * T * 0.5, 0, d.pos.z + hz * T * 0.5);
    d.P.set(d.pos.x - px * T * 0.5, 0, d.pos.z - pz * T * 0.5);
    const mv = smoothstep(0.05, 0.6, d.speed), ph = a.phase;
    const bounce = d.gait.duty < 0.5 ? 0.028 * d.k * Math.max(0, Math.sin(TAU * 2 * (ph - 0.12))) : 0;
    d.C.y = this.heightAt(d.C.x, d.C.z) + a.chestH - 0.012 * mv * (0.5 + 0.5 * Math.cos(TAU * 2 * (ph - 0.3))) + bounce - (a.dropC || 0);
    d.P.y = this.heightAt(d.P.x, d.P.z) + a.hipH - 0.012 * mv * (0.5 + 0.5 * Math.cos(TAU * 2 * (ph - 0.05))) + bounce - (a.dropP || 0);
    void dt;
  }

  /** An offering landed at p: a herd within reach startles and bounds away (calmly), away from it. */
  startle(p) {
    if (!this.active || this.flee) return false;
    let near = false;
    for (const d of this.deer) if (Math.hypot(d.pos.x - p.x, d.pos.z - p.z) < 11) near = true;
    if (!near) return false;
    this.flee = 1;
    // leave by whichever end of the route is farther from the offering
    const a = this.at(0, this.tmp), da = Math.hypot(a.x - p.x, a.z - p.z);
    const b = this.at(this.pathLen, this.tmp2), db = Math.hypot(b.x - p.x, b.z - p.z);
    this.fleeDir = db >= da ? 1 : -1;
    for (const d of this.deer) { d.mode = 'alert'; d.timer = d.rng.range(0.35, 0.9); d.downT = 0; d.lookT = clamp(Math.atan2(p.x - d.pos.x, p.z - d.pos.z) - d.heading, -1, 1); }
    return true;
  }

  update(dt, t, ctx) {
    if (!this.active) return false;
    const r = this.rng;
    // ---- the herd's lead point along the route ----
    if (this.flee) {
      this.flee += dt;
      const vRun = this.flee < 0.8 ? 0 : this.flee < 7 ? 2.2 : 1.3;
      this.v = damp(this.v, vRun * this.fleeDir, 1.5, dt);
    } else if (this.phase === 'arrive') {
      this.v = damp(this.v, this.vHerd, 1, dt);
      if (this.s >= this.sGraze) { this.phase = 'graze'; this.grazeT = 0; }
    } else if (this.phase === 'graze') {
      this.grazeT += dt;
      // the lead drifts on slowly, in fits and starts, while they graze
      this.v = damp(this.v, 0.12 * (0.5 + 0.5 * Math.sin(this.grazeT * 0.35)), 0.8, dt);
      if (this.grazeT > this.grazeFor) this.phase = 'leave';
    } else this.v = damp(this.v, this.vHerd * 1.05, 0.7, dt);
    this.s += this.v * dt;
    const over = this.fleeDir > 0 ? this.s > this.pathLen + 6 : this.s < -6;
    if (over || this.s > this.pathLen + 6) {
      // gone past the end of the route (out of view): the pass is over
      this.end();
      return false;
    }
    // ---- each deer ----
    let cx = 0, cz = 0;
    for (const d of this.deer) {
      const a = d.a, dr = d.rng;
      const target = this.slotPos(d, this.tmp);
      if (this.flee) target.addScaledVector(this.anchorDir, this.fleeDir * 3);
      let dx = target.x - d.pos.x, dz = target.z - d.pos.z;
      // stay clear of one another and of the props
      for (const o of this.deer) {
        if (o === d) continue;
        const ox = d.pos.x - o.pos.x, oz = d.pos.z - o.pos.z, od = Math.hypot(ox, oz);
        if (od < 1.1 && od > 1e-4) { const k = (1.1 - od) * 2; dx += ox / od * k; dz += oz / od * k; }
      }
      for (const o of this.obstacles) {
        const ox = d.pos.x - o.x, oz = d.pos.z - o.z, od = Math.hypot(ox, oz), rr = o.r + 0.9;
        if (od < rr && od > 1e-4) { const k = (rr - od) * 2.5; dx += ox / od * k; dz += oz / od * k; }
      }
      const dist = Math.hypot(dx, dz);
      // behaviour
      d.timer -= dt;
      const onLawn = this.phase === 'graze' && !this.flee;
      if (this.flee) {
        if (d.mode === 'alert') {
          d.flare = damp(d.flare, 1, 10, dt); d.downT = 0;
          if (d.timer <= 0) { d.mode = 'run'; d.timer = 0; }
        } else {
          d.mode = 'run';
          d.flare = damp(d.flare, this.flee < 6 ? 1 : 0, 1.5, dt);
        }
      } else if (onLawn && dist < 0.9) {
        if (d.mode !== 'graze' && d.mode !== 'look') { d.mode = 'graze'; d.timer = dr.range(3, 7); }
        if (d.timer <= 0) {
          if (d.mode === 'graze') { d.mode = 'look'; d.timer = dr.range(1.8, 3.8); d.lookT = dr.range(-0.9, 0.9); }
          else { d.mode = 'graze'; d.timer = dr.range(4, 9); d.lookT = 0; if (dr.chance(0.5)) d.wander.set(dr.range(-0.7, 0.7), dr.range(-0.7, 0.7)); }
        }
      } else if (d.mode === 'graze' || d.mode === 'look') d.mode = 'walk';
      d.downT = d.mode === 'graze' ? 1 : d.mode === 'look' || d.mode === 'alert' ? 0 : d.mode === 'run' ? 0.05 : 0.2;
      if (d.mode !== 'look' && d.mode !== 'alert') d.lookT = 0;
      if (!this.flee) d.flare = damp(d.flare, 0, 0.8, dt);
      // speed and heading
      const run = d.mode === 'run';
      const vMax = run ? 2.6 * d.k : (d.mode === 'graze' || d.mode === 'look') ? 0.35 : 1.25 * Math.sqrt(d.k);
      let vT = d.mode === 'alert' ? 0 : clamp(dist * (run ? 1.2 : 0.75), 0, vMax);
      if (dist < 0.35 && !run) vT = 0;
      const want = dist > 0.05 ? Math.atan2(dx, dz) : d.heading;
      const err = angleDelta(d.heading, want);
      const wMax = run ? 1.8 : 1.1;
      d.turnV = damp(d.turnV, clamp(err * 2.2, -wMax, wMax) * (vT > 0.05 || Math.abs(err) > 0.4 ? 1 : 0), 6, dt);
      d.heading += d.turnV * dt;
      if (d.heading > Math.PI) d.heading -= TAU; else if (d.heading < -Math.PI) d.heading += TAU;
      vT *= clamp(1.2 - Math.abs(err) / 1.4, 0.15, 1);
      d.speed = damp(d.speed, vT, vT > d.speed ? (run ? 3 : 1.6) : 3, dt);
      d.pos.x += Math.sin(d.heading) * d.speed * dt;
      d.pos.z += Math.cos(d.heading) * d.speed * dt;
      const hpPrev = d.hp;
      d.hp += angleDelta(d.hp, d.heading) * (1 - Math.exp(-(2 + 4 * d.speed) * dt));
      // the hindquarters swinging round after a turn step the hind legs too
      const hpRate = dt > 1e-6 ? angleDelta(hpPrev, d.hp) / dt : 0;
      // gait: a springy trot when running, the walk otherwise (offsets slide over while it is stepping briskly)
      const G = d.gait, base = a.spec.gait;
      const trot = run && d.speed > 1.2 ? 1 : 0;
      const rate = a.rate || 0;
      G.duty = damp(G.duty, trot ? 0.4 : base.duty, 3, dt);
      G.swingH = damp(G.swingH, trot ? base.swingH * 1.8 : base.swingH, 3, dt);
      // a quick, short trot (about 2 strides a second): long enough strides would over-reach a deer's legs
      G.L0 = damp(G.L0, trot ? base.L0 * 1.15 : base.L0, 3, dt);
      if (rate > 0.8) for (let i = 0; i < 4; i++) { const tgt = trot ? TROT_OFF[i] : base.off[i]; G.off[i] += clamp(tgt - G.off[i], -0.5 * dt, 0.5 * dt); }
      // head, ears, tail
      d.down = damp(d.down, d.downT, d.downT > d.down ? 1.3 : 2.2, dt);
      d.look = damp(d.look, d.lookT, 2.2, dt);
      d.earT -= dt;
      if (d.earT <= 0) { d.earT = dr.range(1.5, 5); d.earSide = dr.int(0, 1); d.earK = 0; }
      d.earK = (d.earK ?? 1) + dt / 0.32;
      const fl = d.earK < 1 ? Math.sin(Math.PI * d.earK) : 0;
      d.ear[0] = d.earSide === 0 ? fl : 0; d.ear[1] = d.earSide === 1 ? fl : 0;
      d.tailT -= dt;
      if (d.tailT <= 0) { d.tailT = dr.range(2, 7); d.tailK = 0; }
      d.tailK = (d.tailK ?? 1) + dt / 0.6;
      const tw = d.tailK < 1 ? Math.sin(TAU * 2 * d.tailK) * (1 - d.tailK) : 0;
      // pose
      this.body(d, dt);
      const kv = 1 - Math.exp(-14 * dt);
      if (dt > 1e-6) {
        d.vC.lerp(this.tmp2.subVectors(d.C, d.cPrev).divideScalar(dt), kv);
        d.vP.lerp(this.tmp2.subVectors(d.P, d.pPrev).divideScalar(dt), kv);
      }
      d.cPrev.copy(d.C); d.pPrev.copy(d.P);
      const st = d.st || (d.st = { ears: [0, 0] });
      st.P = d.P; st.C = d.C; st.vP = d.vP; st.vC = d.vC; st.speed = d.speed; st.turn = Math.abs(d.turnV) > Math.abs(hpRate) ? d.turnV : hpRate;
      st.roll = 0.02 * smoothstep(0.1, 0.8, d.speed) * Math.sin(TAU * a.phase);
      st.bend = clamp(-d.turnV * 0.08, -0.06, 0.06);
      st.down = d.down;
      st.nod = 0.05 * smoothstep(0.1, 0.6, d.speed) * Math.sin(TAU * 2 * a.phase + 0.6) * (1 - d.down);
      st.lookYaw = d.look; st.lookPitch = 0;
      st.ears[0] = d.ear[0] * 0.8; st.ears[1] = d.ear[1] * 0.8;
      st.earBack = d.mode === 'run' ? 0.5 : 0;
      st.tailLift = d.flare * 0.9; st.tailWag = tw * 0.5;
      st.gait = G;
      a.pose(dt, st);
      this.mat.userData.U.uFlare.value[d.i] = d.flare;
      d.anchor.position.set(d.pos.x, this.heightAt(d.pos.x, d.pos.z), d.pos.z);
      d.anchor.rotation.set(0, d.heading, 0);
      d.labelPos.set(d.pos.x, d.anchor.position.y + a.chestH + 0.45 * d.k, d.pos.z);
      cx += d.pos.x; cz += d.pos.z;
    }
    const n = this.deer.length;
    this.sphere.center.set(cx / n, this.heightAt(cx / n, cz / n) + 0.8, cz / n);
    let rr = 0;
    for (const d of this.deer) rr = Math.max(rr, Math.hypot(d.pos.x - this.sphere.center.x, d.pos.z - this.sphere.center.z));
    this.sphere.radius = rr + 1.8;
    this.mat.userData.U.uMinW.value = 0.5 * 1.5 / Math.max(ctx.pxK, 1);
    this.mat.userData.U.uRim.value.copy(ctx.rim);
    if (ctx.sunDir) this.mat.userData.U.uSunDir.value.copy(ctx.sunDir);
    if (ctx.fill) this.mat.userData.U.uFill.value.copy(ctx.fill);
    void t; void r;
    return true;
  }
  end() {
    this.active = false;
    this.mesh.visible = false;
    this.bones.matrixWorldAutoUpdate = false;
  }
  dispose() { this.geometry.dispose(); this.mat.dispose(); this.tex.dispose(); this.skeleton.dispose(); }
}
