import { SCORING } from '../scoring';

describe('SCORING', () => {
  test('exact constant values', () => {
    expect(SCORING).toEqual({
      GIN: 25,
      BIG_GIN: 31,
      UNDERCUT: 25,
      GAME: 100,
      BOX: 25,
      TARGET: 100,
      SHUTOUT_X: 2,
      KNOCK_MAX: 10,
      HAND_SIZE: 10,
    });
  });
});
