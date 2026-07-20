/**
 * The scorecard: 13 categories x 1..4 players, with the upper subtotal/bonus
 * and the running total.
 *
 * The one affordance that makes a Yahtzee UI feel good is the PREVIEW: for the
 * player on turn, every still-open box shows what the dice currently on the
 * table would score in it. Without it, a player has to do thirteen bits of
 * mental arithmetic every turn. Previews are drawn in the accent colour and
 * italic so they never read as a committed score.
 *
 * The other thing this component has to get right is that `0` is a USED box —
 * a scratched category — not an empty one. Empty and scratched are drawn
 * completely differently, and the scratched cell says "scratched" to a screen
 * reader rather than "0".
 *
 * Presentational: props in, `onPick` out. No store, no move construction.
 */

import { LOWER_CATEGORIES, RULES, UPPER_CATEGORIES, breakdown, previewFor } from '@/engine';
import type { Category, GameState, Seat } from '@/engine';
import './scorecard.css';

/**
 * Human labels.
 *
 * Kept private because the file contract for this component lists only the
 * component itself, and exporting a non-component from a component module also
 * breaks React Fast Refresh. If another screen needs to name a category (the
 * game log narrating `lastMove`, say), lift this table into its own module
 * rather than re-typing it — thirteen strings in two places will drift.
 */
const CATEGORY_LABELS: Record<Category, string> = {
  ones: 'Ones',
  twos: 'Twos',
  threes: 'Threes',
  fours: 'Fours',
  fives: 'Fives',
  sixes: 'Sixes',
  threeKind: 'Three of a kind',
  fourKind: 'Four of a kind',
  fullHouse: 'Full house',
  smallStraight: 'Small straight',
  largeStraight: 'Large straight',
  yahtzee: 'Yahtzee',
  chance: 'Chance',
};

/** The fixed-value boxes, shown as a hint so nobody has to remember them. */
const CATEGORY_HINTS: Partial<Record<Category, string>> = {
  fullHouse: String(RULES.FULL_HOUSE),
  smallStraight: String(RULES.SMALL_STRAIGHT),
  largeStraight: String(RULES.LARGE_STRAIGHT),
  yahtzee: String(RULES.YAHTZEE),
  threeKind: 'sum',
  fourKind: 'sum',
  chance: 'sum',
};

export interface ScorecardProps {
  /**
   * The whole state, rather than players/cards/dice/turn/yahtzeeBonus as five
   * parallel props. Preview numbers come from `previewFor(state, ...)`, which
   * needs the state anyway, and five props that must all describe the SAME
   * snapshot are five chances to hand this component a torn one.
   */
  state: GameState;
  /** The viewer's seat, or null when spectating. */
  mySeat: Seat | null;
  /** `legalCategories(state, turn)` — the ONLY statement of what is pickable. */
  legal: Category[];
  /** Whether picking is enabled at all (false while a move is in flight). */
  interactive: boolean;
  onPick: (category: Category) => void;
}

/** A cell holds a committed score exactly when it is a finite number. */
function isUsed(value: number | null): value is number {
  // NOT `value ? ... : ...` and NOT `!!value`: a scratched box holds 0, which
  // is falsy but absolutely used. This guard is the whole trap in one line.
  return typeof value === 'number' && Number.isFinite(value);
}

export function Scorecard({ state, mySeat, legal, interactive, onPick }: ScorecardProps) {
  const { players, cards, yahtzeeBonus, turn, dice } = state;
  // Only a complete roll can be scored, so previews and pickability both hang
  // off this rather than off `dice.length > 0`.
  const diceReady = dice.length === RULES.DICE;
  const myTurn = mySeat !== null && mySeat === turn;
  const legalSet = new Set(legal);

  const totals = cards.map((card, seat) => breakdown(card, yahtzeeBonus[seat] ?? 0));

  /**
   * The joker rule narrowed the choice. Say what it narrowed it TO — an
   * explanation a player can act on beats a greyed-out box with no reason.
   */
  const jokerReason =
    legal.length > 0
      ? `Joker rule: this Yahtzee has to go in ${legal
          .map((c) => CATEGORY_LABELS[c])
          .join(', ')}.`
      : 'This box is not available for the current dice.';

  function renderCell(cat: Category, seat: Seat) {
    const card = cards[seat];
    const value = card?.[cat] ?? null;

    if (isUsed(value)) {
      // A scratched box gets its own glyph, its own colour, and its own
      // accessible text. Drawing it as "0" next to a genuinely empty cell is
      // how players end up thinking they still have the box.
      const scratched = value === 0;
      return (
        <span
          className="sc__value"
          data-scratched={scratched ? 'true' : undefined}
          aria-label={
            scratched
              ? `${CATEGORY_LABELS[cat]}: scratched, 0 points`
              : `${CATEGORY_LABELS[cat]}: ${value}`
          }
        >
          {scratched ? '—' : value}
        </span>
      );
    }

    // Open box, and not the seat on turn: nothing to say yet.
    if (seat !== turn || !diceReady) {
      return <span className="sc__empty" aria-label="open" />;
    }

    // Joker rules can force this Yahtzee elsewhere. `legal` is authoritative.
    const forbidden = !legalSet.has(cat);
    if (forbidden) {
      return (
        <span className="sc__value" data-forbidden="true" title={jokerReason} aria-label={jokerReason}>
          {'–'}
        </span>
      );
    }

    // The engine owns the joker predicate. This used to recompute
    // `isYahtzee(dice) && card.yahtzee !== null` inline — a second copy of a
    // rule the reducer states privately, which is exactly how a preview starts
    // promising points the reducer will not pay.
    const preview = previewFor(state, seat, cat);
    const pickable = interactive && myTurn;

    if (!pickable) {
      return (
        <span className="sc__value" data-preview="true" aria-label={`would score ${preview}`}>
          {preview}
        </span>
      );
    }

    return (
      <button
        type="button"
        className="sc__pick"
        onClick={() => onPick(cat)}
        aria-label={`Score ${preview} in ${CATEGORY_LABELS[cat]}`}
      >
        <span className="sc__value" data-preview="true">
          {preview}
        </span>
      </button>
    );
  }

  function renderRows(list: readonly Category[]) {
    return list.map((cat) => (
      <tr key={cat} className="sc__row">
        <th scope="row" className="sc__label">
          <span className="sc__label-text">{CATEGORY_LABELS[cat]}</span>
          {CATEGORY_HINTS[cat] ? (
            <span className="sc__label-hint">{CATEGORY_HINTS[cat]}</span>
          ) : null}
        </th>
        {players.map((p, seat) => (
          <td
            key={p.uid}
            className="sc__cell"
            data-turn={seat === turn ? 'true' : undefined}
            data-mine={seat === mySeat ? 'true' : undefined}
          >
            {renderCell(cat, seat)}
          </td>
        ))}
      </tr>
    ));
  }

  function renderDerivedRow(
    key: string,
    label: string,
    hint: string | null,
    valueFor: (seat: Seat) => string,
  ) {
    return (
      <tr key={key} className="sc__row sc__row--derived">
        <th scope="row" className="sc__label">
          <span className="sc__label-text">{label}</span>
          {hint ? <span className="sc__label-hint">{hint}</span> : null}
        </th>
        {players.map((p, seat) => (
          <td
            key={p.uid}
            className="sc__cell"
            data-turn={seat === turn ? 'true' : undefined}
            data-mine={seat === mySeat ? 'true' : undefined}
          >
            <span className="sc__value">{valueFor(seat)}</span>
          </td>
        ))}
      </tr>
    );
  }

  return (
    /*
     * The scroll container. With four players the table is wider than a phone,
     * and the page body must NEVER scroll sideways — a horizontally scrolling
     * document on iOS lets you drag the whole app off screen. So the overflow
     * lives here, on the table's own wrapper, and the label column is sticky so
     * you always know which row you are reading.
     */
    <div className="sc" role="region" aria-label="Scorecard" tabIndex={0}>
      <table className="sc__table">
        <caption className="visually-hidden">
          Scorecard. Open boxes on the current player's column show what the dice on the table
          would score.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="sc__label sc__corner">
              <span className="visually-hidden">Category</span>
            </th>
            {players.map((p, seat) => (
              <th
                key={p.uid}
                scope="col"
                className="sc__player"
                data-turn={seat === turn ? 'true' : undefined}
                data-mine={seat === mySeat ? 'true' : undefined}
              >
                <span className="sc__player-name">{p.name}</span>
                {seat === turn ? <span className="sc__player-turn">to play</span> : null}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {renderRows(UPPER_CATEGORIES)}
          {renderDerivedRow('upper', 'Upper total', null, (seat) => String(totals[seat].upper))}
          {renderDerivedRow(
            'bonus',
            'Bonus',
            `${RULES.UPPER_BONUS} at ${RULES.UPPER_BONUS_AT}`,
            (seat) =>
              // Show progress toward the bonus rather than a bare 0, because
              // "how far off 63 am I" is the decision the upper section is all
              // about.
              totals[seat].bonus > 0
                ? String(totals[seat].bonus)
                : `${totals[seat].upper}/${RULES.UPPER_BONUS_AT}`,
          )}
        </tbody>

        <tbody>
          {renderRows(LOWER_CATEGORIES)}
          {renderDerivedRow('ybonus', 'Yahtzee bonus', `${RULES.YAHTZEE_BONUS} each`, (seat) =>
            String(totals[seat].yahtzeeBonus),
          )}
        </tbody>

        <tfoot>
          <tr className="sc__row sc__row--total">
            <th scope="row" className="sc__label">
              <span className="sc__label-text">Total</span>
            </th>
            {players.map((p, seat) => (
              <td
                key={p.uid}
                className="sc__cell"
                data-turn={seat === turn ? 'true' : undefined}
                data-mine={seat === mySeat ? 'true' : undefined}
              >
                <span className="sc__total">{totals[seat].total}</span>
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default Scorecard;
