/**
 * Money categories and investment classes, and the classifier that files a transaction under one.
 * Pure code, no I/O: used by the SMS ingest (bot) and the dashboard's Money view (rules, re-classify).
 * Nothing here ever leaves the Workers: no Gemini, no Telegram.
 */

export const CATEGORIES = {
  food: "Food & dining",
  groceries: "Groceries",
  transport: "Transport & fuel",
  travel: "Travel",
  shopping: "Shopping",
  bills: "Bills & recharges",
  subscriptions: "Subscriptions",
  rent: "Rent & home",
  health: "Health & fitness",
  insurance: "Insurance",
  emi: "Loans & EMI",
  education: "Education",
  entertainment: "Entertainment",
  personal: "Personal care",
  gifts: "Gifts & donations",
  fees: "Fees & charges",
  cash: "Cash withdrawal",
  other: "Other spend",
  investment: "Investment",
  transfer: "Self transfer / card bill",
  income: "Income",
  refund: "Refund",
} as const;
export type Category = keyof typeof CATEGORIES;

export const INVEST_CLASSES = {
  mutual_fund: "Mutual funds",
  stocks: "Stocks & ETFs",
  gold: "Gold",
  fd_rd: "FD / RD",
  retirement: "PPF / NPS / EPF",
  crypto: "Crypto",
  real_estate: "Real estate",
  other: "Other",
} as const;
export type InvestClass = keyof typeof INVEST_CLASSES;

/** Categories that are not spending: money moved, saved or received. */
export const NOT_SPEND: readonly string[] = ["investment", "transfer", "income", "refund"];

export const isCategory = (v: unknown): v is Category => typeof v === "string" && Object.hasOwn(CATEGORIES, v);
export const isInvestClass = (v: unknown): v is InvestClass => typeof v === "string" && Object.hasOwn(INVEST_CLASSES, v);

export type Rule = { pattern: string; category: string; invest_class: string | null };
export type Filed = { category: Category; invest_class: InvestClass | null; src: "rule" | "auto" };

// Investment platforms first: a debit to any of these is money saved, not spent.
const INVEST: [InvestClass, RegExp][] = [
  ["crypto", /COINDCX|WAZIRX|COINSWITCH|BINANCE|ZEBPAY|MUDREX|GIOTTUS/],
  ["gold", /DIGI ?GOLD|DIGITAL ?GOLD|SAFE ?GOLD|MMTC|AUGMONT|GOLD ?BOND|\bSGB\b|\bJAR\b|GOLD ?ETF|GOLD ?SIP/],
  ["retirement", /\bPPF\b|\bNPS\b|PROTEAN|NPS ?TRUST|\bEPF\b|\bVPF\b|PENSION ?FUND/],
  ["fd_rd", /FIXED ?DEPOSIT|RECURRING ?DEPOSIT|TERM ?DEPOSIT|\bFD\b|\bRD\b|\bTD ?BOOK/],
  ["stocks", /ZERODHA(?! ?COIN)|KITE|UPSTOX|ANGEL ?(ONE|BROKING)|\bDHAN\b|5 ?PAISA|ICICI ?DIRECT|ICICI ?SEC|HDFC ?SEC|KOTAK ?SEC|SHAREKHAN|FYERS|\bICCL\b|NSCCL|INDIAN ?CLEARING|NSE ?CLEARING|STOCK ?BROK|VESTED|INDSTOCKS/],
  ["mutual_fund", /MUTUAL ?FUND|\bMF\b|\bSIP\b|\bCAMS\b|KFIN|KARVY|BSE ?STAR|NSE ?MF|\bAMC\b|PPFAS|PARAG ?PARIKH|NIPPON|SBI ?MF|SBIMF|HDFC ?MF|HDFCMF|ICICI ?PRU|AXIS ?MF|KOTAK ?MF|MIRAE|UTI ?MF|\bDSP\b|QUANT ?MF|MOTILAL|NAVI ?MF|KUVERA|ZERODHA ?COIN|COIN ?BY ?ZERODHA|PAYTM ?MONEY|ET ?MONEY|INDMONEY|GROWW|SCRIPBOX/],
];

// Spending categories, most specific first (groceries before food so "SWIGGY INSTAMART" is groceries).
const SPEND: [Category, RegExp][] = [
  ["transfer", /\bSELF\b|OWN ?A\/?C|OWN ?ACCOUNT|\bCRED\b|CREDIT ?CARD|CC ?BILL|CC ?PAYMENT|CARD ?BILL|CARD ?PAYMENT/],
  ["cash", /\bATM\b|CASH ?WDL|CASH ?WITHDRAW|\bCWDR\b|\bNFS\b/],
  ["groceries", /BLINKIT|ZEPTO|BIG ?BASKET|\bBB ?NOW|INSTAMART|D ?MART|JIO ?MART|MORE ?RETAIL|RELIANCE ?(FRESH|SMART)|NATURES ?BASKET|SPENCER|GROCER|KIRANA|SUPERMARKET|FRESH ?TO ?HOME|LICIOUS|COUNTRY ?DELIGHT|MILK ?BASKET/],
  ["food", /SWIGGY|ZOMATO|DOMINO|PIZZA|MCDONALD|\bKFC\b|STARBUCKS|\bCAFE|COFFEE|RESTAURANT|EAT ?CLUB|BURGER|SUBWAY|CHAAYOS|BARBEQUE|HALDIRAM|BAKERY|DHABA|BIRYANI|EATSURE|THIRD ?WAVE|BLUE ?TOKAI/],
  ["travel", /IRCTC|MAKE ?MY ?TRIP|GOIBIBO|CLEARTRIP|YATRA|INDIGO|AIR ?INDIA|VISTARA|AKASA|SPICEJET|\bOYO\b|AIRBNB|BOOKING\.?COM|AGODA|RED ?BUS|IXIGO|ABHIBUS|ZOOMCAR/],
  ["transport", /\bUBER|\bOLA\b|OLA ?CABS|RAPIDO|NAMMA ?YATRI|BLU ?SMART|\bMETRO|FASTAG|PETROL|\bFUEL|HPCL|BPCL|IOCL|INDIAN ?OIL|HP ?PAY|\bSHELL\b|PARKING|YULU/],
  ["subscriptions", /NETFLIX|SPOTIFY|PRIME ?VIDEO|AMAZON ?PRIME|HOTSTAR|DISNEY|YOUTUBE|GOOGLE ?(PLAY|ONE|STORAGE)|APPLE\.?COM|APPLE ?SERVICES|ITUNES|ICLOUD|CHATGPT|OPENAI|ANTHROPIC|CLAUDE|GITHUB|NOTION|CLOUDFLARE|SONY ?LIV|ZEE5|JIO ?CINEMA|JIO ?HOTSTAR|AUDIBLE|KINDLE|MICROSOFT|ADOBE|CANVA/],
  ["shopping", /AMAZON|FLIPKART|MYNTRA|\bAJIO|MEESHO|NYKAA|TATA ?CLIQ|CROMA|RELIANCE ?DIGITAL|DECATHLON|IKEA|\bH ?& ?M\b|\bZARA\b|UNIQLO|LENSKART|PEPPERFRY|URBAN ?LADDER|SNAPDEAL|FIRSTCRY/],
  ["bills", /AIRTEL|\bJIO\b|VODAFONE|\bVI\b|BSNL|ELECTRICITY|BESCOM|MSEDCL|TATA ?POWER|ADANI ?(ELEC|GAS)|TORRENT ?POWER|\bBBPS|BROADBAND|FIBERNET|HATHWAY|INDANE|BHARAT ?GAS|HP ?GAS|PIPED ?GAS|WATER ?(BOARD|BILL)|RECHARGE|\bDTH\b|TATA ?PLAY/],
  ["rent", /\bRENT\b|NO ?BROKER|NESTAWAY|MAINTENANCE|SOCIETY|\bMYGATE/],
  ["insurance", /INSURANCE|\bLIC\b|POLICY ?BAZAAR|\bACKO\b|GO ?DIGIT|HDFC ?ERGO|ICICI ?LOMBARD|STAR ?HEALTH|MAX ?LIFE|TATA ?AIA|BAJAJ ?ALLIANZ|NIVA ?BUPA|CARE ?HEALTH/],
  ["emi", /\bEMI\b|\bLOAN\b|BAJAJ ?FIN|HOME ?CREDIT|\bNACH\b.*LOAN/],
  ["health", /PHARM|APOLLO|MEDPLUS|\b1 ?MG\b|NETMEDS|HOSPITAL|CLINIC|DIAGNOSTIC|PATHOLOG|\bLAB\b|PRACTO|CULT\.?FIT|CULTFIT|\bGYM\b|FITNESS|HEALTHIFY/],
  ["education", /UDEMY|COURSERA|BYJU|UNACADEMY|SCHOOL|COLLEGE|UNIVERSITY|TUITION|EDX|SCALER|LEETCODE|O'?REILLY/],
  ["entertainment", /BOOK ?MY ?SHOW|\bPVR\b|\bINOX\b|CINEPOLIS|DISTRICT|STEAM|PLAYSTATION|XBOX|NINTENDO|DREAM ?11/],
  ["personal", /SALON|\bSPA\b|URBAN ?COMPANY|URBAN ?CLAP|BARBER|PARLOU?R/],
  ["gifts", /DONATION|GIVE ?INDIA|CHARITY|TEMPLE|KETTO|MILAAP/],
  ["fees", /CHARGES?\b|\bFEES?\b|PENALTY|ANNUAL ?FEE|\bGST\b|LATE ?FEE/],
];

const INCOME = /SALARY|\bSAL\b|PAYROLL|STIPEND|INTEREST|\bINT\.? ?PD|DIVIDEND|\bDIV\b|CASHBACK|REWARD/;

const norm = (s: string | null | undefined) => String(s ?? "").toUpperCase().replace(/\s+/g, " ").trim();

/** The user's own rules: substring of the merchant, longest pattern wins. */
export function matchRule(merchant: string | null | undefined, rules: Rule[]): Rule | null {
  const m = norm(merchant);
  if (!m) return null;
  let best: Rule | null = null;
  for (const r of rules) {
    const p = norm(r.pattern);
    if (p && m.includes(p) && (!best || p.length > norm(best.pattern).length)) best = r;
  }
  return best;
}

/**
 * File one transaction. The user's rules win; then the built-in keyword lists.
 * Returns null when nothing matches (shown as "uncategorised"; a debit still counts as spend).
 */
export function classify(t: { merchant?: string | null; type: string; channel?: string | null }, rules: Rule[] = []): Filed | null {
  const rule = matchRule(t.merchant, rules);
  if (rule && isCategory(rule.category)) {
    const cls = rule.category === "investment" ? (isInvestClass(rule.invest_class) ? rule.invest_class : "other") : null;
    return { category: rule.category, invest_class: cls, src: "rule" };
  }
  const m = norm(t.merchant);
  if (t.type === "refund") return { category: "refund", invest_class: null, src: "auto" };
  for (const [cls, re] of INVEST) if (re.test(m)) return { category: "investment", invest_class: cls, src: "auto" };
  if (t.type === "credit") {
    if (INCOME.test(m)) return { category: "income", invest_class: null, src: "auto" };
    if (/\bSELF\b|OWN ?A\/?C|OWN ?ACCOUNT/.test(m)) return { category: "transfer", invest_class: null, src: "auto" };
    return null;
  }
  if (!m) return null;
  for (const [cat, re] of SPEND) if (re.test(m)) return { category: cat, invest_class: null, src: "auto" };
  return null;
}
