/**
 * Pass-and-play: one device, one to four seats, no network.
 *
 * Two screens in one route — a roster form, then the SAME <Table/> the online
 * game renders. Nothing here imports `@/fb`, directly or transitively, so this
 * mode works on a build with no Firebase config and on a phone in aeroplane
 * mode. That is the whole reason `localStore` exists as a separate store with a
 * matching shape rather than as a flag on `gameStore`.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table } from '@/components/table';
import { useLocalStore } from '@/store/localStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { randomSeed } from '@/util/seed';
import { RULES, type Category } from '@/engine';
import './screen.css';
import './local.css';

/**
 * Grow or shrink a roster to exactly `count` seats, keeping what is already
 * typed. Naming the new seats rather than leaving them blank means the roster
 * reads as a table of players from the first tap, and localStore's own fallback
 * ("Player N" for a blank name) never has to fire.
 */
function resize(names: string[], count: number): string[] {
  const next = names.slice(0, count);
  while (next.length < count) next.push(`Player ${next.length + 1}`);
  return next;
}

export function LocalRoute() {
  const navigate = useNavigate();

  const state = useLocalStore((s) => s.state);
  const mySeat = useLocalStore((s) => s.mySeat);
  const allHolds = useLocalStore((s) => s.holds);
  const pendingMove = useLocalStore((s) => s.pendingMove);
  const error = useLocalStore((s) => s.error);
  const send = useLocalStore((s) => s.send);
  const setHolds = useLocalStore((s) => s.setHolds);
  const newGame = useLocalStore((s) => s.newGame);
  const reset = useLocalStore((s) => s.reset);

  const savedPlayers = useSettingsStore((s) => s.localPlayers);
  const setLocalPlayers = useSettingsStore((s) => s.setLocalPlayers);
  const motionSetting = useSettingsStore((s) => s.motion);
  const osReduced = useReducedMotion();
  // The OS preference is a hard veto over the in-app setting.
  const motion = motionSetting && !osReduced;

  // Seeded from the persisted roster so a group that plays regularly does not
  // retype their names every session. Local state, not the settings store,
  // because half-typed names should not be written to disk on every keystroke.
  const [names, setNames] = useState<string[]>(() => savedPlayers.slice(0, RULES.MAX_PLAYERS));

  // ── Roster ───────────────────────────────────────────────────────────────

  if (!state) {
    return (
      <main className="screen screen--centred">
        <div className="screen__inner local">
          <h1 className="screen__title">Pass and play</h1>
          <p className="screen__subtitle">
            Everyone shares this device. Hand it on when the turn changes — the table always
            shows whose turn it is.
          </p>

          <div className="field">
            <span className="field__label">Players</span>
            <div className="local__counts" role="group" aria-label="Number of players">
              {Array.from({ length: RULES.MAX_PLAYERS }, (_, i) => i + 1).map((count) => (
                <button
                  key={count}
                  type="button"
                  className="btn btn--secondary local__count"
                  data-selected={names.length === count ? 'true' : undefined}
                  aria-pressed={names.length === count}
                  onClick={() => setNames((cur) => resize(cur, count))}
                >
                  {count}
                </button>
              ))}
            </div>
            {names.length === 1 && (
              <p className="field__hint">
                One player is a solo game: {RULES.ROUNDS} turns against your own best score.
              </p>
            )}
          </div>

          <div className="stack">
            {names.map((name, seat) => (
              <div className="field" key={seat}>
                <label className="field__label" htmlFor={`local-name-${seat}`}>
                  Seat {seat + 1}
                </label>
                <input
                  id={`local-name-${seat}`}
                  className="field__input"
                  type="text"
                  value={name}
                  maxLength={24}
                  onChange={(e) => {
                    const value = e.target.value;
                    setNames((cur) => cur.map((n, i) => (i === seat ? value : n)));
                  }}
                />
              </div>
            ))}
          </div>

          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => {
              // Persist the roster only on Start — this is the point at which
              // the names are the ones they actually meant.
              setLocalPlayers(names);
              newGame(names);
            }}
          >
            Start game
          </button>

          <button
            type="button"
            className="btn btn--ghost btn--block"
            onClick={() => navigate('/')}
          >
            Back
          </button>
        </div>
      </main>
    );
  }

  // ── The table ────────────────────────────────────────────────────────────

  /*
   * On this device "the player" is by definition whoever is on turn, so holds
   * are looked up under that seat's local uid. `localStore` clears the whole
   * holds map on a turn change, so the next person is never handed a table with
   * dice already held for them.
   */
  const turnUid = state.players[state.turn]?.uid ?? '';
  const myHolds = allHolds[turnUid] ?? [];

  function handleToggleHold(index: number): void {
    setHolds(
      myHolds.includes(index)
        ? myHolds.filter((i) => i !== index)
        : [...myHolds, index].sort((a, b) => a - b),
    );
  }

  return (
    <Table
      state={state}
      mySeat={mySeat}
      holds={myHolds}
      // Always false; local moves are synchronous. Passed for prop parity so
      // the table needs no branch for which store is driving it.
      pending={pendingMove}
      error={error}
      // No `presence`: everyone is in the room. The table renders no presence
      // markers at all when this is undefined, rather than showing four
      // permanently-green dots that mean nothing.
      //
      // A trivially satisfied rematch tally rather than an omitted prop: there
      // is no vote here (one tap deals a new game immediately), and `total: 1`
      // is what makes the table's progress line — gated on `total > 1` — stay
      // silent without the table needing to know which store is driving it.
      rematch={{ voted: false, count: 0, total: 1 }}
      motion={motion}
      onRoll={(keep) => send({ kind: 'roll', keep, seed: randomSeed() })}
      onScore={(category: Category) => send({ kind: 'score', category })}
      onToggleHold={handleToggleHold}
      onRematch={() => send({ kind: 'rematch' })}
      // Leaving a local game returns to the roster rather than to the home
      // screen: the usual next thing after a pass-and-play game is another
      // pass-and-play game with the same people.
      onLeave={reset}
    />
  );
}

export default LocalRoute;
