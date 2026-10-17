import { io } from 'socket.io-client';

/*
 * Browser side of the live task updates (Sprint 2 Pair D).
 * Server side: backend/src/lib/realtime.js. One shared socket per tab; each open project joins its room.
 *
 * Loaded lazily by taskApi.subscribe() in api.js, so pages that never show tasks do not download it.
 */

let socket = null;
let retryTimer = null;

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
 * Calls onTaskUpdated(task) whenever someone changes a task in this project.
 * Returns a function that stops listening.
 */
export function subscribeToProjectTasks({ origin, getToken }, projectId, onTaskUpdated) {
  const current = getSocket(origin, getToken);

  const join = () => current.emit('project:join', { projectId });
  const handler = (payload) => {
    if (payload?.projectId === projectId && payload.task) onTaskUpdated(payload.task);
  };

  current.on('connect', join);
  current.on('task:updated', handler);
  if (current.connected) join();

  return () => {
    current.off('connect', join);
    current.off('task:updated', handler);
    if (current.connected) current.emit('project:leave', { projectId });
  };
}

// Used on logout so the next user does not reuse this connection.
export function disconnectRealtime() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  socket?.disconnect();
  socket = null;
}
