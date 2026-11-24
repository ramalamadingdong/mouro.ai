/**
 * The human's controls. While betting: 10/25/50/100 chips that each add to
 * the bet, "Clear", "Sit out" and "Bet". While playing: Hit, Stand, Double and Split. Everything it offers
 * comes from `legalActions` — the bar never works out legality itself, so it
 * cannot disagree with the engine.
 */
import type { LegalActions, PlayerMove } from '@/engine';
import { CHIPS } from '@/components/chips';
import './action-bar.css';

export interface ActionBarProps {
  /** Non-null exactly when it is this player's turn. */
  legal: LegalActions | null;
  /** Chips pushed into the betting spot so far this round (held by the table). */
  pushed: readonly number[];
  onPush: (value: number) => void;
  onUndo: () => void;
  onClear: () => void;
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
  pushed,
  busy,
  onPush,
  onUndo,
  onClear,
  onMove,
}: {
  legal: Extract<LegalActions, { kind: 'bet' }>;
  pushed: readonly number[];
  busy: boolean;
  onPush: (value: number) => void;
  onUndo: () => void;
  onClear: () => void;
  onMove: (move: PlayerMove) => void;
}) {
  const { minBet: min, maxBet: max } = legal;
  const bet = pushed.reduce((a, b) => a + b, 0);
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
              onClick={() => onPush(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="bet-chips__row">
          <button type="button" className="bet-chips__edit" disabled={busy || pushed.length === 0} onClick={onUndo}>
            Undo
          </button>
          <p className="bet-chips__hint" aria-live="polite">
            {pushed.length === 0
              ? `Tap chips to bet · ${chips(min)}–${chips(max)}`
              : `${pushed.length} ${pushed.length === 1 ? 'chip' : 'chips'} · ${chips(bet)}${short ? ` (min ${chips(min)})` : ''}`}
          </p>
          <button
            type="button"
            className="bet-chips__edit bet-chips__edit--clear"
            disabled={busy || pushed.length === 0}
            onClick={onClear}
          >
            Clear
          </button>
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
          disabled={busy || short}
          onClick={() => onMove({ kind: 'bet', amount: bet })}
        >
          {bet === 0 ? 'Add chips' : short ? `Bet ${chips(bet)} — min ${chips(min)}` : `Bet ${chips(bet)}`}
        </button>
      </div>
    </section>
  );
}

export function ActionBar({ legal, pushed, onPush, onUndo, onClear, status, busy = false, extra, onMove }: ActionBarProps) {
  if (legal?.kind === 'bet') {
    return (
      <BetControls
        legal={legal}
        pushed={pushed}
        busy={busy}
        onPush={onPush}
        onUndo={onUndo}
        onClear={onClear}
        onMove={onMove}
      />
    );
  }

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
