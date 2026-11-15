#!/usr/bin/env node
// Serve the whole site locally, the way infra/Caddyfile does in production:
// built games + personal site + the realtime server on /rt, on one port.
//
//   npm run build        # from the repo root, builds every app
//   npm run preview      # → http://localhost:8080
//
// Useful for trying a change across the whole site, and used by the end-to-end
// browser test (scripts/e2e.py).
import { createReadStream, existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { Store } from '../server/src/db.js';
import { Rules } from '../server/src/rules.js';
import { createRealtimeServer } from '../server/src/server.js';

const repo = resolve(import.meta.dirname, '..');
const port = Number(process.env.PORT ?? 8080);
const rtPort = port + 1;

const dirs = {
  backgammon: join(repo, 'games/backgammon/dist'),
  'gin-rummy': join(repo, 'games/gin-rummy/dist'),
  yahtzee: join(repo, 'games/yahtzee/dist'),
  holdem: join(repo, 'games/holdem/dist'),
  dots: join(repo, 'games/dots/dist'),
  pawprints: join(repo, 'games/pawprints/dist'),
  site: join(repo, 'site'),
};

// realtime server with a throwaway database
const games = JSON.parse(readFileSync(join(repo, 'server/games.json'), 'utf8')).map((g) => ({
  ...g,
  rules: new Rules(JSON.parse(readFileSync(join(repo, g.rules), 'utf8'))),
}));
const rt = createRealtimeServer({
  store: new Store(join(mkdtempSync(join(tmpdir(), 'mouro-preview-')), 'rt.sqlite')),
  games,
  secret: 'preview',
});
rt.http.listen(rtPort, '127.0.0.1');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

const isFile = (p) => existsSync(p) && statSync(p).isFile();
function firstFile(root, candidates) {
  for (const c of candidates) {
    const p = normalize(join(root, c));
    if (p.startsWith(root) && isFile(p)) return p;
  }
  return null;
}

function resolveFile(pathname) {
  const m = pathname.match(/^\/(backgammon|gin-rummy|yahtzee|holdem|dots|pawprints)(\/.*)?$/);
  if (m) {
    const [, app, rest = '/'] = m;
    const root = dirs[app];
    const dyn = rest.match(/^\/(join|lobby|game)\/[A-HJKMNP-Z2-9]{5}\/?$/);
    const vite = app === 'yahtzee' || app === 'holdem' || app === 'dots' || app === 'pawprints';
    if (dyn && !vite) return firstFile(root, [`/${dyn[1]}/[code].html`, '/index.html']);
    if (vite) return firstFile(root, [rest, '/index.html']);
    return firstFile(root, [rest, `${rest}.html`, `${rest}/index.html`, '/index.html']);
  }
  return firstFile(dirs.site, [pathname, `${pathname}/index.html`, `${pathname}.html`]);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  if (p.startsWith('/rt')) {
    const up = request({ host: '127.0.0.1', port: rtPort, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    req.pipe(up);
    return;
  }
  const old = p.match(/^\/gin-rummey(\/.*)?$/);
  if (old) return res.writeHead(301, { location: `/gin-rummy${old[1] ?? '/'}${url.search}` }).end();
  if (/^\/(backgammon|gin-rummy|yahtzee|holdem|dots|pawprints)$/.test(p)) return res.writeHead(301, { location: `${p}/` }).end();
  const file = resolveFile(p);
  if (!file) {
    // Same as the Caddyfile's handle_errors: the site's 404 page, as a 404.
    res.writeHead(404, { 'content-type': types['.html'] });
    return createReadStream(join(dirs.site, '404.html')).pipe(res);
  }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

// WebSocket upgrades on /rt → realtime server
server.on('upgrade', (req, socket, head) => {
  const up = connect(rtPort, '127.0.0.1', () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
    up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

// Loopback only: this serves a throwaway realtime server with a fixed secret.
server.listen(port, '127.0.0.1', () => console.log(`preview on http://localhost:${port}`));
