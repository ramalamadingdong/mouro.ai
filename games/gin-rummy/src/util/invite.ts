import { Platform } from 'react-native';

/**
 * The sub-path the web build is served under.
 *
 * MUST stay in step with `expo.experiments.baseUrl` in app.json. There is no
 * import that can derive one from the other (app.json is plain JSON consumed by
 * the Expo CLI at build time, and `process.env.EXPO_BASE_URL` only exists in the
 * web bundle — it is undefined on native, which is exactly where we need this
 * constant most). So the coupling is manual: change one, change the other. It is
 * also called out in the README's invite-link section.
 */
export const WEB_BASE_PATH = '/gin-rummy';

/** Where the PWA lives publicly — the fallback origin for native shares. */
export const SITE_ORIGIN = 'https://mouro.ai';

/**
 * An absolute https URL that opens the join screen with `code` prefilled.
 *
 * Deliberately NOT a `ginrummy://` deep link, even though the recipient USUALLY
 * DOES have the app — a scheme link would only help a device with a native build
 * registered for it, and there is no native build (Expo Go only, see AGENTS.md).
 * What people actually have installed is the PWA, and for that an https URL is
 * strictly better in every case:
 *   - Android / desktop Chrome: an in-scope https link is captured INTO the
 *     installed PWA (see the `handle_links` member in public/manifest.json).
 *   - iOS: nothing can open an installed home-screen web app from a link —
 *     deep-linking into one is not possible, and iOS hands every web link to
 *     Safari regardless of scope. A scheme link would not have helped either.
 *     That is what `inviteMessage` below is designed around.
 *   - No app at all: it just works in the browser.
 */
export function inviteUrl(code: string): string {
  // On web, prefer the live origin so a share from `localhost:8081` or a LAN IP
  // during development produces a link that actually resolves for the tester,
  // instead of silently pointing at production.
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
    return `${window.location.origin}${WEB_BASE_PATH}/join/${code}`;
  }
  // Native (Expo Go): there is no `window`, so the public site is the only
  // origin we can name.
  return `${SITE_ORIGIN}${WEB_BASE_PATH}/join/${code}`;
}

/**
 * The share body.
 *
 * Three things are in here on purpose.
 *
 * 1. THE URL IS INLINE IN THE TEXT, and it is the ONLY copy of it: the
 *    lobby shares this text with no separate `url`. Android's share intent
 *    ignores React Native's `url` field entirely, so the link has to be in the
 *    body; and share targets that take both print the link twice.
 *
 * 2. THE CODE IS READABLE AS TEXT, not just encoded in the URL — the last
 *    line below spells it out. On iOS an installed PWA cannot be opened from a
 *    link at all, so a link-only invite is no use to the most common
 *    recipient: someone who already has the app on their home screen. They can
 *    copy the invite and tap Join copied invite in the app (util/app-hop.ts),
 *    or open the app and type five characters.
 *
 * 3. THE LAST LINE IS `@host #CODE` — the origin-bound one-time-code format.
 *    It is what lets the phone offer the code straight above the keyboard
 *    instead of making the recipient memorise it, turning (2) from "read it and
 *    retype it" into one tap. It also makes the code auto-readable by Chrome's
 *    WebOTP API on Android. The format requires a 4-10 character alphanumeric
 *    code containing at least one digit, which is exactly why `randomRoomCode`
 *    guarantees a digit. The host in the line MUST be the origin serving the
 *    app, or the OS treats the code as belonging to a different site and
 *    ignores it.
 *
 * That trailing line is machine-facing and looks slightly odd in a chat. It
 * earns its place: without it the autofill is heuristic at best.
 */
export function inviteMessage(code: string): string {
  const url = inviteUrl(code);
  // The `@host` must match the origin the code will be typed into, so derive it
  // from the very URL we are sharing rather than hardcoding it twice.
  const host = url.replace(/^https?:\/\//, '').split('/')[0];
  return `Join my gin rummy game: ${url}\n\n@${host} #${code}`;
}
