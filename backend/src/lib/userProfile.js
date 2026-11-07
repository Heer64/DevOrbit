import User from '../models/User.js';
import { readUsername } from './portfolioRules.js';
import { PROFILE_FIELDS, profileView } from './userProfileRules.js';

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
 * public posts. Following (US-54) and posts with votes (US-50, US-52) are built in a later sprint and
 * have no models yet, so both numbers are 0 until then. When they are added, only this function changes.
 */
export async function socialCountsFor(_userId) {
  return { followerCount: 0, publicScore: 0 };
}

// Returns the profile for a username, or null when there is no such user.
export async function loadUserProfile(rawUsername, viewerId) {
  const username = readUsername(rawUsername);
  if (!username) return null;
  const user = await User.findOne({ username }).select(PROFILE_FIELDS).lean();
  if (!user) return null;
  const counts = await socialCountsFor(user._id);
  return profileView(user, counts, viewerId);
}
