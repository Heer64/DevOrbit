/*
 * [Sprint 5 · M4] US-48 Find a collaborator by skill — rules that need no database
 * (tested in test/skillSearchRules.test.js). routes/profile.js (GET /api/profile/people) uses them.
 *
 *   ?skills=react,css      tags separated by commas (the same parameter may also be repeated)
 *
 * AC1: a user is returned when at least one of their skill tags equals one of the searched tags,
 *      ignoring upper/lower case, and results are ordered by how many tags match (most first).
 * AC2: people who turned off "appear in collaborator search" are never returned (the route keeps
 *      its profileDiscoverable filter).
 */

// Same limits as profile skill tags (PATCH /api/profile/me): up to 10 tags, 40 characters each.
export const MAX_SEARCH_TAGS = 10;
export const MAX_TAG_LENGTH = 40;
export const SKILL_SEARCH_LIMIT = 60;

export const TOO_MANY_TAGS_MESSAGE = `Search with no more than ${MAX_SEARCH_TAGS} skill tags.`;
export const TAG_TOO_LONG_MESSAGE = `Each skill tag must be ${MAX_TAG_LENGTH} characters or fewer.`;
export const BAD_TAGS_MESSAGE = 'Skill tags must be text separated by commas.';

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/*
 * Reads ?skills= into a clean list of tags.
 * Returns { tags, error }: tags are trimmed, empty ones dropped and duplicates removed ignoring case
 * (the first spelling is kept). No parameter gives { tags: [], error: null }.
 */
export function parseSkillTags(raw) {
  if (raw === undefined || raw === null) return { tags: [], error: null };
  const parts = Array.isArray(raw) ? raw : [raw];
  if (parts.some((part) => typeof part !== 'string')) return { tags: [], error: BAD_TAGS_MESSAGE };

  const tags = [];
  const seen = new Set();
  for (const tag of parts.flatMap((part) => part.split(','))) {
    const clean = tag.trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    if (clean.length > MAX_TAG_LENGTH) return { tags: [], error: TAG_TOO_LONG_MESSAGE };
    seen.add(key);
    tags.push(clean);
  }
  if (tags.length > MAX_SEARCH_TAGS) return { tags: [], error: TOO_MANY_TAGS_MESSAGE };
  return { tags, error: null };
}

// MongoDB condition for "has at least one of these tags": whole-tag, case-insensitive match.
// "react" finds "React" but not "React Native".
export function skillTagFilter(tags) {
  return { $in: tags.map((tag) => new RegExp(`^${escapeRegex(tag)}$`, 'i')) };
}

// The user's own tags that match the search, in the user's spelling and order.
export function matchedSkillsOf(userSkills, tags) {
  const wanted = new Set(tags.map((tag) => tag.toLowerCase()));
  const matched = [];
  const seen = new Set();
  for (const skill of Array.isArray(userSkills) ? userSkills : []) {
    const key = String(skill).toLowerCase();
    if (wanted.has(key) && !seen.has(key)) {
      seen.add(key);
      matched.push(skill);
    }
  }
  return matched;
}

/*
 * Adds matchedSkills and matchCount to each user, drops users with no match, and sorts:
 *   1. more matching tags first (AC1)
 *   2. then by name (A–Z, ignoring case), then username, so equal matches have a stable order.
 * Does not change the objects that were passed in.
 */
export function rankBySkillMatch(users, tags) {
  return users
    .map((user) => {
      const matchedSkills = matchedSkillsOf(user.skills, tags);
      return { ...user, matchedSkills, matchCount: matchedSkills.length };
    })
    .filter((user) => user.matchCount > 0)
    .sort((a, b) =>
      b.matchCount - a.matchCount
      || String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base' })
      || String(a.username || '').localeCompare(String(b.username || '')));
}
