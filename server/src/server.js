// The realtime server: a small WebSocket service that stands in for Firebase
// Realtime Database + Anonymous Auth for the games on mouro.ai.
//
// Protocol (JSON text frames). Client → server:
//   {op:'hello', db, token?}                         → {op:'welcome', uid, token}
//   {id, op:'get', path}                             → {id, ok, value}
//   {id, op:'set', path, value}                      → {id, ok}
//   {id, op:'update', path, values:{rel: value}}     → {id, ok}
//   {id, op:'txn', path, base, value}                → {id, ok} | {id, ok:false, code:'stale', value}
//   {id, op:'sub', sid, path}                        → stream of {op:'value', sid, value} / {op:'cancel', sid}
//   {op:'unsub', sid}
//   {id, op:'od', path, action:'set'|'update'|'remove'|'cancel', value?, values?}
// Failures carry {ok:false, code:'permission_denied' | 'bad_request', error}.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { GameDb } from './db.js';
import { canonical, fromStore, getAt, resolveServerValues, splitPath, toStore, validKey, validKeys } from './tree.js';

const DAY_MS = 86_400_000;
const MAX_SUBS = 200; // live subscriptions per connection
const MAX_DISCONNECT_OPS = 50;

export function createAuth(secret) {
  const sign = (uid) => createHmac('sha256', secret).update(uid).digest('base64url');
  return {
    mint() {
      const uid = randomBytes(15).toString('base64url');
      return { uid, token: `${uid}.${sign(uid)}` };
    },
    verify(token) {
      if (typeof token !== 'string') return null;
      const [uid, sig] = token.split('.');
      if (!uid || !sig) return null;
      const want = Buffer.from(sign(uid));
      const got = Buffer.from(sig);
      return want.length === got.length && timingSafeEqual(want, got) ? uid : null;
    },
  };
}

/**
 * @param {{store: import('./db.js').Store, games: {name:string, rules:import('./rules.js').Rules, reap?:string[]}[], secret:string, log?:(...a:any[])=>void}} opts
 */
export function createRealtimeServer({ store, games, secret, log = () => {} }) {
  const dbs = new Map(games.map((g) => [g.name, Object.assign(new GameDb(g.name, g.rules, store), { reap: g.reap ?? [] })]));
  const auth = createAuth(secret);
  const http = createServer((req, res) => {
    if (req.url === '/rt/health' || req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });

  http.on('upgrade', (req, socket, head) => {
    // Accept /rt and /rt/<anything>; the database is chosen in `hello`.
    if (!/^\/rt(\/|$|\?)/.test(req.url ?? '') && req.url !== '/') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    /** @type {GameDb|null} */
    let db = null;
    let uid = null;
    const subs = new Map(); // sid → {segs, last}
    let disconnectOps = []; // [{segs, kind, writes}]
    let alive = true;

    const send = (msg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    const authObj = () => (uid ? { uid, provider: 'anonymous', token: { firebase: { sign_in_provider: 'anonymous' } } } : null);

    const pushSubs = (changed) => {
      for (const [sid, sub] of subs) {
        const touched = changed === null || changed.some((c) => prefixOverlap(c, sub.segs));
        if (!touched) continue;
        if (!db.rules.canRead(sub.segs.join('/'), authObj(), db.root)) {
          subs.delete(sid);
          send({ op: 'cancel', sid, code: 'permission_denied' });
          continue;
        }
        const raw = getAt(db.root, sub.segs);
        const c = canonical(raw);
        if (c === sub.last) continue;
        sub.last = c;
        send({ op: 'value', sid, value: fromStore(raw) });
      }
    };

    ws.on('pong', () => (alive = true));
    const beat = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 25_000);

    ws.on('message', (buf) => {
      let msg;
      try {
        msg = JSON.parse(String(buf));
      } catch {
        return;
      }
      const reply = (body) => msg.id !== undefined && send({ id: msg.id, ...body });
      const deny = () => reply({ ok: false, code: 'permission_denied', error: 'PERMISSION_DENIED: Permission denied' });
      const bad = (e) => reply({ ok: false, code: 'bad_request', error: e });

      if (msg.op === 'hello') {
        const target = dbs.get(msg.db);
        if (!target) return send({ op: 'error', error: `unknown database "${msg.db}"` });
        if (db && db !== target) return send({ op: 'error', error: 'database already selected' });
        if (!db) {
          db = target;
          db.listeners.add(pushSubs);
        }
        uid = auth.verify(msg.token);
        let token = msg.token;
        if (!uid) ({ uid, token } = auth.mint());
        send({ op: 'welcome', uid, token, now: Date.now() });
        return;
      }
      if (!db || !uid) return bad('send hello first');

      const segs = splitPath(msg.path);
      if (!segs.every(validKey)) return bad('invalid path');
      const now = Date.now();
      const prep = (v) => {
        const resolved = resolveServerValues(v, now);
        if (!validKeys(resolved)) throw new Error('invalid key');
        return toStore(resolved);
      };

      try {
        switch (msg.op) {
          case 'get': {
            if (!db.rules.canRead(segs.join('/'), authObj(), db.root, now)) return deny();
            return reply({ ok: true, value: fromStore(db.get(segs)) });
          }
          case 'set': {
            const ok = db.write(authObj(), [{ segs, value: prep(msg.value) }], now);
            return ok ? reply({ ok: true }) : deny();
          }
          case 'update': {
            const writes = Object.entries(msg.values ?? {}).map(([rel, v]) => ({ segs: [...segs, ...splitPath(rel)], value: prep(v) }));
            if (writes.some((w) => !w.segs.every(validKey))) return bad('invalid path');
            if (writes.length === 0) return reply({ ok: true });
            const ok = db.write(authObj(), writes, now);
            return ok ? reply({ ok: true }) : deny();
          }
          case 'txn': {
            // Compare-and-set: the client ran its update function against
            // `base`; commit only if nothing changed underneath it.
            const current = db.get(segs);
            if (canonical(toStore(msg.base)) !== canonical(current)) {
              if (!db.rules.canRead(segs.join('/'), authObj(), db.root, now)) return deny();
              return reply({ ok: false, code: 'stale', value: fromStore(current) });
            }
            const ok = db.write(authObj(), [{ segs, value: prep(msg.value) }], now);
            return ok ? reply({ ok: true, value: fromStore(db.get(segs)) }) : deny();
          }
          case 'sub': {
            if (subs.size >= MAX_SUBS && !subs.has(msg.sid)) return bad('too many subscriptions');
            if (!db.rules.canRead(segs.join('/'), authObj(), db.root, now)) {
              return send({ op: 'cancel', sid: msg.sid, code: 'permission_denied' });
            }
            const raw = getAt(db.root, segs);
            subs.set(msg.sid, { segs, last: canonical(raw) });
            return send({ op: 'value', sid: msg.sid, value: fromStore(raw) });
          }
          case 'unsub':
            subs.delete(msg.sid);
            return;
          case 'od': {
            const key = segs.join('/');
            disconnectOps = disconnectOps.filter((o) => !(o.key === key || o.key.startsWith(key + '/')));
            if (msg.action === 'cancel') return reply({ ok: true });
            let writes;
            if (msg.action === 'remove') writes = [{ segs, value: null }];
            else if (msg.action === 'set') writes = [{ segs, raw: msg.value }];
            else if (msg.action === 'update') writes = Object.entries(msg.values ?? {}).map(([rel, v]) => ({ segs: [...segs, ...splitPath(rel)], raw: v }));
            else return bad('unknown onDisconnect action');
            if (writes.some((w) => !w.segs.every(validKey))) return bad('invalid path');
            if (disconnectOps.length >= MAX_DISCONNECT_OPS) return bad('too many onDisconnect operations');
            // Firebase checks onDisconnect writes when they are armed.
            const trial = writes.map((w) => ({ segs: w.segs, value: 'raw' in w ? prep(w.raw) : null }));
            const next = db.preview(trial);
            for (const w of trial) if (!db.rules.canWrite(w.segs.join('/'), authObj(), db.root, next, now)) return deny();
            disconnectOps.push({ key, writes });
            return reply({ ok: true });
          }
          default:
            return bad(`unknown op ${msg.op}`);
        }
      } catch (err) {
        log('request failed', err);
        return bad(String(err?.message ?? err));
      }
    });

    ws.on('close', () => {
      clearInterval(beat);
      if (!db) return;
      db.listeners.delete(pushSubs);
      if (disconnectOps.length) {
        const now = Date.now();
        try {
          const writes = disconnectOps.flatMap((o) =>
            o.writes.map((w) => ({ segs: w.segs, value: 'raw' in w ? toStore(resolveServerValues(w.raw, now)) : null })),
          );
          db.writeAsServer(writes);
        } catch (err) {
          log('onDisconnect failed', err);
        }
      }
    });
  });

  /** Delete rooms idle for more than a day (meta.updatedAt). */
  function reap(now = Date.now()) {
    for (const db of dbs.values()) {
      for (const top of db.reap) {
        const rooms = db.get([top]);
        if (!rooms || typeof rooms !== 'object') continue;
        const dead = Object.entries(rooms)
          .filter(([, r]) => {
            const t = r?.meta?.updatedAt ?? r?.meta?.createdAt;
            return typeof t === 'number' && now - t > DAY_MS;
          })
          .map(([code]) => ({ segs: [top, code], value: null }));
        if (dead.length) {
          db.writeAsServer(dead);
          log(`reaped ${dead.length} room(s) from ${db.name}/${top}`);
        }
      }
    }
  }
  const reaper = setInterval(reap, 60 * 60 * 1000);
  reaper.unref();

  return {
    http,
    reap,
    dbs,
    close() {
      clearInterval(reaper);
      for (const c of wss.clients) c.terminate();
      wss.close();
      http.close();
    },
  };
}

function prefixOverlap(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}
