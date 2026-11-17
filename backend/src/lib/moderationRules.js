/*
 * [Sprint 6 · M7] US-56 Moderate reported posts (FR-27, NFR-19, NFR-22). Rules with no database imports, so they
 * are tested on their own (backend/test/moderationRules.test.js); routes/moderation.js and lib/moderation.js use them.
 *
 * A Content Moderator (or a Platform Admin) reviews a reported post in the moderator queue and chooses ONE action:
 *   remove   the post is deleted (same clean-up as when its author deletes it: image and votes go too)
 *   warn     the post stays; its author gets an in-app "Moderation warning" notification
 *   dismiss  nothing changes on the post; the reports are closed
 * Each action marks every open report of that post "resolved", with who resolved it, when and how.
 *
 * Own post: a moderator may Remove or Dismiss reports on their own post (they could delete it anyway). Warn is
 * allowed too, but no notification is sent to yourself (nothing to tell); the response says notified: false.
 *
 * Words (NFR-27): "Content Moderator", "report", "reason", "Remove", "Warn", "Dismiss", "Moderation warning".
 */
import {
  REPORT_RESOLUTION_DISMISSED,
  REPORT_RESOLUTION_REMOVED,
  REPORT_RESOLUTION_WARNED,
  reportReasonLabel,
} from './reportRules.js';

export const MODERATION_ACTION_REMOVE = 'remove';
export const MODERATION_ACTION_WARN = 'warn';
export const MODERATION_ACTION_DISMISS = 'dismiss';
export const MODERATION_ACTIONS = Object.freeze([MODERATION_ACTION_REMOVE, MODERATION_ACTION_WARN, MODERATION_ACTION_DISMISS]);

// Action -> the resolution stored on every report it closes.
export const ACTION_RESOLUTIONS = Object.freeze({
  [MODERATION_ACTION_REMOVE]: REPORT_RESOLUTION_REMOVED,
  [MODERATION_ACTION_WARN]: REPORT_RESOLUTION_WARNED,
  [MODERATION_ACTION_DISMISS]: REPORT_RESOLUTION_DISMISSED,
});

export const MODERATION_MESSAGES = Object.freeze({
  removed: 'Post removed. Its reports are resolved.',
  warned: 'Warning sent to the author. Its reports are resolved.',
  warnedSelf: 'This is your own post, so no warning was sent. Its reports are resolved.',
  dismissed: 'Reports dismissed. The post was not changed.',
  invalidId: 'Invalid post ID.',
  noOpenReports: 'This post has no open reports.',
  alreadyHandled: 'This report was already handled.',
  unknownAction: 'Choose Remove, Warn or Dismiss.',
});

// How long a "moderation in progress" lock may live if the server stops mid-action (normally it lasts milliseconds).
export const MODERATION_LOCK_SECONDS = 60;

export const QUEUE_DEFAULT = 50;
export const QUEUE_MAX = 100;
export const ACTIONS_DEFAULT = 20;
export const ACTIONS_MAX = 50;
export const NOTES_PER_POST = 5; // reporters' "details" shown per post (never who wrote them)
export const EXCERPT_MAX = 60;

export function isModerationAction(value) {
  return typeof value === 'string' && MODERATION_ACTIONS.includes(value);
}

// A list size from the query string: a whole number between 1 and max, otherwise the default.
export function readListLimit(raw, fallback, max) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(value, max);
}

// First characters of the post text on one line, for the warning and the moderation log ("…" when cut).
export function postExcerpt(text, max = EXCERPT_MAX) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

// The reason most users chose (ties: the order of the reason list, as summarizeReasons sorts them).
// `reasons` is the summarizeReasons() shape: [{ reason, label, count }] sorted by count.
export function mainReasonLabel(reasons = []) {
  const top = Array.isArray(reasons) && reasons.length ? reasons[0] : null;
  return top ? top.label || reportReasonLabel(top.reason) : '';
}

/*
 * Text of the warning notification. There is no actor on purpose: the author is told that "a Content Moderator"
 * warned them, not which one (the moderator's name is in the moderation log for moderators and admins).
 */
export function warningSummary(postText, reasons = []) {
  const reason = mainReasonLabel(reasons);
  const excerpt = postExcerpt(postText);
  const quoted = excerpt ? ` "${excerpt}"` : '';
  return `A Content Moderator warned you about your post${quoted}${reason ? ` (reason: ${reason})` : ''}. Please follow the community rules.`;
}

// Where the warning opens: the public feed (posts have no page of their own).
export const WARNING_LINK = '/feed';

// One warning per post per round of reports: the oldest open report of the round names the round.
export function warningDedupeKey(postId, firstReportId) {
  return `moderation-warning:${postId}:${firstReportId}`;
}

// The single line written to the server log for each outcome: IDs and the action only. No tokens, cookies,
// emails, passwords, request bodies or post text (NFR-22: log outcomes without exposing secrets).
export function moderationLogLine({ action, postId, moderatorId, authorId, reportCount }) {
  return `[moderation] ${action} post=${postId} moderator=${moderatorId} author=${authorId || 'unknown'} reports=${reportCount}`;
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 6 · M7] What this file does
 * The moderator's three actions (Remove, Warn, Dismiss), the report resolution each one stores, the messages
 * shown to the moderator, the text of the in-app warning, and the secret-free server log line.
 * ---------------------------------------------------------------------------
 */
