// [Sprint 6 · M6] US-55 Report a public post: the Report button on a post card.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PostCard from './PostCard';
import { REPORT_ALREADY_MESSAGE, REPORT_CREATED_MESSAGE } from '../reports';

const NOW = Date.parse('2026-11-13T12:00:00.000Z');

const post = (extra = {}) => ({
  _id: 'p1',
  author: { _id: 'u1', name: 'Asha Author', username: 'asha', avatarUrl: '' },
  text: 'Someone else’s post',
  imageUrl: null,
  image: null,
  edited: false,
  editedAt: null,
  createdAt: '2026-11-13T11:55:00.000Z',
  updatedAt: '2026-11-13T11:55:00.000Z',
  upvotes: 2,
  downvotes: 0,
  score: 2,
  myVote: 0,
  isMine: false,
  ...extra,
});

function fakeApi(extra = {}) {
  return {
    update: vi.fn(),
    remove: vi.fn(),
    vote: vi.fn(),
    unvote: vi.fn(),
    reportStatus: vi.fn(() => Promise.resolve({ reported: false, report: null })),
    report: vi.fn((postId, { reason }) =>
      Promise.resolve({ report: { _id: 'r1', post: postId, reason, status: 'open' }, message: REPORT_CREATED_MESSAGE })
    ),
    ...extra,
  };
}

const renderCard = (item = post(), api = fakeApi()) => ({ api, ...render(<PostCard post={item} api={api} now={NOW} />) });

describe('PostCard · Report (US-55)', () => {
  it('shows Report on other people’s posts only; my own posts keep Edit/Delete', () => {
    const { unmount } = renderCard();
    expect(screen.getByLabelText('Report post')).toBeTruthy();
    expect(screen.queryByLabelText('Edit post')).toBeNull();
    unmount();

    renderCard(post({ isMine: true }));
    expect(screen.queryByLabelText('Report post')).toBeNull();
    expect(screen.getByLabelText('Edit post')).toBeTruthy();
    expect(screen.getByLabelText('Delete post')).toBeTruthy();
  });

  it('AC1: Report -> choose a reason -> Send: the dialog closes and the card confirms it was sent', async () => {
    const { api } = renderCard();
    fireEvent.click(screen.getByLabelText('Report post'));
    const dialog = screen.getByRole('dialog', { name: 'Report this post' });
    fireEvent.click(await within(dialog).findByRole('radio', { name: 'Violence or threats' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send report' }));

    expect((await screen.findByRole('status')).textContent).toBe(REPORT_CREATED_MESSAGE);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.report).toHaveBeenCalledWith('p1', { reason: 'violence', details: '' });
    // The post itself is unchanged: same text, same score, still has its vote buttons.
    expect(screen.getByText('Someone else’s post')).toBeTruthy();
    expect(screen.getByLabelText('Score 2')).toBeTruthy();
  });

  it('AC2: reporting the same post again tells the user it was already reported, without sending again', async () => {
    const { api } = renderCard();
    fireEvent.click(screen.getByLabelText('Report post'));
    fireEvent.click(await screen.findByRole('radio', { name: 'Spam or misleading' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }));
    await screen.findByText(REPORT_CREATED_MESSAGE);

    fireEvent.click(screen.getByLabelText('Report post'));
    const dialog = screen.getByRole('dialog', { name: 'Report this post' });
    expect(within(dialog).getByText(REPORT_ALREADY_MESSAGE)).toBeTruthy();
    expect(within(dialog).queryByRole('radio')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.report).toHaveBeenCalledTimes(1);
  });

  it('AC2 after a reload: the server says it was already reported, and the card remembers it', async () => {
    const api = fakeApi({ reportStatus: vi.fn(() => Promise.resolve({ reported: true, report: { reason: 'spam' } })) });
    renderCard(post(), api);
    fireEvent.click(screen.getByLabelText('Report post'));
    expect(await screen.findByText(REPORT_ALREADY_MESSAGE)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(screen.getByLabelText('Report post').title).toBe('You reported this post'));
    fireEvent.click(screen.getByLabelText('Report post'));
    expect(screen.getByText(REPORT_ALREADY_MESSAGE)).toBeTruthy();
    expect(api.reportStatus).toHaveBeenCalledTimes(1);
    expect(api.report).not.toHaveBeenCalled();
  });

  it('Cancel closes the dialog and nothing is sent', async () => {
    const { api } = renderCard();
    fireEvent.click(screen.getByLabelText('Report post'));
    await screen.findByRole('radio', { name: 'Spam or misleading' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.report).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
