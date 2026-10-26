import { Router } from 'express';

import Message, { MESSAGE_MAX } from '../models/Message.js';
import { requireAuth } from '../middleware/auth.js';
import { loadProjectForMember, validId } from '../lib/projectAccess.js';
import { canPostMessages } from '../lib/permissions.js';
import { emitThreadReply } from '../lib/realtime.js';
import { logActivity, quote } from '../lib/activity.js';
import { AUTHOR_FIELDS, MENTION_FIELDS, findPopulatedMessage, loadChannel } from './channels.js';
import { findMentionedMembers, notifyMentions } from '../lib/mentions.js';
import { messageLink } from '../lib/notifications.js';

/*
 * [Sprint 3 · US-17] Reply in a thread.
 * Mounted at /api/projects/:id/channels/:channelId/messages/:messageId/replies (see app.js),
 * so it only sees thread requests and routes/channels.js is not touched for them.
 *
 * A thread belongs to one top-level channel message. Replies are stored as Messages with
 * parentMessage set, so they keep the same author/body/time shape as channel messages, and
 * they are left out of the channel history (GET /:channelId/messages only lists top-level ones).
 * Threads are one level deep: replying to a reply is refused (400).
 *
 * GET  .../replies   members
 *        ?limit=100&after=<ISO date>
 *        -> { parent, replies (oldest first), nextAfter }   pass nextAfter back as ?after= for the rest
 * POST .../replies   Owner, Admin, Contributor   { body }
 *        -> 201 { reply, parent: { _id, replyCount, lastReplyAt } }
 *        Viewers get 403 but can still read threads.
 *
 * The parent's replyCount is increased with $inc in the same step as lastReplyAt, so two people
 * replying at the same moment both count. Live: 'message:reply' to members (lib/realtime.js).
 */

const router = Router({ mergeParams: true });
router.use(requireAuth);

function readLimit(raw, fallback, max) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(value, max);
}

// Loads the message that starts the thread. Responds itself and returns null when the caller must stop.
async function loadThreadParent(req, res, channel) {
  if (!validId(req.params.messageId)) {
    res.status(400).json({ message: 'Invalid message ID.' });
    return null;
  }
  const parent = await Message.findOne({ _id: req.params.messageId, channel: channel._id }).lean();
  if (!parent) {
    res.status(404).json({ message: 'Message not found.' });
    return null;
  }
  if (parent.parentMessage) {
    res.status(400).json({ message: 'Replies cannot have their own thread. Reply to the original message instead.' });
    return null;
  }
  return parent;
}

router.get('/', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;
    const channel = await loadChannel(req, res, loaded.project);
    if (!channel) return undefined;
    const parent = await loadThreadParent(req, res, channel);
    if (!parent) return undefined;

    const limit = readLimit(req.query.limit, 100, 200);
    const filter = { parentMessage: parent._id };

    if (req.query.after !== undefined) {
      const after = new Date(req.query.after);
      if (Number.isNaN(after.getTime())) return res.status(400).json({ message: 'Invalid "after" date.' });
      filter.createdAt = { $gt: after };
    }

    const [populatedParent, rows] = await Promise.all([
      findPopulatedMessage(parent._id),
      Message.find(filter)
        .sort({ createdAt: 1, _id: 1 })
        .limit(limit + 1)
        .populate('author', AUTHOR_FIELDS)
        .populate('mentions', MENTION_FIELDS)
        .lean(),
    ]);

    const replies = rows.slice(0, limit);
    const nextAfter = rows.length > limit ? replies[replies.length - 1].createdAt : null;
    return res.json({ parent: populatedParent, replies, nextAfter });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;

    if (!canPostMessages(loaded.role)) {
      return res.status(403).json({ message: 'Viewers can read threads but cannot reply.' });
    }

    const channel = await loadChannel(req, res, loaded.project);
    if (!channel) return undefined;
    const parent = await loadThreadParent(req, res, channel);
    if (!parent) return undefined;

    const body = String(req.body.body ?? '').trim();
    if (!body) return res.status(400).json({ message: 'Reply cannot be empty.' });
    if (body.length > MESSAGE_MAX) {
      return res.status(400).json({ message: `Reply must be ${MESSAGE_MAX.toLocaleString('en-US')} characters or fewer.` });
    }

    const mentioned = await findMentionedMembers(loaded.project, body); // US-18 in threads too

    const created = await Message.create({
      project: loaded.project._id,
      channel: channel._id,
      author: req.user.id,
      body,
      parentMessage: parent._id,
      mentions: mentioned.map((user) => user._id),
    });

    // Atomic: concurrent replies each add exactly 1.
    const updatedParent = await Message.findOneAndUpdate(
      { _id: parent._id },
      { $inc: { replyCount: 1 }, $set: { lastReplyAt: created.createdAt } },
      { new: true, projection: { replyCount: 1, lastReplyAt: 1 } }
    ).lean();

    const reply = await findPopulatedMessage(created._id);
    const counts = {
      replyCount: updatedParent?.replyCount ?? 1,
      lastReplyAt: updatedParent?.lastReplyAt ?? created.createdAt,
    };
    emitThreadReply(reply, counts);

    // US-18: the notification opens the channel with this thread open.
    await notifyMentions(mentioned, {
      project: loaded.project._id,
      actor: req.user.id,
      summary: `mentioned you in a thread in #${channel.name}`,
      targetType: 'message',
      targetId: created._id,
      targetLabel: `#${channel.name}`,
      link: `${messageLink(loaded.project._id, channel._id, parent._id)}&thread=${parent._id}`,
    });

    // Thread replies show in the Activity Feed like channel messages (US-29).
    await logActivity({
      project: loaded.project._id,
      actor: req.user.id,
      type: 'message.posted',
      summary: `replied in a thread in #${channel.name}: ${quote(body, 80)}`,
      targetType: 'message',
      targetId: created._id,
      targetLabel: `#${channel.name}`,
      meta: { channelId: String(channel._id), parentId: String(parent._id) },
    });

    return res.status(201).json({ reply, parent: { _id: parent._id, ...counts } });
  } catch (error) {
    return next(error);
  }
});

export default router;

/*
 * ---------------------------------------------------------------------------
 * [Sprint 3 · US-17] What this file does
 * Thread replies for channel messages: read a thread and reply to it. The
 * parent message keeps a replyCount that the channel shows ("3 replies").
 * ---------------------------------------------------------------------------
 */
