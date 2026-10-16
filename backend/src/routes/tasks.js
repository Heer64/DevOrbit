import { Router } from 'express';
import mongoose from 'mongoose';

import Project from '../models/Project.js';
import Task from '../models/Task.js';
import Milestone from '../models/Milestone.js';
import User from '../models/User.js';
import { logActivity, quote } from '../lib/activity.js';
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

// A task may only point at a milestone of its own project.
async function validateMilestone(project, milestone) {
  if (milestone === null || milestone === undefined || milestone === '') {
    return { valid: true, value: null };
  }

  if (!validId(milestone)) {
    return { valid: false, status: 400, message: 'Invalid milestone ID.' };
  }

  const exists = await Milestone.exists({ _id: milestone, project: project._id });

  if (!exists) {
    return {
      valid: false,
      status: 400,
      message: 'Milestone must belong to this project.',
    };
  }

  return { valid: true, value: milestone };
}

async function userName(userId) {
  if (!userId) return null;
  const user = await User.findById(userId).select('name').lean();
  return user?.name || 'a former member';
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
 * Writes one activity event for a task edit.
 * A status change wins (it is what the team cares about most), then a new assignee,
 * then a general "updated" event listing the fields. Nothing is logged when nothing changed.
 */
async function logTaskChanges(req, project, task, before) {
  const base = {
    project: project._id,
    actor: req.user.id,
    targetType: 'task',
    targetId: task._id,
    targetLabel: task.title,
  };

  if (task.status !== before.status) {
    return logActivity({
      ...base,
      type: 'task.status_changed',
      summary: `moved ${quote(task.title)} from ${before.status} to ${task.status}`,
      meta: { from: before.status, to: task.status },
    });
  }

  const assignee = task.assignee ? task.assignee.toString() : null;

  if (assignee !== before.assignee) {
    const summary = assignee
      ? `assigned ${quote(task.title)} to ${assignee === req.user.id ? 'themselves' : await userName(assignee)}`
      : `unassigned ${quote(task.title)}`;

    return logActivity({
      ...base,
      type: 'task.assigned',
      summary,
      meta: { from: before.assignee, to: assignee },
    });
  }

  const changed = [];
  if (task.title !== before.title) changed.push('title');
  if (task.description !== before.description) changed.push('description');
  if (task.priority !== before.priority) changed.push('priority');
  if ((task.dueDate ? task.dueDate.getTime() : null) !== before.dueDate) changed.push('due date');
  if ((task.milestone ? task.milestone.toString() : null) !== before.milestone) changed.push('milestone');

  if (changed.length === 0) return null;

  return logActivity({
    ...base,
    type: 'task.updated',
    summary: `updated the ${changed.join(', ')} of ${quote(task.title)}`,
    meta: { fields: changed },
  });
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
 *   ?milestone=<milestoneId>
 *   ?milestone=none
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

    if (req.query.milestone !== undefined) {
      if (req.query.milestone === 'none') {
        filter.milestone = null;
      } else if (!validId(req.query.milestone)) {
        return res.status(400).json({
          message: 'Invalid milestone ID.',
        });
      } else {
        filter.milestone = req.query.milestone;
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

    const milestoneResult = await validateMilestone(
      project,
      req.body.milestone
    );

    if (!milestoneResult.valid) {
      return res.status(milestoneResult.status).json({
        message: milestoneResult.message,
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
      milestone: milestoneResult.value,
      completedAt: status === 'Done' ? new Date() : null,
    });

    await updateProgress(project._id);

    await logActivity({
      project: project._id,
      actor: req.user.id,
      type: 'task.created',
      summary: `created task ${quote(task.title)}`,
      targetType: 'task',
      targetId: task._id,
      targetLabel: task.title,
      meta: { status: task.status },
    });

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

    const before = {
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      assignee: task.assignee ? task.assignee.toString() : null,
      dueDate: task.dueDate ? task.dueDate.getTime() : null,
      milestone: task.milestone ? task.milestone.toString() : null,
    };

    const allowedFields = [
      'title',
      'description',
      'status',
      'priority',
      'assignee',
      'dueDate',
      'milestone',
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

        if (field === 'milestone') {
          const milestoneResult = await validateMilestone(
            project,
            req.body.milestone
          );

          if (!milestoneResult.valid) {
            return res.status(milestoneResult.status).json({
              message: milestoneResult.message,
            });
          }

          task.milestone = milestoneResult.value;
        }
      }
    }

    await task.save();

    await updateProgress(project._id);

    await logTaskChanges(req, project, task, before);

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

    await logActivity({
      project: project._id,
      actor: req.user.id,
      type: 'task.deleted',
      summary: `deleted task ${quote(task.title)}`,
      targetType: 'task',
      targetId: task._id,
      targetLabel: task.title,
    });

    return res.json({
      message: 'Task deleted successfully.',
    });
  } catch (error) {
    return next(error);
  }
});

export default router;