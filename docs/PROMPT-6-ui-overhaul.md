# PROMPT 6 — UI Overhaul: Visual Quality, Animations, and Layout

## Context

You are working on `ryuk`, a personal life-logging dashboard with a Death Note inspired theme. The dashboard is a React/Vite/Tailwind SPA served from a Cloudflare Worker (`dash/ui/`). Read `CLAUDE.md` and `HANDOFF.md` first.

The current Gaze (home) view looks flat, cluttered, and the Death Note aesthetic is weak. Animations for opening the notebook fail or stutter. The layout needs a complete visual overhaul while keeping all existing functionality intact.

## Hard Rules

- Read `CLAUDE.md` before any code change — it has project rules.
- Never ship copyrighted Death Note characters, logos, or lettering. All art is original or user-supplied via character art slots.
- Never touch `.dev.vars`, secrets, or deploy without asking.
- All changes are in `dash/ui/src/` only. Run `npm run build:ui` to verify after changes.
- Keep the `demoStore` working — the demo must still function.
- Run `npm test` before declaring anything done.

## Problem 1 — Layout & Visual Hierarchy (Gaze View)

- Group stats into Body / Mind / Life clusters with subtle labels (not cards). Active/non-zero stats glow gently.
- "Today's Entries" becomes the dominant card: 1–2deg tilt, paper texture, soft lift shadow, slight per-line rotation on handwriting.
- "Vital Readings" smaller / tighter rings.
- "Apples & Omens" becomes a sidebar strip.
- Header: red "written" gets a 4s glow cycle; Day counter becomes large with "DAYS WRITTEN" caption; add a subtle ink-drip / pen-stroke CSS decoration between header and content.

## Problem 2 — Animations That Actually Work

- CSS-only via React class toggles; don't animate from JS.
- Notebook open: cover appears (0ms) → lifts rotateY(-120) origin:left (0–400ms) → page reveals under (200–600ms) → entries write-in with clip-path wipe (400–800ms).
- Only animate transform/opacity. `will-change: transform` during animation.
- Page turn (DeathPage): two layers with backface-visibility hidden, rotateY 0→-180, growing shadow, touch swipe threshold 50px.
- Micro: entries clip-path write-in on arrival; numbers count up (rAF 500ms); tab switch fade-in 150ms; Ryuk eye logo 8s pulse.

## Problem 3 — Death Note Aesthetic Polish

- Paper texture CSS-only (horizontal rule stripes + 135deg cream gradient) with red margin line.
- Ink: color #1a1a2e, subtle text-shadow for bleed, hand font at 18–20px.
- Dark bg: radial gradient 30% 20% #1a1520 → #0d0a0f — warm purple-black, not flat.
- Status bar: red dot pulses; text monospace small, letter-spaced.
- Ruled lines on the notebook: opacity 0.03–0.05; the line beneath a written entry darkens to 0.08 (pressure).

## Problem 4 — Mobile Responsiveness (390 px)

- Stats: 2 columns within each of 3 groups.
- Notebook card full-width, no tilt.
- Vital rings 2x2.
- Header smaller, day counter stays prominent.
- Touch targets >= 44 px.

## Implementation Order

1. Background and color palette.
2. Stats restructure (groups).
3. Card hierarchy resize/restyle.
4. Paper texture and ink.
5. Notebook open animation.
6. Page turn animation.
7. Micro-animations.
8. Mobile pass.
9. Build + test.

## What NOT to do

- No external animation libraries (Framer Motion, GSAP, Lottie).
- No data-layer or API restructure.
- No store/dataflow changes; only components + CSS.
- No new npm deps.
- No tab renames.
- No images — textures and decorations are CSS.
