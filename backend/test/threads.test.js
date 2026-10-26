// [Sprint 3] US-17: reply to a channel message in a thread; the message shows its reply count.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as connect } from 'socket.io-client';
import { setup, teardown, signup, authed } from './helpers.js';
import { initRealtime, closeRealtime } from '../src/lib/realtime.js';
import mongoose from 'mongoose';
import Message from '../src/models/Message.js';

let app;
let server;
let baseUrl;
let owner, contributor, viewer, outsider;
let projectId;
let generalId;
let parentId;
const sockets = [];

const as = (account) => authed(app, account.token);
const channels = () => `/api/projects/${projectId}/channels`;
const messages = (channelId = generalId) => `${channels()}/${channelId}/messages`;
const replies = (messageId = parentId, channelId = generalId) => `${messages(channelId)}/${messageId}/replies`;

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
  server = http.createServer(app);
  initRealtime(server, { origins: ['http://localhost:5173'] });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  [owner, contributor, viewer, outsider] = await Promise.all(
    ['Thread Owner', 'Thread Contributor', 'Thread Viewer', 'Thread Outsider'].map((name) => signup(app, name))
  );
  const project = await as(owner).post('/api/projects').send({ name: 'Thread Project', visibility: 'Public' });
  projectId = project.body.project._id;
  for (const [account, role] of [[contributor, 'Contributor'], [viewer, 'Viewer']]) {
    const res = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
  generalId = (await as(owner).get(channels())).body.channels[0]._id;
  const parent = await as(owner).post(messages()).send({ body: 'Should we use Vite or Next?' });
  assert.equal(parent.status, 201, JSON.stringify(parent.body));
  parentId = parent.body.message._id;
});

after(async () => {
  sockets.forEach((socket) => socket.close());
  await closeRealtime();
  await teardown();
});

test('A new channel message starts with 0 replies', async () => {
  const history = await as(viewer).get(messages());
  const parent = history.body.messages.find((m) => m._id === parentId);
  assert.equal(parent.replyCount, 0);
});

test('A Contributor replies; the reply is in the thread and the message shows its reply count', async () => {
  const sent = await as(contributor).post(replies()).send({ body: '  Vite, it is lighter  ' });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.reply.body, 'Vite, it is lighter');
  assert.equal(sent.body.reply.author.name, 'Thread Contributor');
  assert.equal(String(sent.body.reply.parentMessage), parentId);
  assert.equal(sent.body.parent.replyCount, 1);
  assert.ok(sent.body.parent.lastReplyAt);

  const thread = await as(viewer).get(replies());
  assert.equal(thread.status, 200);
  assert.equal(thread.body.parent._id, parentId);
  assert.equal(thread.body.parent.author.name, 'Thread Owner');
  assert.deepEqual(thread.body.replies.map((r) => r.body), ['Vite, it is lighter']);

  const history = await as(viewer).get(messages());
  assert.equal(history.body.messages.find((m) => m._id === parentId).replyCount, 1);
});

test('Replies stay in the thread and do not clutter the channel history', async () => {
  const history = await as(owner).get(messages());
  assert.ok(history.body.messages.every((m) => !m.parentMessage), 'channel history must only list top-level messages');
  assert.ok(!history.body.messages.some((m) => m.body === 'Vite, it is lighter'));
});

test('Messages saved before threads existed still show in the channel with 0 replies', async () => {
  // Simulate an old row: no parentMessage / replyCount fields at all.
  const legacy = await Message.collection.insertOne({
    project: new mongoose.Types.ObjectId(projectId),
    channel: new mongoose.Types.ObjectId(generalId),
    author: new mongoose.Types.ObjectId(owner.user.id),
    body: 'Legacy message',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const history = await as(owner).get(messages());
  const row = history.body.messages.find((m) => String(m._id) === String(legacy.insertedId));
  assert.ok(row, 'legacy message is still listed');
  assert.equal(row.replyCount ?? 0, 0);

  const sent = await as(owner).post(replies(String(legacy.insertedId))).send({ body: 'Replying to an old one' });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.parent.replyCount, 1);
});

test('Concurrent replies are all counted', async () => {
  const parent = await as(owner).post(messages()).send({ body: 'Count me' });
  const id = parent.body.message._id;
  const results = await Promise.all(
    Array.from({ length: 6 }, (_, i) => as(i % 2 ? owner : contributor).post(replies(id)).send({ body: `r${i}` }))
  );
  results.forEach((res) => assert.equal(res.status, 201));
  const history = await as(owner).get(messages());
  assert.equal(history.body.messages.find((m) => m._id === id).replyCount, 6);
  assert.equal((await as(owner).get(replies(id))).body.replies.length, 6);
});

test('Replies are read oldest-first and paged with nextAfter', async () => {
  const parent = await as(owner).post(messages()).send({ body: 'Paging thread' });
  const id = parent.body.message._id;
  for (let i = 1; i <= 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await as(owner).post(replies(id)).send({ body: `p${i}` });
  }
  const first = await as(owner).get(`${replies(id)}?limit=3`);
  assert.deepEqual(first.body.replies.map((r) => r.body), ['p1', 'p2', 'p3']);
  assert.ok(first.body.nextAfter);
  const rest = await as(owner).get(`${replies(id)}?after=${encodeURIComponent(first.body.nextAfter)}`);
  assert.deepEqual(rest.body.replies.map((r) => r.body), ['p4']);
  assert.equal(rest.body.nextAfter, null);
});

test('Threads are one level deep: replying to a reply is refused', async () => {
  const thread = await as(owner).get(replies());
  const replyId = thread.body.replies[0]._id;
  const res = await as(owner).post(replies(replyId)).send({ body: 'nested?' });
  assert.equal(res.status, 400);
  assert.equal((await as(owner).get(replies(replyId))).status, 400);
});

test('Viewers can read threads but get 403 when replying', async () => {
  assert.equal((await as(viewer).get(replies())).status, 200);
  const res = await as(viewer).post(replies()).send({ body: 'me too' });
  assert.equal(res.status, 403);
  assert.match(res.body.message, /Viewers can read threads/);
});

test('Non-members cannot read or reply, even in a Public project', async () => {
  assert.equal((await as(outsider).get(replies())).status, 403);
  assert.equal((await as(outsider).post(replies()).send({ body: 'hi' })).status, 403);
});

test('Invalid input is rejected', async () => {
  assert.equal((await as(owner).post(replies()).send({ body: '   ' })).status, 400);
  assert.equal((await as(owner).post(replies()).send({ body: 'x'.repeat(4001) })).status, 400);
  assert.equal((await as(owner).post(replies('not-an-id')).send({ body: 'hi' })).status, 400);
  assert.equal((await as(owner).post(replies('64b7f0c2a1b2c3d4e5f60718')).send({ body: 'hi' })).status, 404);
  assert.equal((await as(owner).get(`${replies()}?after=nope`)).status, 400);

  // A message from another channel cannot be replied to through this channel's URL.
  const other = await as(owner).post(channels()).send({ name: 'other' });
  assert.equal(other.status, 201);
  assert.equal((await as(owner).post(replies(parentId, other.body.channel._id)).send({ body: 'wrong room' })).status, 404);
});

test('Members get replies live with the new reply count; visitors of a Public project do not', async () => {
  const member = await open(viewer.token);
  const visitor = await open(outsider.token);
  assert.equal((await join(member, projectId)).ok, true);
  assert.equal((await join(visitor, projectId)).ok, true);

  const arrived = nextEvent(member, 'message:reply', 1000);
  const notForVisitor = noEvent(visitor, 'message:reply', 400);
  const before = (await as(owner).get(messages())).body.messages.find((m) => m._id === parentId).replyCount;
  await as(owner).post(replies()).send({ body: 'Live reply' });

  const payload = await arrived;
  assert.equal(payload.projectId, projectId);
  assert.equal(payload.channelId, generalId);
  assert.equal(payload.parentId, parentId);
  assert.equal(payload.reply.body, 'Live reply');
  assert.equal(payload.replyCount, before + 1);
  await notForVisitor;
});

test('Thread replies appear in the Activity Feed', async () => {
  const sent = await as(contributor).post(replies()).send({ body: 'Feed reply' });
  const feed = await as(owner).get(`/api/projects/${projectId}/activity`);
  const event = feed.body.activity.find((item) => String(item.targetId) === String(sent.body.reply._id));
  assert.ok(event);
  assert.equal(event.type, 'message.posted');
  assert.equal(event.summary, 'replied in a thread in #general: "Feed reply"');
  assert.equal(event.meta.parentId, parentId);
});
