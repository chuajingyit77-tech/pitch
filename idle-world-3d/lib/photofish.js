// Photo fish: fish modelled from photographs, from the "Fish Kit" by なちゃっと (https://cda-social.github.io/fish/,
// CC0 1.0: models and photos dedicated to the public domain). Only the kit's models are used, packed by
// tools/photofish_pack.py (detailed and far model, fin regions, an atlas with an opaque body and bled edges); they
// swim with our own shader (lib/fish.js applySwim) and keep see-through fins on the iPad (applyFinAlpha + fin pass).
import * as THREE from 'three';
import { applySwim, applyFinAlpha, FishInstances } from './fish.js';

/**
 * Load a packed species: `hi` (~5,000 triangles) and `lo` (~700) geometries in the fish frame (head toward +X,
 * length 1, centred) with aFin, the shared atlas, and the real fish's length in metres.
 */
export async function loadPhotoFish(env, id) {
  const gltf = await env.loadGLTF(`models/fish_${id}.glb`);
  const out = { id, hi: null, lo: null, map: null, length: gltf.parser?.json?.extras?.lengthM ?? 0.4 };
  gltf.scene.traverse(o => {
    if (!o.isMesh || (o.name !== 'hi' && o.name !== 'lo')) return;
    const g = o.geometry;
    // glTF custom attributes arrive lower-cased (_AFIN -> _afin); the swim shader reads aFin
    if (!g.getAttribute('aFin') && g.getAttribute('_afin')) { g.setAttribute('aFin', g.getAttribute('_afin')); g.deleteAttribute('_afin'); }
    out[o.name] = g;
    out.map = o.material.map;
  });
  if (!out.hi || !out.lo || !out.map) throw new Error(`photo fish ${id}: incomplete model`);
  out.map.anisotropy = 4;
  return out;
}

/**
 * The material of a photo fish: the photographs carry their own light and shade, so a plain standard surface
 * (moist: a soft sheen, no metal), swimming, with see-through fins.
 */
export function photoFishMaterial(map, { roughness = 0.42, envMapIntensity = 0.8, waveK = 6.5 } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map, roughness, metalness: 0, envMapIntensity,
    side: THREE.DoubleSide,
    alphaToCoverage: true,
    alphaTest: 0.04,
  });
  applySwim(mat, { waveK });
  return applyFinAlpha(mat);
}

/**
 * A species drawn instanced at one level of detail (`lod`: 'hi' near the viewer, 'lo' in the distance). Each fish
 * keeps its instance slot for good (push them in the same order every frame), so nothing swaps between meshes.
 */
export class PhotoFishGroup {
  constructor(spec, material, max, { lod = 'hi', castShadow = false, name = spec.id } = {}) {
    this.inst = new FishInstances(spec[lod], material, max, { castShadow });
    this.inst.mesh.name = name;
    this.mesh = this.inst.mesh;
    this.ampK = 1;
  }
  begin() { this.inst.begin(); }
  /** One fish (a Swimmer); its tail beat is scaled by this species' ampK and the fish's own `calm` (0..1). */
  push(f) {
    const a = f.amp;
    f.amp = a * this.ampK * (f.calm ?? 1);
    const i = this.inst.push(f);
    f.amp = a;
    return i;
  }
  end(time) { this.inst.end(time); }
  dispose() { this.inst.geometry.dispose(); }
}
