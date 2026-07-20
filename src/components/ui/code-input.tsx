import { useRef } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { accent, felt, text } from '@/theme/colors';
import { mono } from '@/theme/typography';
import { CODE_LENGTH, sanitizeCode } from '@/util/room-code';

/*
 * The alphabet, the length and `sanitizeCode` all live in @/util/room-code now —
 * they were duplicated across this file, the generator and the analytics script,
 * with the same rule restated a fourth time as a regex in the database rules.
 * Re-exported here so existing importers keep working.
 */
export { CODE_ALPHABET, CODE_LENGTH, sanitizeCode } from '@/util/room-code';

export type CodeInputProps = {
  value: string;
  onChangeText: (v: string) => void;
  onSubmit?: () => void;
  autoFocus?: boolean;
};

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
    const next = sanitizeCode(raw);
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
        /*
         * OS AUTOFILL OF THE CODE OUT OF A TEXT MESSAGE.
         *
         * `inviteMessage` (util/invite.ts) ends with the origin-bound
         * one-time-code line `@host #CODE`. These two attributes are the other
         * half of that contract: they tell the platform this field is where such
         * a code goes, so the keyboard offers it on a tap instead of the
         * recipient reading five characters off a chat and retyping them.
         *
         * This matters most on iOS, where it is the ONLY good path. An installed
         * home-screen web app cannot be opened from a link at all, so an iOS
         * recipient with the app has to come in through the code — and this turns
         * that from transcription into one tap.
         *
         * `textContentType` is the native (iOS) spelling; `autoComplete` is the
         * one react-native-web forwards to the DOM as
         * `autocomplete="one-time-code"`. Both are needed because this component
         * renders on both.
         */
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
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
    fontFamily: mono,
  },
});
