import User from '../models/User.js';
import { readUsername } from './portfolioRules.js';
import { PROFILE_FIELDS, profileView } from './userProfileRules.js';
import { followerCount, isFollowing, totalVoteScore } from './follows.js'; // [Sprint 5 · M8] US-54

/*
 * [Sprint 5 · M3] US-06 View another user's profile (FR-19, FR-26).
 *
 * Shows photo, bio, skill tags, follower count and public score, read-only.
 * Hidden fields are never sent (see profileView in userProfileRules.js for the allow-list).
 * Turning off "appear in collaborator search" only removes the user from search results (US-07 AC1);
 * the profile still opens from a direct link, for example from a project's member list.
 */

/*
 * FR-26: the follower count, and the public score = the sum of the net vote scores of the user's
 * public posts.
 * [Sprint 5 · M8] US-54: now the real numbers. followerCount = Follow rows pointing at the user,
 * publicScore = "total vote score" = sum of (upvotes - downvotes) over the user's posts (M6 posts,
 * M7 votes). Never "likes" (NFR-27). See lib/follows.js.
 */
export async function socialCountsFor(userId) {
  const [followers, score] = await Promise.all([followerCount(userId), totalVoteScore(userId)]);
  return { followerCount: followers, publicScore: score };
}

// Returns the profile for a username, or null when there is no such user.
export async function loadUserProfile(rawUsername, viewerId) {
  const username = readUsername(rawUsername);
  if (!username) return null;
  const user = await User.findOne({ username }).select(PROFILE_FIELDS).lean();
  if (!user) return null;
  const [counts, viewerFollows] = await Promise.all([
    socialCountsFor(user._id),
    isFollowing(viewerId, user._id), // [Sprint 5 · M8] US-54
  ]);
  // [Sprint 5 · M8] isFollowing: does the viewer follow this user (always false on your own profile).
  return { ...profileView(user, counts, viewerId), isFollowing: viewerFollows };
}
