/**
 * A dealer's voice: every line they can say, by moment. The logic that picks
 * WHEN to say what lives in `src/dealer-talk.ts` and is shared by every
 * dealer; a dealer is only data. Lines use `{who}` (the player), `{n}`,
 * `{card}`/`{Card}` ("a 7"/"A 7"), `{total}`/`{Total}` and `{was}`.
 */

export const LINE_KEYS = [
  'open',
  'round',
  'shuffle',
  'closed',
  'peek10',
  'peekA',
  'showWeak',
  'showStrong',
  'dbj',
  'pbj',
  'sat',
  'surr',
  'split',
  'double',
  'dbust',
  'low',
  'stiff',
  'bust',
  '21',
  'hole',
  'holeX',
  's17',
  'draw',
  'dbc',
  'busted',
  'sweep',
  'some',
  'tipS',
  'tipN',
  'tipB',
  'push',
] as const;

export type LineKey = (typeof LINE_KEYS)[number];

export interface Voice {
  lines: Record<LineKey, readonly string[]>;
  /** Five escalating levels of impatience at the player on turn ({who}). */
  nag: readonly (readonly string[])[];
  /** Five levels for when a round is paid and nobody deals the next one. */
  nagDeal: readonly (readonly string[])[];
  /** One emoji per impatience level. */
  nagEmoji: readonly string[];
  /** When someone they were nagging finally moves. */
  finally: readonly string[];
  finallyEmoji: readonly string[];
  /** Emoji by moment (the same keys as `lines`, plus 'show', 'open', 'over', 'ambient'). */
  emoji: Record<string, readonly string[]>;
  over: {
    closed: string;
    winner: string;
    houseUp: string;
    houseDown: string;
    noTips: string;
    tips: string;
  };
  /** What they are saying when the page opens mid-game (no previous state to compare). */
  ambient: {
    back: string;
    playing: string;
    dealer: string;
    settledBJ: string;
    settled: string;
    over: string;
  };
}
