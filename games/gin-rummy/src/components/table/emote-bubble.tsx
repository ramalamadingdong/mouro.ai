/**
 * A single floating emoji that pops when a reaction arrives, then fades out and
 * sits invisible at rest. Driven off a `trigger` counter (the room's per-player
 * `emotes/<uid>/n`) so BOTH devices animate the same reaction — mine anchored to
 * the bottom (my side), the opponent's to the top (their side).
 *
 * Mirrors <GrabToast>: RN's built-in Animated (native driver, transform +
 * opacity), off the reanimated worklet runtime like the other table overlays.
 * The first observed trigger is skipped so a stale reaction already synced into
 * the room on mount doesn't pop.
 */
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';

export type EmoteAnchor = 'top' | 'bottom';

export function EmoteBubble({
  emoji,
  trigger,
  anchor,
}: {
  emoji: string | null;
  trigger: number;
  anchor: EmoteAnchor;
}) {
  const progress = useRef(new Animated.Value(1)).current; // start settled/invisible
  const seen = useRef<number | null>(null);

  useEffect(() => {
    // Skip the value we mounted into (may be a leftover reaction from before we
    // joined) — only animate when the trigger actually advances afterward.
    if (seen.current === null) {
      seen.current = trigger;
      return;
    }
    if (seen.current === trigger || trigger === 0) return;
    seen.current = trigger;
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 1500,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [trigger, progress]);

  if (trigger === 0 || emoji === null) return null;

  const opacity = progress.interpolate({
    inputRange: [0, 0.12, 0.7, 1],
    outputRange: [0, 1, 1, 0],
  });
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [10, -34],
  });
  const scale = progress.interpolate({
    inputRange: [0, 0.2, 0.55, 1],
    outputRange: [0.4, 1.35, 1.1, 1],
  });
  const rotate = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['-8deg', '5deg', '-2deg'],
  });

  return (
    <Animated.View
      style={[styles.layer, anchor === 'top' ? styles.top : styles.bottom]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.Text
        style={[styles.emoji, { opacity, transform: [{ translateY }, { scale }, { rotate }] }]}
      >
        {emoji}
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
  },
  top: {
    justifyContent: 'flex-start',
    paddingTop: 84,
  },
  bottom: {
    justifyContent: 'flex-end',
    paddingBottom: 190,
  },
  emoji: {
    fontSize: 56,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
});
