import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { accent, felt, text } from '@/theme/colors';

export type ConfirmModalProps = {
  visible: boolean;
  title: string;
  message?: string;
  /** Label for the confirming (destructive) action. */
  confirmLabel: string;
  /** Label for the dismiss action (defaults to "Cancel"). */
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * A small in-theme confirm sheet — matches the felt/gold look of the round/match
 * modals (an RN <Modal>, not the OS <Alert>, which can't be styled). DUMB: it
 * only renders the prompt and reports Confirm / Cancel.
 */
export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}

          <Pressable
            onPress={onConfirm}
            accessibilityRole="button"
            accessibilityLabel={confirmLabel}
            style={({ pressed }) => [
              styles.button,
              styles.confirm,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.confirmText}>{confirmLabel}</Text>
          </Pressable>

          <Pressable
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel={cancelLabel}
            style={({ pressed }) => [
              styles.button,
              styles.ghost,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.ghostText}>{cancelLabel}</Text>
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
    maxWidth: 400,
    backgroundColor: felt.tableRaised,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: accent.goldDim,
    padding: 24,
    gap: 12,
    alignItems: 'stretch',
  },
  title: {
    color: text.primary,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  message: {
    color: text.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 4,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  confirm: {
    backgroundColor: accent.bad,
  },
  confirmText: {
    color: text.primary,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  ghostText: {
    color: text.muted,
    fontSize: 15,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.85,
  },
});
