/**
 * The human's controls: Fold, Check/Call and Bet/Raise with a slider and
 * presets. Everything it offers comes from `legalActions` — the bar never
 * works out legality itself, so it cannot disagree with the engine.
 */
import { useState } from 'react';
import type { LegalActions, PlayerMove } from '@/engine';
import './action-bar.css';

export interface ActionBarProps {
  /** Non-null exactly when it is this player's turn. */
  legal: LegalActions | null;
  /** Chips in the middle, including this street's bets. */
  pot: number;
  /** Highest bet on this street (0 if nobody has bet). */
  currentBet: number;
  bigBlind: number;
  /** This player's remaining chips. */
  myStack: number;
  /** Shown in place of the raise controls when it is not this player's turn. */
  status: string;
  /** A move is in flight (online): keep the buttons from being pressed twice. */
  busy?: boolean;
  /** Optional extra control beside the status line (e.g. "Skip ahead"). */
  extra?: React.ReactNode;
  onMove: (move: PlayerMove) => void;
}

const chips = (n: number): string => n.toLocaleString('en-US');

export function ActionBar({ legal, pot, currentBet, bigBlind, myStack, status, busy = false, extra, onMove }: ActionBarProps) {
  const min = legal?.minRaiseTo ?? 0;
  const max = legal?.maxRaiseTo ?? 0;
  // The table remounts this component (via `key`) for each new decision, so
  // the amount always starts from the minimum raise, never from a stale one.
  const [raiseTo, setRaiseTo] = useState(min);

  const clamp = (n: number): number => Math.min(max, Math.max(min, Math.round(n)));
  const amount = clamp(raiseTo);

  // The slider moves in steps of half a big blind, but an <input type=range>
  // cannot reach a max that is not a whole number of steps from its min. So it
  // works in step INDEXES and the last index always means all-in.
  const step = Math.max(1, Math.round(bigBlind / 2));
  const steps = Math.max(1, Math.ceil((max - min) / step));
  const toIndex = (n: number): number => (n >= max ? steps : Math.min(steps - 1, Math.round((n - min) / step)));
  const fromIndex = (i: number): number => (i >= steps ? max : clamp(min + i * step));

  // "Pot" means a pot-sized raise: call first, then raise by the pot as it
  // stands after the call.
  const call = legal?.callAmount ?? 0;
  const potRaise = (fraction: number): number => clamp(currentBet + (pot + call) * fraction);
  const presets = [
    { label: 'Min', to: min },
    { label: '½ pot', to: potRaise(0.5) },
    { label: 'Pot', to: potRaise(1) },
    { label: 'All-in', to: max },
  ];

  const myTurn = legal !== null;
  const canRaise = myTurn && legal.canRaise;
  const disabled = !myTurn || busy;

  const raiseLabel =
    amount >= max ? `All-in ${chips(max)}` : currentBet === 0 ? `Bet ${chips(amount)}` : `Raise to ${chips(amount)}`;
  // Calling for the whole stack is an all-in; say so on the button.
  const callIsAllIn = myTurn && call > 0 && call >= myStack;

  return (
    <section className="actions" aria-label="Your move">
      <div className="actions__top">
        {canRaise ? (
          <>
            <input
              className="actions__slider"
              type="range"
              min={0}
              max={steps}
              step={1}
              value={toIndex(amount)}
              disabled={busy || min >= max}
              aria-label="Bet size"
              aria-valuetext={`${chips(amount)} chips`}
              onChange={(e) => setRaiseTo(fromIndex(Number(e.target.value)))}
            />
            <div className="actions__presets">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className="actions__preset"
                  aria-pressed={amount === preset.to}
                  disabled={busy}
                  onClick={() => setRaiseTo(preset.to)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="actions__status" role="status">
            <span>{status}</span>
            {extra}
          </div>
        )}
      </div>

      <div className="actions__buttons">
        {/* Folding when a check is free is legal but always a mistake, so the
            button is disabled rather than left as a mis-tap waiting to happen. */}
        <button
          type="button"
          className="actions__btn actions__btn--fold"
          disabled={disabled || legal?.canCheck}
          onClick={() => onMove({ kind: 'fold' })}
        >
          Fold
        </button>
        <button
          type="button"
          className="actions__btn actions__btn--call"
          disabled={disabled}
          onClick={() => onMove({ kind: legal?.canCheck ? 'check' : 'call' })}
        >
          {!legal || legal.canCheck ? 'Check' : `Call ${chips(call)}${callIsAllIn ? ' (all-in)' : ''}`}
        </button>
        {(canRaise || !myTurn) && (
          <button
            type="button"
            className="actions__btn actions__btn--raise"
            disabled={disabled || !canRaise}
            onClick={() => onMove({ kind: 'raise', to: amount })}
          >
            {canRaise ? raiseLabel : 'Bet'}
          </button>
        )}
      </div>
    </section>
  );
}
