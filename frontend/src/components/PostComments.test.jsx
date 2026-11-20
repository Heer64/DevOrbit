// [Sprint 7 · M3] Comments and replies on a feed post: list, comment, reply (one level), edit, delete.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PostComments from './PostComments';
import { COMMENT_TEXT_REQUIRED_MESSAGE, COMMENT_TEXT_TOO_LONG_MESSAGE } from '../comments';

const NOW = Date.parse('2026-11-20T10:00:00.000Z');
const BEN = { _id: 'u2', name: 'Ben Shah', username: 'ben', avatarUrl: '' };
const ME = { _id: 'u1', name: 'Heer Patel', username: 'heer', avatarUrl: '' };

const item = (extra = {}) => ({
  _id: 'c1',
  post: 'p1',
  parent: null,
  author: BEN,
  text: 'Congrats on the launch!',
  edited: false,
  editedAt: null,
  deleted: false,
  createdAt: '2026-11-20T09:55:00.000Z',
  updatedAt: '2026-11-20T09:55:00.000Z',
  isMine: false,
  ...extra,
});

const startList = () => [
  { ...item(), replyCount: 1, replies: [item({ _id: 'r1', parent: 'c1', author: ME, text: 'Thank you!', isMine: true })] },
  { ...item({ _id: 'c2', author: ME, text: 'Write-up coming soon.', isMine: true }), replyCount: 0, replies: [] },
];

function fakeApi(extra = {}) {
  return {
    list: vi.fn(() => Promise.resolve({ comments: startList(), nextAfter: null, commentCount: 3 })),
    create: vi.fn((postId, { text, parentId }) => Promise.resolve({
      comment: item({ _id: parentId ? 'r9' : 'c9', parent: parentId || null, author: ME, text, isMine: true }),
      commentCount: 4,
      message: parentId ? 'Your reply was added.' : 'Your comment was added.',
    })),
    update: vi.fn((postId, commentId, { text }) => Promise.resolve({
      comment: item({ _id: commentId, author: ME, text, isMine: true, edited: true, editedAt: '2026-11-20T10:00:00.000Z', parent: commentId === 'r1' ? 'c1' : null }),
      message: 'Your comment was updated.',
    })),
    remove: vi.fn((postId, commentId) => Promise.resolve({ commentId, deleted: 'removed', comment: null, commentCount: 2, message: 'Your comment was deleted.' })),
    ...extra,
  };
}

async function renderComments(api = fakeApi()) {
  const onCountChange = vi.fn();
  const view = render(<PostComments postId="p1" api={api} onCountChange={onCountChange} now={NOW} />);
  await screen.findByText('Congrats on the launch!');
  return { api, onCountChange, ...view };
}

describe('PostComments', () => {
  it('loads the comments with their replies nested under them, and reports the count', async () => {
    const { api, onCountChange } = await renderComments();
    expect(api.list).toHaveBeenCalledWith('p1', { limit: 20 });
    expect(onCountChange).toHaveBeenCalledWith(3);
    const replies = screen.getByRole('list', { name: 'Replies (1)' });
    expect(within(replies).getByText('Thank you!')).toBeTruthy();
    expect(screen.getByText('Write-up coming soon.')).toBeTruthy();
    expect(screen.getAllByText('5 min ago').length).toBeGreaterThan(0);
  });

  it('replies are one level deep: comments have Reply, replies do not', async () => {
    await renderComments();
    expect(screen.getAllByRole('button', { name: 'Reply' })).toHaveLength(2);
    const replies = screen.getByRole('list', { name: 'Replies (1)' });
    expect(within(replies).queryByRole('button', { name: 'Reply' })).toBeNull();
  });

  it('only your own comments and replies have Edit and Delete', async () => {
    await renderComments();
    expect(screen.getAllByLabelText('Edit comment')).toHaveLength(1);
    expect(screen.getAllByLabelText('Edit reply')).toHaveLength(1);
    const bens = screen.getByText('Congrats on the launch!').closest('.pc-row');
    expect(within(bens).queryByLabelText('Edit comment')).toBeNull();
    expect(within(bens).queryByLabelText('Delete comment')).toBeNull();
  });

  it('shows an empty state when there are no comments', async () => {
    const api = fakeApi({ list: vi.fn(() => Promise.resolve({ comments: [], nextAfter: null, commentCount: 0 })) });
    render(<PostComments postId="p1" api={api} now={NOW} />);
    expect(await screen.findByText('No comments yet. Start the conversation.')).toBeTruthy();
  });

  it('comment on the post: added at the end, box cleared, count updated', async () => {
    const { api, onCountChange } = await renderComments();
    const box = screen.getByLabelText('Write a comment');
    fireEvent.change(box, { target: { value: 'Adding the docs link tonight.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    expect(await screen.findByText('Adding the docs link tonight.')).toBeTruthy();
    expect(api.create).toHaveBeenCalledWith('p1', { text: 'Adding the docs link tonight.' });
    expect(onCountChange).toHaveBeenLastCalledWith(4);
    await waitFor(() => expect(screen.getByLabelText('Write a comment').value).toBe(''));
    expect(screen.getByRole('status').textContent).toBe('Your comment was added.');
  });

  it('empty or too-long text is refused before sending', async () => {
    const { api } = await renderComments();
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    expect((await screen.findByRole('alert')).textContent).toBe(COMMENT_TEXT_REQUIRED_MESSAGE);
    fireEvent.change(screen.getByLabelText('Write a comment'), { target: { value: 'x'.repeat(501) } });
    expect(screen.getByText('501/500')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    expect((await screen.findByRole('alert')).textContent).toBe(COMMENT_TEXT_TOO_LONG_MESSAGE);
    expect(api.create).not.toHaveBeenCalled();
  });

  it('reply to a comment: the reply shows under it and the box closes', async () => {
    const { api, onCountChange } = await renderComments();
    fireEvent.click(screen.getAllByRole('button', { name: 'Reply' })[0]);
    const box = screen.getByLabelText('Reply to Ben Shah');
    fireEvent.change(box, { target: { value: 'React, Express and MongoDB.' } });
    fireEvent.click(within(box.closest('form')).getByRole('button', { name: 'Reply' }));

    const replies = await screen.findByRole('list', { name: 'Replies (2)' });
    expect(within(replies).getByText('React, Express and MongoDB.')).toBeTruthy();
    expect(api.create).toHaveBeenCalledWith('p1', { text: 'React, Express and MongoDB.', parentId: 'c1' });
    expect(onCountChange).toHaveBeenLastCalledWith(4);
    expect(screen.queryByLabelText('Reply to Ben Shah')).toBeNull();
  });

  it('edit your own reply: new text with "edited"; Cancel keeps the old text', async () => {
    const { api } = await renderComments();
    fireEvent.click(screen.getByLabelText('Edit comment'));
    fireEvent.change(screen.getByLabelText('Edit your comment'), { target: { value: 'Changed my mind' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Write-up coming soon.')).toBeTruthy();
    expect(api.update).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Edit reply'));
    fireEvent.change(screen.getByLabelText('Edit your reply'), { target: { value: 'Thank you so much!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Thank you so much!')).toBeTruthy();
    expect(api.update).toHaveBeenCalledWith('p1', 'r1', { text: 'Thank you so much!' });
    const row = screen.getByText('Thank you so much!').closest('.pc-row');
    expect(within(row).getByText(/edited/)).toBeTruthy();
  });

  it('delete asks first; a deleted reply leaves the list and the count goes down', async () => {
    const { api, onCountChange } = await renderComments();
    fireEvent.click(screen.getByLabelText('Delete reply'));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Delete this reply?')).toBeTruthy();
    expect(api.remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete reply' }));
    await waitFor(() => expect(screen.queryByText('Thank you!')).toBeNull());
    expect(api.remove).toHaveBeenCalledWith('p1', 'r1');
    expect(onCountChange).toHaveBeenLastCalledWith(2);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('deleting a comment that has replies shows "Comment deleted" and keeps the replies', async () => {
    const list = startList();
    list[0] = { ...list[0], author: ME, isMine: true };
    const api = fakeApi({
      list: vi.fn(() => Promise.resolve({ comments: list, nextAfter: null, commentCount: 3 })),
      remove: vi.fn((postId, commentId) => Promise.resolve({
        commentId, deleted: 'placeholder', comment: item({ _id: commentId, deleted: true, text: '', author: null }), commentCount: 2, message: 'Your comment was deleted.',
      })),
    });
    await renderComments(api);
    fireEvent.click(screen.getAllByLabelText('Delete comment')[0]);
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/replies under it stay/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete comment' }));
    expect(await screen.findByText('Comment deleted')).toBeTruthy();
    expect(screen.queryByText('Congrats on the launch!')).toBeNull();
    expect(screen.getByText('Thank you!')).toBeTruthy();
  });

  it('a 403 from the server is shown in the dialog and nothing is removed', async () => {
    const refuse = () => Promise.reject(Object.assign(new Error('You can only edit or delete your own comments.'), { status: 403 }));
    await renderComments(fakeApi({ remove: vi.fn(refuse) }));
    fireEvent.click(screen.getByLabelText('Delete reply'));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete reply' }));
    expect((await within(screen.getByRole('alertdialog')).findByRole('alert')).textContent).toBe('You can only edit or delete your own comments.');
    expect(screen.getByText('Thank you!')).toBeTruthy();
  });

  it('loads more comments when there are more', async () => {
    const api = fakeApi({
      list: vi.fn((postId, { after } = {}) => Promise.resolve(after
        ? { comments: [{ ...item({ _id: 'c3', text: 'Third comment' }), replies: [], replyCount: 0 }], nextAfter: null, commentCount: 4 }
        : { comments: startList(), nextAfter: 'c2', commentCount: 4 })),
    });
    await renderComments(api);
    fireEvent.click(screen.getByRole('button', { name: 'Show more comments' }));
    expect(await screen.findByText('Third comment')).toBeTruthy();
    expect(api.list).toHaveBeenLastCalledWith('p1', { after: 'c2', limit: 20 });
    expect(screen.queryByRole('button', { name: 'Show more comments' })).toBeNull();
  });

  it('a failed load shows a message', async () => {
    const api = fakeApi({ list: vi.fn(() => Promise.reject(Object.assign(new Error('Post not found. It may have been deleted.'), { status: 404 }))) });
    render(<PostComments postId="p1" api={api} now={NOW} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Post not found. It may have been deleted.');
  });
});
