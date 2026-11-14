import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';

import { PlayingCard, type PlayingCardProps } from './playing-card';

export type AnimatedCardProps = PlayingCardProps & {
  /** When true, the card fades + rises in on mount (deal / draw). */
  animate?: boolean;
  /** Stagger delay (ms) so a freshly-dealt hand cascades in. */
  delay?: number;
};

/**
 * A PlayingCard that eases in on mount — used for the deal cascade and the
 * just-drawn card. Built on RN's Animated (native driver, no worklet setup), so
 * it's safe in Expo Go. A re-sort keeps the same card Views mounted, so it does
 * NOT re-animate on sort; only genuinely new cards ease in. When `animate` is
 * false (motion off / reduce-motion) it renders the plain card with no wrapper.
 */
export function AnimatedCard({ animate, delay = 0, ...cardProps }: AnimatedCardProps) {
  const p = useRef(new Animated.Value(animate ? 0 : 1)).current;

  useEffect(() => {
    if (!animate) return;
    p.setValue(0);
    const anim = Animated.timing(p, {
      toValue: 1,
      duration: 220,
      delay,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
    // Mount-only: animate the card in once when it first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!animate) return <PlayingCard {...cardProps} />;

  return (
    <Animated.View
      style={{
        opacity: p,
        transform: [
          { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
        ],
      }}
    >
      <PlayingCard {...cardProps} />
    </Animated.View>
  );
}
