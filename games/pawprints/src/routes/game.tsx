/**
 * The online game. The room binding itself is owned by RoomLayout in
 * app.tsx; this route only reads the store and turns taps into moves.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { GameView } from '@/components/game-view';
import { useOnlineAway } from '@/hooks/use-online-away';
import { leaveRoom } from '@/net/rooms';
import { useGameStore } from '@/store/gameStore';
import { useSettingsStore } from '@/store/settingsStore';
import { sanitizeRoomCode } from '@/util/seed';
import './screen.css';

/** How long to wait for the first snapshot before deciding there is no game here. */
const SETTLE_MS = 6000;

export function GameRoute() {
  const navigate = useNavigate();
  const params = useParams<{ code: string }>();
  const code = sanitizeRoomCode(params.code ?? '');

  const state = useGameStore((s) => s.state);
  const mySeat = useGameStore((s) => s.mySeat);
  const presence = useGameStore((s) => s.presence);
  const pendingMove = useGameStore((s) => s.pendingMove);
  const error = useGameStore((s) => s.error);
  const send = useGameStore((s) => s.send);
  const clearError = useGameStore((s) => s.clearError);
  const setLastRoom = useSettingsStore((s) => s.setLastRoom);

  useOnlineAway();

  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(false);
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [code]);

  // No state after the settle window means the game has not started (or the
  // room is gone): the lobby is the screen that can say which.
  useEffect(() => {
    if (settled && !state && code) navigate(`/lobby/${code}`, { replace: true });
  }, [settled, state, code, navigate]);

  // Not computed until the room has settled: presence arrives on its own
  // schedule, and flagging everyone "away" after a reload would be alarming.
  const away = useMemo(() => {
    const gone = new Set<string>();
    if (state && settled) for (const p of state.players) if (!(p.uid in presence)) gone.add(p.uid);
    return gone;
  }, [state, presence, settled]);

  function handleLeave(): void {
    void leaveRoom(code);
    setLastRoom(null);
    navigate('/', { replace: true });
  }

  if (!state) {
    return (
      <main className="screen screen--centred">
        <div className="screen__inner screen__inner--centred">
          <span className="spinner" aria-hidden="true" />
          <p className="screen__subtitle">Loading the quilt…</p>
          <button type="button" className="btn btn--ghost" onClick={handleLeave}>
            Leave
          </button>
        </div>
      </main>
    );
  }

  return (
    <GameView
      state={state}
      mySeat={mySeat}
      away={away}
      busy={pendingMove}
      error={error}
      onDismissError={clearError}
      tag={code}
      onPaw={(cell) => void send({ kind: 'paw', cell })}
      // Any seated player may start the rematch; if two tap at once the
      // reducer refuses the second.
      onRematch={() => void send({ kind: 'rematch' })}
      onLeave={handleLeave}
      leaveLabel="Leave"
    />
  );
}
