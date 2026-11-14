/**
 * The table: every seat, the board, the pot, the human's cards and the action
 * bar. One component drives BOTH modes — the offline game against the cats
 * and an online room — so the two cannot drift apart. It is presentational:
 * it renders a GameState and reports intents; it never applies a move itself.
 *
 * Privacy: a seat's hole cards are drawn face-up only if it is `mySeat`, or
 * once the engine has published that hand in `result.hands` at showdown.
 * (Online, everyone's cards ARE in the state each client receives — see
 * AGENTS.md — so this component is the thing that keeps them hidden.)
 */
import { useState, type ReactNode } from 'react';
import {
  evaluate,
  isBettingPhase,
  isGameOver,
  legalActions,
  potTotal,
  type Card,
  type GameState,
  type PlayerMove,
} from '@/engine';
import { ActionBar } from '@/components/action-bar';
import { Avatar } from '@/components/avatar';
import { CardView } from '@/components/card';
import { HelpModal } from '@/components/help';
import { Modal } from '@/components/modal';
import './table.css';

export interface TableProps {
  state: GameState;
  /** The seat this device plays, or null for a spectator. */
  mySeat: number | null;
  /** Offline: the cat whose timer is running. */
  thinkingSeat?: number | null;
  /** Online: uids whose connection is currently gone. */
  away?: ReadonlySet<string>;
  /** Online: a move is in flight. */
  busy?: boolean;
  error?: string | null;
  onDismissError?: () => void;
  /** Shown in the header (the room code online). */
  tag?: string;
  /** Offered while the human is out of the hand (offline only). */
  onSkipAhead?: (() => void) | null;
  onMove: (move: PlayerMove) => void;
  /** Deal the next hand (the "tap to continue" after a showdown). */
  onDeal: () => void;
  onRematch: () => void;
  onLeave: () => void;
  leaveLabel: string;
}

const chips = (n: number): string => n.toLocaleString('en-US');

/**
 * Where the opponents sit, clockwise from the human's left, for each table
 * size. Named slots rather than computed angles: on a tall phone oval the
 * seats must avoid the board and each other, which a circle formula does not.
 */
const SLOTS: Record<number, readonly string[]> = {
  1: ['top'],
  2: ['left-high', 'right-high'],
  3: ['left-high', 'top', 'right-high'],
  4: ['left-low', 'left-high', 'right-high', 'right-low'],
  5: ['left-low', 'left-high', 'top', 'right-high', 'right-low'],
};

const ACTION_LABELS: Record<string, string> = {
  sb: 'Small blind',
  bb: 'Big blind',
  fold: 'Fold',
  check: 'Check',
  call: 'Call',
  bet: 'Bet',
  raise: 'Raise',
  allin: 'All-in',
};

const STREET_NAMES: Record<string, string> = { preflop: 'the flop', flop: 'the turn', turn: 'the river', river: 'the showdown' };

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function Table(props: TableProps) {
  const { state, mySeat, thinkingSeat = null, away, busy = false, error, onMove } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const n = state.players.length;
  const result = state.phase === 'showdown' || state.phase === 'gameover' ? state.result : null;
  const betting = isBettingPhase(state.phase);
  // A spectator watches from seat 0's side of the table.
  const heroSeat = mySeat ?? 0;
  const hero = state.players[heroSeat];
  const isMe = (seat: number): boolean => seat === mySeat;
  const nameOf = (seat: number): string => (isMe(seat) ? 'You' : state.players[seat].name);

  // Cards that make a winning hand, for the showdown highlight.
  const winning = new Set<Card>();
  if (result?.showdown) {
    for (const pot of result.pots) for (const w of pot.winners) result.hands[w]?.best5.forEach((c) => winning.add(c));
  }
  const cardState = (card: Card): { winning: boolean; dim: boolean } => ({
    winning: winning.has(card),
    dim: winning.size > 0 && !winning.has(card),
  });

  const legal = betting && mySeat !== null && state.toAct === mySeat ? legalActions(state) : null;
  const pot = result ? result.pots.reduce((sum, p) => sum + p.amount, 0) : potTotal(state);

  // ── Status line (what the table is waiting for) ──────────────────────────
  let status = '';
  if (betting) {
    if (state.toAct === null) status = `Dealing ${STREET_NAMES[state.phase]}…`;
    else if (isMe(state.toAct)) status = 'Your turn';
    else if (thinkingSeat === state.toAct) status = `${state.players[state.toAct].name} is thinking…`;
    else if (away?.has(state.players[state.toAct].uid)) status = `${state.players[state.toAct].name} is away…`;
    else status = `Waiting for ${state.players[state.toAct].name}…`;
  }
  const heroOut = mySeat !== null && (!hero.inHand || hero.folded);

  // ── The human's hand readout ─────────────────────────────────────────────
  let readout = '';
  if (mySeat !== null) {
    if (!hero.inHand) readout = hero.stack === 0 ? 'Out of chips' : 'Sitting this hand out';
    else if (hero.folded) readout = 'Folded';
    else if (hero.hole.length === 2) readout = evaluate([...hero.hole, ...state.board]).name;
  }

  const levelHandsLeft = state.config.blindUpEvery - ((Math.max(1, state.handNo) - 1) % state.config.blindUpEvery);

  function seatView(seat: number, slot: string): ReactNode {
    const p = state.players[seat];
    const shown = result?.hands[seat] ?? null;
    const live = p.inHand && !p.folded;
    const won = result?.won[seat] ?? 0;
    const isAway = away?.has(p.uid) ?? false;
    const badge = won > 0 ? `+${chips(won)}` : p.allIn && betting ? 'All-in' : p.lastAction ? ACTION_LABELS[p.lastAction.kind] : '';
    return (
      <div
        key={p.uid}
        className={`seat seat--${slot}`}
        data-turn={betting && state.toAct === seat ? 'true' : undefined}
        data-thinking={thinkingSeat === seat ? 'true' : undefined}
        data-folded={p.inHand && p.folded ? 'true' : undefined}
        data-out={!p.inHand ? 'true' : undefined}
        data-winner={won > 0 ? 'true' : undefined}
      >
        <div className="seat__avatar">
          <Avatar uid={p.uid} name={p.name} />
          {thinkingSeat === seat && (
            <span className="seat__dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}
          {state.button === seat && state.handNo > 0 && (
            <span className="dealer-button" title="Dealer button" aria-label="Dealer">
              D
            </span>
          )}
        </div>
        <div className="seat__cards" aria-hidden={!shown}>
          {live && shown && p.hole.map((c) => <CardView key={c} card={c} size="sm" {...cardState(c)} />)}
          {live && !shown && p.hole.map((c) => <CardView key={c} faceDown size="sm" />)}
        </div>
        <div className="seat__plate">
          <span className="seat__name">{p.name}</span>
          <span className="seat__stack">
            {!p.inHand && p.stack === 0 ? 'Out' : isAway ? 'Away' : chips(p.stack)}
          </span>
        </div>
        {badge && (
          <span className="seat__badge" data-kind={won > 0 ? 'won' : p.allIn ? 'allin' : p.lastAction?.kind}>
            {badge}
          </span>
        )}
        {shown && <span className="seat__hand">{shown.name}</span>}
        {p.bet > 0 && (
          <span className="seat__bet">
            <i className="chip" aria-hidden="true" />
            {chips(p.bet)}
          </span>
        )}
      </div>
    );
  }

  // Opponents in clockwise order starting from the seat on the hero's left.
  const others = Array.from({ length: n - 1 }, (_, i) => (heroSeat + 1 + i) % n);
  const slots = SLOTS[others.length] ?? SLOTS[5];
  const heroWon = result?.won[heroSeat] ?? 0;
  const heroShown = result?.hands[heroSeat] ?? null;
  const heroFaceUp = mySeat !== null || heroShown !== null;
  const heroBadge =
    heroWon > 0 ? `+${chips(heroWon)}` : hero.allIn && betting ? 'All-in' : hero.lastAction ? ACTION_LABELS[hero.lastAction.kind] : '';

  return (
    <main className="table">
      <header className="table__bar">
        <button type="button" className="table__menu" onClick={() => setMenuOpen(true)} aria-label="Menu">
          <span aria-hidden="true">☰</span> Menu
        </button>
        <p className="table__info">
          {state.handNo > 0 && (
            <>
              Hand {state.handNo} · Blinds {chips(state.smallBlind)}/{chips(state.bigBlind)}
              <span className="table__level"> · up in {levelHandsLeft}</span>
            </>
          )}
        </p>
        {props.tag && <span className="table__tag code-text">{props.tag}</span>}
      </header>

      <div className="felt-wrap">
        <div className="felt">
          {others.map((seat, i) => seatView(seat, slots[i]))}

          <div className="felt__centre">
            <p className="pot" aria-live="polite">
              <span className="pot__label">Pot</span> {chips(pot)}
            </p>
            <div className="board" aria-label="Community cards">
              {state.board.map((c) => (
                <CardView key={c} card={c} size="md" {...cardState(c)} />
              ))}
              {/* Empty outlines keep the board the same width from flop to river. */}
              {Array.from({ length: 5 - state.board.length }, (_, i) => (
                <span key={`gap-${i}`} className="board__gap" aria-hidden="true" />
              ))}
            </div>
          </div>

          {hero.bet > 0 && (
            <span className="seat__bet seat__bet--hero">
              <i className="chip" aria-hidden="true" />
              {chips(hero.bet)}
            </span>
          )}
        </div>

        {/* The hero sits on the near rail, overlapping the felt's lower edge. */}
        <div
          className="hero"
          data-turn={betting && state.toAct === heroSeat ? 'true' : undefined}
          data-folded={hero.inHand && hero.folded ? 'true' : undefined}
          data-winner={heroWon > 0 ? 'true' : undefined}
        >
          <div className="hero__cards">
            {hero.inHand &&
              hero.hole.map((c) =>
                heroFaceUp ? (
                  <CardView key={c} card={c} size="lg" dim={hero.folded || cardState(c).dim} winning={cardState(c).winning} />
                ) : (
                  <CardView key={c} faceDown size="lg" dim={hero.folded} />
                ),
              )}
            {state.button === heroSeat && state.handNo > 0 && (
              <span className="dealer-button dealer-button--hero" title="Dealer button" aria-label="Dealer">
                D
              </span>
            )}
          </div>
          <div className="hero__info">
            <span className="hero__name">{mySeat === null ? hero.name : 'You'}</span>
            <span className="hero__stack">{chips(hero.stack)}</span>
            {heroBadge && (
              <span className="seat__badge seat__badge--inline" data-kind={heroWon > 0 ? 'won' : hero.allIn ? 'allin' : hero.lastAction?.kind}>
                {heroBadge}
              </span>
            )}
            <span className="hero__readout" aria-live="polite">
              {readout}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="table__error notice notice--bad" role="alert">
          <span>{error}</span>
          {props.onDismissError && (
            <button type="button" className="btn btn--ghost btn--small" onClick={props.onDismissError}>
              Dismiss
            </button>
          )}
        </div>
      )}

      <div className="table__dock">
        {result && state.phase === 'showdown' ? (
          <section className="result" aria-label="Hand result">
            <ul className="result__pots">
              {result.pots.map((p, i) => {
                const label = result.pots.length === 1 ? 'Pot' : i === 0 ? 'Main pot' : `Side pot ${i}`;
                const names = joinNames(p.winners.map(nameOf));
                const verb = p.winners.length > 1 ? 'split' : p.winners.length === 1 && isMe(p.winners[0]) ? 'win' : 'wins';
                const hand = result.showdown ? result.hands[p.winners[0]]?.name : null;
                return (
                  <li key={i} className="result__pot">
                    <span className="result__label">
                      {label} · {chips(p.amount)}
                    </span>
                    <span className="result__line">
                      <strong>{names}</strong> {verb}
                      {hand ? ` with ${hand}` : ' — everyone else folded'}
                    </span>
                  </li>
                );
              })}
            </ul>
            {/* The showdown stays on screen until someone taps: no timer. */}
            <button type="button" className="btn btn--primary btn--block result__next" disabled={busy} onClick={props.onDeal}>
              {isGameOver(state) ? 'See the final result' : 'Deal next hand'}
            </button>
          </section>
        ) : (
          <ActionBar
            // A fresh bar (and a fresh bet amount) for every decision.
            key={legal ? `${state.handNo}:${state.phase}:${legal.minRaiseTo}` : 'waiting'}
            legal={legal}
            pot={pot}
            currentBet={state.currentBet}
            bigBlind={state.bigBlind}
            myStack={hero.stack}
            status={status}
            busy={busy}
            onMove={onMove}
            extra={
              heroOut && betting && props.onSkipAhead ? (
                <button type="button" className="btn btn--secondary btn--small" onClick={props.onSkipAhead}>
                  Skip ahead
                </button>
              ) : null
            }
          />
        )}
      </div>

      <Modal
        open={state.phase === 'gameover'}
        title={state.winner !== null && isMe(state.winner) ? 'You win!' : 'Game over'}
        dismissible={false}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={props.onLeave}>
              {props.leaveLabel}
            </button>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={props.onRematch}>
              Play again
            </button>
          </>
        }
      >
        {state.winner !== null && (
          <p>
            {isMe(state.winner)
              ? `Every chip on the table is yours after ${state.handNo} hands.`
              : `${state.players[state.winner].name} ${
                  state.players.filter((p) => p.stack > 0).length === 1 ? 'has every chip on the table' : 'is the chip leader'
                } after ${state.handNo} hands.`}
          </p>
        )}
        <ol className="standings">
          {state.players
            .map((p, seat) => ({ p, seat }))
            .sort((a, b) => b.p.stack - a.p.stack)
            .map(({ p, seat }) => (
              <li key={p.uid}>
                <span>{nameOf(seat)}</span>
                <span>{chips(p.stack)}</span>
              </li>
            ))}
        </ol>
      </Modal>

      <Modal open={menuOpen} title="Menu" onClose={() => setMenuOpen(false)}>
        <div className="stack">
          <button
            type="button"
            className="btn btn--secondary btn--block"
            onClick={() => {
              setMenuOpen(false);
              setHelpOpen(true);
            }}
          >
            How to play
          </button>
          <button type="button" className="btn btn--secondary btn--block" onClick={props.onLeave}>
            {props.leaveLabel}
          </button>
          <a className="btn btn--ghost btn--block" href="/games/">
            ← All games
          </a>
        </div>
      </Modal>
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </main>
  );
}
