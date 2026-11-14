import { Pressable, StyleSheet, Text, View } from 'react-native';

import { accent, felt, text } from '@/theme/colors';

type Tone = 'primary' | 'secondary' | 'ghost' | 'good' | 'danger';

function Action({
  label,
  sub,
  tone = 'secondary',
  disabled,
  onPress,
  onLongPress,
  flex = 1,
}: {
  label: string;
  sub?: string;
  tone?: Tone;
  disabled?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  flex?: number;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.btn,
        toneStyles[tone],
        { flex },
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.label, labelTones[tone]]} numberOfLines={1}>
        {label}
      </Text>
      {sub && (
        <Text style={[styles.sub, labelTones[tone]]} numberOfLines={1}>
          {sub}
        </Text>
      )}
    </Pressable>
  );
}

export type MoveControlsProps = {
  /** 'roll' | 'moving' | 'waiting' — what the player can do right now. */
  mode: 'roll' | 'moving' | 'waiting';
  canUndo: boolean;
  canConfirm: boolean;
  forcedPass: boolean;
  busy: boolean;
  onRoll: () => void;
  onUndo: () => void;
  onUndoAll: () => void;
  onConfirm: () => void;
};

/** The action row under the board. */
export function MoveControls({
  mode,
  canUndo,
  canConfirm,
  forcedPass,
  busy,
  onRoll,
  onUndo,
  onUndoAll,
  onConfirm,
}: MoveControlsProps) {
  if (mode === 'waiting') return <View style={styles.rowSpacer} />;

  if (mode === 'roll') {
    return (
      <View style={styles.row}>
        <Action label="Roll" tone="primary" disabled={busy} onPress={onRoll} />
      </View>
    );
  }

  if (forcedPass) {
    return (
      <View style={styles.row}>
        <Action label="No legal move" sub="tap to pass the turn" tone="ghost" disabled={busy} onPress={onConfirm} />
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <Action
        label="Undo"
        sub={canUndo ? 'hold to undo all' : undefined}
        tone="ghost"
        disabled={!canUndo || busy}
        onPress={onUndo}
        onLongPress={onUndoAll}
      />
      <Action
        label="Confirm"
        tone={canConfirm ? 'good' : 'secondary'}
        disabled={!canConfirm || busy}
        onPress={onConfirm}
        flex={1.4}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, width: '100%' },
  rowSpacer: { height: 52 },
  btn: {
    minHeight: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  label: { fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
  sub: { fontSize: 11, fontWeight: '600', marginTop: 1, opacity: 0.85 },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
});

const toneStyles = StyleSheet.create({
  primary: { backgroundColor: accent.gold },
  good: { backgroundColor: accent.good },
  danger: { backgroundColor: accent.bad },
  secondary: { borderWidth: 2, borderColor: accent.gold },
  ghost: { borderWidth: 2, borderColor: felt.tableGlow },
});

const labelTones = StyleSheet.create({
  primary: { color: text.onGold },
  good: { color: text.primary },
  danger: { color: text.primary },
  secondary: { color: accent.gold },
  ghost: { color: text.muted },
});
