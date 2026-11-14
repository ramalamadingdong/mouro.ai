import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { text } from '@/theme/colors';

/**
 * Three softly-pulsing dots — an "opponent is thinking" indicator. Uses the
 * built-in RN Animated API (native driver) so it stays decoupled from the
 * reanimated worklet runtime. Purely decorative, hidden from a11y.
 */
export function ThinkingDots({ color = text.muted }: { color?: string }) {
  const a = useRef(new Animated.Value(0.3)).current;
  const b = useRef(new Animated.Value(0.3)).current;
  const c = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const pulse = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.3, duration: 300, useNativeDriver: true }),
          Animated.delay(300 - delay),
        ]),
      );
    const loops = [pulse(a, 0), pulse(b, 150), pulse(c, 300)];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [a, b, c]);

  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.dot, { opacity: a, backgroundColor: color }]} />
      <Animated.View style={[styles.dot, { opacity: b, backgroundColor: color }]} />
      <Animated.View style={[styles.dot, { opacity: c, backgroundColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
