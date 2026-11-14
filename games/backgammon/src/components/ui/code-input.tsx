import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { accent, felt, text } from '@/theme/colors';
import { mono } from '@/theme/typography';
import { CODE_LENGTH, extractCode } from '@/util/room-code';

/*
 * The alphabet, the length and the sanitizers all live in @/util/room-code.
 * Re-exported here so existing importers keep working.
 */
export { CODE_ALPHABET, CODE_LENGTH, sanitizeCode } from '@/util/room-code';

export type CodeInputProps = {
  value: string;
  onChangeText: (v: string) => void;
  onSubmit?: () => void;
  autoFocus?: boolean;
};

/** The slice of the browser clipboard / WebOTP surface this component uses. */
type WebNavigator = {
  clipboard?: { readText?: () => Promise<string> };
  credentials?: { get: (options: unknown) => Promise<{ code?: string } | null> };
};

function webNavigator(): WebNavigator | null {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return null;
  return navigator as unknown as WebNavigator;
}

/**
 * A 5-slot room-code entry: one real `TextInput` laid transparently over five
 * painted boxes. Whatever arrives in the field — keystrokes, a pasted invite,
 * a code the keyboard offers from a text message — goes through `extractCode`,
 * so the boxes only ever show the room code.
 *
 * ── Why the input covers the boxes instead of hiding in a corner ────────────
 * It used to be a 1x1 invisible field capped at five characters, focused from
 * JS. That typed fine and broke everything else a phone does with a code:
 *
 *   - there was nothing to long-press, so "Paste" was unreachable — and
 *     copying the code out of a chat is how most people bring it over;
 *   - the five-character cap truncated a paste or an autofill BEFORE this
 *     component saw it, so a pasted invite filled the boxes with the first
 *     five letters of the message rather than the code.
 *
 * A full-size field with no cap is an ordinary text field as far as iOS and
 * Android are concerned, so paste, the keyboard's suggestion bar and autofill
 * all just work. It is hidden with a transparent text colour, NOT `opacity: 0`:
 * iOS does not deliver touches to a fully transparent native view.
 */
export function CodeInput({ value, onChangeText, onSubmit, autoFocus }: CodeInputProps) {
  const [canPaste, setCanPaste] = useState(false);
  const [pasteMissed, setPasteMissed] = useState(false);

  const handleChange = (raw: string) => {
    const next = extractCode(raw);
    setPasteMissed(false);
    onChangeText(next);
    if (next.length === CODE_LENGTH) onSubmit?.();
  };

  // The effect below runs once but must call the CURRENT handler.
  const latestChange = useRef(handleChange);
  useEffect(() => {
    latestChange.current = handleChange;
  });

  useEffect(() => {
    const nav = webNavigator();
    if (!nav) return;

    // Decided after mount, never during render: this screen is prerendered at
    // build time, where there is no clipboard, and the first client render has
    // to match that HTML.
    setCanPaste(typeof nav.clipboard?.readText === 'function');

    /*
     * ANDROID: READ THE CODE STRAIGHT OUT OF A TEXT MESSAGE (WebOTP).
     *
     * `autoComplete="one-time-code"` is enough on iOS, which offers the code
     * above the keyboard by itself. Chrome on Android does nothing with that
     * attribute alone — it has to be ASKED, with this call. When a text whose
     * last line is `@host #CODE` (see `inviteMessage` in util/invite.ts)
     * arrives, Android shows its own "allow" sheet and resolves with the code.
     * It only covers SMS, and only messages that arrive while this screen is
     * open; an invite that came earlier, or over WhatsApp, is what the Paste
     * button is for. Absent everywhere else, hence the feature test.
     */
    if (typeof window === 'undefined' || !('OTPCredential' in window) || !nav.credentials) return;
    const abort = new AbortController();
    nav.credentials
      .get({ otp: { transport: ['sms'] }, signal: abort.signal })
      .then((credential) => {
        const code = extractCode(credential?.code ?? '');
        if (code.length === CODE_LENGTH) latestChange.current(code);
      })
      .catch(() => {
        // Aborted on unmount, timed out, or declined — all fine; typing and
        // pasting still work.
      });
    return () => abort.abort();
  }, []);

  const handlePaste = async () => {
    try {
      const pasted = (await webNavigator()?.clipboard?.readText?.()) ?? '';
      const code = extractCode(pasted);
      if (code.length === CODE_LENGTH) handleChange(code);
      else setPasteMissed(true);
    } catch {
      // Permission refused, or nothing readable on the clipboard.
      setPasteMissed(true);
    }
  };

  const slots = Array.from({ length: CODE_LENGTH }, (_, i) => value[i] ?? '');
  const focusedIndex = Math.min(value.length, CODE_LENGTH - 1);

  return (
    <View style={styles.container}>
      <View>
        <View style={styles.slots} pointerEvents="none">
          {slots.map((ch, i) => {
            const active = i === focusedIndex && value.length < CODE_LENGTH;
            const filled = ch !== '';
            return (
              <View
                key={i}
                style={[styles.slot, filled && styles.slotFilled, active && styles.slotActive]}
              >
                <Text style={styles.slotText}>{ch}</Text>
              </View>
            );
          })}
        </View>
        <TextInput
          value={value}
          onChangeText={handleChange}
          onSubmitEditing={() => {
            if (value.length === CODE_LENGTH) onSubmit?.();
          }}
          autoFocus={autoFocus}
          autoCapitalize="characters"
          autoCorrect={false}
          keyboardType="visible-password"
          caretHidden
          /*
           * No `maxLength`, on purpose — see the component comment. `extractCode`
           * is what keeps the value to five characters.
           *
           * `textContentType` (iOS native) and `autoComplete` (forwarded to the
           * DOM as `autocomplete="one-time-code"`) mark this as the field a
           * code from a text message belongs in. They pair with the `@host
           * #CODE` last line of `inviteMessage` (util/invite.ts).
           */
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          style={styles.input}
          accessibilityLabel="Room code"
        />
      </View>

      {canPaste && (
        <Pressable
          onPress={handlePaste}
          accessibilityRole="button"
          hitSlop={8}
          style={styles.paste}
        >
          <Text style={styles.pasteText}>Paste code</Text>
        </Pressable>
      )}
      {pasteMissed && (
        <Text style={styles.pasteMissed}>
          Couldn’t find a room code in what you copied — copy the invite message and try again.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignSelf: 'center', alignItems: 'center' },
  // Covers the boxes exactly. 16px so iOS never zooms the page on focus.
  input: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    fontSize: 16,
    color: 'transparent',
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    // The gold border on the active box is the focus indicator; without this
    // the browser draws its own ring around the whole (invisible) field.
    outlineWidth: 0,
  },
  slots: { flexDirection: 'row', gap: 10 },
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
  slotFilled: { borderColor: accent.goldDim, backgroundColor: felt.tableRaised },
  slotActive: { borderColor: accent.gold },
  slotText: { color: text.primary, fontSize: 28, fontWeight: '800', fontFamily: mono },
  paste: { marginTop: 14, paddingVertical: 6, paddingHorizontal: 14 },
  pasteText: { color: accent.gold, fontSize: 15, fontWeight: '700' },
  pasteMissed: {
    color: text.muted,
    fontSize: 13,
    marginTop: 6,
    maxWidth: 300,
    textAlign: 'center',
  },
});
