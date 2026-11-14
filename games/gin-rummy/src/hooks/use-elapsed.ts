import { useEffect, useState } from 'react';

/**
 * Re-render on an interval while `active`, returning the current epoch ms. The
 * timer only runs while active, so an idle screen pays nothing. Use it to
 * recompute "time since X" for a UI hint (never for game logic).
 */
export function useElapsed(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}
