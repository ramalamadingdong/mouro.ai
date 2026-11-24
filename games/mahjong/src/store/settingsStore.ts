/**
 * Preferences that outlive a game: the player's name, the room they were last
 * in (for the "Resume" prompt), and the options last chosen for a table.
 * Persisted to localStorage.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Difficulty } from '@/ai';
import { MIN_FAAN_CHOICES, ROUNDS_FOR, RULESET_CHOICES, SEAT_CHOICES, type Ruleset } from '@/engine';

export interface LastRoom {
  code: string;
  role: 'host' | 'guest';
}

export interface TableOptions {
  ruleset: Ruleset;
  /** 4, or 2 for heads-up. Online, 4 fills empty seats with cats. */
  seats: number;
  /** Faan needed to go Mahjong (Hong Kong). */
  minFaan: number;
  /** Riichi 1 (East) or 2 (East + South); Hong Kong 1 (East) or 4 (full game). */
  rounds: number;
  /** Show the coach's hints during play. */
  coach: boolean;
  /** How well the cats play (offline, and the cats filling seats online). */
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

const DEFAULT_TABLE: TableOptions = { ruleset: 'riichi', seats: 4, minFaan: 1, rounds: 1, coach: true, difficulty: 'medium' };

/** Clamp whatever was in storage back into the allowed choices. */
function cleanTable(raw: unknown): TableOptions {
  const t = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<TableOptions>;
  const pick = <T,>(value: unknown, choices: readonly T[], fallback: T): T =>
    choices.includes(value as T) ? (value as T) : fallback;
  const ruleset = pick(t.ruleset, RULESET_CHOICES, DEFAULT_TABLE.ruleset);
  return {
    ruleset,
    seats: pick(t.seats, SEAT_CHOICES, DEFAULT_TABLE.seats),
    minFaan: pick(t.minFaan, MIN_FAAN_CHOICES, DEFAULT_TABLE.minFaan),
    rounds: pick(t.rounds, ROUNDS_FOR[ruleset], 1),
    coach: typeof t.coach === 'boolean' ? t.coach : DEFAULT_TABLE.coach,
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
      name: 'mahjong-settings',
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
