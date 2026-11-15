/**
 * Two pieces of motion that need the authoritative state, not a component's
 * local state: replaying the opponent's turn step by step, and tumbling the
 * dice as they land.
 *
 * Both are driven off `state.version` advancing, which is the only signal that
 * is identical on both clients. Both are plain timers and RN `Animated` —
 * transform and opacity only, native driver, no worklets (Expo Go).
 */
import { useEffect, useRef, useState } from 'react';

import { previewDraft } from '@/engine/moves';
import { makeRng } from '@/engine/rng';
import type { GameState, Seat, Step } from '@/engine/types';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useSettingsStore } from '@/store/settingsStore';

/** Per-step timing for the opponent's turn replay. */
const STEP_MS = 300;
/** How long the dice tumble before settling on their real faces. */
const TUMBLE_MS = 480;
const TUMBLE_FRAMES = 3;

export interface BoardMotion {
  /** True while any motion is running. */
  active: boolean;
  /** The state to DRAW — mid-replay this is a partial position. */
  display: GameState;
  /** The step currently in flight, for the flying checker. */
  flying: Step | null;
  /** Whether the flying step is a hit, so it can flash red. */
  flyingHit: boolean;
  /** Whose checker is flying. */
  flyingSeat: Seat | null;
  /** Dice faces to show right now (tumbling values, or the real ones). */
  dice: number[];
}

/**
 * Is motion wanted at all? Gated by BOTH the app setting and the OS reduce-motion
 * preference — and unlike the gin rummy app, this gate covers every animation
 * rather than only some of them.
 */
export function useMotionEnabled(): boolean {
  const setting = useSettingsStore((s) => s.motion);
  const reduced = useReducedMotion();
  return setting && !reduced;
}

/** How many leading steps two step lists share. */
function sharedPrefix(a: Step[], b: Step[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n].from === b[n].from && a[n].to === b[n].to) n += 1;
  return n;
}

/**
 * @param watched  The opponent's turn as it was last seen being staged live
 *                 (`version` is the state it was staged against). When they
 *                 commit, the steps the viewer already watched are not replayed
 *                 — otherwise the checkers would snap back and move again.
 */
export function useBoardMotion(
  state: GameState,
  mySeat: Seat | null,
  base: GameState,
  enabled: boolean,
  watched: { version: number; steps: Step[] } | null = null,
): BoardMotion {
  const watchedRef = useRef(watched);
  useEffect(() => {
    watchedRef.current = watched;
  });

  // The state as it was BEFORE the move we are replaying.
  const prevRef = useRef<GameState | null>(null);
  const lastVersion = useRef<number | null>(null);

  const [replay, setReplay] = useState<{
    from: GameState;
    seat: Seat;
    steps: Step[];
    hits: number[];
    k: number;
  } | null>(null);
  // The tumble is keyed by a counter, NOT by the faces array. The old effect
  // depended on the faces it was itself updating, so every frame tore down and
  // restarted the animation at frame 0: it never finished, and the board kept
  // showing a made-up pair of dice instead of the real roll — while the rules
  // (correctly) checked moves against the real one.
  const [tumbleId, setTumbleId] = useState(0);
  const [tumble, setTumble] = useState<number[] | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = state;

    // Skip the state we mounted into: there is nothing to animate FROM.
    if (lastVersion.current === null) {
      lastVersion.current = state.version;
      return;
    }
    if (state.version <= lastVersion.current) return;
    lastVersion.current = state.version;

    if (!enabled) return;
    const lm = state.lastMove;
    if (!lm) return;

    if ((lm.kind === 'roll' || lm.kind === 'openingRoll') && state.dice.length > 0) {
      setTumble(state.dice.map(() => 1));
      setTumbleId((n) => n + 1);
      return;
    }

    if (lm.kind === 'play' && lm.seat !== mySeat && prev && lm.steps && lm.steps.length > 0) {
      const seen = watchedRef.current;
      const k = seen && seen.version === prev.version ? sharedPrefix(seen.steps, lm.steps) : 0;
      // Everything was already watched live: there is nothing left to replay.
      if (k >= lm.steps.length) return;
      setReplay({ from: prev, seat: lm.seat, steps: lm.steps, hits: lm.hits ?? [], k });
    }
  }, [state, mySeat, enabled]);

  // Advance the replay one step at a time.
  useEffect(() => {
    if (!replay) return;
    if (replay.k >= replay.steps.length) {
      const t = setTimeout(() => setReplay(null), STEP_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setReplay((r) => (r ? { ...r, k: r.k + 1 } : null)), STEP_MS);
    return () => clearTimeout(t);
  }, [replay]);

  // Cycle a few random faces, then let the real dice show through.
  const diceRef = useRef(state.dice);
  diceRef.current = state.dice;
  const versionRef = useRef(state.version);
  versionRef.current = state.version;
  useEffect(() => {
    if (tumbleId === 0) return;
    let frame = 0;
    const id = setInterval(() => {
      frame += 1;
      if (frame >= TUMBLE_FRAMES) {
        clearInterval(id);
        setTumble(null);
        return;
      }
      // Seeded on the version so BOTH clients tumble through identical faces —
      // a small thing, but it means two people watching the same game see the
      // same dice roll rather than two different ones.
      const rng = makeRng([versionRef.current, frame]);
      setTumble(diceRef.current.map(() => 1 + Math.floor(rng() * 6)));
    }, TUMBLE_MS / TUMBLE_FRAMES);
    // Whatever happens, the real dice show once this tumble is torn down.
    return () => {
      clearInterval(id);
      setTumble(null);
    };
  }, [tumbleId]);

  if (replay && replay.k <= replay.steps.length) {
    const shown = replay.steps.slice(0, replay.k);
    const flying = replay.k < replay.steps.length ? replay.steps[replay.k] : null;
    return {
      active: true,
      // The SAME `previewDraft` the player's own staged turn uses, so a
      // half-played turn can never look different depending on who played it.
      display: previewDraft(replay.from, replay.seat, shown),
      flying,
      flyingHit: flying ? replay.hits.includes(23 - flying.to) : false,
      flyingSeat: replay.seat,
      dice: replay.from.dice,
    };
  }

  return {
    active: tumble !== null,
    display: base,
    flying: null,
    flyingHit: false,
    flyingSeat: null,
    dice: tumble ?? base.dice,
  };
}
