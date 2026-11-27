// ---------- Types (mirror the D1 tables) ----------
type Base = { id: number; message_id?: number; logged_at: string; summary: string | null };
type N = number | null; type S = string | null;
export type Strength = Base & { exercise: string; muscle_group?: S; equipment?: S; sets: N; reps: N; weight_kg: N;
  set_detail?: S; volume_kg?: N; rpe?: N; rest_sec?: N; detail: S };
export type Cardio = Base & { activity: string; setting?: S; workout_type?: S; duration_min: N; distance_km: N;
  avg_pace_sec_km?: N; avg_speed_kmh?: N; cadence_spm?: N; avg_hr: N; max_hr?: N; elevation_gain_m?: N; calories?: N;
  steps?: N; rpe?: N; splits?: S; detail: S };
export type Meal = Base & { meal_slot: S; items: S; source?: S; calories_est?: N; protein_g_est: N; carbs_g_est?: N;
  fat_g_est?: N; fiber_g_est?: N; detail: S };
export type Body = Base & { weight_kg: N; body_fat_pct: N; waist_cm: N; resting_hr: N; detail: S };
export type Water = Base & { ml: number };
export type Sleep = Base & { duration_min: N; bed_time: S; wake_time: S; quality?: N; awakenings?: N; is_nap?: N; detail: S };
export type TimeLog = Base & { kind: string; topic: S; duration_min: N; pages: N; title: S; start_time?: S; focus_quality?: N; output?: S; detail: S };
export type Checkin = Base & { metric: string; score: number };
export type Note = Base & { note_kind: string; text: string };
export type Message = { id: number; received_at: string; text: string; status: string; model: string | null };
// note holds the quote for a text-only pin
export type Pin = { id: number; created_at: string; kind: string; title: string; note: string | null; image_url: string | null; link?: string | null; position?: number | null };
export type NewPin = { title: string; quote?: string; image_url?: string; link?: string };

// finance_log: parsed bank SMS (the SMS text itself is never stored)
export type FinanceRow = { id: number; date: string; time: S; type: "debit" | "credit" | "refund"; amount: number; account_last4: string;
  merchant: S; balance: N; channel: S; raw_direction: S; date_in_sms: S; source: S; category?: S; invest_class?: S; note?: S; created_at: string };
// health_log: one row per IST day from the Health Watcher Shortcut
export type HealthRow = { id: number; date: string; steps: N; exercise_minutes: N; running_speed: N; walk_run_distance: N; heart_rate_avg: N;
  sleep_minutes: N; weight_kg: N; active_cal: N; stand_minutes: N; running_power: N; running_stride_length: N; created_at: string };
export type Data = {
  finance_log?: FinanceRow[]; health_log?: HealthRow[];
  strength: Strength[]; cardio: Cardio[]; meals: Meal[]; water: Water[]; sleep: Sleep[];
  time_log: TimeLog[]; checkins: Checkin[]; body: Body[]; notes: Note[]; messages: Message[]; pins: Pin[];
  daily_counts: { d: string; n: number }[];
};
export const EVENT_TABLES = ["strength", "cardio", "meals", "water", "sleep", "time_log", "checkins", "body", "notes"] as const;
export type EventTable = (typeof EVENT_TABLES)[number];

// ---------- Time helpers (everything shown in IST) ----------
const TZ = "Asia/Kolkata";
export const dayKey = (iso: string | number | Date) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
export const todayKey = () => dayKey(Date.now());
export const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
export const hourIST = (iso: string) => Number(new Date(iso).toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).slice(0, 2)) % 24;
export const prettyDay = (key: string) =>
  new Date(key + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
export const shortDay = (key: string) =>
  new Date(key + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
export function lastDays(n: number): string[] {
  const t = Date.parse(todayKey() + "T12:00:00Z");
  return Array.from({ length: n }, (_, i) => new Date(t - (n - 1 - i) * 86400e3).toISOString().slice(0, 10));
}
const sum = (a: (number | null | undefined)[]) => a.reduce<number>((s, v) => s + (Number(v) || 0), 0);
const mean = (a: number[]) => (a.length ? sum(a) / a.length : null);
const sd = (a: number[]) => { const m = mean(a); return m == null || a.length < 2 ? null : Math.sqrt(sum(a.map((v) => (v - m) ** 2)) / (a.length - 1)); };

export function byDay<T extends Base>(rows: T[], f: (r: T) => number | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) { const v = f(r); if (v == null || !isFinite(v)) continue; const k = dayKey(r.logged_at); m.set(k, (m.get(k) || 0) + v); }
  return m;
}
export function avgByDay<T extends Base>(rows: T[], f: (r: T) => number | null | undefined): Map<string, number> {
  const s = new Map<string, number>(), c = new Map<string, number>();
  for (const r of rows) { const v = f(r); if (v == null || !isFinite(v)) continue; const k = dayKey(r.logged_at); s.set(k, (s.get(k) || 0) + v); c.set(k, (c.get(k) || 0) + 1); }
  return new Map([...s].map(([k, v]) => [k, v / c.get(k)!]));
}
export const seriesOf = (m: Map<string, number>, days: string[]) => days.map((d) => (m.has(d) ? m.get(d)! : null));

// ---------- API ----------
export async function fetchData(days: number): Promise<Data> {
  const res = await fetch(`/api/data?days=${days}`, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
export async function apiCapture(text: string): Promise<string> {
  const res = await fetch("/api/capture", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body.reply;
}
export async function apiNotepad(lines: { text: string; at: string }[]): Promise<string> {
  const res = await fetch("/api/notepad", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lines }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body.reply;
}
export async function apiRow(method: "PATCH" | "DELETE", payload: object) {
  const res = await fetch("/api/row", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `HTTP ${res.status}`); }
}
export async function apiAddPin(pin: NewPin): Promise<Pin> {
  const res = await fetch("/api/pins", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(pin) });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(b.error || `HTTP ${res.status}`);
  return b;
}
export async function apiOrderPins(ids: number[]): Promise<void> {
  const res = await fetch("/api/pins/order", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `HTTP ${res.status}`); }
}
export async function apiDeletePin(id: number): Promise<void> {
  const res = await fetch(`/api/pins/${id}`, { method: "DELETE" });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `HTTP ${res.status}`); }
}

// ---------- Unified event stream ----------
export type Ev = { table: EventTable; id: number; at: string; title: string; detail: string | null; tag: string };
const TAG: Record<EventTable, string> = { strength: "lift", cardio: "move", meals: "meal", water: "water", sleep: "sleep", time_log: "time", checkins: "state", body: "body", notes: "note" };
export function allEvents(d: Data): Ev[] {
  const out: Ev[] = [];
  for (const t of EVENT_TABLES) {
    for (const r of d[t] as any[]) {
      let tag = TAG[t];
      if (t === "time_log") tag = r.kind === "deep_work" ? "focus" : r.kind;
      if (t === "checkins") tag = r.metric;
      if (t === "notes") tag = r.note_kind;
      out.push({ table: t, id: r.id, at: r.logged_at, title: r.summary || r.exercise || r.activity || r.items || r.text || t, detail: r.detail ?? (t === "meals" ? r.items : t === "notes" ? null : null), tag });
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

// ---------- Derived metrics ----------
export type Vitals = {
  days: string[];
  sleepH: (number | null)[]; deepH: (number | null)[]; energy: (number | null)[]; mood: (number | null)[]; moveMin: (number | null)[];
  today: { sleepH: number | null; deepH: number; energy: number | null; moveMin: number; sets: number };
};
export function vitals(d: Data, n = 14): Vitals {
  const days = lastDays(n);
  const sleep = byDay(d.sleep, (r) => (r.duration_min ?? 0) / 60);
  const deep = byDay(d.time_log.filter((r) => r.kind === "deep_work"), (r) => (r.duration_min ?? 0) / 60);
  const energy = avgByDay(d.checkins.filter((r) => r.metric === "energy"), (r) => r.score);
  const mood = avgByDay(d.checkins.filter((r) => r.metric === "mood"), (r) => r.score);
  // movement = cardio minutes + lifting at ~3 min per set (sets carry no duration of their own)
  const move = new Map(byDay(d.cardio, (r) => r.duration_min));
  for (const [k, v] of byDay(d.strength, (r) => (r.sets ?? 1) * 3)) move.set(k, (move.get(k) || 0) + v);
  const t = todayKey();
  const yest = lastDays(2)[0];
  return {
    days, sleepH: seriesOf(sleep, days), deepH: seriesOf(deep, days), energy: seriesOf(energy, days), mood: seriesOf(mood, days), moveMin: seriesOf(move, days),
    today: {
      sleepH: sleep.get(t) ?? sleep.get(yest) ?? null,
      deepH: deep.get(t) ?? 0,
      energy: energy.get(t) ?? null,
      moveMin: move.get(t) ?? 0,
      sets: sum(d.strength.filter((r) => dayKey(r.logged_at) === t).map((r) => r.sets ?? 1)),
    },
  };
}

export type Habit = { key: string; label: string; doneToday: boolean; streak: number; rule: string };
export function habits(d: Data): Habit[] {
  const days = lastDays(60).reverse(); // today first
  const has = (rows: Base[]) => new Set(rows.map((r) => dayKey(r.logged_at)));
  const workout = new Set([...has(d.strength), ...has(d.cardio)]);
  const deep = byDay(d.time_log.filter((r) => r.kind === "deep_work"), (r) => r.duration_min);
  const read = has(d.time_log.filter((r) => r.kind === "read"));
  const sleep = byDay(d.sleep, (r) => r.duration_min);
  const protein = byDay(d.meals, (r) => r.protein_g_est);
  const screen = byDay(d.time_log.filter((r) => r.kind === "screen"), (r) => r.duration_min);
  const logged = new Set(d.daily_counts.filter((x) => x.n > 0).map((x) => x.d));
  // sleep is dated to the night it started, so "slept well" for today = last night's entry
  const prevDay = (k: string) => new Date(Date.parse(k + "T12:00:00Z") - 86400e3).toISOString().slice(0, 10);
  const defs: [string, string, string, (k: string) => boolean][] = [
    ["workout", "Train", "any lift or cardio", (k) => workout.has(k)],
    ["deep", "Deep work 2h", "≥ 120 min focused", (k) => (deep.get(k) ?? 0) >= 120],
    ["read", "Read", "any reading block", (k) => read.has(k)],
    ["sleep", "Sleep 7h", "≥ 420 min, night before", (k) => (sleep.get(prevDay(k)) ?? sleep.get(k) ?? 0) >= 420],
    ["protein", "Protein 80g", "estimated ≥ 80 g", (k) => (protein.get(k) ?? 0) >= 80],
    ["screen", "Screen < 60m", "logged and under 60 min", (k) => logged.has(k) && (screen.get(k) ?? 0) < 60],
  ];
  return defs.map(([key, label, rule, ok]) => {
    let streak = 0;
    const start = ok(days[0]) ? 0 : 1; // today not done yet doesn't break a streak
    for (let i = start; i < days.length && ok(days[i]); i++) streak++;
    return { key, label, rule, doneToday: ok(days[0]), streak };
  });
}

export function heatmap(d: Data): { weeks: { d: string; n: number }[][]; max: number; total: number; activeDays: number; level: (n: number) => number } {
  const counts = new Map(d.daily_counts.map((x) => [x.d, x.n]));
  const days = lastDays(364);
  // pad so the first column starts on a Monday
  const firstDow = (new Date(days[0] + "T12:00:00Z").getUTCDay() + 6) % 7;
  const cells = [...Array(firstDow).fill(null), ...days.map((k) => ({ d: k, n: counts.get(k) ?? 0 }))];
  const weeks: { d: string; n: number }[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const vals = days.map((k) => counts.get(k) ?? 0);
  // levels by percentile of active days, so the accent marks only the top ~10%
  const nz = vals.filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p: number) => nz[Math.min(nz.length - 1, Math.floor(p * nz.length))] ?? 1;
  const [q1, q2, q3] = [q(0.35), q(0.65), q(0.9)];
  const level = (n: number) => (n <= 0 ? 0 : n < q1 ? 1 : n < q2 ? 2 : n < q3 ? 3 : 4);
  return { weeks, max: Math.max(1, ...vals), total: sum(vals), activeDays: nz.length, level };
}

// Ryuk's observations: computed from the data, written as detached analytical prose.
export function observations(d: Data): { text: string; metric?: string }[] {
  const out: { text: string; metric?: string }[] = [];
  const week = lastDays(7), prev = lastDays(14).slice(0, 7);
  const inSet = (s: string[]) => (r: Base) => s.includes(dayKey(r.logged_at));

  // 1. deep work window: best 3-hour window by minutes logged (last 30 days)
  const deepRows = d.time_log.filter((r) => r.kind === "deep_work" && r.duration_min);
  if (deepRows.length >= 5) {
    const h = Array(24).fill(0);
    deepRows.forEach((r) => (h[hourIST(r.logged_at)] += r.duration_min!));
    let best = 0, at = 0;
    for (let i = 0; i < 24; i++) { const s = h[i] + h[(i + 1) % 24] + h[(i + 2) % 24]; if (s > best) { best = s; at = i; } }
    const share = Math.round((best / sum(h)) * 100);
    const f = (x: number) => String(x % 24).padStart(2, "0") + ":00";
    out.push({ text: `Deep work clusters between ${f(at)} and ${f(at + 3)}; ${share}% of focused minutes are logged in that window.`, metric: `${share}%` });
  }
  // 2. sleep consistency week over week
  const sW = d.sleep.filter(inSet(week)).map((r) => r.duration_min!).filter(Boolean);
  const sP = d.sleep.filter(inSet(prev)).map((r) => r.duration_min!).filter(Boolean);
  const sdW = sd(sW), sdP = sd(sP), mW = mean(sW);
  if (sdW != null && mW != null) {
    let t = `Sleep averaged ${(mW / 60).toFixed(1)} h across ${sW.length} nights, varying by ±${Math.round(sdW)} min`;
    if (sdP != null && sdP > 0) {
      const ch = Math.round(((sdP - sdW) / sdP) * 100);
      t += ch >= 0 ? `; consistency is up ${ch}% on the previous week.` : `; consistency is down ${-ch}% on the previous week.`;
    } else t += ".";
    out.push({ text: t, metric: `${(mW / 60).toFixed(1)}h` });
  }
  // 3. energy after good vs short sleep
  const sleepBy = byDay(d.sleep, (r) => r.duration_min);
  const energyBy = avgByDay(d.checkins.filter((r) => r.metric === "energy"), (r) => r.score);
  const good: number[] = [], short: number[] = [];
  for (const [k, e] of energyBy) {
    const prevK = new Date(Date.parse(k + "T12:00:00Z") - 86400e3).toISOString().slice(0, 10);
    const s = sleepBy.get(prevK);
    if (s == null) continue;
    (s >= 420 ? good : short).push(e);
  }
  if (good.length >= 3 && short.length >= 3) {
    const g = mean(good)!, s = mean(short)!;
    out.push({ text: `After nights of seven hours or more, energy averages ${g.toFixed(1)}; after shorter nights it falls to ${s.toFixed(1)}.`, metric: `${(g - s >= 0 ? "+" : "")}${(g - s).toFixed(1)}` });
  }
  // 4. protein vs target
  const pW = byDay(d.meals.filter(inSet(week)), (r) => r.protein_g_est);
  if (pW.size >= 3) {
    const avg = mean([...pW.values()])!;
    const under = [...pW.values()].filter((v) => v < 80).length;
    out.push({ text: `Estimated protein averaged ${Math.round(avg)} g a day this week; ${under} of ${pW.size} logged days fell short of 80 g.`, metric: `${Math.round(avg)}g` });
  }
  // 5. screen time trend
  const scr = d.time_log.filter((r) => r.kind === "screen");
  const scW = sum(scr.filter(inSet(week)).map((r) => r.duration_min)), scP = sum(scr.filter(inSet(prev)).map((r) => r.duration_min));
  if (scW > 0 && scP > 0) {
    const ch = Math.round(((scW - scP) / scP) * 100);
    out.push({ text: `Passive screen time totalled ${Math.round(scW / 60 * 10) / 10} h this week, ${ch >= 0 ? "up" : "down"} ${Math.abs(ch)}% on the week before.`, metric: `${ch >= 0 ? "+" : ""}${ch}%` });
  }
  return out;
}

// ---------- Day counter: "Day N", streak, live tallies vs 7-day average ----------
export type DayCounter = {
  dayN: number;             // days since first entry (inclusive)
  today: string;            // IST date "YYYY-MM-DD"
  streak: number;           // consecutive IST days with >=1 entry up to today
  daysWritten: number;      // days with at least one entry, ever
  goalStreak: number;       // consecutive days all goals kept (placeholder until pacts/goals exist)
  tallies: {
    key: string;
    label: string;
    now: number;
    avg7: number;           // mean of previous 7 days (today excluded)
    unit: string;
    fmt?: (n: number) => string;
    hideWhenZero?: boolean;
  }[];
};
export function dayCounter(d: Data): DayCounter {
  const today = todayKey();
  const todayMs = Date.parse(today + "T12:00:00Z");
  // first day: earliest in daily_counts or first message
  const firstDay = (d.daily_counts.length ? d.daily_counts[0].d : (d.messages[d.messages.length - 1]?.received_at && dayKey(d.messages[d.messages.length - 1].received_at))) || today;
  const dayN = Math.max(1, Math.round((todayMs - Date.parse(firstDay + "T12:00:00Z")) / 86400e3) + 1);

  // writing streak: walk back from today through daily_counts set
  const written = new Set(d.daily_counts.filter((x) => x.n > 0).map((x) => x.d));
  let streak = 0;
  for (let i = 0; ; i++) {
    const k = new Date(todayMs - i * 86400e3).toISOString().slice(0, 10);
    if (written.has(k)) streak++;
    else if (i === 0) { /* today not yet written: don't break the streak */ }
    else break;
    if (i > 400) break;
  }

  // build tallies for today vs previous 7-day average
  const prev7 = Array.from({ length: 7 }, (_, i) => new Date(todayMs - (i + 1) * 86400e3).toISOString().slice(0, 10));
  const avg = (m: Map<string, number>) => mean(prev7.map((k) => m.get(k) ?? 0).filter((v) => v != null) as number[]) ?? 0;

  const entriesByDay = new Map(d.daily_counts.map((x) => [x.d, x.n]));
  const setsByDay = byDay(d.strength, (r) => r.sets ?? 1);
  const trainMinByDay = new Map(byDay(d.cardio, (r) => r.duration_min));
  for (const [k, v] of byDay(d.strength, (r) => (r.sets ?? 1) * 3)) trainMinByDay.set(k, (trainMinByDay.get(k) || 0) + v);
  const proteinByDay = byDay(d.meals, (r) => r.protein_g_est);
  const waterByDay = byDay(d.water, (r) => r.ml);
  const deepByDay = byDay(d.time_log.filter((r) => r.kind === "deep_work"), (r) => r.duration_min);
  const screenByDay = byDay(d.time_log.filter((r) => r.kind === "screen"), (r) => r.duration_min);
  const sleepByDay = byDay(d.sleep, (r) => r.duration_min);
  // sleep is dated to the night it started, so "last night" is yesterday's sleep
  const yesterday = prev7[0];
  // finance_log dates are already IST days
  const spendBy = new Map<string, number>();
  for (const t of d.finance_log ?? []) if (t.type === "debit" && !["investment", "transfer"].includes(t.category ?? "")) spendBy.set(t.date, (spendBy.get(t.date) || 0) + (t.amount || 0));
  const spend = spendBy.get(today) ?? 0;
  const spendAvg = avg(spendBy);

  const tallies: DayCounter["tallies"] = [
    { key: "entries",  label: "Entries",  now: entriesByDay.get(today) ?? 0, avg7: avg(entriesByDay), unit: "" },
    { key: "sets",     label: "Sets",     now: setsByDay.get(today) ?? 0,    avg7: avg(setsByDay),    unit: "", hideWhenZero: false },
    { key: "train",    label: "Training", now: trainMinByDay.get(today) ?? 0, avg7: avg(trainMinByDay), unit: "min" },
    { key: "protein",  label: "Protein",  now: proteinByDay.get(today) ?? 0, avg7: avg(proteinByDay), unit: "g" },
    { key: "water",    label: "Water",    now: waterByDay.get(today) ?? 0,   avg7: avg(waterByDay),   unit: "ml" },
    { key: "deep",     label: "Deep work", now: deepByDay.get(today) ?? 0,   avg7: avg(deepByDay),    unit: "min" },
    { key: "sleep",    label: "Sleep",    now: sleepByDay.get(yesterday) ?? sleepByDay.get(today) ?? 0, avg7: avg(sleepByDay), unit: "min" },
    { key: "screen",   label: "Screen",   now: screenByDay.get(today) ?? 0,  avg7: avg(screenByDay),  unit: "min" },
  ];
  if (d.finance_log) {
    tallies.push({ key: "spend", label: "Spend", now: spend, avg7: spendAvg, unit: "₹", fmt: (n) => "₹" + Math.round(n).toLocaleString("en-IN") });
  }
  return { dayN, today, streak, daysWritten: written.size, goalStreak: 0, tallies };
}


// ---------- Demo data (used only when ?demo=1 or the API is unreachable) ----------
export function demoData(): Data {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const at = (daysAgo: number, h: number, m = Math.floor(rnd() * 60)) => {
    const k = lastDays(daysAgo + 1)[0];
    return new Date(Date.parse(`${k}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+05:30`)).toISOString();
  };
  const D: Data = { strength: [], cardio: [], meals: [], water: [], sleep: [], time_log: [], checkins: [], body: [], notes: [], messages: [], pins: [], daily_counts: [] };
  let id = 1;
  const nowH = Number(new Date().toLocaleString("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).slice(0, 2));
  const ok = (dAgo: number, h: number) => dAgo > 0 || h <= Math.max(nowH, 9);
  for (let d = 0; d < 90; d++) {
    const sleepMin = pick([385, 400, 415, 430, 445, 460, 470, 350]);
    if (d > 0 || true) D.sleep.push({ id: id++, logged_at: at(d + 1, 23, 50), duration_min: sleepMin, bed_time: pick(["00:40", "01:05", "23:55", "00:20"]), wake_time: pick(["07:30", "08:05", "07:50"]), detail: null, summary: `Slept ${(sleepMin / 60).toFixed(1)} h` });
    if (ok(d, 7)) D.meals.push({ id: id++, logged_at: at(d, 8, 40), meal_slot: "breakfast", items: pick(["2 besan chilla, 1 bowl curd", "oats with whey, banana", "paneer paratha, curd"]), protein_g_est: pick([18, 24, 30]), detail: null, summary: "Breakfast" });
    if (ok(d, 13)) D.meals.push({ id: id++, logged_at: at(d, 13, 20), meal_slot: "lunch", items: pick(["2 roti, dal, rajma, salad", "rice, chole, curd", "2 roti, paneer bhurji, dal"]), protein_g_est: pick([20, 26, 32]), detail: null, summary: "Lunch" });
    if (ok(d, 20) && d > 0) D.meals.push({ id: id++, logged_at: at(d, 20, 45), meal_slot: "dinner", items: pick(["soya chunks curry, 2 roti", "tofu stir fry, rice", "dal khichdi, curd"]), protein_g_est: pick([22, 28, 35]), detail: null, summary: "Dinner" });
    if (d % 2 === 0 && ok(d, 7)) {
      for (const [ex, w] of pick([[["Bench press", 60], ["Incline dumbbell press", 20], ["Cable fly", 15]], [["Squat", 80], ["Romanian deadlift", 70], ["Leg press", 120]], [["Pull-ups", 0], ["Barbell row", 55], ["Bicep curl", 12]]]) as [string, number][])
        D.strength.push({ id: id++, logged_at: at(d, 7, 10), exercise: ex, sets: 3, reps: pick([8, 10, 12]), weight_kg: w || null, detail: null, summary: `${ex} 3×${w ? w + "kg" : "BW"}` });
    } else if (ok(d, 7)) {
      const mins = pick([24, 28, 31, 35, 40]);
      D.cardio.push({ id: id++, logged_at: at(d, 6, 55), activity: pick(["Run", "Run", "Cycling", "Walk"]), duration_min: mins, distance_km: Math.round(mins / 5.8 * 10) / 10, avg_hr: pick([142, 148, 155]), detail: pick(["easy pace", "legs heavy", "negative split"]), summary: `Run ${Math.round(mins / 5.8 * 10) / 10} km in ${mins} min` });
    }
    const blocks: [number, string, string][] = [[10, "work", "GDX validation hooks"], [11, "work", "Pipeline payload review"], [17, "dsa", "LeetCode graphs, 3 mediums"], [21, "ai", "MCP agent prototype"], [9, "system_design", "Caching and consistency notes"], [22, "rust", "Rust ownership exercises"]];
    for (const [h, topic, title] of blocks.filter(() => rnd() > 0.45)) if (ok(d, h))
      D.time_log.push({ id: id++, logged_at: at(d, h, 30), kind: "deep_work", topic, duration_min: pick([45, 60, 75, 90, 120]), pages: null, title, detail: null, summary: `${title}` });
    if (rnd() > 0.35 && ok(d, 22)) D.time_log.push({ id: id++, logged_at: at(d, 22, 40), kind: "read", topic: pick(["system_design", "other"]), duration_min: 30, pages: pick([18, 22, 30]), title: pick(["Designing Data-Intensive Applications", "The Pragmatic Programmer", "Thinking in Systems", "Meditations"]), detail: null, summary: "Reading block" });
    if (rnd() > 0.6 && ok(d, 19)) D.time_log.push({ id: id++, logged_at: at(d, 19, 10), kind: "watch", topic: "ai", duration_min: 40, pages: null, title: pick(["Lecture: Retrieval at scale", "Talk: Building reliable agents"]), detail: null, summary: "Watched a talk" });
    if (rnd() > 0.7 && ok(d, 8)) D.time_log.push({ id: id++, logged_at: at(d, 8, 15), kind: "listen", topic: "other", duration_min: 35, pages: null, title: "Podcast: Systems thinking", detail: null, summary: "Podcast on commute" });
    if (ok(d, 23)) D.time_log.push({ id: id++, logged_at: at(d, 23, 15), kind: "screen", topic: "other", duration_min: pick([25, 40, 55, 70, 95]), pages: null, title: pick(["Instagram reels", "YouTube shorts", "X feed"]), detail: null, summary: "Scrolling" });
    for (const [metric, h] of [["energy", 11], ["focus", 16], ["mood", 21]] as [string, number][]) if (ok(d, h))
      D.checkins.push({ id: id++, logged_at: at(d, h), metric, score: Math.max(1, Math.min(5, Math.round((sleepMin - 330) / 45 + rnd() * 1.6))), summary: `${metric[0].toUpperCase() + metric.slice(1)} check-in` });
    if (ok(d, 15)) D.water.push({ id: id++, logged_at: at(d, 15), ml: pick([1500, 2000, 2500]), summary: "Water" });
  }
  D.notes.push({ id: id++, logged_at: at(0, 9, 5), note_kind: "idea", text: "An MCP server that lets Claude query this log", summary: "Idea: MCP server over the log" });
  D.notes.push({ id: id++, logged_at: at(2, 22, 30), note_kind: "note", text: "Felt sharpest after the early run; keep runs before 8.", summary: "Early runs help focus" });
  // original abstract posters, drawn inline so the demo needs no network
  const poster = (a: string, b: string, shape: string) => "data:image/svg+xml;utf8," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 520"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="400" height="520" fill="url(#g)"/>${shape}</svg>`);
  D.pins = [
    { id: 1, created_at: at(3, 10), kind: "media", title: "10 km under 60 minutes", note: null, link: null, position: 1,
      image_url: poster("#2a1c1c", "#0d0a0f", `<circle cx="200" cy="190" r="110" fill="#C84B31" opacity=".85"/><path d="M0 400 Q120 330 220 380 T400 350 V520 H0Z" fill="#000" opacity=".55"/>`) },
    { id: 2, created_at: at(8, 10), kind: "inspiration", title: "On the work", note: "Fewer things, done slowly and well.", image_url: null, link: null, position: 2 },
    { id: 3, created_at: at(12, 10), kind: "media", title: "Ship the portfolio project", note: null, link: null, position: 3,
      image_url: poster("#1b2230", "#0b0b0e", `<rect x="70" y="120" width="260" height="190" rx="10" fill="none" stroke="#ECE5D3" stroke-width="6" opacity=".8"/><path d="M110 260 L170 200 L220 240 L290 170" fill="none" stroke="#C84B31" stroke-width="10" stroke-linecap="round"/>`) },
    { id: 4, created_at: at(20, 10), kind: "inspiration", title: "Rule", note: "Seven hours of sleep, six nights in seven.", image_url: null, link: null, position: 4 },
  ];
  // Apple Health days, as the Health Watcher Shortcut would send them
  D.health_log = lastDays(30).reverse().map((date, i) => ({
    id: 100 + i, date, steps: Math.round(5200 + rnd() * 7400), exercise_minutes: Math.round(15 + rnd() * 55),
    running_speed: i % 2 ? null : Math.round((9 + rnd() * 3) * 10) / 10, walk_run_distance: Math.round((2.5 + rnd() * 7) * 10) / 10,
    heart_rate_avg: Math.round(64 + rnd() * 14), sleep_minutes: null, weight_kg: null, active_cal: Math.round(280 + rnd() * 420),
    stand_minutes: null, running_power: null, running_stride_length: null, created_at: `${date} 21:00:00`,
  }));
  D.messages = [
    { id: 1, received_at: at(0, 8, 41), text: "breakfast 2 besan chilla aur dahi", status: "auto", model: "gemini-3.5-flash-lite" },
    { id: 2, received_at: at(0, 7, 12), text: "bench 3x10 60 incline db 3x12 20", status: "auto", model: "gemini-3.5-flash-lite" },
    { id: 3, received_at: at(1, 23, 2), text: "uhh the thing from earlier", status: "needs_review", model: null },
  ];
  // heatmap counts for a year
  const counts = new Map<string, number>();
  for (const t of EVENT_TABLES) for (const r of D[t] as Base[]) { const k = dayKey(r.logged_at); counts.set(k, (counts.get(k) || 0) + 1); }
  for (const k of lastDays(364)) if (!counts.has(k)) { const r = rnd(); counts.set(k, r < 0.18 ? 0 : 8 + Math.floor(r * 18)); }
  D.daily_counts = [...counts].map(([d, n]) => ({ d, n })).sort((a, b) => a.d.localeCompare(b.d));
  return D;
}

// ---------- Shinigami eyes: raw readouts, this period vs the one before ----------
export type Readout = { key: string; label: string; unit: string; now: number | null; prev: number | null; better: "up" | "down"; spark: (number | null)[]; digits: number };
export function eyesReadouts(d: Data, n = 30): { readouts: Readout[]; daysWritten: number; entries: number; table: Record<string, number | null | string>[] } {
  const cur = lastDays(n), prev = lastDays(2 * n).slice(0, n), spark = lastDays(21);
  const inS = (set: string[]) => { const s = new Set(set); return (r: Base) => s.has(dayKey(r.logged_at)); };
  const avgDaily = (m: Map<string, number>, set: string[]) => { const v = set.filter((k) => m.has(k)).map((k) => m.get(k)!); return v.length ? sum(v) / v.length : null; };
  const total = (m: Map<string, number>, set: string[]) => { const v = set.filter((k) => m.has(k)).map((k) => m.get(k)!); return v.length ? sum(v) : null; };
  const sleep = byDay(d.sleep, (r) => (r.duration_min ?? 0) / 60);
  const deep = byDay(d.time_log.filter((r) => r.kind === "deep_work"), (r) => (r.duration_min ?? 0) / 60);
  const protein = byDay(d.meals, (r) => r.protein_g_est);
  const cardio = byDay(d.cardio, (r) => r.duration_min);
  const volume = byDay(d.strength, (r) => (r.sets ?? 1) * (r.reps ?? 0) * (r.weight_kg ?? 0));
  const screen = byDay(d.time_log.filter((r) => r.kind === "screen"), (r) => r.duration_min);
  const energy = avgByDay(d.checkins.filter((r) => r.metric === "energy"), (r) => r.score);
  const focus = avgByDay(d.checkins.filter((r) => r.metric === "focus"), (r) => r.score);
  const pages = byDay(d.time_log.filter((r) => r.kind === "read"), (r) => r.pages);
  const counts = new Map(d.daily_counts.map((x) => [x.d, x.n]));
  const R = (key: string, label: string, unit: string, m: Map<string, number>, mode: "avg" | "total", better: "up" | "down", digits = 1): Readout => ({
    key, label, unit, better, digits,
    now: mode === "avg" ? avgDaily(m, cur) : total(m, cur), prev: mode === "avg" ? avgDaily(m, prev) : total(m, prev), spark: seriesOf(m, spark),
  });
  void inS;
  const readouts = [
    R("sleep", "Sleep", "h / night", sleep, "avg", "up"),
    R("deep", "Deep work", "h total", deep, "total", "up"),
    R("protein", "Protein", "g / day est.", protein, "avg", "up", 0),
    R("cardio", "Cardio", "min total", cardio, "total", "up", 0),
    R("volume", "Lifted", "kg total", volume, "total", "up", 0),
    R("pages", "Pages read", "pages", pages, "total", "up", 0),
    R("energy", "Energy", "/ 5 avg", energy, "avg", "up"),
    R("focus", "Focus", "/ 5 avg", focus, "avg", "up"),
    R("screen", "Screen", "min / day", screen, "avg", "down", 0),
  ];
  const table = lastDays(14).reverse().map((k) => ({
    day: k, entries: counts.get(k) ?? 0,
    sleep: sleep.get(k) ?? null, deep: deep.get(k) ?? null, protein: protein.get(k) ?? null,
    cardio: cardio.get(k) ?? null, screen: screen.get(k) ?? null, energy: energy.get(k) ?? null,
  }));
  return { readouts, daysWritten: cur.filter((k) => (counts.get(k) ?? 0) > 0).length, entries: sum(cur.map((k) => counts.get(k) ?? 0)), table };
}
