/**
 * The offline game against the cats. Imports nothing from `@/net`, so this
 * whole mode works with no server at all.
 *
 * The game is persisted on every move, so a refresh (or iOS evicting the tab)
 * resumes it. It goes through `normalize()` on the way back in, exactly like a
 * state arriving from the network.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { CATS, CAT_UID_PREFIX, type Difficulty } from '@/ai';
import { applyMove, createGame, normalize, type GameState, type Move } from '@/engine';
import type { TableOptions } from '@/store/settingsStore';
import { randomSeed } from '@/util/seed';

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
  error: string | null;
  start: (name: string, options: TableOptions) => void;
  /** Apply a move as `uid` (the human, or the cat whose turn it is). */
  send: (move: Move, uid: string) => void;
  setThinking: (seat: number | null) => void;
  quit: () => void;
  clearError: () => void;
}

export const useSoloStore = create<SoloStore>()(
  persist(
    (set, get) => ({
      game: null,
      difficulty: 'medium',
      thinkingSeat: null,
      error: null,

      start: (name, options) => {
        set({
          game: createGame({
            players: [
              { uid: SOLO_UID, name: name.trim() || 'You', isHuman: true },
              ...CATS.map((cat) => ({ uid: `${CAT_UID_PREFIX}${cat.id}`, name: cat.name, isHuman: false })),
            ],
            minFaan: options.minFaan,
            rounds: options.rounds,
            seed: randomSeed(),
            by: SOLO_UID,
          }),
          difficulty: options.difficulty,
          thinkingSeat: null,
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
        set({ game: result.state, error: null, thinkingSeat: null });
      },

      setThinking: (thinkingSeat) => set({ thinkingSeat }),
      quit: () => set({ game: null, thinkingSeat: null, error: null }),
      clearError: () => set({ error: null }),
    }),
    {
      name: 'mahjong-solo',
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
