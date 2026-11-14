import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { accent, felt, text } from '@/theme/colors';

export type TurnBannerTone = 'neutral' | 'you' | 'wait';

export type TurnBannerProps = {
  /** Whose turn / what to do. */
  text: string;
  /** `you` = gold (your move); `wait` = muted; `neutral` = default. */
  tone?: TurnBannerTone;
};

/** A centered pill announcing whose turn it is or the required action. */
function TurnBannerBase({ text: label, tone = 'neutral' }: TurnBannerProps) {
  const toneStyle =
    tone === 'you'
      ? styles.you
      : tone === 'wait'
        ? styles.wait
        : styles.neutral;
  const textStyle =
    tone === 'you' ? styles.youText : styles.defaultText;

  return (
    <View style={styles.wrap}>
      <View style={[styles.pill, toneStyle]}>
        <Text style={[styles.label, textStyle]}>{label}</Text>
      </View>
    </View>
  );
}

export const TurnBanner = memo(TurnBannerBase);

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
  },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 999,
  },
  neutral: {
    backgroundColor: felt.tableRaised,
  },
  you: {
    backgroundColor: accent.gold,
  },
  wait: {
    backgroundColor: felt.tableDeep,
  },
  label: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  defaultText: {
    color: text.primary,
  },
  youText: {
    color: text.onGold,
  },
});
