// [Sprint 5 · M5] US-49 Generate my portfolio (FR-21, NFR-12).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import User from '../src/models/User.js';
import Task from '../src/models/Task.js';
import Decision from '../src/models/Decision.js';
import Message from '../src/models/Message.js';
import PortfolioStat from '../src/models/PortfolioStat.js';
import { ensureDefaultChannel } from '../src/lib/channels.js';
import { STATS_MAX_AGE_MS, buildPortfolio } from '../src/lib/portfolio.js';

let app;
let owner, member, viewer, outsider;
let publicDone, privateDone, stillOpen;

const as = (account) => authed(app, account.token);
const mine = (account) => as(account).get('/api/portfolio/me');
const shared = (username) => request(app).get(`/api/public/portfolio/${encodeURIComponent(username)}`);

async function createProject(account, body) {
  const res = await as(account).post('/api/projects').send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.project._id;
}
async function addMember(projectId, account, role) {
  const res = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
  assert.equal(res.status, 201, JSON.stringify(res.body));
}
async function markCompleted(projectId) {
  const res = await as(owner).post(`/api/projects/${projectId}/complete`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

// Contributions by `account` in a project: Done tasks, open tasks, decisions and messages.
async function contribute(projectId, account, { done = 0, open = 0, decisions = 0, messages = 0, replies = 0 }) {
  const by = account.user.id;
  for (let i = 0; i < done; i += 1) {
    await Task.create({ project: projectId, title: `Done ${i}`, status: 'Done', assignee: by, createdBy: by, completedAt: new Date() });
  }
  for (let i = 0; i < open; i += 1) {
    await Task.create({ project: projectId, title: `Open ${i}`, status: 'In progress', assignee: by, createdBy: by });
  }
  for (let i = 0; i < decisions; i += 1) {
    await Decision.create({ project: projectId, title: `Decision ${i}`, description: 'Why we chose it', participants: [by], date: new Date(), createdBy: by });
  }
  const channel = await ensureDefaultChannel(projectId);
  let last = null;
  for (let i = 0; i < messages; i += 1) {
    last = await Message.create({ project: projectId, channel: channel._id, author: by, body: `Message ${i}` });
  }
  for (let i = 0; i < replies; i += 1) {
    await Message.create({ project: projectId, channel: channel._id, author: by, body: `Reply ${i}`, parentMessage: last._id });
  }
}

before(async () => {
  ({ app } = await setup());
  [owner, member, viewer, outsider] = await Promise.all(
    ['Priya Portfolio', 'Max Member', 'Vera Viewer', 'Otto Outsider'].map((name) => signup(app, name))
  );

  publicDone = await createProject(owner, { name: 'Open Garden', description: 'Community gardening app', domain: 'Community', visibility: 'Public' });
  privateDone = await createProject(owner, { name: 'Secret Lab', description: 'Internal research notes', domain: 'Research', visibility: 'Private' });
  stillOpen = await createProject(owner, { name: 'Still Going', description: 'Not finished', domain: 'Education', visibility: 'Public' });

  await addMember(publicDone, member, 'Contributor');
  await addMember(privateDone, member, 'Admin');
  await addMember(publicDone, viewer, 'Viewer');
  await addMember(stillOpen, member, 'Contributor');

  // Member's work: 3 Done + 1 open task, 2 decisions, 4 messages + 1 thread reply in Open Garden;
  // 1 Done task and 2 messages in Secret Lab; work in the unfinished project must not show.
  await contribute(publicDone, member, { done: 3, open: 1, decisions: 2, messages: 4, replies: 1 });
  await contribute(privateDone, member, { done: 1, messages: 2 });
  await contribute(stillOpen, member, { done: 5, decisions: 5, messages: 5 });
  // Someone else's work in the same project is not counted for the member.
  await contribute(publicDone, owner, { done: 2, decisions: 1, messages: 3 });

  await markCompleted(publicDone);
  await markCompleted(privateDone);
});

after(teardown);

// --- AC1: each Completed project is listed with my role -----------------------------------------

test('AC1: my portfolio lists every project I belong to that is Completed, with my role', async () => {
  const res = await mine(member);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const byName = Object.fromEntries(res.body.projects.map((item) => [item.name, item]));
  assert.deepEqual(Object.keys(byName).sort(), ['Open Garden', 'Secret Lab']);
  assert.equal(byName['Open Garden'].role, 'Contributor');
  assert.equal(byName['Secret Lab'].role, 'Admin');
  assert.equal(byName['Open Garden'].domain, 'Community');
  assert.ok(byName['Open Garden'].completedAt);
  assert.equal(String(byName['Open Garden']._id), String(publicDone), 'owner view links to the project');
  assert.equal(res.body.user.username, member.user.username);
});

test('AC1: the Owner and a Viewer see their own roles; unfinished projects never appear', async () => {
  const ownerView = await mine(owner);
  assert.deepEqual(ownerView.body.projects.map((item) => item.role).sort(), ['Owner', 'Owner']);
  assert.equal(ownerView.body.projects.some((item) => item.name === 'Still Going'), false);
  const viewerView = await mine(viewer);
  assert.deepEqual(viewerView.body.projects.map((item) => [item.name, item.role]), [['Open Garden', 'Viewer']]);
});

test('AC1: someone with no Completed projects gets an empty portfolio, not an error', async () => {
  const res = await mine(outsider);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.projects, []);
  assert.deepEqual(res.body.totals, { projects: 0, tasksCompleted: 0, decisionsRecorded: 0, messagesPosted: 0 });
  assert.equal(res.body.statsUpdatedAt, null);
});

// --- AC2: tasks completed, decisions recorded, messages posted per project -----------------------

test('AC2: per-project numbers count only my Done tasks, my decisions and my messages (thread replies too)', async () => {
  const res = await mine(member);
  const byName = Object.fromEntries(res.body.projects.map((item) => [item.name, item.stats]));
  assert.equal(byName['Open Garden'].tasksCompleted, 3);
  assert.equal(byName['Open Garden'].decisionsRecorded, 2);
  assert.equal(byName['Open Garden'].messagesPosted, 5);
  assert.equal(byName['Secret Lab'].tasksCompleted, 1);
  assert.equal(byName['Secret Lab'].decisionsRecorded, 0);
  assert.equal(byName['Secret Lab'].messagesPosted, 2);
  assert.deepEqual(res.body.totals, { projects: 2, tasksCompleted: 4, decisionsRecorded: 2, messagesPosted: 7 });

  const ownerStats = (await mine(owner)).body.projects.find((item) => item.name === 'Open Garden').stats;
  assert.equal(ownerStats.tasksCompleted, 2);
  assert.equal(ownerStats.decisionsRecorded, 1);
  assert.equal(ownerStats.messagesPosted, 3);
});

test('AC2 / NFR-12: numbers carry the time they were counted, and that time is never 24 hours old', async () => {
  const res = await mine(member);
  for (const item of res.body.projects) {
    const age = Date.now() - new Date(item.stats.computedAt).getTime();
    assert.ok(age >= 0 && age < STATS_MAX_AGE_MS, `age ${age}`);
  }
  assert.ok(res.body.statsUpdatedAt);
});

test('NFR-12: saved numbers are reused while fresh and counted again once 24 hours old', async () => {
  await mine(member); // make sure numbers are saved
  const memberId = member.user.id;
  const before = await PortfolioStat.findOne({ user: memberId, project: publicDone }).lean();

  // New work after the numbers were counted.
  await contribute(publicDone, member, { done: 1, messages: 1 });

  // Still fresh: the saved numbers are shown (allowed, they are under 24 hours old).
  const fresh = await mine(member);
  const freshStats = fresh.body.projects.find((item) => item.name === 'Open Garden').stats;
  assert.equal(freshStats.tasksCompleted, before.tasksCompleted);
  assert.equal(new Date(freshStats.computedAt).getTime(), new Date(before.computedAt).getTime());

  // 23 h 59 min old: still reused.
  await PortfolioStat.updateOne({ _id: before._id }, { computedAt: new Date(Date.now() - STATS_MAX_AGE_MS + 60_000) });
  const almost = (await mine(member)).body.projects.find((item) => item.name === 'Open Garden').stats;
  assert.equal(almost.tasksCompleted, before.tasksCompleted);

  // Exactly 24 hours old: counted again, now including the new work.
  await PortfolioStat.updateOne({ _id: before._id }, { computedAt: new Date(Date.now() - STATS_MAX_AGE_MS) });
  const recounted = (await mine(member)).body.projects.find((item) => item.name === 'Open Garden').stats;
  assert.equal(recounted.tasksCompleted, before.tasksCompleted + 1);
  assert.equal(recounted.messagesPosted, before.messagesPosted + 1);
  assert.ok(Date.now() - new Date(recounted.computedAt).getTime() < 60_000);
});

test('NFR-12: buildPortfolio uses the clock it is given (a day later everything is recounted)', async () => {
  const user = await User.findById(member.user.id).lean();
  const later = new Date(Date.now() + STATS_MAX_AGE_MS + 1000);
  const portfolio = await buildPortfolio(user, { now: later });
  for (const item of portfolio.projects) assert.equal(new Date(item.stats.computedAt).getTime(), later.getTime());
  assert.equal(await PortfolioStat.countDocuments({ user: member.user.id }), 2, 'one saved row per project, no duplicates');
});

// --- AC3: a public portfolio link opens read-only for anyone -------------------------------------

test('AC3: anyone with the link can view a public portfolio without logging in', async () => {
  const res = await shared(member.user.username);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.body.user.name, 'Max Member');
  assert.equal(res.body.projects.length, 2);
  const garden = res.body.projects.find((item) => item.name === 'Open Garden');
  assert.equal(garden.role, 'Contributor');
  assert.ok(garden.stats.tasksCompleted >= 3);

  // A logged-in stranger sees exactly the same read-only answer.
  const stranger = await as(outsider).get(`/api/public/portfolio/${member.user.username}`);
  assert.deepEqual(stranger.body.projects.map((item) => item.name), res.body.projects.map((item) => item.name));
});

test('AC3: the link is case-insensitive and read-only (no way to change anything through it)', async () => {
  assert.equal((await shared(member.user.username.toUpperCase())).status, 200);
  for (const method of ['post', 'patch', 'delete']) {
    const res = await request(app)[method](`/api/public/portfolio/${member.user.username}`).send({ name: 'Hacked' });
    assert.equal(res.status, 404);
  }
  assert.equal((await User.findById(member.user.id).lean()).name, 'Max Member');
});

test('public view: a Private project shows role, domain and numbers, but not its name, description or ID', async () => {
  const res = await shared(member.user.username);
  const hidden = res.body.projects.find((item) => item.isPrivate);
  assert.ok(hidden, 'the private project is still listed');
  assert.equal(hidden.name, 'Private project');
  assert.equal(hidden.description, '');
  assert.deepEqual(hidden.tags, []);
  assert.equal(hidden.role, 'Admin');
  assert.equal(hidden.domain, 'Research');
  assert.equal(hidden._id, undefined);
  const text = JSON.stringify(res.body);
  assert.equal(text.includes('Secret Lab'), false);
  assert.equal(text.includes('Internal research notes'), false);
  assert.equal(text.includes(String(privateDone)), false);
  assert.equal(text.includes(String(publicDone)), false, 'no project IDs in the public view');
});

test('public view: never exposes email, other members or account fields', async () => {
  const res = await shared(member.user.username);
  const text = JSON.stringify(res.body);
  assert.equal(text.includes(member.email), false);
  assert.equal(text.includes(owner.user.username), false, 'other members are not listed');
  assert.equal(text.includes('passwordHash'), false);
  assert.deepEqual(Object.keys(res.body.user).sort(), ['avatarUrl', 'headline', 'name', 'username']);
});

test('privacy: when the portfolio is turned off the link says "not available", but the owner still sees it', async () => {
  await User.updateOne({ _id: member.user.id }, { portfolioPublic: false });
  try {
    const res = await shared(member.user.username);
    assert.equal(res.status, 404);
    assert.equal(res.body.message, 'This portfolio is not available.');
    assert.equal(res.body.projects, undefined);

    const own = await mine(member);
    assert.equal(own.status, 200);
    assert.equal(own.body.isPublic, false);
    assert.equal(own.body.projects.length, 2);
  } finally {
    await User.updateOne({ _id: member.user.id }, { portfolioPublic: true });
  }
  assert.equal((await mine(member)).body.isPublic, true);
});

test('privacy: an unknown or malformed username gives the same "not available" answer', async () => {
  for (const name of ['nobody-here-123', 'bad name!', 'x'.repeat(31), '..%2F..%2Fadmin']) {
    const res = await shared(name);
    assert.equal(res.status, 404, name);
    assert.equal(res.body.message, 'This portfolio is not available.', name);
  }
});

test('my portfolio needs login, and gives the share path', async () => {
  assert.equal((await request(app).get('/api/portfolio/me')).status, 401);
  const res = await mine(member);
  assert.equal(res.body.sharePath, `/portfolio/${member.user.username}`);
  assert.equal(res.body.isPublic, true);
});

test('a project that is reopened leaves the portfolio, and comes back when Completed again', async () => {
  const reopened = await as(owner).post(`/api/projects/${privateDone}/reopen`);
  assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
  try {
    const names = (await mine(member)).body.projects.map((item) => item.name);
    assert.deepEqual(names, ['Open Garden']);
  } finally {
    await markCompleted(privateDone);
  }
  const back = (await mine(member)).body.projects.map((item) => item.name).sort();
  assert.deepEqual(back, ['Open Garden', 'Secret Lab']);
});

test('two portfolio loads at the same moment keep one saved row per project', async () => {
  await PortfolioStat.deleteMany({ user: member.user.id });
  const results = await Promise.all([mine(member), mine(member), mine(member)]);
  for (const res of results) assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(await PortfolioStat.countDocuments({ user: member.user.id }), 2);
});
