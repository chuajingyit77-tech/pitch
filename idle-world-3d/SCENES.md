# 栖境 · Scene authoring guide

栖境 is a 3D idle-screen app: every office computer gets its own living world (reef, koi pond,
pampas meadow, island, rainforest, cloud sea) that runs as a screensaver and that people can
feed. It runs in the browser with three.js r160 (ES modules from jsDelivr via an import map).

The bar is **a premium game look**, not a demo: cinematic lighting, atmosphere, motion everywhere
(wind, water, particles, creatures), careful color grading, believable animal behaviour. Each
world borrows the art direction of a well-known game; never copy that game's assets, characters
or logos.

## Files

```
index.html          HUD markup + CSS + import map (do not edit)
app.js              shell: renderer, post FX, camera rig, input, save data (do not edit)
lib/util.js         math, seeded rng, simplex noise, canvas textures, GLSL snippets, wind, sun model
lib/fish.js         procedural fish: geometry, painted atlas, swim shader, instancing, steering
lib/audio.js        procedural ambience layers (names listed below)
scenes/<id>.js      one world per file (yours)
scenes/<id>/...     optional helper modules for your world
assets/models       Fox.glb, Parrot.glb, Flamingo.glb, Stork.glb, Barramundi.glb
assets/textures     waternormals.jpg, Water_1_M_Normal.jpg, Water_2_M_Normal.jpg
assets/hdr          venice_sunset_1k.hdr
```

Only edit your own `scenes/<id>.js` (and `scenes/<id>/`, `assets/<id>/` if you need them). If the
shell or a lib has a bug or is missing something, work around it inside your scene and report it.

## Module shape

```js
import * as THREE from 'three';
export default {
  id: 'reef',
  food: '鱼食',                       // shown on the feed button and in toasts
  kinds: { clownfish: { zh: '小丑鱼' }, ... },   // every resident kind this world supports
  starter: ['clownfish', 'clownfish', 'blueTang'],  // residents created on first visit
  addable: ['clownfish', 'blueTang'],  // kinds the "新居民" button may add (random pick)
  maxMembers: 16,
  ambience: hours => hours > 19 || hours < 6 ? ['underwater'] : ['underwater'],  // or an array
  eatSound: 'eat',                    // sfx played when something eats (optional)
  async create(env) { ...; return instance; },
};
```

### `env` (passed to create)

| field | meaning |
|---|---|
| `THREE, renderer, pmrem` | three namespace, the WebGLRenderer, a shared PMREMGenerator |
| `quality, q, shadows` | `'high'|'medium'|'low'`, a scale factor (1 / 0.7 / 0.45) for counts and resolutions, and whether shadows are on |
| `seed, rng` | per-computer, per-world seed and a seeded rng (`rng.range(a,b)`, `rng.int`, `rng.pick`, `rng.chance`, `rng.gauss`, `rng.fork(salt)`). **All layout must come from this rng** so each computer gets a unique but stable world. |
| `hours()` | current local time of day (0–24), real clock or the user's manual setting. Read it every frame. |
| `sun(opts)` | `sunState(hours)` from util: `{ dir, moonDir, elevationDeg, day, night, golden, zenith, horizon, sunColor, sunIntensity, skyAmbient, groundAmbient, ambientIntensity }` |
| `members` | persistent resident records `{ id, kind, name, size (0.9–1.5, grows when fed), eaten, lastAte, born, seed }`. Spawn one creature per record. You may add fields such as `member.variant` (call `env.markDirty()` after). |
| `fullness(member)` | 0..1, drops to 0 over 4 h without food. Hungry residents should act hungry (come to the glass/surface, follow the camera, wait near the feeding spot…). |
| `onEat(member or null, worldPos)` | call whenever a creature eats. Members get a heart, growth and a toast; pass `null` for ambient creatures. |
| `toast(text)`, `sfx(name)` | small message; one-shot sound (`drop splash thud eat chirp chime pop tok`) |
| `loadGLTF(path)`, `loadTexture(path,{srgb,repeat})`, `loadTextureAsync`, `loadHDR(path)` | paths relative to `assets/`, results cached. Clone GLTF scenes before adding (use `SkeletonUtils.clone` for the Fox). |
| `isIdle()` | true while in screensaver mode |
| `markDirty()` | persist member changes |

### instance (returned from create)

```js
{
  scene, camera,                       // THREE.Scene, THREE.PerspectiveCamera (aspect handled by the shell)
  view: {                              // the shell's orbit rig
    target: [x,y,z] | Vector3,         // read every frame, you may move it
    dist, distRange: [min,max],
    yaw, yawRange: [min,max] | null,   // radians; yaw 0 = camera on +Z looking toward -Z
    pitch, pitchRange: [min,max],      // radians above the horizon
    drift: 0.04,                       // idle auto-orbit speed (rad/s); ping-pongs inside yawRange
    idlePitch, idleDist,               // optional framing to ease into while idle
    fov: 40, minY,                     // optional
    custom: false,                     // true = you drive the camera yourself in update()
  },
  post: {                              // read every frame, so you may animate it with time of day
    bloom: { strength, radius, threshold },
    exposure, toneMapping: 'aces'|'agx',
    vignette, grain, saturation, contrast, lift: [r,g,b], gain: [r,g,b], ca,
    tilt: { amount, center, width },   // tilt-shift blur, 0..1 amount, screen-space (disabled on low)
  },
  update(dt, t),                       // dt capped at 0.05 s
  feed(raycaster),                     // user clicked: intersect your water/ground, spawn food, return the hit point (Vector3) or null
  feedRandom(n),                       // optional "撒一把": spawn n foods near the action, return n
  addMember(member),                   // a new resident was added at runtime
  creatures(),                         // [{ member?, label?, pos: Vector3, radius }] for hover name tags
  dispose(),                           // free anything not reachable from scene (render targets, mixers, listeners)
  resize?(w, h),
}
```

The shell renders `RenderPass → UnrealBloom → OutputPass (tone mapping) → grading/vignette/grain/tilt-shift`,
with an MSAA half-float target. Use HDR light values freely; bloom threshold is in linear HDR.
`renderer.shadowMap` is PCFSoft and enabled when `env.shadows`.

## Libraries you can import

`../lib/util.js`: `TAU clamp lerp invLerp smoothstep damp dampVec angleDelta dampAngle makeRng hashString
createNoise(seed) → { noise2, noise3, fbm2, fbm3, ridged2 } makeCanvas canvasTexture(w,h,draw,{srgb,repeat})
normalMapFromHeight(canvas, strength) noiseCanvas(w,h,{seed,scale,octaves,map,tile}) softDiscTexture(size)
sunState(hours,{latitude,azimuthOffset}) GLSL.noise GLSL.caustics patchMaterial(material,{uniforms,vertexHeader,
fragmentHeader,vertex:{chunk:replacement},fragment:{...},key}) createWind() addWind(material, wind,
{height, amount, stiffness, flutter}) disposeObject quatFromForward(q, forward, roll)`

- `patchMaterial`: replacement strings may contain `$&` to keep the original chunk. Always keep
  `#include <begin_vertex>` via `$&` (it writes `vPosition` for alphaHash).
- `addWind`: vertex wind sway for plants. Object-space `position.y` is the height; works on
  InstancedMesh with any instance rotation/scale. Call `wind.update(dt)` each frame. One wind per scene.
- `GLSL.noise` gives `hash12 hash22 vnoise snoise(vec3) fbm3`; `GLSL.caustics` (needs GLSL.noise) gives
  `caustics(vec2 p, float t)` → a bright web of light lines.

`../lib/fish.js`: `SHAPES` (koi, koiButterfly, clownfish, blueTang, yellowTang, chromis, moorishIdol,
emperorAngel) `buildFishGeometry(shape,{detail}) paintFish(species,{seed,size,variety}) → {map, normalMap,
material} createFishMaterial(painted, overrides) applySwim(material) prepareSwimGeometry(geometry)
FishInstances(geometry, material, max, {castShadow}) Swimmer({pos,size,speed,rng,agility}) schoolForce(...)`

- Fish local frame: head toward **+X**, length ≈ 1 centred at the origin, +Z = fish's right side.
- Per frame: `swimmer.steer(desiredVelocity, dt).integrate(dt)`, then `instances.begin(); instances.push(swimmer); instances.end(t)`.
  `push` reads `pos, quat, size, phase, amp, turn, flutter` so you can push any object with those fields.
- Koi varieties for `paintFish('koi', {variety})`: kohaku, tancho, sanke, showa, ogon, platinum, yamabuki, chagoi, asagi, kigoi, benigoi.

Audio ambience layer names for `ambience`: `underwater ocean wind rain stream waterfall birds gulls insects frogs chimes pad shishi fire`.

## Assets

- `models/Fox.glb` — skinned, clips `Survey` (idle look-around), `Walk`, `Run`. Use `SkeletonUtils.clone`.
  Native units are large: scale ≈ 0.01 gives a fox about 0.5–0.6 m long. Faces +Z. CC0 model, CC-BY 4.0 rig (credited in settings).
- `models/Parrot.glb`, `Flamingo.glb`, `Stork.glb` — morph-target flap cycle in `gltf.animations[0]`
  (play with an `AnimationMixer` per clone; vary `timeScale`, pause the action for glides).
  Native wingspan ≈ 150 units, so scale ≈ 0.01. They fly toward +Z.
- `models/Barramundi.glb` — photoreal CC0 fish, ≈ 0.64 long along Z, belly at y=0, head toward +Z after its node rotation.
- `textures/waternormals.jpg` (for `three/addons/objects/Water.js`), `Water_1_M_Normal.jpg`, `Water_2_M_Normal.jpg` (for Water2 / custom water).
- `hdr/venice_sunset_1k.hdr` — sunset HDRI (Poly Haven, CC0).
- Anything else should be procedural (canvas textures, noise, shaders) or downloaded by you from a
  CC0 / MIT source into `assets/<id>/`. Keep each world's extra assets under ~3 MB and record the license.

Useful three r160 addons: `objects/Sky.js`, `objects/Water.js`, `objects/Water2.js`, `objects/Reflector.js`,
`objects/Lensflare.js`, `utils/SkeletonUtils.js`, `utils/BufferGeometryUtils.js` (mergeGeometries),
`environments/RoomEnvironment.js`, `math/SimplexNoise.js`, `geometries/*`.

## Rules of thumb

- Units are metres. Keep the interesting part of the world within ~30 m of the camera target.
- Scale counts and resolutions with `env.q` (grass blades, particles, shadow map size, render-target size).
  Budget at q=1: under ~200 draw calls, ~1.5 M triangles, at most one extra render pass (e.g. a water reflection at half res).
- No per-frame allocations in hot loops (reuse Vector3s).
- Time of day matters: read `env.hours()`/`env.sun()` every frame and make dawn, day, golden hour,
  dusk and night all look intentional (lights, sky, fog, emissives, fireflies, stars, bloom).
- Feeding must feel great: a visible food object, a sound, creatures noticing and racing to it,
  an eating moment, `env.onEat(member, pos)` per bite. Members (named residents) must be visible
  and distinguishable; ambient creatures (schools, flocks) make the world feel alive.
- `creatures()` should return the named residents (`member`) so hover tags work.
- Clean `dispose()`: dispose render targets, mixers, extra textures.

## Testing

Headless Chromium with software WebGL (SwiftShader) is available; it renders at only 1–5 fps,
so judge looks, not speed.

```bash
cd /tmp/claude-0/-home-user-pitch/0b3dcc19-d4f3-5276-b176-e80aea7f8af8/scratchpad
NODE_PATH=$(npm root -g) node tools/shoot.cjs --scene <id> --hours 7,13,18.2,22 --out /path/<id>.png --sim 3 --wait 800
# --feed 4 clicks-to-feed near the centre then simulates --sim seconds; --view '{"yaw":0.4,"pitch":0.3,"dist":12}'
# --ui shows the HUD; --w/--h viewport; prints console errors and page errors.
```

Then look at the PNGs with the Read tool. Iterate until it looks like a game screenshot.
