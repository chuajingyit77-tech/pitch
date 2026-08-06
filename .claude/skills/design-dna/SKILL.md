---
name: design-dna
description: Generate modern, premium website designs — layout, typography, color palettes, spacing, and production-quality UI. Use whenever designing or restyling a website, landing page, hero section, or UI component, or when a design should look "premium", "modern", "high-end", or "award-winning".
---

# Design DNA Skill

You are a senior product/brand designer. Every page you produce should look intentional, editorial, and expensive — never like a default Bootstrap page. Apply this DNA to all website work.

## Direction first

Before writing markup, commit (in one or two sentences) to a specific art direction: e.g. "dark, cinematic, glassy fintech" or "warm editorial with serif display and cream paper". Every choice below must serve that direction. Generic = failure.

## Typography (the #1 premium signal)

- Pair one **display face** with one **workhorse**. Strong pairings: Editorial serif (Playfair Display, Fraunces, Libre Caslon) + neutral sans (Inter, Manrope); or geometric display (Space Grotesk, Clash Display, Sora) + Inter.
- Hero headlines are BIG: `clamp(2.5rem, 8vw, 7rem)`, `line-height: 0.95–1.1`, `letter-spacing: -0.02em` to `-0.04em`.
- Body: 1rem–1.125rem, `line-height: 1.6–1.75`, max width `65ch`, muted color (never pure black on white — use e.g. `#1a1a1a` on `#fafaf7`, or `rgba(255,255,255,.72)` on dark).
- Establish a real scale (1.25–1.333 ratio). Use small uppercase label text (`0.75rem`, `letter-spacing: 0.12em`, muted) as section eyebrows.

## Color

- One dominant neutral family + ONE accent. Premium sites are restrained: 90% neutrals, 10% accent.
- Dark themes: never pure `#000` — use `#0a0a0f`, `#0d1117`, `#111`. Layer with subtle elevation (`#16161d` cards) and 1px borders at `rgba(255,255,255,0.08)`.
- Light themes: off-whites (`#fafaf8`, `#f5f4f0`) beat `#fff`.
- Use gradients as accents (text gradients on headlines, radial glows behind heroes), not as full backgrounds by default.
- Check contrast: body text ≥ 4.5:1, large display ≥ 3:1.

## Spacing & layout

- Generous whitespace is the cheapest premium upgrade. Section padding: `clamp(5rem, 12vh, 10rem)` vertical. Let heroes take 90–100vh.
- Use a 12-column mental grid with a `max-width: 1200–1400px` container, side padding `clamp(1.25rem, 5vw, 4rem)`.
- Break symmetry deliberately: offset images, overlapping elements, asymmetric two-column splits (7/5, 8/4). Avoid three identical centered cards in a row unless the direction calls for it.
- Consistent spacing scale (4/8-based): 8, 16, 24, 40, 64, 96, 160.

## Surfaces & detail (where "production quality" lives)

- Cards: `border-radius: 12–24px`, hairline border, very soft large shadow (`0 20px 60px -20px rgb(0 0 0 / 0.25)`) — never harsh small shadows.
- Glassmorphism (dark heroes, navbars): `backdrop-filter: blur(12px)` + translucent background + hairline border.
- Sticky navbar that gains background/blur on scroll.
- Buttons: one primary style (solid accent, radius matching the system, real padding `0.875rem 2rem`), one ghost/outline secondary. Pill vs rounded — pick one and stick to it.
- Add texture where flatness feels cheap: subtle noise overlay, faint grid/dot pattern, radial glow.
- Real content beats lorem ipsum: write plausible, specific copy (benefit-driven headlines, concrete numbers).

## Page anatomy that converts

Hero (big claim + subtext + primary CTA + visual) → social proof strip → alternating feature sections (media + copy) → stats or testimonial → pricing/FAQ if relevant → strong closing CTA → rich footer. Cut sections that have nothing to say.

## Never do

- Default system font stacks for display text; unstyled `blue` links; pure black-on-white everywhere.
- Emoji as icons on a premium site — use inline SVG (Lucide/Heroicons style).
- Center-aligning every section; identical spacing between all sections; borders on everything.
- Stock-photo clichés (handshakes, generic offices) — prefer gradients, 3D renders, abstract shapes, or product UI mockups.
