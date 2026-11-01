const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/$/, '');

// Access tokens live only in memory. The HttpOnly refresh cookie is managed by the API.
let currentAccessToken = null;
let refreshInFlight = null;
let restoreSessionInFlight = null;

export function setAccessToken(token) {
  currentAccessToken = token || null;
}

export function clearAccessToken() {
  currentAccessToken = null;
  // [Pair D] Drop the live-updates socket so the next user does not reuse it.
  realtimeModule?.then((module) => module.disconnectRealtime()).catch(() => {});
}

// [Pair D] The Socket.IO client is only downloaded once a task list subscribes to live updates.
let realtimeModule = null;
function loadRealtime() {
  if (!realtimeModule) realtimeModule = import('./realtime.js');
  return realtimeModule;
}

function dispatchSessionExpired() {
  currentAccessToken = null;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('devorbit:session-expired'));
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function refreshAccessToken() {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const data = await readJson(response);
      if (!response.ok || !data.accessToken) {
        currentAccessToken = null;
        const error = new Error(data.message || 'Your session has expired. Please log in again.');
        error.status = response.status;
        throw error;
      }
      currentAccessToken = data.accessToken;
      return data.accessToken;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

function makeApiError(data, status) {
  const error = new Error(data?.message || `Request failed (${status}).`);
  error.status = status;
  error.details = data?.details;
  // Keep compatibility with components written against Axios-style errors.
  error.response = { status, data };
  return error;
}

export async function api(path, options = {}) {
  const { skipAuthRefresh = false, ...fetchOptions } = options;
  const authPathsWithoutRefresh = ['/auth/login', '/auth/signup', '/auth/refresh', '/auth/logout'];

  const request = async (accessToken) => {
    const headers = new Headers(fetchOptions.headers || {});
    headers.set('Accept', 'application/json');
    if (fetchOptions.body && !(fetchOptions.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
    else headers.delete('Authorization');

    return fetch(`${API_BASE}${path}`, {
      ...fetchOptions,
      headers,
      credentials: 'include',
    });
  };

  let response = await request(currentAccessToken);
  if (response.status === 401 && !skipAuthRefresh && !authPathsWithoutRefresh.includes(path)) {
    try {
      const token = await refreshAccessToken();
      response = await request(token);
      if (response.status === 401) dispatchSessionExpired();
    } catch {
      dispatchSessionExpired();
    }
  }

  const data = await readJson(response);
  if (!response.ok) throw makeApiError(data, response.status);
  return data;
}

export function restoreSession() {
  if (!restoreSessionInFlight) {
    restoreSessionInFlight = api('/auth/refresh', { method: 'POST', skipAuthRefresh: true }).finally(() => { restoreSessionInFlight = null; });
  }
  return restoreSessionInFlight;
}

export const authApi = {
  register: (payload) => api('/auth/signup', { method: 'POST', body: JSON.stringify(payload), skipAuthRefresh: true }),
  login: (payload) => api('/auth/login', { method: 'POST', body: JSON.stringify(payload), skipAuthRefresh: true }),
  refresh: () => restoreSession(),
  me: () => api('/auth/me'),
  logout: () => api('/auth/logout', { method: 'POST', skipAuthRefresh: true }),
};

export const profileApi = {
  get: () => api('/profile/me'),
  update: (payload) => api('/profile/me', { method: 'PATCH', body: JSON.stringify(payload) }),
  uploadAvatar: (file) => {
    const form = new FormData();
    form.append('avatar', file);
    return api('/profile/me/avatar', { method: 'POST', body: form });
  },
  removeAvatar: () => api('/profile/me/avatar', { method: 'DELETE' }),
};

export const projectApi = {
  list: () => api('/projects'),
  create: (payload) => api('/projects', { method: 'POST', body: JSON.stringify(payload) }),
  get: (id) => api(`/projects/${encodeURIComponent(id)}`),
  update: (id, payload) => api(`/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  discover: (q = '') => api(`/projects/discover?q=${encodeURIComponent(q)}`),
  members: (id) => api(`/projects/${encodeURIComponent(id)}/members`),
  addMember: (id, payload) => api(`/projects/${encodeURIComponent(id)}/members`, { method: 'POST', body: JSON.stringify(payload) }),
  setMemberRole: (id, userId, role) => api(`/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  removeMember: (id, userId) => api(`/projects/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
};

// Tasks inside one project. Contract: backend/src/routes/tasks.js
//   list   -> { tasks, membershipRole }     (filters: status, assignee = <userId> | 'me' | 'none')
//   create -> { task }   update -> { task }   remove -> { message }
// Each task has assignee and createdBy populated as { _id, name, username, ... } or null.
const projectTasksPath = (id) => `/projects/${encodeURIComponent(id)}/tasks`;

export const taskApi = {
  list: (id, params = {}) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')).toString();
    return api(`${projectTasksPath(id)}${query ? `?${query}` : ''}`);
  },
  create: (id, payload) => api(projectTasksPath(id), { method: 'POST', body: JSON.stringify(payload) }),
  update: (id, taskId, payload) => api(`${projectTasksPath(id)}/${encodeURIComponent(taskId)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  remove: (id, taskId) => api(`${projectTasksPath(id)}/${encodeURIComponent(taskId)}`, { method: 'DELETE' }),

  // [Pair D] Kanban (US-27/28).
  // get          -> { task }
  // updateStatus -> { task } | throws error with status 409 and error.response.data = { message, task }
  get: (id, taskId) => api(`${projectTasksPath(id)}/${encodeURIComponent(taskId)}`),
  updateStatus: (id, taskId, { status, version }) => api(`${projectTasksPath(id)}/${encodeURIComponent(taskId)}/status`, { method: 'PATCH', body: JSON.stringify({ status, version }) }),

  // Live updates: calls onTaskUpdated(task) for every task:updated event of this project.
  // Returns an unsubscribe function. Server side: backend/src/lib/realtime.js.
  // [Sprint 2 final] onTaskDeleted(taskId) is optional; created tasks arrive through onTaskUpdated.
  subscribe: (id, onTaskUpdated, onTaskDeleted) => {
    let stop = null;
    let cancelled = false;
    loadRealtime()
      .then((module) => {
        if (cancelled) return;
        stop = module.subscribeToProjectTasks(
          { origin: API_BASE.replace(/\/api$/, ''), getToken: () => currentAccessToken },
          id,
          onTaskUpdated,
          onTaskDeleted
        );
      })
      .catch(() => {}); // Live updates are a bonus; the board still works without them.
    return () => {
      cancelled = true;
      stop?.();
    };
  },

  // [Sprint 3 · US-20] Task comments. Contract: backend/src/routes/taskComments.js
  //   comments   -> { comments (oldest first), nextAfter }
  //   addComment -> { comment }   comment has author { name, username, avatarUrl } and mentions [{ _id, name, username }]
  //   onComment(handler) gets { projectId, taskId, comment }
  // The demo api (taskMock.js) has none of these, so the task window simply shows no comments there.
  comments: (id, taskId, { after, limit = 100 } = {}) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (after) params.set('after', after);
    return api(`${projectTasksPath(id)}/${encodeURIComponent(taskId)}/comments?${params}`);
  },
  addComment: (id, taskId, body) => api(`${projectTasksPath(id)}/${encodeURIComponent(taskId)}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
  onComment: (id, handler) => liveApi.onProject(id, 'comment:created', handler),
};

const projectPath = (id) => `/projects/${encodeURIComponent(id)}`;

// [Sprint 2 final] Generic live updates for one project. Calls handler(payload) for each
// `eventName` event ('message:created', ...). Returns an unsubscribe function.
export const liveApi = {
  onProject: (id, eventName, handler) => {
    let stop = null;
    let cancelled = false;
    loadRealtime()
      .then((module) => {
        if (cancelled) return;
        stop = module.subscribeToProjectEvent(
          { origin: API_BASE.replace(/\/api$/, ''), getToken: () => currentAccessToken },
          id,
          eventName,
          handler
        );
      })
      .catch(() => {}); // Live updates are a bonus; the page still works by reloading.
    return () => {
      cancelled = true;
      stop?.();
    };
  },
  // [Sprint 3 · M7 Part 2] Events sent to the signed-in user only (their notifications).
  onUser: (eventName, handler) => {
    let stop = null;
    let cancelled = false;
    loadRealtime()
      .then((module) => {
        if (cancelled) return;
        stop = module.subscribeToUserEvent(
          { origin: API_BASE.replace(/\/api$/, ''), getToken: () => currentAccessToken },
          eventName,
          handler
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      stop?.();
    };
  },
};

// [Sprint 3 · M7 Part 2] The signed-in user's notifications (US-30). Contract: backend/src/routes/notifications.js
//   list      -> { notifications (newest first), nextBefore, unreadCount }   pass nextBefore back as `before`
//   markRead  -> { notification, unreadCount }
//   onCreated -> live { notification, unreadCount };  onRead -> live { notificationId, unreadCount }
export const notificationApi = {
  list: ({ limit = 20, before, unread } = {}) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before) params.set('before', before);
    if (unread !== undefined) params.set('unread', String(Boolean(unread)));
    return api(`/notifications?${params}`);
  },
  markRead: (notificationId) => api(`/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'PATCH' }),
  onCreated: (handler) => liveApi.onUser('notification:created', handler),
  onRead: (handler) => liveApi.onUser('notification:read', handler),
};

// [Sprint 2 final] Project channels (US-16). Contract: backend/src/routes/channels.js
//   list     -> { channels, membershipRole }
//   create   -> { channel }
//   messages -> { messages (oldest first), nextBefore }   pass nextBefore back as `before` for older ones
//   send     -> { message }
const channelPath = (id, channelId = '') => `${projectPath(id)}/channels${channelId ? `/${encodeURIComponent(channelId)}` : ''}`;
export const channelApi = {
  list: (id) => api(channelPath(id)),
  create: (id, payload) => api(channelPath(id), { method: 'POST', body: JSON.stringify(payload) }),
  messages: (id, channelId, { before, limit = 50 } = {}) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before) params.set('before', before);
    return api(`${channelPath(id, channelId)}/messages?${params}`);
  },
  send: (id, channelId, body) => api(`${channelPath(id, channelId)}/messages`, { method: 'POST', body: JSON.stringify({ body }) }),
  onMessage: (id, handler) => liveApi.onProject(id, 'message:created', handler),

  // [Sprint 3 · US-17] Threads. Contract: backend/src/routes/threads.js
  //   replies -> { parent, replies (oldest first), nextAfter }
  //   reply   -> { reply, parent: { _id, replyCount, lastReplyAt } }
  //   onReply(handler) gets { projectId, channelId, parentId, reply, replyCount, lastReplyAt }
  replies: (id, channelId, messageId, { after, limit = 100 } = {}) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (after) params.set('after', after);
    return api(`${channelPath(id, channelId)}/messages/${encodeURIComponent(messageId)}/replies?${params}`);
  },
  reply: (id, channelId, messageId, body) => api(`${channelPath(id, channelId)}/messages/${encodeURIComponent(messageId)}/replies`, { method: 'POST', body: JSON.stringify({ body }) }),
  onReply: (id, handler) => liveApi.onProject(id, 'message:reply', handler),
};

// Milestones of one project. Each milestone comes back with taskCount, doneCount, progress (0-100) and completed.
export const milestoneApi = {
  list: (id) => api(`${projectPath(id)}/milestones`),
  create: (id, payload) => api(`${projectPath(id)}/milestones`, { method: 'POST', body: JSON.stringify(payload) }),
  update: (id, milestoneId, payload) => api(`${projectPath(id)}/milestones/${encodeURIComponent(milestoneId)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  remove: (id, milestoneId) => api(`${projectPath(id)}/milestones/${encodeURIComponent(milestoneId)}`, { method: 'DELETE' }),
  // Tasks attached to one milestone (uses the task API's ?milestone= filter).
  tasks: (id, milestoneId) => api(`${projectPath(id)}/tasks?milestone=${encodeURIComponent(milestoneId)}`),
};

// [Sprint 3 · M8] Decisions (US-35, US-36). Contract: backend/src/routes/decisions.js
//   list   -> { decisions }  newest date first, members only
//   get    -> { decision }
//   create -> { decision }   payload { title, description, participants: [userId], date: 'YYYY-MM-DD', link? }
//   update -> { decision }   any of the same fields; link: null removes it
// link sent: { type: 'task', id: taskId } | { type: 'thread', id: messageId } | null
// link returned: { type, id, label, href, missing } (missing = the task/thread was deleted; href is null then)
export const decisionApi = {
  list: (id) => api(`${projectPath(id)}/decisions`),
  get: (id, decisionId) => api(`${projectPath(id)}/decisions/${encodeURIComponent(decisionId)}`),
  create: (id, payload) => api(`${projectPath(id)}/decisions`, { method: 'POST', body: JSON.stringify(payload) }),
  update: (id, decisionId, payload) => api(`${projectPath(id)}/decisions/${encodeURIComponent(decisionId)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
};

// [Sprint 4 · M1] US-31 GitHub authorization. Contract: backend/src/routes/github.js
//   status    -> { configured, canAuthorize, connection: null | { githubLogin, scopes, authorizedAt, authorizedBy } }  Owner/Admin
//   authorize -> { url }  Owner only; send the browser to url. GitHub returns to /project/<id>?github=<result>.
// The GitHub access token is never sent to the browser.
export const githubApi = {
  status: (id) => api(`${projectPath(id)}/github`),
  authorize: (id) => api(`${projectPath(id)}/github/authorize`, { method: 'POST' }),
};

// [Sprint 4 · M7] Project dashboard (US-39). Contract: backend/src/routes/dashboard.js
//   project -> { project, membershipRole,
//                milestones: { total, completed, items: [{ _id, title, dueDate, taskCount, doneCount, progress, completed }] },
//                tasks: { total, open, done, byStatus },
//                dueSoon: { days, from, to, total, limit, tasks: [{ _id, title, status, priority, dueDate, assignee, milestone }] },
//                generatedAt }
// Members only (403 otherwise). Due dates are midnight-UTC calendar days; from/to are 'YYYY-MM-DD'.
export const dashboardApi = {
  project: (id) => api(`${projectPath(id)}/dashboard`),
};

// [Sprint 4 · M8] Mark complete / reopen (US-15). Contract: backend/src/routes/projects.js
//   complete -> { project }  reopen -> { project }   Owner only (403); 409 when already in that state.
export const projectCompletionApi = {
  complete: (id) => api(`${projectPath(id)}/complete`, { method: 'POST' }),
  reopen: (id) => api(`${projectPath(id)}/reopen`, { method: 'POST' }),
};

// [Sprint 4 · M8] Project health (US-40). Contract: backend/src/routes/health.js
//   project -> { project, membershipRole,
//                overdue: { total, limit, tasks: [{ _id, title, status, label, priority, dueDate, daysOverdue, assignee }] },
//                blocked: { total, limit, tasks: [ same shape ] },
//                activity: { days, since, count, level: 'Low'|'Medium'|'High', thresholds: { mediumFrom, highAbove } },
//                generatedAt }
// Owner and Admin only (403 otherwise).
export const healthApi = {
  project: (id) => api(`${projectPath(id)}/health`),
};

// Activity feeds. project() is members-only and newest first; pass nextBefore from a page as `before` for the next one.
export const activityApi = {
  project: (id, { limit = 30, before } = {}) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before) params.set('before', before);
    return api(`${projectPath(id)}/activity?${params}`);
  },
  mine: (limit = 10) => api(`/activity/me?limit=${encodeURIComponent(limit)}`),
};

// Personal task views for the dashboard (Sprint 2 leftovers). Contract: backend/src/routes/myTasks.js
//   upcoming -> { tasks, days }   open tasks due from today to `days` ahead, soonest first (US-23)
//   mine     -> { tasks, total }  open tasks assigned to me
//   stats    -> { completedLast7Days, openAssignedToMe }
// Each task has project { _id, name, color } and assignee populated.
export const myTaskApi = {
  upcoming: (days = 7, limit = 6) => api(`/tasks/upcoming?days=${encodeURIComponent(days)}&limit=${encodeURIComponent(limit)}`),
  mine: (limit = 6) => api(`/tasks/mine?limit=${encodeURIComponent(limit)}`),
  stats: () => api('/tasks/stats'),
};

// [Sprint 3 · M2] Join requests (US-12, US-47). Contract: backend/src/routes/joinRequests.js
//   mine    -> { joinRequest (my latest or null), canRequestAgainAt, isMember }
//   create  -> { joinRequest }   409 when already a member, already pending, or blocked (with canRequestAgainAt)
//   list    -> { joinRequests }  Owner/Admin only, oldest first (status: Pending by default)
//   approve -> { joinRequest }   role: 'Admin' | 'Contributor' | 'Viewer' (default Contributor)
//   reject  -> { joinRequest }
const joinRequestPath = (id, rest = '') => `${projectPath(id)}/join-requests${rest}`;
export const joinRequestApi = {
  mine: (id) => api(joinRequestPath(id, '/me')),
  create: (id, message = '') => api(joinRequestPath(id), { method: 'POST', body: JSON.stringify({ message }) }),
  list: (id, status = 'Pending') => api(`${joinRequestPath(id)}?status=${encodeURIComponent(status)}`),
  approve: (id, requestId, role = 'Contributor') => api(joinRequestPath(id, `/${encodeURIComponent(requestId)}/approve`), { method: 'POST', body: JSON.stringify({ role }) }),
  reject: (id, requestId) => api(joinRequestPath(id, `/${encodeURIComponent(requestId)}/reject`), { method: 'POST', body: JSON.stringify({}) }),
};

// [Sprint 3 · M1] Invitations (US-10, US-11). Contract: backend/src/routes/invitations.js
//   send       -> { invitation }    Owner/Admin; payload { identifier (email or username), role }
//                                   409 when already a member or already invited
//   forProject -> { invitations }   Owner/Admin, newest first (status: all by default) — shows Declined/Expired too
//   mine       -> { invitations }   my invitations (status: Pending by default)
//   accept     -> { invitation, project: { _id, name }, joined }
//   decline    -> { invitation }
// Each invitation has status ('Pending' | 'Accepted' | 'Declined' | 'Expired'), role, expiresAt, respondedAt,
// invitee / invitedBy { _id, name, username, avatarUrl } and project { _id, name, color, visibility, description }.
export const invitationApi = {
  send: (id, { identifier, role }) => api(`${projectPath(id)}/invitations`, { method: 'POST', body: JSON.stringify({ identifier, role }) }),
  forProject: (id, status = 'all') => api(`${projectPath(id)}/invitations?status=${encodeURIComponent(status)}`),
  mine: (status = 'Pending') => api(`/invitations?status=${encodeURIComponent(status)}`),
  accept: (invitationId) => api(`/invitations/${encodeURIComponent(invitationId)}/accept`, { method: 'POST', body: JSON.stringify({}) }),
  decline: (invitationId) => api(`/invitations/${encodeURIComponent(invitationId)}/decline`, { method: 'POST', body: JSON.stringify({}) }),
};

export const userApi = {
  search: (q = '') => api(`/profile/people?q=${encodeURIComponent(q)}`),
};

// Uploaded photos are stored by the API as "/uploads/avatars/<file>"; turn that into a full URL.
export function assetUrl(path) {
  if (!path) return '';
  if (/^(https?:|blob:|data:)/i.test(path)) return path;
  return `${API_BASE.replace(/\/api$/, '')}${path}`;
}

export function normalizeUser(user = {}) {
  const name = user.name || user.fullName || 'DevOrbit User';
  return {
    ...user,
    avatarSrc: assetUrl(user.avatarUrl),
    id: String(user.id || user._id || ''),
    name,
    fullName: user.fullName || name,
    headline: user.headline || user.bio || '',
    bio: user.bio || '',
    avatar: user.avatar || name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase(),
    skills: Array.isArray(user.skills) ? user.skills : [],
    isDemo: Boolean(user.isDemo),
  };
}

export function toProjectCard(project = {}, currentUser = null) {
  const name = project.name || 'Untitled project';
  const members = Array.isArray(project.members) ? project.members : [];
  const initials = members.map((member) => {
    const memberUser = member.user && typeof member.user === 'object' ? member.user : null;
    if (memberUser?.name) return memberUser.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
    if (currentUser && String(member.user?._id || member.user || '') === String(currentUser.id)) return currentUser.avatar || 'ME';
    return member.role === 'Owner' ? 'OW' : 'TM';
  });
  const progress = Number(project.progress || 0);
  return {
    ...project,
    id: String(project.id || project._id || ''),
    name,
    description: project.description || 'Your project workspace',
    tag: project.domain || project.tags?.[0] || 'Project',
    domain: project.domain || 'General',
    color: project.color || 'violet',
    progress,
    members: members.length || 1,
    initials: initials.length ? initials.slice(0, 4) : [currentUser?.avatar || 'ME'],
    due: project.due || 'Not set',
    status: project.status || (progress >= 100 ? 'Completed' : 'In progress'),
    repo: project.githubRepo || '',
    tags: Array.isArray(project.tags) ? project.tags : (project.domain ? [project.domain] : []),
  };
}

export function toWorkspaceProject(project = {}, currentUser = null) {
  const members = Array.isArray(project.members) ? project.members : [];
  const memberInitials = members.map((member) => {
    const memberUser = member.user && typeof member.user === 'object' ? member.user : null;
    if (memberUser?.name) return memberUser.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase();
    if (currentUser && String(member.user?._id || member.user || '') === String(currentUser.id)) return currentUser.avatar || 'ME';
    return member.role === 'Owner' ? 'OW' : 'TM';
  });
  const progress = Number(project.progress || 0);
  const name = project.name || 'Project workspace';
  return {
    ...project,
    id: String(project.id || project._id || ''),
    name,
    description: project.description || 'Your project details and team workspace.',
    domain: project.domain || 'General',
    repo: project.githubRepo || 'Repository not connected',
    color: project.color || 'violet',
    members: memberInitials.length ? memberInitials : [currentUser?.avatar || 'ME'],
    health: project.status === 'Completed' ? 'Completed' : 'On track',
    goal: project.description || `Build ${name} together.`,
    progress,
  };
}

export function toProfileProject(project = {}, currentUser = null) {
  const role = (project.members || []).find((member) => String(member.user?._id || member.user || '') === String(currentUser?.id))?.role || 'Member';
  return {
    name: project.name || 'Untitled project',
    role,
    tech: Array.isArray(project.tags) && project.tags.length ? project.tags : [project.domain || 'Project'],
    color: project.color || 'violet',
    status: project.status || 'In progress',
    progress: Number(project.progress || 0),
    id: String(project._id || project.id || ''),
  };
}

export { API_BASE };
