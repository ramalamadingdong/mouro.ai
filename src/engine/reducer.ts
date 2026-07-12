/**
 * The single source of game truth. Pure reducer over GameState.
 *
 * `applyMove` never mutates its input: it deep-clones, mutates the clone,
 * bumps `version`, sets `lastMove`, and keeps `turnUid = players[turn]`.
 */
import type {
  ApplyResult,
  CardId,
  GameState,
  LastMove,
  MatchResult,
  Meld,
  Move,
  MoveKind,
  RoundResult,
  Seat,
} from './types';
import { makeDeck } from './cards';
import { makeRng, shuffle } from './rng';
import { bestArrangement, isBigGin, knockOptions } from './melds';
import { bestLayoff } from './layoffs';
import { SCORING } from './scoring';

/** The seat opposite `seat`. */
export function otherSeat(seat: Seat): Seat {
  return seat === 'p0' ? 'p1' : 'p0';
}

/** The seat for a uid, or null if the uid is not a player. */
export function seatOf(state: GameState, uid: string): Seat | null {
  if (state.players.p0 === uid) return 'p0';
  if (state.players.p1 === uid) return 'p1';
  return null;
}

/** Deterministic deep clone of a JSON-clean state. */
function clone(s: GameState): GameState {
  return JSON.parse(JSON.stringify(s)) as GameState;
}

/** Deal the per-round fields for `dealer`, returning a partial state patch. */
function dealRound(
  seed: number[],
  dealer: Seat,
): Pick<
  GameState,
  'stock' | 'discard' | 'hands' | 'phase' | 'turn' | 'noDiscard' | 'dealer'
> {
  const nonDealer = otherSeat(dealer);
  const deck = shuffle(makeDeck(), makeRng(seed));
  const hands: Record<Seat, CardId[]> = { p0: [], p1: [] };
  hands[nonDealer] = deck.slice(0, 10);
  hands[dealer] = deck.slice(10, 20);
  const upcard = deck[20];
  const stock = deck.slice(21);
  const discard = [upcard];
  return {
    stock,
    discard,
    hands,
    phase: 'upcard1',
    turn: nonDealer,
    noDiscard: null,
    dealer,
  };
}

/** Create the initial match state (round 1 dealt, upcard turned, phase upcard1). */
export function initialMatchState(args: {
  hostUid: string;
  guestUid: string;
  hostName: string;
  guestName: string;
  seed: number[];
  target?: number;
}): GameState {
  const dealer: Seat = 'p1'; // round 1 dealer is p1; host p0 acts first
  const patch = dealRound(args.seed, dealer);
  const players: Record<Seat, string> = { p0: args.hostUid, p1: args.guestUid };
  return {
    version: 0,
    players,
    names: { p0: args.hostName, p1: args.guestName },
    target: args.target ?? SCORING.TARGET,
    scores: { p0: 0, p1: 0 },
    boxes: { p0: 0, p1: 0 },
    round: 1,
    dealer: patch.dealer,
    phase: patch.phase,
    turn: patch.turn,
    turnUid: players[patch.turn],
    noDiscard: patch.noDiscard,
    stock: patch.stock,
    discard: patch.discard,
    hands: patch.hands,
    roundResult: null,
    matchResult: null,
    lastMove: null,
  };
}

function reject(error: string): ApplyResult {
  return { ok: false, error };
}

/** Stock size immediately after the deal (before any draw): 52 - 2*hand - upcard. */
const INITIAL_STOCK = 52 - 2 * SCORING.HAND_SIZE - 1;

/**
 * True when the draw phase was entered because BOTH players passed the initial
 * upcard. Real gin rummy (and the spec prose) require the non-dealer to draw
 * from STOCK here: the refused upcard may not be taken until a later discard
 * covers it. Signature: nothing has been drawn or discarded yet, so the stock is
 * still full and the discard pile holds only the original upcard.
 */
function isInitialForcedStockDraw(state: GameState): boolean {
  return (
    state.phase === 'draw' &&
    state.stock.length === INITIAL_STOCK &&
    state.discard.length === 1
  );
}

/** Finalize a successful move: bump version, sync turnUid, record lastMove. */
function commit(
  s: GameState,
  uid: string,
  seat: Seat,
  kind: MoveKind,
  card: CardId | undefined,
  baseVersion: number,
): ApplyResult {
  s.version = baseVersion + 1;
  s.turnUid = s.players[s.turn];
  const lastMove: LastMove = { by: uid, seat, kind, at: Date.now() };
  if (card !== undefined) lastMove.card = card;
  s.lastMove = lastMove;
  return { ok: true, state: s };
}

/** Apply end-of-round scoring + match-end detection given a built RoundResult. */
function scoreRound(s: GameState, result: RoundResult): void {
  if (result.winner) {
    s.scores[result.winner] += result.points;
    s.boxes[result.winner] += 1;
  }
  s.roundResult = result;
  const w = result.winner;
  if (w && s.scores[w] >= s.target) {
    s.phase = 'matchOver';
    s.matchResult = buildMatchResult(s, w);
  } else {
    s.phase = 'roundOver';
    s.matchResult = null;
  }
}

function buildMatchResult(s: GameState, winner: Seat): MatchResult {
  const loser = otherSeat(winner);
  const base: Record<Seat, number> = { p0: s.scores.p0, p1: s.scores.p1 };
  const boxes: Record<Seat, number> = { p0: s.boxes.p0, p1: s.boxes.p1 };
  let winnerFinal = base[winner] + SCORING.GAME + SCORING.BOX * boxes[winner];
  const loserFinal = base[loser] + SCORING.BOX * boxes[loser];
  const shutout = base[loser] === 0;
  if (shutout) winnerFinal *= SCORING.SHUTOUT_X;
  const final: Record<Seat, number> = { p0: 0, p1: 0 };
  final[winner] = winnerFinal;
  final[loser] = loserFinal;
  return { winner, base, boxes, gameBonusTo: winner, shutout, final };
}

/** Build a reveal RoundResult from the resolved melds/deadwood. */
function makeRoundResult(args: {
  type: RoundResult['type'];
  knocker: Seat;
  knockerMelds: Meld[];
  knockerDeadwoodCards: CardId[];
  knockerDeadwood: number;
  defenderMelds: Meld[];
  defenderDeadwoodCards: CardId[];
  defenderDeadwood: number;
  layoffs: RoundResult['layoffs'];
  winner: Seat;
  points: number;
  knockerHand: CardId[];
  defenderHand: CardId[];
}): RoundResult {
  const defender = otherSeat(args.knocker);
  const deadwood: Record<Seat, number> = { p0: 0, p1: 0 };
  deadwood[args.knocker] = args.knockerDeadwood;
  deadwood[defender] = args.defenderDeadwood;
  const handAtReveal: Record<Seat, CardId[]> = { p0: [], p1: [] };
  handAtReveal[args.knocker] = args.knockerHand.slice();
  handAtReveal[defender] = args.defenderHand.slice();
  return {
    type: args.type,
    knocker: args.knocker,
    knockerMelds: args.knockerMelds,
    knockerDeadwoodCards: args.knockerDeadwoodCards,
    defenderMelds: args.defenderMelds,
    defenderDeadwoodCards: args.defenderDeadwoodCards,
    layoffs: args.layoffs,
    deadwood,
    winner: args.winner,
    points: args.points,
    handAtReveal,
  };
}

/** Apply a move. Pure: returns a fresh state or a rejection. */
export function applyMove(state: GameState, move: Move, uid: string): ApplyResult {
  const baseVersion = state.version;
  const actingSeat = seatOf(state, uid);

  // nextRound / rematch: either player may act, only in the terminal phases.
  if (move.kind === 'nextRound') {
    if (state.phase !== 'roundOver') return reject('nextRound only allowed in roundOver');
    if (actingSeat === null) return reject('not a player');
    const s = clone(state);
    const wasVoid = state.roundResult?.type === 'void';
    const nextDealer = wasVoid ? state.dealer : otherSeat(state.dealer);
    const patch = dealRound(move.seed, nextDealer);
    s.round = state.round + 1;
    s.dealer = patch.dealer;
    s.phase = patch.phase;
    s.turn = patch.turn;
    s.noDiscard = patch.noDiscard;
    s.stock = patch.stock;
    s.discard = patch.discard;
    s.hands = patch.hands;
    s.roundResult = null;
    s.matchResult = null;
    return commit(s, uid, actingSeat, move.kind, undefined, baseVersion);
  }

  if (move.kind === 'rematch') {
    if (state.phase !== 'matchOver') return reject('rematch only allowed in matchOver');
    if (actingSeat === null) return reject('not a player');
    const s = clone(state);
    const dealer: Seat = 'p1';
    const patch = dealRound(move.seed, dealer);
    s.scores = { p0: 0, p1: 0 };
    s.boxes = { p0: 0, p1: 0 };
    s.round = 1;
    s.dealer = patch.dealer;
    s.phase = patch.phase;
    s.turn = patch.turn;
    s.noDiscard = patch.noDiscard;
    s.stock = patch.stock;
    s.discard = patch.discard;
    s.hands = patch.hands;
    s.roundResult = null;
    s.matchResult = null;
    return commit(s, uid, actingSeat, move.kind, undefined, baseVersion);
  }

  // All other moves require it to be the caller's turn.
  if (actingSeat === null) return reject('not a player');
  if (uid !== state.turnUid) return reject('not your turn');
  const turn = state.turn;

  switch (move.kind) {
    case 'takeUpcard': {
      if (state.phase !== 'upcard1' && state.phase !== 'upcard2') {
        return reject('takeUpcard only allowed in upcard phase');
      }
      if (state.discard.length === 0) return reject('discard pile is empty');
      const s = clone(state);
      const taken = s.discard.pop()!;
      s.hands[turn].push(taken);
      s.noDiscard = taken;
      s.phase = 'discard';
      return commit(s, uid, turn, move.kind, taken, baseVersion);
    }

    case 'passUpcard': {
      if (state.phase === 'upcard1') {
        const s = clone(state);
        s.phase = 'upcard2';
        s.turn = state.dealer;
        return commit(s, uid, turn, move.kind, undefined, baseVersion);
      }
      if (state.phase === 'upcard2') {
        const s = clone(state);
        s.phase = 'draw';
        s.turn = otherSeat(state.dealer); // non-dealer draws stock
        return commit(s, uid, turn, move.kind, undefined, baseVersion);
      }
      return reject('passUpcard only allowed in upcard phase');
    }

    case 'drawStock': {
      if (state.phase !== 'draw') return reject('drawStock only allowed in draw phase');
      if (state.stock.length === 0) return reject('stock is empty');
      const s = clone(state);
      const drawn = s.stock.pop()!;
      s.hands[turn].push(drawn);
      s.noDiscard = null;
      s.phase = 'discard';
      return commit(s, uid, turn, move.kind, undefined, baseVersion);
    }

    case 'drawDiscard': {
      if (state.phase !== 'draw') return reject('drawDiscard only allowed in draw phase');
      if (isInitialForcedStockDraw(state)) {
        return reject('must draw from stock after both players pass the upcard');
      }
      if (state.discard.length === 0) return reject('discard pile is empty');
      const s = clone(state);
      const taken = s.discard.pop()!;
      s.hands[turn].push(taken);
      s.noDiscard = taken;
      s.phase = 'discard';
      return commit(s, uid, turn, move.kind, taken, baseVersion);
    }

    case 'discard': {
      if (state.phase !== 'discard') return reject('discard only allowed in discard phase');
      const card = move.card;
      if (!state.hands[turn].includes(card)) return reject('card not in hand');
      if (state.noDiscard !== null && card === state.noDiscard) {
        return reject('cannot discard the just-taken card');
      }
      const s = clone(state);
      const hand = s.hands[turn];
      hand.splice(hand.indexOf(card), 1);
      s.discard.push(card);
      s.noDiscard = null;
      s.turn = otherSeat(turn);
      s.phase = 'draw';
      // Void check: stock exhausted.
      if (s.stock.length <= 2) {
        const result: RoundResult = {
          type: 'void',
          knocker: null,
          knockerMelds: [],
          knockerDeadwoodCards: [],
          defenderMelds: [],
          defenderDeadwoodCards: [],
          layoffs: [],
          deadwood: { p0: 0, p1: 0 },
          winner: null,
          points: 0,
          handAtReveal: { p0: s.hands.p0.slice(), p1: s.hands.p1.slice() },
        };
        s.roundResult = result;
        s.phase = 'roundOver';
        s.matchResult = null;
      }
      return commit(s, uid, turn, move.kind, card, baseVersion);
    }

    case 'knock': {
      if (state.phase !== 'discard') return reject('knock only allowed in discard phase');
      const card = move.discard;
      if (!state.hands[turn].includes(card)) return reject('card not in hand');
      if (state.noDiscard !== null && card === state.noDiscard) {
        return reject('cannot discard the just-taken card');
      }
      const knocker = turn;
      const defender = otherSeat(knocker);
      const knockerHand = state.hands[knocker].filter((c) => c !== card);
      const arr = bestArrangement(knockerHand);
      if (arr.deadwoodValue > SCORING.KNOCK_MAX) {
        return reject('deadwood exceeds knock maximum');
      }
      const s = clone(state);
      const kh = s.hands[knocker];
      kh.splice(kh.indexOf(card), 1);
      s.discard.push(card);
      s.noDiscard = null;
      const defenderHand = s.hands[defender];

      let result: RoundResult;
      if (arr.deadwoodValue === 0) {
        // GIN: defender gets no layoffs.
        const dArr = bestArrangement(defenderHand);
        const points = dArr.deadwoodValue + SCORING.GIN;
        result = makeRoundResult({
          type: 'gin',
          knocker,
          knockerMelds: arr.melds,
          knockerDeadwoodCards: arr.deadwood,
          knockerDeadwood: 0,
          defenderMelds: dArr.melds,
          defenderDeadwoodCards: dArr.deadwood,
          defenderDeadwood: dArr.deadwoodValue,
          layoffs: [],
          winner: knocker,
          points,
          knockerHand: kh,
          defenderHand,
        });
      } else {
        // Normal knock: defender lays off.
        const lay = bestLayoff(defenderHand, arr.melds);
        if (lay.deadwoodValue <= arr.deadwoodValue) {
          // UNDERCUT: defender wins (ties go to defender).
          const points = arr.deadwoodValue - lay.deadwoodValue + SCORING.UNDERCUT;
          result = makeRoundResult({
            type: 'undercut',
            knocker,
            knockerMelds: arr.melds,
            knockerDeadwoodCards: arr.deadwood,
            knockerDeadwood: arr.deadwoodValue,
            defenderMelds: lay.melds,
            defenderDeadwoodCards: lay.deadwood,
            defenderDeadwood: lay.deadwoodValue,
            layoffs: lay.layoffs,
            winner: defender,
            points,
            knockerHand: kh,
            defenderHand,
          });
        } else {
          const points = lay.deadwoodValue - arr.deadwoodValue;
          result = makeRoundResult({
            type: 'knock',
            knocker,
            knockerMelds: arr.melds,
            knockerDeadwoodCards: arr.deadwood,
            knockerDeadwood: arr.deadwoodValue,
            defenderMelds: lay.melds,
            defenderDeadwoodCards: lay.deadwood,
            defenderDeadwood: lay.deadwoodValue,
            layoffs: lay.layoffs,
            winner: knocker,
            points,
            knockerHand: kh,
            defenderHand,
          });
        }
      }
      scoreRound(s, result);
      return commit(s, uid, turn, move.kind, card, baseVersion);
    }

    case 'bigGin': {
      if (state.phase !== 'discard') return reject('bigGin only allowed in discard phase');
      const knocker = turn;
      if (!isBigGin(state.hands[knocker])) return reject('hand is not big gin');
      const defender = otherSeat(knocker);
      const s = clone(state);
      const knockerHand = s.hands[knocker];
      const arr = bestArrangement(knockerHand);
      const defenderHand = s.hands[defender];
      const dArr = bestArrangement(defenderHand);
      const points = dArr.deadwoodValue + SCORING.BIG_GIN;
      const result = makeRoundResult({
        type: 'bigGin',
        knocker,
        knockerMelds: arr.melds,
        knockerDeadwoodCards: arr.deadwood,
        knockerDeadwood: 0,
        defenderMelds: dArr.melds,
        defenderDeadwoodCards: dArr.deadwood,
        defenderDeadwood: dArr.deadwoodValue,
        layoffs: [],
        winner: knocker,
        points,
        knockerHand,
        defenderHand,
      });
      scoreRound(s, result);
      return commit(s, uid, turn, move.kind, undefined, baseVersion);
    }

    default:
      return reject('unknown move');
  }
}

/** Legal move kinds for `uid` in the given state. */
export function legalMoves(state: GameState, uid: string): MoveKind[] {
  if (state.phase === 'roundOver') return ['nextRound'];
  if (state.phase === 'matchOver') return ['rematch'];
  if (uid !== state.turnUid) return [];
  const seat = state.turn;
  switch (state.phase) {
    case 'upcard1':
    case 'upcard2':
      return ['takeUpcard', 'passUpcard'];
    case 'draw':
      if (isInitialForcedStockDraw(state)) return ['drawStock'];
      return state.discard.length > 0 ? ['drawStock', 'drawDiscard'] : ['drawStock'];
    case 'discard': {
      const hand = state.hands[seat];
      const moves: MoveKind[] = ['discard'];
      // The just-taken card (noDiscard) may not be discarded, so a knock option
      // that requires discarding it is not actually executable — exclude it.
      const knockable = knockOptions(hand).some(
        (o) => o.card !== state.noDiscard && o.deadwoodAfter <= SCORING.KNOCK_MAX,
      );
      if (knockable) moves.push('knock');
      if (isBigGin(hand)) moves.push('bigGin');
      return moves;
    }
    default:
      return [];
  }
}
