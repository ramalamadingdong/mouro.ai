import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { accent, felt, text } from '@/theme/colors';

export type DeadwoodBadgeProps = {
  /** Current deadwood value of the player's hand. */
  value: number;
  /** Highlight (can knock) → gold/green. */
  highlight?: boolean;
};

/** A small badge showing the player's current deadwood total. */
function DeadwoodBadgeBase({ value, highlight }: DeadwoodBadgeProps) {
  return (
    <View
      style={[styles.badge, highlight && styles.badgeHighlight]}
      accessibilityLabel={`Deadwood ${value}`}
    >
      <Text style={[styles.label, highlight && styles.labelHighlight]}>
        Deadwood
      </Text>
      <Text style={[styles.value, highlight && styles.valueHighlight]}>
        {value}
      </Text>
    </View>
  );
}

export const DeadwoodBadge = memo(DeadwoodBadgeBase);

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: felt.tableDeep,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  badgeHighlight: {
    borderColor: accent.good,
    backgroundColor: felt.tableRaised,
  },
  label: {
    color: text.muted,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  labelHighlight: {
    color: text.primary,
  },
  value: {
    color: text.primary,
    fontSize: 16,
    fontWeight: '800',
  },
  valueHighlight: {
    color: accent.good,
  },
});
