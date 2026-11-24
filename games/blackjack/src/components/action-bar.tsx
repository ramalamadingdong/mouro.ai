/**
 * The human's controls. While betting: 10/25/50/100 chips that each add to
 * the bet, "Clear", "Sit out" and "Bet". While playing: Hit, Stand, Double and Split. Everything it offers
 * comes from `legalActions` — the bar never works out legality itself, so it
 * cannot disagree with the engine.
 */
import { useState } from 'react';
import type { LegalActions, PlayerMove } from '@/engine';
import './action-bar.css';

export interface ActionBarProps {
  /** Non-null exactly when it is this player's turn. */
  legal: LegalActions | null;
  /** The bet the slider starts at (the player's last bet, else the minimum). */
  defaultBet: number;
  /** Shown in place of the controls when it is not this player's turn. */
  status: string;
  /** A move is in flight (online): keep the buttons from being pressed twice. */
  busy?: boolean;
  /** Optional extra control beside the status line (e.g. "Skip ahead"). */
  extra?: React.ReactNode;
  onMove: (move: PlayerMove) => void;
}

const chips = (n: number): string => n.toLocaleString('en-US');

/** The betting chips. Each tap adds its value to the bet. */
const CHIPS = [10, 25, 50, 100] as const;

function BetControls({
  legal,
  defaultBet,
  busy,
  onMove,
}: {
  legal: Extract<LegalActions, { kind: 'bet' }>;
  defaultBet: number;
  busy: boolean;
  onMove: (move: PlayerMove) => void;
}) {
  const { minBet: min, maxBet: max } = legal;
  // Starts at the last bet (so repeating it is one tap). The table remounts
  // this component (via `key`) for each new round, so it is never stale.
  const [bet, setBet] = useState(() => (defaultBet >= min && defaultBet <= max ? defaultBet : 0));
  const short = bet < min;

  return (
    <section className="actions" aria-label="Your bet">
      <div className="actions__top">
        <div className="bet-chips">
          {CHIPS.map((value) => (
            <button
              key={value}
              type="button"
              className="bet-chip"
              data-value={value}
              disabled={busy || bet + value > max}
              aria-label={`Add ${value}`}
              onClick={() => setBet(bet + value)}
            >
              {value}
            </button>
          ))}
          <button
            type="button"
            className="bet-chips__clear"
            disabled={busy || bet === 0}
            onClick={() => setBet(0)}
          >
            Clear
          </button>
        </div>
        <p className="bet-chips__hint" aria-live="polite">
          {short ? `Tap chips to bet — ${chips(min)} to ${chips(max)}` : `Betting ${chips(bet)} of ${chips(max)} max`}
        </p>
      </div>
      <div className="actions__buttons">
        <button
          type="button"
          className="actions__btn actions__btn--quiet"
          disabled={busy}
          onClick={() => onMove({ kind: 'bet', amount: 0 })}
        >
          Sit out
        </button>
        <button
          type="button"
          className="actions__btn actions__btn--main"
          disabled={busy || short}
          onClick={() => onMove({ kind: 'bet', amount: bet })}
        >
          {short ? 'Add chips' : `Bet ${chips(bet)}`}
        </button>
      </div>
    </section>
  );
}

export function ActionBar({ legal, defaultBet, status, busy = false, extra, onMove }: ActionBarProps) {
  if (legal?.kind === 'bet') return <BetControls legal={legal} defaultBet={defaultBet} busy={busy} onMove={onMove} />;

  const play = legal?.kind === 'play' ? legal : null;
  const disabled = !play || busy;
  return (
    <section className="actions" aria-label="Your move">
      <div className="actions__top">
        <div className="actions__status" role="status">
          <span>{status}</span>
          {extra}
        </div>
      </div>
      <div className="actions__buttons">
        <button type="button" className="actions__btn" disabled={disabled} onClick={() => onMove({ kind: 'hit' })}>
          Hit
        </button>
        <button
          type="button"
          className="actions__btn actions__btn--main"
          disabled={disabled}
          onClick={() => onMove({ kind: 'stand' })}
        >
          Stand
        </button>
        <button
          type="button"
          className="actions__btn actions__btn--side"
          disabled={disabled || !play?.canDouble}
          onClick={() => onMove({ kind: 'double' })}
        >
          Double
        </button>
        <button
          type="button"
          className="actions__btn actions__btn--side"
          disabled={disabled || !play?.canSplit}
          onClick={() => onMove({ kind: 'split' })}
        >
          Split
        </button>
      </div>
    </section>
  );
}
