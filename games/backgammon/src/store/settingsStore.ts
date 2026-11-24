/**
 * Persisted local preferences (AsyncStorage). `lastRoom` drives the Home
 * "Resume" affordance so a player can rejoin the room they left.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_MATCH_LENGTH } from '@/engine/match';
// Type-only import — erased at compile time, so the store carries no AI dep.
import type { Difficulty } from '@/ai/difficulty';

export type { Difficulty };

export interface LastRoom {
  code: string;
  role: 'host' | 'guest';
}

interface SettingsStore {
  playerName: string;
  lastRoom: LastRoom | null;
  /** Remembered difficulty for the offline "vs computer" mode. */
  cpuDifficulty: Difficulty;
  /** Remembered match length in points, reused across solo + online setup. */
  matchLength: number;
  /** Master switch for board animation (checker slides, dice tumble, pops). */
  motion: boolean;
  /** Ring the points a selected checker may legally move to. */
  highlightLegal: boolean;
  /**
   * Tap a point with exactly one legal destination and the checker just goes.
   * Covers nearly every bar entry and bear-off, and halves the taps in a game.
   */
  tapToMoveFast: boolean;
  /**
   * Commit the turn the moment the last die is used. Off by default: people
   * want to look at the position before it goes, and a turn cannot be undone
   * once committed.
   */
  autoConfirm: boolean;
  /** Host's switch: list a waiting room to players on the same Wi-Fi (web only). */
  showNearby: boolean;
  setPlayerName: (name: string) => void;
  setLastRoom: (room: LastRoom | null) => void;
  setCpuDifficulty: (difficulty: Difficulty) => void;
  setMatchLength: (points: number) => void;
  setMotion: (on: boolean) => void;
  setHighlightLegal: (on: boolean) => void;
  setTapToMoveFast: (on: boolean) => void;
  setAutoConfirm: (on: boolean) => void;
  setShowNearby: (on: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      playerName: '',
      lastRoom: null,
      cpuDifficulty: 'medium',
      matchLength: DEFAULT_MATCH_LENGTH,
      motion: true,
      highlightLegal: true,
      tapToMoveFast: true,
      autoConfirm: false,
      showNearby: true,
      setPlayerName: (playerName) => set({ playerName }),
      setLastRoom: (lastRoom) => set({ lastRoom }),
      setCpuDifficulty: (cpuDifficulty) => set({ cpuDifficulty }),
      setMatchLength: (matchLength) => set({ matchLength }),
      setMotion: (motion) => set({ motion }),
      setHighlightLegal: (highlightLegal) => set({ highlightLegal }),
      setTapToMoveFast: (tapToMoveFast) => set({ tapToMoveFast }),
      setAutoConfirm: (autoConfirm) => set({ autoConfirm }),
      setShowNearby: (showNearby) => set({ showNearby }),
    }),
    {
      name: 'bg-settings',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
