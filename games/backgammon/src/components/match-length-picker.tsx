import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MATCH_LENGTHS } from '@/engine/match';
import { accent, felt, text } from '@/theme/colors';

/**
 * Match lengths, with the shorthand players actually use. Odd numbers are the
 * tradition (an even match can end level, which the Crawford rule assumes away).
 */
export const LENGTH_CAPTIONS: Record<number, string> = {
  1: 'One game',
  3: 'Quick',
  5: 'Standard',
  7: 'Long',
  9: 'Long',
  11: 'Tournament',
  15: 'Marathon',
  21: 'Epic',
};

export type MatchLengthPickerProps = {
  value: number;
  onChange: (points: number) => void;
  /** Read-only for the guest, who can see the choice but not make it. */
  disabled?: boolean;
  label?: string;
};

/** Segmented control for the match length in points. */
export function MatchLengthPicker({
  value,
  onChange,
  disabled = false,
  label = 'Match length',
}: MatchLengthPickerProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        {MATCH_LENGTHS.map((points) => {
          const active = points === value;
          return (
            <Pressable
              key={points}
              onPress={() => !disabled && onChange(points)}
              disabled={disabled}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled }}
              accessibilityLabel={`${points} point match`}
              style={[styles.chip, active && styles.chipActive, disabled && styles.chipDisabled]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{points}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.caption}>
        {LENGTH_CAPTIONS[value] ?? 'Custom'} · first to {value} {value === 1 ? 'point' : 'points'}
        {value > 1 ? ' · Crawford rule on' : ' · no doubling'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', width: '100%' },
  label: {
    color: text.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  chip: {
    minWidth: 46,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: felt.tableGlow,
    backgroundColor: felt.tableDeep,
    alignItems: 'center',
  },
  chipActive: { borderColor: accent.gold, backgroundColor: felt.tableRaised },
  chipDisabled: { opacity: 0.55 },
  chipText: { color: text.muted, fontSize: 16, fontWeight: '800' },
  chipTextActive: { color: accent.gold },
  caption: { color: text.hint, fontSize: 13, marginTop: 12, textAlign: 'center' },
});
