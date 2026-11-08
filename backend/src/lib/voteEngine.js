import {
  VOTES_PER_MINUTE,
  VOTE_BUSY_MESSAGE,
  VOTE_NONE,
  isEmptyDelta,
  voteDelta,
  voteOutcome,
} from './voteRules.js';

/*
 * [Sprint 5 · M7] The vote engine (US-52 Vote on a post; FR-24, NFR-13, NFR-14).
 *
 * The truth is the PostVote row of (post, user). The counters on Post (upvotes, downvotes, score)
 * follow it. Both steps are single atomic MongoDB operations, and no transaction is needed:
 *
 *   1. Change the vote row with a "compare-and-swap": the write only happens if the row is still
 *      exactly what we read (same _id AND same value), or, for a first vote, if no row exists yet
 *      (the unique { post, user } index refuses a second insert).
 *   2. ONLY the request whose write in step 1 succeeded moves the post's counters, with one $inc
 *      that changes upvotes, downvotes and score together (so score = upvotes - downvotes).
 *
 * If step 1 loses a race (another request of the same user changed the row first), the request
 * reads the row again and tries again. So:
 *   - the same vote sent twice, even at the same moment, is counted once (US-52 AC2, NFR-13);
 *   - many users voting at the same moment each move the counters exactly once, because $inc
 *     is atomic and never loses an update (US-52 AC3, NFR-14);
 *   - up -> down moves upvotes -1, downvotes +1, score -2 in one step (FR-24 change a vote);
 *   - retract deletes the row and takes its point back (FR-24 retract a vote).
 *
 * makeVoteEngine() takes the two models instead of importing them, so the race logic can also be
 * tested without MongoDB (backend/test/voteEngine.test.js). lib/postVotes.js gives it the real models.
 */

// A request only has to try again when ANOTHER request of the same user on the same post won
// the race, and each of those wins only once. The rate limit allows at most 30 vote requests
// per user per minute, so 31 attempts are always enough under the limit.
const MAX_ATTEMPTS = VOTES_PER_MINUTE + 1;

function busyError() {
  const error = new Error(VOTE_BUSY_MESSAGE);
  error.status = 409;
  return error;
}

export function makeVoteEngine({ Post: PostModel, PostVote: VoteModel }) {
  // Moves the post's counters. Returns false when the post no longer exists.
  async function moveCounters(postId, delta) {
    if (isEmptyDelta(delta)) return true;
    const result = await PostModel.updateOne({ _id: postId }, { $inc: delta });
    return result.matchedCount === 1;
  }

  /*
   * Sets userId's vote on postId to `value` (1, -1 or 0).
   * Returns { outcome, previous, value }, outcome = cast | changed | retracted | unchanged,
   * or { outcome: 'post_gone' } when the post was deleted while the vote was being saved.
   */
  async function castVote({ postId, userId, value }) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const current = await VoteModel.findOne({ post: postId, user: userId }, 'value').lean();
      const previous = current ? current.value : VOTE_NONE;

      // US-52 AC2: the same vote again (or retracting a vote that is not there) changes nothing.
      if (previous === value) return { outcome: 'unchanged', previous, value };

      if (!current) {
        try {
          await VoteModel.create({ post: postId, user: userId, value });
        } catch (error) {
          // Another request of this user stored a vote first: read it again and decide again.
          if (error?.code === 11000) continue;
          throw error;
        }
      } else if (value === VOTE_NONE) {
        const removed = await VoteModel.deleteOne({ _id: current._id, value: previous });
        if (removed.deletedCount !== 1) continue;
      } else {
        const changed = await VoteModel.updateOne({ _id: current._id, value: previous }, { $set: { value } });
        if (changed.modifiedCount !== 1) continue;
      }

      // Only the request that changed the row gets here, so the counters move exactly once.
      const stillThere = await moveCounters(postId, voteDelta(previous, value));
      if (!stillThere) {
        // The post was deleted in the meantime: do not leave a vote behind for it.
        await VoteModel.deleteMany({ post: postId });
        return { outcome: 'post_gone' };
      }
      return { outcome: voteOutcome(previous, value), previous, value };
    }
    // Only reachable if this user's own requests keep changing the row between our read and write.
    throw busyError();
  }

  // The viewer's vote on each post (1, -1 or 0), as a Map of postId -> value.
  async function myVotesFor(postIds, userId) {
    const ids = [...new Set(postIds.map(String))];
    const votes = new Map(ids.map((id) => [id, VOTE_NONE]));
    if (!userId || ids.length === 0) return votes;
    const rows = await VoteModel.find({ user: userId, post: { $in: ids } }, 'post value').lean();
    for (const row of rows) votes.set(String(row.post), row.value);
    return votes;
  }

  // Adds myVote to post views from postView() (lib/postRules.js).
  async function attachMyVotes(views, userId) {
    const votes = await myVotesFor(views.map((view) => view._id), userId);
    return views.map((view) => ({ ...view, myVote: votes.get(String(view._id)) ?? VOTE_NONE }));
  }

  // US-51 AC2 "its votes no longer count": called after a post is deleted.
  async function deleteVotesForPost(postId) {
    await VoteModel.deleteMany({ post: postId });
  }

  /*
   * Counts a post's votes again from the PostVote rows and saves the counters.
   * Not used on the normal path. It exists for checks in tests and as a repair tool (for example
   * after restoring a database backup): `node -e` / a script can call it for one post.
   */
  async function recountPostVotes(postId) {
    const rows = await VoteModel.find({ post: postId }, 'value').lean();
    const upvotes = rows.filter((row) => row.value === 1).length;
    const downvotes = rows.filter((row) => row.value === -1).length;
    await PostModel.updateOne({ _id: postId }, { $set: { upvotes, downvotes, score: upvotes - downvotes } });
    return { upvotes, downvotes, score: upvotes - downvotes };
  }

  return { castVote, myVotesFor, attachMyVotes, deleteVotesForPost, recountPostVotes };
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 5 · M7] What this file does
 * Saves a user's up/down vote on a post, changes or removes it, and keeps the post's
 * upvotes / downvotes / score right even when many votes arrive at the same moment.
 * Each change is one atomic write on the vote row, and only the request that made it
 * moves the counters (one atomic $inc). Also gives "my vote" for a list of posts and
 * removes a deleted post's votes. Works on any two models given to makeVoteEngine().
 * ---------------------------------------------------------------------------
 */
