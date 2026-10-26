/*
 * [Sprint 3 · US-20] @mention helpers for the comment box (and later the chat composer, US-18).
 * Same username rule as the API (backend/src/lib/mentions.js): 3-30 of a-z, 0-9, ".", "_", "-".
 * Pure functions, so they are easy to test.
 */

const HANDLE_CHARS = /[a-z0-9._-]/i;

/*
 * When the caret sits right after "@something" (the "@" not following a letter, digit or ._-@),
 * returns { start, query } where start is the index of "@". Otherwise null.
 *   activeMention('Hi @ri', 6) -> { start: 3, query: 'ri' }
 */
export function activeMention(text, caret) {
  const value = String(text || '');
  const end = Math.min(caret ?? value.length, value.length);
  let index = end - 1;
  while (index >= 0 && HANDLE_CHARS.test(value[index])) index -= 1;
  if (index < 0 || value[index] !== '@') return null;
  const before = index > 0 ? value[index - 1] : '';
  if (before && /[a-z0-9._@-]/i.test(before)) return null;
  const query = value.slice(index + 1, end);
  if (query.length > 30) return null;
  return { start: index, query: query.toLowerCase() };
}

/*
 * Project members matching what was typed after "@", best matches first, at most `limit`.
 * members: [{ userId, name, username }] (the shape TeamPanel / GET /members returns).
 * Members without a username cannot be mentioned and are left out; so is `excludeId` (yourself).
 */
export function suggestMembers(members, query, { excludeId = '', limit = 6 } = {}) {
  const q = String(query || '').toLowerCase();
  const scored = [];
  for (const member of members || []) {
    const username = String(member.username || '').toLowerCase();
    if (!username || String(member.userId) === String(excludeId)) continue;
    const name = String(member.name || '').toLowerCase();
    let score = -1;
    if (!q) score = 3;
    else if (username.startsWith(q)) score = 0;
    else if (name.split(/\s+/).some((part) => part.startsWith(q))) score = 1;
    else if (username.includes(q) || name.includes(q)) score = 2;
    if (score >= 0) scored.push({ member, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || String(a.member.name).localeCompare(String(b.member.name)))
    .slice(0, limit)
    .map((item) => item.member);
}

/*
 * Replaces the "@query" being typed with "@username " and returns { text, caret }.
 */
export function insertMention(text, mention, caret, username) {
  const value = String(text || '');
  const before = value.slice(0, mention.start);
  const after = value.slice(caret).replace(/^[a-z0-9._-]*/i, '');
  const inserted = `@${username}${after.startsWith(' ') ? '' : ' '}`;
  return { text: `${before}${inserted}${after}`, caret: before.length + inserted.length };
}

/*
 * Splits a saved comment into plain text and mentions, for highlighting.
 * Only the people the API stored in comment.mentions are highlighted, so "@nobody" stays plain text.
 *   splitMentions('hi @riya!', [{ username: 'riya', name: 'Riya' }])
 *     -> [{ text: 'hi ' }, { text: '@riya', user: { ... } }, { text: '!' }]
 */
export function splitMentions(body, mentions = []) {
  const value = String(body || '');
  const byUsername = new Map((mentions || []).filter((user) => user?.username).map((user) => [String(user.username).toLowerCase(), user]));
  if (!byUsername.size) return [{ text: value }];

  const parts = [];
  const pattern = /(^|[^a-z0-9._@-])@([a-z0-9._-]{3,30})/gi;
  let last = 0;
  for (const match of value.matchAll(pattern)) {
    const start = match.index + match[1].length;
    let handle = match[2].toLowerCase();
    let user = byUsername.get(handle);
    if (!user) {
      // "@riya." at the end of a sentence: the trailing dot is punctuation.
      handle = handle.replace(/[._-]+$/, '');
      user = byUsername.get(handle);
    }
    if (!user) continue;
    const end = start + 1 + handle.length;
    if (start > last) parts.push({ text: value.slice(last, start) });
    parts.push({ text: value.slice(start, end), user });
    last = end;
  }
  if (last < value.length) parts.push({ text: value.slice(last) });
  return parts.length ? parts : [{ text: value }];
}
