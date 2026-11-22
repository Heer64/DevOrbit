// [Sprint 7 · M1] Edit and delete your own channel messages and thread replies.
// Edited ones show "edited", deleted ones "Message deleted" (so threads still make sense),
// other people's messages get 403, and changes reach every member live.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as connect } from 'socket.io-client';
import { setup, teardown, signup, authed } from './helpers.js';
import { initRealtime, closeRealtime } from '../src/lib/realtime.js';
import mongoose from 'mongoose';
import Message from '../src/models/Message.js';
import Activity from '../src/models/Activity.js';
import Notification from '../src/models/Notification.js';
import Project from '../src/models/Project.js';
import { loadCopilotRecords } from '../src/lib/copilotContext.js';

let app;
let server;
let baseUrl;
let owner, contributor, viewer, outsider;
let projectId;
let generalId;
let otherChannelId;
const sockets = [];

const as = (account) => authed(app, account.token);
const channels = () => `/api/projects/${projectId}/channels`;
const messages = (channelId = generalId) => `${channels()}/${channelId}/messages`;
const one = (messageId, channelId = generalId) => `${messages(channelId)}/${messageId}`;
const replies = (messageId, channelId = generalId) => `${messages(channelId)}/${messageId}/replies`;

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

async function post(account, body, channelId = generalId) {
  const res = await as(account).post(messages(channelId)).send({ body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.message;
}

async function reply(account, parentId, body) {
  const res = await as(account).post(replies(parentId)).send({ body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.reply;
}

before(async () => {
  ({ app } = await setup());
  server = http.createServer(app);
  initRealtime(server, { origins: ['http://localhost:5173'] });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  [owner, contributor, viewer, outsider] = await Promise.all(
    ['Edit Owner', 'Edit Contributor', 'Edit Viewer', 'Edit Outsider'].map((name) => signup(app, name))
  );
  const project = await as(owner).post('/api/projects').send({ name: 'Edit Project', visibility: 'Public' });
  projectId = project.body.project._id;
  for (const [account, role] of [[contributor, 'Contributor'], [viewer, 'Viewer']]) {
    const res = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
  generalId = (await as(owner).get(channels())).body.channels[0]._id;
  const created = await as(owner).post(channels()).send({ name: 'design' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  otherChannelId = created.body.channel._id;
});

after(async () => {
  sockets.forEach((socket) => socket.close());
  await closeRealtime();
  await teardown();
});

test('New messages are listed as not edited and not deleted', async () => {
  const message = await post(contributor, 'Fresh message');
  assert.equal(message.edited, false);
  assert.equal(message.deleted, false);
  const history = await as(viewer).get(messages());
  const row = history.body.messages.find((m) => m._id === message._id);
  assert.equal(row.edited, false);
  assert.equal(row.deleted, false);
  assert.equal(row.body, 'Fresh message');
});

test('The author edits their message: new text, marked "edited", in the channel history too', async () => {
  const message = await post(contributor, 'Standup at 10');
  const res = await as(contributor).patch(one(message._id)).send({ body: '  Standup at 11  ' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.changed, true);
  assert.equal(res.body.message.body, 'Standup at 11');
  assert.equal(res.body.message.edited, true);
  assert.ok(res.body.message.editedAt);
  assert.equal(res.body.message.author.name, 'Edit Contributor');

  const history = await as(viewer).get(messages());
  const row = history.body.messages.find((m) => m._id === message._id);
  assert.equal(row.body, 'Standup at 11');
  assert.equal(row.edited, true);
});

test('Saving the same text again is not an edit', async () => {
  const message = await post(contributor, 'No change here');
  const res = await as(contributor).patch(one(message._id)).send({ body: 'No change here' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.changed, false);
  assert.equal(res.body.message.edited, false);
});

test('An edit follows the same text rules as sending', async () => {
  const message = await post(contributor, 'Rules apply');
  assert.equal((await as(contributor).patch(one(message._id)).send({ body: '   ' })).status, 400);
  assert.equal((await as(contributor).patch(one(message._id)).send({})).status, 400);
  assert.equal((await as(contributor).patch(one(message._id)).send({ body: 42 })).status, 400);
  assert.equal((await as(contributor).patch(one(message._id)).send({ body: 'x'.repeat(4001) })).status, 400);
  const stored = await Message.findById(message._id).lean();
  assert.equal(stored.body, 'Rules apply');
  assert.equal(stored.editedAt ?? null, null);
});

test("Other people's messages get 403, the project Owner included", async () => {
  const message = await post(contributor, 'Mine, not yours');
  const ownerEdit = await as(owner).patch(one(message._id)).send({ body: 'Hijacked' });
  assert.equal(ownerEdit.status, 403);
  assert.equal(ownerEdit.body.code, 'not_author');
  assert.equal((await as(owner).delete(one(message._id))).status, 403);
  assert.equal((await as(viewer).patch(one(message._id)).send({ body: 'Nope' })).status, 403);
  assert.equal((await as(viewer).delete(one(message._id))).status, 403);

  const stored = await Message.findById(message._id).lean();
  assert.equal(stored.body, 'Mine, not yours');
  assert.equal(stored.deletedAt ?? null, null);
});

test('People outside the project cannot edit or delete anything', async () => {
  const message = await post(contributor, 'Members only');
  const edit = await as(outsider).patch(one(message._id)).send({ body: 'Outsider' });
  const remove = await as(outsider).delete(one(message._id));
  assert.equal(edit.status, 403);
  assert.equal(remove.status, 403);
  const anonymous = await authed(app, 'not-a-token').patch(one(message._id)).send({ body: 'x' });
  assert.equal(anonymous.status, 401);
});

test('Bad, unknown and wrong-channel message IDs are refused', async () => {
  assert.equal((await as(contributor).patch(one('not-an-id')).send({ body: 'x' })).status, 400);
  assert.equal((await as(contributor).delete(one('64b7f0c2a1b2c3d4e5f60789'))).status, 404);
  const message = await post(contributor, 'Lives in #general');
  // Same message, but the URL names #design: it is not a message of that channel.
  assert.equal((await as(contributor).patch(one(message._id, otherChannelId)).send({ body: 'x' })).status, 404);
  assert.equal((await as(contributor).delete(one(message._id, otherChannelId))).status, 404);
});

test('A Viewer cannot edit, but can still delete what they wrote before being made a Viewer', async () => {
  const old = await Message.create({ project: projectId, channel: generalId, author: viewer.user.id, body: 'Written as a Contributor' });
  const edit = await as(viewer).patch(one(old._id)).send({ body: 'Changed' });
  assert.equal(edit.status, 403);
  assert.equal(edit.body.code, 'viewer');
  const remove = await as(viewer).delete(one(old._id));
  assert.equal(remove.status, 200, JSON.stringify(remove.body));
  assert.equal(remove.body.message.deleted, true);
});

test('The author deletes a message: it stays in place as "Message deleted" and its text is gone', async () => {
  const message = await post(contributor, 'Oops, wrong channel');
  const res = await as(contributor).delete(one(message._id));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.changed, true);
  assert.equal(res.body.message.deleted, true);
  assert.equal(res.body.message.body, '');
  assert.equal(res.body.message.edited, false);
  assert.deepEqual(res.body.message.mentions, []);

  const history = await as(viewer).get(messages());
  const row = history.body.messages.find((m) => m._id === message._id);
  assert.ok(row, 'a deleted message is still listed, so the conversation keeps its order');
  assert.equal(row.deleted, true);
  assert.equal(row.body, '');

  const stored = await Message.findById(message._id).lean();
  assert.ok(stored.deletedAt);
  assert.equal(stored.body, '', 'the text is removed from the database');
});

test('A deleted message cannot be edited (409) and deleting again changes nothing', async () => {
  const message = await post(contributor, 'Short lived');
  assert.equal((await as(contributor).delete(one(message._id))).status, 200);
  const edit = await as(contributor).patch(one(message._id)).send({ body: 'Back again' });
  assert.equal(edit.status, 409);
  assert.equal(edit.body.code, 'message_deleted');
  const again = await as(contributor).delete(one(message._id));
  assert.equal(again.status, 200);
  assert.equal(again.body.changed, false);
  assert.equal(again.body.message.deleted, true);
  assert.equal((await Message.findById(message._id).lean()).body, '');
});

test('Thread replies can be edited and deleted by their author; the thread keeps making sense', async () => {
  const parent = await post(owner, 'Vite or Next?');
  const first = await reply(contributor, parent._id, 'Vite');
  const second = await reply(owner, parent._id, 'Agreed');

  const edited = await as(contributor).patch(one(first._id)).send({ body: 'Vite, it is lighter' });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.message.edited, true);
  assert.equal((await as(contributor).delete(one(second._id))).status, 403, 'not your reply');

  assert.equal((await as(owner).delete(one(second._id))).status, 200);

  const thread = await as(viewer).get(replies(parent._id));
  assert.equal(thread.status, 200);
  assert.deepEqual(thread.body.replies.map((r) => [r.body, r.edited, r.deleted]), [
    ['Vite, it is lighter', true, false],
    ['', false, true],
  ]);
  const history = await as(viewer).get(messages());
  assert.equal(history.body.messages.find((m) => m._id === parent._id).replyCount, 2, 'a deleted reply still holds its place');
});

test('Deleting the first message of a thread keeps its replies readable and open for new replies', async () => {
  const parent = await post(contributor, 'Thread starter');
  await reply(owner, parent._id, 'First answer');
  assert.equal((await as(contributor).delete(one(parent._id))).status, 200);

  const thread = await as(viewer).get(replies(parent._id));
  assert.equal(thread.status, 200);
  assert.equal(thread.body.parent.deleted, true);
  assert.equal(thread.body.parent.body, '');
  assert.deepEqual(thread.body.replies.map((r) => r.body), ['First answer']);

  const history = await as(viewer).get(messages());
  const row = history.body.messages.find((m) => m._id === parent._id);
  assert.equal(row.deleted, true);
  assert.equal(row.replyCount, 1);

  const late = await as(owner).post(replies(parent._id)).send({ body: 'Still here' });
  assert.equal(late.status, 201, JSON.stringify(late.body));
});

test('The Activity Feed follows edits, and never shows the text of a deleted message', async () => {
  const message = await post(contributor, 'Feed text one');
  await as(contributor).patch(one(message._id)).send({ body: 'Feed text two' });
  let entry = await Activity.findOne({ targetId: message._id, type: 'message.posted' }).lean();
  assert.equal(entry.summary, 'posted in #general: "Feed text two"');

  await as(contributor).delete(one(message._id));
  entry = await Activity.findOne({ targetId: message._id, type: 'message.posted' }).lean();
  assert.equal(entry.summary, 'posted in #general: (message deleted)');

  const parent = await post(owner, 'Feed parent');
  const answer = await reply(contributor, parent._id, 'Feed reply text');
  await as(contributor).delete(one(answer._id));
  entry = await Activity.findOne({ targetId: answer._id, type: 'message.posted' }).lean();
  assert.equal(entry.summary, 'replied in a thread in #general: (message deleted)');
});

test('Ask the Copilot never gets the text of a deleted message', async () => {
  const keep = await post(contributor, 'Copilot may read this');
  const gone = await post(contributor, 'Copilot must not read this secret');
  await as(contributor).delete(one(gone._id));
  const project = await Project.findById(projectId).lean();
  const { records } = await loadCopilotRecords(project);
  const text = JSON.stringify(records);
  assert.ok(text.includes('Copilot may read this'), String(keep._id));
  assert.ok(!text.includes('must not read this secret'));
});

test('An edit that adds an @mention notifies that member once', async () => {
  const message = await post(owner, 'Can someone review?');
  const count = () => Notification.countDocuments({ recipient: contributor.user.id, type: 'mention', targetId: message._id });
  assert.equal(await count(), 0);

  const edited = await as(owner).patch(one(message._id)).send({ body: `Can @${contributor.user.username} review?` });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.deepEqual(edited.body.message.mentions.map((user) => user.username), [contributor.user.username]);
  assert.equal(await count(), 1);

  await as(owner).patch(one(message._id)).send({ body: `Can @${contributor.user.username} review it today?` });
  assert.equal(await count(), 1, 'not notified twice for the same message');
});

test('Edits and deletes reach every member live, and nobody outside the project', async () => {
  const [ownerSocket, viewerSocket, outsiderSocket] = await Promise.all([open(owner.token), open(viewer.token), open(outsider.token)]);
  assert.equal((await join(ownerSocket, projectId)).ok, true);
  assert.equal((await join(viewerSocket, projectId)).ok, true);
  assert.equal((await join(outsiderSocket, projectId)).ok, false);

  const message = await post(contributor, 'Live before');
  const editSeen = Promise.all([nextEvent(ownerSocket, 'message:updated'), nextEvent(viewerSocket, 'message:updated')]);
  const outsiderQuiet = noEvent(outsiderSocket, 'message:updated');
  await as(contributor).patch(one(message._id)).send({ body: 'Live after' });
  const [toOwner, toViewer] = await editSeen;
  for (const payload of [toOwner, toViewer]) {
    assert.equal(payload.projectId, projectId);
    assert.equal(payload.channelId, generalId);
    assert.equal(payload.parentId, null);
    assert.equal(payload.message._id, message._id);
    assert.equal(payload.message.body, 'Live after');
    assert.equal(payload.message.edited, true);
  }
  await outsiderQuiet;

  const parent = await post(owner, 'Live thread');
  const answer = await reply(contributor, parent._id, 'Live reply');
  const deleteSeen = nextEvent(viewerSocket, 'message:updated');
  await as(contributor).delete(one(answer._id));
  const removed = await deleteSeen;
  assert.equal(removed.parentId, parent._id);
  assert.equal(removed.message._id, answer._id);
  assert.equal(removed.message.deleted, true);
  assert.equal(removed.message.body, '', 'the deleted text is not sent live either');
});

test('Messages saved before Sprint 7 still work and can be edited', async () => {
  const legacy = await Message.collection.insertOne({
    project: new mongoose.Types.ObjectId(projectId),
    channel: new mongoose.Types.ObjectId(generalId),
    author: new mongoose.Types.ObjectId(contributor.user.id),
    body: 'Legacy text',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const history = await as(viewer).get(messages());
  const row = history.body.messages.find((m) => String(m._id) === String(legacy.insertedId));
  assert.ok(row, 'legacy message is still listed');
  assert.equal(row.edited, false);
  assert.equal(row.deleted, false);
  const res = await as(contributor).patch(one(legacy.insertedId)).send({ body: 'Legacy text, edited' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.message.edited, true);
});
