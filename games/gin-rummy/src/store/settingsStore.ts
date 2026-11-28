/**
 * Persisted local preferences (AsyncStorage). `lastRoom` drives the Home
 * "Resume" affordance so a player can rejoin the room they left.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Difficulty } from '@/ai/cpu';
import type { CardId } from '@/engine/types';
// Type-only import — erased at compile time, so the store carries no React dep.
import type { SortMode } from '@/hooks/use-hand-sort';

export type { SortMode };

export interface LastRoom {
  code: string;
  role: 'host' | 'guest';
}

interface SettingsStore {
  playerName: string;
  sortMode: SortMode;
  /** The hand order the player dragged the cards into (the `custom` sort). */
  customOrder: CardId[];
  lastRoom: LastRoom | null;
  /** Remembered difficulty for the offline "vs computer" mode. */
  cpuDifficulty: Difficulty;
  /** Remembered match target (winning score), reused across solo + online setup. */
  matchTarget: number;
  /** Mark discards that enable a knock/gin with a subtle corner dot. */
  showKnockHints: boolean;
  /** Master switch for card animations (deal / draw / reorder). */
  motion: boolean;
  /**
   * Optional personal card-back photo, stored as a small JPEG `data:` URI. Local
   * cosmetic only — never synced, so each player sees their own face-down backs.
   * `null` falls back to the drawn diamond-lattice back.
   */
  customCardBack: string | null;
  /** Host's switch: list a waiting room to players on the same Wi-Fi (web only). */
  showNearby: boolean;
  setPlayerName: (name: string) => void;
  setSortMode: (mode: SortMode) => void;
  /** Save a dragged order and switch to the `custom` sort. */
  setCustomOrder: (order: CardId[]) => void;
  setLastRoom: (room: LastRoom | null) => void;
  setCpuDifficulty: (difficulty: Difficulty) => void;
  setMatchTarget: (target: number) => void;
  setShowKnockHints: (show: boolean) => void;
  setMotion: (on: boolean) => void;
  setCustomCardBack: (uri: string | null) => void;
  setShowNearby: (on: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      playerName: '',
      sortMode: 'rank',
      customOrder: [],
      lastRoom: null,
      cpuDifficulty: 'medium',
      matchTarget: 100,
      showKnockHints: true,
      motion: true,
      customCardBack: null,
      showNearby: true,
      setPlayerName: (playerName) => set({ playerName }),
      setSortMode: (sortMode) => set({ sortMode }),
      setCustomOrder: (customOrder) => set({ customOrder, sortMode: 'custom' }),
      setLastRoom: (lastRoom) => set({ lastRoom }),
      setCpuDifficulty: (cpuDifficulty) => set({ cpuDifficulty }),
      setMatchTarget: (matchTarget) => set({ matchTarget }),
      setShowKnockHints: (showKnockHints) => set({ showKnockHints }),
      setMotion: (motion) => set({ motion }),
      setCustomCardBack: (customCardBack) => set({ customCardBack }),
      setShowNearby: (showNearby) => set({ showNearby }),
    }),
    {
      name: 'gin-settings',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
