import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  RANK_LABELS,
  SUIT_SYMBOLS,
  isRed,
  rankOf,
  suitOf,
  type CardId,
} from '@/engine';
import { accent, card as cardColors } from '@/theme/colors';

/** Discard-hint marker: discarding this card would let you knock, or go gin. */
export type KnockHint = 'knock' | 'gin';

export type PlayingCardProps = {
  card: CardId;
  /** Raise + ring the card (e.g. staged for discard). */
  selected?: boolean;
  /** Meld-group color: draws an underline showing which set/run this card is in. */
  meldColor?: string | null;
  /** Meld kind: 'run' draws a solid underline, 'set' a dashed one. */
  meldKind?: 'set' | 'run' | null;
  /**
   * A subtle top-right dot marking that discarding this card enables a knock
   * (green) or gin (gold). Only a hint — it never plays for you.
   */
  knockHint?: KnockHint | null;
  /** Size multiplier (1 = the default hand-card size). Piles render larger. */
  scale?: number;
  /** Hold-to-peek: ring color when this card matches the held card (else null). */
  matchRing?: string | null;
  /** Hold-to-peek: fade the card back when it does not match the held card. */
  dimmed?: boolean;
  /** When provided, the card is pressable and reports its own id. */
  onPress?: (card: CardId) => void;
  /** Press-and-hold: report this card's id (e.g. to preview its matches). */
  onLongPress?: (card: CardId) => void;
  /** Fired when the press is released (e.g. to end a hold-to-peek). */
  onPressOut?: () => void;
};

function PlayingCardBase({
  card,
  selected,
  meldColor,
  meldKind,
  knockHint,
  scale = 1,
  matchRing,
  dimmed,
  onPress,
  onLongPress,
  onPressOut,
}: PlayingCardProps) {
  const color = isRed(card) ? cardColors.suitRed : cardColors.suitBlack;
  const rank = RANK_LABELS[rankOf(card)];
  const suit = SUIT_SYMBOLS[suitOf(card)];
  const s = scale;
  const hintColor =
    knockHint === 'gin' ? accent.gold : knockHint === 'knock' ? accent.good : null;

  const face = (
    <View
      style={[
        styles.card,
        s !== 1 && {
          width: CARD_WIDTH * s,
          height: CARD_HEIGHT * s,
          borderRadius: 6 * s,
          paddingHorizontal: 4 * s,
          paddingTop: 3 * s,
        },
        selected && styles.selected,
        matchRing ? { borderColor: matchRing, borderWidth: 2 } : null,
        dimmed && styles.dimmed,
      ]}
    >
      <View style={styles.corner}>
        <Text selectable={false} style={[styles.rank, { color }, s !== 1 && { fontSize: 15 * s, lineHeight: 16 * s }]}>
          {rank}
        </Text>
        <Text selectable={false} style={[styles.cornerSuit, { color }, s !== 1 && { fontSize: 12 * s, lineHeight: 13 * s }]}>
          {suit}
        </Text>
      </View>
      <Text selectable={false} style={[styles.pip, { color }, s !== 1 && { fontSize: 22 * s, bottom: 4 * s, right: 5 * s }]}>
        {suit}
      </Text>
      {hintColor ? (
        <View
          style={[
            styles.hintDot,
            { backgroundColor: hintColor },
            s !== 1 && { width: 7 * s, height: 7 * s, borderRadius: 4 * s, top: 3 * s, right: 3 * s },
          ]}
        />
      ) : null}
      {meldColor ? (
        meldKind === 'set' ? (
          <View style={styles.meldDashes}>
            {[0, 1, 2, 3].map((k) => (
              <View key={k} style={[styles.meldDash, { backgroundColor: meldColor }]} />
            ))}
          </View>
        ) : (
          <View style={[styles.meldBar, { backgroundColor: meldColor }]} />
        )
      ) : null}
    </View>
  );

  if (!onPress && !onLongPress) return face;

  return (
    <Pressable
      onPress={onPress ? () => onPress(card) : undefined}
      onLongPress={onLongPress ? () => onLongPress(card) : undefined}
      onPressOut={onPressOut}
      delayLongPress={300}
      accessibilityRole="button"
      accessibilityLabel={
        knockHint ? `${rank}${suit}, discard to ${knockHint}` : `${rank}${suit}`
      }
      accessibilityState={{ selected: !!selected }}
    >
      {face}
    </Pressable>
  );
}

/** A single face-up playing card. Memoized — it only depends on its own props. */
export const PlayingCard = memo(PlayingCardBase);

/** Base hand-card footprint (scale = 1). The single source of truth for card
 *  dimensions — the fanned hand, the piles, and the card back all size against
 *  these (multiplied by their own `scale`). */
export const CARD_WIDTH = 48;
export const CARD_HEIGHT = 68;

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 6,
    backgroundColor: cardColors.face,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: cardColors.faceEdge,
    paddingHorizontal: 4,
    paddingTop: 3,
    // Web: holding a card to peek must not start a text/element selection.
    userSelect: 'none',
  },
  selected: {
    borderWidth: 2,
    borderColor: cardColors.selected,
    transform: [{ translateY: -12 }],
  },
  // Hold-to-peek: cards that don't match the held card fade back.
  dimmed: {
    opacity: 0.3,
  },
  corner: {
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  rank: {
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 16,
  },
  cornerSuit: {
    fontSize: 12,
    lineHeight: 13,
  },
  pip: {
    position: 'absolute',
    bottom: 4,
    right: 5,
    fontSize: 22,
  },
  // Knock/gin discard hint — a small dot in the top-right corner.
  hintDot: {
    position: 'absolute',
    top: 3,
    right: 3,
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  // Run: one solid underline bar pinned to the bottom edge, inside the corners.
  meldBar: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: 0,
    height: 3,
    borderRadius: 2,
  },
  // Set: same footprint, drawn as evenly spaced dashes to read as "dotted".
  meldDashes: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: 0,
    height: 3,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  meldDash: {
    width: 6,
    height: 3,
    borderRadius: 1,
  },
});
