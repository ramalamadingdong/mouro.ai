// Entry point: `node server/src/main.js`
//
// Environment:
//   PORT        listen port (default 8787, bound to 127.0.0.1 — Caddy fronts it)
//   HOST        bind address (default 127.0.0.1)
//   DATA_DIR    where realtime.sqlite and the auth secret live (default ./data)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './db.js';
import { Rules } from './rules.js';
import { createRealtimeServer } from './server.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const dataDir = resolve(process.env.DATA_DIR ?? join(repo, 'server/data'));
mkdirSync(dataDir, { recursive: true });

const secretFile = join(dataDir, 'auth-secret');
if (!existsSync(secretFile)) writeFileSync(secretFile, randomBytes(32).toString('hex'), { mode: 0o600 });
const secret = readFileSync(secretFile, 'utf8').trim();

const config = JSON.parse(readFileSync(join(here, '../games.json'), 'utf8'));
const games = config.map((g) => ({
  name: g.name,
  reap: g.reap,
  rules: new Rules(JSON.parse(readFileSync(resolve(repo, g.rules), 'utf8'))),
}));

const store = new Store(join(dataDir, 'realtime.sqlite'));
const server = createRealtimeServer({ store, games, secret, log: (...a) => console.log(new Date().toISOString(), ...a) });
server.reap();

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
server.http.listen(port, host, () => {
  console.log(`realtime server on ${host}:${port} — databases: ${games.map((g) => g.name).join(', ')}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close();
    process.exit(0);
  });
}
