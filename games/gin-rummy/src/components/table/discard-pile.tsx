import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { PlayingCard, CARD_WIDTH, CARD_HEIGHT } from '@/components/playing-card';
import { pileGlow } from '@/components/table/pile-glow';
import type { CardId } from '@/engine';
import { accent, text } from '@/theme/colors';

export type DiscardPileProps = {
  /** The top (face-up) discard, or null when the pile is empty. */
  top: CardId | null;
  /** When true, the pile glows gold and can be taken. */
  drawable?: boolean;
  /** When true, show a dashed gold target ring (discard drop target). */
  isTarget?: boolean;
  /** Size multiplier (1 = default card size). */
  scale?: number;
  /** Fired when a drawable or target pile is tapped. */
  onPress?: () => void;
  /** Press-and-hold the top card (e.g. to preview which hand cards it matches). */
  onLongPress?: () => void;
  /** Fired when the press is released (e.g. to end a hold-to-peek). */
  onPressOut?: () => void;
};

function DiscardPileBase({
  top,
  drawable,
  isTarget,
  scale = 1,
  onPress,
  onLongPress,
  onPressOut,
}: DiscardPileProps) {
  const face =
    top === null ? (
      <View
        style={[
          styles.empty,
          scale !== 1 && { width: CARD_WIDTH * scale, height: CARD_HEIGHT * scale },
          isTarget && styles.emptyTarget,
        ]}
      />
    ) : (
      <PlayingCard card={top} scale={scale} />
    );

  const pile = (
    <View
      style={[
        styles.pile,
        drawable && pileGlow.drawable,
        isTarget && styles.target,
      ]}
    >
      {drawable ? <View style={pileGlow.halo} pointerEvents="none" /> : null}
      {face}
    </View>
  );

  // Long-press works even when the pile isn't drawable/target, so you can always
  // peek what the top card matches in your hand.
  const canLongPress = !!onLongPress && top !== null;
  const pressable = drawable || isTarget || canLongPress;
  if (!pressable) return pile;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={canLongPress ? onLongPress : undefined}
      onPressOut={onPressOut}
      delayLongPress={300}
      accessibilityRole="button"
      accessibilityLabel={
        isTarget ? 'Discard here' : drawable ? 'Take discard' : 'Preview matches'
      }
    >
      {pile}
    </Pressable>
  );
}

/** The face-up discard pile: top card (or empty outline), drawable glow, and target ring. */
export const DiscardPile = memo(DiscardPileBase);

const styles = StyleSheet.create({
  pile: {
    borderRadius: 8,
    padding: 4,
  },
  target: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: accent.gold,
  },
  empty: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 6,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: text.faint,
  },
  emptyTarget: {
    borderColor: accent.gold,
  },
});
