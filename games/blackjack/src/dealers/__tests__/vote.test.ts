import { describe, expect, it } from 'vitest';
import { tallyVotes } from '@/dealers';

const seats = { a: {}, b: {}, c: {}, host: {} };

describe('tallyVotes', () => {
  it('no votes: the default dealer', () => {
    expect(tallyVotes({}, seats, 'host')).toBe('duchess');
  });
  it('most votes wins', () => {
    expect(tallyVotes({ a: 'lou', b: 'lou', host: 'nana' }, seats, 'host')).toBe('lou');
  });
  it('a tie goes to the host’s pick', () => {
    expect(tallyVotes({ a: 'lou', host: 'unit9' }, seats, 'host')).toBe('unit9');
  });
  it('a tie the host is not part of goes to the first in the list', () => {
    expect(tallyVotes({ a: 'unit9', b: 'nana', host: 'lou', c: 'lou' }, { ...seats }, 'host')).toBe('lou');
    expect(tallyVotes({ a: 'unit9', b: 'nana' }, seats, 'host')).toBe('nana');
  });
  it('ignores players who left and unknown dealers', () => {
    expect(tallyVotes({ gone: 'unit9', gone2: 'unit9', a: 'nana', b: 'bogus' }, seats, 'host')).toBe('nana');
  });
});
