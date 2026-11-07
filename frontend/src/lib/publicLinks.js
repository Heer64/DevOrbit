/*
 * [Sprint 5 · M1] US-45: where a project card on Discover leads.
 * Every Discover card links through this ONE helper.
 *
 * [Sprint 5 · M2] US-46: real projects (24-character MongoDB IDs) now open the public read-only
 * project page at /discover/:projectId. It works logged out (PublicShell) and logged in (AppShell).
 * Members get a link from it into their workspace; logged-in non-members can request to join;
 * visitors are asked to log in first (US-47).
 * Sample projects of the demo workspace (ids like 'orbit-dashboard') keep opening the demo workspace page.
 */
export const PROJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

export function publicProjectPath(id) {
  const text = String(id ?? '');
  if (PROJECT_ID_PATTERN.test(text)) return `/discover/${encodeURIComponent(text)}`;
  return `/project/${encodeURIComponent(text)}`;
}

// [Sprint 5 · M2] The member workspace of a project (tasks, chat, files ...). Members only.
export function workspacePath(id) {
  return `/project/${encodeURIComponent(String(id ?? ''))}`;
}
