import { Router } from 'express';

import Decision from '../models/Decision.js';
import Task from '../models/Task.js';
import Message from '../models/Message.js';
import Channel from '../models/Channel.js';
import { requireAuth } from '../middleware/auth.js';
import { loadProjectForMember, validId } from '../lib/projectAccess.js';
import { canWriteDecisions } from '../lib/permissions.js';
import { logActivity, quote } from '../lib/activity.js';
import { decisionLinkView, readDecisionInput } from '../lib/decisions.js';

/*
 * [Sprint 3 · M8] Project decisions (US-35 record a decision, US-36 view and update decisions).
 * Mounted at /api/projects/:id/decisions (see app.js).
 *
 * GET   /              members (all roles)          -> { decisions }  newest date first
 * GET   /:decisionId   members (all roles)          -> { decision }
 * POST  /              Owner, Admin, Contributor    { title, description, participants, date, link? } -> 201 { decision }
 * PATCH /:decisionId   Owner, Admin, Contributor    any of the fields above -> { decision }
 *
 * Body fields
 *   title          required, up to 120 characters
 *   description    required, up to 2000 characters
 *   participants   [userId, ...] at least one; each must be a current project member
 *                  (on edit, people already on the decision may stay even if they left the project)
 *   date           "YYYY-MM-DD"
 *   link           optional { type: 'task', id } | { type: 'thread', id: <top-level messageId> } | null (no link)
 *
 * A missing or invalid field answers 400 and nothing is saved. Viewers get 403 on POST/PATCH
 * but can read. Non-members get 403. A decision from another project is 404.
 *
 * Each decision: { _id, project, title, description, date, createdAt, updatedAt,
 *                  participants [{ _id, name, username, avatarUrl }], createdBy, updatedBy (same shape or null),
 *                  link (see lib/decisions.js decisionLinkView) }
 *
 * Activity Feed: 'decision.created' and 'decision.updated' (types reserved in models/Activity.js).
 */

const router = Router({ mergeParams: true });
router.use(requireAuth);

const USER_FIELDS = 'name username avatarUrl';

function populated(query) {
  return query
    .populate('participants', USER_FIELDS)
    .populate('createdBy', USER_FIELDS)
    .populate('updatedBy', USER_FIELDS);
}

const idText = (value) => (value === null || value === undefined ? '' : String(value._id || value));

function memberIds(project) {
  return new Set((project.members || []).map((member) => idText(member.user)));
}

// Loads what each decision links to, then returns the decisions in the API shape.
async function toViews(decisions) {
  const taskIds = decisions.map((d) => d.relatedTask).filter(Boolean);
  const messageIds = decisions.map((d) => d.relatedMessage).filter(Boolean);
  const channelIds = decisions.map((d) => d.relatedChannel).filter(Boolean);

  const [tasks, messages, channels] = await Promise.all([
    taskIds.length ? Task.find({ _id: { $in: taskIds } }).select('title').lean() : [],
    messageIds.length ? Message.find({ _id: { $in: messageIds } }).select('body').lean() : [],
    channelIds.length ? Channel.find({ _id: { $in: channelIds } }).select('name').lean() : [],
  ]);
  const targets = {
    tasks: new Map(tasks.map((row) => [String(row._id), row])),
    messages: new Map(messages.map((row) => [String(row._id), row])),
    channels: new Map(channels.map((row) => [String(row._id), row])),
  };

  return decisions.map((decision) => {
    const { relatedTask, relatedMessage, relatedChannel, __v, ...rest } = decision;
    return {
      ...rest,
      // Populated refs are dropped by Mongoose when the user no longer exists.
      participants: (decision.participants || []).filter(Boolean),
      link: decisionLinkView(decision, targets),
    };
  });
}

async function viewOf(decisionId) {
  const decision = await populated(Decision.findById(decisionId)).lean();
  const [view] = await toViews([decision]);
  return view;
}

async function findDecision(req, res, project) {
  if (!validId(req.params.decisionId)) {
    res.status(400).json({ message: 'Invalid decision ID.' });
    return null;
  }
  const decision = await Decision.findOne({ _id: req.params.decisionId, project: project._id });
  if (!decision) {
    res.status(404).json({ message: 'Decision not found.' });
    return null;
  }
  return decision;
}

// Participants must be project members. `allowed` = people already on the decision (edit only).
function checkParticipants(project, ids, allowed = new Set()) {
  const members = memberIds(project);
  const outsider = ids.find((id) => !members.has(id) && !allowed.has(id));
  if (outsider) return 'Participants must be members of this project.';
  return null;
}

/*
 * Turns the link from the body into the fields stored on the decision.
 * Returns { fields } or { message } (answer 400).
 */
async function resolveLink(project, link) {
  if (link === null) return { fields: { relatedTask: null, relatedMessage: null, relatedChannel: null } };

  if (link.type === 'task') {
    const task = await Task.findOne({ _id: link.id, project: project._id }).select('_id').lean();
    if (!task) return { message: 'The related task must be a task in this project.' };
    return { fields: { relatedTask: task._id, relatedMessage: null, relatedChannel: null } };
  }

  const message = await Message.findOne({ _id: link.id, project: project._id }).select('channel parentMessage').lean();
  if (!message) return { message: 'The related thread must be a channel message in this project.' };
  if (message.parentMessage) return { message: 'Link the thread\'s first message, not a reply inside it.' };
  return { fields: { relatedTask: null, relatedMessage: message._id, relatedChannel: message.channel } };
}

router.get('/', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;

    const rows = await populated(
      Decision.find({ project: loaded.project._id }).sort({ date: -1, createdAt: -1, _id: -1 })
    ).lean();

    return res.json({ decisions: await toViews(rows) });
  } catch (error) {
    return next(error);
  }
});

router.get('/:decisionId', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;
    const decision = await findDecision(req, res, loaded.project);
    if (!decision) return undefined;

    return res.json({ decision: await viewOf(decision._id) });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;

    if (!canWriteDecisions(loaded.role)) {
      return res.status(403).json({ message: 'Viewers can read decisions but cannot record them.' });
    }

    const input = readDecisionInput(req.body, { partial: false });
    if (!input.ok) return res.status(400).json({ message: input.message });
    const { title, description, participants, date, link } = input.values;

    const participantError = checkParticipants(loaded.project, participants);
    if (participantError) return res.status(400).json({ message: participantError });

    let linkFields = { relatedTask: null, relatedMessage: null, relatedChannel: null };
    if (link) {
      const resolved = await resolveLink(loaded.project, link);
      if (resolved.message) return res.status(400).json({ message: resolved.message });
      linkFields = resolved.fields;
    }

    const created = await Decision.create({
      project: loaded.project._id,
      title,
      description,
      participants,
      date,
      ...linkFields,
      createdBy: req.user.id,
    });

    await logActivity({
      project: loaded.project._id,
      actor: req.user.id,
      type: 'decision.created',
      summary: `recorded decision ${quote(title)}`,
      targetType: 'decision',
      targetId: created._id,
      targetLabel: title,
      meta: { date: date.toISOString().slice(0, 10) },
    });

    return res.status(201).json({ decision: await viewOf(created._id) });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:decisionId', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;

    if (!canWriteDecisions(loaded.role)) {
      return res.status(403).json({ message: 'Viewers can read decisions but cannot edit them.' });
    }

    const decision = await findDecision(req, res, loaded.project);
    if (!decision) return undefined;

    const input = readDecisionInput(req.body, { partial: true });
    if (!input.ok) return res.status(400).json({ message: input.message });
    const { link, ...fields } = input.values;

    // Every check runs before anything is changed, so a refused edit saves nothing.
    if (fields.participants) {
      const current = new Set((decision.participants || []).map((id) => idText(id)));
      const participantError = checkParticipants(loaded.project, fields.participants, current);
      if (participantError) return res.status(400).json({ message: participantError });
    }

    let linkFields = null;
    if (link !== undefined) {
      const resolved = await resolveLink(loaded.project, link);
      if (resolved.message) return res.status(400).json({ message: resolved.message });
      linkFields = resolved.fields;
    }

    const changed = [];
    const same = (a, b) => idText(a) === idText(b);
    if (fields.title !== undefined && fields.title !== decision.title) changed.push('title');
    if (fields.description !== undefined && fields.description !== decision.description) changed.push('description');
    if (fields.date !== undefined && fields.date.getTime() !== new Date(decision.date).getTime()) changed.push('date');
    if (fields.participants !== undefined) {
      const before = (decision.participants || []).map((id) => idText(id));
      if (before.length !== fields.participants.length || before.some((id, i) => id !== fields.participants[i])) changed.push('participants');
    }
    if (linkFields && !(same(linkFields.relatedTask, decision.relatedTask) && same(linkFields.relatedMessage, decision.relatedMessage))) {
      changed.push('link');
    }

    if (changed.length === 0) {
      return res.json({ decision: await viewOf(decision._id) });
    }

    decision.set({ ...fields, ...(linkFields || {}), updatedBy: req.user.id });
    await decision.save();

    await logActivity({
      project: loaded.project._id,
      actor: req.user.id,
      type: 'decision.updated',
      summary: `updated decision ${quote(decision.title)}`,
      targetType: 'decision',
      targetId: decision._id,
      targetLabel: decision.title,
      meta: { fields: changed },
    });

    return res.json({ decision: await viewOf(decision._id) });
  } catch (error) {
    return next(error);
  }
});

export default router;

/*
 * ---------------------------------------------------------------------------
 * [Sprint 3 · M8] What this file does
 * REST API for project decisions: list and open them (any member), record and
 * edit them (Owner/Admin/Contributor). Checks participants are members and the
 * optional link is a task or top-level thread of the same project. Every save is
 * logged in the Activity Feed as decision.created / decision.updated.
 * ---------------------------------------------------------------------------
 */
