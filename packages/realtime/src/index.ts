/**
 * @mouro/realtime — a drop-in client for the mouro.ai realtime server.
 *
 * It mirrors the subset of the Firebase JS SDK (modular API) that the games
 * use, so their room/presence code keeps its shape: ref, get, set, update,
 * remove, onValue, runTransaction, serverTimestamp, onDisconnect, the local
 * `.info/connected` node, and anonymous auth (getAuth, onAuthStateChanged,
 * signInAnonymously).
 *
 * Nothing touches the network or browser globals at import time, so modules
 * that import this stay safe under static prerendering in Node.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface KeyValueStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
}

export interface RealtimeOptions {
  /** Database (game) name on the server, e.g. "backgammon". */
  database: string;
  /**
   * WebSocket URL of the server. Defaults on the web to `wss://<host>/rt`
   * (or ws:// for http pages). Required on native.
   */
  url?: string;
  /** Where the anonymous identity token is kept. Defaults to localStorage on the web, memory elsewhere. */
  storage?: KeyValueStorage;
}

export interface User {
  uid: string;
  isAnonymous: true;
}

export interface Unsubscribe {
  (): void;
}


interface Pending {
  resolve: (msg: Reply) => void;
  reject: (err: Error) => void;
  /** The serialized request, re-sent after a reconnect until answered. */
  body: string;
}

interface Reply {
  id: number;
  ok: boolean;
  code?: string;
  error?: string;
  value?: unknown;
}

export class RealtimeError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const SERVER_TIMESTAMP = Object.freeze({ '.sv': 'timestamp' });

function deepClone<T>(v: T): T {
  return v === undefined ? (null as T) : (JSON.parse(JSON.stringify(v)) as T);
}

function splitPath(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

function defaultUrl(): string {
  const loc = (globalThis as { location?: { protocol: string; host: string } }).location;
  if (!loc || !loc.host) throw new Error('@mouro/realtime: no server url configured');
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/rt`;
}

function defaultStorage(): KeyValueStorage {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (ls) {
      ls.getItem('__probe__');
      return ls;
    }
  } catch {
    // Safari private mode etc.
  }
  const mem = new Map<string, string>();
  return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) };
}

// ── Client (one socket per app) ──────────────────────────────────────────────

interface SubRecord {
  path: string;
  onValue: (value: unknown) => void;
  onCancel: (err: Error) => void;
}

export class RealtimeClient {
  readonly options: RealtimeOptions;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private queue: string[] = [];
  private subs = new Map<number, SubRecord>();
  private connected = false;
  private connectedListeners = new Set<(c: boolean) => void>();
  private authListeners = new Set<(u: User | null) => void>();
  private token: string | null = null;
  private user: User | null = null;
  private authLoaded: Promise<void> | null = null;
  private wanted = false;
  private backoff = 500;
  private welcomeWaiters: Array<() => void> = [];
  private storage: KeyValueStorage | null = null;
  private tokenKey: string;
  /** The lobby this client shows "On your Wi-Fi"; re-sent after a reconnect. */
  private nearbyHost: Record<string, unknown> | null = null;

  constructor(options: RealtimeOptions) {
    this.options = options;
    this.tokenKey = `mouro.realtime.token.${options.database}`;
  }

  // ── identity ──

  /** Load a stored identity (no network). Resolves once currentUser is known. */
  loadAuth(): Promise<void> {
    if (!this.authLoaded) {
      this.storage = this.options.storage ?? defaultStorage();
      this.authLoaded = Promise.resolve(this.storage.getItem(this.tokenKey))
        .catch(() => null)
        .then((tok) => {
          if (tok && tok.includes('.')) {
            this.token = tok;
            this.setUser(tok.split('.')[0]);
          }
        });
    }
    return this.authLoaded;
  }

  get currentUser(): User | null {
    return this.user;
  }

  private setUser(uid: string | null): void {
    const prev = this.user?.uid ?? null;
    if (prev === uid) return;
    this.user = uid ? { uid, isAnonymous: true } : null;
    this.authListeners.forEach((l) => l(this.user));
  }

  onAuth(cb: (u: User | null) => void): Unsubscribe {
    this.authListeners.add(cb);
    void this.loadAuth().then(() => {
      if (this.authListeners.has(cb)) cb(this.user);
    });
    return () => this.authListeners.delete(cb);
  }

  /** Mint (or confirm) an anonymous identity with the server. */
  async signIn(): Promise<User> {
    await this.loadAuth();
    await this.ensureConnected();
    if (!this.user) throw new RealtimeError('auth/internal-error', 'Sign-in failed');
    return this.user;
  }

  // ── connection ──

  private ensureConnected(): Promise<void> {
    this.wanted = true;
    if (this.connected) return Promise.resolve();
    const p = new Promise<void>((resolve) => this.welcomeWaiters.push(resolve));
    if (!this.ws) void this.open();
    return p;
  }

  private async open(): Promise<void> {
    await this.loadAuth();
    if (this.ws) return;
    const WS = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!WS) throw new Error('@mouro/realtime: WebSocket is not available in this environment');
    const ws = new WS(this.options.url ?? defaultUrl());
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ op: 'hello', db: this.options.database, token: this.token }));
    };
    ws.onmessage = (ev: MessageEvent) => this.onMessage(String(ev.data));
    ws.onclose = () => this.onClose(ws);
    ws.onerror = () => {
      // onclose follows; reconnect is handled there.
    };
  }

  private onClose(ws: WebSocket): void {
    if (this.ws !== ws) return;
    this.ws = null;
    const was = this.connected;
    this.connected = false;
    if (was) this.connectedListeners.forEach((l) => l(false));
    if (this.wanted) {
      const delay = this.backoff;
      this.backoff = Math.min(this.backoff * 2, 15_000);
      setTimeout(() => {
        if (this.wanted) void this.open();
      }, delay);
    }
  }

  private onMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (msg.op === 'welcome') {
      this.token = msg.token as string;
      void Promise.resolve(this.storage?.setItem(this.tokenKey, this.token)).catch(() => {});
      this.setUser(msg.uid as string);
      this.connected = true;
      this.backoff = 500;
      // Re-establish live subscriptions, then flush queued requests.
      for (const [sid, s] of this.subs) this.raw({ op: 'sub', sid, path: s.path });
      // The server forgets an announced lobby when the socket closes.
      if (this.nearbyHost) this.raw(this.nearbyHost);
      // Requests in flight when the socket dropped are re-sent: set/update are
      // idempotent and transactions are compare-and-set, so a replay is safe.
      const q = this.queue;
      this.queue = [];
      q.forEach((m) => this.ws?.send(m));
      for (const p of this.pending.values()) this.ws?.send(p.body);
      this.connectedListeners.forEach((l) => l(true));
      const w = this.welcomeWaiters;
      this.welcomeWaiters = [];
      w.forEach((r) => r());
      return;
    }
    if (msg.op === 'value') {
      this.subs.get(msg.sid as number)?.onValue(msg.value);
      return;
    }
    if (msg.op === 'cancel') {
      const s = this.subs.get(msg.sid as number);
      if (s) {
        this.subs.delete(msg.sid as number);
        s.onCancel(new RealtimeError('PERMISSION_DENIED', 'PERMISSION_DENIED: Permission denied'));
      }
      return;
    }
    if (typeof msg.id === 'number') {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        p.resolve(msg as unknown as Reply);
      }
    }
  }

  private raw(body: Record<string, unknown>): void {
    const s = JSON.stringify(body);
    if (this.connected && this.ws) this.ws.send(s);
    else this.queue.push(s);
  }

  async request(body: Record<string, unknown>): Promise<Reply> {
    void this.ensureConnected();
    const id = this.nextId++;
    const text = JSON.stringify({ ...body, id });
    const p = new Promise<Reply>((resolve, reject) => this.pending.set(id, { resolve, reject, body: text }));
    if (this.connected && this.ws) this.ws.send(text);
    const reply = await p;
    if (!reply.ok && reply.code !== 'stale') {
      const code = reply.code === 'permission_denied' ? 'PERMISSION_DENIED' : (reply.code ?? 'unknown');
      throw new RealtimeError(code, reply.error ?? code);
    }
    return reply;
  }

  subscribe(path: string, onValue: (v: unknown) => void, onCancel: (e: Error) => void): Unsubscribe {
    void this.ensureConnected();
    const sid = this.nextId++;
    this.subs.set(sid, { path, onValue, onCancel });
    this.raw({ op: 'sub', sid, path });
    return () => {
      if (this.subs.delete(sid)) this.raw({ op: 'unsub', sid });
    };
  }

  /** Disconnect for good: no reconnects, pending requests rejected. */
  close(): void {
    this.wanted = false;
    const ws = this.ws;
    this.ws = null;
    this.connected = false;
    for (const p of this.pending.values()) p.reject(new RealtimeError('closed', 'Client closed'));
    this.pending.clear();
    this.subs.clear();
    ws?.close();
  }

  setNearbyHost(body: Record<string, unknown> | null): void {
    this.nearbyHost = body;
  }

  watchConnected(cb: (c: boolean) => void): Unsubscribe {
    void this.ensureConnected();
    this.connectedListeners.add(cb);
    setTimeout(() => this.connectedListeners.has(cb) && cb(this.connected), 0);
    return () => this.connectedListeners.delete(cb);
  }
}

// ── Firebase-shaped API ──────────────────────────────────────────────────────

export interface Auth {
  readonly client: RealtimeClient;
  readonly currentUser: User | null;
}
export interface Database {
  readonly client: RealtimeClient;
}

export function initializeRealtime(options: RealtimeOptions): { auth: Auth; db: Database; client: RealtimeClient } {
  const client = new RealtimeClient(options);
  const auth: Auth = {
    client,
    get currentUser() {
      return client.currentUser;
    },
  };
  return { auth, db: { client }, client };
}

export function onAuthStateChanged(auth: Auth, next: (user: User | null) => void, _error?: (err: Error) => void): Unsubscribe {
  return auth.client.onAuth(next);
}

export async function signInAnonymously(auth: Auth): Promise<{ user: User }> {
  return { user: await auth.client.signIn() };
}

export interface DatabaseReference {
  readonly db: Database;
  readonly path: string;
  readonly key: string | null;
}

export function ref(db: Database, path = ''): DatabaseReference {
  const segs = splitPath(path);
  return { db, path: segs.join('/'), key: segs.length ? segs[segs.length - 1] : null };
}

export class DataSnapshot {
  readonly key: string | null;
  private readonly value: unknown;
  constructor(key: string | null, value: unknown) {
    this.key = key;
    this.value = value === undefined ? null : value;
  }
  val(): any {
    return deepClone(this.value);
  }
  exists(): boolean {
    return this.value !== null;
  }
  child(path: string): DataSnapshot {
    let cur: unknown = this.value;
    const segs = splitPath(path);
    for (const s of segs) {
      cur = cur !== null && typeof cur === 'object' ? (cur as Record<string, unknown>)[s] ?? null : null;
    }
    return new DataSnapshot(segs.length ? segs[segs.length - 1] : this.key, cur);
  }
  forEach(action: (child: DataSnapshot) => boolean | void): boolean {
    const v = this.value;
    if (v === null || typeof v !== 'object') return false;
    const entries = Array.isArray(v) ? v.map((x, i) => [String(i), x] as const).filter(([, x]) => x !== null) : Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [k, x] of entries) if (action(new DataSnapshot(k, x)) === true) return true;
    return false;
  }
  get size(): number {
    const v = this.value;
    return v !== null && typeof v === 'object' ? Object.keys(v).length : 0;
  }
}

export function serverTimestamp(): object {
  return SERVER_TIMESTAMP;
}

function isInfoConnected(r: DatabaseReference): boolean {
  return r.path === '.info/connected';
}

export async function get(r: DatabaseReference): Promise<DataSnapshot> {
  const reply = await r.db.client.request({ op: 'get', path: r.path });
  return new DataSnapshot(r.key, reply.value ?? null);
}

export async function set(r: DatabaseReference, value: unknown): Promise<void> {
  await r.db.client.request({ op: 'set', path: r.path, value: value === undefined ? null : value });
}

export async function update(r: DatabaseReference, values: Record<string, unknown>): Promise<void> {
  await r.db.client.request({ op: 'update', path: r.path, values });
}

export async function remove(r: DatabaseReference): Promise<void> {
  await set(r, null);
}

export function onValue(
  r: DatabaseReference,
  callback: (snap: DataSnapshot) => unknown,
  cancelCallback?: ((err: Error) => unknown) | { onlyOnce?: boolean },
): Unsubscribe {
  const cancel = typeof cancelCallback === 'function' ? cancelCallback : undefined;
  if (isInfoConnected(r)) {
    return r.db.client.watchConnected((c) => void callback(new DataSnapshot('connected', c)));
  }
  return r.db.client.subscribe(
    r.path,
    (v) => void callback(new DataSnapshot(r.key, v)),
    (e) => void cancel?.(e),
  );
}

export interface TransactionResult {
  committed: boolean;
  snapshot: DataSnapshot;
}

/**
 * Optimistic compare-and-set, the same model as Firebase: run `update` against
 * the current value, send the result with the value it was computed from, and
 * retry against the fresh value if someone else wrote first. Returning
 * `undefined` from `update` aborts.
 */
export async function runTransaction(
  r: DatabaseReference,
  updateFn: (current: any) => unknown,
  _options?: { applyLocally?: boolean },
): Promise<TransactionResult> {
  const client = r.db.client;
  let current: unknown = (await client.request({ op: 'get', path: r.path })).value ?? null;
  for (let attempt = 0; attempt < 25; attempt++) {
    const next = updateFn(deepClone(current));
    if (next === undefined) return { committed: false, snapshot: new DataSnapshot(r.key, current) };
    const reply = await client.request({ op: 'txn', path: r.path, base: current, value: next });
    if (reply.ok) return { committed: true, snapshot: new DataSnapshot(r.key, reply.value ?? null) };
    current = reply.value ?? null; // stale: retry against the fresh value
  }
  throw new RealtimeError('maxretry', 'Transaction had too many retries');
}

export interface OnDisconnect {
  set(value: unknown): Promise<void>;
  update(values: Record<string, unknown>): Promise<void>;
  remove(): Promise<void>;
  cancel(): Promise<void>;
}

export function onDisconnect(r: DatabaseReference): OnDisconnect {
  const send = async (body: Record<string, unknown>) => {
    await r.db.client.request({ op: 'od', path: r.path, ...body });
  };
  return {
    set: (value) => send({ action: 'set', value }),
    update: (values) => send({ action: 'update', values }),
    remove: () => send({ action: 'remove' }),
    cancel: () => send({ action: 'cancel' }),
  };
}

// ── "On your Wi-Fi" ─────────────────────────────────────────────────────────
// Not part of the Firebase API. The server matches players who reach it from
// the same network (one public IPv4 address, or one IPv6 /64) and keeps that
// match in memory only; clients never see an address, just these fields.

export interface NearbyRoom {
  code: string;
  /** The host's display name, as they announced it. */
  name: string;
  players: number;
}

/**
 * Show a waiting room to players on the same network, or stop with `null`.
 * Kept across reconnects; it ends when the room is withdrawn or this client
 * disconnects for good. A room that does not exist is refused.
 */
export async function announceNearbyRoom(db: Database, room: NearbyRoom | null): Promise<void> {
  const body = room ? { op: 'nearby:host', code: room.code, name: room.name, players: room.players } : null;
  db.client.setNearbyHost(body);
  await db.client.request(body ?? { op: 'nearby:host', code: null });
}

/** Waiting rooms of this game announced from the same network. */
export async function listNearbyRooms(db: Database): Promise<NearbyRoom[]> {
  const reply = (await db.client.request({ op: 'nearby:list' })) as Reply & { rooms?: unknown };
  return Array.isArray(reply.rooms) ? (reply.rooms as NearbyRoom[]) : [];
}
