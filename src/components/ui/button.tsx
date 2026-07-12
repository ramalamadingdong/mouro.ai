import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { accent, text } from '@/theme/colors';

export type ButtonProps = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * A tappable action button. `primary` is a gold fill, `secondary` is a gold
 * outline, `ghost` is text only. While `loading` it shows a spinner and is
 * non-interactive; `disabled` dims it and blocks presses.
 */
export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
}: ButtonProps) {
  const blocked = disabled || loading;
  const spinnerColor = variant === 'primary' ? text.onGold : accent.gold;

  return (
    <Pressable
      onPress={onPress}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: blocked, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        pressed && !blocked && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <View style={styles.content}>
        {loading && (
          <ActivityIndicator
            size="small"
            color={spinnerColor}
            style={styles.spinner}
          />
        )}
        <Text style={[styles.label, labelStyles[variant]]} numberOfLines={1}>
          {title}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: 12,
    paddingHorizontal: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  spinner: {
    marginRight: 8,
  },
  label: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.45,
  },
});

const variantStyles = StyleSheet.create({
  primary: {
    backgroundColor: accent.gold,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: accent.gold,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
});

const labelStyles = StyleSheet.create({
  primary: {
    color: text.onGold,
  },
  secondary: {
    color: accent.gold,
  },
  ghost: {
    color: accent.gold,
  },
});
