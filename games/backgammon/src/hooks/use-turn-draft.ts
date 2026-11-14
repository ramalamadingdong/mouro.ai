/**
 * The staged turn: which steps the player has picked so far, before committing.
 *
 * This lives in a hook rather than a store on purpose. It is ephemeral, never
 * synced, and identical for online and solo play — so the one board component
 * serves both stores with no branching. Putting it in a store would force
 * either a third shared store or a duplicated slice in two.
 *
 * Undo is free here: nothing has been written, so popping a step is just
 * shortening an array. Once the turn is committed there is no undo, which
 * matches how the game is actually played.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { BAR, OFF } from '@/engine/board';
import {
  consumedDice,
  isCompleteTurn,
  maxUsableDice,
  nextSteps,
  previewDraft,
  turnLines,
} from '@/engine/moves';
import type { GameState, Seat, Step } from '@/engine/types';

export interface TurnDraft {
  /** Steps staged so far, in order. */
  draft: Step[];
  /** The board as it looks with the draft applied. */
  preview: GameState;
  /** Every legal continuation right now. */
  next: Step[];
  /** Points a checker may currently be picked up from (may include BAR). */
  sources: number[];
  /** The point the player has tapped, if any. */
  selected: number | null;
  /** Destinations from the selected point. */
  targets: Step[];
  /** Die values already spent by the draft. */
  spent: number[];
  /** How many dice a legal turn must use. */
  maxDice: number;
  /** No legal play exists — the turn must be handed over empty. */
  forcedPass: boolean;
  /** Exactly one legal turn exists; the draft has been prefilled with it. */
  onlyPlay: boolean;
  canUndo: boolean;
  canConfirm: boolean;

  /** Tap a point: select it, deselect it, or move to it. */
  tapPoint: (own: number) => void;
  /** Tap the bear-off tray. */
  tapOff: () => void;
  undo: () => void;
  undoAll: () => void;
  /** Drop the draft without committing (used when the turn changes under us). */
  clear: () => void;
}

export interface TurnDraftOptions {
  /** Move immediately when a tapped source has exactly one destination. */
  fastTap?: boolean;
}

const NO_STEPS: Step[] = [];

/**
 * Every place the checker on `from` can reach this turn — with one die, or by
 * moving the SAME checker with several dice in a row (3 then 5 to land 8 away)
 * — mapped to the shortest legal chain of steps that gets it there.
 *
 * Without this, tapping the landing point of a combined move did nothing,
 * which felt exactly like the game refusing a legal move.
 */
export function reachable(
  state: GameState,
  seat: Seat,
  draft: Step[],
  from: number,
): Map<number, Step[]> {
  const out = new Map<number, Step[]>();
  let frontier: { at: number; chain: Step[] }[] = [{ at: from, chain: [] }];
  while (frontier.length) {
    const next: { at: number; chain: Step[] }[] = [];
    for (const { at, chain } of frontier) {
      for (const s of nextSteps(state, seat, [...draft, ...chain])) {
        if (s.from !== at) continue;
        if (out.has(s.to)) continue;
        const c = [...chain, s];
        out.set(s.to, c);
        if (s.to !== OFF) next.push({ at: s.to, chain: c });
      }
    }
    frontier = next;
  }
  return out;
}

export function useTurnDraft(
  state: GameState,
  mySeat: Seat | null,
  options: TurnDraftOptions = {},
): TurnDraft {
  const { fastTap = true } = options;
  const [draft, setDraft] = useState<Step[]>(NO_STEPS);
  const [selected, setSelected] = useState<number | null>(null);

  const myTurn = mySeat !== null && state.phase === 'moving' && state.turn === mySeat;

  // Any accepted move invalidates the draft — including our own commit, which
  // is what clears the board after a turn goes through.
  useEffect(() => {
    setDraft(NO_STEPS);
    setSelected(null);
  }, [state.version]);

  const lines = useMemo(
    () => (myTurn && mySeat ? turnLines(state, mySeat) : []),
    [state, mySeat, myTurn],
  );
  const maxDice = useMemo(
    () => (myTurn && mySeat ? maxUsableDice(state, mySeat) : 0),
    [state, mySeat, myTurn],
  );
  const forcedPass = myTurn && maxDice === 0;
  const onlyPlay = myTurn && lines.length === 1 && lines[0].steps.length > 0;

  /*
   * A single legal turn is PREFILLED, not auto-committed. Auto-committing is
   * startling: the board changes and the turn is gone before the player has
   * looked at it. Prefilling gets the taps out of the way while leaving the
   * decision — and the undo — with them.
   */
  useEffect(() => {
    if (onlyPlay && draft.length === 0) setDraft(lines[0].steps);
    // Intentionally keyed on the position, not on `draft`: re-running when the
    // player undoes back to empty would instantly refill it and make Undo
    // look broken.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.version, onlyPlay]);

  const preview = useMemo(
    () => (mySeat ? previewDraft(state, mySeat, draft) : state),
    [state, mySeat, draft],
  );
  const next = useMemo(
    () => (myTurn && mySeat ? nextSteps(state, mySeat, draft) : []),
    [state, mySeat, draft, myTurn],
  );
  const sources = useMemo(() => Array.from(new Set(next.map((s) => s.from))), [next]);
  const routes = useMemo(
    () =>
      selected === null || !mySeat || !myTurn
        ? new Map<number, Step[]>()
        : reachable(state, mySeat, draft, selected),
    [state, mySeat, draft, selected, myTurn],
  );
  // One highlighted target per landing point (single die or combined).
  const targets = useMemo(
    () => Array.from(routes.keys()).map((to) => ({ from: selected ?? -1, to })),
    [routes, selected],
  );
  const spent = useMemo(
    () => (mySeat ? consumedDice(state, mySeat, draft) : []),
    [state, mySeat, draft],
  );
  const canConfirm = useMemo(
    () => (myTurn && mySeat ? isCompleteTurn(state, mySeat, draft) : false),
    [state, mySeat, draft, myTurn],
  );

  const push = useCallback((...steps: Step[]) => {
    setDraft((d) => [...d, ...steps]);
    setSelected(null);
  }, []);

  const tapPoint = useCallback(
    (own: number) => {
      if (!myTurn || !mySeat) return;

      // Completing a move onto an already-selected source's destination.
      if (selected !== null) {
        const route = routes.get(own);
        if (route) {
          push(...route);
          return;
        }
        if (own === selected) {
          setSelected(null);
          return;
        }
      }

      // Picking up. The bar is forced, so tapping anything else while it holds a
      // checker should not silently do nothing — but `next` already contains
      // only bar entries in that case, so this falls through correctly.
      const from = own;
      const outs = next.filter((s) => s.from === from);
      if (outs.length === 0) {
        setSelected(null);
        return;
      }
      if (outs.length === 1 && fastTap) {
        push(outs[0]);
        return;
      }
      setSelected(from);
    },
    [myTurn, mySeat, selected, routes, next, fastTap, push],
  );

  const tapOff = useCallback(() => {
    if (!myTurn) return;
    if (selected !== null) {
      const route = routes.get(OFF);
      if (route) {
        push(...route);
        return;
      }
    }
    // Nothing selected: if exactly one checker can come off, take that one.
    const offs = next.filter((s) => s.to === OFF);
    if (offs.length === 1 && fastTap) push(offs[0]);
  }, [myTurn, selected, routes, next, fastTap, push]);

  const undo = useCallback(() => {
    setDraft((d) => d.slice(0, -1));
    setSelected(null);
  }, []);

  const undoAll = useCallback(() => {
    setDraft(NO_STEPS);
    setSelected(null);
  }, []);

  const clear = undoAll;

  return {
    draft,
    preview,
    next,
    sources,
    selected,
    targets,
    spent,
    maxDice,
    forcedPass,
    onlyPlay,
    canUndo: draft.length > 0,
    canConfirm,
    tapPoint,
    tapOff,
    undo,
    undoAll,
    clear,
  };
}

export { BAR, OFF };
