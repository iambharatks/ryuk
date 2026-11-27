-- Ryuk schema (Cloudflare D1 / SQLite)
-- Apply:  npx wrangler d1 execute ryuk --remote --file=schema.sql
-- All timestamps are ISO-8601 UTC strings; the dashboard shows them in IST.

-- Every Telegram message, exactly as sent. Source of truth: typed rows can be rebuilt from here.
CREATE TABLE IF NOT EXISTS messages (
  id            INTEGER PRIMARY KEY,
  tg_message_id INTEGER,
  received_at   TEXT NOT NULL,
  text          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'auto',   -- auto | needs_review | corrected
  model         TEXT                            -- Gemini model that parsed it
);

-- Strength training: one row per exercise.
CREATE TABLE IF NOT EXISTS strength (
  id            INTEGER PRIMARY KEY,
  message_id    INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  logged_at     TEXT NOT NULL,
  exercise      TEXT NOT NULL,   -- canonical name, e.g. "Bench press"
  muscle_group  TEXT,            -- chest | back | shoulders | legs | arms | core | full_body
  equipment     TEXT,            -- barbell | dumbbell | machine | cable | bodyweight | kettlebell | band | other
  sets          INTEGER,
  reps          INTEGER,         -- reps per set (top/typical set when sets differ)
  weight_kg     REAL,            -- NULL for bodyweight; top-set weight when sets differ
  set_detail    TEXT,            -- per-set breakdown when sets differ: "60x10, 65x8, 70x6"
  volume_kg     REAL,            -- computed: total kg lifted (sets x reps x weight, or summed from set_detail)
  rpe           REAL,            -- effort 1-10
  rest_sec      INTEGER,
  detail        TEXT,
  summary       TEXT
);

-- Runs, walks, cycling, swimming, sports, yoga, stretching.
CREATE TABLE IF NOT EXISTS cardio (
  id                INTEGER PRIMARY KEY,
  message_id        INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  logged_at         TEXT NOT NULL,
  activity          TEXT NOT NULL,   -- Run | Walk | Cycling | Swim | Treadmill run | Yoga | Stretching | Sport ...
  setting           TEXT,            -- outdoor | indoor | treadmill
  workout_type      TEXT,            -- easy | tempo | intervals | long | recovery | race | other
  duration_min      REAL,
  distance_km       REAL,
  avg_pace_sec_km   REAL,            -- computed when missing: duration / distance (run, walk, swim)
  avg_speed_kmh     REAL,            -- computed when missing (cycling)
  cadence_spm       INTEGER,         -- steps per minute (run/walk) or rpm (cycling)
  avg_hr            INTEGER,
  max_hr            INTEGER,
  elevation_gain_m  REAL,
  calories          REAL,            -- only if stated (watch/app), never guessed
  steps             INTEGER,
  rpe               REAL,            -- effort 1-10
  splits            TEXT,            -- "5:40, 5:35, 5:30" or interval reps "6x400m @ 1:45"
  detail            TEXT,
  summary           TEXT
);

CREATE TABLE IF NOT EXISTS meals (
  id             INTEGER PRIMARY KEY,
  message_id     INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  logged_at      TEXT NOT NULL,
  meal_slot      TEXT,        -- breakfast | lunch | dinner | snack | pre_workout | post_workout
  items          TEXT,        -- every item with rough quantity
  source         TEXT,        -- home | outside | ordered | office | packaged
  calories_est   REAL,        -- rough estimates (vegetarian Indian portions)
  protein_g_est  REAL,
  carbs_g_est    REAL,
  fat_g_est      REAL,
  fiber_g_est    REAL,
  detail         TEXT,
  summary        TEXT
);

CREATE TABLE IF NOT EXISTS water (
  id          INTEGER PRIMARY KEY,
  message_id  INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  logged_at   TEXT NOT NULL,
  ml          REAL NOT NULL,
  summary     TEXT
);

CREATE TABLE IF NOT EXISTS sleep (
  id            INTEGER PRIMARY KEY,
  message_id    INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  logged_at     TEXT NOT NULL,   -- dated to the night it started
  duration_min  REAL,
  bed_time      TEXT,            -- HH:MM
  wake_time     TEXT,            -- HH:MM
  quality       REAL,            -- 1-5 as felt
  awakenings    INTEGER,
  is_nap        INTEGER NOT NULL DEFAULT 0,
  detail        TEXT,
  summary       TEXT
);

-- Where the time went: deep work, reading, watching, listening, passive screen time.
CREATE TABLE IF NOT EXISTS time_log (
  id            INTEGER PRIMARY KEY,
  message_id    INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  logged_at     TEXT NOT NULL,
  kind          TEXT NOT NULL,   -- deep_work | read | watch | listen | screen
  topic         TEXT,            -- work | dsa | system_design | ai | rust | gre | job_search | side_project | other
  duration_min  REAL,
  pages         REAL,
  title         TEXT,            -- book / video / app / task name
  start_time    TEXT,            -- HH:MM if stated
  focus_quality REAL,            -- 1-5 how focused the session was
  output        TEXT,            -- what came out of it: "3 mediums solved", "PR merged", "ch5 notes"
  detail        TEXT,
  summary       TEXT
);

-- Self-rated scores, 1-5.
CREATE TABLE IF NOT EXISTS checkins (
  id          INTEGER PRIMARY KEY,
  message_id  INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  logged_at   TEXT NOT NULL,
  metric      TEXT NOT NULL,     -- energy | focus | mood | stress | soreness | motivation
  score       REAL NOT NULL,
  summary     TEXT
);

-- Body measurements.
CREATE TABLE IF NOT EXISTS body (
  id            INTEGER PRIMARY KEY,
  message_id    INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  logged_at     TEXT NOT NULL,
  weight_kg     REAL,
  body_fat_pct  REAL,
  waist_cm      REAL,
  resting_hr    INTEGER,
  detail        TEXT,
  summary       TEXT
);

CREATE TABLE IF NOT EXISTS notes (
  id          INTEGER PRIMARY KEY,
  message_id  INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  logged_at   TEXT NOT NULL,
  note_kind   TEXT NOT NULL,     -- idea | correction | note
  text        TEXT NOT NULL,
  summary     TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_received ON messages(received_at);
CREATE INDEX IF NOT EXISTS idx_strength_at ON strength(logged_at);
CREATE INDEX IF NOT EXISTS idx_cardio_at   ON cardio(logged_at);
CREATE INDEX IF NOT EXISTS idx_meals_at    ON meals(logged_at);
CREATE INDEX IF NOT EXISTS idx_water_at    ON water(logged_at);
CREATE INDEX IF NOT EXISTS idx_sleep_at    ON sleep(logged_at);
CREATE INDEX IF NOT EXISTS idx_time_at     ON time_log(logged_at);
CREATE INDEX IF NOT EXISTS idx_checkins_at ON checkins(logged_at);
CREATE INDEX IF NOT EXISTS idx_notes_at    ON notes(logged_at);
CREATE INDEX IF NOT EXISTS idx_body_at     ON body(logged_at);
CREATE INDEX IF NOT EXISTS idx_body_msg    ON body(message_id);
CREATE INDEX IF NOT EXISTS idx_strength_ex ON strength(exercise);
CREATE INDEX IF NOT EXISTS idx_cardio_act  ON cardio(activity);
CREATE INDEX IF NOT EXISTS idx_strength_msg ON strength(message_id);
CREATE INDEX IF NOT EXISTS idx_cardio_msg   ON cardio(message_id);
CREATE INDEX IF NOT EXISTS idx_meals_msg    ON meals(message_id);
CREATE INDEX IF NOT EXISTS idx_water_msg    ON water(message_id);
CREATE INDEX IF NOT EXISTS idx_sleep_msg    ON sleep(message_id);
CREATE INDEX IF NOT EXISTS idx_time_msg     ON time_log(message_id);
CREATE INDEX IF NOT EXISTS idx_checkins_msg ON checkins(message_id);
CREATE INDEX IF NOT EXISTS idx_notes_msg    ON notes(message_id);
-- Note: no cross-table UNION view. D1 limits compound SELECTs, so the bot queries each table in one batch.

-- Moodboard pins: goals, inspiration, media you want on the board (added from the dashboard).
CREATE TABLE IF NOT EXISTS pins (
  id          INTEGER PRIMARY KEY,
  created_at  TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'goal',   -- goal | inspiration | media
  title       TEXT NOT NULL,
  note        TEXT,                          -- the quote, for a text-only pin
  image_url   TEXT,                          -- https link, or /api/file/... when copied into R2
  link        TEXT,                          -- optional https link   (added to existing DBs by migrations/002)
  position    INTEGER                        -- order on the pin wall  (added to existing DBs by migrations/002)
);

-- ================= Goals board: sticky notes for one IST day (never carried over) =================
CREATE TABLE IF NOT EXISTS daily_goals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,                 -- YYYY-MM-DD (IST)
  text        TEXT NOT NULL,
  done        INTEGER DEFAULT 0,             -- 0 or 1
  color       TEXT,                          -- sticky-note colour
  rotation    REAL,                          -- -3..3 degrees, fixed when the note is written
  position    INTEGER,                       -- order on the board
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_daily_goals_date ON daily_goals(date);

-- ================= Finance (bank SMS, parsed by regex in src/finance.ts) =================
-- One row per transaction. Only parsed fields are kept: the SMS text is never stored and never sent to Gemini.
-- sms_hash = HMAC-SHA256 of the SMS keyed with INGEST_KEY, so a resent SMS is stored once.
CREATE TABLE IF NOT EXISTS finance_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  date          TEXT NOT NULL,               -- YYYY-MM-DD (IST, when received)
  time          TEXT,                        -- HH:MM (IST)
  type          TEXT NOT NULL,               -- debit | credit | refund
  amount        REAL NOT NULL,
  account_last4 TEXT NOT NULL,               -- last 4 digits only
  merchant      TEXT,
  balance       REAL,
  channel       TEXT,                        -- bank | upi | card | auto_debit
  raw_direction TEXT,                        -- the verb in the SMS: debited, paid, reversed...
  date_in_sms   TEXT,                        -- the date as the SMS wrote it
  source        TEXT DEFAULT 'sms',
  sms_hash      TEXT UNIQUE,                 -- NULL for entries added by hand
  category      TEXT,                        -- src/classify.ts CATEGORIES key; NULL = uncategorised
  invest_class  TEXT,                        -- INVEST_CLASSES key when category = 'investment'
  category_src  TEXT,                        -- auto | rule | manual (manual is never overwritten)
  note          TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_finance_date ON finance_log(date);
CREATE INDEX IF NOT EXISTS idx_finance_category ON finance_log(category);

-- "Always file merchant X as Y": substring of the merchant, case-insensitive. Applied at ingest and on re-classify.
CREATE TABLE IF NOT EXISTS finance_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern       TEXT NOT NULL UNIQUE,        -- stored upper-case
  category      TEXT NOT NULL,
  invest_class  TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- Monthly spending limit per category.
CREATE TABLE IF NOT EXISTS finance_budgets (
  category      TEXT PRIMARY KEY,
  monthly_limit REAL NOT NULL
);

-- ================= Apple Health ("Health Watcher" iPhone Shortcut) =================
-- One row per IST day, upserted. A later sync fills in values but never blanks one. Never sent to Gemini or Telegram.
CREATE TABLE IF NOT EXISTS health_log (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  date                  TEXT NOT NULL UNIQUE,   -- YYYY-MM-DD, the upsert key
  steps                 INTEGER,
  exercise_minutes      INTEGER,
  running_speed         REAL,
  walk_run_distance     REAL,
  heart_rate_avg        REAL,
  sleep_minutes         INTEGER,
  weight_kg             REAL,
  active_cal            REAL,
  stand_minutes         INTEGER,
  running_power         REAL,
  running_stride_length REAL,
  raw_json              TEXT,                   -- the last payload, for debugging
  created_at            TEXT DEFAULT (datetime('now'))
);

-- ================= Batch notes =================
-- Each line of a pasted note (e.g. a whole workout) becomes its own message at its own time.
-- line_key = minute + normalised text, so re-sending the same note never logs a line twice; batch_id groups a paste for /undo.
CREATE TABLE IF NOT EXISTS batch_lines (
  line_key    TEXT PRIMARY KEY,
  batch_id    TEXT NOT NULL,
  message_id  INTEGER REFERENCES messages(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_batch_lines_batch ON batch_lines(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_lines_msg   ON batch_lines(message_id);

-- ================= Gym mode (Telegram /gym ... /done) =================
-- While a session is open, each message is buffered here with its Telegram send time; /done parses them in one batch.
CREATE TABLE IF NOT EXISTS live_session (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  started_at  TEXT NOT NULL,
  label       TEXT
);
CREATE TABLE IF NOT EXISTS live_lines (
  id             INTEGER PRIMARY KEY,
  at             TEXT NOT NULL,
  text           TEXT NOT NULL,
  tg_message_id  INTEGER
);

-- ================= The daily page: tasks =================
-- Tasks written on a day's page. Ticking one done logs it (a message at done_at) and keeps its message_id.
CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY,
  day         TEXT NOT NULL,              -- YYYY-MM-DD (IST) the task is written on
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  done_at     TEXT,
  message_id  INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tasks_day ON tasks(day);

-- ================= The shelf: books, PDFs, videos, images, links =================
CREATE TABLE IF NOT EXISTS library (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL,              -- book | pdf | video | audio | image | link
  title       TEXT NOT NULL,
  creator     TEXT,                       -- author / channel / site
  url         TEXT,                       -- external link (https)
  file_key    TEXT,                       -- uploaded file in R2 (served at /api/file/<key>)
  mime        TEXT,
  total       REAL,                       -- pages (book, pdf) or seconds (video, audio)
  progress    REAL,                       -- current page or current second
  status      TEXT NOT NULL DEFAULT 'active',  -- active | paused | done | wishlist
  note        TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
-- Every progress change: "page 120 -> 150", "video 12:30 -> 31:05". Also written to time_log as reading / watching.
CREATE TABLE IF NOT EXISTS library_events (
  id          INTEGER PRIMARY KEY,
  item_id     INTEGER NOT NULL REFERENCES library(id) ON DELETE CASCADE,
  at          TEXT NOT NULL,
  from_value  REAL,
  to_value    REAL NOT NULL,
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_library_events_item ON library_events(item_id);

-- R2 operation counters (stay within free tier: 1M Class A, 10M Class B per month)
CREATE TABLE IF NOT EXISTS r2_ops (
  month   TEXT PRIMARY KEY,   -- "2026-11"
  class_a INTEGER DEFAULT 0,
  class_b INTEGER DEFAULT 0
);
