---
name: ryuk-dashboard-ui
description: Work on Ryuk's React dashboard — layout, views, charts, theme, animations, the demo build. Use for any UI change in dash/ui.
---
# Ryuk dashboard UI

Stack: React 18, Vite, Tailwind 3, lucide-react, single-file build. Source `dash/ui/src`, output copied to `dash/src/page.html` by `npm run build:ui`. Demo: `npm run build:demo` (or `?demo` / localhost uses `demoData()`).

## Files
- `App.tsx` — top bar, view switching, ⌘K capture, E key → Shinigami Eyes, owner badge.
- `config.ts` — OWNER name/title.
- `data.ts` — types, fetch helpers, derived metrics (vitals, habits, heatmap percentiles, observations), `demoData()`.
- `components/ui.tsx` — Card, Ring, Sparkline, StackedBars, Lines, Legend (hand-rolled SVG; no chart lib).
- `components/Overview.tsx` — bento dashboard.
- `components/Views.tsx` — Chronicle, Ledger (VaultView: TABS incl. Money, Rules), Telemetry, CaptureModal.
- `components/ShinigamiEyes.tsx` — full-screen metric overlay (createPortal).
- `components/Lore.tsx` — Watcher, notebook intro/cover, apple drop, ash, rules, eye icon.

## Theme (keep it)
Colours: bg `#0B0B0E`, surface `#141419`, line `#24242C`, ink `#F4F4F6`, slate `#8E8E9A`, apple red `#C84B31`.
Fonts (inlined via @fontsource): Mansalva (UI, headings and notebook handwriting: `font-sans`, `font-serif`, `font-hand` all map to it), JetBrains Mono (numbers, labels), Jacquard 24 = `font-frak` (RYUK wordmark, page numbers), Grenze Gotisch, Share Tech Mono (Eyes).
Desk notebook cover (Gaze): `src/assets/notebook-cover.jpg`, portrait, chosen by the owner; inlined as a data URI by the build.
Grid: use `minmax(0,1fr)` columns (prevents mobile overflow). Respect `prefers-reduced-motion`.

## Planned restructure (not built yet — confirm with user before starting)
Sections: **Today** (daily routine), **Body** (gym + food + sleep), **Mind** (work, learning, reading), **Coin** (transactions, rules, filters, monthly spend by category/merchant), **The Arc** (story view: where you started → where you are, trend lines over months).
Shinigami Eyes stays a global mode; Ledger (raw tables) moves behind an icon.

## Done checklist
`npm run build:ui` succeeds; check at ~390 px and desktop widths; no new network origins (CSP is `default-src 'self'`).
