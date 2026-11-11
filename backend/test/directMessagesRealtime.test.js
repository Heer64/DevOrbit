// [Sprint 6 · M2] US-19 AC2 / NFR-1b: a direct message reaches the recipient live in under 1 second,
// over the shared Socket.IO server, and nobody except the two participants receives it.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as connect } from 'socket.io-client';
import { setup, teardown, signup, authed } from './helpers.js';
import { initRealtime, closeRealtime } from '../src/lib/realtime.js';
import DirectConversation from '../src/models/DirectConversation.js';
import DirectMessage from '../src/models/DirectMessage.js';
import { dmSendLimiter } from '../src/routes/directMessages.js';

const BASE = '/api/direct-messages';
let app;
let server;
let baseUrl;
let alice, bob, carol;
const sockets = [];

const as = (account) => authed(app, account.token);

// ---- socket helpers (same style as realtime.test.js)
function open(token) {
  const socket = connect(baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
  sockets.push(socket);
  return socket;
}
function connected(socket) {
  return new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
}
async function online(account) {
  const socket = open(account.token);
  await connected(socket);
  return socket;
}
function nextEvent(socket, name, ms = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${name} within ${ms} ms`)), ms);
    socket.once(name, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}
function noEvent(socket, name, ms = 400) {
  return new Promise((resolve, reject) => {
    const handler = (payload) => reject(new Error(`unexpected ${name}: ${JSON.stringify(payload)}`));
    socket.once(name, handler);
    setTimeout(() => {
      socket.off(name, handler);
      resolve();
    }, ms);
  });
}

async function conversationBetween(a, b) {
  const res = await as(a).post(BASE).send({ username: b.user.username });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.conversation._id;
}

before(async () => {
  ({ app } = await setup());
  server = http.createServer(app);
  initRealtime(server, { origins: ['http://localhost:5173'] });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  [alice, bob, carol] = await Promise.all(['Alice Live', 'Bob Live', 'Carol Live'].map((name) => signup(app, name)));
});

beforeEach(async () => {
  await Promise.all([DirectConversation.deleteMany({}), DirectMessage.deleteMany({})]);
  dmSendLimiter.reset();
});

after(async () => {
  for (const socket of sockets) socket.disconnect();
  await closeRealtime(); // also closes the HTTP server
  await teardown();
});

test('AC2: the recipient receives the message live in under 1 second, with their own inbox view', async () => {
  const id = await conversationBetween(alice, bob);
  const bobSocket = await online(bob);

  const started = Date.now();
  const arrived = nextEvent(bobSocket, 'dm:message', 1000); // fails if it takes 1 second or more
  const sent = await as(alice).post(`${BASE}/${id}/messages`).send({ body: 'Live hello' });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  const payload = await arrived;
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 1000, `delivered after ${elapsed} ms`);
  assert.equal(payload.conversationId, id);
  assert.equal(payload.message.body, 'Live hello');
  assert.equal(payload.message._id, sent.body.message._id);
  assert.equal(payload.message.sender.username, alice.user.username);
  // Bob's view: the other person is Alice, the message is not his, and it is unread.
  assert.equal(payload.conversation.otherUser.username, alice.user.username);
  assert.equal(payload.conversation.lastMessage.fromMe, false);
  assert.equal(payload.conversation.unreadCount, 1);
  assert.equal(payload.unreadTotal, 1);
  assert.equal(JSON.stringify(payload).includes(alice.email), false);
});

test("AC2: nobody else receives it: not a third user, not the sender's view of the other person", async () => {
  const id = await conversationBetween(alice, bob);
  const [bobSocket, carolSocket, aliceOtherTab] = await Promise.all([online(bob), online(carol), online(alice)]);

  const toBob = nextEvent(bobSocket, 'dm:message');
  const toAliceTab = nextEvent(aliceOtherTab, 'dm:message');
  const toCarol = noEvent(carolSocket, 'dm:message');
  const sent = await as(alice).post(`${BASE}/${id}/messages`).send({ body: 'Only for Bob' });
  assert.equal(sent.status, 201);

  await toBob;
  await toCarol; // Carol, who is not in the conversation, gets nothing
  // The sender's other open tab also gets it, with the sender's own view.
  const mine = await toAliceTab;
  assert.equal(mine.conversation.otherUser.username, bob.user.username);
  assert.equal(mine.conversation.lastMessage.fromMe, true);
  assert.equal(mine.conversation.unreadCount, 0);
  assert.equal(mine.unreadTotal, 0);
});

test('AC2: a socket cannot listen in by joining a project room or sending fake events', async () => {
  const id = await conversationBetween(alice, bob);
  const carolSocket = await online(carol);
  carolSocket.emit('project:join', { projectId: id }); // a conversation ID is not a project
  carolSocket.emit('dm:message', { conversationId: id, message: { body: 'fake' } }); // clients cannot broadcast
  const bobSocket = await online(bob);
  const quiet = noEvent(carolSocket, 'dm:message');
  const toBob = nextEvent(bobSocket, 'dm:message');
  await as(alice).post(`${BASE}/${id}/messages`).send({ body: 'still private' });
  const payload = await toBob;
  assert.equal(payload.message.body, 'still private');
  await quiet;
});

test("reading a conversation tells the reader's other tabs (badge drops), and only them", async () => {
  const id = await conversationBetween(alice, bob);
  await as(alice).post(`${BASE}/${id}/messages`).send({ body: 'please read' });
  const [bobTab, aliceTab] = await Promise.all([online(bob), online(alice)]);

  const toBobTab = nextEvent(bobTab, 'dm:read');
  const notToAlice = noEvent(aliceTab, 'dm:read');
  const read = await as(bob).post(`${BASE}/${id}/read`);
  assert.equal(read.status, 200);
  assert.deepEqual(await toBobTab, { conversationId: id, unreadTotal: 0 });
  await notToAlice;
});

test('the live event and the REST history agree, message by message, in order', async () => {
  const id = await conversationBetween(alice, bob);
  const bobSocket = await online(bob);
  const received = [];
  bobSocket.on('dm:message', (payload) => received.push(payload.message.body));

  for (const body of ['one', 'two', 'three']) {
    const res = await as(alice).post(`${BASE}/${id}/messages`).send({ body });
    assert.equal(res.status, 201);
  }
  await new Promise((resolve) => {
    setTimeout(resolve, 300);
  });
  const history = await as(bob).get(`${BASE}/${id}/messages`);
  assert.deepEqual(received, ['one', 'two', 'three']);
  assert.deepEqual(
    history.body.messages.map((m) => m.body),
    received
  );
});
