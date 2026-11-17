// [Sprint 6 · M7] US-56: moderation rules (no database needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_RESOLUTIONS,
  MODERATION_ACTIONS,
  MODERATION_MESSAGES,
  WARNING_LINK,
  isModerationAction,
  mainReasonLabel,
  moderationLogLine,
  postExcerpt,
  readListLimit,
  warningDedupeKey,
  warningSummary,
} from '../src/lib/moderationRules.js';
import { REPORT_RESOLUTIONS, summarizeReasons } from '../src/lib/reportRules.js';

test('three actions, each with its own stored resolution', () => {
  assert.deepEqual(MODERATION_ACTIONS, ['remove', 'warn', 'dismiss']);
  assert.deepEqual(ACTION_RESOLUTIONS, { remove: 'removed', warn: 'warned', dismiss: 'dismissed' });
  assert.deepEqual(REPORT_RESOLUTIONS, ['removed', 'warned', 'dismissed']);
  assert.equal(isModerationAction('warn'), true);
  for (const bad of ['Warn', 'delete', '', null, undefined, ['warn']]) assert.equal(isModerationAction(bad), false);
});

test('the 409 message is the agreed wording', () => {
  assert.equal(MODERATION_MESSAGES.alreadyHandled, 'This report was already handled.');
});

test('post excerpt: one line, cut at 60 characters with …', () => {
  assert.equal(postExcerpt('  Hello\n\nworld  '), 'Hello world');
  const long = postExcerpt('a'.repeat(100));
  assert.equal(long.length, 60);
  assert.ok(long.endsWith('…'));
  assert.equal(postExcerpt(null), '');
});

test('main reason = the most reported one', () => {
  const reasons = summarizeReasons(['spam', 'harassment', 'harassment']);
  assert.equal(mainReasonLabel(reasons), 'Harassment or bullying');
  assert.equal(mainReasonLabel([]), '');
});

test('warning text: quote of the post + main reason, no moderator name', () => {
  const text = warningSummary('Buy cheap followers now!!! click my link', summarizeReasons(['spam', 'spam', 'other']));
  assert.equal(text, 'A Content Moderator warned you about your post "Buy cheap followers now!!! click my link" (reason: Spam or misleading). Please follow the community rules.');
  assert.ok(text.length <= 300);
  assert.ok(warningSummary('x'.repeat(400), summarizeReasons(['hate'])).length <= 300);
  assert.equal(WARNING_LINK, '/feed');
});

test('one warning per post per round of reports', () => {
  assert.equal(warningDedupeKey('p1', 'r1'), 'moderation-warning:p1:r1');
  assert.notEqual(warningDedupeKey('p1', 'r1'), warningDedupeKey('p1', 'r9'));
});

test('server log line has the action and IDs only', () => {
  const line = moderationLogLine({ action: 'warn', postId: 'p1', moderatorId: 'm1', authorId: 'a1', reportCount: 3 });
  assert.equal(line, '[moderation] warn post=p1 moderator=m1 author=a1 reports=3');
  assert.equal(/@|token|password|cookie|Bearer/i.test(line), false);
});

test('list limits', () => {
  assert.equal(readListLimit(undefined, 50, 100), 50);
  assert.equal(readListLimit('0', 50, 100), 50);
  assert.equal(readListLimit('abc', 50, 100), 50);
  assert.equal(readListLimit('500', 50, 100), 100);
  assert.equal(readListLimit('7', 50, 100), 7);
});
