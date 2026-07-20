/**
 * The "drawable" gold glow shared by the stock and discard piles. On iOS a soft
 * gold shadow reads as a glow; Android's `elevation` shadow renders GREY (not
 * gold), so instead of elevation we paint a translucent gold halo behind the
 * card — which looks correct on both platforms. Render `<View style={halo}>` as
 * the first child of the pile (so it sits behind the card) when drawable.
 */
import { Platform, StyleSheet } from 'react-native';

import { accent } from '@/theme/colors';

export const pileGlow = StyleSheet.create({
  /** Applied to the pile wrapper when the pile is drawable: gold border + iOS glow. */
  drawable: {
    borderWidth: 2,
    borderColor: accent.gold,
    ...Platform.select({
      ios: {
        shadowColor: accent.gold,
        shadowOpacity: 0.9,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 0 },
      },
      default: {},
    }),
  },
  /** Translucent gold halo behind the card — the cross-platform glow. */
  halo: {
    position: 'absolute',
    top: -5,
    left: -5,
    right: -5,
    bottom: -5,
    borderRadius: 12,
    backgroundColor: accent.gold,
    opacity: 0.22,
  },
});
