import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { text } from '@/theme/colors';

/** Three looping dots, for "the opponent is thinking". */
export function ThinkingDots({ color = text.hint, size = 6 }: { color?: string; size?: number }) {
  const a = useRef(new Animated.Value(0.3)).current;
  const b = useRef(new Animated.Value(0.3)).current;
  const c = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const loop = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.3, duration: 300, useNativeDriver: true }),
          Animated.delay(300 - delay),
        ]),
      );
    const anims = [loop(a, 0), loop(b, 150), loop(c, 300)];
    anims.forEach((x) => x.start());
    return () => anims.forEach((x) => x.stop());
  }, [a, b, c]);

  const dot = { width: size, height: size, borderRadius: size / 2, backgroundColor: color };
  return (
    <View style={styles.row}>
      <Animated.View style={[dot, { opacity: a }]} />
      <Animated.View style={[dot, { opacity: b }]} />
      <Animated.View style={[dot, { opacity: c }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
