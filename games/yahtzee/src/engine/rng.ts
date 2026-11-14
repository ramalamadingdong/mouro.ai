/**
 * Deterministic PRNG for the engine. DOM/crypto-free: seeds are supplied by the
 * caller (see src/util/seed.ts, which is where `crypto.getRandomValues` lives so
 * this module stays runnable in plain Node for tests and the replay pipeline).
 *
 * cyrb128-style hash of the seed array -> sfc32 generator. All arithmetic goes
 * through Math.imul / |0 / >>>0 so two clients on different JS engines compute
 * byte-identical rolls from the same seed.
 */

/** Deterministic PRNG in [0,1). `seed` is an array of integers. */
export function makeRng(seed: number[]): () => number {
  let h1 = 1779033703 ^ seed.length;
  let h2 = 3144134277 ^ seed.length;
  let h3 = 1013904242 ^ seed.length;
  let h4 = 2773480762 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    const k = seed[i] | 0;
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }

  let a = (h1 ^ h2) >>> 0;
  let b = (h3 ^ h4) >>> 0;
  let c = (h1 ^ h3) >>> 0;
  let d = (h2 ^ h4) >>> 0;

  // sfc32
  return function next(): number {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** One die face in 1..faces. */
export function rollDie(rng: () => number, faces: number): number {
  return 1 + Math.floor(rng() * faces);
}
