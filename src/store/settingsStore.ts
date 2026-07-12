/**
 * Persisted local preferences (AsyncStorage). `lastRoom` drives the Home
 * "Resume" affordance so a player can rejoin the room they left.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Difficulty } from '@/ai/cpu';

export type SortMode = 'rank' | 'suit';

export interface LastRoom {
  code: string;
  role: 'host' | 'guest';
}

interface SettingsStore {
  playerName: string;
  sortMode: SortMode;
  lastRoom: LastRoom | null;
  /** Remembered difficulty for the offline "vs computer" mode. */
  cpuDifficulty: Difficulty;
  setPlayerName: (name: string) => void;
  setSortMode: (mode: SortMode) => void;
  setLastRoom: (room: LastRoom | null) => void;
  setCpuDifficulty: (difficulty: Difficulty) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      playerName: '',
      sortMode: 'rank',
      lastRoom: null,
      cpuDifficulty: 'medium',
      setPlayerName: (playerName) => set({ playerName }),
      setSortMode: (sortMode) => set({ sortMode }),
      setLastRoom: (lastRoom) => set({ lastRoom }),
      setCpuDifficulty: (cpuDifficulty) => set({ cpuDifficulty }),
    }),
    {
      name: 'gin-settings',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
