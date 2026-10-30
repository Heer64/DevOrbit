import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import Project from '../models/Project.js';
import Session from '../models/Session.js';
import { memberRole, validId } from './projectAccess.js';

/*
 * Real-time updates over Socket.IO (Sprint 2 Pair D, US-24 / US-28).
 *
 * Client protocol
 *   connect    io(API_ORIGIN, { auth: { token: <access token> } })
 *              The token is the same JWT the REST API takes in "Authorization: Bearer".
 *   emit       'project:join'  { projectId }  ack -> { ok: true, role } | { ok: false, message }
 *   emit       'project:leave' { projectId }
 *   listen     'task:updated'  { projectId, task }   task = populated task, same shape as the REST API
 *   listen     'task:created'  { projectId, task }     [Sprint 2 final]
 *   listen     'task:deleted'  { projectId, taskId }   [Sprint 2 final]
 *   listen     'message:created' { projectId, channelId, message }   [Sprint 2 final] members only
 *   listen     'activity:created' { projectId, activity }   [US-29] members only, activity = populated feed event
 *   listen     'project:access-removed' { projectId, reason }   [Sprint 3 · M3] sent to a person removed from / leaving a project
 *   listen     'message:reply' { projectId, channelId, parentId, reply, replyCount, lastReplyAt }   [US-17] members only
 *   listen     'comment:created' { projectId, taskId, comment }   [US-20] members only
 *   listen     'notification:created' { notification, unreadCount }   [Sprint 3 · M7 Part 2] only to the recipient
 *   listen     'notification:read' { notificationId, unreadCount }    [Sprint 3 · M7 Part 2] only to the recipient
 *              Every authenticated socket is put in its own user room on connect (no join needed),
 *              so these reach all of the recipient's open tabs and nobody else.
 *
 * Who may join a project room: the same people who may read its tasks
 * (members of any project, and anyone for a Public project). Only reading happens here;
 * every change still goes through the REST API and its permission checks.
 *
 * This is the shared socket server. Other features (e.g. channel messages) should add their
 * events here instead of creating a second Socket.IO server.
 */

let io = null;

export const projectRoom = (projectId) => `project:${projectId}`;
// [Sprint 2 final] Members-only room. Chat messages go here, because visitors of a Public
// project may watch its task board (projectRoom) but must not read the team's channels.
export const memberRoom = (projectId) => `project:${projectId}:members`;
// [Sprint 3 · M7 Part 2] One private room per signed-in user, for their own notifications.
export const userRoom = (userId) => `user:${userId}`;

// Same checks as middleware/auth.js requireAuth: a valid JWT and a live, unrevoked session.
async function userIdFromToken(token) {
  if (!token || typeof token !== 'string') return null;

  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    if (!claims.id || !claims.sid) return null;

    const session = await Session.findOne({
      _id: claims.sid,
      user: claims.id,
      expiresAt: { $gt: new Date() },
    }).select('_id');

    return session ? String(claims.id) : null;
  } catch {
    return null;
  }
}

export function initRealtime(httpServer, { origins = [] } = {}) {
  io = new Server(httpServer, {
    cors: { origin: origins, credentials: true },
  });

  io.use(async (socket, next) => {
    const userId = await userIdFromToken(socket.handshake.auth?.token);
    if (!userId) return next(new Error('Authentication required.'));
    socket.data.userId = userId;
    return next();
  });

  io.on('connection', (socket) => {
    // [Sprint 3 · M7 Part 2] The user id comes from the verified token (io.use above), never from the client.
    socket.join(userRoom(socket.data.userId));

    socket.on('project:join', async (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const projectId = String(payload?.projectId || '');

      try {
        if (!validId(projectId)) return reply({ ok: false, message: 'Invalid project ID.' });

        const project = await Project.findById(projectId).select('members visibility').lean();
        if (!project) return reply({ ok: false, message: 'Project not found.' });

        const role = memberRole(project, socket.data.userId);
        if (!role && project.visibility === 'Private') {
          return reply({ ok: false, message: 'You do not have access to this project.' });
        }

        await socket.join(projectRoom(projectId));
        // [Sprint 2 final] Only real members also join the members-only room (chat).
        if (role) await socket.join(memberRoom(projectId));
        return reply({ ok: true, role });
      } catch {
        return reply({ ok: false, message: 'Could not join the project.' });
      }
    });

    socket.on('project:leave', (payload) => {
      const projectId = String(payload?.projectId || '');
      if (validId(projectId)) {
        socket.leave(projectRoom(projectId));
        socket.leave(memberRoom(projectId)); // [Sprint 2 final]
      }
    });
  });

  return io;
}

/*
 * Tells everyone watching the task's project that it changed.
 * Safe to call when the socket server is not running (tests, scripts): it does nothing.
 */
export function emitTaskUpdated(task) {
  if (!io || !task) return;
  const projectId = String(task.project?._id || task.project || '');
  if (!projectId) return;
  io.to(projectRoom(projectId)).emit('task:updated', { projectId, task });
}

/*
 * [Sprint 2 final] A task was created or deleted. Same room and rules as task:updated,
 * so a board open in another browser shows new tasks and drops deleted ones without a reload.
 *   'task:created' { projectId, task }      task = populated, same shape as the REST API
 *   'task:deleted' { projectId, taskId }
 */
export function emitTaskCreated(task) {
  if (!io || !task) return;
  const projectId = String(task.project?._id || task.project || '');
  if (!projectId) return;
  io.to(projectRoom(projectId)).emit('task:created', { projectId, task });
}

export function emitTaskDeleted(projectId, taskId) {
  if (!io || !projectId || !taskId) return;
  io.to(projectRoom(String(projectId))).emit('task:deleted', { projectId: String(projectId), taskId: String(taskId) });
}

/*
 * [Sprint 2 final] A new channel message (US-16). Sent to project members only.
 * Payload: { projectId, channelId, message }   message = populated, same shape as the REST API.
 */
export function emitMessageCreated(message) {
  if (!io || !message) return;
  const projectId = String(message.project?._id || message.project || '');
  const channelId = String(message.channel?._id || message.channel || '');
  if (!projectId || !channelId) return;
  io.to(memberRoom(projectId)).emit('message:created', { projectId, channelId, message });
}

/*
 * [US-17] A new reply in a message thread. Members only, like 'message:created'.
 * Payload: { projectId, channelId, parentId, reply, replyCount, lastReplyAt }
 *   reply      = populated, same shape as GET .../replies
 *   replyCount = the parent's new reply count, so every open channel can update its "N replies" label
 */
export function emitThreadReply(reply, { replyCount = 0, lastReplyAt = null } = {}) {
  if (!io || !reply) return;
  const projectId = String(reply.project?._id || reply.project || '');
  const channelId = String(reply.channel?._id || reply.channel || '');
  const parentId = String(reply.parentMessage?._id || reply.parentMessage || '');
  if (!projectId || !channelId || !parentId) return;
  io.to(memberRoom(projectId)).emit('message:reply', { projectId, channelId, parentId, reply, replyCount, lastReplyAt });
}

/*
 * [US-20] A new task comment. Members only: comments are team discussion, so visitors
 * watching a Public project's board (projectRoom) do not get them.
 * Payload: { projectId, taskId, comment }   comment = populated, same shape as GET .../comments
 */
export function emitCommentCreated(comment) {
  if (!io || !comment) return;
  const projectId = String(comment.project?._id || comment.project || '');
  const taskId = String(comment.task?._id || comment.task || '');
  if (!projectId || !taskId) return;
  io.to(memberRoom(projectId)).emit('comment:created', { projectId, taskId, comment });
}

/*
 * [US-29] A new Activity Feed event, sent by lib/activity.js logActivity().
 * Members only, like chat: the feed names people, so Public-project visitors do not get it.
 * Payload: { projectId, activity }   activity = same shape as GET /api/projects/:id/activity
 */
export function emitActivityCreated(activity) {
  if (!io || !activity) return;
  const projectId = String(activity.project?._id || activity.project || '');
  if (!projectId) return;
  io.to(memberRoom(projectId)).emit('activity:created', { projectId, activity });
}

/*
 * [Sprint 3 · M3] US-13 / US-14: someone was removed from a project or left it.
 * Their open browser tabs stop receiving the project's members-only events (chat, activity) right away,
 * and for a Private project its task events too. A Public project's board stays watchable, as for any visitor.
 * Each of their sockets also gets:
 *   'project:access-removed' { projectId, reason: 'removed' | 'left' }
 * so the page can tell them and reload. Never throws: the removal itself has already been saved.
 */
export async function revokeProjectAccess(projectId, userId, { visibility = 'Private', reason = 'removed' } = {}) {
  if (!io || !projectId || !userId) return;
  const pid = String(projectId);
  const uid = String(userId);

  try {
    const sockets = await io.in(memberRoom(pid)).fetchSockets();
    for (const socket of sockets) {
      if (String(socket.data?.userId) !== uid) continue;
      socket.leave(memberRoom(pid));
      if (visibility !== 'Public') socket.leave(projectRoom(pid));
      socket.emit('project:access-removed', { projectId: pid, reason });
    }
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') console.error('Could not revoke live access:', error.message);
  }
}

/*
 * [Sprint 3 · M7 Part 2] Notifications (US-30, NFR-6: shown within 5 seconds).
 * Sent only to the recipient's own room. Safe to call when the socket server is not running.
 *   'notification:created' { notification, unreadCount }   notification = same shape as GET /api/notifications
 *   'notification:read'    { notificationId, unreadCount }  so other open tabs update their badge
 */
export function realtimeActive() {
  return Boolean(io);
}

export function emitNotificationCreated(notification, unreadCount) {
  if (!io || !notification) return;
  const recipient = String(notification.recipient?._id || notification.recipient || '');
  if (!recipient) return;
  io.to(userRoom(recipient)).emit('notification:created', { notification, unreadCount });
}

export function emitNotificationRead(userId, notificationId, unreadCount) {
  if (!io || !userId || !notificationId) return;
  io.to(userRoom(String(userId))).emit('notification:read', { notificationId: String(notificationId), unreadCount });
}

export async function closeRealtime() {
  if (!io) return;
  const server = io;
  io = null;
  await new Promise((resolve) => { server.close(() => resolve()); });
}
