import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { accent, piece, text } from '@/theme/colors';

export type CubeChipProps = {
  value: number;
  size: number;
  x: number;
  y: number;
  /** Live offer — draw attention to it. */
  live?: boolean;
};

/**
 * The doubling cube. A cube sitting in the middle of the rail is centred and
 * belongs to nobody; once taken it sits at its owner's end, so "who owns the
 * cube" is readable without a label.
 *
 * The face shows the value it is currently ON. A centred cube reads "64" on a
 * real board (meaning 1); showing 1 is clearer for people who have not played
 * much, and unambiguous for people who have.
 */
export const CubeChip = memo(function CubeChip({ value, size, x, y, live = false }: CubeChipProps) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.cube,
        { left: x, top: y, width: size, height: size, borderRadius: size * 0.22 },
        live && styles.live,
      ]}
    >
      <Text style={[styles.value, { fontSize: size * (value >= 10 ? 0.42 : 0.55) }]}>{value}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  cube: {
    position: 'absolute',
    backgroundColor: piece.face,
    borderWidth: 1,
    borderColor: piece.faceEdge,
    alignItems: 'center',
    justifyContent: 'center',
  },
  live: { borderWidth: 2, borderColor: accent.gold },
  value: { color: text.onLight, fontWeight: '800' },
});
