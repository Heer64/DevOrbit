/*
 * [Sprint 5 · M8] US-54 Follow users and see public counts (FR-26, NFR-26, NFR-27).
 * Rules with no database imports (tested in backend/test/followRules.test.js).
 *
 *   - Any logged-in user can follow any other existing user whose profile they can open
 *     (M3, US-06: profiles open from a direct link for every logged-in user; turning off
 *     "appear in collaborator search" only hides someone from search, not from following).
 *   - Nobody can follow themselves.
 *   - Following twice is not an error and never counts twice; unfollowing someone you do not follow
 *     is not an error either (both answer with the current state).
 *   - The profile shows the follower count and the "total vote score": the sum of the net scores
 *     (upvotes - downvotes) of all the user's public posts. Never "likes" (NFR-27).
 */

export const FOLLOW_SELF_MESSAGE = 'You cannot follow yourself.';
export const FOLLOWED_MESSAGE = 'You are now following';
export const UNFOLLOWED_MESSAGE = 'You unfollowed';
export const ALREADY_FOLLOWING_MESSAGE = 'You already follow';
export const NOT_FOLLOWING_MESSAGE = 'You do not follow';

export function isSelfFollow(followerId, followingId) {
  return followerId !== undefined && followerId !== null && String(followerId) === String(followingId);
}

// The message for a follow/unfollow answer, e.g. "You are now following Bob Builder."
export function followMessage({ following, changed }, name) {
  const who = name || 'this user';
  if (following) return `${changed ? FOLLOWED_MESSAGE : ALREADY_FOLLOWING_MESSAGE} ${who}.`;
  return `${changed ? UNFOLLOWED_MESSAGE : NOT_FOLLOWING_MESSAGE} ${who}.`;
}

// A count from the database: a whole number >= 0.
export function safeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

// The sum of net scores; can be negative. Anything that is not a number counts as 0.
export function safeScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 5 · M8] What this file does
 * The follow rules: no following yourself, following twice or unfollowing twice is
 * harmless, and the words used in answers ("follow", "total vote score", never "likes").
 * ---------------------------------------------------------------------------
 */
