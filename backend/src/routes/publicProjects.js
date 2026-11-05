import { Router } from 'express';

import Project from '../models/Project.js';
import { PROJECT_DOMAINS } from '../lib/projectSetup.js';
import {
  DISCOVER_PAGE_SIZE,
  PROJECT_STATUSES,
  readDiscoverQuery,
  sortedTags,
  toPublicProject,
} from '../lib/publicDiscovery.js';

/*
 * [Sprint 5 · M1] US-45 Browse and filter public projects (FR-18, FR-30). Mounted at
 * /api/public/projects (see app.js). No login: a Visitor can use it.
 *
 * GET /            ?q=&domain=&tag=&status=&page=
 *                  -> { projects, page, pageSize, total, filters: { q, domain, tag, status } }
 *                  Only Public projects, most recently updated first, 24 per page.
 *                  Each project: { _id, name, description, domain, tags, status, memberCount, createdAt, updatedAt }
 *                  (no member names, emails, roles or GitHub data).
 * GET /filters     -> { domains, statuses, tags }   tags = skill tags used by Public projects only
 *
 * Bad filter values answer 400 (lib/publicDiscovery.js has the rules and messages).
 * This router never reads the Authorization header, so a missing, expired or garbage token
 * makes no difference: everyone gets the same public answer.
 *
 * For M2 (US-46 public project page): add the read-only page as GET /:projectId in this same
 * router so every no-login project URL lives under /api/public/projects.
 */

const router = Router();

// Public answers are the same for everyone, so a shared cache must not mix them with private ones.
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.get('/filters', async (_req, res, next) => {
  try {
    const tags = await Project.distinct('tags', { visibility: 'Public' });
    return res.json({ domains: PROJECT_DOMAINS, statuses: PROJECT_STATUSES, tags: sortedTags(tags) });
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const query = readDiscoverQuery(req.query);
    if (!query.ok) return res.status(400).json({ message: query.message });

    const skip = (query.page - 1) * DISCOVER_PAGE_SIZE;
    const [rows, total] = await Promise.all([
      Project.find(query.filter)
        .select('name description domain tags status members.user createdAt updatedAt')
        .sort({ updatedAt: -1, _id: -1 })
        .skip(skip)
        .limit(DISCOVER_PAGE_SIZE)
        .lean(),
      Project.countDocuments(query.filter),
    ]);

    return res.json({
      projects: rows.map(toPublicProject),
      page: query.page,
      pageSize: DISCOVER_PAGE_SIZE,
      total,
      filters: query.applied,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;

/*
 * ---------------------------------------------------------------------------
 * [Sprint 5 · M1] What this file does
 * No-login API for the Discover page: lists Public projects with keyword,
 * domain, skill-tag and status filters and paging, and returns the filter
 * choices. Only whitelisted, non-personal project fields are sent.
 * ---------------------------------------------------------------------------
 */
