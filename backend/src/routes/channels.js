import { Router } from 'express';

import Channel, { CHANNEL_NAME_PATTERN } from '../models/Channel.js';
import Message, { MESSAGE_MAX } from '../models/Message.js';
import { requireAuth } from '../middleware/auth.js';
import { loadProjectForMember, validId } from '../lib/projectAccess.js';
import { canManageChannels, canPostMessages } from '../lib/permissions.js';
import { ensureDefaultChannel, normalizeChannelName } from '../lib/channels.js';
import { emitMessageCreated } from '../lib/realtime.js';
import { logActivity, quote } from '../lib/activity.js'; // [US-29]

/*
 * Project channels and messages (US-16, FR-5). Mounted at /api/projects/:id/channels
 *
 * Channels are for project members only, even in a Public project (visitors see the
 * read-only project page, not the team's conversation).
 *
 * GET    /                              members        -> { channels, membershipRole }   (#general is created on first use)
 * POST   /                              Owner, Admin   { name, description? } -> 201 { channel }
 * GET    /:channelId/messages           members        ?limit=50&before=<ISO date>
 *                                                       -> { messages (oldest first), nextBefore }
 * POST   /:channelId/messages           Owner, Admin, Contributor   { body } -> 201 { message }
 *                                                       Viewers get 403 but can still read.
 *
 * Live: every new message is pushed as 'message:created' to members (lib/realtime.js).
 */

const router = Router({ mergeParams: true });
router.use(requireAuth);

export const AUTHOR_FIELDS = 'name username avatarUrl';

function readLimit(raw, fallback, max) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(value, max);
}

// Loads the channel and checks it belongs to the project in the URL.
async function loadChannel(req, res, project) {
  if (!validId(req.params.channelId)) {
    res.status(400).json({ message: 'Invalid channel ID.' });
    return null;
  }
  const channel = await Channel.findOne({ _id: req.params.channelId, project: project._id }).lean();
  if (!channel) {
    res.status(404).json({ message: 'Channel not found.' });
    return null;
  }
  return channel;
}

export async function findPopulatedMessage(messageId) {
  return Message.findById(messageId).populate('author', AUTHOR_FIELDS).lean();
}

router.get('/', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;

    await ensureDefaultChannel(loaded.project._id);
    const channels = await Channel.find({ project: loaded.project._id })
      .sort({ isDefault: -1, name: 1 })
      .lean();

    return res.json({ channels, membershipRole: loaded.role });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;

    if (!canManageChannels(loaded.role)) {
      return res.status(403).json({ message: 'Only project Owners and Admins can create channels.' });
    }

    const name = normalizeChannelName(req.body.name);
    if (!CHANNEL_NAME_PATTERN.test(name)) {
      return res.status(400).json({
        message: 'Channel name must be 1-30 characters: lowercase letters, numbers, "-" or "_".',
      });
    }

    const description = String(req.body.description || '').trim();
    if (description.length > 200) {
      return res.status(400).json({ message: 'Channel description must be 200 characters or fewer.' });
    }

    await ensureDefaultChannel(loaded.project._id);

    try {
      const channel = await Channel.create({
        project: loaded.project._id,
        name,
        description,
        createdBy: req.user.id,
      });
      return res.status(201).json({ channel });
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ message: `#${name} already exists in this project.` });
      throw error;
    }
  } catch (error) {
    return next(error);
  }
});

router.get('/:channelId/messages', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;
    const channel = await loadChannel(req, res, loaded.project);
    if (!channel) return undefined;

    const limit = readLimit(req.query.limit, 50, 100);
    const filter = { channel: channel._id };

    if (req.query.before !== undefined) {
      const before = new Date(req.query.before);
      if (Number.isNaN(before.getTime())) return res.status(400).json({ message: 'Invalid "before" date.' });
      filter.createdAt = { $lt: before };
    }

    // Newest page first, one extra row to know whether older messages exist.
    const rows = await Message.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .populate('author', AUTHOR_FIELDS)
      .lean();

    const page = rows.slice(0, limit);
    const nextBefore = rows.length > limit ? page[page.length - 1].createdAt : null;

    // The chat shows oldest at the top, so send this page oldest first.
    return res.json({ messages: page.reverse(), nextBefore });
  } catch (error) {
    return next(error);
  }
});

router.post('/:channelId/messages', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;

    if (!canPostMessages(loaded.role)) {
      return res.status(403).json({ message: 'Viewers can read channels but cannot send messages.' });
    }

    const channel = await loadChannel(req, res, loaded.project);
    if (!channel) return undefined;

    const body = String(req.body.body ?? '').trim();
    if (!body) return res.status(400).json({ message: 'Message cannot be empty.' });
    if (body.length > MESSAGE_MAX) {
      return res.status(400).json({ message: `Message must be ${MESSAGE_MAX.toLocaleString('en-US')} characters or fewer.` });
    }

    const created = await Message.create({
      project: loaded.project._id,
      channel: channel._id,
      author: req.user.id,
      body,
    });

    const message = await findPopulatedMessage(created._id);
    emitMessageCreated(message);

    // [US-29] Chat messages appear in the project Activity Feed.
    await logActivity({
      project: loaded.project._id,
      actor: req.user.id,
      type: 'message.posted',
      summary: `posted in #${channel.name}: ${quote(body, 80)}`,
      targetType: 'message',
      targetId: created._id,
      targetLabel: `#${channel.name}`,
      meta: { channelId: String(channel._id) },
    });

    return res.status(201).json({ message });
  } catch (error) {
    return next(error);
  }
});

export default router;

/*
 * ---------------------------------------------------------------------------
 * [Sprint 2 final] What this file does
 * REST API for project channels (US-16): list/create channels and read/send
 * messages. Members only; Viewers are read-only (403 on send). New messages are
 * saved, then pushed live to every member viewing the project (target: < 1 s).
 * ---------------------------------------------------------------------------
 */
