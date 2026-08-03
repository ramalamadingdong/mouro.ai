import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { piece } from '@/theme/colors';
import type { Seat } from '@/engine/types';

export type CheckerProps = {
  seat: Seat;
  size: number;
  /** Absolute position within the board. */
  x: number;
  y: number;
  /** Number shown on the outermost checker when a stack is too tall to draw. */
  badge?: number;
  /** A translucent preview of a legal destination, not a real checker. */
  ghost?: boolean;
  /** Highlight ring (the source point of a staged move). */
  ringed?: boolean;
};

/**
 * One checker. Colour is fixed by SEAT, never by viewer — so both devices agree
 * about who is cream, which matters the moment two people talk about the board
 * out loud. Your own checkers are simply always the ones at the bottom of your
 * screen.
 */
export const Checker = memo(function Checker({
  seat,
  size,
  x,
  y,
  badge,
  ghost = false,
  ringed = false,
}: CheckerProps) {
  const cream = seat === 'p0';
  return (
    <View
      pointerEvents="none"
      style={[
        styles.base,
        {
          left: x,
          top: y,
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: Math.max(1, size * 0.08),
          backgroundColor: cream ? piece.face : piece.back,
          borderColor: cream ? piece.faceEdge : piece.backAccent,
        },
        ghost && styles.ghost,
        ringed && { borderColor: piece.selected, borderWidth: Math.max(2, size * 0.12) },
      ]}
    >
      {badge !== undefined && (
        <Text
          style={[
            styles.badge,
            { fontSize: size * 0.5, color: cream ? piece.pip : piece.face },
          ]}
        >
          {badge}
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  base: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  ghost: { opacity: 0.28 },
  badge: { fontWeight: '800' },
});
