/**
 * Getting from an invite link into the home-screen app on iPhone.
 *
 * iOS never opens a link in an installed web app: every link goes to a Safari
 * tab, and Safari and the home-screen app do not share storage. The clipboard
 * is the one thing both can reach, so the hop is: the Safari tab copies the
 * invite (one tap, which iOS requires for a clipboard write), the player opens
 * the app, and the app's home screen reads it back (one tap, which iOS
 * requires for a clipboard read) and joins. Android and desktop Chrome open
 * invite links in the installed app themselves (`handle_links` in the
 * manifest), so none of this shows there.
 */

/** True in an iPhone or iPad browser tab, not the installed home-screen app. */
export function isIosBrowserTab(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ios =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac; a touch screen gives it away.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && !isInstalledApp();
}

/** True when running as the installed app rather than in a browser tab. */
export function isInstalledApp(): boolean {
  if (typeof window === 'undefined') return false;
  const legacy = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return legacy || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

// Per-browser memory of "I play in Safari", so that choice is asked once.
const PLAY_HERE_KEY = 'invite-play-here';

export function prefersPlayingHere(): boolean {
  try {
    return localStorage.getItem(PLAY_HERE_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberPlayingHere(): void {
  try {
    localStorage.setItem(PLAY_HERE_KEY, '1');
  } catch {
    // Private mode or storage blocked: they will be asked again next time.
  }
}
