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
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { dealerById } from '@/dealers';
import { CUT_FRACTION, NAG_AFTER, ambientLine, dealerLine, finallyLine, impatienceLine, type Talk } from '@/dealer-talk';
import {
  chipsInPlay,
  handValue,
  holeCardShown,
  isBlackjack,
  isGameOver,
  legalActions,
  maxTip,
  maxTransfer,
  netWorth,
  owed,
  type Card,
  type GameState,
  type Hand,
  type PlayerMove,
  type PlayerState,
  RULES,
  SHOE_SIZE,
} from '@/engine';
import { ActionBar } from '@/components/action-bar';
import { CHIPS } from '@/components/chips';
import { Avatar } from '@/components/avatar';
import { CardView } from '@/components/card';
import { HelpModal } from '@/components/help';
import { Modal } from '@/components/modal';
import { buzz, canVibrate, playChime, useTurnBuzz } from '@/hooks/use-turn-buzz';
import { useSettingsStore } from '@/store/settingsStore';
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
  /**
   * Offline: ask the cat in `seat` for a loan. Returns null if it lent, or
   * what it said when it refused. Absent online, where people lend each
   * other by themselves.
   */
  onAskLoan?: (seat: number, amount: number) => string | null;
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
  tip: 'Tipped!',
  surrender: 'Surrender',
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
  surrender: 'Surrendered',
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

/**
 * The betting spot in front of you while you build a bet: every chip you
 * have pushed, stacked by value (so "three 25s" reads at a glance), with the
 * total in big type.
 */
function BetSpot({ pushed }: { pushed: readonly number[] }) {
  const total = pushed.reduce((a, b) => a + b, 0);
  const stacks = [...CHIPS].reverse().map((value) => ({ value, count: pushed.filter((c) => c === value).length }));
  return (
    <div className="bet-spot" data-empty={pushed.length === 0 ? 'true' : undefined} aria-label={`Your bet: ${chips(total)}`}>
      <div className="bet-spot__stacks" aria-hidden="true">
        {stacks
          .filter((s) => s.count > 0)
          .map((s) => (
            <div key={s.value} className="bet-spot__stack">
              <span className="bet-spot__chips">
                {/* Drawn up to 8 high; the count underneath says the rest. */}
                {Array.from({ length: Math.min(s.count, 8) }, (_, i) => (
                  <i key={i} className="bet-chip bet-chip--mini" data-value={s.value} />
                ))}
              </span>
              <span className="bet-spot__count">
                {s.count}×{s.value}
              </span>
            </div>
          ))}
      </div>
      <span className="bet-spot__total">{pushed.length === 0 ? 'Bet' : chips(total)}</span>
    </div>
  );
}

export function Table(props: TableProps) {
  const { state, mySeat, thinkingSeat = null, away, busy = false, error, onMove } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // The dealer this table voted for (or the player picked): face, name and voice.
  const DEALER = dealerById(state.config.dealer);
  const DEALER_UID = `cat-${DEALER.id}`;
  const voice = DEALER.voice;
  const [tipOpen, setTipOpen] = useState(false);
  // The player whose loan sheet is open, and the last refusal shown in it.
  const [loanSeat, setLoanSeat] = useState<number | null>(null);
  const [loanNote, setLoanNote] = useState<string | null>(null);
  const loansOpen = mySeat !== null && state.phase !== 'idle' && state.phase !== 'gameover';
  const vibrate = useSettingsStore((s) => s.vibrate);
  const setVibrate = useSettingsStore((s) => s.setVibrate);
  const chime = useSettingsStore((s) => s.chime);
  const setChime = useSettingsStore((s) => s.setChime);
  useTurnBuzz(state, mySeat);

  const n = state.players.length;
  const settled = state.phase === 'settled';
  const result = settled || state.phase === 'gameover' ? state.result : null;
  const holeShown = holeCardShown(state);
  // A spectator watches from seat 0's side of the table.
  const heroSeat = mySeat ?? 0;
  const hero = state.players[heroSeat];
  const isMe = (seat: number): boolean => seat === mySeat;
  const nameOf = (seat: number): string => (isMe(seat) ? 'You' : state.players[seat].name);

  // Chips pushed into the betting spot this round, in the order they went in.
  // The first round starts empty; every later one starts with the chips of
  // the last bet placed (so repeating it is one tap), minus chips off the top
  // if the stack can no longer cover it. Keyed by the round, so a new round
  // starts afresh and a Clear within a round sticks.
  const roundKey = `${state.handNo}:${state.phase}`;
  const [lastChips, setLastChips] = useState<number[]>([]);
  const [pushedFor, setPushedFor] = useState<{ key: string; chips: number[] }>({ key: '', chips: [] });
  const rebet = (): number[] => {
    const limit = Math.min(state.config.maxBet, hero.stack);
    const out = [...lastChips];
    while (out.length > 0 && out.reduce((a, b) => a + b, 0) > limit) out.pop();
    return out;
  };
  const pushed = pushedFor.key === roundKey ? pushedFor.chips : rebet();
  const setPushed = (next: number[]): void => setPushedFor({ key: roundKey, chips: next });
  const move = (m: PlayerMove): void => {
    if (m.kind === 'bet' && m.amount > 0) setLastChips([...pushed]);
    onMove(m);
  };

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
  else if (state.phase === 'playing') status = state.toAct === null ? `${DEALER.name} turns ${DEALER.their} card…` : waitingOn('play');
  else if (state.phase === 'dealer') {
    const { total } = handValue(state.dealer);
    status = total > 21 ? `${DEALER.name} busts!` : `${DEALER.name} has ${total}…`;
  }
  const heroDone =
    mySeat !== null &&
    (state.phase === 'betting'
      ? hero.lastAction?.kind === 'bet' || hero.lastAction?.kind === 'sitout' || hero.stack < state.config.minBet
      : hero.hands.every((h) => h.done));
  const inRound = state.phase === 'betting' || state.phase === 'playing' || state.phase === 'dealer';

  // ── Duchess calls the game ───────────────────────────────────────────────
  // Re-derived on each new state (adjusting state during render, React's
  // sanctioned way to follow a prop). A move she has nothing to say about
  // keeps her last line up.
  const [talk, setTalk] = useState<{ version: number; prev: GameState; line: Talk }>(() => ({
    version: state.version,
    prev: state,
    line: ambientLine(voice, state),
  }));
  // She calls players by name ("Sugar" for an unnamed "You").
  const talkName = (seat: number): string => (state.players[seat].name === 'You' ? 'Sugar' : state.players[seat].name);
  // (Declared before the talk update below, which reads it.)
  const [nag, setNag] = useState<{ version: number; level: number }>({ version: state.version, level: 0 });
  if (talk.version !== state.version) {
    // If she was nagging about the last state, a move she has nothing else
    // to say about gets a "Finally." instead of her old line coming back.
    const wasNagging = nag.version === talk.version && nag.level > 0;
    const line = dealerLine(talk.prev, state, talkName, voice) ?? (wasNagging ? finallyLine(voice, state.version) : talk.line);
    setTalk({ version: state.version, prev: state, line });
  }

  // The longer a PERSON takes, the worse she gets: a step up at each of
  // NAG_AFTER seconds with nothing happening. Cats are never slow, so only
  // humans are nagged; once a round is paid and nobody deals the next one,
  // she nags the whole table. Any move resets her (the timers are keyed on
  // the state version).
  const waitSeat =
    (state.phase === 'betting' || state.phase === 'playing') && state.toAct !== null && state.players[state.toAct].isHuman
      ? state.toAct
      : settled
        ? -1
        : null;
  useEffect(() => {
    if (waitSeat === null) return;
    const v = state.version;
    const timers = NAG_AFTER.map((sec, i) => setTimeout(() => setNag({ version: v, level: i + 1 }), sec * 1000));
    return () => timers.forEach(clearTimeout);
  }, [state.version, waitSeat]);
  const nagLevel = nag.version === state.version && waitSeat !== null ? nag.level : 0;
  const said: Talk =
    nagLevel > 0 ? impatienceLine(voice, nagLevel, waitSeat === -1 || waitSeat === null ? null : talkName(waitSeat), state.version) : talk.line;
  const shoeLeft = state.shoe.length / SHOE_SIZE;

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
        <button
          type="button"
          className="seat__who"
          disabled={!loansOpen}
          aria-label={`${p.name}: lend or pay back`}
          onClick={() => {
            setLoanNote(null);
            setLoanSeat(seat);
          }}
        >
          <div className="seat__avatar">
            <Avatar uid={p.uid} name={p.name} />
            {mySeat !== null && owed(state, mySeat, seat) > 0 && (
              <span className="seat__iou" data-kind="owed" title={`${p.name} owes you ${chips(owed(state, mySeat, seat))}`}>
                +{chips(owed(state, mySeat, seat))}
              </span>
            )}
            {mySeat !== null && owed(state, seat, mySeat) > 0 && (
              <span className="seat__iou" data-kind="owe" title={`You owe ${p.name} ${chips(owed(state, seat, mySeat))}`}>
                −{chips(owed(state, seat, mySeat))}
              </span>
            )}
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
        </button>
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

      <div className="talk">
        <span className="talk__avatar" aria-hidden="true">
          <Avatar uid={DEALER_UID} name={DEALER.name} />
        </span>
        <p className="talk__line" aria-live="polite" key={said.text} data-long={said.text.length > 90 ? 'true' : undefined}>
          “{said.text}” <span className="talk__emoji">{said.emoji}</span>
        </p>
        <span
          className="shoe"
          title={`Shoe: ${state.shoe.length} cards left — reshuffle below ${RULES.CUT}`}
          aria-label={`Shoe: ${state.shoe.length} cards left, reshuffle below ${RULES.CUT}`}
        >
          <span className="shoe__label">Shoe</span>
          <span className="shoe__bar">
            <i className="shoe__fill" style={{ width: `${shoeLeft * 100}%` }} data-low={state.shoe.length < RULES.CUT ? 'true' : undefined} />
            <i className="shoe__cut" style={{ left: `${CUT_FRACTION * 100}%` }} />
          </span>
        </span>
      </div>

      <div className="felt-wrap">
        <div className="felt">
          <div className="dealer" data-turn={state.phase === 'dealer' ? 'true' : undefined}>
            <div className="dealer__who">
              <span className="dealer__avatar">
                <Avatar uid={DEALER_UID} name={DEALER.name} />
                {/* The emoji she just sent, popping up beside her. Re-keyed so it pops each time. */}
                <span className="dealer__emoji" key={`${said.text}|${said.emoji}`} aria-hidden="true" data-mad={nagLevel >= 3 ? 'true' : undefined}>
                  {said.emoji}
                </span>
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
            {hero.hands.length === 0 &&
              (legal?.kind === 'bet' ? <BetSpot pushed={pushed} /> : <span className="hand__gap hand__gap--lg" aria-hidden="true" />)}
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
            {mySeat !== null && hero.stack < state.config.minBet && !isGameOver(state) && (
              <p className="result__broke">
                You&apos;re out of chips. Tap a player to {props.onAskLoan ? 'ask for' : 'borrow'} a loan before the next deal —
                otherwise you&apos;re done.
              </p>
            )}
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
            pushed={pushed}
            onPush={(value) => setPushed([...pushed, value])}
            onUndo={() => setPushed(pushed.slice(0, -1))}
            onClear={() => setPushed([])}
            onTip={() => setTipOpen(true)}
            status={status}
            busy={busy}
            onMove={move}
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
            .sort((a, b) => netWorth(state, b.seat) - netWorth(state, a.seat))
            .map(({ p, seat }) => (
              <li key={p.uid}>
                <span>
                  {nameOf(seat)}
                  {p.tipped > 0 && <span className="standings__tips"> · tipped {chips(p.tipped)}</span>}
                  {netWorth(state, seat) !== p.stack && (
                    <span className="standings__tips"> · {chips(p.stack)} in chips, loans {netWorth(state, seat) > p.stack ? '+' : '−'}{chips(Math.abs(netWorth(state, seat) - p.stack))}</span>
                  )}
                </span>
                <span>{chips(netWorth(state, seat))}</span>
              </li>
            ))}
          <li className="standings__house">
            <span>{DEALER.name} (the house)</span>
            <span>{state.house >= 0 ? `+${chips(state.house)}` : `−${chips(-state.house)}`}</span>
          </li>
        </ol>
      </Modal>

      <Modal open={tipOpen && legal?.kind === 'bet'} title={`Tip ${DEALER.name}`} onClose={() => setTipOpen(false)}>
        <div className="stack">
          <p className="tip__note">
            Tips go to the house. {DEALER.name} notices.
            {hero.tipped > 0 && ` You've tipped ${chips(hero.tipped)} so far.`}
          </p>
          <div className="tip__options">
            {[5, 10, 25, 50, 100].map((amount) => (
              <button
                key={amount}
                type="button"
                className="bet-chip tip__chip"
                data-value={amount >= 100 ? 100 : amount >= 50 ? 50 : amount >= 25 ? 25 : 10}
                disabled={busy || amount > maxTip(state, hero)}
                onClick={() => {
                  setTipOpen(false);
                  onMove({ kind: 'tip', amount });
                }}
              >
                {amount}
              </button>
            ))}
          </div>
          {maxTip(state, hero) < 5 && <p className="tip__note">You need to keep the minimum bet — nothing to spare.</p>}
          <button type="button" className="btn btn--ghost btn--block" onClick={() => setTipOpen(false)}>
            Not now
          </button>
        </div>
      </Modal>

      {loanSeat !== null && mySeat !== null && (() => {
        const them = state.players[loanSeat];
        const theyOwe = owed(state, mySeat, loanSeat);
        const iOwe = owed(state, loanSeat, mySeat);
        const spare = maxTransfer(state, mySeat);
        const close = (): void => setLoanSeat(null);
        return (
          <Modal open={loansOpen} title={them.name} onClose={close}>
            <div className="stack loan">
              <p className="tip__note">
                {theyOwe > 0
                  ? `${them.name} owes you ${chips(theyOwe)}.`
                  : iOwe > 0
                    ? `You owe ${them.name} ${chips(iOwe)}.`
                    : `No loans between you and ${them.name}.`}{' '}
                {them.name} has {chips(them.stack)}; you have {chips(hero.stack)}.
              </p>

              {iOwe > 0 && (
                <>
                  <h3 className="loan__heading">Pay back</h3>
                  <div className="tip__options">
                    {[...new Set([Math.min(iOwe, spare), 25, 50, 100].filter((n) => n > 0 && n <= Math.min(iOwe, spare)))]
                      .sort((a, b) => a - b)
                      .map((amount) => (
                        <button
                          key={amount}
                          type="button"
                          className="btn btn--secondary btn--small"
                          disabled={busy}
                          onClick={() => {
                            close();
                            onMove({ kind: 'repay', to: loanSeat, amount });
                          }}
                        >
                          {amount === iOwe ? `All ${chips(amount)}` : chips(amount)}
                        </button>
                      ))}
                  </div>
                </>
              )}

              <h3 className="loan__heading">Lend {them.name}</h3>
              <div className="tip__options">
                {[25, 50, 100, 250, 500].map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    className="bet-chip tip__chip"
                    data-value={amount >= 100 ? 100 : amount >= 50 ? 50 : amount >= 25 ? 25 : 10}
                    disabled={busy || amount > spare}
                    onClick={() => {
                      close();
                      onMove({ kind: 'loan', to: loanSeat, amount });
                    }}
                  >
                    {amount}
                  </button>
                ))}
              </div>

              {props.onAskLoan && !them.isHuman && (
                <>
                  <h3 className="loan__heading">Ask {them.name} for</h3>
                  <div className="tip__options">
                    {[50, 100, 250, 500].map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        className="btn btn--secondary btn--small"
                        onClick={() => {
                          const refused = props.onAskLoan!(loanSeat, amount);
                          if (refused === null) close();
                          else setLoanNote(`${them.name}: “${refused}”`);
                        }}
                      >
                        {amount}
                      </button>
                    ))}
                  </div>
                  {loanNote && <p className="loan__refused">{loanNote}</p>}
                </>
              )}
              <button type="button" className="btn btn--ghost btn--block" onClick={close}>
                Done
              </button>
            </div>
          </Modal>
        );
      })()}

      <Modal open={menuOpen} title="Menu" onClose={() => setMenuOpen(false)}>
        <div className="stack">
          {state.debts.length > 0 && (
            <div className="loans">
              <h3 className="loan__heading">Loans</h3>
              <ul>
                {state.debts.map((d) => (
                  <li key={`${d.lender}>${d.borrower}`}>
                    <strong>{nameOf(d.borrower)}</strong> {isMe(d.borrower) ? 'owe' : 'owes'} <strong>{isMe(d.lender) ? 'you' : nameOf(d.lender)}</strong>{' '}
                    {chips(d.amount)}
                  </li>
                ))}
              </ul>
            </div>
          )}
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
          <button
            type="button"
            role="switch"
            aria-checked={chime}
            className="btn btn--secondary btn--block"
            onClick={() => {
              setChime(!chime);
              // Turning it on plays it once, so you know what to listen for.
              if (!chime) playChime();
            }}
          >
            Chime on my turn: {chime ? 'On' : 'Off'}
          </button>
          {canVibrate() && (
            <button
              type="button"
              role="switch"
              aria-checked={vibrate}
              className="btn btn--secondary btn--block"
              onClick={() => {
                setVibrate(!vibrate);
                // Turning it on buzzes once, so you can tell it works.
                if (!vibrate) buzz();
              }}
            >
              Vibrate on my turn: {vibrate ? 'On' : 'Off'}
            </button>
          )}
          {canVibrate() && vibrate && (
            <p className="table__menu-note">Your phone stays still while it is on silent.</p>
          )}
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
