/*
 * [Sprint 5 · M8] US-53 Browse the trending feed (FR-25, NFR-1a, NFR-15).
 *
 * The trending rules, with no database imports so they are tested on their own
 * (backend/test/trendingRules.test.js) and the ranker, route, tests and README use the same numbers.
 *
 *   trendingScore = score / (ageHours + 2) ^ 1.5
 *     score     the post's net vote score, upvotes - downvotes (kept by M7's vote engine, US-52)
 *     ageHours  hours since the post was created
 *   Order: trendingScore highest first; equal scores -> the NEWER post first (createdAt, then _id).
 *
 * The score depends on the clock, so it is stored on each post (Post.trendingScore) and recalculated
 * by lib/trending.js at least every 5 minutes (NFR-15): a scheduled run every 4 minutes, and the feed
 * itself re-ranks first if the last run is older than 5 minutes (e.g. after a restart).
 */

export const TRENDING_AGE_OFFSET_HOURS = 2;
export const TRENDING_GRAVITY = 1.5;
export const TRENDING_MAX_AGE_MS = 5 * 60 * 1000; // NFR-15: never older than 5 minutes when the feed is read
export const TRENDING_RECALC_INTERVAL_MS = 4 * 60 * 1000; // scheduled runs, one minute of slack under the 5
export const TRENDING_PAGE_DEFAULT = 20;
export const TRENDING_PAGE_MAX = 50;
export const TRENDING_BAD_CURSOR_MESSAGE = 'Invalid trending feed cursor. Reload the feed.';

const HOUR_MS = 60 * 60 * 1000;

// Hours since createdAt (never negative, so a clock a little ahead of the server does not explode).
export function ageHours(createdAt, now = Date.now()) {
  const created = new Date(createdAt).getTime();
  const at = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(created) || !Number.isFinite(at)) return 0;
  return Math.max(0, (at - created) / HOUR_MS);
}

// FR-25. A post without a valid net score counts as 0.
export function trendingScore(score, createdAt, now = Date.now()) {
  const net = Number(score);
  if (!Number.isFinite(net) || net === 0) return 0;
  return net / (ageHours(createdAt, now) + TRENDING_AGE_OFFSET_HOURS) ** TRENDING_GRAVITY;
}

// Same for a post document ({ upvotes, downvotes } win over a stored score if both are there).
export function postTrendingScore(post, now = Date.now()) {
  const net = Number.isFinite(post?.upvotes) && Number.isFinite(post?.downvotes) ? post.upvotes - post.downvotes : post?.score;
  return trendingScore(net, post?.createdAt, now);
}

const time = (value) => {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

/*
 * Array sort comparator for { trendingScore, createdAt, _id }: highest trendingScore first,
 * then newer createdAt, then larger _id (ObjectIds grow with creation time).
 * The MongoDB sort { trendingScore: -1, createdAt: -1, _id: -1 } gives the same order.
 */
export function compareTrending(a, b) {
  const scoreA = Number(a.trendingScore) || 0;
  const scoreB = Number(b.trendingScore) || 0;
  if (scoreA !== scoreB) return scoreB - scoreA;
  const byTime = time(b.createdAt) - time(a.createdAt);
  if (byTime !== 0) return byTime;
  return String(b._id).localeCompare(String(a._id));
}

export const TRENDING_SORT = Object.freeze({ trendingScore: -1, createdAt: -1, _id: -1 });

export function readTrendingLimit(raw) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) return TRENDING_PAGE_DEFAULT;
  return Math.min(value, TRENDING_PAGE_MAX);
}

/*
 * Cursor for "load more": the last post's place in the order, as an opaque URL-safe string.
 * Holds { s: trendingScore, c: createdAt ms, i: _id }. Numbers survive JSON exactly.
 */
export function encodeTrendingCursor(post) {
  const payload = { s: Number(post.trendingScore) || 0, c: time(post.createdAt), i: String(post._id) };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

// Returns { trendingScore, createdAt: Date, id } or null when the cursor is not one we made.
export function decodeTrendingCursor(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  const { s, c, i } = payload;
  if (typeof s !== 'number' || !Number.isFinite(s)) return null;
  if (typeof c !== 'number' || !Number.isSafeInteger(c) || c < 0) return null;
  if (typeof i !== 'string' || !/^[a-f0-9]{24}$/i.test(i)) return null;
  return { trendingScore: s, createdAt: new Date(c), id: i };
}

// MongoDB filter for "everything after this cursor" in TRENDING_SORT order.
export function afterCursorFilter(cursor) {
  if (!cursor) return {};
  const { trendingScore: s, createdAt: c, id } = cursor;
  return {
    $or: [{ trendingScore: { $lt: s } }, { trendingScore: s, createdAt: { $lt: c } }, { trendingScore: s, createdAt: c, _id: { $lt: id } }],
  };
}

// True when the last ranking run is missing or older than TRENDING_MAX_AGE_MS.
export function rankingIsStale(lastRankedAt, now = Date.now(), maxAgeMs = TRENDING_MAX_AGE_MS) {
  if (!lastRankedAt) return true;
  const at = now instanceof Date ? now.getTime() : Number(now);
  return at - time(lastRankedAt) >= maxAgeMs;
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 5 · M8] What this file does
 * The trending formula score / (ageHours + 2)^1.5, the feed order (highest first,
 * newer post on ties), the "load more" cursor, and when a ranking is too old (5 min).
 * ---------------------------------------------------------------------------
 */
