// [Sprint 5 · M6] US-50 / US-51 post rules (no database needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_POST_IMAGE_BYTES,
  POSTS_PER_HOUR,
  POST_IMAGE_EMPTY_MESSAGE,
  POST_IMAGE_TOO_LARGE_MESSAGE,
  POST_IMAGE_TYPE_MESSAGE,
  POST_TEXT_MAX,
  POST_TEXT_REQUIRED_MESSAGE,
  POST_TEXT_TOO_LONG_MESSAGE,
  POST_TEXT_TYPE_MESSAGE,
  POST_WINDOW_MS,
  checkPostImage,
  detectPostImageType,
  isPostAuthor,
  normalizePostText,
  postRateLimit,
  postView,
  readPageLimit,
  readPostText,
} from '../src/lib/postRules.js';

const jpeg = (size = 64) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size - 4, 1)]);
const png = (size = 64) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(size - 8, 1)]);
const webp = (size = 64) => {
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(size - 8, 4);
  head.write('WEBP', 8, 'ascii');
  return Buffer.concat([head, Buffer.alloc(size - 12, 1)]);
};

test('limits match US-50: 500 characters, 5 MB, 10 posts per hour', () => {
  assert.equal(POST_TEXT_MAX, 500);
  assert.equal(MAX_POST_IMAGE_BYTES, 5 * 1024 * 1024);
  assert.equal(POSTS_PER_HOUR, 10);
  assert.equal(POST_WINDOW_MS, 3_600_000);
});

test('text: required, trimmed, line breaks kept, up to 500 characters', () => {
  assert.deepEqual(readPostText(undefined), { ok: false, message: POST_TEXT_REQUIRED_MESSAGE });
  assert.deepEqual(readPostText('   \n\t '), { ok: false, message: POST_TEXT_REQUIRED_MESSAGE });
  assert.deepEqual(readPostText(42), { ok: false, message: POST_TEXT_TYPE_MESSAGE });
  assert.deepEqual(readPostText({ text: 'x' }), { ok: false, message: POST_TEXT_TYPE_MESSAGE });
  assert.deepEqual(readPostText('  Hello\r\nworld  '), { ok: true, value: 'Hello\nworld' });
  assert.deepEqual(readPostText('a'.repeat(500)), { ok: true, value: 'a'.repeat(500) });
  assert.deepEqual(readPostText(`  ${'a'.repeat(500)}  `), { ok: true, value: 'a'.repeat(500) });
  assert.deepEqual(readPostText('a'.repeat(501)), { ok: false, message: POST_TEXT_TOO_LONG_MESSAGE });
});

test('text: invisible control characters are removed, tabs and new lines stay', () => {
  assert.equal(normalizePostText('a\u0000b\u0007c\td\ne\u007f'), 'abc\td\ne');
  assert.deepEqual(readPostText('\u0000\u0001'), { ok: false, message: POST_TEXT_REQUIRED_MESSAGE });
});

test('image type is decided by the real bytes, not the name', () => {
  assert.equal(detectPostImageType(jpeg()).mime, 'image/jpeg');
  assert.equal(detectPostImageType(png()).mime, 'image/png');
  assert.equal(detectPostImageType(webp()).mime, 'image/webp');
  assert.equal(detectPostImageType(Buffer.from('GIF89a................')), null);
  assert.equal(detectPostImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(detectPostImageType(Buffer.from('RIFF0000WAVEfmt ')), null); // RIFF but audio
  assert.equal(detectPostImageType(Buffer.from([0xff, 0xd8])), null); // too short
  assert.equal(detectPostImageType(null), null);
});

test('checkPostImage: no image is fine; empty, too big or wrong type is refused', () => {
  assert.deepEqual(checkPostImage(undefined), { ok: true, type: null });
  assert.equal(checkPostImage({ buffer: png(), size: 64 }).type.ext, 'png');
  assert.equal(checkPostImage({ buffer: jpeg(MAX_POST_IMAGE_BYTES), size: MAX_POST_IMAGE_BYTES }).ok, true);

  assert.deepEqual(checkPostImage({ buffer: Buffer.alloc(0), size: 0 }), { ok: false, status: 400, message: POST_IMAGE_EMPTY_MESSAGE, code: 'image_empty' });
  assert.deepEqual(checkPostImage({ buffer: jpeg(), size: MAX_POST_IMAGE_BYTES + 1 }), { ok: false, status: 413, message: POST_IMAGE_TOO_LARGE_MESSAGE, code: 'image_too_large' });
  assert.deepEqual(checkPostImage({ buffer: Buffer.from('%PDF-1.7 fake pdf file'), size: 22 }), { ok: false, status: 400, message: POST_IMAGE_TYPE_MESSAGE, code: 'image_type' });
});

test('only the author counts as the author (US-51 AC3)', () => {
  const author = 'a'.repeat(24);
  assert.equal(isPostAuthor({ author }, author), true);
  assert.equal(isPostAuthor({ author: { _id: author, name: 'A' } }, author), true);
  assert.equal(isPostAuthor({ author }, 'b'.repeat(24)), false);
  assert.equal(isPostAuthor({ author }, null), false);
  assert.equal(isPostAuthor(null, author), false);
});

test('rate limit: posts 1-10 in an hour pass, the 11th is refused with a wait time', () => {
  const now = Date.parse('2026-11-07T12:00:00Z');
  for (let count = 1; count <= POSTS_PER_HOUR; count += 1) assert.equal(postRateLimit(count, now - 1000, now), null);

  const oldest = now - 45 * 60 * 1000; // the oldest post in the window was 45 minutes ago
  const limited = postRateLimit(POSTS_PER_HOUR + 1, oldest, now);
  assert.equal(limited.retryAfterSeconds, 15 * 60);
  assert.equal(limited.message, 'You can create up to 10 posts per hour. Please try again in 15 minutes.');

  assert.match(postRateLimit(11, now - POST_WINDOW_MS + 20_000, now).message, /try again in 1 minute\.$/);
  assert.ok(postRateLimit(11, null, now).retryAfterSeconds >= 1);
});

test('page size: default 20, at most 50', () => {
  assert.equal(readPageLimit(undefined), 20);
  assert.equal(readPageLimit('abc'), 20);
  assert.equal(readPageLimit('0'), 20);
  assert.equal(readPageLimit('5'), 5);
  assert.equal(readPageLimit('500'), 50);
});

test('postView: API shape with author, image link, edited mark and score fields', () => {
  const id = 'c'.repeat(24);
  const author = { _id: 'a'.repeat(24), name: 'Asha', username: 'asha', avatarUrl: '', email: 'secret@example.com' };
  const view = postView({
    _id: id,
    author,
    text: 'Hello',
    image: { storageId: 'd'.repeat(24), contentType: 'image/png', size: 64 },
    editedAt: new Date('2026-11-07T10:00:00Z'),
    createdAt: new Date('2026-11-07T09:00:00Z'),
    updatedAt: new Date('2026-11-07T10:00:00Z'),
  }, author._id);

  assert.equal(view._id, id);
  assert.deepEqual(view.author, { _id: author._id, name: 'Asha', username: 'asha', avatarUrl: '' });
  assert.equal(view.imageUrl, `/api/posts/${id}/image`);
  assert.deepEqual(view.image, { contentType: 'image/png', size: 64 });
  assert.equal(view.edited, true);
  assert.equal(view.isMine, true);
  assert.deepEqual([view.upvotes, view.downvotes, view.score], [0, 0, 0]);
  assert.equal('storageId' in view.image, false);
  assert.equal(JSON.stringify(view).includes('secret@example.com'), false);

  const plain = postView({ _id: id, author, text: 'Hi', image: null, editedAt: null }, 'b'.repeat(24));
  assert.equal(plain.imageUrl, null);
  assert.equal(plain.image, null);
  assert.equal(plain.edited, false);
  assert.equal(plain.isMine, false);
  assert.equal(JSON.stringify(plain).includes('likes'), false); // NFR-27: "score", never "likes"
});
