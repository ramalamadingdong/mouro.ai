/**
 * The offline game against the cats. Imports nothing from `@/net`, so this
 * whole mode works with no server at all.
 *
 * The in-progress game is persisted on every move, so a refresh (or iOS
 * evicting the tab) resumes the same hand. It goes through `normalize()` on
 * the way back in, exactly like a state arriving from the network: storage
 * that fails its integrity checks is dropped rather than half-trusted.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { CATS, type Difficulty } from '@/ai';
import { applyMove, createGame, normalize, type GameState, type Move } from '@/engine';
import { randomSeed } from '@/util/seed';
import type { TableOptions } from '@/store/settingsStore';

/** The human's uid offline. Prefixed so it can never be mistaken for a realtime uid. */
export const SOLO_UID = 'local-you';

interface SoloData {
  game: GameState | null;
  /** Difficulty the running game was started with (settings may change later). */
  difficulty: Difficulty;
}

interface SoloStore extends SoloData {
  /** Seat of the cat currently "thinking", for the table to show. Not persisted. */
  thinkingSeat: number | null;
  /** The human tapped "Skip ahead" this hand. Reset on every deal. */
  skipAhead: boolean;
  error: string | null;
  start: (name: string, options: TableOptions) => void;
  /** Apply a move as `uid` (the human, or the cat whose turn it is). */
  send: (move: Move, uid: string) => void;
  setThinking: (seat: number | null) => void;
  setSkipAhead: (on: boolean) => void;
  quit: () => void;
  clearError: () => void;
}

export const useSoloStore = create<SoloStore>()(
  persist(
    (set, get) => ({
      game: null,
      difficulty: 'medium',
      thinkingSeat: null,
      skipAhead: false,
      error: null,

      start: (name, options) => {
        // In the cats' own order, so seats are stable whatever order they were picked in.
        const opponents = CATS.filter((cat) => options.cats.includes(cat.id));
        const fresh = createGame({
          players: [
            { uid: SOLO_UID, name: name.trim() || 'You', isHuman: true },
            ...opponents.map((cat) => ({ uid: `cat-${cat.id}`, name: cat.name, isHuman: false })),
          ],
          startingStack: options.startingStack,
          rounds: options.rounds,
        });
        const dealt = applyMove(fresh, { kind: 'deal', seed: randomSeed() }, SOLO_UID);
        set({
          game: dealt.ok ? dealt.state : fresh,
          difficulty: options.difficulty,
          thinkingSeat: null,
          skipAhead: false,
          error: null,
        });
      },

      send: (move, uid) => {
        const { game } = get();
        if (!game) return;
        const result = applyMove(game, move, uid);
        if (!result.ok) {
          set({ error: result.error });
          return;
        }
        set({
          game: result.state,
          error: null,
          thinkingSeat: null,
          ...(move.kind === 'deal' || move.kind === 'rematch' ? { skipAhead: false } : {}),
        });
      },

      setThinking: (thinkingSeat) => set({ thinkingSeat }),
      setSkipAhead: (skipAhead) => set({ skipAhead }),
      quit: () => set({ game: null, thinkingSeat: null, skipAhead: false, error: null }),
      clearError: () => set({ error: null }),
    }),
    {
      name: 'blackjack-solo',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s): SoloData => ({ game: s.game, difficulty: s.difficulty }),
      merge: (persisted, current) => {
        const old = (typeof persisted === 'object' && persisted !== null ? persisted : {}) as Partial<SoloData>;
        return {
          ...current,
          game: normalize(old.game),
          difficulty: old.difficulty === 'easy' || old.difficulty === 'hard' ? old.difficulty : 'medium',
        };
      },
    },
  ),
);
