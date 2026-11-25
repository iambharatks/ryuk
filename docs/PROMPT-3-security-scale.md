# Prompt 3 — Encryption, storage size and scalability

Review and implement the following. Explain trade-offs to me before changing the schema.

## Encryption
Current: D1 and R2 encrypt at rest (AES-256, keys held by Cloudflare); everything is HTTPS; the dashboard sits behind
Access and re-verifies the JWT. That protects against stolen disks, not against someone with my Cloudflare account.
Add defence in depth:
1. **Field-level encryption** of free-text columns that are never filtered in SQL: `messages.text`, `notes.text`,
   `sms_inbox.text`, `tasks.text`, `library.note`, `*.detail`. AES-256-GCM via WebCrypto, random 96-bit IV per value,
   stored as `enc:v1:<base64(iv|ciphertext)>`, key from secret `DATA_KEY` (32 random bytes, base64). Version prefix so the
   key can be rotated (`v2`) with a background re-encrypt job. Keep structured numeric/date/category columns in plain text
   so charts and filters still work. Decrypt only inside the Workers; never send keys to the browser.
   Note the limit honestly in docs: a Worker that can decrypt means Cloudflare-side compromise of the Worker still exposes data.
2. **Backups encrypted with a public key** (age / X25519 or RSA-OAEP + AES-GCM): the Worker holds only the public key,
   the private key stays offline with me. Gzip *before* encrypting.
3. Uploaded files: keep them private (already only via the Access-protected Worker); optionally encrypt PDFs/images
   client-side before upload if I ask — it breaks in-browser preview, so not by default.
4. Secrets audit: list every secret, where it's used, how to rotate it; add a `SECURITY.md`.

## Compression (avoid waste, but measure first)
- Rows are tiny (~0.2–1 KB). At ~200 rows/day that is well under 100 MB/year; compressing rows would save little and break
  SQL filtering. **Don't compress table rows.** Instead:
  - Gzip backups (expect 5–10×).
  - Images: resize client-side to ≤ 2048 px and convert to WebP (quality ~0.82) before upload; keep the original only if I tick "keep original".
  - Videos: prefer links; for uploads warn above 95 MB (Worker request limit) and suggest a link.
  - Trim duplicated data: `summary` strings are derivable — keep them (they make the dashboard cheap), but cap lengths.
- Write `scripts/storage-report.sql`: rows and approximate bytes per table, R2 usage, growth per month.

## Scalability and limits (check current Cloudflare/Gemini limits in their docs before relying on numbers)
- Workers free plan has a small CPU-time limit per request: profile `/api/data` (JSON of up to 5,000 rows per table + JWT
  verify). Paginate / limit by date range, cache the Access certs (already cached 1 h), and move heavy aggregation into SQL.
- D1 free: per-database size cap and daily rows-read/rows-written caps. Add indexes for every query in `getData`/`getPage`,
  check with `EXPLAIN QUERY PLAN`, and keep the 365-day heatmap as one grouped query per table (UNION views hit D1 limits).
- Gemini free daily request caps: batching (gym mode, notes) already cuts calls; add a daily counter and switch to the
  fallback model before the cap, not after errors.
- Idempotency everywhere: Telegram redeliveries (unique `tg_message_id`), Shortcut retries (`sms_inbox.text_hash`,
  `batch_lines.line_key`, `health_daily` upsert by date).
- Observability without leaking data: structured logs with ids and counts only, never message text or amounts.
- Load test locally (Miniflare / `wrangler dev`) with 10 years of synthetic data (~700k rows) and report page-load time
  and CPU per endpoint; fix anything over budget.
