// [Sprint 3 · M4] US-18: @mentions in channel messages and threads store the mention and send a Mention notification.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, signup, authed } from './helpers.js';
import Notification from '../src/models/Notification.js';

let app;
let alice, bob, outsider;
let projectId;
let generalId;

const as = (account) => authed(app, account.token);
const channels = () => `/api/projects/${projectId}/channels`;
const messages = () => `${channels()}/${generalId}/messages`;
const replies = (messageId) => `${messages()}/${messageId}/replies`;
const mentionsOf = (account) => Notification.find({ recipient: account.user.id, type: 'mention' }).sort({ createdAt: 1 }).lean();

before(async () => {
  ({ app } = await setup());
  await Notification.init();

  [alice, bob, outsider] = await Promise.all(['Alice Mention', 'Bob Mention', 'Olly Outsider'].map((name) => signup(app, name)));
  const project = await as(alice).post('/api/projects').send({ name: 'Mention Project' });
  projectId = project.body.project._id;
  const added = await as(alice).post(`/api/projects/${projectId}/members`).send({ identifier: bob.user.username, role: 'Viewer' });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  generalId = (await as(alice).get(channels())).body.channels[0]._id;
});

after(teardown);

test('US-18: mentioning a member in a channel message stores the mention and notifies them with a link to the message', async () => {
  const sent = await as(alice).post(messages()).send({ body: `@${bob.user.username} hello` });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.deepEqual(sent.body.message.mentions.map((user) => user.username), [bob.user.username]);

  const rows = await mentionsOf(bob);
  const note = rows.find((row) => String(row.targetId) === String(sent.body.message._id));
  assert.ok(note, 'Bob got a Mention notification');
  assert.equal(note.targetType, 'message');
  assert.equal(note.summary, 'mentioned you in #general');
  assert.equal(note.targetLabel, '#general');
  assert.equal(note.link, `/project/${projectId}?tab=chat&channel=${generalId}&message=${sent.body.message._id}`);

  // The channel history returns the mentions so the chat can highlight them.
  const history = await as(bob).get(messages());
  const row = history.body.messages.find((m) => m._id === sent.body.message._id);
  assert.deepEqual(row.mentions.map((user) => user.username), [bob.user.username]);
});

test('US-18: a mention inside a thread links to the channel with that thread open', async () => {
  const parent = await as(alice).post(messages()).send({ body: 'Thread start' });
  const sent = await as(alice).post(replies(parent.body.message._id)).send({ body: `cc @${bob.user.username}` });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.deepEqual(sent.body.reply.mentions.map((user) => user.username), [bob.user.username]);

  const note = (await mentionsOf(bob)).find((row) => String(row.targetId) === String(sent.body.reply._id));
  assert.ok(note);
  assert.equal(note.summary, 'mentioned you in a thread in #general');
  assert.match(note.link, new RegExp(`message=${parent.body.message._id}&thread=${parent.body.message._id}$`));
});

test('Mentions of non-members, unknown names and yourself notify nobody', async () => {
  const before = (await Notification.countDocuments({ type: 'mention' }));
  const sent = await as(alice).post(messages()).send({ body: `@${outsider.user.username} @nobody_here @${alice.user.username}` });
  assert.equal(sent.status, 201);
  assert.deepEqual(sent.body.message.mentions.map((user) => user.username), [alice.user.username]);
  assert.equal(await Notification.countDocuments({ type: 'mention' }), before);
});
