/**
 * Spacing & radius tokens — the de-facto scale already used across the app,
 * centralized so layout values stop being magic numbers. Plain constants (no
 * React), mirroring `colors.ts`. Adopt incrementally.
 */

/** Padding / gap / margin steps. */
export const space = {
  xs: 4,
  sm: 6,
  gap: 8,
  md: 12,
  lg: 16,
  xl: 18,
  xxl: 24,
  section: 32,
} as const;

/** Corner radii. `pill` is the fully-rounded (999) capsule. */
export const radius = {
  card: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 16,
  sheet: 18,
  pill: 999,
} as const;

export const spacing = { space, radius } as const;
export type Spacing = typeof spacing;
