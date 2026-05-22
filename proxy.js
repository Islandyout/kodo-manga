// MangaDex proxy server — run with: node proxy.js
// Then open index.html in your browser

const http = require('http');
const https = require('https');
const url = require('url');

const PORT = 3300;

const server = http.createServer((req, res) => {
  // CORS headers — allow everything
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsed = url.parse(req.url, true);
  const target = parsed.query.url;

  if (!target) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing ?url= param' }));
    return;
  }

  // Only allow MangaDex domains
  let targetUrl;
  try {
    targetUrl = new url.URL(target);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid URL' }));
    return;
  }

  // Allow all MangaDex domains and at-home CDN servers (any hostname) for manga page images
  const allowedDomains = ['mangadex.org', 'mangadex.network'];
  const isMangaDex = allowedDomains.some(h =>
    targetUrl.hostname === h || targetUrl.hostname.endsWith('.' + h)
  );
  const isAtHomeCDN = target.includes('/data/') || target.includes('/data-saver/');
  if (!isMangaDex && !isAtHomeCDN) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Domain not allowed: ' + targetUrl.hostname }));
    return;
  }

  console.log('→', target.substring(0, 80));

  const options = {
    hostname: targetUrl.hostname,
    path: targetUrl.pathname + (targetUrl.search || ''),
    method: 'GET',
    headers: {
      'User-Agent': 'Kodo-MangaReader/1.0',
      'Accept': 'application/json, image/*, */*',
    }
  };

  const proxyReq = https.request(options, (proxyRes) => {
    const ct = proxyRes.headers['content-type'] || 'application/octet-stream';
    res.writeHead(proxyRes.statusCode, {
      'Content-Type': ct,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=120',
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (e) => {
    console.error('Proxy error:', e.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });

  proxyReq.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n✅ Kodo proxy running at http://localhost:${PORT}`);
  console.log('   Now open index.html in your browser.\n');
});
