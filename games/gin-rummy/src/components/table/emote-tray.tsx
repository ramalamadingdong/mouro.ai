/**
 * The reaction button + picker. A small round trigger on the table opens a
 * bottom sheet of emoji; tapping one broadcasts it to the room (via the parent's
 * `onEmote`) and closes the sheet. Online play only — the table renders this
 * only when an `onEmote` handler is supplied.
 */
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { accent, felt, text } from '@/theme/colors';

/** The curated reaction set. Small and friendly — no free text, no moderation. */
export const EMOTES = ['👍', '😂', '😮', '🤔', '🔥', '😭', '🎉'] as const;

export function EmoteTray({ onEmote }: { onEmote: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);

  const pick = (emoji: string) => {
    onEmote(emoji);
    setOpen(false);
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Send a reaction"
        style={({ pressed }) => [styles.trigger, pressed && styles.triggerPressed]}
        hitSlop={6}
      >
        <Text style={styles.triggerGlyph}>😄</Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        {/* Backdrop tap closes; the sheet is a Pressable so taps on it don't. */}
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.hint}>Send a reaction</Text>
            <View style={styles.row}>
              {EMOTES.map((e) => (
                <Pressable
                  key={e}
                  onPress={() => pick(e)}
                  accessibilityRole="button"
                  accessibilityLabel={`React ${e}`}
                  style={({ pressed }) => [styles.emoteBtn, pressed && styles.emoteBtnPressed]}
                >
                  <Text style={styles.emote}>{e}</Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: felt.tableRaised,
    borderWidth: 1,
    borderColor: accent.goldDim,
  },
  triggerPressed: {
    opacity: 0.7,
  },
  triggerGlyph: {
    fontSize: 18,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
    padding: 16,
  },
  sheet: {
    backgroundColor: felt.tableRaised,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: accent.goldDim,
    paddingVertical: 16,
    paddingHorizontal: 12,
    gap: 10,
  },
  hint: {
    color: text.muted,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  emoteBtn: {
    width: 52,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: felt.tableDeep,
  },
  emoteBtnPressed: {
    backgroundColor: felt.tableGlow,
  },
  emote: {
    fontSize: 30,
  },
});
