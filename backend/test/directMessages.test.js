// [Sprint 6 · M2] US-19 Send direct messages (FR-6) against a real MongoDB.
// AC1: "Message" on a profile opens a direct conversation, separate from all project channels.
// AC2: only the two participants can read it (live delivery is in directMessagesRealtime.test.js).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import Activity from '../src/models/Activity.js';
import DirectConversation from '../src/models/DirectConversation.js';
import DirectMessage from '../src/models/DirectMessage.js';
import Message from '../src/models/Message.js';
import Notification from '../src/models/Notification.js';
import User from '../src/models/User.js';
import { DM_BODY_MAX, DM_MESSAGES, DM_SEND_LIMIT } from '../src/lib/directMessageRules.js';
import { dmSendLimiter } from '../src/routes/directMessages.js';

const BASE = '/api/direct-messages';
let app;
let alice, bob, carol, dave;

const as = (account) => authed(app, account.token);
const open = (from, to) => as(from).post(BASE).send({ username: to.user.username });
const send = (from, conversationId, body) => as(from).post(`${BASE}/${conversationId}/messages`).send({ body });
const inbox = async (account) => {
  const res = await as(account).get(BASE);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
};
async function conversationBetween(a, b) {
  const res = await open(a, b);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.conversation._id;
}
async function sendOk(from, conversationId, body) {
  const res = await send(from, conversationId, body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.message;
}

before(async () => {
  ({ app } = await setup());
  [alice, bob, carol, dave] = await Promise.all(
    ['Alice Sender', 'Bob Receiver', 'Carol Outsider', 'Dave Other'].map((name) => signup(app, name))
  );
});

beforeEach(async () => {
  await Promise.all([DirectConversation.deleteMany({}), DirectMessage.deleteMany({})]);
  dmSendLimiter.reset();
});

after(teardown);

// --- Login ---------------------------------------------------------------------------------------

test('login is required for every direct-message route (NFR-19)', async () => {
  const id = '64b000000000000000000001';
  const calls = [
    request(app).get(BASE),
    request(app).get(`${BASE}/unread-count`),
    request(app).post(BASE).send({ username: bob.user.username }),
    request(app).get(`${BASE}/${id}`),
    request(app).get(`${BASE}/${id}/messages`),
    request(app).post(`${BASE}/${id}/messages`).send({ body: 'hi' }),
    request(app).post(`${BASE}/${id}/read`),
  ];
  for (const res of await Promise.all(calls)) assert.equal(res.status, 401);
});

// --- AC1: open a conversation from a profile ------------------------------------------------------

test('AC1: "Message" opens a conversation with that user, with only their public fields', async () => {
  const res = await open(alice, bob);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { conversation } = res.body;
  assert.match(conversation._id, /^[a-f0-9]{24}$/);
  assert.deepEqual(conversation.otherUser, { _id: bob.user.id, name: 'Bob Receiver', username: bob.user.username, avatarUrl: '' });
  assert.equal(conversation.lastMessage, null);
  assert.equal(conversation.unreadCount, 0);
  // No email, IDs of both people or internal fields.
  const text = JSON.stringify(res.body);
  assert.equal(text.includes(bob.email), false);
  for (const key of ['pairKey', 'reads', 'participants', 'openedBy']) assert.equal(key in conversation, false);
});

test('AC1: both people get the same conversation, however often and in whatever order they open it', async () => {
  const first = await conversationBetween(alice, bob);
  const again = await conversationBetween(alice, bob);
  const fromBob = await conversationBetween(bob, alice);
  assert.equal(again, first);
  assert.equal(fromBob, first);
  assert.equal(await DirectConversation.countDocuments(), 1);

  const res = await as(bob).get(`${BASE}/${first}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.conversation.otherUser.username, alice.user.username);
});

test('AC1: two people pressing "Message" at the same moment still get one conversation', async () => {
  const [a, b] = await Promise.all([open(alice, bob), open(bob, alice)]);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(a.body.conversation._id, b.body.conversation._id);
  assert.equal(await DirectConversation.countDocuments(), 1);
});

test('AC1: a different person means a different conversation', async () => {
  const withBob = await conversationBetween(alice, bob);
  const withCarol = await conversationBetween(alice, carol);
  assert.notEqual(withBob, withCarol);
});

test('opening: no username 400, unknown user 404, yourself 400', async () => {
  const missing = await as(alice).post(BASE).send({});
  assert.equal(missing.status, 400);
  assert.equal(missing.body.message, DM_MESSAGES.usernameRequired);

  assert.equal((await as(alice).post(BASE).send({ username: 'nobody-here-123' })).status, 404);
  assert.equal(
    (
      await as(alice)
        .post(BASE)
        .send({ username: { $gt: '' } })
    ).status,
    404,
    'an object is not a username'
  );

  const self = await open(alice, alice);
  assert.equal(self.status, 400);
  assert.equal(self.body.code, 'self_message');
  assert.equal(self.body.message, DM_MESSAGES.self);
  assert.equal(await DirectConversation.countDocuments(), 0);
});

test('AC1: direct messages are separate from project channels: no channel message, activity or notification is written', async () => {
  const project = await as(alice).post('/api/projects').send({ name: 'Shared Project', visibility: 'Private' });
  assert.equal(project.status, 201, JSON.stringify(project.body));
  const added = await as(alice)
    .post(`/api/projects/${project.body.project._id}/members`)
    .send({ identifier: bob.user.username, role: 'Contributor' });
  assert.equal(added.status, 201, JSON.stringify(added.body));

  const [messagesBefore, activityBefore, notificationsBefore] = await Promise.all([
    Message.countDocuments(),
    Activity.countDocuments(),
    Notification.countDocuments(),
  ]);

  const id = await conversationBetween(alice, bob);
  await sendOk(alice, id, `Hi @${bob.user.username}, private question about the project`);
  await sendOk(bob, id, 'Sure, ask away');

  assert.equal(await Message.countDocuments(), messagesBefore, 'no project channel message');
  assert.equal(await Activity.countDocuments(), activityBefore, 'nothing in any Activity Feed');
  assert.equal(await Notification.countDocuments(), notificationsBefore, 'no @mention notification from a DM');
  const saved = await DirectMessage.findOne().lean();
  assert.equal('project' in saved, false);
  assert.equal('channel' in saved, false);
});

// --- Sending and reading ------------------------------------------------------------------------

test('sending: 201 with the saved message; the other person reads it, oldest first', async () => {
  const id = await conversationBetween(alice, bob);
  const res = await send(alice, id, '  Hello Bob!\nHow is the API going?  ');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.message.body, 'Hello Bob!\nHow is the API going?');
  assert.equal(res.body.message.conversation, id);
  assert.deepEqual(res.body.message.sender, { _id: alice.user.id, name: 'Alice Sender', username: alice.user.username, avatarUrl: '' });
  assert.equal(res.body.conversation.lastMessage.fromMe, true);
  assert.equal(res.body.conversation.unreadCount, 0);

  await sendOk(bob, id, 'Going well!');
  const read = await as(bob).get(`${BASE}/${id}/messages`);
  assert.equal(read.status, 200);
  assert.deepEqual(
    read.body.messages.map((m) => [m.sender.username, m.body]),
    [
      [alice.user.username, 'Hello Bob!\nHow is the API going?'],
      [bob.user.username, 'Going well!'],
    ]
  );
  assert.equal(read.body.nextBefore, null);
  assert.equal(JSON.stringify(read.body).includes(alice.email), false);
});

test('sending: empty, blank, too long or non-text messages are refused and nothing is saved (NFR-21)', async () => {
  const id = await conversationBetween(alice, bob);
  const cases = [
    [undefined, DM_MESSAGES.empty],
    ['', DM_MESSAGES.empty],
    ['   \n  ', DM_MESSAGES.empty],
    ['x'.repeat(DM_BODY_MAX + 1), DM_MESSAGES.tooLong],
    [42, DM_MESSAGES.notText],
    [{ $ne: '' }, DM_MESSAGES.notText],
    [['hi'], DM_MESSAGES.notText],
  ];
  for (const [body, message] of cases) {
    const res = await as(alice)
      .post(`${BASE}/${id}/messages`)
      .send(body === undefined ? {} : { body });
    assert.equal(res.status, 400, `body ${JSON.stringify(body)?.slice(0, 30)}`);
    assert.equal(res.body.message, message);
  }
  assert.equal(await DirectMessage.countDocuments(), 0);
  // Exactly the limit is fine.
  await sendOk(alice, id, 'y'.repeat(DM_BODY_MAX));
});

test('AC2: only the two participants can read or write a conversation; others get 404', async () => {
  const id = await conversationBetween(alice, bob);
  await sendOk(alice, id, 'Secret plan');

  const outsider = as(carol);
  const answers = await Promise.all([
    outsider.get(`${BASE}/${id}`),
    outsider.get(`${BASE}/${id}/messages`),
    outsider.post(`${BASE}/${id}/messages`).send({ body: 'let me in' }),
    outsider.post(`${BASE}/${id}/read`),
  ]);
  for (const res of answers) {
    assert.equal(res.status, 404);
    assert.equal(res.body.message, DM_MESSAGES.conversationNotFound);
    assert.equal(JSON.stringify(res.body).includes('Secret plan'), false);
  }
  // Same answer as a conversation that does not exist, so its existence is not revealed.
  const missing = await outsider.get(`${BASE}/64b000000000000000000009`);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.message, DM_MESSAGES.conversationNotFound);

  assert.equal(await DirectMessage.countDocuments(), 1, "the outsider's message was not saved");
  assert.equal((await inbox(carol)).conversations.length, 0);
  assert.equal((await inbox(carol)).unreadTotal, 0);
});

test('invalid conversation IDs are rejected with 400', async () => {
  for (const url of [`${BASE}/not-an-id`, `${BASE}/not-an-id/messages`, `${BASE}/123/read`]) {
    const res = url.endsWith('/read') ? await as(alice).post(url) : await as(alice).get(url);
    assert.equal(res.status, 400, url);
  }
});

test('reading history: pages of messages with "before", oldest first, nothing skipped or repeated', async () => {
  const id = await conversationBetween(alice, bob);
  for (let i = 1; i <= 7; i += 1) await sendOk(i % 2 ? alice : bob, id, `message ${i}`);

  const seen = [];
  let beforeId = null;
  for (let page = 0; page < 5; page += 1) {
    const url = `${BASE}/${id}/messages?limit=3${beforeId ? `&before=${beforeId}` : ''}`;
    const res = await as(bob).get(url);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    seen.unshift(...res.body.messages.map((m) => m.body));
    beforeId = res.body.nextBefore;
    if (!beforeId) break;
  }
  assert.deepEqual(seen, ['message 1', 'message 2', 'message 3', 'message 4', 'message 5', 'message 6', 'message 7']);

  assert.equal((await as(bob).get(`${BASE}/${id}/messages?before=nope`)).status, 400);
  // A message ID from another conversation is not a valid "before".
  const other = await conversationBetween(alice, dave);
  const foreign = await sendOk(alice, other, 'elsewhere');
  const res = await as(bob).get(`${BASE}/${id}/messages?before=${foreign._id}`);
  assert.equal(res.status, 400);
  assert.equal(res.body.message, DM_MESSAGES.invalidBefore);
});

// --- Inbox and unread counts ---------------------------------------------------------------------

test('inbox: an empty conversation only shows for the person who opened it; the first message shows it to the other', async () => {
  const id = await conversationBetween(alice, bob);
  assert.deepEqual(
    (await inbox(alice)).conversations.map((c) => c._id),
    [id]
  );
  assert.equal((await inbox(bob)).conversations.length, 0);

  await sendOk(alice, id, 'Are you free to pair on Friday?');
  const bobs = await inbox(bob);
  assert.equal(bobs.conversations.length, 1);
  assert.equal(bobs.conversations[0].otherUser.username, alice.user.username);
  assert.deepEqual(
    { preview: bobs.conversations[0].lastMessage.preview, fromMe: bobs.conversations[0].lastMessage.fromMe },
    { preview: 'Are you free to pair on Friday?', fromMe: false }
  );
  assert.equal(bobs.conversations[0].unreadCount, 1);
  assert.equal(bobs.unreadTotal, 1);
});

test("unread: counts the other person's new messages; reading clears them; my own never count", async () => {
  const withBob = await conversationBetween(alice, bob);
  const withDave = await conversationBetween(dave, bob);
  await sendOk(alice, withBob, 'one');
  await sendOk(alice, withBob, 'two');
  await sendOk(dave, withDave, 'hey Bob');

  assert.equal((await as(bob).get(`${BASE}/unread-count`)).body.unreadTotal, 3);
  assert.equal((await as(alice).get(`${BASE}/unread-count`)).body.unreadTotal, 0, 'own messages are not unread');
  assert.equal((await as(bob).get(`${BASE}/${withBob}`)).body.conversation.unreadCount, 2);

  const read = await as(bob).post(`${BASE}/${withBob}/read`);
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, { unreadCount: 0, unreadTotal: 1 });
  assert.equal((await as(bob).get(`${BASE}/${withBob}`)).body.conversation.unreadCount, 0);

  // A new message after reading counts again; replying marks the conversation read for the replier.
  await sendOk(alice, withBob, 'three');
  assert.equal((await as(bob).get(`${BASE}/unread-count`)).body.unreadTotal, 2);
  await sendOk(bob, withBob, 'replying');
  assert.equal((await as(bob).get(`${BASE}/unread-count`)).body.unreadTotal, 1);
  assert.equal((await as(alice).get(`${BASE}/unread-count`)).body.unreadTotal, 1);

  // Reading twice, or reading an empty conversation, is harmless.
  assert.equal((await as(bob).post(`${BASE}/${withBob}/read`)).status, 200);
  const empty = await conversationBetween(carol, bob);
  assert.deepEqual((await as(carol).post(`${BASE}/${empty}/read`)).body, { unreadCount: 0, unreadTotal: 0 });
});

test('inbox: newest activity first, with "fromMe" and a one-line preview', async () => {
  const withBob = await conversationBetween(alice, bob);
  const withCarol = await conversationBetween(alice, carol);
  const withDave = await conversationBetween(alice, dave);
  await sendOk(alice, withBob, 'first');
  await sendOk(carol, withCarol, 'second');
  await sendOk(dave, withDave, `third\n\nwith a very long line ${'x'.repeat(200)}`);
  await sendOk(bob, withBob, 'newest');

  const { conversations, unreadTotal } = await inbox(alice);
  assert.deepEqual(
    conversations.map((c) => c.otherUser.username),
    [bob.user.username, dave.user.username, carol.user.username]
  );
  assert.equal(conversations[0].lastMessage.preview, 'newest');
  assert.equal(conversations[0].lastMessage.fromMe, false);
  assert.ok(!conversations[1].lastMessage.preview.includes('\n'));
  assert.ok(conversations[1].lastMessage.preview.length <= 120);
  assert.equal(unreadTotal, 3);
});

// --- Spam guard ----------------------------------------------------------------------------------

test(`sending more than ${DM_SEND_LIMIT} messages in a minute gets 429 with Retry-After`, async () => {
  const id = await conversationBetween(alice, bob);
  for (let i = 0; i < DM_SEND_LIMIT; i += 1) await sendOk(alice, id, `msg ${i}`);
  const res = await send(alice, id, 'one too many');
  assert.equal(res.status, 429);
  assert.equal(res.body.message, DM_MESSAGES.tooFast);
  assert.ok(Number(res.headers['retry-after']) >= 1);
  assert.equal(await DirectMessage.countDocuments(), DM_SEND_LIMIT);
  // Only that sender is limited.
  await sendOk(bob, id, 'Bob can still reply');
});

test('a conversation whose other account was removed cannot get new messages (410)', async () => {
  const ghost = await signup(app, 'Gone Person');
  const id = await conversationBetween(alice, ghost);
  await sendOk(alice, id, 'before removal');
  await User.deleteOne({ _id: ghost.user.id });

  const res = await send(alice, id, 'anyone there?');
  assert.equal(res.status, 410);
  const view = await as(alice).get(`${BASE}/${id}`);
  assert.equal(view.status, 200);
  assert.equal(view.body.conversation.otherUser.name, 'Deleted user');
  const history = await as(alice).get(`${BASE}/${id}/messages`);
  assert.deepEqual(
    history.body.messages.map((m) => m.body),
    ['before removal']
  );
});
