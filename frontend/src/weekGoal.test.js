// [Sprint 7 · M7] D7: wording of the Dashboard's weekly goal.
import { describe, expect, it } from 'vitest';
import { weekGoalView } from './weekGoal';

describe('weekGoalView', () => {
  it('shows real numbers: done of total, percent, and what is left this week', () => {
    const view = weekGoalView({ from: '2026-11-16', to: '2026-11-22', total: 5, done: 3, percent: 60 });
    expect(view.percent).toBe(60);
    expect(view.headline).toBe('3 of 5 done');
    expect(view.detail).toBe('2 still to finish (16 Nov – 22 Nov). Counts tasks assigned to you.');
  });

  it('all done', () => {
    const view = weekGoalView({ from: '2026-11-16', to: '2026-11-22', total: 2, done: 2 });
    expect(view.percent).toBe(100);
    expect(view.headline).toBe('2 of 2 done');
    expect(view.detail).toMatch(/^Every task assigned to you that is due 16 Nov – 22 Nov is done/);
  });

  it('nothing due this week', () => {
    const view = weekGoalView({ from: '2026-11-16', to: '2026-11-22', total: 0, done: 0 });
    expect(view.percent).toBe(0);
    expect(view.headline).toBe('No tasks due this week');
  });

  it('missing or broken data gives null (the card then says it is not available)', () => {
    expect(weekGoalView(undefined)).toBeNull();
    expect(weekGoalView({ total: 'x', done: 1 })).toBeNull();
  });

  it('never shows more done than total', () => {
    expect(weekGoalView({ total: 2, done: 9 }).headline).toBe('2 of 2 done');
  });
});
