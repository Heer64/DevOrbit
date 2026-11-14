// [Sprint 6 · M5] US-44 Catch Me Up (FR-17, NFR-9, NFR-10a, NFR-10b): API tests.
// The AI provider is replaced by a fake client (setLlmClient), so no network and no API key are needed.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import Activity from '../src/models/Activity.js';
import User from '../src/models/User.js';
import { AiUnavailableError, setLlmClient } from '../src/lib/llmClient.js';
import { ensureDefaultChannel } from '../src/lib/channels.js';
import { INPUT_TOKEN_LIMIT, estimateTokens } from '../src/lib/copilotGrounding.js';
import { NOTHING_NEW_MESSAGE, NOTHING_NEW_RECENT_MESSAGE } from '../src/lib/catchUpRules.js';

let app;
let owner, contributor, viewer, outsider;
let projectId, otherProjectId, publicProjectId, channelId;
const HOUR = 3600_000;

const as = (account) => authed(app, account.token);
const catchUp = (account, id = projectId) => as(account).post(`/api/projects/${id}/catch-up`);
const setPreviousLogin = (account, date) => User.updateOne({ _id: account.user.id }, { previousLoginAt: date });

// Feed entries with a chosen time, written straight to the collection (like test/publicProjects.test.js),
// so the time is exactly the one given.
const oid = (value) => (value ? new mongoose.Types.ObjectId(String(value)) : null);
function addEvents(list) {
  return Activity.collection.insertMany(
    list.map((event) => ({
      targetType: 'project',
      targetId: null,
      targetLabel: '',
      meta: {},
      createdAt: new Date(),
      ...event,
      project: oid(event.project),
      actor: oid(event.actor),
    }))
  );
}
const addEvent = (event) => addEvents([event]);

// Fake LLM client: records every prompt; `reply` decides what it does.
const calls = [];
let reply;
const fakeClient = {
  complete: async (prompt) => {
    calls.push(prompt);
    return reply(prompt);
  },
  status: () => ({ configured: true, available: true }),
};
const promptText = (prompt) => `${prompt.system}\n${prompt.messages.map((message) => message.content).join('\n')}`;

async function countEverything() {
  const counts = await Promise.all(Object.values(mongoose.models).map(async (model) => [model.modelName, await model.countDocuments()]));
  return Object.fromEntries(counts);
}

before(async () => {
  ({ app } = await setup());
  [owner, contributor, viewer, outsider] = await Promise.all(
    ['Olu Owner', 'Cy Contributor', 'Vi Viewer', 'Otto Outsider'].map((name) => signup(app, name))
  );
  const project = await as(owner).post('/api/projects').send({ name: 'Catch Up Project', visibility: 'Private' });
  assert.equal(project.status, 201, JSON.stringify(project.body));
  projectId = project.body.project._id;
  for (const [account, role] of [
    [contributor, 'Contributor'],
    [viewer, 'Viewer'],
  ]) {
    const res = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
  const other = await as(owner).post('/api/projects').send({ name: 'Secret Other Project', visibility: 'Private' });
  otherProjectId = other.body.project._id;
  await as(owner).post(`/api/projects/${otherProjectId}/members`).send({ identifier: contributor.user.username, role: 'Contributor' });
  const open = await as(owner).post('/api/projects').send({ name: 'Open Project', visibility: 'Public' });
  publicProjectId = open.body.project._id;
  channelId = String((await ensureDefaultChannel(projectId))._id);
  setLlmClient(fakeClient);
});

after(async () => {
  setLlmClient(null);
  await teardown();
});

beforeEach(async () => {
  calls.length = 0;
  reply = () => ({ text: '- The owner created and finished work [E1].', truncated: false, usage: { inputTokens: 321 }, durationMs: 12 });
  await Activity.deleteMany({});
});

// --- Login bookkeeping ----------------------------------------------------------------------------

test('signing up records the first login; each successful login moves the last one to "previous"', async () => {
  const account = await signup(app, 'Lena Login');
  const afterSignup = await User.findById(account.user.id).select('+lastLoginAt +previousLoginAt').lean();
  assert.ok(afterSignup.lastLoginAt, 'sign-up counts as the first login');
  assert.equal(afterSignup.previousLoginAt, null);

  const login = await request(app).post('/api/auth/login').send({ email: account.email, password: account.password });
  assert.equal(login.status, 200);
  const afterLogin = await User.findById(account.user.id).select('+lastLoginAt +previousLoginAt').lean();
  assert.equal(afterLogin.previousLoginAt.getTime(), afterSignup.lastLoginAt.getTime());
  assert.ok(afterLogin.lastLoginAt > afterSignup.lastLoginAt);

  // A wrong password is not a successful login.
  const wrong = await request(app).post('/api/auth/login').send({ email: account.email, password: 'not the password' });
  assert.equal(wrong.status, 401);
  const afterWrong = await User.findById(account.user.id).select('+lastLoginAt +previousLoginAt').lean();
  assert.equal(afterWrong.lastLoginAt.getTime(), afterLogin.lastLoginAt.getTime());

  // The login times are never sent to the browser.
  assert.equal(JSON.stringify(login.body).includes('LoginAt'), false);
});

// --- AC1: a summary of what happened since my previous login --------------------------------------

test('AC1: after being away, a member gets a summary of what others did since their previous login', async () => {
  await setPreviousLogin(contributor, new Date(Date.now() - 2 * HOUR));
  // Before the previous login: not part of the catch-up.
  await addEvent({
    project: projectId,
    actor: owner.user.id,
    type: 'task.created',
    summary: 'created task "Old news"',
    createdAt: new Date(Date.now() - 5 * HOUR),
  });
  // While away.
  const task = await as(owner).post(`/api/projects/${projectId}/tasks`).send({ title: 'Payment page' });
  assert.equal(task.status, 201);
  const message = await as(owner).post(`/api/projects/${projectId}/channels/${channelId}/messages`).send({ body: 'We ship on Friday' });
  assert.equal(message.status, 201, JSON.stringify(message.body));

  const res = await catchUp(contributor);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.body.nothingNew, false);
  assert.equal(res.body.basis, 'previous_login');
  assert.equal(res.body.summary, '- The owner created and finished work [E1].');
  assert.equal(res.body.counts.tasks, 1);
  assert.equal(res.body.counts.messages, 1);
  assert.equal(res.body.counts.total, 2);
  assert.equal(res.body.context.providerInputTokens, 321);
  assert.equal(res.body.context.included, 2);
  assert.equal(res.body.durationMs, 12);
  assert.ok(Date.parse(res.body.since) < Date.parse(res.body.until));

  // E1 is the oldest event in the window: the task. Its source links to the task.
  assert.equal(res.body.sources.length, 1);
  assert.equal(res.body.sources[0].ref, 'E1');
  assert.equal(res.body.sources[0].link, `/project/${projectId}?tab=tasks&task=${task.body.task._id}`);
  assert.match(res.body.sources[0].label, /Olu Owner/);

  const text = promptText(calls[0]);
  assert.match(text, /Payment page/);
  assert.match(text, /We ship on Friday/);
  assert.equal(text.includes('Old news'), false, 'events before the previous login are not used');
});

test('AC1: only data the member can access: this project only, no own actions, no e-mails', async () => {
  await setPreviousLogin(contributor, new Date(Date.now() - HOUR));
  await as(owner).post(`/api/projects/${projectId}/tasks`).send({ title: 'Visible task' });
  await as(owner).post(`/api/projects/${otherProjectId}/tasks`).send({ title: 'Other project task' });
  await as(contributor).post(`/api/projects/${projectId}/tasks`).send({ title: 'My own task' });

  const res = await catchUp(contributor);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.counts.total, 1);
  const text = promptText(calls[0]);
  assert.match(text, /Visible task/);
  assert.equal(text.includes('Other project task'), false, 'another project is never used');
  assert.equal(text.includes('My own task'), false, 'my own actions are left out');
  assert.equal(text.includes('Secret Other Project'), false);
  for (const account of [owner, contributor, viewer]) assert.equal(text.includes(account.email), false, 'no e-mail addresses');
});

test('AC1: GitHub events (no DevOrbit author) are included and link to GitHub', async () => {
  await setPreviousLogin(viewer, new Date(Date.now() - HOUR));
  await addEvent({
    project: projectId,
    actor: null,
    type: 'github.commit',
    summary: 'pushed commit "Fix login" to main',
    meta: { author: 'octocat', url: 'https://github.com/o/r/commit/abc123' },
  });
  reply = () => ({ text: '- octocat fixed login [E1].', truncated: false });
  const res = await catchUp(viewer);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.counts.github, 1);
  assert.deepEqual([res.body.sources[0].link, res.body.sources[0].external], ['https://github.com/o/r/commit/abc123', true]);
  assert.match(promptText(calls[0]), /GitHub user octocat pushed commit "Fix login"/);
});

test('AC1: citations of events that were not sent are removed', async () => {
  await setPreviousLogin(contributor, new Date(Date.now() - HOUR));
  await as(owner).post(`/api/projects/${projectId}/tasks`).send({ title: 'Real task' });
  reply = () => ({ text: '- Real work [E1]\n- Invented [E42]', truncated: false });
  const res = await catchUp(contributor);
  assert.equal(res.body.summary, '- Real work [E1]\n- Invented');
  assert.deepEqual(
    res.body.sources.map((source) => source.ref),
    ['E1']
  );
});

test('AC1 / NFR-10b: a busy period stays within the 8,000-token budget and says how much was left out', async () => {
  await setPreviousLogin(contributor, new Date(Date.now() - 48 * HOUR));
  const base = Date.now() - 24 * HOUR;
  await addEvents(
    Array.from({ length: 450 }, (_, i) => ({
      project: projectId,
      actor: owner.user.id,
      type: 'message.posted',
      summary: `posted "Update number ${i}: ${'the release checklist is moving along '.repeat(4)}"`,
      createdAt: new Date(base + i * 60_000),
    }))
  );
  const res = await catchUp(contributor);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.counts.total, 450, 'counts cover every event, not only the ones sent');
  assert.equal(res.body.context.trimmed, true);
  assert.equal(res.body.context.available, 450);
  assert.equal(res.body.context.leftOut, 450 - res.body.context.included);
  assert.ok(res.body.context.estimatedTokens <= INPUT_TOKEN_LIMIT);
  const prompt = calls[0];
  assert.ok(estimateTokens(prompt.system) + estimateTokens(prompt.messages[0].content) <= INPUT_TOKEN_LIMIT);
  assert.match(prompt.messages[0].content, /Update number 449:/, 'the newest event is kept');
  assert.equal(prompt.messages[0].content.includes('Update number 0:'), false, 'the oldest is left out');
});

test('no previous login known yet: the last 7 days are covered, and the answer says so', async () => {
  await setPreviousLogin(contributor, null);
  await addEvent({
    project: projectId,
    actor: owner.user.id,
    type: 'task.created',
    summary: 'created task "Ten days ago"',
    createdAt: new Date(Date.now() - 10 * 24 * HOUR),
  });
  await addEvent({
    project: projectId,
    actor: owner.user.id,
    type: 'task.created',
    summary: 'created task "Yesterday"',
    createdAt: new Date(Date.now() - 24 * HOUR),
  });
  const res = await catchUp(contributor);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.basis, 'recent_days');
  assert.equal(res.body.counts.total, 1);
  assert.equal(promptText(calls[0]).includes('Ten days ago'), false);
});

// --- AC2: nothing new -----------------------------------------------------------------------------

test('AC2: nothing happened since my previous login -> "nothing new", without asking the AI', async () => {
  await setPreviousLogin(contributor, new Date(Date.now() - HOUR));
  await addEvent({
    project: projectId,
    actor: owner.user.id,
    type: 'task.created',
    summary: 'created task "Before"',
    createdAt: new Date(Date.now() - 2 * HOUR),
  });
  const res = await catchUp(contributor);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.nothingNew, true);
  assert.equal(res.body.message, NOTHING_NEW_MESSAGE);
  assert.equal(res.body.summary, '');
  assert.deepEqual(res.body.sources, []);
  assert.equal(res.body.counts.total, 0);
  assert.equal(calls.length, 0, 'the AI is not asked');
});

test('AC2: only my own actions since then also counts as nothing new', async () => {
  await setPreviousLogin(contributor, new Date(Date.now() - HOUR));
  await as(contributor).post(`/api/projects/${projectId}/tasks`).send({ title: 'Done by me' });
  const res = await catchUp(contributor);
  assert.equal(res.body.nothingNew, true);
  assert.equal(calls.length, 0);
});

test('AC2: "nothing new" still works while the AI is down', async () => {
  await setPreviousLogin(contributor, null);
  reply = () => {
    throw new AiUnavailableError('network');
  };
  const res = await catchUp(contributor);
  assert.equal(res.status, 200);
  assert.equal(res.body.message, NOTHING_NEW_RECENT_MESSAGE);
});

// --- AC3: AI unavailable --------------------------------------------------------------------------

test('AC3: AI provider down -> 503 "AI temporarily unavailable", and the rest of DevOrbit keeps working', async () => {
  await setPreviousLogin(contributor, new Date(Date.now() - HOUR));
  await as(owner).post(`/api/projects/${projectId}/tasks`).send({ title: 'While the AI is down' });
  reply = () => {
    throw new AiUnavailableError('timeout');
  };
  const res = await catchUp(contributor);
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'AI_UNAVAILABLE');
  assert.match(res.body.message, /AI temporarily unavailable/);
  assert.equal(res.headers['retry-after'], '30');

  assert.equal((await as(contributor).get(`/api/projects/${projectId}/tasks`)).status, 200);
  assert.equal((await as(contributor).get(`/api/projects/${projectId}/activity`)).status, 200);
  assert.equal((await as(contributor).get(`/api/projects/${projectId}/channels/${channelId}/messages`)).status, 200);
  assert.equal((await as(contributor).post(`/api/projects/${projectId}/tasks`).send({ title: 'Still works' })).status, 201);
});

test('AC3: an empty reply from the AI is treated as unavailable, not shown as a blank summary', async () => {
  await setPreviousLogin(contributor, new Date(Date.now() - HOUR));
  await as(owner).post(`/api/projects/${projectId}/tasks`).send({ title: 'Something' });
  reply = () => ({ text: '[E99]', truncated: false });
  const res = await catchUp(contributor);
  assert.equal(res.status, 503);
});

test('AC3: the real client without an API key fails fast with 503', async () => {
  await setPreviousLogin(contributor, new Date(Date.now() - HOUR));
  await as(owner).post(`/api/projects/${projectId}/tasks`).send({ title: 'Needs the AI' });
  const saved = process.env.LLM_API_KEY;
  delete process.env.LLM_API_KEY;
  setLlmClient(null);
  try {
    const started = Date.now();
    const res = await catchUp(contributor);
    assert.equal(res.status, 503);
    assert.ok(Date.now() - started < 3000);
  } finally {
    if (saved !== undefined) process.env.LLM_API_KEY = saved;
    setLlmClient(fakeClient);
  }
});

// --- Who may use it -------------------------------------------------------------------------------

test('every member role can catch up; outsiders cannot, even on a Public project', async () => {
  for (const account of [owner, contributor, viewer]) {
    const res = await catchUp(account);
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }
  assert.equal((await catchUp(outsider)).status, 403);
  assert.equal((await catchUp(contributor, publicProjectId)).status, 403);
  assert.equal((await request(app).post(`/api/projects/${projectId}/catch-up`)).status, 401);
  assert.equal((await catchUp(owner, 'not-an-id')).status, 400);
  assert.equal((await catchUp(owner, new mongoose.Types.ObjectId().toString())).status, 404);
});

test('Catch Me Up only reads: nothing in the database changes', async () => {
  await setPreviousLogin(contributor, new Date(Date.now() - HOUR));
  await as(owner).post(`/api/projects/${projectId}/tasks`).send({ title: 'Read only check' });
  const before = await countEverything();
  const beforeUser = await User.findById(contributor.user.id).select('+lastLoginAt +previousLoginAt').lean();
  assert.equal((await catchUp(contributor)).status, 200);
  assert.deepEqual(await countEverything(), before);
  const afterUser = await User.findById(contributor.user.id).select('+lastLoginAt +previousLoginAt').lean();
  assert.equal(String(afterUser.previousLoginAt), String(beforeUser.previousLoginAt), 'catching up does not move the window');
});
