/**
 * One computer decision. Pure: (state, seat, personality, skill, rng) → PlayerMove.
 *
 * Shape of the logic:
 *   preflop  — Chen score against thresholds that loosen in late position and
 *              at short-handed tables, with a push/fold mode under 10 blinds.
 *   postflop — Monte-Carlo equity vs random hands, discounted by how hard the
 *              opponent is betting, then compared with the pot odds.
 * The personality shifts the thresholds; the skill level adds error.
 *
 * Every branch produces an INTENT (fold / stay in cheaply / raise to X), and
 * the one exit, `legalize`, turns that into an action the engine will accept.
 * No branch needs to know the min-raise rules, and a mis-sized or impossible
 * raise degrades to the nearest legal thing instead of an error.
 */
import { legalActions, potTotal, type GameState, type LegalActions, type PlayerMove } from '@/engine';
import type { Personality, Skill } from './cats';
import { estimateEquity } from './equity';
import { chenScore } from './preflop';

type Intent = { kind: 'fold' } | { kind: 'passive' } | { kind: 'raise'; to: number };

const FOLD: Intent = { kind: 'fold' };
const PASSIVE: Intent = { kind: 'passive' };

function legalize(intent: Intent, legal: LegalActions): PlayerMove {
  if (intent.kind === 'raise' && legal.canRaise) {
    let to = Math.round(intent.to);
    to = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, to));
    // Leaving a sliver behind is worse than either alternative: once most of
    // the stack is going in, put all of it in.
    if (to >= legal.maxRaiseTo * 0.75) to = legal.maxRaiseTo;
    return { kind: 'raise', to };
  }
  // Never fold when checking is free.
  if (intent.kind === 'fold' && !legal.canCheck) return { kind: 'fold' };
  return legal.canCheck ? { kind: 'check' } : { kind: 'call' };
}

function preflop(state: GameState, seat: number, cat: Personality, skill: Skill, rng: () => number): Intent {
  const legal = legalActions(state)!;
  const me = state.players[seat];
  const bb = state.bigBlind;
  const toCall = legal.callAmount;
  const dealtIn = state.players.filter((p) => p.inHand).length;

  const score = chenScore(me.hole) + (rng() * 2 - 1) * skill.preflopNoise;

  // Late position = the button, or the seat acting just before it.
  const n = state.players.length;
  let cutoff = state.button;
  do cutoff = (cutoff - 1 + n) % n;
  while (!state.players[cutoff].inHand);
  const late = seat === state.button || (dealtIn > 3 && seat === cutoff);

  // Fewer opponents → any given hand is more likely to be best.
  const shortHanded = (6 - dealtIn) * 0.7;
  const open = cat.openThreshold - shortHanded - (late ? 1 : 0);
  const raised = state.currentBet > bb;
  const stackBlinds = (me.stack + me.bet) / bb;

  // Too short to raise-and-fold: every hand is all-in or out.
  if (stackBlinds <= 10) {
    if (score >= (raised ? open + 1 : open - 1)) return { kind: 'raise', to: legal.maxRaiseTo };
    return legal.canCheck ? PASSIVE : FOLD;
  }

  if (!raised) {
    // Size up over limpers so the raise still thins the field.
    const limped = Math.max(0, potTotal(state) - state.smallBlind - bb);
    const openTo = bb * (2.4 + rng() * 0.8) + limped;
    if (score >= open) return rng() < 0.35 + 0.6 * cat.aggression ? { kind: 'raise', to: openTo } : PASSIVE;
    if (legal.canCheck) return rng() < cat.bluff * 0.5 ? { kind: 'raise', to: openTo } : PASSIVE;
    if (score >= open - 2.5 - cat.callLooseness * 20) return PASSIVE;
    if (late && rng() < cat.bluff) return { kind: 'raise', to: openTo };
    return FOLD;
  }

  // Facing a raise.
  const premium = 12 - shortHanded * 0.5; // JJ+, AK suited at a full table
  if (score >= premium) {
    if (rng() < cat.slowplay * 0.5) return PASSIVE;
    return { kind: 'raise', to: state.currentBet * (2.6 + rng() * 0.8) };
  }
  let callAt = open + 1 + Math.min(5, (toCall / bb) * 0.35) - cat.callLooseness * 20;
  // Calling off a big part of the stack needs a hand close to premium.
  if (toCall > me.stack * 0.4) callAt = Math.max(callAt, premium - 1.5 - cat.callLooseness * 10);
  if (score >= callAt) return PASSIVE;
  if (toCall < me.stack * 0.15 && rng() < cat.bluff * 0.25) return { kind: 'raise', to: state.currentBet * 3 };
  return FOLD;
}

function postflop(state: GameState, seat: number, cat: Personality, skill: Skill, rng: () => number): Intent {
  const legal = legalActions(state)!;
  const me = state.players[seat];
  const toCall = legal.callAmount;
  const pot = potTotal(state);
  const opponents = state.players.filter((p, i) => i !== seat && p.inHand && !p.folded).length;

  const raw = estimateEquity(me.hole, state.board, opponents, skill.rollouts, rng);
  const equity = Math.min(1, Math.max(0, raw + (rng() * 2 - 1) * skill.equityNoise));

  if (rng() < skill.autopilot) return PASSIVE;

  if (toCall === 0) {
    // Heads-up-equivalent strength: beating n random hands with probability e
    // means beating ONE with about e^(1/n). Keeps the thresholds below
    // meaningful whether one opponent is left or five.
    const strength = equity ** (1 / opponents);
    if (strength >= 0.66 - 0.1 * cat.aggression) {
      if (rng() < cat.slowplay) return PASSIVE;
      return { kind: 'raise', to: pot * (0.45 + 0.45 * rng()) };
    }
    if (strength >= 0.5 && rng() < 0.15 + 0.35 * cat.aggression) {
      return { kind: 'raise', to: pot * (0.3 + 0.25 * rng()) };
    }
    // Bluffs work better against one opponent than against a crowd.
    if (rng() < cat.bluff * (opponents === 1 ? 1.6 : 0.8)) {
      return { kind: 'raise', to: pot * (0.5 + 0.3 * rng()) };
    }
    return PASSIVE;
  }

  // Facing a bet. `pressure` is the bet as a share of the pot it made: 0.33
  // for a half-pot bet, 0.5 for a pot bet. Bigger bets come from better hands,
  // which equity-vs-random does not see, so skilled cats mark themselves down.
  const pressure = toCall / pot;
  const adjusted = equity - skill.respect * 0.22 * pressure;
  const strength = Math.max(0, adjusted) ** (1 / opponents);
  const potOdds = toCall / (pot + toCall);
  // A call for most of the stack has no later streets to make up a thin edge.
  const need = potOdds + 0.04 - cat.callLooseness + (toCall > me.stack * 0.5 ? 0.05 : 0);

  const raiseTo = state.currentBet + (pot + toCall) * (0.5 + 0.5 * rng());
  if (strength >= 0.82 - 0.08 * cat.aggression) {
    return rng() < cat.slowplay ? PASSIVE : { kind: 'raise', to: raiseTo };
  }
  if (adjusted >= need) return PASSIVE;
  if (toCall < me.stack * 0.2 && rng() < cat.bluff * 0.35) return { kind: 'raise', to: raiseTo };
  return FOLD;
}

/**
 * Decide for the seat in `state.toAct`. The result is always legal for that
 * state. Called for a seat that is not due to act, it returns a fold (which
 * the engine will reject) rather than throwing — the caller has a bug either
 * way, and the reducer's error message is the clearer report of it.
 */
export function decide(state: GameState, seat: number, cat: Personality, skill: Skill, rng: () => number): PlayerMove {
  const legal = legalActions(state);
  if (!legal || legal.seat !== seat) return { kind: 'fold' };
  const intent = state.phase === 'preflop' ? preflop(state, seat, cat, skill, rng) : postflop(state, seat, cat, skill, rng);
  return legalize(intent, legal);
}
