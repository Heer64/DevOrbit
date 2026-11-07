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
import { PUBLIC_PAGE_BAD_ID, PUBLIC_PAGE_NOT_FOUND, toPublicProjectPage } from '../lib/publicProjectPage.js'; // [Sprint 5 · M2] US-46
import { validId } from '../lib/projectAccess.js';

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
 * [Sprint 5 · M2] US-46 public read-only project page:
 * GET /:projectId  -> { project: { _id, name, description, domain, status, memberNames } }
 *                  Public projects only. A Private project answers exactly like a missing one
 *                  (404 "This project is not public or does not exist."), so its existence is not revealed.
 *                  400 for an ID that is not a valid project ID. Read-only: this router has no write routes.
 *                  Channels, messages, tasks and files are never included (they stay members-only).
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

// [Sprint 5 · M2] US-46: the public read-only page of one project. Kept after '/filters' so that word
// is never read as a project ID.
router.get('/:projectId', async (req, res, next) => {
  try {
    const { projectId } = req.params;
    if (!validId(projectId)) return res.status(400).json({ message: PUBLIC_PAGE_BAD_ID });

    // visibility is part of the query itself, so a Private project is never even loaded.
    const project = await Project.findOne({ _id: projectId, visibility: 'Public' })
      .select('name description domain status members.user')
      .populate('members.user', 'name')
      .lean();
    if (!project) return res.status(404).json({ message: PUBLIC_PAGE_NOT_FOUND });

    return res.json({ project: toPublicProjectPage(project) });
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
 * [Sprint 5 · M2] Also serves one Public project's read-only page (US-46).
 * ---------------------------------------------------------------------------
 */
