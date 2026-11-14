import { Router } from 'express';
import mongoose from 'mongoose';

import Activity from '../models/Activity.js';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { loadProjectForMember } from '../lib/projectAccess.js';
import { getLlmClient, isAiUnavailable } from '../lib/llmClient.js';
import { inputTokenBudget } from '../lib/copilotGrounding.js';
import { AI_UNAVAILABLE_MESSAGE, RETRY_AFTER_SECONDS } from './copilot.js';
import {
  LOAD_LIMIT,
  buildCatchUpRequest,
  catchUpWindow,
  countsFrom,
  eventRecord,
  nothingNewMessage,
  readCatchUpAnswer,
} from '../lib/catchUpRules.js';

/*
 * [Sprint 6 · M5] US-44 Catch Me Up (FR-17, NFR-9, NFR-10a, NFR-10b). Mounted at /api/projects/:id/catch-up
 * Rules and limits: lib/catchUpRules.js. AI client: lib/llmClient.js (shared with the Copilot, M3).
 *
 * POST /api/projects/:id/catch-up        (no body)
 *   Signed-in project members only, every role (Viewer included), same as Ask the Copilot.
 *   200 { nothingNew, message, since, until, basis, counts, summary, shortened, sources, context, durationMs, generatedAt }
 *     since / until   the period covered: the member's previous successful login -> now (basis 'previous_login'),
 *                     or the last 7 days when no previous login is known yet (basis 'recent_days')
 *     counts          { tasks, milestones, messages, comments, decisions, github, people, files, project, total }:
 *                     every event in the period by other people, whether or not it fitted in the AI request
 *     nothingNew      true (AC2) when nobody else did anything in the period: message says so, the AI is
 *                     not asked, summary is '' and sources []
 *     summary         short points ("- ..."), each citing events as [E1] or [E2, E5]
 *     sources         [{ ref, type: 'event', category, label, detail, link, external, at }] cited, in order of first use.
 *                     link: an in-app /project/... path, or for GitHub an https://github.com/ link (external: true)
 *     context         { budgetTokens, estimatedTokens, providerInputTokens, included, available, leftOut, trimmed }
 *   401 not signed in · 400 invalid project ID · 404 no such project · 403 not a member (Public projects too)
 *   503 { code: 'AI_UNAVAILABLE', message } + Retry-After  (AC3) AI provider down, slow or not set up.
 *       Nothing else depends on it: chat, tasks and feeds keep working (NFR-9).
 *
 * Only data the member can access (AC1): membership is checked first, then only THIS project's Activity feed
 * (which every member role can read) is used, filtered to the period, without the member's own actions.
 * Read-only: nothing is written (the login times are written by routes/auth.js at login).
 * The summary is not stored and not logged.
 */

const router = Router({ mergeParams: true });
router.use(requireAuth);

router.post('/', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;
    res.set('Cache-Control', 'no-store');

    const requestedAt = new Date();
    const me = await User.findById(req.user.id).select('+lastLoginAt +previousLoginAt').lean();
    const { since, until, basis } = catchUpWindow(me, requestedAt);

    const projectId = loaded.project._id;
    const myId = new mongoose.Types.ObjectId(String(req.user.id));
    // Events in the window by anyone but me. GitHub events have no DevOrbit actor (null), so they stay in.
    const filter = { project: projectId, createdAt: { $gt: since, $lte: until }, actor: { $ne: myId } };

    const [events, perType] = await Promise.all([
      Activity.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .limit(LOAD_LIMIT)
        .select('project actor type summary targetType targetId targetLabel meta createdAt')
        .populate('actor', 'name username')
        .lean(),
      Activity.aggregate([{ $match: filter }, { $group: { _id: '$type', count: { $sum: 1 } } }]),
    ]);
    const counts = countsFrom(perType.map((row) => ({ type: row._id, count: row.count })));

    const base = { since: since.toISOString(), until: until.toISOString(), basis, counts };

    // AC2: nothing happened while I was away. No AI call needed, so this works even when the AI is down.
    if (counts.total === 0) {
      return res.json({
        ...base,
        nothingNew: true,
        message: nothingNewMessage(basis),
        summary: '',
        shortened: false,
        sources: [],
        context: null,
        durationMs: 0,
        generatedAt: new Date().toISOString(),
      });
    }

    const records = events.map((event) => eventRecord(event, String(projectId))).filter(Boolean);
    const request = buildCatchUpRequest({
      projectName: loaded.project.name,
      projectId: String(projectId),
      since,
      until,
      records,
      available: counts.total,
      budgetTokens: inputTokenBudget(),
    });

    let reply;
    try {
      reply = await getLlmClient().complete({ system: request.system, messages: request.messages });
    } catch (error) {
      if (!isAiUnavailable(error)) throw error;
      // AC3. lib/llmClient.js has already logged the reason (provider + HTTP status only).
      res.set('Retry-After', String(RETRY_AFTER_SECONDS));
      return res.status(503).json({ code: 'AI_UNAVAILABLE', message: AI_UNAVAILABLE_MESSAGE });
    }

    const read = readCatchUpAnswer(reply.text, request.sources);
    if (!read.summary) {
      // An empty reply is no summary at all: treat it like the AI being unavailable.
      res.set('Retry-After', String(RETRY_AFTER_SECONDS));
      return res.status(503).json({ code: 'AI_UNAVAILABLE', message: AI_UNAVAILABLE_MESSAGE });
    }
    const inputTokens = reply.usage?.inputTokens;
    return res.json({
      ...base,
      nothingNew: false,
      message: '',
      summary: read.summary,
      shortened: Boolean(reply.truncated || read.shortened),
      sources: read.sources,
      context: { ...request.context, providerInputTokens: Number.isSafeInteger(inputTokens) ? inputTokens : null },
      durationMs: Number.isFinite(reply.durationMs) ? reply.durationMs : Date.now() - requestedAt.getTime(),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
