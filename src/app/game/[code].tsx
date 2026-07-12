/**
 * Online game route — binds the Firebase room and renders the shared <GameTable>.
 * All table UI/logic lives in GameTable; this screen only wires the online data
 * source (gameStore) and the online-specific rematch action (voteRematch).
 */
import { useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { GameTable } from '@/components/table/game-table';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { otherSeat } from '@/engine';
import { voteRematch } from '@/fb/rooms';
import { useGameStore } from '@/store/gameStore';
import { text } from '@/theme/colors';

export default function GameScreen() {
  const params = useLocalSearchParams<{ code: string | string[] }>();
  const code = Array.isArray(params.code) ? params.code[0] : params.code;
  const router = useRouter();

  const state = useGameStore((s) => s.state);
  const mySeat = useGameStore((s) => s.mySeat);
  const presence = useGameStore((s) => s.presence);
  const rematchVotes = useGameStore((s) => s.rematchVotes);
  const pendingMove = useGameStore((s) => s.pendingMove);
  const error = useGameStore((s) => s.error);
  const connected = useGameStore((s) => s.connected);
  const send = useGameStore((s) => s.send);
  const reset = useGameStore((s) => s.reset);
  const bindRoom = useGameStore((s) => s.bindRoom);

  // Bind the room (idempotent — the lobby may already have bound the same code).
  useEffect(() => {
    if (code) bindRoom(code);
  }, [code, bindRoom]);

  const onLeave = () => {
    reset();
    router.replace('/');
  };

  // Loading / reconnecting: mySeat can be null while anonymous auth is restoring.
  if (!state || !mySeat) {
    return (
      <Screen center>
        <Text style={styles.loadingTitle}>
          {connected ? 'Loading the table…' : 'Reconnecting…'}
        </Text>
        <Text style={styles.loadingSub}>Restoring your seat</Text>
        <Button title="Leave" variant="ghost" onPress={onLeave} style={styles.loadingLeave} />
      </Screen>
    );
  }

  const oppUid = state.players[otherSeat(mySeat)];
  const opponentOnline = presence[oppUid]?.online ?? false;

  return (
    <GameTable
      state={state}
      mySeat={mySeat}
      send={send}
      onLeave={onLeave}
      onRematch={() => {
        if (code) voteRematch(code).catch(() => {});
      }}
      pending={pendingMove}
      error={error}
      connected={connected}
      opponentOnline={opponentOnline}
      rematchVotes={rematchVotes}
    />
  );
}

const styles = StyleSheet.create({
  loadingTitle: {
    color: text.primary,
    fontSize: 20,
    fontWeight: '700',
  },
  loadingSub: {
    color: text.muted,
    fontSize: 14,
    marginTop: 6,
  },
  loadingLeave: {
    marginTop: 24,
  },
});
