// Pure role rules for project membership. Kept free of Express/Mongoose so they are easy to unit test.
export const ROLES = ['Owner', 'Admin', 'Contributor', 'Viewer'];
export const ASSIGNABLE_ROLES = ['Admin', 'Contributor', 'Viewer'];

export function isRole(value) {
  return ROLES.includes(value);
}

// Who may see and change project details (name, description, visibility, ...).
export function canEditProject(role) {
  return role === 'Owner' || role === 'Admin';
}

// Who may open the members management actions at all.
export function canManageMembers(role) {
  return role === 'Owner' || role === 'Admin';
}

// Roles an actor is allowed to hand out.
// Owner: Admin, Contributor, Viewer. Admin: Contributor, Viewer. Everyone else: none.
// "Owner" is never assignable: each project has exactly one Owner (its creator).
export function assignableRoles(actorRole) {
  if (actorRole === 'Owner') return ['Admin', 'Contributor', 'Viewer'];
  if (actorRole === 'Admin') return ['Contributor', 'Viewer'];
  return [];
}

// Whether the actor may act on a member who currently holds targetRole.
// Owner can manage anyone but themselves; Admin can only manage Contributors and Viewers.
export function canActOnMember(actorRole, targetRole) {
  if (targetRole === 'Owner') return false;
  if (actorRole === 'Owner') return true;
  if (actorRole === 'Admin') return targetRole === 'Contributor' || targetRole === 'Viewer';
  return false;
}

// Full check for "set this member's role to newRole". Returns { ok: true } or { ok: false, status, message }.
export function checkRoleChange(actorRole, targetRole, newRole) {
  if (!canManageMembers(actorRole)) {
    return { ok: false, status: 403, message: 'Only project Owners and Admins can change roles.' };
  }
  if (!isRole(newRole)) return { ok: false, status: 400, message: `Role must be one of: ${ROLES.join(', ')}.` };
  if (newRole === 'Owner') return { ok: false, status: 400, message: 'A project has one Owner. Ownership transfer is not supported yet.' };
  if (targetRole === 'Owner') return { ok: false, status: 403, message: "The project Owner's role cannot be changed." };
  if (!canActOnMember(actorRole, targetRole)) {
    return { ok: false, status: 403, message: 'Admins can only manage Contributors and Viewers.' };
  }
  if (!assignableRoles(actorRole).includes(newRole)) {
    return { ok: false, status: 403, message: `Your role cannot assign the ${newRole} role.` };
  }
  return { ok: true };
}

// Adding a member is a role assignment for someone who has no role yet.
export function checkAddMember(actorRole, newRole) {
  if (!canManageMembers(actorRole)) {
    return { ok: false, status: 403, message: 'Only project Owners and Admins can add members.' };
  }
  if (!isRole(newRole)) return { ok: false, status: 400, message: `Role must be one of: ${ROLES.join(', ')}.` };
  if (newRole === 'Owner') return { ok: false, status: 400, message: 'A project has one Owner. Ownership transfer is not supported yet.' };
  if (!assignableRoles(actorRole).includes(newRole)) {
    return { ok: false, status: 403, message: `Your role cannot assign the ${newRole} role.` };
  }
  return { ok: true };
}

// Removing a member. Members may always leave themselves (except the Owner).
export function checkRemoveMember(actorRole, targetRole, isSelf) {
  // [Sprint 3 · M3] US-14: the only Owner is asked to hand the project over before leaving.
  if (targetRole === 'Owner' && isSelf) {
    return { ok: false, status: 403, message: 'You are the only Owner of this project. Transfer ownership to another member before leaving.' };
  }
  // US-13: the only Owner cannot be removed by anyone else.
  if (targetRole === 'Owner') return { ok: false, status: 403, message: 'The project Owner cannot be removed. Every project needs an Owner.' };
  if (isSelf) return { ok: true };
  if (!canManageMembers(actorRole)) {
    return { ok: false, status: 403, message: 'Only project Owners and Admins can remove members.' };
  }
  if (!canActOnMember(actorRole, targetRole)) {
    return { ok: false, status: 403, message: 'Admins can only remove Contributors and Viewers.' };
  }
  return { ok: true };
}
// Who may create and edit tasks within a project.
export function canWriteTasks(role) {
  return (
    role === 'Owner' ||
    role === 'Admin' ||
    role === 'Contributor'
  );
}

// Who may delete a task.
export function canDeleteTask(role, isCreator) {
  if (role === 'Owner' || role === 'Admin') {
    return true;
  }

  if (role === 'Contributor') {
    return isCreator === true;
  }

  return false;
}

// Who may create, rename, re-date and delete milestones.
// Contributors can still attach their tasks to a milestone through the task API.
export function canManageMilestones(role) {
  return role === 'Owner' || role === 'Admin';
}

// [Sprint 2 final] Project channels (US-16).
// Every member can read channels; Viewers cannot post (they get 403 but can still read).
export function canPostMessages(role) {
  return role === 'Owner' || role === 'Admin' || role === 'Contributor';
}

// Who may create new channels. #general exists for everyone automatically.
export function canManageChannels(role) {
  return role === 'Owner' || role === 'Admin';
}

// [Sprint 3 · M8] US-35/US-36: who may record and edit project decisions.
// Every member can read them; Viewers cannot record or edit (403).
export function canWriteDecisions(role) {
  return role === 'Owner' || role === 'Admin' || role === 'Contributor';
}

// [Sprint 4 · M8] US-40: project health is a "Project Manager" view (Owner or Admin).
export function canViewProjectHealth(role) {
  return role === 'Owner' || role === 'Admin';
}

// [Sprint 4 · M8] US-15: only the Owner marks the project Completed or reopens it.
export function canChangeCompletion(role) {
  return role === 'Owner';
}
