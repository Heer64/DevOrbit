/*
 * [Sprint 4 · M6] Documentation page rules (US-38 Write a documentation page, FR-14b).
 *
 * Reads and checks the fields of a documentation page sent to the API. No database imports,
 * so the rules are tested on their own (backend/test/docRules.test.js).
 *
 * A page has
 *   title     required, trimmed, up to 120 characters
 *   content   required Markdown text, up to 10,000 characters
 *
 * The content is stored as plain Markdown text, exactly as written (only Windows line endings
 * \r\n are turned into \n, so a page typed on Windows counts the same as on a Mac). The server
 * never turns it into HTML; the browser renders it safely (frontend/src/components/markdown.jsx).
 */

export const DOC_TITLE_MAX = 120;
export const DOC_CONTENT_MAX = 10000;
export const DOC_PREVIEW_MAX = 160;

export const DOC_TITLE_REQUIRED_MESSAGE = 'Title is required.';
export const DOC_TITLE_TOO_LONG_MESSAGE = `Title must be ${DOC_TITLE_MAX} characters or fewer.`;
export const DOC_CONTENT_REQUIRED_MESSAGE = 'Write some content before saving.';
export const DOC_CONTENT_TOO_LONG_MESSAGE = `Content must be ${DOC_CONTENT_MAX.toLocaleString('en-US')} characters or fewer.`;
export const DOC_TEXT_MESSAGE = 'Title and content must be text.';

// "\r\n" and a lone "\r" become "\n". Nothing else is changed.
export function normalizeContent(text) {
  return String(text).replace(/\r\n?/g, '\n');
}

function readTitle(raw) {
  if (raw === undefined || raw === null) return { valid: false, message: DOC_TITLE_REQUIRED_MESSAGE };
  if (typeof raw !== 'string') return { valid: false, message: DOC_TEXT_MESSAGE };
  const value = raw.replace(/\s+/g, ' ').trim();
  if (!value) return { valid: false, message: DOC_TITLE_REQUIRED_MESSAGE };
  if (value.length > DOC_TITLE_MAX) return { valid: false, message: DOC_TITLE_TOO_LONG_MESSAGE };
  return { valid: true, value };
}

function readContent(raw) {
  if (raw === undefined || raw === null) return { valid: false, message: DOC_CONTENT_REQUIRED_MESSAGE };
  if (typeof raw !== 'string') return { valid: false, message: DOC_TEXT_MESSAGE };
  const value = normalizeContent(raw);
  if (!value.trim()) return { valid: false, message: DOC_CONTENT_REQUIRED_MESSAGE };
  if (value.length > DOC_CONTENT_MAX) return { valid: false, message: DOC_CONTENT_TOO_LONG_MESSAGE };
  return { valid: true, value };
}

/*
 * Reads a create (partial = false) or edit (partial = true) request body.
 * On create both fields are required. On edit only the fields sent are read, but a field that
 * is sent must still be valid (an empty title or content over the limit is refused).
 * Returns { ok: true, values } (values has only the keys that were sent) or { ok: false, message }.
 */
export function readDocInput(body, { partial = false } = {}) {
  const input = body && typeof body === 'object' ? body : {};
  const values = {};

  for (const [key, read] of [['title', readTitle], ['content', readContent]]) {
    if (partial && input[key] === undefined) continue;
    const result = read(input[key]);
    if (!result.valid) return { ok: false, message: result.message };
    values[key] = result.value;
  }

  return { ok: true, values };
}

/*
 * A short plain-text preview of the Markdown for the page list: the Markdown symbols are
 * removed, links keep only their text, whitespace is collapsed, and it is cut to `max` characters.
 */
export function docPreview(content, max = DOC_PREVIEW_MAX) {
  const text = String(content || '')
    .replace(/```[^\n]*\n?/g, ' ') // code fence lines
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // [text](url) -> text
    .replace(/^\s{0,3}(#{1,6}|>+|[-*+]|\d+[.)])\s+/gm, '') // headings, quotes, list markers
    .replace(/^\s*([-*_]\s*){3,}$/gm, ' ') // --- rules
    .replace(/(\*\*|__|\*|_|`)/g, '') // emphasis and code marks
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 4 · M6] What this file does
 * Validation for documentation pages (title, Markdown content up to 10,000
 * characters) and the plain-text preview shown in the page list. No database
 * code, so it is unit tested directly.
 * ---------------------------------------------------------------------------
 */
