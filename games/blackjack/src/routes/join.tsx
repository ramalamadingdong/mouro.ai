/**
 * Joining a room, from either direction:
 *
 *   /join         — the player types a code they were read out loud.
 *   /join/AB3CD   — the player tapped an invite link. The code is prefilled and
 *                   the join fires on its own as soon as anonymous auth lands.
 *
 * The auto-join is the whole point of sharing a link instead of a bare code: the
 * recipient's next interaction after tapping should be looking at the lobby, not
 * re-typing five characters that are already in the URL bar.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { isOnlineConfigured } from '@/net/config';
import { retryAuth, useAuth } from '@/net/auth';
import { joinRoom } from '@/net/rooms';
import { useSettingsStore } from '@/store/settingsStore';
import { isRoomCode, sanitizeRoomCode, CODE_LENGTH } from '@/util/seed';
import { CodeInput } from '@/components/code-input';
import { isIosBrowserTab, prefersPlayingHere, rememberPlayingHere } from '@/util/app-hop';
import { NearbyRooms } from '@/components/nearby-rooms';
import './screen.css';
import './join.css';

export function JoinRoute() {
  const navigate = useNavigate();
  const params = useParams<{ code?: string }>();
  // Set when a tap inside the game sent us here ("On your Wi-Fi"), as opposed
  // to an invite link opened from a message: no app-hop question then.
  const fromInside = (useLocation().state as { inside?: boolean } | null)?.inside === true;

  const playerName = useSettingsStore((s) => s.playerName);
  const setPlayerName = useSettingsStore((s) => s.setPlayerName);
  const setLastRoom = useSettingsStore((s) => s.setLastRoom);

  const { uid, error: authError } = useAuth();

  // The URL param goes through the same sanitizer as typed input, because a link
  // can be pasted with a trailing slash, in lowercase, or with the code as the
  // tail of a longer path.
  const linkCode = params.code ? sanitizeRoomCode(params.code) : '';

  const [code, setCode] = useState(linkCode);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * The auto-join must fire exactly once per mount. A ref rather than state
   * because flipping state would re-render, and the effect below depends on
   * values (`uid`, `joining`) that change during the attempt — a state latch
   * would race with its own re-render and could fire the join twice, seating the
   * player and then immediately failing the second attempt with a confusing
   * "that game has already started".
   */
  const autoJoined = useRef(false);

  /*
   * iPhone: an invite link always lands in a Safari tab, even when the player
   * has the app on their home screen (see util/app-hop.ts). Before joining
   * here, which would seat a Safari identity the app does not share, offer to
   * copy the invite for the app. Asked once: "Play here" is remembered.
   */
  const [hop, setHop] = useState(() => isRoomCode(linkCode) && !fromInside && isIosBrowserTab() && !prefersPlayingHere());
  const [hopCopy, setHopCopy] = useState<'copied' | 'failed' | null>(null);

  async function copyForApp(): Promise<void> {
    const clipboard = navigator.clipboard as Clipboard | undefined;
    try {
      if (!clipboard?.writeText) throw new Error('no clipboard');
      await clipboard.writeText(window.location.href);
      setHopCopy('copied');
    } catch {
      setHopCopy('failed');
    }
  }

  const join = useCallback(
    async (raw: string): Promise<void> => {
      const wanted = sanitizeRoomCode(raw);
      if (!isRoomCode(wanted)) {
        setError(`Room codes are ${CODE_LENGTH} characters — letters and digits. Check the code with whoever invited you.`);
        return;
      }
      setJoining(true);
      setError(null);
      try {
        await joinRoom(wanted, playerName);
        // Recorded before navigating so a reload on the lobby screen can still
        // offer the room back from the home screen.
        setLastRoom({ code: wanted, role: 'guest' });
        // `replace`: pressing Back from the lobby should go home, not to a join
        // form that would immediately re-join the room we are already in.
        navigate(`/lobby/${wanted}`, { replace: true });
      } catch (err) {
        // joinRoom throws prose that already distinguishes "not found" from
        // "already started" from "full". Never replace it with a generic string.
        setError(err instanceof Error ? err.message : 'Could not join that room. Try again.');
      } finally {
        setJoining(false);
      }
    },
    [navigate, playerName, setLastRoom],
  );

  useEffect(() => {
    if (autoJoined.current) return;
    if (hop) return;
    if (!isRoomCode(linkCode)) return;
    // A join is a write, and a write needs an identity. Waiting for `uid`
    // rather than calling ensureAnonymousAuth here keeps the single-flight
    // sign-in in one place (useAuth already kicked it off).
    if (!uid) return;
    autoJoined.current = true;
    void join(linkCode);
  }, [linkCode, uid, join, hop]);

  const connecting = isOnlineConfigured && uid === null && !authError;
  const ready = isOnlineConfigured && uid !== null;
  const canSubmit = ready && !joining && isRoomCode(sanitizeRoomCode(code));

  if (hop) {
    return (
      <main className="screen screen--centred">
        <div className="screen__inner join">
          <h1 className="screen__title">Join room {linkCode}</h1>
          <p className="screen__subtitle">
            Playing in the Blackjack app on your home screen? Copy the invite, open the app, and tap
            Join copied invite.
          </p>
          <button type="button" className="btn btn--primary btn--block" onClick={() => void copyForApp()}>
            Copy invite for the app
          </button>
          {hopCopy === 'copied' && (
            <p className="notice" role="status">
              Copied. Now open Blackjack from your home screen.
            </p>
          )}
          {hopCopy === 'failed' && (
            <p className="notice notice--bad" role="status">
              Couldn&apos;t copy. In the app, tap Join with a code and enter {linkCode}.
            </p>
          )}
          <button
            type="button"
            className="btn btn--secondary btn--block"
            onClick={() => {
              rememberPlayingHere();
              setHop(false);
            }}
          >
            Play here in Safari
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="screen screen--centred">
      <div className="screen__inner join">
        <h1 className="screen__title">Join a game</h1>
        <p className="screen__subtitle">
          Enter the {CODE_LENGTH}-character code from whoever set up the room.
        </p>

        {!linkCode && <NearbyRooms enabled={ready && !joining} onJoin={(c) => void join(c)} />}

        <form
          className="join__form"
          onSubmit={(e) => {
            // A real <form> so the on-screen keyboard shows a Go key and Enter
            // submits; preventDefault stops the full-page navigation that would
            // otherwise blow away the SPA.
            e.preventDefault();
            if (canSubmit) void join(code);
          }}
        >
          {/* CodeInput sanitizes on every keystroke, fires `onSubmit` the moment
              the fifth character lands, and renders `error` under the boxes —
              so a failed join is reported next to the field that caused it
              rather than in a panel further down the page.

              No `autoFocus` on the invite-link path: that screen auto-joins and
              is on its way out, and popping the on-screen keyboard for a field
              nobody will type in shoves the content off a phone display. */}
          <CodeInput
            value={code}
            onChange={setCode}
            onSubmit={(v) => {
              if (ready && !joining) void join(v);
            }}
            error={error}
            disabled={joining}
            autoFocus={linkCode.length === 0}
          />

          <div className="field">
            <label className="field__label" htmlFor="join-name">
              Your name
            </label>
            <input
              id="join-name"
              className="field__input"
              type="text"
              value={playerName}
              maxLength={24}
              placeholder="Who's playing?"
              autoComplete="nickname"
              onChange={(e) => setPlayerName(e.target.value)}
            />
          </div>

          <button type="submit" className="btn btn--primary btn--block" disabled={!canSubmit}>
            {joining ? 'Joining…' : 'Join game'}
          </button>
        </form>

        {connecting && (
          <div className="notice row">
            <span className="spinner" aria-hidden="true" />
            <span>Connecting…</span>
          </div>
        )}

        {!isOnlineConfigured && (
          <p className="notice">
            Online play is not available in this build, so there is no room to join.{' '}
            <strong>Playing the cats</strong> from the home screen works without a connection.
          </p>
        )}

        {isOnlineConfigured && authError && (
          <div className="notice notice--bad">
            <p>{authError}</p>
            <div className="notice__actions">
              <button type="button" className="btn btn--secondary btn--small" onClick={retryAuth}>
                Try again
              </button>
            </div>
          </div>
        )}

        {/* The join error is deliberately NOT repeated here: CodeInput renders
            it directly under the boxes, and the same sentence in two places
            reads as two separate problems. */}

        <button type="button" className="btn btn--ghost btn--block" onClick={() => navigate('/')}>
          Back
        </button>
      </div>
    </main>
  );
}

export default JoinRoute;
