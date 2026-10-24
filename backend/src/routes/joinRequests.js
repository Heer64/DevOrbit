import { Router } from 'express';

import JoinRequest, { JOIN_MESSAGE_MAX, REJOIN_BLOCK_DAYS } from '../models/JoinRequest.js';
import Project from '../models/Project.js';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { loadProjectForMember, memberRole, validId } from '../lib/projectAccess.js';
import { canManageMembers, checkAddMember } from '../lib/permissions.js';
import { logActivity } from '../lib/activity.js';

/*
 * [Sprint 3 · M2] Join requests (US-12, US-47, FR-20), mounted at /api/projects/:id/join-requests
 *
 * Requester (any signed-in user who is not a member of a Public project)
 *   POST /                       { message? }  -> 201 { joinRequest }
 *                                400 message too long · 403 Private project · 404 no project
 *                                409 already a member | already pending | rejected less than 7 days ago
 *                                    (the blocked case also returns canRequestAgainAt)
 *   GET  /me                     -> { joinRequest (my latest, or null), canRequestAgainAt (date or null), isMember }
 *
 * Owner / Admin of the project
 *   GET  /?status=Pending        -> { joinRequests }   oldest first; status Pending (default) | Approved | Rejected | all
 *   POST /:requestId/approve     { role? = 'Contributor' } -> { joinRequest }
 *                                The person becomes a member with that role. Owner may give Admin, Contributor
 *                                or Viewer; Admin may give Contributor or Viewer (same rules as adding a member).
 *   POST /:requestId/reject      -> { joinRequest }   the person cannot ask again for 7 days
 *   Both answer 409 when the request was already decided, 404 when it is not in this project.
 *
 * Each joinRequest has user { _id, name, username, avatarUrl } and decidedBy { _id, name } populated.
 */
const router = Router({ mergeParams: true });
router.use(requireAuth);

const DAY_MS = 24 * 60 * 60 * 1000;
const USER_FIELDS = 'name username avatarUrl';
const STATUS_FILTERS = ['Pending', 'Approved', 'Rejected', 'all'];

function populated(query) {
  return query.populate('user', USER_FIELDS).populate('decidedBy', 'name');
}

// When a rejected person may ask again, or null if they are not blocked right now.
async function blockedUntil(projectId, userId, now = new Date()) {
  const recent = await JoinRequest.findOne({
    project: projectId,
    user: userId,
    status: 'Rejected',
    decidedAt: { $gt: new Date(now.getTime() - REJOIN_BLOCK_DAYS * DAY_MS) },
  })
    .sort({ decidedAt: -1 })
    .select('decidedAt')
    .lean();
  return recent ? new Date(recent.decidedAt.getTime() + REJOIN_BLOCK_DAYS * DAY_MS) : null;
}

// Loads the project for someone who may not be a member. Private projects stay hidden from non-members.
async function loadProjectForRequester(req, res) {
  if (!validId(req.params.id)) {
    res.status(400).json({ message: 'Invalid project ID.' });
    return null;
  }
  const project = await Project.findById(req.params.id).select('name visibility members').lean();
  if (!project) {
    res.status(404).json({ message: 'Project not found.' });
    return null;
  }
  const role = memberRole(project, req.user.id);
  if (!role && project.visibility !== 'Public') {
    res.status(403).json({ message: 'Only public projects accept join requests.' });
    return null;
  }
  return { project, role };
}

// Loads the project for its Owner/Admin. Responds itself and returns null when the caller must stop.
async function loadProjectForManager(req, res) {
  const loaded = await loadProjectForMember(req, res);
  if (!loaded) return null;
  if (!canManageMembers(loaded.role)) {
    res.status(403).json({ message: 'Only project Owners and Admins can review join requests.' });
    return null;
  }
  return loaded;
}

// ---- Requester ----------------------------------------------------------------------------

router.post('/', async (req, res, next) => {
  try {
    const loaded = await loadProjectForRequester(req, res);
    if (!loaded) return undefined;
    const { project, role } = loaded;

    if (role) return res.status(409).json({ message: 'You are already a member of this project.' });

    const message = String(req.body?.message ?? '').trim();
    if (message.length > JOIN_MESSAGE_MAX) {
      return res.status(400).json({ message: `Message must be ${JOIN_MESSAGE_MAX} characters or fewer.` });
    }

    const pending = await JoinRequest.exists({ project: project._id, user: req.user.id, status: 'Pending' });
    if (pending) return res.status(409).json({ message: 'You already have a pending request for this project.' });

    const canRequestAgainAt = await blockedUntil(project._id, req.user.id);
    if (canRequestAgainAt) {
      return res.status(409).json({
        message: `Your last request was not approved. You can ask again on ${canRequestAgainAt.toISOString().slice(0, 10)}.`,
        canRequestAgainAt,
      });
    }

    let created;
    try {
      created = await JoinRequest.create({ project: project._id, user: req.user.id, message });
    } catch (error) {
      // Two requests at the same moment: the unique index keeps only one.
      if (error?.code === 11000) return res.status(409).json({ message: 'You already have a pending request for this project.' });
      throw error;
    }

    await logActivity({
      project: project._id,
      actor: req.user.id,
      type: 'join_request.created',
      summary: 'asked to join the project',
      targetType: 'join_request',
      targetId: created._id,
      targetLabel: project.name,
    });

    const joinRequest = await populated(JoinRequest.findById(created._id)).lean();
    return res.status(201).json({ joinRequest });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', async (req, res, next) => {
  try {
    const loaded = await loadProjectForRequester(req, res);
    if (!loaded) return undefined;

    const [joinRequest, canRequestAgainAt] = await Promise.all([
      populated(JoinRequest.findOne({ project: loaded.project._id, user: req.user.id }).sort({ createdAt: -1, _id: -1 })).lean(),
      blockedUntil(loaded.project._id, req.user.id),
    ]);

    return res.json({ joinRequest: joinRequest || null, canRequestAgainAt, isMember: Boolean(loaded.role) });
  } catch (error) {
    return next(error);
  }
});

// ---- Owner / Admin ------------------------------------------------------------------------

router.get('/', async (req, res, next) => {
  try {
    const loaded = await loadProjectForManager(req, res);
    if (!loaded) return undefined;

    const status = req.query.status === undefined ? 'Pending' : String(req.query.status);
    if (!STATUS_FILTERS.includes(status)) {
      return res.status(400).json({ message: `Status must be one of: ${STATUS_FILTERS.join(', ')}.` });
    }

    const filter = { project: loaded.project._id };
    if (status !== 'all') filter.status = status;

    const joinRequests = await populated(JoinRequest.find(filter).sort({ createdAt: 1, _id: 1 }).limit(200)).lean();
    return res.json({ joinRequests });
  } catch (error) {
    return next(error);
  }
});

// Marks a pending request as decided. Only one decision can win, even if two managers click at once.
async function decide(req, res, { status, role = null }) {
  if (!validId(req.params.requestId)) {
    res.status(400).json({ message: 'Invalid join request ID.' });
    return null;
  }

  const decided = await JoinRequest.findOneAndUpdate(
    { _id: req.params.requestId, project: req.params.id, status: 'Pending' },
    { $set: { status, role, decidedBy: req.user.id, decidedAt: new Date() } },
    { new: true }
  );

  if (!decided) {
    const existing = await JoinRequest.findOne({ _id: req.params.requestId, project: req.params.id }).select('status').lean();
    if (!existing) res.status(404).json({ message: 'Join request not found.' });
    else res.status(409).json({ message: `This request was already ${existing.status.toLowerCase()}.` });
    return null;
  }
  return decided;
}

async function requesterName(userId) {
  const person = await User.findById(userId).select('name').lean();
  return person?.name || 'a former user';
}

router.post('/:requestId/approve', async (req, res, next) => {
  try {
    const loaded = await loadProjectForManager(req, res);
    if (!loaded) return undefined;
    const { project, role: actorRole } = loaded;

    const role = req.body?.role === undefined ? 'Contributor' : req.body.role;
    const allowed = checkAddMember(actorRole, role);
    if (!allowed.ok) return res.status(allowed.status).json({ message: allowed.message });

    const decided = await decide(req, res, { status: 'Approved', role });
    if (!decided) return undefined;

    // Add them unless someone already added them by hand in the meantime.
    await Project.updateOne(
      { _id: project._id, 'members.user': { $ne: decided.user } },
      { $push: { members: { user: decided.user, role } } }
    );

    const name = await requesterName(decided.user);
    await logActivity({
      project: project._id,
      actor: req.user.id,
      type: 'join_request.approved',
      summary: `approved ${name}'s request to join as ${role}`,
      targetType: 'join_request',
      targetId: decided._id,
      targetLabel: name,
      meta: { role },
    });

    const joinRequest = await populated(JoinRequest.findById(decided._id)).lean();
    return res.json({ joinRequest });
  } catch (error) {
    return next(error);
  }
});

router.post('/:requestId/reject', async (req, res, next) => {
  try {
    const loaded = await loadProjectForManager(req, res);
    if (!loaded) return undefined;

    const decided = await decide(req, res, { status: 'Rejected' });
    if (!decided) return undefined;

    const name = await requesterName(decided.user);
    await logActivity({
      project: loaded.project._id,
      actor: req.user.id,
      type: 'join_request.rejected',
      summary: `rejected ${name}'s request to join`,
      targetType: 'join_request',
      targetId: decided._id,
      targetLabel: name,
    });

    const joinRequest = await populated(JoinRequest.findById(decided._id)).lean();
    return res.json({ joinRequest });
  } catch (error) {
    return next(error);
  }
});

export default router;
