import { Router } from 'express';
import mongoose from 'mongoose';

import Project from '../models/Project.js';
import Task from '../models/Task.js';
import { requireAuth } from '../middleware/auth.js';
import { canWriteTasks, canDeleteTask } from '../lib/permissions.js';

const router = Router({ mergeParams: true });

const TASK_STATUSES = ['To do', 'In progress', 'Done'];
const TASK_PRIORITIES = ['Low', 'Medium', 'High'];

router.use(requireAuth);

function validId(id) {
  return mongoose.isValidObjectId(id);
}

function isMember(project, userId) {
  return (project.members || []).some(
    (member) =>
      member.user?._id?.toString() === userId ||
      member.user?.toString() === userId
  );
}

function memberRole(project, userId) {
  const member = (project.members || []).find(
    (item) =>
      item.user?._id?.toString() === userId ||
      item.user?.toString() === userId
  );

  return member?.role || null;
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
  const member = Boolean(role);

  if (project.visibility === 'Private' && !member) {
    res.status(403).json({
      message: 'You do not have access to this project.',
    });
    return null;
  }

  return { project, role, member };
}

async function validateAssignee(project, assignee) {
  if (assignee === null || assignee === undefined || assignee === '') {
    return { valid: true, value: null };
  }

  if (!validId(assignee)) {
    return {
      valid: false,
      status: 400,
      message: 'Invalid assignee ID.',
    };
  }

  const assignedMember = (project.members || []).some(
    (member) =>
      member.user?._id?.toString() === assignee ||
      member.user?.toString() === assignee
  );

  if (!assignedMember) {
    return {
      valid: false,
      status: 400,
      message: 'Assignee must be a member of this project.',
    };
  }

  return { valid: true, value: assignee };
}

async function updateProgress(projectId) {
  const totalTasks = await Task.countDocuments({
    project: projectId,
  });

  if (totalTasks === 0) {
    await Project.findByIdAndUpdate(projectId, {
      progress: 0,
    });

    return 0;
  }

  const completedTasks = await Task.countDocuments({
    project: projectId,
    status: 'Done',
  });

  const progress = Math.round((completedTasks / totalTasks) * 100);

  await Project.findByIdAndUpdate(projectId, {
    progress,
  });

  return progress;
}

/*
 * GET /api/projects/:id/tasks
 *
 * List tasks for a project.
 *
 * Optional filters:
 *   ?status=Done
 *   ?assignee=<userId>
 *   ?assignee=me
 *   ?assignee=none
 *   ?assignee=unassigned
 */
router.get('/', async (req, res, next) => {
  try {
    const loaded = await loadProject(req, res);

    if (!loaded) {
      return;
    }

    const { project, member } = loaded;

    const filter = {
      project: project._id,
    };

    if (req.query.status !== undefined) {
      if (!TASK_STATUSES.includes(req.query.status)) {
        return res.status(400).json({
          message: 'Invalid task status.',
        });
      }

      filter.status = req.query.status;
    }

    if (req.query.assignee !== undefined) {
      if (
        req.query.assignee === 'none' ||
        req.query.assignee === 'unassigned'
      ) {
        filter.assignee = null;
      } else if (req.query.assignee === 'me') {
        filter.assignee = req.user.id;
      } else if (!validId(req.query.assignee)) {
        return res.status(400).json({
          message: 'Invalid assignee ID.',
        });
      } else {
        filter.assignee = req.query.assignee;
      }
    }

    const tasks = await Task.find(filter)
      .populate('assignee', 'name username email avatarUrl')
      .populate('createdBy', 'name username email')
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      tasks,
      membershipRole: member ? loaded.role : null,
    });
  } catch (error) {
    return next(error);
  }
});

/*
 * POST /api/projects/:id/tasks
 *
 * Create a task.
 */
router.post('/', async (req, res, next) => {
  try {
    const loaded = await loadProject(req, res);

    if (!loaded) {
      return;
    }

    const { project, role, member } = loaded;

    if (!member) {
      return res.status(403).json({
        message: 'You must be a project member to create tasks.',
      });
    }

    if (!canWriteTasks(role)) {
      return res.status(403).json({
        message: 'You do not have permission to create tasks.',
      });
    }

    const title = String(req.body.title || '').trim();
    const description = String(req.body.description || '').trim();

    if (!title) {
      return res.status(400).json({
        message: 'Task title is required.',
      });
    }

    if (title.length > 200) {
      return res.status(400).json({
        message: 'Task title must be 200 characters or fewer.',
      });
    }

    if (description.length > 2000) {
      return res.status(400).json({
        message: 'Task description must be 2,000 characters or fewer.',
      });
    }

    const status =
      req.body.status === undefined ? 'To do' : req.body.status;

    if (!TASK_STATUSES.includes(status)) {
      return res.status(400).json({
        message: 'Invalid task status.',
      });
    }

    const priority =
      req.body.priority === undefined ? 'Medium' : req.body.priority;

    if (!TASK_PRIORITIES.includes(priority)) {
      return res.status(400).json({
        message: 'Invalid task priority.',
      });
    }

    const assigneeResult = await validateAssignee(
      project,
      req.body.assignee
    );

    if (!assigneeResult.valid) {
      return res.status(assigneeResult.status).json({
        message: assigneeResult.message,
      });
    }

    let dueDate = null;

    if (
      req.body.dueDate !== undefined &&
      req.body.dueDate !== null &&
      req.body.dueDate !== ''
    ) {
      const parsedDate = new Date(req.body.dueDate);

      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({
          message: 'Invalid due date.',
        });
      }

      dueDate = parsedDate;
    }

    const task = await Task.create({
      project: project._id,
      title,
      description,
      status,
      priority,
      assignee: assigneeResult.value,
      createdBy: req.user.id,
      dueDate,
      completedAt: status === 'Done' ? new Date() : null,
    });

    await updateProgress(project._id);

    const populatedTask = await Task.findById(task._id)
      .populate('assignee', 'name username email avatarUrl')
      .populate('createdBy', 'name username email')
      .lean();

    return res.status(201).json({
      task: populatedTask,
    });
  } catch (error) {
    return next(error);
  }
});

/*
 * PATCH /api/projects/:id/tasks/:taskId
 *
 * Update a task.
 */
router.patch('/:taskId', async (req, res, next) => {
  try {
    const loaded = await loadProject(req, res);

    if (!loaded) {
      return;
    }

    const { project, role, member } = loaded;

    if (!member) {
      return res.status(403).json({
        message: 'You must be a project member to edit tasks.',
      });
    }

    if (!canWriteTasks(role)) {
      return res.status(403).json({
        message: 'You do not have permission to edit tasks.',
      });
    }

    if (!validId(req.params.taskId)) {
      return res.status(400).json({
        message: 'Invalid task ID.',
      });
    }

    const task = await Task.findOne({
      _id: req.params.taskId,
      project: project._id,
    });

    if (!task) {
      return res.status(404).json({
        message: 'Task not found.',
      });
    }

    const allowedFields = [
      'title',
      'description',
      'status',
      'priority',
      'assignee',
      'dueDate',
    ];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        if (field === 'title') {
          const title = String(req.body.title).trim();

          if (!title) {
            return res.status(400).json({
              message: 'Task title is required.',
            });
          }

          if (title.length > 200) {
            return res.status(400).json({
              message: 'Task title must be 200 characters or fewer.',
            });
          }

          task.title = title;
        }

        if (field === 'description') {
          const description = String(req.body.description || '').trim();

          if (description.length > 2000) {
            return res.status(400).json({
              message: 'Task description must be 2,000 characters or fewer.',
            });
          }

          task.description = description;
        }

        if (field === 'status') {
          if (!TASK_STATUSES.includes(req.body.status)) {
            return res.status(400).json({
              message: 'Invalid task status.',
            });
          }

          task.status = req.body.status;

          /*
           * completedAt logic:
           *
           * - When a task becomes Done, record the completion time.
           * - When a Done task is reopened, clear completedAt.
           */
          if (req.body.status === 'Done') {
            task.completedAt = new Date();
          } else {
            task.completedAt = null;
          }
        }

        if (field === 'priority') {
          if (!TASK_PRIORITIES.includes(req.body.priority)) {
            return res.status(400).json({
              message: 'Invalid task priority.',
            });
          }

          task.priority = req.body.priority;
        }

        if (field === 'assignee') {
          const assigneeResult = await validateAssignee(
            project,
            req.body.assignee
          );

          if (!assigneeResult.valid) {
            return res.status(assigneeResult.status).json({
              message: assigneeResult.message,
            });
          }

          task.assignee = assigneeResult.value;
        }

        if (field === 'dueDate') {
          if (
            req.body.dueDate === null ||
            req.body.dueDate === ''
          ) {
            task.dueDate = null;
          } else {
            const parsedDate = new Date(req.body.dueDate);

            if (Number.isNaN(parsedDate.getTime())) {
              return res.status(400).json({
                message: 'Invalid due date.',
              });
            }

            task.dueDate = parsedDate;
          }
        }
      }
    }

    await task.save();

    await updateProgress(project._id);

    const populatedTask = await Task.findById(task._id)
      .populate('assignee', 'name username email avatarUrl')
      .populate('createdBy', 'name username email')
      .lean();

    return res.json({
      task: populatedTask,
    });
  } catch (error) {
    return next(error);
  }
});

/*
 * DELETE /api/projects/:id/tasks/:taskId
 *
 * Delete a task.
 */
router.delete('/:taskId', async (req, res, next) => {
  try {
    const loaded = await loadProject(req, res);

    if (!loaded) {
      return;
    }

    const { project, role, member } = loaded;

    if (!member) {
      return res.status(403).json({
        message: 'You must be a project member to delete tasks.',
      });
    }

    if (!validId(req.params.taskId)) {
      return res.status(400).json({
        message: 'Invalid task ID.',
      });
    }

    const task = await Task.findOne({
      _id: req.params.taskId,
      project: project._id,
    });

    if (!task) {
      return res.status(404).json({
        message: 'Task not found.',
      });
    }

    const isCreator = task.createdBy?.toString() === req.user.id;

    if (!canDeleteTask(role, isCreator)) {
      return res.status(403).json({
        message: 'You do not have permission to delete this task.',
      });
    }

    await Task.deleteOne({
      _id: task._id,
    });

    await updateProgress(project._id);

    return res.json({
      message: 'Task deleted successfully.',
    });
  } catch (error) {
    return next(error);
  }
});

export default router;