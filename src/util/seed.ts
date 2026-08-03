/**
 * App-side crypto helpers. These live OUTSIDE the engine so the engine stays
 * free of React Native / Expo imports. Seeds produced here feed `makeRng`.
 */
import * as Crypto from 'expo-crypto';

import { CODE_ALPHABET, CODE_LENGTH, hasDigit } from '@/util/room-code';

/**
 * 8 integers (each 0..65535) derived from 16 cryptographically-random bytes.
 *
 * Every roll of the dice carries one of these inside the move, which is what
 * makes a whole match replayable from its initial state plus the move log.
 */
export function randomSeed(): number[] {
  const bytes = Crypto.getRandomBytes(16);
  const seed: number[] = [];
  for (let i = 0; i < 8; i++) {
    seed.push((bytes[i * 2] << 8) | bytes[i * 2 + 1]);
  }
  return seed;
}

/**
 * A crypto-random room code.
 *
 * Two details that look fussy and are not:
 *
 * 1. REJECTION SAMPLING, not `byte % 31`. The alphabet is 31 characters and a
 *    byte is 0..255, which is not a multiple of 31 — so plain modulo makes the
 *    first eight characters ('2'..'9') about 4% likelier than the rest. It would
 *    never be noticed and it needlessly shrinks the effective code space, so
 *    bytes that land in the ragged tail are discarded instead.
 *
 * 2. AT LEAST ONE DIGIT, enforced by redrawing. See `hasDigit` — OS autofill of
 *    a code out of a text message requires it. About 22% of raw draws are all
 *    letters ((23/31)^5), so this costs ~1.3 draws on average and removes
 *    6.4M of the 28.6M codes, leaving 22.2M.
 */
export function randomRoomCode(): string {
  for (;;) {
    let code = '';
    while (code.length < CODE_LENGTH) {
      // One byte per attempted character; discard the biased tail.
      const [byte] = Crypto.getRandomBytes(1);
      const limit = 256 - (256 % CODE_ALPHABET.length);
      if (byte >= limit) continue;
      code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    }
    if (hasDigit(code)) return code;
  }
}
