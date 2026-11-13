import { Router } from 'express';
import multer from 'multer';

import Post from '../models/Post.js';
import PostCreateLog from '../models/PostCreateLog.js';
import { requireAuth } from '../middleware/auth.js';
import { validId } from '../lib/projectAccess.js';
import {
  MAX_POST_IMAGE_BYTES,
  POST_CREATED_MESSAGE,
  POST_DELETED_MESSAGE,
  POST_IMAGE_FIELD,
  POST_IMAGE_TOO_LARGE_MESSAGE,
  POST_NOT_AUTHOR_MESSAGE,
  POST_NOT_FOUND_MESSAGE,
  POST_ONE_IMAGE_MESSAGE,
  POST_TEXT_TOO_LONG_MESSAGE,
  POST_UPDATED_MESSAGE,
  POST_WINDOW_MS,
  checkPostImage,
  isPostAuthor,
  postRateLimit,
  postView,
  readPageLimit,
  readPostText,
} from '../lib/postRules.js';
import { deletePostImage, openPostImage, postImageExists, storePostImage } from '../lib/postImages.js';
import { attachMyVotes, deleteVotesForPost } from '../lib/postVotes.js'; // [Sprint 5 · M7] US-52
import { deleteOpenReportsForPost } from '../lib/postReports.js'; // [Sprint 6 · M6] US-55

/*
 * [Sprint 5 · M6] Public posts (US-50 Create a public post, US-51 Edit or delete my post;
 * FR-23, NFR-16, NFR-26). Mounted at /api/posts (see app.js). Posts belong to no project.
 *
 * GET    /                     logged in.  ?limit=1..50 (default 20) &before=<postId> &author=<userId>
 *        -> { posts, nextBefore }   newest first; nextBefore is null on the last page
 *           (Sprint 5 M8 adds the trending order for the feed, US-53)
 * GET    /:postId              logged in  -> { post }
 * POST   /                     logged in
 *        multipart/form-data: "text" (required, ≤ 500 chars) + optional ONE image in "image"
 *        (JPEG/PNG/WebP by its real bytes, ≤ 5 MB). JSON { text } also works for text-only posts.
 *        -> 201 { post, message: 'Your post is published.' }
 *        400 { message } text missing / too long, wrong image type, empty image, extra files
 *        413 { message, code: 'image_too_large', maxBytes }  image over 5 MB (nothing is stored)
 *        429 { message, code: 'post_rate_limited', retryAfterSeconds } + Retry-After header
 *            when the user already created 10 posts in the last hour
 * PATCH  /:postId              author only, JSON { text }
 *        -> { post, message }   the post now has edited: true
 *        403 { message } not the author      404 unknown or deleted post
 * DELETE /:postId              author only (the UI asks for confirmation first)
 *        -> { postId, message }  the post and its image are removed
 *        403 not the author      404 unknown or already deleted
 * GET    /:postId/image        NO login needed (an <img> tag cannot send the Bearer token)
 *        -> the image bytes with their checked type; 404 when the post or image is gone
 *
 * Each post: see postView() in lib/postRules.js, plus myVote (1, -1 or 0) for the logged-in user.
 * [Sprint 5 · M7] Voting (US-52) lives in routes/postVotes.js: PUT/DELETE /api/posts/:postId/vote.
 * [Sprint 6 · M6] Reporting (US-55) lives in routes/postReports.js: GET/POST /api/posts/:postId/report.
 */

const router = Router();
const AUTHOR_FIELDS = 'name username avatarUrl';

const parseUpload = multer({
  storage: multer.memoryStorage(),
  // fields: only "text". fieldSize leaves room for 500 characters of any language (up to 4 bytes each).
  limits: { fileSize: MAX_POST_IMAGE_BYTES, files: 1, fields: 1, fieldSize: 4 * 1024, parts: 2 },
}).single(POST_IMAGE_FIELD);

function readUpload(req, res) {
  return new Promise((resolve) => {
    parseUpload(req, res, (error) => resolve(error || null));
  });
}

// Turns a multer error into the answer for the client. Returns true when it answered.
function answerUploadError(error, res) {
  if (!error) return false;
  if (error.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ message: POST_IMAGE_TOO_LARGE_MESSAGE, code: 'image_too_large', maxBytes: MAX_POST_IMAGE_BYTES });
    return true;
  }
  if (error.code === 'LIMIT_FIELD_VALUE') {
    res.status(400).json({ message: POST_TEXT_TOO_LONG_MESSAGE });
    return true;
  }
  if (error.name === 'MulterError') {
    res.status(400).json({ message: POST_ONE_IMAGE_MESSAGE });
    return true;
  }
  res.status(400).json({ message: 'The post could not be read. Please try again.' });
  return true;
}

async function findPost(req, res) {
  if (!validId(req.params.postId)) {
    res.status(400).json({ message: 'Invalid post ID.' });
    return null;
  }
  const post = await Post.findById(req.params.postId);
  if (!post) {
    res.status(404).json({ message: POST_NOT_FOUND_MESSAGE });
    return null;
  }
  return post;
}

// Loads a post the current user wrote. Answers 400/404/403 and returns null otherwise (US-51 AC3).
async function findOwnPost(req, res) {
  const post = await findPost(req, res);
  if (!post) return null;
  if (!isPostAuthor(post, req.user.id)) {
    res.status(403).json({ message: POST_NOT_AUTHOR_MESSAGE });
    return null;
  }
  return post;
}

async function viewOf(postId, viewerId) {
  const saved = await Post.findById(postId).populate('author', AUTHOR_FIELDS).lean();
  const [view] = await attachMyVotes([postView(saved, viewerId)], viewerId); // [Sprint 5 · M7] myVote
  return view;
}

// --- Image: before requireAuth on purpose (see the header) --------------------------------------

router.get('/:postId/image', async (req, res, next) => {
  try {
    if (!validId(req.params.postId)) return res.status(400).json({ message: 'Invalid post ID.' });
    const post = await Post.findById(req.params.postId).select('image').lean();
    if (!post?.image?.storageId || !(await postImageExists(post.image.storageId))) {
      return res.status(404).json({ message: 'Image not found.' });
    }

    res.set({
      'Content-Type': post.image.contentType,
      'Content-Length': String(post.image.size),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'cross-origin',
      // Short cache: a deleted post's image should stop showing soon.
      'Cache-Control': 'public, max-age=300',
    });
    const stream = openPostImage(post.image.storageId);
    stream.once('error', (error) => {
      if (!res.headersSent) next(error);
      else res.destroy(error);
    });
    stream.pipe(res);
    return undefined;
  } catch (error) {
    return next(error);
  }
});

router.use(requireAuth);

// --- Read ---------------------------------------------------------------------------------------

router.get('/', async (req, res, next) => {
  try {
    const limit = readPageLimit(req.query.limit);
    const filter = {};

    if (req.query.before !== undefined) {
      if (!validId(req.query.before)) return res.status(400).json({ message: 'Invalid "before" post ID.' });
      filter._id = { $lt: req.query.before };
    }
    if (req.query.author !== undefined) {
      if (!validId(req.query.author)) return res.status(400).json({ message: 'Invalid author ID.' });
      filter.author = req.query.author;
    }

    // ObjectIds grow with creation time, so _id descending is newest first and a stable cursor.
    const rows = await Post.find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .populate('author', AUTHOR_FIELDS)
      .lean();

    const page = rows.slice(0, limit);
    return res.json({
      posts: await attachMyVotes(page.map((post) => postView(post, req.user.id)), req.user.id), // [Sprint 5 · M7] myVote
      nextBefore: rows.length > limit ? String(page[page.length - 1]._id) : null,
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:postId', async (req, res, next) => {
  try {
    const post = await findPost(req, res);
    if (!post) return undefined;
    return res.json({ post: await viewOf(post._id, req.user.id) });
  } catch (error) {
    return next(error);
  }
});

// --- Create (US-50) -----------------------------------------------------------------------------

router.post('/', async (req, res, next) => {
  try {
    const uploadError = await readUpload(req, res);
    if (answerUploadError(uploadError, res)) return undefined;

    // AC3: a post that fails validation is refused with a message saying why. Nothing is stored.
    const text = readPostText(req.body?.text);
    if (!text.ok) return res.status(400).json({ message: text.message });

    const image = checkPostImage(req.file);
    if (!image.ok) {
      const body = { message: image.message, code: image.code };
      if (image.status === 413) body.maxBytes = MAX_POST_IMAGE_BYTES;
      return res.status(image.status).json(body);
    }

    // AC2 / NFR-16: at most 10 posts per rolling hour. The slot is taken FIRST and then counted,
    // so two requests sent at the same moment cannot both slip in as the 10th post.
    const slot = await PostCreateLog.create({ user: req.user.id });
    const since = new Date(Date.now() - POST_WINDOW_MS);
    const recent = await PostCreateLog.find({ user: req.user.id, createdAt: { $gte: since } })
      .sort({ createdAt: 1 })
      .select('createdAt')
      .lean();
    const limited = postRateLimit(recent.length, recent[0]?.createdAt);
    if (limited) {
      await PostCreateLog.deleteOne({ _id: slot._id });
      res.set('Retry-After', String(limited.retryAfterSeconds));
      return res.status(429).json({
        message: limited.message,
        code: 'post_rate_limited',
        retryAfterSeconds: limited.retryAfterSeconds,
      });
    }

    let storageId = null;
    let created;
    try {
      if (image.type) {
        storageId = await storePostImage({ buffer: req.file.buffer, type: image.type, userId: req.user.id });
      }
      created = await Post.create({
        author: req.user.id,
        text: text.value,
        image: storageId ? { storageId, contentType: image.type.mime, size: req.file.size } : null,
      });
    } catch (error) {
      // Nothing was published: give the slot back and remove any stored bytes.
      await deletePostImage(storageId);
      await PostCreateLog.deleteOne({ _id: slot._id }).catch(() => {});
      throw error;
    }

    return res.status(201).json({ post: await viewOf(created._id, req.user.id), message: POST_CREATED_MESSAGE });
  } catch (error) {
    return next(error);
  }
});

// --- Edit and delete (US-51) --------------------------------------------------------------------

router.patch('/:postId', async (req, res, next) => {
  try {
    const post = await findOwnPost(req, res);
    if (!post) return undefined;

    const text = readPostText(req.body?.text);
    if (!text.ok) return res.status(400).json({ message: text.message });

    // Saving the same text again is not an edit, so it does not get the "edited" mark.
    if (text.value !== post.text) {
      post.text = text.value;
      post.editedAt = new Date();
      await post.save();
    }

    return res.json({ post: await viewOf(post._id, req.user.id), message: POST_UPDATED_MESSAGE });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:postId', async (req, res, next) => {
  try {
    const post = await findOwnPost(req, res);
    if (!post) return undefined;

    // Only delete what is still there and still this author's (two delete clicks answer 200 then 404).
    const removed = await Post.findOneAndDelete({ _id: post._id, author: req.user.id });
    if (!removed) return res.status(404).json({ message: POST_NOT_FOUND_MESSAGE });
    await deletePostImage(removed.image?.storageId);
    // AC2 "its votes no longer count": the score lives on the post, which is gone, so it drops out
    // of every feed and every total. [Sprint 5 · M7] The vote rows of the post are removed too.
    await deleteVotesForPost(removed._id);
    // [Sprint 6 · M6] US-55: a deleted post has nothing left to review, so its open reports leave the moderator queue.
    await deleteOpenReportsForPost(removed._id);

    return res.json({ postId: String(removed._id), message: POST_DELETED_MESSAGE });
  } catch (error) {
    return next(error);
  }
});

export default router;

/*
 * ---------------------------------------------------------------------------
 * [Sprint 5 · M6] What this file does
 * REST API for public posts: list and read them (logged in), create one with up to
 * 500 characters of text and one optional JPEG/PNG/WebP image up to 5 MB (10 per user
 * per hour), and let ONLY the author edit the text (marked "edited") or delete it.
 * Anyone else gets 403. Images are stored in MongoDB GridFS and served at /:postId/image.
 * ---------------------------------------------------------------------------
 */
