/**
 * The blackjack reducer: `applyMove(state, move, uid)` returns a new state or
 * an error and never throws or mutates its input. The same reducer runs the
 * offline game against the cats and the online rooms.
 *
 * The dealer is explicit. When the last bet is in, the cards are NOT dealt by
 * themselves: the round waits with `toAct === null` for a `next` move. The
 * same happens when the last player stands (`next` turns the hole card) and
 * for every card the dealer draws (one `next` each). That costs a few extra
 * moves per round and buys two things: the UI can pace the dealer and hold the
 * result without the engine knowing about time, and online what is on screen
 * is always exactly what is in the database.
 *
 * All randomness is a seed carried inside the move that consumes it (`deal`,
 * `rematch`); nothing here calls Math.random(). A game is fully replayable
 * from its options plus the ordered move log.
 *
 * House rules — a Las Vegas Strip shoe game (see AGENTS.md): six decks,
 * reshuffled at the cut card between rounds; dealer HITS soft 17 and peeks for
 * blackjack under an Ace or a ten; insurance (even money on a blackjack)
 * when the dealer shows an Ace, paying 2:1; blackjack pays 3:2 (rounded down
 * to a whole chip); double on any first two cards, also after a split; split
 * any two cards of the same value, up to four hands; split Aces take one card
 * each; a two-card 21 after a split is not a blackjack; late surrender (half
 * the bet back) on the first two cards of an unsplit hand.
 */
import { cardValue, freshShoe, handValue, isNatural, shuffle } from './cards';
import { makeRng } from './rng';
import {
  ANY_PLAYER,
  RULES,
  type ApplyResult,
  type Card,
  type GameState,
  type Hand,
  type LegalActions,
  type Move,
  type NewGameOptions,
  type Outcome,
  type Phase,
  type PlayerMove,
  type PlayerState,
} from './types';

const roundToStep = (n: number): number => Math.floor(n / RULES.BET_STEP) * RULES.BET_STEP;

export function createGame(options: NewGameOptions): GameState {
  if (options.players.length < RULES.MIN_PLAYERS || options.players.length > RULES.MAX_PLAYERS) {
    throw new Error(`Blackjack seats ${RULES.MIN_PLAYERS}-${RULES.MAX_PLAYERS} players.`);
  }
  const minBet = Math.max(RULES.BET_STEP, roundToStep(options.minBet ?? RULES.DEFAULT_MIN_BET));
  const maxBet = Math.max(minBet, roundToStep(options.maxBet ?? RULES.DEFAULT_MAX_BET));
  // Nobody may start unable to place a bet.
  const startingStack = Math.max(minBet, Math.floor(options.startingStack));
  const rounds = Math.max(1, Math.floor(options.rounds ?? RULES.DEFAULT_ROUNDS));

  return {
    version: 0,
    config: { startingStack, minBet, maxBet, rounds },
    players: options.players.map((p) => ({
      uid: p.uid,
      name: p.name,
      isHuman: p.isHuman,
      stack: startingStack,
      hands: [],
      active: 0,
      insurance: 0,
      sitOut: false,
      lastAction: null,
    })),
    phase: 'idle',
    handNo: 0,
    // Shuffled by the first deal's seed, so creating a game needs no randomness.
    shoe: [],
    dealer: [],
    house: 0,
    toAct: null,
    turnUid: ANY_PLAYER,
    result: null,
    winner: null,
    lastMove: null,
  };
}

// ── Queries ────────────────────────────────────────────────────────────────

const canBet = (state: GameState, p: PlayerState): boolean => p.stack >= state.config.minBet;

/** A hand that counts as a blackjack (two-card 21, not made by splitting). */
export function isBlackjack(hand: Hand): boolean {
  return !hand.split && isNatural(hand.cards);
}

/** What insurance costs a seat: half its bet, rounded down to a whole chip. */
export function insuranceCost(p: PlayerState): number {
  return p.hands.length === 1 ? Math.floor(p.hands[0].bet / 2) : 0;
}

/**
 * Chips riding on the table right now (0 once the round is settled).
 * Insurance only counts while it is undecided: at the peek it is either
 * lost to the house or paid with the round.
 */
export function chipsInPlay(state: GameState): number {
  if (state.result !== null) return 0;
  const insurance = state.phase === 'insurance' ? state.players.reduce((sum, p) => sum + p.insurance, 0) : 0;
  return state.players.reduce((sum, p) => sum + p.hands.reduce((s, h) => s + h.bet, 0), 0) + insurance;
}

/** Every chip in the game, house included. Constant for the whole game — the fuzz test's anchor. */
export function totalChips(state: GameState): number {
  return state.players.reduce((sum, p) => sum + p.stack, 0) + chipsInPlay(state) + state.house;
}

/** True when the dealer's hole card is face up. */
export function holeCardShown(state: GameState): boolean {
  return state.phase === 'dealer' || state.phase === 'settled' || (state.phase === 'gameover' && state.dealer.length > 0);
}

/** Does any player hand still depend on what the dealer makes? */
function handsAwaitDealer(state: GameState): boolean {
  return state.players.some((p) =>
    p.hands.some((h) => handValue(h.cards).total <= 21 && !isBlackjack(h) && h.outcome !== 'surrender'),
  );
}

/** Is this a soft 17 the dealer must hit (Vegas rules)? */
export function dealerSoft17(cards: readonly Card[]): boolean {
  const { total, soft } = handValue(cards);
  return RULES.DEALER_HITS_SOFT_17 && total === 17 && soft;
}

/** True when the dealer must take another card: below 17, or on a soft 17. */
export function dealerMustDraw(state: GameState): boolean {
  return handsAwaitDealer(state) && (handValue(state.dealer).total < 17 || dealerSoft17(state.dealer));
}

/**
 * What the seat in `toAct` may do. The single statement of legality: the UI,
 * the computer players and the fuzz test all read it, and `applyMove`
 * validates against it. Standing (and a bet of 0, sitting out) are always
 * legal and are not listed.
 */
export function legalActions(state: GameState): LegalActions | null {
  if (state.toAct === null) return null;
  const seat = state.toAct;
  const p = state.players[seat];
  if (state.phase === 'betting') {
    return {
      kind: 'bet',
      seat,
      minBet: state.config.minBet,
      maxBet: Math.max(state.config.minBet, roundToStep(Math.min(state.config.maxBet, p.stack))),
      step: RULES.BET_STEP,
    };
  }
  if (state.phase === 'insurance') {
    const cost = insuranceCost(p);
    return { kind: 'insurance', seat, cost: p.stack >= cost ? cost : 0, evenMoney: isBlackjack(p.hands[0]) };
  }
  if (state.phase !== 'playing') return null;
  const hand = p.hands[p.active];
  if (!hand || hand.done) return null;
  const two = hand.cards.length === 2;
  return {
    kind: 'play',
    seat,
    hand: p.active,
    canHit: true,
    canDouble: two && p.stack >= hand.bet,
    canSplit:
      two &&
      cardValue(hand.cards[0]) === cardValue(hand.cards[1]) &&
      p.hands.length < RULES.MAX_HANDS &&
      p.stack >= hand.bet,
    canSurrender: two && p.hands.length === 1 && !hand.split,
  };
}

/** True once no more rounds will be dealt: the last round is played, or no human can bet. */
export function isGameOver(state: GameState): boolean {
  if (state.handNo >= state.config.rounds) return true;
  return !state.players.some((p) => p.isHuman && canBet(state, p));
}

/** The seat with the most chips (ties go to the lower seat). */
function leader(state: GameState): number {
  return state.players.reduce((best, p, i) => (p.stack > state.players[best].stack ? i : best), 0);
}

// ── Internals (all mutate a private clone) ─────────────────────────────────

function clone(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((p) => ({ ...p, hands: p.hands.map((h) => ({ ...h, cards: [...h.cards] })) })),
    shoe: [...state.shoe],
    dealer: [...state.dealer],
    // `config` and `result` are never mutated after creation.
  };
}

const newHand = (bet: number, cards: Card[] = [], split = false): Hand => ({
  cards,
  bet,
  done: false,
  doubled: false,
  split,
  outcome: null,
  paid: 0,
});

/**
 * Take the top card. If a monster round ever empties the shoe, the cards
 * already played this shoe are shuffled back in — deterministically, so every
 * client agrees, from the state alone.
 */
function draw(state: GameState): Card {
  if (state.shoe.length === 0) {
    const onTable = new Set<Card>([...state.dealer, ...state.players.flatMap((p) => p.hands.flatMap((h) => h.cards))]);
    const discards = freshShoe().filter((c) => !onTable.has(c));
    state.shoe = shuffle(discards, makeRng([state.handNo, state.version, state.dealer.length, onTable.size]));
  }
  return state.shoe.pop()!;
}

/** First seat at or after `from` with an unfinished hand; sets `active`. */
function nextToPlay(state: GameState, from: number): number | null {
  for (let seat = from; seat < state.players.length; seat++) {
    const p = state.players[seat];
    const idx = p.hands.findIndex((h) => !h.done);
    if (idx >= 0) {
      p.active = idx;
      return seat;
    }
  }
  return null;
}

/** First seat at or after `from` that can afford a bet. */
function nextToBet(state: GameState, from: number): number | null {
  for (let seat = from; seat < state.players.length; seat++) {
    if (canBet(state, state.players[seat])) return seat;
  }
  return null;
}

/** Mark a hand finished if it has busted or reached 21 (21 stands by itself). */
function finishIfDone(hand: Hand): void {
  if (handValue(hand.cards).total >= 21) hand.done = true;
}

function settle(state: GameState): void {
  const dealer = handValue(state.dealer);
  const dealerBJ = isNatural(state.dealer);
  let houseNet = 0;
  const net = state.players.map((p) => {
    let staked = 0;
    let paid = 0;
    for (const h of p.hands) {
      const total = handValue(h.cards).total;
      const bj = isBlackjack(h);
      let outcome: Outcome;
      if (h.outcome === 'surrender') outcome = 'surrender';
      else if (total > 21) outcome = 'bust';
      else if (bj && dealerBJ) outcome = 'push';
      else if (bj) outcome = 'blackjack';
      else if (dealerBJ) outcome = 'lose';
      else if (dealer.total > 21 || total > dealer.total) outcome = 'win';
      else if (total === dealer.total) outcome = 'push';
      else outcome = 'lose';
      h.outcome = outcome;
      h.done = true;
      // 3:2, rounded down to a whole chip when the bet is an odd multiple of 5.
      // Surrender returns half the bet, also rounded down.
      h.paid =
        outcome === 'blackjack'
          ? h.bet + Math.floor((h.bet * 3) / 2)
          : outcome === 'win'
            ? h.bet * 2
            : outcome === 'push'
              ? h.bet
              : outcome === 'surrender'
                ? Math.floor(h.bet / 2)
                : 0;
      staked += h.bet;
      paid += h.paid;
    }
    p.stack += paid;
    houseNet -= paid - staked;
    // Insurance: paid 2:1 here when the dealer has blackjack (it is still on
    // the table); otherwise it was already lost to the house at the peek and
    // only shows in this round's net.
    let insuranceNet = 0;
    if (p.insurance > 0 && dealerBJ) {
      p.stack += p.insurance * 3;
      houseNet -= p.insurance * 2;
      insuranceNet = p.insurance * 2;
    } else if (p.insurance > 0) {
      insuranceNet = -p.insurance;
    }
    return paid - staked + insuranceNet;
  });
  state.house += houseNet;
  state.result = { dealerTotal: dealer.total, dealerBlackjack: dealerBJ, net };
  state.phase = 'settled';
  state.toAct = null;
}

function deal(state: GameState, seed: readonly number[]): string | null {
  if (state.phase !== 'idle' && state.phase !== 'settled') return 'A round is still being played.';
  if (!Array.isArray(seed) || seed.length === 0 || !seed.every(Number.isFinite)) return 'A deal needs a seed.';

  if (isGameOver(state) || nextToBet(state, 0) === null) {
    state.phase = 'gameover';
    state.toAct = null;
    state.winner = leader(state);
    return null;
  }

  // One stream per round, seeded by the move and salted with the round
  // number so a client that reused a seed would still not repeat a shoe.
  const rng = makeRng([...seed, state.handNo + 1]);
  state.handNo += 1;
  // The cut card: reshuffle every card (last round's included) when the shoe runs low.
  if (state.shoe.length < RULES.CUT) state.shoe = shuffle(freshShoe(), rng);

  for (const p of state.players) {
    p.hands = [];
    p.active = 0;
    p.insurance = 0;
    p.lastAction = null;
  }
  state.dealer = [];
  state.result = null;
  state.phase = 'betting';
  state.toAct = nextToBet(state, 0);
  return null;
}

function rematch(state: GameState, seed: readonly number[]): string | null {
  if (state.phase !== 'gameover') return 'The game is not over yet.';
  for (const p of state.players) {
    p.stack = state.config.startingStack;
    p.hands = [];
    p.active = 0;
    p.insurance = 0;
    p.sitOut = false;
    p.lastAction = null;
  }
  state.house = 0;
  state.handNo = 0;
  state.shoe = [];
  state.dealer = [];
  state.result = null;
  state.winner = null;
  state.phase = 'idle';
  return deal(state, seed);
}

/** Deal two cards to every bettor and the dealer, then peek for a dealer blackjack. */
function dealCards(state: GameState): void {
  const bettors = state.players.filter((p) => p.hands.length > 0);
  if (bettors.length === 0) {
    // Everybody sat out: nothing to play.
    state.result = { dealerTotal: 0, dealerBlackjack: false, net: state.players.map(() => 0) };
    state.phase = 'settled';
    return;
  }
  for (let round = 0; round < 2; round++) {
    for (const p of bettors) p.hands[0].cards.push(draw(state));
    state.dealer.push(draw(state));
  }
  for (const p of bettors) {
    if (isNatural(p.hands[0].cards)) {
      p.hands[0].done = true;
      p.lastAction = { kind: 'blackjack', amount: 0 };
    }
  }
  // An Ace up: insurance first, then the peek (a `next` from 'insurance').
  if (cardValue(state.dealer[0]) === 11) {
    state.phase = 'insurance';
    state.toAct = nextToInsure(state, 0);
    return;
  }
  peek(state);
}

/** First seat at or after `from` that can afford insurance. */
function nextToInsure(state: GameState, from: number): number | null {
  for (let seat = from; seat < state.players.length; seat++) {
    const p = state.players[seat];
    const cost = insuranceCost(p);
    if (cost > 0 && p.stack >= cost) return seat;
  }
  return null;
}

/**
 * The peek: under an Ace or a ten the dealer checks for blackjack before
 * anyone plays, so nobody doubles or splits into a hand that was already
 * lost. A blackjack settles the round (paying insurance); otherwise any
 * insurance is lost to the house and play begins.
 */
function peek(state: GameState): void {
  if (cardValue(state.dealer[0]) >= 10 && isNatural(state.dealer)) {
    settle(state);
    return;
  }
  for (const p of state.players) state.house += p.insurance;
  state.phase = 'playing';
  state.toAct = nextToPlay(state, 0);
}

function next(state: GameState, from: Phase, dealerCards: number): string | null {
  if (state.toAct !== null) return 'A player is still to act.';
  // Two clients may both send `next` for the same step; the loser of that race
  // arrives here one step late and must be refused, not obeyed.
  if (from !== state.phase || dealerCards !== state.dealer.length) return 'The dealer has already done that.';
  switch (state.phase) {
    case 'betting':
      dealCards(state);
      return null;
    case 'insurance':
      peek(state);
      return null;
    case 'playing':
      // Turn the hole card.
      state.phase = 'dealer';
      return null;
    case 'dealer':
      if (dealerMustDraw(state)) state.dealer.push(draw(state));
      else settle(state);
      return null;
    default:
      return 'There is nothing for the dealer to do.';
  }
}

function playerAction(state: GameState, action: PlayerMove, seat: number): string | null {
  const legal = legalActions(state);
  if (!legal) return 'Nobody is due to act.';
  if (seat !== legal.seat) return 'It is not your turn.';
  const p = state.players[seat];

  if (legal.kind === 'bet') {
    if (action.kind !== 'bet') return 'Place a bet first.';
    const amount = action.amount;
    if (amount === 0) {
      p.lastAction = { kind: 'sitout', amount: 0 };
    } else {
      if (!Number.isInteger(amount) || amount % legal.step !== 0 || amount < legal.minBet || amount > legal.maxBet) {
        return `A bet must be a multiple of ${legal.step} between ${legal.minBet} and ${legal.maxBet}.`;
      }
      p.stack -= amount;
      p.hands = [newHand(amount)];
      p.lastAction = { kind: 'bet', amount };
    }
    state.toAct = nextToBet(state, seat + 1);
    return null;
  }

  if (legal.kind === 'insurance') {
    if (action.kind !== 'insure') return 'Insurance first: take it or not.';
    if (action.take) {
      if (legal.cost === 0) return 'Not enough chips for insurance.';
      p.stack -= legal.cost;
      p.insurance = legal.cost;
      p.lastAction = { kind: 'insure', amount: legal.cost };
    } else {
      p.lastAction = { kind: 'noinsure', amount: 0 };
    }
    state.toAct = nextToInsure(state, seat + 1);
    return null;
  }

  const hand = p.hands[p.active];
  switch (action.kind) {
    case 'bet':
      return 'The bets are already in.';
    case 'insure':
      return 'Insurance is closed.';
    case 'surrender':
      if (!legal.canSurrender) return 'You can only surrender your first two cards.';
      hand.done = true;
      hand.outcome = 'surrender';
      p.lastAction = { kind: 'surrender', amount: Math.floor(hand.bet / 2) };
      break;
    case 'hit':
      hand.cards.push(draw(state));
      finishIfDone(hand);
      p.lastAction = { kind: handValue(hand.cards).total > 21 ? 'bust' : 'hit', amount: 0 };
      break;
    case 'stand':
      hand.done = true;
      p.lastAction = { kind: 'stand', amount: 0 };
      break;
    case 'double':
      if (!legal.canDouble) return 'You can only double on your first two cards, with the chips to match.';
      p.stack -= hand.bet;
      p.lastAction = { kind: 'double', amount: hand.bet };
      hand.bet *= 2;
      hand.doubled = true;
      hand.cards.push(draw(state));
      hand.done = true;
      if (handValue(hand.cards).total > 21) p.lastAction = { kind: 'bust', amount: 0 };
      break;
    case 'split': {
      if (!legal.canSplit) return 'Only a pair can be split, with the chips to match.';
      p.stack -= hand.bet;
      const second = newHand(hand.bet, [hand.cards[1]], true);
      hand.cards = [hand.cards[0]];
      hand.split = true;
      p.hands.splice(p.active + 1, 0, second);
      hand.cards.push(draw(state));
      second.cards.push(draw(state));
      // Split Aces get one card each and no more.
      const aces = cardValue(hand.cards[0]) === 11;
      for (const h of [hand, second]) {
        if (aces) h.done = true;
        else finishIfDone(h);
      }
      p.lastAction = { kind: 'split', amount: hand.bet };
      break;
    }
  }

  // Next unfinished hand of this seat, else the next seat, else the dealer.
  const idx = p.hands.findIndex((h) => !h.done);
  if (idx >= 0) p.active = idx;
  else state.toAct = nextToPlay(state, seat + 1);
  return null;
}

/** Act for the absent player on turn: sit out while betting, no insurance, stand while playing. */
function away(state: GameState, senderSeat: number): string | null {
  const legal = legalActions(state);
  if (!legal) return 'Nobody is due to act.';
  if (senderSeat === legal.seat) return 'You cannot be away from your own turn.';
  const stand: PlayerMove =
    legal.kind === 'bet' ? { kind: 'bet', amount: 0 } : legal.kind === 'insurance' ? { kind: 'insure', take: false } : { kind: 'stand' };
  const error = playerAction(state, stand, legal.seat);
  if (error === null) state.players[legal.seat].sitOut = true;
  return error;
}

// ── Public reducer ─────────────────────────────────────────────────────────

/**
 * Apply one move. `uid` is who is sending it, and is an argument rather than
 * a field on the move so a payload cannot lie about its sender (the same
 * convention as the other games' engines).
 */
export function applyMove(state: GameState, move: Move, uid: string): ApplyResult {
  const seat = state.players.findIndex((p) => p.uid === uid);
  if (seat < 0) return { ok: false, error: 'You are not seated at this table.' };

  const nextState = clone(state);
  let error: string | null;
  let actedOn = seat;
  switch (move.kind) {
    case 'deal':
      error = deal(nextState, move.seed);
      break;
    case 'rematch':
      error = rematch(nextState, move.seed);
      break;
    case 'next':
      error = next(nextState, move.from, move.dealerCards);
      break;
    case 'bet':
    case 'insure':
    case 'hit':
    case 'stand':
    case 'double':
    case 'split':
    case 'surrender':
      error = playerAction(nextState, move, seat);
      if (error === null) nextState.players[seat].sitOut = false;
      break;
    case 'away':
      actedOn = state.toAct ?? seat;
      error = away(nextState, seat);
      break;
    default:
      error = 'Unknown move.';
  }
  if (error !== null) return { ok: false, error };

  // The one commit point: everything the database rules read is derived here.
  nextState.version = state.version + 1;
  nextState.turnUid = nextState.toAct === null ? ANY_PLAYER : nextState.players[nextState.toAct].uid;
  nextState.lastMove = { by: uid, kind: move.kind, seat: actedOn };
  return { ok: true, state: nextState };
}
