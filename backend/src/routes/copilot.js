import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { loadProjectForMember } from '../lib/projectAccess.js';
import { checkQuestion, shapeAnswer } from '../lib/copilotRules.js';
import { getLlmClient, isAiUnavailable } from '../lib/llmClient.js';
import { loadCopilotRecords } from '../lib/copilotContext.js'; // [Sprint 6 · M4] US-42
import { NOT_ENOUGH_DATA_ANSWER, buildGroundedRequest, citedRefs, inputTokenBudget, readGroundedAnswer } from '../lib/copilotGrounding.js'; // [Sprint 6 · M4] US-42, US-43

/*
 * [Sprint 6 · M3] Ask the Copilot (US-41, FR-16a, NFR-9, NFR-10a). Mounted at /api/projects/:id/copilot
 * [Sprint 6 · M4] Answers grounded in project data (US-42, US-43, FR-16b, FR-16c, FR-36, NFR-10b).
 *
 * POST /api/projects/:id/copilot/ask   { question }
 *   Signed-in project members only, every role (Viewer included: "Use Copilot" is Yes for all roles in
 *   the role-permission matrix).
 *   200 { question, answer, shortened, askedAt, answeredAt, durationMs, insufficient, sources, context }
 *         question      what was sent, after trimming
 *         shortened     true when the answer was cut (model output limit or ANSWER_MAX_CHARS)
 *         durationMs    time spent waiting for the AI provider (0 when it was not asked)
 *         [M4] insufficient  true = "not enough project data" (US-43): the answer is the fixed
 *                            NOT_ENOUGH_DATA_ANSWER and there are no sources
 *         [M4] sources       [{ ref, type, label, detail, link, external, at }] the records the answer cites,
 *                            in order of first use. The answer text cites them as [T1], [M2, D1] ...
 *                            type: task | decision | message | comment | github. link: an in-app path
 *                            (/project/...) or, for GitHub, an https://github.com/ link (external: true)
 *         [M4] context       { budgetTokens, estimatedTokens, providerInputTokens, included, available,
 *                            leftOut, trimmed }: how many records of each kind were used / exist, and
 *                            whether some were left out to stay within the input budget (NFR-10b)
 *   400 { code: 'QUESTION_REQUIRED' | 'QUESTION_TOO_LONG', message }   empty, or over 500 characters
 *   401 not signed in · 400 invalid project ID · 404 no such project · 403 not a member (Public projects too)
 *   503 { code: 'AI_UNAVAILABLE', message } + Retry-After   AI provider down, slow, refusing, or not set up.
 *       Nothing else is affected: chat, tasks and feeds do not use the AI (NFR-9).
 *
 * [M4] How an answer is built (lib/copilotContext.js + lib/copilotGrounding.js, README "Sprint 6 — M4"):
 *   1. Membership is checked first; then only THIS project's tasks, task comments, decisions, channel
 *      messages and GitHub activity are read. Every member role may read all of these.
 *   2. They are ranked against the question and added while the whole request stays within the input
 *      budget (8,000 tokens; COPILOT_MAX_INPUT_TOKENS can lower it). The rest is counted as left out.
 *   3. No records at all -> "not enough project data" at once, without asking the AI.
 *   4. The AI must cite record ids. Answers it marks NOT_ENOUGH_PROJECT_DATA, or that cite no record,
 *      become the fixed "not enough project data" answer, so no unsupported project claim is shown.
 *
 * The Copilot only answers (FR document, Out of Scope: no autonomous AI actions). This route reads the
 * project data and writes nothing: no database change, no activity entry, no notification.
 * The question and the answer are not stored and not logged.
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

    // [Sprint 6 · M4] US-42: the member's permitted project data, trimmed to the input budget.
    const { records, available } = await loadCopilotRecords(loaded.project);
    const grounded = buildGroundedRequest({
      projectName: loaded.project.name,
      projectId: String(loaded.project._id),
      question: checked.question,
      records,
      available,
      budgetTokens: inputTokenBudget(),
      today: askedAt,
    });
    const context = { ...grounded.context, providerInputTokens: null };
    res.set('Cache-Control', 'no-store');

    // [Sprint 6 · M4] US-43: nothing to ground an answer in, so say so without asking the AI.
    if (grounded.included.length === 0) {
      return res.json({
        question: checked.question,
        answer: NOT_ENOUGH_DATA_ANSWER,
        shortened: false,
        askedAt: askedAt.toISOString(),
        answeredAt: new Date().toISOString(),
        durationMs: 0,
        insufficient: true,
        sources: [],
        context,
      });
    }

    let reply;
    try {
      reply = await getLlmClient().complete({ system: grounded.system, messages: grounded.messages });
    } catch (error) {
      if (!isAiUnavailable(error)) throw error;
      // lib/llmClient.js has already logged the reason (provider + HTTP status only).
      res.set('Retry-After', String(RETRY_AFTER_SECONDS));
      return res.status(503).json({ code: 'AI_UNAVAILABLE', message: AI_UNAVAILABLE_MESSAGE });
    }

    // [Sprint 6 · M4] US-42 sources, US-43 "not enough project data".
    const read = readGroundedAnswer(reply.text, grounded.sources);
    const shaped = shapeAnswer(read.answer);
    // A cut answer only keeps the sources it still cites.
    const sources = read.insufficient ? [] : citedRefs(shaped.answer, grounded.sources).map((ref) => grounded.sources.get(ref));
    const inputTokens = reply.usage?.inputTokens;
    context.providerInputTokens = Number.isSafeInteger(inputTokens) ? inputTokens : null;

    return res.json({
      question: checked.question,
      answer: shaped.answer,
      shortened: Boolean(!read.insufficient && (reply.truncated || shaped.shortened)),
      askedAt: askedAt.toISOString(),
      answeredAt: new Date().toISOString(),
      durationMs: Number.isFinite(reply.durationMs) ? reply.durationMs : Date.now() - askedAt.getTime(),
      insufficient: read.insufficient,
      sources,
      context,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
