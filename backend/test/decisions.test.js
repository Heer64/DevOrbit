// [Sprint 3 · M8] US-35 record a decision, US-36 view and update decisions.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, signup, authed } from './helpers.js';
import Decision from '../src/models/Decision.js';
import Activity from '../src/models/Activity.js';

let app;
let owner, admin, contributor, viewer, outsider;
let projectId, otherProjectId;
let taskId, otherTaskId, generalId, threadId, replyId;

const as = (account) => authed(app, account.token);
const decisions = (id = projectId) => `/api/projects/${id}/decisions`;
const valid = () => ({
  title: 'Use MongoDB for the task store',
  description: 'Tasks have optional fields (label, milestone, due date), so a document store fits.',
  participants: [owner.user.id, contributor.user.id],
  date: '2026-10-20',
});

before(async () => {
  ({ app } = await setup());
  [owner, admin, contributor, viewer, outsider] = await Promise.all(
    ['Decision Owner', 'Decision Admin', 'Decision Contributor', 'Decision Viewer', 'Decision Outsider'].map((name) => signup(app, name))
  );

  const project = await as(owner).post('/api/projects').send({ name: 'Decision Project', visibility: 'Public' });
  assert.equal(project.status, 201, JSON.stringify(project.body));
  projectId = project.body.project._id;
  for (const [account, role] of [[admin, 'Admin'], [contributor, 'Contributor'], [viewer, 'Viewer']]) {
    const res = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }

  const other = await as(outsider).post('/api/projects').send({ name: 'Other Project', visibility: 'Public' });
  otherProjectId = other.body.project._id;

  const task = await as(owner).post(`/api/projects/${projectId}/tasks`).send({ title: 'Set up database' });
  assert.equal(task.status, 201, JSON.stringify(task.body));
  taskId = task.body.task._id;
  const otherTask = await as(outsider).post(`/api/projects/${otherProjectId}/tasks`).send({ title: 'Not yours' });
  otherTaskId = otherTask.body.task._id;

  generalId = (await as(owner).get(`/api/projects/${projectId}/channels`)).body.channels[0]._id;
  const message = await as(owner).post(`/api/projects/${projectId}/channels/${generalId}/messages`).send({ body: 'Mongo or Postgres for tasks?' });
  assert.equal(message.status, 201, JSON.stringify(message.body));
  threadId = message.body.message._id;
  const reply = await as(contributor).post(`/api/projects/${projectId}/channels/${generalId}/messages/${threadId}/replies`).send({ body: 'Mongo, the fields vary a lot.' });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  replyId = reply.body.reply._id;
});

after(async () => {
  await teardown();
});

// --- US-35 acceptance criteria -------------------------------------------------------------

test('AC1: a Contributor records a decision with title, description, participants and date', async () => {
  const res = await as(contributor).post(decisions()).send(valid());
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const { decision } = res.body;
  assert.equal(decision.title, 'Use MongoDB for the task store');
  assert.equal(decision.date, '2026-10-20T00:00:00.000Z');
  assert.deepEqual(decision.participants.map((p) => p._id).sort(), [owner.user.id, contributor.user.id].sort());
  assert.equal(decision.participants[0].name !== undefined, true);
  assert.equal(decision.createdBy._id, contributor.user.id);
  assert.equal(decision.updatedBy, null);
  assert.equal(decision.link, null);
  assert.equal(await Decision.countDocuments({ _id: decision._id }), 1);
});

test('AC2: a decision linked to a task shows a working link to it', async () => {
  const res = await as(contributor).post(decisions()).send({ ...valid(), title: 'Database task owner', link: { type: 'task', id: taskId } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.deepEqual(res.body.decision.link, {
    type: 'task', id: taskId, label: 'Set up database', href: `/project/${projectId}?tab=tasks&task=${taskId}`, missing: false,
  });
});

test('AC2: a decision linked to a channel thread shows a working link to it', async () => {
  const res = await as(contributor).post(decisions()).send({ ...valid(), title: 'From the chat', link: { type: 'thread', id: threadId } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const { link } = res.body.decision;
  assert.equal(link.type, 'thread');
  assert.equal(link.channelId, generalId);
  assert.equal(link.label, '#general: Mongo or Postgres for tasks?');
  assert.equal(link.href, `/project/${projectId}?tab=chat&channel=${generalId}&message=${threadId}&thread=${threadId}`);
  assert.equal(link.missing, false);
});

test('AC3: a missing required field gives a validation error and nothing is saved', async () => {
  const before = await Decision.countDocuments({ project: projectId });
  for (const key of ['title', 'description', 'participants', 'date']) {
    const body = valid();
    delete body[key];
    const res = await as(contributor).post(decisions()).send(body);
    assert.equal(res.status, 400, key);
    assert.ok(res.body.message, key);
  }
  const blank = await as(contributor).post(decisions()).send({ ...valid(), title: '   ', participants: [] });
  assert.equal(blank.status, 400);
  const badDate = await as(contributor).post(decisions()).send({ ...valid(), date: '2026-02-30' });
  assert.equal(badDate.status, 400);
  assert.equal(await Decision.countDocuments({ project: projectId }), before);
});

// --- US-36 acceptance criteria -------------------------------------------------------------

test('AC4: every project member (Viewer too) sees all decisions with title and date, newest date first', async () => {
  await as(owner).post(decisions()).send({ ...valid(), title: 'Older decision', date: '2026-09-01' });
  await as(owner).post(decisions()).send({ ...valid(), title: 'Newest decision', date: '2026-10-28' });
  const total = await Decision.countDocuments({ project: projectId });

  for (const account of [owner, admin, contributor, viewer]) {
    const res = await as(account).get(decisions());
    assert.equal(res.status, 200);
    assert.equal(res.body.decisions.length, total);
    assert.ok(res.body.decisions.every((d) => d.title && d.date));
    const dates = res.body.decisions.map((d) => d.date);
    assert.deepEqual(dates, [...dates].sort().reverse());
    assert.equal(res.body.decisions[0].title, 'Newest decision');
  }
});

test('AC5: a Contributor edits a decision and the updated details are shown', async () => {
  const created = (await as(owner).post(decisions()).send({ ...valid(), title: 'Draft title' })).body.decision;
  const res = await as(contributor).patch(`${decisions()}/${created._id}`).send({
    title: 'Final title',
    description: 'Updated reasoning.',
    date: '2026-10-21',
    participants: [admin.user.id],
    link: { type: 'task', id: taskId },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { decision } = res.body;
  assert.equal(decision.title, 'Final title');
  assert.equal(decision.description, 'Updated reasoning.');
  assert.equal(decision.date, '2026-10-21T00:00:00.000Z');
  assert.deepEqual(decision.participants.map((p) => p._id), [admin.user.id]);
  assert.equal(decision.link.type, 'task');
  assert.equal(decision.updatedBy._id, contributor.user.id);

  const read = await as(viewer).get(`${decisions()}/${created._id}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.decision.title, 'Final title');

  // Removing the link.
  const unlinked = await as(contributor).patch(`${decisions()}/${created._id}`).send({ link: null });
  assert.equal(unlinked.body.decision.link, null);
});

test('an edit with an invalid field is refused and changes nothing', async () => {
  const created = (await as(owner).post(decisions()).send({ ...valid(), title: 'Keep me' })).body.decision;
  for (const body of [{ title: '' }, { participants: [] }, { date: 'tomorrow' }, { title: 'Changed', participants: [outsider.user.id] }]) {
    const res = await as(contributor).patch(`${decisions()}/${created._id}`).send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  const saved = await Decision.findById(created._id).lean();
  assert.equal(saved.title, 'Keep me');
  assert.equal(saved.participants.length, 2);
});

// --- Roles ---------------------------------------------------------------------------------

test('Viewers can read but get 403 when recording or editing', async () => {
  const created = (await as(owner).post(decisions()).send(valid())).body.decision;
  const post = await as(viewer).post(decisions()).send(valid());
  assert.equal(post.status, 403);
  const patch = await as(viewer).patch(`${decisions()}/${created._id}`).send({ title: 'Nope' });
  assert.equal(patch.status, 403);
  assert.equal((await Decision.findById(created._id).lean()).title, valid().title);
});

test('Owners and Admins can record and edit too', async () => {
  const byAdmin = await as(admin).post(decisions()).send(valid());
  assert.equal(byAdmin.status, 201);
  const edit = await as(owner).patch(`${decisions()}/${byAdmin.body.decision._id}`).send({ title: 'Edited by owner' });
  assert.equal(edit.status, 200);
  assert.equal(edit.body.decision.title, 'Edited by owner');
});

test('non-members get 403, even on a Public project', async () => {
  assert.equal((await as(outsider).get(decisions())).status, 403);
  assert.equal((await as(outsider).post(decisions()).send({ ...valid(), participants: [outsider.user.id] })).status, 403);
});

// --- Participants and links ----------------------------------------------------------------

test('a participant who is not a project member is refused', async () => {
  const res = await as(contributor).post(decisions()).send({ ...valid(), participants: [contributor.user.id, outsider.user.id] });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /members of this project/);
});

test('the same participant sent twice is saved once', async () => {
  const res = await as(contributor).post(decisions()).send({ ...valid(), participants: [contributor.user.id, contributor.user.id] });
  assert.equal(res.status, 201);
  assert.equal(res.body.decision.participants.length, 1);
});

test('a task from another project cannot be linked', async () => {
  const res = await as(contributor).post(decisions()).send({ ...valid(), link: { type: 'task', id: otherTaskId } });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /task in this project/);
});

test('a reply inside a thread cannot be used as the thread link', async () => {
  const res = await as(contributor).post(decisions()).send({ ...valid(), link: { type: 'thread', id: replyId } });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /not a reply/);
});

test('when the linked task is deleted, the decision is kept and its link is marked missing', async () => {
  const task = (await as(owner).post(`/api/projects/${projectId}/tasks`).send({ title: 'Short-lived task' })).body.task;
  const created = (await as(contributor).post(decisions()).send({ ...valid(), title: 'Linked to a doomed task', link: { type: 'task', id: task._id } })).body.decision;
  const removed = await as(owner).delete(`/api/projects/${projectId}/tasks/${task._id}`);
  assert.ok([200, 204].includes(removed.status), JSON.stringify(removed.body));

  const res = await as(viewer).get(`${decisions()}/${created._id}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.decision.link, { type: 'task', id: task._id, label: '', href: null, missing: true });
});

// --- IDs ------------------------------------------------------------------------------------

test('bad IDs give 400 and a decision from another project gives 404', async () => {
  assert.equal((await as(owner).get(`${decisions()}/not-an-id`)).status, 400);
  const elsewhere = await as(outsider).post(decisions(otherProjectId)).send({ ...valid(), participants: [outsider.user.id] });
  assert.equal(elsewhere.status, 201);
  const crossRead = await as(owner).get(`${decisions()}/${elsewhere.body.decision._id}`);
  assert.equal(crossRead.status, 404);
  const crossEdit = await as(owner).patch(`${decisions()}/${elsewhere.body.decision._id}`).send({ title: 'Hijack' });
  assert.equal(crossEdit.status, 404);
});

// --- Activity Feed -------------------------------------------------------------------------

test('recording and editing a decision write decision.created and decision.updated events', async () => {
  const created = (await as(contributor).post(decisions()).send({ ...valid(), title: 'Feed check' })).body.decision;
  await as(contributor).patch(`${decisions()}/${created._id}`).send({ title: 'Feed check v2' });

  const events = await Activity.find({ targetType: 'decision', targetId: created._id }).sort({ createdAt: 1 }).lean();
  assert.deepEqual(events.map((e) => e.type), ['decision.created', 'decision.updated']);
  assert.equal(events[0].summary, 'recorded decision "Feed check"');
  assert.equal(events[1].summary, 'updated decision "Feed check v2"');
  assert.equal(String(events[0].actor), contributor.user.id);

  const feed = await as(viewer).get(`/api/projects/${projectId}/activity`);
  assert.ok(feed.body.activity.some((e) => e.type === 'decision.updated' && e.targetLabel === 'Feed check v2'));
});

test('saving an edit that changes nothing does not add a feed event', async () => {
  const created = (await as(contributor).post(decisions()).send({ ...valid(), title: 'No-op edit' })).body.decision;
  const res = await as(contributor).patch(`${decisions()}/${created._id}`).send({ title: 'No-op edit' });
  assert.equal(res.status, 200);
  assert.equal(await Activity.countDocuments({ type: 'decision.updated', targetId: created._id }), 0);
});
