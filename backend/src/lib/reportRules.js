/*
 * [Sprint 6 · M6] Report rules (US-55 Report a public post; FR-27, NFR-21, NFR-26).
 *
 * No database imports, so these rules are tested on their own (backend/test/reportRules.test.js)
 * and the route, the tests, the README and the frontend (frontend/src/reports.js) use the same values.
 *
 * A report is
 *   reason    required, exactly one of REPORT_REASONS[].value
 *   details   optional text, up to 300 characters after trimming (line breaks kept);
 *             REQUIRED when the reason is "other", so the moderator knows what is wrong
 *   status    "open" when created. The moderator queue (US-56) shows open reports and marks them
 *             "resolved" after Remove, Warn or Dismiss.
 *
 * Rules
 *   One report per user per post (US-55 AC2). A second one is refused with
 *   "You have already reported this post." (409). The unique index on PostReport { post, reporter }
 *   makes this true even when the same report is sent twice at the same moment.
 *   A user cannot report their own post (it is theirs to edit or delete, US-51).
 *
 * Words (NFR-27): always "report", "reason", "moderator". The report count is only shown to moderators.
 */

export const REPORT_REASONS = Object.freeze([
  Object.freeze({ value: 'spam', label: 'Spam or misleading' }),
  Object.freeze({ value: 'harassment', label: 'Harassment or bullying' }),
  Object.freeze({ value: 'hate', label: 'Hate speech or symbols' }),
  Object.freeze({ value: 'violence', label: 'Violence or threats' }),
  Object.freeze({ value: 'explicit', label: 'Sexual or explicit content' }),
  Object.freeze({ value: 'other', label: 'Something else' }),
]);
export const REPORT_REASON_VALUES = Object.freeze(REPORT_REASONS.map((reason) => reason.value));
export const REPORT_REASON_OTHER = 'other';

export const REPORT_DETAILS_MAX = 300;

export const REPORT_STATUS_OPEN = 'open';
export const REPORT_STATUS_RESOLVED = 'resolved';
export const REPORT_STATUSES = Object.freeze([REPORT_STATUS_OPEN, REPORT_STATUS_RESOLVED]);

export const REPORT_CREATED_MESSAGE = 'Thanks. Your report was sent to the moderators.';
export const REPORT_ALREADY_MESSAGE = 'You have already reported this post.';
export const REPORT_REASON_MESSAGE = 'Choose a reason for your report.';
export const REPORT_DETAILS_TYPE_MESSAGE = 'Report details must be text.';
export const REPORT_DETAILS_TOO_LONG_MESSAGE = `Report details must be ${REPORT_DETAILS_MAX} characters or fewer.`;
export const REPORT_DETAILS_REQUIRED_MESSAGE = 'Tell the moderators what is wrong with this post.';
export const REPORT_OWN_POST_MESSAGE = 'You cannot report your own post. You can edit or delete it instead.';

// Control characters other than tab and line break are removed (same cleaning as post text).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function normalizeReportDetails(text) {
  return String(text).replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').trim();
}

export function isReportReason(value) {
  return typeof value === 'string' && REPORT_REASON_VALUES.includes(value);
}

// "spam" -> "Spam or misleading". Unknown values come back unchanged.
export function reportReasonLabel(value) {
  return REPORT_REASONS.find((reason) => reason.value === value)?.label || String(value || '');
}

/*
 * Reads { reason, details } as sent by the client (NFR-21: checked on the server before storing).
 * Only the exact reason values are accepted (no "SPAM", no " spam", no arrays).
 * Returns { ok: true, reason, details } or { ok: false, message, field }.
 */
export function readReport(body) {
  const reason = body?.reason;
  if (!isReportReason(reason)) return { ok: false, field: 'reason', message: REPORT_REASON_MESSAGE };

  const raw = body?.details;
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    return { ok: false, field: 'details', message: REPORT_DETAILS_TYPE_MESSAGE };
  }
  const details = raw ? normalizeReportDetails(raw) : '';
  if (details.length > REPORT_DETAILS_MAX) return { ok: false, field: 'details', message: REPORT_DETAILS_TOO_LONG_MESSAGE };
  if (reason === REPORT_REASON_OTHER && !details) {
    return { ok: false, field: 'details', message: REPORT_DETAILS_REQUIRED_MESSAGE };
  }
  return { ok: true, reason, details };
}

/*
 * API shape of one report, as its reporter sees it. The reporter's own id is not repeated
 * and no other reporter's data is ever included.
 *   { _id, post, reason, reasonLabel, details, status, createdAt }
 */
export function reportView(report) {
  if (!report) return null;
  return {
    _id: String(report._id),
    post: String(report.post?._id || report.post),
    reason: report.reason,
    reasonLabel: reportReasonLabel(report.reason),
    details: report.details || '',
    status: report.status || REPORT_STATUS_OPEN,
    createdAt: report.createdAt,
  };
}

/*
 * For the moderator queue (US-56): ["spam", "spam", "hate"] ->
 *   [{ reason: 'spam', label: 'Spam or misleading', count: 2 }, { reason: 'hate', label: 'Hate speech or symbols', count: 1 }]
 * Most frequent first; equal counts keep the order of REPORT_REASONS.
 */
export function summarizeReasons(reasons = []) {
  const counts = new Map();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) || 0) + 1);
  const order = (value) => {
    const index = REPORT_REASON_VALUES.indexOf(value);
    return index === -1 ? REPORT_REASON_VALUES.length : index;
  };
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, label: reportReasonLabel(reason), count }))
    .sort((a, b) => b.count - a.count || order(a.reason) - order(b.reason));
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 6 · M6] What this file does
 * The rules for reporting a public post: the fixed list of reasons, optional details
 * (up to 300 characters, required for "Something else"), one report per user per post,
 * the words shown to the user, and the shape of a report in the API.
 * ---------------------------------------------------------------------------
 */
