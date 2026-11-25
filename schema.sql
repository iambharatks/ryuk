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
  note        TEXT,
  image_url   TEXT                           -- optional https image link
);

-- ================= Finance (bank / card SMS) =================
-- Every SMS the iPhone forwards, REDACTED (long digit runs and links removed), with what the parser decided.
-- Kept so the parser can be improved and old messages re-parsed. OTPs and adverts are stored only as "ignored".
CREATE TABLE IF NOT EXISTS sms_inbox (
  id           INTEGER PRIMARY KEY,
  received_at  TEXT NOT NULL,
  text         TEXT NOT NULL,              -- redacted SMS body
  text_hash    TEXT NOT NULL UNIQUE,       -- sha-256 of the original body: the same SMS twice is stored once
  result       TEXT NOT NULL,              -- recorded | duplicate | ignored | unparsed
  reason       TEXT                        -- why it was ignored / what was missing
);

-- One row per real money movement.
CREATE TABLE IF NOT EXISTS transactions (
  id               INTEGER PRIMARY KEY,
  sms_id           INTEGER REFERENCES sms_inbox(id) ON DELETE SET NULL,
  txn_at           TEXT NOT NULL,          -- when it happened (from the SMS when present, else when received), UTC ISO
  received_at      TEXT NOT NULL,
  amount           REAL NOT NULL,          -- always positive; see direction
  currency         TEXT NOT NULL DEFAULT 'INR',
  direction        TEXT NOT NULL,          -- debit | credit
  kind             TEXT NOT NULL,          -- spend | income | refund | transfer | card_payment | cash_withdrawal | investment | failed
  channel          TEXT,                   -- UPI | CARD | NEFT | IMPS | RTGS | NACH | ATM | CHEQUE | WALLET | OTHER
  bank             TEXT,                   -- HDFC | ICICI | SBI | AXIS | KOTAK | ...
  account_last4    TEXT,                   -- only the last 4 digits, never a full number
  card_last4       TEXT,
  txn_ref          TEXT,                   -- UPI ref / RRN / UTR / transaction id
  counterparty     TEXT,                   -- who the money went to / came from, as written in the SMS
  counterparty_key TEXT,                   -- normalised for grouping and rules
  vpa              TEXT,                   -- UPI id, e.g. swiggy@icici
  purpose          TEXT,                   -- remarks / narration / "salary nov" / "autopay"
  category         TEXT,                   -- food, groceries, travel, shopping, bills, rent, investing, ...
  flags            TEXT,                   -- comma list: large,new_merchant,international,atm,late_night,possible_duplicate,low_confidence
  confidence       REAL NOT NULL DEFAULT 1,
  status           TEXT NOT NULL DEFAULT 'auto',   -- auto | needs_review | confirmed | ignored
  note             TEXT
);
CREATE INDEX IF NOT EXISTS idx_txn_at        ON transactions(txn_at);
CREATE INDEX IF NOT EXISTS idx_txn_cp        ON transactions(counterparty_key);
CREATE INDEX IF NOT EXISTS idx_txn_category  ON transactions(category);
CREATE UNIQUE INDEX IF NOT EXISTS idx_txn_ref ON transactions(txn_ref, direction, amount) WHERE txn_ref IS NOT NULL;

-- Your corrections, applied to every future SMS: "SWIGGY -> food", "paytmqr281005 -> Chai Point", "ignore cashback".
CREATE TABLE IF NOT EXISTS merchant_rules (
  id            INTEGER PRIMARY KEY,
  match_key     TEXT NOT NULL UNIQUE,      -- counterparty_key or vpa to match
  display_name  TEXT,
  category      TEXT,
  kind          TEXT,                      -- e.g. transfer for your own accounts
  ignore        INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

-- ================= Apple Health (daily totals from an iPhone Shortcut) =================
-- One row per IST day. Re-sending the same day updates it (non-null values win). Never sent to Gemini or Telegram.
CREATE TABLE IF NOT EXISTS health_daily (
  date              TEXT PRIMARY KEY,        -- YYYY-MM-DD (IST)
  steps             INTEGER,
  distance_km       REAL,                    -- walking + running
  flights           INTEGER,
  active_kcal       REAL,
  resting_kcal      REAL,
  exercise_min      REAL,
  stand_hours       INTEGER,
  avg_hr            REAL,
  resting_hr        REAL,
  walking_hr        REAL,
  hrv_ms            REAL,
  vo2max            REAL,
  respiratory_rate  REAL,
  spo2_pct          REAL,
  sleep_min         REAL,                    -- asleep time for the night that ended this day
  in_bed_min        REAL,
  weight_kg         REAL,
  body_fat_pct      REAL,
  mindful_min       REAL,
  source            TEXT,                    -- e.g. "iphone-shortcut"
  updated_at        TEXT NOT NULL
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
