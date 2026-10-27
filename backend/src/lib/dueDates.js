/*
 * [Sprint 3 · M5] Task due dates (US-23, FR-7a, FR-10, FR-32).
 *
 * One place for the due-date rules, so the task routes, the dashboard views and the
 * deadline notifications (M7) all agree. This file has no imports on purpose: the rules
 * can be tested without a database (see backend/test/dueDates.test.js).
 *
 * The rules
 * 1. A due date is a calendar day, not a moment. It is stored as midnight UTC of that
 *    day ("2026-10-28" -> 2026-10-28T00:00:00.000Z). Everyone sees the same day, whatever
 *    their timezone: a teammate in India and one in the US who both pick 28 Oct store and
 *    see 28 Oct.
 * 2. The API accepts "YYYY-MM-DD" (what <input type="date"> sends). A full timestamp is
 *    accepted only when it is exactly midnight UTC (so a task read from the API can be sent
 *    back unchanged). Other timestamps are refused, because turning "28 Oct 00:00 in India"
 *    into a day would silently give 27 Oct.
 * 3. A task is due at the END of its due day (UTC). It is overdue once that has passed and
 *    it is not Done.
 * 4. "Due within 24 hours" (the deadline notification of US-23 / FR-10): the task is not
 *    Done and its deadline is still ahead but less than 24 hours away:
 *        now < deadline < now + 24h
 *    With midnight-UTC due dates this is the whole of the due day in UTC.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
export const DEADLINE_WINDOW_MS = DAY_MS; // "less than 24 hours away"
export const MIN_DUE_YEAR = 2000;
export const MAX_DUE_YEAR = 2100;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
// ISO timestamp with an explicit zone, e.g. 2026-10-28T00:00:00.000Z or ...+05:30
const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export const DUE_DATE_FORMAT_MESSAGE = 'Due date must be a calendar date (YYYY-MM-DD).';
export const DUE_DATE_INVALID_MESSAGE = 'Invalid due date.';
export const DUE_DATE_RANGE_MESSAGE = `Due date must be between ${MIN_DUE_YEAR} and ${MAX_DUE_YEAR}.`;

// Midnight UTC of a calendar day, or null when the day does not exist (2026-02-30).
function utcDay(year, month, day) {
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

/*
 * Reads "dueDate" from a request body.
 *   undefined          -> { valid: true, value: undefined }   (field not sent: leave it alone)
 *   null or ''         -> { valid: true, value: null }        (no due date / clear it)
 *   '2026-10-28'       -> { valid: true, value: Date(2026-10-28T00:00:00.000Z) }
 *   anything else bad  -> { valid: false, message }           (answer 400)
 */
export function parseDueDate(raw) {
  if (raw === undefined) return { valid: true, value: undefined };
  if (raw === null || raw === '') return { valid: true, value: null };
  if (typeof raw !== 'string') return { valid: false, message: DUE_DATE_INVALID_MESSAGE };

  const text = raw.trim();
  let date = null;

  const dateOnly = DATE_ONLY.exec(text);
  if (dateOnly) {
    date = utcDay(Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3]));
    if (!date) return { valid: false, message: DUE_DATE_INVALID_MESSAGE };
  } else if (ISO_TIMESTAMP.test(text)) {
    const [, y, m, d] = ISO_TIMESTAMP.exec(text);
    const moment = new Date(text);
    if (!utcDay(Number(y), Number(m), Number(d)) || Number.isNaN(moment.getTime())) {
      return { valid: false, message: DUE_DATE_INVALID_MESSAGE };
    }
    if (moment.getTime() !== startOfUtcDay(moment).getTime()) {
      return { valid: false, message: DUE_DATE_FORMAT_MESSAGE };
    }
    date = moment;
  } else {
    return { valid: false, message: DUE_DATE_FORMAT_MESSAGE };
  }

  const year = date.getUTCFullYear();
  if (year < MIN_DUE_YEAR || year > MAX_DUE_YEAR) return { valid: false, message: DUE_DATE_RANGE_MESSAGE };

  return { valid: true, value: date };
}

export function startOfUtcDay(value = new Date()) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// The moment a task stops being on time: the end of its due day (UTC). null without a due date.
export function deadlineOf(dueDate) {
  if (!dueDate) return null;
  const date = new Date(dueDate);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(startOfUtcDay(date).getTime() + DAY_MS);
}

export function isOverdue(task, now = new Date()) {
  if (!task?.dueDate || task.status === 'Done') return false;
  const deadline = deadlineOf(task.dueDate);
  return Boolean(deadline) && deadline.getTime() <= new Date(now).getTime();
}

// Rule 4 for one task.
export function isDueWithin24h(task, now = new Date()) {
  if (!task?.dueDate || task.status === 'Done') return false;
  const deadline = deadlineOf(task.dueDate);
  if (!deadline) return false;
  const nowMs = new Date(now).getTime();
  return deadline.getTime() > nowMs && deadline.getTime() < nowMs + DEADLINE_WINDOW_MS;
}

/*
 * Rule 4 as a MongoDB condition on the stored dueDate (midnight UTC):
 *   now < dueDate + 24h < now + 24h   <=>   now - 24h < dueDate < now
 * Use it as { dueDate: dueWithin24hRange(now) } together with { status: { $ne: 'Done' } }.
 */
export function dueWithin24hRange(now = new Date()) {
  const nowMs = new Date(now).getTime();
  return { $gt: new Date(nowMs - DEADLINE_WINDOW_MS), $lt: new Date(nowMs) };
}

/*
 * Idempotency key for the deadline notification (createNotification's dedupeKey, M7).
 * The same task and due day never notify twice; moving the due date gives a new key,
 * so the assignee is told again about the new day.
 */
export function deadlineDedupeKey(task) {
  const id = String(task?._id || task?.id || '');
  if (!id || !task?.dueDate) return null;
  return `deadline:${id}:${startOfUtcDay(task.dueDate).toISOString()}`;
}

// "28 Oct 2026" style text for activity summaries (UTC, so it is the stored day).
export function formatDueDay(dueDate) {
  if (!dueDate) return '';
  return new Date(dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
