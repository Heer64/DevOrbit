import { io } from 'socket.io-client';

/*
 * Browser side of the live updates (Sprint 2 Pair D, extended in Sprint 2 final).
 * Server side: backend/src/lib/realtime.js. One shared socket per tab; each open project joins its room.
 *
 * Loaded lazily by api.js (taskApi.subscribe, liveApi.onProject), so pages that never need live
 * updates do not download it.
 */

let socket = null;
let retryTimer = null;
// [Sprint 7 · M6] Refused handshakes in a row (for the back-off), whether this socket has connected before
// (so the next 'connect' is a REconnect), and who wants to hear about reconnects.
let refusedInARow = 0;
let connectedBefore = false;
const reconnectListeners = new Set();

export const RETRY_FIRST_MS = 5000;
export const RETRY_MAX_MS = 60_000;

// 0 for the first refusal (refresh the token and retry at once), then 5 s, 10 s, 20 s … up to 60 s.
export function refusedRetryDelay(refusals) {
  if (refusals <= 1) return 0;
  return Math.min(RETRY_FIRST_MS * 2 ** (refusals - 2), RETRY_MAX_MS);
}
// [Sprint 2 final] How many open subscriptions use each project room. The room is only left when
// the last one stops, so closing the Chat tab does not stop live updates on the task board.
const joinCounts = new Map();

function getSocket({ origin, getToken, refreshToken }) {
  if (socket) return socket;

  socket = io(origin, {
    // Called on every (re)connect, so a refreshed access token is picked up automatically.
    auth: (callback) => callback({ token: getToken() || '' }),
    withCredentials: true,
    transports: ['websocket', 'polling'],
  });

  // [Sprint 7 · M6] Tell listeners when the connection is back after a drop: events sent meanwhile are lost,
  // so e.g. the notification bell reloads its list.
  socket.on('connect', () => {
    refusedInARow = 0;
    if (connectedBefore) reconnectListeners.forEach((listener) => { try { listener(); } catch { /* keep going */ } });
    connectedBefore = true;
  });

  // A rejected handshake (e.g. the access token expired) is not retried by Socket.IO itself.
  // [Sprint 7 · M6] Fix for live delivery on the deployed site: the access token lives 15 minutes, and the server
  // only checks it when a socket connects. After a Render restart or sleep, a laptop waking up or a Wi-Fi drop the
  // socket reconnects with a token that has run out, and before this fix it retried that same token every 5 s
  // until the person happened to click something. Now it gets a fresh token first (refreshToken), then
  // reconnects, backing off 5 s, 10 s … 60 s if the server keeps refusing (e.g. the session really ended).
  socket.on('connect_error', () => {
    if (socket.active || retryTimer) return; // a network problem: Socket.IO reconnects by itself
    refusedInARow += 1;
    retryTimer = setTimeout(async () => {
      retryTimer = null;
      if (refreshToken) {
        try { await refreshToken(); } catch { /* offline or signed out: try again later */ }
      }
      socket?.connect();
    }, refusedRetryDelay(refusedInARow));
  });

  return socket;
}

/*
 * [Sprint 2 final] Calls handler(payload) for every `eventName` event of this project
 * (e.g. 'task:updated', 'message:created'). Returns a function that stops listening.
 */
export function subscribeToProjectEvent(config, projectId, eventName, handler) {
  const current = getSocket(config);

  const join = () => current.emit('project:join', { projectId });
  const listener = (payload) => {
    if (payload?.projectId === projectId) handler(payload);
  };

  joinCounts.set(projectId, (joinCounts.get(projectId) || 0) + 1);
  current.on('connect', join);
  current.on(eventName, listener);
  if (current.connected) join();

  return () => {
    current.off('connect', join);
    current.off(eventName, listener);
    const left = (joinCounts.get(projectId) || 1) - 1;
    if (left > 0) {
      joinCounts.set(projectId, left);
    } else {
      joinCounts.delete(projectId);
      if (current.connected) current.emit('project:leave', { projectId });
    }
  };
}

/*
 * [Sprint 3 · M7 Part 2] Calls handler(payload) for every `eventName` event sent to the signed-in user
 * personally ('notification:created', 'notification:read'). The server puts each socket in the user's
 * own room when it connects, so nothing needs joining. Returns a function that stops listening.
 */
export function subscribeToUserEvent(config, eventName, handler) {
  const current = getSocket(config);
  current.on(eventName, handler);
  return () => current.off(eventName, handler);
}

/*
 * [Sprint 7 · M6] Calls handler() every time the live connection comes back after it was lost (not on the first
 * connect). Returns a function that stops listening.
 */
export function subscribeToReconnect(config, handler) {
  getSocket(config);
  reconnectListeners.add(handler);
  return () => reconnectListeners.delete(handler);
}

/*
 * Calls onTaskUpdated(task) whenever someone changes a task in this project.
 * [Sprint 2 final] Also calls onTaskUpdated(task) for a newly created task (task:created),
 * and onTaskDeleted(taskId) when someone deletes one (task:deleted).
 * Returns a function that stops listening.
 */
export function subscribeToProjectTasks(config, projectId, onTaskUpdated, onTaskDeleted) {
  const stops = [
    subscribeToProjectEvent(config, projectId, 'task:updated', (payload) => {
      if (payload.task) onTaskUpdated(payload.task);
    }),
    subscribeToProjectEvent(config, projectId, 'task:created', (payload) => {
      if (payload.task) onTaskUpdated(payload.task);
    }),
  ];
  if (onTaskDeleted) {
    stops.push(subscribeToProjectEvent(config, projectId, 'task:deleted', (payload) => {
      if (payload.taskId) onTaskDeleted(payload.taskId);
    }));
  }
  return () => stops.forEach((stop) => stop());
}

// Used on logout so the next user does not reuse this connection.
export function disconnectRealtime() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  joinCounts.clear();
  refusedInARow = 0; // [Sprint 7 · M6]
  connectedBefore = false;
  reconnectListeners.clear();
  socket?.disconnect();
  socket = null;
}
