// Sprint 2 final: project channels and messages (US-16).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as connect } from 'socket.io-client';
import { setup, teardown, signup, authed } from './helpers.js';
import { initRealtime, closeRealtime } from '../src/lib/realtime.js';

let app;
let server;
let baseUrl;
let owner, contributor, viewer, outsider;
let projectId;
let generalId;
const sockets = [];

const as = (account) => authed(app, account.token);
const channels = () => `/api/projects/${projectId}/channels`;
const messages = (channelId) => `${channels()}/${channelId}/messages`;

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
    ['Chat Owner', 'Chat Contributor', 'Chat Viewer', 'Chat Outsider'].map((name) => signup(app, name))
  );
  const project = await as(owner).post('/api/projects').send({ name: 'Chat Project', visibility: 'Public' });
  projectId = project.body.project._id;
  for (const [account, role] of [[contributor, 'Contributor'], [viewer, 'Viewer']]) {
    const res = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
});

after(async () => {
  sockets.forEach((socket) => socket.close());
  await closeRealtime();
  await teardown();
});

test('#general is created automatically and only once', async () => {
  const [first, second] = await Promise.all([as(owner).get(channels()), as(contributor).get(channels())]);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(second.status, 200);
  const names = first.body.channels.map((c) => c.name);
  assert.deepEqual(names, ['general']);
  assert.equal((await as(owner).get(channels())).body.channels.length, 1);
  generalId = first.body.channels[0]._id;
  assert.equal(first.body.membershipRole, 'Owner');
});

test('A Contributor sends a message; it is saved in the history with author and time', async () => {
  const sent = await as(contributor).post(messages(generalId)).send({ body: '  Hello team  ' });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.message.body, 'Hello team');
  assert.equal(sent.body.message.author.name, 'Chat Contributor');
  assert.ok(sent.body.message.createdAt);

  const history = await as(viewer).get(messages(generalId));
  assert.equal(history.status, 200);
  assert.equal(history.body.messages.at(-1).body, 'Hello team');
});

test('A Viewer gets 403 when sending but can still read the channel', async () => {
  const res = await as(viewer).post(messages(generalId)).send({ body: 'Can I talk?' });
  assert.equal(res.status, 403);
  assert.match(res.body.message, /Viewers can read/);
  assert.equal((await as(viewer).get(messages(generalId))).status, 200);
});

test('Non-members cannot read or post, even in a Public project', async () => {
  assert.equal((await as(outsider).get(channels())).status, 403);
  assert.equal((await as(outsider).get(messages(generalId))).status, 403);
  assert.equal((await as(outsider).post(messages(generalId)).send({ body: 'hi' })).status, 403);
});

test('Empty, too long and wrong-channel messages are rejected', async () => {
  assert.equal((await as(owner).post(messages(generalId)).send({ body: '   ' })).status, 400);
  assert.equal((await as(owner).post(messages(generalId)).send({ body: 'x'.repeat(4001) })).status, 400);
  assert.equal((await as(owner).post(messages('not-an-id')).send({ body: 'hi' })).status, 400);
  assert.equal((await as(owner).post(messages('64b7f0c2a1b2c3d4e5f60718')).send({ body: 'hi' })).status, 404);
});

test('Owners and Admins create channels; Contributors cannot; names are unique', async () => {
  const created = await as(owner).post(channels()).send({ name: 'Design Review', description: 'UI talk' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.channel.name, 'design-review');

  assert.equal((await as(owner).post(channels()).send({ name: 'design-review' })).status, 409);
  assert.equal((await as(owner).post(channels()).send({ name: '!!' })).status, 400);
  assert.equal((await as(contributor).post(channels()).send({ name: 'random' })).status, 403);

  const list = await as(viewer).get(channels());
  assert.deepEqual(list.body.channels.map((c) => c.name), ['general', 'design-review']);
});

test('History is paged newest-first and each page reads oldest-first', async () => {
  const room = await as(owner).post(channels()).send({ name: 'paging' });
  const id = room.body.channel._id;
  for (let i = 1; i <= 5; i += 1) {
    // Sequential so createdAt is increasing.
    // eslint-disable-next-line no-await-in-loop
    await as(owner).post(messages(id)).send({ body: `m${i}` });
  }
  const first = await as(owner).get(`${messages(id)}?limit=2`);
  assert.deepEqual(first.body.messages.map((m) => m.body), ['m4', 'm5']);
  assert.ok(first.body.nextBefore);
  const older = await as(owner).get(`${messages(id)}?limit=10&before=${encodeURIComponent(first.body.nextBefore)}`);
  assert.deepEqual(older.body.messages.map((m) => m.body), ['m1', 'm2', 'm3']);
  assert.equal(older.body.nextBefore, null);
});

test('Members watching the project get the message live (< 1 s); visitors of a Public project do not', async () => {
  const member = await open(viewer.token);
  const visitor = await open(outsider.token);
  assert.equal((await join(member, projectId)).ok, true);
  assert.equal((await join(visitor, projectId)).ok, true); // may watch the public task board...

  const started = Date.now();
  const arrived = nextEvent(member, 'message:created', 1000);
  const notForVisitor = noEvent(visitor, 'message:created', 400);
  await as(owner).post(messages(generalId)).send({ body: 'Live hello' });

  const payload = await arrived;
  assert.ok(Date.now() - started < 1000);
  assert.equal(payload.projectId, projectId);
  assert.equal(payload.channelId, generalId);
  assert.equal(payload.message.body, 'Live hello');
  await notForVisitor; // ...but never receives chat messages
});

/*
 * ---------------------------------------------------------------------------
 * [Sprint 2 final] What this file tests
 * US-16 acceptance criteria: messages are saved and reach viewers of the
 * channel live within 1 second; Viewers get 403 on send but can read; channels
 * are members-only; #general is automatic; Owner/Admin channel creation.
 * ---------------------------------------------------------------------------
 */
