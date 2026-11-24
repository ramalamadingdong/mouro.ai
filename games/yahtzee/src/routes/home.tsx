/**
 * The front door. Three ways in: host a room, join one, or pass one phone
 * around the table.
 *
 * THE ONE RULE THIS SCREEN ENFORCES: pass-and-play is never gated. Hosting and
 * joining need Firebase config AND a resolved anonymous uid, and both are
 * disabled until they have them. Pass-and-play touches no network at all
 * (localStore imports nothing from `@/fb`, not even transitively), so it must
 * stay playable on a fresh clone with no `.env` and on a phone with no signal.
 * Disabling all three buttons behind one "connecting…" check is the easy bug
 * here, and it makes the app look broken when it is merely offline.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isOnlineConfigured } from '@/net/config';
import { retryAuth, useAuth } from '@/net/auth';
import { createRoom } from '@/net/rooms';
import { useSettingsStore } from '@/store/settingsStore';
import { InstallPrompt } from '@/components/install-prompt';
import { isInstalledApp } from '@/util/app-hop';
import { NearbyRooms } from '@/components/nearby-rooms';
import { CODE_LENGTH, extractRoomCode } from '@/util/seed';
import './screen.css';
import './home.css';

/** Matches the `seats/$uid/name` validate rule in database.rules.json. */
const MAX_NAME_LENGTH = 24;

export function HomeRoute() {
  const navigate = useNavigate();
  // The installed app's half of the iPhone invite hop (util/app-hop.ts): the
  // Safari tab copied the invite, this reads it back and joins.
  const installed = isInstalledApp();
  const [pasteNote, setPasteNote] = useState<string | null>(null);

  async function joinCopiedInvite(): Promise<void> {
    try {
      const code = extractRoomCode(await navigator.clipboard.readText());
      if (code.length === CODE_LENGTH) {
        navigate(`/join/${code}`);
        return;
      }
      setPasteNote('No invite on the clipboard. Copy the invite link, then tap again.');
    } catch {
      setPasteNote('Couldn’t read the clipboard. Tap Join with a code and paste it there.');
    }
  }

  const playerName = useSettingsStore((s) => s.playerName);
  const setPlayerName = useSettingsStore((s) => s.setPlayerName);
  const lastRoom = useSettingsStore((s) => s.lastRoom);
  const setLastRoom = useSettingsStore((s) => s.setLastRoom);

  const { uid, error: authError } = useAuth();

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Online is available only when we have both a project to talk to and an
  // identity to talk as. `uid === null` covers the cold-start window before the
  // persisted anonymous session is restored, which is under a second but is
  // exactly when an impatient player taps Create.
  const onlineReady = isOnlineConfigured && uid !== null;
  // "Still trying" is distinct from "failed": one shows a spinner, the other
  // shows prose and a Retry. Without the `!authError` term a failed sign-in
  // would spin forever.
  const connecting = isOnlineConfigured && uid === null && !authError;

  async function handleCreate(): Promise<void> {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const code = await createRoom(playerName);
      // Persisted BEFORE navigating: if the lobby screen is closed or reloaded
      // before it renders, the home screen can still offer the room back.
      setLastRoom({ code, role: 'host' });
      navigate(`/lobby/${code}`);
    } catch (err) {
      // createRoom already throws prose naming the next step (deploy the rules,
      // enable Anonymous sign-in, check your connection). Show it verbatim.
      setCreateError(err instanceof Error ? err.message : 'Could not create a room. Try again.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="screen screen--centred">
      <div className="screen__inner home">
        <header className="home__header">
          <h1 className="home__wordmark">Yahtzee</h1>
          <p className="screen__subtitle">
            Five dice, thirteen boxes, no sign-up. Play with friends on their own phones, or
            pass one around the table.
          </p>
        </header>

        <div className="field">
          <label className="field__label" htmlFor="player-name">
            Your name
          </label>
          <input
            id="player-name"
            className="field__input"
            type="text"
            value={playerName}
            maxLength={MAX_NAME_LENGTH}
            placeholder="Who's playing?"
            autoComplete="nickname"
            // Persist on every keystroke rather than on blur: on iOS, closing a
            // tab from the app switcher never fires blur, and the name would be
            // lost by the player who most needs it remembered.
            onChange={(e) => setPlayerName(e.target.value)}
          />
          <p className="field__hint">
            Shown to the other players. You can leave it blank and be “Player”.
          </p>
        </div>

        {/* Resume comes FIRST, above the primary actions: someone who reloaded
            mid-game is here to get back to that game, not to start another. */}
        {lastRoom && (
          <div className="notice home__resume">
            <div className="row row--spread row--wrap">
              <span>
                {lastRoom.role === 'host' ? 'You hosted room ' : 'You joined room '}
                <strong className="code-text">{lastRoom.code}</strong>
              </span>
            </div>
            <div className="notice__actions">
              <button
                type="button"
                className="btn btn--secondary btn--small"
                disabled={!onlineReady}
                // Always the lobby, for host and guest alike. The lobby forwards
                // to /game as soon as a dealt state appears, so it is the single
                // correct entry point whether or not play has started — and it
                // is the only screen that can explain a room that has vanished.
                onClick={() => navigate(`/lobby/${lastRoom.code}`)}
              >
                Resume game
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                // Dismiss CLEARS the stored room rather than hiding the row for
                // this render. A row that reappears on the next reload after
                // being dismissed is the more annoying of the two behaviours,
                // and the room code is still recoverable from the invite link.
                onClick={() => setLastRoom(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <NearbyRooms enabled={onlineReady} onJoin={(code) => navigate(`/join/${code}`, { state: { inside: true } })} />

        <div className="stack home__actions">
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={!onlineReady || creating}
            onClick={() => void handleCreate()}
          >
            {creating ? 'Creating room…' : 'Create game'}
          </button>

          {installed && (
            <button
              type="button"
              className="btn btn--secondary btn--block"
              disabled={!onlineReady}
              onClick={() => void joinCopiedInvite()}
            >
              Join copied invite
            </button>
          )}
          <button
            type="button"
            className="btn btn--secondary btn--block"
            disabled={!onlineReady}
            onClick={() => navigate('/join')}
          >
            Join with a code
          </button>
          {pasteNote && (
            <p className="notice" role="status">
              {pasteNote}
            </p>
          )}

          {/* NOT gated. See the header comment. */}
          <button
            type="button"
            className="btn btn--secondary btn--block"
            onClick={() => navigate('/local')}
          >
            Pass and play
          </button>
        </div>

        {connecting && (
          <div className="notice row">
            <span className="spinner" aria-hidden="true" />
            <span>Connecting…</span>
          </div>
        )}

        {!isOnlineConfigured && (
          <p className="notice">
            Online play is not available in this build — it ships without a Firebase project,
            so there is no server to host a room on. <strong>Pass and play</strong> works
            fully: it runs entirely on this device.
          </p>
        )}

        {/* Only when Firebase IS configured: otherwise auth reports the missing
            config as an error too, and the player would read two paragraphs
            saying the same thing, one of them with a Retry that cannot help. */}
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

        {createError && (
          <div className="notice notice--bad">
            <p>{createError}</p>
            <div className="notice__actions">
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => setCreateError(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/*
          Suppressed while a game is resumable, and the reason is not cosmetic:
          on iOS a home-screen web app gets its OWN storage, separate from
          Safari. Installing therefore starts the player over with a fresh
          anonymous uid — so anyone who accepts this prompt mid-game silently
          loses the seat they are holding, and `lastRoom` points at a room they
          can no longer act in. Offering "install" and "resume" side by side is
          offering to destroy the thing next to it.

          Safe to gate on, because lastRoom is cleared on leaving the lobby, on
          leaving the game, and on dismissing the resume card — so the prompt
          reappears as soon as there is nothing to lose.
        */}
        {!lastRoom && <InstallPrompt />}
      </div>
    </main>
  );
}

export default HomeRoute;
