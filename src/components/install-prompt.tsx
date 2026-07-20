/**
 * "Add this to your home screen."
 *
 * WHY THIS IS NOT JUST A CONVENIENCE BANNER.
 *
 * A player's identity here is an anonymous Firebase uid, and the Firebase JS
 * SDK persists that uid in localStorage. iOS Safari runs a seven-day cap on
 * script-writable storage: for a site you have NOT added to the home screen,
 * localStorage (and IndexedDB, and the rest) is evicted after roughly seven
 * days without a visit. When that happens the player comes back as a brand new
 * anonymous user — a different uid, which means a different seat. They lose
 * their place in any room in progress and their name and preferences with it,
 * with no error and nothing to recover from.
 *
 * Home-screen web apps are exempt from that cap. So installing is the only
 * thing that makes an anonymous identity durable on iOS, and this banner is
 * the only place we can ask. (There is deliberately no service worker in this
 * app — see AGENTS.md — which does not affect installability.)
 *
 * Two entirely separate mechanisms, because the platforms are different:
 *   - Chrome/Edge/Android fire `beforeinstallprompt`, which we capture and
 *     replay from a button. One real tap, done.
 *   - iOS Safari has no such event and no programmatic install at all. The
 *     only thing we can do is detect iOS + not-installed and show the manual
 *     Share -> Add to Home Screen instructions.
 */

import { useEffect, useState } from 'react';
import './install-prompt.css';

/**
 * Not in lib.dom yet (it is a Chromium extension to the spec), so it is
 * declared here rather than reached for with `any`.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Dismissal persists so the banner does not nag on every visit. The irony is
 * noted: on the very platform this matters most, this key is itself subject to
 * the seven-day eviction — which means a long-absent iOS user gets asked again,
 * exactly when asking is most useful.
 */
const DISMISSED_KEY = 'yahtzee-install-dismissed';

function isDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    // Safari private mode throws on localStorage access rather than returning
    // null. A throw here must not take the whole app down.
    return false;
  }
}

function rememberDismissal(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // Nothing to do — worst case the banner reappears next visit.
  }
}

/** Already launched from the home screen / installed. Nothing to offer. */
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari never implemented `display-mode: standalone` for home-screen web
  // apps in older versions; it exposes this non-standard flag instead.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  // iPadOS 13+ reports a desktop Mac user agent. The touch-point count is the
  // standard way to tell a real Mac (0) from an iPad pretending to be one.
  return /macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

export interface InstallPromptProps {
  /** Fired after the player dismisses, in case the caller wants to log it. */
  onDismiss?: () => void;
}

export function InstallPrompt({ onDismiss }: InstallPromptProps) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(isDismissed);

  useEffect(() => {
    if (isStandalone()) return;

    function onBeforeInstall(e: Event) {
      // Chrome shows its own mini-infobar unless the event is cancelled. We
      // cancel it and hold the event so the install happens from OUR button,
      // at a moment that makes sense (after a game, not mid-turn).
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    }

    function onInstalled() {
      // Installed by any route (our button, the browser menu). Stop offering.
      setDeferred(null);
      setShowIosHint(false);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    // iOS never fires `beforeinstallprompt`, so nothing above will ever run
    // there — the manual hint is decided synchronously instead.
    if (isIos()) setShowIosHint(true);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  function dismiss() {
    rememberDismissal();
    setDismissed(true);
    onDismiss?.();
  }

  async function install() {
    if (!deferred) return;
    // A deferred prompt is single-use: Chrome will not let the same event be
    // shown twice, so clear it whatever the player chooses.
    setDeferred(null);
    try {
      await deferred.prompt();
    } catch {
      // The player closed it, or the browser refused. Nothing to report.
    }
  }

  if (dismissed) return null;
  if (!deferred && !showIosHint) return null;

  return (
    <aside className="install" aria-label="Install this app">
      <div className="install__body">
        <p className="install__title">Add Yahtzee to your home screen</p>
        <p className="install__text">
          {deferred
            ? 'It opens full screen, and it keeps you signed in to your games on this device.'
            : 'Tap the Share button, then “Add to Home Screen”. iPhone forgets who you are after about a week on a site that is not installed — installing keeps your games and your name.'}
        </p>
      </div>

      <div className="install__actions">
        {deferred ? (
          <button type="button" className="install__go" onClick={install}>
            Install
          </button>
        ) : null}
        <button type="button" className="install__dismiss" onClick={dismiss}>
          Not now
        </button>
      </div>
    </aside>
  );
}

export default InstallPrompt;
