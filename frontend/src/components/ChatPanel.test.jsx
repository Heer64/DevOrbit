// Sprint 2 final: the Chat tab (US-16).
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ChatPanel, { mergeMessages } from './ChatPanel';
import TasksPanel from './TasksPanel';

const general = { _id: 'c1', name: 'general', isDefault: true };
const design = { _id: 'c2', name: 'design', isDefault: false };
const at = (minute) => new Date(Date.UTC(2026, 9, 20, 10, minute)).toISOString();
const msg = (id, body, minute, author = { _id: 'u1', name: 'Riya Kapoor' }) => ({ _id: id, body, createdAt: at(minute), author, channel: 'c1', project: 'p1' });

function fakeApi({ messages = [msg('m1', 'Hello team', 1)] } = {}) {
  let live = null;
  return {
    list: vi.fn(() => Promise.resolve({ channels: [general, design] })),
    messages: vi.fn((projectId, channelId) => Promise.resolve({ messages: channelId === 'c1' ? messages : [], nextBefore: null })),
    send: vi.fn((projectId, channelId, body) => Promise.resolve({ message: msg('m-new', body, 5, { _id: 'me', name: 'Me' }) })),
    create: vi.fn((projectId, { name }) => Promise.resolve({ channel: { _id: 'c3', name } })),
    onMessage: vi.fn((projectId, handler) => { live = handler; return () => { live = null; }; }),
    push: (payload) => live?.(payload),
  };
}

describe('mergeMessages', () => {
  it('adds new messages once and keeps them oldest first', () => {
    const list = [msg('a', 'one', 1), msg('b', 'two', 2)];
    const merged = mergeMessages(list, [msg('c', 'zero', 0), msg('b', 'two', 2)]);
    expect(merged.map((m) => m._id)).toEqual(['c', 'a', 'b']);
  });
});

describe('ChatPanel (US-16)', () => {
  it('opens #general and shows each message with its author', async () => {
    render(<ChatPanel projectId="p1" myRole="Contributor" api={fakeApi()} />);
    expect(await screen.findByText('Hello team')).toBeTruthy();
    expect(screen.getByText('Riya Kapoor')).toBeTruthy();
    expect(screen.getByRole('button', { name: /general/ }).getAttribute('aria-current')).toBe('true');
  });

  it('sends with Enter and shows the saved message', async () => {
    const api = fakeApi();
    render(<ChatPanel projectId="p1" myRole="Contributor" api={api} />);
    const box = await screen.findByLabelText('Message');
    fireEvent.change(box, { target: { value: 'Standup at 10?' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await screen.findByText('Standup at 10?');
    expect(api.send).toHaveBeenCalledWith('p1', 'c1', 'Standup at 10?');
  });

  it('shows live messages from teammates in the open channel only, without duplicates', async () => {
    const api = fakeApi();
    render(<ChatPanel projectId="p1" myRole="Contributor" api={api} />);
    await screen.findByText('Hello team');
    act(() => api.push({ projectId: 'p1', channelId: 'c1', message: msg('m2', 'Live one', 2) }));
    act(() => api.push({ projectId: 'p1', channelId: 'c1', message: msg('m2', 'Live one', 2) }));
    act(() => api.push({ projectId: 'p1', channelId: 'c2', message: msg('m3', 'Other room', 3) }));
    expect(screen.getAllByText('Live one')).toHaveLength(1);
    expect(screen.queryByText('Other room')).toBeNull();
  });

  it('Viewers can read but get no composer', async () => {
    render(<ChatPanel projectId="p1" myRole="Viewer" api={fakeApi()} />);
    await screen.findByText('Hello team');
    expect(screen.queryByLabelText('Message')).toBeNull();
    expect(screen.getByText(/can read channels but not send/)).toBeTruthy();
  });

  it('only Owners and Admins see "New channel"', async () => {
    const { unmount } = render(<ChatPanel projectId="p1" myRole="Contributor" api={fakeApi()} />);
    await screen.findByText('Hello team');
    expect(screen.queryByText('New channel')).toBeNull();
    unmount();

    const api = fakeApi();
    render(<ChatPanel projectId="p1" myRole="Admin" api={api} />);
    fireEvent.click(await screen.findByText('New channel'));
    fireEvent.change(screen.getByLabelText('New channel name'), { target: { value: 'release' } });
    fireEvent.click(screen.getByLabelText('Create channel'));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith('p1', { name: 'release' }));
    expect(await screen.findByRole('button', { name: /release/ })).toBeTruthy();
  });

  it('opens the channel named in the link', async () => {
    const api = fakeApi();
    render(<ChatPanel projectId="p1" myRole="Owner" api={api} channelId="c2" />);
    await waitFor(() => expect(api.messages).toHaveBeenCalledWith('p1', 'c2'));
  });
});

describe('Task links (?task=<id>)', () => {
  const task = { _id: 't1', title: 'Linked task', status: 'To do', priority: 'Medium', version: 0, assignee: null, createdBy: { _id: 'me' } };
  const taskApi = (tasks) => ({
    list: vi.fn(() => Promise.resolve({ tasks })),
    get: vi.fn(() => Promise.resolve({ task })),
    create: vi.fn(), update: vi.fn(), remove: vi.fn(), updateStatus: vi.fn(),
  });

  it('opens the linked task when it is in the list', async () => {
    render(<TasksPanel projectId="p1" myRole="Owner" currentUserId="me" api={taskApi([task])} openTaskId="t1" />);
    expect(await screen.findByDisplayValue('Linked task')).toBeTruthy();
  });

  it('fetches the linked task when it is not in the loaded list, and reports close', async () => {
    const api = taskApi([]);
    const onCloseTask = vi.fn();
    render(<TasksPanel projectId="p1" myRole="Viewer" currentUserId="me" api={api} openTaskId="t1" onCloseTask={onCloseTask} />);
    expect(await screen.findByDisplayValue('Linked task')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('p1', 't1');
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onCloseTask).toHaveBeenCalled();
  });
});

/*
 * ---------------------------------------------------------------------------
 * [Sprint 2 final] What this file tests
 * Chat tab: history with authors, sending, live messages (no duplicates, only
 * the open channel), Viewer read-only, channel creation rights, channel links.
 * Also the new task links (?task=<id>) used by notifications and decisions.
 * ---------------------------------------------------------------------------
 */
