// [Sprint 5 · M6] US-51 Edit or delete my post: post card (edited mark, owner-only actions, confirm delete, 403).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PostCard from './PostCard';
import { POST_TEXT_TOO_LONG_MESSAGE } from '../posts';

const NOW = Date.parse('2026-11-07T12:00:00.000Z');

const post = (extra = {}) => ({
  _id: 'p1',
  author: { _id: 'u1', name: 'Asha Author', username: 'asha', avatarUrl: '' },
  text: 'Original text',
  imageUrl: null,
  image: null,
  edited: false,
  editedAt: null,
  createdAt: '2026-11-07T11:55:00.000Z',
  updatedAt: '2026-11-07T11:55:00.000Z',
  upvotes: 0,
  downvotes: 0,
  score: 0,
  isMine: true,
  ...extra,
});

function renderCard(item = post(), api = {}) {
  const onUpdated = vi.fn();
  const onDeleted = vi.fn();
  const fullApi = {
    update: vi.fn((id, { text }) => Promise.resolve({ post: post({ text, edited: true, editedAt: '2026-11-07T12:00:00.000Z' }) })),
    remove: vi.fn(() => Promise.resolve({ postId: 'p1' })),
    ...api,
  };
  const view = render(<PostCard post={item} api={fullApi} onUpdated={onUpdated} onDeleted={onDeleted} now={NOW} />);
  return { api: fullApi, onUpdated, onDeleted, ...view };
}

describe('PostCard', () => {
  it('shows author, time, text and image', () => {
    renderCard(post({ imageUrl: '/api/posts/p1/image', image: { contentType: 'image/png', size: 10 } }));
    expect(screen.getByText('Asha Author')).toBeTruthy();
    expect(screen.getByText('5 min ago')).toBeTruthy();
    expect(screen.getByText('Original text')).toBeTruthy();
    expect(screen.getByAltText('Image shared by Asha Author').getAttribute('src')).toMatch(/\/api\/posts\/p1\/image$/);
    expect(screen.queryByText(/edited/)).toBeNull();
  });

  it('US-51 AC3: only the author sees Edit and Delete', () => {
    renderCard(post({ isMine: false }));
    expect(screen.queryByLabelText('Edit post')).toBeNull();
    expect(screen.queryByLabelText('Delete post')).toBeNull();
  });

  it('US-51 AC1: the author edits the text and the card shows it as edited', async () => {
    const { api, onUpdated, rerender } = renderCard();
    fireEvent.click(screen.getByLabelText('Edit post'));
    const box = screen.getByLabelText('Edit post text');
    expect(box.value).toBe('Original text');
    fireEvent.change(box, { target: { value: 'Fixed text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(api.update).toHaveBeenCalledWith('p1', { text: 'Fixed text' });
    const saved = onUpdated.mock.calls[0][0];
    rerender(<PostCard post={saved} api={api} now={NOW} />);
    expect(screen.getByText('Fixed text')).toBeTruthy();
    expect(screen.getByText(/edited/)).toBeTruthy();
  });

  it('US-51 AC1: an edit over 500 characters is refused before sending; Cancel keeps the old text', async () => {
    const { api } = renderCard();
    fireEvent.click(screen.getByLabelText('Edit post'));
    fireEvent.change(screen.getByLabelText('Edit post text'), { target: { value: 'b'.repeat(501) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe(POST_TEXT_TOO_LONG_MESSAGE);
    expect(api.update).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Original text')).toBeTruthy();
  });

  it('US-51 AC2: delete asks for confirmation first, then removes the post', async () => {
    const { api, onDeleted } = renderCard();
    fireEvent.click(screen.getByLabelText('Delete post'));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Delete this post?')).toBeTruthy();
    expect(api.remove).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete post' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('p1'));
    expect(api.remove).toHaveBeenCalledWith('p1');
  });

  it('US-51 AC2: cancelling the confirmation keeps the post', () => {
    const { api, onDeleted } = renderCard();
    fireEvent.click(screen.getByLabelText('Delete post'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.remove).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  it('US-51 AC3: a 403 from the server is shown and the post stays', async () => {
    const refuse = () => Promise.reject(Object.assign(new Error('You can only edit or delete your own posts.'), { status: 403 }));
    const { onDeleted, onUpdated } = renderCard(post(), { remove: vi.fn(refuse), update: vi.fn(refuse) });

    fireEvent.click(screen.getByLabelText('Delete post'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete post' }));
    expect((await within(screen.getByRole('alertdialog')).findByRole('alert')).textContent).toBe('You can only edit or delete your own posts.');
    expect(onDeleted).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByLabelText('Edit post'));
    fireEvent.change(screen.getByLabelText('Edit post text'), { target: { value: 'Changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('You can only edit or delete your own posts.');
    expect(onUpdated).not.toHaveBeenCalled();
  });
});
