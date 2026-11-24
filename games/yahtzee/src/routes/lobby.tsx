/**
 * The waiting room: who is here, the code to get here, and the host's Start
 * button.
 *
 * Two things on this screen are load-bearing:
 *
 * 1. THE SHARE CONTROL SHARES A LINK, NOT A CODE. The gin rummy app shares the
 *    bare five characters and makes the recipient open the site, find Join, and
 *    retype them. Sharing `<origin><base>join/<code>` means the recipient taps
 *    once and lands seated. The code stays on screen in large type as well,
 *    because it is still the thing you read down the phone to someone.
 *
 * 2. THE EMPTY STATE IS THREE DIFFERENT STATES. "Nothing has arrived yet" is
 *    ambiguous between "still loading", "no such room" and "we are offline", and
 *    those want three different actions from the player. Resolving them needs
 *    both a settle timer and the socket-health flag; see `settled` below.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useGameStore } from '@/store/gameStore';
import { useSettingsStore } from '@/store/settingsStore';
import { leaveRoom, seatOrder } from '@/net/rooms';
import { useAuth } from '@/net/auth';
import { RULES } from '@/engine';
import { sanitizeRoomCode } from '@/util/seed';
import './screen.css';
import './lobby.css';

/**
 * How long to wait before calling an empty room empty.
 *
 * Long enough to cover a cold RTDB socket on mobile data plus the anonymous
 * sign-in round-trip that has to finish before the room is even readable — both
 * of which routinely take two or three seconds on a train. Short enough that a
 * genuinely wrong code does not leave someone staring at a spinner. Shortening
 * this reintroduces "Room not found" flashing up for a room that then appears.
 */
const SETTLE_MS = 6000;

/** How long the "Copied" confirmation stays up. */
const COPIED_MS = 2200;

export function LobbyRoute() {
  const navigate = useNavigate();
  const params = useParams<{ code: string }>();
  const code = sanitizeRoomCode(params.code ?? '');

  /*
   * Mounting this is what starts anonymous sign-in for a player who deep-linked
   * straight here; without it the room reads as "not found" until something else
   * on the page happens to authenticate.
   *
   * The RETURNED uid is what gates the host-only Start control below. It used to
   * come from `getCurrentUid()` — a module variable read during render with no
   * subscription, which re-rendered only because this hook happened to be
   * mounted beside it for its side effect with its result thrown away. Anything
   * that pruned this "unused" call, or any change to the order auth resolves in,
   * would have left the host permanently unable to start and nothing on screen
   * to say why.
   */
  const { uid } = useAuth();

  // No bindRoom/unbindRoom here: RoomLayout in app.tsx owns the subscription for
  // this route and /game/:code alike, so it survives the handoff to the table
  // and is torn down by any exit from the subtree, not just the Leave button.
  const startGame = useGameStore((s) => s.startGame);
  const clearError = useGameStore((s) => s.clearError);
  const meta = useGameStore((s) => s.meta);
  const seats = useGameStore((s) => s.seats);
  const state = useGameStore((s) => s.state);
  const presence = useGameStore((s) => s.presence);
  const connected = useGameStore((s) => s.connected);
  const error = useGameStore((s) => s.error);

  const setLastRoom = useSettingsStore((s) => s.setLastRoom);

  const [settled, setSettled] = useState(false);
  const [copied, setCopied] = useState(false);
  // Set when the clipboard is unavailable or refuses, so the failure branch has
  // something to say instead of leaving a button that visibly does nothing.
  const [copyFailed, setCopyFailed] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    /*
     * RESET, don't just start. React Router reuses this element across
     * /lobby/A -> /lobby/B, so with `[]` deps the flag stayed latched at true
     * from room A while the rebind had just cleared `meta` to null for B —
     * rendering "Room not found" for a room whose first snapshot was still in
     * flight. Same latch, same cause, as the table's settle timer.
     */
    setSettled(false);
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [code]);

  // The moment a game exists, this screen has nothing left to say. `replace` so
  // Back from the table does not drop the player into a lobby for a room that is
  // already playing — which would immediately forward them here again.
  useEffect(() => {
    if (state && code) navigate(`/game/${code}`, { replace: true });
  }, [state, code, navigate]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const isHost = meta !== null && uid !== null && meta.host === uid;
  const order = meta ? seatOrder(seats, meta.host) : [];
  const canStart = isHost && order.length >= 2 && !starting;

  /*
   * The invite link. `import.meta.env.BASE_URL` is read by STATIC DOT NOTATION
   * because Vite performs a literal text substitution at build time — a computed
   * lookup like `import.meta.env[k]` works in dev and yields undefined in the
   * production bundle, which here would produce `https://mouro.ai/undefinedjoin/AB3CD`.
   * BASE_URL already carries its trailing slash ('/yahtzee/'), so no separator
   * goes between it and `join/`.
   */
  const inviteLink = `${window.location.origin}${import.meta.env.BASE_URL}join/${code}`;

  function handleLeave(): void {
    // Fire and forget the network side, but tear down and navigate regardless:
    // a player who pressed Leave has left, and blocking that on a round-trip
    // that may never complete (they may be leaving *because* they are offline)
    // strands them on this screen.
    void leaveRoom(code);
    setLastRoom(null);
    // Leaving this route unmounts RoomLayout, whose cleanup unbinds. Doing it
    // here as well would blank the store for the frame before the route changes.
    navigate('/', { replace: true });
  }

  async function handleShare(): Promise<void> {
    /*
     * The message carries the room code as TEXT as well as inside the link, and
     * ends with `@host #CODE` — the origin-bound one-time-code format.
     *
     * Both exist for the same recipient: someone on iOS who already has this
     * installed to their home screen. An installed web app cannot be opened from
     * a link on iOS at all (iOS hands every web link to Safari regardless of
     * scope), so a link-only invite is useless to them — they have to come in
     * through the code. That last line is what lets their phone offer the code
     * straight above the keyboard, turning "read five characters off a chat and
     * retype them" into one tap. `randomRoomCode` guarantees a digit because the
     * format requires one; CodeInput carries the matching
     * autocomplete="one-time-code".
     *
     * The host must be the origin the code gets typed into, so it is derived
     * from the invite link rather than written down a second time.
     */
    const shareHost = new URL(inviteLink).host;
    // Short on purpose: the link, then the one-time-code line. No separate
    // `url`: share targets that take both print the link twice.
    const payload = {
      title: 'Yahtzee',
      text: `Join my Yahtzee game: ${inviteLink}\n\n@${shareHost} #${code}`,
    };
    // Clear last attempt's failure up front, so a retry that works (or a share
    // sheet on a device that has one) does not leave the apology on screen.
    setCopyFailed(false);
    // navigator.share is the good path on a phone: it offers Messages, WhatsApp,
    // AirDrop. It is absent on every desktop browser except Safari, and it
    // REJECTS when the user dismisses the sheet — which is not an error and must
    // not fall through to silently copying instead.
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share(payload);
        return;
      } catch {
        // Dismissed, or the share sheet is unavailable in this context (an
        // iframe, an insecure origin). Fall through to the clipboard.
      }
    }
    /*
     * OPTIONAL CALL, not a bare `navigator.clipboard.writeText(...)`.
     *
     * The async clipboard API is absent entirely — `navigator.clipboard` is
     * undefined, so a property access on it is a TypeError, not a rejected
     * promise — on an insecure origin, inside a sandboxed iframe, and in older
     * browsers. On desktop Firefox and Chrome `navigator.share` is missing too,
     * so this is the WHOLE share path there and that TypeError was the entire
     * outcome of pressing the button.
     */
    // lib.dom types `navigator.clipboard` as always present, which is a lie in
    // every context listed above; widening it is what lets the guard compile.
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (!clipboard?.writeText) {
      setCopied(false);
      setCopyFailed(true);
      return;
    }
    try {
      await clipboard.writeText(inviteLink);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      // Also the refusal path: the clipboard needs a secure context and, in
      // Safari, a user gesture the browser still recognises after an `await`.
      // The link is rendered selectable below, so point at it — the previous
      // `setCopied(false)` here left the button looking broken.
      setCopied(false);
      setCopyFailed(true);
    }
  }

  // ── The three terminal empty states ──────────────────────────────────────
  //
  // Every one of them renders Leave, because this is a screen a player can
  // arrive at from a stale link with no other way out.

  if (!meta) {
    if (settled && connected) {
      return (
        <EmptyState
          title="Room not found"
          body={`No room is open with the code ${code || '(none)'}. Rooms are cleaned up a day after their last move, so ask whoever invited you for a fresh code — or start your own from the home screen.`}
          onLeave={handleLeave}
        />
      );
    }
    if (settled && !connected) {
      return (
        <EmptyState
          title="Couldn't connect"
          body="We can't reach the game server, so we can't tell whether this room exists. Check your connection — the room is still there and this screen will fill in on its own once you're back."
          onLeave={handleLeave}
          spinner
        />
      );
    }
    return (
      <EmptyState
        title="Opening room…"
        body={`Looking for room ${code}.`}
        onLeave={handleLeave}
        spinner
      />
    );
  }

  return (
    <main className="screen">
      <div className="screen__inner lobby">
        <h1 className="screen__title">Waiting room</h1>

        <section className="panel lobby__code-panel">
          <p className="field__label">Room code</p>
          <p className="lobby__code code-text selectable">{code}</p>
          <div className="row row--wrap">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => void handleShare()}
            >
              Share invite link
            </button>
            {copied && (
              <span className="lobby__copied" role="status">
                Copied
              </span>
            )}
          </div>
          {/* The failure branch's actual UI. Without this the button silently
              did nothing on every browser with no clipboard API — which on
              desktop Firefox and Chrome, where navigator.share is also absent,
              is the only share path there is. It points at the link below,
              which is rendered `selectable` precisely so it can be copied by
              hand. `role="status"` so it is announced, not just drawn. */}
          {copyFailed && (
            <p className="lobby__copy-failed" role="status">
              This browser wouldn&apos;t let us copy for you. Select the link below and copy it
              yourself.
            </p>
          )}
          <p className="field__hint selectable">{inviteLink}</p>
        </section>

        <section className="panel">
          <h2 className="panel__heading">
            Players ({order.length}/{RULES.MAX_PLAYERS})
          </h2>
          <ul className="lobby__seats">
            {order.map((seatUid, seat) => {
              // Presence is written by a sibling node and arrives on its own
              // schedule, so a seat with no presence entry yet is treated as
              // online — showing a fresh joiner as offline for two seconds is a
              // worse lie than the reverse.
              const entry = presence[seatUid];
              const online = entry ? entry.online : true;
              return (
                <li key={seatUid} className="lobby__seat">
                  <span
                    className="lobby__dot"
                    data-online={online ? 'true' : 'false'}
                    aria-hidden="true"
                  />
                  <span className="lobby__seat-name">{seats[seatUid]?.name ?? 'Player'}</span>
                  <span className="lobby__seat-tags">
                    {seatUid === meta.host && <span className="lobby__tag">Host</span>}
                    {seatUid === uid && <span className="lobby__tag">You</span>}
                    {!online && <span className="lobby__tag lobby__tag--away">Away</span>}
                  </span>
                  <span className="visually-hidden">{`seat ${seat + 1}`}</span>
                </li>
              );
            })}
          </ul>
        </section>

        {isHost ? (
          <div className="stack">
            <button
              type="button"
              className="btn btn--primary btn--block"
              disabled={!canStart}
              onClick={() => {
                setStarting(true);
                // startGame writes its own failure into the store's `error`,
                // which is rendered below; the flag only guards a double-tap
                // dealing over a game that is mid-deal.
                void startGame().finally(() => setStarting(false));
              }}
            >
              {starting ? 'Dealing…' : 'Start game'}
            </button>
            {order.length < 2 && (
              <p className="field__hint">
                Waiting for someone else to join. Playing on your own? Go back and use{' '}
                <strong>Pass and play</strong> instead — it seats up to {RULES.MAX_PLAYERS}{' '}
                players on this one device, with no room and no connection needed.
              </p>
            )}
          </div>
        ) : (
          <p className="notice row">
            <span className="spinner" aria-hidden="true" />
            <span>Waiting for the host to start.</span>
          </p>
        )}

        {error && (
          <div className="notice notice--bad">
            <p>{error}</p>
            <div className="notice__actions">
              <button type="button" className="btn btn--ghost btn--small" onClick={clearError}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          className="btn btn--ghost btn--block"
          onClick={handleLeave}
        >
          Leave room
        </button>
      </div>
    </main>
  );
}

/** The shared shape of all three "there is no room here" renders. */
function EmptyState(props: {
  title: string;
  body: string;
  onLeave: () => void;
  spinner?: boolean;
}) {
  return (
    <main className="screen screen--centred">
      <div className="screen__inner lobby lobby--empty">
        <h1 className="screen__title">{props.title}</h1>
        <p className="screen__subtitle">{props.body}</p>
        {props.spinner && <span className="spinner lobby__spinner" aria-hidden="true" />}
        <button type="button" className="btn btn--ghost btn--block" onClick={props.onLeave}>
          Leave
        </button>
      </div>
    </main>
  );
}

export default LobbyRoute;
