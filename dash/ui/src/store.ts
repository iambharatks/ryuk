/**
 * One interface for the daily page and the shelf, with two implementations:
 * the real API (behind Access) and an in-memory demo that behaves the same way.
 */
export type Parsed = { table: string; summary: string };
export type Entry = { id: number; received_at: string; text: string; status: string; parsed: Parsed[] };
export type Task = { id: number; day: string; text: string; created_at: string; done_at: string | null; message_id: number | null; position: number };
export type PageData = { day: string; entries: Entry[]; tasks: Task[] };
export type LibKind = "book" | "pdf" | "video" | "audio" | "image" | "link";
export type LibItem = {
  id: number; kind: LibKind; title: string; creator: string | null; url: string | null; file_key: string | null; mime: string | null;
  total: number | null; progress: number | null; status: "active" | "paused" | "done" | "wishlist"; note: string | null; created_at: string; updated_at: string;
};
export type Uploaded = { key: string; size: number; mime: string; url: string };
export type Goal = { id: number; date: string; text: string; done: number; color: string | null; rotation: number | null; position: number | null; created_at: string;
  done_at?: string | null; x?: number | null; y?: number | null; z?: number | null };
export type GoalPatch = { done?: boolean; text?: string; position?: number; x?: number | null; y?: number | null; z?: number };

export interface Store {
  demo: boolean;
  uploads: boolean;
  page(day: string): Promise<PageData>;
  writeLines(lines: { text: string; at: string }[]): Promise<string>;
  editEntry(id: number, text: string, at: string): Promise<string>;
  eraseEntry(id: number): Promise<void>;
  addTask(day: string, text: string): Promise<Task>;
  editTask(id: number, patch: { text?: string; done?: boolean; at?: string }): Promise<{ task: Task; reply?: string }>;
  deleteTask(id: number): Promise<void>;
  library(): Promise<LibItem[]>;
  addItem(v: Partial<LibItem>): Promise<LibItem>;
  editItem(id: number, v: Partial<LibItem>): Promise<LibItem>;
  progress(id: number, value: number): Promise<LibItem>;
  deleteItem(id: number): Promise<void>;
  upload(file: File, onProgress?: (pct: number) => void): Promise<Uploaded>;
  fileUrl(item: { file_key: string | null; url: string | null }): string | null;
  goals(date?: string): Promise<Goal[]>;
  addGoal(text: string, date?: string): Promise<Goal>;
  editGoal(id: number, patch: GoalPatch): Promise<Goal>;
  deleteGoal(id: number): Promise<void>;
}

export const istDay = (ms = Date.now()) => new Date(ms + 19800e3).toISOString().slice(0, 10);

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `HTTP ${res.status}${res.status === 403 ? " (signed out? reload the page)" : ""}`);
  return out as T;
}

export function apiStore(uploads: boolean): Store {
  return {
    demo: false,
    uploads,
    page: (day) => call("GET", `/api/page?day=${day}`),
    writeLines: async (lines) => (await call<{ reply: string }>("POST", "/api/notepad", { lines })).reply,
    editEntry: async (id, text, at) => (await call<{ reply: string }>("PATCH", "/api/entry", { id, text, at })).reply,
    eraseEntry: async (id) => { await call("DELETE", "/api/row", { table: "messages", id }); },
    addTask: (day, text) => call("POST", "/api/tasks", { day, text }),
    editTask: (id, patch) => call("PATCH", "/api/tasks", { id, ...patch }),
    deleteTask: async (id) => { await call("DELETE", "/api/tasks", { id }); },
    library: async () => ((await call<{ library?: LibItem[] }>("GET", "/api/data?days=1")).library ?? []),
    addItem: (v) => call("POST", "/api/library", v),
    editItem: (id, v) => call("PATCH", "/api/library", { id, ...v }),
    progress: async (id, value) => (await call<{ item: LibItem }>("POST", "/api/library/progress", { id, value })).item,
    deleteItem: async (id) => { await call("DELETE", "/api/library", { id }); },
    upload: (file, onProgress) => new Promise((resolve, reject) => {
      // XHR (not fetch) so the bar can show upload progress
      const x = new XMLHttpRequest();
      x.open("POST", "/api/upload");
      x.setRequestHeader("content-type", file.type || "application/octet-stream");
      x.setRequestHeader("x-file-name", encodeURIComponent(file.name));
      x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
      x.onload = () => { let b: any = {}; try { b = JSON.parse(x.responseText); } catch { /* */ } x.status < 300 ? resolve(b) : reject(new Error(b.error || `HTTP ${x.status}`)); };
      x.onerror = () => reject(new Error("network error"));
      x.send(file);
    }),
    fileUrl: (i) => (i.file_key ? `/api/file/${i.file_key.split("/").map(encodeURIComponent).join("/")}` : i.url),
    goals: async (date) => (await call<{ goals: Goal[] }>("GET", `/api/goals${date ? `?date=${date}` : ""}`)).goals,
    addGoal: (text, date) => call("POST", "/api/goals", { text, date }),
    editGoal: (id, patch) => call("PATCH", `/api/goals/${id}`, patch),
    deleteGoal: async (id) => { await call("DELETE", `/api/goals/${id}`); },
  };
}

const STICKY = ["#f5e6a3", "#f5c6c6", "#c6d8f5", "#c6f5d0"];
const seedTilt = (s: string) => Math.round((([...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7) % 1000) / 1000 * 6 - 3) * 10) / 10;

// ---------------- demo: everything in memory, same behaviour ----------------
const guess = (text: string): Parsed[] => {
  const t = text.toLowerCase();
  const m = t.match(/(\d+(?:\.\d+)?)\s*x\s*(\d+)/);
  if (m && /bench|squat|dead|press|row|curl|pull|lunge|dip/.test(t)) {
    const name = text.replace(/[\d.]+\s*x\s*\d+.*/i, "").trim() || "Lift";
    return [{ table: "strength", summary: `${name[0].toUpperCase() + name.slice(1)} ${m[1]} kg × ${m[2]}` }];
  }
  if (/ran|run|walk|cycl|km\b/.test(t)) return [{ table: "cardio", summary: text.length > 40 ? text.slice(0, 40) + "…" : text }];
  if (/breakfast|lunch|dinner|ate|roti|dal|paneer|whey|oats/.test(t)) return [{ table: "meals", summary: "Meal: " + text.slice(0, 36) }];
  if (/read|pages|chapter/.test(t)) return [{ table: "time_log", summary: "Reading: " + text.slice(0, 36) }];
  if (/leetcode|dsa|deep work|worked|study|coded/.test(t)) return [{ table: "time_log", summary: "Deep work: " + text.slice(0, 34) }];
  if (/sleep|slept|nap/.test(t)) return [{ table: "sleep", summary: text.slice(0, 40) }];
  if (/water|glass|bottle/.test(t)) return [{ table: "water", summary: text.slice(0, 40) }];
  if (/energy|mood|focus|stress/.test(t)) return [{ table: "checkins", summary: text.slice(0, 40) }];
  return [{ table: "notes", summary: text.slice(0, 44) }];
};

function tinyPdf(pages: string[]): Blob {
  // a valid little PDF so the demo viewer has something real to open
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic >>");
  pages.forEach((p, i) => {
    const stream = `BT /F1 28 Tf 72 700 Td (${p.replace(/[()\\]/g, "")}) Tj ET BT /F1 12 Tf 72 80 Td (page ${i + 1} of ${pages.length}) Tj ET`;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([out], { type: "application/pdf" });
}

const svgCover = (title: string, a: string, b: string) =>
  "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 260"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="400" height="260" fill="url(#g)"/><circle cx="300" cy="80" r="46" fill="#C84B31" opacity=".75"/><path d="M0 200 Q100 150 200 190 T400 170 V260 H0Z" fill="#000" opacity=".45"/><text x="24" y="236" font-family="Georgia" font-style="italic" font-size="22" fill="#F4F4F6">${title}</text></svg>`);

export function demoStore(): Store {
  let nextId = 1000;
  const now = Date.now();
  const today = istDay(now);
  const yday = istDay(now - 86400e3);
  const at = (day: string, hm: string) => new Date(Date.parse(`${day}T${hm}:00+05:30`)).toISOString();
  const nowHm = new Date(now + 19800e3).toISOString().slice(11, 16);
  const earlier = (hm: string) => (hm <= nowHm ? hm : nowHm);
  const entries: Entry[] = [];
  const add = (day: string, hm: string, text: string) => entries.push({ id: nextId++, received_at: at(day, day === today ? earlier(hm) : hm), text, status: "auto", parsed: guess(text) });
  [["06:40", "ran 5km in 29 min, legs fresh"], ["07:20", "oats with whey and banana"], ["07:55", "bench 60x10"], ["07:58", "bench 65x8"], ["08:02", "bench 70x6"],
   ["10:30", "deep work: GDX validation hooks, 2h"], ["13:10", "lunch dal chawal 2 roti paneer"], ["17:45", "read DDIA ch5, 22 pages"]]
    .forEach(([h, t]) => add(today, h, t));
  [["07:10", "squat 80x5"], ["07:14", "squat 85x5"], ["09:00", "leetcode 3 mediums, 90 min"], ["21:30", "energy 3, mood 4"], ["23:40", "slept at 23:40"]].forEach(([h, t]) => add(yday, h, t));
  const tasks: Task[] = [
    { id: nextId++, day: today, text: "deadlift 100x5", created_at: at(today, earlier("06:30")), done_at: null, message_id: null, position: 1 },
    { id: nextId++, day: today, text: "3 litres of water", created_at: at(today, earlier("06:31")), done_at: null, message_id: null, position: 2 },
    { id: nextId++, day: today, text: "system design: consistent hashing notes", created_at: at(today, earlier("06:32")), done_at: at(today, earlier("11:05")), message_id: null, position: 3 },
  ];
  const pdfUrl = URL.createObjectURL(tinyPdf(["Chapter 1 - Reliable systems", "Chapter 2 - Data models", "Chapter 3 - Storage", "Chapter 4 - Encoding", "Chapter 5 - Replication"]));
  const lib: (LibItem & { _url?: string })[] = [
    { id: nextId++, kind: "book", title: "Designing Data-Intensive Applications", creator: "Martin Kleppmann", url: null, file_key: null, mime: null, total: 590, progress: 214, status: "active", note: "Replication chapter, leader-based vs leaderless", created_at: at(yday, "08:00"), updated_at: at(today, earlier("17:45")) },
    { id: nextId++, kind: "pdf", title: "Raft paper (extended)", creator: "Ongaro & Ousterhout", url: null, file_key: "demo-pdf", mime: "application/pdf", total: 5, progress: 3, status: "active", note: null, created_at: at(yday, "09:00"), updated_at: at(yday, "21:00"), _url: pdfUrl },
    { id: nextId++, kind: "video", title: "Distributed systems lecture 4", creator: "University course", url: "https://example.com/lecture-4", file_key: null, mime: null, total: 4740, progress: 1530, status: "active", note: "pick up at the primary/backup part", created_at: at(yday, "10:00"), updated_at: at(yday, "22:10") },
    { id: nextId++, kind: "image", title: "Bangalore, the next chapter", creator: null, url: svgCover("the next chapter", "#1E2A33", "#0B0B0E"), file_key: null, mime: "image/svg+xml", total: null, progress: null, status: "active", note: "why the move matters", created_at: at(yday, "11:00"), updated_at: at(yday, "11:00") },
    { id: nextId++, kind: "book", title: "Atomic Habits", creator: "James Clear", url: null, file_key: null, mime: null, total: 320, progress: 320, status: "done", note: null, created_at: at(yday, "11:00"), updated_at: at(yday, "11:00") },
    { id: nextId++, kind: "link", title: "Cloudflare D1 docs", creator: "developers.cloudflare.com", url: "https://developers.cloudflare.com/d1/", file_key: null, mime: null, total: null, progress: null, status: "wishlist", note: null, created_at: at(yday, "12:00"), updated_at: at(yday, "12:00") },
  ];
  const goals: Goal[] = ["Deadlift 100x5", "Finish DDIA ch 6", "3 L of water", "Call home", "Ship the pin wall"].map((text, i) => ({
    id: nextId++, date: i === 1 ? istDay(now - 2 * 86400e3) : today, text, done: i === 2 ? 1 : 0, done_at: i === 2 ? new Date(now).toISOString() : null,
    color: STICKY[i % 4], rotation: seedTilt(text + i), position: i + 1, created_at: new Date(now).toISOString(), x: null, y: null, z: null,
  }));
  // open notes carry forward; a kept one stays on the day it was kept
  const onBoard = (g: Goal, d: string) => g.date <= d && (!g.done || (g.done_at ? dayOf(g.done_at) : g.date) >= d);
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  const wait = (ms = 350) => new Promise((r) => setTimeout(r, ms));
  const dayOf = (iso: string) => istDay(Date.parse(iso));
  return {
    demo: true,
    uploads: true,
    async page(day) { await wait(200); return { day, entries: clone(entries.filter((e) => dayOf(e.received_at) === day).sort((a, b) => a.received_at.localeCompare(b.received_at))), tasks: clone(tasks.filter((t) => t.day <= day && (!t.done_at || dayOf(t.done_at) >= day)).sort((a, b) => a.day.localeCompare(b.day) || a.position - b.position || a.id - b.id)) }; },
    async writeLines(lines) {
      await wait(700);
      const out = lines.map((l) => { const e: Entry = { id: nextId++, received_at: l.at, text: l.text, status: "auto", parsed: guess(l.text) }; entries.push(e); return `✓ ${new Date(l.at).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })} ${e.parsed[0].summary}`; });
      return `📒 ${lines.length} written in ink (demo)\n` + out.join("\n");
    },
    async editEntry(id, text, at) { await wait(); const e = entries.find((x) => x.id === id); if (!e) throw new Error("not found"); Object.assign(e, { text, received_at: at, status: "corrected", parsed: guess(text) }); return "✓ " + e.parsed[0].summary; },
    async eraseEntry(id) { await wait(); const i = entries.findIndex((x) => x.id === id); if (i >= 0) entries.splice(i, 1); },
    async addTask(day, text) { await wait(200); const t: Task = { id: nextId++, day, text, created_at: new Date().toISOString(), done_at: null, message_id: null, position: tasks.length + 1 }; tasks.push(t); return clone(t); },
    async editTask(id, patch) {
      await wait(); const t = tasks.find((x) => x.id === id); if (!t) throw new Error("not found");
      if (patch.text != null) t.text = patch.text;
      if (patch.done === true) t.done_at = patch.at ?? new Date().toISOString();
      if (patch.done === false) t.done_at = null;
      if (patch.done == null && patch.at && t.done_at) t.done_at = patch.at;
      return { task: clone(t), reply: patch.done ? "✓ " + guess(t.text)[0].summary : undefined };
    },
    async deleteTask(id) { await wait(200); const i = tasks.findIndex((x) => x.id === id); if (i >= 0) tasks.splice(i, 1); },
    async library() { await wait(200); return clone(lib) as LibItem[]; },
    async addItem(v) { await wait(); const now2 = new Date().toISOString(); const it = { kind: "link", status: "active", creator: null, url: null, file_key: null, mime: null, total: null, progress: null, note: null, ...v, id: nextId++, created_at: now2, updated_at: now2 } as LibItem & { _url?: string }; lib.unshift(it); return clone(it); },
    async editItem(id, v) { await wait(); const it = lib.find((x) => x.id === id)!; const { progress: _p, ...rest } = v; Object.assign(it, rest, { updated_at: new Date().toISOString() }); return clone(it); },
    async progress(id, value) { await wait(); const it = lib.find((x) => x.id === id)!; it.progress = value; if (it.total != null && value >= it.total - (it.kind === "video" || it.kind === "audio" ? 5 : 0)) it.status = "done"; it.updated_at = new Date().toISOString(); return clone(it); },
    async deleteItem(id) { await wait(); const i = lib.findIndex((x) => x.id === id); if (i >= 0) lib.splice(i, 1); },
    async upload(file, onProgress) {
      for (let p = 0; p <= 100; p += 20) { onProgress?.(p); await wait(90); }
      const url = URL.createObjectURL(file);
      const key = `demo-${nextId++}`;
      demoFiles.set(key, url);
      return { key, size: file.size, mime: file.type, url };
    },
    fileUrl: (i) => (i.file_key ? demoFiles.get(i.file_key) ?? (i.file_key === "demo-pdf" ? pdfUrl : null) : i.url),
    async goals(date = today) { await wait(150); return clone(goals.filter((g) => onBoard(g, date)).sort((a, b) => a.date.localeCompare(b.date) || (a.position ?? 0) - (b.position ?? 0))); },
    async addGoal(text, date = today) {
      await wait(150);
      const n = goals.filter((g) => onBoard(g, date)).length;
      if (n >= 24) throw new Error("the board holds 24 notes; tear one off first");
      const g: Goal = { id: nextId++, date, text: text.slice(0, 160), done: 0, color: STICKY[n % 4], rotation: seedTilt(text + n), position: n + 1, created_at: new Date().toISOString(), done_at: null, x: null, y: null, z: null };
      goals.push(g); return clone(g);
    },
    async editGoal(id, patch) {
      await wait(120); const g = goals.find((x) => x.id === id); if (!g) throw new Error("not found");
      if (patch.done != null) { g.done = patch.done ? 1 : 0; g.done_at = patch.done ? new Date().toISOString() : null; }
      if (patch.x !== undefined) g.x = patch.x;
      if (patch.y !== undefined) g.y = patch.y;
      if (patch.z !== undefined) g.z = patch.z;
      if (patch.text != null) g.text = patch.text;
      if (patch.position != null) g.position = patch.position;
      return clone(g);
    },
    async deleteGoal(id) { await wait(120); const i = goals.findIndex((x) => x.id === id); if (i >= 0) goals.splice(i, 1); },
  };
}
const demoFiles = new Map<string, string>();
