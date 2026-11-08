/*
 * [Sprint 5 · M6] Public post rules (US-50 Create a public post, US-51 Edit or delete my post;
 * FR-23, NFR-16, NFR-26, NFR-27).
 *
 * No database imports, so these rules are tested on their own (backend/test/postRules.test.js)
 * and the route, the tests, the README and the frontend all use the same numbers.
 *
 * A post is
 *   text    required, 1 to 500 characters after trimming (line breaks kept)
 *   image   optional, ONE JPEG, PNG or WebP image of at most 5 MB
 *           The type is decided from the file's first bytes (its "signature"), never from the
 *           file name or the Content-Type the browser sent, so a renamed .exe or .svg is refused.
 *   It belongs to no project (FR-23 "independent of a project").
 *
 * Limits
 *   At most 10 posts per user in any rolling hour (US-50 AC2, NFR-16). Edits do not count.
 *   Deleting a post does NOT give the slot back, so delete-and-repost cannot flood the feed.
 *
 * Words (NFR-27): always "post", "votes", "score". Never "likes".
 */

export const POST_TEXT_MAX = 500;
export const MAX_POST_IMAGE_MB = 5;
export const MAX_POST_IMAGE_BYTES = MAX_POST_IMAGE_MB * 1024 * 1024; // 5 MB
export const POSTS_PER_HOUR = 10;
export const POST_WINDOW_MS = 60 * 60 * 1000; // one hour
export const POST_IMAGE_FIELD = 'image';
export const POST_TEXT_FIELD = 'text';
export const POSTS_PAGE_DEFAULT = 20;
export const POSTS_PAGE_MAX = 50;

export const POST_IMAGE_TYPES = Object.freeze([
  { ext: 'jpg', mime: 'image/jpeg', label: 'JPEG' },
  { ext: 'png', mime: 'image/png', label: 'PNG' },
  { ext: 'webp', mime: 'image/webp', label: 'WebP' },
]);

export const POST_TEXT_REQUIRED_MESSAGE = 'Write something before posting.';
export const POST_TEXT_TOO_LONG_MESSAGE = `Posts must be ${POST_TEXT_MAX} characters or fewer.`;
export const POST_TEXT_TYPE_MESSAGE = 'Post text must be text.';
export const POST_IMAGE_TOO_LARGE_MESSAGE = `Images must be ${MAX_POST_IMAGE_MB} MB or smaller.`;
export const POST_IMAGE_TYPE_MESSAGE = 'Only JPEG, PNG or WebP images can be added to a post.';
export const POST_IMAGE_EMPTY_MESSAGE = 'This image file is empty. Choose another image.';
export const POST_ONE_IMAGE_MESSAGE = `A post can have at most one image, sent in the "${POST_IMAGE_FIELD}" field.`;
export const POST_NOT_FOUND_MESSAGE = 'Post not found. It may have been deleted.';
export const POST_NOT_AUTHOR_MESSAGE = 'You can only edit or delete your own posts.';
export const POST_CREATED_MESSAGE = 'Your post is published.';
export const POST_UPDATED_MESSAGE = 'Your post was updated.';
export const POST_DELETED_MESSAGE = 'Your post was deleted.';

// Control characters other than tab and line break are removed (they are invisible and break layouts).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

// "\r\n" and a lone "\r" become "\n", control characters are dropped, and the ends are trimmed.
export function normalizePostText(text) {
  return String(text).replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').trim();
}

/*
 * Reads the post text sent by the client.
 * Returns { ok: true, value } or { ok: false, message } with a message the user can act on (US-50 AC3).
 */
export function readPostText(raw) {
  if (raw === undefined || raw === null) return { ok: false, message: POST_TEXT_REQUIRED_MESSAGE };
  if (typeof raw !== 'string') return { ok: false, message: POST_TEXT_TYPE_MESSAGE };
  const value = normalizePostText(raw);
  if (!value) return { ok: false, message: POST_TEXT_REQUIRED_MESSAGE };
  if (value.length > POST_TEXT_MAX) return { ok: false, message: POST_TEXT_TOO_LONG_MESSAGE };
  return { ok: true, value };
}

/*
 * Decides the real image type from the first bytes. Returns { ext, mime, label } or null.
 *   JPEG  FF D8 FF
 *   PNG   89 50 4E 47 0D 0A 1A 0A
 *   WebP  "RIFF" <4-byte size> "WEBP"
 * SVG, GIF, HEIC and anything else answer null (refused).
 */
export function detectPostImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const at = (index) => buffer[index];
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return POST_IMAGE_TYPES[0];
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, index) => at(index) === byte)) return POST_IMAGE_TYPES[1];
  const ascii = (start, end) => String.fromCharCode(...buffer.subarray(start, end));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return POST_IMAGE_TYPES[2];
  return null;
}

/*
 * Checks an uploaded image (multer file object or { buffer, size }).
 * Returns { ok: true, type } or { ok: false, status, message, code }.
 */
export function checkPostImage(file) {
  if (!file) return { ok: true, type: null };
  const size = Number(file.size ?? file.buffer?.length ?? 0);
  if (!file.buffer || size === 0) return { ok: false, status: 400, message: POST_IMAGE_EMPTY_MESSAGE, code: 'image_empty' };
  if (size > MAX_POST_IMAGE_BYTES) {
    return { ok: false, status: 413, message: POST_IMAGE_TOO_LARGE_MESSAGE, code: 'image_too_large' };
  }
  const type = detectPostImageType(file.buffer);
  if (!type) return { ok: false, status: 400, message: POST_IMAGE_TYPE_MESSAGE, code: 'image_type' };
  return { ok: true, type };
}

// True when userId wrote the post (post.author may be an id or a populated user).
export function isPostAuthor(post, userId) {
  if (!post || !userId) return false;
  const author = post.author && typeof post.author === 'object' && post.author._id ? post.author._id : post.author;
  return String(author) === String(userId);
}

/*
 * Rate limit (US-50 AC2). `recent` is how many posts the user created in the last hour,
 * `oldest` the time of the oldest of those. Returns null when another post is allowed,
 * otherwise { retryAfterSeconds, message }.
 */
export function postRateLimit(recent, oldest, now = Date.now()) {
  if (recent <= POSTS_PER_HOUR) return null;
  const oldestMs = oldest ? new Date(oldest).getTime() : now;
  const retryAfterSeconds = Math.max(1, Math.ceil((oldestMs + POST_WINDOW_MS - now) / 1000));
  return { retryAfterSeconds, message: postRateLimitMessage(retryAfterSeconds) };
}

export function postRateLimitMessage(retryAfterSeconds) {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  const wait = minutes === 1 ? '1 minute' : `${minutes} minutes`;
  return `You can create up to ${POSTS_PER_HOUR} posts per hour. Please try again in ${wait}.`;
}

// Page size for the list: a whole number from 1 to POSTS_PAGE_MAX (default POSTS_PAGE_DEFAULT).
export function readPageLimit(raw) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) return POSTS_PAGE_DEFAULT;
  return Math.min(value, POSTS_PAGE_MAX);
}

/*
 * API shape of one post. The GridFS id of the image stays on the server.
 *   { _id, author { _id, name, username, avatarUrl } | null, text, imageUrl | null,
 *     image { contentType, size } | null, edited, editedAt, createdAt, updatedAt,
 *     upvotes, downvotes, score, isMine }
 * upvotes / downvotes / score are kept up to date by the vote engine (Sprint 5 · M7, lib/postVotes.js).
 * The routes add myVote (the viewer's own vote: 1, -1 or 0) with attachMyVotes().
 */
export function postView(post, viewerId = null) {
  const author = post.author && typeof post.author === 'object' && post.author.name !== undefined
    ? {
      _id: String(post.author._id),
      name: post.author.name,
      username: post.author.username,
      avatarUrl: post.author.avatarUrl || '',
    }
    : null;

  const hasImage = Boolean(post.image && post.image.storageId);
  return {
    _id: String(post._id),
    author,
    text: post.text,
    imageUrl: hasImage ? `/api/posts/${post._id}/image` : null,
    image: hasImage ? { contentType: post.image.contentType, size: post.image.size } : null,
    edited: Boolean(post.editedAt),
    editedAt: post.editedAt || null,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    upvotes: post.upvotes || 0,
    downvotes: post.downvotes || 0,
    score: post.score || 0,
    isMine: isPostAuthor(post, viewerId),
  };
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 5 · M6] What this file does
 * The rules for public posts: text up to 500 characters, one optional JPEG/PNG/WebP
 * image up to 5 MB (checked by its real bytes), 10 posts per user per hour, and
 * who may edit or delete (only the author). Also turns a post into its API shape.
 * ---------------------------------------------------------------------------
 */
