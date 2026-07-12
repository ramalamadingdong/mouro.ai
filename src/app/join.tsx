import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button } from '@/components/ui/button';
import { CodeInput } from '@/components/ui/code-input';
import { Screen } from '@/components/ui/screen';
import { joinRoom } from '@/fb/rooms';
import { useSettingsStore } from '@/store/settingsStore';
import { accent, text } from '@/theme/colors';

const CODE_LENGTH = 5;

/**
 * Join — enter a 5-character room code and claim the guest seat. On success we
 * record the room for resume and replace into the lobby.
 */
export default function JoinScreen() {
  const router = useRouter();

  const playerName = useSettingsStore((s) => s.playerName);
  const setLastRoom = useSettingsStore((s) => s.setLastRoom);

  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameFor = (): string => {
    const trimmed = playerName.trim();
    return trimmed.length > 0 ? trimmed : 'Player';
  };

  const handleJoin = async () => {
    if (joining || code.length !== CODE_LENGTH) return;
    setJoining(true);
    setError(null);
    try {
      await joinRoom(code, nameFor());
      setLastRoom({ code, role: 'guest' });
      router.replace(`/lobby/${code}`);
    } catch (err) {
      setError((err as Error)?.message ?? 'Could not join the game');
    } finally {
      setJoining(false);
    }
  };

  return (
    <Screen center>
      <Text style={styles.title}>Join a game</Text>
      <Text style={styles.subtitle}>Enter the 5-letter room code</Text>

      <View style={styles.codeArea}>
        <CodeInput
          value={code}
          onChangeText={(v) => {
            setCode(v);
            setError(null);
          }}
          onSubmit={handleJoin}
          autoFocus
        />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actions}>
        <Button
          title={joining ? 'Joining…' : 'Join'}
          onPress={handleJoin}
          loading={joining}
          disabled={code.length !== CODE_LENGTH || joining}
          style={styles.action}
        />
        <Button
          title="Back"
          onPress={() => router.back()}
          variant="ghost"
          disabled={joining}
          style={styles.action}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    color: accent.gold,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  subtitle: {
    color: text.muted,
    fontSize: 15,
    marginTop: 6,
    marginBottom: 32,
    textAlign: 'center',
  },
  codeArea: {
    marginBottom: 8,
  },
  error: {
    color: accent.bad,
    fontSize: 14,
    marginTop: 16,
    textAlign: 'center',
    maxWidth: 340,
  },
  actions: {
    width: '100%',
    maxWidth: 340,
    marginTop: 24,
  },
  action: {
    marginTop: 12,
  },
});
