// [Sprint 6 · M6] US-55 report rules (no database needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_DETAILS_MAX,
  REPORT_DETAILS_REQUIRED_MESSAGE,
  REPORT_DETAILS_TOO_LONG_MESSAGE,
  REPORT_DETAILS_TYPE_MESSAGE,
  REPORT_REASONS,
  REPORT_REASON_MESSAGE,
  REPORT_REASON_VALUES,
  REPORT_STATUSES,
  REPORT_STATUS_OPEN,
  isReportReason,
  normalizeReportDetails,
  readReport,
  reportReasonLabel,
  reportView,
  summarizeReasons,
} from '../src/lib/reportRules.js';

test('the reasons are a fixed list with a label each, and "other" is last', () => {
  assert.deepEqual(REPORT_REASON_VALUES, ['spam', 'harassment', 'hate', 'violence', 'explicit', 'other']);
  for (const reason of REPORT_REASONS) assert.ok(reason.label.length > 0, reason.value);
  assert.equal(reportReasonLabel('spam'), 'Spam or misleading');
  assert.equal(reportReasonLabel('other'), 'Something else');
  assert.equal(reportReasonLabel('made-up'), 'made-up');
  assert.ok(Object.isFrozen(REPORT_REASONS));
  assert.deepEqual(REPORT_STATUSES, ['open', 'resolved']);
  assert.equal(REPORT_DETAILS_MAX, 300);
});

test('only the exact reason values are accepted (NFR-21)', () => {
  for (const value of REPORT_REASON_VALUES) assert.equal(isReportReason(value), true, value);
  for (const value of ['SPAM', ' spam', 'spam ', '', 'abuse', null, undefined, 1, ['spam'], { value: 'spam' }]) {
    assert.equal(isReportReason(value), false, JSON.stringify(value));
    assert.deepEqual(readReport({ reason: value }), { ok: false, field: 'reason', message: REPORT_REASON_MESSAGE });
  }
  assert.deepEqual(readReport(undefined), { ok: false, field: 'reason', message: REPORT_REASON_MESSAGE });
  assert.deepEqual(readReport(null), { ok: false, field: 'reason', message: REPORT_REASON_MESSAGE });
});

test('a reason alone is enough (details optional), and details are cleaned', () => {
  assert.deepEqual(readReport({ reason: 'spam' }), { ok: true, reason: 'spam', details: '' });
  assert.deepEqual(readReport({ reason: 'spam', details: null }), { ok: true, reason: 'spam', details: '' });
  assert.deepEqual(readReport({ reason: 'spam', details: '' }), { ok: true, reason: 'spam', details: '' });
  assert.deepEqual(readReport({ reason: 'hate', details: '  Slur in line 2\r\nsee image \u0007 ' }), {
    ok: true,
    reason: 'hate',
    details: 'Slur in line 2\nsee image',
  });
  assert.equal(normalizeReportDetails('\u0000a\tb\r c '), 'a\tb\n c');
});

test('details: text only, at most 300 characters, required for "Something else"', () => {
  assert.deepEqual(readReport({ reason: 'spam', details: 42 }), { ok: false, field: 'details', message: REPORT_DETAILS_TYPE_MESSAGE });
  assert.deepEqual(readReport({ reason: 'spam', details: ['x'] }), { ok: false, field: 'details', message: REPORT_DETAILS_TYPE_MESSAGE });

  assert.equal(readReport({ reason: 'spam', details: 'x'.repeat(300) }).ok, true);
  assert.equal(readReport({ reason: 'spam', details: `  ${'x'.repeat(300)}  ` }).ok, true, 'spaces at the ends do not count');
  assert.deepEqual(readReport({ reason: 'spam', details: 'x'.repeat(301) }), {
    ok: false,
    field: 'details',
    message: REPORT_DETAILS_TOO_LONG_MESSAGE,
  });

  for (const details of [undefined, '', '    ', '\n\n']) {
    assert.deepEqual(readReport({ reason: 'other', details }), { ok: false, field: 'details', message: REPORT_DETAILS_REQUIRED_MESSAGE });
  }
  assert.deepEqual(readReport({ reason: 'other', details: 'Copied my project' }), {
    ok: true,
    reason: 'other',
    details: 'Copied my project',
  });
});

test('reportView: the reporter sees their own report, never other reporters', () => {
  const view = reportView({
    _id: 'r1',
    post: 'p1',
    reporter: 'u9',
    reason: 'violence',
    details: '',
    status: REPORT_STATUS_OPEN,
    createdAt: '2026-11-13T10:00:00.000Z',
  });
  assert.deepEqual(view, {
    _id: 'r1',
    post: 'p1',
    reason: 'violence',
    reasonLabel: 'Violence or threats',
    details: '',
    status: 'open',
    createdAt: '2026-11-13T10:00:00.000Z',
  });
  assert.equal('reporter' in view, false);
  assert.equal(reportView(null), null);
  assert.equal(reportView({ _id: 'r2', post: { _id: 'p2' }, reason: 'spam' }).post, 'p2');
});

test('summarizeReasons: counts per reason for the moderator queue, most frequent first', () => {
  assert.deepEqual(summarizeReasons([]), []);
  assert.deepEqual(summarizeReasons(['hate', 'spam', 'spam', 'other', 'hate', 'spam']), [
    { reason: 'spam', label: 'Spam or misleading', count: 3 },
    { reason: 'hate', label: 'Hate speech or symbols', count: 2 },
    { reason: 'other', label: 'Something else', count: 1 },
  ]);
  // Equal counts keep the order of the reason list.
  assert.deepEqual(
    summarizeReasons(['other', 'violence', 'spam']).map((item) => item.reason),
    ['spam', 'violence', 'other']
  );
});
