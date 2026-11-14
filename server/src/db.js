// One in-memory JSON tree per game, persisted to SQLite.
//
// Each game gets its own database (its own tree, rules and namespace), so
// gin rummy's `rooms/` and yahtzee's `rooms/` never collide.
//
// Persistence granularity is the second path segment (e.g. `rooms/ABCDE`): a
// room is a few KB, so rewriting the whole room row on every move is cheap and
// keeps the storage model trivially simple.

import { DatabaseSync } from 'node:sqlite';
import { getAt, setAt, splitPath, toStore } from './tree.js';

export class Store {
  constructor(file) {
    this.sql = new DatabaseSync(file);
    this.sql.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS nodes (
        db   TEXT NOT NULL,
        key  TEXT NOT NULL,
        json TEXT NOT NULL,
        PRIMARY KEY (db, key)
      );
    `);
    this._put = this.sql.prepare('INSERT INTO nodes (db, key, json) VALUES (?, ?, ?) ON CONFLICT(db, key) DO UPDATE SET json = excluded.json');
    this._del = this.sql.prepare('DELETE FROM nodes WHERE db = ? AND key = ?');
    this._delPrefix = this.sql.prepare("DELETE FROM nodes WHERE db = ? AND (key = ? OR key LIKE ? ESCAPE '\\')");
    this._load = this.sql.prepare('SELECT key, json FROM nodes WHERE db = ?');
  }

  load(dbName) {
    let root = null;
    for (const row of this._load.all(dbName)) {
      root = setAt(root, splitPath(row.key), JSON.parse(row.json));
    }
    return root;
  }

  /** Persist the given unit keys (depth ≤ 2) from `root`. */
  flush(dbName, root, unitKeys) {
    this.sql.exec('BEGIN');
    try {
      for (const key of unitKeys) {
        const segs = splitPath(key);
        if (segs.length === 1) {
          // A whole top-level node was replaced: rewrite all of its units.
          const esc = key.replace(/[\\%_]/g, (c) => '\\' + c);
          this._delPrefix.run(dbName, key, esc + '/%');
          const v = getAt(root, segs);
          if (v !== null && typeof v === 'object') {
            for (const [k, x] of Object.entries(v)) this._put.run(dbName, `${key}/${k}`, JSON.stringify(x));
          } else if (v !== null) {
            this._put.run(dbName, key, JSON.stringify(v));
          }
        } else {
          const v = getAt(root, segs);
          if (v === null) this._del.run(dbName, key);
          else this._put.run(dbName, key, JSON.stringify(v));
        }
      }
      this.sql.exec('COMMIT');
    } catch (err) {
      this.sql.exec('ROLLBACK');
      throw err;
    }
  }
}

/** Which persistence units a write at `segs` touches. */
export function unitsFor(segs, root) {
  if (segs.length === 0) return Object.keys(root ?? {});
  if (segs.length === 1) return [segs[0]];
  return [`${segs[0]}/${segs[1]}`];
}

export class GameDb {
  constructor(name, rules, store) {
    this.name = name;
    this.rules = rules;
    this.store = store;
    this.root = store.load(name);
    /** @type {Set<(changed: string[][]) => void>} */
    this.listeners = new Set();
  }

  get(segs) {
    return getAt(this.root, segs);
  }

  /**
   * Apply writes atomically: [{segs, value(stored form)}]. Returns the new root
   * without committing so the caller can rule-check it first.
   */
  preview(writes) {
    let next = this.root;
    for (const w of writes) next = setAt(next, w.segs, w.value);
    return next;
  }

  commit(nextRoot, writes) {
    const prev = this.root;
    this.root = nextRoot;
    const units = new Set();
    for (const w of writes) for (const u of unitsFor(w.segs, prev)) units.add(u);
    if (writes.some((w) => w.segs.length === 0)) for (const u of unitsFor([], nextRoot)) units.add(u);
    this.store.flush(this.name, nextRoot, units);
    const changed = writes.map((w) => w.segs);
    for (const l of this.listeners) l(changed);
  }

  /** Rule-checked write as `auth`. Returns true when committed. */
  write(auth, writes, now = Date.now()) {
    const next = this.preview(writes);
    for (const w of writes) {
      if (!this.rules.canWrite(w.segs.join('/'), auth, this.root, next, now)) return false;
    }
    this.commit(next, writes);
    return true;
  }

  /** Server-side write that bypasses rules (used by the reaper). */
  writeAsServer(writes) {
    this.commit(this.preview(writes), writes);
  }
}

export { toStore };
