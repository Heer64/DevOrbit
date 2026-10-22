import { Router } from 'express';
import mongoose from 'mongoose';

import Project from '../models/Project.js';
import Task from '../models/Task.js';
import Milestone from '../models/Milestone.js';
import User from '../models/User.js';
import { logActivity, quote } from '../lib/activity.js';
import { requireAuth } from '../middleware/auth.js';
import { canWriteTasks, canDeleteTask } from '../lib/permissions.js';
import { emitTaskCreated, emitTaskDeleted, emitTaskUpdated } from '../lib/realtime.js';

const router = Router({ mergeParams: true });

// Board column order (Sprint 2 Pair D added 'Blocked', see FR-7b).
const TASK_STATUSES = ['To do', 'In progress', 'Blocked', 'Done'];
const TASK_PRIORITIES = ['Low', 'Medium', 'High'];
const LABEL_MAX = 30;

// Optional task label (US-21). Returns { valid, value } like the other validators.
function readLabel(raw) {
  const value = raw === null || raw === undefined ? '' : String(raw).trim();
  if (value.length > LABEL_MAX) {
    return { valid: false, message: `Task label must be ${LABEL_MAX} characters or fewer.` };
  }
  return { valid: true, value };
}

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

/* ---- Sprint 2 Pair D: version-checked status changes (US-28) ---- */

const CONFLICT_MESSAGE = 'This task was changed by someone else.';

// Tasks saved before the version field existed have none stored; they count as 0.
function versionOf(task) {
  return Number.isInteger(task?.version) ? task.version : 0;
}

// Query filter that matches the task only while it still has the version the client loaded.
function versionFilter(version) {
  return version === 0
    ? { $or: [{ version: 0 }, { version: { $exists: false } }] }
    : { version };
}

async function findPopulatedTask(taskId) {
  const task = await Task.findById(taskId)
    .populate('assignee', 'name username email avatarUrl')
    .populate('createdBy', 'name username email')
    .lean();

  if (task) task.version = versionOf(task);
  return task;
}

// Same shape logTaskChanges() expects for "before".
function snapshot(task) {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    label: task.label || '',
    assignee: task.assignee ? task.assignee.toString() : null,
    dueDate: task.dueDate ? task.dueDate.getTime() : null,
    milestone: task.milestone ? task.milestone.toString() : null,
  };
}

async function sendConflict(res, taskId) {
  return res.status(409).json({
    message: CONFLICT_MESSAGE,
    task: await findPopulatedTask(taskId),
  });
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
  if ((task.label || '') !== (before.label || '')) changed.push('label');
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
 * GET /api/projects/:id/tasks/:taskId
 *
 * One task, populated like the list. Readable by anyone who can read the project's tasks.
 * The Kanban board uses it to fetch the latest state after a conflict.
 */
router.get('/:taskId', async (req, res, next) => {
  try {
    const loaded = await loadProject(req, res);

    if (!loaded) {
      return;
    }

    if (!validId(req.params.taskId)) {
      return res.status(400).json({
        message: 'Invalid task ID.',
      });
    }

    const exists = await Task.exists({
      _id: req.params.taskId,
      project: loaded.project._id,
    });

    if (!exists) {
      return res.status(404).json({
        message: 'Task not found.',
      });
    }

    return res.json({
      task: await findPopulatedTask(req.params.taskId),
    });
  } catch (error) {
    return next(error);
  }
});

/*
 * PATCH /api/projects/:id/tasks/:taskId/status
 *
 * Move a task to another status (Kanban drag and drop).
 * Body: { status, version }   version = the task's version when the client loaded it
 *
 * 200 { task }             saved; task.version is the new version
 * 400 { message }          invalid status, version or task ID
 * 403 { message }          not a member, or a Viewer
 * 404 { message }          no such task in this project
 * 409 { message, task }    someone changed the task first; task is the latest saved state
 */
router.patch('/:taskId/status', async (req, res, next) => {
  try {
    const loaded = await loadProject(req, res);

    if (!loaded) {
      return;
    }

    const { project, role, member } = loaded;

    if (!member) {
      return res.status(403).json({
        message: 'You must be a project member to change task status.',
      });
    }

    if (!canWriteTasks(role)) {
      return res.status(403).json({
        message: 'You do not have permission to change task status.',
      });
    }

    if (!validId(req.params.taskId)) {
      return res.status(400).json({
        message: 'Invalid task ID.',
      });
    }

    const { status, version } = req.body;

    if (!TASK_STATUSES.includes(status)) {
      return res.status(400).json({
        message: 'Invalid task status.',
      });
    }

    if (!Number.isInteger(version) || version < 0) {
      return res.status(400).json({
        message: 'Task version is required.',
      });
    }

    const current = await Task.findOne({
      _id: req.params.taskId,
      project: project._id,
    });

    if (!current) {
      return res.status(404).json({
        message: 'Task not found.',
      });
    }

    if (versionOf(current) !== version) {
      return sendConflict(res, current._id);
    }

    // Dropped back into its own column: nothing to save.
    if (current.status === status) {
      return res.json({
        task: await findPopulatedTask(current._id),
      });
    }

    // Check-and-set in one step, so two simultaneous moves cannot both succeed.
    const updated = await Task.findOneAndUpdate(
      { _id: current._id, project: project._id, ...versionFilter(version) },
      {
        $set: {
          status,
          completedAt: status === 'Done' ? new Date() : null,
        },
        $inc: { version: 1 },
      },
      { new: true }
    );

    if (!updated) {
      return sendConflict(res, current._id);
    }

    await updateProgress(project._id);

    await logTaskChanges(req, project, updated, snapshot(current));

    const populatedTask = await findPopulatedTask(updated._id);

    emitTaskUpdated(populatedTask);

    return res.json({
      task: populatedTask,
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

    const labelResult = readLabel(req.body.label);

    if (!labelResult.valid) {
      return res.status(400).json({
        message: labelResult.message,
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
      label: labelResult.value,
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

    const populatedTask = await findPopulatedTask(task._id);

    emitTaskCreated(populatedTask); // [Sprint 2 final] live for other members

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
      label: task.label || '',
      assignee: task.assignee ? task.assignee.toString() : null,
      dueDate: task.dueDate ? task.dueDate.getTime() : null,
      milestone: task.milestone ? task.milestone.toString() : null,
    };

    // [Pair D] Optional conflict check: a client that sends the version it loaded
    // gets 409 instead of overwriting a newer change. Clients that omit it keep working.
    const loadedVersion = versionOf(task);

    if (req.body.version !== undefined) {
      if (!Number.isInteger(req.body.version) || req.body.version < 0) {
        return res.status(400).json({
          message: 'Invalid task version.',
        });
      }

      if (req.body.version !== loadedVersion) {
        return sendConflict(res, task._id);
      }
    }

    const allowedFields = [
      'title',
      'description',
      'status',
      'priority',
      'label',
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

        if (field === 'label') {
          const labelResult = readLabel(req.body.label);

          if (!labelResult.valid) {
            return res.status(400).json({
              message: labelResult.message,
            });
          }

          task.label = labelResult.value;
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

    // [Pair D] Every real change bumps the version, so Kanban boards holding the old
    // version get a 409 instead of silently overwriting this edit. The save only matches
    // while the stored version is still the one loaded above (atomic check-and-set).
    const changed = task.isModified();

    if (changed) {
      task.$where = versionFilter(loadedVersion);
      task.version = loadedVersion + 1;
    }

    try {
      await task.save();
    } catch (error) {
      if (error.name === 'DocumentNotFoundError') {
        return sendConflict(res, task._id);
      }
      throw error;
    }

    await updateProgress(project._id);

    await logTaskChanges(req, project, task, before);

    const populatedTask = await findPopulatedTask(task._id);

    if (changed) {
      emitTaskUpdated(populatedTask);
    }

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

    emitTaskDeleted(project._id, task._id); // [Sprint 2 final] live for other members

    return res.json({
      message: 'Task deleted successfully.',
    });
  } catch (error) {
    return next(error);
  }
});

export default router;