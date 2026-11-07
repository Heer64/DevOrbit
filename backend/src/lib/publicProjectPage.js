/*
 * [Sprint 5 · M2] US-46 View a public project page (FR-20). Actor: Visitor (no login needed).
 *
 * AC1: for a Public project the page shows its name, description, domain, status and member names,
 *      and nothing can be edited from it.
 * AC2: channels, messages, tasks and files are never part of it.
 *
 * Pure rules, no Express or Mongoose, so they are unit tested on their own
 * (backend/test/publicProjectPageRules.test.js). The route is GET /api/public/projects/:projectId
 * in routes/publicProjects.js.
 */

// The only project fields a visitor receives on the public page (plus memberNames below).
export const PUBLIC_PAGE_FIELDS = ['_id', 'name', 'description', 'domain', 'status'];

// One answer for "does not exist" and "is Private", so a visitor cannot tell a private project exists.
export const PUBLIC_PAGE_NOT_FOUND = 'This project is not public or does not exist.';
export const PUBLIC_PAGE_BAD_ID = 'Invalid project ID.';

// Only Public projects have a public page.
export function isPublicProject(project) {
  return Boolean(project) && project.visibility === 'Public';
}

/*
 * memberNames(project.members) -> ['Olivia Owner', 'Casey Contributor', ...]
 * members[].user must be populated with `name`. Accounts that no longer exist (user is null)
 * and empty names are skipped. Only names are returned: no IDs, usernames, emails or roles.
 */
export function memberNames(members = []) {
  if (!Array.isArray(members)) return [];
  const names = [];
  for (const membership of members) {
    const name = typeof membership?.user?.name === 'string' ? membership.user.name.trim() : '';
    if (name) names.push(name);
  }
  return names;
}

// A Public project document -> exactly what the public page may show. Nothing else is copied.
export function toPublicProjectPage(project = {}) {
  const view = {};
  for (const field of PUBLIC_PAGE_FIELDS) {
    if (project[field] !== undefined) view[field] = project[field];
  }
  if (typeof view.description !== 'string') view.description = '';
  view.memberNames = memberNames(project.members);
  return view;
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 5 · M2] What this file does
 * Rules for the public read-only project page: only Public projects have one,
 * and it shows exactly name, description, domain, status and member names.
 * No database code, so it is unit tested.
 * ---------------------------------------------------------------------------
 */
