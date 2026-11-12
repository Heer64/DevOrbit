import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { loadProjectForMember } from '../lib/projectAccess.js';
import { buildCopilotPrompt, checkQuestion, shapeAnswer } from '../lib/copilotRules.js';
import { getLlmClient, isAiUnavailable } from '../lib/llmClient.js';

/*
 * [Sprint 6 · M3] Ask the Copilot (US-41, FR-16a, NFR-9, NFR-10a). Mounted at /api/projects/:id/copilot
 *
 * POST /api/projects/:id/copilot/ask   { question }
 *   Signed-in project members only, every role (Viewer included: "Use Copilot" is Yes for all roles in
 *   the role-permission matrix).
 *   200 { question, answer, shortened, askedAt, answeredAt, durationMs }
 *         question    what was sent, after trimming
 *         shortened   true when the answer was cut (model output limit or ANSWER_MAX_CHARS)
 *         durationMs  time spent waiting for the AI provider
 *   400 { code: 'QUESTION_REQUIRED' | 'QUESTION_TOO_LONG', message }   empty, or over 500 characters
 *   401 not signed in · 400 invalid project ID · 404 no such project · 403 not a member (Public projects too)
 *   503 { code: 'AI_UNAVAILABLE', message } + Retry-After   AI provider down, slow, refusing, or not set up.
 *       Nothing else is affected: chat, tasks and feeds do not use the AI (NFR-9).
 *
 * The Copilot only answers (FR document, Out of Scope: no autonomous AI actions). This route reads the
 * project to check membership and writes nothing: no database change, no activity entry, no notification.
 * The question and the answer are not stored and not logged.
 *
 * The AI call goes through the shared client in lib/llmClient.js (timeout, outage pause, no secrets in
 * logs). [Sprint 6 · M4] US-42/US-43 adds the permitted project records (8,000-token budget, source links,
 * "not enough project data") where the prompt is built below.
 */
export const AI_UNAVAILABLE_MESSAGE = 'AI temporarily unavailable. Chat, tasks and feeds still work. Please try again in a minute.';
export const RETRY_AFTER_SECONDS = 30;

const router = Router({ mergeParams: true });
router.use(requireAuth);

router.post('/ask', async (req, res, next) => {
  try {
    // Membership first, so a non-member learns nothing from the question checks.
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;

    const checked = checkQuestion(req.body?.question);
    if (!checked.ok) return res.status(400).json({ code: checked.code, message: checked.message });

    const askedAt = new Date();
    const prompt = buildCopilotPrompt({ projectName: loaded.project.name, question: checked.question });

    let reply;
    try {
      reply = await getLlmClient().complete(prompt);
    } catch (error) {
      if (!isAiUnavailable(error)) throw error;
      // lib/llmClient.js has already logged the reason (provider + HTTP status only).
      res.set('Retry-After', String(RETRY_AFTER_SECONDS));
      res.set('Cache-Control', 'no-store');
      return res.status(503).json({ code: 'AI_UNAVAILABLE', message: AI_UNAVAILABLE_MESSAGE });
    }

    const shaped = shapeAnswer(reply.text);
    res.set('Cache-Control', 'no-store');
    return res.json({
      question: checked.question,
      answer: shaped.answer,
      shortened: Boolean(reply.truncated || shaped.shortened),
      askedAt: askedAt.toISOString(),
      answeredAt: new Date().toISOString(),
      durationMs: Number.isFinite(reply.durationMs) ? reply.durationMs : Date.now() - askedAt.getTime(),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
