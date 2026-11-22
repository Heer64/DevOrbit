import { Router } from 'express';

import Channel, { CHANNEL_NAME_PATTERN } from '../models/Channel.js';
import Message, { MESSAGE_MAX } from '../models/Message.js';
import { requireAuth } from '../middleware/auth.js';
import { loadProjectForMember, validId } from '../lib/projectAccess.js';
import { canManageChannels, canPostMessages } from '../lib/permissions.js';
import { ensureDefaultChannel, normalizeChannelName } from '../lib/channels.js';
import { emitMessageCreated } from '../lib/realtime.js';
import { logActivity, quote } from '../lib/activity.js'; // [US-29]
import { findMentionedMembers, notifyMentions } from '../lib/mentions.js'; // [Sprint 3] US-18
import { messageLink } from '../lib/notifications.js'; // [Sprint 3] US-18
import { CHANNEL_EDIT_MESSAGES, channelMessageView, isMessageAuthor, readEditedBody } from '../lib/channelMessageRules.js'; // [Sprint 7 · M1]
import { deleteChannelMessage, editChannelMessage, findMessageInChannel } from '../lib/channelMessageEdits.js'; // [Sprint 7 · M1]

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
 *
 * [Sprint 3 · US-18] @username of a project member in a message: stored in message.mentions
 * ([{ _id, name, username }]) and the member gets a Mention notification linking to the message.
 *
 * [Sprint 7 · M1] Edit and delete your own messages (thread replies too: they are messages of the same channel).
 * PATCH  /:channelId/messages/:messageId   author only, Owner/Admin/Contributor   { body }
 *                                           -> 200 { message, changed, notice }
 *                                           Same text again -> changed: false (no "edited" mark).
 *                                           400 invalid ID / empty / too long, 403 not your message or you are a
 *                                           Viewer, 404 unknown message, 409 { code: 'message_deleted' } it was deleted.
 * DELETE /:channelId/messages/:messageId   author only, any role -> 200 { message, changed, notice }
 *                                           It stays in place as "Message deleted" (deleted: true, body ''), so its
 *                                           thread still makes sense. Already deleted -> changed: false.
 *                                           403 not your message (the Owner too), 404 unknown message.
 * Every message the API returns now also has { edited, editedAt, deleted, deletedAt }.
 * Live: 'message:updated' { projectId, channelId, parentId, message } to members (lib/realtime.js).
 */

const router = Router({ mergeParams: true });
router.use(requireAuth);

export const AUTHOR_FIELDS = 'name username avatarUrl';
export const MENTION_FIELDS = 'name username'; // [Sprint 3] US-18

function readLimit(raw, fallback, max) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(value, max);
}

// Loads the channel and checks it belongs to the project in the URL.
// [US-17] Exported so routes/threads.js uses the same check.
export async function loadChannel(req, res, project) {
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

// [Sprint 7 · M1] Returned through channelMessageView: adds edited / deleted and hides a deleted message's text.
export async function findPopulatedMessage(messageId) {
  const row = await Message.findById(messageId).populate('author', AUTHOR_FIELDS).populate('mentions', MENTION_FIELDS).lean();
  return channelMessageView(row);
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
    // [US-17] Thread replies stay inside their thread (routes/threads.js), not in the channel.
    // { parentMessage: null } also matches messages saved before threads existed.
    const filter = { channel: channel._id, parentMessage: null };

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
      .populate('mentions', MENTION_FIELDS) // [Sprint 3] US-18
      .lean();

    const page = rows.slice(0, limit);
    const nextBefore = rows.length > limit ? page[page.length - 1].createdAt : null;

    // The chat shows oldest at the top, so send this page oldest first.
    // [Sprint 7 · M1] channelMessageView: "edited" / "Message deleted" (a deleted message's text is never sent).
    return res.json({ messages: page.reverse().map(channelMessageView), nextBefore });
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

    const mentioned = await findMentionedMembers(loaded.project, body); // [Sprint 3] US-18

    const created = await Message.create({
      project: loaded.project._id,
      channel: channel._id,
      author: req.user.id,
      body,
      mentions: mentioned.map((user) => user._id), // [Sprint 3] US-18
    });

    const message = await findPopulatedMessage(created._id);
    emitMessageCreated(message);

    // [Sprint 3] US-18: "that member receives a mention notification linking to the message".
    await notifyMentions(mentioned, {
      project: loaded.project._id,
      actor: req.user.id,
      summary: `mentioned you in #${channel.name}`,
      targetType: 'message',
      targetId: created._id,
      targetLabel: `#${channel.name}`,
      link: messageLink(loaded.project._id, channel._id, created._id),
    });

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

/*
 * [Sprint 7 · M1] The message in the URL, for its author only.
 * 400 bad ID, 404 not a message of this channel, 403 someone else's message. Returns null after answering.
 */
async function ownMessageFromUrl(req, res, channel) {
  if (!validId(req.params.messageId)) {
    res.status(400).json({ message: CHANNEL_EDIT_MESSAGES.invalidMessage });
    return null;
  }
  const message = await findMessageInChannel(channel, req.params.messageId);
  if (!message) {
    res.status(404).json({ message: CHANNEL_EDIT_MESSAGES.messageNotFound });
    return null;
  }
  if (!isMessageAuthor(message, req.user.id)) {
    res.status(403).json({ message: CHANNEL_EDIT_MESSAGES.notAuthor, code: 'not_author' });
    return null;
  }
  return message;
}

// [Sprint 7 · M1] Edit my own channel message or thread reply.
router.patch('/:channelId/messages/:messageId', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;
    const channel = await loadChannel(req, res, loaded.project);
    if (!channel) return undefined;
    const message = await ownMessageFromUrl(req, res, channel);
    if (!message) return undefined;

    if (!canPostMessages(loaded.role)) {
      return res.status(403).json({ message: CHANNEL_EDIT_MESSAGES.viewerEdit, code: 'viewer' });
    }
    if (message.deletedAt) return res.status(409).json({ message: CHANNEL_EDIT_MESSAGES.editDeleted, code: 'message_deleted' });

    const checked = readEditedBody(req.body?.body);
    if (!checked.ok) return res.status(400).json({ message: checked.message });

    const result = await editChannelMessage({
      project: loaded.project,
      channel,
      message,
      editorId: req.user.id,
      body: checked.body,
    });
    if (result.deleted) return res.status(409).json({ message: CHANNEL_EDIT_MESSAGES.editDeleted, code: 'message_deleted' });
    return res.json({
      message: result.message,
      changed: result.changed,
      notice: result.changed ? CHANNEL_EDIT_MESSAGES.edited : CHANNEL_EDIT_MESSAGES.unchanged,
    });
  } catch (error) {
    return next(error);
  }
});

// [Sprint 7 · M1] Delete my own channel message or thread reply (it stays as "Message deleted").
router.delete('/:channelId/messages/:messageId', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;
    const channel = await loadChannel(req, res, loaded.project);
    if (!channel) return undefined;
    const message = await ownMessageFromUrl(req, res, channel);
    if (!message) return undefined;

    const result = await deleteChannelMessage({ project: loaded.project, channel, message, userId: req.user.id });
    return res.json({
      message: result.message,
      changed: result.changed,
      notice: result.changed ? CHANNEL_EDIT_MESSAGES.deleted : CHANNEL_EDIT_MESSAGES.alreadyDeleted,
    });
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
 * [Sprint 7 · M1] Also: edit and delete your own messages and thread replies
 * ("edited", "Message deleted"); anyone else gets 403. Changes are pushed live.
 * ---------------------------------------------------------------------------
 */
