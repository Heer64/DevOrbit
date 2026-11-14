/*
 * [Sprint 6 · M5] US-44 Catch Me Up: helpers for components/CatchMeUpPanel.jsx.
 * Pure functions, no React, so they are unit tested on their own (catchUpDisplay.test.js).
 *
 * The API (POST /api/projects/:id/catch-up, backend/src/routes/catchUp.js) returns
 *   summary   short points ("- ..."), each citing events as [E1] or [E2, E5]
 *   sources   [{ ref, type: 'event', category, label, detail, link, external, at }] in order of first use
 *   counts    { tasks, milestones, messages, comments, decisions, github, people, files, project, total }
 *   context   { budgetTokens, included, available, leftOut, trimmed }
 *
 *   summaryPoints(text)            -> ['point one [E1]', ...]: one entry per line, "- " / "* " / "• " removed
 *   splitEventCitations(text, sources) -> [{ text } | { refs: [{ ref, number, source }] }]
 *   countsLine(counts)             -> "3 task updates · 5 messages · 1 GitHub event"
 *   periodLabel({ since, basis })  -> "Since your previous login on Nov 12, 2026, 14:05"
 *   contextLine(context)           -> '' or one sentence on events left out to fit the AI input limit
 */

const CITATION = /\[([^[\]\n]{1,80})\]/g;
const REF_PATTERN = /^E\d{1,4}$/;

const CATEGORY_WORDS = [
  ['tasks', 'task update', 'task updates'],
  ['messages', 'message', 'messages'],
  ['comments', 'task comment', 'task comments'],
  ['decisions', 'decision', 'decisions'],
  ['github', 'GitHub event', 'GitHub events'],
  ['milestones', 'milestone change', 'milestone changes'],
  ['people', 'member change', 'member changes'],
  ['files', 'file', 'files'],
  ['project', 'project change', 'project changes'],
];

const number = (value) => (Number.isSafeInteger(value) && value > 0 ? value : 0);

export function summaryPoints(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
}

export function splitEventCitations(text, sources = []) {
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

export function countsLine(counts) {
  return CATEGORY_WORDS.filter(([key]) => number(counts?.[key]) > 0)
    .map(([key, one, many]) => `${number(counts[key]).toLocaleString('en-US')} ${number(counts[key]) === 1 ? one : many}`)
    .join(' · ');
}

export function formatWhen(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function periodLabel({ since, basis } = {}) {
  if (basis === 'recent_days') return 'Your previous login is not known yet, so this covers the last 7 days.';
  const when = formatWhen(since);
  return when ? `Since your previous login on ${when}.` : 'Since your previous login.';
}

export function contextLine(context) {
  if (!context?.trimmed || !Number.isFinite(context.included) || !Number.isFinite(context.available)) return '';
  const budget = Number.isFinite(context.budgetTokens) ? context.budgetTokens : 8000;
  return `Summarised from the ${context.included.toLocaleString('en-US')} newest of ${context.available.toLocaleString('en-US')} events; older ones were left out to stay within the ${budget.toLocaleString('en-US')}-token AI input limit.`;
}
