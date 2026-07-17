// KŌDŌ Multi-Source Proxy Server v3
// Run: node proxy.js   (no dependencies, Node 16+)
//
// Why this exists: MangaDex intentionally does not send CORS headers to
// third-party sites and serves wrong responses to hotlinked images, so a
// personal proxy is required. Docs: https://api.mangadex.org/docs/2-limitations/

const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3300;

// Exact hosts OR suffix matches. Covers the dynamic MangaDex@Home image
// servers (*.mangadex.network) WITHOUT the old "/data/ in URL" bypass,
// which allowed proxying to ANY domain (open-proxy / SSRF hole).
const ALLOWED = [
  { host: 'api.mangadex.org' },
  { host: 'uploads.mangadex.org' },
  { suffix: '.mangadex.network' },
  { host: 'graphql.anilist.co' },
  { host: 'api.jikan.moe' },
];

function isAllowed(hostname) {
  return ALLOWED.some(rule =>
    rule.host ? hostname === rule.host : hostname.endsWith(rule.suffix)
  );
}

// Tiny in-memory cache for GET JSON (60s) — keeps us well under MangaDex's
// ~5 req/s/IP limit when the UI re-requests the same feeds.
const cache = new Map();
const CACHE_TTL = 60 * 1000;
const CACHE_MAX = 300;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL) { cache.delete(key); return null; }
  return hit;
}

function cacheSet(key, status, contentType, body) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), status, contentType, body });
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(obj));
}

function proxyFetch(targetUrl, clientReq, bodyBuf, redirectsLeft, done) {
  let parsed;
  try { parsed = new URL(targetUrl); } catch { return done({ status: 400, error: 'Invalid URL' }); }
  if (parsed.protocol !== 'https:') return done({ status: 400, error: 'HTTPS only' });
  if (!isAllowed(parsed.hostname)) return done({ status: 403, error: `Domain not allowed: ${parsed.hostname}` });

  const headers = {
    // Real, honest UA — MangaDex requires a User-Agent and forbids spoofing.
    'User-Agent': 'KodoPersonalReader/3.0 (personal use; contact: local)',
    'Accept': '*/*',
  };
  if (clientReq.method === 'POST') {
    headers['Content-Type'] = clientReq.headers['content-type'] || 'application/json';
    if (bodyBuf) headers['Content-Length'] = bodyBuf.length;
  }

  const upstream = https.request({
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    method: clientReq.method === 'POST' ? 'POST' : 'GET',
    headers,
    timeout: 30000,
  }, (upRes) => {
    const status = upRes.statusCode || 502;
    // Follow redirects (MangaDex@Home image servers 302 sometimes)
    if ([301, 302, 303, 307, 308].includes(status) && upRes.headers.location && redirectsLeft > 0) {
      const next = new URL(upRes.headers.location, targetUrl).toString();
      upRes.resume();
      return proxyFetch(next, clientReq, bodyBuf, redirectsLeft - 1, done);
    }
    done(null, upRes, status);
  });

  upstream.on('timeout', () => { upstream.destroy(new Error('Upstream timeout')); });
  upstream.on('error', (err) => done({ status: 502, error: err.message }));
  if (bodyBuf) upstream.write(bodyBuf);
  upstream.end();
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const reqUrl = new URL(req.url, 'http://localhost');

  if (reqUrl.pathname === '/health' || (reqUrl.pathname === '/' && !reqUrl.searchParams.has('url'))) {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'KODO Proxy v3',
      uptime: Math.round(process.uptime()),
      cache: cache.size,
      sources: ['MangaDex', 'AniList', 'Jikan'],
    });
  }

  const target = reqUrl.searchParams.get('url');
  if (!target) return sendJson(res, 400, { error: 'Missing ?url= parameter' });

  // Serve cached GET JSON
  const cacheKey = req.method === 'GET' ? target : null;
  if (cacheKey) {
    const hit = cacheGet(cacheKey);
    if (hit) {
      res.writeHead(hit.status, {
        'Content-Type': hit.contentType,
        'Access-Control-Allow-Origin': '*',
        'X-Kodo-Cache': 'hit',
      });
      return res.end(hit.body);
    }
  }

  // Collect POST body first (AniList GraphQL)
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const bodyBuf = req.method === 'POST' ? Buffer.concat(chunks) : null;

    proxyFetch(target, req, bodyBuf, 4, (err, upRes, status) => {
      if (err) return sendJson(res, err.status, { error: err.error });

      const ct = upRes.headers['content-type'] || 'application/octet-stream';
      const outHeaders = {
        'Content-Type': ct,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': ct.startsWith('image/') ? 'public, max-age=86400' : 'public, max-age=60',
      };
      if (upRes.headers['retry-after']) outHeaders['Retry-After'] = upRes.headers['retry-after'];

      const isJson = ct.includes('json') || ct.startsWith('text/');
      if (cacheKey && isJson && status === 200) {
        // Buffer small JSON to cache it; stream everything else
        const parts = [];
        upRes.on('data', c => parts.push(c));
        upRes.on('end', () => {
          const body = Buffer.concat(parts);
          if (body.length < 2 * 1024 * 1024) cacheSet(cacheKey, status, ct, body);
          res.writeHead(status, outHeaders);
          res.end(body);
        });
        return;
      }

      res.writeHead(status, outHeaders);
      upRes.pipe(res);
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ KŌDŌ Proxy v3 on port ${PORT}`);
  console.log('   Allowed: api/uploads.mangadex.org, *.mangadex.network, AniList, Jikan');
  console.log(`   Health:  http://localhost:${PORT}/health\n`);
});
