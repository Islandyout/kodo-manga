// KŌDŌ Multi-Source Proxy Server
// Run: node proxy.js

const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3300;

const ALLOWED_DOMAINS = [
  'api.mangadex.org',
  'uploads.mangadex.org',
  'graphql.anilist.co',
  'api.jikan.moe',
  'mangaplus.shueisha.co.jp'
];

function isAllowed(hostname, fullUrl = '') {
  if (fullUrl.includes('/data/') || fullUrl.includes('/at-home/server/')) return true;
  return ALLOWED_DOMAINS.some(d => hostname === d || hostname.endsWith('.' + d));
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'KODO Multi-Source Proxy',
      uptime: process.uptime(),
      sources: ['MangaDex', 'AniList', 'Jikan', 'MangaPlus']
    }));
    return;
  }

  const parsed = url.parse(req.url, true);
  const target = parsed.query.url;

  if (!target) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing ?url= parameter' }));
    return;
  }

  let targetUrl;
  try {
    targetUrl = new url.URL(target);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid URL' }));
    return;
  }

  if (!isAllowed(targetUrl.hostname, target)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Domain not allowed', host: targetUrl.hostname }));
    return;
  }

  console.log(`→ ${req.method} ${target.substring(0, 120)}`);

  const options = {
    hostname: targetUrl.hostname,
    path: targetUrl.pathname + (targetUrl.search || ''),
    method: req.method,
    headers: {
      'User-Agent': 'KODO-MangaReader/2.0',
      'Accept': '*/*',
      'Referer': 'https://islandyout.github.io/'
    }
  };

  // Forward Content-Type for POST (AniList GraphQL)
  if (req.method === 'POST') {
    options.headers['Content-Type'] = req.headers['content-type'] || 'application/json';
    options.headers['Accept'] = 'application/json';
  }

  const proxyReq = https.request(options, (proxyRes) => {
    const ct = proxyRes.headers['content-type'] || 'application/octet-stream';
    res.writeHead(proxyRes.statusCode || 200, {
      'Content-Type': ct,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300'
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  if (req.method === 'POST') {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ KŌDŌ Proxy running on port ${PORT}`);
  console.log('   Sources: MangaDex, AniList, Jikan, MangaPlus');
  console.log(`   Health:  http://localhost:${PORT}/health\n`);
});
