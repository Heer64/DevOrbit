/*
 * [Sprint 5 · M6] Public post rules for the browser (US-50, US-51).
 * Same numbers as backend/src/lib/postRules.js. The server checks everything again;
 * these checks only give a quicker message before uploading.
 */

export const POST_TEXT_MAX = 500;
export const MAX_POST_IMAGE_MB = 5;
export const MAX_POST_IMAGE_BYTES = MAX_POST_IMAGE_MB * 1024 * 1024;
export const POSTS_PER_HOUR = 10;
export const POST_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const POST_IMAGE_ACCEPT = POST_IMAGE_MIME_TYPES.join(',');

export const POST_TEXT_REQUIRED_MESSAGE = 'Write something before posting.';
export const POST_TEXT_TOO_LONG_MESSAGE = `Posts must be ${POST_TEXT_MAX} characters or fewer.`;
export const POST_IMAGE_TOO_LARGE_MESSAGE = `Images must be ${MAX_POST_IMAGE_MB} MB or smaller.`;
export const POST_IMAGE_TYPE_MESSAGE = 'Only JPEG, PNG or WebP images can be added to a post.';
export const POST_CREATED_MESSAGE = 'Your post is published.';

// Same cleaning as the server for counting: Windows line endings count as one character, ends trimmed.
export function postTextLength(text) {
  return String(text || '').replace(/\r\n?/g, '\n').trim().length;
}

// Returns an error message, or '' when the text can be posted.
export function checkPostText(text) {
  const length = postTextLength(text);
  if (length === 0) return POST_TEXT_REQUIRED_MESSAGE;
  if (length > POST_TEXT_MAX) return POST_TEXT_TOO_LONG_MESSAGE;
  return '';
}

// Returns an error message, or '' when the picked image can be uploaded.
export function checkPostImage(file) {
  if (!file) return '';
  if (!POST_IMAGE_MIME_TYPES.includes(String(file.type || '').toLowerCase())) return POST_IMAGE_TYPE_MESSAGE;
  if (file.size > MAX_POST_IMAGE_BYTES) return POST_IMAGE_TOO_LARGE_MESSAGE;
  if (file.size === 0) return 'This image file is empty. Choose another image.';
  return '';
}

// A readable message for a failed request. 429 keeps the server's "try again in N minutes" text.
export function postErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback;
  if (error.status === 429) {
    return error.message || `You can create up to ${POSTS_PER_HOUR} posts per hour. Please try again later.`;
  }
  if (error.status === 413) return POST_IMAGE_TOO_LARGE_MESSAGE;
  if (error.status === 403) return error.message || 'You can only edit or delete your own posts.';
  if (error.status === 404) return error.message || 'Post not found. It may have been deleted.';
  return error.message || fallback;
}

// "just now", "5 min ago", "3 h ago", "2 d ago", then a date.
export function postTimeAgo(date, now = Date.now()) {
  const time = new Date(date).getTime();
  if (!Number.isFinite(time)) return '';
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
