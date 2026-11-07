/*
 * [Sprint 5 · M7] Vote helpers for the browser (US-52 Vote on a post; FR-24, NFR-16, NFR-27).
 * Same numbers and words as backend/src/lib/voteRules.js. The server decides the real score;
 * these helpers only let the card show the new score at once, before the server answers.
 */

export const VOTE_UP = 1;
export const VOTE_DOWN = -1;
export const VOTE_NONE = 0;
export const VOTES_PER_MINUTE = 30;

/*
 * What a click means. Clicking the arrow that is already on removes the vote (retract);
 * clicking the other arrow changes the vote; with no vote yet it casts one.
 */
export function nextVote(current, clicked) {
  return current === clicked ? VOTE_NONE : clicked;
}

// The post's counters after the viewer's vote goes from post.myVote to `next`.
export function withVote(post, next) {
  const previous = post.myVote || VOTE_NONE;
  const up = (next === VOTE_UP ? 1 : 0) - (previous === VOTE_UP ? 1 : 0);
  const down = (next === VOTE_DOWN ? 1 : 0) - (previous === VOTE_DOWN ? 1 : 0);
  const upvotes = (post.upvotes || 0) + up;
  const downvotes = (post.downvotes || 0) + down;
  return { ...post, upvotes, downvotes, score: upvotes - downvotes, myVote: next };
}

// "1 upvote · 3 downvotes" (NFR-27: votes and score, never likes).
export function voteSummary(post) {
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  return `${plural(post.upvotes || 0, 'upvote')} · ${plural(post.downvotes || 0, 'downvote')}`;
}

// A readable message when a vote fails. 429 keeps the server's "try again in N seconds" text.
export function voteErrorMessage(error) {
  if (error?.status === 429) {
    return error.message || `You can vote up to ${VOTES_PER_MINUTE} times per minute. Please try again shortly.`;
  }
  if (error?.status === 404) return 'This post was deleted, so it can no longer be voted on.';
  if (error?.status === 401) return error.message || 'Please log in again to vote.';
  return 'Your vote could not be saved. Please try again.';
}
