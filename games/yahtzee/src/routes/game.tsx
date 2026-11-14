/**
 * Online play. This route is a thin adapter: it binds the room, maps store
 * fields onto <Table/> props, and turns the table's callbacks into engine moves.
 *
 * Every rule, every disabled button and every piece of layout lives in <Table/>,
 * which `local.tsx` renders from the pass-and-play store with the same props.
 * Anything game-shaped added here instead of there exists in online play only.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Table } from '@/components/table';
import { useGameStore } from '@/store/gameStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { leaveRoom } from '@/net/rooms';
import { randomSeed, sanitizeRoomCode } from '@/util/seed';
import type { Category } from '@/engine';
import './screen.css';

/**
 * How long to sit on "loading" before deciding this room has no dealt game and
 * handing the player back to the lobby.
 *
 * Same budget as the lobby's settle timer, and for the same reason: a cold RTDB
 * socket plus anonymous sign-in is routinely two or three seconds. Bouncing to
 * the lobby is a soft failure — the lobby is the screen that knows how to say
 * "room not found" versus "couldn't connect" — so the cost of it firing early is
 * only a flicker, not a dead end.
 */
const SETTLE_MS = 6000;

export function GameRoute() {
  const navigate = useNavigate();
  const params = useParams<{ code: string }>();
  const code = sanitizeRoomCode(params.code ?? '');

  // No bindRoom/unbindRoom here: RoomLayout in app.tsx owns the subscription for
  // the whole /lobby/:code + /game/:code subtree. Binding here too would be a
  // second owner with no way to agree on when to tear down.
  const send = useGameStore((s) => s.send);
  const setHolds = useGameStore((s) => s.setHolds);
  const voteRematch = useGameStore((s) => s.voteRematch);
  const state = useGameStore((s) => s.state);
  const mySeat = useGameStore((s) => s.mySeat);
  const allHolds = useGameStore((s) => s.holds);
  const presence = useGameStore((s) => s.presence);
  const rematchVotes = useGameStore((s) => s.rematchVotes);
  const pendingMove = useGameStore((s) => s.pendingMove);
  const error = useGameStore((s) => s.error);

  const setLastRoom = useSettingsStore((s) => s.setLastRoom);
  const motionSetting = useSettingsStore((s) => s.motion);
  // The OS preference is a HARD VETO over the in-app setting; see
  // use-reduced-motion. Written as `&& !osReduced` at the call site on purpose,
  // so the precedence cannot be expressed the wrong way round.
  const osReduced = useReducedMotion();
  const motion = motionSetting && !osReduced;

  const [settled, setSettled] = useState(false);

  useEffect(() => {
    /*
     * RESET, don't just start. React Router reuses this same element across
     * /game/A -> /game/B — only the param changes — so with `[]` deps the flag
     * stayed latched at true from room A. On arrival at B the store has just
     * been cleared to `state: null` by the rebind, `settled` was already true,
     * and the redirect below fired instantly: bounced to /lobby/B, which
     * forwards straight back the moment B's snapshot lands. A visible
     * round-trip flicker for a room that was fine all along.
     */
    setSettled(false);
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [code]);

  // No dealt game after the settle window: the room may exist but be waiting,
  // or not exist at all. Both are the lobby's story to tell.
  useEffect(() => {
    if (settled && !state && code) navigate(`/lobby/${code}`, { replace: true });
  }, [settled, state, code, navigate]);

  function handleLeave(): void {
    // Not awaited: leaving must not depend on a round-trip, least of all when
    // the reason for leaving is a connection that has already stopped working.
    void leaveRoom(code);
    setLastRoom(null);
    // Navigating out of the /game/:code subtree unmounts RoomLayout, whose
    // cleanup unbinds. Calling unbindRoom() here as well would only blank the
    // store for the frame before the route changes, flashing the loading state.
    navigate('/', { replace: true });
  }

  if (!state) {
    return (
      <main className="screen screen--centred">
        <div className="screen__inner screen__inner--centred">
          <span className="spinner" aria-hidden="true" />
          <p className="screen__subtitle">Loading the game…</p>
          <button type="button" className="btn btn--ghost" onClick={handleLeave}>
            Leave
          </button>
        </div>
      </main>
    );
  }

  // Our own holds, keyed by our uid in a map that also carries the opponents'.
  // Derived from the seat rather than from `getCurrentUid()` so it can never
  // disagree with the seat the table is rendering us as.
  const myUid = mySeat === null ? null : (state.players[mySeat]?.uid ?? null);
  const myHolds = myUid ? (allHolds[myUid] ?? []) : [];

  function handleToggleHold(index: number): void {
    // Toggle computed here rather than in the table, because the store owns the
    // published copy and the table is deliberately stateless about holds.
    const next = myHolds.includes(index)
      ? myHolds.filter((i) => i !== index)
      : [...myHolds, index].sort((a, b) => a - b);
    setHolds(next);
  }

  /*
   * The rematch tally, for the game-over sheet.
   *
   * `rooms.ts` submits the real `{ kind: 'rematch' }` move only once EVERY
   * seated player has voted, so without this the first player to tap sat in
   * front of a still-enabled button and a screen that never changed. The store
   * has kept `rematchVotes` all along; nothing read it.
   *
   * Counted over `state.players` rather than over the votes map: a vote from
   * someone who has since left the room is not a vote from a seated player, and
   * counting it would report a tally that can never complete.
   */
  const rematch = {
    voted: myUid !== null && rematchVotes[myUid] === true,
    count: state.players.filter((p) => rematchVotes[p.uid] === true).length,
    total: state.players.length,
  };

  return (
    <Table
      state={state}
      mySeat={mySeat}
      holds={myHolds}
      pending={pendingMove}
      error={error}
      presence={presence}
      rematch={rematch}
      motion={motion}
      // The seed is attached HERE, not in the table: all randomness enters the
      // engine as an explicit seed on the move that consumes it, which is what
      // makes a game replayable from its move log. The table never calls
      // crypto, so it stays a pure function of its props.
      onRoll={(keep) => void send({ kind: 'roll', keep, seed: randomSeed() })}
      onScore={(category: Category) => void send({ kind: 'score', category })}
      onToggleHold={handleToggleHold}
      // A vote, not a move. `voteRematch` records it and submits the actual
      // rematch move only once every seated player has voted.
      onRematch={() => void voteRematch()}
      onLeave={handleLeave}
    />
  );
}

export default GameRoute;
