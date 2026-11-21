// [Sprint 7 · M2] Edits, deletes and "Seen" reach both participants live, over the shared Socket.IO server,
// and nobody else. Same set-up as directMessagesRealtime.test.js.
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
async function sendOk(from, conversationId, body) {
  const res = await as(from).post(`${BASE}/${conversationId}/messages`).send({ body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.message;
}

before(async () => {
  ({ app } = await setup());
  server = http.createServer(app);
  initRealtime(server, { origins: ['http://localhost:5173'] });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  [alice, bob, carol] = await Promise.all(['Alice Live Edit', 'Bob Live Edit', 'Carol Live Edit'].map((name) => signup(app, name)));
});

beforeEach(async () => {
  await Promise.all([DirectConversation.deleteMany({}), DirectMessage.deleteMany({})]);
  dmSendLimiter.reset();
});

after(async () => {
  for (const socket of sockets) socket.disconnect();
  await closeRealtime();
  await teardown();
});

test('[Sprint 7 · M2] an edit reaches both participants live (each with their own view), and nobody else', async () => {
  const id = await conversationBetween(alice, bob);
  const sent = await sendOk(alice, id, 'Meet at 4');
  const [bobSocket, aliceTab, carolSocket] = await Promise.all([online(bob), online(alice), online(carol)]);

  const toBob = nextEvent(bobSocket, 'dm:updated', 1000);
  const toAlice = nextEvent(aliceTab, 'dm:updated', 1000);
  const toCarol = noEvent(carolSocket, 'dm:updated');
  const res = await as(alice).patch(`${BASE}/${id}/messages/${sent._id}`).send({ body: 'Meet at 5' });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const forBob = await toBob;
  assert.equal(forBob.conversationId, id);
  assert.equal(forBob.message._id, sent._id);
  assert.equal(forBob.message.body, 'Meet at 5');
  assert.equal(forBob.message.edited, true);
  assert.equal(forBob.message.status, null, "Bob's copy has no Sent/Seen (it is not his message)");
  assert.equal(forBob.conversation.otherUser.username, alice.user.username);
  assert.equal(forBob.conversation.lastMessage.preview, 'Meet at 5');
  assert.equal(forBob.unreadTotal, 1);

  const forAlice = await toAlice;
  assert.equal(forAlice.message.body, 'Meet at 5');
  assert.equal(forAlice.message.status, 'sent');
  assert.equal(forAlice.conversation.otherUser.username, bob.user.username);
  await toCarol;
});

test('[Sprint 7 · M2] a delete reaches the other person live as "Message deleted" without its text, and lowers their unread count', async () => {
  const id = await conversationBetween(alice, bob);
  const sent = await sendOk(alice, id, 'wrong chat, sorry');
  const [bobSocket, carolSocket] = await Promise.all([online(bob), online(carol)]);

  const toBob = nextEvent(bobSocket, 'dm:updated', 1000);
  const toCarol = noEvent(carolSocket, 'dm:updated');
  const res = await as(alice).delete(`${BASE}/${id}/messages/${sent._id}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const payload = await toBob;
  assert.equal(payload.message._id, sent._id);
  assert.equal(payload.message.deleted, true);
  assert.equal(payload.message.body, '');
  assert.equal(JSON.stringify(payload).includes('wrong chat'), false, 'the deleted text is never sent live');
  assert.equal(payload.conversation.lastMessage.preview, 'Message deleted');
  assert.equal(payload.conversation.unreadCount, 0);
  assert.equal(payload.unreadTotal, 0);
  await toCarol;
});

test('[Sprint 7 · M2] a refused edit (403) or an unchanged one sends no event', async () => {
  const id = await conversationBetween(alice, bob);
  const sent = await sendOk(alice, id, 'stable');
  const [aliceSocket, bobSocket] = await Promise.all([online(alice), online(bob)]);
  const quietAlice = noEvent(aliceSocket, 'dm:updated');
  const quietBob = noEvent(bobSocket, 'dm:updated');
  assert.equal((await as(bob).patch(`${BASE}/${id}/messages/${sent._id}`).send({ body: 'hijack' })).status, 403);
  assert.equal((await as(bob).delete(`${BASE}/${id}/messages/${sent._id}`)).status, 403);
  assert.equal((await as(alice).patch(`${BASE}/${id}/messages/${sent._id}`).send({ body: 'stable' })).body.changed, false);
  await Promise.all([quietAlice, quietBob]);
});

test('[Sprint 7 · M2] when the recipient opens the conversation, the sender is told live: "Seen"', async () => {
  const id = await conversationBetween(alice, bob);
  const sent = await sendOk(alice, id, 'did you see this?');
  const [aliceSocket, bobSocket, carolSocket] = await Promise.all([online(alice), online(bob), online(carol)]);

  const started = Date.now();
  const toAlice = nextEvent(aliceSocket, 'dm:seen', 1000);
  const notToBob = noEvent(bobSocket, 'dm:seen'); // the reader gets 'dm:read' (badge), not 'dm:seen'
  const notToCarol = noEvent(carolSocket, 'dm:seen');
  const read = await as(bob).post(`${BASE}/${id}/read`);
  assert.equal(read.status, 200);

  const payload = await toAlice;
  assert.ok(Date.now() - started < 1000);
  assert.equal(payload.conversationId, id);
  assert.ok(new Date(payload.readAt).getTime() >= new Date(sent.createdAt).getTime(), 'covers the message Alice sent');
  assert.deepEqual(Object.keys(payload).sort(), ['conversationId', 'readAt']);
  await Promise.all([notToBob, notToCarol]);

  // And it is saved: Alice reloads and the message is still "seen".
  const history = await as(alice).get(`${BASE}/${id}/messages`);
  assert.equal(history.body.messages[0].status, 'seen');
});
