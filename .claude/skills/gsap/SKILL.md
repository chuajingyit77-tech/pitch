---
name: gsap
description: Build smooth scroll animations, page transitions, text reveals, staggered entrances, and premium UI animations with GSAP and ScrollTrigger. Use whenever a task involves scroll-based animation, animated page load sequences, text animation, or timeline-choreographed motion.
---

# GSAP Skill

You are crafting premium, buttery-smooth web animation with GSAP. Follow these practices whenever animating with GSAP.

## Setup

GSAP (including ScrollTrigger, ScrollToPlugin, TextPlugin and all formerly "Club" plugins like SplitText) is now 100% free. Load via CDN for static sites:

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/ScrollTrigger.min.js"></script>
<script>gsap.registerPlugin(ScrollTrigger);</script>
```

Or `npm install gsap` and `import gsap from "gsap"; import { ScrollTrigger } from "gsap/ScrollTrigger";`

Always call `gsap.registerPlugin(...)` for every plugin used.

## Core principles

- **Timelines over loose tweens.** Choreograph load sequences with one `gsap.timeline({ defaults: { ease: "power3.out", duration: 1 } })` and position parameters (`"-=0.6"`, `"<"`, `"+=0.2"`) for overlap. Overlapping animations feel premium; sequential ones feel robotic.
- **Animate only transforms and opacity** (`x`, `y`, `scale`, `rotation`, `opacity`) — GPU-accelerated. Avoid animating `top/left/width/height/margin` except when unavoidable (use `clip-path` for reveals instead).
- **Set initial states with `gsap.set()` or `from()` tweens**, and prevent flash-of-unstyled-content by hiding elements in CSS only if JS re-shows them (`visibility: hidden` + `autoAlpha`).
- **Easing defines the feel:** `power3.out` / `power4.out` for entrances, `power2.inOut` for movement between states, `expo.out` for dramatic reveals, `back.out(1.7)` for playful pops, `elastic` sparingly. Never linear except for marquees/loaders.

## Signature premium patterns

**Staggered entrance:**
```js
gsap.from(".card", { y: 60, opacity: 0, duration: 1, ease: "power3.out", stagger: 0.12 });
```

**Text reveal (line/word/char):** wrap content in overflow-hidden parents and slide inner spans up:
```js
gsap.from(".hero-title .line-inner", { yPercent: 110, duration: 1.1, ease: "power4.out", stagger: 0.1 });
```
Use SplitText when available; otherwise split manually into spans.

**Scroll-triggered section reveal:**
```js
gsap.from(".section-title", {
  y: 50, opacity: 0, duration: 1,
  scrollTrigger: { trigger: ".section", start: "top 75%", toggleActions: "play none none reverse" }
});
```

**Scrubbed / pinned storytelling:**
```js
gsap.timeline({
  scrollTrigger: { trigger: ".panel", start: "top top", end: "+=200%", scrub: 1, pin: true }
});
```
Use `scrub: 1` (smoothed) rather than `scrub: true` for a premium feel.

**Parallax:** move background layers with `yPercent` at different rates via `scrub`.

**Counter/number tick-up:** tween a proxy object and update `textContent` in `onUpdate`, triggered by ScrollTrigger.

## ScrollTrigger rules

- One ScrollTrigger per animation or timeline — don't nest ScrollTriggers inside a scrubbed timeline's children.
- Call `ScrollTrigger.refresh()` after images/fonts load or dynamic layout changes.
- For batch reveals of many elements, use `ScrollTrigger.batch()`.
- Markers (`markers: true`) are for debugging only — remove before finishing.

## Cleanup & frameworks

- In React, wrap everything in `useGSAP(() => { ... }, { scope: containerRef })` from `@gsap/react` — it handles context cleanup. Otherwise use `gsap.context()` and `ctx.revert()` on unmount.
- Kill ScrollTriggers on SPA route change: `ScrollTrigger.getAll().forEach(st => st.kill())`.

## Restraint & accessibility

- Durations: micro-interactions 0.2–0.4s, entrances 0.6–1.2s, scrubbed scenes as long as the scroll distance dictates. Nothing UI-blocking beyond 1.5s.
- Respect reduced motion:
```js
gsap.matchMedia().add("(prefers-reduced-motion: reduce)", () => {
  gsap.globalTimeline.timeScale(100); // or set final states directly
});
```
- Every animation should have a purpose (hierarchy, feedback, continuity). If it doesn't, cut it.
