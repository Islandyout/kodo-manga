# KŌDŌ — Personal Manga Reader (v3)

A single-file manga reader (`index.html`) + a zero-dependency Node proxy (`proxy.js`).

## Why a proxy at all?
MangaDex deliberately blocks browser CORS for third-party sites and serves wrong
responses to hotlinked images — their docs require third-party apps to proxy
requests. So the proxy is not optional; it just needs to be somewhere.

## Run it
```bash
node proxy.js          # starts on http://localhost:3300
# then open index.html in a browser
```
The app auto-detects a working proxy in this order:
1. A custom URL you set (banner → "Set proxy URL", stored in localStorage)
2. The hosted Render instance
3. `http://localhost:3300` / `127.0.0.1:3300`

If a free-tier host is asleep it retries with a long timeout (~55s cold start).

## Deploying the proxy for free
Render / Railway / Fly.io free tiers, or any always-on box. Set `PORT` env var
if needed. Then paste the URL via "Set proxy URL".

## What was fixed in v3
- **Proxy SSRF hole closed** — the old `/data/` substring check let anyone
  proxy to *any* domain. Now a strict allowlist incl. `*.mangadex.network`.
- **Redirect following** — MangaDex@Home image nodes 302 sometimes; images no
  longer randomly fail.
- **60s response cache + image cache headers** — stays under MangaDex's
  ~5 req/s/IP limit.
- **Proxy auto-detection** — dead hosted proxy no longer bricks the app; falls
  back to localhost, with Retry / Set-URL controls.
- **Full chapter lists** — feed is now paginated (was capped at 100; long
  series like One Piece were truncated). External/official-only chapters with
  no hosted pages are filtered out (they used to open as blank readers).
- **Scanlation dedupe** — one entry per chapter number (newest upload wins),
  group names shown in the chapter list.
- **Reader opens where you left off** — previously it always jumped to the
  *newest* chapter. Now: saved progress → else chapter 1.
- **Merged-card identity bug** — a title merged from AniList+MangaDex could
  carry the AniList id into the reader and 404. Readable identity now wins.

## New features
- Continue Reading rail on Home (reading history + per-title progress, all in
  localStorage — no accounts, fully private)
- "Continue Ch.X" button + current-chapter marker in the details modal
- Page counter (`3 / 24`) in the reader bar
- Fit-width toggle for the page strip
- Per-page data-saver fallback when a full-quality image fails
- "Next: Ch.X →" button at the end of each chapter / end-of-series marker

## Ideas for later
- Paged mode with RTL direction + tap zones (true manga page-flip)
- Offline chapter caching via a Service Worker (Cache API)
- MangaDex OAuth to sync follows/reading status with your account
- More languages than `en` (one-line change in `fetchAllChapters`)
- AniList OAuth for list syncing on meta titles
