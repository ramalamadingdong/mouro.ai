import { Modal, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { accent, felt, text } from '@/theme/colors';

export type DoubleModalProps = {
  visible: boolean;
  /** Who offered it. */
  fromName: string;
  /** The value the cube would go to. */
  value: number;
  /** What dropping costs — the value BEFORE the double. */
  dropCost: number;
  /** Score if you drop, for the "you would trail" line. */
  myScore: number;
  theirScore: number;
  target: number;
  busy: boolean;
  onTake: () => void;
  onPass: () => void;
};

/**
 * The take-or-drop decision. Deliberately non-dismissible: there is no third
 * option in backgammon, and a modal you can tap away from would leave the
 * player looking at a board they are not allowed to touch.
 */
export function DoubleModal({
  visible,
  fromName,
  value,
  dropCost,
  myScore,
  theirScore,
  target,
  busy,
  onTake,
  onPass,
}: DoubleModalProps) {
  const afterDrop = theirScore + dropCost;
  const trailing = afterDrop - myScore;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.eyebrow}>{fromName} doubles</Text>
          <View style={styles.cube}>
            <Text style={styles.cubeValue}>{value}</Text>
          </View>
          <Text style={styles.body}>
            Take, and the game is worth {value} {value === 1 ? 'point' : 'points'} — and the cube
            becomes yours to turn.
          </Text>
          <Text style={styles.dropLine}>
            Drop and {fromName} scores {dropCost}, making it {afterDrop}–{myScore} to {target}
            {trailing > 0 ? ` (you'd trail by ${trailing})` : ''}.
          </Text>

          <Button title="Take" onPress={onTake} disabled={busy} style={styles.action} />
          <Button
            title={`Drop — lose ${dropCost}`}
            variant="danger"
            onPress={onPass}
            disabled={busy}
            style={styles.action}
          />
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
    alignItems: 'center',
  },
  eyebrow: {
    color: text.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  cube: {
    width: 76,
    height: 76,
    borderRadius: 16,
    backgroundColor: '#f5f0e1',
    borderWidth: 3,
    borderColor: accent.gold,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 16,
  },
  cubeValue: { color: '#1c2b24', fontSize: 38, fontWeight: '800' },
  body: { color: text.primary, fontSize: 15, textAlign: 'center', lineHeight: 21 },
  dropLine: { color: text.hint, fontSize: 13, textAlign: 'center', marginTop: 10, lineHeight: 19 },
  action: { marginTop: 14, alignSelf: 'stretch' },
});
