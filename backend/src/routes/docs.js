import { Router } from 'express';

import DocPage from '../models/DocPage.js';
import { requireAuth } from '../middleware/auth.js';
import { loadProjectForMember, validId } from '../lib/projectAccess.js';
import { canWriteDocs } from '../lib/permissions.js';
import { docPreview, readDocInput } from '../lib/docs.js';

/*
 * [Sprint 4 · M6] Project documentation pages (US-38 Write a documentation page, FR-14b).
 * Mounted at /api/projects/:id/docs (see app.js). Project members only, also for Public projects.
 *
 * GET   /          members (all roles)          -> { docs }   most recently updated first
 *                  Each: { _id, project, title, preview, length, createdBy, updatedBy, createdAt, updatedAt }
 *                  (no full content in the list)
 * GET   /:docId    members (all roles)          -> { doc }    same fields plus content
 * POST  /          Owner, Admin, Contributor    { title, content } -> 201 { doc }
 * PATCH /:docId    Owner, Admin, Contributor    { title?, content? } -> { doc }
 *
 * Rules (lib/docs.js): title required, up to 120 characters; content required Markdown, up to
 * 10,000 characters. A missing, invalid or too-long field answers 400 and nothing is saved.
 * Viewers get 403 on POST/PATCH but can read. Non-members get 403. A page of another project is 404.
 *
 * The Markdown is stored and returned as plain text. The server never turns it into HTML;
 * the browser renders it safely (frontend/src/components/markdown.jsx).
 */

const router = Router({ mergeParams: true });
router.use(requireAuth);

const USER_FIELDS = 'name username avatarUrl';
const VIEWER_WRITE_MESSAGE = 'Viewers can read documentation but cannot write it.';

function populated(query) {
  return query.populate('createdBy', USER_FIELDS).populate('updatedBy', USER_FIELDS);
}

function docView(doc, { withContent }) {
  const { __v, content, ...rest } = doc;
  const view = { ...rest, preview: docPreview(content), length: String(content || '').length };
  if (withContent) view.content = content;
  return view;
}

async function viewOf(docId) {
  const doc = await populated(DocPage.findById(docId)).lean();
  return docView(doc, { withContent: true });
}

async function findDoc(req, res, project) {
  if (!validId(req.params.docId)) {
    res.status(400).json({ message: 'Invalid page ID.' });
    return null;
  }
  const doc = await DocPage.findOne({ _id: req.params.docId, project: project._id });
  if (!doc) {
    res.status(404).json({ message: 'Documentation page not found.' });
    return null;
  }
  return doc;
}

router.get('/', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;

    const rows = await populated(
      DocPage.find({ project: loaded.project._id }).sort({ updatedAt: -1, _id: -1 })
    ).lean();

    return res.json({ docs: rows.map((row) => docView(row, { withContent: false })) });
  } catch (error) {
    return next(error);
  }
});

router.get('/:docId', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;
    const doc = await findDoc(req, res, loaded.project);
    if (!doc) return undefined;

    return res.json({ doc: await viewOf(doc._id) });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;
    if (!canWriteDocs(loaded.role)) return res.status(403).json({ message: VIEWER_WRITE_MESSAGE });

    const input = readDocInput(req.body, { partial: false });
    if (!input.ok) return res.status(400).json({ message: input.message });

    const created = await DocPage.create({
      project: loaded.project._id,
      title: input.values.title,
      content: input.values.content,
      createdBy: req.user.id,
    });

    return res.status(201).json({ doc: await viewOf(created._id) });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:docId', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;
    if (!canWriteDocs(loaded.role)) return res.status(403).json({ message: VIEWER_WRITE_MESSAGE });

    const doc = await findDoc(req, res, loaded.project);
    if (!doc) return undefined;

    // Every check runs before anything is changed, so a refused edit saves nothing.
    const input = readDocInput(req.body, { partial: true });
    if (!input.ok) return res.status(400).json({ message: input.message });

    const changes = {};
    if (input.values.title !== undefined && input.values.title !== doc.title) changes.title = input.values.title;
    if (input.values.content !== undefined && input.values.content !== doc.content) changes.content = input.values.content;

    if (Object.keys(changes).length > 0) {
      doc.set({ ...changes, updatedBy: req.user.id });
      await doc.save();
    }

    return res.json({ doc: await viewOf(doc._id) });
  } catch (error) {
    return next(error);
  }
});

export default router;

/*
 * ---------------------------------------------------------------------------
 * [Sprint 4 · M6] What this file does
 * REST API for project documentation pages: list and read them (any member),
 * create and save them (Owner/Admin/Contributor). Markdown content up to
 * 10,000 characters, checked on the server and stored as plain text.
 * ---------------------------------------------------------------------------
 */
