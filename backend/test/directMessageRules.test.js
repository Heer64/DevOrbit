// [Sprint 6 · M2] US-19 Direct messages: rules that need no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DM_BODY_MAX,
  DM_MESSAGES,
  DM_PAGE_DEFAULT,
  DM_PAGE_MAX,
  DM_PREVIEW_MAX,
  DM_SEND_LIMIT,
  conversationView,
  createSendLimiter,
  isParticipant,
  mayHaveUnread,
  messageView,
  otherParticipant,
  pairKeyOf,
  previewOf,
  readAtFor,
  readBody,
  readLimit,
  userView,
} from '../src/lib/directMessageRules.js';

const A = '64b000000000000000000001';
const B = '64b000000000000000000002';
const C = '64b000000000000000000003';
const alice = { _id: A, name: 'Alice', username: 'alice', avatarUrl: '/uploads/avatars/a.png', email: 'alice@example.com' };
const bob = { _id: B, name: 'Bob', username: 'bob', avatarUrl: '' };

test('pairKeyOf: the same key whoever opens the conversation', () => {
  assert.equal(pairKeyOf(A, B), `${A}:${B}`);
  assert.equal(pairKeyOf(B, A), `${A}:${B}`);
  assert.equal(pairKeyOf({ _id: B }, A), `${A}:${B}`);
  assert.notEqual(pairKeyOf(A, B), pairKeyOf(A, C));
});

test('readBody: text of 1 to 4,000 characters, trimmed, line breaks kept (NFR-21)', () => {
  assert.deepEqual(readBody('  Hi Bob  '), { ok: true, body: 'Hi Bob' });
  assert.deepEqual(readBody('line one\r\nline two\n'), { ok: true, body: 'line one\nline two' });
  assert.deepEqual(readBody('x'.repeat(DM_BODY_MAX)), { ok: true, body: 'x'.repeat(DM_BODY_MAX) });
  assert.deepEqual(readBody('x'.repeat(DM_BODY_MAX + 1)), { ok: false, message: DM_MESSAGES.tooLong });
  assert.deepEqual(readBody(''), { ok: false, message: DM_MESSAGES.empty });
  assert.deepEqual(readBody('   \n\t '), { ok: false, message: DM_MESSAGES.empty });
  assert.deepEqual(readBody(undefined), { ok: false, message: DM_MESSAGES.empty });
  assert.deepEqual(readBody(null), { ok: false, message: DM_MESSAGES.empty });
  for (const bad of [42, true, ['hi'], { text: 'hi' }]) assert.deepEqual(readBody(bad), { ok: false, message: DM_MESSAGES.notText });
  assert.match(DM_MESSAGES.tooLong, /4,000/);
});

test('previewOf: one line, at most 120 characters', () => {
  assert.equal(previewOf('Hello\n\n   there'), 'Hello there');
  const long = previewOf('word '.repeat(100));
  assert.equal(long.length, DM_PREVIEW_MAX);
  assert.ok(long.endsWith('…'));
  assert.equal(previewOf(''), '');
});

test('readLimit: default 50, between 1 and 100', () => {
  assert.equal(readLimit(undefined), DM_PAGE_DEFAULT);
  assert.equal(readLimit('abc'), DM_PAGE_DEFAULT);
  assert.equal(readLimit('0'), DM_PAGE_DEFAULT);
  assert.equal(readLimit('-5'), DM_PAGE_DEFAULT);
  assert.equal(readLimit('7'), 7);
  assert.equal(readLimit('1000'), DM_PAGE_MAX);
});

test('participants: the other person and membership checks', () => {
  const conversation = { participants: [alice, bob] };
  assert.equal(otherParticipant(conversation, A), bob);
  assert.equal(otherParticipant(conversation, B), alice);
  assert.equal(otherParticipant({ participants: [A, B] }, A), B);
  assert.equal(otherParticipant({ participants: [alice] }, A), null); // the other account is gone
  assert.equal(isParticipant(conversation, A), true);
  assert.equal(isParticipant(conversation, C), false);
  assert.equal(isParticipant(conversation, ''), false);
});

test('readAtFor / mayHaveUnread: works with a Map (document) and a plain object (lean)', () => {
  const t1 = new Date('2026-11-11T10:00:00Z');
  const t2 = new Date('2026-11-11T10:05:00Z');
  const lean = { lastMessageAt: t2, reads: { [A]: t1, [B]: t2 } };
  const doc = { lastMessageAt: t2, reads: new Map([[A, t1]]) };
  assert.equal(readAtFor(lean, A).getTime(), t1.getTime());
  assert.equal(readAtFor(doc, A).getTime(), t1.getTime());
  assert.equal(readAtFor(doc, B), null);
  assert.equal(readAtFor({}, A), null);
  assert.equal(mayHaveUnread(lean, A), true); // read up to t1, newest message at t2
  assert.equal(mayHaveUnread(lean, B), false); // read up to the newest message
  assert.equal(mayHaveUnread(doc, B), true); // never read
  assert.equal(mayHaveUnread({ lastMessageAt: null, reads: {} }, A), false); // no messages yet
});

test('userView: only name, username and photo; a missing user is "Deleted user"', () => {
  assert.deepEqual(userView(alice), { _id: A, name: 'Alice', username: 'alice', avatarUrl: '/uploads/avatars/a.png' });
  assert.equal('email' in userView(alice), false);
  assert.deepEqual(userView(null), { _id: null, name: 'Deleted user', username: '', avatarUrl: '' });
  assert.deepEqual(userView(A), { _id: null, name: 'Deleted user', username: '', avatarUrl: '' }); // not populated
});

test('messageView: safe sender fields only', () => {
  const at = new Date();
  const view = messageView({ _id: 'm1', conversation: 'c1', sender: alice, body: 'Hi', createdAt: at, extra: 'x' });
  assert.deepEqual(view, {
    _id: 'm1',
    conversation: 'c1',
    sender: { _id: A, name: 'Alice', username: 'alice', avatarUrl: '/uploads/avatars/a.png' },
    body: 'Hi',
    createdAt: at,
  });
});

test('conversationView: each participant sees the other person and their own unread count', () => {
  const at = new Date('2026-11-11T10:00:00Z');
  const conversation = {
    _id: 'c1',
    participants: [alice, bob],
    lastMessageAt: at,
    lastMessagePreview: 'Hi Bob',
    lastMessageSender: A,
    activityAt: at,
    createdAt: at,
    reads: { [A]: at },
    pairKey: `${A}:${B}`,
  };
  const forAlice = conversationView(conversation, A, 0);
  const forBob = conversationView(conversation, B, 3);
  assert.equal(forAlice.otherUser.username, 'bob');
  assert.equal(forBob.otherUser.username, 'alice');
  assert.deepEqual(forAlice.lastMessage, { preview: 'Hi Bob', at, fromMe: true });
  assert.deepEqual(forBob.lastMessage, { preview: 'Hi Bob', at, fromMe: false });
  assert.equal(forBob.unreadCount, 3);
  // Internal fields are never sent.
  for (const key of ['pairKey', 'reads', 'participants', 'openedBy']) assert.equal(key in forBob, false);
  assert.equal(conversationView({ ...conversation, lastMessageAt: null }, A).lastMessage, null);
  assert.equal(conversationView(conversation, B, -2).unreadCount, 0);
  assert.equal(conversationView(conversation, B, 'x').unreadCount, 0);
});

test('createSendLimiter: 30 messages per minute per user, then a wait time', () => {
  let now = 1_000_000;
  const limiter = createSendLimiter({ now: () => now });
  for (let i = 0; i < DM_SEND_LIMIT; i += 1) assert.equal(limiter.take(A).ok, true);
  const blocked = limiter.take(A);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfterSeconds, 60);
  assert.equal(limiter.take(B).ok, true, 'another user is not affected');

  now += 30_000;
  assert.equal(limiter.take(A).retryAfterSeconds, 30);
  now += 30_000; // the first message is now a minute old
  assert.equal(limiter.take(A).ok, true);

  limiter.reset();
  assert.equal(limiter.size, 0);
});
