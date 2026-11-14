// [Sprint 6 · M5] US-44 Catch Me Up display helpers.
import { describe, expect, it } from 'vitest';
import { contextLine, countsLine, periodLabel, splitEventCitations, summaryPoints } from './catchUpDisplay';

const sources = [
  { ref: 'E2', label: 'Riya moved "Login" to Done', link: '/project/x' },
  { ref: 'E1', label: 'Sam created task "API"', link: '/project/y' },
];

describe('catchUpDisplay', () => {
  it('splits the summary into points, removing list markers and blank lines', () => {
    expect(summaryPoints('- First [E1]\n\n* Second\n• Third\n2. Fourth\nPlain line')).toEqual([
      'First [E1]',
      'Second',
      'Third',
      'Fourth',
      'Plain line',
    ]);
    expect(summaryPoints('')).toEqual([]);
    expect(summaryPoints(null)).toEqual([]);
  });

  it('turns [E2] citations into numbered refs in Sources order, and leaves other brackets alone', () => {
    const parts = splitEventCitations('Login done [E2, E1] (see [notes]) and [E9]', sources);
    expect(parts[0]).toEqual({ text: 'Login done' });
    expect(parts[1].refs.map((item) => [item.ref, item.number])).toEqual([
      ['E2', 1],
      ['E1', 2],
    ]);
    expect(parts[2].text).toBe(' (see [notes]) and');
    expect(parts).toHaveLength(3);
    expect(splitEventCitations('No citations', sources)).toEqual([{ text: 'No citations' }]);
  });

  it('lists what changed with singular and plural words, skipping zeros', () => {
    expect(countsLine({ tasks: 3, messages: 1, github: 2, decisions: 0, total: 6 })).toBe('3 task updates · 1 message · 2 GitHub events');
    expect(countsLine({ people: 1, files: 1 })).toBe('1 member change · 1 file');
    expect(countsLine(null)).toBe('');
  });

  it('says which period the summary covers', () => {
    expect(periodLabel({ since: '2026-11-12T14:05:00.000Z', basis: 'previous_login' })).toMatch(
      /^Since your previous login on Nov 12, 2026/
    );
    expect(periodLabel({ basis: 'recent_days' })).toBe('Your previous login is not known yet, so this covers the last 7 days.');
    expect(periodLabel({ since: 'nope', basis: 'previous_login' })).toBe('Since your previous login.');
  });

  it('explains when older events were left out to fit the AI limit', () => {
    expect(contextLine({ trimmed: true, included: 120, available: 450, budgetTokens: 8000 })).toBe(
      'Summarised from the 120 newest of 450 events; older ones were left out to stay within the 8,000-token AI input limit.'
    );
    expect(contextLine({ trimmed: false, included: 5, available: 5 })).toBe('');
    expect(contextLine(null)).toBe('');
  });
});
