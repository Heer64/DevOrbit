import mongoose from 'mongoose';

import Follow from '../models/Follow.js';
import Post from '../models/Post.js';
import { isSelfFollow, safeCount, safeScore } from './followRules.js';

/*
 * [Sprint 5 · M8] US-54 Follow users and see public counts (FR-26).
 * Database side of following; the rules are in lib/followRules.js.
 *
 *   follow(followerId, followingId)    -> { following: true,  changed }   changed = a new row was made
 *   unfollow(followerId, followingId)  -> { following: false, changed }   changed = a row was removed
 *   followerCount(userId)              -> number of users following userId
 *   isFollowing(followerId, userId)    -> boolean
 *   totalVoteScore(userId)             -> sum of (upvotes - downvotes) over the user's posts (M6 posts, M7 votes)
 *
 * Both writes are single atomic MongoDB operations, so repeated or simultaneous requests are safe:
 *   follow   = upsert on the unique { follower, following } pair: only one request can create the row,
 *              a second simultaneous one either finds it or hits the unique index (E11000), which
 *              simply means "already following".
 *   unfollow = deleteOne: only one request can remove the row.
 */

const objectId = (id) => new mongoose.Types.ObjectId(String(id));

export async function follow(followerId, followingId) {
  if (isSelfFollow(followerId, followingId)) {
    const error = new Error('self_follow');
    error.code = 'self_follow';
    throw error;
  }
  try {
    const result = await Follow.updateOne(
      { follower: followerId, following: followingId },
      { $setOnInsert: { follower: followerId, following: followingId } },
      { upsert: true }
    );
    return { following: true, changed: result.upsertedCount === 1 };
  } catch (error) {
    if (error?.code === 11000) return { following: true, changed: false };
    throw error;
  }
}

export async function unfollow(followerId, followingId) {
  const result = await Follow.deleteOne({ follower: followerId, following: followingId });
  return { following: false, changed: result.deletedCount === 1 };
}

export async function followerCount(userId) {
  return safeCount(await Follow.countDocuments({ following: userId }));
}

export async function isFollowing(followerId, userId) {
  if (!followerId || isSelfFollow(followerId, userId)) return false;
  return Boolean(await Follow.exists({ follower: followerId, following: userId }));
}

// FR-26 "total vote score": uses the post index { author: 1, createdAt: -1 }; one number back.
export async function totalVoteScore(userId) {
  const [row] = await Post.aggregate([
    { $match: { author: objectId(userId) } },
    { $group: { _id: null, total: { $sum: { $subtract: [{ $ifNull: ['$upvotes', 0] }, { $ifNull: ['$downvotes', 0] }] } } } },
  ]);
  return safeScore(row?.total);
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 5 · M8] What this file does
 * Follow and unfollow another user (safe when repeated or sent twice at once), count
 * a user's followers, check "do I follow them", and add up the net vote score of all
 * of a user's posts for their profile.
 * ---------------------------------------------------------------------------
 */
