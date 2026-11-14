import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button } from '@/components/ui/button';
import { CodeInput, CODE_LENGTH } from '@/components/ui/code-input';
import { Screen } from '@/components/ui/screen';
import { joinRoom } from '@/net/rooms';
import { useSettingsStore } from '@/store/settingsStore';
import { accent, text } from '@/theme/colors';
import { mono } from '@/theme/typography';

export type JoinScreenProps = {
  /** Code lifted out of an invite link, already sanitized by the caller. */
  initialCode?: string;
  /** True when we arrived via an invite link — changes the copy, not the flow. */
  invited?: boolean;
  /**
   * Shown above the code entry when an invite link was malformed, so the
   * fallback to manual entry explains itself instead of looking like a bug.
   */
  notice?: string;
  /**
   * Render a neutral shell instead of the real screen.
   *
   * This is what `/join/<code>` prerenders and what it renders on its first
   * client pass, so the two AGREE and React can hydrate rather than throwing a
   * mismatch and rebuilding the tree. See the comment in join/[code].tsx — it
   * mirrors the "Opening room…" shell /lobby and /game already use.
   */
  pending?: boolean;
};

/**
 * The single implementation behind both `/join` (type a code) and
 * `/join/<code>` (arrived from an invite link). Kept as one component on
 * purpose: two copies of a screen that claims the guest seat would drift, and
 * the invited path is the one nobody manually tests.
 *
 * On success we record the room for resume and replace into the lobby.
 */
export function JoinScreen({ initialCode, invited, notice, pending }: JoinScreenProps) {
  const router = useRouter();

  const playerName = useSettingsStore((s) => s.playerName);
  const setLastRoom = useSettingsStore((s) => s.setLastRoom);

  const [code, setCode] = useState(initialCode ?? '');
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

  // The neutral shell. Deliberately contains NO code-derived content: anything
  // that depends on the URL would differ between the build-time prerender (no
  // param) and the client (param present), which is the whole mismatch this
  // exists to avoid.
  if (pending) {
    return (
      <Screen center>
        <Text style={styles.title}>You’re invited</Text>
        <Text style={styles.subtitle}>Opening invite…</Text>
      </Screen>
    );
  }

  return (
    <Screen center>
      <Text style={styles.title}>{invited ? 'You’re invited' : 'Join a game'}</Text>
      <Text style={styles.subtitle}>
        {invited
          ? 'Tap Join to take the second seat'
          : 'Enter the 5-letter room code'}
      </Text>

      {notice && <Text style={styles.notice}>{notice}</Text>}

      {invited && (
        <View style={styles.inviteBanner}>
          <Text style={styles.inviteLabel}>Game</Text>
          <Text style={styles.inviteCode}>{code}</Text>
        </View>
      )}

      <View style={styles.codeArea}>
        <CodeInput
          value={code}
          onChangeText={(v) => {
            setCode(v);
            setError(null);
          }}
          onSubmit={handleJoin}
          // Don't steal focus (and pop the keyboard over the Join button) when
          // the code is already filled in from the link.
          autoFocus={!invited}
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
          // An invite link is usually a cold start with no history to pop —
          // `back()` would be a no-op and strand the player on this screen.
          /*
           * History-aware, not flag-aware. `router.back()` is a silent no-op on
           * an empty stack, and EVERY way into this screen can be a cold start:
           * a tapped invite link, the malformed-link fallback (which renders
           * without `invited`), and /join itself, which is a real exported
           * static route and so is bookmarkable. Asking the router whether it
           * can go back covers all three with one rule.
           */
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
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
  notice: {
    color: accent.warn,
    fontSize: 14,
    marginTop: -20,
    marginBottom: 24,
    textAlign: 'center',
    maxWidth: 340,
  },
  inviteBanner: {
    alignItems: 'center',
    marginTop: -16,
    marginBottom: 20,
  },
  inviteLabel: {
    color: text.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inviteCode: {
    color: accent.gold,
    fontSize: 22,
    fontWeight: '800',
    fontFamily: mono,
    letterSpacing: 4,
    marginTop: 2,
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
