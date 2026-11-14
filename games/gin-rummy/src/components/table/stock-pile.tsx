import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CardBack } from '@/components/card-back';
import { CARD_WIDTH, CARD_HEIGHT } from '@/components/playing-card';
import { pileGlow } from '@/components/table/pile-glow';
import { accent, text } from '@/theme/colors';

export type StockPileProps = {
  /** Number of cards remaining in the stock. */
  count: number;
  /** When true, the pile glows gold and is pressable. */
  drawable?: boolean;
  /** Size multiplier (1 = default card size). */
  scale?: number;
  /** Fired when a drawable pile is tapped. */
  onPress?: () => void;
  /**
   * Card-back photo for the pile — the CURRENT player's back (whose turn it is).
   * `undefined` → this device's own back; `null` → the default lattice.
   */
  cardBack?: string | null;
};

const LOW_STOCK = 5;

function StockPileBase({ count, drawable, scale = 1, onPress, cardBack }: StockPileProps) {
  const lowStock = count <= LOW_STOCK;

  const pile = (
    <View style={[styles.pile, drawable && pileGlow.drawable]}>
      {drawable ? <View style={pileGlow.halo} pointerEvents="none" /> : null}
      <CardBack width={CARD_WIDTH * scale} height={CARD_HEIGHT * scale} uri={cardBack} />
      <View style={[styles.badge, lowStock && styles.badgeLow]}>
        <Text style={[styles.badgeText, lowStock && styles.badgeTextLow]}>{count}</Text>
      </View>
    </View>
  );

  if (!drawable) return pile;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Draw from stock, ${count} cards`}
    >
      {pile}
    </Pressable>
  );
}

/** The face-down stock pile: a count badge, a drawable gold glow, and a low-stock tint. */
export const StockPile = memo(StockPileBase);

const styles = StyleSheet.create({
  pile: {
    borderRadius: 8,
    padding: 4,
  },
  badge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: accent.gold,
  },
  badgeLow: {
    backgroundColor: accent.warn,
  },
  badgeText: {
    color: text.onGold,
    fontSize: 12,
    fontWeight: '800',
  },
  badgeTextLow: {
    color: text.primary,
  },
});
