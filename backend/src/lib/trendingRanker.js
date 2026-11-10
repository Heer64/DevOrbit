import { TRENDING_MAX_AGE_MS, TRENDING_RECALC_INTERVAL_MS, postTrendingScore, rankingIsStale } from './trendingRules.js';

/*
 * [Sprint 5 · M8] US-53: keeps Post.trendingScore up to date (FR-25, NFR-15).
 *
 * recalculate()   one ranking run: reads every post's vote counters and age, computes
 *                 trendingScore (lib/trendingRules.js) at ONE moment for all posts, and writes only
 *                 the posts whose value changed (bulkWrite in batches). Concurrent calls share one run.
 * ensureFresh()   runs recalculate() first when the last run is missing or 5+ minutes old,
 *                 so the feed is never ranked with scores older than 5 minutes, even right after
 *                 a restart or if a scheduled run was delayed.
 * start()/stop()  the scheduled run: once straight away, then every 4 minutes (timer is unref'd).
 *
 * The votes are M7's (Post.upvotes / downvotes / score, moved atomically by lib/postVotes.js);
 * nothing here changes them. makeTrendingRanker() takes the model and the clock instead of importing
 * them, so it is tested without MongoDB (backend/test/trendingRanker.test.js). lib/trending.js
 * binds it to the real Post model.
 */
export function makeTrendingRanker({
  Post: PostModel,
  now = () => Date.now(),
  batchSize = 500,
  maxAgeMs = TRENDING_MAX_AGE_MS,
  onError = (error) => {
    if (process.env.NODE_ENV !== 'test') console.error('Trending ranking failed:', error.message);
  },
} = {}) {
  let clock = now;
  let lastRankedAt = null;
  let current = null; // the run in progress, shared by concurrent callers
  let timer = null;
  let runs = 0;

  async function runOnce() {
    const at = clock();
    const rows = await PostModel.find({}).select('upvotes downvotes score createdAt trendingScore').lean();
    const writes = [];
    for (const post of rows) {
      const next = postTrendingScore(post, at);
      // Also writes posts that have no trendingScore yet (made before Sprint 5 M8).
      if (post.trendingScore !== next) {
        writes.push({ updateOne: { filter: { _id: post._id }, update: { $set: { trendingScore: next } } } });
      }
    }
    for (let start = 0; start < writes.length; start += batchSize) {
      await PostModel.bulkWrite(writes.slice(start, start + batchSize), { ordered: false });
    }
    lastRankedAt = new Date(at);
    runs += 1;
    return { checked: rows.length, updated: writes.length, rankedAt: lastRankedAt };
  }

  function recalculate() {
    if (!current) {
      current = runOnce().finally(() => {
        current = null;
      });
    }
    return current;
  }

  // Never throws: if a run fails the feed is still served from the last stored scores
  // (rankedAt then shows how old they are), and the failure is reported through onError.
  async function ensureFresh() {
    if (rankingIsStale(lastRankedAt, clock(), maxAgeMs)) {
      try {
        await recalculate();
      } catch (error) {
        onError(error);
      }
    }
    return lastRankedAt;
  }

  async function scheduledRun() {
    try {
      await recalculate();
    } catch (error) {
      onError(error);
    }
  }

  function start({ intervalMs = TRENDING_RECALC_INTERVAL_MS } = {}) {
    if (timer) return;
    scheduledRun();
    timer = setInterval(scheduledRun, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    recalculate,
    ensureFresh,
    start,
    stop,
    get lastRankedAt() {
      return lastRankedAt;
    },
    get runs() {
      return runs;
    },
    get running() {
      return Boolean(timer);
    },
    // Tests only: move the ranker's clock (e.g. "5 minutes later") without touching Date.
    setClock(fn) {
      clock = typeof fn === 'function' ? fn : now;
    },
    // Tests only: forget the last run, as after a restart.
    reset() {
      lastRankedAt = null;
    },
  };
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 5 · M8] What this file does
 * Recalculates every post's trending score from its real votes and age, at most
 * one run at a time, on a timer (every 4 minutes) and on demand when the last run
 * is 5 minutes old, so the trending order is never more than 5 minutes stale.
 * ---------------------------------------------------------------------------
 */
