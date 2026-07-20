import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { JoinScreen } from '@/components/join-screen';
import { CODE_LENGTH, sanitizeCode } from '@/components/ui/code-input';

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
  useEffect(() => setHydrated(true), []);

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
