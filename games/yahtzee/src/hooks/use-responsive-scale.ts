/**
 * One number that scales the whole UI.
 *
 * The alternative — a media query per component — drifts: the dice grow at
 * 768px, the scorecard at 900px, and on a tablet you get a giant tray above a
 * tiny card. Instead this hook produces a SINGLE multiplier that the top-level
 * route writes into the `--ui-scale` custom property. `base.css` applies it to
 * `html { font-size }`, and because every space/type token is in `rem`, layout
 * and type grow together and stay in proportion at every size.
 *
 * The scale is the MINIMUM of a width-derived and a height-derived factor.
 * Yahtzee is a one-screen game: the tray and the 13-row scorecard have to be
 * visible at once. Scaling off width alone makes a wide-but-short window (a
 * phone in landscape, a half-height desktop window) push the scorecard off the
 * bottom, which is worse than slightly small dice.
 */

import { useEffect, useState } from 'react';

/**
 * The viewport the layout was designed against: a mid-size phone. At exactly
 * this size the scale is 1 and every token means its literal value.
 */
const BASE_WIDTH = 400;
const BASE_HEIGHT = 720;

/**
 * Never shrink below 1. Below the design size we want the layout to reflow and
 * scroll, not to render 9px type that nobody can read — clamping at the bottom
 * is what keeps small phones legible.
 */
const MIN_SCALE = 1;

/**
 * 2.2 is roughly where the dice stop reading as objects on a table and start
 * reading as a mistake. A 4K monitor would otherwise ask for ~5x.
 */
const MAX_SCALE = 2.2;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Rounded to 1/100 so a one-pixel resize does not produce a new float every
 * frame; each distinct value is a React re-render and a full page reflow.
 */
function quantize(n: number): number {
  return Math.round(n * 100) / 100;
}

function measure(): number {
  // Vitest and any non-DOM consumer: fall back to the design size rather than
  // throwing on `window`.
  if (typeof window === 'undefined') return MIN_SCALE;
  const byWidth = window.innerWidth / BASE_WIDTH;
  const byHeight = window.innerHeight / BASE_HEIGHT;
  return quantize(clamp(Math.min(byWidth, byHeight), MIN_SCALE, MAX_SCALE));
}

/**
 * The current UI scale, in [1, 2.2]. Apply it as `--ui-scale`; do not multiply
 * individual values by it.
 *
 * The initial value is read synchronously in the `useState` initializer rather
 * than in an effect, because an effect-set value means the first paint happens
 * at scale 1 and then everything jumps — visible as a flash of tiny UI on a
 * large screen.
 */
export function useResponsiveScale(): number {
  const [scale, setScale] = useState<number>(measure);

  useEffect(() => {
    const onResize = () => setScale(measure());
    // `passive`: this listener never calls preventDefault, and saying so lets
    // the browser keep resize/scroll off the main thread's critical path.
    window.addEventListener('resize', onResize, { passive: true });
    // A mobile rotate can fire `orientationchange` with the old innerWidth on
    // some iOS versions, but `resize` always follows it, so one listener is
    // enough — this re-measure is here purely to catch the case where the
    // viewport changed between first render and effect attachment (address bar
    // collapse on load).
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return scale;
}
