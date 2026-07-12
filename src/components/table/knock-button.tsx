import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { accent, text } from '@/theme/colors';

export type KnockButtonLabel = 'KNOCK' | 'GIN' | 'BIG GIN';

export type KnockButtonProps = {
  /** The action headline. */
  label: KnockButtonLabel;
  /** Resulting deadwood (shown for a plain KNOCK). */
  deadwood?: number;
  /** Fired on tap when enabled. */
  onPress: () => void;
  /** Disable + dim the button. */
  disabled?: boolean;
};

/** A prominent green action button to knock / go gin / big gin. */
function KnockButtonBase({
  label,
  deadwood,
  onPress,
  disabled,
}: KnockButtonProps) {
  const showDeadwood = label === 'KNOCK' && deadwood !== undefined;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityLabel={
        showDeadwood ? `${label}, deadwood ${deadwood}` : label
      }
      style={({ pressed }) => [
        styles.button,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={styles.label}>{label}</Text>
      {showDeadwood ? (
        <View style={styles.deadwoodPill}>
          <Text style={styles.deadwoodText}>{deadwood}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export const KnockButton = memo(KnockButtonBase);

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 12,
    backgroundColor: accent.good,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.85,
  },
  label: {
    color: text.primary,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1,
  },
  deadwoodPill: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  deadwoodText: {
    color: text.primary,
    fontSize: 13,
    fontWeight: '700',
  },
});
