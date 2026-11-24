import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { TargetPicker, DEFAULT_TARGET } from '@/components/target-picker';
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
  const setTarget = useGameStore((s) => s.setTarget);

  const matchTarget = useSettingsStore((s) => s.matchTarget);
  const setMatchTarget = useSettingsStore((s) => s.setMatchTarget);

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

  // Host: seed the room's winning score from the saved preference as soon as the
  // room is open and no target is set yet, so the guest inherits it even if the
  // host never touches the picker (the deal reads meta.target).
  const isHost = !!(meta && getCurrentUid() === meta.host);
  useEffect(() => {
    if (isHost && meta && meta.target === undefined) setTarget(matchTarget);
  }, [isHost, meta, matchTarget, setTarget]);

  const handleTarget = (t: number) => {
    setMatchTarget(t); // remember the preference for next time
    setTarget(t); // write to the room
  };

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
    const url = inviteUrl(code);

    // Web: React Native's Share is unreliable/unsupported under react-native-web,
    // so go through the browser APIs directly — each one feature-checked, because
    // all of them are absent in plausible situations (no navigator.share on
    // desktop Firefox; no navigator.clipboard on insecure origins or inside an
    // iframe) and an unguarded call throws instead of degrading.
    if (Platform.OS === 'web') {
      const nav: Navigator | undefined =
        typeof navigator !== 'undefined' ? navigator : undefined;

      if (nav?.share) {
        // No `url` beside the text: the link is in the text already, and share
        // targets that take both print it twice.
        nav
          .share({ title: 'Gin Rummy', text: inviteMessage(code) })
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

    // Native. The link is already in the message (Android ignores `url`
    // entirely), so no separate `url`: share targets that take both print the
    // link twice.
    Share.share({ message: inviteMessage(code) }).catch(() => {});
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

  // Settled but never connected — don't leave the player on an endless spinner.
  if (settled && !meta && !connected) {
    return (
      <Screen center>
        <Text style={styles.title}>Couldn’t connect</Text>
        <Text style={styles.subtitle}>
          Check your internet connection and try again.
        </Text>
        <Button
          title="Back to home"
          onPress={leaveHome}
          style={styles.homeButton}
        />
      </Screen>
    );
  }

  // Waiting for the first snapshot (still within the settle window). Always offer
  // an exit so a slow/absent connection can never trap the player here.
  if (!meta) {
    return (
      <Screen center>
        <ActivityIndicator size="large" color={accent.gold} />
        <Text style={styles.loadingText}>Opening room…</Text>
        <Button
          title="Leave"
          onPress={leaveHome}
          variant="ghost"
          style={styles.loadingLeave}
        />
      </Screen>
    );
  }

  const hostOnline = !!(meta.host && presence[meta.host]?.online);
  const guestOnline = !!(meta.guest && presence[meta.guest]?.online);
  const hasGuest = !!meta.guest;

  return (
    <Screen center>
      <Text style={styles.title}>Room ready</Text>
      <Text style={styles.subtitle}>Send this link to your opponent</Text>

      <Pressable
        onPress={handleShare}
        accessibilityRole="button"
        accessibilityLabel={`Room code ${code}, tap to share the invite link`}
        style={styles.codeBox}
      >
        <Text style={styles.code}>{code}</Text>
      </Pressable>

      <Button
        title="Share invite link"
        onPress={handleShare}
        variant="secondary"
        style={styles.shareButton}
      />

      {copied && <Text style={styles.copied}>Link copied</Text>}

      {showLink && (
        <Text style={styles.linkFallback} selectable>
          {inviteUrl(code)}
        </Text>
      )}

      <View style={styles.players}>
        <PlayerRow name={meta.hostName} online={hostOnline} />
        <PlayerRow
          name={meta.guestName ?? null}
          online={guestOnline}
          waiting={!hasGuest}
        />
      </View>

      <View style={styles.targetSection}>
        <Text style={styles.targetHeading}>Winning score</Text>
        {isHost ? (
          <TargetPicker value={meta.target ?? matchTarget} onChange={handleTarget} />
        ) : (
          <Text style={styles.targetReadonly}>
            First to {meta.target ?? DEFAULT_TARGET} wins
          </Text>
        )}
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
    fontFamily: mono,
    letterSpacing: 8,
    textAlign: 'center',
  },
  shareButton: {
    minWidth: 200,
  },
  copied: {
    color: accent.online,
    fontSize: 13,
    fontWeight: '700',
    marginTop: 10,
  },
  linkFallback: {
    color: text.muted,
    fontSize: 12,
    fontFamily: mono,
    marginTop: 10,
    textAlign: 'center',
    maxWidth: 340,
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
    color: text.hint,
    fontWeight: '500',
    fontStyle: 'italic',
  },
  targetSection: {
    width: '100%',
    maxWidth: 340,
    marginTop: 24,
    alignItems: 'center',
  },
  targetHeading: {
    color: text.muted,
    fontSize: 13,
    fontWeight: '700',
    alignSelf: 'flex-start',
    marginLeft: 2,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  targetReadonly: {
    color: text.primary,
    fontSize: 15,
    fontWeight: '700',
    alignSelf: 'flex-start',
    marginLeft: 2,
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
  loadingLeave: {
    marginTop: 24,
  },
});
