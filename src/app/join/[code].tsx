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

  // Same alphabet/length rules the keyboard path uses — a code copied out of a
  // chat app can arrive lowercase or with trailing punctuation.
  const code = sanitizeCode(raw ?? '');
  const valid = code.length === CODE_LENGTH;

  // A malformed link is a bad link, not a crash: fall back to manual entry and
  // say why, so the player can still type the code their friend read out.
  return valid ? (
    <JoinScreen initialCode={code} invited />
  ) : (
    <JoinScreen notice="That invite link didn’t contain a valid room code — enter it below." />
  );
}
