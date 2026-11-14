import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { MatchLengthPicker } from '@/components/match-length-picker';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { getCurrentUid } from '@/net/auth';
import { useGameStore } from '@/store/gameStore';
import { useSettingsStore } from '@/store/settingsStore';
import { accent, felt, text } from '@/theme/colors';
import { mono } from '@/theme/typography';
import { inviteMessage, inviteUrl } from '@/util/invite';

/** Presence dot: green when online, grey otherwise. */
function PresenceDot({ online }: { online: boolean }) {
  return <View style={[styles.dot, { backgroundColor: online ? accent.online : accent.offline }]} />;
}

function PlayerRow({
  name,
  online,
  waiting,
  colour,
}: {
  name: string | null;
  online: boolean;
  waiting?: boolean;
  colour: 'cream' | 'maroon';
}) {
  return (
    <View style={styles.playerRow}>
      <PresenceDot online={online} />
      <View style={[styles.checkerChip, colour === 'cream' ? styles.chipCream : styles.chipMaroon]} />
      <Text style={[styles.playerName, waiting && styles.playerWaiting]}>
        {name ?? 'Waiting for a friend to join…'}
      </Text>
    </View>
  );
}

/**
 * Lobby — a waiting room bound to the room code. Shows the shareable code and
 * both players as they arrive, then forwards into the game once the host opens
 * the board.
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
  const setTarget = useGameStore((s) => s.setTarget);

  const matchLength = useSettingsStore((s) => s.matchLength);
  const setMatchLength = useSettingsStore((s) => s.setMatchLength);

  const [settled, setSettled] = useState(false);
  // Web-only share feedback: `copied` confirms the clipboard write (the browser
  // gives no visible signal of its own), `showLink` reveals a selectable URL
  // when no clipboard API exists at all.
  const [copied, setCopied] = useState(false);
  const [showLink, setShowLink] = useState(false);

  useEffect(() => {
    if (!code) return;
    bindRoom(code);
    // Give the first snapshot time to arrive before deciding the room is gone.
    const t = setTimeout(() => setSettled(true), 6000);
    return () => clearTimeout(t);
  }, [code, bindRoom]);

  // Host: seed the room's match length from the saved preference as soon as the
  // room is open and no target is set yet, so the guest inherits it even if the
  // host never touches the picker (the opening read uses meta.target).
  const isHost = !!(meta && getCurrentUid() === meta.host);
  useEffect(() => {
    if (isHost && meta && meta.target === undefined) setTarget(matchLength);
  }, [isHost, meta, matchLength, setTarget]);

  const handleLength = (points: number) => {
    setMatchLength(points); // remember the preference for next time
    setTarget(points); // write to the room
  };

  // Once the host has opened the board, move into the game (and don't allow
  // coming back to a lobby for a match already in progress).
  useEffect(() => {
    if (code && state) router.replace(`/game/${code}`);
  }, [code, state, router]);

  const leaveHome = () => {
    reset();
    router.replace('/');
  };

  const handleShare = () => {
    if (!code) return;
    const url = inviteUrl(code);

    // Web: React Native's Share is unreliable/unsupported under react-native-web,
    // so go through the browser APIs directly — each one feature-checked, because
    // all of them are absent in plausible situations (no navigator.share on
    // desktop Firefox; no navigator.clipboard on insecure origins or inside an
    // iframe) and an unguarded call throws instead of degrading.
    if (Platform.OS === 'web') {
      const nav: Navigator | undefined = typeof navigator !== 'undefined' ? navigator : undefined;

      if (nav?.share) {
        nav
          .share({ title: 'Backgammon', text: inviteMessage(code), url })
          // A rejection here is usually the user dismissing the sheet, not a
          // failure — don't fall through to copying behind their back.
          .catch(() => {});
        return;
      }
      if (nav?.clipboard?.writeText) {
        nav.clipboard
          .writeText(url)
          .then(() => setCopied(true))
          .catch(() => setShowLink(true));
        return;
      }
      // Last resort: render the URL so it can be selected and copied by hand.
      setShowLink(true);
      return;
    }

    // Native. iOS reads `url` separately to build the rich share sheet preview;
    // Android IGNORES `url` entirely, which is why inviteMessage() also embeds
    // the link in the text.
    Share.share({ message: inviteMessage(code), url }).catch(() => {});
  };

  // Room is gone / access denied — but only trust this once we're actually
  // connected, so a slow/absent connection doesn't falsely report "not found".
  if (settled && !meta && connected) {
    return (
      <Screen center>
        <Text style={styles.title}>Room not found</Text>
        <Text style={styles.subtitle}>This room no longer exists or has already finished.</Text>
        <Button title="Back to home" onPress={leaveHome} style={styles.homeButton} />
      </Screen>
    );
  }

  // Settled but never connected — don't leave the player on an endless spinner.
  if (settled && !meta && !connected) {
    return (
      <Screen center>
        <Text style={styles.title}>Couldn’t connect</Text>
        <Text style={styles.subtitle}>Check your internet connection and try again.</Text>
        <Button title="Back to home" onPress={leaveHome} style={styles.homeButton} />
      </Screen>
    );
  }

  // Waiting for the first snapshot (still within the settle window). Always offer
  // an exit so a slow/absent connection can never trap the player here.
  if (!meta) {
    return (
      <Screen center>
        <ActivityIndicator size="large" color={accent.gold} />
        <Text style={styles.subtitle}>Opening room…</Text>
        <Button title="Back to home" onPress={leaveHome} variant="ghost" style={styles.homeButton} />
      </Screen>
    );
  }

  const hostOnline = presence[meta.host]?.online === true;
  const guestOnline = !!meta.guest && presence[meta.guest]?.online === true;
  const target = meta.target ?? matchLength;

  return (
    <Screen scroll>
      <Text style={styles.title}>Waiting room</Text>
      <Text style={styles.subtitle}>Share this code with your opponent</Text>

      <Pressable
        onPress={handleShare}
        style={styles.codeBox}
        accessibilityRole="button"
        accessibilityLabel={`Room code ${code}. Tap to share.`}
      >
        <Text style={styles.code}>{code}</Text>
      </Pressable>

      <Button title="Share invite" variant="secondary" onPress={handleShare} style={styles.share} />
      {copied && <Text style={styles.copied}>Link copied</Text>}
      {showLink && code && (
        <Text selectable style={styles.linkFallback}>
          {inviteUrl(code)}
        </Text>
      )}

      <View style={styles.players}>
        <PlayerRow name={meta.hostName} online={hostOnline} colour="cream" />
        <PlayerRow
          name={meta.guestName ?? null}
          online={guestOnline}
          waiting={!meta.guest}
          colour="maroon"
        />
      </View>

      <View style={styles.lengthBlock}>
        {isHost ? (
          <MatchLengthPicker value={target} onChange={handleLength} />
        ) : (
          <>
            <Text style={styles.lengthLabel}>Match length</Text>
            <Text style={styles.lengthValue}>
              First to {target} {target === 1 ? 'point' : 'points'}
            </Text>
            <Text style={styles.lengthHint}>The host chooses this</Text>
          </>
        )}
      </View>

      {!connected && <Text style={styles.reconnecting}>Reconnecting…</Text>}

      <Button title="Leave" variant="ghost" onPress={leaveHome} style={styles.homeButton} />
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

  codeBox: {
    alignSelf: 'center',
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: accent.goldDim,
    backgroundColor: felt.tableDeep,
  },
  code: {
    color: accent.gold,
    fontSize: 48,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 8,
    textAlign: 'center',
  },
  share: { alignSelf: 'center', marginTop: 16, minWidth: 220 },
  copied: { color: accent.good, fontSize: 13, textAlign: 'center', marginTop: 8 },
  linkFallback: {
    color: text.hint,
    fontSize: 12,
    fontFamily: mono,
    textAlign: 'center',
    marginTop: 10,
  },

  players: {
    width: '100%',
    maxWidth: 340,
    alignSelf: 'center',
    marginTop: 28,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: felt.tableGlow,
    backgroundColor: felt.tableDeep,
    paddingHorizontal: 14,
  },
  playerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  checkerChip: { width: 16, height: 16, borderRadius: 8, borderWidth: 1 },
  chipCream: { backgroundColor: '#f5f0e1', borderColor: '#d8d0ba' },
  chipMaroon: { backgroundColor: '#7c2d3a', borderColor: '#a34551' },
  playerName: { color: text.primary, fontSize: 16, fontWeight: '600', flex: 1 },
  playerWaiting: { color: text.faint, fontWeight: '400', fontStyle: 'italic' },

  lengthBlock: { marginTop: 28, alignItems: 'center' },
  lengthLabel: {
    color: text.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  lengthValue: { color: accent.gold, fontSize: 20, fontWeight: '800', marginTop: 6 },
  lengthHint: { color: text.faint, fontSize: 12, marginTop: 4 },

  reconnecting: { color: accent.warn, fontSize: 13, textAlign: 'center', marginTop: 20 },
  homeButton: { marginTop: 24, alignSelf: 'center', minWidth: 220 },
});
