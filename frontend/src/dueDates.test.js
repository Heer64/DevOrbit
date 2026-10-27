// [Sprint 3 · M5] "Due today" / "due tomorrow" rules (US-23): timezones and day boundaries.
import { afterEach, describe, expect, it } from 'vitest';
import { daysUntilDue, dueSoonSuffix, dueState } from './dueDates';

const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

// The API's format: a calendar day at midnight UTC.
const DUE_28 = '2026-10-28T00:00:00.000Z';
const task = (dueDate, status = 'To do') => ({ dueDate, status });

describe('the viewer\'s own calendar day decides today / tomorrow / overdue', () => {
  it('in India, just after local midnight it is already the due day', () => {
    process.env.TZ = 'Asia/Kolkata';
    // 28 Oct 00:30 in India = 27 Oct 19:00 UTC.
    const now = new Date('2026-10-27T19:00:00.000Z');
    expect(daysUntilDue(DUE_28, now)).toBe(0);
    expect(dueState(task(DUE_28), now)).toBe('today');
    // One minute before local midnight it is still "tomorrow".
    expect(dueState(task(DUE_28), new Date('2026-10-27T18:29:00.000Z'))).toBe('tomorrow');
  });

  it('in California, late on the due day it is still due today, not overdue', () => {
    process.env.TZ = 'America/Los_Angeles';
    // 28 Oct 23:30 in California = 29 Oct 06:30 UTC (already the next day in UTC).
    expect(dueState(task(DUE_28), new Date('2026-10-29T06:30:00.000Z'))).toBe('today');
    // Local midnight passes: now it is overdue.
    expect(dueState(task(DUE_28), new Date('2026-10-29T07:00:00.000Z'))).toBe('overdue');
  });

  it('exact midnight boundaries', () => {
    process.env.TZ = 'UTC';
    expect(dueState(task(DUE_28), new Date('2026-10-27T23:59:59.999Z'))).toBe('tomorrow');
    expect(dueState(task(DUE_28), new Date('2026-10-28T00:00:00.000Z'))).toBe('today');
    expect(dueState(task(DUE_28), new Date('2026-10-28T23:59:59.999Z'))).toBe('today');
    expect(dueState(task(DUE_28), new Date('2026-10-29T00:00:00.000Z'))).toBe('overdue');
  });

  it('counts days across month ends, year ends and leap days', () => {
    process.env.TZ = 'UTC';
    expect(daysUntilDue('2027-01-01T00:00:00.000Z', new Date('2026-12-31T10:00:00.000Z'))).toBe(1);
    expect(daysUntilDue('2028-03-01T00:00:00.000Z', new Date('2028-02-28T10:00:00.000Z'))).toBe(2);
    expect(daysUntilDue('2026-11-01T00:00:00.000Z', new Date('2026-10-31T10:00:00.000Z'))).toBe(1);
  });

  it('day counts stay whole across a daylight-saving change', () => {
    process.env.TZ = 'America/Los_Angeles'; // clocks go back on 1 Nov 2026
    const now = new Date('2026-10-31T19:00:00.000Z'); // 31 Oct, noon local
    expect(daysUntilDue('2026-11-02T00:00:00.000Z', now)).toBe(2);
    expect(daysUntilDue('2026-11-09T00:00:00.000Z', now)).toBe(9);
  });
});

describe('dueSoonSuffix', () => {
  const now = new Date('2026-10-28T09:00:00.000Z');

  it('adds "due today" / "due tomorrow" only for open tasks', () => {
    process.env.TZ = 'UTC';
    expect(dueSoonSuffix(task(DUE_28), now)).toBe(' · due today');
    expect(dueSoonSuffix(task('2026-10-29T00:00:00.000Z'), now)).toBe(' · due tomorrow');
    expect(dueSoonSuffix(task('2026-11-05T00:00:00.000Z'), now)).toBe('');
    expect(dueSoonSuffix(task('2026-10-27T00:00:00.000Z'), now)).toBe(''); // overdue is shown separately
    expect(dueSoonSuffix(task(DUE_28, 'Done'), now)).toBe('');
    expect(dueSoonSuffix(task(null), now)).toBe('');
    expect(dueSoonSuffix(task('nonsense'), now)).toBe('');
  });

  it('Done tasks are never overdue or due soon', () => {
    process.env.TZ = 'UTC';
    expect(dueState(task('2026-10-01T00:00:00.000Z', 'Done'), now)).toBe('done');
    expect(dueState(task(null), now)).toBe('none');
  });
});
