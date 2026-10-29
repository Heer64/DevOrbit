/*
 * [Sprint 3 · M8] Decision rules (US-35, US-36, FR-13, FR-34).
 *
 * Reads and checks the fields of a decision sent to the API. Like lib/dueDates.js this
 * file imports nothing that needs a database, so the rules can be tested on their own
 * (see backend/test/decisionRules.test.js). The routes (routes/decisions.js) do the checks
 * that need the database: participants are project members, the linked task or thread
 * belongs to this project.
 *
 * A decision has
 *   title         required, trimmed, up to 120 characters
 *   description   required, trimmed, up to 2000 characters
 *   participants  at least one user ID (duplicates are removed)
 *   date          required calendar day, "YYYY-MM-DD", stored as midnight UTC (same rules as task due dates)
 *   link          optional: { type: 'task', id: <taskId> } or { type: 'thread', id: <top-level messageId> }, or null
 */
import { DUE_DATE_FORMAT_MESSAGE, DUE_DATE_RANGE_MESSAGE, MAX_DUE_YEAR, MIN_DUE_YEAR, parseDueDate } from './dueDates.js';

export const DECISION_TITLE_MAX = 120;
export const DECISION_DESCRIPTION_MAX = 2000;
export const DECISION_LINK_TYPES = ['task', 'thread'];

export const DECISION_DATE_REQUIRED_MESSAGE = 'Decision date is required.';
export const DECISION_DATE_FORMAT_MESSAGE = 'Decision date must be a calendar date (YYYY-MM-DD).';
export const DECISION_DATE_INVALID_MESSAGE = 'Invalid decision date.';
export const DECISION_DATE_RANGE_MESSAGE = `Decision date must be between ${MIN_DUE_YEAR} and ${MAX_DUE_YEAR}.`;

const OBJECT_ID = /^[a-f0-9]{24}$/i;

export function isObjectIdText(value) {
  return typeof value === 'string' && OBJECT_ID.test(value);
}

/*
 * The decision date, using the task due-date rules (lib/dueDates.js) with decision wording.
 * Unlike a due date it cannot be left empty.
 *   '2026-10-28' -> { valid: true, value: Date(2026-10-28T00:00:00.000Z) }
 *   missing/bad  -> { valid: false, message }
 */
export function parseDecisionDate(raw) {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return { valid: false, message: DECISION_DATE_REQUIRED_MESSAGE };
  }
  const parsed = parseDueDate(raw);
  if (parsed.valid) return parsed;
  if (parsed.message === DUE_DATE_FORMAT_MESSAGE) return { valid: false, message: DECISION_DATE_FORMAT_MESSAGE };
  if (parsed.message === DUE_DATE_RANGE_MESSAGE) return { valid: false, message: DECISION_DATE_RANGE_MESSAGE };
  return { valid: false, message: DECISION_DATE_INVALID_MESSAGE };
}

function readText(raw, { label, max }) {
  if (raw === undefined || raw === null) return { valid: false, message: `${label} is required.` };
  if (typeof raw !== 'string') return { valid: false, message: `${label} must be text.` };
  const value = raw.trim();
  if (!value) return { valid: false, message: `${label} is required.` };
  if (value.length > max) return { valid: false, message: `${label} must be ${max.toLocaleString('en-US')} characters or fewer.` };
  return { valid: true, value };
}

// User IDs of the participants, in the order sent, without duplicates.
export function readParticipants(raw) {
  if (raw === undefined || raw === null) return { valid: false, message: 'Add at least one participant.' };
  if (!Array.isArray(raw)) return { valid: false, message: 'Participants must be a list of project members.' };
  const ids = [];
  for (const item of raw) {
    const id = typeof item === 'string' ? item.trim() : String(item?._id || item?.userId || item?.id || '');
    if (!isObjectIdText(id)) return { valid: false, message: 'Invalid participant ID.' };
    if (!ids.includes(id.toLowerCase())) ids.push(id.toLowerCase());
  }
  if (ids.length === 0) return { valid: false, message: 'Add at least one participant.' };
  return { valid: true, value: ids };
}

/*
 * The optional link to a related task or channel thread.
 *   null or ''                       -> { valid: true, value: null }   (no link / remove it)
 *   { type: 'task', id }             -> { valid: true, value: { type, id } }
 *   { type: 'thread', id }           -> same (id = the thread's top-level message)
 */
export function readDecisionLink(raw) {
  if (raw === null || raw === '') return { valid: true, value: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { valid: false, message: 'Link must be a task or a channel thread.' };
  const type = String(raw.type || '').trim().toLowerCase();
  if (!DECISION_LINK_TYPES.includes(type)) return { valid: false, message: 'Link must be a task or a channel thread.' };
  const id = String(raw.id || '').trim();
  if (!isObjectIdText(id)) return { valid: false, message: type === 'task' ? 'Invalid task ID.' : 'Invalid thread ID.' };
  return { valid: true, value: { type, id: id.toLowerCase() } };
}

/*
 * Reads a create (partial = false) or edit (partial = true) request body.
 * On create every required field must be there. On edit only the fields sent are checked
 * and changed, but a field that is sent must still be valid (an empty title is refused).
 * Returns { ok: true, values } or { ok: false, message } (answer 400; nothing is saved).
 * values only has the keys that were sent: title, description, date, participants, link.
 */
export function readDecisionInput(body, { partial = false } = {}) {
  const input = body && typeof body === 'object' ? body : {};
  const values = {};

  const steps = [
    ['title', () => readText(input.title, { label: 'Title', max: DECISION_TITLE_MAX })],
    ['description', () => readText(input.description, { label: 'Description', max: DECISION_DESCRIPTION_MAX })],
    ['participants', () => readParticipants(input.participants)],
    ['date', () => parseDecisionDate(input.date)],
  ];

  for (const [key, read] of steps) {
    if (partial && input[key] === undefined) continue;
    const result = read();
    if (!result.valid) return { ok: false, message: result.message };
    values[key] = result.value;
  }

  if (input.link !== undefined) {
    const result = readDecisionLink(input.link);
    if (!result.valid) return { ok: false, message: result.message };
    values.link = result.value;
  }

  return { ok: true, values };
}

// Where a link opens in the app. Same deep links as notifications (lib/notifications.js).
export function decisionTaskHref(projectId, taskId) {
  return `/project/${projectId}?tab=tasks&task=${taskId}`;
}

export function decisionThreadHref(projectId, channelId, messageId) {
  return `/project/${projectId}?tab=chat&channel=${channelId}&message=${messageId}&thread=${messageId}`;
}

function shortText(text, max = 80) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function idOf(value) {
  if (value === null || value === undefined) return '';
  return String(value._id || value);
}

/*
 * The link as the API returns it. `decision` has the raw IDs relatedTask / relatedMessage /
 * relatedChannel; `targets` has what is still in the database, as Maps by ID string:
 *   { tasks: Map(id -> { _id, title }), messages: Map(id -> { _id, body }), channels: Map(id -> { _id, name }) }
 * Returns
 *   null                                                         no link
 *   { type: 'task', id, label, href, missing: false }            working link
 *   { type: 'thread', id, channelId, label, href, missing: false }
 *   { type, id, label: '', href: null, missing: true }           target deleted: show text, not a link
 */
export function decisionLinkView(decision, targets = {}) {
  const projectId = idOf(decision.project);
  const tasks = targets.tasks || new Map();
  const messages = targets.messages || new Map();
  const channels = targets.channels || new Map();

  const taskId = idOf(decision.relatedTask);
  if (taskId) {
    const task = tasks.get(taskId);
    if (!task) return { type: 'task', id: taskId, label: '', href: null, missing: true };
    return { type: 'task', id: taskId, label: task.title, href: decisionTaskHref(projectId, taskId), missing: false };
  }

  const messageId = idOf(decision.relatedMessage);
  if (messageId) {
    const channelId = idOf(decision.relatedChannel);
    const message = messages.get(messageId);
    const channel = channels.get(channelId);
    if (!message || !channel) return { type: 'thread', id: messageId, channelId: channelId || null, label: '', href: null, missing: true };
    return {
      type: 'thread',
      id: messageId,
      channelId,
      label: `#${channel.name}: ${shortText(message.body)}`,
      href: decisionThreadHref(projectId, channelId, messageId),
      missing: false,
    };
  }

  return null;
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 3 · M8] What this file does
 * Validation for decision records (title, description, participants, date, optional
 * task/thread link) and the link shape the API returns, including the "target was
 * deleted" case. No database code, so it is unit tested directly.
 * ---------------------------------------------------------------------------
 */
