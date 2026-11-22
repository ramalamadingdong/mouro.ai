/**
 * The guided lessons, as data. A step either explains (`read`), asks you to
 * tap a tile (`pick`) or to choose an answer (`choose`).
 *
 * Every "which tile" answer is worked out by the engine at run time (waits,
 * removeTiles, doraOf…) rather than typed in, so a lesson cannot teach a
 * wrong answer; `__tests__/lessons.test.ts` checks every question has one.
 */
import type { ReactNode } from 'react';
import { doraOf, kindOf, removeTiles, t, tileName, waits } from '@/engine';
import { Notation } from '@/components/tile';

export type Step =
  | { kind: 'read'; body: ReactNode }
  | {
      kind: 'pick';
      prompt: ReactNode;
      /** Tile notation of the tiles to choose from. */
      tiles: string;
      right: (tile: string) => boolean;
      /** Said after a right answer. */
      why: string;
      /** Said after a wrong one (gets the tile tapped). */
      hint: (tile: string) => string;
    }
  | {
      kind: 'choose';
      prompt: ReactNode;
      options: { label: string; right: boolean; why: string }[];
    };

export interface Lesson {
  title: string;
  steps: Step[];
}

export const LESSONS: Lesson[] = [
  {
    title: 'The tiles',
    steps: [
      {
        kind: 'read',
        body: (
          <>
            <p>
              Mahjong has three <strong>suits</strong>, each numbered 1 to 9, with four copies of every tile.
            </p>
            <p>Characters (man) — the big number is on top, the red 萬 below:</p>
            <Notation n="123456789m" />
            <p>Dots (pin):</p>
            <Notation n="123456789p" />
            <p>Bamboo (sou) — the 1 is drawn as a bird:</p>
            <Notation n="123456789s" />
          </>
        ),
      },
      {
        kind: 'pick',
        prompt: 'Tap the 3 of bamboo.',
        tiles: '3m 3p 3s 8s',
        right: (x) => x === t('3s'),
        why: 'Three green-and-blue sticks: the 3 of bamboo.',
        hint: (x) => `That is the ${tileName(x)}. Bamboo tiles are sticks.`,
      },
      {
        kind: 'read',
        body: (
          <>
            <p>
              Then the <strong>honours</strong>, which have no numbers. Four winds — East, South, West, North:
            </p>
            <Notation n="1234z" />
            <p>and three dragons — white, green, red:</p>
            <Notation n="567z" />
            <p>
              The 1s and 9s are called <strong>terminals</strong>; the 2–8s are <strong>simples</strong>. That matters
              for scoring later.
            </p>
          </>
        ),
      },
      {
        kind: 'pick',
        prompt: 'Tap the red dragon.',
        tiles: '1z 5z 6z 7z',
        right: (x) => x === t('7z'),
        why: 'Right — the red 中 is the red dragon.',
        hint: (x) => `That is the ${tileName(x)}.`,
      },
    ],
  },
  {
    title: 'Sets and a pair',
    steps: [
      {
        kind: 'read',
        body: (
          <>
            <p>You collect tiles into sets of three:</p>
            <ul>
              <li>
                a <strong>run</strong> of three in a row in one suit — called a <strong>chi</strong> <Notation n="456p" />
              </li>
              <li>
                three of the same tile — a <strong>pon</strong> <Notation n="222s" />
              </li>
              <li>
                four of the same is a <strong>kan</strong>; it counts as one set.
              </li>
            </ul>
            <p>
              Honours only make pons; a run cannot use honours or wrap from 9 to 1. A <strong>pair</strong> is two the same{' '}
              <Notation n="55z" />.
            </p>
          </>
        ),
      },
      {
        kind: 'pick',
        prompt: (
          <>
            Which tile would finish this run? <Notation n="45p" />
          </>
        ),
        tiles: '3p 5p 6p 6s',
        right: (x) => x === t('3p') || x === t('6p'),
        why: '3-4-5 or 4-5-6 of dots: both finish the run. Holding two tiles next to each other leaves you two ways in.',
        hint: (x) => `${tileName(x)} does not continue 4-5 of dots: a run has to be the same suit and in a row.`,
      },
      {
        kind: 'choose',
        prompt: (
          <>
            What is <Notation n="999m" />?
          </>
        ),
        options: [
          { label: 'A run (chi)', right: false, why: 'A run is three different numbers in a row.' },
          { label: 'Three of a kind (pon)', right: true, why: 'Three 9s of characters: a pon.' },
          { label: 'Not a set', right: false, why: 'Three of the same tile is a set: a pon.' },
        ],
      },
    ],
  },
  {
    title: 'A winning hand',
    steps: [
      {
        kind: 'read',
        body: (
          <>
            <p>
              You hold 13 tiles. Each turn you <strong>draw one</strong> (14) and <strong>throw one</strong> (back to
              13). You win with 14 tiles that make <strong>four sets and a pair</strong>:
            </p>
            <Notation n="123m 456p 789s 234s 55z" />
            <p>
              When you are one tile away from that, you are <strong>ready</strong> (tenpai), and the game shows which tiles
              you are waiting on.
            </p>
          </>
        ),
      },
      {
        kind: 'pick',
        prompt: (
          <>
            You just drew and hold 14 tiles. Throw the one tile that leaves you ready:
          </>
        ),
        tiles: '123m 456p 789s 11z 23s 9m',
        right: (x) => waits(removeTiles(t('123m 456p 789s 11z 23s 9m'), x) ?? '').length > 0,
        why: 'The lone 9 of characters fits nothing. Without it you have three runs, a pair of East and 2-3 of bamboo: ready, waiting on a 1 or 4 of bamboo.',
        hint: (x) => `Throwing ${tileName(x)} breaks a set you already have. Look for the tile that fits with nothing.`,
      },
      {
        kind: 'pick',
        prompt: (
          <>
            This hand is ready. Tap a tile that would win: <Notation n="123m 456p 789s 55z 34s" />
          </>
        ),
        tiles: '1s 2s 4s 5s 6s',
        right: (x) => waits(t('123m 456p 789s 55z 34s')).includes(x),
        why: '3-4 of bamboo waits on both sides: a 2 or a 5 makes the last run. Two-sided waits are the best kind.',
        hint: (x) => `${tileName(x)} does not make 3-4 of bamboo into a run of three.`,
      },
    ],
  },
  {
    title: 'Calling tiles',
    steps: [
      {
        kind: 'read',
        body: (
          <>
            <p>When someone throws a tile you need, you can take it — the game asks you only when you can:</p>
            <ul>
              <li>
                <strong>Pon</strong>: you hold two of it. Anyone's throw.
              </li>
              <li>
                <strong>Chi</strong>: it finishes a run — but only from the player <em>just before you</em>.
              </li>
              <li>
                <strong>Kan</strong>: you hold three of it.
              </li>
              <li>
                <strong>Ron</strong>: it wins your hand. Ron beats every other call.
              </li>
            </ul>
            <p>The called set goes face up, and you throw a tile. Play carries on from you.</p>
          </>
        ),
      },
      {
        kind: 'choose',
        prompt: (
          <>
            The player <strong>just before you</strong> throws <Notation n="6p" />. You hold <Notation n="45p" />. What can you call?
          </>
        ),
        options: [
          { label: 'Chi', right: true, why: 'They are just before you, and 4-5-6 of dots is a run: chi.' },
          { label: 'Pon', right: false, why: 'Pon needs two of the same tile already in your hand.' },
          { label: 'Nothing', right: false, why: 'A run from the player just before you can be called: chi.' },
        ],
      },
      {
        kind: 'choose',
        prompt: (
          <>
            Now the player <strong>across</strong> the table throws <Notation n="6p" />. You still hold <Notation n="45p" />.
          </>
        ),
        options: [
          { label: 'Chi', right: false, why: 'Chi only works on the player just before you.' },
          { label: 'Nothing', right: true, why: 'Right: chi is only from the player just before you. (Heads-up, your one opponent always is.)' },
        ],
      },
      {
        kind: 'read',
        body: (
          <>
            <p>
              <strong>Careful:</strong> calling opens your hand. In Japanese rules an open hand cannot declare riichi and
              loses several yaku — and you can only win with a yaku. Calling a dragon pon is safe (that pon is itself a
              yaku); calling just to get closer often leaves you stuck. The coach will warn you.
            </p>
          </>
        ),
      },
    ],
  },
  {
    title: 'Yaku and riichi',
    steps: [
      {
        kind: 'read',
        body: (
          <>
            <p>
              In Japanese mahjong a winning hand also needs at least one <strong>yaku</strong> — a scoring pattern. The
              easiest ones:
            </p>
            <ul>
              <li>
                <strong>Riichi</strong>: declare that your closed hand is ready.
              </li>
              <li>
                <strong>Tanyao</strong>: only simples (2–8), no 1s, 9s or honours. <Notation n="234m 567p 345s 678s 55p" />
              </li>
              <li>
                <strong>Yakuhai</strong>: a pon of dragons, or of your own or the round's wind. <Notation n="666z" />
              </li>
              <li>
                <strong>Menzen tsumo</strong>: win on your own draw with a closed hand.
              </li>
            </ul>
            <p>The full list, with examples, is under ? → Yaku &amp; scoring.</p>
          </>
        ),
      },
      {
        kind: 'read',
        body: (
          <>
            <p>
              <strong>Riichi</strong>: when your hand is closed (no calls) and ready, choose the tile to throw and press{' '}
              <strong>Riichi!</strong> You put down 1,000 points and can no longer change your hand — every tile you draw
              goes out unless it wins.
            </p>
            <p>
              In return your hand has a yaku whatever it looks like, win within a turn for <strong>ippatsu</strong>, and the
              hidden <strong>ura dora</strong> are turned over when you win.
            </p>
          </>
        ),
      },
      {
        kind: 'choose',
        prompt: 'Your hand is closed and ready, but has no yaku. What should you do?',
        options: [
          { label: 'Declare riichi', right: true, why: 'Riichi is a yaku, so now any winning tile wins.' },
          { label: 'Call a chi to finish it', right: false, why: 'A call opens the hand — still no yaku, and now no riichi either.' },
          { label: 'Wait and hope', right: false, why: 'Without a yaku you could only win by drawing it yourself (menzen tsumo). Riichi makes every winning tile count.' },
        ],
      },
      {
        kind: 'pick',
        prompt: (
          <>
            You want <strong>tanyao</strong> (all simples). Which tile do you throw from <Notation n="234m 567p 34s 88s 9p 6m" />?
          </>
        ),
        tiles: '234m 567p 34s 88s 9p 6m',
        right: (x) => x === t('9p'),
        why: 'The 9 of dots is a terminal: tanyao allows only 2s to 8s.',
        hint: (x) => `${tileName(x)} is a simple — it is fine for tanyao. Find the 1, 9 or honour.`,
      },
    ],
  },
  {
    title: 'Furiten and dora',
    steps: [
      {
        kind: 'read',
        body: (
          <>
            <p>
              <strong>Furiten</strong>: if any tile you are waiting on is in <em>your own</em> discards, you cannot win
              by Ron (on someone else&apos;s tile) — only by drawing it yourself. Letting a winning tile go by does the same
              until your next throw (for the rest of the hand, after riichi).
            </p>
            <p>So: do not throw tiles you might later want to win on. The game warns you when you are furiten.</p>
          </>
        ),
      },
      {
        kind: 'read',
        body: (
          <>
            <p>
              <strong>Dora</strong> are bonus tiles. A tile at the side of the table is the <em>indicator</em>; the dora is
              the <strong>next</strong> tile in order — after a 9 comes the 1 again, winds go East → South → West → North
              → East, dragons white → green → red → white.
            </p>
            <p>
              <Notation n="3p" /> means the 4 of dots is dora. Each dora you hold when you win adds a han — but dora are not a
              yaku.
            </p>
          </>
        ),
      },
      {
        kind: 'pick',
        prompt: (
          <>
            The indicator is <Notation n="9m" />. Tap the dora.
          </>
        ),
        tiles: '8m 9m 1m 1p',
        right: (x) => kindOf(x) === doraOf(kindOf(t('9m'))),
        why: 'After the 9 comes the 1 again, in the same suit: the 1 of characters is dora.',
        hint: (x) => `${tileName(x)} is not the tile after 9 of characters. Numbers wrap round from 9 to 1, same suit.`,
      },
    ],
  },
  {
    title: 'Scoring and the game',
    steps: [
      {
        kind: 'read',
        body: (
          <>
            <p>
              Everyone starts with <strong>25,000</strong> points. A win is worth <strong>han</strong> (yaku and dora) and{' '}
              <strong>fu</strong> (the shape); the game works it out and shows every line. Five han is a{' '}
              <strong>mangan</strong>: 8,000 points, or 12,000 for the dealer.
            </p>
            <p>
              On <strong>Ron</strong> the player who threw the tile pays it all. On <strong>Tsumo</strong> everyone pays a
              share. The dealer (East) wins and pays one and a half times as much — and keeps the deal after winning.
            </p>
            <p>
              If the wall runs out, players who were not ready pay those who were. The game ends after the East round (or
              East and South), or when someone drops below zero.
            </p>
          </>
        ),
      },
      {
        kind: 'choose',
        prompt: 'Someone throws your winning tile. You say “Ron!”. Who pays?',
        options: [
          { label: 'Only the player who threw it', right: true, why: 'Right — on Ron the thrower pays the whole hand.' },
          { label: 'Everyone else', right: false, why: 'That is a Tsumo, when you draw the tile yourself.' },
        ],
      },
    ],
  },
  {
    title: 'Hong Kong rules',
    steps: [
      {
        kind: 'read',
        body: (
          <>
            <p>The Hong Kong game uses the same tiles, sets, calls and four-sets-and-a-pair. The differences:</p>
            <ul>
              <li>
                The calls are called <strong>chow</strong>, <strong>pung</strong> and <strong>kong</strong>, and you say{' '}
                <strong>Mahjong!</strong> to win.
              </li>
              <li>
                Eight <strong>flowers and seasons</strong> <Notation n="1f1y" /> are set aside when drawn and replaced; your own
                ones score.
              </li>
              <li>
                No riichi, no dora, no furiten. Hands score <strong>faan</strong>, and the table chooses a minimum — with
                none, any complete hand wins.
              </li>
              <li>Points start from zero and only the difference matters.</li>
            </ul>
          </>
        ),
      },
    ],
  },
];

