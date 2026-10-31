// [Sprint 4 · M7] US-39: pure dashboard rules (no database needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareMilestones,
  isDueWithinDays,
  isOpenTask,
  isOverdue,
  isoDay,
  milestoneProgress,
  summarizeTaskCounts,
  upcomingWindow,
} from '../src/lib/dashboardRules.js';

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);
// Saturday 31 Oct 2026, 15:39 in India = 10:09 UTC.
const NOW = new Date('2026-10-31T10:09:00.000Z');

test('milestone progress is the share of Done tasks, rounded', () => {
  assert.deepEqual(milestoneProgress(0, 0), { taskCount: 0, doneCount: 0, progress: 0, completed: false });
  assert.deepEqual(milestoneProgress(3, 1), { taskCount: 3, doneCount: 1, progress: 33, completed: false });
  assert.deepEqual(milestoneProgress(3, 2), { taskCount: 3, doneCount: 2, progress: 67, completed: false });
  assert.deepEqual(milestoneProgress(4, 4), { taskCount: 4, doneCount: 4, progress: 100, completed: true });
});

test('milestone progress never goes below 0% or above 100%', () => {
  assert.equal(milestoneProgress(2, 5).progress, 100);
  assert.equal(milestoneProgress(2, -1).progress, 0);
  assert.equal(milestoneProgress(undefined, undefined).progress, 0);
  assert.equal(milestoneProgress(1, 0.999).completed, false); // 1 task, not Done
});

test('an open task is any task that is not Done', () => {
  for (const status of ['To do', 'In progress', 'Blocked']) assert.equal(isOpenTask({ status }), true, status);
  assert.equal(isOpenTask({ status: 'Done' }), false);
  assert.equal(isOpenTask(null), false);
});

test('task counts: open = everything except Done, every status present', () => {
  const summary = summarizeTaskCounts([
    { _id: 'To do', count: 3 },
    { _id: 'Blocked', count: 1 },
    { _id: 'Done', count: 4 },
  ]);
  assert.deepEqual(summary, {
    total: 8,
    open: 4,
    done: 4,
    byStatus: { 'To do': 3, 'In progress': 0, Blocked: 1, Done: 4 },
  });
});

test('task counts: empty project and unknown statuses', () => {
  assert.deepEqual(summarizeTaskCounts([]), { total: 0, open: 0, done: 0, byStatus: { 'To do': 0, 'In progress': 0, Blocked: 0, Done: 0 } });
  const odd = summarizeTaskCounts([{ _id: 'Legacy', count: 2 }]);
  assert.equal(odd.open, 2, 'an unexpected status still counts as open');
});

test('7-day window: today through 7 days ahead, in UTC calendar days', () => {
  const window = upcomingWindow(NOW);
  assert.equal(window.days, 7);
  assert.equal(window.from.toISOString(), '2026-10-31T00:00:00.000Z');
  assert.equal(window.until.toISOString(), '2026-11-08T00:00:00.000Z'); // exclusive
  assert.equal(isoDay(window.lastDay), '2026-11-07');
});

test('7-day window: days are clamped to 1-30', () => {
  assert.equal(upcomingWindow(NOW, 0).days, 7, '0 / invalid falls back to 7');
  assert.equal(upcomingWindow(NOW, 'x').days, 7);
  assert.equal(upcomingWindow(NOW, -4).days, 1);
  assert.equal(upcomingWindow(NOW, 999).days, 30);
});

test('due in the next 7 days: boundary days', () => {
  const open = (iso, status = 'To do') => ({ status, dueDate: day(iso) });
  assert.equal(isDueWithinDays(open('2026-10-30'), NOW), false, 'yesterday is overdue, not upcoming');
  assert.equal(isDueWithinDays(open('2026-10-31'), NOW), true, 'today');
  assert.equal(isDueWithinDays(open('2026-11-01'), NOW), true, 'tomorrow');
  assert.equal(isDueWithinDays(open('2026-11-07'), NOW), true, 'day 7 is included');
  assert.equal(isDueWithinDays(open('2026-11-08'), NOW), false, 'day 8 is not');
  assert.equal(isDueWithinDays(open('2026-11-01', 'Done'), NOW), false, 'Done tasks are not listed');
  assert.equal(isDueWithinDays(open('2026-11-01', 'Blocked'), NOW), true, 'Blocked tasks are still open');
  assert.equal(isDueWithinDays({ status: 'To do', dueDate: null }, NOW), false, 'no due date');
  assert.equal(isDueWithinDays({ status: 'To do', dueDate: 'not a date' }, NOW), false);
});

test('due in the next 7 days: edges of the UTC day', () => {
  const task = { status: 'To do', dueDate: day('2026-10-31') };
  assert.equal(isDueWithinDays(task, new Date('2026-10-31T00:00:00.000Z')), true, 'first millisecond of the day');
  assert.equal(isDueWithinDays(task, new Date('2026-10-31T23:59:59.999Z')), true, 'last millisecond of the day');
  assert.equal(isDueWithinDays(task, new Date('2026-11-01T00:00:00.000Z')), false, 'next day it is overdue');
  const lastDay = { status: 'To do', dueDate: day('2026-11-07') };
  assert.equal(isDueWithinDays(lastDay, new Date('2026-10-30T23:59:59.999Z')), false, 'day 8 seen from the day before');
});

test('a dated open task is either overdue or upcoming within the week, never both', () => {
  for (let offset = -3; offset <= 7; offset += 1) {
    const due = new Date(Date.UTC(2026, 9, 31 + offset));
    const task = { status: 'In progress', dueDate: due };
    const overdue = isOverdue(task, NOW);
    const upcoming = isDueWithinDays(task, NOW);
    assert.notEqual(overdue, upcoming, `offset ${offset}: overdue=${overdue} upcoming=${upcoming}`);
  }
});

test('milestones sort by due date, undated last, then oldest first', () => {
  const list = [
    { title: 'Undated new', dueDate: null, createdAt: '2026-10-03' },
    { title: 'Late', dueDate: '2026-12-01', createdAt: '2026-10-01' },
    { title: 'Undated old', dueDate: null, createdAt: '2026-10-02' },
    { title: 'Soon', dueDate: '2026-11-01', createdAt: '2026-10-05' },
    { title: 'Soon twin', dueDate: '2026-11-01', createdAt: '2026-10-06' },
  ];
  assert.deepEqual([...list].sort(compareMilestones).map((m) => m.title), ['Soon', 'Soon twin', 'Late', 'Undated old', 'Undated new']);
});
