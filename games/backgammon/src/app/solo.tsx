import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { BackgammonBoard } from '@/components/board/backgammon-board';
import { MatchLengthPicker } from '@/components/match-length-picker';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { DIFFICULTIES, DIFFICULTY_BLURB, DIFFICULTY_LABEL } from '@/ai/difficulty';
import { useSettingsStore } from '@/store/settingsStore';
import { useSoloStore } from '@/store/soloStore';
import { accent, felt, text } from '@/theme/colors';

/**
 * `/solo` — offline against the computer. Renders the SAME board as the online
 * route; the only differences are the props (no presence, no rematch votes, a
 * "Computer is thinking…" label).
 *
 * Deliberately independent of Firebase: this screen works with the backend
 * unconfigured and with no network.
 */
export default function SoloScreen() {
  const router = useRouter();

  const difficulty = useSettingsStore((s) => s.cpuDifficulty);
  const setDifficulty = useSettingsStore((s) => s.setCpuDifficulty);
  const matchLength = useSettingsStore((s) => s.matchLength);
  const setMatchLength = useSettingsStore((s) => s.setMatchLength);
  const playerName = useSettingsStore((s) => s.playerName);

  const state = useSoloStore((s) => s.state);
  const mySeat = useSoloStore((s) => s.mySeat);
  const cpuThinking = useSoloStore((s) => s.cpuThinking);
  const error = useSoloStore((s) => s.error);
  const send = useSoloStore((s) => s.send);
  const newMatch = useSoloStore((s) => s.newMatch);
  const reset = useSoloStore((s) => s.reset);

  const leave = () => {
    reset();
    router.replace('/');
  };

  if (!state) {
    return (
      <Screen scroll>
        <Text style={styles.title}>Play the computer</Text>
        <Text style={styles.subtitle}>Offline — no connection needed</Text>

        <View style={styles.tiers}>
          {DIFFICULTIES.map((d) => {
            const active = d === difficulty;
            return (
              <Pressable
                key={d}
                onPress={() => setDifficulty(d)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={[styles.tier, active && styles.tierActive]}
              >
                <Text style={[styles.tierName, active && styles.tierNameActive]}>
                  {DIFFICULTY_LABEL[d]}
                </Text>
                <Text style={styles.tierBlurb}>{DIFFICULTY_BLURB[d]}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.lengthBlock}>
          <MatchLengthPicker value={matchLength} onChange={setMatchLength} />
        </View>

        <Button
          title="Start"
          onPress={() =>
            newMatch({ difficulty, target: matchLength, playerName: playerName.trim() })
          }
          style={styles.start}
        />
        <Button title="Back" variant="ghost" onPress={leave} style={styles.start} />
      </Screen>
    );
  }

  return (
    <Screen flush>
      <BackgammonBoard
        state={state}
        mySeat={mySeat}
        send={send}
        onLeave={leave}
        onRematch={() => send({ kind: 'rematch' })}
        error={error}
        connected
        opponentOnline
        opponentTurnLabel={cpuThinking ? 'Computer is thinking…' : "Computer's turn"}
        opponentThinking={cpuThinking}
        soloRematch
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    color: accent.gold,
    fontSize: 30,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 12,
  },
  subtitle: { color: text.muted, fontSize: 15, marginTop: 6, textAlign: 'center' },

  tiers: { width: '100%', maxWidth: 380, alignSelf: 'center', marginTop: 24, gap: 10 },
  tier: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: felt.tableGlow,
    backgroundColor: felt.tableDeep,
    padding: 14,
  },
  tierActive: { borderColor: accent.gold, backgroundColor: felt.tableRaised },
  tierName: { color: text.primary, fontSize: 17, fontWeight: '800' },
  tierNameActive: { color: accent.gold },
  tierBlurb: { color: text.hint, fontSize: 13, marginTop: 4, lineHeight: 18 },

  lengthBlock: { marginTop: 28 },
  start: { marginTop: 16, alignSelf: 'center', width: '100%', maxWidth: 380 },
});
