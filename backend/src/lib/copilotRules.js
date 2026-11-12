/*
 * [Sprint 6 · M3] US-41 (FR-16a): rules for "Ask the Copilot". Pure functions, no database, no network.
 *
 *   checkQuestion(raw)            free-text question, up to QUESTION_MAX_CHARS after trimming
 *   buildCopilotPrompt({ ... })   the system prompt + messages sent to the shared LLM client (lib/llmClient.js)
 *   shapeAnswer(text)             trims the reply and caps its length for the response
 *
 * Grounding the answer in the project's permitted messages, tasks, decisions and GitHub activity, the
 * 8,000-token input budget and the "not enough project data" reply are US-42 / US-43 (Sprint 6 · M4).
 * They plug in where buildCopilotPrompt() is called in routes/copilot.js. Until then the prompt tells the
 * model that no project records are attached, so it does not invent project facts.
 *
 * Unit tests: backend/test/copilotRules.test.js
 */

export const QUESTION_MAX_CHARS = 500; // "Copilot limits: Question up to 500 characters" (User Stories, section 3)
export const ANSWER_MAX_CHARS = 4_000;
export const PROJECT_NAME_MAX_CHARS = 80; // same limit as the project name itself

/**
 * checkQuestion(raw) -> { ok: true, question } | { ok: false, code, message }
 * Line endings are normalised and the text trimmed before counting, so the limit is on what is sent.
 * Length is counted in JavaScript characters (UTF-16 units), the same way the browser's maxLength counts.
 */
export function checkQuestion(raw) {
  const question = typeof raw === 'string' ? raw.replace(/\r\n?/g, '\n').trim() : '';
  if (!question) {
    return { ok: false, code: 'QUESTION_REQUIRED', message: 'Type a question for the Copilot.' };
  }
  if (question.length > QUESTION_MAX_CHARS) {
    return {
      ok: false,
      code: 'QUESTION_TOO_LONG',
      message: `Questions can be up to ${QUESTION_MAX_CHARS} characters (yours has ${question.length}).`,
    };
  }
  return { ok: true, question };
}

function cleanProjectName(name) {
  const value = String(name || '')
    .replace(/\s+/g, ' ')
    .replace(/"/g, "'")
    .trim()
    .slice(0, PROJECT_NAME_MAX_CHARS);
  return value || 'this project';
}

/**
 * buildCopilotPrompt({ projectName, question }) -> { system, messages }
 * The question goes only into the user message, never into the system prompt.
 */
export function buildCopilotPrompt({ projectName, question }) {
  const system = [
    `You are the DevOrbit Project Copilot for the project "${cleanProjectName(projectName)}".`,
    'A member of this project is asking you a question. Answer clearly and briefly: a few short paragraphs at most.',
    'You only answer questions. You cannot create, change or delete anything in DevOrbit, so never say that you did.',
    'No project records (messages, tasks, decisions or GitHub activity) are attached to this request.',
    'Do not invent project-specific facts such as task names, people, dates, decisions or commits.',
    'If the question needs those records, say that you cannot see that project data, and answer only the general part, if there is one.',
  ].join('\n');
  return { system, messages: [{ role: 'user', content: question }] };
}

/** shapeAnswer(text) -> { answer, shortened } */
export function shapeAnswer(text) {
  const answer = String(text || '').trim();
  if (answer.length <= ANSWER_MAX_CHARS) return { answer, shortened: false };
  return { answer: `${answer.slice(0, ANSWER_MAX_CHARS - 1).trimEnd()}…`, shortened: true };
}
