import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { piece, text } from '@/theme/colors';

/**
 * Pip layout as a 3x3 grid, listed per face. Drawing dots rather than shipping
 * six images keeps the whole board dependency-free.
 */
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [0, 2],
    [2, 0],
    [2, 2],
  ],
  5: [
    [0, 0],
    [0, 2],
    [1, 1],
    [2, 0],
    [2, 2],
  ],
  6: [
    [0, 0],
    [0, 1],
    [0, 2],
    [2, 0],
    [2, 1],
    [2, 2],
  ],
};

export type DieProps = {
  value: number;
  size: number;
  x: number;
  y: number;
  /** Already spent by the staged turn — dimmed. */
  used?: boolean;
};

export const Die = memo(function Die({ value, size, x, y, used = false }: DieProps) {
  const pip = Math.max(2, size * 0.17);
  const pad = size * 0.16;
  const span = size - pad * 2 - pip;
  const face = PIPS[value] ?? [];

  return (
    <View
      pointerEvents="none"
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Die showing ${value}${used ? ', used' : ''}`}
      style={[
        styles.die,
        {
          left: x,
          top: y,
          width: size,
          height: size,
          borderRadius: size * 0.2,
        },
        used && styles.used,
      ]}
    >
      {face.map(([col, row], i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: pad + (span / 2) * col,
            top: pad + (span / 2) * row,
            width: pip,
            height: pip,
            borderRadius: pip / 2,
            backgroundColor: used ? text.faint : piece.pip,
          }}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  die: {
    position: 'absolute',
    backgroundColor: piece.face,
    borderWidth: 1,
    borderColor: piece.faceEdge,
  },
  used: { opacity: 0.35 },
});
