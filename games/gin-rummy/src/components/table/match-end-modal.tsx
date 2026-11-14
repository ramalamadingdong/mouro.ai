import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { RoundReveal } from '@/components/table/round-reveal';
import { SCORING, type MatchResult, type RoundResult, type Seat } from '@/engine';
import { accent, felt, text } from '@/theme/colors';

/** After this long waiting alone for a rematch, nudge the player toward Exit. */
const STALL_MS = 30000;

export type MatchEndModalProps = {
  visible: boolean;
  result: MatchResult;
  /** The deciding round, revealed before the tally so players see HOW it ended. */
  roundResult: RoundResult;
  names: Record<Seat, string>;
  mySeat: Seat;
  players: Record<Seat, string>;
  rematchVotes: Record<string, boolean>;
  /** Whether the opponent is still connected (online). Solo: always true. */
  opponentPresent?: boolean;
  onRematch: () => void;
  onExit: () => void;
  pending?: boolean;
};

const SEATS: Seat[] = ['p0', 'p1'];

/**
 * Match-over overlay. Two beats: first it reveals the deciding round (how it was
 * won, via the shared `RoundReveal`), then — on "Continue" — the final tallies
 * (base + game bonus + boxes, with a shutout flag) and Rematch / Exit. Rematch
 * shows a live vote count derived from `rematchVotes` keyed by player uid.
 */
export function MatchEndModal({
  visible,
  result,
  roundResult,
  names,
  mySeat,
  players,
  rematchVotes,
  opponentPresent = true,
  onRematch,
  onExit,
  pending,
}: MatchEndModalProps) {
  const winnerName =
    result.winner === mySeat
      ? `${names[result.winner]} (you)`
      : names[result.winner];

  // A match can only be decided by a scoring round, but guard defensively.
  const canReveal = roundResult.type !== 'void' && roundResult.winner != null;
  const [step, setStep] = useState<'reveal' | 'tally'>('reveal');
  useEffect(() => {
    if (visible) setStep(canReveal ? 'reveal' : 'tally');
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const votes = SEATS.filter((s) => rematchVotes[players[s]]).length;
  const iVoted = !!rematchVotes[players[mySeat]];
  const rematchDisabled = pending || iVoted;

  // If the opponent disconnected, a rematch can never complete — say so.
  const opponentLeft = iVoted && !opponentPresent;

  // Otherwise, after a while waiting alone, nudge toward Exit.
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (step !== 'tally' || !visible || !iVoted || votes >= 2 || opponentLeft) {
      setStalled(false);
      return;
    }
    const t = setTimeout(() => setStalled(true), STALL_MS);
    return () => clearTimeout(t);
  }, [step, visible, iVoted, votes, opponentLeft]);

  const rematchText = !iVoted
    ? 'Rematch'
    : opponentLeft
      ? 'Opponent left'
      : `Waiting for opponent… (${votes}/2)`;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onExit}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {step === 'reveal' ? (
            <>
              <ScrollView
                style={styles.body}
                contentContainerStyle={styles.bodyContent}
                showsVerticalScrollIndicator={false}
              >
                <RoundReveal
                  result={roundResult}
                  names={names}
                  mySeat={mySeat}
                />
              </ScrollView>

              <Pressable
                onPress={() => setStep('tally')}
                accessibilityRole="button"
                accessibilityLabel="Continue to final score"
                style={({ pressed }) => [
                  styles.button,
                  styles.primary,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.primaryText}>Continue</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.trophy}>🏆</Text>
              <Text style={styles.banner}>{winnerName} wins!</Text>
              {result.shutout && (
                <View style={styles.shutout}>
                  <Text style={styles.shutoutText}>
                    SHUTOUT ×{SCORING.SHUTOUT_X}
                  </Text>
                </View>
              )}

              <View style={styles.tallies}>
                {SEATS.map((seat) => (
                  <SeatTally
                    key={seat}
                    name={seat === mySeat ? `${names[seat]} (you)` : names[seat]}
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
                <Text style={styles.primaryText}>{rematchText}</Text>
              </Pressable>

              {opponentLeft ? (
                <Text style={styles.waitHint}>
                  Your opponent left the game — tap Exit to return home.
                </Text>
              ) : stalled ? (
                <Text style={styles.waitHint}>
                  Still waiting — you can Exit anytime.
                </Text>
              ) : null}

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
            </>
          )}
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
    maxHeight: '90%',
    backgroundColor: felt.tableRaised,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: accent.gold,
    padding: 24,
    gap: 12,
    alignItems: 'stretch',
  },
  body: {
    flexGrow: 0,
  },
  bodyContent: {
    paddingVertical: 4,
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
  waitHint: {
    color: text.hint,
    fontSize: 13,
    textAlign: 'center',
    marginTop: -4,
  },
  pressed: {
    opacity: 0.85,
  },
});
