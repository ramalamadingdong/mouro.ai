/**
 * Device-local preferences. This is the ONLY store that persists anything, and
 * it deliberately holds nothing about a game in progress: game truth lives in
 * Realtime Database (online) or in memory (pass-and-play). Persisting a
 * GameState here would give us a second source of truth that goes stale the
 * moment another device moves.
 *
 * What it does hold is the handful of things a returning player should not have
 * to re-enter: their name, the last room they were in (so "rejoin" works after
 * a reload), whether they want animation, and the pass-and-play roster.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { RULES } from '@/engine';

/**
 * The last room this device was in. `role` is remembered as well as the code
 * because the host and a guest get different offers on the home screen — the
 * host can reopen a room they own, a guest can only ask to rejoin.
 */
export interface LastRoom {
  code: string;
  role: 'host' | 'guest';
}

/**
 * Bump this AND add a `migrate` branch whenever the persisted shape changes.
 * It is set from day one on purpose: once real users have JSON in localStorage,
 * introducing versioning after the fact has no path to interpret the unversioned
 * blobs already out there, and zustand would rehydrate them straight into the
 * new type.
 */
const PERSIST_VERSION = 1;

/** Default roster for pass-and-play: one seat, the person holding the device. */
const DEFAULT_LOCAL_PLAYERS = ['You'];

/**
 * Motion defaults to the OS preference rather than to `true`, so a player who
 * has already asked their system for reduced motion never sees the dice tumble
 * even once. The `typeof window` guard is for Vitest/node, where this module is
 * imported without a DOM.
 */
function prefersMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The persisted slice, split out so `migrate` has a name for what it returns. */
interface SettingsData {
  playerName: string;
  lastRoom: LastRoom | null;
  motion: boolean;
  /** Names for pass-and-play seats, 1..RULES.MAX_PLAYERS. */
  localPlayers: string[];
  /** Host's switch: list a waiting room to players on the same Wi-Fi. */
  showNearby: boolean;
}

interface SettingsState extends SettingsData {
  setPlayerName: (name: string) => void;
  setLastRoom: (room: LastRoom | null) => void;
  setMotion: (motion: boolean) => void;
  setLocalPlayers: (names: string[]) => void;
  setShowNearby: (on: boolean) => void;
}

function defaults(): SettingsData {
  return {
    playerName: '',
    lastRoom: null,
    motion: prefersMotion(),
    localPlayers: [...DEFAULT_LOCAL_PLAYERS],
    showNearby: true,
  };
}

/**
 * Repair anything that survived from an older (or hand-edited, or corrupt)
 * localStorage entry. Everything here is defensive on purpose: `persisted` is
 * `unknown` because it came off the disk of a browser we do not control, and one
 * bad field must not take the whole app down at import time.
 */
function migrate(persisted: unknown, version: number): SettingsState {
  const base = defaults();
  if (persisted === null || typeof persisted !== 'object') {
    // No usable prior state (version 0 = pre-versioning, or a truncated write).
    return { ...base } as SettingsState;
  }
  if (version > PERSIST_VERSION) {
    // Written by a NEWER build of the app — another tab the player left open
    // across a deploy. We have no schema for it, and guessing at field meanings
    // is how a preference silently flips. Start clean instead.
    return { ...base } as SettingsState;
  }
  const old = persisted as Partial<SettingsData>;

  const localPlayers =
    Array.isArray(old.localPlayers) && old.localPlayers.length > 0
      ? old.localPlayers.filter((n): n is string => typeof n === 'string').slice(0, RULES.MAX_PLAYERS)
      : base.localPlayers;

  const lastRoom =
    old.lastRoom &&
    typeof old.lastRoom === 'object' &&
    typeof old.lastRoom.code === 'string' &&
    (old.lastRoom.role === 'host' || old.lastRoom.role === 'guest')
      ? { code: old.lastRoom.code, role: old.lastRoom.role }
      : null;

  return {
    ...base,
    playerName: typeof old.playerName === 'string' ? old.playerName : base.playerName,
    lastRoom,
    // NOT `old.motion || base.motion`: `false` is a real choice a player made,
    // and that expression would silently turn animation back on for them.
    motion: typeof old.motion === 'boolean' ? old.motion : base.motion,
    localPlayers: localPlayers.length > 0 ? localPlayers : base.localPlayers,
    showNearby: old.showNearby !== false,
  } as SettingsState;
}

/**
 * One tiny setter per field, rather than a single `set(partial)`. Each one has a
 * stable function identity across renders, so a component can subscribe with
 * `useSettingsStore((s) => s.setMotion)` and never re-render when an unrelated
 * field changes.
 */
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults(),
      setPlayerName: (name) => set({ playerName: name }),
      setLastRoom: (room) => set({ lastRoom: room }),
      setMotion: (motion) => set({ motion }),
      setLocalPlayers: (names) => set({ localPlayers: names.slice(0, RULES.MAX_PLAYERS) }),
      setShowNearby: (showNearby) => set({ showNearby }),
    }),
    {
      name: 'yahtzee-settings',
      storage: createJSONStorage(() => localStorage),
      version: PERSIST_VERSION,
      migrate,
      // Only data is written back. Without this the setters would be walked by
      // JSON.stringify on every change (they serialize to nothing, but it is
      // wasted work and it makes the stored blob's shape depend on the store's
      // implementation rather than on SettingsData).
      partialize: (s): SettingsData => ({
        playerName: s.playerName,
        lastRoom: s.lastRoom,
        motion: s.motion,
        localPlayers: s.localPlayers,
        showNearby: s.showNearby,
      }),
    },
  ),
);
