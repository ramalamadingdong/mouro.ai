import { StyleSheet, Text, View } from 'react-native';

import { ThinkingDots } from '@/components/board/thinking-dots';
import { accent, felt, text } from '@/theme/colors';

export type TurnBannerProps = {
  label: string;
  tone: 'you' | 'wait' | 'neutral' | 'alert';
  thinking?: boolean;
};

/** The one-line "whose move is it" pill above the controls. */
export function TurnBanner({ label, tone, thinking = false }: TurnBannerProps) {
  return (
    <View style={[styles.pill, toneStyles[tone]]}>
      <Text style={[styles.label, tone === 'you' && styles.labelYou]} numberOfLines={1}>
        {label}
      </Text>
      {thinking && <ThinkingDots color={tone === 'you' ? text.onGold : text.hint} />}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 999,
    maxWidth: '100%',
  },
  label: { color: text.primary, fontSize: 14, fontWeight: '700', letterSpacing: 0.3 },
  labelYou: { color: text.onGold },
});

const toneStyles = StyleSheet.create({
  you: { backgroundColor: accent.gold },
  wait: { backgroundColor: felt.tableDeep },
  neutral: { backgroundColor: felt.tableRaised },
  alert: { backgroundColor: accent.warn },
});
