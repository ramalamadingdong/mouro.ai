import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { RoundReveal } from '@/components/table/round-reveal';
import type { RoundResult, Seat } from '@/engine';
import { accent, felt, text } from '@/theme/colors';

export type RoundEndModalProps = {
  visible: boolean;
  result: RoundResult;
  names: Record<Seat, string>;
  mySeat: Seat;
  onNext: () => void;
  pending?: boolean;
  /** We've requested the next round but the new deal hasn't arrived yet. */
  waiting?: boolean;
};

/**
 * Round reveal overlay. DUMB: wraps the shared `RoundReveal` (melds, deadwood,
 * knock card, and the defender's per-meld layoffs) in a scrollable sheet and
 * reports the "Next round" tap.
 */
export function RoundEndModal({
  visible,
  result,
  names,
  mySeat,
  onNext,
  pending,
  waiting,
}: RoundEndModalProps) {
  const busy = !!pending || !!waiting;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onNext}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            <RoundReveal result={result} names={names} mySeat={mySeat} />
          </ScrollView>

          <Pressable
            onPress={onNext}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Next round"
            accessibilityState={{ disabled: busy }}
            style={({ pressed }) => [
              styles.button,
              busy && styles.buttonDisabled,
              pressed && !busy && styles.buttonPressed,
            ]}
          >
            <Text style={styles.buttonText}>
              {waiting
                ? 'Waiting for the next deal…'
                : pending
                  ? 'Dealing…'
                  : 'Next round'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  sheet: {
    width: '100%',
    maxWidth: 460,
    maxHeight: '90%',
    backgroundColor: felt.tableRaised,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: accent.goldDim,
    padding: 20,
    gap: 12,
  },
  body: {
    flexGrow: 0,
  },
  bodyContent: {
    paddingVertical: 4,
  },
  button: {
    backgroundColor: accent.gold,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    backgroundColor: accent.goldDim,
    opacity: 0.7,
  },
  buttonText: {
    color: text.onGold,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
