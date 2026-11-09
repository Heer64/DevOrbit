import { Router } from 'express';

import Post from '../models/Post.js';
import { requireAuth } from '../middleware/auth.js';
import { postView } from '../lib/postRules.js';
import { attachMyVotes } from '../lib/postVotes.js';
import { trendingRanker } from '../lib/trending.js';
import {
  TRENDING_BAD_CURSOR_MESSAGE,
  TRENDING_MAX_AGE_MS,
  TRENDING_RECALC_INTERVAL_MS,
  TRENDING_SORT,
  afterCursorFilter,
  decodeTrendingCursor,
  encodeTrendingCursor,
  readTrendingLimit,
} from '../lib/trendingRules.js';

/*
 * [Sprint 5 · M8] US-53 Browse the trending feed (FR-25, NFR-1a, NFR-15).
 * Mounted at /api/posts/trending (see app.js), BEFORE M6's /api/posts routes, so "trending" is never
 * read as a post ID. Login needed, like M6's newest-first list.
 *
 * GET /api/posts/trending?limit=1..50 (default 20)&cursor=<nextCursor from the previous page>
 *   -> 200 {
 *        posts: [ post + trendingScore ],   M6's post shape (postView) + M7's myVote + trendingScore
 *        nextCursor: string | null,         null on the last page
 *        rankedAt: ISO date | null,         when the scores were last recalculated
 *        maxRankAgeSeconds: 300             scores are never older than this when served (NFR-15)
 *      }
 *   400 { message } bad cursor     401 not logged in
 *
 * Order: trendingScore highest first, then the newer post (createdAt, then _id) on ties.
 * trendingScore = (upvotes - downvotes) / (ageHours + 2)^1.5, stored on the post and recalculated
 * by lib/trending.js every 4 minutes, and here first when the last run is 5+ minutes old.
 * The votes are M7's (US-52); this route only reads them.
 *
 * Speed (NFR-1a, < 3 s): one indexed, limited query (index { trendingScore: -1, createdAt: -1, _id: -1 }
 * on Post) + one author populate + one "my votes" query per page. No per-request sorting of all posts.
 */

const router = Router();
const AUTHOR_FIELDS = 'name username avatarUrl';

router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const limit = readTrendingLimit(req.query.limit);
    let cursor = null;
    if (req.query.cursor !== undefined) {
      cursor = decodeTrendingCursor(req.query.cursor);
      if (!cursor) return res.status(400).json({ message: TRENDING_BAD_CURSOR_MESSAGE });
    }

    const rankedAt = await trendingRanker.ensureFresh();

    const rows = await Post.find(afterCursorFilter(cursor))
      .sort(TRENDING_SORT)
      .limit(limit + 1)
      .populate('author', AUTHOR_FIELDS)
      .lean();
    const page = rows.slice(0, limit);
    const views = page.map((post) => ({ ...postView(post, req.user.id), trendingScore: post.trendingScore || 0 }));

    res.set('Cache-Control', 'no-store');
    return res.json({
      posts: await attachMyVotes(views, req.user.id),
      nextCursor: rows.length > limit ? encodeTrendingCursor(page[page.length - 1]) : null,
      rankedAt: rankedAt ? rankedAt.toISOString() : null,
      maxRankAgeSeconds: TRENDING_MAX_AGE_MS / 1000,
      recalculatedEverySeconds: TRENDING_RECALC_INTERVAL_MS / 1000,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;

/*
 * ---------------------------------------------------------------------------
 * [Sprint 5 · M8] What this file does
 * The trending feed: public posts ordered by their stored trending score (highest
 * first, newer post on ties), 20 per page with a "load more" cursor. Makes sure the
 * scores are at most 5 minutes old before reading them.
 * ---------------------------------------------------------------------------
 */
