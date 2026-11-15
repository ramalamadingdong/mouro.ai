import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { BackgammonBoard } from '@/components/board/backgammon-board';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { voteRematch } from '@/net/rooms';
import { unpackSteps } from '@/util/draft';
import { useGameStore } from '@/store/gameStore';
import { useSettingsStore } from '@/store/settingsStore';
import { accent, text } from '@/theme/colors';

/**
 * `/game/<code>` — the online table. Deliberately thin: it binds the store to
 * the room and maps store slices onto `<BackgammonBoard>` props. All the game
 * behaviour lives in the board, which `/solo` renders too.
 */
export default function GameScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code: string | string[] }>();
  const code = Array.isArray(params.code) ? params.code[0] : params.code;

  const bindRoom = useGameStore((s) => s.bindRoom);
  const reset = useGameStore((s) => s.reset);
  const state = useGameStore((s) => s.state);
  const meta = useGameStore((s) => s.meta);
  const mySeat = useGameStore((s) => s.mySeat);
  const presence = useGameStore((s) => s.presence);
  const connected = useGameStore((s) => s.connected);
  const pendingMove = useGameStore((s) => s.pendingMove);
  const error = useGameStore((s) => s.error);
  const send = useGameStore((s) => s.send);
  const rematchVotes = useGameStore((s) => s.rematchVotes);
  const emotes = useGameStore((s) => s.emotes);
  const sendEmote = useGameStore((s) => s.sendEmote);
  const drafts = useGameStore((s) => s.drafts);
  const publishDraft = useGameStore((s) => s.publishDraft);

  const setLastRoom = useSettingsStore((s) => s.setLastRoom);

  useEffect(() => {
    if (code) bindRoom(code);
  }, [code, bindRoom]);

  const leave = () => {
    // A finished match is not worth resuming into.
    if (state?.matchResult) setLastRoom(null);
    reset();
    router.replace('/');
  };

  if (!state || !meta) {
    return (
      <Screen center>
        <ActivityIndicator size="large" color={accent.gold} />
        <Text style={styles.hint}>{connected ? 'Setting up the board…' : 'Reconnecting…'}</Text>
        <Button title="Back to home" variant="ghost" onPress={leave} style={styles.back} />
      </Screen>
    );
  }

  const myUid = mySeat ? state.players[mySeat] : null;
  const opponentUid = mySeat === 'p0' ? state.players.p1 : state.players.p0;
  const opponentOnline = presence[opponentUid]?.online === true;
  const theirDraft = drafts[opponentUid];
  const opponentDraft = theirDraft
    ? { version: Number(theirDraft.v), steps: unpackSteps(theirDraft.s) }
    : null;

  return (
    <Screen flush>
      <BackgammonBoard
        state={state}
        mySeat={mySeat}
        send={send}
        onLeave={leave}
        onRematch={() => {
          if (code) void voteRematch(code);
        }}
        pending={pendingMove}
        error={error}
        connected={connected}
        opponentOnline={opponentOnline}
        rematchVotes={rematchVotes}
        onEmote={sendEmote}
        myEmote={myUid ? (emotes[myUid] ?? null) : null}
        opponentEmote={emotes[opponentUid] ?? null}
        opponentDraft={opponentDraft}
        onDraftChange={publishDraft}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { color: text.hint, fontSize: 15, marginTop: 14 },
  back: { marginTop: 24, minWidth: 220 },
});
