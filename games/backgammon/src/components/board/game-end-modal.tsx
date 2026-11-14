import { Modal, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import type { GameResult, Seat } from '@/engine/types';
import { accent, felt, text } from '@/theme/colors';

const HEADLINE: Record<GameResult['how'], string> = {
  single: 'Game',
  gammon: 'Gammon',
  backgammon: 'Backgammon',
  pass: 'Dropped',
};

/** Plain English for what just happened, so the score is never a mystery. */
export function describeResult(r: GameResult, winnerName: string): string {
  switch (r.how) {
    case 'pass':
      return `${winnerName} doubled and the cube was dropped, for ${r.points}.`;
    case 'gammon':
      return `${winnerName} bore off before the other side got a single checker home — double the cube.`;
    case 'backgammon':
      return `${winnerName} bore off while the other side still had a checker on the bar or in ${winnerName}'s home board — triple the cube.`;
    default:
      return `${winnerName} bore off first.`;
  }
}

export type GameEndModalProps = {
  visible: boolean;
  result: GameResult;
  names: Record<Seat, string>;
  mySeat: Seat | null;
  target: number;
  busy: boolean;
  /** True once we have asked for the next game and are waiting for the write. */
  requested: boolean;
  onNext: () => void;
  onLeave: () => void;
};

/** The between-games reveal. */
export function GameEndModal({
  visible,
  result,
  names,
  mySeat,
  target,
  busy,
  requested,
  onNext,
  onLeave,
}: GameEndModalProps) {
  const winnerName = names[result.winner];
  const iWon = mySeat === result.winner;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={[styles.headline, iWon ? styles.won : styles.lost]}>
            {HEADLINE[result.how]}
          </Text>
          <Text style={styles.who}>{iWon ? 'You win it' : `${winnerName} wins it`}</Text>

          <View style={styles.points}>
            <Text style={styles.pointsValue}>+{result.points}</Text>
            <Text style={styles.pointsMath}>
              cube {result.cube} × {result.multiplier}
            </Text>
          </View>

          <Text style={styles.body}>{describeResult(result, winnerName)}</Text>

          <View style={styles.scoreRow}>
            <ScoreCell name={names.p0} value={result.scores.p0} />
            <Text style={styles.scoreTo}>to {target}</Text>
            <ScoreCell name={names.p1} value={result.scores.p1} />
          </View>

          {result.crawford && <Text style={styles.note}>That was the Crawford game.</Text>}

          <Button
            title={requested ? 'Waiting for the next game…' : 'Next game'}
            onPress={onNext}
            disabled={busy || requested}
            style={styles.action}
          />
          <Button title="Leave" variant="ghost" onPress={onLeave} style={styles.action} />
        </View>
      </View>
    </Modal>
  );
}

function ScoreCell({ name, value }: { name: string; value: number }) {
  return (
    <View style={styles.scoreCell}>
      <Text style={styles.scoreName} numberOfLines={1}>
        {name}
      </Text>
      <Text style={styles.scoreValue}>{value}</Text>
    </View>
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
    maxWidth: 380,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: accent.goldDim,
    backgroundColor: felt.tableRaised,
    padding: 20,
    alignItems: 'center',
  },
  headline: { fontSize: 30, fontWeight: '800', letterSpacing: 0.5 },
  won: { color: accent.gold },
  lost: { color: text.muted },
  who: { color: text.primary, fontSize: 16, marginTop: 4 },
  points: { alignItems: 'center', marginVertical: 14 },
  pointsValue: { color: accent.good, fontSize: 40, fontWeight: '800' },
  pointsMath: { color: text.faint, fontSize: 12, marginTop: 2 },
  body: { color: text.hint, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    marginTop: 18,
  },
  scoreCell: { alignItems: 'center', minWidth: 80 },
  scoreName: { color: text.muted, fontSize: 12 },
  scoreValue: { color: accent.gold, fontSize: 26, fontWeight: '800' },
  scoreTo: { color: text.faint, fontSize: 12 },
  note: { color: text.hint, fontSize: 12, marginTop: 12, fontStyle: 'italic' },
  action: { marginTop: 14, alignSelf: 'stretch' },
});
