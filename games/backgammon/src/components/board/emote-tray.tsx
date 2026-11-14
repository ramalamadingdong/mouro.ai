import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { accent, felt, text } from '@/theme/colors';

/** A short, curated set. An open picker invites abuse and needs moderation. */
const EMOJI = ['👍', '😅', '😮', '🎲', '🔥', '😤', '🍀'];

export function EmoteTray({ onSend }: { onSend: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={styles.trigger}
        accessibilityRole="button"
        accessibilityLabel="Send a reaction"
        hitSlop={8}
      >
        <Text style={styles.triggerText}>😄</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Send a reaction</Text>
            <View style={styles.row}>
              {EMOJI.map((e) => (
                <Pressable
                  key={e}
                  onPress={() => {
                    onSend(e);
                    setOpen(false);
                  }}
                  style={styles.chip}
                  accessibilityRole="button"
                  accessibilityLabel={`Send ${e}`}
                >
                  <Text style={styles.chipText}>{e}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: felt.tableGlow,
    backgroundColor: felt.tableDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  triggerText: { fontSize: 18 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: accent.goldDim,
    backgroundColor: felt.tableRaised,
    padding: 20,
    paddingBottom: 36,
  },
  title: {
    color: text.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    textAlign: 'center',
    marginBottom: 14,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  chip: {
    width: 54,
    height: 54,
    borderRadius: 12,
    backgroundColor: felt.tableDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { fontSize: 26 },
});
