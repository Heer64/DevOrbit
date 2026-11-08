/*
 * [Sprint 5 · M7] Vote rules (US-52 Vote on a post; FR-24, NFR-13, NFR-14, NFR-16, NFR-27).
 *
 * No database imports, so these rules are tested on their own (backend/test/voteRules.test.js)
 * and the route, the vote engine, the tests and the README all use the same numbers.
 *
 * A vote is one of
 *    1   upvote
 *   -1   downvote
 *    0   no vote (used to retract)
 *
 * FR-24: at most ONE active vote per user per post. The user may change it (up <-> down)
 * or retract it. A post's score = upvotes - downvotes.
 * US-52 AC2: voting the same way again changes nothing (the score stays the same).
 * NFR-16: at most 30 vote requests per user in any rolling minute.
 * NFR-27: always "votes" and "score", never "likes".
 */

export const VOTE_UP = 1;
export const VOTE_DOWN = -1;
export const VOTE_NONE = 0;
export const VOTE_VALUES = Object.freeze([VOTE_UP, VOTE_DOWN, VOTE_NONE]);

export const VOTES_PER_MINUTE = 30;
export const VOTE_WINDOW_MS = 60 * 1000; // one minute

export const VOTE_VALUE_MESSAGE = 'Send "value": 1 to upvote, -1 to downvote or 0 to remove your vote.';
export const VOTE_CAST_MESSAGE = 'Your vote was counted.';
export const VOTE_CHANGED_MESSAGE = 'Your vote was changed.';
export const VOTE_RETRACTED_MESSAGE = 'Your vote was removed.';
export const VOTE_UNCHANGED_MESSAGE = 'You already voted this way, so the score did not change.';
export const VOTE_NOTHING_TO_RETRACT_MESSAGE = 'You have not voted on this post.';
export const VOTE_BUSY_MESSAGE = 'Your vote could not be saved right now. Please try again.';

/*
 * Reads the "value" the client sent. Only the JSON numbers 1, -1 and 0 are accepted
 * (no strings, no 2, no 0.5), so a crafted request cannot add more than one point.
 * Returns { ok: true, value } or { ok: false, message }.
 */
export function readVoteValue(raw) {
  if (typeof raw !== 'number' || !VOTE_VALUES.includes(raw)) return { ok: false, message: VOTE_VALUE_MESSAGE };
  // -0 is a number that equals 0; store it as plain 0.
  return { ok: true, value: raw === 0 ? VOTE_NONE : raw };
}

/*
 * How the post's counters change when one user's vote goes from `previous` to `next`.
 * Always returns the three fields, so score = upvotes - downvotes stays true after every $inc.
 *   none -> up     { upvotes: +1, downvotes:  0, score: +1 }
 *   up   -> down   { upvotes: -1, downvotes: +1, score: -2 }
 *   down -> none   { upvotes:  0, downvotes: -1, score: +1 }
 *   same -> same   all 0
 */
export function voteDelta(previous, next) {
  const up = (next === VOTE_UP ? 1 : 0) - (previous === VOTE_UP ? 1 : 0);
  const down = (next === VOTE_DOWN ? 1 : 0) - (previous === VOTE_DOWN ? 1 : 0);
  return { upvotes: up, downvotes: down, score: up - down };
}

export function isEmptyDelta(delta) {
  return !delta.upvotes && !delta.downvotes && !delta.score;
}

// What happened, as a word the client can use: cast | changed | retracted | unchanged.
export function voteOutcome(previous, next) {
  if (previous === next) return 'unchanged';
  if (previous === VOTE_NONE) return 'cast';
  if (next === VOTE_NONE) return 'retracted';
  return 'changed';
}

export function voteMessage(outcome, next = VOTE_NONE) {
  if (outcome === 'cast') return VOTE_CAST_MESSAGE;
  if (outcome === 'changed') return VOTE_CHANGED_MESSAGE;
  if (outcome === 'retracted') return VOTE_RETRACTED_MESSAGE;
  return next === VOTE_NONE ? VOTE_NOTHING_TO_RETRACT_MESSAGE : VOTE_UNCHANGED_MESSAGE;
}

/*
 * Rate limit (NFR-16). `recent` is how many vote requests the user made in the last minute
 * (including this one), `oldest` the time of the oldest of those. Returns null when the
 * request is allowed, otherwise { retryAfterSeconds, message }.
 */
export function voteRateLimit(recent, oldest, now = Date.now()) {
  if (recent <= VOTES_PER_MINUTE) return null;
  const oldestMs = oldest ? new Date(oldest).getTime() : now;
  const retryAfterSeconds = Math.max(1, Math.ceil((oldestMs + VOTE_WINDOW_MS - now) / 1000));
  return { retryAfterSeconds, message: voteRateLimitMessage(retryAfterSeconds) };
}

export function voteRateLimitMessage(retryAfterSeconds) {
  const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
  const wait = seconds === 1 ? '1 second' : `${seconds} seconds`;
  return `You can vote up to ${VOTES_PER_MINUTE} times per minute. Please try again in ${wait}.`;
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 5 · M7] What this file does
 * The rules for voting on a public post: the allowed values (1, -1, 0), how a vote
 * change moves upvotes / downvotes / score, the words shown to the user, and the
 * limit of 30 votes per user per minute.
 * ---------------------------------------------------------------------------
 */
