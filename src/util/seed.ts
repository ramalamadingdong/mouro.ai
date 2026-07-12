/**
 * App-side crypto helpers. These live OUTSIDE the engine so the engine stays
 * free of React Native / Expo imports. Seeds produced here feed `makeRng`.
 */
import * as Crypto from 'expo-crypto';

/**
 * 8 integers (each 0..65535) derived from 16 cryptographically-random bytes.
 * Used as the deterministic engine seed for shuffling a fresh deal.
 */
export function randomSeed(): number[] {
  const bytes = Crypto.getRandomBytes(16);
  const seed: number[] = [];
  for (let i = 0; i < 8; i++) {
    seed.push((bytes[i * 2] << 8) | bytes[i * 2 + 1]);
  }
  return seed;
}

/** Room-code alphabet: no 0/O/1/I/L. Matches the rules regex ^[A-HJKMNP-Z2-9]{5}$. */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** A 5-character crypto-random room code drawn from CODE_ALPHABET. */
export function randomRoomCode(): string {
  const bytes = Crypto.getRandomBytes(5);
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}
