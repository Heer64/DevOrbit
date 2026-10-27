// [Sprint 3 · M5] Due-date rules (US-23): parsing, timezones and the 24-hour boundary.
// Pure functions only, no database, so these run in milliseconds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAY_MS,
  DUE_DATE_FORMAT_MESSAGE,
  DUE_DATE_INVALID_MESSAGE,
  DUE_DATE_RANGE_MESSAGE,
  deadlineDedupeKey,
  deadlineOf,
  dueWithin24hRange,
  formatDueDay,
  isDueWithin24h,
  isOverdue,
  parseDueDate,
  startOfUtcDay,
} from '../src/lib/dueDates.js';

const iso = (result) => result.value?.toISOString();
const at = (text) => new Date(text);
const task = (dueDate, status = 'To do') => ({ _id: 'a'.repeat(24), dueDate: dueDate && new Date(dueDate), status });

/* ---------- parsing ---------- */

test('A YYYY-MM-DD due date is stored as midnight UTC of that day', () => {
  assert.equal(iso(parseDueDate('2026-10-28')), '2026-10-28T00:00:00.000Z');
  assert.equal(iso(parseDueDate(' 2026-10-28 ')), '2026-10-28T00:00:00.000Z');
});

test('Missing, null and empty due dates', () => {
  assert.deepEqual(parseDueDate(undefined), { valid: true, value: undefined });
  assert.deepEqual(parseDueDate(null), { valid: true, value: null });
  assert.deepEqual(parseDueDate(''), { valid: true, value: null });
});

test('The day picked is the day stored, whatever the server timezone is', () => {
  const original = process.env.TZ;
  try {
    for (const zone of ['UTC', 'Asia/Kolkata', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      process.env.TZ = zone;
      assert.equal(iso(parseDueDate('2026-10-28')), '2026-10-28T00:00:00.000Z', zone);
      assert.equal(formatDueDay(parseDueDate('2026-10-28').value), 'Oct 28, 2026', zone);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test('A timestamp is accepted only when it is exactly midnight UTC (API round trip)', () => {
  assert.equal(iso(parseDueDate('2026-10-28T00:00:00.000Z')), '2026-10-28T00:00:00.000Z');
  assert.equal(iso(parseDueDate('2026-10-28T00:00Z')), '2026-10-28T00:00:00.000Z');
  assert.equal(iso(parseDueDate('2026-10-28T05:30:00+05:30')), '2026-10-28T00:00:00.000Z');
});

test('Local midnight in India or the US is refused instead of silently moving the day', () => {
  // 28 Oct 00:00 in India is 27 Oct 18:30 UTC; guessing a day would store the wrong one.
  assert.deepEqual(parseDueDate('2026-10-28T00:00:00+05:30'), { valid: false, message: DUE_DATE_FORMAT_MESSAGE });
  assert.deepEqual(parseDueDate('2026-10-28T00:00:00-07:00'), { valid: false, message: DUE_DATE_FORMAT_MESSAGE });
  assert.deepEqual(parseDueDate('2026-10-28T12:00:00.000Z'), { valid: false, message: DUE_DATE_FORMAT_MESSAGE });
});

test('Days that do not exist are refused; leap days are accepted', () => {
  assert.equal(parseDueDate('2026-02-29').valid, false); // 2026 is not a leap year
  assert.equal(parseDueDate('2026-02-30').message, DUE_DATE_INVALID_MESSAGE);
  assert.equal(parseDueDate('2026-04-31').valid, false);
  assert.equal(parseDueDate('2026-13-01').valid, false);
  assert.equal(parseDueDate('2026-00-10').valid, false);
  assert.equal(parseDueDate('2026-02-30T00:00:00Z').valid, false);
  assert.equal(iso(parseDueDate('2028-02-29')), '2028-02-29T00:00:00.000Z');
  assert.equal(iso(parseDueDate('2026-12-31')), '2026-12-31T00:00:00.000Z');
});

test('Other formats and types are refused', () => {
  for (const raw of ['not-a-date', '28/10/2026', '10-28-2026', '2026-10-2', '20261028', 'Oct 28 2026', '2026-10-28T00:00:00']) {
    assert.equal(parseDueDate(raw).valid, false, raw);
  }
  for (const raw of [1761609600000, true, {}, [], { $gt: '' }]) {
    assert.deepEqual(parseDueDate(raw), { valid: false, message: DUE_DATE_INVALID_MESSAGE }, JSON.stringify(raw));
  }
});

test('Due dates must fall between 2000 and 2100', () => {
  assert.equal(parseDueDate('1999-12-31').message, DUE_DATE_RANGE_MESSAGE);
  assert.equal(parseDueDate('0202-10-28').message, DUE_DATE_RANGE_MESSAGE); // typo in the year
  assert.equal(parseDueDate('2101-01-01').message, DUE_DATE_RANGE_MESSAGE);
  assert.equal(parseDueDate('2000-01-01').valid, true);
  assert.equal(parseDueDate('2100-12-31').valid, true);
});

/* ---------- deadline and overdue ---------- */

test('The deadline is the end of the due day (UTC)', () => {
  assert.equal(deadlineOf(at('2026-10-28T00:00:00.000Z')).toISOString(), '2026-10-29T00:00:00.000Z');
  assert.equal(deadlineOf(at('2026-12-31T00:00:00.000Z')).toISOString(), '2027-01-01T00:00:00.000Z'); // year end
  assert.equal(deadlineOf(at('2028-02-28T00:00:00.000Z')).toISOString(), '2028-02-29T00:00:00.000Z'); // leap year
  assert.equal(deadlineOf(null), null);
  assert.equal(deadlineOf('nonsense'), null);
});

test('A task is overdue only after its due day has ended, and never when Done', () => {
  const due = '2026-10-28T00:00:00.000Z';
  assert.equal(isOverdue(task(due), at('2026-10-28T23:59:59.999Z')), false);
  assert.equal(isOverdue(task(due), at('2026-10-29T00:00:00.000Z')), true);
  assert.equal(isOverdue(task(due, 'Done'), at('2026-11-30T00:00:00.000Z')), false);
  assert.equal(isOverdue(task(null), at('2026-11-30T00:00:00.000Z')), false);
});

/* ---------- "due within 24 hours" boundary (US-23 AC 2) ---------- */

test('Due within 24 hours: exact boundaries around the due day', () => {
  const due = '2026-11-10T00:00:00.000Z'; // deadline 2026-11-11T00:00Z
  const cases = [
    ['2026-11-09T00:00:00.000Z', false], // 48 h left
    ['2026-11-09T23:59:59.999Z', false], // 24 h + 1 ms left
    ['2026-11-10T00:00:00.000Z', false], // exactly 24 h left: not LESS than 24 h
    ['2026-11-10T00:00:00.001Z', true], // just under 24 h
    ['2026-11-10T12:00:00.000Z', true],
    ['2026-11-10T23:59:59.999Z', true], // 1 ms left
    ['2026-11-11T00:00:00.000Z', false], // deadline reached: overdue, no longer "due soon"
    ['2026-11-12T00:00:00.000Z', false],
  ];
  for (const [now, expected] of cases) {
    assert.equal(isDueWithin24h(task(due), at(now)), expected, now);
  }
});

test('Due within 24 hours seen from India (UTC+5:30) and California (UTC-7)', () => {
  const due = '2026-11-10T00:00:00.000Z';
  // India: the window is 10 Nov 05:30 to 11 Nov 05:30 local time.
  assert.equal(isDueWithin24h(task(due), at('2026-11-10T05:29:59+05:30')), false);
  assert.equal(isDueWithin24h(task(due), at('2026-11-10T05:30:01+05:30')), true);
  assert.equal(isDueWithin24h(task(due), at('2026-11-11T05:29:59+05:30')), true);
  assert.equal(isDueWithin24h(task(due), at('2026-11-11T05:30:00+05:30')), false);
  // California: 9 Nov 16:00 to 10 Nov 16:00 local time.
  assert.equal(isDueWithin24h(task(due), at('2026-11-09T16:00:01-08:00')), true);
  assert.equal(isDueWithin24h(task(due), at('2026-11-10T16:00:00-08:00')), false);
});

test('Done tasks and tasks without a due date are never due soon', () => {
  const now = at('2026-11-10T12:00:00.000Z');
  assert.equal(isDueWithin24h(task('2026-11-10T00:00:00.000Z', 'Done'), now), false);
  assert.equal(isDueWithin24h(task(null), now), false);
  for (const status of ['To do', 'In progress', 'Blocked']) {
    assert.equal(isDueWithin24h(task('2026-11-10T00:00:00.000Z', status), now), true, status);
  }
});

test('The MongoDB range matches the rule for every hour of a month', () => {
  // Due dates from 3 days before to 3 days after each "now", checked against the predicate.
  const start = at('2026-02-25T00:00:00.000Z').getTime();
  for (let hour = 0; hour < 24 * 31; hour += 1) {
    for (const offsetMs of [0, 1, 30 * 60 * 1000]) {
      const now = new Date(start + hour * 60 * 60 * 1000 + offsetMs);
      const range = dueWithin24hRange(now);
      for (let day = -3; day <= 3; day += 1) {
        const dueDate = new Date(startOfUtcDay(now).getTime() + day * DAY_MS);
        const inRange = dueDate > range.$gt && dueDate < range.$lt;
        assert.equal(inRange, isDueWithin24h(task(dueDate), now), `${now.toISOString()} due ${dueDate.toISOString()}`);
      }
    }
  }
});

test('At any moment exactly one due day is "within 24 hours" (except exactly at midnight UTC)', () => {
  const now = at('2026-10-27T10:00:00.000Z'); // 15:30 in India
  const range = dueWithin24hRange(now);
  assert.equal(range.$gt.toISOString(), '2026-10-26T10:00:00.000Z');
  assert.equal(range.$lt.toISOString(), '2026-10-27T10:00:00.000Z');
  // Only 27 Oct qualifies; 28 Oct (tomorrow) is still more than 24 h away.
  assert.equal(isDueWithin24h(task('2026-10-27T00:00:00.000Z'), now), true);
  assert.equal(isDueWithin24h(task('2026-10-28T00:00:00.000Z'), now), false);
  assert.equal(isDueWithin24h(task('2026-10-26T00:00:00.000Z'), now), false);
});

/* ---------- dedupe key for M7 ---------- */

test('Deadline dedupe key: one per task and due day', () => {
  const id = '64b000000000000000000001';
  assert.equal(deadlineDedupeKey({ _id: id, dueDate: at('2026-11-01T00:00:00.000Z') }), `deadline:${id}:2026-11-01T00:00:00.000Z`);
  assert.notEqual(
    deadlineDedupeKey({ _id: id, dueDate: at('2026-11-01T00:00:00.000Z') }),
    deadlineDedupeKey({ _id: id, dueDate: at('2026-11-02T00:00:00.000Z') }),
    'moving the due date gives a new key',
  );
  assert.equal(deadlineDedupeKey({ _id: id, dueDate: null }), null);
  assert.equal(deadlineDedupeKey({ dueDate: at('2026-11-01T00:00:00.000Z') }), null);
});
