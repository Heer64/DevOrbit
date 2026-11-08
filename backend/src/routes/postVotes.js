import { Router } from 'express';

import Post from '../models/Post.js';
import PostVoteLog from '../models/PostVoteLog.js';
import { requireAuth } from '../middleware/auth.js';
import { validId } from '../lib/projectAccess.js';
import { POST_NOT_FOUND_MESSAGE, postView } from '../lib/postRules.js';
import { VOTE_NONE, VOTE_WINDOW_MS, readVoteValue, voteMessage, voteRateLimit } from '../lib/voteRules.js';
import { attachMyVotes, castVote } from '../lib/postVotes.js';

/*
 * [Sprint 5 · M7] Vote on a public post (US-52; FR-24, NFR-13, NFR-14, NFR-16, NFR-26).
 * Mounted at /api/posts/:postId/vote (see app.js), before the M6 post routes. Login needed.
 *
 * PUT    /    JSON { value: 1 | -1 | 0 }   1 = upvote, -1 = downvote, 0 = remove my vote
 * DELETE /    same as PUT { value: 0 }      (retract my vote)
 *
 *   -> 200 { post, vote, previous, outcome, message }
 *        post      the post with its new upvotes / downvotes / score and myVote
 *        vote      my vote now (1, -1 or 0); previous = my vote before
 *        outcome   cast | changed | retracted | unchanged
 *                  "unchanged" = I voted the same way again: nothing was counted (US-52 AC2)
 *   400 { message }  invalid post ID, or value is not exactly 1, -1 or 0
 *   401              not logged in
 *   404 { message }  unknown or deleted post
 *   429 { message, code: 'vote_rate_limited', retryAfterSeconds } + Retry-After header
 *        when the user already sent 30 votes in the last minute (NFR-16)
 *
 * A user may vote on any public post, their own included (FR-24 has no exception).
 */

const router = Router({ mergeParams: true });
const AUTHOR_FIELDS = 'name username avatarUrl';

router.use(requireAuth);

async function vote(req, res, next, rawValue) {
  try {
    if (!validId(req.params.postId)) return res.status(400).json({ message: 'Invalid post ID.' });
    const parsed = readVoteValue(rawValue);
    if (!parsed.ok) return res.status(400).json({ message: parsed.message });

    const exists = await Post.exists({ _id: req.params.postId });
    if (!exists) return res.status(404).json({ message: POST_NOT_FOUND_MESSAGE });

    // NFR-16: 30 vote requests per user per rolling minute. The slot is taken FIRST and then every
    // slot in the window is counted, so requests sent at the same moment can never get past 30
    // together (in such a burst the limit errs on the safe side). A refused request gives its slot back.
    const slot = await PostVoteLog.create({ user: req.user.id });
    const since = new Date(Date.now() - VOTE_WINDOW_MS);
    const inWindow = { user: req.user.id, createdAt: { $gte: since } };
    const [recent, oldest] = await Promise.all([
      PostVoteLog.countDocuments(inWindow),
      PostVoteLog.findOne(inWindow).sort({ createdAt: 1 }).select('createdAt').lean(),
    ]);
    const limited = voteRateLimit(recent, oldest?.createdAt);
    if (limited) {
      await PostVoteLog.deleteOne({ _id: slot._id });
      res.set('Retry-After', String(limited.retryAfterSeconds));
      return res.status(429).json({
        message: limited.message,
        code: 'vote_rate_limited',
        retryAfterSeconds: limited.retryAfterSeconds,
      });
    }

    const result = await castVote({ postId: req.params.postId, userId: req.user.id, value: parsed.value });
    if (result.outcome === 'post_gone') return res.status(404).json({ message: POST_NOT_FOUND_MESSAGE });

    const saved = await Post.findById(req.params.postId).populate('author', AUTHOR_FIELDS).lean();
    if (!saved) return res.status(404).json({ message: POST_NOT_FOUND_MESSAGE });
    const [post] = await attachMyVotes([postView(saved, req.user.id)], req.user.id);

    return res.json({
      post,
      vote: result.value,
      previous: result.previous,
      outcome: result.outcome,
      message: voteMessage(result.outcome, result.value),
    });
  } catch (error) {
    return next(error);
  }
}

router.put('/', (req, res, next) => vote(req, res, next, req.body?.value));
router.delete('/', (req, res, next) => vote(req, res, next, VOTE_NONE));

export default router;

/*
 * ---------------------------------------------------------------------------
 * [Sprint 5 · M7] What this file does
 * REST API to upvote, downvote, change or remove your vote on a public post.
 * One active vote per user per post, the same vote twice counts once, many votes at
 * the same moment are each counted exactly once, and at most 30 votes per user per minute.
 * ---------------------------------------------------------------------------
 */
