/**
 * Winning-score picker — a small segmented row of preset match targets. Shared
 * by the solo difficulty screen and the online lobby (host only), so both modes
 * offer the same choices. The engine takes any positive target; these presets
 * are just the friendly, tap-to-pick options.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { accent, felt, text } from '@/theme/colors';

/** The offered match targets, with a one-word feel for each. */
export const TARGET_PRESETS: { value: number; caption: string }[] = [
  { value: 50, caption: 'Quick' },
  { value: 100, caption: 'Classic' },
  { value: 150, caption: 'Long' },
  { value: 200, caption: 'Marathon' },
];

/** The default match target (classic gin rummy). */
export const DEFAULT_TARGET = 100;

export function TargetPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: number;
  onChange: (target: number) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.row}>
      {TARGET_PRESETS.map((t) => {
        const on = value === t.value;
        return (
          <Pressable
            key={t.value}
            onPress={() => onChange(t.value)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled }}
            accessibilityLabel={`Play to ${t.value} points (${t.caption})`}
            style={[styles.pill, on && styles.pillOn, disabled && styles.pillDisabled]}
          >
            <Text style={[styles.value, on && styles.valueOn]}>{t.value}</Text>
            <Text style={[styles.caption, on && styles.captionOn]}>{t.caption}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
    maxWidth: 360,
  },
  pill: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: felt.tableGlow,
    backgroundColor: felt.tableDeep,
    paddingVertical: 10,
    alignItems: 'center',
  },
  pillOn: {
    borderColor: accent.gold,
    backgroundColor: felt.tableRaised,
  },
  pillDisabled: {
    opacity: 0.5,
  },
  value: {
    color: text.primary,
    fontSize: 18,
    fontWeight: '800',
  },
  valueOn: {
    color: accent.gold,
  },
  caption: {
    color: text.muted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  captionOn: {
    color: text.primary,
  },
});
