// [Sprint 5 · M6] US-50 Create a public post: composer (500 characters, one image ≤ 5 MB, rate-limit message).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PostComposer from './PostComposer';
import {
  MAX_POST_IMAGE_BYTES,
  POST_CREATED_MESSAGE,
  POST_IMAGE_TOO_LARGE_MESSAGE,
  POST_IMAGE_TYPE_MESSAGE,
  POST_TEXT_REQUIRED_MESSAGE,
  POST_TEXT_TOO_LONG_MESSAGE,
} from '../posts';

// A File whose reported size can be set without allocating the bytes.
function fakeImage(name = 'photo.png', size = 2048, type = 'image/png') {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

const savedPost = (text) => ({
  _id: 'p1', text, author: { _id: 'u1', name: 'Asha Author', username: 'asha' },
  imageUrl: null, edited: false, createdAt: '2026-11-07T10:00:00.000Z', isMine: true, upvotes: 0, downvotes: 0, score: 0,
});

function renderComposer(create = vi.fn(({ text }) => Promise.resolve({ post: savedPost(text), message: POST_CREATED_MESSAGE }))) {
  const onCreated = vi.fn();
  render(<PostComposer api={{ create }} onCreated={onCreated} />);
  return { create, onCreated };
}

const type = (text) => fireEvent.change(screen.getByLabelText('Post text'), { target: { value: text } });
const pick = (file) => fireEvent.change(screen.getByTestId('post-image-input'), { target: { files: [file] } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: /^post$/i }));

describe('PostComposer (US-50)', () => {
  it('AC1: publishes a text post and shows the success message', async () => {
    const { create, onCreated } = renderComposer();
    type('Hello community');
    expect(screen.getByText('15/500')).toBeTruthy();
    submit();

    expect((await screen.findByRole('status')).textContent).toBe(POST_CREATED_MESSAGE);
    expect(create).toHaveBeenCalledWith({ text: 'Hello community', image: null });
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ _id: 'p1', text: 'Hello community' }));
    expect(screen.getByLabelText('Post text').value).toBe('');
  });

  it('AC1: sends one JPEG, PNG or WebP image with the text', async () => {
    const { create } = renderComposer();
    type('With a picture');
    const image = fakeImage('shot.webp', 4096, 'image/webp');
    pick(image);
    expect(screen.getByRole('button', { name: /image added/i })).toBeTruthy();
    submit();

    await screen.findByRole('status');
    expect(create).toHaveBeenCalledWith({ text: 'With a picture', image });
  });

  it('AC3: refuses empty text and text over 500 characters before sending', async () => {
    const { create } = renderComposer();
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe(POST_TEXT_REQUIRED_MESSAGE);

    type('a'.repeat(501));
    expect(screen.getByText('501/500').className).toContain('over');
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe(POST_TEXT_TOO_LONG_MESSAGE);
    expect(create).not.toHaveBeenCalled();
  });

  it('AC3: refuses an image over 5 MB or of the wrong type', async () => {
    const { create } = renderComposer();
    pick(fakeImage('huge.png', MAX_POST_IMAGE_BYTES + 1));
    expect((await screen.findByRole('alert')).textContent).toBe(POST_IMAGE_TOO_LARGE_MESSAGE);

    pick(fakeImage('anim.gif', 1000, 'image/gif'));
    expect((await screen.findByRole('alert')).textContent).toBe(POST_IMAGE_TYPE_MESSAGE);
    expect(screen.getByRole('button', { name: /add image/i })).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
  });

  it('AC2: shows the server rate-limit message on the 11th post in an hour', async () => {
    const message = 'You can create up to 10 posts per hour. Please try again in 12 minutes.';
    const create = vi.fn(() => Promise.reject(Object.assign(new Error(message), { status: 429 })));
    renderComposer(create);
    type('Another one');
    submit();

    expect((await screen.findByRole('alert')).textContent).toBe(message);
    // The text stays so the user does not lose it.
    expect(screen.getByLabelText('Post text').value).toBe('Another one');
  });

  it('AC3: shows the server message when the server refuses the post', async () => {
    const create = vi.fn(() => Promise.reject(Object.assign(new Error(POST_IMAGE_TYPE_MESSAGE), { status: 400 })));
    renderComposer(create);
    type('Renamed file');
    pick(fakeImage('fake.png'));
    submit();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(POST_IMAGE_TYPE_MESSAGE));
  });
});
