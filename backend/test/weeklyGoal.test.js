// [Sprint 7 · M7] D7: the Dashboard's weekly goal from real data (GET /api/tasks/stats -> weekGoal).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, signup, authed } from './helpers.js';
import { weekWindow, weeklyGoal } from '../src/lib/dashboardRules.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const day = (iso) => new Date(`${iso}T00:00:00.000Z`);

test('weekWindow: Monday 00:00 UTC up to next Monday, for every day of the week', () => {
  // 16 Nov 2026 is a Monday.
  for (const [now, from] of [
    ['2026-11-16T00:00:00Z', '2026-11-16'],
    ['2026-11-18T13:30:00Z', '2026-11-16'],
    ['2026-11-22T23:59:59Z', '2026-11-16'],
    ['2026-11-23T00:00:00Z', '2026-11-23'],
  ]) {
    const window = weekWindow(new Date(now));
    assert.equal(window.from.toISOString().slice(0, 10), from, now);
    assert.equal(window.until.getTime() - window.from.getTime(), 7 * DAY_MS);
    assert.equal(window.lastDay.getUTCDay(), 0, 'last day is a Sunday');
  }
});

test('weeklyGoal: counts, percent, and safe numbers', () => {
  const window = weekWindow(day('2026-11-18'));
  assert.deepEqual(weeklyGoal(5, 4, window), { from: '2026-11-16', to: '2026-11-22', total: 5, done: 4, percent: 80 });
  assert.deepEqual(weeklyGoal(3, 1, window).percent, 33);
  assert.deepEqual(weeklyGoal(0, 0, window), { from: '2026-11-16', to: '2026-11-22', total: 0, done: 0, percent: 0 });
  assert.equal(weeklyGoal(2, 9, window).done, 2, 'done never exceeds total');
  assert.equal(weeklyGoal(-1, 'x', window).total, 0);
});

// --- API ---------------------------------------------------------------------------------------

let app;
let me, teammate, stranger;
let projectId, otherProjectId;
const as = (account) => authed(app, account.token);

function thisWeekDay(offsetFromMonday) {
  const { from } = weekWindow(new Date());
  return new Date(from.getTime() + offsetFromMonday * DAY_MS).toISOString().slice(0, 10);
}

async function task(account, project, body) {
  const res = await as(account).post(`/api/projects/${project}/tasks`).send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.task;
}

before(async () => {
  ({ app } = await setup());
  [me, teammate, stranger] = await Promise.all(['Mia Member', 'Tom Teammate', 'Sid Stranger'].map((name) => signup(app, name)));
  projectId = (await as(me).post('/api/projects').send({ name: 'Goal Project' })).body.project._id;
  await as(me).post(`/api/projects/${projectId}/members`).send({ identifier: teammate.user.username, role: 'Contributor' });
  otherProjectId = (await as(stranger).post('/api/projects').send({ name: 'Not Mine' })).body.project._id;

  // Mine, due this week: 3, of which 2 Done.
  await task(me, projectId, { title: 'Mon done', dueDate: thisWeekDay(0), assignee: me.user.id, status: 'Done' });
  await task(me, projectId, { title: 'Wed done', dueDate: thisWeekDay(2), assignee: me.user.id, status: 'Done' });
  await task(me, projectId, { title: 'Sun open', dueDate: thisWeekDay(6), assignee: me.user.id });
  // Not counted: next week, last week, someone else's, unassigned, undated.
  await task(me, projectId, { title: 'Next Mon', dueDate: thisWeekDay(7), assignee: me.user.id });
  await task(me, projectId, { title: 'Last Sun', dueDate: thisWeekDay(-1), assignee: me.user.id });
  await task(me, projectId, { title: 'Teammate', dueDate: thisWeekDay(3), assignee: teammate.user.id });
  await task(me, projectId, { title: 'Unassigned', dueDate: thisWeekDay(3) });
  await task(me, projectId, { title: 'Undated', assignee: me.user.id });
});

after(teardown);

test('D7: weekGoal counts my tasks due this week (Mon-Sun) and how many are Done', async () => {
  const res = await as(me).get('/api/tasks/stats');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { from, lastDay } = weekWindow(new Date());
  assert.deepEqual(res.body.weekGoal, {
    from: from.toISOString().slice(0, 10),
    to: lastDay.toISOString().slice(0, 10),
    total: 3,
    done: 2,
    percent: 67,
  });
  assert.equal(typeof res.body.completedLast7Days, 'number');
  assert.equal(typeof res.body.openAssignedToMe, 'number');
});

test('D7: each person gets their own numbers; someone with no projects gets 0 of 0', async () => {
  const mate = await as(teammate).get('/api/tasks/stats');
  assert.equal(mate.body.weekGoal.total, 1);
  assert.equal(mate.body.weekGoal.done, 0);
  const loner = await signup(app, 'Lou Loner');
  const res = await as(loner).get('/api/tasks/stats');
  assert.equal(res.body.weekGoal.total, 0);
  assert.equal(res.body.weekGoal.percent, 0);
});

test('D7: tasks from a project I am not in never count', async () => {
  await as(stranger).post(`/api/projects/${otherProjectId}/members`).send({ identifier: me.user.username, role: 'Contributor' });
  await task(stranger, otherProjectId, { title: 'Other project', dueDate: thisWeekDay(1), assignee: me.user.id });
  assert.equal((await as(me).get('/api/tasks/stats')).body.weekGoal.total, 4);
  await as(me).delete(`/api/projects/${otherProjectId}/members/${me.user.id}`);
  assert.equal((await as(me).get('/api/tasks/stats')).body.weekGoal.total, 3, 'after leaving, it no longer counts');
});
