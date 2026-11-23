/**
 * The playing screen, shared by the cats and online rooms: the players and
 * their scores, one line saying what is happening, the table (stock, pile and
 * the suit to follow), your hand, and — between rounds — the round's result
 * with "Deal the next round" / "Play again".
 *
 * Presentational: it knows nothing about stores or the network. The routes
 * pass in the state and the callbacks, and add the seeds that draws and deals
 * need.
 *
 * Only this device's own hand is ever drawn face up. Online the whole state
 * is readable by every seated player (see AGENTS.md on the trust model); this
 * is the one place that decides what is shown.
 */
import { useState } from 'react';
import {
  SUITS,
  SUIT_NAMES,
  canDraw,
  canPass,
  canPlay,
  cardName,
  drawable,
  gameWinner,
  handPoints,
  isWild,
  roundPoints,
  roundWinner,
  sortHand,
  split,
  topCard,
  type GameState,
  type LastMove,
  type Suit,
} from '@/engine';
import { Avatar } from '@/components/avatar';
import { CardBack, CardFace, SuitMark } from '@/components/cards';
import { HelpModal } from '@/components/help';
import { Modal } from '@/components/modal';
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
  onPlay: (card: string, suit?: Suit) => void;
  onDraw: () => void;
  onPass: () => void;
  /** Deal the next round, or start a new game when this one is over. */
  onNext: () => void;
  onLeave: () => void;
  leaveLabel: string;
}

function nameFor(state: GameState, seat: number, mySeat: number | null): string {
  return seat === mySeat ? 'You' : (state.players[seat]?.name ?? 'Player');
}

const cardsWord = (n: number) => (n === 1 ? '1 card' : `${n} cards`);

function statusLine(state: GameState, mySeat: number | null, thinkingSeat: number | null): string {
  if (state.phase === 'gameover') {
    const won = gameWinner(state);
    if (won === null) return 'Game over';
    return won === mySeat ? 'You win the game!' : `${nameFor(state, won, mySeat)} wins the game`;
  }
  if (state.phase === 'roundover') {
    const won = roundWinner(state);
    if (won === null) return 'Round over';
    return won === mySeat ? 'You went out!' : `${nameFor(state, won, mySeat)} went out`;
  }
  const seat = state.toAct as number;
  if (seat === mySeat) {
    if (state.drew) return 'Play a card, or pass';
    return 'Your turn — match the pile, or draw';
  }
  const name = nameFor(state, seat, mySeat);
  if (thinkingSeat === seat) return `${name} is thinking…`;
  if (state.players[seat].sitOut) return `${name} is away — the game will play for them`;
  return `${name}’s turn`;
}

/** One short line about the move just made, so a cat's turn can be followed. */
function lastLine(state: GameState, mySeat: number | null): string | null {
  const m: LastMove = state.lastMove;
  const who = nameFor(state, m.seat, mySeat);
  const named = m.suit ? ` and named ${SUIT_NAMES[m.suit].many}` : '';
  switch (m.kind) {
    case 'play':
      return `${who} played ${cardName(m.card ?? topCard(state))}${named}.`;
    case 'draw':
      return `${who} drew a card.`;
    case 'pass':
      return `${who} passed.`;
    case 'away':
      return m.card
        ? `${who} is away, so the table played ${cardName(m.card)}${named} for them.`
        : `${who} is away, so the table drew for them.`;
    case 'deal':
      return `Round ${state.round}. ${who} ${m.seat === mySeat ? 'lead' : 'leads'}.`;
    case 'start':
    case 'rematch':
      return `First to ${state.config.target} points. ${who} ${m.seat === mySeat ? 'lead' : 'leads'}.`;
    default:
      return null;
  }
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
  onPlay,
  onDraw,
  onPass,
  onNext,
  onLeave,
  leaveLabel,
}: GameViewProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  // An eight waiting for its suit belongs to one position: it lapses when the state moves on.
  const [naming, setNaming] = useState<{ card: string; version: number } | null>(null);
  const eight = naming !== null && naming.version === state.version ? naming.card : null;

  const playing = state.phase === 'playing';
  const myTurn = mySeat !== null && playing && state.toAct === mySeat;
  const canAct = myTurn && !busy;
  const hand = mySeat !== null ? sortHand(split(state.players[mySeat].hand)) : [];
  const top = topCard(state);
  const followSuit = state.suit;
  const roundWon = playing ? null : roundWinner(state);
  const left = drawable(state);

  function choose(card: string): void {
    if (!canAct || !canPlay(state, card)) return;
    if (isWild(card) && hand.length > 1) {
      setNaming({ card, version: state.version });
      return;
    }
    onPlay(card);
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
            `Round ${state.round} · to ${state.config.target}`
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
          const count = p.hand.length / 2;
          return (
            <li
              key={p.uid}
              className="score"
              data-seat={seat}
              data-turn={state.toAct === seat ? 'true' : 'false'}
              data-winner={roundWon === seat ? 'true' : 'false'}
              data-thinking={thinkingSeat === seat ? 'true' : 'false'}
            >
              <span className="score__avatar">
                <Avatar uid={p.uid} name={p.name} />
              </span>
              <span className="score__name">
                {nameFor(state, seat, mySeat)}
                {gone && <span className="score__away">away</span>}
              </span>
              <span className="score__points" aria-label={`${p.score} points`}>
                {p.score}
                <span className="score__unit" aria-hidden="true">
                  pts
                </span>
              </span>
              <span className="score__cards" aria-label={cardsWord(count)}>
                <span className="score__fan" aria-hidden="true" />
                {count}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="play__lines">
        <p className="play__status" role="status" data-seat={state.toAct ?? roundWon ?? undefined}>
          {statusLine(state, mySeat, thinkingSeat)}
        </p>
        <p className="play__last">{lastLine(state, mySeat)}</p>
      </div>

      <section className="felt" aria-label="The table" data-myturn={myTurn ? 'true' : 'false'}>
        <button
          type="button"
          className="felt__stock"
          onClick={onDraw}
          disabled={!canAct || !canDraw(state)}
          aria-label={left > 0 ? `Draw a card (${cardsWord(left)} left)` : 'Nothing left to draw'}
        >
          {left > 0 ? <CardBack size="large" /> : <span className="card card--large felt__empty" aria-hidden="true" />}
          <span className="felt__count">{state.stock.length > 0 ? `${state.stock.length / 2} to draw` : left > 0 ? 'shuffle in' : 'empty'}</span>
        </button>

        <div className="felt__pile" aria-label={`On the pile: ${cardName(top)}`}>
          <span className="felt__stack">
            {split(state.pile)
              .slice(-3, -1)
              .map((c, i) => (
                <span key={`${c}${i}`} className="felt__under" data-i={i}>
                  <CardFace card={c} size="large" />
                </span>
              ))}
            <span className="felt__top" key={top}>
              <CardFace card={top} size="large" />
            </span>
          </span>
        </div>

        <div className="felt__follow" aria-label={`Suit to follow: ${SUIT_NAMES[followSuit].many}`}>
          <span className="felt__follow-label">Follow</span>
          <span className="suit-chip">
            <SuitMark suit={followSuit} />
          </span>
          <span className="felt__follow-name">{SUIT_NAMES[followSuit].many}</span>
        </div>
      </section>

      {mySeat !== null && playing && (
        <section className="hand" aria-label="Your hand" data-myturn={myTurn ? 'true' : 'false'}>
          <ul className="hand__cards">
            {hand.map((c) => {
              const ok = canPlay(state, c);
              return (
                <li key={c}>
                  <button
                    type="button"
                    className="hand__card"
                    data-ok={myTurn && ok ? 'true' : 'false'}
                    disabled={!canAct || !ok}
                    onClick={() => choose(c)}
                    aria-label={`${cardName(c)}${myTurn && !ok ? ', does not fit' : ''}`}
                  >
                    <CardFace card={c} />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="hand__actions">
            {myTurn && canDraw(state) && (
              <button type="button" className="btn btn--secondary" onClick={onDraw} disabled={busy}>
                Draw a card
              </button>
            )}
            {myTurn && canPass(state) && (
              <button type="button" className="btn btn--secondary" onClick={onPass} disabled={busy}>
                Pass
              </button>
            )}
            {myTurn && !canDraw(state) && !canPass(state) && (
              <p className="play__hint-line">Tap a card that matches the pile.</p>
            )}
          </div>
        </section>
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

      {!playing && (
        <section className="panel play__over" aria-label="Round result">
          <p className="play__result">
            {roundWon === null
              ? 'Round over.'
              : state.players[roundWon].hand.length === 0
                ? `${nameFor(state, roundWon, mySeat)} ${roundWon === mySeat ? 'score' : 'scores'} ${roundPoints(state)} for the cards left in everyone else’s paws.`
                : `Nothing left to draw: ${nameFor(state, roundWon, mySeat)} ${roundWon === mySeat ? 'hold' : 'holds'} the fewest points and ${roundWon === mySeat ? 'score' : 'scores'} ${roundPoints(state)}.`}
          </p>
          <ul className="over__hands">
            {state.players.map((p, seat) =>
              seat === roundWon && p.hand.length === 0 ? null : (
                <li key={p.uid} className="over__row" data-seat={seat}>
                  <span className="over__name">{nameFor(state, seat, mySeat)}</span>
                  <span className="over__cards">
                    {sortHand(split(p.hand)).map((c) => (
                      <CardFace key={c} card={c} size="small" />
                    ))}
                  </span>
                  <span className="over__points">{handPoints(p.hand)}</span>
                </li>
              ),
            )}
          </ul>
          <div className="stack">
            <button type="button" className="btn btn--primary btn--block" onClick={onNext} disabled={busy}>
              {state.phase === 'gameover' ? 'Play again' : 'Deal the next round'}
            </button>
            <p className="field__hint play__hint">
              {state.phase === 'gameover'
                ? `Scores go back to nought; the next player along leads.`
                : `First to ${state.config.target} wins. The next player along leads.`}
            </p>
          </div>
        </section>
      )}

      <Modal open={eight !== null} title="Name the next suit" onClose={() => setNaming(null)}>
        <div className="namer">
          <p className="namer__text">Your tabby eight is wild. Which suit must the next player follow?</p>
          <div className="namer__grid">
            {SUITS.map((s) => {
              const held = hand.filter((c) => c !== eight && !isWild(c) && c[0] === s).length;
              return (
                <button
                  key={s}
                  type="button"
                  className="namer__suit"
                  onClick={() => {
                    if (eight) onPlay(eight, s);
                    setNaming(null);
                  }}
                >
                  <span className="suit-chip suit-chip--big">
                    <SuitMark suit={s} />
                  </span>
                  <span className="namer__name">{SUIT_NAMES[s].many}</span>
                  <span className="namer__held">you hold {held}</span>
                </button>
              );
            })}
          </div>
        </div>
      </Modal>

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </main>
  );
}
