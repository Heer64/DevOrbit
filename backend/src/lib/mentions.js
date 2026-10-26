import User from '../models/User.js';
import { createNotification } from './notifications.js';

/*
 * [Sprint 3 · US-18, US-20] @mentions in text: task comments, channel messages and thread replies.
 *
 * A mention is "@" + a username. Usernames are 3-30 characters of a-z, 0-9, ".", "_" and "-"
 * (same rule as routes/profile.js). The "@" must not follow a letter, digit or one of ._-@,
 * so an email address such as "riya@example.com" is not a mention.
 *
 * Only CURRENT members of the project are ever matched, so you cannot notify, or find out
 * the existence of, someone outside the project.
 */

const MENTION_PATTERN = /(^|[^a-z0-9._@-])@([a-z0-9._-]{3,30})/gi;
const TRAILING_PUNCTUATION = /[._-]+$/;

/*
 * The handles written in the text, in order, lowercased and without repeats.
 * Each entry lists the spellings to try: "@riya." at the end of a sentence tries "riya." and then "riya".
 *   mentionCandidates('Thanks @Riya. and @dev_1!') -> [['riya.', 'riya'], ['dev_1']]
 */
export function mentionCandidates(text) {
  const seen = new Set();
  const result = [];
  for (const match of String(text || '').matchAll(MENTION_PATTERN)) {
    const full = match[2].toLowerCase();
    if (seen.has(full)) continue;
    seen.add(full);
    const trimmed = full.replace(TRAILING_PUNCTUATION, '');
    result.push(trimmed !== full && trimmed.length >= 3 ? [full, trimmed] : [full]);
  }
  return result;
}

function memberIds(project) {
  return (project?.members || []).map((member) => String(member.user?._id || member.user));
}

/*
 * The project members mentioned in `text`, as [{ _id, name, username }], in the order written.
 * The same person mentioned twice is returned once.
 */
export async function findMentionedMembers(project, text) {
  const candidates = mentionCandidates(text);
  if (!candidates.length) return [];

  const ids = memberIds(project);
  if (!ids.length) return [];

  const handles = [...new Set(candidates.flat())];
  const users = await User.find({ _id: { $in: ids }, username: { $in: handles } })
    .select('name username')
    .lean();
  const byUsername = new Map(users.map((user) => [user.username, user]));

  const found = [];
  const added = new Set();
  for (const spellings of candidates) {
    // Prefer the exact spelling; fall back to the one without trailing punctuation.
    const user = spellings.map((handle) => byUsername.get(handle)).find(Boolean);
    if (user && !added.has(String(user._id))) {
      added.add(String(user._id));
      found.push(user);
    }
  }
  return found;
}

/*
 * Sends one Mention notification to each mentioned member (US-18, US-20, US-30).
 * createNotification() skips the author mentioning themselves, never throws, and the
 * dedupeKey stops a retried request from notifying anyone twice.
 *
 *   await notifyMentions(mentioned, {
 *     project, actor, summary: 'mentioned you in #general',
 *     targetType: 'message', targetId: message._id, targetLabel: '#general', link,
 *   });
 */
export async function notifyMentions(users, { project, actor, summary, targetType, targetId, targetLabel = '', link }) {
  return Promise.all((users || []).map((user) => createNotification({
    recipient: user._id,
    type: 'mention',
    project,
    actor,
    summary,
    targetType,
    targetId,
    targetLabel,
    link,
    dedupeKey: `mention:${targetType}:${targetId}`,
  })));
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 3 · US-20] What this file does
 * Finds "@username" mentions in a piece of text and turns them into project
 * members, so the caller can store them and send Mention notifications.
 * ---------------------------------------------------------------------------
 */
