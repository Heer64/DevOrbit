// Mirrors backend/src/lib/permissions.js so the UI only offers actions the server will accept.
// The server is still the one that enforces every rule (it answers 403 otherwise).
export const ROLE_ORDER = ['Owner', 'Admin', 'Contributor', 'Viewer'];

export function assignableRoles(actorRole) {
  if (actorRole === 'Owner') return ['Admin', 'Contributor', 'Viewer'];
  if (actorRole === 'Admin') return ['Contributor', 'Viewer'];
  return [];
}

export function canActOnMember(actorRole, targetRole) {
  if (targetRole === 'Owner') return false;
  if (actorRole === 'Owner') return true;
  if (actorRole === 'Admin') return targetRole === 'Contributor' || targetRole === 'Viewer';
  return false;
}

export const canManageMembers = (role) => role === 'Owner' || role === 'Admin';

// Task rules (same as canWriteTasks / canDeleteTask in backend/src/lib/permissions.js).
export const canWriteTasks = (role) => role === 'Owner' || role === 'Admin' || role === 'Contributor';

export function canDeleteTask(role, isCreator) {
  if (role === 'Owner' || role === 'Admin') return true;
  if (role === 'Contributor') return isCreator === true;
  return false;
}

export const ROLE_HELP = {
  Owner: 'Full control. One per project.',
  Admin: 'Edit the project and manage Contributors and Viewers.',
  Contributor: 'Work on the project. Cannot change settings or roles.',
  Viewer: 'Read only.',
};

// Mirrors canManageMilestones in backend/src/lib/permissions.js.
export const canManageMilestones = (role) => role === 'Owner' || role === 'Admin';

// [Sprint 2 final] Mirrors canPostMessages / canManageChannels in backend/src/lib/permissions.js.
export const canPostMessages = (role) => role === 'Owner' || role === 'Admin' || role === 'Contributor';
export const canManageChannels = (role) => role === 'Owner' || role === 'Admin';

// [Sprint 3 · M8] US-35/US-36: who may record and edit decisions (same rule as the API).
export const canWriteDecisions = (role) => role === 'Owner' || role === 'Admin' || role === 'Contributor';
