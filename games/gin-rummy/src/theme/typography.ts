/**
 * Typography tokens — the de-facto type scale already in use across the app,
 * centralized so screens/components stop re-declaring font sizes and weights
 * inline. Plain constants (no React) so any module can import them, mirroring
 * `colors.ts`. Adopt incrementally: a file gains nothing by switching until it's
 * being edited anyway.
 */
import { Platform } from 'react-native';

/** Font sizes, smallest → largest. Names describe intent, not exact px. */
export const size = {
  /** Tiny captions ("new", pile labels). */
  xs: 10,
  /** Small caps labels / badges. */
  sm: 11,
  /** Notes, secondary hints. */
  note: 12,
  /** Body-small / most hint text. */
  body: 13,
  /** Standard label / subtitle. */
  label: 14,
  /** Emphasised label. */
  md: 15,
  /** Button / primary label. */
  lg: 16,
  /** Section / bar titles. */
  title: 18,
  /** Large emphasis (scores). */
  xl: 20,
  /** Prominent numerals. */
  xxl: 22,
  /** Modal titles. */
  display: 26,
  /** Screen titles. */
  hero: 30,
  /** Home hero title. */
  giant: 44,
  /** Room code. */
  mega: 48,
} as const;

/** Font weights — the app only ever uses these three. */
export const weight = {
  medium: '600',
  bold: '700',
  heavy: '800',
} as const;

/** letterSpacing values in use. */
export const tracking = {
  tight: 0.3,
  /** Small-caps labels. */
  label: 0.5,
  /** Uppercase headings. */
  wide: 1,
  /** Room-code style. */
  code: 2,
  /** The big room code on the lobby. */
  codeWide: 8,
} as const;

/**
 * Monospace family that actually resolves on both platforms. `'monospace'` is
 * only valid on Android; iOS silently falls back to Courier, so name Menlo there.
 */
export const mono = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
}) as string;

export const typography = { size, weight, tracking, mono } as const;
export type Typography = typeof typography;
