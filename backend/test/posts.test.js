// [Sprint 5 · M6] US-50 Create a public post, US-51 Edit or delete my post (FR-23, NFR-16, NFR-26).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { setup, teardown, signup, authed, jpegBytes, pngBytes } from './helpers.js';
import Post from '../src/models/Post.js';
import PostCreateLog from '../src/models/PostCreateLog.js';
import { POST_IMAGES_BUCKET } from '../src/lib/postImages.js';
import {
  MAX_POST_IMAGE_BYTES,
  POST_CREATED_MESSAGE,
  POST_IMAGE_TOO_LARGE_MESSAGE,
  POST_IMAGE_TYPE_MESSAGE,
  POST_NOT_AUTHOR_MESSAGE,
  POST_ONE_IMAGE_MESSAGE,
  POST_TEXT_REQUIRED_MESSAGE,
  POST_TEXT_TOO_LONG_MESSAGE,
  POSTS_PER_HOUR,
} from '../src/lib/postRules.js';

let app;
let asha, ben, spammer, racer;

const as = (account) => authed(app, account.token);

// multipart post: text + optional image
const postWithImage = (account, text, buffer, filename = 'photo.png', contentType = 'image/png') => {
  const req = request(app).post('/api/posts').set('Authorization', `Bearer ${account.token}`).field('text', text);
  return buffer ? req.attach('image', buffer, { filename, contentType }) : req;
};

const webpBytes = (size = 1024) => {
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'ascii');
  head.writeUInt32LE(size - 8, 4);
  head.write('WEBP', 8, 'ascii');
  return Buffer.concat([head, Buffer.alloc(size - 12, 1)]);
};

const readBinary = (url) => request(app).get(url)
  .buffer(true)
  .parse((res, callback) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
  });

const storedImages = () => mongoose.connection.db.collection(`${POST_IMAGES_BUCKET}.files`).countDocuments();
const storedChunks = () => mongoose.connection.db.collection(`${POST_IMAGES_BUCKET}.chunks`).countDocuments();

before(async () => {
  ({ app } = await setup());
  [asha, ben, spammer, racer] = await Promise.all(['Asha Author', 'Ben Other', 'Sam Spammer', 'Rae Racer'].map((name) => signup(app, name)));
});

after(async () => {
  await teardown();
});

// --- Login (NFR-19) -----------------------------------------------------------------------------

test('posting, listing, editing and deleting need a login', async () => {
  const id = new mongoose.Types.ObjectId().toString();
  assert.equal((await request(app).get('/api/posts')).status, 401);
  assert.equal((await request(app).post('/api/posts').send({ text: 'Hi' })).status, 401);
  assert.equal((await request(app).patch(`/api/posts/${id}`).send({ text: 'Hi' })).status, 401);
  assert.equal((await request(app).delete(`/api/posts/${id}`)).status, 401);
});

// --- US-50 Create a public post -----------------------------------------------------------------

test('US-50 AC1: text-only post is published with a success message and appears in the feed', async () => {
  const res = await as(asha).post('/api/posts').send({ text: '  Hello FORGE community!\r\nFirst post.  ' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.message, POST_CREATED_MESSAGE);
  const { post } = res.body;
  assert.equal(post.text, 'Hello FORGE community!\nFirst post.');
  assert.equal(post.author._id, asha.user.id);
  assert.equal(post.author.name, 'Asha Author');
  assert.equal(post.imageUrl, null);
  assert.equal(post.edited, false);
  assert.equal(post.isMine, true);
  assert.deepEqual([post.upvotes, post.downvotes, post.score], [0, 0, 0]);
  assert.equal('project' in post, false); // independent of any project (FR-23)

  const feed = await as(ben).get('/api/posts');
  assert.equal(feed.status, 200);
  const seen = feed.body.posts.find((item) => item._id === post._id);
  assert.ok(seen, 'another logged-in user sees the post');
  assert.equal(seen.isMine, false);
});

test('US-50 AC1: exactly 500 characters is allowed', async () => {
  const res = await as(asha).post('/api/posts').send({ text: 'x'.repeat(500) });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.post.text.length, 500);
});

test('US-50 AC1: a post with one PNG, JPEG or WebP image is stored and the image can be shown', async () => {
  for (const [bytes, filename, type] of [
    [pngBytes(2048), 'shot.png', 'image/png'],
    [jpegBytes(2048), 'photo.jpg', 'image/jpeg'],
    [webpBytes(2048), 'pic.webp', 'image/webp'],
  ]) {
    const res = await postWithImage(asha, `Image post ${type}`, bytes, filename, type);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const { post } = res.body;
    assert.equal(post.imageUrl, `/api/posts/${post._id}/image`);
    assert.deepEqual(post.image, { contentType: type, size: bytes.length });

    // <img> tags send no token, so the image link works without login.
    const image = await readBinary(post.imageUrl);
    assert.equal(image.status, 200);
    assert.equal(image.headers['content-type'], type);
    assert.equal(image.headers['x-content-type-options'], 'nosniff');
    assert.ok(Buffer.compare(image.body, bytes) === 0, 'same bytes come back');
  }
});

test('US-50 AC1: an image of exactly 5 MB is accepted', async () => {
  const res = await postWithImage(asha, 'Big but allowed', pngBytes(MAX_POST_IMAGE_BYTES));
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.post.image.size, MAX_POST_IMAGE_BYTES);
});

test('US-50 AC3: invalid posts are refused with a reason and nothing is stored', async () => {
  const postsBefore = await Post.countDocuments();
  const imagesBefore = await storedImages();
  const chunksBefore = await storedChunks();

  let res = await as(ben).post('/api/posts').send({ text: '   ' });
  assert.equal(res.status, 400);
  assert.equal(res.body.message, POST_TEXT_REQUIRED_MESSAGE);

  res = await as(ben).post('/api/posts').send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.message, POST_TEXT_REQUIRED_MESSAGE);

  res = await as(ben).post('/api/posts').send({ text: 'y'.repeat(501) });
  assert.equal(res.status, 400);
  assert.equal(res.body.message, POST_TEXT_TOO_LONG_MESSAGE);

  // Over 5 MB
  res = await postWithImage(ben, 'Too big', pngBytes(MAX_POST_IMAGE_BYTES + 1));
  assert.equal(res.status, 413);
  assert.equal(res.body.message, POST_IMAGE_TOO_LARGE_MESSAGE);
  assert.equal(res.body.code, 'image_too_large');

  // Named .png and sent as image/png, but the bytes are a GIF: the real type decides.
  res = await postWithImage(ben, 'Fake png', Buffer.from(`GIF89a${'x'.repeat(100)}`), 'fake.png', 'image/png');
  assert.equal(res.status, 400);
  assert.equal(res.body.message, POST_IMAGE_TYPE_MESSAGE);

  // SVG can carry scripts: refused.
  res = await postWithImage(ben, 'Svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.svg', 'image/svg+xml');
  assert.equal(res.status, 400);
  assert.equal(res.body.message, POST_IMAGE_TYPE_MESSAGE);

  // Two images
  res = await request(app).post('/api/posts').set('Authorization', `Bearer ${ben.token}`)
    .field('text', 'Two images')
    .attach('image', pngBytes(), { filename: 'a.png', contentType: 'image/png' })
    .attach('image', pngBytes(), { filename: 'b.png', contentType: 'image/png' });
  assert.equal(res.status, 400);
  assert.equal(res.body.message, POST_ONE_IMAGE_MESSAGE);

  // Good image but no text
  res = await postWithImage(ben, '', pngBytes());
  assert.equal(res.status, 400);
  assert.equal(res.body.message, POST_TEXT_REQUIRED_MESSAGE);

  assert.equal(await Post.countDocuments(), postsBefore);
  assert.equal(await storedImages(), imagesBefore);
  assert.equal(await storedChunks(), chunksBefore);
  // Refused posts do not use up the hourly limit.
  assert.equal(await PostCreateLog.countDocuments({ user: ben.user.id }), 0);
});

test('US-50 AC2 / NFR-16: the 11th post in an hour is refused with a rate-limit message', async () => {
  for (let index = 1; index <= POSTS_PER_HOUR; index += 1) {
    const res = await as(spammer).post('/api/posts').send({ text: `Post number ${index}` });
    assert.equal(res.status, 201, `post ${index}: ${JSON.stringify(res.body)}`);
  }

  const blocked = await as(spammer).post('/api/posts').send({ text: 'One too many' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, 'post_rate_limited');
  assert.match(blocked.body.message, /^You can create up to 10 posts per hour\. Please try again in \d+ minutes?\.$/);
  assert.ok(blocked.body.retryAfterSeconds > 0 && blocked.body.retryAfterSeconds <= 3600);
  assert.equal(blocked.headers['retry-after'], String(blocked.body.retryAfterSeconds));
  assert.equal(await Post.countDocuments({ author: spammer.user.id }), POSTS_PER_HOUR);

  // Deleting a post does not give the slot back.
  const mine = await as(spammer).get(`/api/posts?author=${spammer.user.id}&limit=1`);
  const removed = await as(spammer).delete(`/api/posts/${mine.body.posts[0]._id}`);
  assert.equal(removed.status, 200);
  assert.equal((await as(spammer).post('/api/posts').send({ text: 'Still too many' })).status, 429);

  // Other users are not affected.
  assert.equal((await as(ben).post('/api/posts').send({ text: 'Ben is fine' })).status, 201);

  // An hour later the user can post again.
  await PostCreateLog.updateMany({ user: spammer.user.id }, { $set: { createdAt: new Date(Date.now() - 61 * 60 * 1000) } });
  assert.equal((await as(spammer).post('/api/posts').send({ text: 'Back after an hour' })).status, 201);
});

test('NFR-16: posts sent at the same moment never go over 10 in an hour', async () => {
  const results = await Promise.all(Array.from({ length: 14 }, (_, index) => as(racer).post('/api/posts').send({ text: `Race ${index}` })));
  const statuses = results.map((res) => res.status);
  assert.ok(statuses.every((status) => status === 201 || status === 429), statuses.join(','));
  assert.ok(statuses.filter((status) => status === 201).length <= POSTS_PER_HOUR);
  assert.ok(await Post.countDocuments({ author: racer.user.id }) <= POSTS_PER_HOUR);
});

test('feed: newest first, paged with nextBefore, and filterable by author', async () => {
  const first = await as(ben).get('/api/posts?limit=2');
  assert.equal(first.status, 200);
  assert.equal(first.body.posts.length, 2);
  assert.ok(first.body.nextBefore);
  assert.ok(first.body.posts[0]._id > first.body.posts[1]._id, 'newest first');

  const second = await as(ben).get(`/api/posts?limit=2&before=${first.body.nextBefore}`);
  assert.equal(second.status, 200);
  assert.ok(second.body.posts.every((post) => post._id < first.body.posts[1]._id));

  const byAsha = await as(ben).get(`/api/posts?author=${asha.user.id}&limit=50`);
  assert.ok(byAsha.body.posts.length > 0);
  assert.ok(byAsha.body.posts.every((post) => post.author._id === asha.user.id));

  assert.equal((await as(ben).get('/api/posts?before=nope')).status, 400);
  assert.equal((await as(ben).get('/api/posts?author=nope')).status, 400);
});

// --- US-51 Edit or delete my post ---------------------------------------------------------------

test('US-51 AC1: the author edits the text and the post is marked "edited"', async () => {
  const created = await as(asha).post('/api/posts').send({ text: 'Typo in this psot' });
  const id = created.body.post._id;

  // Saving the same text is not an edit.
  const same = await as(asha).patch(`/api/posts/${id}`).send({ text: 'Typo in this psot' });
  assert.equal(same.status, 200);
  assert.equal(same.body.post.edited, false);

  const res = await as(asha).patch(`/api/posts/${id}`).send({ text: 'Typo in this post (fixed)' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.post.text, 'Typo in this post (fixed)');
  assert.equal(res.body.post.edited, true);
  assert.ok(res.body.post.editedAt);

  const read = await as(ben).get(`/api/posts/${id}`);
  assert.equal(read.body.post.text, 'Typo in this post (fixed)');
  assert.equal(read.body.post.edited, true);

  const tooLong = await as(asha).patch(`/api/posts/${id}`).send({ text: 'z'.repeat(501) });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.body.message, POST_TEXT_TOO_LONG_MESSAGE);
  const empty = await as(asha).patch(`/api/posts/${id}`).send({ text: '' });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.message, POST_TEXT_REQUIRED_MESSAGE);
});

test('US-51 AC3: someone who does not own the post gets 403 for edit and delete', async () => {
  const created = await as(asha).post('/api/posts').send({ text: 'Only Asha may change this' });
  const id = created.body.post._id;

  const edit = await as(ben).patch(`/api/posts/${id}`).send({ text: 'Ben was here' });
  assert.equal(edit.status, 403);
  assert.equal(edit.body.message, POST_NOT_AUTHOR_MESSAGE);

  const del = await as(ben).delete(`/api/posts/${id}`);
  assert.equal(del.status, 403);
  assert.equal(del.body.message, POST_NOT_AUTHOR_MESSAGE);

  const still = await Post.findById(id).lean();
  assert.equal(still.text, 'Only Asha may change this');
  assert.equal(still.editedAt, null);
});

test('US-51 AC2: the author deletes a post; it leaves every feed and its image is removed', async () => {
  const created = await postWithImage(asha, 'Delete me', pngBytes(4096));
  assert.equal(created.status, 201);
  const { post } = created.body;
  const imagesBefore = await storedImages();

  const res = await as(asha).delete(`/api/posts/${post._id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.postId, post._id);

  assert.equal((await as(ben).get(`/api/posts/${post._id}`)).status, 404);
  const feed = await as(ben).get('/api/posts?limit=50');
  assert.equal(feed.body.posts.some((item) => item._id === post._id), false);
  assert.equal(await Post.findById(post._id), null);
  assert.equal(await storedImages(), imagesBefore - 1);
  assert.equal((await request(app).get(post.imageUrl)).status, 404);

  // A second delete finds nothing.
  assert.equal((await as(asha).delete(`/api/posts/${post._id}`)).status, 404);
});

test('unknown or invalid post IDs answer 404 / 400', async () => {
  const missing = new mongoose.Types.ObjectId().toString();
  assert.equal((await as(asha).get(`/api/posts/${missing}`)).status, 404);
  assert.equal((await as(asha).patch(`/api/posts/${missing}`).send({ text: 'x' })).status, 404);
  assert.equal((await as(asha).delete(`/api/posts/${missing}`)).status, 404);
  assert.equal((await as(asha).get('/api/posts/not-an-id')).status, 400);
  assert.equal((await request(app).get(`/api/posts/${missing}/image`)).status, 404);
  assert.equal((await request(app).get('/api/posts/not-an-id/image')).status, 400);
});
