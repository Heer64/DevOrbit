/*
 * [Sprint 6 · M6] Report rules for the browser (US-55 Report a public post, FR-27).
 * Same reasons, limits and words as backend/src/lib/reportRules.js. The server checks everything
 * again; these checks only give a quicker message before sending.
 */

export const REPORT_REASONS = Object.freeze([
  Object.freeze({ value: 'spam', label: 'Spam or misleading' }),
  Object.freeze({ value: 'harassment', label: 'Harassment or bullying' }),
  Object.freeze({ value: 'hate', label: 'Hate speech or symbols' }),
  Object.freeze({ value: 'violence', label: 'Violence or threats' }),
  Object.freeze({ value: 'explicit', label: 'Sexual or explicit content' }),
  Object.freeze({ value: 'other', label: 'Something else' }),
]);
export const REPORT_REASON_OTHER = 'other';
export const REPORT_DETAILS_MAX = 300;

export const REPORT_CREATED_MESSAGE = 'Thanks. Your report was sent to the moderators.';
export const REPORT_ALREADY_MESSAGE = 'You have already reported this post.';
export const REPORT_REASON_MESSAGE = 'Choose a reason for your report.';
export const REPORT_DETAILS_TOO_LONG_MESSAGE = `Report details must be ${REPORT_DETAILS_MAX} characters or fewer.`;
export const REPORT_DETAILS_REQUIRED_MESSAGE = 'Tell the moderators what is wrong with this post.';
export const REPORT_FAILED_MESSAGE = 'Your report could not be sent. Please try again.';

// Same counting as the server: Windows line endings count as one character, ends trimmed.
export function reportDetailsLength(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .trim().length;
}

// Returns an error message, or '' when the report can be sent.
export function checkReport({ reason, details = '' } = {}) {
  if (!REPORT_REASONS.some((item) => item.value === reason)) return REPORT_REASON_MESSAGE;
  const length = reportDetailsLength(details);
  if (length > REPORT_DETAILS_MAX) return REPORT_DETAILS_TOO_LONG_MESSAGE;
  if (reason === REPORT_REASON_OTHER && length === 0) return REPORT_DETAILS_REQUIRED_MESSAGE;
  return '';
}

// True when the server said this user already reported the post (409 already_reported, US-55 AC2).
export function isAlreadyReported(error) {
  return error?.status === 409;
}

// A readable message for a failed report request.
export function reportErrorMessage(error) {
  if (!error) return REPORT_FAILED_MESSAGE;
  if (isAlreadyReported(error)) return REPORT_ALREADY_MESSAGE;
  if (error.status === 404) return error.message || 'Post not found. It may have been deleted.';
  if (error.status === 400 && error.message) return error.message;
  if (error.status === 429) return error.message || 'Too many requests. Please wait a moment and try again.';
  return error.message && error.status && error.status < 500 ? error.message : REPORT_FAILED_MESSAGE;
}
