/**
 * Device-to-Worker ingest helpers, and the finance endpoint.
 *
 * POST /ingest/finance  (also /ingest and /ingest/sms) — the iPhone Shortcut forwards a bank SMS.
 * Auth: "Authorization: Bearer <INGEST_KEY>" (X-Ryuk-Key also accepted).
 * Body: {"text": "<sms>", "at": "<optional ISO time>"} or the raw SMS as text/plain.
 *
 * Every request on these paths is treated as a bank SMS, whatever "source" says, so an SMS can
 * never end up on the Gemini path by mistake. Unparsed SMS are dropped, not sent anywhere.
 * Only the parsed fields are stored; the SMS text is not. Nothing financial is logged.
 * Authenticated, valid requests always get 200 {ok, status} so the Shortcut never shows an error.
 */
import { parseBankSMS } from "./finance";

export interface IngestEnv {
  DB: D1Database;
  INGEST_KEY?: string;          // secret
  TELEGRAM_TOKEN?: string;
  OWNER_CHAT_ID?: string;
  FINANCE_ALERTS?: string;      // var: "0" turns off the detail-free Telegram ping
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function keyOk(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  // constant-time compare
  return (crypto.subtle as any).timingSafeEqual ? (crypto.subtle as any).timingSafeEqual(a, b) : a.every((x, i) => x === b[i]);
}

/** "Authorization: Bearer <key>", or the older "X-Ryuk-Key: <key>". */
export function authOk(req: Request, expected: string | undefined): boolean {
  const bearer = (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
  return keyOk(bearer, expected) || keyOk(req.headers.get("X-Ryuk-Key"), expected);
}

export const istDateTime = (ms: number) => {
  const s = new Date(ms + 19800e3).toISOString();
  return { date: s.slice(0, 10), time: s.slice(11, 16) };
};

// keyed hash: the same SMS sent twice is stored once, and the hash can't be reversed without the secret
async function smsHash(text: string, key: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(text.replace(/\s+/g, " ").trim()));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handleFinance(req: Request, env: IngestEnv): Promise<Response> {
  if (req.method !== "POST") return json({ error: "not found" }, 404);
  if (!env.INGEST_KEY) return json({ error: "INGEST_KEY not configured" }, 503);
  if (!authOk(req, env.INGEST_KEY)) return json({ error: "unauthorized" }, 401);

  const raw = (await req.text()).slice(0, 4096);
  let text = raw, at: string | undefined;
  if ((req.headers.get("content-type") || "").includes("json")) {
    try { const b = JSON.parse(raw); text = String(b?.text ?? ""); at = b?.at ? String(b.at) : undefined; }
    catch { return json({ error: "invalid json" }, 400); }
  }
  text = text.trim();
  if (!text) return json({ error: "empty text" }, 400);

  const parsed = parseBankSMS(text);
  if (!parsed) return json({ ok: true, status: "ignored" });

  const hash = await smsHash(text, env.INGEST_KEY);
  if (await env.DB.prepare(`SELECT 1 FROM finance_log WHERE sms_hash = ?`).bind(hash).first()) return json({ ok: true, status: "duplicate" });

  const atMs = at && !Number.isNaN(Date.parse(at)) ? Date.parse(at) : Date.now();
  const { date, time } = istDateTime(atMs);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO finance_log (date, time, type, amount, account_last4, merchant, balance, channel, raw_direction, date_in_sms, source, sms_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?, 'sms', ?)`,
  ).bind(date, time, parsed.type, parsed.amount, parsed.account_last4, parsed.merchant || null, parsed.balance,
    parsed.channel, parsed.raw_direction, parsed.date_in_sms, hash).run();

  // no amount, merchant or account in the ping
  if (env.FINANCE_ALERTS !== "0" && env.TELEGRAM_TOKEN && env.OWNER_CHAT_ID) {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.OWNER_CHAT_ID, text: "💰 Finance entry logged" }),
    }).catch(() => {});
  }
  return json({ ok: true, status: "recorded", type: parsed.type, amount: parsed.amount, merchant: parsed.merchant });
}
