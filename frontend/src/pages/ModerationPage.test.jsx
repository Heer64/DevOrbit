// [Sprint 6 · M7] US-56 Moderate reported posts: the moderator queue page.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const auth = vi.hoisted(() => ({ user: { id: 'm1', name: 'Mo Moderator', platformRole: 'moderator', isDemo: false } }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }));

import ModerationPage, { ALREADY_HANDLED_MESSAGE, MODERATORS_ONLY_MESSAGE } from './ModerationPage';

const item = (id, overrides = {}) => ({
  post: { _id: id, text: `Post ${id} text`, hasImage: false, imageUrl: null, edited: false, createdAt: '2026-11-15T10:00:00.000Z', author: { _id: `a-${id}`, name: `Author ${id}`, username: `author${id}` } },
  ownPost: false,
  reportCount: 3,
  reasons: [{ reason: 'spam', label: 'Spam or misleading', count: 2 }, { reason: 'other', label: 'Something else', count: 1 }],
  notes: [{ reason: 'other', label: 'Something else', details: 'Phishing link', reportedAt: '2026-11-15T11:00:00.000Z' }],
  firstReportedAt: '2026-11-15T10:30:00.000Z',
  lastReportedAt: '2026-11-15T11:00:00.000Z',
  ...overrides,
});

const httpError = (status, message) => Object.assign(new Error(message), { status });

function fakeApi({ reports = [item('p1'), item('p2', { reportCount: 1, reasons: [{ reason: 'hate', label: 'Hate speech or symbols', count: 1 }], notes: [] })], actions = [] } = {}) {
  const done = (action) => vi.fn((postId) => Promise.resolve({
    action, postId, resolution: `${action}d`, resolvedReports: 1, notified: action === 'warn', message: `${action} ok`,
    moderationAction: { _id: `log-${postId}`, action, postId, postExcerpt: `Post ${postId} text`, postAuthor: { name: `Author ${postId}` }, moderator: { name: 'Mo Moderator' }, reportCount: 1, reasons: [], createdAt: '2026-11-16T09:00:00.000Z' },
  }));
  return {
    queue: vi.fn(() => Promise.resolve({ reports })),
    actions: vi.fn(() => Promise.resolve({ actions })),
    remove: done('remove'),
    warn: done('warn'),
    dismiss: done('dismiss'),
  };
}

const cards = () => screen.queryAllByTestId('report-card');

beforeEach(() => {
  auth.user = { id: 'm1', name: 'Mo Moderator', platformRole: 'moderator', isDemo: false };
});

describe('ModerationPage (US-56)', () => {
  it('AC1: lists each reported post with its reasons and report count', async () => {
    render(<ModerationPage api={fakeApi()} />);
    await waitFor(() => expect(cards()).toHaveLength(2));
    const first = cards()[0];
    expect(within(first).getByText('Post p1 text')).toBeTruthy();
    expect(within(first).getByText('Author p1')).toBeTruthy();
    expect(within(first).getByText('3 reports')).toBeTruthy();
    expect(within(first).getByText('Spam or misleading × 2')).toBeTruthy();
    expect(within(first).getByText('Something else × 1')).toBeTruthy();
    expect(within(first).getByText('“Phishing link”')).toBeTruthy();
    expect(within(cards()[1]).getByText('1 report')).toBeTruthy();
    expect(screen.getByLabelText('Queue summary').textContent).toContain('2 reported posts');
    expect(screen.getByLabelText('Queue summary').textContent).toContain('4 open reports');
  });

  it('Remove asks first, then deletes and the card leaves the queue', async () => {
    const api = fakeApi();
    render(<ModerationPage api={api} />);
    await waitFor(() => expect(cards()).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Remove post by Author p1' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Remove this post?')).toBeTruthy();
    expect(api.remove).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Remove post' })); });
    expect(api.remove).toHaveBeenCalledWith('p1');
    expect(cards()).toHaveLength(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('remove ok');
    expect(screen.getByRole('list', { name: 'Recent decisions' }).textContent).toContain('Removed');
  });

  it('cancelling the Remove dialog changes nothing', async () => {
    const api = fakeApi();
    render(<ModerationPage api={api} />);
    await waitFor(() => expect(cards()).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Remove post by Author p1' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(api.remove).not.toHaveBeenCalled();
    expect(cards()).toHaveLength(2);
  });

  it('Warn and Dismiss act at once and remove the card', async () => {
    const api = fakeApi();
    render(<ModerationPage api={api} />);
    await waitFor(() => expect(cards()).toHaveLength(2));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Warn Author p1' })); });
    expect(api.warn).toHaveBeenCalledWith('p1');
    expect(screen.getByRole('status').textContent).toBe('warn ok');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Dismiss reports on post by Author p2' })); });
    expect(api.dismiss).toHaveBeenCalledWith('p2');
    expect(cards()).toHaveLength(0);
    expect(screen.getByText('Nothing to review')).toBeTruthy();
  });

  it('409: says another moderator handled it and reloads the queue', async () => {
    const api = fakeApi();
    api.warn.mockRejectedValueOnce(httpError(409, 'This report was already handled.'));
    render(<ModerationPage api={api} />);
    await waitFor(() => expect(cards()).toHaveLength(2));
    api.queue.mockResolvedValueOnce({ reports: [item('p2')] });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Warn Author p1' })); });
    expect(screen.getByRole('alert').textContent).toBe(ALREADY_HANDLED_MESSAGE);
    expect(api.queue).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(cards()).toHaveLength(1));
  });

  it('buttons are disabled while an action is on its way', async () => {
    const api = fakeApi();
    let finish;
    api.dismiss.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<ModerationPage api={api} />);
    await waitFor(() => expect(cards()).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss reports on post by Author p1' }));
    expect(screen.getByRole('button', { name: 'Warn Author p1' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Warn Author p2' }).disabled).toBe(false);
    await act(async () => { finish({ message: 'done' }); });
  });

  it('empty queue', async () => {
    render(<ModerationPage api={fakeApi({ reports: [] })} />);
    expect(await screen.findByText('Nothing to review')).toBeTruthy();
  });

  it('AC3: a 403 from the server shows "Content Moderators only"', async () => {
    const api = fakeApi();
    api.queue.mockRejectedValueOnce(httpError(403, 'Only a Content Moderator can do this.'));
    render(<ModerationPage api={api} />);
    expect(await screen.findByText('Content Moderators only')).toBeTruthy();
    expect(screen.getByText(MODERATORS_ONLY_MESSAGE)).toBeTruthy();
  });

  it('AC3: a normal user who types /moderation sees "Content Moderators only" and nothing is loaded', () => {
    auth.user = { id: 'u1', name: 'Uma', platformRole: 'user', isDemo: false };
    const api = fakeApi();
    render(<ModerationPage api={api} />);
    expect(screen.getByText('Content Moderators only')).toBeTruthy();
    expect(api.queue).not.toHaveBeenCalled();
  });

  it('a load error can be retried', async () => {
    const api = fakeApi();
    api.queue.mockRejectedValueOnce(httpError(500, 'Server is down.'));
    render(<ModerationPage api={api} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Server is down.');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    await waitFor(() => expect(cards()).toHaveLength(2));
  });

  it('shows "your own post" for the moderator\'s own post', async () => {
    render(<ModerationPage api={fakeApi({ reports: [item('p9', { ownPost: true })] })} />);
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(cards()[0].textContent).toContain('your own post');
  });
});
