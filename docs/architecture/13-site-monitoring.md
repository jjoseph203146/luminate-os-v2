# 13 - Site monitoring (2026-11-06)

v2 checks every client website itself. Nothing in the old app is needed for monitoring.

## What is checked (per site, every 10 minutes)
- **Up / slow / down.** Down is a failed connection or an HTTP status outside 200-399. Slow is an answer that took 3 seconds or more.
- **Eight security checks**, scored out of 8 (`securityScore`, the number shown on the Monitoring screen): HTTP status ok, fast response, HTTPS, `Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security`, `X-Content-Type-Options`, and no server version or framework in `Server` / `X-Powered-By`. The problems found are stored as readable sentences.
- **SSL certificate expiry** (https sites).
- **Domain registration expiry**, from RDAP.
- **Broken links** among the homepage's own links.

## How it runs
- Job `site_checks` (row in `jobs`, migration `0006`), called by the one scheduler through `POST /api/jobs/tick`. The tick has `maxDuration = 60`.
- Up to 10 sites are scanned at the same time, each for at most 22 seconds: a site that has not answered by then is recorded as down ("No response within 22 seconds") and the scan moves on. No new site is started 15 seconds into a run; the rest wait for the next run (`skippedForTime` in the run result). A typical run takes a few seconds, so the whole tick stays well inside its 60-second limit (and inside cron-job.org's 30-second wait).
- A page that sends its headers and then stalls cannot hang the scan: the body read has its own time limit.
- The SSL check tries IPv4 addresses first, then IPv6 (at most three), so a server without IPv6 routing still reads the certificate. A known expiry date is kept after a failed lookup only while it is still in the future (or the failure was a genuinely expired certificate), so a renewal never produces a false "expired" alert.
- Residual risk: the address guard resolves the name, then `fetch` resolves it again, so a hostile DNS server could in theory switch to a private address in between (DNS rebinding). The scan sends only GET/HEAD requests and stores only the status code and two header values, and the sites come from your own client records, so this is accepted for now.
- A site is scanned unless its client is **archived** or has **monitoring stopped**. A client **on hold** is scanned (history stays complete) but its alerts are muted by the alert job.
- The URL is the project's production URL, else the client's oldest website, else the client is skipped. A missing `https://` is added.

## What it writes
The same tables the old checker wrote, so the old client portal keeps working:
- `site_monitors`: one row per client (upsert on `client_id`): status, response time, HTTP status, security score and issues, SSL and domain expiry, broken link count, `last_checked_at`, `last_error`.
- `site_monitor_checks`: one history row per scan (status, response time, security score, time). Uptime percentages and the monthly reports are computed from these.

A failed SSL or domain lookup keeps the last known expiry date instead of erasing it.

## Safety
- The scanner only fetches public internet addresses: http(s) only, no credentials in the URL, and hosts that resolve to private, loopback, link-local or metadata addresses are refused. Every redirect hop is checked again.
- A network error or a 5xx answer is retried once before a site is called down, to avoid false alarms.
- One site failing, in the scan or in saving, never stops the others. Logs name only client ids, never URLs.
- Only the system actor may run it (`monitoring.scan`).

## Not ported
- Visual regression and Core Web Vitals screenshots (needs a real browser; the old GitHub Actions workflow did it).
- Sentry ingest (`site_issues`): still written by the old app.
- The "security score dropped" push (v2's alerts cover down, back up, SSL and domain expiry, and stalled checks).

## Cutover: one owner (CLAUDE.md)
Do these in the same sitting as enabling the job:
1. Apply `0006_site_checks_job.sql` (staging first, then production with the owner's approval).
2. Stop the old scanner: disable `.github/workflows/site-check.yml` in the old repo (Actions > Site uptime + security check > Disable workflow) and delete any cron-job.org job that calls `/api/cron/site-check`.
3. Mute the old app's matching pushes: in the old Vercel project set `OLD_PUSH_MUTE=monitoring_stalled,site_down,site_up,ssl_expiring,domain_expiring,security_score_dropped` and redeploy. v2 scans do not write the old `sync_log`, so without `monitoring_stalled` muted the old daily expiry check would push a false "Site monitoring stalled".

## How to verify
- Settings > Automations: `site_checks` shows a succeeded run every 10 minutes, with `scanned` equal to the number of monitored sites.
- `select client_id, status, last_checked_at from public.site_monitors order by last_checked_at desc;` shows every `last_checked_at` within the last 10 minutes or so.
- The Monitoring screen shows no "stale" sites.
