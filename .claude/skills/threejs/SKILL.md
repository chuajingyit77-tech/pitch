---
name: threejs
description: Build interactive 3D websites, product showcases, hero scenes, particle effects, and immersive WebGL experiences with Three.js. Use whenever a task involves 3D graphics, WebGL, particles, shaders, 3D product viewers, or "immersive" website sections.
---

# Three.js Skill

You are building premium, production-quality 3D web experiences. Follow these practices whenever Three.js is involved.

## Setup

- Prefer ES modules via CDN import map for static sites, or `npm install three` for bundled projects:

```html
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.166.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.166.0/examples/jsm/"
  }
}
</script>
```

- Always pin a version. Never mix r150+ module builds with legacy `THREE.` global scripts.

## Scene fundamentals (always do these)

```js
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // cap DPR for perf
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
```

- Handle resize: update camera aspect + `updateProjectionMatrix()` + renderer size.
- Use `THREE.Clock` and pass elapsed/delta time into the render loop — never animate by frame count.
- Dispose geometries, materials, and textures when removing objects (`.dispose()`), especially in SPA route changes.

## Premium look checklist

- **Lighting:** never rely on a single ambient light. Combine a soft `AmbientLight` or `HemisphereLight` (low intensity) with a key `DirectionalLight` and a rim/fill light. For realism, use an HDRI environment map (`RoomEnvironment` from addons is a zero-asset option).
- **Materials:** prefer `MeshStandardMaterial` / `MeshPhysicalMaterial` (metalness, roughness, clearcoat, transmission for glass). Flat `MeshBasicMaterial` looks cheap except for stylized/unlit designs.
- **Shadows:** enable only when they add value; use `PCFSoftShadowMap` and tight shadow camera bounds.
- **Post-processing:** subtle `UnrealBloomPass` (strength 0.2–0.5) sells "premium glow". Use `EffectComposer` from addons.
- **Fog:** `scene.fog = new THREE.FogExp2(color, 0.02)` blends distant geometry and adds depth.

## Common premium patterns

- **Particle field hero:** `BufferGeometry` + `Float32Array` positions + `PointsMaterial` (size 0.01–0.05, `transparent`, `depthWrite: false`, `blending: THREE.AdditiveBlending`). Animate positions in the loop or with a simple vertex shader. 3k–15k particles is plenty; never 100k+ on the main page.
- **Mouse parallax:** lerp camera position toward `(mouse.x * strength, mouse.y * strength)` each frame — never snap directly.
- **Scroll-driven 3D:** map scroll progress (0–1) to camera position/rotation or object state. Pair with GSAP ScrollTrigger when GSAP is in the project.
- **3D model showcase:** `GLTFLoader` (+ `DRACOLoader` for compressed assets), `OrbitControls` with `enableDamping = true`, `autoRotate` for idle motion, and clamp `minDistance`/`maxDistance` and polar angles.

## Performance rules

- One renderer, one canvas per page whenever possible.
- Reuse geometries/materials; use `InstancedMesh` for repeated objects.
- Pause the render loop when the canvas is offscreen (`IntersectionObserver`) or tab is hidden.
- Test mentally on mobile: reduce particle counts and disable post-processing below ~768px width.
- Respect `prefers-reduced-motion`: freeze or drastically slow animation loops.

## Accessibility & fallbacks

- The 3D canvas is decorative: `aria-hidden="true"`, and never place essential text only inside WebGL.
- Provide a graceful static/gradient fallback if WebGL context creation fails.
