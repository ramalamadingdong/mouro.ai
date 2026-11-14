import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { BAR, OFF } from '@/engine/board';
import type { Seat } from '@/engine/types';
import type { BoardMetrics } from '@/hooks/use-board-metrics';
import { accent, piece } from '@/theme/colors';

export type CheckerFlyOverlayProps = {
  m: BoardMetrics;
  /**
   * The move in the VIEWER's own frame (the board frame translates it), with
   * the stack slots to lift from and land on.
   */
  flight: { from: number; to: number; fromK: number; fromCount: number; toK: number; toCount: number };
  seat: Seat;
  /** The flier belongs to the viewer (affects which bar lane / tray it uses). */
  mine: boolean;
  /** This step lands on a blot — flash the destination. */
  hit: boolean;
  durationMs?: number;
};

/**
 * One checker sliding from A to B during the opponent's turn replay.
 *
 * Every coordinate comes from `BoardMetrics`, the same object the static board
 * uses, so the flier can never land somewhere a checker does not actually sit.
 * Transform and opacity only, native driver — no worklets.
 */
export function CheckerFlyOverlay({
  m,
  flight,
  seat,
  mine,
  hit,
  durationMs = 280,
}: CheckerFlyOverlayProps) {
  const p = useRef(new Animated.Value(0)).current;

  const from =
    flight.from === BAR ? m.barXY(mine, 0) : m.checkerXY(flight.from, flight.fromK, flight.fromCount);
  const to = flight.to === OFF ? m.trayXY(mine, 0) : m.checkerXY(flight.to, flight.toK, flight.toCount);

  useEffect(() => {
    p.setValue(0);
    Animated.timing(p, {
      toValue: 1,
      duration: durationMs,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [p, durationMs, flight.from, flight.to]);

  const translateX = p.interpolate({ inputRange: [0, 1], outputRange: [0, to.x - from.x] });
  const translateY = p.interpolate({ inputRange: [0, 1], outputRange: [0, to.y - from.y] });
  // A small lift out of the stack and back down reads as "picked up and placed"
  // rather than "slid along the felt".
  const scale = p.interpolate({ inputRange: [0, 0.4, 1], outputRange: [1, 1.18, 1] });

  const cream = seat === 'p0';

  return (
    <>
      {hit && flight.to !== OFF && (
        <View
          pointerEvents="none"
          style={[
            styles.flash,
            {
              left: to.x - 2,
              top: to.y - 2,
              width: m.ch + 4,
              height: m.ch + 4,
              borderRadius: (m.ch + 4) / 2,
            },
          ]}
        />
      )}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.checker,
          {
            left: from.x,
            top: from.y,
            width: m.ch,
            height: m.ch,
            borderRadius: m.ch / 2,
            borderWidth: Math.max(1, m.ch * 0.08),
            backgroundColor: cream ? piece.face : piece.back,
            borderColor: cream ? piece.faceEdge : piece.backAccent,
            transform: [{ translateX }, { translateY }, { scale }],
          },
        ]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  checker: { position: 'absolute', zIndex: 5 },
  flash: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: accent.bad,
    zIndex: 4,
  },
});
