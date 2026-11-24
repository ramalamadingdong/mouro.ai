import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { JoinScreen } from '@/components/join-screen';
import { Button } from '@/components/ui/button';
import { CODE_LENGTH, sanitizeCode } from '@/components/ui/code-input';
import { Screen } from '@/components/ui/screen';
import { accent, text } from '@/theme/colors';
import { isIosBrowserTab, prefersPlayingHere, rememberPlayingHere } from '@/util/app-hop';

/**
 * `/join/<code>` — the landing route for an invite link (see
 * `@/util/invite`). The code arrives prefilled; the player still taps Join.
 *
 * We deliberately DO NOT auto-join on mount:
 *
 *  1. Link-preview crawlers in iMessage / WhatsApp / Slack fetch — and in some
 *     cases execute — a shared URL to build the preview card. An auto-join would
 *     let a preview bot claim the guest seat before the human ever tapped, and
 *     in a strictly 2-player room that permanently locks the room the host just
 *     created.
 *  2. The joiner may want to set their name first; joining writes it to the room
 *     immediately, so a silent join would seat them as "Player".
 */
export default function InvitedJoinRoute() {
  const params = useLocalSearchParams<{ code: string | string[] }>();
  const raw = Array.isArray(params.code) ? params.code[0] : params.code;

  /*
   * HOLD THE FIRST PAINT UNTIL AFTER MOUNT.
   *
   * `output: "static"` prerenders this route at BUILD time, when there is no
   * code in the URL — so the prerendered HTML is whatever this component
   * renders for an absent param. The browser then hydrates that HTML with a
   * client render that DOES have the code. Any disagreement between the two is
   * a hydration mismatch: React throws #418, discards the server markup and
   * re-renders the whole tree.
   *
   * Rendering the same neutral shell on the server AND on the client's first
   * pass makes them agree; the real screen arrives on the next tick, once the
   * effect has run. This is exactly how the /lobby and /game routes already
   * behave — they prerender "Opening room…" and fill in when data lands — and
   * matching them is what keeps deep links from flashing the wrong screen.
   */
  const [hydrated, setHydrated] = useState(false);

  /*
   * iPhone: an invite link always lands in a Safari tab, even when the player
   * has the app on their home screen (see util/app-hop.ts). Before the join
   * screen, which would seat a Safari identity the app does not share, offer
   * to copy the invite for the app. Asked once: "Play here" is remembered.
   *
   * Decided in the same effect that ends the pending shell, never during
   * render: the prerender has no `navigator`, so reading it there would be the
   * very hydration mismatch the shell exists to avoid. Both updates land in one
   * render, so the join screen never flashes up first.
   */
  const [hop, setHop] = useState(false);
  const [hopCopy, setHopCopy] = useState<'copied' | 'failed' | null>(null);

  useEffect(() => {
    setHop(isIosBrowserTab() && !prefersPlayingHere());
    setHydrated(true);
  }, []);

  // Same alphabet/length rules the keyboard path uses — a code copied out of a
  // chat app can arrive lowercase or with trailing punctuation.
  const code = sanitizeCode(raw ?? '');
  const valid = code.length === CODE_LENGTH;

  /*
   * The `key` is load-bearing, and its absence cost a silently broken feature:
   * the invite screen rendered perfectly and the five code boxes were EMPTY.
   *
   * JoinScreen seeds its editable code with `useState(initialCode ?? '')`, and
   * useState initialises ONCE — on mount. The pending shell and the real screen
   * are the same component type at the same position, so React reconciles them
   * instead of remounting, the state keeps the '' it was seeded with while
   * pending, and the prefilled code is dropped on the floor. Changing the key
   * forces a genuine remount, so the real screen seeds from the real code.
   */
  if (!hydrated) return <JoinScreen key="pending" invited pending />;

  if (hop && valid) {
    const copyForApp = async (): Promise<void> => {
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
      try {
        if (!clipboard?.writeText) throw new Error('no clipboard');
        await clipboard.writeText(window.location.href);
        setHopCopy('copied');
      } catch {
        setHopCopy('failed');
      }
    };

    return (
      <Screen center>
        <Text style={styles.title}>Join room {code}</Text>
        <Text style={styles.subtitle}>
          Playing in the Gin Rummy app on your home screen? Copy the invite, open the app, and tap
          Join copied invite.
        </Text>
        <Button
          title="Copy invite for the app"
          onPress={() => void copyForApp()}
          style={styles.action}
        />
        {hopCopy === 'copied' && (
          <Text style={styles.status} accessibilityLiveRegion="polite">
            Copied. Now open Gin Rummy from your home screen.
          </Text>
        )}
        {hopCopy === 'failed' && (
          <Text style={[styles.status, styles.statusBad]} accessibilityLiveRegion="polite">
            Couldn’t copy. In the app, tap Join game and enter {code}.
          </Text>
        )}
        <Button
          title="Play here in Safari"
          variant="secondary"
          onPress={() => {
            rememberPlayingHere();
            setHop(false);
          }}
          style={styles.action}
        />
      </Screen>
    );
  }

  // A malformed link is a bad link, not a crash: fall back to manual entry and
  // say why, so the player can still type the code their friend read out.
  return valid ? (
    <JoinScreen key="ready" initialCode={code} invited />
  ) : (
    <JoinScreen
      key="ready"
      notice="That invite link didn’t contain a valid room code — enter it below."
    />
  );
}

// Matches JoinScreen's title and subtitle, so the hop reads as the same screen.
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
    marginBottom: 20,
    textAlign: 'center',
    maxWidth: 340,
  },
  action: { marginTop: 12, width: '100%', maxWidth: 340 },
  status: {
    color: text.hint,
    fontSize: 14,
    marginTop: 12,
    textAlign: 'center',
    maxWidth: 340,
  },
  statusBad: { color: accent.bad },
});
