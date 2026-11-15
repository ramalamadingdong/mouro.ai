import { describe, expect, it } from 'vitest';
import { extractRoomCode } from '../seed';

describe('extractRoomCode', () => {
  it('finds the code in a whole pasted invite message', () => {
    const invite =
      'Join my Dots and Boxes game — code AB3CD\nhttps://mouro.ai/dots/join/AB3CD\n\n@mouro.ai #AB3CD';
    expect(extractRoomCode(invite)).toBe('AB3CD');
  });

  it('finds the code in a pasted invite link', () => {
    expect(extractRoomCode('https://mouro.ai/dots/join/AB3CD')).toBe('AB3CD');
    expect(extractRoomCode('https://mouro.ai/dots/join/ab3cd/')).toBe('AB3CD');
  });

  it('finds the code after a label or the autofill marker', () => {
    expect(extractRoomCode('Room code: ab3cd')).toBe('AB3CD');
    expect(extractRoomCode('@mouro.ai #AB3CD')).toBe('AB3CD');
    expect(extractRoomCode('the code is K7MNP, see you there')).toBe('K7MNP');
  });

  it('does not mistake ordinary words for a code', () => {
    expect(extractRoomCode('Come and play some cards with us tonight')).toBe('');
  });

  it('leaves plain typing alone', () => {
    expect(extractRoomCode('')).toBe('');
    expect(extractRoomCode('a')).toBe('A');
    expect(extractRoomCode('ab3')).toBe('AB3');
    expect(extractRoomCode('ab3cd')).toBe('AB3CD');
    expect(extractRoomCode('AB3CDE')).toBe('AB3CD');
    expect(extractRoomCode('ab3-cd')).toBe('AB3CD');
    expect(extractRoomCode('ABCDE')).toBe('ABCDE');
  });
});
