/**
 * Computer opponent policy for gin rummy.
 *
 * PURE TypeScript: imports only from the pure engine (`@/engine`) — no React,
 * Firebase, or Expo, and no `Math.random` (all tie-breaks are deterministic so
 * the unit tests are stable). `chooseMove` returns a single legal `Move` for the
 * seat whose turn it is; the solo store applies it via the engine reducer.
 *
 * Fairness: the CPU never reads the human's hand. Easy/Medium reason only about
 * their own hand. Hard is additionally "card-aware" using only public info — the
 * `OppModel` the store builds from what the human takes off the discard pile and
 * throws away — to prefer discards that don't feed the opponent.
 */
import {
  bestArrangement,
  deadwoodValue,
  isBigGin,
  knockOptions,
  legalMoves,
  pipValue,
  rankOf,
  seatOf,
  suitOf,
  SCORING,
  type CardId,
  type GameState,
  type Move,
} from '@/engine';

export type Difficulty = 'easy' | 'medium' | 'hard';

/**
 * Honestly-observable public info about the human, built by the solo store.
 * `wanted` = cards the human pulled off the discard pile (and kept); `discarded`
 * = cards the human threw. This is NOT the human's hand — no hidden information.
 */
export interface OppModel {
  wanted: CardId[];
  discarded: CardId[];
}

/** Per-difficulty tuning. Difficulty is a thin knob over these thresholds. */
interface Tier {
  /** Take the upcard only if it lowers deadwood by at least this much (or makes us knockable). */
  takeMinGain: number;
  /** Draw from the discard pile only if it lowers deadwood by at least this much (or makes us knockable). */
  drawMinGain: number;
  /** Hold (keep drawing toward gin) instead of knocking when deadwood <= this and stock is deep. */
  ginHoldDeadwood: number;
  /** Only hold for gin while more than this many cards remain in the stock. */
  ginHoldMinStock: number;
  /** How the non-knocking discard is chosen. */
  discardStrategy: 'min' | 'crude' | 'safe';
  /** Whether the OppModel influences play (only Hard). */
  oppAware: boolean;
}

const TIERS: Record<Difficulty, Tier> = {
  easy: {
    takeMinGain: 99, // effectively never draws the discard
    drawMinGain: 99,
    ginHoldDeadwood: 0, // never holds — knocks as soon as able
    ginHoldMinStock: 99,
    discardStrategy: 'crude',
    oppAware: false,
  },
  medium: {
    takeMinGain: 5,
    drawMinGain: 5,
    ginHoldDeadwood: 2,
    ginHoldMinStock: 10,
    discardStrategy: 'min',
    oppAware: false,
  },
  hard: {
    takeMinGain: 3,
    drawMinGain: 1, // grabs any real improvement
    ginHoldDeadwood: 3,
    ginHoldMinStock: 6,
    discardStrategy: 'safe',
    oppAware: true,
  },
};

/** Weight applied to "danger" (feeding the opponent) when Hard picks a discard. */
const DANGER_WEIGHT = 3;
/** When the human has taken this many cards off the pile, Hard stops holding for gin. */
const OPP_DEVELOPED = 3;

/** A discard candidate: the card and the deadwood left after throwing it. */
interface DiscardChoice {
  card: CardId;
  deadwoodAfter: number;
}

const topOf = (pile: CardId[]): CardId | null =>
  pile.length > 0 ? pile[pile.length - 1] : null;

/**
 * Deadwood of the best 10-card hand reachable after ADDING `card` and then
 * discarding the best OTHER card. The taken card becomes `noDiscard`, so it may
 * not be re-thrown this turn — hence we exclude it from the candidates. Used for
 * both the upcard and draw-from-discard decisions.
 */
function projectTake(hand: CardId[], card: CardId): number {
  const combined = hand.concat(card);
  let best = Infinity;
  for (const o of knockOptions(combined)) {
    if (o.card === card) continue;
    if (o.deadwoodAfter < best) best = o.deadwoodAfter;
  }
  return best;
}

/** True if `a` is a strictly better throw than `b`: lower deadwood, then higher pip, then lower id. */
function betterThrow(a: DiscardChoice, b: DiscardChoice): boolean {
  if (a.deadwoodAfter !== b.deadwoodAfter) return a.deadwoodAfter < b.deadwoodAfter;
  const pa = pipValue(a.card);
  const pb = pipValue(b.card);
  if (pa !== pb) return pa > pb;
  return a.card < b.card;
}

/** Min-deadwood discard (excluding the just-taken `noDiscard`). Also the knock discard. */
function bestDiscard(hand: CardId[], noDiscard: CardId | null): DiscardChoice {
  let best: DiscardChoice | null = null;
  for (const o of knockOptions(hand)) {
    if (noDiscard !== null && o.card === noDiscard) continue;
    const cand: DiscardChoice = { card: o.card, deadwoodAfter: o.deadwoodAfter };
    if (best === null || betterThrow(cand, best)) best = cand;
  }
  // An 11-card hand always has at least one discardable card.
  return best ?? { card: hand[0], deadwoodAfter: deadwoodValue(hand.slice(1)) };
}

/**
 * How many wanted cards a throw could feed: same rank (a set) or same suit within
 * two ranks (a run). Public info only — `wanted` is what the human took off the pile.
 */
function danger(card: CardId, wanted: CardId[]): number {
  const rc = rankOf(card);
  const sc = suitOf(card);
  let d = 0;
  for (const w of wanted) {
    const rw = rankOf(w);
    if (rw === rc) d++;
    else if (suitOf(w) === sc && Math.abs(rw - rc) <= 2) d++;
  }
  return d;
}

/** Hard's discard: minimize `deadwoodAfter + DANGER_WEIGHT * danger`, keeping our hand tight but not feeding the human. */
function safeDiscard(
  hand: CardId[],
  noDiscard: CardId | null,
  wanted: CardId[],
): DiscardChoice {
  let best: DiscardChoice | null = null;
  let bestScore = Infinity;
  for (const o of knockOptions(hand)) {
    if (noDiscard !== null && o.card === noDiscard) continue;
    const score = o.deadwoodAfter + DANGER_WEIGHT * danger(o.card, wanted);
    const cand: DiscardChoice = { card: o.card, deadwoodAfter: o.deadwoodAfter };
    if (
      best === null ||
      score < bestScore ||
      (score === bestScore && betterThrow(cand, best))
    ) {
      best = cand;
      bestScore = score;
    }
  }
  return best ?? bestDiscard(hand, noDiscard);
}

/** Easy's discard: crudely throw the highest-pip unmelded card (excluding the just-taken card). */
function crudeDiscard(hand: CardId[], noDiscard: CardId | null): CardId {
  const dead = bestArrangement(hand).deadwood.filter(
    (c) => noDiscard === null || c !== noDiscard,
  );
  if (dead.length === 0) return bestDiscard(hand, noDiscard).card;
  let best = dead[0];
  for (const c of dead) {
    const pc = pipValue(c);
    const pb = pipValue(best);
    if (pc > pb || (pc === pb && c < best)) best = c;
  }
  return best;
}

function chooseUpcard(hand: CardId[], up: CardId, tier: Tier): Move {
  const after = projectTake(hand, up);
  const gain = deadwoodValue(hand) - after;
  if (after <= SCORING.KNOCK_MAX || gain >= tier.takeMinGain) {
    return { kind: 'takeUpcard' };
  }
  return { kind: 'passUpcard' };
}

function chooseDraw(
  state: GameState,
  hand: CardId[],
  tier: Tier,
  legal: readonly string[],
): Move {
  const top = topOf(state.discard);
  if (top === null || !legal.includes('drawDiscard')) {
    return { kind: 'drawStock' };
  }
  const after = projectTake(hand, top);
  const gain = deadwoodValue(hand) - after;
  if (after <= SCORING.KNOCK_MAX || gain >= tier.drawMinGain) {
    return { kind: 'drawDiscard' };
  }
  return { kind: 'drawStock' };
}

function chooseDiscardMove(
  state: GameState,
  hand: CardId[],
  tier: Tier,
  opp: OppModel | undefined,
): Move {
  if (isBigGin(hand)) return { kind: 'bigGin' };

  const bd = bestDiscard(hand, state.noDiscard);
  if (bd.deadwoodAfter === 0) return { kind: 'knock', discard: bd.card }; // gin

  // Knock timing: usually knock when able, but briefly hold near-gin hands when
  // the stock is deep. Hard stops holding once the human's hand looks developed.
  let holdDeadwood = tier.ginHoldDeadwood;
  if (tier.oppAware && opp && opp.wanted.length >= OPP_DEVELOPED) holdDeadwood = 0;
  const holdForGin =
    bd.deadwoodAfter <= holdDeadwood && state.stock.length > tier.ginHoldMinStock;

  if (!holdForGin && bd.deadwoodAfter <= SCORING.KNOCK_MAX) {
    return { kind: 'knock', discard: bd.card };
  }

  // Keep playing: pick the throw per the tier's strategy.
  let card: CardId;
  if (tier.discardStrategy === 'safe') {
    card = safeDiscard(hand, state.noDiscard, opp?.wanted ?? []).card;
  } else if (tier.discardStrategy === 'crude') {
    card = crudeDiscard(hand, state.noDiscard);
  } else {
    card = bd.card;
  }
  return { kind: 'discard', card };
}

/**
 * Choose the CPU's move for the seat identified by `cpuUid`. The returned move is
 * always legal for the current state (its kind is in `legalMoves`, and any card is
 * in hand and not the just-taken `noDiscard`). Intended to be called only in the
 * four play phases (`upcard1`/`upcard2`/`draw`/`discard`); the human drives
 * `nextRound`/`rematch`.
 */
export function chooseMove(
  state: GameState,
  cpuUid: string,
  difficulty: Difficulty = 'medium',
  opp?: OppModel,
): Move {
  const tier = TIERS[difficulty];
  const seat = seatOf(state, cpuUid);
  if (seat === null) return { kind: 'drawStock' }; // not a player — inert fallback
  const hand = state.hands[seat];
  const legal = legalMoves(state, cpuUid);

  switch (state.phase) {
    case 'upcard1':
    case 'upcard2': {
      const up = topOf(state.discard);
      if (up === null) return { kind: 'passUpcard' };
      return chooseUpcard(hand, up, tier);
    }
    case 'draw':
      return chooseDraw(state, hand, tier, legal);
    case 'discard':
      return chooseDiscardMove(state, hand, tier, opp);
    default:
      // roundOver / matchOver are driven by the human; never reached in play.
      return { kind: 'drawStock' };
  }
}
