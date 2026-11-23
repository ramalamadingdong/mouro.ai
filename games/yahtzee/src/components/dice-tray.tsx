/**
 * The five dice, their hold toggles, and the roll button.
 *
 * Purely presentational: it never touches a store and never constructs a Move.
 * The parent turns `held` into `move.keep` when it submits a roll.
 *
 * Holding a die is NOT a move (see AGENTS.md): it is local UI state the parent
 * mirrors into a sibling RTDB node. That is why `onToggleHold` is a plain
 * index callback with no async result to wait on — a per-die database
 * round-trip would make the tray feel broken.
 */

import { useEffect, useRef, useState } from 'react';
import { RULES } from '@/engine';
import { durationMs } from '@/theme/tokens';
import { Die } from './die';
import './dice-tray.css';

export interface DiceTrayProps {
  /** The dice on the table: 5 faces of 1..6, or `[]` before the first roll. */
  dice: number[];
  /** INDICES of the dice held back from the next roll. */
  held: number[];
  /** Rolls spent this turn, 0..RULES.ROLLS_PER_TURN. */
  rollsUsed: number;
  /** Whether the viewer may roll right now (their turn, rolls remaining). */
  canRoll: boolean;
  /**
   * Whether the viewer may change holds. False while watching an opponent's
   * turn: their holds are still drawn, just not clickable.
   */
  canToggleHold: boolean;
  /** Whether the viewer may score right now. Drives the "pick a box" hint. */
  canScore: boolean;
  /** Animation allowed. Combine the app setting with the OS veto before passing. */
  motion: boolean;
  onToggleHold: (index: number) => void;
  onRoll: () => void;
}

/** Stable list of die slots, so the tray always draws five even with no dice. */
const SLOTS = Array.from({ length: RULES.DICE }, (_, i) => i);

export function DiceTray({
  dice,
  held,
  rollsUsed,
  canRoll,
  canToggleHold,
  canScore,
  motion,
  onToggleHold,
  onRoll,
}: DiceTrayProps) {
  const heldSet = new Set(held);
  const rollsLeft = Math.max(0, RULES.ROLLS_PER_TURN - rollsUsed);

  /*
   * Detect "a roll just landed" from the props alone, so the parent does not
   * have to own an `isRolling` flag that it would have to remember to clear.
   * `rollsUsed` only ever increases within a turn and resets to 0 between
   * turns, so a strict increase is exactly one new roll.
   */
  const [rollId, setRollId] = useState(0);
  const [rolling, setRolling] = useState(false);
  const prevRolls = useRef(rollsUsed);

  useEffect(() => {
    const landed = rollsUsed > prevRolls.current;
    prevRolls.current = rollsUsed;

    if (!landed || !motion) {
      /*
       * CLEAR, don't just bail. The ref is mutated above — before this branch —
       * so a re-run that is not itself a new roll used to return having
       * cancelled the timer (via the previous run's cleanup) without anything
       * left to switch `rolling` off, and the dice tumbled forever.
       *
       * Two real ways in: score a box inside the 420ms window, which drops
       * rollsUsed 3 -> 0 and re-runs this effect with `landed` false; or the OS
       * prefers-reduced-motion veto flips mid-roll, re-running it with `motion`
       * false. Both are exactly the cases that must end the animation, so
       * ending it here is the honest handling rather than a guard bolted on.
       */
      setRolling(false);
      return;
    }

    setRollId((n) => n + 1);
    setRolling(true);
    const timer = window.setTimeout(() => setRolling(false), durationMs.durSlow);
    return () => window.clearTimeout(timer);
  }, [rollsUsed, motion]);

  /*
   * Before the first roll there are no dice to hold — `state.dice` is `[]` and
   * the five slots on screen are placeholders. Disabling the toggles is more
   * honest than letting someone "hold" a die that does not exist yet.
   */
  const hasDice = rollsUsed > 0 && dice.length === RULES.DICE;
  const canHold = hasDice && canToggleHold;

  /*
   * The engine rejects a roll that keeps every die ("keeping every die is not a
   * roll"), because it would burn one of three rolls and change nothing. Catch
   * that here rather than letting the player submit a move that is guaranteed
   * to come back as an error.
   */
  const allHeld = canHold && heldSet.size === RULES.DICE;
  const rollEnabled = canRoll && !allHeld;

  let rollHint: string;
  if (allHeld) {
    rollHint = 'Release a die — rolling with all five held would change nothing.';
  } else if (canScore) {
    rollHint = 'Roll again, or pick a box on the scorecard to score these dice.';
  } else if (canRoll) {
    rollHint = 'Roll the dice to start your turn.';
  } else {
    rollHint = 'Waiting for the other player.';
  }

  return (
    <section className="tray" aria-label="Dice">
      <ul className="tray__dice">
        {SLOTS.map((i) => {
          const face = dice[i] ?? 0;
          const isHeld = heldSet.has(i);
          return (
            <li key={i} className="tray__slot">
              <button
                type="button"
                className="tray__toggle"
                // aria-pressed is what turns this into a toggle for a screen
                // reader; the ring and tint alone announce nothing.
                aria-pressed={isHeld}
                aria-label={
                  hasDice
                    ? `Die ${i + 1}, showing ${face}. ${isHeld ? 'Held' : 'Not held'}.`
                    : `Die ${i + 1}. No dice yet.`
                }
                disabled={!canHold}
                onClick={() => onToggleHold(i)}
              >
                <Die
                  // Remounting on each roll is what RESTARTS the CSS keyframe
                  // animation. Toggling a data attribute back on within the
                  // same element does not replay an animation that is already
                  // running, so a fast second roll would not tumble.
                  key={rollId}
                  face={face}
                  held={isHeld}
                  // Dimmed only when there are no dice yet. An opponent's dice
                  // stay at full strength so their HELD rings read clearly.
                  disabled={!hasDice}
                  // A held die is not being re-rolled, so it must not tumble.
                  rolling={rolling && !isHeld}
                  motion={motion}
                />
              </button>
              <span className="tray__held-tag" aria-hidden="true">
                {isHeld ? 'HELD' : ''}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="tray__controls">
        <button
          type="button"
          className="tray__roll"
          disabled={!rollEnabled}
          onClick={onRoll}
          title={allHeld ? rollHint : undefined}
        >
          {rollsUsed === 0 ? 'Roll' : 'Roll again'}
        </button>

        <p className="tray__rolls" aria-live="polite">
          <strong className="tray__rolls-count">{rollsLeft}</strong>
          {rollsLeft === 1 ? ' roll left' : ' rolls left'}
        </p>
      </div>

      <p className="tray__hint">{rollHint}</p>
    </section>
  );
}

export default DiceTray;
