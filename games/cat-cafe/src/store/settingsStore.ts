/**
 * Preferences that outlive a game: the player's name, the room they were last
 * in (for the "Resume" prompt), and the options last chosen for a game against the cats.
 * Persisted to localStorage.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Difficulty } from '@/ai';

export interface LastRoom {
  code: string;
  role: 'host' | 'guest';
}

export const OPPONENT_CHOICES = [1, 2, 3] as const;

export interface TableOptions {
  /** Computer opponents. Offline only. */
  opponents: number;
  /** Offline only. */
  difficulty: Difficulty;
}

interface SettingsData {
  playerName: string;
  lastRoom: LastRoom | null;
  table: TableOptions;
}

interface SettingsState extends SettingsData {
  setPlayerName: (name: string) => void;
  setLastRoom: (room: LastRoom | null) => void;
  setTable: (patch: Partial<TableOptions>) => void;
}

const DEFAULT_TABLE: TableOptions = { opponents: 1, difficulty: 'medium' };

/** Clamp whatever was in storage back into the allowed choices. */
function cleanTable(raw: unknown): TableOptions {
  const t = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<TableOptions>;
  const pick = <T,>(value: unknown, choices: readonly T[], fallback: T): T =>
    choices.includes(value as T) ? (value as T) : fallback;
  return {
    opponents: pick(t.opponents, OPPONENT_CHOICES, DEFAULT_TABLE.opponents),
    difficulty: pick(t.difficulty, ['easy', 'medium', 'hard'] as const, DEFAULT_TABLE.difficulty),
  };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      playerName: '',
      lastRoom: null,
      table: DEFAULT_TABLE,
      setPlayerName: (playerName) => set({ playerName }),
      setLastRoom: (lastRoom) => set({ lastRoom }),
      setTable: (patch) => set((s) => ({ table: cleanTable({ ...s.table, ...patch }) })),
    }),
    {
      name: 'cat-cafe-settings',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s): SettingsData => ({ playerName: s.playerName, lastRoom: s.lastRoom, table: s.table }),
      // Storage is user-editable and survives app updates: never trust its shape.
      merge: (persisted, current) => {
        const old = (typeof persisted === 'object' && persisted !== null ? persisted : {}) as Partial<SettingsData>;
        const room = old.lastRoom;
        return {
          ...current,
          playerName: typeof old.playerName === 'string' ? old.playerName : '',
          lastRoom:
            room && typeof room.code === 'string' && (room.role === 'host' || room.role === 'guest')
              ? { code: room.code, role: room.role }
              : null,
          table: cleanTable(old.table),
        };
      },
    },
  ),
);
