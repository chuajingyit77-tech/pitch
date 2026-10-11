// 晴岛 shared bits: water-volume uniforms + GLSL used by every material that can sit below the
// sea surface, render layers, and a tiny instanced "part batch" used to animate creatures.
import * as THREE from 'three';
import { GLSL, patchMaterial } from '../../lib/util.js';

/** Layer 1 = main camera only (skipped by the water reflection pass). */
export const LAYER_NO_REFLECT = 1;

/**
 * Shared water-volume uniforms. Every submerged surface (seabed, rocks, turtles, fish, dock posts)
 * tints itself with the same absorption so the shallows read as one clear body of water that
 * fades to the open-ocean blue. The surface shader adds reflections, glitter and foam on top.
 */
export const waterUniforms = {
  uWTime: { value: 0 },
  uAbsorb: { value: new THREE.Vector3(0.9, 0.2, 0.13) },  // per metre of light path
  uDeep: { value: new THREE.Color(0.008, 0.07, 0.17) },     // asymptotic in-scatter radiance (lit)
  uCaustic: { value: new THREE.Color(1, 1, 1) },            // sun colour * intensity, 0 at night
  uGlowUW: { value: new THREE.Color(0, 0, 0) },             // night plankton glow tint
};

export const UNDERWATER_GLSL = /* glsl */`
uniform float uWTime;
uniform vec3 uAbsorb;
uniform vec3 uDeep;
uniform vec3 uCaustic;
vec3 underwaterFog(vec3 col, vec3 wpos) {
  float d = -wpos.y;
  if (d <= 0.0) return col;
  vec3 V = normalize(cameraPosition - wpos);
  float path = d / max(V.y, 0.12) + d * 0.8;
  vec3 T = exp(-uAbsorb * path);
  return col * T + uDeep * (1.0 - T);
}
`;

/**
 * Make a material water-aware: below y = 0 it gets absorption + in-scatter, optionally caustics.
 * Works on any built-in material with fog_vertex / opaque_fragment chunks (incl. wind-patched ones).
 */
export function addUnderwater(material, { caustics = false, includeNoise = true, key = '' } = {}) {
  return patchMaterial(material, {
    key: 'uw' + (caustics ? 'c' : '') + key,
    uniforms: waterUniforms,
    vertexHeader: 'varying vec3 vUwPos;',
    fragmentHeader: 'varying vec3 vUwPos;\n' + UNDERWATER_GLSL + (caustics ? (includeNoise ? GLSL.noise : '') + GLSL.caustics : ''),
    vertex: {
      '#include <fog_vertex>': '$&\n vUwPos = (mvPosition.xyz - viewMatrix[3].xyz) * mat3(viewMatrix);',
    },
    fragment: {
      '#include <opaque_fragment>': `$&
        {
          float uwD = -vUwPos.y;
          ${caustics ? `if (uwD > 0.0) {
            float cs = caustics(vUwPos.xz * 0.55, uWTime * 0.7) + caustics(vUwPos.xz * 0.23 + 4.0, uWTime * 0.45) * 0.6;
            gl_FragColor.rgb += diffuseColor.rgb * uCaustic * cs * 0.32 * smoothstep(0.0, 0.35, uwD) * exp(-uwD * 0.22);
          }` : ''}
          gl_FragColor.rgb = underwaterFog(gl_FragColor.rgb, vUwPos);
        }`,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Instanced part batches for animated creatures                       */
/* ------------------------------------------------------------------ */
export class Batch {
  constructor(geometry, material, max, { shadow = true, receive = false, color = false, layer = 0 } = {}) {
    this.mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, max));
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadow;
    this.mesh.receiveShadow = receive;
    if (color) { this.mesh.setColorAt(0, new THREE.Color(1, 1, 1)); this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage); }
    if (layer) this.mesh.layers.set(layer);
    this.mesh.count = 0;
    this.n = 0;
    this.max = Math.max(1, max);
  }
  begin() { this.n = 0; }
  add(m4, color) {
    if (this.n >= this.max) return -1;
    const i = this.n++;
    this.mesh.setMatrixAt(i, m4);
    if (color && this.mesh.instanceColor) this.mesh.setColorAt(i, color);
    return i;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
/**
 * Matrix for a limb segment from a to b (world space), for a unit geometry spanning y∈[0,1].
 * `side` is any vector not parallel to the segment, used to orient the thickness axes.
 */
export function segmentMatrix(out, a, b, thick, side) {
  _y.subVectors(b, a);
  const len = _y.length() || 1e-4;
  _y.divideScalar(len);
  _x.crossVectors(_y, side);
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0).cross(_y);
  _x.normalize();
  _z.crossVectors(_x, _y).normalize();
  const e = out.elements;
  e[0] = _x.x * thick; e[1] = _x.y * thick; e[2] = _x.z * thick; e[3] = 0;
  e[4] = _y.x * len; e[5] = _y.y * len; e[6] = _y.z * len; e[7] = 0;
  e[8] = _z.x * thick; e[9] = _z.y * thick; e[10] = _z.z * thick; e[11] = 0;
  e[12] = a.x; e[13] = a.y; e[14] = a.z; e[15] = 1;
  return out;
}

/** Recompute vertex normals and bend them toward +Y (soft, rounded foliage shading). */
export function softenNormals(geometry, upBias = 0.5) {
  geometry.computeVertexNormals();
  const n = geometry.attributes.normal;
  for (let i = 0; i < n.count; i++) {
    _x.set(n.getX(i), n.getY(i), n.getZ(i)).lerp(_y.set(0, 1, 0), upBias).normalize();
    n.setXYZ(i, _x.x, _x.y, _x.z);
  }
  n.needsUpdate = true;
  return geometry;
}
