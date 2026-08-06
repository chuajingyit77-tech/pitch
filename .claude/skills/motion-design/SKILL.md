---
name: motion-design
description: Add polished hover effects, micro-interactions, UI transitions, and animated components to websites. Use whenever styling interactive states (hover, focus, press), adding loading/skeleton states, animating menus/modals/accordions, or when a UI should feel "alive", "smooth", or "polished".
---

# Motion Design Skill

You are a motion designer for interfaces. Motion here means micro-interactions and component transitions — small, fast, and meaningful. (For scroll choreography and big entrance timelines, the `gsap` skill leads; this skill governs interactive feel.)

## The physics of premium feel

- **Timing:** hover responses 150–250ms, state changes 200–350ms, layout/overlay transitions 300–500ms. Faster in, slightly slower out is fine; sluggish (>500ms) UI transitions feel broken.
- **Easing:** never `linear`, and default `ease` is mediocre. Use:
  - `cubic-bezier(0.4, 0, 0.2, 1)` — standard material feel
  - `cubic-bezier(0.16, 1, 0.3, 1)` — "expo-out", the modern premium default
  - `cubic-bezier(0.34, 1.56, 0.64, 1)` — gentle overshoot for playful pops
- **Only animate `transform`, `opacity`, `filter`, `clip-path`, and colors.** Animating layout properties causes jank.
- Define motion tokens once:

```css
:root {
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-fast: 180ms; --dur-med: 300ms; --dur-slow: 450ms;
}
```

- Set explicit `transition` properties (`transition: transform var(--dur-fast) var(--ease-out-expo), ...`) — never `transition: all`.

## Hover & interactive states (every interactive element gets one)

- **Buttons:** slight lift `translateY(-2px)` + shadow deepen, or background shift; press state `scale(0.97)`. Premium extra: an internal sheen/sweep (positioned gradient pseudo-element sliding across).
- **Cards:** lift + shadow bloom + hairline border brighten; optionally scale an inner image to 1.05 with `overflow: hidden` on the card.
- **Links:** animated underline — pseudo-element scaling from `scaleX(0)` to `scaleX(1)` with `transform-origin` left; exit to the right for a directional feel.
- **Images/media:** slow zoom (`scale(1.06)`, 600–800ms) on hover inside a clipped container.
- **Nav items:** color shift + underline or background pill that moves between items.
- **Focus states are mandatory:** `:focus-visible` with a visible ring (`outline: 2px solid accent; outline-offset: 2px`) — never remove outlines without replacement.

## Component transitions

- **Modals/dialogs:** overlay fades (200ms) while panel fades + `scale(0.96→1)` or slides up 12px; exit reverses faster (150ms).
- **Dropdowns/popovers:** `opacity + translateY(-8px→0)` with transform-origin at the trigger; 180ms.
- **Mobile menu:** slide or clip-path reveal, then stagger the links in (30–50ms apart).
- **Accordions:** animate height via `grid-template-rows: 0fr→1fr` trick, or measured max-height; rotate the chevron.
- **Toasts:** slide in from an edge with slight overshoot; auto-dismiss with a shrinking progress bar.
- **Skeletons:** shimmer via a translating gradient overlay on neutral blocks — always for content that loads async.
- **Tabs/toggles:** a shared indicator element that slides between positions rather than blinking.

## Choreography rules

- **Stagger siblings** (nav links, cards, list items) by 30–80ms — simultaneous appearance feels mechanical.
- **Enter ≠ exit:** exits are faster and simpler than entrances.
- **Continuity:** elements should move *from* somewhere sensible (menu grows from its trigger, modal rises from below center).
- One hero moment per view; everything else stays subtle. If two big animations compete, cut one.

## Implementation choices

- Pure CSS transitions for hover/focus/press — no JS needed.
- CSS `@keyframes` for loops (shimmer, pulse, marquee).
- JS (GSAP or the Web Animations API) only for sequenced, interruptible, or scroll-linked motion.
- `IntersectionObserver` + a `.in-view` class is the lightweight reveal pattern when GSAP isn't loaded.

## Accessibility (non-negotiable)

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- Motion must never be the only feedback — pair with color/text/icon changes.
- No flashing above 3 times/second; keep parallax and large-scale motion gentle.
