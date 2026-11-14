import { describe, expect, it } from 'vitest';
import { CAT, cardToString, evaluate, parseCards, rankHand } from '@/engine';

const hand = (text: string) => evaluate(parseCards(text));
const best = (text: string) => hand(text).best5.map(cardToString).join(' ');

describe('categories', () => {
  it.each([
    ['As Ks Qs Js Ts 2d 3c', CAT.STRAIGHT_FLUSH, 'Royal Flush'],
    ['9h 8h 7h 6h 5h Ad Ac', CAT.STRAIGHT_FLUSH, 'Straight Flush, Nine high'],
    ['5d 4d 3d 2d Ad Kc Kh', CAT.STRAIGHT_FLUSH, 'Straight Flush, Five high'],
    ['Kc Kd Kh Ks 2d 3c Ah', CAT.QUADS, 'Four of a Kind, Kings'],
    ['Tc Td Th 4s 4d Ac 2h', CAT.FULL_HOUSE, 'Full House, Tens full of Fours'],
    ['Ah Jh 8h 4h 2h Kc Qd', CAT.FLUSH, 'Flush, Ace high'],
    ['Tc 9d 8h 7s 6c Ac Ad', CAT.STRAIGHT, 'Straight, Ten high'],
    ['Ac 2d 3h 4s 5c Kd Qh', CAT.STRAIGHT, 'Straight, Five high'],
    ['7c 7d 7h Ks 2c 9d 4h', CAT.TRIPS, 'Three of a Kind, Sevens'],
    ['Kc Kd Tc Td 3h 6s 2c', CAT.TWO_PAIR, 'Two Pair, Kings and Tens'],
    ['Kc Kd 9c 7d 3h 6s 2c', CAT.PAIR, 'Pair of Kings'],
    ['6c 6d 9c 7d 3h Ks 2c', CAT.PAIR, 'Pair of Sixes'],
    ['Ac Jd 9c 7d 3h 6s 2c', CAT.HIGH, 'Ace high'],
  ])('%s', (text, category, name) => {
    const h = hand(text);
    expect(h.category).toBe(category);
    expect(h.name).toBe(name);
    expect(h.best5).toHaveLength(5);
  });

  it('orders the categories', () => {
    const ladder = [
      'Ac Jd 9c 7d 3h 6s 2c',
      'Kc Kd 9c 7d 3h 6s 2c',
      'Kc Kd Tc Td 3h 6s 2c',
      '7c 7d 7h Ks 2c 9d 4h',
      'Ac 2d 3h 4s 5c Kd Qh',
      'Ah Jh 8h 4h 2h Kc Qd',
      'Tc Td Th 4s 4d Ac 2h',
      'Kc Kd Kh Ks 2d 3c Ah',
      '5d 4d 3d 2d Ad Kc Kh',
    ].map((t) => hand(t).score);
    expect([...ladder].sort((a, b) => a - b)).toEqual(ladder);
    expect(new Set(ladder).size).toBe(ladder.length);
  });
});

describe('the wheel', () => {
  it('is the lowest straight, below a six-high one', () => {
    expect(hand('Ac 2d 3h 4s 5c 9d Kh').score).toBeLessThan(hand('2d 3h 4s 5c 6d 9d Kh').score);
  });
  it('picks 5-4-3-2-A as the five cards', () => {
    expect(best('Ac 2d 3h 4s 5c 9d Kh')).toBe('5c 4s 3h 2d Ac');
  });
  it('does not wrap around: Q-K-A-2-3 is no straight', () => {
    expect(hand('Qc Kd Ah 2s 3c 8d 9h').category).toBe(CAT.HIGH);
  });
  it('prefers the higher straight when six cards connect', () => {
    expect(hand('Ac 2d 3h 4s 5c 6d Kh').name).toBe('Straight, Six high');
  });
});

describe('kickers', () => {
  it('a pair is decided by the first kicker that differs', () => {
    expect(hand('Kc Kd Ah 9s 4c 3d 2h').score).toBeGreaterThan(hand('Ks Kh Qh 9d 4d 3c 2s').score);
    expect(hand('Kc Kd Ah 9s 5c 3d 2h').score).toBeGreaterThan(hand('Ks Kh Ad 9d 4d 3c 2s').score);
  });
  it('only five cards play: a sixth-card difference is a tie', () => {
    expect(hand('Kc Kd Ah Qs Jc 3d 2h').score).toBe(hand('Ks Kh Ad Qd Jd 5c 4s').score);
  });
  it('two pair uses the best kicker, even from a third pair', () => {
    const h = hand('Ac Ad Kc Kd Qh Qs 2c');
    expect(h.name).toBe('Two Pair, Aces and Kings');
    expect(best('Ac Ad Kc Kd Qh Qs 2c')).toBe('Ac Ad Kc Kd Qh');
    expect(h.score).toBeGreaterThan(hand('Ah As Kh Ks Jh 9s 2d').score);
  });
  it('quads use the board kicker', () => {
    expect(hand('9c 9d 9h 9s Ac 2d 3h').score).toBeGreaterThan(hand('9c 9d 9h 9s Kc Qd Jh').score);
  });
  it('flushes compare all five cards', () => {
    expect(hand('Ah Jh 8h 4h 3h 2c 2d').score).toBeGreaterThan(hand('As Js 8s 4s 2s 3c 3d').score);
  });
  it('a flush uses the five highest of six suited cards', () => {
    expect(best('Ah Jh 8h 4h 3h 2h Kc')).toBe('Ah Jh 8h 4h 3h');
  });
});

describe('seven-card corner cases', () => {
  it('two sets of trips make a full house, higher trips on top', () => {
    const h = hand('8c 8d 8h 5c 5d 5h Ks');
    expect(h.name).toBe('Full House, Eights full of Fives');
    expect(best('8c 8d 8h 5c 5d 5h Ks')).toBe('8c 8d 8h 5c 5d');
  });
  it('trips with two pairs picks the higher pair', () => {
    expect(hand('8c 8d 8h 5c 5d Ks Kh').name).toBe('Full House, Eights full of Kings');
  });
  it('a flush beats a straight on the same board', () => {
    expect(hand('9h 8h 7h 6c 5d 2h Ah').category).toBe(CAT.FLUSH);
  });
  it('a straight flush is found even when a higher plain straight exists', () => {
    // 5-9 of hearts, plus an offsuit Ten making a ten-high straight.
    const h = hand('9h 8h 7h 6h 5h Tc 2d');
    expect(h.name).toBe('Straight Flush, Nine high');
  });
  it('identical hands on the board tie', () => {
    expect(hand('2c 3d As Ks Qs Js Ts').score).toBe(hand('4c 5d As Ks Qs Js Ts').score);
  });
});

describe('short hands (the "your hand" readout)', () => {
  it('names two hole cards', () => {
    expect(hand('Kc Kd').name).toBe('Pair of Kings');
    expect(hand('Ac 7d').name).toBe('Ace high');
    expect(hand('Kc Kd').best5).toHaveLength(2);
  });
  it('never invents a straight or flush from fewer than five cards', () => {
    expect(rankHand(parseCards('Ah Kh Qh Jh')).category).toBe(CAT.HIGH);
  });
});
