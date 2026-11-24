/**
 * A cat's decision. Pure: the state, the cat, its skill and a random stream
 * in; one legal move out. Every option it considers comes from
 * `legalActions`, so it can never send something the engine refuses.
 */
import {
  cardValue,
  freshShoe,
  handValue,
  holeCardShown,
  legalActions,
  type Card,
  type GameState,
  type PlayerMove,
} from '@/engine';
import type { Personality, Skill } from './cats';

/**
 * H hit, S stand, D double (else hit), Ds double (else stand), P split,
 * R surrender (else hit), Rs surrender (else stand).
 */
export type Play = 'H' | 'S' | 'D' | 'Ds' | 'P' | 'R' | 'Rs';

/**
 * Basic strategy for this table's Vegas rules: six decks, dealer HITS soft
 * 17, double after split, late surrender. `up` is the dealer's upcard value
 * (2..11). `canSurrender` false gives the no-surrender chart.
 */
export function basicStrategy(cards: readonly Card[], up: number, canSplit: boolean, canSurrender = false): Play {
  const { total, soft } = handValue(cards);
  const between = (lo: number, hi: number): boolean => up >= lo && up <= hi;

  if (canSplit && cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1])) {
    const v = cardValue(cards[0]);
    if (v === 11 || v === 8) return 'P';
    if (v === 9 && (between(2, 6) || up === 8 || up === 9)) return 'P';
    if (v === 7 && between(2, 7)) return 'P';
    if (v === 6 && between(2, 6)) return 'P';
    if (v === 4 && between(5, 6)) return 'P';
    if ((v === 2 || v === 3) && between(2, 7)) return 'P';
    // 5s and tens fall through to their totals.
  }

  if (canSurrender && cards.length === 2 && !soft) {
    if (total === 16 && up >= 9) return 'R';
    if (total === 15 && up >= 10) return 'R';
    if (total === 17 && up === 11) return 'Rs';
  }

  if (soft) {
    if (total >= 20) return 'S';
    if (total === 19) return up === 6 ? 'Ds' : 'S';
    if (total === 18) return between(2, 6) ? 'Ds' : between(7, 8) ? 'S' : 'H';
    if (total === 17) return between(3, 6) ? 'D' : 'H';
    if (total >= 15) return between(4, 6) ? 'D' : 'H';
    if (total >= 13) return between(5, 6) ? 'D' : 'H';
    return 'H';
  }

  if (total >= 17) return 'S';
  if (total >= 13) return between(2, 6) ? 'S' : 'H';
  if (total === 12) return between(4, 6) ? 'S' : 'H';
  if (total === 11) return 'D';
  if (total === 10) return up <= 9 ? 'D' : 'H';
  if (total === 9) return between(3, 6) ? 'D' : 'H';
  return 'H';
}

/**
 * Hi-Lo true count of the cards seen since the last shuffle: every card not
 * in the shoe, except a hole card still face down. (A real counter cannot see
 * the shoe — this only uses its SIZE and which cards have been dealt.)
 */
export function trueCount(state: GameState): number {
  const inShoe = new Set(state.shoe);
  const hidden = !holeCardShown(state) && state.dealer.length > 1 ? state.dealer[1] : -1;
  let running = 0;
  for (const c of freshShoe()) {
    if (inShoe.has(c) || c === hidden) continue;
    const v = cardValue(c);
    if (v <= 6) running += 1;
    else if (v >= 10) running -= 1;
  }
  const decksLeft = Math.max(0.5, state.shoe.length / 52);
  return running / decksLeft;
}

export function decide(
  state: GameState,
  seat: number,
  personality: Personality,
  skill: Skill,
  rng: () => number,
): PlayerMove {
  const legal = legalActions(state);
  if (!legal || legal.seat !== seat) throw new Error('decide() called when this cat is not on turn');
  const p = state.players[seat];

  if (legal.kind === 'bet') {
    let amount = Math.max(legal.minBet, p.stack * personality.betFraction);
    if (personality.counts) {
      // One unit at a neutral count, ramping to eight as the count climbs.
      const tc = trueCount(state);
      amount = legal.minBet * Math.min(8, Math.max(1, Math.floor(tc) * 2));
    }
    amount *= 1 + (rng() * 2 - 1) * personality.betJitter;
    const stepped = Math.round(amount / legal.step) * legal.step;
    return { kind: 'bet', amount: Math.min(legal.maxBet, Math.max(legal.minBet, stepped)) };
  }

  const hand = p.hands[legal.hand];
  const up = cardValue(state.dealer[0]);
  const { total, soft } = handValue(hand.cards);
  let play: Play;
  switch (personality.strategy) {
    case 'dealer':
      play = total < 17 ? 'H' : 'S';
      break;
    case 'never-bust':
      play = basicStrategy(hand.cards, up, legal.canSplit && cardValue(hand.cards[0]) === 11);
      if (play === 'D' || play === 'Ds') play = total >= 17 || (!soft && total >= 12) ? 'S' : 'H';
      if (play === 'H' && !soft && total >= 12) play = 'S';
      break;
    case 'hunch':
      play = basicStrategy(hand.cards, up, legal.canSplit);
      // Any pair is a sign; any 9-11 is a double.
      if (legal.canSplit && cardValue(hand.cards[0]) !== 10) play = 'P';
      else if (!soft && total >= 9 && total <= 11) play = 'D';
      break;
    default:
      play = basicStrategy(hand.cards, up, legal.canSplit, legal.canSurrender);
  }

  // A fumble: the plain hit/stand choice goes the other way.
  if ((play === 'H' || play === 'S') && rng() < skill.mistake && total < 21) play = play === 'H' ? 'S' : 'H';

  if ((play === 'R' || play === 'Rs') && legal.canSurrender) return { kind: 'surrender' };
  if (play === 'Rs') return { kind: 'stand' };
  if (play === 'P' && legal.canSplit) return { kind: 'split' };
  if ((play === 'D' || play === 'Ds') && legal.canDouble) return { kind: 'double' };
  if (play === 'Ds' || play === 'S') return { kind: 'stand' };
  if (play === 'P') return basicStrategy(hand.cards, up, false) === 'S' ? { kind: 'stand' } : { kind: 'hit' };
  return total >= 21 ? { kind: 'stand' } : { kind: 'hit' };
}

