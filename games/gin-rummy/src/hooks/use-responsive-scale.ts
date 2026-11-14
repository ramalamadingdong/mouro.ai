import { useWindowDimensions } from 'react-native';

/** The table column is capped at this width so it never stretches awkwardly. */
export const TABLE_MAX_WIDTH = 820;

/**
 * A UI scale factor for the game table so cards, piles, and the hand grow on
 * larger screens (tablets, desktop/web) instead of staying phone-sized. It's a
 * plain multiplier off the window size:
 *   - width term keeps the fanned hand inside the (capped) table column, and
 *   - height term keeps the whole table from overflowing vertically.
 * The smaller of the two wins, clamped to [1, 2.2]. Phones land at ~1; a portrait
 * iPad ~2×.
 */
export function useResponsiveScale(): number {
  const { width, height } = useWindowDimensions();
  // Usable width inside the table column (Screen padding + a little margin).
  const availW = Math.min(width, TABLE_MAX_WIDTH) - 48;
  const byWidth = availW / 360; // ~fits the widest fanned hand at this scale
  const byHeight = height / 520; // vertical breathing room
  return Math.max(1, Math.min(2.2, Math.min(byWidth, byHeight)));
}
