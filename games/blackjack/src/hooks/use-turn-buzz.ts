/**
 * Tell the player it has become their turn — to bet or to play a hand — so a phone left on the table (or a player chatting online) is
 * called back: a short two-note CHIME and, where the phone allows, a BUZZ.
 *
 * Only on the EDGE into "my turn", never again while it stays mine (hitting,
 * moving to the next split hand), and not when my own tap caused it (dealing
 * the next round puts me straight on turn to bet: I am already looking).
 *
 * - Vibration: the Vibration API. Android browsers have it; iPhone Safari does
 *   not, and nothing a web page can do turns it on — hence the chime. Chrome
 *   on Android also stays still while the phone's ringer is on silent, and
 *   while the tab is in the background.
 * - Chime: Web Audio. Browsers (iOS above all) only let a page make sound
 *   after a tap, and only from an AudioContext created or resumed inside
 *   one, so the context is unlocked on the first tap anywhere on the page.
 *   Every player taps (to bet, to join) before their first turn. It is silent
 *   when an iPhone's ringer switch is off.
 */
import { useEffect, useRef } from 'react';
import type { GameState } from '@/engine';
import { useSettingsStore } from '@/store/settingsStore';

/**
 * Two firm pulses. 70 ms pulses were too faint to feel on many Android
 * phones, above all one lying on a table.
 */
const PATTERN = [200, 120, 200];

export function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/** One buzz now, from inside a tap (switching it on), so you know it works. */
export function buzz(): void {
  if (!canVibrate()) return;
  try {
    navigator.vibrate(PATTERN);
  } catch {
    // Blocked by a policy: nothing to do.
  }
}

// ── The chime ──────────────────────────────────────────────────────────────

let audio: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (audio) return audio;
  const Ctor =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctor) return null;
  try {
    audio = new Ctor();
  } catch {
    audio = null;
  }
  return audio;
}

/** Called from inside a tap: create/resume the context and play one silent sample (iOS needs it). */
function unlockAudio(): void {
  const ctx = audioContext();
  if (!ctx) return;
  void ctx.resume().catch(() => {});
  try {
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
  } catch {
    // Nothing to unlock with: the chime will simply stay silent.
  }
}

let unlockListening = false;
function listenForUnlock(): void {
  if (unlockListening || typeof document === 'undefined') return;
  unlockListening = true;
  const onTap = (): void => {
    unlockAudio();
    if (audio?.state === 'running') {
      document.removeEventListener('pointerdown', onTap, true);
      document.removeEventListener('keydown', onTap, true);
    }
  };
  document.addEventListener('pointerdown', onTap, true);
  document.addEventListener('keydown', onTap, true);
}

/** A soft rising two-note "ding-ding" (A5 then E6), well under half volume. */
export function playChime(): void {
  const ctx = audioContext();
  if (!ctx || ctx.state !== 'running') return;
  const notes = [880, 1318.5];
  notes.forEach((freq, i) => {
    const start = ctx.currentTime + i * 0.16;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.22, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.4);
  });
}

// ── The hook ───────────────────────────────────────────────────────────────

export function useTurnBuzz(state: GameState, mySeat: number | null): void {
  const vibrate = useSettingsStore((s) => s.vibrate);
  const chime = useSettingsStore((s) => s.chime);
  const myTurn = mySeat !== null && state.toAct === mySeat;
  const wasMyTurn = useRef(myTurn);
  const myUid = mySeat === null ? null : state.players[mySeat]?.uid;
  // Only a deal or rematch I tapped myself. Not `next`: offline the dealer's
  // steps are sent under my uid too, and online my client sends them
  // automatically — neither is me looking at the screen.
  const causedByMe =
    state.lastMove?.by === myUid && (state.lastMove?.kind === 'deal' || state.lastMove?.kind === 'rematch');

  useEffect(() => {
    if (chime) listenForUnlock();
  }, [chime]);

  useEffect(() => {
    const rising = myTurn && !wasMyTurn.current;
    wasMyTurn.current = myTurn;
    if (!rising || causedByMe) return;
    if (chime) playChime();
    // Browsers refuse (and log an error) before the page has had a tap.
    const tapped = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? true;
    if (vibrate && tapped) buzz();
  }, [myTurn, causedByMe, vibrate, chime]);
}
