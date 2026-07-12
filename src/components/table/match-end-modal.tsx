import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { SCORING, type MatchResult, type Seat } from '@/engine';
import { accent, felt, text } from '@/theme/colors';

export type MatchEndModalProps = {
  visible: boolean;
  result: MatchResult;
  names: Record<Seat, string>;
  mySeat: Seat;
  players: Record<Seat, string>;
  rematchVotes: Record<string, boolean>;
  onRematch: () => void;
  onExit: () => void;
  pending?: boolean;
};

const SEATS: Seat[] = ['p0', 'p1'];

/**
 * Match-over overlay. DUMB: renders the final `MatchResult` tallies (base + game
 * bonus + boxes, with a shutout flag) and reports Rematch / Exit taps. Rematch
 * shows a live vote count derived from `rematchVotes` keyed by player uid.
 */
export function MatchEndModal({
  visible,
  result,
  names,
  mySeat,
  players,
  rematchVotes,
  onRematch,
  onExit,
  pending,
}: MatchEndModalProps) {
  const winnerName =
    result.winner === mySeat
      ? `${names[result.winner]} (you)`
      : names[result.winner];

  const votes = SEATS.filter((s) => rematchVotes[players[s]]).length;
  const iVoted = !!rematchVotes[players[mySeat]];
  const rematchDisabled = pending || iVoted;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onExit}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.trophy}>🏆</Text>
          <Text style={styles.banner}>{winnerName} wins!</Text>
          {result.shutout && (
            <View style={styles.shutout}>
              <Text style={styles.shutoutText}>SHUTOUT ×{SCORING.SHUTOUT_X}</Text>
            </View>
          )}

          <View style={styles.tallies}>
            {SEATS.map((seat) => (
              <SeatTally
                key={seat}
                name={
                  seat === mySeat ? `${names[seat]} (you)` : names[seat]
                }
                base={result.base[seat]}
                boxes={result.boxes[seat]}
                hasGameBonus={result.gameBonusTo === seat}
                shutout={result.shutout && result.winner === seat}
                total={result.final[seat]}
                isWinner={result.winner === seat}
              />
            ))}
          </View>

          <Pressable
            onPress={onRematch}
            disabled={rematchDisabled}
            accessibilityRole="button"
            accessibilityLabel="Rematch"
            accessibilityState={{ disabled: rematchDisabled }}
            style={({ pressed }) => [
              styles.button,
              styles.primary,
              rematchDisabled && styles.primaryDisabled,
              pressed && !rematchDisabled && styles.pressed,
            ]}
          >
            <Text style={styles.primaryText}>
              {iVoted ? `Waiting for opponent… (${votes}/2)` : 'Rematch'}
            </Text>
          </Pressable>

          <Pressable
            onPress={onExit}
            accessibilityRole="button"
            accessibilityLabel="Exit to home"
            style={({ pressed }) => [
              styles.button,
              styles.ghost,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.ghostText}>Exit</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function SeatTally({
  name,
  base,
  boxes,
  hasGameBonus,
  shutout,
  total,
  isWinner,
}: {
  name: string;
  base: number;
  boxes: number;
  hasGameBonus: boolean;
  shutout: boolean;
  total: number;
  isWinner: boolean;
}) {
  return (
    <View style={[styles.tally, isWinner && styles.tallyWinner]}>
      <View style={styles.tallyHeader}>
        <Text style={styles.tallyName} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.tallyTotal, isWinner && styles.tallyTotalWin]}>
          {total}
        </Text>
      </View>
      <View style={styles.breakdown}>
        <BreakdownRow label="Base score" value={base} />
        {hasGameBonus && (
          <BreakdownRow label="Game bonus" value={SCORING.GAME} />
        )}
        {boxes > 0 && (
          <BreakdownRow
            label={`Boxes ${boxes} × ${SCORING.BOX}`}
            value={boxes * SCORING.BOX}
          />
        )}
        {shutout && (
          <BreakdownRow label={`Shutout × ${SCORING.SHUTOUT_X}`} value={null} />
        )}
      </View>
    </View>
  );
}

function BreakdownRow({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <View style={styles.breakdownRow}>
      <Text style={styles.breakdownLabel}>{label}</Text>
      {value != null && <Text style={styles.breakdownValue}>+{value}</Text>}
    </View>
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
    maxWidth: 440,
    backgroundColor: felt.tableRaised,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: accent.gold,
    padding: 24,
    gap: 12,
    alignItems: 'stretch',
  },
  trophy: {
    fontSize: 48,
    textAlign: 'center',
  },
  banner: {
    color: accent.gold,
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
  },
  shutout: {
    alignSelf: 'center',
    backgroundColor: accent.bad,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  shutoutText: {
    color: text.primary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
  },
  tallies: {
    gap: 10,
    marginTop: 4,
  },
  tally: {
    backgroundColor: felt.table,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: felt.tableDeep,
  },
  tallyWinner: {
    borderColor: accent.gold,
  },
  tallyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  tallyName: {
    color: text.primary,
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  tallyTotal: {
    color: text.primary,
    fontSize: 22,
    fontWeight: '800',
  },
  tallyTotalWin: {
    color: accent.gold,
  },
  breakdown: {
    gap: 3,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  breakdownLabel: {
    color: text.muted,
    fontSize: 13,
  },
  breakdownValue: {
    color: text.muted,
    fontSize: 13,
    fontWeight: '700',
  },
  button: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primary: {
    backgroundColor: accent.gold,
  },
  primaryDisabled: {
    backgroundColor: accent.goldDim,
    opacity: 0.8,
  },
  primaryText: {
    color: text.onGold,
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
