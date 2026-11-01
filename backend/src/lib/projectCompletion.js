/*
 * [Sprint 4 · M8] Mark a project complete / reopen it (US-15, FR-3, FR-21).
 *
 * Pure rules, no Express or Mongoose, so they can be unit tested without a database
 * (see backend/test/projectCompletionRules.test.js).
 *
 * The rules
 * 1. Only the project Owner may mark a project Completed or reopen it. Admins can still
 *    edit the other project details, but not this status (US-15 actor: Project Owner).
 * 2. "Active" in the user story means any status that is not Completed. This codebase
 *    already uses two active statuses, "Planning" and "In progress", so they are kept
 *    as they are; nothing else in the app has to change.
 * 3. Completing remembers the active status the project had (reopenStatus) and the time
 *    (completedAt). Reopening restores that status, or "In progress" when none was saved.
 * 4. Completing a Completed project, or reopening an active one, is refused with 409 so a
 *    double click or a stale page never changes anything.
 * 5. "Archived" is listed in FR-3 but is not part of US-15; it is NOT built here.
 *    (Sprint plan: "Confirm whether Archived is in scope before building it.")
 */

export const COMPLETED_STATUS = 'Completed';
export const ACTIVE_STATUSES = ['Planning', 'In progress'];
export const DEFAULT_REOPEN_STATUS = 'In progress';

export const OWNER_ONLY_MESSAGE = 'Only the project Owner can mark the project Completed or reopen it.';
export const ALREADY_COMPLETED_MESSAGE = 'This project is already Completed.';
export const NOT_COMPLETED_MESSAGE = 'This project is not Completed, so there is nothing to reopen.';

export function isCompleted(project) {
  return project?.status === COMPLETED_STATUS;
}

export function isActive(project) {
  return Boolean(project) && !isCompleted(project);
}

// Rule 1 + 4. action is 'complete' or 'reopen'. Returns { ok: true } or { ok: false, status, message }.
export function checkCompletionChange(role, currentStatus, action) {
  if (role !== 'Owner') return { ok: false, status: 403, message: OWNER_ONLY_MESSAGE };
  if (action === 'complete' && currentStatus === COMPLETED_STATUS) {
    return { ok: false, status: 409, message: ALREADY_COMPLETED_MESSAGE };
  }
  if (action === 'reopen' && currentStatus !== COMPLETED_STATUS) {
    return { ok: false, status: 409, message: NOT_COMPLETED_MESSAGE };
  }
  if (action !== 'complete' && action !== 'reopen') return { ok: false, status: 400, message: 'Unknown action.' };
  return { ok: true };
}

// Rule 1 for PATCH /api/projects/:id: does this status change cross the Completed line?
// (Planning <-> In progress is an ordinary edit that Admins may still make.)
export function touchesCompletion(currentStatus, nextStatus) {
  if (nextStatus === undefined || nextStatus === currentStatus) return false;
  return currentStatus === COMPLETED_STATUS || nextStatus === COMPLETED_STATUS;
}

// Rule 3. The fields to set on the project document for each action.
export function completionFields(project, now = new Date()) {
  const reopenStatus = ACTIVE_STATUSES.includes(project?.status) ? project.status : DEFAULT_REOPEN_STATUS;
  return { status: COMPLETED_STATUS, completedAt: new Date(now), reopenStatus };
}

export function reopenFields(project) {
  const status = ACTIVE_STATUSES.includes(project?.reopenStatus) ? project.reopenStatus : DEFAULT_REOPEN_STATUS;
  return { status, completedAt: null, reopenStatus: '' };
}
