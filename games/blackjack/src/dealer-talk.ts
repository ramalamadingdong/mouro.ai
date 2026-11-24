/**
 * Duchess, the dealer: a Las Vegas diva with attitude. She has run this table
 * longer than you have been alive, she is fabulous and knows it, and she has
 * shade for every bad decision at the felt — gloating when the house wins,
 * sulking (gracefully) when it loses. Sharp-tongued but clean: this is a
 * family games site.
 *
 * `dealerLine(prev, next)` looks at what one move changed and returns what
 * she says about it, or null to keep her last line. It is pure and picks its
 * variation from the state's `version`, so every client at an online table
 * shows the same line for the same state.
 *
 * Under the attitude she still calls every moment a real dealer would —
 * bets open and closed, insurance, the peek, the hole card, hitting soft 17,
 * the reshuffle — so the table always says what just changed and why.
 */
import {
  RULES,
  SHOE_SIZE,
  cardValue,
  dealerSoft17,
  handValue,
  isBlackjack,
  rankOf,
  type Card,
  type GameState,
} from '@/engine';

const RANK_WORDS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'Jack', 'Queen', 'King', 'Ace'];

/** "an Ace", "a King", "a 7", "an 8". */
export function cardWords(card: Card): string {
  const word = RANK_WORDS[rankOf(card)];
  return `${word === 'Ace' || word === '8' ? 'an' : 'a'} ${word}`;
}

const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);
const pick = (options: readonly string[], seed: number): string => options[Math.abs(seed) % options.length];

/** What she says when the game opens: the house rules, with attitude. */
export function openingLine(): string {
  return "Welcome to MY table. Six decks, I hit soft seventeen, blackjack pays three to two. Bets down — I don't have all night.";
}

/**
 * What she is saying about the table as it stands, for when there is no
 * previous state to compare with (the page was just opened or reloaded).
 */
export function ambientLine(s: GameState): string {
  switch (s.phase) {
    case 'idle':
    case 'betting':
      return s.handNo <= 1 ? openingLine() : "Oh, you're back. Bets down, sweetheart.";
    case 'insurance':
      return "Ace up. Insurance is open — half your bet, pays two to one. Go on, I'll wait.";
    case 'playing':
      return `I'm showing ${cardWords(s.dealer[0])}. Your move — try to make it a good one.`;
    case 'dealer':
      return `My hand's up: ${handValue(s.dealer).total}. Watch and learn.`;
    case 'settled':
      return s.result?.dealerBlackjack
        ? 'Blackjack. Mine. Obviously.'
        : `The house had ${s.result?.dealerTotal ?? 0}. Deal again whenever you've stopped crying.`;
    case 'gameover':
      return "That's the last hand. Tip your dealer — I accept compliments and tuna.";
  }
}

export function dealerLine(prev: GameState, s: GameState, nameOf: (seat: number) => string): string | null {
  const v = s.version;
  const by = s.lastMove?.seat ?? 0;
  const who = nameOf(by);

  if (s.phase === 'gameover' && prev.phase !== 'gameover') {
    const winner = s.winner === null ? '' : ` ${nameOf(s.winner)} leaves with the most chips — don't let it go to your head.`;
    const house = s.house > 0 ? ' The house is up, as it should be.' : ' The house is down. This never happened.';
    return `Last hand. Table's closed.${winner}${house}`;
  }

  // A new round.
  if (s.phase === 'betting' && s.handNo !== prev.handNo) {
    if (s.handNo === 1) return openingLine();
    if (s.shoe.length === SHOE_SIZE) {
      return 'Shuffle up! The cut card came out, so it\'s a fresh six-deck shoe. Don\'t act like that changes your luck.';
    }
    return pick(
      [
        'Bets down, babies. Chop chop.',
        "New hand. Same me. Place your bets.",
        "Chips on the felt — I'm not getting any younger. Well, I am. But still.",
        'Place your bets. Try not to embarrass yourselves.',
        "Go on, bet. The house is feeling generous. That's a lie.",
      ],
      v,
    );
  }

  if (s.phase === 'betting' && prev.phase === 'betting' && s.toAct === null && prev.toAct !== null) {
    return pick(['No more bets — paws OFF the felt!', 'Bets are closed. Hands where I can see them.'], v);
  }

  if (s.phase === 'insurance' && prev.phase !== 'insurance') {
    const bj = s.players.some((p) => p.hands[0] && isBlackjack(p.hands[0]));
    return `Ace up. Mm-hm. Insurance is open — half your bet, pays two to one.${bj ? ' Blackjacks, you can take even money. Or be brave.' : ''}`;
  }

  // The deal (and the peek).
  if (prev.phase === 'betting' || prev.phase === 'insurance') {
    if (s.phase === 'settled' && s.result?.dealerBlackjack) {
      const insured = s.players.some((p) => p.insurance > 0);
      return `I peek… blackjack. Mine. Obviously.${insured ? ' Fine, insurance pays two to one. Smart cookies.' : ' Thank you for your donations.'}`;
    }
    if (s.phase === 'settled' && s.dealer.length === 0) return "Everybody sat out? Wow. I'll just be gorgeous over here, then.";
    if (s.phase === 'playing') {
      const up = cardValue(s.dealer[0]);
      const naturals = s.players.map((p, seat) => (p.hands[0] && isBlackjack(p.hands[0]) ? nameOf(seat) : null)).filter(Boolean);
      const bjNote = naturals.length ? ` ${naturals.join(' and ')} — blackjack. Three to two. Don't get cocky.` : '';
      if (prev.phase === 'insurance') {
        const insured = s.players.some((p) => p.insurance > 0);
        return `I peek… nobody's home.${insured ? ' Insurance loses — thanks for the tip.' : ''} Play.${bjNote}`;
      }
      if (up >= 10) return `I peek under the ten… nothing. Don't look so relieved.${bjNote}`;
      if (up <= 6) {
        return `I'm showing ${cardWords(s.dealer[0])}.${bjNote || ' Yes, it\'s a weak card. No, that doesn\'t mean you\'ve won.'}`;
      }
      return `I'm showing ${cardWords(s.dealer[0])}.${bjNote || ' Sweat a little.'}`;
    }
  }

  // A player's move.
  if (s.phase === 'playing' || (s.phase !== prev.phase && prev.phase === 'playing')) {
    const p = s.players[by];
    const before = prev.players[by];
    switch (s.lastMove?.kind) {
      case 'surrender':
        return pick([`${who} surrenders. Half back. Run along, baby.`, `${who} gives up. Honestly? Respect. Half back.`], v);
      case 'split':
        return pick([`${who} splits. Two hands, twice the drama. I love it.`, `${who} splits 'em. Bold. Let's see.`], v);
      case 'double': {
        const hand = p.hands.find((h, i) => h.doubled && !before.hands[i]?.doubled);
        const total = hand ? handValue(hand.cards).total : 0;
        if (total > 21) return `${who} doubles… and busts. Oh, sweetheart. No.`;
        return (
          pick([`${who} doubles down — feeling lucky, are we?`, `${who} doubles. Somebody's confident.`], v) +
          (total ? ` That's ${total}.` : '')
        );
      }
      case 'stand': {
        const hand = before.hands[before.active];
        const total = hand ? handValue(hand.cards).total : 0;
        if (hand && total <= 11) return `${who} stands on ${total}?! On ${total}? I— okay. Okay. Your money.`;
        return null;
      }
      case 'hit': {
        const hand = p.hands.find((h, i) => h.cards.length > (before.hands[i]?.cards.length ?? 0));
        if (!hand) return null;
        const total = handValue(hand.cards).total;
        const was = handValue(hand.cards.slice(0, -1));
        if (total > 21 && !was.soft && was.total >= 17) return `${who} hit ${was.total} and busted. Who raised you?`;
        if (total > 21) {
          return pick(
            [`${who} busts with ${total}. Mm. Tragic.`, `${total} — bust! Bye, ${who}.`, `${who} busts. I'll take those chips, thank you.`],
            v,
          );
        }
        if (total === 21) return `Twenty-one for ${who}. Fine. I see you.`;
        return null;
      }
      default:
        break;
    }
  }

  // The dealer's hand.
  if (s.phase === 'dealer' && prev.phase === 'playing') {
    const { total, soft } = handValue(s.dealer);
    const anyLeft = s.players.some((p) =>
      p.hands.some((h) => handValue(h.cards).total <= 21 && !isBlackjack(h) && h.outcome !== 'surrender'),
    );
    if (!anyLeft) return `Hole card's ${cardWords(s.dealer[1])}. Doesn't matter — nobody's left standing. Easy money.`;
    return `Hole card's ${cardWords(s.dealer[1])} — I've got ${soft && total < 21 ? 'soft ' : ''}${total}.`;
  }
  if (s.phase === 'dealer' && s.dealer.length > prev.dealer.length) {
    const before = s.dealer.slice(0, -1);
    const card = cardWords(s.dealer[s.dealer.length - 1]);
    const { total } = handValue(s.dealer);
    const why = dealerSoft17(before) ? 'Soft seventeen — Vegas rules, the house hits! ' : '';
    if (total > 21) return `${why}${cap(card)}… ugh. I bust with ${total}.`;
    return `${why}Card for the house: ${card}. That's ${total}.`;
  }
  if (s.phase === 'settled' && prev.phase === 'dealer') {
    const r = s.result!;
    if (r.dealerTotal > 21) {
      return pick(
        ["I bust. Don't get used to it.", "I bust. Take your little winnings — I'm still the prettiest one here.", 'Over I go. Pay the winners. Quickly, before I change my mind.'],
        v,
      );
    }
    const winners = r.net.filter((n) => n > 0).length;
    const stand = `I stand on ${r.dealerTotal}.`;
    if (winners === 0) return `${stand} ${pick(['The house takes it all. As it should.', 'Thank you for your donations.', 'Clean sweep. I make this look easy because it is.'], v)}`;
    return `${stand} ${pick(['Some of you got lucky. Enjoy it while it lasts.', 'Winners get paid. Losers get my sympathy. Not really.', "Fine — collect. I'm not bitter."], v)}`;
  }
  return null;
}

/** The cut card's position, for the shoe gauge: a fraction of a full shoe. */
export const CUT_FRACTION = RULES.CUT / SHOE_SIZE;
