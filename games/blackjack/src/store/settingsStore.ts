/**
 * Preferences that outlive a game: the player's name, the room they were last
 * in (for the "Resume" prompt), and the options last chosen for a table
 * against the cats. Persisted to localStorage.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { CATS, type Difficulty } from '@/ai';

export interface LastRoom {
  code: string;
  role: 'host' | 'guest';
}

export const STACK_CHOICES = [500, 1000, 2500] as const;
export const ROUND_CHOICES = [10, 20, 40] as const;

export interface TableOptions {
  /** Which cats sit with you, by id (any of the seven, or none). Offline only. */
  cats: string[];
  startingStack: number;
  /** Rounds in a game. */
  rounds: number;
  /** Offline only. */
  difficulty: Difficulty;
}

interface SettingsData {
  playerName: string;
  lastRoom: LastRoom | null;
  table: TableOptions;
  /** Buzz the phone when it becomes this player's turn (where the browser can). */
  vibrate: boolean;
  /** Play a short chime when it becomes this player's turn (works on iPhone too). */
  chime: boolean;
}

interface SettingsState extends SettingsData {
  setPlayerName: (name: string) => void;
  setLastRoom: (room: LastRoom | null) => void;
  setTable: (patch: Partial<TableOptions>) => void;
  setVibrate: (on: boolean) => void;
  setChime: (on: boolean) => void;
}

const DEFAULT_TABLE: TableOptions = { cats: CATS.slice(0, 4).map((c) => c.id), startingStack: 1000, rounds: 20, difficulty: 'medium' };

/** Clamp whatever was in storage back into the allowed choices. */
function cleanTable(raw: unknown): TableOptions {
  const t = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<TableOptions> & { opponents?: unknown };
  const pick = <T,>(value: unknown, choices: readonly T[], fallback: T): T =>
    choices.includes(value as T) ? (value as T) : fallback;
  return {
    // Known ids only, in the cats' own order. Older saves stored a COUNT of
    // opponents (the first N cats): honour it once.
    cats: Array.isArray(t.cats)
      ? CATS.map((c) => c.id).filter((id) => (t.cats as unknown[]).includes(id))
      : typeof t.opponents === 'number' && t.opponents >= 0 && t.opponents <= CATS.length
        ? CATS.slice(0, t.opponents).map((c) => c.id)
        : DEFAULT_TABLE.cats,
    startingStack: pick(t.startingStack, STACK_CHOICES, DEFAULT_TABLE.startingStack),
    rounds: pick(t.rounds, ROUND_CHOICES, DEFAULT_TABLE.rounds),
    difficulty: pick(t.difficulty, ['easy', 'medium', 'hard'] as const, DEFAULT_TABLE.difficulty),
  };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      playerName: '',
      lastRoom: null,
      table: DEFAULT_TABLE,
      vibrate: true,
      chime: true,
      setPlayerName: (playerName) => set({ playerName }),
      setLastRoom: (lastRoom) => set({ lastRoom }),
      setVibrate: (vibrate) => set({ vibrate }),
      setChime: (chime) => set({ chime }),
      setTable: (patch) => set((s) => ({ table: cleanTable({ ...s.table, ...patch }) })),
    }),
    {
      name: 'blackjack-settings',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s): SettingsData => ({ playerName: s.playerName, lastRoom: s.lastRoom, table: s.table, vibrate: s.vibrate, chime: s.chime }),
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
          vibrate: old.vibrate !== false,
          chime: old.chime !== false,
        };
      },
    },
  ),
);
