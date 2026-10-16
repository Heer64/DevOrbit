import mongoose from 'mongoose';
import Project from '../models/Project.js';

export function validId(id) {
  return mongoose.isValidObjectId(id);
}

export function memberRole(project, userId) {
  const member = project.members.find(
    (item) =>
      item.user?._id?.toString() === userId ||
      item.user?.toString() === userId
  );

  return member?.role || null;
}

export async function loadProjectForMember(req, res) {
  if (!validId(req.params.id)) {
    res.status(400).json({ message: 'Invalid project ID.' });
    return null;
  }

  const project = await Project.findById(req.params.id).lean();

  if (!project) {
    res.status(404).json({ message: 'Project not found.' });
    return null;
  }

  const role = memberRole(project, req.user.id);

  if (!role) {
    res.status(403).json({
      message: 'You are not a member of this project.',
    });
    return null;
  }

  return { project, role };
}

// Like loadProjectForMember, but visitors may also read a Public project.
// Returns { project, role } where role is null for a visitor. Private projects stay members-only.
export async function loadProjectForViewer(req, res) {
  if (!validId(req.params.id)) {
    res.status(400).json({ message: 'Invalid project ID.' });
    return null;
  }

  const project = await Project.findById(req.params.id).lean();

  if (!project) {
    res.status(404).json({ message: 'Project not found.' });
    return null;
  }

  const role = memberRole(project, req.user.id);

  if (!role && project.visibility === 'Private') {
    res.status(403).json({
      message: 'You do not have access to this project.',
    });
    return null;
  }

  return { project, role };
}
