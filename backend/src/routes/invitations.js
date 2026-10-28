import { Router } from 'express';

import Invitation, { INVITATION_STATUSES, INVITE_EXPIRY_MS, effectiveStatus } from '../models/Invitation.js';
import Project from '../models/Project.js';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { loadProjectForMember, memberRole, validId } from '../lib/projectAccess.js';
import { canManageMembers, checkAddMember } from '../lib/permissions.js';
import { logActivity } from '../lib/activity.js';

/*
 * [Sprint 3 · M1] Project invitations (US-10, US-11, FR-31)
 *
 * Owner / Admin of a project, mounted at /api/projects/:id/invitations
 *   POST /                 { identifier (email or username, "@name" is fine), role? = 'Contributor' }
 *                          -> 201 { invitation }   pending, expires in 7 days
 *                          400 no identifier / bad role · 403 not Owner/Admin, or role not allowed for you
 *                          404 no such user · 409 already a member | already has a pending invitation
 *                          Owner may invite as Admin, Contributor or Viewer; Admin as Contributor or Viewer
 *                          (same rules as adding a member, US-09).
 *   GET  /?status=all      -> { invitations }   newest first; status all (default) | Pending | Accepted | Declined | Expired
 *                          This is how the inviter sees that an invitation was declined (US-11).
 *
 * The invited user, mounted at /api/invitations
 *   GET  /?status=Pending  -> { invitations }   my invitations, newest first; same status values as above
 *   POST /:invitationId/accept   -> { invitation, project: { _id, name }, joined }
 *                          I become a member with the invited role and the invitation is closed (Accepted).
 *                          joined is false if I was already a member by then (my role is not changed).
 *   POST /:invitationId/decline  -> { invitation }   I am not added; the invitation is closed (Declined).
 *   Both answer 404 for an invitation that is not mine and 409 when it was already answered or has expired.
 *
 * Every invitation comes back with status already worked out (a Pending one past expiresAt says 'Expired'),
 * and with invitee and invitedBy { _id, name, username, avatarUrl } and project { _id, name, color, visibility,
 * description } populated. Emails are never returned.
 */

const USER_FIELDS = 'name username avatarUrl';
const PROJECT_FIELDS = 'name color visibility description';
const STATUS_FILTERS = [...INVITATION_STATUSES, 'all'];

function populated(query) {
  return query
    .populate('invitee', USER_FIELDS)
    .populate('invitedBy', USER_FIELDS)
    .populate('project', PROJECT_FIELDS);
}

// What the API returns: the stored row with its effective status.
function view(invitation, now = new Date()) {
  if (!invitation) return null;
  return { ...invitation, status: effectiveStatus(invitation, now) };
}

// Mongo filter for one effective status. Pending and Expired depend on the clock.
function statusFilter(status, now = new Date()) {
  if (status === 'all') return {};
  if (status === 'Pending') return { status: 'Pending', expiresAt: { $gt: now } };
  if (status === 'Expired') return { $or: [{ status: 'Expired' }, { status: 'Pending', expiresAt: { $lte: now } }] };
  return { status };
}

function readStatus(req, res, fallback) {
  const status = req.query.status === undefined ? fallback : String(req.query.status);
  if (!STATUS_FILTERS.includes(status)) {
    res.status(400).json({ message: `Status must be one of: ${STATUS_FILTERS.join(', ')}.` });
    return null;
  }
  return status;
}

// Stores 'Expired' on pending invitations whose time is up, so they stop holding the one-pending slot.
async function markExpired(filter, now = new Date()) {
  await Invitation.updateMany(
    { ...filter, status: 'Pending', expiresAt: { $lte: now } },
    { $set: { status: 'Expired' } }
  );
}

// ---- Owner / Admin: /api/projects/:id/invitations ------------------------------------------

export const projectInvitationRoutes = Router({ mergeParams: true });
projectInvitationRoutes.use(requireAuth);

// Loads the project for its Owner/Admin. Responds itself and returns null when the caller must stop.
async function loadProjectForManager(req, res) {
  const loaded = await loadProjectForMember(req, res);
  if (!loaded) return null;
  if (!canManageMembers(loaded.role)) {
    res.status(403).json({ message: 'Only project Owners and Admins can invite people.' });
    return null;
  }
  return loaded;
}

projectInvitationRoutes.post('/', async (req, res, next) => {
  try {
    const loaded = await loadProjectForManager(req, res);
    if (!loaded) return undefined;
    const { project, role: actorRole } = loaded;

    const role = req.body?.role === undefined ? 'Contributor' : req.body.role;
    const allowed = checkAddMember(actorRole, role);
    if (!allowed.ok) return res.status(allowed.status).json({ message: allowed.message });

    const identifier = String(req.body?.identifier || '').trim().toLowerCase().replace(/^@/, '');
    if (!identifier) return res.status(400).json({ message: 'Enter the email or username of the person to invite.' });

    const person = await User.findOne(identifier.includes('@') ? { email: identifier } : { username: identifier })
      .select('_id name')
      .lean();
    if (!person) return res.status(404).json({ message: 'No DevOrbit user matches that email or username.' });

    // Also covers inviting yourself: you are already a member.
    if (memberRole(project, person._id.toString())) {
      return res.status(409).json({ message: 'That person is already a member of this project.' });
    }

    const now = new Date();
    await markExpired({ project: project._id, invitee: person._id }, now);

    const duplicate = { message: 'That person already has a pending invitation to this project.' };
    const pending = await Invitation.exists({ project: project._id, invitee: person._id, status: 'Pending' });
    if (pending) return res.status(409).json(duplicate);

    let created;
    try {
      created = await Invitation.create({
        project: project._id,
        invitee: person._id,
        invitedBy: req.user.id,
        role,
        expiresAt: new Date(now.getTime() + INVITE_EXPIRY_MS),
      });
    } catch (error) {
      // Two invites at the same moment: the unique index keeps only one.
      if (error?.code === 11000) return res.status(409).json(duplicate);
      throw error;
    }

    await logActivity({
      project: project._id,
      actor: req.user.id,
      type: 'invite.sent',
      summary: `invited ${person.name} to join as ${role}`,
      targetType: 'invite',
      targetId: created._id,
      targetLabel: person.name,
      meta: { role },
    });

    const invitation = await populated(Invitation.findById(created._id)).lean();
    return res.status(201).json({ invitation: view(invitation) });
  } catch (error) {
    return next(error);
  }
});

projectInvitationRoutes.get('/', async (req, res, next) => {
  try {
    const loaded = await loadProjectForManager(req, res);
    if (!loaded) return undefined;

    const status = readStatus(req, res, 'all');
    if (!status) return undefined;

    const now = new Date();
    const rows = await populated(
      Invitation.find({ project: loaded.project._id, ...statusFilter(status, now) }).sort({ createdAt: -1, _id: -1 }).limit(100)
    ).lean();
    return res.json({ invitations: rows.map((row) => view(row, now)) });
  } catch (error) {
    return next(error);
  }
});

// ---- The invited user: /api/invitations ----------------------------------------------------

export const myInvitationRoutes = Router();
myInvitationRoutes.use(requireAuth);

myInvitationRoutes.get('/', async (req, res, next) => {
  try {
    const status = readStatus(req, res, 'Pending');
    if (!status) return undefined;

    const now = new Date();
    const rows = await populated(
      Invitation.find({ invitee: req.user.id, ...statusFilter(status, now) }).sort({ createdAt: -1, _id: -1 }).limit(50)
    ).lean();
    // A project that no longer exists has nothing to join.
    const invitations = rows.filter((row) => row.project).map((row) => view(row, now));
    return res.json({ invitations });
  } catch (error) {
    return next(error);
  }
});

/*
 * Closes one of my pending, unexpired invitations as Accepted or Declined.
 * Only one answer can win, even if accept and decline are clicked at the same moment.
 * Responds itself (400/404/409) and returns null when the caller must stop.
 */
async function respond(req, res, status) {
  if (!validId(req.params.invitationId)) {
    res.status(400).json({ message: 'Invalid invitation ID.' });
    return null;
  }

  const now = new Date();
  const answered = await Invitation.findOneAndUpdate(
    { _id: req.params.invitationId, invitee: req.user.id, status: 'Pending', expiresAt: { $gt: now } },
    { $set: { status, respondedAt: now } },
    { new: true }
  ).lean();
  if (answered) return answered;

  // Someone else's invitation answers 404, so its existence is not revealed.
  const existing = await Invitation.findOne({ _id: req.params.invitationId, invitee: req.user.id }).lean();
  if (!existing) {
    res.status(404).json({ message: 'Invitation not found.' });
    return null;
  }
  if (effectiveStatus(existing, now) === 'Expired') {
    await markExpired({ _id: existing._id }, now);
    res.status(409).json({ message: 'This invitation has expired. Ask the project team to invite you again.' });
    return null;
  }
  res.status(409).json({ message: `This invitation was already ${existing.status.toLowerCase()}.` });
  return null;
}

myInvitationRoutes.post('/:invitationId/accept', async (req, res, next) => {
  try {
    const answered = await respond(req, res, 'Accepted');
    if (!answered) return undefined;

    // Add them with the invited role, unless they joined some other way in the meantime.
    const added = await Project.updateOne(
      { _id: answered.project, 'members.user': { $ne: answered.invitee } },
      { $push: { members: { user: answered.invitee, role: answered.role } } }
    );
    const joined = added.modifiedCount === 1;

    const project = await Project.findById(answered.project).select('name').lean();
    if (project) {
      await logActivity({
        project: project._id,
        actor: req.user.id,
        type: 'invite.accepted',
        summary: joined ? `accepted the invitation and joined as ${answered.role}` : 'accepted the invitation',
        targetType: 'invite',
        targetId: answered._id,
        targetLabel: project.name,
        meta: { role: answered.role },
      });
    }

    const invitation = await populated(Invitation.findById(answered._id)).lean();
    return res.json({
      invitation: view(invitation),
      project: project ? { _id: project._id, name: project.name } : null,
      joined,
    });
  } catch (error) {
    return next(error);
  }
});

myInvitationRoutes.post('/:invitationId/decline', async (req, res, next) => {
  try {
    const answered = await respond(req, res, 'Declined');
    if (!answered) return undefined;

    const project = await Project.findById(answered.project).select('name').lean();
    if (project) {
      // Shown in the project's Activity Feed, so the inviter can see it was declined (US-11).
      await logActivity({
        project: project._id,
        actor: req.user.id,
        type: 'invite.declined',
        summary: 'declined the invitation to join the project',
        targetType: 'invite',
        targetId: answered._id,
        targetLabel: project.name,
        meta: { role: answered.role },
      });
    }

    const invitation = await populated(Invitation.findById(answered._id)).lean();
    return res.json({ invitation: view(invitation) });
  } catch (error) {
    return next(error);
  }
});
