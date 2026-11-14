import { Modal, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { accent, felt, text } from '@/theme/colors';

export type ConfirmModalProps = {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** A themed confirm sheet, matching the felt-and-gold modal language. */
export function ConfirmModal({
  visible,
  title,
  body,
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
          {body && <Text style={styles.body}>{body}</Text>}
          <Button title={confirmLabel} variant="danger" onPress={onConfirm} style={styles.action} />
          <Button title={cancelLabel} variant="ghost" onPress={onCancel} style={styles.action} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: accent.goldDim,
    backgroundColor: felt.tableRaised,
    padding: 20,
  },
  title: { color: accent.gold, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  body: { color: text.hint, fontSize: 14, textAlign: 'center', marginTop: 10, lineHeight: 20 },
  action: { marginTop: 14 },
});
