/*
 * [Sprint 5 · M1] US-45: where a project card on Discover leads.
 *
 * Every Discover card links through this ONE helper. Today it opens the normal project page
 * (/project/:id): members see the project, logged-out visitors are asked to log in first and
 * then come back, and logged-in non-members can request to join a Public project (Sprint 3 · M2).
 *
 * M2 (US-46 public read-only project page): change only this function to point to the new
 * public page, e.g. `/discover/${id}`. No other file needs to change.
 */
export function publicProjectPath(id) {
  return `/project/${encodeURIComponent(String(id))}`;
}
