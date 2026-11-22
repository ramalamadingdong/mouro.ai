/**
 * The engine's only source of randomness: a seeded generator. The seed travels
 * inside the move that deals, so every client replays the same wall.
 */

/** mulberry32: small, fast, and plenty for shuffling 144 tiles. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates over the characters of `tiles`. */
export function shuffle(tiles: string, seed: number): string {
  const out = Array.from(tiles);
  const random = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}
