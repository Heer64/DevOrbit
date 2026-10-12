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

export const ROLE_HELP = {
  Owner: 'Full control. One per project.',
  Admin: 'Edit the project and manage Contributors and Viewers.',
  Contributor: 'Work on the project. Cannot change settings or roles.',
  Viewer: 'Read only.',
};
