
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import taskRoutes from './routes/tasks.js';
import myTaskRoutes from './routes/myTasks.js';
import milestoneRoutes from './routes/milestones.js';
import { projectActivityRoutes, myActivityRoutes } from './routes/activity.js';
import profileRoutes from './routes/profile.js';
import channelRoutes from './routes/channels.js'; // [Sprint 2 final] US-16
import notificationRoutes from './routes/notifications.js'; // [Sprint 3 · M7 Part 1] US-30
import joinRequestRoutes from './routes/joinRequests.js'; // [Sprint 3 · M2] US-12, US-47
import threadRoutes from './routes/threads.js'; // [Sprint 3] US-17 thread replies
import taskCommentRoutes from './routes/taskComments.js'; // [Sprint 3] US-20 task comments
import { projectInvitationRoutes, myInvitationRoutes } from './routes/invitations.js'; // [Sprint 3 · M1] US-10, US-11
import decisionRoutes from './routes/decisions.js'; // [Sprint 3 · M8] US-35/US-36
import { projectGithubRoutes, githubCallbackRoutes } from './routes/github.js'; // [Sprint 4 · M1] US-31
import { githubRepositoriesRoutes, githubRepositoryRoutes } from './routes/githubRepository.js'; // [Sprint 4 · M2] US-32
import dashboardRoutes from './routes/dashboard.js'; // [Sprint 4 · M7] US-39
import healthRoutes from './routes/health.js'; // [Sprint 4 · M8] US-40
import { uploadRoot } from './lib/avatar.js';

export function createApp() {
  const app = express();
  const clientOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const skip = () => process.env.NODE_ENV === 'test';

  app.disable('x-powered-by');
  app.use(cors({ origin: clientOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  app.use('/api', rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    skip,
  }));

  app.use('/api/auth/login', rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
    skip,
  }));

  app.use('/api/auth/signup', rateLimit({
    windowMs: 60 * 60_000,
    limit: 15,
    standardHeaders: true,
    legacyHeaders: false,
    skip,
  }));

  app.use(
    '/uploads',
    (_req, res, next) => {
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Cross-Origin-Resource-Policy', 'cross-origin');
      next();
    },
    express.static(uploadRoot(), {
      index: false,
      dotfiles: 'deny',
    })
  );

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'devorbit-api' });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/projects', projectRoutes);
  // [Sprint 3] US-20. Mounted before the task routes so only comment URLs reach it.
  app.use('/api/projects/:id/tasks/:taskId/comments', taskCommentRoutes);
  app.use('/api/projects/:id/tasks', taskRoutes);
  app.use('/api/tasks', myTaskRoutes);
  app.use('/api/projects/:id/milestones', milestoneRoutes);
  app.use('/api/projects/:id/activity', projectActivityRoutes);
  app.use('/api/activity', myActivityRoutes);
  app.use('/api/profile', profileRoutes);
  // [Sprint 3] US-17. Mounted before the channel routes so only thread URLs reach it.
  app.use('/api/projects/:id/channels/:channelId/messages/:messageId/replies', threadRoutes);
  app.use('/api/projects/:id/channels', channelRoutes); // [Sprint 2 final] US-16
  app.use('/api/notifications', notificationRoutes); // [Sprint 3 · M7 Part 1] US-30
  app.use('/api/projects/:id/join-requests', joinRequestRoutes); // [Sprint 3 · M2] US-12, US-47
  app.use('/api/projects/:id/invitations', projectInvitationRoutes); // [Sprint 3 · M1] US-10
  app.use('/api/invitations', myInvitationRoutes); // [Sprint 3 · M1] US-11
  app.use('/api/projects/:id/decisions', decisionRoutes); // [Sprint 3 · M8] US-35/US-36
  // [Sprint 4 · M2] US-32: choose the repository. Mounted before the M1 routes so only these URLs reach them.
  app.use('/api/projects/:id/github/repositories', githubRepositoriesRoutes);
  app.use('/api/projects/:id/github/repository', githubRepositoryRoutes);
  app.use('/api/projects/:id/github', projectGithubRoutes); // [Sprint 4 · M1] US-31 integration settings
  app.use('/api/github', githubCallbackRoutes); // [Sprint 4 · M1] US-31 OAuth callback from GitHub
  app.use('/api/projects/:id/dashboard', dashboardRoutes); // [Sprint 4 · M7] US-39 project dashboard
  app.use('/api/projects/:id/health', healthRoutes); // [Sprint 4 · M8] US-40 project health

  app.use((_req, res) => {
    res.status(404).json({ message: 'API endpoint not found.' });
  });

  app.use((error, _req, res, _next) => {
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        message: 'Some fields are invalid.',
        details: Object.values(error.errors).map((item) => item.message),
      });
    }

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        message: 'Profile photo must be 2 MB or smaller.',
      });
    }

    if (error.name === 'MulterError') {
      return res.status(400).json({
        message: 'Upload a single image in the "avatar" field.',
      });
    }

    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({
        message: 'Request body is not valid JSON.',
      });
    }

    if (error.code === 11000) {
      return res.status(409).json({
        message: 'A record with that value already exists.',
      });
    }

    console.error(error);

    return res.status(error.status || 500).json({
      message: error.status
        ? error.message
        : 'Something went wrong. Please try again.',
    });
  });

  return app;
}
