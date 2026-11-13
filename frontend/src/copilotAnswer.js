/*
 * [Sprint 6 · M4] US-42, US-43: helpers for showing a grounded Copilot answer (components/CopilotPanel.jsx).
 * Pure functions, no React, so they are unit tested on their own (copilotAnswer.test.js).
 *
 * The API (POST /api/projects/:id/copilot/ask, backend/src/routes/copilot.js) returns
 *   answer        text that cites records as [T1] or [M2, D1]
 *   insufficient  true = "not enough project data" (US-43)
 *   sources       [{ ref, type, label, detail, link, external, at }] in order of first use
 *   context       { budgetTokens, included: { total, ... }, available: { total, ... }, leftOut, trimmed }
 *
 *   splitCitations(text, sources)  -> parts to render: { text } or { refs: [{ ref, number, source }] }
 *                                     number = position in the Sources list (1, 2, 3 ...)
 *   sourceDate(source)             -> the date shown for a message, comment or GitHub event ('' otherwise:
 *                                     a task's or decision's own dates are already in its detail)
 *   sourceHref(source)             -> { href, external } for a safe link, or null
 *   contextNote(context, insufficient) -> one sentence on what the answer was based on / left out
 */

export const SOURCE_KINDS = {
  task: 'Task',
  decision: 'Decision',
  message: 'Message',
  comment: 'Task comment',
  github: 'GitHub',
};

const CITATION = /\[([^[\]\n]{1,80})\]/g;
const REF_PATTERN = /^[TDMCG]\d{1,4}$/;
// In-app links the server builds: /project/<id>?tab=...&task=<id> (lib/copilotGrounding.js).
const INTERNAL_LINK = /^\/project\/[0-9a-f]{24}\?[A-Za-z0-9=&_-]+$/i;
const GITHUB_LINK = /^https:\/\/github\.com\/[^\s"'<>]+$/;

/** sourceHref(source) -> { href, external } or null when the link is missing or not one DevOrbit makes. */
export function sourceHref(source) {
  const link = typeof source?.link === 'string' ? source.link.trim() : '';
  if (source?.external) return GITHUB_LINK.test(link) && link.length <= 500 ? { href: link, external: true } : null;
  return INTERNAL_LINK.test(link) ? { href: link, external: false } : null;
}

/**
 * splitCitations(text, sources) -> [{ text } | { refs }]
 * Only a bracket holding nothing but record ids is a citation; ids that are not in the sources are dropped
 * (the server already removed them, this is a second guard). Any other bracket stays as text.
 */
export function splitCitations(text, sources = []) {
  const list = Array.isArray(sources) ? sources : [];
  const numbers = new Map(list.map((source, index) => [String(source?.ref || '').toUpperCase(), index + 1]));
  const value = String(text ?? '');
  const parts = [];
  let last = 0;
  for (const match of value.matchAll(CITATION)) {
    const ids = match[1]
      .split(/[\s,;]+/)
      .filter(Boolean)
      .map((id) => id.toUpperCase());
    if (!ids.length || !ids.every((id) => REF_PATTERN.test(id))) continue;
    // The citation sits right after the word it supports, like a footnote: "arrive[1]." not "arrive [1]."
    const before = value.slice(last, match.index).replace(/[ \t]+$/, '');
    if (before) parts.push({ text: before });
    const refs = [...new Set(ids)]
      .filter((id) => numbers.has(id))
      .map((id) => ({ ref: id, number: numbers.get(id), source: list[numbers.get(id) - 1] }));
    if (refs.length) parts.push({ refs });
    last = match.index + match[0].length;
  }
  if (last < value.length) parts.push({ text: value.slice(last) });
  return parts.length ? parts : [{ text: value }];
}

const count = (n, word) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

/** contextNote(context, insufficient) -> '' when the API sent no context (older server). */
export function contextNote(context, insufficient = false) {
  const used = context?.included?.total;
  const all = context?.available?.total;
  if (!Number.isFinite(used) || !Number.isFinite(all)) return '';
  if (all === 0) return 'This project has no tasks, messages, decisions or GitHub activity yet.';
  const budget = Number.isFinite(context.budgetTokens) ? context.budgetTokens : 8000;
  const verb = insufficient ? 'Checked' : 'Based on';
  let base;
  if (used < all) base = `${verb} ${used.toLocaleString('en-US')} of ${count(all, 'project record')} you can see.`;
  else if (all === 1) base = `${verb} the only project record you can see.`;
  else base = `${verb} all ${count(all, 'project record')} you can see.`;
  if (!context.trimmed || used >= all) return base;
  return `${base} The rest were left out to stay within the ${budget.toLocaleString('en-US')}-token AI input limit (least related and oldest first).`;
}

/** sourceDate(source) -> "Nov 10, 2026" for messages, comments and GitHub events; '' for tasks and decisions. */
export function sourceDate(source) {
  return ['message', 'comment', 'github'].includes(source?.type) ? formatSourceDate(source.at) : '';
}

/** formatSourceDate(iso) -> "Nov 10, 2026" (UTC, like decision dates), '' when missing. */
export function formatSourceDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
