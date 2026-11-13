// [Sprint 6 · M4] US-42, US-43: helpers that show a grounded Copilot answer.
import { describe, expect, it } from 'vitest';
import { contextNote, formatSourceDate, sourceDate, sourceHref, splitCitations } from './copilotAnswer';

const P = 'a'.repeat(24);
const T = 'b'.repeat(24);
const task = { ref: 'T1', type: 'task', label: 'Login page', link: `/project/${P}?tab=tasks&task=${T}`, external: false };
const msg = {
  ref: 'M2',
  type: 'message',
  label: 'We ship Friday',
  link: `/project/${P}?tab=chat&channel=${T}&message=${T}&thread=${T}`,
  external: false,
};
const gh = { ref: 'G1', type: 'github', label: 'Add login', link: 'https://github.com/Heer64/DevOrbit/pull/41', external: true };

describe('sourceHref', () => {
  it('accepts the in-app links the server builds and github.com links only', () => {
    expect(sourceHref(task)).toEqual({ href: task.link, external: false });
    expect(sourceHref(msg)).toEqual({ href: msg.link, external: false });
    expect(sourceHref(gh)).toEqual({ href: gh.link, external: true });
  });

  it('refuses anything else', () => {
    for (const source of [
      { link: 'javascript:alert(1)' },
      { link: 'https://evil.example/project' },
      { link: '//evil.example/x' },
      { link: `/project/${P}?tab=tasks&task=<script>` },
      { link: 'https://evil.example', external: true },
      { link: 'http://github.com/x', external: true },
      { link: '/project/abc?tab=tasks' },
      null,
      {},
    ]) {
      expect(sourceHref(source)).toBeNull();
    }
  });
});

describe('splitCitations', () => {
  it('turns [T1] and [M2, G1] into numbered references to the sources list', () => {
    const parts = splitCitations('Login is in progress [T1]. Shipped [m2; G1].', [task, msg, gh]);
    expect(parts).toEqual([
      { text: 'Login is in progress' },
      { refs: [{ ref: 'T1', number: 1, source: task }] },
      { text: '. Shipped' },
      {
        refs: [
          { ref: 'M2', number: 2, source: msg },
          { ref: 'G1', number: 3, source: gh },
        ],
      },
      { text: '.' },
    ]);
  });

  it('drops ids that are not sources and leaves other brackets as text', () => {
    expect(splitCitations('Done [T9] see [the docs](x) [T1, note]', [task])).toEqual([
      { text: 'Done' },
      { text: ' see [the docs](x) [T1, note]' },
    ]);
  });

  it('text without citations is one part', () => {
    expect(splitCitations('Plain answer.', [])).toEqual([{ text: 'Plain answer.' }]);
    expect(splitCitations('', [])).toEqual([{ text: '' }]);
    expect(splitCitations(undefined)).toEqual([{ text: '' }]);
  });
});

describe('contextNote', () => {
  const context = (included, available, trimmed, budgetTokens = 8000) => ({
    budgetTokens,
    included: { total: included },
    available: { total: available },
    trimmed,
  });

  it('says what the answer is based on', () => {
    expect(contextNote(context(7, 7, false))).toBe('Based on all 7 project records you can see.');
    expect(contextNote(context(1, 1, false))).toBe('Based on the only project record you can see.');
  });

  it('says what was left out to stay within the token limit', () => {
    expect(contextNote(context(42, 1250, true))).toBe(
      'Based on 42 of 1,250 project records you can see. The rest were left out to stay within the 8,000-token AI input limit (least related and oldest first).'
    );
    expect(contextNote(context(10, 300, true, 3000))).toMatch(/3,000-token/);
  });

  it('"Checked" for a not-enough-data answer; a project with no records says so', () => {
    expect(contextNote(context(5, 5, false), true)).toBe('Checked all 5 project records you can see.');
    expect(contextNote(context(0, 0, false), true)).toBe('This project has no tasks, messages, decisions or GitHub activity yet.');
  });

  it('nothing when the server sent no context', () => {
    expect(contextNote(null)).toBe('');
    expect(contextNote({})).toBe('');
  });
});

describe('formatSourceDate', () => {
  it('shows the UTC calendar day', () => {
    expect(formatSourceDate('2026-11-10T23:30:00.000Z')).toBe('Nov 10, 2026');
    expect(formatSourceDate(null)).toBe('');
    expect(formatSourceDate('not a date')).toBe('');
  });

  it('only messages, comments and GitHub events show a date (tasks and decisions carry their own)', () => {
    const at = '2026-11-10T08:00:00.000Z';
    expect(['message', 'comment', 'github', 'task', 'decision'].map((type) => sourceDate({ type, at }))).toEqual([
      'Nov 10, 2026',
      'Nov 10, 2026',
      'Nov 10, 2026',
      '',
      '',
    ]);
  });
});
