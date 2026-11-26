/**
 * Bank SMS parser: pure regex, no network. Financial SMS never reach Gemini or any third party.
 * Indian bank SMS follow TRAI DLT templates, so three things identify a transaction:
 * an amount, a direction verb and an account/card tail. If any is missing the SMS is not treated
 * as a transaction (it is dropped, not sent anywhere else).
 */

export interface ParsedTransaction {
  type: "debit" | "credit" | "refund";
  amount: number;
  currency: string;           // always "INR" (Rs, Rs., ₹ and INR all mean the same)
  account_last4: string;      // last 4 digits only, never more
  merchant: string;           // payee / payer as written, "" when the SMS doesn't name one
  balance: number | null;
  channel: "bank" | "upi" | "card" | "auto_debit";
  date_in_sms: string | null; // as written, e.g. "14-MAY" or "25/11/26"
  raw_direction: string;      // the verb found, e.g. "debited"
}

// word-bounded so "shopping" or "pincode" do not count as "PIN"
const BLACKLIST = /\b(OTP|PIN|password|CVV|expiry|verification|passcode|activate|one.?time)\b/i;
const AMOUNT = /(INR|Rs\.?|₹)\s?([\d,]+(?:\.\d{1,2})?)/gi;
// "spent" / "used" / "purchase" cover card SMS; "credit card" is a product name, not a credit
const DIRECTION = /\b(auto[- ]?debit(?:ed)?|debit(?:ed)?|credit(?:ed)?(?!\s*card)|paid|received|reversed|withdrawn|sent|refund(?:ed)?|spent|used|purchase[d]?)/i;
const ACCOUNT = /(?:a\/c|acct?|account|card|xx|x{2,}|\*{2,})\s*[*xX]*(\d{4,6})/i;
const BALANCE = /(?:(?:avl?|available|avail)\.?\s*)?bal(?:ance)?[:\s.]*(?:INR|Rs\.?|₹)\s?([\d,]+(?:\.\d{1,2})?)/i;
const DATE_NUM = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/;
const DATE_MON = /(\d{1,2})[\/\-](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?:[\/\-]?(\d{2,4}))?/i;

const MERCHANT_START = /\b(at|to|towards|from|by)\s+/gi;
const MERCHANT_STOP = /\s*(?:\bavl\b|\bavail|\bbal\b|\bbalance\b|\bupi\s*ref|\bref\b|\bon\s|\bvia\s|\bfor\s|\bdated?\b|\bif\s|\.\s|\n|$)/i;

const toAmount = (s: string) => Number(s.replace(/,/g, ""));

function direction(verb: string): ParsedTransaction["type"] {
  const v = verb.toLowerCase();
  if (/revers|refund/.test(v)) return "refund";
  if (/credit|received/.test(v)) return "credit";
  return "debit";
}

function channel(text: string): ParsedTransaction["channel"] {
  if (/\bUPI\b/i.test(text) || /[\w.\-]+@[a-z]{2,}/i.test(text)) return "upi";
  if (/\bcard\b/i.test(text)) return "card";
  if (/auto[- ]?debit|\bEMI\b|\bSIP\b/i.test(text)) return "auto_debit";
  return "bank";
}

/** The first amount that is not a balance ("Avl bal Rs.12,540" is not what was spent). */
function firstAmount(text: string): number | null {
  for (const m of text.matchAll(AMOUNT)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 24), m.index);
    if (/bal(?:ance)?[:\s.]*$/i.test(before)) continue;
    const n = toAmount(m[2]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** The text after "at / to / towards / from / by", up to the next known token; skips "from a/c **1234" and "by Rs.500". */
function merchant(text: string): string {
  for (const m of text.matchAll(MERCHANT_START)) {
    const rest = text.slice((m.index ?? 0) + m[0].length);
    if (/^(?:a\/c|acct?\b|account|your\b|card\b|xx|\*{2}|INR|Rs\.?|₹|\d)/i.test(rest)) continue;
    const stop = rest.search(MERCHANT_STOP);
    const name = (stop >= 0 ? rest.slice(0, stop) : rest)
      .replace(/\d{6,}/g, "")              // long digit runs could be account numbers: never kept
      .replace(/[\s.,;:\-]+$/, "")
      .trim()
      .slice(0, 50);
    if (name) return name;
  }
  return "";
}

export function parseBankSMS(text: string): ParsedTransaction | null {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!t || BLACKLIST.test(t)) return null;
  const amount = firstAmount(t);
  const verb = t.match(DIRECTION);
  const acct = t.match(ACCOUNT);
  if (amount == null || !verb || !acct) return null;

  const bal = t.match(BALANCE);
  const date = t.match(DATE_NUM) ?? t.match(DATE_MON);
  return {
    type: direction(verb[1]),
    amount,
    currency: "INR",
    account_last4: acct[1].slice(-4),
    merchant: merchant(t),
    balance: bal ? toAmount(bal[1]) : null,
    channel: channel(t),
    date_in_sms: date ? date[0] : null,
    raw_direction: verb[1].toLowerCase(),
  };
}
