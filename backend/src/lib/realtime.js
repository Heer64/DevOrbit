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
        return reply({ ok: true, role });
      } catch {
        return reply({ ok: false, message: 'Could not join the project.' });
      }
    });

    socket.on('project:leave', (payload) => {
      const projectId = String(payload?.projectId || '');
      if (validId(projectId)) socket.leave(projectRoom(projectId));
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

export async function closeRealtime() {
  if (!io) return;
  const server = io;
  io = null;
  await new Promise((resolve) => { server.close(() => resolve()); });
}
