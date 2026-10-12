import { Router } from 'express';
import mongoose from 'mongoose';
import Project from '../models/Project.js';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { canEditProject, checkAddMember, checkRoleChange, checkRemoveMember } from '../lib/permissions.js';

const router = Router();
router.use(requireAuth);

function isMember(project, userId) {
  return project.members.some((member) => member.user?._id?.toString() === userId || member.user?.toString() === userId);
}
function memberRole(project, userId) {
  const member = project.members.find((item) => item.user?._id?.toString() === userId || item.user?.toString() === userId);
  return member?.role || null;
}
function canManage(project, userId) {
  return canEditProject(memberRole(project, userId));
}
function validId(id) {
  return mongoose.isValidObjectId(id);
}

router.get('/discover', async (req, res, next) => {
  try {
    const query = String(req.query.q || '').trim();
    const filter = { visibility: 'Public' };
    if (query) {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(escaped, 'i');
      filter.$or = [{ name: pattern }, { description: pattern }, { domain: pattern }, { tags: pattern }];
    }
    const rows = await Project.find(filter).sort({ updatedAt: -1 }).limit(100).lean();
    const projects = rows.map((project) => ({ ...project, members: (project.members || []).map(() => ({})) }));
    return res.json({ projects });
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const projects = await Project.find({ 'members.user': req.user.id }).sort({ updatedAt: -1 }).lean();
    return res.json({ projects });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const description = String(req.body.description || '').trim();
    const domain = String(req.body.domain || 'General').trim();
    const visibility = req.body.visibility === undefined ? 'Public' : req.body.visibility;
    if (!name) return res.status(400).json({ message: 'Project name is required.' });
    if (!['Public', 'Private'].includes(visibility)) return res.status(400).json({ message: 'Visibility must be Public or Private.' });
    if (domain.length > 80) return res.status(400).json({ message: 'Domain must be 80 characters or fewer.' });
    if (name.length > 80) return res.status(400).json({ message: 'Project name must be 80 characters or fewer.' });
    if (description.length > 2000) return res.status(400).json({ message: 'Description must be 2,000 characters or fewer.' });
    const color = ['violet', 'mint', 'orange', 'blue'][Math.floor(Math.random() * 4)];
    const project = await Project.create({
      name,
      description,
      domain: domain || 'General',
      visibility,
      color,
      members: [{ user: req.user.id, role: 'Owner' }],
      tags: domain && domain !== 'General' ? [domain] : [],
    });
    return res.status(201).json({ project });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid project ID.' });
    const project = await Project.findById(req.params.id).lean();
    if (!project) return res.status(404).json({ message: 'Project not found.' });
    const member = isMember(project, req.user.id);
    if (project.visibility === 'Private' && !member) return res.status(403).json({ message: 'You do not have access to this project.' });
    if (!member) {
      // Visitors to a public project page receive public metadata only.
      project.members = (project.members || []).map((membership) => ({ role: membership.role }));
    }
    return res.json({ project, membershipRole: memberRole(project, req.user.id) });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid project ID.' });
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: 'Project not found.' });
    if (!canManage(project, req.user.id)) return res.status(403).json({ message: 'Only project Owners and Admins can edit project details.' });

    const allowed = ['name', 'description', 'domain', 'visibility', 'status', 'tags', 'githubRepo', 'progress'];
    const update = {};
    for (const field of allowed) if (req.body[field] !== undefined) update[field] = req.body[field];
    if (update.name !== undefined) {
      update.name = String(update.name).trim();
      if (!update.name || update.name.length > 80) return res.status(400).json({ message: 'Project name is required and must be 80 characters or fewer.' });
    }
    if (update.description !== undefined && String(update.description).length > 2000) return res.status(400).json({ message: 'Description must be 2,000 characters or fewer.' });
    if (update.tags !== undefined && (!Array.isArray(update.tags) || update.tags.length > 20)) return res.status(400).json({ message: 'Project tags must be a list of at most 20 items.' });
    if (update.progress !== undefined && (!Number.isFinite(Number(update.progress)) || Number(update.progress) < 0 || Number(update.progress) > 100)) return res.status(400).json({ message: 'Progress must be between 0 and 100.' });

    for (const [key, value] of Object.entries(update)) project[key] = value;
    await project.save();
    return res.json({ project });
  } catch (error) {
    return next(error);
  }
});

// ---- Members and roles (US-09) -------------------------------------------------------------
// Every check below runs on the server; the UI only hides buttons.

function memberView(member, usersById) {
  const id = (member.user?._id || member.user).toString();
  const user = usersById.get(id);
  return {
    userId: id,
    role: member.role,
    name: user?.name || 'Former member',
    username: user?.username || '',
    avatarUrl: user?.avatarUrl || '',
  };
}

async function loadMembers(project) {
  const ids = project.members.map((member) => member.user);
  const users = await User.find({ _id: { $in: ids } }).select('name username avatarUrl').lean();
  const usersById = new Map(users.map((user) => [user._id.toString(), user]));
  return project.members.map((member) => memberView(member, usersById));
}

// Loads the project and the caller's role. Responds 400/404/403 itself and returns null when the caller must stop.
async function loadProjectForMember(req, res) {
  if (!validId(req.params.id)) { res.status(400).json({ message: 'Invalid project ID.' }); return null; }
  const project = await Project.findById(req.params.id);
  if (!project) { res.status(404).json({ message: 'Project not found.' }); return null; }
  const role = memberRole(project, req.user.id);
  if (!role) { res.status(403).json({ message: 'You are not a member of this project.' }); return null; }
  return { project, role };
}

router.get('/:id/members', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;
    return res.json({ members: await loadMembers(loaded.project), membershipRole: loaded.role });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/members', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;
    const { project, role: actorRole } = loaded;

    const newRole = req.body.role === undefined ? 'Contributor' : req.body.role;
    const allowed = checkAddMember(actorRole, newRole);
    if (!allowed.ok) return res.status(allowed.status).json({ message: allowed.message });

    const identifier = String(req.body.identifier || '').trim().toLowerCase().replace(/^@/, '');
    if (!identifier) return res.status(400).json({ message: 'Enter the email or username of the person to add.' });
    const person = await User.findOne(identifier.includes('@') ? { email: identifier } : { username: identifier }).select('_id');
    if (!person) return res.status(404).json({ message: 'No DevOrbit user matches that email or username.' });
    if (isMember(project, person._id.toString())) return res.status(409).json({ message: 'That person is already a member of this project.' });

    project.members.push({ user: person._id, role: newRole });
    await project.save();
    return res.status(201).json({ members: await loadMembers(project) });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/members/:userId', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;
    const { project, role: actorRole } = loaded;
    if (!validId(req.params.userId)) return res.status(400).json({ message: 'Invalid user ID.' });

    const targetRole = memberRole(project, req.params.userId);
    // Viewers and Contributors are told 403 before anything about other members is revealed.
    if (!['Owner', 'Admin'].includes(actorRole)) return res.status(403).json({ message: 'Only project Owners and Admins can change roles.' });
    if (!targetRole) return res.status(404).json({ message: 'That person is not a member of this project.' });

    const allowed = checkRoleChange(actorRole, targetRole, req.body.role);
    if (!allowed.ok) return res.status(allowed.status).json({ message: allowed.message });

    const member = project.members.find((item) => item.user.toString() === req.params.userId);
    member.role = req.body.role;
    await project.save();
    return res.json({ members: await loadMembers(project) });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id/members/:userId', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;
    const { project, role: actorRole } = loaded;
    if (!validId(req.params.userId)) return res.status(400).json({ message: 'Invalid user ID.' });

    const targetRole = memberRole(project, req.params.userId);
    const isSelf = req.params.userId === req.user.id;
    if (!targetRole) {
      if (!['Owner', 'Admin'].includes(actorRole)) return res.status(403).json({ message: 'Only project Owners and Admins can remove members.' });
      return res.status(404).json({ message: 'That person is not a member of this project.' });
    }
    const allowed = checkRemoveMember(actorRole, targetRole, isSelf);
    if (!allowed.ok) return res.status(allowed.status).json({ message: allowed.message });

    project.members = project.members.filter((item) => item.user.toString() !== req.params.userId);
    await project.save();
    return res.json({ members: await loadMembers(project) });
  } catch (error) {
    return next(error);
  }
});

export default router;
