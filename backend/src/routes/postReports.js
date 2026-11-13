import { Router } from 'express';

import Post from '../models/Post.js';
import PostReport from '../models/PostReport.js';
import { requireAuth } from '../middleware/auth.js';
import { validId } from '../lib/projectAccess.js';
import { POST_NOT_FOUND_MESSAGE, isPostAuthor } from '../lib/postRules.js';
import { REPORT_ALREADY_MESSAGE, REPORT_CREATED_MESSAGE, REPORT_OWN_POST_MESSAGE, readReport } from '../lib/reportRules.js';
import { createReport, findMyReport } from '../lib/postReports.js';

/*
 * [Sprint 6 · M6] Report a public post (US-55; FR-27, NFR-19, NFR-21, NFR-26).
 * Mounted at /api/posts/:postId/report (see app.js), before the M6 post routes. Login needed.
 *
 * GET  /   -> 200 { reported: boolean, report | null }
 *          Lets the app say "You have already reported this post." before the user fills in the form.
 *
 * POST /   JSON { reason, details? }
 *          reason   one of: spam | harassment | hate | violence | explicit | other  (lib/reportRules.js)
 *          details  optional text up to 300 characters; required when reason is "other"
 *   -> 201 { report, message: 'Thanks. Your report was sent to the moderators.' }
 *          The report is stored as "open", so it is in the moderator queue (US-56, lib/postReports.js).
 *   400 { message }                       invalid post ID
 *   400 { message, field }                missing/unknown reason, details not text, too long, or missing for "other"
 *   400 { message, code: 'own_post' }     you cannot report your own post
 *   401                                   not logged in
 *   404 { message }                       unknown or deleted post
 *   409 { message: 'You have already reported this post.', code: 'already_reported', report }   (US-55 AC2)
 *
 * report: { _id, post, reason, reasonLabel, details, status, createdAt } — never who else reported it.
 */

const router = Router({ mergeParams: true });

router.use(requireAuth);

// Loads the reported post (only what is needed). Answers 400/404 and returns null otherwise.
async function findReportablePost(req, res) {
  if (!validId(req.params.postId)) {
    res.status(400).json({ message: 'Invalid post ID.' });
    return null;
  }
  const post = await Post.findById(req.params.postId).select('author').lean();
  if (!post) {
    res.status(404).json({ message: POST_NOT_FOUND_MESSAGE });
    return null;
  }
  return post;
}

router.get('/', async (req, res, next) => {
  try {
    const post = await findReportablePost(req, res);
    if (!post) return undefined;
    const report = await findMyReport(post._id, req.user.id);
    return res.json({ reported: Boolean(report), report });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const post = await findReportablePost(req, res);
    if (!post) return undefined;

    // NFR-21: the reason and details are checked here before anything is stored.
    const input = readReport(req.body);
    if (!input.ok) return res.status(400).json({ message: input.message, field: input.field });

    if (isPostAuthor(post, req.user.id)) {
      return res.status(400).json({ message: REPORT_OWN_POST_MESSAGE, code: 'own_post' });
    }

    const result = await createReport({
      postId: post._id,
      reporterId: req.user.id,
      reason: input.reason,
      details: input.details,
    });

    // AC2: a second report by the same user is not stored; they are told they already reported it.
    if (result.outcome === 'already_reported') {
      return res.status(409).json({ message: REPORT_ALREADY_MESSAGE, code: 'already_reported', report: result.report });
    }

    // The author may have deleted the post while this request was running. Do not leave a report
    // in the moderator queue for a post that no longer exists.
    if (!(await Post.exists({ _id: post._id }))) {
      await PostReport.deleteOne({ _id: result.report._id });
      return res.status(404).json({ message: POST_NOT_FOUND_MESSAGE });
    }

    return res.status(201).json({ report: result.report, message: REPORT_CREATED_MESSAGE });
  } catch (error) {
    return next(error);
  }
});

export default router;

/*
 * ---------------------------------------------------------------------------
 * [Sprint 6 · M6] What this file does
 * REST API for reporting a public post: a logged-in user picks a reason (and may add details),
 * the report is stored as "open" so it reaches the moderator queue, a second report of the same
 * post by the same user is answered with "You have already reported this post.", and nobody can
 * report their own post. GET tells the app whether the user already reported the post.
 * ---------------------------------------------------------------------------
 */
