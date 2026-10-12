import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import profileRoutes from './routes/profile.js';
import { uploadRoot } from './lib/avatar.js';

// Builds the Express app without connecting to MongoDB or listening on a port,
// so server.js can start it and the automated tests can drive it directly.
export function createApp() {
  const app = express();
  const clientOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  // Rate limits protect a real deployment; the test suite makes many requests from one address.
  const skip = () => process.env.NODE_ENV === 'test';

  app.disable('x-powered-by');
  app.use(cors({ origin: clientOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, skip }));
  app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, skip }));
  app.use('/api/auth/signup', rateLimit({ windowMs: 60 * 60_000, limit: 15, standardHeaders: true, legacyHeaders: false, skip }));

  // Uploaded profile photos. nosniff stops browsers from treating a file as anything but an image;
  // cross-origin is allowed because the React app runs on a different port.
  app.use('/uploads', (_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  }, express.static(uploadRoot(), { index: false, dotfiles: 'deny' }));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'devorbit-api' }));
  app.use('/api/auth', authRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/api/profile', profileRoutes);

  app.use((_req, res) => res.status(404).json({ message: 'API endpoint not found.' }));
  app.use((error, _req, res, _next) => {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: 'Some fields are invalid.', details: Object.values(error.errors).map((item) => item.message) });
    }
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: 'Profile photo must be 2 MB or smaller.' });
    if (error.name === 'MulterError') return res.status(400).json({ message: 'Upload a single image in the "avatar" field.' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ message: 'Request body is not valid JSON.' });
    if (error.code === 11000) return res.status(409).json({ message: 'A record with that value already exists.' });
    console.error(error);
    return res.status(error.status || 500).json({ message: error.status ? error.message : 'Something went wrong. Please try again.' });
  });

  return app;
}
