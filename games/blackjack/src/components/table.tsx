/**
 * The table: the dealer, every seat, the human's hands and the action bar.
 * One component drives BOTH modes — the offline game against the cats and an
 * online room — so the two cannot drift apart. It is presentational: it
 * renders a GameState and reports intents; it never applies a move itself.
 *
 * Privacy: in blackjack every player's cards are dealt face up, so the only
 * secrets are the dealer's hole card and the shoe. The hole card is drawn
 * face down until `holeCardShown` (online, it IS in the state each client
 * receives — see AGENTS.md — so this component is what keeps it hidden).
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { DEALER } from '@/ai';
import {
  chipsInPlay,
  handValue,
  holeCardShown,
  isBlackjack,
  isGameOver,
  legalActions,
  type Card,
  type GameState,
  type Hand,
  type PlayerMove,
  type PlayerState,
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
  /** Offered once the human's own hands are finished (offline only). */
  onSkipAhead?: (() => void) | null;
  onMove: (move: PlayerMove) => void;
  /** Deal the next round (the "tap to continue" after a round is paid). */
  onDeal: () => void;
  onRematch: () => void;
  onLeave: () => void;
  leaveLabel: string;
}

const chips = (n: number): string => n.toLocaleString('en-US');
const signed = (n: number): string => (n > 0 ? `+${chips(n)}` : n < 0 ? `−${chips(-n)}` : 'Push');

const ACTION_LABELS: Record<string, string> = {
  bet: 'Bet',
  sitout: 'Sitting out',
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
  blackjack: 'Blackjack!',
  bust: 'Bust',
};

const OUTCOME_LABELS: Record<string, string> = {
  blackjack: 'Blackjack',
  win: 'Win',
  push: 'Push',
  lose: 'Lose',
  bust: 'Bust',
};

/** "17", "Soft 17", "Blackjack", "Bust 24". */
function totalLabel(cards: readonly Card[], blackjack: boolean): string {
  if (cards.length === 0) return '';
  if (blackjack) return 'Blackjack';
  const { total, soft } = handValue(cards);
  if (total > 21) return `Bust ${total}`;
  return soft && total < 21 ? `Soft ${total}` : String(total);
}

/**
 * Where the other seats sit. Clockwise from the human's left: up the left
 * rail, then down the right one, as many rows per side as it takes (four at
 * most). Positions are percentages of the felt, so one rule serves a 390px
 * phone and a desktop window.
 */
function seatPlaces(count: number): { side: 'left' | 'right'; top: number }[] {
  const left = Math.ceil(count / 2);
  const right = count - left;
  const tops = (k: number): number[] =>
    k <= 1 ? [44] : Array.from({ length: k }, (_, i) => 20 + (i * 52) / (k - 1));
  return [
    ...tops(left).reverse().map((top) => ({ side: 'left' as const, top })),
    ...tops(right).map((top) => ({ side: 'right' as const, top })),
  ];
}

export function Table(props: TableProps) {
  const { state, mySeat, thinkingSeat = null, away, busy = false, error, onMove } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const n = state.players.length;
  const settled = state.phase === 'settled';
  const result = settled || state.phase === 'gameover' ? state.result : null;
  const holeShown = holeCardShown(state);
  // A spectator watches from seat 0's side of the table.
  const heroSeat = mySeat ?? 0;
  const hero = state.players[heroSeat];
  const isMe = (seat: number): boolean => seat === mySeat;
  const nameOf = (seat: number): string => (isMe(seat) ? 'You' : state.players[seat].name);

  // The bet slider starts at the last bet this player placed.
  // (Adjusting state during render is React's sanctioned way to follow a prop.)
  const [lastBet, setLastBet] = useState(state.config.minBet);
  if (hero.lastAction?.kind === 'bet' && hero.lastAction.amount !== lastBet) setLastBet(hero.lastAction.amount);

  const legal = mySeat !== null && state.toAct === mySeat ? legalActions(state) : null;

  // ── Status line (what the table is waiting for) ──────────────────────────
  let status = '';
  const toActName = state.toAct === null ? '' : state.players[state.toAct].name;
  const waitingOn = (verb: string): string => {
    if (state.toAct === null) return '';
    if (isMe(state.toAct)) return 'Your turn';
    if (thinkingSeat === state.toAct) return `${toActName} is thinking…`;
    if (away?.has(state.players[state.toAct].uid)) return `${toActName} is away…`;
    return `Waiting for ${toActName} to ${verb}…`;
  };
  if (state.phase === 'betting') status = state.toAct === null ? 'Dealing…' : waitingOn('bet');
  else if (state.phase === 'playing') status = state.toAct === null ? `${DEALER.name} turns her card…` : waitingOn('play');
  else if (state.phase === 'dealer') {
    const { total } = handValue(state.dealer);
    status = total > 21 ? `${DEALER.name} busts!` : `${DEALER.name} has ${total}…`;
  }
  const heroDone =
    mySeat !== null &&
    (state.phase === 'betting' ? hero.lastAction !== null || hero.stack < state.config.minBet : hero.hands.every((h) => h.done));
  const inRound = state.phase === 'betting' || state.phase === 'playing' || state.phase === 'dealer';

  function handView(p: PlayerState, hand: Hand, i: number, size: 'sm' | 'md' | 'lg', active: boolean): ReactNode {
    const bj = isBlackjack(hand);
    const label = totalLabel(hand.cards, bj);
    const won = hand.outcome === 'win' || hand.outcome === 'blackjack';
    const lost = hand.outcome === 'lose' || hand.outcome === 'bust';
    return (
      <div
        key={i}
        className={`hand hand--${size}`}
        data-active={active ? 'true' : undefined}
        data-outcome={hand.outcome ?? undefined}
      >
        <div className="hand__cards">
          {hand.cards.map((c) => (
            <CardView key={c} card={c} size={size} dim={lost && result !== null} winning={won && size !== 'sm'} />
          ))}
          {hand.cards.length === 0 && <span className="hand__gap" aria-hidden="true" />}
        </div>
        <div className="hand__tags">
          {label && (
            <span className="hand__total" data-bust={handValue(hand.cards).total > 21 ? 'true' : undefined}>
              {hand.outcome === 'blackjack' ? (
                'Blackjack'
              ) : hand.outcome ? (
                <>
                  {hand.outcome === 'bust' ? handValue(hand.cards).total : label}
                  <span className="hand__label-outcome"> · {OUTCOME_LABELS[hand.outcome]}</span>
                </>
              ) : (
                label
              )}
            </span>
          )}
          <span className="hand__bet">
            <i className="chip" aria-hidden="true" />
            {chips(hand.bet)}
            {hand.doubled ? ' ×2' : ''}
          </span>
        </div>
        <span className="visually-hidden">{`${p.name} hand ${i + 1}`}</span>
      </div>
    );
  }

  function seatView(seat: number, place: { side: 'left' | 'right'; top: number }): ReactNode {
    const p = state.players[seat];
    const net = result ? (result.net[seat] ?? 0) : null;
    const isAway = away?.has(p.uid) ?? false;
    const out = p.stack < state.config.minBet && p.hands.length === 0;
    const badge =
      net !== null && p.hands.length > 0 ? signed(net) : p.lastAction ? ACTION_LABELS[p.lastAction.kind] : '';
    const badgeKind =
      net !== null && p.hands.length > 0 ? (net > 0 ? 'won' : net < 0 ? 'lost' : 'push') : p.lastAction?.kind;
    const onTurn = inRound && state.toAct === seat;
    return (
      <div
        key={p.uid}
        className={`seat seat--${place.side}`}
        style={{ top: `${place.top}%` } as CSSProperties}
        data-turn={onTurn ? 'true' : undefined}
        data-thinking={thinkingSeat === seat ? 'true' : undefined}
        data-out={out ? 'true' : undefined}
        data-idle={p.hands.length === 0 && state.phase !== 'betting' ? 'true' : undefined}
        data-winner={net !== null && net > 0 ? 'true' : undefined}
      >
        <div className="seat__who">
          <div className="seat__avatar">
            <Avatar uid={p.uid} name={p.name} />
            {thinkingSeat === seat && (
              <span className="seat__dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            )}
            {badge && (
              <span className="seat__badge" data-kind={badgeKind}>
                {badge}
              </span>
            )}
          </div>
          <div className="seat__plate">
            <span className="seat__name">{p.name}</span>
            <span className="seat__stack">{out ? 'Out' : isAway ? 'Away' : chips(p.stack)}</span>
          </div>
        </div>
        {p.hands.length > 0 && (
          <div className="seat__hands" data-many={p.hands.length > 1 ? 'true' : undefined}>
            {p.hands.map((h, i) => handView(p, h, i, 'sm', onTurn && p.active === i && p.hands.length > 1))}
          </div>
        )}
      </div>
    );
  }

  // Others in clockwise order starting from the seat on the hero's left.
  const others = Array.from({ length: n - 1 }, (_, i) => (heroSeat + 1 + i) % n);
  const places = seatPlaces(others.length);
  const heroNet = result && hero.hands.length > 0 ? (result.net[heroSeat] ?? 0) : null;
  const heroTurn = inRound && state.toAct === heroSeat;

  // The human's readout under their name.
  let readout = '';
  if (mySeat !== null) {
    if (hero.stack < state.config.minBet && hero.hands.length === 0) readout = 'Out of chips';
    else if (heroNet !== null) readout = heroNet > 0 ? `You win ${chips(heroNet)}` : heroNet < 0 ? `You lose ${chips(-heroNet)}` : 'Push — bet back';
    else if (hero.lastAction?.kind === 'sitout') readout = 'Sitting this round out';
    else if (state.phase === 'betting' && state.toAct === heroSeat) readout = 'Place your bet';
    else if (hero.hands.length > 0 && hero.hands[0].cards.length > 0) {
      const h = hero.hands[hero.active] ?? hero.hands[0];
      readout = totalLabel(h.cards, isBlackjack(h));
    }
  }

  const dealerTotal = state.dealer.length > 0 ? handValue(holeShown ? state.dealer : state.dealer.slice(0, 1)) : null;
  const dealerLabel =
    dealerTotal === null
      ? ''
      : holeShown
        ? result?.dealerBlackjack
          ? 'Blackjack'
          : dealerTotal.total > 21
            ? `Bust ${dealerTotal.total}`
            : String(dealerTotal.total)
        : `Shows ${dealerTotal.total === 11 ? 'an Ace' : dealerTotal.total}`;

  const inPlay = chipsInPlay(state);
  const roundsLeft = state.config.rounds - state.handNo;

  return (
    <main className="table">
      <header className="table__bar">
        <button type="button" className="table__menu" onClick={() => setMenuOpen(true)} aria-label="Menu">
          <span aria-hidden="true">☰</span> Menu
        </button>
        <p className="table__info">
          {state.handNo > 0 && (
            <>
              Round {state.handNo} of {state.config.rounds}
              <span className="table__level"> · bets {chips(state.config.minBet)}–{chips(state.config.maxBet)}</span>
            </>
          )}
        </p>
        {props.tag && <span className="table__tag code-text">{props.tag}</span>}
      </header>

      <div className="felt-wrap">
        <div className="felt">
          <div className="dealer" data-turn={state.phase === 'dealer' ? 'true' : undefined}>
            <div className="dealer__who">
              <span className="dealer__avatar">
                <Avatar uid={DEALER.uid} name={DEALER.name} />
              </span>
              <span className="dealer__name">{DEALER.name}</span>
            </div>
            <div className="dealer__cards" aria-label="Dealer's cards">
              {state.dealer.map((c, i) =>
                i === 1 && !holeShown ? <CardView key={c} faceDown size="md" /> : <CardView key={c} card={c} size="md" />,
              )}
              {state.dealer.length === 0 && (
                <>
                  <span className="hand__gap hand__gap--md" aria-hidden="true" />
                  <span className="hand__gap hand__gap--md" aria-hidden="true" />
                </>
              )}
            </div>
            {dealerLabel && (
              <span className="hand__total dealer__total" data-bust={dealerTotal!.total > 21 ? 'true' : undefined}>
                {dealerLabel}
              </span>
            )}
          </div>

          {others.map((seat, i) => seatView(seat, places[i]))}

          {inPlay > 0 && (
            <p className="felt__inplay">
              <i className="chip" aria-hidden="true" /> {chips(inPlay)} on the table
            </p>
          )}
        </div>

        {/* The hero sits on the near rail, overlapping the felt's lower edge. */}
        <div className="hero" data-turn={heroTurn ? 'true' : undefined} data-winner={heroNet !== null && heroNet > 0 ? 'true' : undefined}>
          <div className="hero__hands" data-many={hero.hands.length > 1 ? 'true' : undefined}>
            {hero.hands.map((h, i) =>
              handView(hero, h, i, hero.hands.length > 1 ? 'md' : 'lg', heroTurn && hero.active === i && hero.hands.length > 1),
            )}
            {hero.hands.length === 0 && <span className="hand__gap hand__gap--lg" aria-hidden="true" />}
          </div>
          <div className="hero__info">
            <span className="hero__name">{mySeat === null ? hero.name : 'You'}</span>
            <span className="hero__stack">{chips(hero.stack)}</span>
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
        {result && settled ? (
          <section className="result" aria-label="Round result">
            <p className="result__line">
              {state.dealer.length === 0
                ? 'Everybody sat this one out.'
                : result.dealerBlackjack
                  ? `${DEALER.name} has blackjack.`
                  : result.dealerTotal > 21
                    ? `${DEALER.name} busts with ${result.dealerTotal} — every hand still in wins.`
                    : `${DEALER.name} stands on ${result.dealerTotal}.`}
              {heroNet !== null && (
                <>
                  {' '}
                  <strong>{heroNet > 0 ? `You win ${chips(heroNet)}.` : heroNet < 0 ? `You lose ${chips(-heroNet)}.` : 'You push.'}</strong>
                </>
              )}
            </p>
            {/* The result stays on screen until someone taps: no timer. */}
            <button type="button" className="btn btn--primary btn--block result__next" disabled={busy} onClick={props.onDeal}>
              {isGameOver(state) ? 'See the final result' : `Deal round ${state.handNo + 1}`}
            </button>
          </section>
        ) : (
          <ActionBar
            // A fresh bar (and a fresh bet amount) for every round.
            key={`${state.handNo}:${state.phase}`}
            legal={legal}
            defaultBet={lastBet}
            status={status}
            busy={busy}
            onMove={onMove}
            extra={
              heroDone && inRound && props.onSkipAhead ? (
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
              ? `Most chips at the table after ${state.handNo} ${state.handNo === 1 ? 'round' : 'rounds'}.`
              : `${state.players[state.winner].name} has the most chips after ${state.handNo} ${state.handNo === 1 ? 'round' : 'rounds'}.`}
            {roundsLeft > 0 && mySeat !== null && hero.stack < state.config.minBet ? ' You ran out of chips.' : ''}
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
          <li className="standings__house">
            <span>{DEALER.name} (the house)</span>
            <span>{state.house >= 0 ? `+${chips(state.house)}` : `−${chips(-state.house)}`}</span>
          </li>
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
