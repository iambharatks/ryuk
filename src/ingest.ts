/**
 * POST /ingest/sms  — the iPhone Shortcut forwards a bank / card SMS here.
 * Auth: header X-Ryuk-Key must equal the INGEST_KEY secret.
 * Body: {"text": "<sms body>", "at": "<optional ISO time>"}  (or the raw SMS as text/plain)
 * Always answers 200 with {status} for valid requests so the Shortcut never shows an error:
 *   recorded | duplicate | ignored
 */
import { normKey, parseSms, redact } from "./sms";

export interface IngestEnv {
  DB: D1Database;
  INGEST_KEY?: string;          // secret
  LARGE_TXN_INR?: string;       // var, default 5000
  TELEGRAM_TOKEN?: string;
  OWNER_CHAT_ID?: string;
  FINANCE_ALERTS?: string;      // var, "1" (default) sends a detail-free Telegram ping for flagged transactions
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function keyOk(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  // constant-time compare
  return (crypto.subtle as any).timingSafeEqual ? (crypto.subtle as any).timingSafeEqual(a, b) : a.every((x, i) => x === b[i]);
}

const istHour = (iso: string) => new Date(Date.parse(iso) + 19800e3).getUTCHours();

type Rule = { display_name: string | null; category: string | null; kind: string | null; ignore: number };

export async function handleIngest(req: Request, env: IngestEnv): Promise<Response> {
  const url = new URL(req.url);
  if (req.method !== "POST" || url.pathname !== "/ingest/sms") return json({ error: "not found" }, 404);
  if (!env.INGEST_KEY) return json({ error: "INGEST_KEY not configured" }, 503);
  if (!keyOk(req.headers.get("X-Ryuk-Key"), env.INGEST_KEY)) return json({ error: "unauthorized" }, 401);

  // ---- read body (max 4 KB) ----
  const rawBody = (await req.text()).slice(0, 4096);
  let text = rawBody, at: string | undefined;
  if ((req.headers.get("content-type") || "").includes("json")) {
    try { const b = JSON.parse(rawBody); text = String(b.text ?? ""); at = b.at ? String(b.at) : undefined; }
    catch { return json({ error: "invalid json" }, 400); }
  }
  text = text.trim();
  if (!text) return json({ error: "empty text" }, 400);
  const receivedAt = at && !Number.isNaN(Date.parse(at)) ? new Date(at) : new Date();
  const receivedIso = receivedAt.toISOString();

  // ---- the same SMS forwarded twice is stored once ----
  const hash = await sha256(text.replace(/\s+/g, " "));
  if (await env.DB.prepare(`SELECT 1 FROM sms_inbox WHERE text_hash = ?`).bind(hash).first()) return json({ status: "duplicate", reason: "same_sms" });

  const logSms = (result: string, reason: string | null) =>
    env.DB.prepare(`INSERT INTO sms_inbox (received_at, text, text_hash, result, reason) VALUES (?,?,?,?,?) RETURNING id`)
      .bind(receivedIso, redact(text), hash, result, reason).first<{ id: number }>();

  // ---- parse ----
  const parsed = parseSms(text, receivedAt);
  if (!parsed.ok) { await logSms("ignored", parsed.reason); return json({ status: "ignored", reason: parsed.reason }); }
  const t = parsed.txn;

  // ---- your rules (learned from corrections in the dashboard) ----
  const keys = [t.counterparty_key, normKey(t.vpa), t.vpa].filter(Boolean) as string[];
  let rule: Rule | null = null;
  for (const k of keys) { rule = await env.DB.prepare(`SELECT display_name, category, kind, ignore FROM merchant_rules WHERE match_key = ?`).bind(k).first<Rule>(); if (rule) break; }
  if (rule?.ignore) { await logSms("ignored", "rule"); return json({ status: "ignored", reason: "rule" }); }
  const counterparty = rule?.display_name || t.counterparty;
  const category = rule?.category || t.category;
  const kind = rule?.kind || t.kind;

  // ---- duplicates: same reference = same transaction; same amount+account within 3 min without refs = maybe ----
  const flags: string[] = [];
  if (t.txn_ref) {
    const dup = await env.DB.prepare(`SELECT id FROM transactions WHERE txn_ref = ? AND direction = ? AND amount = ?`).bind(t.txn_ref, t.direction, t.amount).first();
    if (dup) { await logSms("duplicate", "same_ref"); return json({ status: "duplicate", reason: "same_ref" }); }
  }
  const lo = new Date(Date.parse(t.txn_at) - 180e3).toISOString(), hi = new Date(Date.parse(t.txn_at) + 180e3).toISOString();
  const near = await env.DB.prepare(
    `SELECT id, txn_ref FROM transactions WHERE amount = ? AND direction = ? AND txn_at BETWEEN ? AND ?
       AND (COALESCE(account_last4,'') = COALESCE(?,'') OR COALESCE(card_last4,'') = COALESCE(?,''))`,
  ).bind(t.amount, t.direction, lo, hi, t.account_last4, t.card_last4).first<{ id: number; txn_ref: string | null }>();
  if (near && !(near.txn_ref && t.txn_ref && near.txn_ref !== t.txn_ref)) flags.push("possible_duplicate");

  // ---- flags ----
  const large = Number(env.LARGE_TXN_INR || 5000);
  if (t.amount >= large && t.kind !== "card_payment" && t.kind !== "transfer") flags.push("large");
  if (t.counterparty_key) {
    const seen = await env.DB.prepare(`SELECT 1 FROM transactions WHERE counterparty_key = ? LIMIT 1`).bind(t.counterparty_key).first();
    if (!seen && t.direction === "debit") flags.push("new_merchant");
  }
  if (t.international) flags.push("international");
  if (kind === "cash_withdrawal") flags.push("atm");
  if (istHour(t.txn_at) < 5) flags.push("late_night");
  if (t.confidence < 0.6) flags.push("low_confidence");
  if (!category) flags.push("uncategorised");
  const reviewFlags = ["large", "new_merchant", "international", "possible_duplicate", "low_confidence"];
  const status = rule ? "auto" : flags.some((f) => reviewFlags.includes(f)) ? "needs_review" : "auto";

  // ---- store ----
  const sms = await logSms("recorded", null);
  try {
    await env.DB.prepare(
      `INSERT INTO transactions (sms_id, txn_at, received_at, amount, currency, direction, kind, channel, bank, account_last4, card_last4,
        txn_ref, counterparty, counterparty_key, vpa, purpose, category, flags, confidence, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(sms!.id, t.txn_at, receivedIso, t.amount, t.currency, t.direction, kind, t.channel, t.bank, t.account_last4, t.card_last4,
      t.txn_ref, counterparty, t.counterparty_key, t.vpa, t.purpose, category, flags.join(",") || null, t.confidence, status).run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) { await env.DB.prepare(`UPDATE sms_inbox SET result='duplicate', reason='same_ref' WHERE id=?`).bind(sms!.id).run(); return json({ status: "duplicate", reason: "same_ref" }); }
    throw e;
  }

  // ---- optional detail-free alert ----
  if ((env.FINANCE_ALERTS ?? "1") === "1" && env.TELEGRAM_TOKEN && env.OWNER_CHAT_ID && flags.some((f) => ["large", "international", "possible_duplicate"].includes(f))) {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.OWNER_CHAT_ID, text: "🔔 A flagged transaction was recorded. Check Coin in the dashboard." }),
    }).catch(() => {});
  }

  return json({ status: "recorded", txn: { amount: t.amount, direction: t.direction, kind, counterparty, category, flags, status } });
}
