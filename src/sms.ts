/**
 * Deterministic parser for Indian bank / card transaction SMS. No AI: financial text never leaves the Worker.
 * parseSms(text, receivedAt) -> { ok: false, reason } for OTPs, adverts, reminders, declines
 *                            -> { ok: true, txn } with everything that could be extracted.
 */

export type Direction = "debit" | "credit";
export type Kind = "spend" | "income" | "refund" | "transfer" | "card_payment" | "cash_withdrawal" | "investment" | "failed";

export type ParsedTxn = {
  amount: number;
  currency: string;
  direction: Direction;
  kind: Kind;
  channel: string;
  bank: string | null;
  account_last4: string | null;
  card_last4: string | null;
  txn_ref: string | null;
  counterparty: string | null;
  counterparty_key: string | null;
  vpa: string | null;
  purpose: string | null;
  category: string | null;
  txn_at: string;            // UTC ISO
  international: boolean;
  confidence: number;
};

export type ParseResult = { ok: true; txn: ParsedTxn } | { ok: false; reason: string };

// ---------- helpers ----------
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const num = (s: string) => Number(s.replace(/,/g, ""));
export const normKey = (s: string | null | undefined) =>
  s ? s.toLowerCase().replace(/@.*$/, "").replace(/[^a-z0-9]+/g, " ").replace(/\b(pvt|ltd|private|limited|india|in|llp|technologies|tech|services)\b/g, "").replace(/\s+/g, " ").trim() || null : null;

// Remove long digit runs (possible full card / account / phone numbers) and links before anything is stored.
// 12-digit UPI/RRN references are kept separately in txn_ref, so they are not needed in the stored text.
export function redact(text: string): string {
  return text
    .replace(/https?:\/\/\S+|\b(?:bit\.ly|t\.co|tinyurl\.com)\/\S+/gi, "[link]")
    .replace(/\b\d{9,19}\b/g, (m) => "#".repeat(m.length - 4) + m.slice(-4));
}

// ---------- 1. is this a real, completed transaction? ----------
const REJECT: [RegExp, string][] = [
  [/\b(otp|one[\s-]?time[\s-]?password|verification code|passcode)\b/i, "otp"],
  [/\bwill be (debited|credited|deducted|charged)\b|\bis due\b|\bdue (on|date|by)\b|\bscheduled (for|on)\b|\bupcoming\b|\breminder\b|\bminimum amount due\b|\btotal (amount )?due\b/i, "reminder"],
  [/\b(has )?requested (money|rs|inr|₹)|\bcollect request\b|\bpayment request\b|\brequesting\b/i, "request"],
  [/\b(declined|unsuccessful|could not be processed|insufficient (funds|balance)|has failed|txn failed|transaction failed)\b/i, "declined"],
  [/\b(mandate|e-?mandate|autopay|standing instruction)\b.{0,40}\b(created|registered|set ?up|activated|modified|revoked|cancelled)\b/i, "mandate_setup"],
  [/\b(pre-?approved|apply now|loan (of|upto|up to)|eligible for|offer|win|upto rs|up to rs|limited period|t&c apply|click here|download the app|exclusive)\b/i, "advert"],
];
const TXN_VERB = /\b(debited|credited|spent|withdrawn|paid|received|sent|transferred|deducted|deposited|purchase|txn|transaction|refund(ed)?|reversed)\b/i;

// ---------- 2. amount ----------
function findAmount(t: string): number | null {
  const re = /(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d{1,2})?)|(?:debited|credited|withdrawn)\s+(?:by|for|with|of)\s+(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)/gi;
  for (const m of t.matchAll(re)) {
    const before = t.slice(Math.max(0, m.index! - 24), m.index!);
    if (/(bal(ance)?|limit|avl|available|outstanding|due)\W*(is|:|of)?\W*$/i.test(before)) continue; // skip balances / limits
    const v = num(m[1] ?? m[2]);
    if (v > 0 && v < 1e9) return v;
  }
  return null;
}

// ---------- 3. direction ----------
const DEBIT = /\b(debited|spent|withdrawn|paid|sent|deducted|charged|purchase|transferred to|dr\b)/i;
const CREDIT = /\b(credited|received|deposited|refund(ed)?|reversed|cr\b)/i;
function findDirection(t: string): Direction | null {
  // Prefer the verb attached to YOUR account / card ("Acct XX123 debited ...; ACME credited" is a debit).
  const own = t.match(/(?:a\/c|acct|account|\bac\b|card)[^.;]{0,40}?\b(debited|credited|spent)\b/i);
  if (own) return /credited/i.test(own[1]) ? "credit" : "debit";
  const own2 = t.match(/\b(debited|credited)\b[^.;]{0,30}?(?:from|to|in)\s+(?:your\s+)?(?:a\/c|acct|account|card)/i);
  if (own2) return /credited/i.test(own2[1]) ? "credit" : "debit";
  if (/^\s*(sent|paid)\b/i.test(t)) return "debit";
  if (/^\s*received\b/i.test(t)) return "credit";
  const d = t.search(DEBIT), c = t.search(CREDIT);
  if (d < 0 && c < 0) return null;
  if (d < 0) return "credit";
  if (c < 0) return "debit";
  return d < c ? "debit" : "credit";
}

// ---------- 4. identifiers ----------
const BANKS: [RegExp, string][] = [
  [/\bhdfc\b/i, "HDFC"], [/\bicici\b/i, "ICICI"], [/\bsbi\b|state bank/i, "SBI"], [/\baxis\b/i, "AXIS"],
  [/\bkotak\b/i, "KOTAK"], [/\byes ?bank\b/i, "YES"], [/\bidfc\b/i, "IDFC FIRST"], [/\bindusind\b/i, "INDUSIND"],
  [/\bpnb\b|punjab national/i, "PNB"], [/\bbob\b|bank of baroda/i, "BOB"], [/\bcanara\b/i, "CANARA"],
  [/\bunion bank\b/i, "UNION"], [/\bau (small finance )?bank\b/i, "AU"], [/\bfederal\b/i, "FEDERAL"],
  [/\bamex\b|american express/i, "AMEX"], [/\bsbi ?card\b/i, "SBI CARD"], [/\bonecard\b/i, "ONECARD"],
  [/\bpaytm payments bank\b|\bppbl\b/i, "PAYTM PB"], [/\bjupiter\b/i, "JUPITER"], [/\bfi\b money|\bfederal\b/i, "FEDERAL"],
];
function findBank(t: string) { for (const [re, n] of BANKS) if (re.test(t)) return n; return null; }

function findLast4(t: string, kind: "account" | "card"): string | null {
  const re = kind === "card"
    ? /\b(?:credit |debit )?card\b(?:\s*(?:no\.?|number|ending(?: with| in)?))?\s*[:.]?\s*[x*#]*\s*(\d{4})\b/i
    : /\b(?:a\/c|acct|account|\bac)\b(?:\s*(?:no\.?|number|ending(?: with| in)?))?\s*[:.]?\s*[x*#]*\s*\d*?(\d{3,4})\b/i;
  const m = t.match(re);
  return m ? m[1].padStart(4, "x").slice(-4) : null;
}

function findRef(t: string): string | null {
  const pats = [
    /\b(?:upi|imps|neft|rtgs)\/(?:p2[mapb]\/|cr\/|dr\/)?(\d{9,16})\b/i,                                   // UPI/P2M/433012345678/...
    /\b(?:upi\s*ref(?:erence)?(?:\s*no\.?)?|ref(?:erence)?\s*(?:no\.?|number|#|id)?|refno|rrn|utr(?:\s*no\.?)?|txn\s*(?:id|no\.?|ref)|transaction\s*(?:id|ref(?:erence)?|no\.?)|imps\s*ref(?:\s*no\.?)?)\s*[:.\-#]?\s*([A-Z0-9]{6,22})\b/i,
    /\bupi\s*[:\-]\s*(\d{9,16})\b/i,                                                                         // UPI:1234567890
  ];
  for (const p of pats) { const m = t.match(p); if (m && /\d/.test(m[1])) return m[1].toUpperCase(); }
  return null;
}

function findChannel(t: string): string {
  if (/\bupi\b|\bvpa\b|@[a-z]{2,}\b|\bp2[mp]\b/i.test(t)) return "UPI";
  if (/\batm\b|cash withdraw/i.test(t)) return "ATM";
  if (/\bnach\b|\becs\b|auto ?pay|standing instruction|\bsi\b/i.test(t)) return "NACH";
  if (/\bneft\b/i.test(t)) return "NEFT";
  if (/\bimps\b/i.test(t)) return "IMPS";
  if (/\brtgs\b/i.test(t)) return "RTGS";
  if (/\bcheque\b|\bchq\b|\bclg\b/i.test(t)) return "CHEQUE";
  if (/\bcard\b|\bpos\b|\becom\b/i.test(t)) return "CARD";
  if (/\bwallet\b/i.test(t)) return "WALLET";
  return "OTHER";
}

const VPA_RE = /\b([a-z0-9][a-z0-9._-]{1,48}@[a-z]{2,20})\b/i;

const STOP = String.raw`(?=\s+(?:on|ref|refno|upi|via|at|avl|avbl|bal|txn|using|from|dated|w\.e\.f)\b|\s*[.;,(]|\s+-|\s+not\b|\s*$)`;
const NAME = String.raw`([A-Za-z0-9][A-Za-z0-9 .&@*_'/-]{1,48}?)`;
function findCounterparty(t: string, dir: Direction): string | null {
  const tries: RegExp[] = [
    new RegExp(String.raw`\b(?:upi|imps|neft|rtgs)\/(?:p2[mapb]|cr|dr)\/\d+\/([^/.;]+?)(?:\/|\.|;|\s+not\b|\s*$)`, "i"),   // Axis/IMPS style
    new RegExp(String.raw`\bby\s+(?:neft|imps|rtgs)[-/ ]+([^-/]{2,48}?)(?:[-/]|\s+on\b|\.|$)`, "i"),                // by NEFT-ACME PVT LTD-SALARY
    new RegExp(String.raw`;\s*${NAME}\s+credited\b`, "i"),                                                          // ICICI: "; ACME IN credited"
    new RegExp(String.raw`\btrf to\s+${NAME}${STOP}`, "i"),                                                         // SBI
    new RegExp(String.raw`\btowards\s+${NAME}${STOP}`, "i"),                                                        // NACH/ZERODHA
    ...(dir === "debit"
      ? [new RegExp(String.raw`\b(?:to|paid to|sent to)\s+(?!your\b|a\/c\b|acct\b)${NAME}${STOP}`, "i"),
         new RegExp(String.raw`\bat\s+(?!atm\b)${NAME}${STOP}`, "i"),
         new RegExp(String.raw`\bon\s+([A-Z][A-Z0-9 .&*_'-]{2,30}?)(?=\s*[.;]|\s+avl|\s*$)`)]                    // ICICI card: "on NETFLIX."
      : [new RegExp(String.raw`\b(?:from|by)\s+(?!your\b|a\/c\b|acct\b|.{0,12}\bbank a\/c)${NAME}${STOP}`, "i"),
         new RegExp(String.raw`\bof rs\.?\s*[\d,.]+\s+from\s+${NAME}${STOP}`, "i")]),
  ];
  for (const re of tries) {
    const m = t.match(re);
    if (!m) continue;
    let v = clean(m[1]).replace(/^(mr|ms|mrs|m\/s)\.?\s+/i, "").replace(/\s+(on|ref|upi)$/i, "");
    if (/^(your|a\/c|acct|account|the|rs|inr|bank|card)\b/i.test(v) || /^\d+$/.test(v) || v.length < 2) continue;
    if (/\b(a\/c|acct|account)\b.*\d/i.test(v)) continue;
    return v.slice(0, 60);
  }
  return null;
}

function findPurpose(t: string): string | null {
  const m = t.match(/\b(?:info|remarks?|purpose|narration|note|msg)\s*[:\-]\s*([^.;]{2,60})/i)
    ?? t.match(/\bby\s+(?:neft|imps|rtgs)[-/ ][^-/]+[-/]([^.;/]{2,40})/i);
  if (m) return clean(m[1]);
  if (/\bsalary\b|\bsal\b/i.test(t)) return "salary";
  if (/\bnach\b|auto ?pay|\becs\b|standing instruction/i.test(t)) return "autopay";
  if (/\brefund\b/i.test(t)) return "refund";
  if (/\bcashback\b/i.test(t)) return "cashback";
  if (/\binterest\b/i.test(t)) return "interest";
  return null;
}

// ---------- 5. dates (SMS times are IST) ----------
const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function findDate(t: string, receivedAt: Date): string {
  const y4 = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  let d: number | null = null, mo: number | null = null, y: number | null = null;
  let m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  if (!m && (m = t.match(/\b(\d{1,2})[-/ ]?([A-Za-z]{3})[a-z]*[-/ ,]?\s?(\d{2,4})\b/))) { d = +m[1]; mo = MON[m[2].toLowerCase()] ?? null; y = y4(m[3]); }
  if (!mo && (m = t.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/))) { d = +m[1]; mo = +m[2]; y = y4(m[3]); }
  const tm = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b/);
  if (d && mo && y && mo <= 12 && d <= 31) {
    const hh = tm ? tm[1].padStart(2, "0") : "12", mm = tm ? tm[2] : "00", ss = tm?.[3] ?? "00";
    const when = Date.parse(`${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${hh}:${mm}:${ss}+05:30`);
    // trust the SMS date only if it is plausible: not in the future, not older than 45 days
    if (!isNaN(when) && when <= receivedAt.getTime() + 36e5 && when >= receivedAt.getTime() - 45 * 864e5) {
      // without a time in the SMS, keep the received time if it is the same IST day
      if (!tm && new Date(when).toISOString().slice(0, 10) === new Date(receivedAt.getTime() + 19800e3).toISOString().slice(0, 10)) return receivedAt.toISOString();
      return new Date(when).toISOString();
    }
  }
  return receivedAt.toISOString();
}

// ---------- 6. kind + category ----------
function findKind(t: string, dir: Direction, channel: string, cp: string | null): Kind {
  if (/\breversed\b|\breversal\b|\bcredited back\b|\brefund/i.test(t) && dir === "credit") return "refund";
  if (channel === "ATM" || /\bwithdrawn\b.*\batm\b|\batm\b.*\bwithdrawn\b|cash withdraw/i.test(t)) return "cash_withdrawal";
  if (/\b(payment|paymt|pymt)\b.{0,40}\b(received|credited|successful)\b.{0,40}\bcard\b|\bcard\b.{0,40}\bpayment\b.{0,30}\b(received|credited)\b|\btowards\b.{0,25}\bcredit card\b|\bcred\s*club\b|\bcredit card (bill|payment)\b/i.test(t)) return "card_payment";
  if (/\bself\b|\bown (a\/c|account)\b|\bbetween your accounts\b/i.test(t)) return "transfer";
  if (dir === "debit" && /\b(zerodha|groww|upstox|kuvera|coin|mutual fund|\bmf\b|\bsip\b|indmoney|smallcase|ppf|nps)\b/i.test(`${t} ${cp ?? ""}`)) return "investment";
  return dir === "credit" ? "income" : "spend";
}

const CATEGORIES: [RegExp, string][] = [
  [/swiggy|zomato|eatsure|domino|pizza|mcdonald|kfc|burger|starbucks|cafe|coffee|chai|restaurant|dhaba|food|biryani|bakery|haldiram/i, "food"],
  [/blinkit|zepto|instamart|bigbasket|\bbb\b|dmart|grofers|jiomart|more retail|reliance fresh|nature'?s basket|grocery|kirana|milk|dairy|country delight|licious|freshtohome/i, "groceries"],
  [/uber|\bola\b|rapido|namma yatri|metro|irctc|railway|redbus|makemytrip|goibibo|cleartrip|indigo|air india|vistara|akasa|spicejet|airline|fastag|toll|petrol|fuel|\bhp\b|bpcl|iocl|indian oil|shell|parking/i, "travel"],
  [/amazon|flipkart|myntra|ajio|meesho|nykaa|tata ?cliq|croma|reliance digital|decathlon|ikea|lifestyle|shoppers stop|westside|h&m|zara|uniqlo/i, "shopping"],
  [/netflix|spotify|prime video|hotstar|disney|youtube|apple\.com|itunes|google ?(play|one|storage)|sony ?liv|zee5|jiocinema|audible|kindle|chatgpt|openai|claude|anthropic|notion|github/i, "subscriptions"],
  [/airtel|jio|vodafone|\bvi\b|bsnl|act fibernet|hathway|broadband|recharge|electricity|bescom|tata power|adani electricity|msedcl|water bill|gas|indane|bharat gas|bbps|bill ?desk|billdesk/i, "bills"],
  [/\brent\b|nobroker|housing|landlord|maintenance|society|nestaway|stanza|zolo|pg\b/i, "rent"],
  [/zerodha|groww|upstox|kuvera|coin|mutual fund|\bmf\b|\bsip\b|indmoney|smallcase|ppf|nps|kotak securities|icici direct/i, "investing"],
  [/apollo|pharm|medplus|1mg|netmeds|pharmeasy|hospital|clinic|diagnostic|lab|doctor|practo|cult\.?fit|cultfit|gym|fitness|healthify/i, "health"],
  [/udemy|coursera|leetcode|educative|unacademy|byju|book|bookmyshow|pvr|inox|movie|steam|playstation|xbox/i, "learning_fun"],
  [/insurance|lic\b|policy|premium|hdfc ergo|icici lombard|star health|acko|digit/i, "insurance"],
  [/\bloan\b|\bemi\b|bajaj finserv|home credit|lazypay|simpl|slice/i, "emi_loans"],
];
export function categorise(kind: Kind, hay: string): string | null {
  if (kind === "cash_withdrawal") return "cash";
  if (kind === "card_payment" || kind === "transfer") return "transfer";
  if (kind === "refund") return "refund";
  if (kind === "income") return /salary|\bsal\b/i.test(hay) ? "salary" : /interest/i.test(hay) ? "interest" : /cashback/i.test(hay) ? "cashback" : "income";
  for (const [re, c] of CATEGORIES) if (re.test(hay)) return c;
  return null;
}

// ---------- main ----------
export function parseSms(raw: string, receivedAt: Date = new Date()): ParseResult {
  const t = clean(raw);
  if (t.length < 15) return { ok: false, reason: "too_short" };
  for (const [re, why] of REJECT) if (re.test(t)) {
    // a genuine cashback/refund credit can contain advert-ish words; let it through if it clearly credits your account
    if (why === "advert" && /\b(credited|debited)\b.{0,60}\b(a\/c|acct|account|card)\b|\b(a\/c|acct|account|card)\b.{0,60}\b(credited|debited)\b/i.test(t)) continue;
    return { ok: false, reason: why };
  }
  if (!TXN_VERB.test(t)) return { ok: false, reason: "no_transaction_verb" };
  const amount = findAmount(t);
  if (amount == null) return { ok: false, reason: "no_amount" };
  const direction = findDirection(t);
  if (!direction) return { ok: false, reason: "no_direction" };

  let channel = findChannel(t);
  const vpaM = t.match(VPA_RE);
  const vpa = vpaM ? vpaM[1].toLowerCase() : null;
  let counterparty = findCounterparty(t, direction);
  if (counterparty && vpa && counterparty.toLowerCase() === vpa) counterparty = vpa;           // "to swiggy@icici"
  if (!counterparty && vpa) counterparty = vpa;
  const kind = findKind(t, direction, channel, counterparty);
  const purpose = findPurpose(t);
  const txn_ref = findRef(t);
  if (channel === "OTHER" && txn_ref && /^\d{12}$/.test(txn_ref)) channel = "UPI";   // 12-digit RRN with no other channel named
  const card_last4 = channel === "CARD" || /\bcard\b/i.test(t) ? findLast4(t, "card") : null;
  const account_last4 = findLast4(t, "account");
  const counterparty_key = normKey(counterparty);
  const category = categorise(kind, `${counterparty ?? ""} ${vpa ?? ""} ${purpose ?? ""} ${t}`);
  const international = /\binternational\b|\bintl\b|\bforex\b|\b(usd|eur|gbp|aed|sgd)\b|outside india|cross[- ]border/i.test(t);

  let confidence = 1;
  if (!counterparty) confidence -= 0.35;
  if (!txn_ref && channel !== "CARD" && channel !== "ATM") confidence -= 0.15;
  if (!account_last4 && !card_last4) confidence -= 0.15;
  if (!findBank(t)) confidence -= 0.1;

  return {
    ok: true,
    txn: {
      amount, currency: "INR", direction, kind, channel, bank: findBank(t), account_last4, card_last4, txn_ref,
      counterparty, counterparty_key, vpa, purpose, category, txn_at: findDate(t, receivedAt), international,
      confidence: Math.max(0, Math.round(confidence * 100) / 100),
    },
  };
}
