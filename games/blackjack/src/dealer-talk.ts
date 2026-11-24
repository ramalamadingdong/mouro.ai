/**
 * Duchess, the dealer: a Las Vegas diva with a sharp tongue and zero
 * patience. She has run this table longer than you have been alive, she is
 * fabulous and knows it, and she has shade for every bad decision at the
 * felt — gloating when the house wins, sulking (gloriously) when it loses.
 * Mild language only ("damn", "hell"); no slurs, and no accent played for a
 * laugh — the attitude is in what she says.
 *
 * `dealerLine(prev, next)` looks at what one move changed and returns what
 * she says about it, or null to keep her last line. It is pure and picks its
 * variation from the state's `version` (hashed with the kind of moment, so
 * neighbouring lines do not cycle in step), so every client at an online
 * table shows the same line for the same state. Every moment has a big pool
 * of lines so a long session does not feel like a loop.
 *
 * Under the attitude she still calls every moment a real dealer would —
 * bets open and closed, the peek, the hole card, hitting soft 17, the
 * reshuffle — so the table always says what just changed and why.
 */
import { RULES, SHOE_SIZE, cardValue, dealerSoft17, handValue, isBlackjack, rankOf, type Card, type GameState } from '@/engine';

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

// ── The lines ──────────────────────────────────────────────────────────────

const OPENING = [
  "Welcome to MY table. Six decks, I hit soft seventeen, blackjack pays three to two. Bets down — I don't have all night.",
  'Sit down, kittens. House rules: six decks, I hit soft seventeen, blackjack pays three to two. Now impress me.',
  "Oh look, fresh money. Six decks, I hit soft seventeen, blackjack pays three to two. Let's see what you've got.",
  "Evening. I'm Duchess, this is my table, and you're welcome. Six decks, I hit soft seventeen, three to two on blackjack.",
];

const NEW_ROUND = [
  'Bets down, babies. Chop chop.',
  'New hand. Same me. Place your bets.',
  "Chips on the felt — I'm not getting any younger. Well, I am. But still.",
  'Place your bets. Try not to embarrass yourselves.',
  "Go on, bet. The house is feeling generous. That's a lie.",
  "Bets, please. I've got a manicure at six.",
  'Feed the felt, darlings.',
  "Another round? Bless your hearts. Bets down.",
  "Let's go, let's go. Chips in the circle.",
  "Bet like you mean it. Or don't. I get paid either way.",
  "Round {n}. Some of you are still here? Brave.",
  "Place your bets. And sit up straight, this is Vegas.",
  "Bets down. Whoever's humming, stop it.",
  "Next hand. Somebody's luck is about to change. Probably not yours.",
  "Chips down, hearts up. Let's dance.",
  "Ready to lose a little? I mean play. Ready to play?",
];

const SHUFFLE = [
  "Shuffle up! The cut card came out, so it's a fresh six-deck shoe. Don't act like that changes your luck.",
  'Cut card! Fresh shoe, six decks. New cards, same dealer — still me, still winning.',
  "There's the cut card. Reshuffle. Counters, start over — I see you, Professor.",
  'Fresh shoe, babies. Six decks, nice and shuffled. Your excuses just expired.',
  "Shuffle time. Watch these paws work. That's twenty years of practice, honey.",
];

const BETS_CLOSED = [
  'No more bets — paws OFF the felt!',
  'Bets are closed. Hands where I can see them.',
  "That's it, betting's done. Don't touch my felt.",
  'No more bets. Cards coming, try to look surprised.',
  "Bets are locked. No take-backs, I don't care who you are.",
  'Closed! Sit back and pray, darlings.',
  "Done. Hands off, eyes on me. As usual.",
];

const PEEK_TEN = [
  "I peek under the ten… nothing. Don't look so relieved.",
  'Peeking… no blackjack. You may breathe.',
  'Ten up, and I checked — no blackjack. Yet you still look nervous.',
  "I peek… nope. Lucky you. Don't waste it.",
  'No blackjack under there. Play your hands before I change my mind.',
];

const PEEK_ACE = [
  "Ace up. I peek… no blackjack. Breathe, darlings.",
  "Ace showing — and no, I don't have it. This time.",
  'Ace up, peeked, nothing. Y\'all can unclench.',
  "I peek under the Ace… nothing. Don't you dare get comfortable.",
];

const SHOW_WEAK = [
  "I'm showing {card}. Yes, it's a weak card. No, that doesn't mean you've won.",
  "{Card} up. Don't get cute.",
  "I've got {card} showing. Go on, get greedy. I dare you.",
  "{Card}. Bust card, they say. They say a lot of things.",
  "Showing {card}. Play smart for once.",
  "{Card} up. Somebody's about to overthink this.",
];

const SHOW_STRONG = [
  "I'm showing {card}. Sweat a little.",
  "{Card} up. Nervous? You should be.",
  "{Card}. Mm-hm. Make your little decisions.",
  "Showing {card}. I'd be scared too.",
  "{Card} up. Hit, stand, cry — your choice, baby.",
];

const DEALER_BJ = [
  'I peek… blackjack. Mine. Obviously.',
  'Blackjack for the house. Thank you for your donations.',
  "Blackjack! Oh, don't make that face. It's just business.",
  'And THAT is a blackjack. Pay the lady.',
  "Blackjack. I'd say sorry, but I'm not.",
  'House blackjack. Somebody hold me, I\'m too good.',
];

const PLAYER_BJ = [
  '{who} — blackjack. Three to two. Don\'t get cocky.',
  'Blackjack for {who}. Fine. Take your chips, show-off.',
  '{who} has blackjack. Beginner\'s luck, I assume.',
  'Oh, {who} gets a blackjack. How nice for you. Truly.',
  '{who}, blackjack. Three to two. Frame it, it won\'t happen again.',
];

const EVERYONE_SAT_OUT = [
  "Everybody sat out? Wow. I'll just be gorgeous over here, then.",
  "Nobody's playing? Fine. More time to admire myself.",
  'Not one bet? Cowards. All of you.',
];

const SURRENDER = [
  '{who} surrenders. Half back. Run along, baby.',
  "{who} gives up. Honestly? Respect. Half back.",
  "{who} folds like a lawn chair. Here's half.",
  'Surrender, {who}? Smart. Boring, but smart.',
  "{who} waves the white flag. I'll take the other half, thank you.",
];

const SPLIT = [
  '{who} splits. Two hands, twice the drama. I love it.',
  "{who} splits 'em. Bold. Let's see.",
  '{who} splits. More chips for me to take, sweetheart.',
  "Splitting, {who}? Look at you, all grown up.",
  '{who} splits. Somebody\'s feeling spicy.',
];

const DOUBLE = [
  '{who} doubles down — feeling lucky, are we?',
  "{who} doubles. Somebody's confident.",
  '{who} doubles! One card, all the nerve.',
  "Double down, {who}? Hell yes, let's go.",
  '{who} doubles. Put your money where your mouth is, I love that.',
];

const DOUBLE_BUST = [
  '{who} doubles… and busts. Oh, sweetheart. No.',
  "{who} doubled into a bust. That's a whole lot of chips to hand me. Thank you.",
  'Doubled and busted. {who}, that was a choice.',
];

const STAND_LOW = [
  "{who} stands on {n}?! On {n}? I— okay. Okay. Your money.",
  "Standing on {n}, {who}? Who taught you this game, a goldfish?",
  "{n}. {who} stands on {n}. I'm not even mad, I'm impressed.",
  '{who}, you can\'t bust on {n}. Take a card. No? …Wow.',
];

const BUST_ON_STIFF = [
  '{who} hit {was} and busted. Who raised you?',
  "Hitting {was}, {who}? Damn. Bold, wrong, but bold.",
  "{who} hit a {was}. On purpose. In public.",
];

const BUST = [
  '{who} busts with {n}. Mm. Tragic.',
  '{n} — bust! Bye, {who}.',
  "{who} busts. I'll take those chips, thank you.",
  '{who}, that\'s {n}. Over. Go sit in the corner.',
  "Bust! {who}, honey, the goal is twenty-ONE.",
  '{n}. Damn, {who}. That one hurt to watch.',
  "{who} busts. Don't cry on my felt, it's velvet.",
  'Too many, {who}. Story of your life, probably.',
  "{n}! Into the litter box it goes, {who}.",
];

const TWENTY_ONE = [
  'Twenty-one for {who}. Fine. I see you.',
  '{who} hits twenty-one. Look at you go.',
  'Twenty-one, {who}. Okay, okay. Don\'t let it go to your head.',
  "{who} makes twenty-one. Ugh. Good for you.",
];

const HOLE = [
  "Hole card's {card} — I've got {total}.",
  "Flip… {card}. That's {total} for me.",
  'Turning it over: {card}. {Total}. Stay calm.',
  '{Card} underneath. I\'ve got {total}, darlings.',
  "And the hole card is… {card}. {Total}. Don't shoot the messenger.",
];

const HOLE_NOBODY = [
  "Hole card's {card}. Doesn't matter — nobody's left standing. Easy money.",
  '{Card}. Not that it matters, y\'all already busted. Thank you, come again.',
  'Flip: {card}. And there\'s nobody left to beat. Sad, really.',
];

const SOFT17_HIT = [
  'Soft seventeen — Vegas rules, the house hits!',
  'Soft seventeen. In Vegas the house hits that. Watch me.',
  "That's a soft seventeen, so I take a card. House rules, babies.",
];

const DRAW = [
  'Card for the house: {card}. That\'s {total}.',
  '{Card}. {Total} for me.',
  'I take {card}. {Total}.',
  "Here's {card}. That makes {total}.",
  '{Card} — {total}. Getting warm.',
];

const DEALER_BUST_CARD = [
  '{Card}… ugh. I bust with {total}.',
  "{Card}. {Total}. Damn it. I bust.",
  '{Card}?! That\'s {total}. Fine, I bust. Nobody say anything.',
];

const DEALER_BUSTED = [
  "I bust. Don't get used to it.",
  "I bust. Take your little winnings — I'm still the prettiest one here.",
  'Over I go. Pay the winners. Quickly, before I change my mind.',
  'Fine, I busted. Collect your chips and stop smiling at me.',
  "Bust. Hell. Everybody still standing gets paid.",
  "I bust. Enjoy it, it's a rare event. Like an eclipse.",
];

const HOUSE_SWEEP = [
  'The house takes it all. As it should.',
  'Thank you for your donations.',
  'Clean sweep. I make this look easy because it is.',
  'All mine. Every chip. Come to mama.',
  'House wins. Shocking, I know.',
  "Nobody beat me? Not one of you? Damn, I'm good.",
];

const SOME_WIN = [
  'Some of you got lucky. Enjoy it while it lasts.',
  'Winners get paid. Losers get my sympathy. Not really.',
  "Fine — collect. I'm not bitter.",
  "Pay the winners. Don't look at me like that, I'm paying.",
  'Winners, take your chips. Losers, take a moment.',
  'A few of you beat me. Write it down, it won\'t happen again.',
];

const PUSHES_ONLY = ['Push. Nobody wins, nobody loses. How boring.', "Tie. Your chips stay. I'm unimpressed."];

// ── What she says ──────────────────────────────────────────────────────────

/** What she says when the game opens: the house rules, with attitude. */
export function openingLine(seed = 0): string {
  return pick(OPENING, seed, 'open');
}

/**
 * What she is saying about the table as it stands, for when there is no
 * previous state to compare with (the page was just opened or reloaded).
 */
export function ambientLine(s: GameState): string {
  switch (s.phase) {
    case 'idle':
    case 'betting':
      return s.handNo <= 1 ? openingLine(s.version) : "Oh, you're back. Bets down, sweetheart.";
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
  const say = (pool: readonly string[], key: string, vars: Record<string, string | number> = {}): string =>
    fill(pick(pool, v, key), { who, ...vars });

  if (s.phase === 'gameover' && prev.phase !== 'gameover') {
    const winner = s.winner === null ? '' : ` ${nameOf(s.winner)} leaves with the most chips — don't let it go to your head.`;
    const house = s.house > 0 ? ' The house is up, as God intended.' : ' The house is down. This never happened. Tell no one.';
    return `Last hand. Table's closed.${winner}${house}`;
  }

  // A new round.
  if (s.phase === 'betting' && s.handNo !== prev.handNo) {
    if (s.handNo === 1) return openingLine(v);
    if (s.shoe.length === SHOE_SIZE) return say(SHUFFLE, 'shuffle');
    return say(NEW_ROUND, 'round', { n: s.handNo });
  }

  if (s.phase === 'betting' && prev.phase === 'betting' && s.toAct === null && prev.toAct !== null) {
    return say(BETS_CLOSED, 'closed');
  }

  // The deal (and the peek).
  if (prev.phase === 'betting') {
    if (s.phase === 'settled' && s.result?.dealerBlackjack) return say(DEALER_BJ, 'dbj');
    if (s.phase === 'settled' && s.dealer.length === 0) return say(EVERYONE_SAT_OUT, 'sat');
    if (s.phase === 'playing') {
      const up = cardValue(s.dealer[0]);
      const naturals = s.players
        .map((p, seat) => (p.hands[0] && isBlackjack(p.hands[0]) ? nameOf(seat) : null))
        .filter((n): n is string => n !== null);
      const bj = naturals.length ? ' ' + fill(pick(PLAYER_BJ, v, 'pbj'), { who: naturals.join(' and ') }) : '';
      const card = cardWords(s.dealer[0]);
      if (up === 11) return say(PEEK_ACE, 'peekA') + bj;
      if (up === 10) return say(PEEK_TEN, 'peek10') + bj;
      if (bj) return `${cap(card)} up.${bj}`;
      return say(up <= 6 ? SHOW_WEAK : SHOW_STRONG, 'show', { card, Card: cap(card) });
    }
  }

  // A player's move.
  if (s.phase === 'playing' || (s.phase !== prev.phase && prev.phase === 'playing')) {
    const p = s.players[by];
    const before = prev.players[by];
    switch (s.lastMove?.kind) {
      case 'surrender':
        return say(SURRENDER, 'surr');
      case 'split':
        return say(SPLIT, 'split');
      case 'double': {
        const hand = p.hands.find((h, i) => h.doubled && !before.hands[i]?.doubled);
        const total = hand ? handValue(hand.cards).total : 0;
        if (total > 21) return say(DOUBLE_BUST, 'dbust');
        return say(DOUBLE, 'double') + (total ? ` That's ${total}.` : '');
      }
      case 'stand': {
        const hand = before.hands[before.active];
        const total = hand ? handValue(hand.cards).total : 0;
        if (hand && total <= 11) return say(STAND_LOW, 'low', { n: total });
        return null;
      }
      case 'hit': {
        const hand = p.hands.find((h, i) => h.cards.length > (before.hands[i]?.cards.length ?? 0));
        if (!hand) return null;
        const total = handValue(hand.cards).total;
        const was = handValue(hand.cards.slice(0, -1));
        if (total > 21 && !was.soft && was.total >= 17) return say(BUST_ON_STIFF, 'stiff', { was: was.total });
        if (total > 21) return say(BUST, 'bust', { n: total });
        if (total === 21) return say(TWENTY_ONE, '21');
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
    if (!anyLeft) return say(HOLE_NOBODY, 'holeX', { card, Card: cap(card) });
    const t = `${soft && total < 21 ? 'soft ' : ''}${total}`;
    return say(HOLE, 'hole', { card, Card: cap(card), total: t, Total: cap(t) });
  }
  if (s.phase === 'dealer' && s.dealer.length > prev.dealer.length) {
    const before = s.dealer.slice(0, -1);
    const card = cardWords(s.dealer[s.dealer.length - 1]);
    const { total } = handValue(s.dealer);
    const why = dealerSoft17(before) ? say(SOFT17_HIT, 's17') + ' ' : '';
    const vars = { card, Card: cap(card), total, Total: String(total) };
    if (total > 21) return why + say(DEALER_BUST_CARD, 'dbc', vars);
    return why + say(DRAW, 'draw', vars);
  }
  if (s.phase === 'settled' && prev.phase === 'dealer') {
    const r = s.result!;
    if (r.dealerTotal > 21) return say(DEALER_BUSTED, 'busted');
    const stand = `I stand on ${r.dealerTotal}.`;
    const wins = r.net.filter((n) => n > 0).length;
    const losses = r.net.filter((n) => n < 0).length;
    if (wins === 0 && losses === 0) return `${stand} ${say(PUSHES_ONLY, 'push')}`;
    if (wins === 0) return `${stand} ${say(HOUSE_SWEEP, 'sweep')}`;
    return `${stand} ${say(SOME_WIN, 'some')}`;
  }
  return null;
}

/** The cut card's position, for the shoe gauge: a fraction of a full shoe. */
export const CUT_FRACTION = RULES.CUT / SHOE_SIZE;
