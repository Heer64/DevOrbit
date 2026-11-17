import { createPersonalNotification } from './notifications.js';

/*
 * [Sprint 6 · M7] FR-20 "the requester shall be notified of the outcome" of a join request (US-47 follow-up).
 *
 *   approved -> "Join request approved": "<Owner/Admin name> approved your request to join "<project>" as <role>"
 *               link: the project workspace /project/<id> (they are a member now)
 *   rejected -> "Join request declined": "Your request to join "<project>" was declined."
 *               link: the public project page /discover/<id> (same path as frontend lib/publicLinks.js
 *               publicProjectPath). No actor: a non-member is not told which Owner/Admin declined.
 *
 * One notification per decision (dedupe key per join request and outcome). Never throws.
 */
export function joinOutcomeNotification({ joinRequest, project, outcome, role = '', actor = null }) {
  const projectId = String(project?._id || project || '');
  const name = String(project?.name || 'the project');
  const approved = outcome === 'approved';
  return {
    recipient: joinRequest?.user,
    type: approved ? 'join_approved' : 'join_rejected',
    project: projectId,
    actor: approved ? actor : null,
    summary: approved
      ? `approved your request to join "${name}"${role ? ` as ${role}` : ''}`
      : `Your request to join "${name}" was declined.`,
    targetType: 'project',
    targetId: projectId,
    targetLabel: name,
    link: approved ? `/project/${projectId}` : `/discover/${projectId}`,
    dedupeKey: `join-request:${String(joinRequest?._id || '')}:${approved ? 'approved' : 'rejected'}`,
  };
}

export async function notifyJoinRequestOutcome(options) {
  try {
    return await createPersonalNotification(joinOutcomeNotification(options));
  } catch {
    return null; // the approve/reject itself already succeeded; a missing notification must not undo it
  }
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 6 · M7] What this file does
 * Builds and sends the in-app notification that tells a user their join request was approved or declined.
 * ---------------------------------------------------------------------------
 */
