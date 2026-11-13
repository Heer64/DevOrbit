// [Sprint 6 · M3] US-41: POST /api/projects/:id/copilot/ask (members only, 500-character question,
// "AI temporarily unavailable" while the rest of DevOrbit keeps working).
// The AI provider is replaced by a fake client (setLlmClient), so no network and no API key are needed.
// [Sprint 6 · M4] US-42/US-43 ground answers in project records: the project gets one task (T1) so the AI is
// asked, and the fake answers cite it ([T1]); an uncited answer would become "not enough project data".
// Grounding itself is tested in copilotGrounded.test.js and copilotGrounding.test.js.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { setup, teardown, signup, authed } from './helpers.js';
import { AiUnavailableError, setLlmClient } from '../src/lib/llmClient.js';
import { AI_UNAVAILABLE_MESSAGE, RETRY_AFTER_SECONDS } from '../src/routes/copilot.js';
import { ANSWER_MAX_CHARS } from '../src/lib/copilotRules.js';

let app;
let owner, admin, contributor, viewer, outsider;
let projectId, publicProjectId;

const as = (account) => authed(app, account.token);
const askUrl = (id = projectId) => `/api/projects/${id}/copilot/ask`;
const ask = (account, question, id = projectId) => as(account).post(askUrl(id)).send({ question });

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

async function countEverything() {
  const counts = await Promise.all(Object.values(mongoose.models).map(async (model) => [model.modelName, await model.countDocuments()]));
  return Object.fromEntries(counts);
}

before(async () => {
  ({ app } = await setup());
  [owner, admin, contributor, viewer, outsider] = await Promise.all(
    ['Olu Owner', 'Ada Admin', 'Cy Contributor', 'Vi Viewer', 'Otto Outsider'].map((name) => signup(app, name))
  );

  const project = await as(owner).post('/api/projects').send({ name: 'Copilot Project', visibility: 'Private' });
  assert.equal(project.status, 201, JSON.stringify(project.body));
  projectId = project.body.project._id;
  for (const [account, role] of [
    [admin, 'Admin'],
    [contributor, 'Contributor'],
    [viewer, 'Viewer'],
  ]) {
    const res = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }

  const publicProject = await as(owner).post('/api/projects').send({ name: 'Open Copilot Project', visibility: 'Public' });
  assert.equal(publicProject.status, 201, JSON.stringify(publicProject.body));
  publicProjectId = publicProject.body.project._id;

  // [Sprint 6 · M4] One project record (T1) to ground answers in.
  const task = await as(owner).post(`/api/projects/${projectId}/tasks`).send({ title: 'Set up the Kanban board' });
  assert.equal(task.status, 201, JSON.stringify(task.body));

  setLlmClient(fakeClient);
});

after(async () => {
  setLlmClient(null);
  await teardown();
});

beforeEach(() => {
  calls.length = 0;
  reply = async () => ({ text: 'A Kanban board shows work in columns [T1].', truncated: false, durationMs: 1234 });
});

// --- Access ---------------------------------------------------------------------------------------

test('401 without a session', async () => {
  const res = await request(app).post(askUrl()).send({ question: 'Hi?' });
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test('400 for an invalid project ID, 404 for a project that does not exist', async () => {
  assert.equal((await ask(owner, 'Hi?', 'not-an-id')).status, 400);
  assert.equal((await ask(owner, 'Hi?', new mongoose.Types.ObjectId().toString())).status, 404);
  assert.equal(calls.length, 0);
});

test('403 for a non-member, also on a Public project; the AI is never called', async () => {
  for (const id of [projectId, publicProjectId]) {
    const res = await ask(outsider, 'What is this project about?', id);
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(res.body.answer, undefined);
  }
  assert.equal(calls.length, 0);
});

test('every member role can ask, Viewer included (role-permission matrix: Use Copilot = Yes for all)', async () => {
  for (const account of [owner, admin, contributor, viewer]) {
    const res = await ask(account, 'What is a Kanban board?');
    assert.equal(res.status, 200, `${account.user.name}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.answer, 'A Kanban board shows work in columns [T1].');
  }
  assert.equal(calls.length, 4);
});

// --- AC1: submit a question, receive an answer ------------------------------------------------------

test('200: answer, trimmed question, timing fields and no caching', async () => {
  const before = Date.now();
  const res = await ask(contributor, '   When is the next milestone due?  \n');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.headers['cache-control'], 'no-store');
  // [Sprint 6 · M4] adds insufficient, sources and context.
  assert.deepEqual(Object.keys(res.body).sort(), [
    'answer',
    'answeredAt',
    'askedAt',
    'context',
    'durationMs',
    'insufficient',
    'question',
    'shortened',
    'sources',
  ]);
  assert.equal(res.body.insufficient, false);
  assert.deepEqual(
    res.body.sources.map((source) => source.label),
    ['Set up the Kanban board']
  );
  assert.equal(res.body.question, 'When is the next milestone due?');
  assert.equal(res.body.shortened, false);
  assert.equal(res.body.durationMs, 1234);
  assert.ok(Date.parse(res.body.askedAt) >= before - 1000);
  assert.ok(Date.parse(res.body.answeredAt) >= Date.parse(res.body.askedAt));

  // What reached the AI: one user message (the project records, then the trimmed question), the project
  // named in the system prompt. [Sprint 6 · M4] the records come first.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].messages.length, 1);
  assert.equal(calls[0].messages[0].role, 'user');
  assert.match(calls[0].messages[0].content, /Title: Set up the Kanban board/);
  assert.match(calls[0].messages[0].content, /\n\nQuestion: When is the next milestone due\?$/);
  assert.match(calls[0].system, /"Copilot Project"/);
  assert.match(calls[0].system, /cannot create, change or delete/);
});

test('a truncated or over-long answer is flagged as shortened', async () => {
  reply = async () => ({ text: 'Cut off mid [T1]', truncated: true, durationMs: 5 });
  const truncated = await ask(owner, 'Explain everything?');
  assert.equal(truncated.status, 200);
  assert.equal(truncated.body.shortened, true);

  reply = async () => ({ text: `[T1] ${'w'.repeat(ANSWER_MAX_CHARS + 10)}`, truncated: false, durationMs: 5 });
  const long = await ask(owner, 'Explain everything again?');
  assert.equal(long.status, 200);
  assert.equal(long.body.shortened, true);
  assert.equal(long.body.answer.length, ANSWER_MAX_CHARS);
});

// --- The 500-character limit ----------------------------------------------------------------------

test('boundary: exactly 500 characters is answered, 501 is refused before the AI is called', async () => {
  const ok = await ask(owner, 'q'.repeat(500));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(calls.length, 1);

  const tooLong = await ask(owner, 'q'.repeat(501));
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.body.code, 'QUESTION_TOO_LONG');
  assert.match(tooLong.body.message, /500 characters/);
  assert.equal(calls.length, 1, 'the 501-character question never reached the AI');
});

test('400 QUESTION_REQUIRED for a missing, blank or non-text question', async () => {
  for (const body of [{}, { question: '' }, { question: '    ' }, { question: 123 }, { question: ['a'] }]) {
    const res = await as(owner).post(askUrl()).send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.code, 'QUESTION_REQUIRED');
  }
  assert.equal(calls.length, 0);
});

// --- AI unavailable (NFR-9) ------------------------------------------------------------------------

test('503 "AI temporarily unavailable" when the AI provider fails, with Retry-After', async () => {
  for (const reason of ['timeout', 'network', 'rate_limited', 'provider_error', 'paused']) {
    reply = async () => {
      throw new AiUnavailableError(reason);
    };
    const res = await ask(owner, 'Are we on track?');
    assert.equal(res.status, 503, reason);
    assert.deepEqual(res.body, { code: 'AI_UNAVAILABLE', message: AI_UNAVAILABLE_MESSAGE });
    assert.equal(res.headers['retry-after'], String(RETRY_AFTER_SECONDS));
  }
});

test('while the AI is down, chat, tasks and feeds keep working', async () => {
  reply = async () => {
    throw new AiUnavailableError('timeout');
  };
  assert.equal((await ask(contributor, 'Are we on track?')).status, 503);

  const task = await as(contributor).post(`/api/projects/${projectId}/tasks`).send({ title: 'Still works' });
  assert.equal(task.status, 201, JSON.stringify(task.body));
  assert.equal((await as(contributor).get(`/api/projects/${projectId}/tasks`)).status, 200);
  assert.equal((await as(contributor).get(`/api/projects/${projectId}/channels`)).status, 200);
  assert.equal((await as(contributor).get(`/api/projects/${projectId}/activity`)).status, 200);
  assert.equal((await as(contributor).get('/api/posts')).status, 200);
  assert.equal((await as(contributor).get(`/api/projects/${projectId}/dashboard`)).status, 200);
});

test('with no LLM_API_KEY the real client answers 503 at once (no network call)', async () => {
  const saved = process.env.LLM_API_KEY;
  delete process.env.LLM_API_KEY;
  setLlmClient(null); // the real shared client, created from process.env
  try {
    const started = Date.now();
    const res = await ask(owner, 'Hello?');
    assert.equal(res.status, 503);
    assert.equal(res.body.code, 'AI_UNAVAILABLE');
    assert.ok(Date.now() - started < 3000, 'fails fast instead of waiting for a timeout');
  } finally {
    if (saved === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = saved;
    setLlmClient(fakeClient);
  }
});

test('an unexpected error is a plain 500 that reveals nothing', async () => {
  reply = async () => {
    throw new TypeError('secret internal detail');
  };
  const original = console.error;
  console.error = () => {};
  try {
    const res = await ask(owner, 'Will this break?');
    assert.equal(res.status, 500);
    assert.ok(!JSON.stringify(res.body).includes('secret internal detail'));
  } finally {
    console.error = original;
  }
});

// --- Read-only ------------------------------------------------------------------------------------

test('asking never writes anything: no new or removed records in any collection', async () => {
  await new Promise((resolve) => setTimeout(resolve, 100)); // let writes from earlier tests settle
  const before = await countEverything();
  assert.equal((await ask(owner, 'Summarise the project?')).status, 200);
  reply = async () => {
    throw new AiUnavailableError('timeout');
  };
  assert.equal((await ask(viewer, 'And now?')).status, 503);
  assert.equal((await ask(owner, 'x'.repeat(501))).status, 400);
  assert.deepEqual(await countEverything(), before);
});
