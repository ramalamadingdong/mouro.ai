import { extractCode } from '../room-code';

describe('extractCode', () => {
  const invite = (game: string, path: string) =>
    `Join my ${game} game — code AB3CD\nhttps://mouro.ai/${path}/join/AB3CD\n\n@mouro.ai #AB3CD`;

  it('finds the code in a whole pasted invite message', () => {
    expect(extractCode(invite('gin rummy', 'gin-rummy'))).toBe('AB3CD');
    expect(extractCode(invite('backgammon', 'backgammon'))).toBe('AB3CD');
  });

  it('finds the code in a pasted invite link', () => {
    expect(extractCode('https://mouro.ai/gin-rummy/join/AB3CD')).toBe('AB3CD');
    expect(extractCode('https://mouro.ai/backgammon/join/ab3cd/')).toBe('AB3CD');
  });

  it('finds the code after a label or the autofill marker', () => {
    expect(extractCode('Room code: ab3cd')).toBe('AB3CD');
    expect(extractCode('@mouro.ai #AB3CD')).toBe('AB3CD');
    expect(extractCode('the code is K7MNP, see you there')).toBe('K7MNP');
  });

  it('does not mistake ordinary words for a code', () => {
    expect(extractCode('Come and play rummy with us tonight')).toBe('');
  });

  it('leaves plain typing alone', () => {
    expect(extractCode('')).toBe('');
    expect(extractCode('a')).toBe('A');
    expect(extractCode('ab3')).toBe('AB3');
    expect(extractCode('ab3cd')).toBe('AB3CD');
    expect(extractCode('AB3CDE')).toBe('AB3CD'); // a sixth keystroke is ignored
    expect(extractCode('ab3-cd')).toBe('AB3CD');
    expect(extractCode('ABCDE')).toBe('ABCDE'); // typed, so no digit required
  });
});
