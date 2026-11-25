import { parseSms, redact } from "../.wrangler/sms-test.mjs";
const now = new Date("2025-11-25T09:00:00Z"); // 14:30 IST
const cases = [
 ["ICICI UPI debit", "ICICI Bank Acct XX123 debited for Rs 110.00 on 22-Nov-25; ACME IN credited. UPI:433012345678. Call 18002662 for dispute. SMS BLOCK 103 to 9215676766",
  { amount:110, direction:"debit", kind:"spend", channel:"UPI", bank:"ICICI", account_last4:"x123", txn_ref:"433012345678", counterparty:"ACME IN" }],
 ["HDFC UPI sent", "Sent Rs.250.00 From HDFC Bank A/C *1234 To SWIGGY On 25/11/25 Ref 433098765432 Not You? Call 18002586161/SMS BLOCK UPI to 7308080808",
  { amount:250, direction:"debit", channel:"UPI", bank:"HDFC", account_last4:"1234", txn_ref:"433098765432", counterparty:"SWIGGY", category:"food" }],
 ["HDFC UPI received", "Received Rs.1500.00 in your HDFC Bank A/c *1234 from Rahul Sharma on 24/11/25 UPI Ref No 433011112222",
  { amount:1500, direction:"credit", kind:"income", bank:"HDFC", txn_ref:"433011112222", counterparty:"Rahul Sharma" }],
 ["SBI UPI no Rs", "Dear UPI user A/C X1234 debited by 120.0 on date 25Nov25 trf to ZOMATO Refno 433012399999. If not u? call 1800111109. -SBI",
  { amount:120, direction:"debit", bank:"SBI", txn_ref:"433012399999", counterparty:"ZOMATO", category:"food", account_last4:"1234" }],
 ["Kotak UPI vpa", "Sent Rs.500.00 from Kotak Bank AC X1234 to chaipoint@okaxis on 25-11-25.UPI Ref 433077778888. Not you, https://kotak.com/KBANKT/Fraud",
  { amount:500, direction:"debit", bank:"KOTAK", vpa:"chaipoint@okaxis", txn_ref:"433077778888", counterparty:"chaipoint@okaxis" }],
 ["Axis UPI P2M", "INR 1500.00 debited A/c no. XX1234 25-11-25, 14:22:10 UPI/P2M/433012345111/BLINKIT Not you? SMS BLOCKUPI Cust ID to 919951860002 Axis Bank",
  { amount:1500, direction:"debit", bank:"AXIS", txn_ref:"433012345111", counterparty:"BLINKIT", category:"groceries" }],
 ["HDFC card spend", "Rs.1,250.00 spent on HDFC Bank Card x5678 at AMAZON on 2025-11-25:14:22:10.Avl bal: Rs 45,000.00. Not you? Call 18002586161",
  { amount:1250, direction:"debit", kind:"spend", channel:"CARD", card_last4:"5678", counterparty:"AMAZON", category:"shopping" }],
 ["ICICI card spend", "INR 649.00 spent using ICICI Bank Card XX5678 on 25-Nov-25 on NETFLIX. Avl Limit: INR 1,20,000.00. If not you, call 1800 2662/SMS BLOCK 5678 to 9215676766",
  { amount:649, direction:"debit", card_last4:"5678", counterparty:"NETFLIX", category:"subscriptions" }],
 ["Salary NEFT", "Your A/c XX1234 is credited with INR 85,000.00 on 24-11-2025 by NEFT-ACME TECHNOLOGIES PVT LTD-SALARY NOV. Avl Bal INR 1,02,345.00",
  { amount:85000, direction:"credit", kind:"income", channel:"NEFT", counterparty:"ACME TECHNOLOGIES PVT LTD", category:"salary" }],
 ["ATM", "Rs.2000 withdrawn at ATM SBI MG ROAD from A/c XX1234 on 24-11-25. Avl bal Rs 10,500. Not you? call 1800",
  { amount:2000, direction:"debit", kind:"cash_withdrawal", channel:"ATM", category:"cash" }],
 ["NACH investment", "Rs 1,999.00 debited from A/c XX1234 towards NACH/ZERODHA BROKING on 05-11-25. Avl Bal Rs 20,000",
  { amount:1999, direction:"debit", kind:"investment", channel:"NACH", category:"investing" }],
 ["Card refund", "Refund of Rs.349.00 from AMAZON has been credited to your HDFC Bank Card x5678 on 24-11-25",
  { amount:349, direction:"credit", kind:"refund", card_last4:"5678", category:"refund" }],
 ["CRED card bill", "Payment of Rs 12,500.00 received on your ICICI Bank Credit Card XX5678 on 20-Nov-25. Thank you.",
  { amount:12500, direction:"credit", kind:"card_payment", category:"transfer" }],
 ["IMPS out", "Rs 3,000.00 debited from your A/c XX1234 on 23-11-25 via IMPS/P2A/433055556666/RAHUL. Avl bal Rs 7,000",
  { amount:3000, direction:"debit", channel:"IMPS", txn_ref:"433055556666", counterparty:"RAHUL" }],
 ["Cashback credit", "Cashback of Rs 25.00 credited to your A/c XX1234 for UPI txn. Ref 433012340000",
  { amount:25, direction:"credit", category:"cashback" }],
 ["International", "USD 20.00 spent on HDFC Bank Card x5678 at OPENAI *CHATGPT on 2025-11-20:03:12:10 (Intl txn). Avl lmt Rs 80,000",
  { direction:"debit", international:true, category:"subscriptions" }],
 // ---- must be ignored ----
 ["OTP", "OTP 482913 for txn of Rs 2,500 at AMAZON on your HDFC Card x5678. Do not share. Valid 10 min.", { reject:"otp" }],
 ["Future debit", "Rs 1,200 will be debited on 05-Dec-25 from A/c XX1234 for your SIP in ABC Mutual Fund.", { reject:"reminder" }],
 ["Card bill due", "Your ICICI Credit Card XX5678 statement: Total Amount Due Rs 12,500, Minimum Amount Due Rs 625, due by 05-Dec-25.", { reject:"reminder" }],
 ["Collect request", "Rahul has requested money of Rs 500 from you on Google Pay. Approve on app.", { reject:"request" }],
 ["Declined", "Txn of Rs 999.00 on HDFC Bank Card x5678 at MYNTRA declined due to insufficient balance.", { reject:"declined" }],
 ["Advert", "Get Rs 100 cashback credited! Pre-approved offer, apply now on the app. T&C apply", { reject:"advert" }],
 ["Mandate setup", "Your UPI Autopay mandate for Netflix of Rs 649 has been registered successfully.", { reject:"mandate_setup" }],
];
let pass = 0, fail = 0;
for (const [name, sms, exp] of cases) {
  const r = parseSms(sms, now);
  const errs = [];
  if (exp.reject) { if (r.ok || r.reason !== exp.reject) errs.push(`expected reject ${exp.reject}, got ${r.ok ? "ok" : r.reason}`); }
  else if (!r.ok) errs.push(`rejected: ${r.reason}`);
  else for (const [k, v] of Object.entries(exp)) if (r.txn[k] !== v) errs.push(`${k}: got ${JSON.stringify(r.txn[k])}, want ${JSON.stringify(v)}`);
  if (errs.length) { fail++; console.log("FAIL", name, "|", errs.join("; ")); } else pass++;
}
console.log(`\n${pass} passed, ${fail} failed`);
console.log("redact:", redact("Card 4111111111111234 used. See https://bank.com/x Ref 433012345678"));
const s = parseSms(cases[1][1], now); console.log("sample:", JSON.stringify(s.ok && s.txn));
