/**
 * Duchess, the dealer: a Las Vegas diva with a mean streak and zero
 * patience (the owner asked for "meaner"). She has run this table longer than you have been alive, she is
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
// She is MEAN (the owner asked for meaner). Roast the play, never the person:
// no slurs, nothing about who anyone is — only how badly they play cards.

const OPENING = [
  "Welcome to MY table. Six decks, I hit soft seventeen, blackjack pays three to two. Bets down — I don't have all night, and neither does your wallet.",
  'Sit down, losers. House rules: six decks, I hit soft seventeen, blackjack pays three to two. Now disappoint me.',
  "Oh look, fresh money. Six decks, I hit soft seventeen, blackjack pays three to two. I'll be taking all of it.",
  "I'm Duchess. This is my table. Six decks, I hit soft seventeen, three to two on blackjack. Try to keep up, it's not hard.",
];

const NEW_ROUND = [
  'Bets down. Chop chop, some of us have standards.',
  'New hand. Same me. Same you, unfortunately. Bet.',
  "Chips on the felt — I'm aging watching you think.",
  'Place your bets. Try not to embarrass yourselves. Again.',
  "Go on, bet. The house is feeling generous. That's a lie, I'm never generous.",
  "Bets, please. I've got a manicure at six and you're not worth missing it.",
  'Feed the felt, darlings. Mama is hungry.',
  "Another round? Bless your little hearts. Bets down.",
  "Let's go, let's go. Your chips aren't going to lose themselves. Well. They might.",
  "Bet like you mean it. Or don't. I get paid either way.",
  'Round {n}. Some of you are still here? Brave. Stupid, but brave.',
  'Place your bets. And sit up straight, this is Vegas, not your mother\'s basement.',
  'Bets down. Whoever\'s humming, I will end you.',
  "Next hand. Somebody's luck is about to change. Spoiler: not yours.",
  'Chips down. Hope up. Hope is free, I\'ll allow it.',
  'Ready to lose a little? Sorry — ready to PLAY? Same thing at this table.',
  "Bets. Now. I've seen glaciers make faster decisions.",
  'Round {n}. I want to say I\'ve enjoyed this. I would be lying.',
  'Come on, put something down. I can smell your fear from here.',
  "Your chips look tired. Let me give them a nice new home. With me.",
  'Bet something. Anything. A button. Your dignity — oh wait, that\'s gone.',
  'Another hand of watching amateurs. My favorite. Bets down.',
];

const SHUFFLE = [
  "Shuffle up! Fresh six-deck shoe. Don't act like that changes your luck — your luck is the problem.",
  'Cut card! Fresh shoe, six decks. New cards, same dealer, same losers.',
  "There's the cut card. Reshuffle. Counters, start over — I see you, Professor, and I hate you.",
  'Fresh shoe. Six decks, nice and shuffled. Your excuses just expired.',
  "Shuffle time. Watch these paws work. Twenty years of practice, and you can't add to twenty-one.",
  'New shoe. Clean slate. Please don\'t ruin it immediately. You will, but please don\'t.',
];

const BETS_CLOSED = [
  'No more bets — paws OFF the felt!',
  'Bets are closed. Hands where I can see them, thieves.',
  "That's it, betting's done. Touch my felt again and you lose a finger.",
  'No more bets. Cards coming. Try to look less terrified.',
  "Bets are locked. No take-backs. I don't care who your mother is.",
  'Closed! Sit back and pray. Not that it helps.',
  'Done. Hands off, eyes on me. Where they belong.',
  'Bets are in. Some of you bet like it\'s your first time. Some of you, it shows.',
];

const PEEK_TEN = [
  "I peek under the ten… nothing. Don't look so relieved, it's pathetic.",
  'Peeking… no blackjack. You may breathe. Quietly.',
  'Ten up, no blackjack. Yet. You still look like you\'re about to cry.',
  "I peek… nope. Lucky you. You'll waste it, but lucky you.",
  'No blackjack under there. Play your hands before I lose interest. Too late.',
  "Nothing under the ten. I'll beat you the slow way, then.",
];

const PEEK_ACE = [
  'Ace up. I peek… no blackjack. Unclench, it\'s embarrassing.',
  "Ace showing — and no, I don't have it. This time. Enjoy the next thirty seconds.",
  "Ace up, peeked, nothing. Y'all can stop sweating on my velvet.",
  "I peek under the Ace… nothing. Don't you dare get comfortable.",
  'Ace up. No blackjack. I just wanted to watch you panic.',
];

const SHOW_WEAK = [
  "I'm showing {card}. Yes, it's a weak card. No, that doesn't mean you've won. You never win.",
  "{Card} up. Don't get cute. You're not cute.",
  "{Card} showing. Go on, get greedy. I dare you. I love it when you're greedy.",
  "{Card}. Bust card, they say. They also said you'd be good at this.",
  'Showing {card}. Play smart for once. For ONCE.',
  "{Card} up. Somebody's about to overthink this. It's you. It's always you.",
  "{Card}. Even with a weak card I'm scarier than you.",
];

const SHOW_STRONG = [
  "I'm showing {card}. Sweat. I want to see you sweat.",
  '{Card} up. Nervous? Good.',
  '{Card}. Mm-hm. Make your little decisions, little people.',
  'Showing {card}. I\'d be scared too. Actually, I\'d be scared of being you.',
  '{Card} up. Hit, stand, cry — your choice, baby. Crying is the popular one.',
  "{Card}. You're already losing, you just don't know it yet.",
];

const DEALER_BJ = [
  'I peek… blackjack. Mine. Obviously. Thanks for the chips, idiots.',
  'Blackjack for the house. Thank you for your donations, they will be wasted on me.',
  "Blackjack! Oh, don't make that face. Actually, do. I'm collecting them.",
  'And THAT is a blackjack. Pay the lady. Pay her NOW.',
  "Blackjack. I'd say sorry, but I'd rather laugh.",
  "House blackjack. Somebody hold me, I'm too good. Not you, you're sticky.",
  'Blackjack. Everybody lose. Feels nice. For me.',
];

const PLAYER_BJ = [
  "{who} — blackjack. Three to two. Don't get cocky, it's the only one you'll see.",
  'Blackjack for {who}. Fine. Take your chips, show-off. I\'ll get them back.',
  "{who} has blackjack. A blind cat finds a fish sometimes.",
  'Oh, {who} gets a blackjack. How nice for you. Truly. I\'m so happy. (I\'m not.)',
  "{who}, blackjack. Frame it. It won't happen again, I'll make sure of it.",
  '{who} got blackjack. The universe makes mistakes too.',
];

const EVERYONE_SAT_OUT = [
  "Everybody sat out? Cowards. I'll just be gorgeous over here, then.",
  "Nobody's playing? Pathetic. More time to admire myself.",
  'Not one bet? All of you, spineless. Every single one.',
];

const SURRENDER = [
  '{who} surrenders. Half back. Run along, baby. Run.',
  "{who} gives up. Shocking. Nobody saw that coming. Everybody saw that coming.",
  '{who} folds like a cheap lawn chair. Here\'s half. Don\'t spend it all on regret.',
  "Surrender, {who}? Smart. Boring and spineless, but smart.",
  "{who} waves the white flag. I'll keep the other half as a souvenir of your cowardice.",
  '{who} quits. Honestly the best decision you\'ve made all night.',
];

const SPLIT = [
  "{who} splits. Two hands, twice the chance to lose. Love it.",
  "{who} splits 'em. Bold. Let's watch it go wrong twice.",
  '{who} splits. More chips for me to take, sweetheart. Thank you.',
  "Splitting, {who}? Look at you pretending to know things.",
  "{who} splits. Somebody's feeling spicy. Somebody's about to feel poor.",
  '{who} splits. Did you read that somewhere? Read more.',
];

const DOUBLE = [
  '{who} doubles down — feeling lucky? You\'re not. But go off.',
  "{who} doubles. Somebody's confident. Somebody's wrong.",
  '{who} doubles! One card, twice the money, half the brain.',
  'Double down, {who}? Hell yes, give me MORE.',
  '{who} doubles. Put your money where your mouth is. Then lose it.',
  "{who} doubles. That's adorable. That's really adorable.",
];

const DOUBLE_BUST = [
  '{who} doubles… and busts. Oh, sweetheart. No. Ha. No.',
  "{who} doubled into a bust. That's a whole lot of chips to hand me. Thank you, genius.",
  'Doubled and busted. {who}, that was a choice. A bad one. A historically bad one.',
  "{who} doubled and busted. I'm going to tell everyone about this. Everyone.",
];

const STAND_LOW = [
  "{who} stands on {n}?! On {n}? I— okay. Okay. Your money. Your stupid money.",
  'Standing on {n}, {who}? Who taught you this game, a goldfish?',
  "{n}. {who} stands on {n}. I'm not even mad, I'm stunned.",
  "{who}, you can't bust on {n}. Take a card. No? …Wow. Wow.",
  "Stand on {n}? {who}, sweetie, that's not a strategy, that's a cry for help.",
];

const BUST_ON_STIFF = [
  '{who} hit {was} and busted. Who raised you? Wolves? Bad wolves?',
  'Hitting {was}, {who}? Damn. Bold, wrong, and broke.',
  '{who} hit a {was}. On purpose. In public. With people watching.',
  "{who} hit {was}. I've seen smarter moves from a vacuum cleaner.",
];

const BUST = [
  '{who} busts with {n}. Mm. Tragic. Delicious, but tragic.',
  '{n} — bust! Bye, {who}. Don\'t let the felt hit you on the way out.',
  "{who} busts. I'll take those chips, thank you. Every last one.",
  "{who}, that's {n}. Over. Go sit in the corner and think about what you did.",
  'Bust! {who}, honey, the goal is twenty-ONE. One. Not {n}.',
  '{n}. Damn, {who}. I almost felt something. Almost.',
  "{who} busts. Don't cry on my felt, it's velvet and you can't afford it.",
  'Too many, {who}. Story of your life, I assume.',
  '{n}! Into the litter box it goes, {who}. Where it belongs.',
  "{who} busts. Can't count to twenty-one. Can't count at all, apparently.",
  "Bust, {who}. Was that the plan? Tell me that wasn't the plan.",
  '{who}: {n}. Somewhere a math teacher just felt a chill.',
];

const TWENTY_ONE = [
  'Twenty-one for {who}. Fine. Even a broken clock.',
  '{who} hits twenty-one. Don\'t let it go to your head, there\'s nothing up there to go to.',
  "Twenty-one, {who}. Ugh. Enjoy it, it's the highlight of your night.",
  '{who} makes twenty-one. Lucky. Not good. Lucky.',
  'Twenty-one for {who}. I\'ll allow it. This once.',
];

const HOLE = [
  "Hole card's {card} — I've got {total}.",
  "Flip… {card}. That's {total} for me. Scared yet?",
  'Turning it over: {card}. {Total}. Stay calm. Or don\'t, it\'s funnier.',
  "{Card} underneath. I've got {total}, darlings. Start crying now and beat the rush.",
  "And the hole card is… {card}. {Total}. Don't shoot the messenger. The messenger is fabulous.",
];

const HOLE_NOBODY = [
  "Hole card's {card}. Doesn't matter — you ALL busted. Easy money. Embarrassing for you.",
  "{Card}. Not that it matters, y'all already blew it. Thank you, come again. Please. I need the money.",
  "Flip: {card}. And there's nobody left to beat. You beat yourselves. Impressive, honestly.",
];

const SOFT17_HIT = [
  'Soft seventeen — Vegas rules, the house hits!',
  'Soft seventeen. In Vegas the house hits that. Watch and weep.',
  "That's a soft seventeen, so I take another card. House rules, babies. MY house.",
];

const DRAW = [
  "Card for the house: {card}. That's {total}.",
  '{Card}. {Total} for me. Getting nervous?',
  'I take {card}. {Total}. Keep sweating.',
  "Here's {card}. That makes {total}. Tick tock.",
  '{Card} — {total}. Closer. Closer to taking everything you own.',
];

const DEALER_BUST_CARD = [
  '{Card}… ugh. I bust with {total}. This deck is rigged against ME.',
  '{Card}. {Total}. Damn it. I bust. Nobody clap.',
  "{Card}?! That's {total}. Fine, I bust. If anyone says one word—",
];

const DEALER_BUSTED = [
  "I bust. Don't get used to it. Seriously, don't.",
  "I bust. Take your little winnings — I'm still the prettiest one here, and the richest.",
  'Over I go. Pay the winners. Quickly, before I change my mind and the rules.',
  'Fine, I busted. Collect your chips and wipe that smile off your face.',
  'Bust. Hell. Everybody still standing gets paid. Don\'t thank me. Seriously, don\'t talk to me.',
  "I bust. Enjoy it, it's rare. Like you making a good decision.",
  'I busted. You didn\'t win, I lost. There\'s a difference and it matters to me.',
];

const HOUSE_SWEEP = [
  'The house takes it all. As it should. As it always will.',
  'Thank you for your donations. I\'ll think of you never.',
  'Clean sweep. I make this look easy because you make it easy.',
  'All mine. Every chip. Come to mama.',
  "House wins. Shocking, I know. Well. Shocking to you.",
  "Nobody beat me? Not ONE of you? Damn, I'm good. Or you're terrible. Both. It's both.",
  'Swept. The whole table. Somebody call your loved ones and apologize.',
  'House wins again. You keep giving, I keep taking. Beautiful relationship.',
];

const SOME_WIN = [
  'Some of you got lucky. Enjoy it, it won\'t last.',
  'Winners get paid. Losers get my pity. I\'m out of pity.',
  "Fine — collect. I'm not bitter. I'm a little bitter.",
  "Pay the winners. Don't look at me like that, I'm paying, I'm PAYING.",
  'Winners, take your chips. Losers, take a hard look at yourselves.',
  "A few of you beat me. Write it down, frame it, it won't happen again.",
  'Fine. Take it. I hope it was worth my mood.',
];

const TIP_SMALL = [
  "A {n}-chip tip? Wow. Don't strain yourself, {who}.",
  '{n} chips. How… insulting. I\'ll buy myself half a sardine.',
  "Thank you, {who}. I'll frame it next to my other disappointments.",
  '{n}? From {who}? Somebody call the newspapers, the cheapskate tipped.',
  "{n}? Cute. Keep it next time and buy yourself some basic strategy.",
  '{who} tips {n}. My cat litter costs more than that. I am the cat.',
];

const TIP_NICE = [
  '{who}! {n} chips. Finally, somebody with manners. The rest of you, take notes.',
  '{who} tips {n}. See? Some of you were raised right. Most of you weren\'t.',
  'Well, well. {n} for Duchess. {who}, you\'re tolerable now.',
  '{n} chips, {who}? Mm. I might stop laughing at you. Briefly.',
  "Thank you, sugar. You're still bad at this, but you're generous, and that's something.",
];

const TIP_BIG = [
  '{n}?! {who}, darling, sit closer. You are my favorite and everyone else is dead to me.',
  '{who} tips {n}! Somebody get this kitten a cushion. A velvet one. The rest of you get the floor.',
  "{n} chips. {who}, I'd still beat you, but I'd feel bad about it. For a second.",
  "Oh my. {n}! {who}, if I could deal you a blackjack right now, I would. I can't. But I'd want to.",
];

const PUSHES_ONLY = [
  'Push. Nobody wins, nobody loses. Just like your personality: nothing happening.',
  "Tie. Your chips stay. I'm unimpressed, and also bored.",
  'Push. What a waste of everyone\'s time. Mostly mine.',
];

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
      return s.handNo <= 1 ? openingLine(s.version) : "Oh. You're back. I was having such a nice time without you. Bets down.";
    case 'playing':
      return `I'm showing ${cardWords(s.dealer[0])}. Your move — and for once, try not to blow it.`;
    case 'dealer':
      return `My hand's up: ${handValue(s.dealer).total}. Watch and learn. Mostly learn.`;
    case 'settled':
      return s.result?.dealerBlackjack
        ? 'Blackjack. Mine. Obviously.'
        : `The house had ${s.result?.dealerTotal ?? 0}. Deal again whenever you've stopped crying, which, judging by your face, is never.`;
    case 'gameover':
      return "That's the last hand. Tip your dealer, then get out of my sight.";
  }
}

export function dealerLine(prev: GameState, s: GameState, nameOf: (seat: number) => string): string | null {
  const v = s.version;
  const by = s.lastMove?.seat ?? 0;
  const who = nameOf(by);
  const say = (pool: readonly string[], key: string, vars: Record<string, string | number> = {}): string =>
    fill(pick(pool, v, key), { who, ...vars });

  if (s.phase === 'gameover' && prev.phase !== 'gameover') {
    const winner = s.winner === null ? '' : ` ${nameOf(s.winner)} leaves with the most chips — the least bad of a bad bunch.`;
    const house = s.house > 0 ? ' The house is up, as God intended. Get out.' : ' The house is down. This never happened. Tell anyone and you\'re banned.';
    const tips = s.players.reduce((a, p) => a + p.tipped, 0);
    const tipNote =
      tips === 0 ? ' And not ONE tip all night. Cheap, every one of you. I will remember your faces.' : ` ${tips} in tips. I've had better. I've had worse. Mostly better.`;
    return `Last hand. Table's closed.${winner}${house}${tipNote}`;
  }

  // A new round.
  if (s.phase === 'betting' && s.handNo !== prev.handNo) {
    if (s.handNo === 1) return openingLine(v);
    if (s.shoe.length === SHOE_SIZE) return say(SHUFFLE, 'shuffle');
    return say(NEW_ROUND, 'round', { n: s.handNo });
  }

  if (s.lastMove?.kind === 'tip' && s.version !== prev.version) {
    const n = s.players[by].tipped - prev.players[by].tipped;
    return say(n >= 100 ? TIP_BIG : n >= 25 ? TIP_NICE : TIP_SMALL, 'tip', { n });
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
