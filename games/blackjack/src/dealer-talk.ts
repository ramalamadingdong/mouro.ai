/**
 * The dealer calls the game. WHEN they speak, and about what, is decided
 * here and shared by every dealer; WHAT they say is their `Voice`
 * (`src/dealers/`): Duchess the mean diva, Nana Mittens, Lucky Lou, Unit 9.
 *
 * `dealerLine(prev, next, nameOf, voice)` looks at what one move changed and
 * returns what the dealer says about it (a line and an emoji), or null to
 * keep the last one. It is pure and picks its variation from the state's
 * `version` (hashed with the kind of moment, so neighbouring lines do not
 * cycle in step), so every client at an online table shows the same line.
 *
 * Whatever their personality, every dealer calls each moment a real dealer
 * would — bets open and closed, the peek, the hole card, hitting soft 17,
 * the reshuffle — so the table always says what just changed and why.
 */
import { RULES, SHOE_SIZE, cardValue, dealerSoft17, handValue, isBlackjack, rankOf, type Card, type GameState } from '@/engine';
import type { LineKey, Voice } from '@/dealers/types';

const RANK_WORDS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King', 'Ace'];

/** "an Ace", "a King", "a 7", "an 8". */
export function cardWords(card: Card): string {
  const word = RANK_WORDS[rankOf(card)];
  return `${word === 'Ace' || word === '8' ? 'an' : 'a'} ${word}`;
}

const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);

/** Deterministic pick: the same state and moment always give the same line. */
function pick(options: readonly string[], seed: number, key: string): string {
  // FNV-1a over the key, mixed with the seed in 32-bit integer maths (a plain
  // float multiply would lose the low bits and repeat a handful of lines).
  let h = 2166136261 ^ Math.imul(seed | 0, 2654435761 | 0);
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507 | 0);
  h ^= h >>> 13;
  return options[(h >>> 0) % options.length];
}

/** Fill `{who}`, `{n}`, `{card}`… in a line. */
const fill = (line: string, vars: Record<string, string | number>): string =>
  line.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

/** One thing the dealer says: the line, and the emoji sent with it. */
export interface Talk {
  text: string;
  emoji: string;
}

// ── Impatience: the longer you take, the worse it gets ─────────────────────

/** Seconds of nobody moving before each step up in impatience. */
export const NAG_AFTER = [8, 16, 28, 45, 70] as const;

/**
 * What the dealer says after `level` steps (1..5) of nobody moving. `who` is
 * the player they are waiting on, or null when the round is over and nobody
 * has dealt the next one.
 */
export function impatienceLine(voice: Voice, level: number, who: string | null, seed: number): Talk {
  const i = Math.min(Math.max(level, 1), voice.nag.length) - 1;
  const text = who === null ? pick(voice.nagDeal[i], seed, `deal${i}`) : fill(pick(voice.nag[i], seed, `nag${i}`), { who });
  return { text, emoji: voice.nagEmoji[i] };
}

/** When someone they were nagging finally moves (and nothing else happened worth a line). */
export function finallyLine(voice: Voice, seed: number): Talk {
  return { text: pick(voice.finally, seed, 'finally'), emoji: pick(voice.finallyEmoji, seed, 'finally!') };
}

// ── What they say ──────────────────────────────────────────────────────────

/** The opening line: the house rules, in the dealer's own words. */
export function openingLine(voice: Voice, seed = 0): string {
  return pick(voice.lines.open, seed, 'open');
}

/**
 * What they are saying about the table as it stands, for when there is no
 * previous state to compare with (the page was just opened or reloaded).
 */
export function ambientLine(voice: Voice, s: GameState): Talk {
  const a = voice.ambient;
  let text: string;
  switch (s.phase) {
    case 'idle':
    case 'betting':
      text = s.handNo <= 1 ? openingLine(voice, s.version) : a.back;
      break;
    case 'playing':
      text = fill(a.playing, { card: cardWords(s.dealer[0]) });
      break;
    case 'dealer':
      text = fill(a.dealer, { total: handValue(s.dealer).total });
      break;
    case 'settled':
      text = s.result?.dealerBlackjack ? a.settledBJ : fill(a.settled, { total: s.result?.dealerTotal ?? 0 });
      break;
    case 'gameover':
      text = a.over;
      break;
  }
  return { text, emoji: pick(voice.emoji.ambient ?? ['🃏'], s.version, 'ambient') };
}

export function dealerLine(prev: GameState, s: GameState, nameOf: (seat: number) => string, voice: Voice): Talk | null {
  const ctx = { key: 'ambient' };
  const text = dealerText(prev, s, nameOf, voice, ctx);
  if (text === null) return null;
  const pool = voice.emoji[ctx.key] ?? voice.emoji.ambient ?? ['🃏'];
  return { text, emoji: pick(pool, s.version, `${ctx.key}!`) };
}

function dealerText(
  prev: GameState,
  s: GameState,
  nameOf: (seat: number) => string,
  voice: Voice,
  ctx: { key: string },
): string | null {
  const v = s.version;
  const by = s.lastMove?.seat ?? 0;
  const who = nameOf(by);
  const say = (key: LineKey, vars: Record<string, string | number> = {}, emojiKey: string = key): string => {
    ctx.key = emojiKey;
    return fill(pick(voice.lines[key], v, key), { who, ...vars });
  };

  if (s.phase === 'gameover' && prev.phase !== 'gameover') {
    ctx.key = 'over';
    const o = voice.over;
    const winner = s.winner === null ? '' : ' ' + fill(o.winner, { who: nameOf(s.winner) });
    const house = ' ' + (s.house > 0 ? o.houseUp : o.houseDown);
    const tips = s.players.reduce((a, p) => a + p.tipped, 0);
    const tipNote = ' ' + (tips === 0 ? o.noTips : fill(o.tips, { n: tips }));
    return `${o.closed}${winner}${house}${tipNote}`;
  }

  // A new round.
  if (s.phase === 'betting' && s.handNo !== prev.handNo) {
    if (s.handNo === 1) {
      ctx.key = 'open';
      return openingLine(voice, v);
    }
    if (s.shoe.length === SHOE_SIZE) return say('shuffle');
    return say('round', { n: s.handNo });
  }

  if (s.lastMove?.kind === 'tip' && s.version !== prev.version) {
    const n = s.players[by].tipped - prev.players[by].tipped;
    return say(n >= 100 ? 'tipB' : n >= 25 ? 'tipN' : 'tipS', { n });
  }

  if (s.phase === 'betting' && prev.phase === 'betting' && s.toAct === null && prev.toAct !== null) {
    return say('closed');
  }

  // The deal (and the peek).
  if (prev.phase === 'betting') {
    if (s.phase === 'settled' && s.result?.dealerBlackjack) return say('dbj');
    if (s.phase === 'settled' && s.dealer.length === 0) return say('sat');
    if (s.phase === 'playing') {
      const up = cardValue(s.dealer[0]);
      const naturals = s.players
        .map((p, seat) => (p.hands[0] && isBlackjack(p.hands[0]) ? nameOf(seat) : null))
        .filter((n): n is string => n !== null);
      const bj = naturals.length ? ' ' + fill(pick(voice.lines.pbj, v, 'pbj'), { who: naturals.join(' and ') }) : '';
      const card = cardWords(s.dealer[0]);
      if (up === 11) return say('peekA') + bj;
      if (up === 10) return say('peek10') + bj;
      if (bj) return `${cap(card)} up.${bj}`;
      return say(up <= 6 ? 'showWeak' : 'showStrong', { card, Card: cap(card) }, 'show');
    }
  }

  // A player's move.
  if (s.phase === 'playing' || (s.phase !== prev.phase && prev.phase === 'playing')) {
    const p = s.players[by];
    const before = prev.players[by];
    switch (s.lastMove?.kind) {
      case 'surrender':
        return say('surr');
      case 'split':
        return say('split');
      case 'double': {
        const hand = p.hands.find((h, i) => h.doubled && !before.hands[i]?.doubled);
        const total = hand ? handValue(hand.cards).total : 0;
        if (total > 21) return say('dbust');
        return say('double') + (total ? ` That's ${total}.` : '');
      }
      case 'stand': {
        const hand = before.hands[before.active];
        const total = hand ? handValue(hand.cards).total : 0;
        if (hand && total <= 11) return say('low', { n: total });
        return null;
      }
      case 'hit': {
        const hand = p.hands.find((h, i) => h.cards.length > (before.hands[i]?.cards.length ?? 0));
        if (!hand) return null;
        const total = handValue(hand.cards).total;
        const was = handValue(hand.cards.slice(0, -1));
        if (total > 21 && !was.soft && was.total >= 17) return say('stiff', { was: was.total });
        if (total > 21) return say('bust', { n: total });
        if (total === 21) return say('21');
        return null;
      }
      default:
        break;
    }
  }

  // The dealer's hand.
  if (s.phase === 'dealer' && prev.phase === 'playing') {
    const { total, soft } = handValue(s.dealer);
    const card = cardWords(s.dealer[1]);
    const anyLeft = s.players.some((p) =>
      p.hands.some((h) => handValue(h.cards).total <= 21 && !isBlackjack(h) && h.outcome !== 'surrender'),
    );
    if (!anyLeft) return say('holeX', { card, Card: cap(card) });
    const t = `${soft && total < 21 ? 'soft ' : ''}${total}`;
    return say('hole', { card, Card: cap(card), total: t, Total: cap(t) });
  }
  if (s.phase === 'dealer' && s.dealer.length > prev.dealer.length) {
    const before = s.dealer.slice(0, -1);
    const card = cardWords(s.dealer[s.dealer.length - 1]);
    const { total } = handValue(s.dealer);
    const why = dealerSoft17(before) ? say('s17') + ' ' : '';
    const vars = { card, Card: cap(card), total, Total: String(total) };
    if (total > 21) return why + say('dbc', vars);
    return why + say('draw', vars);
  }
  if (s.phase === 'settled' && prev.phase === 'dealer') {
    const r = s.result!;
    if (r.dealerTotal > 21) return say('busted');
    const stand = `I stand on ${r.dealerTotal}.`;
    const wins = r.net.filter((n) => n > 0).length;
    const losses = r.net.filter((n) => n < 0).length;
    if (wins === 0 && losses === 0) return `${stand} ${say('push')}`;
    if (wins === 0) return `${stand} ${say('sweep')}`;
    return `${stand} ${say('some')}`;
  }
  return null;
}

/** The cut card's position, for the shoe gauge: a fraction of a full shoe. */
export const CUT_FRACTION = RULES.CUT / SHOE_SIZE;
