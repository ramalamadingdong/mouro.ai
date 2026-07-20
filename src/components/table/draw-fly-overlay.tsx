/**
 * A brief fly-in animation shown to the OBSERVER when the opponent draws a card,
 * so it's obvious what they took. A discard/upcard draw is public, so the actual
 * face-up card flies up with a "took 7♥" caption; a stock draw is secret, so a
 * face-DOWN card flies up with a "drew from the stock" caption (never revealing
 * the hidden card — the engine doesn't even send it).
 *
 * Uses React Native's built-in Animated (native driver, transform + opacity only)
 * to avoid any reanimated/worklet setup concerns.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { CardBack } from '@/components/card-back';
import { PlayingCard } from '@/components/playing-card';
import { cardToString, type CardId, type LastMove, type Seat } from '@/engine';
import { accent, felt, text } from '@/theme/colors';

type ActiveAnim = { card: CardId | null; fromStock: boolean; caption: string };

const DRAW_KINDS = new Set<LastMove['kind']>(['drawStock', 'drawDiscard', 'takeUpcard']);

export function DrawFlyOverlay({
  lastMove,
  version,
  mySeat,
  names,
  sizeScale = 1,
  cardBack,
}: {
  lastMove: LastMove | null;
  version: number;
  mySeat: Seat;
  names: Record<Seat, string>;
  /** Match the table's responsive card size on larger screens. */
  sizeScale?: number;
  /**
   * The opponent's card-back photo. The face-down fly card is THEIR card, so it
   * wears their back. `null`/omitted → the default lattice.
   */
  cardBack?: string | null;
}) {
  const [anim, setAnim] = useState<ActiveAnim | null>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const lastVersion = useRef<number | null>(null);

  useEffect(() => {
    // Skip the state we mounted into — only animate genuinely new moves.
    if (lastVersion.current === null) {
      lastVersion.current = version;
      return;
    }
    if (lastVersion.current === version) return;
    lastVersion.current = version;

    const lm = lastMove;
    if (!lm || !DRAW_KINDS.has(lm.kind)) return;
    if (lm.seat === mySeat) return; // you already see your own drawn card held out

    const who = names[lm.seat] ?? 'Opponent';
    const fromStock = lm.kind === 'drawStock';
    const caption =
      fromStock || lm.card == null
        ? `${who} drew from the stock`
        : `${who} took ${cardToString(lm.card)}`;

    setAnim({ card: lm.card ?? null, fromStock, caption });
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 1200,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setAnim(null);
    });
    // Trigger only when the authoritative version advances.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  if (!anim) return null;

  const opacity = progress.interpolate({
    inputRange: [0, 0.18, 0.7, 1],
    outputRange: [0, 1, 1, 0],
  });
  const translateY = progress.interpolate({
    inputRange: [0, 0.55, 1],
    outputRange: [0, 0, -150], // rise toward the opponent at the top
  });
  const scale = progress.interpolate({
    inputRange: [0, 0.22, 0.7, 1],
    outputRange: [0.7, 1.15, 1.1, 0.7],
  });
  const captionOpacity = progress.interpolate({
    inputRange: [0, 0.18, 0.7, 1],
    outputRange: [0, 1, 1, 0],
  });

  return (
    <View style={styles.overlay} pointerEvents="none">
      <Animated.Text style={[styles.caption, { opacity: captionOpacity }]}>
        {anim.caption}
      </Animated.Text>
      <Animated.View style={[styles.cardWrap, { opacity, transform: [{ translateY }, { scale }] }]}>
        {anim.fromStock || anim.card === null ? (
          <CardBack width={66 * sizeScale} height={94 * sizeScale} uri={cardBack ?? null} />
        ) : (
          <PlayingCard card={anim.card} scale={1.4 * sizeScale} />
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardWrap: {
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  caption: {
    position: 'absolute',
    top: '26%',
    textAlign: 'center',
    color: accent.gold,
    fontSize: 16,
    fontWeight: '800',
    backgroundColor: felt.tableDeep,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    overflow: 'hidden',
    maxWidth: 320,
  },
});
