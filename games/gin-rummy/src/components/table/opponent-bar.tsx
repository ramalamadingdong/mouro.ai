import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CardBack } from '@/components/card-back';
import { CatFace, type CatId } from '@/components/cat-face';
import { accent, felt, text } from '@/theme/colors';

export type OpponentBarProps = {
  /** Opponent display name. */
  name: string;
  /** Number of cards in the opponent's hand. */
  handCount: number;
  /** Opponent's current score. */
  score: number;
  /** Whether the opponent is connected. */
  online: boolean;
  /** Highlight (gold underline) when it's the opponent's turn. */
  isTurn?: boolean;
  /** Show a subtle "reconnecting…" label. */
  reconnecting?: boolean;
  /**
   * The opponent's chosen card-back photo (a `data:` URI), synced from the room.
   * `null`/omitted → the default lattice. Never the local player's own back.
   */
  cardBack?: string | null;
  /** Set when the opponent is a computer cat: draws its face by the name. */
  cat?: CatId;
};

/** Fan a few face-down cards to hint the size of the opponent's hand. */
const FAN_WIDTH = 30;
const FAN_HEIGHT = 42;
const MAX_FANNED = 6;

/**
 * Top-of-table bar for the opponent: name + presence dot, a small fan of card
 * backs sized to their hand, and their score. Dumb — props in, no callbacks.
 */
function OpponentBarBase({
  name,
  handCount,
  score,
  online,
  isTurn,
  reconnecting,
  cardBack,
  cat,
}: OpponentBarProps) {
  const fanned = Math.min(handCount, MAX_FANNED);

  return (
    <View style={[styles.container, isTurn && styles.containerTurn]}>
      <View style={styles.identity}>
        <View style={styles.nameRow}>
          <View
            style={[
              styles.dot,
              { backgroundColor: online ? accent.online : accent.offline },
            ]}
          />
          {cat ? <CatFace cat={cat} size={34} /> : null}
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
        </View>
        {reconnecting ? (
          <Text style={styles.reconnecting}>reconnecting…</Text>
        ) : null}
      </View>

      <View style={styles.fan} accessibilityLabel={`${handCount} cards`}>
        {handCount > 0 ? (
          Array.from({ length: fanned }).map((_, i) => (
            <View key={i} style={i === 0 ? undefined : styles.fanOverlap}>
              <CardBack width={FAN_WIDTH} height={FAN_HEIGHT} uri={cardBack ?? null} />
            </View>
          ))
        ) : (
          <Text style={styles.emptyHand}>🂠 ×0</Text>
        )}
        {handCount > MAX_FANNED ? (
          <Text style={styles.fanCount}>×{handCount}</Text>
        ) : null}
      </View>

      <View style={styles.scoreBox}>
        <Text style={styles.scoreLabel}>Score</Text>
        <Text style={styles.score}>{score}</Text>
      </View>
    </View>
  );
}

export const OpponentBar = memo(OpponentBarBase);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: felt.tableDeep,
    borderRadius: 12,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  containerTurn: {
    borderBottomColor: accent.gold,
  },
  identity: {
    flex: 1,
    minWidth: 0,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  name: {
    flexShrink: 1,
    color: text.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  reconnecting: {
    marginTop: 2,
    marginLeft: 18,
    color: text.faint,
    fontSize: 11,
    fontStyle: 'italic',
  },
  fan: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  fanOverlap: {
    marginLeft: -18,
  },
  fanCount: {
    marginLeft: 6,
    color: text.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  emptyHand: {
    color: text.faint,
    fontSize: 14,
  },
  scoreBox: {
    alignItems: 'center',
  },
  scoreLabel: {
    color: text.muted,
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  score: {
    color: accent.gold,
    fontSize: 20,
    fontWeight: '800',
  },
});
