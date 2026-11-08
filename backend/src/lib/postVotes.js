import Post from '../models/Post.js';
import PostVote from '../models/PostVote.js';
import { makeVoteEngine } from './voteEngine.js';

/*
 * [Sprint 5 · M7] US-52 Vote on a post: the vote engine (lib/voteEngine.js) bound to the real
 * Post and PostVote models. Routes import from here:
 *   castVote({ postId, userId, value })  -> { outcome, previous, value } | { outcome: 'post_gone' }
 *   attachMyVotes(postViews, userId)     -> the same views with myVote (1, -1 or 0)
 *   myVotesFor(postIds, userId)          -> Map postId -> 1 | -1 | 0
 *   deleteVotesForPost(postId)           -> removes a deleted post's votes (US-51 AC2)
 *   recountPostVotes(postId)             -> recounts the counters from the vote rows (checks/repair)
 */
const engine = makeVoteEngine({ Post, PostVote });

export const { castVote, myVotesFor, attachMyVotes, deleteVotesForPost, recountPostVotes } = engine;
