import Post from '../models/Post.js';
import { makeTrendingRanker } from './trendingRanker.js';

/*
 * [Sprint 5 · M8] US-53: the trending ranker (lib/trendingRanker.js) bound to the real Post model.
 *   startTrendingRanker() / stopTrendingRanker()   called by server.js (every 4 minutes)
 *   trendingRanker.ensureFresh()                    called by GET /api/posts/trending
 *   trendingRanker.recalculate()                    one run now (also usable from a script)
 */
export const trendingRanker = makeTrendingRanker({ Post });

export function startTrendingRanker(options) {
  trendingRanker.start(options);
}

export function stopTrendingRanker() {
  trendingRanker.stop();
}
