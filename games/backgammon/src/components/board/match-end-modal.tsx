import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { describeResult } from '@/components/board/game-end-modal';
import type { GameResult, MatchResult, Seat } from '@/engine/types';
import { accent, felt, text } from '@/theme/colors';

/** How long before we nudge toward Exit when the opponent never answers. */
const STALL_MS = 30000;

export type MatchEndModalProps = {
  visible: boolean;
  match: MatchResult;
  lastGame: GameResult | null;
  names: Record<Seat, string>;
  mySeat: Seat | null;
  busy: boolean;
  /** uid -> voted. Absent (solo) means a rematch is immediate. */
  rematchVotes: Record<string, boolean>;
  players: Record<Seat, string>;
  /** Solo mode has no vote to wait for. */
  soloRematch?: boolean;
  opponentGone?: boolean;
  onRematch: () => void;
  onLeave: () => void;
};

/**
 * The end of a match, in two beats: the deciding game, then the tally. Rushing
 * straight to the scoreboard skips over how the match was actually won.
 */
export function MatchEndModal({
  visible,
  match,
  lastGame,
  names,
  mySeat,
  busy,
  rematchVotes,
  players,
  soloRematch = false,
  opponentGone = false,
  onRematch,
  onLeave,
}: MatchEndModalProps) {
  const [beat, setBeat] = useState<'reveal' | 'tally'>(lastGame ? 'reveal' : 'tally');
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    if (!visible) {
      setBeat(lastGame ? 'reveal' : 'tally');
      setStalled(false);
    }
  }, [visible, lastGame]);

  useEffect(() => {
    if (beat !== 'tally') return;
    const t = setTimeout(() => setStalled(true), STALL_MS);
    return () => clearTimeout(t);
  }, [beat]);

  const iWon = mySeat === match.winner;
  const votes = Object.values(rematchVotes).filter(Boolean).length;
  const iVoted = mySeat ? rematchVotes[players[mySeat]] === true : false;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          {beat === 'reveal' && lastGame ? (
            <>
              <Text style={styles.eyebrow}>Final game</Text>
              <Text style={[styles.headline, styles.small]}>
                {names[lastGame.winner]} +{lastGame.points}
              </Text>
              <Text style={styles.body}>{describeResult(lastGame, names[lastGame.winner])}</Text>
              <Button title="Continue" onPress={() => setBeat('tally')} style={styles.action} />
            </>
          ) : (
            <>
              <Text style={styles.trophy}>🏆</Text>
              <Text style={[styles.headline, iWon ? styles.won : styles.lost]}>
                {iWon ? 'You win the match' : `${names[match.winner]} wins the match`}
              </Text>

              <View style={styles.scoreRow}>
                <ScoreCell name={names.p0} value={match.scores.p0} win={match.winner === 'p0'} />
                <Text style={styles.scoreTo}>{match.target}-point match</Text>
                <ScoreCell name={names.p1} value={match.scores.p1} win={match.winner === 'p1'} />
              </View>

              {match.shutout && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>SHUTOUT</Text>
                </View>
              )}
              <Text style={styles.games}>
                {match.games} {match.games === 1 ? 'game' : 'games'} played
              </Text>

              {opponentGone ? (
                <Text style={styles.note}>Your opponent has left.</Text>
              ) : (
                <Button
                  title={
                    soloRematch
                      ? 'Play again'
                      : iVoted
                        ? `Waiting for a rematch… (${votes}/2)`
                        : 'Rematch'
                  }
                  onPress={onRematch}
                  disabled={busy || (!soloRematch && iVoted)}
                  style={styles.action}
                />
              )}
              <Button
                title="Exit"
                variant={stalled || opponentGone ? 'secondary' : 'ghost'}
                onPress={onLeave}
                style={styles.action}
              />
              {stalled && !opponentGone && (
                <Text style={styles.note}>No answer yet — you can exit and start a new game.</Text>
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function ScoreCell({ name, value, win }: { name: string; value: number; win: boolean }) {
  return (
    <View style={styles.scoreCell}>
      <Text style={styles.scoreName} numberOfLines={1}>
        {name}
      </Text>
      <Text style={[styles.scoreValue, !win && styles.scoreLose]}>{value}</Text>
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
  eyebrow: {
    color: text.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  trophy: { fontSize: 44 },
  headline: { fontSize: 26, fontWeight: '800', textAlign: 'center', marginTop: 8 },
  small: { fontSize: 22 },
  won: { color: accent.gold },
  lost: { color: text.muted },
  body: { color: text.hint, fontSize: 13, textAlign: 'center', lineHeight: 19, marginTop: 10 },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    marginTop: 18,
  },
  scoreCell: { alignItems: 'center', minWidth: 84 },
  scoreName: { color: text.muted, fontSize: 12 },
  scoreValue: { color: accent.gold, fontSize: 30, fontWeight: '800' },
  scoreLose: { color: text.muted },
  scoreTo: { color: text.faint, fontSize: 12, textAlign: 'center', maxWidth: 90 },
  badge: {
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: accent.gold,
  },
  badgeText: { color: text.onGold, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  games: { color: text.faint, fontSize: 12, marginTop: 10 },
  note: { color: text.hint, fontSize: 12, marginTop: 12, textAlign: 'center' },
  action: { marginTop: 14, alignSelf: 'stretch' },
});
