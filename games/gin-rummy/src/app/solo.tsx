/**
 * Solo route — offline "play vs computer". Runs the engine locally via soloStore
 * and drives a CPU opponent. Shows a difficulty picker before the first deal,
 * then renders the shared <GameTable>. All table UI/logic lives in GameTable;
 * this screen only wires the local data source and the solo rematch (deal now).
 */
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { GameTable } from '@/components/table/game-table';
import { TargetPicker } from '@/components/target-picker';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import type { Difficulty } from '@/ai/cpu';
import { catDeck } from '@/components/card-back';
import { CPU_CAT, CPU_NAME, useSoloStore } from '@/store/soloStore';
import { useSettingsStore } from '@/store/settingsStore';
import { accent, felt, text } from '@/theme/colors';
import { randomSeed } from '@/util/seed';

const DIFFICULTIES: { value: Difficulty; label: string; blurb: string }[] = [
  { value: 'easy', label: 'Easy', blurb: 'Plays loose, knocks early.' },
  { value: 'medium', label: 'Medium', blurb: 'A steady, sensible opponent.' },
  { value: 'hard', label: 'Hard', blurb: 'Sharp — and watches your discards.' },
];

export default function SoloScreen() {
  const router = useRouter();

  const state = useSoloStore((s) => s.state);
  const mySeat = useSoloStore((s) => s.mySeat);
  const pendingMove = useSoloStore((s) => s.pendingMove);
  const error = useSoloStore((s) => s.error);
  const cpuThinking = useSoloStore((s) => s.cpuThinking);
  const send = useSoloStore((s) => s.send);
  const reset = useSoloStore((s) => s.reset);
  const newGame = useSoloStore((s) => s.newGame);

  const playerName = useSettingsStore((s) => s.playerName);
  const cpuDifficulty = useSettingsStore((s) => s.cpuDifficulty);
  const setCpuDifficulty = useSettingsStore((s) => s.setCpuDifficulty);
  const matchTarget = useSettingsStore((s) => s.matchTarget);
  const setMatchTarget = useSettingsStore((s) => s.setMatchTarget);

  // Tear down the local game (and its CPU timer) when leaving the screen.
  useEffect(() => reset, [reset]);

  const onLeave = () => {
    reset();
    router.replace('/');
  };

  const nameFor = (): string => {
    const trimmed = playerName.trim();
    return trimmed.length > 0 ? trimmed : 'Player';
  };

  // Pre-game: choose a difficulty and deal.
  if (!state || !mySeat) {
    return (
      <Screen center>
        <Text style={styles.startTitle}>Play vs Marmalade</Text>
        <Text style={styles.startSub}>Pick a difficulty</Text>

        <View style={styles.picker}>
          {DIFFICULTIES.map((d) => {
            const on = cpuDifficulty === d.value;
            return (
              <Pressable
                key={d.value}
                onPress={() => setCpuDifficulty(d.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={d.label}
                style={[styles.pill, on && styles.pillOn]}
              >
                <Text style={[styles.pillLabel, on && styles.pillLabelOn]}>{d.label}</Text>
                <Text style={[styles.pillBlurb, on && styles.pillBlurbOn]}>{d.blurb}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.targetLabel}>Play to</Text>
        <TargetPicker value={matchTarget} onChange={setMatchTarget} />

        <Button
          title="Deal"
          onPress={() => newGame(nameFor(), cpuDifficulty, matchTarget)}
          style={styles.deal}
        />
        <Button title="Back" variant="ghost" onPress={() => router.replace('/')} style={styles.back} />
      </Screen>
    );
  }

  return (
    <GameTable
      state={state}
      mySeat={mySeat}
      send={send}
      onLeave={onLeave}
      onRematch={() => send({ kind: 'rematch', seed: randomSeed() })}
      pending={pendingMove}
      error={error}
      connected
      opponentOnline
      opponentTurnLabel={cpuThinking ? `${CPU_NAME} is thinking…` : `${CPU_NAME}'s turn`}
      opponentThinking={cpuThinking}
      rematchVotes={{}}
      opponentCat={CPU_CAT}
      opponentCardBack={catDeck(CPU_CAT)}
    />
  );
}

const styles = StyleSheet.create({
  startTitle: {
    color: accent.gold,
    fontSize: 30,
    fontWeight: '800',
    textAlign: 'center',
  },
  startSub: {
    color: text.muted,
    fontSize: 15,
    marginTop: 6,
    marginBottom: 24,
    textAlign: 'center',
  },
  picker: {
    width: '100%',
    maxWidth: 360,
    gap: 12,
  },
  pill: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: felt.tableGlow,
    backgroundColor: felt.tableDeep,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  pillOn: {
    borderColor: accent.gold,
    backgroundColor: felt.tableRaised,
  },
  pillLabel: {
    color: text.primary,
    fontSize: 17,
    fontWeight: '800',
  },
  pillLabelOn: {
    color: accent.gold,
  },
  pillBlurb: {
    color: text.muted,
    fontSize: 13,
    marginTop: 2,
  },
  pillBlurbOn: {
    color: text.primary,
  },
  targetLabel: {
    color: text.muted,
    fontSize: 13,
    fontWeight: '700',
    alignSelf: 'flex-start',
    marginTop: 24,
    marginBottom: 8,
    marginLeft: 2,
    width: '100%',
    maxWidth: 360,
  },
  deal: {
    marginTop: 24,
    minWidth: 200,
  },
  back: {
    marginTop: 8,
  },
});
