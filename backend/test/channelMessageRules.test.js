// [Sprint 7 · M1] Pure rules for editing and deleting channel messages (no database needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANNEL_DELETED_TEXT,
  CHANNEL_EDIT_MESSAGES,
  CHANNEL_MESSAGE_MAX,
  channelMessageView,
  isMessageAuthor,
  messageActivitySummary,
  readEditedBody,
} from '../src/lib/channelMessageRules.js';

const at = new Date('2026-11-22T10:00:00Z');

test('isMessageAuthor matches the author whether populated or a raw ID', () => {
  assert.equal(isMessageAuthor({ author: { _id: 'u1', name: 'Riya' } }, 'u1'), true);
  assert.equal(isMessageAuthor({ author: 'u1' }, 'u1'), true);
  assert.equal(isMessageAuthor({ author: 'u1' }, 'u2'), false);
  assert.equal(isMessageAuthor({ author: null }, 'u1'), false, 'a former member (author gone) matches nobody');
  assert.equal(isMessageAuthor({ author: 'u1' }, ''), false);
  assert.equal(isMessageAuthor(null, 'u1'), false);
});

test('readEditedBody trims and applies the sending rules', () => {
  assert.deepEqual(readEditedBody('  Hello  '), { ok: true, body: 'Hello' });
  assert.deepEqual(readEditedBody('   '), { ok: false, message: CHANNEL_EDIT_MESSAGES.empty });
  assert.deepEqual(readEditedBody(undefined), { ok: false, message: CHANNEL_EDIT_MESSAGES.empty });
  assert.deepEqual(readEditedBody(42), { ok: false, message: CHANNEL_EDIT_MESSAGES.empty });
  assert.deepEqual(readEditedBody({ body: 'x' }), { ok: false, message: CHANNEL_EDIT_MESSAGES.empty });
  assert.equal(readEditedBody('x'.repeat(CHANNEL_MESSAGE_MAX)).ok, true);
  assert.deepEqual(readEditedBody('x'.repeat(CHANNEL_MESSAGE_MAX + 1)), { ok: false, message: CHANNEL_EDIT_MESSAGES.tooLong });
});

test('channelMessageView keeps every old field and adds edited / deleted', () => {
  const plain = { _id: 'm1', body: 'Hi @riya', mentions: [{ _id: 'u2' }], replyCount: 2, author: { _id: 'u1' }, createdAt: at };
  const view = channelMessageView(plain);
  assert.equal(view.body, 'Hi @riya');
  assert.equal(view.replyCount, 2);
  assert.deepEqual(view.mentions, [{ _id: 'u2' }]);
  assert.equal(view.edited, false);
  assert.equal(view.deleted, false);
  assert.equal(view.editedAt, null);
  assert.equal(view.deletedAt, null);
  assert.equal(channelMessageView(null), null);
});

test('an edited message is marked edited', () => {
  const view = channelMessageView({ _id: 'm1', body: 'Changed', editedAt: at });
  assert.equal(view.edited, true);
  assert.equal(view.editedAt, at);
});

test('a deleted message never carries its text or mentions, and is not "edited"', () => {
  const view = channelMessageView({ _id: 'm1', body: 'secret', mentions: [{ _id: 'u2' }], editedAt: at, deletedAt: at, replyCount: 3 });
  assert.equal(view.deleted, true);
  assert.equal(view.body, '');
  assert.deepEqual(view.mentions, []);
  assert.equal(view.edited, false);
  assert.equal(view.editedAt, null);
  assert.equal(view.replyCount, 3, 'its thread is kept');
});

test('activity lines match the wording used when the message was posted', () => {
  assert.equal(messageActivitySummary({ channelName: 'general', quotedText: '"New text"' }), 'posted in #general: "New text"');
  assert.equal(
    messageActivitySummary({ channelName: 'design', isReply: true, quotedText: '"Reply"' }),
    'replied in a thread in #design: "Reply"'
  );
  assert.equal(messageActivitySummary({ channelName: 'general' }), 'posted in #general: (message deleted)');
  assert.equal(CHANNEL_DELETED_TEXT, 'Message deleted');
});

test('a Decision linked to a deleted message shows "Message deleted", not the old text', async () => {
  const { decisionLinkView } = await import('../src/lib/decisions.js');
  const decision = { project: 'p1', relatedMessage: 'm1', relatedChannel: 'c1' };
  const channels = new Map([['c1', { _id: 'c1', name: 'general' }]]);
  const live = decisionLinkView(decision, { messages: new Map([['m1', { _id: 'm1', body: 'Use Vite' }]]), channels });
  assert.equal(live.label, '#general: Use Vite');
  const gone = decisionLinkView(decision, { messages: new Map([['m1', { _id: 'm1', body: '', deletedAt: at }]]), channels });
  assert.equal(gone.label, '#general: Message deleted');
  assert.equal(gone.missing, false, 'the thread still exists, so the link still opens it');
});
