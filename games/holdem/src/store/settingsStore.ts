/**
 * Preferences that outlive a game: the player's name, the room they were last
 * in (for the "Resume" prompt), and the options last chosen for a table
 * against the cats. Persisted to localStorage.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Difficulty } from '@/ai';

export interface LastRoom {
  code: string;
  role: 'host' | 'guest';
}

export const STACK_CHOICES = [1000, 2000, 5000] as const;
export const BLIND_SPEED_CHOICES = [4, 6, 10] as const;

export interface TableOptions {
  /** Computer opponents, 1..5. Offline only. */
  opponents: number;
  startingStack: number;
  /** Blinds go up every this many hands. */
  blindUpEvery: number;
  /** Offline only. */
  difficulty: Difficulty;
}

interface SettingsData {
  playerName: string;
  lastRoom: LastRoom | null;
  table: TableOptions;
  /** Host's switch: list a waiting room to players on the same Wi-Fi. */
  showNearby: boolean;
}

interface SettingsState extends SettingsData {
  setPlayerName: (name: string) => void;
  setLastRoom: (room: LastRoom | null) => void;
  setTable: (patch: Partial<TableOptions>) => void;
  setShowNearby: (on: boolean) => void;
}

const DEFAULT_TABLE: TableOptions = { opponents: 5, startingStack: 2000, blindUpEvery: 6, difficulty: 'medium' };

/** Clamp whatever was in storage back into the allowed choices. */
function cleanTable(raw: unknown): TableOptions {
  const t = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<TableOptions>;
  const pick = <T,>(value: unknown, choices: readonly T[], fallback: T): T =>
    choices.includes(value as T) ? (value as T) : fallback;
  return {
    opponents: pick(t.opponents, [1, 2, 3, 4, 5], DEFAULT_TABLE.opponents),
    startingStack: pick(t.startingStack, STACK_CHOICES, DEFAULT_TABLE.startingStack),
    blindUpEvery: pick(t.blindUpEvery, BLIND_SPEED_CHOICES, DEFAULT_TABLE.blindUpEvery),
    difficulty: pick(t.difficulty, ['easy', 'medium', 'hard'] as const, DEFAULT_TABLE.difficulty),
  };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      playerName: '',
      lastRoom: null,
      table: DEFAULT_TABLE,
      showNearby: true,
      setPlayerName: (playerName) => set({ playerName }),
      setLastRoom: (lastRoom) => set({ lastRoom }),
      setTable: (patch) => set((s) => ({ table: cleanTable({ ...s.table, ...patch }) })),
      setShowNearby: (showNearby) => set({ showNearby }),
    }),
    {
      name: 'holdem-settings',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s): SettingsData => ({ playerName: s.playerName, lastRoom: s.lastRoom, table: s.table, showNearby: s.showNearby }),
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
          showNearby: old.showNearby !== false,
        };
      },
    },
  ),
);
