/**
 * The human's controls. While betting: a bet slider with presets, "Sit out"
 * and "Bet". While playing: Hit, Stand, Double and Split. Everything it offers
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
  const { minBet: min, maxBet: max, step } = legal;
  const clamp = (n: number): number => Math.min(max, Math.max(min, Math.round(n / step) * step));
  // The table remounts this component (via `key`) for each new round, so the
  // amount always starts from the default, never from a stale one.
  const [bet, setBet] = useState(() => clamp(defaultBet));
  const amount = clamp(bet);
  const steps = Math.max(1, (max - min) / step);
  const presets = [
    { label: `Min ${chips(min)}`, to: min },
    { label: chips(clamp(50)), to: clamp(50) },
    { label: chips(clamp(100)), to: clamp(100) },
    { label: `Max ${chips(max)}`, to: max },
  ];

  return (
    <section className="actions" aria-label="Your bet">
      <div className="actions__top">
        <input
          className="actions__slider"
          type="range"
          min={0}
          max={steps}
          step={1}
          value={(amount - min) / step}
          disabled={busy || min >= max}
          aria-label="Bet size"
          aria-valuetext={`${chips(amount)} chips`}
          onChange={(e) => setBet(min + Number(e.target.value) * step)}
        />
        <div className="actions__presets">
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="actions__preset"
              aria-pressed={amount === preset.to}
              disabled={busy}
              onClick={() => setBet(preset.to)}
            >
              {preset.label}
            </button>
          ))}
        </div>
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
          disabled={busy}
          onClick={() => onMove({ kind: 'bet', amount })}
        >
          Bet {chips(amount)}
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
