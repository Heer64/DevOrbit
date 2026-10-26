// [Sprint 3] US-20: comment on a task (author + time) and @mention members (Mention notification).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as connect } from 'socket.io-client';
import { setup, teardown, signup, authed } from './helpers.js';
import { initRealtime, closeRealtime } from '../src/lib/realtime.js';
import Notification from '../src/models/Notification.js';
import { mentionCandidates, findMentionedMembers } from '../src/lib/mentions.js';
import Project from '../src/models/Project.js';

let app;
let server;
let baseUrl;
let owner, contributor, viewer, outsider;
let projectId;
let taskId;
const sockets = [];

const as = (account) => authed(app, account.token);
const comments = (id = taskId) => `/api/projects/${projectId}/tasks/${id}/comments`;
const mentionsFor = (account) => Notification.find({ recipient: account.user.id, type: 'mention' }).lean();

function open(token) {
  const socket = connect(baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}
const join = (socket, id) => new Promise((resolve) => { socket.emit('project:join', { projectId: id }, resolve); });
function nextEvent(socket, name, ms = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${name} within ${ms} ms`)), ms);
    socket.once(name, (payload) => { clearTimeout(timer); resolve(payload); });
  });
}
function noEvent(socket, name, ms = 300) {
  return new Promise((resolve, reject) => {
    const handler = () => reject(new Error(`unexpected ${name}`));
    socket.once(name, handler);
    setTimeout(() => { socket.off(name, handler); resolve(); }, ms);
  });
}

before(async () => {
  ({ app } = await setup());
  await Notification.init();
  server = http.createServer(app);
  initRealtime(server, { origins: ['http://localhost:5173'] });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  [owner, contributor, viewer, outsider] = await Promise.all(
    ['Comment Owner', 'Comment Contributor', 'Comment Viewer', 'Comment Outsider'].map((name) => signup(app, name))
  );
  const project = await as(owner).post('/api/projects').send({ name: 'Comment Project', visibility: 'Public' });
  projectId = project.body.project._id;
  for (const [account, role] of [[contributor, 'Contributor'], [viewer, 'Viewer']]) {
    const res = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
  const task = await as(owner).post(`/api/projects/${projectId}/tasks`).send({ title: 'Build login page' });
  assert.equal(task.status, 201, JSON.stringify(task.body));
  taskId = task.body.task._id;
});

after(async () => {
  sockets.forEach((socket) => socket.close());
  await closeRealtime();
  await teardown();
});

// ---------------------------------------------------------------- mention parsing

test('mentionCandidates finds @username, ignores emails and repeats, and handles trailing punctuation', () => {
  assert.deepEqual(mentionCandidates('Hi @Riya_K and @dev-1, ping @riya_k again'), [['riya_k'], ['dev-1']]);
  assert.deepEqual(mentionCandidates('mail me at riya@example.com'), []);
  assert.deepEqual(mentionCandidates('Thanks @riya.'), [['riya.', 'riya']]);
  assert.deepEqual(mentionCandidates('@ab is too short, @abc is fine'), [['abc']]);
  assert.deepEqual(mentionCandidates('(@first) @second!'), [['first'], ['second']]);
  assert.deepEqual(mentionCandidates(''), []);
});

test('findMentionedMembers only returns current project members', async () => {
  const project = await Project.findById(projectId).lean();
  const found = await findMentionedMembers(project, `@${contributor.user.username} @${outsider.user.username} @nobody123`);
  assert.deepEqual(found.map((user) => user.username), [contributor.user.username]);
});

// ---------------------------------------------------------------- API

test('A comment appears under the task with the author name and a timestamp', async () => {
  const sent = await as(contributor).post(comments()).send({ body: '  I can take the form validation  ' });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.comment.body, 'I can take the form validation');
  assert.equal(sent.body.comment.author.name, 'Comment Contributor');
  assert.equal(sent.body.comment.author.username, contributor.user.username);
  assert.ok(sent.body.comment.createdAt);
  assert.deepEqual(sent.body.comment.mentions, []);

  const list = await as(viewer).get(comments());
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.comments.map((c) => c.body), ['I can take the form validation']);
  assert.equal(list.body.comments[0].author.name, 'Comment Contributor');
});

test('@mentioning a member stores the mention and sends them a Mention notification linking to the task', async () => {
  const sent = await as(contributor).post(comments()).send({ body: `@${viewer.user.username} can you review this?` });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.deepEqual(sent.body.comment.mentions.map((user) => user.username), [viewer.user.username]);

  const rows = await mentionsFor(viewer);
  const note = rows.find((row) => String(row.targetId) === String(sent.body.comment._id));
  assert.ok(note, 'mentioned member got a notification');
  assert.equal(note.type, 'mention');
  assert.equal(note.targetType, 'comment');
  assert.equal(String(note.actor), contributor.user.id);
  assert.equal(note.summary, 'mentioned you in a comment on "Build login page"');
  assert.equal(note.targetLabel, 'Build login page');
  assert.equal(note.link, `/project/${projectId}?tab=tasks&task=${taskId}`);
  assert.equal(note.read, false);

  // It shows in the recipient's own notification list (US-30 storage, M7 Part 1).
  const listed = await as(viewer).get('/api/notifications');
  assert.ok(listed.body.notifications.some((n) => n._id === String(note._id)));
});

test('Mentioning the same person twice notifies once; mentioning yourself notifies nobody', async () => {
  const before = (await mentionsFor(owner)).length;
  await as(contributor).post(comments()).send({ body: `@${owner.user.username} and again @${owner.user.username}` });
  assert.equal((await mentionsFor(owner)).length, before + 1);

  const mine = (await mentionsFor(contributor)).length;
  const self = await as(contributor).post(comments()).send({ body: `note to self @${contributor.user.username}` });
  assert.equal(self.status, 201);
  assert.equal((await mentionsFor(contributor)).length, mine);
});

test('Non-members and unknown names are not notified and not highlighted', async () => {
  const sent = await as(owner).post(comments()).send({ body: `cc @${outsider.user.username} @ghost_user` });
  assert.equal(sent.status, 201);
  assert.deepEqual(sent.body.comment.mentions, []);
  assert.equal((await mentionsFor(outsider)).length, 0);
});

test('Viewers can read comments but get 403 when posting', async () => {
  assert.equal((await as(viewer).get(comments())).status, 200);
  const res = await as(viewer).post(comments()).send({ body: 'Looks good' });
  assert.equal(res.status, 403);
  assert.match(res.body.message, /Viewers can read task comments/);
});

test('Comments are members-only, even on a Public project', async () => {
  assert.equal((await as(outsider).get(comments())).status, 403);
  assert.equal((await as(outsider).post(comments()).send({ body: 'hi' })).status, 403);
});

test('Invalid input is rejected', async () => {
  assert.equal((await as(owner).post(comments()).send({ body: '   ' })).status, 400);
  assert.equal((await as(owner).post(comments()).send({ body: 'x'.repeat(2001) })).status, 400);
  assert.equal((await as(owner).post(comments('not-an-id')).send({ body: 'hi' })).status, 400);
  assert.equal((await as(owner).post(comments('64b7f0c2a1b2c3d4e5f60718')).send({ body: 'hi' })).status, 404);
  assert.equal((await as(owner).get(`${comments()}?after=nope`)).status, 400);

  // A task from another project cannot be commented on through this project's URL.
  const other = await as(owner).post('/api/projects').send({ name: 'Other Project' });
  const otherTask = await as(owner).post(`/api/projects/${other.body.project._id}/tasks`).send({ title: 'Elsewhere' });
  assert.equal((await as(owner).get(comments(otherTask.body.task._id))).status, 404);
});

test('Comments are read oldest-first and paged with nextAfter', async () => {
  const task = await as(owner).post(`/api/projects/${projectId}/tasks`).send({ title: 'Paging task' });
  const id = task.body.task._id;
  for (let i = 1; i <= 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await as(owner).post(comments(id)).send({ body: `c${i}` });
  }
  const first = await as(owner).get(`${comments(id)}?limit=3`);
  assert.deepEqual(first.body.comments.map((c) => c.body), ['c1', 'c2', 'c3']);
  assert.ok(first.body.nextAfter);
  const rest = await as(owner).get(`${comments(id)}?after=${encodeURIComponent(first.body.nextAfter)}`);
  assert.deepEqual(rest.body.comments.map((c) => c.body), ['c4']);
});

test('Members get new comments live; visitors of a Public project do not', async () => {
  const member = await open(viewer.token);
  const visitor = await open(outsider.token);
  assert.equal((await join(member, projectId)).ok, true);
  assert.equal((await join(visitor, projectId)).ok, true);

  const arrived = nextEvent(member, 'comment:created', 1000);
  const notForVisitor = noEvent(visitor, 'comment:created', 400);
  await as(owner).post(comments()).send({ body: 'Live comment' });

  const payload = await arrived;
  assert.equal(payload.projectId, projectId);
  assert.equal(payload.taskId, taskId);
  assert.equal(payload.comment.body, 'Live comment');
  assert.equal(payload.comment.author.name, 'Comment Owner');
  await notForVisitor;
});

test('Comments appear in the Activity Feed as comment.created', async () => {
  const sent = await as(contributor).post(comments()).send({ body: 'Feed comment' });
  const feed = await as(owner).get(`/api/projects/${projectId}/activity`);
  const event = feed.body.activity.find((item) => String(item.targetId) === String(sent.body.comment._id));
  assert.ok(event);
  assert.equal(event.type, 'comment.created');
  assert.equal(event.targetType, 'comment');
  assert.equal(event.summary, 'commented on "Build login page": "Feed comment"');
  assert.equal(event.meta.taskId, taskId);
});

test('Existing task endpoints are unchanged by the comments route', async () => {
  const got = await as(viewer).get(`/api/projects/${projectId}/tasks/${taskId}`);
  assert.equal(got.status, 200);
  assert.equal(got.body.task.title, 'Build login page');
  assert.equal((await as(viewer).get(`/api/projects/${projectId}/tasks`)).status, 200);
});
