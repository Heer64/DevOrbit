import Message from '../models/Message.js';
import Activity from '../models/Activity.js';
import { emitMessageUpdated } from './realtime.js';
import { quote } from './activity.js';
import { findMentionedMembers, notifyMentions } from './mentions.js';
import { messageLink } from './notifications.js';
import { channelMessageView, messageActivitySummary } from './channelMessageRules.js';

/*
 * [Sprint 7 · M1] Edit and delete your own channel messages and thread replies.
 *
 * Both changes are single atomic updates that only match the author's own, not-yet-deleted message,
 * so an edit racing a delete can never bring the text back. routes/channels.js checks who may do it
 * first (403 for anyone but the author); the filters here are a second guard.
 *
 * After a change every member viewing the project gets 'message:updated'
 * { projectId, channelId, parentId, message } (lib/realtime.js), so the message changes live for everyone,
 * in the channel and in an open thread.
 */

// Same fields as routes/channels.js AUTHOR_FIELDS / MENTION_FIELDS, so the message has the same shape.
const AUTHOR_FIELDS = 'name username avatarUrl';
const MENTION_FIELDS = 'name username';

const idOf = (value) => (value === null || value === undefined ? '' : String(value?._id || value));

// The message as the API returns it (author and mentions filled in, "edited" / "deleted" applied).
export async function channelMessageById(messageId) {
  const row = await Message.findById(messageId).populate('author', AUTHOR_FIELDS).populate('mentions', MENTION_FIELDS).lean();
  return channelMessageView(row);
}

// The message with this ID in this channel (top-level message or thread reply, any author), or null.
export function findMessageInChannel(channel, messageId) {
  return Message.findOne({ _id: messageId, channel: channel._id }).lean();
}

/*
 * Keeps the Activity Feed in step: an edit shows the new text, a delete removes the text
 * ("posted in #general: (message deleted)"). Catch Me Up reads the same feed, so it never sees deleted text.
 * Never throws: the edit or delete itself has already been saved.
 */
async function refreshActivity(project, channel, message, quotedText) {
  try {
    await Activity.updateMany(
      { project: project._id, type: 'message.posted', targetType: 'message', targetId: message._id },
      { $set: { summary: messageActivitySummary({ channelName: channel.name, isReply: Boolean(message.parentMessage), quotedText }) } }
    );
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') console.error('Could not update the activity feed:', error.message);
  }
}

/*
 * The author changes the text. Saving the same text again is not an edit (no "edited" mark, no event).
 * Someone newly @mentioned by the edit gets a Mention notification; people already notified for this
 * message are not notified again (notifyMentions uses one dedupeKey per message).
 * -> { changed: true | false, message } or { changed: false, deleted: true } when it was deleted meanwhile.
 */
export async function editChannelMessage({ project, channel, message, editorId, body }) {
  if (message.deletedAt) return { changed: false, deleted: true };
  if (message.body === body) return { changed: false, message: await channelMessageById(message._id) };

  const mentioned = await findMentionedMembers(project, body);
  const result = await Message.updateOne(
    { _id: message._id, channel: channel._id, author: editorId, deletedAt: null },
    { $set: { body, editedAt: new Date(), mentions: mentioned.map((user) => user._id) } }
  );
  if (!result.matchedCount) return { changed: false, deleted: true };

  const updated = await channelMessageById(message._id);
  emitMessageUpdated(updated);

  const parentId = idOf(message.parentMessage);
  const link = parentId
    ? `${messageLink(project._id, channel._id, parentId)}&thread=${parentId}`
    : messageLink(project._id, channel._id, message._id);
  await notifyMentions(mentioned, {
    project: project._id,
    actor: editorId,
    summary: parentId ? `mentioned you in a thread in #${channel.name}` : `mentioned you in #${channel.name}`,
    targetType: 'message',
    targetId: message._id,
    targetLabel: `#${channel.name}`,
    link,
  });
  await refreshActivity(project, channel, message, quote(body, 80));

  return { changed: true, message: updated };
}

/*
 * The author deletes the message. The row stays, so the channel still reads in order and a thread keeps
 * its replies (and its reply count), but it shows "Message deleted": its text and mentions are removed
 * from the database. Deleting it again changes nothing. -> { changed, message }
 */
export async function deleteChannelMessage({ project, channel, message, userId }) {
  const result = await Message.updateOne(
    { _id: message._id, channel: channel._id, author: userId, deletedAt: null },
    { $set: { deletedAt: new Date(), body: '', editedAt: null, mentions: [] } }
  );
  if (!result.matchedCount) return { changed: false, message: await channelMessageById(message._id) };

  const updated = await channelMessageById(message._id);
  emitMessageUpdated(updated);
  await refreshActivity(project, channel, message, null);
  return { changed: true, message: updated };
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 7 · M1] What this file does
 * Saves an edit or a delete of your own channel message / thread reply,
 * pushes the change live to project members ('message:updated'), notifies
 * people newly @mentioned by an edit, and updates the Activity Feed line.
 * ---------------------------------------------------------------------------
 */
