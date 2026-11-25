/**
 * Batch notes: a whole workout (or day) pasted in one go, one line per set/activity, each with its own time.
 *
 *   25/11                      <- optional date header (also "2026-11-25", "yesterday", "kal")
 *   18:02 bench 60x10
 *   18:05 bench 65x8
 *   6:40 pm squats 80x5 rpe 9
 *   - lat pulldown 3x12 50     <- no time: inherits the previous line's time
 *
 * Pure functions only (no I/O), so they are unit-testable.
 */

export type BatchLine = { idx: number; text: string; atMs: number; timed: boolean };

const IST = 19800e3;
const TIME_RE = /^\[?(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(am|pm|AM|PM)?\]?\s*[-–:|]?\s*/;
const BULLET_RE = /^\s*(?:[-*•·▪◦]|\d+[.)]|\[[ xX✓]\])\s+/;

const istDayStartMs = (ms: number) => {
  const d = new Date(ms + IST).toISOString().slice(0, 10);
  return Date.parse(`${d}T00:00:00+05:30`);
};

/** Date header line → IST day start (ms), or null if the line isn't a date header. */
export function parseDateHeader(line: string, nowMs: number): number | null {
  const s = line.trim().toLowerCase().replace(/[,:#*]/g, " ").replace(/\s+/g, " ").trim();
  const today = istDayStartMs(nowMs);
  if (/^(today|aaj)( workout| gym| log)?$/.test(s)) return today;
  if (/^(yesterday|kal)( workout| gym| log)?$/.test(s)) return today - 86400e3;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00+05:30`);
  m = s.match(/^(?:[a-z]{3,9} )?(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/);     // 25/11, 25/11/26, wed 25/11
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : new Date(nowMs + IST).getUTCFullYear();
    const iso = `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    const t = Date.parse(`${iso}T00:00:00+05:30`);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/** Leading time on a line → minutes after midnight, plus the rest of the line. */
export function splitTime(line: string): { minutes: number | null; rest: string } {
  const m = line.match(TIME_RE);
  if (!m) return { minutes: null, rest: line };
  let h = +m[1];
  const min = +m[2];
  const ap = m[3]?.toLowerCase();
  if (min > 59 || h > 23) return { minutes: null, rest: line };
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return { minutes: h * 60 + min, rest: line.slice(m[0].length) };
}

/**
 * Split pasted text into timed lines. Times without am/pm are 24h, except that a time earlier than the
 * previous timed line by more than 6 h is read as pm (e.g. "11:50, 12:10, 1:05" → 13:05).
 * A time that would be in the future (note written last night, sent after midnight) moves to the day before.
 */
export function parseBatch(text: string, nowMs: number): BatchLine[] {
  let dayStart = istDayStartMs(nowMs);
  let explicitDay = false;
  const out: BatchLine[] = [];
  let lastMin: number | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(BULLET_RE, "").trim();
    if (!line) continue;
    const header = parseDateHeader(line, nowMs);
    if (header != null) { dayStart = header; explicitDay = true; lastMin = null; continue; }
    const { minutes, rest } = splitTime(line);
    let mins = minutes;
    if (mins != null && lastMin != null && mins < lastMin - 360 && mins < 720) mins += 720;
    const body = rest.trim();
    if (!body) continue;
    let atMs: number;
    if (mins != null) { atMs = dayStart + mins * 60e3; lastMin = mins; }
    else atMs = out.length ? out[out.length - 1].atMs : (lastMin != null ? dayStart + lastMin * 60e3 : nowMs);
    out.push({ idx: out.length + 1, text: body, atMs, timed: mins != null });
  }
  // lines before the first timed line (a title like "Gym", "push day") take the first time
  const firstTimed = out.find((l) => l.timed);
  if (firstTimed) for (const l of out) { if (l === firstTimed) break; l.atMs = firstTimed.atMs; }
  if (!explicitDay && firstTimed && out.some((l) => l.atMs > nowMs + 5 * 60e3)) {
    for (const l of out) l.atMs -= 86400e3;
  }
  return out;
}

/** A message is treated as a batch if it has 2+ content lines and at least one leading time, or 4+ lines. */
export function isBatch(text: string): boolean {
  const lines = text.split(/\r?\n/).map((l) => l.replace(BULLET_RE, "").trim()).filter(Boolean);
  if (lines.length < 2) return false;
  return lines.some((l) => splitTime(l).minutes != null) || lines.length >= 4;
}

/** Stable key for "this line was already logged": same time (to the second) + same normalised text. */
export function lineKey(l: BatchLine): string {
  const t = new Date(Math.floor(l.atMs / 1000) * 1000).toISOString();
  return `${t}|${l.text.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

export const hhmm = (ms: number) => new Date(ms + IST).toISOString().slice(11, 16);
