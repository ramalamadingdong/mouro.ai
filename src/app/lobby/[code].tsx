import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { useGameStore } from '@/store/gameStore';
import { accent, felt, text } from '@/theme/colors';

/** Presence dot: green when online, grey otherwise. */
function PresenceDot({ online }: { online: boolean }) {
  return (
    <View
      style={[
        styles.dot,
        { backgroundColor: online ? accent.online : accent.offline },
      ]}
    />
  );
}

function PlayerRow({
  name,
  online,
  waiting,
}: {
  name: string | null;
  online: boolean;
  waiting?: boolean;
}) {
  return (
    <View style={styles.playerRow}>
      <PresenceDot online={online} />
      <Text style={[styles.playerName, waiting && styles.playerWaiting]}>
        {name ?? 'Waiting for a friend to join…'}
      </Text>
    </View>
  );
}

/**
 * Lobby — a waiting room bound to the room code. Shows the shareable code and
 * both players as they arrive, then forwards into the game once the host deals.
 */
export default function LobbyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code: string | string[] }>();
  const code = Array.isArray(params.code) ? params.code[0] : params.code;

  const bindRoom = useGameStore((s) => s.bindRoom);
  const reset = useGameStore((s) => s.reset);
  const meta = useGameStore((s) => s.meta);
  const state = useGameStore((s) => s.state);
  const presence = useGameStore((s) => s.presence);
  const connected = useGameStore((s) => s.connected);

  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!code) return;
    bindRoom(code);
    // Give the first snapshot time to arrive before deciding the room is gone.
    const t = setTimeout(() => setSettled(true), 6000);
    return () => clearTimeout(t);
  }, [code, bindRoom]);

  // Once the host has dealt, move into the game (and don't allow coming back).
  useEffect(() => {
    if (code && state) {
      router.replace(`/game/${code}`);
    }
  }, [code, state, router]);

  const leaveHome = () => {
    reset();
    router.replace('/');
  };

  const handleShare = () => {
    if (!code) return;
    Share.share({
      message: `Join my gin rummy game — code ${code}`,
    }).catch(() => {});
  };

  // Room is gone / access denied — but only trust this once we're actually
  // connected, so a slow/absent connection doesn't falsely report "not found".
  if (settled && !meta && connected) {
    return (
      <Screen center>
        <Text style={styles.title}>Room not found</Text>
        <Text style={styles.subtitle}>
          This room no longer exists or has already finished.
        </Text>
        <Button
          title="Back to home"
          onPress={leaveHome}
          style={styles.homeButton}
        />
      </Screen>
    );
  }

  // Waiting for the first snapshot.
  if (!meta) {
    return (
      <Screen center>
        <ActivityIndicator size="large" color={accent.gold} />
        <Text style={styles.loadingText}>Opening room…</Text>
      </Screen>
    );
  }

  const hostOnline = !!(meta.host && presence[meta.host]?.online);
  const guestOnline = !!(meta.guest && presence[meta.guest]?.online);
  const hasGuest = !!meta.guest;

  return (
    <Screen center>
      <Text style={styles.title}>Room ready</Text>
      <Text style={styles.subtitle}>Share this code with your opponent</Text>

      <Pressable
        onPress={handleShare}
        accessibilityRole="button"
        accessibilityLabel={`Room code ${code}, tap to share`}
        style={styles.codeBox}
      >
        <Text style={styles.code}>{code}</Text>
      </Pressable>

      <Button
        title="Share code"
        onPress={handleShare}
        variant="secondary"
        style={styles.shareButton}
      />

      <View style={styles.players}>
        <PlayerRow name={meta.hostName} online={hostOnline} />
        <PlayerRow
          name={meta.guestName ?? null}
          online={guestOnline}
          waiting={!hasGuest}
        />
      </View>

      {!hasGuest && (
        <View style={styles.waitingBanner}>
          <ActivityIndicator size="small" color={accent.gold} />
          <Text style={styles.waitingText}>
            Waiting for a friend to join…
          </Text>
        </View>
      )}

      <Button
        title="Leave"
        onPress={leaveHome}
        variant="ghost"
        style={styles.leaveButton}
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
  },
  subtitle: {
    color: text.muted,
    fontSize: 15,
    marginTop: 6,
    marginBottom: 28,
    textAlign: 'center',
  },
  codeBox: {
    borderRadius: 16,
    borderWidth: 2,
    borderColor: accent.goldDim,
    backgroundColor: felt.tableDeep,
    paddingVertical: 20,
    paddingHorizontal: 32,
    marginBottom: 16,
  },
  code: {
    color: accent.gold,
    fontSize: 48,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 8,
    textAlign: 'center',
  },
  shareButton: {
    minWidth: 200,
  },
  players: {
    width: '100%',
    maxWidth: 340,
    marginTop: 32,
    gap: 4,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: felt.tableRaised,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  playerName: {
    color: text.primary,
    fontSize: 16,
    fontWeight: '700',
    flexShrink: 1,
  },
  playerWaiting: {
    color: text.faint,
    fontWeight: '500',
    fontStyle: 'italic',
  },
  waitingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 24,
  },
  waitingText: {
    color: text.muted,
    fontSize: 14,
  },
  leaveButton: {
    marginTop: 32,
  },
  homeButton: {
    marginTop: 24,
    minWidth: 200,
  },
  loadingText: {
    color: text.muted,
    fontSize: 15,
    marginTop: 16,
  },
});
