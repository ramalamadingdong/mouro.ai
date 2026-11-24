import { describe, expect, it } from 'vitest';
import {
  ANY_PLAYER,
  applyMove,
  createGame,
  handValue,
  holeCardShown,
  legalActions,
  parseCards,
  totalChips,
  type GameState,
} from '@/engine';
import { act, betAll, deal, finish, must, newGame, next, stack, uidOf } from './helpers';

/** Deal round 1, everyone bets `bet`, stack the shoe, deal the cards. */
function round(players: number, cards: string, bet: number | number[] = 100): GameState {
  let s = betAll(deal(newGame(players)), bet);
  s = stack(s, cards);
  return next(s);
}

describe('createGame', () => {
  it('seats one to eight', () => {
    expect(() => newGame(0)).toThrow();
    expect(() => newGame(9)).toThrow();
    const s = newGame(8);
    expect(s.players).toHaveLength(8);
    expect(s.phase).toBe('idle');
    expect(s.turnUid).toBe(ANY_PLAYER);
  });
  it('rounds the limits to the bet step', () => {
    const s = createGame({ players: [{ uid: 'a', name: 'A', isHuman: true }], startingStack: 1000, minBet: 27, maxBet: 333 });
    expect(s.config.minBet).toBe(25);
    expect(s.config.maxBet).toBe(330);
  });
});

describe('betting', () => {
  it('goes round the table in seat order, then waits for the dealer', () => {
    let s = deal(newGame(3));
    expect(s.phase).toBe('betting');
    expect(s.toAct).toBe(0);
    s = act(s, { kind: 'bet', amount: 50 });
    expect(s.toAct).toBe(1);
    expect(s.players[0].stack).toBe(950);
    s = act(s, { kind: 'bet', amount: 0 }); // sits out
    s = act(s, { kind: 'bet', amount: 500 });
    expect(s.toAct).toBeNull();
    expect(s.turnUid).toBe(ANY_PLAYER);
    expect(s.players[1].hands).toHaveLength(0);
  });

  it('refuses a bet off the step, under the minimum, over the maximum or out of turn', () => {
    const s = deal(newGame(2));
    for (const amount of [12, 5, 505, -10]) expect(applyMove(s, { kind: 'bet', amount }, uidOf(0)).ok).toBe(false);
    expect(applyMove(s, { kind: 'bet', amount: 10 }, uidOf(1)).ok).toBe(false);
    expect(applyMove(s, { kind: 'hit' }, uidOf(0)).ok).toBe(false);
  });

  it('caps the maximum at the stack', () => {
    const s = deal(newGame(1, 120));
    const legal = legalActions(s);
    expect(legal?.kind === 'bet' && legal.maxBet).toBe(120);
  });

  it('skips a seat that cannot afford the minimum', () => {
    let s = deal(newGame(3));
    s = { ...s, players: s.players.map((p, i) => (i === 1 ? { ...p, stack: 5 } : p)), house: 995 };
    s = act(s, { kind: 'bet', amount: 10 });
    expect(s.toAct).toBe(2);
  });
});

describe('the deal', () => {
  it('two cards each, the dealer last, hole card hidden', () => {
    const s = round(2, '2c 3c 4c 5c 6c 7c');
    expect(s.players[0].hands[0].cards).toEqual(parseCards('2c 5c'));
    expect(s.players[1].hands[0].cards).toEqual(parseCards('3c 6c'));
    expect(s.dealer).toEqual(parseCards('4c 7c'));
    expect(s.phase).toBe('playing');
    expect(holeCardShown(s)).toBe(false);
    expect(s.toAct).toBe(0);
  });

  it('a blackjack pays 3:2 and is skipped in play', () => {
    let s = round(2, 'As 9c 7d Kh 9d Td');
    expect(s.players[0].hands[0].done).toBe(true);
    expect(s.toAct).toBe(1);
    s = finish(s);
    expect(s.players[0].hands[0].outcome).toBe('blackjack');
    expect(s.result!.net[0]).toBe(150);
    expect(s.players[0].stack).toBe(1150);
    expect(s.result!.net[1]).toBe(100); // 18 beats the dealer's 17
  });

  it('a blackjack on an odd multiple of 5 pays 3:2 rounded down', () => {
    const s = finish(round(1, 'As 9c Kh 8d', 25));
    expect(s.players[0].hands[0].outcome).toBe('blackjack');
    expect(s.result!.net[0]).toBe(37);
    expect(s.players[0].stack).toBe(1037);
  });

  it('the dealer peeks under a ten and settles at once', () => {
    const s = round(2, '9c Tc Ks 9d Td Ah');
    expect(s.phase).toBe('settled');
    expect(s.result!.dealerBlackjack).toBe(true);
    expect(s.result!.net).toEqual([-100, -100]);
    expect(s.house).toBe(200);
  });

  it('under an Ace too, with no insurance offered', () => {
    const s = round(2, '9c Tc As 9d Td Kh');
    expect(s.phase).toBe('settled');
    expect(s.result!.dealerBlackjack).toBe(true);
  });

  it('blackjack against a dealer blackjack is a push', () => {
    const s = round(1, 'As Ac Kd Kh');
    expect(s.players[0].hands[0].outcome).toBe('push');
    expect(s.players[0].stack).toBe(1000);
  });

  it('a lone sit-out round settles with nothing dealt', () => {
    let s = deal(newGame(1));
    s = act(s, { kind: 'bet', amount: 0 });
    s = next(s);
    expect(s.phase).toBe('settled');
    expect(s.dealer).toEqual([]);
  });
});

describe('playing a hand', () => {
  it('hit until bust ends the hand', () => {
    let s = round(1, 'Tc 7c 6c 9d Kd');
    s = act(s, { kind: 'hit' });
    expect(s.players[0].hands[0].done).toBe(true);
    expect(s.players[0].lastAction?.kind).toBe('bust');
    expect(s.toAct).toBeNull();
    s = finish(s);
    expect(s.players[0].hands[0].outcome).toBe('bust');
    // Every player busted: the dealer does not draw.
    expect(s.dealer).toHaveLength(2);
  });

  it('21 stands by itself', () => {
    let s = round(1, '5c 7c 6c 9d Kd');
    s = act(s, { kind: 'hit' });
    expect(handValue(s.players[0].hands[0].cards).total).toBe(21);
    expect(s.toAct).toBeNull();
  });

  it('double: one card, twice the bet', () => {
    let s = round(1, '6c 9c 5d Td Kd 8h');
    s = act(s, { kind: 'double' });
    const h = s.players[0].hands[0];
    expect(h.bet).toBe(200);
    expect(h.cards).toHaveLength(3);
    expect(h.done).toBe(true);
    s = finish(s); // 21 vs dealer 9+T=19
    expect(s.result!.net[0]).toBe(200);
    expect(s.players[0].stack).toBe(1200);
  });

  it('split: two hands, each played in turn, each paid separately', () => {
    let s = round(1, '8c 9c 8d Td 3h Kh 2s');
    expect(legalActions(s)).toMatchObject({ kind: 'play', canSplit: true });
    s = act(s, { kind: 'split' });
    const p = s.players[0];
    expect(p.hands).toHaveLength(2);
    expect(p.hands[0].cards).toEqual(parseCards('8c 3h'));
    expect(p.hands[1].cards).toEqual(parseCards('8d Kh'));
    expect(p.stack).toBe(800);
    expect(p.active).toBe(0);
    s = act(s, { kind: 'double' }); // 8+3+2s = 13, doubled
    expect(s.players[0].active).toBe(1);
    s = act(s, { kind: 'stand' }); // 18
    s = finish(s); // dealer 19
    expect(s.players[0].hands.map((h) => h.outcome)).toEqual(['lose', 'lose']);
    expect(s.result!.net[0]).toBe(-300);
  });

  it('split Aces take one card each, and 21 there is not a blackjack', () => {
    let s = round(1, 'As 9c Ad 8d Kh 5h');
    s = act(s, { kind: 'split' });
    expect(s.players[0].hands.every((h) => h.done)).toBe(true);
    expect(s.toAct).toBeNull();
    s = finish(s);
    // A+K is 21 but only wins 1:1; A+5 is 16 and loses to the dealer's 17.
    expect(s.players[0].hands.map((h) => h.outcome)).toEqual(['win', 'lose']);
    expect(s.result!.net[0]).toBe(0);
  });

  it('no more than four hands', () => {
    let s = round(1, '8c 9c 8d Td 8h 8s 8c#1 8d#1 2c 2d 2h');
    s = act(s, { kind: 'split' });
    s = act(s, { kind: 'split' });
    s = act(s, { kind: 'split' });
    expect(s.players[0].hands).toHaveLength(4);
    expect(legalActions(s)).toMatchObject({ canSplit: false });
  });

  it('cannot double or split without the chips', () => {
    let s = betAll(deal(newGame(1, 100)), 100);
    s = next(stack(s, '8c 9c 8d Td'));
    expect(legalActions(s)).toMatchObject({ canDouble: false, canSplit: false });
    expect(applyMove(s, { kind: 'double' }, uidOf(0)).ok).toBe(false);
  });
});

describe('the dealer', () => {
  it('turns the hole card, then draws one card per `next` to 17, standing on soft 17', () => {
    let s = round(1, 'Tc 6c Td 5d 2c Ac');
    s = act(s, { kind: 'stand' });
    s = next(s);
    expect(s.phase).toBe('dealer');
    expect(holeCardShown(s)).toBe(true);
    s = next(s); // 6+5 → 11, draws 2 → 13
    expect(s.dealer).toHaveLength(3);
    s = next(s); // draws A → soft... 13+A = 14 hard
    expect(s.dealer).toHaveLength(4);
    expect(handValue(s.dealer).total).toBe(14);
  });

  it('hits soft 17 (Vegas rules)', () => {
    let s = round(1, 'Tc 6c Td Ac 2c');
    s = act(s, { kind: 'stand' });
    s = next(next(s)); // hole card, then the soft 17 must draw
    expect(s.dealer).toHaveLength(3);
    s = next(s);
    expect(s.result!.dealerTotal).toBe(19);
    expect(s.result!.net[0]).toBe(100); // our 20 still beats it
  });

  it('stands on hard 17', () => {
    let s = round(1, 'Tc Tc#1 Td 7d');
    s = act(s, { kind: 'stand' });
    s = next(next(s));
    expect(s.phase).toBe('settled');
    expect(s.result!.dealerTotal).toBe(17);
    expect(s.result!.net[0]).toBe(100);
  });

  it('a dealer bust pays every standing hand', () => {
    let s = round(2, 'Tc 2c 6d Td 3c Td#1 Kd');
    s = act(s, { kind: 'stand' });
    s = act(s, { kind: 'stand' });
    s = finish(s);
    expect(s.result!.dealerTotal).toBe(26);
    expect(s.result!.net).toEqual([100, 100]);
  });

  it('`next` from a stale step is refused', () => {
    let s = round(1, 'Tc 6c Td 5d 2c Ac');
    s = act(s, { kind: 'stand' });
    s = next(s);
    const stale = { kind: 'next', from: 'dealer', dealerCards: 2 } as const;
    s = must(s, stale, uidOf(0));
    expect(applyMove(s, stale, uidOf(0)).ok).toBe(false);
    expect(applyMove(s, { kind: 'next', from: 'playing', dealerCards: 3 }, uidOf(0)).ok).toBe(false);
  });
});

describe('tipping the dealer', () => {
  it('goes to the house, keeps your turn, and is counted', () => {
    let s = deal(newGame(2));
    s = act(s, { kind: 'tip', amount: 25 });
    expect(s.toAct).toBe(0);
    expect(s.players[0].stack).toBe(975);
    expect(s.players[0].tipped).toBe(25);
    expect(s.house).toBe(25);
    expect(totalChips(s)).toBe(2000);
    s = act(s, { kind: 'tip', amount: 5 });
    expect(s.players[0].tipped).toBe(30);
    s = act(s, { kind: 'bet', amount: 10 });
    expect(s.toAct).toBe(1);
  });

  it('only on your betting turn, and never more than you have', () => {
    const s = deal(newGame(2));
    expect(applyMove(s, { kind: 'tip', amount: 5 }, uidOf(1)).ok).toBe(false);
    expect(applyMove(s, { kind: 'tip', amount: 991 }, uidOf(0)).ok).toBe(false); // must keep the 10 minimum
    expect(applyMove(s, { kind: 'tip', amount: 990 }, uidOf(0)).ok).toBe(true);
    expect(applyMove(s, { kind: 'tip', amount: 0 }, uidOf(0)).ok).toBe(false);
    const playing = next(stack(betAll(s, 10), 'Tc 9c 6d 7d 8h 2s'));
    expect(applyMove(playing, { kind: 'tip', amount: 5 }, uidOf(playing.toAct!)).ok).toBe(false);
  });
});

describe('late surrender', () => {
  it('gives back half the bet on the first two cards only', () => {
    let s = round(1, 'Tc 9c 6d Kd 2h');
    expect(legalActions(s)).toMatchObject({ canSurrender: true });
    s = act(s, { kind: 'surrender' });
    expect(s.players[0].hands[0].outcome).toBe('surrender');
    s = finish(s);
    expect(s.players[0].hands[0].outcome).toBe('surrender');
    expect(s.result!.net[0]).toBe(-50);
    // nobody left to play for: the dealer does not draw
    expect(s.dealer).toHaveLength(2);
    expect(totalChips(s)).toBe(1000);
  });

  it('not after a hit or a split', () => {
    let s = round(1, '8c 9c 8d Td 2h 3h');
    s = act(s, { kind: 'split' });
    expect(legalActions(s)).toMatchObject({ canSurrender: false });
    s = round(1, '5c 9c 5d Td 2h');
    s = act(s, { kind: 'hit' });
    expect(legalActions(s)).toMatchObject({ canSurrender: false });
    expect(applyMove(s, { kind: 'surrender' }, uidOf(0)).ok).toBe(false);
  });
});

describe('away', () => {
  it('sits out a betting player and stands a playing one', () => {
    let s = deal(newGame(2));
    expect(applyMove(s, { kind: 'away' }, uidOf(0)).ok).toBe(false);
    s = must(s, { kind: 'away' }, uidOf(1));
    expect(s.players[0].sitOut).toBe(true);
    expect(s.players[0].hands).toHaveLength(0);
    s = act(s, { kind: 'bet', amount: 10 });
    s = next(stack(s, 'Tc 6c 9d 5d'));
    s = must(s, { kind: 'away' }, uidOf(0));
    expect(s.players[1].hands[0].done).toBe(true);
    expect(s.players[1].sitOut).toBe(true);
  });
});

describe('game over', () => {
  it('after the last round, the chip leader wins', () => {
    let s = newGame(2, 1000, 1);
    s = finish(stack(betAll(deal(s), [10, 100]), 'Tc Kc 7d Td Qd Kd'));
    // seat 0: T+T=20, seat 1: K+Q=20, dealer 7+K=17: both win
    s = deal(s);
    expect(s.phase).toBe('gameover');
    expect(s.winner).toBe(1);
    s = must(s, { kind: 'rematch', seed: [4] }, uidOf(0));
    expect(s.phase).toBe('betting');
    expect(s.handNo).toBe(1);
    expect(s.players.every((p) => p.stack === 1000)).toBe(true);
    expect(s.house).toBe(0);
  });

  it('when no human can bet', () => {
    let s = deal(newGame(2, 10));
    s = finish(stack(betAll(s, 10), 'Tc Kc As 6d Kd Qh'));
    expect(s.players[0].stack).toBe(0);
    s = deal(s);
    expect(s.phase).toBe('gameover');
  });

  it('chips are conserved with the house holding the difference', () => {
    const s = round(3, '9c 9d 9h As Kd');
    expect(totalChips(s)).toBe(3000);
  });
});
