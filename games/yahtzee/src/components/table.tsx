/**
 * THE play surface. One component renders both online play and pass-and-play.
 *
 * It imports NO store. Everything it needs arrives as props, which is what makes
 * the two modes impossible to drift apart: `gameStore` and `localStore` expose
 * the same overlapping shape, both routes hand it to this file, and a change to
 * the table lands on both by construction. The moment this file reaches for
 * `useGameStore`, pass-and-play stops working on a build with no Firebase config
 * (localStore is deliberately free of `@/fb` imports, even transitively) and
 * every future feature has to be built twice.
 *
 * It also derives NO RULES. What is playable comes from `legalMoves` and
 * `legalCategories` — the engine's only statement of legality, the same one the
 * reducer and the fuzz test read. A local re-implementation ("you can roll if
 * rollsUsed < 3") is how a UI ends up offering a move the server then rejects.
 */
import {
  RULES,
  breakdown,
  legalCategories,
  legalMoves,
  type Category,
  type GameState,
  type Seat,
} from '@/engine';
// TYPE-ONLY, and it must stay that way: a value import from '@/fb' here would
// pull Firebase into the pass-and-play bundle and break offline play. With
// `verbatimModuleSyntax` this line is erased entirely at compile time.
import type { PresenceEntry } from '@/net/rooms';
import { DiceTray } from '@/components/dice-tray';
import { Scorecard } from '@/components/scorecard';
import { Modal } from '@/components/modal';
import './table.css';

export interface TableProps {
  state: GameState;
  /** Our seat, or null when watching a game we are not seated in. */
  mySeat: Seat | null;
  /** Indices of the dice WE are holding. Local UI state, never a move. */
  holds: number[];
  /** A move is in flight. Every control that submits one must be disabled. */
  pending: boolean;
  /** Actionable prose, already written for a human. Rendered verbatim. */
  error: string | null;
  /** Online only; absent in pass-and-play, where everyone is at the table. */
  presence?: Record<string, PresenceEntry>;
  /**
   * Rematch vote tally for the game-over sheet.
   *
   * REQUIRED, not optional, and pass-and-play supplies a trivially satisfied
   * one (`{ voted: false, count: 0, total: 1 }`) rather than omitting it — the
   * whole point of this component is that it needs no online/local branch. The
   * progress line keys off `total > 1`, which is a fact about the number of
   * players, not about which store is driving.
   */
  rematch: { voted: boolean; count: number; total: number };
  /** Already combines the in-app setting with the OS reduced-motion veto. */
  motion: boolean;
  /** `keep` is the indices to hold back. The caller attaches the roll seed. */
  onRoll: (keep: number[]) => void;
  onScore: (category: Category) => void;
  onToggleHold: (index: number) => void;
  onRematch: () => void;
  onLeave: () => void;
}

export function Table({
  state,
  mySeat,
  holds,
  pending,
  error,
  presence,
  rematch,
  motion,
  onRoll,
  onScore,
  onToggleHold,
  onRematch,
  onLeave,
}: TableProps) {
  const myUid = mySeat === null ? null : (state.players[mySeat]?.uid ?? null);

  // ── Legality, entirely from the engine ───────────────────────────────────
  const kinds = myUid ? legalMoves(state, myUid) : [];
  const canRoll = kinds.includes('roll') && !pending;
  const canScore = kinds.includes('score') && !pending;
  const canRematch = kinds.includes('rematch') && !pending;

  /*
   * Computed for `state.turn`, not for `mySeat`: the scorecard previews the
   * dice for whoever is on turn, and `interactive` is what decides whether the
   * viewer may actually pick one.
   *
   * No phase check here any more — `legalCategories` is phase-gated in the
   * engine, so it returns [] outside 'decide' on its own. The ternary that used
   * to live on this line was a rule restated in the UI, and the second caller
   * who forgot it would have shipped a scorecard previewing an empty roll.
   */
  const legal = legalCategories(state, state.turn);

  /*
   * THE held-dice SET. Both the tray's display AND the roll payload read this
   * one expression, which is the fix: `keep` used to be clamped while
   * `held={holds}` was not, so a turn could open with amber rings and "HELD"
   * tags over blank dice that the roll then silently ignored.
   *
   * The engine rejects a roll whose `keep` is non-empty before the first roll of
   * a turn, and holds are cleared on a turn change anyway — but "anyway" is not
   * a guarantee when the holds arrive over the network from a sibling RTDB node
   * that may lag a move behind. gameStore now drops holds belonging to anyone
   * but the player on turn and clears our own after a score or rematch; this
   * clamp is the last of the three belts, and together they restore the
   * local/online parity this shared component depends on.
   *
   * (Keeping all five is the other rejected roll. DiceTray disables its own
   * button for that case and says why, so it is not re-checked here.)
   */
  const keep = state.rollsUsed === 0 ? [] : holds;

  const onTurn = state.players[state.turn];
  const myTurn = myUid !== null && myUid === state.turnUid;
  const rollsLeft = RULES.ROLLS_PER_TURN - state.rollsUsed;

  /*
   * The last-roll pressure state, as a fact the stylesheet can see.
   *
   * `bannerText` has always produced a distinct "Last roll — pick a box to
   * score" string for this, and it was styled identically to every other turn —
   * so the one moment in a turn where the player has no way out read exactly
   * like the two moments where they do. This drives --warn on the banner.
   *
   * MUST match bannerText's `rollsLeft === 0` branch. Kept as one expression
   * beside it rather than re-derived in CSS from something else, so the colour
   * and the wording cannot disagree. (`myTurn` implies a seat, and rollsLeft
   * reaching 0 implies rollsUsed > 0, so the earlier branches are covered.)
   */
  const lastRoll = state.phase !== 'over' && myTurn && rollsLeft === 0;

  return (
    <main className="table">
      <div className="table__inner">
        <header className="table__header">
          <div className="table__round">
            {state.phase === 'over'
              ? 'Final'
              : `Round ${Math.min(state.round, RULES.ROUNDS)} of ${RULES.ROUNDS}`}
          </div>
          <button type="button" className="btn btn--ghost btn--small" onClick={onLeave}>
            Leave
          </button>
        </header>

        <Seats state={state} mySeat={mySeat} presence={presence} />

        {/* `aria-live` so a screen-reader player is told the turn changed; this
            banner is the only thing on the page that announces it. `polite`
            rather than `assertive` — it must not interrupt a cell being read. */}
        <p
          className="table__banner"
          data-mine={myTurn ? 'true' : undefined}
          data-last-roll={lastRoll ? 'true' : undefined}
          role="status"
          aria-live="polite"
        >
          {bannerText({ state, myTurn, mySeat, onTurnName: onTurn?.name ?? 'Player', rollsLeft })}
        </p>

        {/*
         * The tray owns the Roll button, the rolls-left counter and the roll
         * hint. That is deliberate: the "keeping every die is not a roll"
         * rejection is a property of the dice, so the control that can trigger
         * it and the dice that explain it stay in one component.
         */}
        <DiceTray
          dice={state.dice}
          held={keep}
          rollsUsed={state.rollsUsed}
          canRoll={canRoll}
          // Only the player on turn may toggle holds; everyone else sees the
          // same dice and HELD rings read-only.
          canToggleHold={myTurn}
          canScore={canScore}
          motion={motion}
          onToggleHold={onToggleHold}
          onRoll={() => onRoll(keep)}
        />

        <Scorecard
          state={state}
          mySeat={mySeat}
          legal={legal}
          interactive={canScore}
          onPick={onScore}
        />

        {error && (
          <p className="notice notice--bad table__error" role="alert">
            {error}
          </p>
        )}
      </div>

      <GameOver
        state={state}
        mySeat={mySeat}
        canRematch={canRematch}
        rematch={rematch}
        onRematch={onRematch}
        onLeave={onLeave}
      />
    </main>
  );
}

// ── Banner prose ───────────────────────────────────────────────────────────
//
// Split out as a pure function so the JSX above stays readable and so the
// wording of every state is visible in one place rather than as five nested
// ternaries inside a tag.

function bannerText(args: {
  state: GameState;
  myTurn: boolean;
  mySeat: Seat | null;
  onTurnName: string;
  rollsLeft: number;
}): string {
  const { state, myTurn, mySeat, onTurnName, rollsLeft } = args;
  if (state.phase === 'over') return 'Game over';
  if (mySeat === null) return `Watching — ${onTurnName} to play`;
  if (!myTurn) return `${onTurnName} is playing`;
  if (state.rollsUsed === 0) return 'Your turn — roll the dice';
  if (rollsLeft === 0) return 'Last roll — pick a box to score';
  return `Your turn — ${rollsLeft} ${rollsLeft === 1 ? 'roll' : 'rolls'} left`;
}

// ── Seat strip ─────────────────────────────────────────────────────────────

/**
 * Names, running totals and who is on turn.
 *
 * The totals come from `breakdown()` rather than being summed here: the upper
 * bonus and the Yahtzee bonuses are both conditional, and a second
 * implementation of that arithmetic would be a second thing to keep correct.
 */
function Seats(props: {
  state: GameState;
  mySeat: Seat | null;
  presence?: Record<string, PresenceEntry>;
}) {
  const { state, mySeat, presence } = props;
  return (
    <ul className="table__seats">
      {state.players.map((player, seat) => {
        const total = breakdown(state.cards[seat], state.yahtzeeBonus[seat] ?? 0).total;
        // No presence map at all means pass-and-play, where "online" is not a
        // concept. A missing ENTRY inside a present map means the sibling node
        // has not landed yet, which is treated as online — flagging a player who
        // just joined as away is the worse of the two wrong answers.
        const away = presence !== undefined && presence[player.uid]?.online === false;
        return (
          <li
            key={player.uid}
            className="table__seat"
            data-turn={seat === state.turn ? 'true' : undefined}
            data-mine={seat === mySeat ? 'true' : undefined}
          >
            <span className="table__seat-name">{player.name}</span>
            <span className="table__seat-total">{total}</span>
            {away && <span className="table__seat-away">away</span>}
          </li>
        );
      })}
    </ul>
  );
}

// ── Game over ──────────────────────────────────────────────────────────────

/**
 * The end-of-game sheet.
 *
 * `dismissible={false}`: there is nothing to go back to underneath — the game
 * is finished and every control on the table is already disabled — so closing
 * it would leave the player on a dead screen with no way to ask for a rematch.
 * The two footer buttons are the whole of what happens next.
 */
function GameOver(props: {
  state: GameState;
  mySeat: Seat | null;
  canRematch: boolean;
  rematch: { voted: boolean; count: number; total: number };
  onRematch: () => void;
  onLeave: () => void;
}) {
  const { state, mySeat, canRematch, rematch, onRematch, onLeave } = props;
  const result = state.result;
  // `result` is non-null exactly when phase is 'over', but both are checked:
  // the type says so and a damaged snapshot must not render an empty sheet.
  const open = state.phase === 'over' && result !== null;

  // `winners` holds every seat tied for the top score, so this is a real plural.
  const winnerNames = result ? result.winners.map((s) => state.players[s]?.name ?? 'Player') : [];
  const iWon = result !== null && mySeat !== null && result.winners.includes(mySeat);
  const tied = result !== null && result.winners.length > 1;

  const title = !result
    ? 'Game over'
    : iWon
      ? tied
        ? 'A tie!'
        : 'You win'
      : winnersLine(winnerNames);

  // Ranked copy. `map` already produces a new array, so sorting it cannot
  // reorder `state.players` — but the intermediate is named for that reason.
  const ranked = result
    ? state.players
        .map((player, seat) => ({ player, seat, score: result.scores[seat] }))
        .sort((a, b) => (b.score?.total ?? 0) - (a.score?.total ?? 0))
    : [];

  /*
   * REMATCH IS A VOTE, and it needs to look like one.
   *
   * Online, `voteRematch` only submits the real move once EVERY seated player
   * has voted. Driving the button off `legalMoves` alone made it stay enabled
   * and the screen stay put for the first player to tap — no acknowledgement,
   * no indication anything was pending, and the obvious next move is to tap it
   * again. So the button reports our own vote and a line reports the tally.
   *
   * `total > 1` rather than a mode flag: with one seat (solo online, or
   * pass-and-play) the vote is unanimous the instant it is cast, so there is
   * nothing to wait for and the line would be noise.
   */
  const voteInProgress = rematch.total > 1 && rematch.count > 0 && rematch.count < rematch.total;

  return (
    <Modal
      open={open}
      title={title}
      dismissible={false}
      footer={
        <>
          {/* A spectator has no seat, so `legalMoves` gives them no rematch and
              the button is not rendered at all rather than shown disabled. */}
          {mySeat !== null && (
            <button
              type="button"
              className="btn btn--primary btn--block"
              // Disabled once WE have voted: the vote is recorded and a second
              // tap does nothing but write the same tombstone again.
              disabled={!canRematch || rematch.voted}
              onClick={onRematch}
            >
              {rematch.voted ? 'Waiting for the others…' : 'Play again'}
            </button>
          )}
          <button type="button" className="btn btn--ghost btn--block" onClick={onLeave}>
            Leave
          </button>
        </>
      }
    >
      {/* `aria-live` so the tally is announced as other players vote — this
          sheet is modal, so it is the only thing a screen reader can hear. */}
      {voteInProgress && (
        <p className="table__banner" role="status" aria-live="polite">
          {`${rematch.count} of ${rematch.total} players want to play again — waiting for the rest…`}
        </p>
      )}

      <ol className="table__results">
        {ranked.map(({ player, seat, score }) => (
          <li
            key={player.uid}
            className="table__result"
            data-won={result?.winners.includes(seat) ? 'true' : undefined}
          >
            <span className="table__result-name">{player.name}</span>
            <span className="table__result-detail">
              {score?.upper ?? 0} upper
              {score && score.bonus > 0 ? ` +${score.bonus} bonus` : ''}
              {` · ${score?.lower ?? 0} lower`}
              {score && score.yahtzeeBonus > 0 ? ` +${score.yahtzeeBonus} Yahtzee bonus` : ''}
            </span>
            <span className="table__result-total">{score?.total ?? 0}</span>
          </li>
        ))}
      </ol>
    </Modal>
  );
}

function winnersLine(names: string[]): string {
  if (names.length === 0) return 'Game over';
  if (names.length === 1) return `${names[0]} wins`;
  if (names.length === 2) return `${names[0]} and ${names[1]} tie`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} tie`;
}

export default Table;
