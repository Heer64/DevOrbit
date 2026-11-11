// [Sprint 6 · M2] US-19 AC1: "Message" on another user's profile opens a direct conversation.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import UserProfilePage from './UserProfilePage';
import MessageUserButton from '../components/MessageUserButton';

const profile = (overrides = {}) => ({
  name: 'Bob Builder',
  username: 'bob.builder',
  headline: '',
  bio: '',
  avatarUrl: '',
  skills: [],
  followerCount: 0,
  publicScore: 0,
  portfolio: { available: false, path: null },
  isMe: false,
  isFollowing: false,
  ...overrides,
});

function OpenConversation() {
  const { conversationId } = useParams();
  return <p>Conversation {conversationId} is open</p>;
}

function renderProfile({ profileData = profile(), messages }) {
  const api = { user: vi.fn(() => Promise.resolve({ profile: profileData })), follow: vi.fn(), unfollow: vi.fn() };
  return render(
    <MemoryRouter initialEntries={['/people/bob.builder']}>
      <Routes>
        <Route path="/people/:username" element={<UserProfilePage api={api} portfolios={{ shared: vi.fn() }} messages={messages} />} />
        <Route path="/messages/:conversationId" element={<OpenConversation />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Message button on a profile (US-19)', () => {
  it('AC1: choosing Message opens the direct conversation with that user', async () => {
    const messages = { open: vi.fn(() => Promise.resolve({ conversation: { _id: 'conv42', otherUser: { username: 'bob.builder' } } })) };
    renderProfile({ messages });
    const button = await screen.findByRole('button', { name: 'Message Bob Builder' });
    fireEvent.click(button);
    expect(messages.open).toHaveBeenCalledWith('bob.builder');
    expect(await screen.findByText('Conversation conv42 is open')).toBeTruthy();
  });

  it('it sits next to Follow on other people’s profiles', async () => {
    renderProfile({ profileData: profile(), messages: { open: vi.fn() } });
    const message = await screen.findByRole('button', { name: 'Message Bob Builder' });
    const follow = screen.getByRole('button', { name: 'Follow Bob Builder' });
    expect(message.closest('.profile-action-row')).toBe(follow.closest('.profile-action-row'));
  });

  it('it is not shown on my own profile', async () => {
    const open = vi.fn();
    renderProfile({ profileData: profile({ isMe: true }), messages: { open } });
    await screen.findByText(/This is how other people see your profile/);
    expect(screen.queryByRole('button', { name: /^Message/ })).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
});

describe('MessageUserButton', () => {
  function renderButton(api) {
    return render(
      <MemoryRouter initialEntries={['/people/bob']}>
        <Routes>
          <Route path="/people/:username" element={<MessageUserButton username="bob" name="Bob" api={api} />} />
          <Route path="/messages/:conversationId" element={<OpenConversation />} />
        </Routes>
      </MemoryRouter>
    );
  }

  it('shows that it is working and ignores a second click', async () => {
    let finish;
    const api = { open: vi.fn(() => new Promise((resolve) => (finish = resolve))) };
    renderButton(api);
    const button = screen.getByRole('button', { name: 'Message Bob' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.open).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Opening…');
    finish({ conversation: { _id: 'c1' } });
    expect(await screen.findByText('Conversation c1 is open')).toBeTruthy();
  });

  it('a failure (e.g. the user no longer exists) is shown and the button works again', async () => {
    const api = { open: vi.fn(() => Promise.reject(Object.assign(new Error('User not found.'), { status: 404 }))) };
    renderButton(api);
    fireEvent.click(screen.getByRole('button', { name: 'Message Bob' }));
    expect((await screen.findByRole('alert')).textContent).toBe('User not found.');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Message Bob' }).disabled).toBe(false));
  });
});
