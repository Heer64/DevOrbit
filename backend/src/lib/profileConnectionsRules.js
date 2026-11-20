/*
 * [Sprint 7 · M4] Followers / following lists, projects on a profile, and the "Contribution snapshot"
 * on My profile (D6). Rules with no database imports (tested in test/profileConnectionsRules.test.js).
 * lib/profileConnections.js and routes/profile.js use them.
 *
 * Lists (any logged-in user, on any profile they can open):
 *   - Followers = people who follow this user. Following = people this user follows.
 *   - Newest first, 20 per page. Each person is sent as name, username, headline and photo only
 *     (no IDs, no email), and links to /people/:username.
 *
 * Projects on a profile:
 *   - Public projects the user belongs to are shown to everyone logged in.
 *   - A Private project is shown only when the viewer is a member of it too (so on your own
 *     profile you see all of yours).
 *   - Members of the project link to the workspace (/project/:id); everybody else opens the
 *     read-only public project page (/discover/:id), where they can ask to join.
 *
 * Contribution snapshot (D6): real numbers in place of the fixed 18 / 24 / 12 / 86% placeholders.
 */

export const CONNECTIONS_PAGE_SIZE = 20;
export const PROFILE_PROJECT_LIMIT = 100;
export const SNAPSHOT_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const CONNECTION_KINDS = ['followers', 'following'];

// "?page=" -> a whole number from 1 up. Anything else is page 1.
export function readPage(value) {
  const number = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(number) && number >= 1 ? Math.min(number, 10000) : 1;
}

// One person in a followers / following list: only what a profile card needs.
export function personView(user) {
  return {
    name: user?.name || 'DevOrbit member',
    username: user?.username || '',
    headline: user?.headline || '',
    avatarUrl: user?.avatarUrl || '',
  };
}

// The answer for one page of a list.
export function connectionsPage(people, total, page, pageSize = CONNECTIONS_PAGE_SIZE) {
  const safeTotal = Number.isFinite(Number(total)) && Number(total) > 0 ? Math.floor(Number(total)) : 0;
  return {
    people: people.map(personView).filter((person) => person.username),
    total: safeTotal,
    page,
    pageSize,
    hasMore: page * pageSize < safeTotal,
  };
}

const sameId = (a, b) => a !== undefined && a !== null && b !== undefined && b !== null && String(a) === String(b);

export function memberRole(project, userId) {
  const member = (project?.members || []).find((item) => sameId(item.user?._id || item.user, userId));
  return member?.role || null;
}

export function isProjectMember(project, userId) {
  return Boolean(memberRole(project, userId));
}

// The visibility rule: Public, or Private with the viewer as a member too.
export function canSeeOnProfile(project, viewerId) {
  if (!project) return false;
  if (project.visibility === 'Public') return true;
  return isProjectMember(project, viewerId);
}

export function projectPathFor(project, viewerIsMember) {
  const id = encodeURIComponent(String(project._id));
  return viewerIsMember ? `/project/${id}` : `/discover/${id}`;
}

// What the profile shows for one project. The member list itself is never sent, only its size.
export function profileProjectView(project, profileUserId, viewerId) {
  const viewerIsMember = isProjectMember(project, viewerId);
  return {
    _id: String(project._id),
    name: project.name,
    description: project.description || '',
    domain: project.domain || '',
    status: project.status || 'Planning',
    visibility: project.visibility === 'Private' ? 'Private' : 'Public',
    tags: Array.isArray(project.tags) ? project.tags : [],
    color: project.color || 'violet',
    role: memberRole(project, profileUserId),
    memberCount: (project.members || []).length,
    viewerIsMember,
    path: projectPathFor(project, viewerIsMember),
  };
}

// Keeps only the projects the viewer may see, in the order given.
export function visibleProfileProjects(projects, profileUserId, viewerId) {
  return (projects || [])
    .filter((project) => isProjectMember(project, profileUserId) && canSeeOnProfile(project, viewerId))
    .map((project) => profileProjectView(project, profileUserId, viewerId));
}

const count = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};

// D6: the numbers shown in "Contribution snapshot" and the stats strip on My profile.
export function snapshotView(raw = {}) {
  return {
    projects: count(raw.projects),
    completedProjects: count(raw.completedProjects),
    tasksCompleted: count(raw.tasksCompleted),
    tasksCompletedThisWeek: count(raw.tasksCompletedThisWeek),
    messagesPosted: count(raw.messagesPosted),
    decisionsRecorded: count(raw.decisionsRecorded),
    collaborators: count(raw.collaborators),
    followerCount: count(raw.followerCount),
    followingCount: count(raw.followingCount),
    joinedAt: raw.joinedAt ? new Date(raw.joinedAt).toISOString() : null,
  };
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 7 · M4] What this file does
 * Decides who appears in followers / following lists and how each person is shown, which of
 * a user's projects a viewer may see on their profile (Public, or Private when the viewer is a
 * member too) and where each one links, and cleans the real "Contribution snapshot" numbers.
 * ---------------------------------------------------------------------------
 */
