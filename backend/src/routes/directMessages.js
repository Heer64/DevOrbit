import { Router } from 'express';

import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { validId } from '../lib/projectAccess.js';
import { readUsername } from '../lib/portfolioRules.js';
import { USER_NOT_FOUND_MESSAGE } from '../lib/userProfileRules.js';
import {
  DM_MESSAGES,
  createSendLimiter,
  conversationView,
  idOf,
  otherParticipant,
  readBody,
  readLimit,
} from '../lib/directMessageRules.js';
import {
  inboxFor,
  loadConversationFor,
  markRead,
  messagePage,
  openConversation,
  sendMessage,
  unreadCountFor,
  unreadTotalFor,
} from '../lib/directMessages.js';

/*
 * [Sprint 6 · M2] US-19 Send direct messages (FR-6, NFR-1b). Mounted at /api/direct-messages. Login needed.
 *
 * GET    /                          -> { conversations, unreadTotal }   my inbox, newest activity first (max 50)
 * GET    /unread-count              -> { unreadTotal }                  badge on "Messages" in the sidebar
 * POST   /                          { username } -> 200 { conversation }
 *                                     AC1: "Message" on a profile. Opens the conversation with that user,
 *                                     creating it the first time. 400 no username, 400 { code: 'self_message' },
 *                                     404 unknown user.
 * GET    /:conversationId           -> { conversation }
 * GET    /:conversationId/messages  ?limit=1..100&before=<message ID> -> { messages (oldest first), nextBefore }
 * POST   /:conversationId/messages  { body } -> 201 { message, conversation }   1-4,000 characters of text
 *                                     400 empty / too long / not text, 429 after 30 messages in a minute
 *                                     (Retry-After header), 410 the other account no longer exists
 * POST   /:conversationId/read      -> { unreadCount: 0, unreadTotal }
 *
 * conversation = { _id, otherUser: { _id, name, username, avatarUrl }, lastMessage: { preview, at, fromMe } | null,
 *                  unreadCount, activityAt, createdAt }
 * message      = { _id, conversation, sender: { _id, name, username, avatarUrl }, body, createdAt }
 *
 * AC2 privacy: only the two participants can read a conversation. Anyone else gets 404, the same answer as
 * for a conversation that does not exist, so its existence is not revealed either. Live events
 * ('dm:message', 'dm:read', lib/realtime.js) go only to the participants' own rooms.
 * Separate from project channels (AC1): nothing here touches projects, channels or the Activity Feed.
 */

const router = Router();
router.use(requireAuth);

export const dmSendLimiter = createSendLimiter(); // exported so tests can reset it

// Loads the conversation in the URL for the caller, or answers 400 / 404 and returns null.
async function conversationFromUrl(req, res) {
  if (!validId(req.params.conversationId)) {
    res.status(400).json({ message: DM_MESSAGES.invalidConversation });
    return null;
  }
  const conversation = await loadConversationFor(req.params.conversationId, req.user.id);
  if (!conversation) {
    res.status(404).json({ message: DM_MESSAGES.conversationNotFound });
    return null;
  }
  return conversation;
}

router.get('/', async (req, res, next) => {
  try {
    return res.json(await inboxFor(req.user.id));
  } catch (error) {
    return next(error);
  }
});

router.get('/unread-count', async (req, res, next) => {
  try {
    return res.json({ unreadTotal: await unreadTotalFor(req.user.id) });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    if (req.body?.username === undefined || req.body?.username === '') {
      return res.status(400).json({ message: DM_MESSAGES.usernameRequired });
    }
    const username = readUsername(req.body.username);
    const target = username ? await User.findOne({ username }).select('_id').lean() : null;
    if (!target) return res.status(404).json({ message: USER_NOT_FOUND_MESSAGE });
    if (idOf(target) === idOf(req.user.id)) {
      return res.status(400).json({ message: DM_MESSAGES.self, code: 'self_message' });
    }

    const conversation = await openConversation(req.user.id, target._id);
    const unread = await unreadCountFor(conversation, req.user.id);
    return res.json({ conversation: conversationView(conversation, req.user.id, unread) });
  } catch (error) {
    return next(error);
  }
});

router.get('/:conversationId', async (req, res, next) => {
  try {
    const conversation = await conversationFromUrl(req, res);
    if (!conversation) return undefined;
    const unread = await unreadCountFor(conversation, req.user.id);
    return res.json({ conversation: conversationView(conversation, req.user.id, unread) });
  } catch (error) {
    return next(error);
  }
});

router.get('/:conversationId/messages', async (req, res, next) => {
  try {
    const conversation = await conversationFromUrl(req, res);
    if (!conversation) return undefined;

    const { before } = req.query;
    if (before !== undefined && !validId(before)) return res.status(400).json({ message: DM_MESSAGES.invalidBefore });

    const page = await messagePage(conversation, { limit: readLimit(req.query.limit), before });
    if (!page) return res.status(400).json({ message: DM_MESSAGES.invalidBefore });
    return res.json(page);
  } catch (error) {
    return next(error);
  }
});

router.post('/:conversationId/messages', async (req, res, next) => {
  try {
    const conversation = await conversationFromUrl(req, res);
    if (!conversation) return undefined;

    const checked = readBody(req.body?.body);
    if (!checked.ok) return res.status(400).json({ message: checked.message });

    // The other account was removed (e.g. seed data reset): nobody to deliver to.
    if (!otherParticipant(conversation, req.user.id)) {
      return res.status(410).json({ message: 'This person no longer has a DevOrbit account.' });
    }

    const allowed = dmSendLimiter.take(req.user.id);
    if (!allowed.ok) {
      res.set('Retry-After', String(allowed.retryAfterSeconds));
      return res.status(429).json({ message: DM_MESSAGES.tooFast, retryAfterSeconds: allowed.retryAfterSeconds });
    }

    const result = await sendMessage(conversation, req.user.id, checked.body);
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
});

router.post('/:conversationId/read', async (req, res, next) => {
  try {
    const conversation = await conversationFromUrl(req, res);
    if (!conversation) return undefined;
    return res.json(await markRead(conversation, req.user.id));
  } catch (error) {
    return next(error);
  }
});

export default router;

/*
 * ---------------------------------------------------------------------------
 * [Sprint 6 · M2] What this file does
 * REST API for direct messages (US-19): the inbox with unread counts, "Message"
 * on a profile (open or create the conversation), reading and sending messages
 * and marking a conversation read. Only the two people in a conversation can
 * use it; everyone else gets 404.
 * ---------------------------------------------------------------------------
 */
