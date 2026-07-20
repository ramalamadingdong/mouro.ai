/**
 * replay.ts — shared loading/coercion for archived matches.
 *
 * Both extract-features.ts and head-to-head.ts read the same `matches` dump, so
 * the defensive coercion lives here once. Realtime Database is lossy in two ways
 * that matter:
 *   - It prunes empty arrays and may deliver arrays as integer-keyed objects.
 *   - It coerces an object with contiguous integer keys into a JSON ARRAY. Our
 *     log keys start at 1 (version 0 is `initial`), so a real dump arrives as
 *     `[null, {…}, {…}]` — the null hole at index 0 MUST be skipped.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Move, Seat } from '../../src/engine/types';

export type Json = any;

export interface LogEntry {
  v: number;
  seat: Seat;
  move: Move;
}

export function asNumArray(v: Json): number[] {
  if (Array.isArray(v)) return v.map(Number).filter((n) => Number.isFinite(n));
  if (v && typeof v === 'object') {
    return Object.keys(v)
      .filter((k) => /^\d+$/.test(k))
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => Number(v[k]))
      .filter((n) => Number.isFinite(n));
  }
  return [];
}

/** Reconstruct a well-typed Move from a logged (possibly RTDB-pruned) entry. */
export function coerceMove(m: Json): Move {
  const kind = m?.kind;
  switch (kind) {
    case 'discard':
      return { kind, card: Number(m.card) };
    case 'knock':
      return { kind, discard: Number(m.discard) };
    case 'nextRound':
    case 'rematch':
      return { kind, seed: asNumArray(m.seed) };
    case 'takeUpcard':
    case 'passUpcard':
    case 'drawStock':
    case 'drawDiscard':
    case 'bigGin':
      return { kind };
    default:
      throw new Error(`unknown move kind: ${JSON.stringify(kind)}`);
  }
}

/**
 * Sort a log (object keyed by version, or an RTDB-coerced array) into an
 * ascending move stream. Null/absent holes are skipped — see module header.
 */
export function sortLog(log: Json): LogEntry[] {
  if (!log || typeof log !== 'object') return [];
  const out: LogEntry[] = [];
  for (const k of Object.keys(log)) {
    if (!/^\d+$/.test(k)) continue;
    const e = log[k];
    if (!e || typeof e !== 'object' || !e.seat || !e.move) continue;
    out.push({ v: Number(k), seat: e.seat as Seat, move: coerceMove(e.move) });
  }
  return out.sort((a, b) => a.v - b.v);
}

/** Load a dump: either the `matches` node itself, or a full export containing it. */
export function loadMatches(path: string): Record<string, Json> {
  const raw = JSON.parse(readFileSync(resolve(path), 'utf8'));
  return raw?.matches ?? raw ?? {};
}
