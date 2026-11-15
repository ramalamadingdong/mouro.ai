/**
 * The playing screen, shared by the cats and online rooms: the scoreboard,
 * one line saying what is happening, the board, and — once every box is
 * claimed — the result with "Play again".
 *
 * Presentational: it knows nothing about stores or the network. The routes
 * pass in the state and the callbacks.
 */
import { useState } from 'react';
import { scores, winners, type GameState } from '@/engine';
import { Avatar } from '@/components/avatar';
import { Board } from '@/components/board';
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
  onLine: (edge: number) => void;
  onRematch: () => void;
  onLeave: () => void;
  leaveLabel: string;
}

function nameFor(state: GameState, seat: number, mySeat: number | null): string {
  return seat === mySeat ? 'You' : (state.players[seat]?.name ?? 'Player');
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function statusLine(state: GameState, mySeat: number | null, thinkingSeat: number | null): string {
  if (state.toAct === null) {
    const top = winners(state);
    if (top.length > 1) return `A tie between ${joinNames(top.map((s) => nameFor(state, s, mySeat)))}!`;
    return top[0] === mySeat ? 'You win!' : `${nameFor(state, top[0], mySeat)} wins`;
  }
  const seat = state.toAct;
  const last = state.lastMove;
  const again = last.seat === seat && last.closed > 0 && (last.kind === 'line' || last.kind === 'away');
  if (seat === mySeat) return again ? (last.closed > 1 ? 'Two boxes! Go again.' : 'Box! Go again.') : 'Your turn — draw a line';
  const name = nameFor(state, seat, mySeat);
  if (thinkingSeat === seat) return again ? `${name} got a box and goes again…` : `${name} is thinking…`;
  if (state.players[seat].sitOut) return `${name} is away — the game will draw for them`;
  return again ? `${name} got a box and goes again` : `${name}’s turn`;
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
  onLine,
  onRematch,
  onLeave,
  leaveLabel,
}: GameViewProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const points = scores(state);
  const over = state.phase === 'gameover';
  const top = over ? winners(state) : [];
  const myTurn = mySeat !== null && state.toAct === mySeat;
  const remaining = state.boxes.split('').filter((c) => c === '.').length;

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
            `${state.config.cols}×${state.config.rows}`
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

      <ol className="play__scores" aria-label="Scores">
        {state.players.map((p, seat) => {
          const gone = away?.has(p.uid) ?? false;
          return (
            <li
              key={p.uid}
              className="score"
              data-seat={seat}
              data-turn={state.toAct === seat ? 'true' : 'false'}
              data-winner={top.includes(seat) ? 'true' : 'false'}
              data-thinking={thinkingSeat === seat ? 'true' : 'false'}
            >
              <span className="score__avatar">
                <Avatar uid={p.uid} name={p.name} />
              </span>
              <span className="score__name">
                {nameFor(state, seat, mySeat)}
                {gone && <span className="score__away">away</span>}
              </span>
              <span className="score__points" aria-label={`${points[seat]} boxes`}>
                {points[seat]}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="play__status" role="status" data-seat={state.toAct ?? undefined}>
        {statusLine(state, mySeat, thinkingSeat)}
      </p>

      <div className="play__board" data-myturn={myTurn ? 'true' : 'false'}>
        <Board state={state} interactive={myTurn && !busy} previewSeat={mySeat} onLine={onLine} />
      </div>

      {!over && (
        <p className="play__left">
          {remaining} {remaining === 1 ? 'box' : 'boxes'} left
        </p>
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
          <ol className="play__ranking">
            {state.players
              .map((p, seat) => ({ p, seat }))
              .sort((a, b) => points[b.seat] - points[a.seat] || a.seat - b.seat)
              .map(({ seat }) => (
                <li key={seat} data-seat={seat}>
                  <span className="play__swatch" aria-hidden="true" />
                  <span>{nameFor(state, seat, mySeat)}</span>
                  <strong>{points[seat]}</strong>
                </li>
              ))}
          </ol>
          <div className="stack">
            <button type="button" className="btn btn--primary btn--block" onClick={onRematch} disabled={busy}>
              Play again
            </button>
            <p className="field__hint play__hint">The next player along draws first.</p>
          </div>
        </section>
      )}

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </main>
  );
}
