// End-to-end tests: the real server, the real client package, and the games'
// real rules files. Run with `npm test` in server/.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../src/db.js';
import { Rules } from '../src/rules.js';
import { createRealtimeServer } from '../src/server.js';
import {
  get,
  initializeRealtime,
  onDisconnect,
  onValue,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  signInAnonymously,
  update,
} from '../../packages/realtime/src/index.ts';

const repo = resolve(import.meta.dirname, '../..');
const rules = (p) => new Rules(JSON.parse(readFileSync(join(repo, p), 'utf8')));

let server;
const clients = [];
let url;
let dir;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rt-'));
  server = createRealtimeServer({
    store: new Store(join(dir, 'db.sqlite')),
    secret: 'test-secret',
    games: [
      { name: 'gin-rummy', rules: rules('games/gin-rummy/database.rules.json'), reap: ['rooms'] },
      { name: 'backgammon', rules: rules('games/backgammon/database.rules.json'), reap: ['bgRooms'] },
      { name: 'yahtzee', rules: rules('games/yahtzee/database.rules.json'), reap: ['rooms'] },
      { name: 'holdem', rules: rules('games/holdem/database.rules.json'), reap: ['rooms'] },
    ],
  });
  await new Promise((r) => server.http.listen(0, '127.0.0.1', r));
  url = `ws://127.0.0.1:${server.http.address().port}/rt`;
});

after(() => {
  for (const c of clients) c.close();
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

async function player(database, storage = memStorage()) {
  const rt = initializeRealtime({ database, url, storage });
  clients.push(rt.client);
  const { user } = await signInAnonymously(rt.auth);
  return { ...rt, uid: user.uid, storage };
}

const waitFor = async (fn, ms = 2000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

const denied = (p) => assert.rejects(p, (e) => e.code === 'PERMISSION_DENIED');

describe('auth', () => {
  test('a stored token restores the same uid', async () => {
    const storage = memStorage();
    const a = await player('gin-rummy', storage);
    const b = await player('gin-rummy', storage);
    assert.equal(a.uid, b.uid);
    const c = await player('gin-rummy');
    assert.notEqual(a.uid, c.uid);
  });
});

describe('gin rummy rules', () => {
  test('create, join, play, and the rules hold', async () => {
    const host = await player('gin-rummy');
    const guest = await player('gin-rummy');
    const stranger = await player('gin-rummy');
    const code = 'ABCDE';
    const now = Date.now();

    // create-if-null transaction, as rooms.ts does
    const created = await runTransaction(ref(host.db, `rooms/${code}`), (cur) =>
      cur !== null ? undefined : { meta: { host: host.uid, hostName: 'H', status: 'waiting', createdAt: now, updatedAt: now } },
    );
    assert.equal(created.committed, true);
    const again = await runTransaction(ref(stranger.db, `rooms/${code}`), (cur) => (cur !== null ? undefined : { meta: {} }));
    assert.equal(again.committed, false);

    // guest claims the seat
    await update(ref(guest.db, `rooms/${code}/meta`), { guest: guest.uid, guestName: 'G', updatedAt: Date.now() });
    // a third player cannot steal it
    await denied(update(ref(stranger.db, `rooms/${code}/meta`), { guest: stranger.uid }));

    // live subscription sees the guest
    const seen = [];
    const unsub = onValue(ref(host.db, `rooms/${code}`), (s) => seen.push(s.val()));
    await waitFor(() => seen.length && seen.at(-1)?.meta?.guest === guest.uid);

    // host writes the opening state; guest may not (turn rules)
    const state = { version: 0, turnUid: host.uid, phase: 'draw', lastMove: { by: host.uid } };
    assert.equal((await runTransaction(ref(host.db, `rooms/${code}/state`), (c) => (c === null ? state : undefined))).committed, true);
    await denied(set(ref(guest.db, `rooms/${code}/state`), { ...state, version: 1, lastMove: { by: guest.uid } }));
    // version must increase
    await denied(set(ref(host.db, `rooms/${code}/state`), { ...state, version: 0 }));
    const moved = await runTransaction(ref(host.db, `rooms/${code}/state`), (c) => ({ ...c, version: c.version + 1, turnUid: guest.uid }));
    assert.equal(moved.committed, true);
    assert.equal(moved.snapshot.val().turnUid, guest.uid);

    // presence: only for yourself
    await set(ref(guest.db, `rooms/${code}/presence/${guest.uid}`), { online: true, lastSeen: serverTimestamp() });
    await denied(set(ref(guest.db, `rooms/${code}/presence/${host.uid}`), { online: true, lastSeen: 1 }));
    const pres = (await get(ref(host.db, `rooms/${code}/presence/${guest.uid}`))).val();
    assert.equal(typeof pres.lastSeen, 'number');

    // emotes reject unknown fields
    await set(ref(host.db, `rooms/${code}/emotes/${host.uid}`), { emoji: '🎉', n: 1 });
    await denied(set(ref(host.db, `rooms/${code}/emotes/${host.uid}`), { emoji: '🎉', n: 1, x: 1 }));

    // once playing, a stranger's read is cancelled / denied
    await update(ref(host.db, `rooms/${code}/meta`), { status: 'playing' });
    await denied(get(ref(stranger.db, `rooms/${code}`)));
    let cancelled = false;
    onValue(ref(stranger.db, `rooms/${code}`), () => {}, () => (cancelled = true));
    await waitFor(() => cancelled);

    unsub();
    await remove(ref(host.db, `rooms/${code}`));
    assert.equal((await get(ref(host.db, `rooms/${code}`))).exists(), false);
  });

  test('concurrent transactions both land (compare-and-set retries)', async () => {
    const host = await player('gin-rummy');
    const guest = await player('gin-rummy');
    const code = 'FGHJK';
    const now = Date.now();
    await set(ref(host.db, `rooms/${code}`), { meta: { host: host.uid, hostName: 'H', status: 'waiting', createdAt: now, updatedAt: now } });
    await update(ref(guest.db, `rooms/${code}/meta`), { guest: guest.uid, guestName: 'G' });
    await set(ref(host.db, `rooms/${code}/state`), { version: 0, turnUid: host.uid, phase: 'roundOver', lastMove: { by: host.uid } });
    const bump = (p) => runTransaction(ref(p.db, `rooms/${code}/state`), (c) => ({ ...c, version: c.version + 1, lastMove: { by: p.uid } }));
    const [a, b] = await Promise.all([bump(host), bump(guest)]);
    assert.ok(a.committed && b.committed);
    assert.equal((await get(ref(host.db, `rooms/${code}/state/version`))).val(), 2);
  });
});

describe('backgammon rules', () => {
  test('match target bounds and archive are enforced', async () => {
    const host = await player('backgammon');
    const code = 'MNPQR';
    const now = Date.now();
    await set(ref(host.db, `bgRooms/${code}`), { meta: { host: host.uid, hostName: 'H', status: 'waiting', createdAt: now, updatedAt: now } });
    await update(ref(host.db, `bgRooms/${code}/meta`), { target: 7 });
    await denied(update(ref(host.db, `bgRooms/${code}/meta`), { target: 99 }));
    // gin's namespace does not exist in backgammon's database
    await denied(get(ref(host.db, `rooms/${code}`)));
  });

  test('a live draft is writable only by its own player, and only in shape', async () => {
    const host = await player('backgammon');
    const guest = await player('backgammon');
    const stranger = await player('backgammon');
    const code = 'DRAF7';
    const now = Date.now();
    await set(ref(host.db, `bgRooms/${code}`), { meta: { host: host.uid, hostName: 'H', status: 'waiting', createdAt: now, updatedAt: now } });
    await update(ref(guest.db, `bgRooms/${code}/meta`), { guest: guest.uid, guestName: 'G' });

    await set(ref(host.db, `bgRooms/${code}/draft/${host.uid}`), { v: 3, s: '23:20,12:9' });
    await set(ref(guest.db, `bgRooms/${code}/draft/${guest.uid}`), { v: 4, s: '' });
    // not someone else's, not a non-member's, not oversized, not extra fields
    await denied(set(ref(guest.db, `bgRooms/${code}/draft/${host.uid}`), { v: 3, s: '' }));
    await denied(set(ref(stranger.db, `bgRooms/${code}/draft/${stranger.uid}`), { v: 3, s: '' }));
    await denied(set(ref(host.db, `bgRooms/${code}/draft/${host.uid}`), { v: 3, s: 'x'.repeat(41) }));
    await denied(set(ref(host.db, `bgRooms/${code}/draft/${host.uid}`), { v: 3, s: '', extra: 1 }));
  });
});

describe('yahtzee rules', () => {
  test('multi-path seat claim', async () => {
    const host = await player('yahtzee');
    const guest = await player('yahtzee');
    const code = 'STUVW';
    const now = Date.now();
    await set(ref(host.db, `rooms/${code}`), {
      meta: { host: host.uid, status: 'waiting', createdAt: now, updatedAt: now },
      seats: { [host.uid]: `${now}|Host` },
    });
    await update(ref(guest.db, `rooms/${code}`), { [`seats/${guest.uid}`]: `${now}|Guest`, 'meta/updatedAt': serverTimestamp() });
    const seats = (await get(ref(host.db, `rooms/${code}/seats`))).val();
    assert.deepEqual(Object.keys(seats).sort(), [host.uid, guest.uid].sort());
    // you cannot seat someone else
    const other = await player('yahtzee');
    await denied(update(ref(other.db, `rooms/${code}`), { [`seats/${guest.uid}`]: `${now}|Imposter` }));
  });
});

describe('holdem rules', () => {
  // A structurally valid GameState for `uids`, as the engine would write it.
  // The rules bound shape and authority, not poker, so the cards are arbitrary.
  const holdemState = (uids, { version, toAct = null, by, kind }) => ({
    version,
    config: { startingStack: 2000, baseBigBlind: 20, blindUpEvery: 6 },
    players: uids.map((uid, i) => ({
      uid, name: `P${i}`, isHuman: true, stack: 1980, bet: 20, committed: 20, hole: [i * 2, i * 2 + 1],
      inHand: true, folded: false, allIn: false, acted: false, sitOut: false,
    })),
    phase: 'preflop',
    handNo: 1,
    button: 0,
    smallBlind: 10,
    bigBlind: 20,
    deck: [40, 41, 42, 43, 44],
    currentBet: 20,
    minRaise: 20,
    ...(toAct === null ? { turnUid: '*' } : { toAct, turnUid: uids[toAct] }),
    lastMove: { by, kind, seat: 0 },
  });

  async function table(code, seats = 3) {
    const players = [];
    for (let i = 0; i < seats; i++) players.push(await player('holdem'));
    const [host] = players;
    const now = Date.now();
    await set(ref(host.db, `rooms/${code}`), {
      meta: { host: host.uid, status: 'waiting', createdAt: now, updatedAt: now },
      seats: { [host.uid]: `${now}|Host` },
    });
    for (const p of players.slice(1)) {
      await update(ref(p.db, `rooms/${code}`), { [`seats/${p.uid}`]: `${now}|Guest`, 'meta/updatedAt': serverTimestamp() });
    }
    const uids = players.map((p) => p.uid);
    const state = (p) => ref(p.db, `rooms/${code}/state`);
    return { players, uids, state };
  }

  test('only the host deals the first hand; a room cannot be created with a state in it', async () => {
    const { players: [host, guest], uids, state } = await table('HMD22');
    await denied(set(state(guest), holdemState(uids, { version: 1, toAct: 1, by: guest.uid, kind: 'deal' })));
    // the first write must be a deal stamped by the host
    await denied(set(state(host), holdemState(uids, { version: 1, toAct: 1, by: host.uid, kind: 'fold' })));
    await denied(set(state(host), holdemState(uids, { version: 1, toAct: 1, by: guest.uid, kind: 'deal' })));
    await set(state(host), holdemState(uids, { version: 1, toAct: 1, by: host.uid, kind: 'deal' }));

    const now = Date.now();
    await denied(set(ref(host.db, 'rooms/HMD33'), {
      meta: { host: host.uid, status: 'waiting', createdAt: now, updatedAt: now },
      state: holdemState([host.uid, guest.uid], { version: 1, toAct: 0, by: host.uid, kind: 'deal' }),
    }));
  });

  test('only the player on turn may move; version must rise; lastMove.by must be the writer', async () => {
    const { players: [host, a, b], uids, state } = await table('HMD44');
    await set(state(host), holdemState(uids, { version: 1, toAct: 1, by: host.uid, kind: 'deal' }));
    // seat 2 and the host are seated but it is seat 1's turn
    await denied(set(state(b), holdemState(uids, { version: 2, toAct: 2, by: b.uid, kind: 'call' })));
    await denied(set(state(host), holdemState(uids, { version: 2, toAct: 2, by: host.uid, kind: 'call' })));
    // seat 1: no replaying a version, no claiming someone else moved,
    // no turnUid that disagrees with players[toAct]
    await denied(set(state(a), holdemState(uids, { version: 1, toAct: 2, by: a.uid, kind: 'call' })));
    await denied(set(state(a), holdemState(uids, { version: 2, toAct: 2, by: b.uid, kind: 'call' })));
    await denied(set(state(a), { ...holdemState(uids, { version: 2, toAct: 2, by: a.uid, kind: 'call' }), turnUid: a.uid }));
    await denied(set(state(a), { ...holdemState(uids, { version: 2, toAct: 2, by: a.uid, kind: 'call' }), junk: 1 }));
    await set(state(a), holdemState(uids, { version: 2, toAct: 2, by: a.uid, kind: 'call' }));
    // a deep write cannot slip past: version does not move
    await denied(set(ref(b.db, 'rooms/HMD44/state/players/2/stack'), 999999));
    // an outsider cannot read the hole cards of a game in progress, or write
    const outsider = await player('holdem');
    await denied(set(state(outsider), holdemState(uids, { version: 3, toAct: 0, by: outsider.uid, kind: 'call' })));
    await update(ref(host.db, 'rooms/HMD44/meta'), { status: 'playing', updatedAt: serverTimestamp() });
    await denied(get(state(outsider)));
  });

  test('between rounds (turnUid "*") any seated player may deal, but only deal', async () => {
    const { players: [host, a, b], uids, state } = await table('HMD55');
    await set(state(host), holdemState(uids, { version: 1, toAct: 0, by: host.uid, kind: 'deal' }));
    await set(state(host), holdemState(uids, { version: 2, by: host.uid, kind: 'check' })); // round closed
    // the open window is for dealer moves, not for betting on someone's behalf
    await denied(set(state(b), holdemState(uids, { version: 3, toAct: 1, by: b.uid, kind: 'raise' })));
    await set(state(b), holdemState(uids, { version: 3, toAct: 1, by: b.uid, kind: 'next' }));
    // someone who gave up their seat has no say
    await set(state(a), holdemState(uids, { version: 4, by: a.uid, kind: 'check' }));
    await remove(ref(b.db, `rooms/HMD55/seats/${b.uid}`));
    await denied(set(state(b), holdemState(uids, { version: 5, toAct: 0, by: b.uid, kind: 'next' })));
    await set(state(a), holdemState(uids, { version: 5, toAct: 0, by: a.uid, kind: 'next' }));
  });

  test('away: another player may act for the one on turn only while their presence is gone', async () => {
    const { players: [host, a, b], uids, state } = await table('HMD66');
    await set(state(host), holdemState(uids, { version: 1, toAct: 1, by: host.uid, kind: 'deal' }));
    const presence = ref(a.db, `rooms/HMD66/presence/${a.uid}`);
    await set(presence, serverTimestamp());
    // seat 1 is connected: nobody may act for them
    await denied(set(state(b), holdemState(uids, { version: 2, toAct: 2, by: b.uid, kind: 'away' })));
    await remove(presence);
    // gone: allowed, but only as an `away` move, and only by a player at the table
    await denied(set(state(b), holdemState(uids, { version: 2, toAct: 2, by: b.uid, kind: 'fold' })));
    const outsider = await player('holdem');
    await denied(set(state(outsider), holdemState(uids, { version: 2, toAct: 2, by: outsider.uid, kind: 'away' })));
    await set(state(b), holdemState(uids, { version: 2, toAct: 2, by: b.uid, kind: 'away' }));
  });
});

describe('server behaviour', () => {
  test('onDisconnect fires when the socket closes', async () => {
    const host = await player('gin-rummy');
    const code = 'XYZ23';
    const now = Date.now();
    await set(ref(host.db, `rooms/${code}`), { meta: { host: host.uid, hostName: 'H', status: 'waiting', createdAt: now, updatedAt: now } });
    const pres = ref(host.db, `rooms/${code}/presence/${host.uid}`);
    await onDisconnect(pres).update({ online: false, lastSeen: serverTimestamp() });
    await set(pres, { online: true, lastSeen: serverTimestamp() });
    const watcher = await player('gin-rummy');
    // drop the host's socket
    host.client['ws'].close();
    await waitFor(async () => (await get(ref(watcher.db, `rooms/${code}/presence/${host.uid}/online`))).val() === false);
  });

  test('.info/connected reports the socket state', async () => {
    const p = await player('gin-rummy');
    const states = [];
    onValue(ref(p.db, '.info/connected'), (s) => states.push(s.val()));
    await waitFor(() => states.includes(true));
  });

  test('reaper removes rooms idle for a day; data persists across restarts', async () => {
    const host = await player('backgammon');
    const old = Date.now() - 2 * 86_400_000;
    const db = server.dbs.get('backgammon');
    db.writeAsServer([{ segs: ['bgRooms', 'OLD22'], value: { meta: { host: host.uid, status: 'waiting', createdAt: old, updatedAt: old } } }]);
    db.writeAsServer([{ segs: ['bgRooms', 'NEW22'], value: { meta: { host: host.uid, status: 'waiting', createdAt: Date.now(), updatedAt: Date.now() } } }]);
    server.reap();
    assert.equal(db.get(['bgRooms', 'OLD22']), null);
    const reloaded = new Store(join(dir, 'db.sqlite')).load('backgammon');
    assert.ok(reloaded.bgRooms.NEW22);
    assert.equal(reloaded.bgRooms.OLD22, undefined);
  });

  test('prototype keys and illegal paths are rejected', async () => {
    const p = await player('gin-rummy');
    await assert.rejects(set(ref(p.db, 'rooms/__proto__/meta'), { host: p.uid }), /invalid path/);
    await assert.rejects(update(ref(p.db, 'rooms'), { 'constructor/x': 1 }), /invalid path/);
    await assert.rejects(set(ref(p.db, 'rooms/ABC.D'), 1), /invalid path/);
    assert.equal(({}).polluted, undefined);
  });

  test('arrays round-trip the way RTDB returns them', async () => {
    const host = await player('gin-rummy');
    const code = 'ARR22';
    const now = Date.now();
    await set(ref(host.db, `rooms/${code}`), { meta: { host: host.uid, hostName: 'H', status: 'waiting', createdAt: now, updatedAt: now } });
    await set(ref(host.db, `rooms/${code}/state`), { version: 0, turnUid: host.uid, lastMove: { by: host.uid }, hand: ['a', 'b'], empty: [], none: {} });
    const s = (await get(ref(host.db, `rooms/${code}/state`))).val();
    assert.deepEqual(s.hand, ['a', 'b']);
    assert.equal('empty' in s, false);
    assert.equal('none' in s, false);
  });
});
