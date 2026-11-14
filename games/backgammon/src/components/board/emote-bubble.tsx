import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';

export type EmoteBubbleProps = {
  emoji: string | null;
  /** Bumps on each send, so an identical emoji re-pops. */
  n: number | null;
  side: 'top' | 'bottom';
  enabled: boolean;
};

/** A reaction floating up and fading out. */
export function EmoteBubble({ emoji, n, side, enabled }: EmoteBubbleProps) {
  const p = useRef(new Animated.Value(0)).current;
  const [showing, setShowing] = useState<string | null>(null);
  // Skip the value we mounted with, so a reaction synced from before we opened
  // the board doesn't pop the moment we arrive.
  const seen = useRef<number | null>(null);

  useEffect(() => {
    if (n === null || emoji === null) return;
    if (seen.current === null) {
      seen.current = n;
      return;
    }
    if (n === seen.current) return;
    seen.current = n;

    setShowing(emoji);
    if (!enabled) {
      const t = setTimeout(() => setShowing(null), 1200);
      return () => clearTimeout(t);
    }
    p.setValue(0);
    Animated.timing(p, { toValue: 1, duration: 1500, useNativeDriver: true }).start(() =>
      setShowing(null),
    );
  }, [emoji, n, enabled, p]);

  if (!showing) return null;

  const opacity = p.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 1, 1, 0] });
  const translateY = p.interpolate({ inputRange: [0, 1], outputRange: [10, -34] });
  const scale = p.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0.4, 1.35, 1] });

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.bubble,
        side === 'top' ? styles.top : styles.bottom,
        enabled ? { opacity, transform: [{ translateY }, { scale }] } : null,
      ]}
    >
      <Text style={styles.emoji}>{showing}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bubble: { position: 'absolute', alignSelf: 'center', zIndex: 20 },
  top: { top: 44 },
  bottom: { bottom: 96 },
  emoji: { fontSize: 40 },
});
