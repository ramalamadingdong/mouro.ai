import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { card as cardColors } from '@/theme/colors';

export type CardBackProps = {
  /** Card width in px (defaults to 48 to match PlayingCard). */
  width?: number;
  /** Card height in px (defaults to 68 to match PlayingCard). */
  height?: number;
};

const DEFAULT_WIDTH = 48;
const DEFAULT_HEIGHT = 68;

function CardBackBase({ width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT }: CardBackProps) {
  return (
    <View style={[styles.back, { width, height }]} accessibilityElementsHidden>
      <View style={styles.inset} />
    </View>
  );
}

/** A single face-down playing card. Memoized — it only depends on its own props. */
export const CardBack = memo(CardBackBase);

const styles = StyleSheet.create({
  back: {
    borderRadius: 6,
    backgroundColor: cardColors.back,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: cardColors.backAccent,
    padding: 5,
  },
  inset: {
    flex: 1,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: cardColors.backAccent,
  },
});
