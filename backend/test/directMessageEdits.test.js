// [Sprint 7 · M2] Edit and delete your own direct messages, and Sent / Seen, against a real MongoDB.
// - Edit: own messages only (403 for the other person), "edited" mark, same text rules as sending.
// - Delete: own messages only (403), the message stays as "Message deleted" with its text removed.
// - Sent / Seen: my own messages are 'sent' until the other person opens the conversation, then 'seen';
//   the read time is stored, so it survives reloads.
// Live delivery of these changes is in directMessageEditsRealtime.test.js.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { setup, teardown, signup, authed } from './helpers.js';
import DirectConversation from '../src/models/DirectConversation.js';
import DirectMessage from '../src/models/DirectMessage.js';
import { DM_BODY_MAX, DM_MESSAGES } from '../src/lib/directMessageRules.js';
import { dmSendLimiter } from '../src/routes/directMessages.js';

const BASE = '/api/direct-messages';
let app;
let alice, bob, carol;

const as = (account) => authed(app, account.token);
const messageUrl = (conversationId, messageId) => `${BASE}/${conversationId}/messages/${messageId}`;
const edit = (who, conversationId, messageId, body) => as(who).patch(messageUrl(conversationId, messageId)).send({ body });
const remove = (who, conversationId, messageId) => as(who).delete(messageUrl(conversationId, messageId));

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
async function page(who, conversationId) {
  const res = await as(who).get(`${BASE}/${conversationId}/messages`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}
async function inboxRow(who, conversationId) {
  const res = await as(who).get(BASE);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.conversations.find((row) => row._id === conversationId);
}
const unreadTotal = async (who) => (await as(who).get(`${BASE}/unread-count`)).body.unreadTotal;
const pause = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

before(async () => {
  ({ app } = await setup());
  [alice, bob, carol] = await Promise.all(['Alice Editor', 'Bob Reader', 'Carol Outsider'].map((name) => signup(app, name)));
});

beforeEach(async () => {
  await Promise.all([DirectConversation.deleteMany({}), DirectMessage.deleteMany({})]);
  dmSendLimiter.reset();
});

after(teardown);

// --- Login -----------------------------------------------------------------------------------------

test('[Sprint 7 · M2] login is required to edit or delete a message', async () => {
  const url = messageUrl('64b000000000000000000001', '64b000000000000000000002');
  assert.equal((await request(app).patch(url).send({ body: 'x' })).status, 401);
  assert.equal((await request(app).delete(url)).status, 401);
});

// --- Edit ------------------------------------------------------------------------------------------

test('[Sprint 7 · M2] the sender edits a message: saved, marked "edited", and the other person sees the new text', async () => {
  const id = await conversationBetween(alice, bob);
  const sent = await sendOk(alice, id, 'See you at 4');
  assert.equal(sent.edited, false);
  assert.equal(sent.deleted, false);

  const res = await edit(alice, id, sent._id, '  See you at 5  ');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.changed, true);
  assert.equal(res.body.notice, DM_MESSAGES.edited);
  assert.equal(res.body.message._id, sent._id);
  assert.equal(res.body.message.body, 'See you at 5', 'trimmed like a new message');
  assert.equal(res.body.message.edited, true);
  assert.ok(res.body.message.editedAt);
  assert.equal(res.body.message.createdAt, sent.createdAt, 'the time it was sent does not change');

  // Stored in the database.
  const saved = await DirectMessage.findById(sent._id).lean();
  assert.equal(saved.body, 'See you at 5');
  assert.ok(saved.editedAt instanceof Date);
  assert.equal(saved.deletedAt, null);

  // Bob sees the new text and the "edited" mark after a reload; still one message.
  const forBob = await page(bob, id);
  assert.equal(forBob.messages.length, 1);
  assert.equal(forBob.messages[0].body, 'See you at 5');
  assert.equal(forBob.messages[0].edited, true);
});

test('[Sprint 7 · M2] saving the same text again is not an edit', async () => {
  const id = await conversationBetween(alice, bob);
  const sent = await sendOk(alice, id, 'No change');
  const res = await edit(alice, id, sent._id, 'No change');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.changed, false);
  assert.equal(res.body.message.edited, false);
  assert.equal((await DirectMessage.findById(sent._id).lean()).editedAt, null);
});

test('[Sprint 7 · M2] an edit follows the same text rules as sending (NFR-21); a refused edit changes nothing', async () => {
  const id = await conversationBetween(alice, bob);
  const sent = await sendOk(alice, id, 'Original');
  const cases = [
    [undefined, DM_MESSAGES.empty],
    ['   ', DM_MESSAGES.empty],
    [{ $set: 'x' }, DM_MESSAGES.notText],
    [42, DM_MESSAGES.notText],
    ['x'.repeat(DM_BODY_MAX + 1), DM_MESSAGES.tooLong],
  ];
  for (const [body, message] of cases) {
    const res = await as(alice)
      .patch(messageUrl(id, sent._id))
      .send(body === undefined ? {} : { body });
    assert.equal(res.status, 400, `${JSON.stringify(body)?.slice(0, 30)} -> ${res.status}`);
    assert.equal(res.body.message, message);
  }
  assert.equal((await edit(alice, id, sent._id, 'x'.repeat(DM_BODY_MAX))).status, 200, 'exactly 4,000 characters is fine');
  const saved = await DirectMessage.findById(sent._id).lean();
  assert.equal(saved.body.length, DM_BODY_MAX);
});

test("[Sprint 7 · M2] editing or deleting the other person's message is refused with 403 and changes nothing", async () => {
  const id = await conversationBetween(alice, bob);
  const fromAlice = await sendOk(alice, id, 'Only Alice may change this');

  const editByBob = await edit(bob, id, fromAlice._id, 'Bob was here');
  assert.equal(editByBob.status, 403);
  assert.equal(editByBob.body.message, DM_MESSAGES.notSender);
  assert.equal(editByBob.body.code, 'not_sender');

  const deleteByBob = await remove(bob, id, fromAlice._id);
  assert.equal(deleteByBob.status, 403);
  assert.equal(deleteByBob.body.message, DM_MESSAGES.notSender);

  const saved = await DirectMessage.findById(fromAlice._id).lean();
  assert.equal(saved.body, 'Only Alice may change this');
  assert.equal(saved.editedAt, null);
  assert.equal(saved.deletedAt, null);
});

test('[Sprint 7 · M2] someone outside the conversation gets 404 (its existence is not revealed); bad and unknown IDs', async () => {
  const id = await conversationBetween(alice, bob);
  const sent = await sendOk(alice, id, 'Private');

  assert.equal((await edit(carol, id, sent._id, 'Carol')).status, 404);
  assert.equal((await remove(carol, id, sent._id)).status, 404);

  const badId = await edit(alice, id, 'not-an-id', 'x');
  assert.equal(badId.status, 400);
  assert.equal(badId.body.message, DM_MESSAGES.invalidMessage);
  assert.equal((await remove(alice, id, 'not-an-id')).status, 400);

  const unknown = await edit(alice, id, '64b0000000000000000000ff', 'x');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.message, DM_MESSAGES.messageNotFound);
  assert.equal((await remove(alice, id, '64b0000000000000000000ff')).status, 404);

  // A message of another conversation cannot be reached through this one.
  const other = await conversationBetween(alice, carol);
  const elsewhere = await sendOk(alice, other, 'To Carol');
  assert.equal((await edit(alice, id, elsewhere._id, 'moved?')).status, 404);
  assert.equal((await remove(alice, id, elsewhere._id)).status, 404);
  assert.equal((await DirectMessage.findById(elsewhere._id).lean()).body, 'To Carol');
  assert.equal((await DirectMessage.findById(sent._id).lean()).body, 'Private');
});

// --- Delete ----------------------------------------------------------------------------------------

test('[Sprint 7 · M2] delete: the message stays in place as "Message deleted", its text is removed', async () => {
  const id = await conversationBetween(alice, bob);
  const first = await sendOk(alice, id, 'one');
  await pause(5);
  const second = await sendOk(alice, id, 'two (oops)');
  await pause(5);
  const third = await sendOk(bob, id, 'three');

  const res = await remove(alice, id, second._id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.changed, true);
  assert.equal(res.body.notice, DM_MESSAGES.deleted);
  assert.equal(res.body.message.deleted, true);
  assert.equal(res.body.message.body, '');
  assert.ok(res.body.message.deletedAt);

  const saved = await DirectMessage.findById(second._id).lean();
  assert.ok(saved, 'the row is kept so the conversation still reads in order');
  assert.equal(saved.body, '', 'the text is removed from the database');
  assert.ok(saved.deletedAt instanceof Date);

  for (const who of [alice, bob]) {
    const { messages } = await page(who, id);
    assert.deepEqual(
      messages.map((message) => message._id),
      [first._id, second._id, third._id],
      'same messages, same order'
    );
    assert.deepEqual(
      messages.map((message) => [message.body, message.deleted]),
      [
        ['one', false],
        ['', true],
        ['three', false],
      ]
    );
    assert.equal(JSON.stringify(messages).includes('oops'), false, 'the deleted text is never sent');
  }
});

test('[Sprint 7 · M2] deleting twice changes nothing; a deleted message can no longer be edited (409)', async () => {
  const id = await conversationBetween(alice, bob);
  const sent = await sendOk(alice, id, 'temporary');
  assert.equal((await remove(alice, id, sent._id)).status, 200);
  const deletedAt = (await DirectMessage.findById(sent._id).lean()).deletedAt;

  const again = await remove(alice, id, sent._id);
  assert.equal(again.status, 200);
  assert.equal(again.body.changed, false);
  assert.equal(again.body.notice, DM_MESSAGES.alreadyDeleted);
  assert.equal(again.body.message.deleted, true);
  assert.equal((await DirectMessage.findById(sent._id).lean()).deletedAt.getTime(), deletedAt.getTime());

  const editDeleted = await edit(alice, id, sent._id, 'back again');
  assert.equal(editDeleted.status, 409);
  assert.equal(editDeleted.body.code, 'message_deleted');
  assert.equal(editDeleted.body.message, DM_MESSAGES.editDeleted);
  assert.equal((await DirectMessage.findById(sent._id).lean()).body, '');

  // Bob still gets 403, not 409, for Alice's deleted message.
  assert.equal((await edit(bob, id, sent._id, 'x')).status, 403);
});

test('[Sprint 7 · M2] an edited message that is then deleted is shown only as deleted', async () => {
  const id = await conversationBetween(alice, bob);
  const sent = await sendOk(alice, id, 'draft');
  assert.equal((await edit(alice, id, sent._id, 'draft v2')).status, 200);
  const res = await remove(alice, id, sent._id);
  assert.equal(res.body.message.deleted, true);
  assert.equal(res.body.message.edited, false);
  assert.equal(res.body.message.body, '');
});

test('[Sprint 7 · M2] an edit and a delete at the same moment never bring the text back', async () => {
  const id = await conversationBetween(alice, bob);
  const sent = await sendOk(alice, id, 'race');
  const results = await Promise.all([edit(alice, id, sent._id, 'race edited'), remove(alice, id, sent._id)]);
  assert.ok(
    results.every((res) => [200, 409].includes(res.status)),
    results.map((res) => res.status).join(',')
  );
  const saved = await DirectMessage.findById(sent._id).lean();
  assert.ok(saved.deletedAt, 'the delete always wins');
  assert.equal(saved.body, '');
});

// --- Inbox line and unread counts ------------------------------------------------------------------

test('[Sprint 7 · M2] the inbox line follows the newest message: edited text, or "Message deleted"', async () => {
  const id = await conversationBetween(alice, bob);
  const older = await sendOk(alice, id, 'older');
  await pause(5);
  const newest = await sendOk(alice, id, 'newest');

  await edit(alice, id, older._id, 'older, edited');
  assert.equal((await inboxRow(bob, id)).lastMessage.preview, 'newest', 'editing an older message leaves the inbox line alone');

  await edit(alice, id, newest._id, 'newest, edited');
  assert.equal((await inboxRow(bob, id)).lastMessage.preview, 'newest, edited');
  assert.equal((await inboxRow(alice, id)).lastMessage.preview, 'newest, edited');

  const before = await DirectConversation.findById(id).lean();
  await remove(alice, id, newest._id);
  const bobRow = await inboxRow(bob, id);
  assert.equal(bobRow.lastMessage.preview, 'Message deleted');
  assert.equal(bobRow.lastMessage.fromMe, false);
  const after = await DirectConversation.findById(id).lean();
  assert.equal(after.activityAt.getTime(), before.activityAt.getTime(), 'edits and deletes do not move the conversation up');
});

test('[Sprint 7 · M2] deleting a message the other person had not read yet removes it from their unread count', async () => {
  const id = await conversationBetween(alice, bob);
  const first = await sendOk(alice, id, 'unread one');
  await sendOk(alice, id, 'unread two');
  assert.equal(await unreadTotal(bob), 2);
  assert.equal((await inboxRow(bob, id)).unreadCount, 2);

  await remove(alice, id, first._id);
  assert.equal(await unreadTotal(bob), 1);
  assert.equal((await inboxRow(bob, id)).unreadCount, 1);

  await edit(alice, id, (await page(alice, id)).messages[1]._id, 'unread two, edited');
  assert.equal(await unreadTotal(bob), 1, 'an edit does not change the unread count');
});

// --- Sent / Seen -----------------------------------------------------------------------------------

test('[Sprint 7 · M2] my messages are "sent" until the other person opens the conversation, then "seen" (saved)', async () => {
  const id = await conversationBetween(alice, bob);
  const one = await sendOk(alice, id, 'first');
  assert.equal(one.status, 'sent', 'the send answer already says "sent"');
  await pause(5);
  await sendOk(alice, id, 'second');

  let forAlice = await page(alice, id);
  assert.deepEqual(
    forAlice.messages.map((message) => message.status),
    ['sent', 'sent']
  );
  assert.equal(forAlice.otherReadAt, null);
  assert.equal((await as(alice).get(`${BASE}/${id}`)).body.conversation.otherReadAt, null);

  // Bob only loading the page does not count as seen; opening it (the browser then calls /read) does.
  const forBob = await page(bob, id);
  assert.deepEqual(
    forBob.messages.map((message) => message.status),
    [null, null],
    "no status on the other person's messages"
  );
  assert.deepEqual(
    (await page(alice, id)).messages.map((message) => message.status),
    ['sent', 'sent']
  );

  const read = await as(bob).post(`${BASE}/${id}/read`);
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.deepEqual(read.body, { unreadCount: 0, unreadTotal: 0 }, 'same answer as before Sprint 7');

  // Persisted: Bob's read time is saved in the conversation document...
  const stored = await DirectConversation.findById(id).lean();
  const bobReadAt = new Date(stored.reads[bob.user.id]).getTime();
  assert.ok(bobReadAt >= new Date(one.createdAt).getTime());

  // ...so after a reload Alice sees both messages as "seen", and when Bob read.
  forAlice = await page(alice, id);
  assert.deepEqual(
    forAlice.messages.map((message) => message.status),
    ['seen', 'seen']
  );
  assert.equal(new Date(forAlice.otherReadAt).getTime(), bobReadAt);
  assert.equal(new Date((await as(alice).get(`${BASE}/${id}`)).body.conversation.otherReadAt).getTime(), bobReadAt);

  // A newer message is "sent" again until Bob opens the conversation again.
  await pause(5);
  await sendOk(alice, id, 'third');
  assert.deepEqual(
    (await page(alice, id)).messages.map((message) => message.status),
    ['seen', 'seen', 'sent']
  );
});

test('[Sprint 7 · M2] replying counts as having seen the conversation; reads never move backwards', async () => {
  const id = await conversationBetween(alice, bob);
  await sendOk(alice, id, 'question?');
  await pause(5);
  await sendOk(bob, id, 'answer!');
  assert.deepEqual(
    (await page(alice, id)).messages.map((message) => [message.body, message.status]),
    [
      ['question?', 'seen'],
      ['answer!', null],
    ]
  );
  // Bob's own message is "sent" for him until Alice opens it.
  assert.deepEqual(
    (await page(bob, id)).messages.map((message) => message.status),
    [null, 'sent']
  );
  await as(alice).post(`${BASE}/${id}/read`);
  assert.deepEqual(
    (await page(bob, id)).messages.map((message) => message.status),
    [null, 'seen']
  );

  // Marking read again (e.g. a slow second tab) never turns a message back to "sent".
  const before = (await DirectConversation.findById(id).lean()).reads[alice.user.id];
  await as(alice).post(`${BASE}/${id}/read`);
  const after = (await DirectConversation.findById(id).lean()).reads[alice.user.id];
  assert.ok(new Date(after).getTime() >= new Date(before).getTime());
});

test('[Sprint 7 · M2] editing keeps the Seen status; a deleted message has no status', async () => {
  const id = await conversationBetween(alice, bob);
  const sent = await sendOk(alice, id, 'seen soon');
  await as(bob).post(`${BASE}/${id}/read`);
  const edited = await edit(alice, id, sent._id, 'seen soon (edited)');
  assert.equal(edited.body.message.status, 'seen', 'it was seen before the edit, so it stays "seen"');
  const deleted = await remove(alice, id, sent._id);
  assert.equal(deleted.body.message.deleted, true);
});

// --- Messages saved before Sprint 7 -----------------------------------------------------------------

test('[Sprint 7 · M2] messages saved before Sprint 7 (no editedAt / deletedAt) still load, count and can be edited', async () => {
  const id = await conversationBetween(alice, bob);
  const at = new Date();
  // Written straight to the collection, exactly like a Sprint 6 message (no new fields at all).
  const { insertedId } = await DirectMessage.collection.insertOne({
    conversation: new mongoose.Types.ObjectId(id),
    sender: new mongoose.Types.ObjectId(alice.user.id),
    body: 'from Sprint 6',
    createdAt: at,
  });
  await DirectConversation.updateOne(
    { _id: id },
    { $set: { lastMessageAt: at, lastMessagePreview: 'from Sprint 6', lastMessageSender: alice.user.id, activityAt: at } }
  );

  const [old] = (await page(bob, id)).messages;
  assert.equal(old.body, 'from Sprint 6');
  assert.equal(old.edited, false);
  assert.equal(old.deleted, false);
  assert.equal(await unreadTotal(bob), 1, 'an old message still counts as unread');

  const res = await edit(alice, id, String(insertedId), 'from Sprint 6, edited in Sprint 7');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.message.edited, true);
  assert.equal((await inboxRow(bob, id)).lastMessage.preview, 'from Sprint 6, edited in Sprint 7');
});
