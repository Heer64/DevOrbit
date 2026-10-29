// [Sprint 3 · M8] US-35/US-36: decision field rules (no database needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DECISION_DATE_FORMAT_MESSAGE,
  DECISION_DATE_INVALID_MESSAGE,
  DECISION_DATE_RANGE_MESSAGE,
  DECISION_DATE_REQUIRED_MESSAGE,
  DECISION_DESCRIPTION_MAX,
  DECISION_TITLE_MAX,
  decisionLinkView,
  parseDecisionDate,
  readDecisionInput,
  readDecisionLink,
  readParticipants,
} from '../src/lib/decisions.js';

const A = 'a'.repeat(24);
const B = 'b'.repeat(24);
const valid = { title: 'Use PostgreSQL?', description: 'We chose MongoDB for flexible task fields.', participants: [A], date: '2026-10-20' };

test('a complete body is accepted, trimmed, and the date is midnight UTC', () => {
  const result = readDecisionInput({ ...valid, title: '  Pick MongoDB  ' });
  assert.equal(result.ok, true);
  assert.equal(result.values.title, 'Pick MongoDB');
  assert.equal(result.values.date.toISOString(), '2026-10-20T00:00:00.000Z');
  assert.deepEqual(result.values.participants, [A]);
  assert.equal('link' in result.values, false);
});

test('each required field missing on create is refused with its own message', () => {
  for (const [key, message] of [
    ['title', 'Title is required.'],
    ['description', 'Description is required.'],
    ['participants', 'Add at least one participant.'],
    ['date', DECISION_DATE_REQUIRED_MESSAGE],
  ]) {
    const body = { ...valid };
    delete body[key];
    assert.deepEqual(readDecisionInput(body), { ok: false, message }, key);
  }
});

test('blank text, too-long text and an empty participant list are refused', () => {
  assert.equal(readDecisionInput({ ...valid, title: '   ' }).message, 'Title is required.');
  assert.equal(readDecisionInput({ ...valid, description: '\n\t ' }).message, 'Description is required.');
  assert.match(readDecisionInput({ ...valid, title: 'x'.repeat(DECISION_TITLE_MAX + 1) }).message, /120 characters or fewer/);
  assert.match(readDecisionInput({ ...valid, description: 'x'.repeat(DECISION_DESCRIPTION_MAX + 1) }).message, /2,000 characters or fewer/);
  assert.equal(readDecisionInput({ ...valid, participants: [] }).message, 'Add at least one participant.');
  assert.equal(readDecisionInput({ ...valid, title: 42 }).message, 'Title must be text.');
});

test('participants: duplicates removed, bad IDs refused, not a list refused', () => {
  assert.deepEqual(readParticipants([A, B, A.toUpperCase(), ` ${B} `]), { valid: true, value: [A, B] });
  assert.equal(readParticipants(['nope']).message, 'Invalid participant ID.');
  assert.equal(readParticipants(A).message, 'Participants must be a list of project members.');
});

test('decision date uses the due-date rules with decision wording', () => {
  assert.equal(parseDecisionDate('').message, DECISION_DATE_REQUIRED_MESSAGE);
  assert.equal(parseDecisionDate(null).message, DECISION_DATE_REQUIRED_MESSAGE);
  assert.equal(parseDecisionDate('2026-02-30').message, DECISION_DATE_INVALID_MESSAGE);
  assert.equal(parseDecisionDate('20/10/2026').message, DECISION_DATE_FORMAT_MESSAGE);
  assert.equal(parseDecisionDate('2026-10-20T10:00:00+05:30').message, DECISION_DATE_FORMAT_MESSAGE);
  assert.equal(parseDecisionDate('1999-12-31').message, DECISION_DATE_RANGE_MESSAGE);
  assert.equal(parseDecisionDate(20261020).message, DECISION_DATE_INVALID_MESSAGE);
  assert.equal(parseDecisionDate('2028-02-29').value.toISOString(), '2028-02-29T00:00:00.000Z');
  // A date read back from the API can be sent again unchanged.
  assert.equal(parseDecisionDate('2026-10-20T00:00:00.000Z').valid, true);
});

test('edit (partial): only sent fields are read, but sent fields must be valid', () => {
  assert.deepEqual(readDecisionInput({ title: 'New title' }, { partial: true }), { ok: true, values: { title: 'New title' } });
  assert.deepEqual(readDecisionInput({}, { partial: true }), { ok: true, values: {} });
  assert.equal(readDecisionInput({ title: '' }, { partial: true }).message, 'Title is required.');
  assert.equal(readDecisionInput({ date: '' }, { partial: true }).message, DECISION_DATE_REQUIRED_MESSAGE);
  assert.equal(readDecisionInput({ participants: [] }, { partial: true }).message, 'Add at least one participant.');
});

test('link: task or thread, null clears it, anything else is refused', () => {
  assert.deepEqual(readDecisionLink(null), { valid: true, value: null });
  assert.deepEqual(readDecisionLink({ type: 'Task', id: A }), { valid: true, value: { type: 'task', id: A } });
  assert.deepEqual(readDecisionLink({ type: 'thread', id: B }), { valid: true, value: { type: 'thread', id: B } });
  assert.equal(readDecisionLink({ type: 'file', id: A }).valid, false);
  assert.equal(readDecisionLink({ type: 'task', id: '123' }).message, 'Invalid task ID.');
  assert.equal(readDecisionLink('task').valid, false);
  assert.deepEqual(readDecisionInput({ ...valid, link: { type: 'task', id: A } }).values.link, { type: 'task', id: A });
  assert.equal(readDecisionInput({ ...valid, link: { type: 'x' } }).ok, false);
});

test('link view: working task and thread links, and deleted targets marked missing', () => {
  const P = 'c'.repeat(24);
  const T = 'd'.repeat(24);
  const M = 'e'.repeat(24);
  const C = 'f'.repeat(24);
  const targets = {
    tasks: new Map([[T, { _id: T, title: 'Login page' }]]),
    messages: new Map([[M, { _id: M, body: 'Should we use Vite or Next?' }]]),
    channels: new Map([[C, { _id: C, name: 'general' }]]),
  };

  assert.equal(decisionLinkView({ project: P }, targets), null);
  assert.deepEqual(decisionLinkView({ project: P, relatedTask: T }, targets), {
    type: 'task', id: T, label: 'Login page', href: `/project/${P}?tab=tasks&task=${T}`, missing: false,
  });
  assert.deepEqual(decisionLinkView({ project: P, relatedMessage: M, relatedChannel: C }, targets), {
    type: 'thread', id: M, channelId: C, label: '#general: Should we use Vite or Next?',
    href: `/project/${P}?tab=chat&channel=${C}&message=${M}&thread=${M}`, missing: false,
  });
  assert.deepEqual(decisionLinkView({ project: P, relatedTask: T }, {}), { type: 'task', id: T, label: '', href: null, missing: true });
  assert.equal(decisionLinkView({ project: P, relatedMessage: M, relatedChannel: C }, { messages: targets.messages }).missing, true);
});
