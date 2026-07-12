import { useRef } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { accent, felt, text } from '@/theme/colors';

/** The room-code alphabet — omits visually ambiguous characters (0/O/1/I/L). */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 5;

export type CodeInputProps = {
  value: string;
  onChangeText: (v: string) => void;
  onSubmit?: () => void;
  autoFocus?: boolean;
};

/** Strip to uppercase room-code characters and clamp to the code length. */
function sanitize(raw: string): string {
  const upper = raw.toUpperCase();
  let out = '';
  for (const ch of upper) {
    if (CODE_ALPHABET.includes(ch)) out += ch;
    if (out.length === CODE_LENGTH) break;
  }
  return out;
}

/**
 * A 5-slot room-code entry. A single hidden `TextInput` captures keystrokes;
 * the visible boxes render `value`. Input is auto-uppercased and filtered to
 * the room-code alphabet. Fires `onSubmit` once 5 valid characters are entered.
 */
export function CodeInput({
  value,
  onChangeText,
  onSubmit,
  autoFocus,
}: CodeInputProps) {
  const inputRef = useRef<TextInput>(null);

  const handleChange = (raw: string) => {
    const next = sanitize(raw);
    onChangeText(next);
    if (next.length === CODE_LENGTH) onSubmit?.();
  };

  const slots = Array.from({ length: CODE_LENGTH }, (_, i) => value[i] ?? '');
  const focusedIndex = Math.min(value.length, CODE_LENGTH - 1);

  return (
    <Pressable
      style={styles.container}
      onPress={() => inputRef.current?.focus()}
    >
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChange}
        onSubmitEditing={() => {
          if (value.length === CODE_LENGTH) onSubmit?.();
        }}
        autoFocus={autoFocus}
        autoCapitalize="characters"
        autoCorrect={false}
        keyboardType="visible-password"
        maxLength={CODE_LENGTH}
        style={styles.hiddenInput}
        accessibilityLabel="Room code"
      />
      <View style={styles.slots} pointerEvents="none">
        {slots.map((ch, i) => {
          const active = i === focusedIndex && value.length < CODE_LENGTH;
          const filled = ch !== '';
          return (
            <View
              key={i}
              style={[
                styles.slot,
                filled && styles.slotFilled,
                active && styles.slotActive,
              ]}
            >
              <Text style={styles.slotText}>{ch}</Text>
            </View>
          );
        })}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'center',
  },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  slots: {
    flexDirection: 'row',
    gap: 10,
  },
  slot: {
    width: 52,
    height: 64,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: felt.tableGlow,
    backgroundColor: felt.tableDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotFilled: {
    borderColor: accent.goldDim,
    backgroundColor: felt.tableRaised,
  },
  slotActive: {
    borderColor: accent.gold,
  },
  slotText: {
    color: text.primary,
    fontSize: 28,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
});
