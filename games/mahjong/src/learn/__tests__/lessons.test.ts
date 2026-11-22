import { describe, expect, it } from 'vitest';
import { t } from '@/engine';
import { LESSONS } from '@/learn/lessons';

describe('the lessons', () => {
  it('every question has a right answer, and a choice has exactly one', () => {
    for (const lesson of LESSONS) {
      for (const step of lesson.steps) {
        if (step.kind === 'pick') {
          const tiles = Array.from(t(step.tiles));
          expect(tiles.length).toBeGreaterThan(0);
          expect(tiles.some(step.right), `${lesson.title}: ${String(step.why)}`).toBe(true);
          expect(tiles.every(step.right), `${lesson.title}: every tile is right`).toBe(false);
        }
        if (step.kind === 'choose') expect(step.options.filter((o) => o.right)).toHaveLength(1);
      }
    }
  });
});
