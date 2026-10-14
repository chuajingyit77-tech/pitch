// 雨林 · shading for the far vista (the ridges behind the cliff, the ancient tree, the gentle giants, the egrets).
// Everything out there stands in open air, outside the clearing's canopy, so it gets its own light model:
//  - full sun (or moon) with a soft wrap and a soft rim light, sky / ground ambient, no canopy dapples;
//  - aerial perspective: distance haze toward a sky-coloured haze that brightens toward the sun;
//  - mist sheets: three curtains of drifting mist standing round the clearing (cylinders about the view target):
//    at the near ridge (round the giants' feet), at the far ridge (round the ancient tree's foot) and high up in
//    front of the mountains. They are evaluated analytically per pixel (ray / cylinder intersection and one noise
//    read each) in the far materials and in the sky, so the layered mist costs no transparent overdraw at all; the
//    near world (cliff, plateau forest) simply covers them. Being cylinders round the clearing, they stay in front
//    of the ridges from every angle the camera orbits to;
//  - the scene's own height fog (jgFog) on top, so the vista sits in the same air as the clearing.
import * as THREE from 'three';
import { JG_GLSL } from './shading.js';

/** The mist curtains: radius about the view target, centre height, half-thickness, density. The valley between
 * the ridges, the foot of the ancient tree and the air before the mountains each hold one. */
export const MIST_SHEETS = [
  { r: 101, y: 27, h: 5.5, k: 0.5 },      // valley mist behind the near ridge: the giants stand out against it
  { r: 172, y: 61, h: 8, k: 0.45 },       // round the ancient tree's foot, behind the far ridge
  { r: 230, y: 66, h: 20, k: 0.45 },      // high haze in front of the far mountains
];
const CX = 1.4, CZ = -3.6; // the view target (jungle.js VIEW_TARGET)

export function createVistaUniforms() {
  return {
    uHazeCol: { value: new THREE.Color('#9fb8ae') },     // aerial perspective colour (away from the sun)
    uHazeSunCol: { value: new THREE.Color('#e8e0c0') },  // toward the sun
    uHazeK: { value: 1 / 340 },                          // haze per metre beyond the clearing
    uMistCol: { value: new THREE.Color('#c8d8d0') },     // lit mist
    uMistAmt: { value: 1 },
    uMistScroll: { value: new THREE.Vector4() },          // drifting noise offsets, wrapped to 1 in JS
    uSkyAmb: { value: new THREE.Color('#9ab0c0') },
    uGroundAmb: { value: new THREE.Color('#3a4a30') },
    uFarGlow: { value: new THREE.Color('#3ff0d8') },     // bioluminescent moss on the tree roots / the giants' backs
    uVistaExp: { value: 0.6 },                            // the open air out there is far brighter than the shaded clearing: an exposure for it
    uGlowPh: { value: 0 },                                // breathing phase of that glow, wrapped in JS
  };
}

const f1 = x => x.toFixed(1), f2 = x => x.toFixed(2);
const sheetCall = (k, scroll) => {
  const s = MIST_SHEETS[k];
  return `vistaSheet(ro, rd, tSurf, ${f1(s.r)}, ${f1(s.y)}, ${f1(s.h)}, ${f2(s.k)}, ${scroll})`;
};

// The GLSL shared by every far material and the sky (needs JG_GLSL's uniforms and functions in front of it).
export const VISTA_GLSL = /* glsl */`
  uniform vec3 uHazeCol, uHazeSunCol, uMistCol, uSkyAmb, uGroundAmb, uFarGlow;
  uniform float uHazeK, uMistAmt, uGlowPh, uVistaExp;
  uniform vec4 uMistScroll;
  // one curtain of mist: the vertical cylinder of radius R about the view target, a soft band round height y0
  // (denser at its foot), its noise drifting along it
  float vistaSheet(vec3 ro, vec3 rd, float tSurf, float R, float y0, float h, float k, vec2 scroll) {
    vec2 o = ro.xz - vec2(${f1(CX)}, ${f1(CZ)});
    vec2 dxz = rd.xz;
    float a = dot(dxz, dxz);
    if (a < 1e-4) return 0.0;
    float b = dot(o, dxz), c = dot(o, o) - R * R;
    float disc = b * b - a * c;
    if (disc <= 0.0) return 0.0;
    float t = (-b + sqrt(disc)) / a;           // the camera is inside: the far intersection
    if (t <= 0.0 || t >= tSurf) return 0.0;
    vec3 p = ro + rd * t;
    float v = (p.y - y0) / h;
    float prof = smoothstep(-1.2, -0.4, v) * (1.0 - smoothstep(-0.3, 1.0, v));
    // noise along the curtain: (arc length, height); one read of the cookie's soft fbm channel
    float arc = atan(p.x - ${f1(CX)}, ${f1(CZ)} - p.z) * R;
    float n = texture2D(uCookieTex, vec2(arc * 0.0105, p.y * 0.024) + scroll).b;
    return k * prof * smoothstep(0.2, 0.75, n + 0.22 - 0.22 * v);
  }
  vec3 vistaMistCol(vec3 rd) {
    float fwd = pow(max(dot(rd, uLightDirW), 0.0), 4.0);
    return uMistCol + uLightCol * fwd * 0.22 * smoothstep(-0.12, 0.08, uLightDirW.y);
  }
  // the mist curtains in front of a point at distance tSurf along rd (far to near; tSurf = 1e6 for the sky)
  vec3 vistaMist(vec3 col, float tSurf, vec3 rd) {
    vec3 ro = cameraPosition;
    vec3 mc = vistaMistCol(rd);
    col = mix(col, mc, ${sheetCall(2, 'uMistScroll.zw')} * uMistAmt);
    col = mix(col, mc, ${sheetCall(1, 'uMistScroll.xy * 0.8 + vec2(0.37, 0.11)')} * uMistAmt);
    col = mix(col, mc, ${sheetCall(0, 'uMistScroll.xy')} * uMistAmt);
    return col;
  }
  // haze + mist curtains + the scene's height fog (hazeK scales the haze: the landmark keeps a little more presence)
  vec3 vistaAtmosK(vec3 col, vec3 wp, float tSurf, vec3 rd, float hazeK) {
    // aerial perspective beyond the clearing (the first 60 m are the clearing's own air)
    float d = max(tSurf - 60.0, 0.0) * hazeK;
    float haze = 1.0 - exp(-d * uHazeK);
    float sunF = pow(max(dot(rd, uLightDirW), 0.0), 3.0) * smoothstep(-0.12, 0.08, uLightDirW.y);
    col = mix(col, mix(uHazeCol, uHazeSunCol, sunF), haze);
    col = vistaMist(col, tSurf, rd);
    // the clearing's ground fog is calibrated for its own humid air: light from the vista only crosses the first few
    // tens of metres of it (the rest of the way is the haze above)
    return jgFog(col, cameraPosition + (wp - cameraPosition) * 0.2);
  }
  vec3 vistaAtmos(vec3 col, vec3 wp, float tSurf, vec3 rd) { return vistaAtmosK(col, wp, tSurf, rd, 1.0); }
  // open-air light: sun or moon with a soft wrap, sky / ground ambient (ao = baked occlusion), and a soft rim light of
  // strength rimK on silhouettes (the animals, the birds, the tree's edges; none on terrain seen edge-on)
  vec3 vistaLight(vec3 albedo, vec3 N, vec3 V, float ao, float wrapK, float rimK) {
    vec3 L = uLightDirW;
    float ndl = dot(N, L);
    float wrap = max((ndl + wrapK) / (1.0 + wrapK), 0.0);
    float up = N.y * 0.5 + 0.5;
    vec3 amb = mix(uGroundAmb, uSkyAmb, up);
    vec3 col = albedo * (amb * ao * 0.5 + uLightCol * wrap * (0.55 + 0.45 * ao) * 0.78);
    // rim: a thin bright edge on the silhouette, strongest with the light behind it (back-lit mist and hide)
    float rim = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
    float back = pow(max(dot(-V, L), 0.0), 2.0);
    col += (uLightCol * (0.04 + 0.42 * back) + uSkyAmb * 0.1) * rim * ao * rimK;
    return col * uVistaExp;
  }
`;

/** Wrap a JS clock into the uniforms the far materials read (all seamless: scroll offsets wrap to 1 and the glow
 * phase is a sine phase wrapped to 2π, all in double precision). */
export function setVistaClock(U, t) {
  const fr = x => x - Math.floor(x);
  // the near curtains drift sideways at ~0.6 m/s (0.0105 noise units per metre) and rise very slowly, the far one slower
  U.uMistScroll.value.set(fr(t * 0.0063), fr(t * 0.0011), fr(-t * 0.0036), fr(t * 0.0007));
  // moss and markings breathe with a ~7 s period
  U.uGlowPh.value = (t * 0.9) % (Math.PI * 2);
}
