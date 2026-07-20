/**
 * One die face.
 *
 * Presentational and non-interactive on purpose: the tray wraps it in the
 * button that owns the hold toggle. Keeping the die itself inert means it can
 * also be rendered read-only in an opponent's row without growing a "is this
 * clickable" prop.
 *
 * Pips are real elements placed into a 3x3 CSS grid by `grid-area` (see
 * die.css), not a font glyph or an image. That way they inherit the pip colour
 * token, scale with `--ui-scale`, and stay crisp at any size.
 */

import './die.css';

/** Pip slots in the 3x3 grid. Two letters: row (t/m/b) then column (l/c/r). */
type PipSlot = 'tl' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'br';

/**
 * The canonical pip arrangements. 1/3/5 use the centre slot; 6 fills both
 * middle side slots. Note 2 and 3 run top-left to bottom-right, which is the
 * arrangement on a Western die.
 */
const PIPS: Record<number, PipSlot[]> = {
  1: ['mc'],
  2: ['tl', 'br'],
  3: ['tl', 'mc', 'br'],
  4: ['tl', 'tr', 'bl', 'br'],
  5: ['tl', 'tr', 'mc', 'bl', 'br'],
  6: ['tl', 'tr', 'ml', 'mr', 'bl', 'br'],
};

export interface DieProps {
  /**
   * The face showing, 1..6. Anything else (notably 0) renders a BLANK die —
   * that is how the tray draws the five placeholders before a turn's first
   * roll, when `state.dice` is legitimately `[]`.
   */
  face: number;
  /** Held back from the next re-roll. Drawn with a ring and a warm tint. */
  held?: boolean;
  /** Dimmed and non-responsive. Purely visual; the wrapping control also disables. */
  disabled?: boolean;
  /** Play the tumble animation. Ignored entirely when `motion` is false. */
  rolling?: boolean;
  /**
   * Whether animation is allowed at all. Must already combine the user's
   * setting with the OS `prefers-reduced-motion` veto (see use-reduced-motion).
   */
  motion?: boolean;
  /**
   * Accessible name. Defaults to the face value. A wrapping button with its own
   * `aria-label` overrides this, which is what the tray relies on.
   */
  label?: string;
}

export function Die({
  face,
  held = false,
  disabled = false,
  rolling = false,
  motion = true,
  label,
}: DieProps) {
  const blank = !PIPS[face];
  const pips = blank ? [] : PIPS[face];

  const grid = (
    <span className="die__pips">
      {pips.map((slot) => (
        <span key={slot} className="die__pip" data-slot={slot} />
      ))}
    </span>
  );

  return (
    <span
      className="die"
      role="img"
      aria-label={label ?? (blank ? 'empty die' : `die showing ${face}`)}
      data-held={held ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
      data-blank={blank ? 'true' : undefined}
    >
      {/*
       * When motion is off we render the pip grid DIRECTLY, with no animation
       * wrapper at all — rather than keeping the wrapper and setting its
       * duration to zero. A zero-duration animation still creates a compositing
       * layer, and in some engines never fires `animationend`, which would hang
       * anything that waited on it. No wrapper means no animation machinery.
       */}
      {motion ? (
        <span className="die__tumble" data-rolling={rolling ? 'true' : undefined}>
          {grid}
        </span>
      ) : (
        grid
      )}
    </span>
  );
}

export default Die;
