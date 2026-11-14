/**
 * A playful word ("Yoink!", "Yeet!", …) that pops when YOU snag the face-up
 * discard / upcard — a known card, unlike a blind stock draw. Purely decorative
 * and hidden from a11y. Replays whenever `trigger` changes (a monotonically
 * increasing counter); at rest it fades fully out and sits invisible.
 *
 * Uses React Native's built-in Animated (native driver, transform + opacity) to
 * stay off the reanimated worklet runtime, matching the other table overlays.
 */
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';

import { accent, felt } from '@/theme/colors';

export function GrabToast({ word, trigger }: { word: string | null; trigger: number }) {
  const progress = useRef(new Animated.Value(1)).current; // start settled/invisible

  useEffect(() => {
    if (trigger === 0) return; // nothing grabbed yet
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 900,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [trigger, progress]);

  if (trigger === 0 || word === null) return null;

  const opacity = progress.interpolate({
    inputRange: [0, 0.15, 0.6, 1],
    outputRange: [0, 1, 1, 0],
  });
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [12, -44],
  });
  const scale = progress.interpolate({
    inputRange: [0, 0.22, 0.6, 1],
    outputRange: [0.6, 1.28, 1.12, 0.95],
  });
  const rotate = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['-6deg', '4deg', '-2deg'],
  });

  return (
    <Animated.View
      style={[styles.overlay]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.Text
        style={[styles.word, { opacity, transform: [{ translateY }, { scale }, { rotate }] }]}
      >
        {word}!
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  word: {
    color: accent.gold,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 1,
    textShadowColor: felt.tableDeep,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
});
