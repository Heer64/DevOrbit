/*
 * [Sprint 5 · M1] US-45 Browse and filter public projects (FR-18, FR-30).
 *
 * Reads the Discover query a visitor sends (no login needed) and turns it into a safe MongoDB
 * filter. Pure rules, no Express or Mongoose, so they are unit tested on their own
 * (backend/test/publicDiscoveryRules.test.js). The route is routes/publicProjects.js.
 *
 *   q       keyword: the project's name OR description contains it (case-insensitive), up to 100 characters
 *   domain  one of the agreed domains (lib/projectSetup.js PROJECT_DOMAINS), any letter case
 *   tag     a skill tag: matches a project tag exactly, ignoring letter case
 *   status  Planning | In progress | Completed (any letter case)
 *   page    1, 2, 3 ... (24 projects per page)
 *
 * Filters combine with AND. Whatever is sent, the filter always keeps visibility: 'Public', so a
 * private project can never be listed.
 */
import { PROJECT_DOMAINS } from './projectSetup.js';

// Same values as the status enum in models/Project.js (a test checks they stay equal).
export const PROJECT_STATUSES = ['Planning', 'In progress', 'Completed'];

export const DISCOVER_PAGE_SIZE = 24;
export const DISCOVER_MAX_PAGE = 1000;
export const KEYWORD_MAX = 100;
export const TAG_MAX = 40; // same as the tag maxlength in models/Project.js

export const KEYWORD_TOO_LONG_MESSAGE = `Search text must be ${KEYWORD_MAX} characters or fewer.`;
export const DOMAIN_FILTER_MESSAGE = `Domain must be one of: ${PROJECT_DOMAINS.join(', ')}.`;
export const STATUS_FILTER_MESSAGE = `Status must be one of: ${PROJECT_STATUSES.join(', ')}.`;
export const TAG_FILTER_MESSAGE = `Skill tag must be ${TAG_MAX} characters or fewer.`;
export const PAGE_MESSAGE = `Page must be a whole number from 1 to ${DISCOVER_MAX_PAGE}.`;
export const QUERY_TEXT_MESSAGE = 'Each filter must be given once, as text.';

// The only project fields a visitor ever receives (plus memberCount, worked out from members).
export const PUBLIC_PROJECT_FIELDS = ['_id', 'name', 'description', 'domain', 'tags', 'status', 'createdAt', 'updatedAt'];

// Text with regex symbols (".", "(", "*" ...) is searched for literally.
export function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Query values arrive as strings; ?a=1&a=2 arrives as an array, which is refused.
function readText(raw) {
  if (raw === undefined) return { ok: true, value: '' };
  if (typeof raw !== 'string') return { ok: false };
  return { ok: true, value: raw.trim() };
}

/*
 * readDiscoverQuery(req.query)
 *   -> { ok: true, filter, page, applied: { q, domain, tag, status } }
 *   -> { ok: false, message }   (answer 400)
 * `applied` holds the cleaned values (domain and status in their official spelling) for the reply.
 */
export function readDiscoverQuery(query = {}) {
  const input = query && typeof query === 'object' ? query : {};
  const fields = {};
  for (const key of ['q', 'domain', 'tag', 'status', 'page']) {
    const read = readText(input[key]);
    if (!read.ok) return { ok: false, message: QUERY_TEXT_MESSAGE };
    fields[key] = read.value;
  }

  const filter = { visibility: 'Public' };
  const applied = { q: '', domain: '', tag: '', status: '' };

  if (fields.q) {
    if (fields.q.length > KEYWORD_MAX) return { ok: false, message: KEYWORD_TOO_LONG_MESSAGE };
    const pattern = new RegExp(escapeRegex(fields.q), 'i');
    filter.$or = [{ name: pattern }, { description: pattern }];
    applied.q = fields.q;
  }

  if (fields.domain) {
    const domain = PROJECT_DOMAINS.find((name) => name.toLowerCase() === fields.domain.toLowerCase());
    if (!domain) return { ok: false, message: DOMAIN_FILTER_MESSAGE };
    filter.domain = domain;
    applied.domain = domain;
  }

  if (fields.tag) {
    if (fields.tag.length > TAG_MAX) return { ok: false, message: TAG_FILTER_MESSAGE };
    filter.tags = new RegExp(`^${escapeRegex(fields.tag)}$`, 'i');
    applied.tag = fields.tag;
  }

  if (fields.status) {
    const status = PROJECT_STATUSES.find((name) => name.toLowerCase() === fields.status.toLowerCase());
    if (!status) return { ok: false, message: STATUS_FILTER_MESSAGE };
    filter.status = status;
    applied.status = status;
  }

  let page = 1;
  if (fields.page) {
    if (!/^\d{1,4}$/.test(fields.page)) return { ok: false, message: PAGE_MESSAGE };
    page = Number(fields.page);
    if (page < 1 || page > DISCOVER_MAX_PAGE) return { ok: false, message: PAGE_MESSAGE };
  }

  // Set last so nothing above can ever replace it.
  filter.visibility = 'Public';
  return { ok: true, filter, page, applied };
}

// A project document -> exactly what a visitor may see. Nothing else is copied.
export function toPublicProject(project = {}) {
  const view = {};
  for (const field of PUBLIC_PROJECT_FIELDS) {
    if (project[field] !== undefined) view[field] = project[field];
  }
  view.tags = Array.isArray(project.tags) ? project.tags : [];
  view.memberCount = Array.isArray(project.members) ? project.members.length : 0;
  return view;
}

// Distinct tags of public projects, cleaned and sorted for the "Skill tag" dropdown.
export function sortedTags(tags = []) {
  const seen = new Map();
  for (const raw of tags) {
    const tag = String(raw || '').trim();
    if (tag && !seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 5 · M1] What this file does
 * Rules for the public Discover list: reads keyword, domain, skill-tag, status
 * and page from the query, always restricts to Public projects, and decides
 * which project fields a visitor may see. No database code, so it is unit tested.
 * ---------------------------------------------------------------------------
 */
