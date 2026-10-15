
import { Router } from 'express';
import mongoose from 'mongoose';
import Project from '../models/Project.js';
import Task from '../models/Task.js';
import { requireAuth } from '../middleware/auth.js';
import { canWriteTasks, canDeleteTask } from '../lib/permissions.js';

const router = Router({ mergeParams: true });

router.use(requireAuth);

function validId(id) {
  return mongoose.isValidObjectId(id);
}

function memberRole(project, userId) {
  const member = project.members.find(
    (item) => item.user?._id?.toString() === userId ||
      item.user?.toString() === userId
  );

  return member?.role || null;
}

function isMember(project, userId) {
  return Boolean(memberRole(project, userId));
}

async function loadProject(req, res) {
  if (!validId(req.params.id)) {
    res.status(400).json({ message: 'Invalid project ID.' });
    return null;
  }

  const project = await Project.findById(req.params.id);

  if (!project) {
    res.status(404).json({ message: 'Project not found.' });
    return null;
  }

  const role = memberRole(project, req.user.id);

  if (project.visibility === 'Private' && !role) {
    res.status(403).json({
      message: 'You do not have access to this project.',
    });
    return null;
  }

  return { project, role };
}

async function updateProgress(projectId) {
  const total = await Task.countDocuments({ project: projectId });

  const done = await Task.countDocuments({
    project: projectId,
    status: 'Done',
  });

  const progress = total === 0 ? 0 : Math.round((done / total) * 100);

  await Project.findByIdAndUpdate(projectId, { progress });
}

async function validateAssignee(project, assigneeId) {
  if (assigneeId === null || assigneeId === '') {
    return { ok: true, assignee: null };
  }

  if (!validId(assigneeId)) {
    return { ok: false, message: 'Invalid assignee ID.' };
  }

  const isProjectMember = project.members.some(
    (member) => member.user?.toString() === assigneeId
  );

  if (!isProjectMember) {
    return {
      ok: false,
      message: 'Assignee must be a member of this project.',
    };
  }

  return { ok: true, assignee: assigneeId };
}

router.get('/', async (req, res, next) => {
  try {
    const loaded = await loadProject(req, res);
    if (!loaded) return;

    const { project, role } = loaded;

    if (!role && project.visibility !== 'Public') {
      return res.status(403).json({
        message: 'You do not have access to this project.',
      });
    }

    
const filter = { project: project._id };

if (req.query.status) {
  filter.status = req.query.status;
}

if (req.query.assignee === 'none') {
  filter.assignee = null;
} else if (req.query.assignee === 'me') {
  filter.assignee = req.user.id;
} else if (req.query.assignee) {
  if (!validId(req.query.assignee)) {
    return res.status(400).json({ message: 'Invalid assignee ID.' });
  }
  filter.assignee = req.query.assignee;
}

const tasks = await Task.find(filter)
  .populate('assignee', 'name username avatarUrl')
  .populate('createdBy', 'name username')
  .sort({ createdAt: -1 })
  .lean();


    return res.json({ tasks, membershipRole: role });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const loaded = await loadProject(req, res);
    if (!loaded) return;

    const { project, role } = loaded;

    if (!role) {
      return res.status(403).json({
        message: 'Only project members can create tasks.',
      });
    }

    if (!canWriteTasks(role)) {
      return res.status(403).json({
        message: 'Your role cannot create tasks.',
      });
    }

    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();

    if (!title) {
      return res.status(400).json({ message: 'Task title is required.' });
    }

    if (title.length > 200) {
      return res.status(400).json({
        message: 'Task title must be 200 characters or fewer.',
      });
    }

    if (description.length > 2000) {
      return res.status(400).json({
        message: 'Description must be 2,000 characters or fewer.',
      });
    }

    const priority = req.body.priority ?? 'Medium';
    const status = req.body.status ?? 'To do';

    if (!['Low', 'Medium', 'High'].includes(priority)) {
      return res.status(400).json({ message: 'Invalid task priority.' });
    }

    if (!['To do', 'In progress', 'Done'].includes(status)) {
      return res.status(400).json({ message: 'Invalid task status.' });
    }

    const assigneeResult = await validateAssignee(
      project,
      req.body.assignee ?? null
    );

    if (!assigneeResult.ok) {
      return res.status(400).json({ message: assigneeResult.message });
    }

    let dueDate = null;

    if (req.body.dueDate) {
      dueDate = new Date(req.body.dueDate);

      if (Number.isNaN(dueDate.getTime())) {
        return res.status(400).json({ message: 'Invalid due date.' });
      }
    }

    const task = await Task.create({
      project: project._id,
      title,
      description,
      status,
      priority,
      assignee: assigneeResult.assignee,
      createdBy: req.user.id,
      dueDate,
    });

    await updateProgress(project._id);

    return res.status(201).json({ task });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:taskId', async (req, res, next) => {
  try {
    const loaded = await loadProject(req, res);
    if (!loaded) return;

    const { project, role } = loaded;

    if (!role) {
      return res.status(403).json({
        message: 'Only project members can edit tasks.',
      });
    }

    if (!canWriteTasks(role)) {
      return res.status(403).json({
        message: 'Your role cannot edit tasks.',
      });
    }

    if (!validId(req.params.taskId)) {
      return res.status(400).json({ message: 'Invalid task ID.' });
    }

    const task = await Task.findOne({
      _id: req.params.taskId,
      project: project._id,
    });

    if (!task) {
      return res.status(404).json({ message: 'Task not found.' });
    }

    const allowedFields = [
      'title',
      'description',
      'status',
      'priority',
      'assignee',
      'dueDate',
    ];

    const fields = Object.keys(req.body);

    if (fields.length === 0 || fields.some((field) => !allowedFields.includes(field))) {
      return res.status(400).json({ message: 'Invalid task fields.' });
    }

    if (req.body.title !== undefined) {
      const title = String(req.body.title).trim();

      if (!title || title.length > 200) {
        return res.status(400).json({
          message: 'Task title is required and must be 200 characters or fewer.',
        });
      }

      task.title = title;
    }

    if (req.body.description !== undefined) {
      const description = String(req.body.description).trim();

      if (description.length > 2000) {
        return res.status(400).json({
          message: 'Description must be 2,000 characters or fewer.',
        });
      }

      task.description = description;
    }

    if (req.body.status !== undefined) {
      if (!['To do', 'In progress', 'Done'].includes(req.body.status)) {
        return res.status(400).json({ message: 'Invalid task status.' });
      }

      task.status = req.body.status;
    }

    if (req.body.priority !== undefined) {
      if (!['Low', 'Medium', 'High'].includes(req.body.priority)) {
        return res.status(400).json({ message: 'Invalid task priority.' });
      }

      task.priority = req.body.priority;
    }

    if (req.body.assignee !== undefined) {
      const assigneeResult = await validateAssignee(
        project,
        req.body.assignee
      );

      if (!assigneeResult.ok) {
        return res.status(400).json({ message: assigneeResult.message });
      }

      task.assignee = assigneeResult.assignee;
    }

    if (req.body.dueDate !== undefined) {
      if (req.body.dueDate === null || req.body.dueDate === '') {
        task.dueDate = null;
      } else {
        const dueDate = new Date(req.body.dueDate);

        if (Number.isNaN(dueDate.getTime())) {
          return res.status(400).json({ message: 'Invalid due date.' });
        }

        task.dueDate = dueDate;
      }
    }

    await task.save();
    await updateProgress(project._id);

    return res.json({ task });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:taskId', async (req, res, next) => {
  try {
    const loaded = await loadProject(req, res);
    if (!loaded) return;

    const { project, role } = loaded;

    if (!role) {
      return res.status(403).json({
        message: 'Only project members can delete tasks.',
      });
    }

    if (!validId(req.params.taskId)) {
      return res.status(400).json({ message: 'Invalid task ID.' });
    }

    const task = await Task.findOne({
      _id: req.params.taskId,
      project: project._id,
    });

    if (!task) {
      return res.status(404).json({ message: 'Task not found.' });
    }

    const isCreator = task.createdBy.toString() === req.user.id;

    if (!canDeleteTask(role, isCreator)) {
      return res.status(403).json({
        message: 'Your role cannot delete this task.',
      });
    }

    await task.deleteOne();
    await updateProgress(project._id);

    return res.json({ message: 'Task deleted successfully.' });
  } catch (error) {
    return next(error);
  }
});

export default router;