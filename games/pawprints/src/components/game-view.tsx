/**
 * The playing screen, shared by the cats and online rooms: the players, one
 * line saying what is happening, the quilt, the "Leave a paw here" button
 * for a chosen point, and — once someone has a line — the result with
 * "Play again".
 *
 * Presentational: it knows nothing about stores or the network. The routes
 * pass in the state and the callbacks.
 */
import { useState } from 'react';
import { need, pawCounts, winner, winningLine, type GameState } from '@/engine';
import { Avatar } from '@/components/avatar';
import { Board, Paw } from '@/components/board';
import { HelpModal } from '@/components/help';
import './game-view.css';

export interface GameViewProps {
  state: GameState;
  /** This device's seat, or null for a spectator. */
  mySeat: number | null;
  /** A cat that is "thinking" (offline only). */
  thinkingSeat?: number | null;
  /** uids whose connection is gone (online only). */
  away?: ReadonlySet<string>;
  /** A move from this device is in flight. */
  busy?: boolean;
  error?: string | null;
  onDismissError?: () => void;
  /** Shown in the header: the room code online. */
  tag?: string;
  onPaw: (cell: number) => void;
  onRematch: () => void;
  onLeave: () => void;
  leaveLabel: string;
}

function nameFor(state: GameState, seat: number, mySeat: number | null): string {
  return seat === mySeat ? 'You' : (state.players[seat]?.name ?? 'Player');
}

function statusLine(state: GameState, mySeat: number | null, thinkingSeat: number | null): string {
  if (state.toAct === null) {
    const won = winner(state);
    if (won === null) return 'The quilt is full — a draw!';
    return won === mySeat ? `You win — ${need(state)} in a row!` : `${nameFor(state, won, mySeat)} wins`;
  }
  const seat = state.toAct;
  if (seat === mySeat) return 'Your turn — leave a paw';
  const name = nameFor(state, seat, mySeat);
  if (thinkingSeat === seat) return `${name} is thinking…`;
  if (state.players[seat].sitOut) return `${name} is away — the game will play for them`;
  return `${name}’s turn`;
}

export function GameView({
  state,
  mySeat,
  thinkingSeat = null,
  away,
  busy = false,
  error,
  onDismissError,
  tag,
  onPaw,
  onRematch,
  onLeave,
  leaveLabel,
}: GameViewProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  // A choice belongs to one position: it lapses by itself when the board changes.
  const [choice, setChoice] = useState<{ cell: number; version: number } | null>(null);
  const chosen = choice !== null && choice.version === state.version ? choice.cell : null;
  const setChosen = (cell: number | null) => setChoice(cell === null ? null : { cell, version: state.version });
  const counts = pawCounts(state);
  const over = state.phase === 'gameover';
  const won = over ? winner(state) : null;
  const line = over ? winningLine(state) : null;
  const myTurn = mySeat !== null && state.toAct === mySeat;
  const canPlay = myTurn && !busy;

  function play(cell: number): void {
    setChosen(null);
    onPaw(cell);
  }

  return (
    <main className="play">
      <header className="play__bar">
        <button type="button" className="btn btn--ghost btn--small" onClick={onLeave}>
          {leaveLabel}
        </button>
        <span className="play__tag">
          {tag ? (
            <>
              Room <strong className="code-text selectable">{tag}</strong>
            </>
          ) : (
            `${state.config.size}×${state.config.size} · ${need(state)} in a row`
          )}
        </span>
        <button
          type="button"
          className="btn btn--ghost btn--small play__help"
          onClick={() => setHelpOpen(true)}
          aria-label="How to play"
        >
          ?
        </button>
      </header>

      <ol className="play__scores" aria-label="Players">
        {state.players.map((p, seat) => {
          const gone = away?.has(p.uid) ?? false;
          return (
            <li
              key={p.uid}
              className="score"
              data-seat={seat}
              data-turn={state.toAct === seat ? 'true' : 'false'}
              data-winner={won === seat ? 'true' : 'false'}
              data-thinking={thinkingSeat === seat ? 'true' : 'false'}
            >
              <span className="score__avatar">
                <Avatar uid={p.uid} name={p.name} />
              </span>
              <span className="score__name">
                {nameFor(state, seat, mySeat)}
                {gone && <span className="score__away">away</span>}
              </span>
              <span className="score__points" aria-label={`${counts[seat]} paws`}>
                <svg className="score__paw" viewBox="-0.5 -0.5 1 1" aria-hidden="true">
                  <Paw seat={seat} />
                </svg>
                {counts[seat]}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="play__status" role="status" data-seat={state.toAct ?? undefined}>
        {statusLine(state, mySeat, thinkingSeat)}
      </p>

      <div className="play__board" data-myturn={myTurn ? 'true' : 'false'}>
        <Board
          state={state}
          interactive={canPlay}
          previewSeat={mySeat}
          chosen={canPlay ? chosen : null}
          line={line}
          onPoint={(cell, now) => (now ? play(cell) : setChosen(cell))}
        />
      </div>

      {!over && (
        <div className="play__place">
          {canPlay && chosen !== null ? (
            <button type="button" className="btn btn--primary btn--block" onClick={() => play(chosen)}>
              Leave a paw here
            </button>
          ) : (
            canPlay && <p className="play__hint-line">Tap a point on the quilt, then leave your paw there.</p>
          )}
        </div>
      )}

      {error && (
        <div className="notice notice--bad play__error">
          <p>{error}</p>
          {onDismissError && (
            <div className="notice__actions">
              <button type="button" className="btn btn--ghost btn--small" onClick={onDismissError}>
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

      {over && (
        <section className="panel play__over">
          <p className="play__result" data-seat={won ?? undefined}>
            {won === null
              ? 'Nobody found a line. Shake out the quilt and go again.'
              : `${nameFor(state, won, mySeat)} made ${need(state)} in a row in ${counts[won]} paws.`}
          </p>
          <div className="stack">
            <button type="button" className="btn btn--primary btn--block" onClick={onRematch} disabled={busy}>
              Play again
            </button>
            <p className="field__hint play__hint">The next player along goes first.</p>
          </div>
        </section>
      )}

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </main>
  );
}
