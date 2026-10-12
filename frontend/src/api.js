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
