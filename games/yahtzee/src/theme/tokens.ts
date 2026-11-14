/**
 * Design tokens, as TypeScript values.
 *
 * THIS FILE AND `src/theme/tokens.css` ARE MIRRORED BY HAND AND MUST BE EDITED
 * TOGETHER, VALUE FOR VALUE. Nothing generates one from the other and nothing
 * checks them at build time, so a change to a colour here that is not made
 * there produces a UI where a canvas-drawn die and its CSS surround are subtly
 * different shades.
 *
 * Which one to use:
 *   - In a stylesheet, ALWAYS use the custom property: `color: var(--text)`.
 *     Then a future theme swap is one file.
 *   - Reach for this module only where CSS cannot go: values passed to a canvas
 *     2D context, an SVG attribute computed in JS, a `<meta name="theme-color">`
 *     tag, or a numeric duration handed to an animation API.
 *
 * `cssVar` is provided for the in-between case (an inline style object), so
 * components never hand-write the `var(--x)` string and typo a token name.
 */

/** Literal token values. Mirrors tokens.css exactly. */
export const tokens = {
  color: {
    felt: '#151828',
    feltRaised: '#1e2238',
    feltDeep: '#0e1020',
    surface: '#262b45',
    surfaceRaised: '#323853',
    border: '#3d4462',
    accent: '#f0a830',
    accentDim: '#b8801f',
    good: '#4ec98a',
    warn: '#e8b64c',
    bad: '#f2705f',
    text: '#f2f0f7',
    textMuted: '#b9b6cc',
    textHint: '#9d9ab4',
    textFaint: '#6b6885',
    textOnAccent: '#1a1206',
    dieFace: '#f7f4ee',
    diePip: '#1b1f30',
    dieHeld: '#ffd27a',
  },
  space: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '0.75rem',
    lg: '1rem',
    xl: '1.5rem',
    xxl: '2rem',
    section: '3rem',
  },
  radius: {
    sm: '4px',
    md: '8px',
    lg: '14px',
    xl: '22px',
    pill: '999px',
  },
  size: {
    xs: '0.6875rem',
    sm: '0.8125rem',
    body: '0.9375rem',
    label: '1rem',
    md: '1.125rem',
    lg: '1.375rem',
    title: '1.75rem',
    xl: '2.125rem',
    xxl: '2.75rem',
    display: '3.5rem',
    hero: '4.5rem',
    giant: '6rem',
  },
  weight: {
    medium: 500,
    bold: 700,
    heavy: 800,
  },
  motion: {
    durFast: 120,
    durBase: 220,
    durSlow: 420,
    ease: 'cubic-bezier(0.2, 0.8, 0.25, 1)',
  },
  layout: {
    uiScale: 1,
    tableMaxWidth: '720px',
  },
} as const;

/**
 * Durations are NUMBERS of milliseconds here but `120ms` strings in the CSS —
 * the only intentional shape difference between the two files. JS animation
 * APIs and `setTimeout` want a number, and parsing `'120ms'` at every call site
 * to strip the unit is worse than documenting the difference once.
 */
export const durationMs = tokens.motion;

/** Every custom property name declared in tokens.css, for the `cssVar` type. */
const CSS_VAR_NAMES = [
  '--felt',
  '--felt-raised',
  '--felt-deep',
  '--surface',
  '--surface-raised',
  '--border',
  '--accent',
  '--accent-dim',
  '--good',
  '--warn',
  '--bad',
  '--text',
  '--text-muted',
  '--text-hint',
  '--text-faint',
  '--text-on-accent',
  '--die-face',
  '--die-pip',
  '--die-held',
  '--space-xs',
  '--space-sm',
  '--space-md',
  '--space-lg',
  '--space-xl',
  '--space-xxl',
  '--space-section',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--radius-xl',
  '--radius-pill',
  '--size-xs',
  '--size-sm',
  '--size-body',
  '--size-label',
  '--size-md',
  '--size-lg',
  '--size-title',
  '--size-xl',
  '--size-xxl',
  '--size-display',
  '--size-hero',
  '--size-giant',
  '--weight-medium',
  '--weight-bold',
  '--weight-heavy',
  '--dur-fast',
  '--dur-base',
  '--dur-slow',
  '--ease',
  '--ui-scale',
  '--table-max-width',
] as const;

/** A custom property declared in tokens.css. */
export type TokenName = (typeof CSS_VAR_NAMES)[number];

/**
 * `cssVar('--accent')` -> `'var(--accent)'`, checked against the token list so a
 * typo is a compile error instead of a silently transparent colour. Use in
 * inline style objects; prefer a real stylesheet rule where one will do.
 */
export function cssVar(name: TokenName): string {
  return `var(${name})`;
}
