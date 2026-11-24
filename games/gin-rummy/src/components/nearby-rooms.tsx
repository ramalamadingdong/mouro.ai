import { useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';

import { Button } from '@/components/ui/button';
import { useNearbyRooms } from '@/net/nearby';
import { joinRoom } from '@/net/rooms';
import { useSettingsStore } from '@/store/settingsStore';
import { accent, felt, text } from '@/theme/colors';

/**
 * The "On your Wi-Fi" list on the home and join screens. Renders nothing when
 * empty (always, during the prerender and on native).
 *
 * Join takes the seat straight away and opens the lobby. That is safe here,
 * unlike on `/join/<code>`, which never auto-joins: this is a tap inside the
 * game, not a link a preview bot can open, and the player's name is whatever
 * they set on the home screen, same as the Join button.
 */
export function NearbyRooms({
  enabled,
  replace = false,
  style,
}: {
  enabled: boolean;
  /** Replace the current screen with the lobby (the join screen) instead of pushing it. */
  replace?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const router = useRouter();
  // Screens under the lobby stay mounted in the stack: poll only while seen.
  const focused = useIsFocused();
  const rooms = useNearbyRooms(enabled && focused);
  const playerName = useSettingsStore((s) => s.playerName);
  const setLastRoom = useSettingsStore((s) => s.setLastRoom);
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (rooms.length === 0) return null;

  const join = async (code: string) => {
    if (joining) return;
    setJoining(code);
    setError(null);
    try {
      await joinRoom(code, playerName.trim() || 'Player');
      setLastRoom({ code, role: 'guest' });
      if (replace) router.replace(`/lobby/${code}`);
      else router.push(`/lobby/${code}`);
    } catch (err) {
      setError((err as Error)?.message ?? 'Could not join the game');
    } finally {
      setJoining(null);
    }
  };

  return (
    <View style={[styles.panel, style]}>
      <Text style={styles.heading} accessibilityRole="header">
        On your Wi-Fi
      </Text>
      {rooms.map((room) => (
        <View key={room.code} style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.name} numberOfLines={1}>
              {room.name ? `${room.name}’s game` : `Room ${room.code}`}
            </Text>
            <Text style={styles.players}>
              {room.players} {room.players === 1 ? 'player' : 'players'}
            </Text>
          </View>
          <Button
            title={joining === room.code ? 'Joining…' : 'Join'}
            onPress={() => void join(room.code)}
            loading={joining === room.code}
            disabled={joining !== null}
            style={styles.join}
          />
        </View>
      ))}
      {error && (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: '100%',
    maxWidth: 340,
    alignSelf: 'center',
    marginTop: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: felt.tableGlow,
    backgroundColor: felt.tableDeep,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  heading: {
    color: text.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 12 },
  rowText: { flex: 1, minWidth: 0 },
  name: { color: text.primary, fontSize: 15, fontWeight: '600' },
  players: { color: text.faint, fontSize: 12, marginTop: 2 },
  join: { minWidth: 96 },
  error: { color: accent.bad, fontSize: 13, textAlign: 'center', marginVertical: 6 },
});
