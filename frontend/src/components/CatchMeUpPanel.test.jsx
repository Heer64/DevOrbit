// [Sprint 6 · M5] US-44 Catch Me Up: summary since the previous login, loading indicator after 2 seconds,
// "nothing new", and "AI temporarily unavailable".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mocks = vi.hoisted(() => ({ catchUpApi: { run: vi.fn() }, copilotApi: { ask: vi.fn() } }));
vi.mock('../api', () => ({ catchUpApi: mocks.catchUpApi, copilotApi: mocks.copilotApi }));

import CatchMeUpPanel from './CatchMeUpPanel';
import { AI_UNAVAILABLE_TEXT, LOADING_DELAY_MS } from './CopilotPanel';

const P = 'a'.repeat(24);
const T = 'c'.repeat(24);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function apiError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.response = { status, data: { message, code } };
  return error;
}

const summary = (extra = {}) => ({
  nothingNew: false,
  message: '',
  since: '2026-11-12T14:05:00.000Z',
  until: '2026-11-14T10:00:00.000Z',
  basis: 'previous_login',
  counts: { tasks: 2, messages: 3, comments: 0, decisions: 1, github: 1, milestones: 0, people: 0, files: 0, project: 0, total: 7 },
  summary: '- The login page is done [E1]\n- The team decided to ship on Friday [E2]\n- octocat pushed a fix [E3]',
  shortened: false,
  sources: [
    {
      ref: 'E1',
      type: 'event',
      category: 'tasks',
      label: 'Riya Mehta (@riya) moved "Login page" to Done',
      detail: 'task updates',
      link: `/project/${P}?tab=tasks&task=${T}`,
      external: false,
      at: '2026-11-13T09:00:00.000Z',
    },
    {
      ref: 'E2',
      type: 'event',
      category: 'decisions',
      label: 'Sam (@sam) recorded decision "Ship Friday"',
      detail: 'decisions',
      link: `/project/${P}?tab=decisions&decision=${T}`,
      external: false,
      at: '2026-11-13T10:00:00.000Z',
    },
    {
      ref: 'E3',
      type: 'event',
      category: 'github',
      label: 'GitHub user octocat pushed commit "Fix"',
      detail: 'GitHub events',
      link: 'https://github.com/o/r/commit/abc',
      external: true,
      at: '2026-11-13T11:00:00.000Z',
    },
  ],
  context: { budgetTokens: 8000, estimatedTokens: 900, included: 7, available: 7, leftOut: 0, trimmed: false },
  ...extra,
});

const renderPanel = (projectId = P) =>
  render(
    <MemoryRouter>
      <CatchMeUpPanel projectId={projectId} />
    </MemoryRouter>
  );
const button = () => screen.getByRole('button', { name: /catch me up|catching up/i });
const settle = () => act(async () => {});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.catchUpApi.run.mockResolvedValue(summary());
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CatchMeUpPanel', () => {
  it('AC1: shows the summary since my previous login, with what changed and numbered links to the events', async () => {
    renderPanel();
    expect(mocks.catchUpApi.run).not.toHaveBeenCalled();
    fireEvent.click(button());
    await settle();
    expect(mocks.catchUpApi.run).toHaveBeenCalledWith(P);
    expect(screen.getByText(/^Since your previous login on Nov 12, 2026/)).toBeTruthy();
    expect(screen.getByText('What changed: 2 task updates · 3 messages · 1 decision · 1 GitHub event')).toBeTruthy();
    const points = screen.getAllByRole('listitem').filter((item) => item.closest('.catch-up-points'));
    expect(points).toHaveLength(3);
    expect(points[0].textContent).toBe('The login page is done1');

    const sourcesList = screen.getByRole('list', { name: 'Events used' });
    const links = within(sourcesList).getAllByRole('link');
    expect(links[0].getAttribute('href')).toBe(`/project/${P}?tab=tasks&task=${T}`);
    expect(links[2].getAttribute('href')).toBe('https://github.com/o/r/commit/abc');
    expect(links[2].getAttribute('target')).toBe('_blank');
    expect(links[2].getAttribute('rel')).toContain('noopener');
    // The citation number and the "Based on" entry both link to event 1.
    expect(screen.getAllByRole('link', { name: /Event 1: Riya Mehta/ })).toHaveLength(2);
  });

  it('AC1: no loading indicator before 2 seconds, then one until the summary arrives', async () => {
    vi.useFakeTimers();
    const pending = deferred();
    mocks.catchUpApi.run.mockReturnValue(pending.promise);
    renderPanel();
    fireEvent.click(button());
    expect(button().disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(LOADING_DELAY_MS - 1));
    expect(screen.queryByText('Catching you up…')).toBeNull();
    await act(async () => vi.advanceTimersByTime(1));
    expect(screen.getByText('Catching you up…')).toBeTruthy();
    await act(async () => pending.resolve(summary()));
    expect(screen.queryByText('Catching you up…')).toBeNull();
    expect(screen.getByText(/The login page is done/)).toBeTruthy();
  });

  it('a quick summary never flashes the loading indicator', async () => {
    vi.useFakeTimers();
    const pending = deferred();
    mocks.catchUpApi.run.mockReturnValue(pending.promise);
    renderPanel();
    fireEvent.click(button());
    await act(async () => vi.advanceTimersByTime(1500));
    await act(async () => pending.resolve(summary()));
    await act(async () => vi.advanceTimersByTime(5000));
    expect(screen.queryByText('Catching you up…')).toBeNull();
  });

  it('AC2: nothing happened -> "nothing new", no list, no sources', async () => {
    mocks.catchUpApi.run.mockResolvedValue(
      summary({
        nothingNew: true,
        message: 'Nothing new since your last login. You are all caught up.',
        summary: '',
        sources: [],
        context: null,
        counts: { total: 0 },
      })
    );
    renderPanel();
    fireEvent.click(button());
    await settle();
    expect(screen.getByRole('status').textContent).toBe('Nothing new since your last login. You are all caught up.');
    expect(screen.queryByRole('list', { name: 'Events used' })).toBeNull();
    expect(screen.queryByText(/What changed/)).toBeNull();
  });

  it('no previous login known yet: says the summary covers the last 7 days', async () => {
    mocks.catchUpApi.run.mockResolvedValue(summary({ basis: 'recent_days' }));
    renderPanel();
    fireEvent.click(button());
    await settle();
    expect(screen.getByText('Your previous login is not known yet, so this covers the last 7 days.')).toBeTruthy();
  });

  it('AC3: AI provider down -> "AI temporarily unavailable", and the button can be pressed again', async () => {
    mocks.catchUpApi.run.mockRejectedValueOnce(apiError(503, 'AI temporarily unavailable.', 'AI_UNAVAILABLE'));
    renderPanel();
    fireEvent.click(button());
    await settle();
    expect(screen.getByRole('alert').textContent).toBe(AI_UNAVAILABLE_TEXT);
    expect(button().disabled).toBe(false);
    fireEvent.click(button());
    await settle();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/The login page is done/)).toBeTruthy();
  });

  it('other errors are shown as they come; network failures say to check the connection', async () => {
    mocks.catchUpApi.run.mockRejectedValueOnce(apiError(403, 'You are not a member of this project.'));
    renderPanel();
    fireEvent.click(button());
    await settle();
    expect(screen.getByRole('alert').textContent).toBe('You are not a member of this project.');
    mocks.catchUpApi.run.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fireEvent.click(button());
    await settle();
    expect(screen.getByRole('alert').textContent).toMatch(/Check your connection/);
  });

  it('says when older events were left out, and when the summary was shortened', async () => {
    mocks.catchUpApi.run.mockResolvedValue(
      summary({ shortened: true, context: { budgetTokens: 8000, included: 120, available: 450, leftOut: 330, trimmed: true } })
    );
    renderPanel();
    fireEvent.click(button());
    await settle();
    expect(screen.getByText(/120 newest of 450 events/)).toBeTruthy();
    expect(screen.getByText('This summary was shortened.')).toBeTruthy();
  });

  it('the summary is plain text, never HTML, and unsafe links are not made clickable', async () => {
    mocks.catchUpApi.run.mockResolvedValue(
      summary({
        summary: '- <img src=x onerror=alert(1)> did something [E1]',
        sources: [
          { ref: 'E1', type: 'event', label: 'Bad link', link: 'javascript:alert(1)', external: false, at: '2026-11-13T09:00:00.000Z' },
        ],
      })
    );
    const { container } = renderPanel();
    fireEvent.click(button());
    await settle();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)> did something/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Bad link/ })).toBeNull();
  });

  it('switching to another project clears the summary', async () => {
    const { rerender } = renderPanel();
    fireEvent.click(button());
    await settle();
    expect(screen.getByText(/The login page is done/)).toBeTruthy();
    rerender(
      <MemoryRouter>
        <CatchMeUpPanel projectId={'b'.repeat(24)} />
      </MemoryRouter>
    );
    await settle();
    expect(screen.queryByText(/The login page is done/)).toBeNull();
  });
});
