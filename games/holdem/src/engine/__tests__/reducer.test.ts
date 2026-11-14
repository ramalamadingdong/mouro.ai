import { describe, expect, it } from 'vitest';
import {
  ANY_PLAYER,
  applyMove,
  blindsForHand,
  legalActions,
  potTotal,
  totalChips,
  type GameState,
} from '@/engine';
import { act, deal, dealWithButton, must, newGame, next, rig, runOut, uidOf } from './helpers';

/** Give seats custom stacks before the first deal. */
function withStacks(state: GameState, stacks: number[]): GameState {
  return { ...state, players: state.players.map((p, i) => ({ ...p, stack: stacks[i] })) };
}

const bets = (s: GameState) => s.players.map((p) => p.bet);
const stacks = (s: GameState) => s.players.map((p) => p.stack);

describe('blinds and order of action', () => {
  it('heads-up: the button posts the small blind and acts first preflop, last after', () => {
    let s = dealWithButton(newGame(2), 1);
    expect(s.smallBlind).toBe(10);
    expect(s.bigBlind).toBe(20);
    expect(bets(s)).toEqual([20, 10]); // seat 1 is the button AND the small blind
    expect(s.toAct).toBe(1);
    expect(s.turnUid).toBe(uidOf(1));
    s = act(s, { kind: 'call' });
    expect(s.toAct).toBe(0); // big blind's option
    s = act(s, { kind: 'check' });
    expect(s.toAct).toBeNull();
    s = next(s);
    expect(s.phase).toBe('flop');
    expect(s.toAct).toBe(0); // big blind first postflop
  });

  it('three-handed: blinds sit left of the button, the button opens preflop', () => {
    let s = dealWithButton(newGame(3), 0);
    expect(bets(s)).toEqual([0, 10, 20]);
    expect(s.toAct).toBe(0);
    s = act(s, { kind: 'call' });
    s = act(s, { kind: 'call' });
    s = act(s, { kind: 'check' });
    s = next(s);
    expect(s.toAct).toBe(1); // small blind first postflop
  });

  it('six-handed: under the gun is third left of the button', () => {
    const s = dealWithButton(newGame(6), 2);
    expect(bets(s)).toEqual([0, 0, 0, 10, 20, 0]);
    expect(s.toAct).toBe(5);
  });

  it('the button moves one seat each hand and skips busted players', () => {
    let s = dealWithButton(newGame(4), 0);
    s = act(s, { kind: 'fold' });
    s = act(s, { kind: 'fold' });
    s = act(s, { kind: 'fold' });
    expect(s.phase).toBe('showdown');
    // Bust seat 1 by hand, then deal: the button must skip it.
    s = { ...s, players: s.players.map((p, i) => (i === 1 ? { ...p, stack: 0 } : i === 2 ? { ...p, stack: p.stack + s.players[1].stack } : p)) };
    s = deal(s, 7);
    expect(s.button).toBe(2);
    expect(s.players[1].inHand).toBe(false);
    expect(s.players[1].hole).toEqual([]);
    expect(bets(s)).toEqual([20, 0, 0, 10]);
  });

  it('blinds step up on schedule and keep doubling past the table', () => {
    expect(blindsForHand(20, 6, 1)).toMatchObject({ smallBlind: 10, bigBlind: 20, level: 1 });
    expect(blindsForHand(20, 6, 6)).toMatchObject({ bigBlind: 20 });
    expect(blindsForHand(20, 6, 7)).toMatchObject({ smallBlind: 15, bigBlind: 30, level: 2 });
    expect(blindsForHand(20, 6, 13)).toMatchObject({ bigBlind: 40 });
    const late = blindsForHand(20, 1, 14).bigBlind;
    expect(blindsForHand(20, 1, 15).bigBlind).toBe(late * 2);
    expect(blindsForHand(20, 1, 16).bigBlind).toBe(late * 4);
  });

  it('applies the new level to the hand being dealt', () => {
    let s = dealWithButton(newGame(2, 1000, 1), 0);
    s = act(s, { kind: 'fold' });
    s = deal(s, 3);
    expect(s.handNo).toBe(2);
    expect(s.bigBlind).toBe(30);
  });
});

describe('betting rounds', () => {
  it('a limped pot gives the big blind an option, and a raise reopens it', () => {
    let s = dealWithButton(newGame(3), 0);
    s = act(s, { kind: 'call' });
    s = act(s, { kind: 'call' });
    expect(s.toAct).toBe(2);
    expect(legalActions(s)).toMatchObject({ canCheck: true, canRaise: true, minRaiseTo: 40 });
    s = act(s, { kind: 'raise', to: 80 });
    expect(s.toAct).toBe(0);
    s = act(s, { kind: 'call' });
    s = act(s, { kind: 'fold' });
    expect(s.toAct).toBeNull(); // everyone left has matched 80
    expect(s.turnUid).toBe(ANY_PLAYER);
    expect(potTotal(s)).toBe(180);
  });

  it('a checked-around street closes after the last check, not before', () => {
    let s = dealWithButton(newGame(3), 0);
    s = act(s, { kind: 'call' });
    s = act(s, { kind: 'call' });
    s = act(s, { kind: 'check' });
    s = next(s);
    s = act(s, { kind: 'check' });
    s = act(s, { kind: 'check' });
    expect(s.toAct).toBe(0);
    s = act(s, { kind: 'check' });
    expect(s.toAct).toBeNull();
    expect(s.phase).toBe('flop');
  });

  it('the hand ends the moment only one player is left', () => {
    let s = dealWithButton(newGame(3), 0);
    s = act(s, { kind: 'raise', to: 60 });
    s = act(s, { kind: 'fold' });
    s = act(s, { kind: 'fold' });
    expect(s.phase).toBe('showdown');
    expect(s.result?.showdown).toBe(false);
    expect(s.result?.hands.every((h) => h === null)).toBe(true);
    // The raiser gets the blinds; the 40 nobody called came straight back.
    expect(stacks(s)).toEqual([1030, 990, 980]);
    expect(s.result?.won[0]).toBe(50);
  });

  it('min-raise is the size of the last raise', () => {
    let s = dealWithButton(newGame(3), 0);
    expect(legalActions(s)).toMatchObject({ minRaiseTo: 40, maxRaiseTo: 1000 });
    expect(applyMove(s, { kind: 'raise', to: 39 }, uidOf(0)).ok).toBe(false);
    s = act(s, { kind: 'raise', to: 60 }); // a raise OF 40
    expect(legalActions(s)).toMatchObject({ callAmount: 50, minRaiseTo: 100 });
    expect(applyMove(s, { kind: 'raise', to: 99 }, uidOf(1)).ok).toBe(false);
    s = act(s, { kind: 'raise', to: 180 }); // a raise OF 120
    expect(legalActions(s)).toMatchObject({ callAmount: 160, minRaiseTo: 300 });
    expect(applyMove(s, { kind: 'raise', to: 1001 }, uidOf(2)).ok).toBe(false);
    expect(applyMove(s, { kind: 'raise', to: 300.5 }, uidOf(2)).ok).toBe(false);
  });

  it('the opening bet after the flop must be at least the big blind', () => {
    let s = dealWithButton(newGame(2), 1);
    s = act(s, { kind: 'call' });
    s = act(s, { kind: 'check' });
    s = next(s);
    expect(legalActions(s)).toMatchObject({ canCheck: true, minRaiseTo: 20 });
    expect(applyMove(s, { kind: 'raise', to: 19 }, uidOf(0)).ok).toBe(false);
    s = act(s, { kind: 'raise', to: 20 });
    expect(s.players[0].lastAction).toEqual({ kind: 'bet', amount: 20 });
    expect(legalActions(s)).toMatchObject({ callAmount: 20, minRaiseTo: 40 });
  });

  it('a stack shorter than the minimum raise may still shove', () => {
    let s = dealWithButton(withStacks(newGame(3), [1000, 1000, 55]), 1);
    // seat 2 is the small blind (10 in, 45 behind); seat 0 is the big blind.
    s = act(s, { kind: 'raise', to: 60 });
    expect(s.toAct).toBe(2);
    expect(legalActions(s)).toMatchObject({ callAmount: 45, canRaise: false });
    s = act(s, { kind: 'call' });
    expect(s.players[2].allIn).toBe(true);
    expect(s.players[2].lastAction?.kind).toBe('allin');
  });

  it('a short all-in raise does not reopen the betting for players who already acted', () => {
    let s = dealWithButton(withStacks(newGame(3), [1000, 1000, 150]), 0);
    s = act(s, { kind: 'call' });
    s = act(s, { kind: 'call' });
    s = act(s, { kind: 'check' });
    s = next(s); // flop: seat 1, seat 2 (130 behind), seat 0
    s = act(s, { kind: 'check' });
    s = act(s, { kind: 'check' });
    s = act(s, { kind: 'raise', to: 100 }); // seat 0 bets 100
    s = act(s, { kind: 'call' }); // seat 1 calls
    expect(legalActions(s)).toMatchObject({ seat: 2, minRaiseTo: 130, maxRaiseTo: 130, canRaise: true });
    s = act(s, { kind: 'raise', to: 130 }); // all-in, only 30 more: NOT a full raise
    expect(s.minRaise).toBe(100);
    expect(legalActions(s)).toMatchObject({ seat: 0, callAmount: 30, canRaise: false });
    expect(applyMove(s, { kind: 'raise', to: 400 }, uidOf(0)).ok).toBe(false);
    s = act(s, { kind: 'call' });
    expect(legalActions(s)).toMatchObject({ seat: 1, callAmount: 30, canRaise: false });
    s = act(s, { kind: 'call' });
    expect(s.toAct).toBeNull();
  });

  it('a full all-in raise does reopen it', () => {
    let s = dealWithButton(withStacks(newGame(3), [1000, 1000, 320]), 0);
    s = act(s, { kind: 'call' });
    s = act(s, { kind: 'call' });
    s = act(s, { kind: 'check' });
    s = next(s);
    s = act(s, { kind: 'check' });
    s = act(s, { kind: 'check' });
    s = act(s, { kind: 'raise', to: 100 });
    s = act(s, { kind: 'call' });
    s = act(s, { kind: 'raise', to: 300 }); // all-in for a raise of 200
    expect(legalActions(s)).toMatchObject({ seat: 0, callAmount: 200, canRaise: true, minRaiseTo: 500 });
  });

  it('nobody is asked to act when everyone else is all-in', () => {
    let s = dealWithButton(withStacks(newGame(2), [1000, 200]), 1);
    s = act(s, { kind: 'raise', to: 200 }); // button shoves
    s = act(s, { kind: 'call' });
    expect(s.toAct).toBeNull();
    // Every later street has nobody to act either: only `next` moves it on.
    for (const phase of ['flop', 'turn', 'river'] as const) {
      s = next(s);
      expect(s.phase).toBe(phase);
      expect(s.toAct).toBeNull();
    }
    s = next(s);
    expect(s.phase).toBe('showdown');
    expect(s.board).toHaveLength(5);
  });

  it('a short big blind: the caller is refunded what the blind could not cover', () => {
    let s = dealWithButton(withStacks(newGame(2), [12, 1988]), 1);
    // seat 0 posts a 12-chip big blind all-in; the button's 10 is already... not enough.
    expect(bets(s)).toEqual([12, 10]);
    expect(legalActions(s)).toMatchObject({ seat: 1, callAmount: 10, canRaise: false });
    s = act(s, { kind: 'call' });
    expect(s.toAct).toBeNull();
    expect(bets(s)).toEqual([12, 12]);
    expect(totalChips(s)).toBe(2000);
  });
});

describe('showdown', () => {
  it('best hand wins and the winning five are reported', () => {
    let s = rig(dealWithButton(newGame(2), 1), ['Ah Kd', 'Qc Qd'], '2c 7d Ks 9h 3s');
    s = act(s, { kind: 'call' });
    s = runOut(s);
    expect(s.result?.showdown).toBe(true);
    expect(s.result?.hands[0]?.name).toBe('Pair of Kings');
    expect(s.result?.hands[1]?.name).toBe('Pair of Queens');
    expect(s.result?.pots).toHaveLength(1);
    expect(s.result?.pots[0].winners).toEqual([0]);
    expect(stacks(s)).toEqual([1020, 980]);
  });

  it('multiple all-ins: each pot goes to the best hand eligible for it', () => {
    // Seat 0 (50 chips) has the nuts, seat 1 (200) is second, seat 2 covers.
    let s = rig(dealWithButton(withStacks(newGame(3), [50, 200, 1000]), 0), ['As Ad', 'Ks Kd', '7c 2d'], '3h 8s 9c Jd 4h');
    s = act(s, { kind: 'raise', to: 50 }); // seat 0 all-in
    s = act(s, { kind: 'raise', to: 200 }); // seat 1 all-in over the top
    s = act(s, { kind: 'call' }); // seat 2 calls 200
    expect(s.toAct).toBeNull();
    s = runOut(s);
    expect(s.result?.pots).toEqual([
      { amount: 150, eligible: [0, 1, 2], winners: [0], payouts: [{ seat: 0, amount: 150 }] },
      { amount: 300, eligible: [1, 2], winners: [1], payouts: [{ seat: 1, amount: 300 }] },
    ]);
    expect(stacks(s)).toEqual([150, 300, 800]);
  });

  it('the short stack cannot win more than it could match', () => {
    // Same stacks, but now the big stack has the best hand and scoops both pots.
    let s = rig(dealWithButton(withStacks(newGame(3), [50, 200, 1000]), 0), ['7c 2d', 'Ks Kd', 'As Ad'], '3h 8s 9c Jd 4h');
    s = act(s, { kind: 'raise', to: 50 });
    s = act(s, { kind: 'raise', to: 200 });
    s = act(s, { kind: 'call' });
    s = runOut(s);
    expect(stacks(s)).toEqual([0, 0, 1250]);
    expect(s.result?.won).toEqual([0, 0, 450]);
  });

  it('an over-bet into a shorter all-in is returned before the showdown', () => {
    let s = rig(dealWithButton(withStacks(newGame(2), [1000, 300]), 1), ['2c 3d', 'As Ad'], '9h 8s Kc Jd 4h');
    s = act(s, { kind: 'call' }); // button completes
    s = act(s, { kind: 'raise', to: 1000 }); // big blind shoves 1000 into a 300 stack
    s = act(s, { kind: 'call' }); // all-in for 300
    expect(bets(s)).toEqual([300, 300]);
    expect(s.players[0].stack).toBe(700);
    expect(s.players[0].allIn).toBe(false);
    s = runOut(s);
    expect(stacks(s)).toEqual([700, 600]);
  });

  it('a split pot gives the odd chip to the first winner left of the button', () => {
    // Stack 750 → blinds 7/15. Button (seat 0) and big blind (seat 2) play the
    // board for 15 each; the small blind's dead 7 makes the pot 37.
    let s = rig(dealWithButton(newGame(3, 750), 0), ['2c 3d', '4c 5d', '2h 3s'], 'As Ks Qd Jc Th');
    expect(s.smallBlind).toBe(7);
    s = act(s, { kind: 'call' });
    s = act(s, { kind: 'fold' });
    s = act(s, { kind: 'check' });
    s = runOut(s);
    expect(s.result?.pots[0].winners).toEqual([0, 2]);
    // Seat 2 is nearer the button's left than the button itself.
    expect(s.result?.pots[0].payouts).toEqual([
      { seat: 0, amount: 18 },
      { seat: 2, amount: 19 },
    ]);
    expect(totalChips(s)).toBe(2250);
  });
});

describe('elimination and game over', () => {
  function bustSeat(loser: number, players: number): GameState {
    const holes = Array.from({ length: players }, (_, i) => (i === loser ? '7c 2d' : i === (loser + 1) % players ? 'As Ad' : '3c 4d'));
    let s = rig(dealWithButton(newGame(players), 0), holes, '9h 8s Kc Jd 5h');
    while (s.toAct !== null) {
      const seat = s.toAct;
      const legal = legalActions(s)!;
      if (seat === loser || seat === (loser + 1) % players) {
        s = act(s, legal.canRaise ? { kind: 'raise', to: legal.maxRaiseTo } : { kind: 'call' });
      } else {
        s = act(s, { kind: 'fold' });
      }
    }
    return runOut(s);
  }

  it('heads-up: the winner takes it all and the next deal ends the game', () => {
    let s = bustSeat(1, 2);
    expect(stacks(s)).toEqual([2000, 0]);
    s = deal(s, 9);
    expect(s.phase).toBe('gameover');
    expect(s.winner).toBe(0);
    expect(applyMove(s, { kind: 'deal', seed: [1] }, uidOf(0)).ok).toBe(false);
  });

  it('a busted computer player sits out and the game goes on', () => {
    let s = bustSeat(1, 3);
    expect(s.players[1].stack).toBe(0);
    s = deal(s, 9);
    expect(s.phase).toBe('preflop');
    expect(s.players.map((p) => p.inHand)).toEqual([true, false, true]);
  });

  it('the game ends when the human busts, even with computers left', () => {
    let s = bustSeat(0, 3);
    expect(s.players[0].stack).toBe(0);
    s = deal(s, 9);
    expect(s.phase).toBe('gameover');
    expect(s.winner).toBe(1);
  });

  it('rematch resets every stack and deals hand one', () => {
    let s = deal(bustSeat(1, 2), 9);
    expect(applyMove(dealWithButton(newGame(2), 0), { kind: 'rematch', seed: [1] }, uidOf(0)).ok).toBe(false);
    s = must(s, { kind: 'rematch', seed: [4] }, uidOf(1));
    expect(s.phase).toBe('preflop');
    expect(s.handNo).toBe(1);
    expect(s.winner).toBeNull();
    expect(totalChips(s)).toBe(2000);
    expect(s.players.every((p) => p.inHand)).toBe(true);
  });
});

describe('who may do what', () => {
  it('rejects out-of-turn and impossible moves without touching the state', () => {
    const s = dealWithButton(newGame(3), 0);
    const before = JSON.stringify(s);
    expect(applyMove(s, { kind: 'call' }, uidOf(1))).toEqual({ ok: false, error: 'It is not your turn.' });
    expect(applyMove(s, { kind: 'check' }, uidOf(0)).ok).toBe(false); // facing the big blind
    expect(applyMove(s, { kind: 'next', from: 'preflop' }, uidOf(0)).ok).toBe(false); // round still open
    expect(applyMove(s, { kind: 'deal', seed: [1] }, uidOf(0)).ok).toBe(false);
    expect(applyMove(s, { kind: 'fold' }, 'stranger').ok).toBe(false);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('cannot call when there is nothing to call', () => {
    let s = dealWithButton(newGame(2), 1);
    s = act(s, { kind: 'call' });
    expect(applyMove(s, { kind: 'call' }, uidOf(0)).ok).toBe(false);
  });

  it('a stale `next` from a client that lost the race is refused', () => {
    let s = dealWithButton(newGame(2), 1);
    s = act(s, { kind: 'call' });
    s = act(s, { kind: 'check' });
    const flop = must(s, { kind: 'next', from: 'preflop' }, uidOf(0));
    // Check it down to a closed flop, then replay the old move.
    const closed = act(act(flop, { kind: 'check' }), { kind: 'check' });
    expect(closed.toAct).toBeNull();
    expect(applyMove(closed, { kind: 'next', from: 'preflop' }, uidOf(1)).ok).toBe(false);
    expect(applyMove(closed, { kind: 'next', from: 'flop' }, uidOf(1)).ok).toBe(true);
  });

  it('any seated player may deal and move the streets on', () => {
    let s = must(newGame(3), { kind: 'deal', seed: [5] }, uidOf(2));
    expect(s.lastMove).toEqual({ by: uidOf(2), kind: 'deal', seat: 2 });
    while (s.toAct !== null) s = act(s, legalActions(s)!.canCheck ? { kind: 'check' } : { kind: 'call' });
    s = must(s, { kind: 'next', from: 'preflop' }, uidOf(1));
    expect(s.phase).toBe('flop');
  });

  it('away: another player checks or folds for the absent one, who is marked sitting out', () => {
    let s = dealWithButton(newGame(3), 0);
    expect(applyMove(s, { kind: 'away' }, uidOf(0)).ok).toBe(false); // not for yourself
    s = must(s, { kind: 'away' }, uidOf(1)); // seat 0 faces the blind → folded
    expect(s.players[0]).toMatchObject({ folded: true, sitOut: true });
    expect(s.lastMove).toEqual({ by: uidOf(1), kind: 'away', seat: 0 });
    s = act(s, { kind: 'call' }); // seat 1 completes
    s = must(s, { kind: 'away' }, uidOf(1)); // seat 2 (big blind) can check → checked
    expect(s.players[2]).toMatchObject({ folded: false, sitOut: true });
    expect(s.players[2].lastAction?.kind).toBe('check');
    // Coming back and acting clears the flag.
    s = next(s);
    s = act(s, { kind: 'check' });
    s = act(s, { kind: 'check' });
    expect(s.players[2].sitOut).toBe(false);
  });

  it('is deterministic: same seeds and moves, same game', () => {
    const play = () => {
      let s = deal(newGame(4), 42);
      s = act(s, { kind: 'call' });
      s = act(s, { kind: 'raise', to: 80 });
      return s;
    };
    expect(play()).toEqual(play());
    expect(deal(newGame(4), 42).deck).not.toEqual(deal(newGame(4), 43).deck);
  });
});
