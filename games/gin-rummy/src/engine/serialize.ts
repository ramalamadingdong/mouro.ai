/**
 * Snapshot repair + validation. RTDB prunes empty arrays/objects and null
 * fields, and may deliver arrays as integer-keyed objects. `normalize` coerces
 * a raw snapshot back into a well-formed GameState, or returns null if the
 * shape is fundamentally invalid.
 */
import type {
  CardId,
  GameState,
  LastMove,
  MatchResult,
  Meld,
  RoundResult,
  Seat,
} from './types';

const PHASES = ['upcard1', 'upcard2', 'draw', 'discard', 'roundOver', 'matchOver'];
const SEATS = ['p0', 'p1'];
const ROUND_RESULT_TYPES = ['knock', 'gin', 'bigGin', 'undercut', 'void'];
const MOVE_KINDS = [
  'takeUpcard',
  'passUpcard',
  'drawStock',
  'drawDiscard',
  'discard',
  'knock',
  'bigGin',
  'nextRound',
  'rematch',
];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Coerce a value that should be an array (may be pruned or integer-keyed). */
function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (isObj(v)) {
    const keys = Object.keys(v);
    if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
      const sorted = keys.map(Number).sort((a, b) => a - b);
      return sorted.map((n) => (v as Record<string, unknown>)[String(n)]);
    }
    return [];
  }
  return [];
}

/** Array of CardId (numbers). */
function asNumArray(v: unknown): CardId[] {
  return asArray(v)
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));
}

/** Array of melds (arrays of CardId). */
function asMeldArray(v: unknown): Meld[] {
  return asArray(v).map((m) => asNumArray(m));
}

function asSeatNumRecord(v: unknown): Record<Seat, number> | null {
  if (!isObj(v)) return null;
  const p0 = Number(v.p0);
  const p1 = Number(v.p1);
  if (!Number.isFinite(p0) || !Number.isFinite(p1)) return null;
  return { p0, p1 };
}

function asSeatStrRecord(v: unknown): Record<Seat, string> | null {
  if (!isObj(v)) return null;
  if (typeof v.p0 !== 'string' || typeof v.p1 !== 'string') return null;
  return { p0: v.p0, p1: v.p1 };
}

function asSeatCardsRecord(v: unknown): Record<Seat, CardId[]> {
  const o = isObj(v) ? v : {};
  return { p0: asNumArray(o.p0), p1: asNumArray(o.p1) };
}

function isSeat(v: unknown): v is Seat {
  return v === 'p0' || v === 'p1';
}

function normalizeLayoffs(v: unknown): RoundResult['layoffs'] {
  return asArray(v)
    .filter(isObj)
    .map((o) => ({ card: Number(o.card), meldIndex: Number(o.meldIndex) }))
    .filter((o) => Number.isFinite(o.card) && Number.isFinite(o.meldIndex));
}

function normalizeRoundResult(v: unknown): RoundResult | null {
  if (!isObj(v)) return null;
  if (typeof v.type !== 'string' || !ROUND_RESULT_TYPES.includes(v.type)) return null;
  const deadwood = asSeatNumRecord(v.deadwood) ?? { p0: 0, p1: 0 };
  const handAtReveal = asSeatCardsRecord(v.handAtReveal);
  // RTDB prunes null fields; a finite id (including 0 = A♣) round-trips, anything
  // else (missing/pruned) becomes null. Never use `|| null` — 0 is falsy.
  const kc = Number(v.knockCard);
  return {
    type: v.type as RoundResult['type'],
    knocker: isSeat(v.knocker) ? v.knocker : null,
    knockerMelds: asMeldArray(v.knockerMelds),
    knockerDeadwoodCards: asNumArray(v.knockerDeadwoodCards),
    defenderMelds: asMeldArray(v.defenderMelds),
    defenderDeadwoodCards: asNumArray(v.defenderDeadwoodCards),
    layoffs: normalizeLayoffs(v.layoffs),
    deadwood,
    winner: isSeat(v.winner) ? v.winner : null,
    points: Number(v.points) || 0,
    knockCard: Number.isFinite(kc) ? kc : null,
    handAtReveal,
  };
}

function normalizeMatchResult(v: unknown): MatchResult | null {
  if (!isObj(v)) return null;
  if (!isSeat(v.winner)) return null;
  const base = asSeatNumRecord(v.base);
  const boxes = asSeatNumRecord(v.boxes);
  const final = asSeatNumRecord(v.final);
  if (!base || !boxes || !final) return null;
  return {
    winner: v.winner,
    base,
    boxes,
    gameBonusTo: isSeat(v.gameBonusTo) ? v.gameBonusTo : v.winner,
    shutout: Boolean(v.shutout),
    final,
  };
}

function normalizeLastMove(v: unknown): LastMove | null {
  if (!isObj(v)) return null;
  if (typeof v.by !== 'string' || !isSeat(v.seat)) return null;
  if (typeof v.kind !== 'string' || !MOVE_KINDS.includes(v.kind)) return null;
  const lm: LastMove = {
    by: v.by,
    seat: v.seat,
    kind: v.kind as LastMove['kind'],
    at: Number(v.at) || 0,
  };
  if (v.card !== undefined && v.card !== null && Number.isFinite(Number(v.card))) {
    lm.card = Number(v.card);
  }
  return lm;
}

/** Repair + validate a raw snapshot into a GameState (or null). */
export function normalize(raw: unknown): GameState | null {
  if (!isObj(raw)) return null;

  const players = asSeatStrRecord(raw.players);
  const names = asSeatStrRecord(raw.names);
  if (!players || !names) return null;

  const scores = asSeatNumRecord(raw.scores);
  const boxes = asSeatNumRecord(raw.boxes);
  if (!scores || !boxes) return null;

  if (typeof raw.phase !== 'string' || !PHASES.includes(raw.phase)) return null;
  if (!isSeat(raw.dealer) || !isSeat(raw.turn)) return null;
  if (typeof raw.turnUid !== 'string') return null;

  const version = Number(raw.version);
  const target = Number(raw.target);
  const round = Number(raw.round);
  if (!Number.isFinite(version) || !Number.isFinite(target) || !Number.isFinite(round)) {
    return null;
  }

  const noDiscard =
    raw.noDiscard === undefined || raw.noDiscard === null
      ? null
      : Number.isFinite(Number(raw.noDiscard))
        ? Number(raw.noDiscard)
        : null;

  const state: GameState = {
    version,
    players,
    names,
    target,
    scores,
    boxes,
    round,
    dealer: raw.dealer,
    phase: raw.phase as GameState['phase'],
    turn: raw.turn,
    turnUid: raw.turnUid,
    noDiscard,
    stock: asNumArray(raw.stock),
    discard: asNumArray(raw.discard),
    hands: asSeatCardsRecord(raw.hands),
    roundResult:
      raw.roundResult === undefined || raw.roundResult === null
        ? null
        : normalizeRoundResult(raw.roundResult),
    matchResult:
      raw.matchResult === undefined || raw.matchResult === null
        ? null
        : normalizeMatchResult(raw.matchResult),
    lastMove:
      raw.lastMove === undefined || raw.lastMove === null
        ? null
        : normalizeLastMove(raw.lastMove),
  };

  // A terminal phase must carry its result object; otherwise the snapshot is
  // internally inconsistent (corrupt/hand-edited) and cannot be trusted.
  if (state.phase === 'roundOver' && state.roundResult === null) return null;
  if (state.phase === 'matchOver' && state.matchResult === null) return null;

  return state;
}
