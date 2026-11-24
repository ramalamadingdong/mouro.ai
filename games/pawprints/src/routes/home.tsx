/**
 * The front door: your name, then a choice of game — the cats on this
 * device, or an online room with friends.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { retryAuth, useAuth } from '@/net/auth';
import { createRoom } from '@/net/rooms';
import { useSettingsStore } from '@/store/settingsStore';
import { useSoloStore } from '@/store/soloStore';
import { HelpModal } from '@/components/help';
import { MAX_NAME_LENGTH } from '@/util/seat';
import { isInstalledApp } from '@/util/app-hop';
import { CODE_LENGTH, extractRoomCode } from '@/util/seed';
import './screen.css';
import './home.css';

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
  const soloInProgress = useSoloStore((s) => s.game !== null);
  const { uid, error: authError } = useAuth();

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  // Online needs a signed-in (anonymous) uid; the cats need nothing at all,
  // so that button is never gated on the connection.
  const onlineReady = uid !== null;
  const connecting = uid === null && !authError;

  async function handleCreate(): Promise<void> {
    if (creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const code = await createRoom(playerName);
      setLastRoom({ code, role: 'host' });
      navigate(`/lobby/${code}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create a room. Try again.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="screen screen--centred">
      <div className="screen__inner home">
        <header className="home__header">
          <img className="home__art" src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" width="96" height="96" />
          <h1 className="home__wordmark">Pawprints</h1>
          <p className="screen__subtitle">
            Five paws in a row across the quilt. Play the cats on this phone, or up to three friends on their own.
          </p>
          <p className="home__weekly">Weekly cat game · November 15, 2026</p>
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
            onChange={(e) => setPlayerName(e.target.value)}
          />
        </div>

        {lastRoom && (
          <div className="notice home__resume">
            <span>
              {lastRoom.role === 'host' ? 'You hosted room ' : 'You joined room '}
              <strong className="code-text">{lastRoom.code}</strong>
            </span>
            <div className="notice__actions">
              <button
                type="button"
                className="btn btn--secondary btn--small"
                disabled={!onlineReady}
                onClick={() => navigate(`/lobby/${lastRoom.code}`)}
              >
                Resume game
              </button>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setLastRoom(null)}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        <div className="stack home__actions">
          <button type="button" className="btn btn--primary btn--block" onClick={() => navigate('/solo')}>
            {soloInProgress ? 'Back to your game with the cats' : 'Play the cats'}
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--block"
            disabled={!onlineReady || creating}
            onClick={() => void handleCreate()}
          >
            {creating ? 'Creating room…' : 'Create online game'}
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
          <button type="button" className="btn btn--ghost btn--block" onClick={() => setHelpOpen(true)}>
            How to play
          </button>
        </div>

        {connecting && (
          <div className="notice row">
            <span className="spinner" aria-hidden="true" />
            <span>Connecting for online play…</span>
          </div>
        )}

        {authError && (
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
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setCreateError(null)}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* A plain absolute href: the hub is a different app on the same host,
            outside this router's basename. */}
        <a className="home__hub" href="/games/">
          ← All games
        </a>
      </div>
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </main>
  );
}
