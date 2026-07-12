/**
 * Game palette — a dark card-table "felt" theme used across every screen.
 * These are plain constants (no React) so any module can import them.
 */

export const felt = {
  /** Deep table green, the primary background. */
  table: '#12362a',
  /** Slightly lighter felt for raised surfaces / the play area. */
  tableRaised: '#1b4d3e',
  /** Felt highlight, e.g. a glowing drop target ring. */
  tableGlow: '#2e7d5b',
  /** Darkest green for the very bottom / status bar backdrop. */
  tableDeep: '#0d271e',
} as const;

export const card = {
  /** Card face. */
  face: '#f5f0e1',
  /** Subtle card face shadow / edge. */
  faceEdge: '#d8d0ba',
  /** Card back fill. */
  back: '#7c2d3a',
  /** Card back pattern accent. */
  backAccent: '#a34551',
  /** Red suits (hearts, diamonds). */
  suitRed: '#c0392b',
  /** Black suits (clubs, spades). */
  suitBlack: '#1c1c1c',
  /** Selected/raised card ring. */
  selected: '#d4af37',
} as const;

export const accent = {
  /** Primary gold accent for buttons, the room code, active turn. */
  gold: '#d4af37',
  goldDim: '#9c8020',
  /** Positive actions (knock, gin, win). */
  good: '#27ae60',
  /** Warnings (low stock, undercut risk). */
  warn: '#e67e22',
  /** Errors / danger. */
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
  /** Faint / disabled text. */
  faint: '#6f8c7e',
  /** Text on light (card face) surfaces. */
  onLight: '#1c2b24',
  /** Text on gold buttons. */
  onGold: '#1c2b24',
} as const;

/** Meld group underline colors, cycled by meld index in the hand view. */
export const meldColors = ['#3498db', '#9b59b6', '#e67e22', '#16a085'] as const;

/** Hold-to-peek match rings: green = same-rank (set), blue = same-suit (run). */
export const peek = { set: '#27ae60', run: '#3498db' } as const;

export const theme = { felt, card, accent, text, meldColors, peek } as const;
export type GameTheme = typeof theme;
