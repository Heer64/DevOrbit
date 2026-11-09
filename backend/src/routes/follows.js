import { Router } from 'express';

import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { readUsername } from '../lib/portfolioRules.js';
import { USER_NOT_FOUND_MESSAGE } from '../lib/userProfileRules.js';
import { FOLLOW_SELF_MESSAGE, followMessage } from '../lib/followRules.js';
import { follow, followerCount, unfollow } from '../lib/follows.js';

/*
 * [Sprint 5 · M8] US-54 Follow users and see public counts (FR-26, NFR-26).
 * Mounted at /api/profile/users/:username/follow (see app.js), next to M3's
 * GET /api/profile/users/:username, and keyed by username like it, so no user IDs are sent.
 * Login needed.
 *
 * PUT    /   follow    -> 200 { following: true,  followerCount, changed, message }
 * DELETE /   unfollow  -> 200 { following: false, followerCount, changed, message }
 *   changed = false when nothing had to change (already following / not following):
 *   repeating a request, or sending it twice at once, never counts twice.
 *   followerCount = the user's real follower count right after the change.
 *   400 { message, code: 'self_follow' }  trying to follow yourself
 *   404 { message }                      no such user
 *   401                                  not logged in
 *
 * Privacy (M3, US-06/US-07): anyone logged in can open any profile by its link, so anyone logged in
 * can follow it; "appear in collaborator search" only affects search. Followers are never listed,
 * only counted.
 */

const router = Router({ mergeParams: true });
router.use(requireAuth);

async function findTarget(req, res) {
  const username = readUsername(req.params.username);
  const user = username ? await User.findOne({ username }).select('_id name username').lean() : null;
  if (!user) {
    res.status(404).json({ message: USER_NOT_FOUND_MESSAGE });
    return null;
  }
  return user;
}

router.put('/', async (req, res, next) => {
  try {
    const target = await findTarget(req, res);
    if (!target) return undefined;
    let result;
    try {
      result = await follow(req.user.id, target._id);
    } catch (error) {
      if (error?.code === 'self_follow') return res.status(400).json({ message: FOLLOW_SELF_MESSAGE, code: 'self_follow' });
      throw error;
    }
    return res.json({
      ...result,
      followerCount: await followerCount(target._id),
      message: followMessage(result, target.name),
    });
  } catch (error) {
    return next(error);
  }
});

router.delete('/', async (req, res, next) => {
  try {
    const target = await findTarget(req, res);
    if (!target) return undefined;
    const result = await unfollow(req.user.id, target._id);
    return res.json({
      ...result,
      followerCount: await followerCount(target._id),
      message: followMessage(result, target.name),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;

/*
 * ---------------------------------------------------------------------------
 * [Sprint 5 · M8] What this file does
 * Follow or unfollow another user by username. Answers with "do I follow them now"
 * and their real follower count. Following yourself is refused; repeating a request
 * is harmless.
 * ---------------------------------------------------------------------------
 */
