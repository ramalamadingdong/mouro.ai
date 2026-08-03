/**
 * Game palette — the dark "felt" theme carried over from the gin rummy app, so
 * the two games on mouro.ai read as siblings. Plain constants (no React) so any
 * module can import them, including the pure-ish CPU scripts.
 */

export const felt = {
  /** Deep table green, the primary background. */
  table: '#12362a',
  /** Slightly lighter felt for raised surfaces / the play area. */
  tableRaised: '#1b4d3e',
  /** Felt highlight, e.g. a glowing drop target ring. */
  tableGlow: '#2e7d5b',
  /** Darkest green — the board frame, bar, rail, and status-bar backdrop. */
  tableDeep: '#0d271e',
} as const;

/**
 * Checker + dice colours. The names are inherited from the card app on purpose:
 * `face`/`back` are literally the same two hues, so a cream checker and a cream
 * card face match across the two games.
 */
export const piece = {
  /** p0's checkers, and the dice faces. */
  face: '#f5f0e1',
  /** Rim/edge of a cream checker. */
  faceEdge: '#d8d0ba',
  /** p1's checkers. */
  back: '#7c2d3a',
  /** Rim/edge of a maroon checker. */
  backAccent: '#a34551',
  /** Dice pips, and text on a cream surface. */
  pip: '#1c1c1c',
  /** Selected/raised ring. */
  selected: '#d4af37',
} as const;

/** The board itself. */
export const board = {
  /** The play field between the triangles. */
  field: '#12362a',
  /** Odd-index points. */
  pointDark: '#1b4d3e',
  /** Even-index points. */
  pointLight: '#c9bfa4',
  /** Frame, bar and right rail. */
  frame: '#0d271e',
  /** Frame border / inlay. */
  inlay: '#9c8020',
} as const;

export const accent = {
  /** Primary gold accent for buttons, the room code, active turn. */
  gold: '#d4af37',
  goldDim: '#9c8020',
  /** Positive actions (bear off, take, win). */
  good: '#27ae60',
  /** Warnings (a blot left exposed, a big double). */
  warn: '#e67e22',
  /** Errors / danger / a hit. */
  bad: '#e74c3c',
  /** Opponent-online presence dot. */
  online: '#2ecc71',
  /** Opponent-offline presence dot. */
  offline: '#95a5a6',
} as const;

export const text = {
  /** Primary text on felt. */
  primary: '#f5f0e1',
  /** Secondary / muted text on felt. */
  muted: '#a8c3b5',
  /**
   * Readable hint text on felt (~3.5:1 on `felt.table`). Use this for hints the
   * player must actually read; reserve `faint` for decorative/disabled text.
   */
  hint: '#93b0a3',
  /** Faint / disabled / decorative text — too low-contrast for must-read copy. */
  faint: '#6f8c7e',
  /** Text on light (checker face / dice) surfaces. */
  onLight: '#1c2b24',
  /** Text on gold buttons. */
  onGold: '#1c2b24',
} as const;

export const theme = { felt, piece, board, accent, text } as const;
export type GameTheme = typeof theme;
