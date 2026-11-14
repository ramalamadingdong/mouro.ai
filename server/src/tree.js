// JSON-tree helpers that reproduce the Realtime Database's value semantics,
// so the games' `normalize()` functions see exactly the shapes they were
// written against:
//
//   - null and empty objects/arrays are never stored (writing them deletes);
//   - arrays are stored as objects keyed "0", "1", ...;
//   - on read, an object whose keys are all small non-negative integers comes
//     back as an array (holes filled with null) — the RTDB heuristic.

export function splitPath(path) {
  return String(path ?? '')
    .split('/')
    .filter((s) => s.length > 0);
}

export function joinPath(segs) {
  return segs.join('/');
}

/** Incoming value → stored form (objects only, pruned). */
export function toStore(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) {
    const o = {};
    v.forEach((x, i) => {
      const s = toStore(x);
      if (s !== null) o[String(i)] = s;
    });
    return Object.keys(o).length ? o : null;
  }
  if (typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      const s = toStore(x);
      if (s !== null) o[k] = s;
    }
    return Object.keys(o).length ? o : null;
  }
  if (typeof v === 'number' && !Number.isFinite(v)) return null;
  return v;
}

/** Stored form → value as a client sees it (array heuristic applied). */
export function fromStore(v) {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object') return v;
  const keys = Object.keys(v);
  const allInts = keys.length > 0 && keys.every((k) => /^(0|[1-9][0-9]{0,8})$/.test(k));
  if (allInts) {
    const max = Math.max(...keys.map(Number));
    if (max < keys.length * 2) {
      const arr = new Array(max + 1).fill(null);
      for (const k of keys) arr[Number(k)] = fromStore(v[k]);
      return arr;
    }
  }
  const o = {};
  for (const k of keys) o[k] = fromStore(v[k]);
  return o;
}

export function getAt(root, segs) {
  let cur = root;
  for (const s of segs) {
    if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, s)) return null;
    cur = cur[s];
  }
  return cur ?? null;
}

/**
 * Returns a NEW root with `value` (already in stored form) placed at `segs`.
 * Structural sharing: only the spine is copied. Empty parents are pruned.
 */
export function setAt(root, segs, value) {
  if (segs.length === 0) return value;
  const [head, ...rest] = segs;
  const base = root !== null && typeof root === 'object' ? { ...root } : {};
  const child = setAt(base[head] ?? null, rest, value);
  if (child === null) delete base[head];
  else base[head] = child;
  return Object.keys(base).length ? base : null;
}

/** Replace {".sv":"timestamp"} sentinels with the server clock. */
export function resolveServerValues(v, now) {
  if (v === null || typeof v !== 'object') return v;
  if (!Array.isArray(v) && v['.sv'] === 'timestamp' && Object.keys(v).length === 1) return now;
  if (Array.isArray(v)) return v.map((x) => resolveServerValues(x, now));
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = resolveServerValues(x, now);
  return o;
}

/** Order-independent JSON, used to compare transaction bases. */
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

// Firebase's key rules (no . # $ [ ] /), plus names that would reach an
// object's prototype chain.
const BAD_KEY = /[.#$\[\]\/\u0000-\u001f\u007f]/;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
export function validKey(k) {
  return typeof k === 'string' && k.length > 0 && k.length <= 768 && !BAD_KEY.test(k) && !RESERVED.has(k);
}

export function validKeys(v, depth = 0) {
  if (depth > 32) return false;
  if (v === null || typeof v !== 'object') return true;
  for (const [k, x] of Object.entries(v)) {
    if (!Array.isArray(v) && !validKey(k)) return false;
    if (!validKeys(x, depth + 1)) return false;
  }
  return true;
}
