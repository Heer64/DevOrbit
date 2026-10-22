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
// [Sprint 2 final] How many open subscriptions use each project room. The room is only left when
// the last one stops, so closing the Chat tab does not stop live updates on the task board.
const joinCounts = new Map();

function getSocket(origin, getToken) {
  if (socket) return socket;

  socket = io(origin, {
    // Called on every (re)connect, so a refreshed access token is picked up automatically.
    auth: (callback) => callback({ token: getToken() || '' }),
    withCredentials: true,
    transports: ['websocket', 'polling'],
  });

  // A rejected handshake (e.g. the access token expired) is not retried by Socket.IO itself.
  socket.on('connect_error', () => {
    if (socket.active || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      socket?.connect();
    }, 5000);
  });

  return socket;
}

/*
 * [Sprint 2 final] Calls handler(payload) for every `eventName` event of this project
 * (e.g. 'task:updated', 'message:created'). Returns a function that stops listening.
 */
export function subscribeToProjectEvent({ origin, getToken }, projectId, eventName, handler) {
  const current = getSocket(origin, getToken);

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
  socket?.disconnect();
  socket = null;
}
