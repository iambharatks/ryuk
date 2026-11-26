# PROMPT 8 — Workspace Redesign: Goals Board, Pin Wall, and Layout Fixes

Gaze becomes a workspace (desk / corkboard). All changes in dash/ui (plus the dashboard API it needs).
No new deps, no animation libraries, no images for textures, demo store keeps working, tabs unchanged.

1. Remove "Today's Entries" from Gaze (the Page / Notebook tabs cover it).
2. Vital Readings -> horizontal metric strip under the header: steps, exercise min, running speed,
   walk/run distance, calories, sleep, water, protein. Numbers only ("—" when missing), parchment on dark,
   red accent above target, live metrics glow, zeros dimmed, 2x2 on mobile, click -> 7-day mini bars.
   Source: health_log (Prompt 7) plus the logged tables.
3. Goals Board: corkboard (CSS), sticky notes ~140x120 (110x100 mobile) in 4 muted colours
   (#f5e6a3 #f5c6c6 #c6d8f5 #c6f5d0), seeded -3..3deg tilt, CSS pushpin, handwriting, x to remove,
   tap text to strike. "+" note turns into an input; Enter/blur saves; pop-in 200ms; remove 150ms.
   grid auto-fill minmax(130px,1fr); ~8-10 a day. Table daily_goals(id, date, text, done, color, rotation,
   position, created_at). API: POST /api/goals {text, date?}, GET /api/goals?date=, PATCH /api/goals/:id,
   DELETE /api/goals/:id. No carry-over: each day starts fresh.
4. Pin Wall replaces Apples & Omens: poster cards ~200x260, big image (object-fit cover, >=180px),
   1-line caption, no footer, torn bottom edge, 10px pushpin, -2..2deg tilt. Text pins: italic handwriting
   quote on parchment. Row/masonry, 3-4 visible + horizontal scroll on desktop, 2 columns on mobile, max ~12.
   "+" card -> small form: title (required), image URL (backend copies it into R2), quote. Tack-in animation;
   x / right-click / long-press to unpin with a lift-off animation. Reuse the pins table if possible.
   API: POST/GET /api/pins, DELETE/PATCH /api/pins/:id (position).
5. Notebook image: CSS-drawn cover (#1a1520 -> #0d0a0f), 3px spine, red ribbon, 4px radius, leather noise.
6. Layout: header + day counter / vitals strip / goals board / pin wall.
7. Schema: daily_goals (+ wall_pins only if pins can't be reused). Remind the user; don't run d1 execute.
Order: remove card, strip, goals, pin wall, notebook, layout, mobile, animations, build + test.
