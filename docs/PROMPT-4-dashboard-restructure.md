# Prompt 4 — Restructure the dashboard: Gaze, daily goals, real Pacts, animation, character art

Read `CLAUDE.md`, `HANDOFF.md` and `.claude/skills/ryuk-dashboard-ui/SKILL.md` first. Keep `npm test` green, add tests
for every new endpoint, and check every screen in demo mode with Playwright at 1280 px and 390 px before telling me
it's done. Ask before deploying or running anything `--remote`.

## Design direction (applies to everything below)
- Death-Note-*inspired*, original design: a black leather notebook, bone-white ruled paper, black ink, one crimson
  accent, candle-lit darkness around the page. Handwriting font *Nothing You Could Do* for written content,
  Jacquard 24 for titles, JetBrains Mono for numbers. Keep the existing palette tokens in `tailwind.config.js`.
- No copyrighted characters, logos or the manga's lettering ship in the code. Character art comes only through the
  art slots in section 6.
- Every card on Gaze should look like a page, a scrap of paper or an object on the desk, not a generic dark tile.
- Mobile first: the phone is where I use it most. Touch targets of 44 px or more, nothing wider than 390 px.

## 1. Gaze: new layout (top to bottom)
Remove the **"Pages Written & Pacts"** card completely; it isn't useful.
1. **Day counter strip** (full width, first thing on screen):
   - "Day 147" = days since my first entry, today's date, current writing streak (consecutive IST days with at least
     one entry), and how many pages (days) in a row I've kept all my goals.
   - Today's live tallies, each with a small change against my 7-day average: entries written, working sets,
     training minutes, protein (est.), water, deep work, last night's sleep, screen time, money spent today.
   - Numbers flip like a mechanical counter when they change (respect `prefers-reduced-motion`).
2. **Names for today** (daily goals, section 2) on the left, **Pacts** (section 3) on the right; stacked on mobile.
3. **Apples & Omens** (pins + shelf): pins become fully editable and deletable (title, note, kind, image upload);
   active shelf items (current book page, video timestamp) appear here instead of time_log-derived "books".
4. **The Watcher's observations**, unchanged in logic, restyled as notes pinned to the page edge.

## 2. Daily goals ("Names for today")
Use **one model** for goals, reminders and the Page's intentions: extend the existing `tasks` table (migration file,
not a rewrite):
- `status` open | done | discarded, `kind` goal | reminder, `priority` 1–3, `remind_at` (optional ISO time),
  `origin_day` (first day it was written), `carry_count`, `discarded_at`, `note`.
- **Carry forward:** at the start of each IST day, every open goal from earlier days moves to today with
  `carry_count + 1`. Do it lazily on read *and* from a cron at 00:05 IST, idempotently (never duplicate). Show
  "carried 3x" as small tally marks; after 3 carries ask "keep, reschedule or discard?" in the UI.
- Actions on each goal: tick done (ink strike, and it's logged at that moment like Page intentions), **discard**
  (a crimson X and the line fades to grey, no log), remove (erased completely), edit text and priority, drag to
  reorder, "move to tomorrow".
- Add from Gaze, from the Page (`[]` prefix), and from Telegram (`/goal text`, `/goals`, `/done N`).
- **Reminders:** a cron every 15 minutes sends due `remind_at` goals to Telegram with inline buttons Done / +1 h /
  Tomorrow. Goal text may go to Telegram; never finance or health data.
- Style: a torn page pinned at the top with a header *"Names written today"*, numbered lines in handwriting, priority
  shown as 1-3 ink dots in the margin.

## 3. Pacts that actually do something
A pact is a rule I set that the app checks **automatically from my logs**:
- Table `pacts`: title, `metric` (one of: sleep_min, protein_g, water_ml, deep_work_min, screen_min,
  strength_sets, training_min, steps, spend_inr, entries, or `manual` yes/no), comparator (>= or <=), target,
  period (`day`, or `week` with N days required), active days of the week, start date, `stake` (my own words, e.g.
  "no Netflix tomorrow"), status active/paused/archived.
- Table `pact_days`: pact_id, day, value, kept/broken/pending, computed by one SQL query per metric (no
  Gemini). Recompute for today on every new log, and finalise yesterday in the 00:05 cron.
- UI card: each pact as a clause in the notebook ("I will sleep at least 7 h"), today's progress bar, a 30-day
  strip of kept/broken marks, current and best streak. Kept 7 days in a row -> a crimson wax seal appears.
  Broken -> an ink blot spreads over that day and the stake is shown.
- 21:00 IST Telegram nudge only for pacts still at risk ("Water: 1.2 L to go").
- Create, edit, pause and archive pacts from the card. Suggest 4 starter pacts from my data (sleep, protein, deep work,
  screen time) that I can accept with one tap.
- Endpoints `/api/pacts` (CRUD) and `/api/pacts/status?days=30`, all covered by tests with a fake D1.

## 4. Animations: realistic, restrained, death-note-inspired
Use CSS for loops and **Motion** (`motion/react`, pin an exact version) for orchestration if needed. Animate only
`transform`, `opacity`, `clip-path` and `filter`; 60 fps on a mid-range phone; every animation off under
`prefers-reduced-motion`; nothing over 1.2 s except the first-visit intro.
- **Page turn** between views and days: a real paper bend (two halves rotating on the Y axis, a moving shadow
  gradient and a slight paper curl), not a fade.
- **Handwriting:** reveal along the text with a pen nib following, plus slight ink bleed at the start of each
  stroke (animated SVG `feTurbulence` / `feDisplacementMap` with seed changes, then settling).
- **Ink drop** when something is saved: a drop falls, spreads into the paper fibres, dries darker at the edge.
- **Strike / discard / broken pact:** hand-drawn strokes drawn with `stroke-dashoffset`; a broken pact's blot
  spreads irregularly.
- **Counters:** mechanical digit flip. **Seal:** wax press with a squash and settle.
- **Ambient:** candle-light flicker on the page edge (a subtle radial gradient), dust in the light, the notebook
  tilting toward the cursor on desktop.
- **Character reactions** (with art slots, section 6): watches while I type, laughs at a broken pact, eats an apple
  when a full page is written, looks away when the page is empty.
- Build a `/#motion-lab` demo route that shows every animation side by side with a replay button, so I can tune them.

## 5. Structure and code quality
- Split `Overview.tsx` into one component per card under `components/gaze/`. Shared paper primitives in
  `components/paper/` (Paper, RuledLines, Margin, Handwriting, InkStrike, InkBlot, WaxSeal, TallyMarks).
- One data hook per feature (`useGoals`, `usePacts`, `useToday`) on top of `store.ts`, with the same demo
  implementation so the demo shows everything.
- The demo must be realistic: 90 days of data, goals carried over, two kept pacts with streaks, one broken.

## 6. Character art from my designer (slots, not bundled art)
The app must work with **no** character art (it falls back to the original Watcher SVG) and accept art I add later
**without code changes**:
- `dash/ui/src/art/slots.ts`: a typed manifest of named slots, each with purpose, size, format and fallback:
  - `watcher.idle`, `watcher.watching`, `watcher.laughing`, `watcher.apple`, `watcher.away` (the companion
    character's reaction states), `owner.portrait` (my avatar in the header), `page.corner` (small figure peeking
    over the page), `intro.cover` (notebook cover for the intro), `seal.mark` (emblem stamped into wax).
- Accepted formats: transparent **WebP/PNG at 2x size** for still poses, **SVG** with named layer groups (`#eyes`,
  `#mouth`, `#hand`) for CSS-driven idle animation, **Lottie JSON** for designer-made animations (load
  `lottie-web` light build lazily, only when a Lottie slot is used), optionally **Rive** (`.riv`) for interactive
  states (state machine inputs `watching`, `laugh`, `eat`).
- Two ways to supply art:
  1. **Settings -> Characters** screen in the dashboard: upload a file per slot (stored in R2 under `art/`, slot ->
     key in a D1 table `art_slots`), preview it live in every state, revert to default. No redeploy.
  2. Defaults in `dash/ui/public/art/<slot>.<ext>`, served as static assets. Switch the dashboard to **Workers Static
     Assets** for art and fonts instead of inlining them into one HTML file, with `run_worker_first = true` so the
     Worker's Access check still guards every file.
- Map app events to states in one place (`art/reactions.ts`): typing -> watching, pact broken -> laughing, >= 8 entries ->
  apple, empty page -> away, otherwise idle.
- Write `docs/ART-SPEC.md` for the designer: every slot with pixel sizes (e.g. watcher poses 480x640 @2x, page corner
  240x240, portrait 256x256), transparent background, safe margins, a dark background preview colour (#0B0B0E) and the
  paper colour (#ECE5D3), layer names for SVG, frame rate and loop rules for Lottie, file-size budget
  (< 300 KB per still, < 500 KB per Lottie), and one example file per format.
- Demo and anything shared publicly use only the default original art.

## Order of work
1. Paper primitives + Gaze layout and day counter, with the "Pages Written & Pacts" card removed.
2. Goals: migration, carry-forward, API, Telegram commands, UI.
3. Pacts: tables, evaluation SQL, API, UI, nudges.
4. Art slots + Settings -> Characters + ART-SPEC.md.
5. Animations and the motion lab.
6. Update the demo, `HANDOFF.md` and the setup doc.
After each step: tests, Playwright screenshots at both widths, and a short note of what to run.
