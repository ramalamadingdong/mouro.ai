import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { retryAuth, useAuth } from '@/fb/auth';
import { isFirebaseConfigured } from '@/fb/config';
import { createRoom } from '@/fb/rooms';
import { useSettingsStore } from '@/store/settingsStore';
import { accent, felt, text } from '@/theme/colors';

/**
 * Home — nickname entry plus Create / Join / Resume. Kicks off anonymous auth
 * on mount so a uid exists before the player creates or joins a room.
 */
export default function HomeScreen() {
  const router = useRouter();
  const { uid, error: authError } = useAuth();

  const playerName = useSettingsStore((s) => s.playerName);
  const setPlayerName = useSettingsStore((s) => s.setPlayerName);
  const lastRoom = useSettingsStore((s) => s.lastRoom);
  const setLastRoom = useSettingsStore((s) => s.setLastRoom);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameFor = (): string => {
    const trimmed = playerName.trim();
    return trimmed.length > 0 ? trimmed : 'Player';
  };

  const ready = isFirebaseConfigured && uid !== null;
  const actionsDisabled = !ready || creating;

  const handleCreate = async () => {
    if (actionsDisabled) return;
    setCreating(true);
    setError(null);
    try {
      const code = await createRoom(nameFor());
      setLastRoom({ code, role: 'host' });
      router.push(`/lobby/${code}`);
    } catch (err) {
      setError((err as Error)?.message ?? 'Could not create a game');
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = () => {
    if (actionsDisabled) return;
    router.push('/join');
  };

  return (
    <Screen center>
      <Text style={styles.title}>Gin Rummy</Text>
      <Text style={styles.subtitle}>Two-player online · or vs computer</Text>

      {!isFirebaseConfigured && (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Firebase not configured</Text>
          <Text style={styles.noticeBody}>
            Add your Firebase config in src/fb/config.ts — see README.
          </Text>
        </View>
      )}

      <View style={styles.form}>
        <Text style={styles.label}>Your name</Text>
        <TextInput
          value={playerName}
          onChangeText={setPlayerName}
          placeholder="Player"
          placeholderTextColor={text.faint}
          maxLength={16}
          autoCapitalize="words"
          autoCorrect={false}
          style={styles.input}
          returnKeyType="done"
        />

        <Button
          title={creating ? 'Creating…' : 'Create game'}
          onPress={handleCreate}
          loading={creating}
          disabled={actionsDisabled}
          style={styles.action}
        />
        <Button
          title="Join game"
          onPress={handleJoin}
          variant="secondary"
          disabled={actionsDisabled}
          style={styles.action}
        />
        {/* Offline — intentionally NOT gated on Firebase/auth readiness. */}
        <Button
          title="Play vs Computer"
          onPress={() => router.push('/solo')}
          variant="secondary"
          style={styles.action}
        />
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {lastRoom && (
        <View style={styles.resume}>
          <Pressable
            style={styles.resumeMain}
            onPress={() => router.push(`/lobby/${lastRoom.code}`)}
            accessibilityRole="button"
            accessibilityLabel={`Resume game ${lastRoom.code}`}
          >
            <Text style={styles.resumeLabel}>Resume game</Text>
            <Text style={styles.resumeCode}>{lastRoom.code}</Text>
          </Pressable>
          <Pressable
            style={styles.resumeDismiss}
            onPress={() => setLastRoom(null)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss resume"
            hitSlop={8}
          >
            <Text style={styles.resumeDismissText}>×</Text>
          </Pressable>
        </View>
      )}

      {isFirebaseConfigured && uid === null && !authError && (
        <View style={styles.connecting}>
          <ActivityIndicator size="small" color={accent.gold} />
          <Text style={styles.connectingText}>connecting…</Text>
        </View>
      )}

      {isFirebaseConfigured && authError && (
        <View style={styles.authError}>
          <Text style={styles.authErrorTitle}>Can’t connect</Text>
          <Text style={styles.authErrorBody}>{authError}</Text>
          <Button
            title="Retry"
            variant="secondary"
            onPress={() => {
              retryAuth().catch(() => {});
            }}
            style={styles.retry}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    color: accent.gold,
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: 1,
    textAlign: 'center',
  },
  subtitle: {
    color: text.muted,
    fontSize: 15,
    marginTop: 6,
    marginBottom: 28,
    textAlign: 'center',
  },
  notice: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: accent.warn,
    backgroundColor: felt.tableRaised,
    padding: 16,
    marginBottom: 24,
  },
  noticeTitle: {
    color: accent.warn,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 4,
  },
  noticeBody: {
    color: text.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  form: {
    width: '100%',
    maxWidth: 360,
  },
  label: {
    color: text.muted,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
    marginLeft: 2,
  },
  input: {
    height: 52,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: felt.tableGlow,
    backgroundColor: felt.tableDeep,
    paddingHorizontal: 16,
    color: text.primary,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 20,
  },
  action: {
    marginTop: 12,
  },
  error: {
    color: accent.bad,
    fontSize: 14,
    marginTop: 16,
    textAlign: 'center',
    maxWidth: 360,
  },
  resume: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    maxWidth: 360,
    marginTop: 28,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: accent.goldDim,
    backgroundColor: felt.tableRaised,
    overflow: 'hidden',
  },
  resumeMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  resumeLabel: {
    color: text.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  resumeCode: {
    color: accent.gold,
    fontSize: 18,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 2,
  },
  resumeDismiss: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  resumeDismissText: {
    color: text.muted,
    fontSize: 22,
    fontWeight: '700',
  },
  connecting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 24,
  },
  connectingText: {
    color: text.muted,
    fontSize: 13,
  },
  authError: {
    width: '100%',
    maxWidth: 360,
    marginTop: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: accent.bad,
    backgroundColor: felt.tableRaised,
    padding: 16,
    alignItems: 'center',
  },
  authErrorTitle: {
    color: accent.bad,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 6,
  },
  authErrorBody: {
    color: text.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  retry: {
    marginTop: 14,
    minWidth: 160,
  },
});
