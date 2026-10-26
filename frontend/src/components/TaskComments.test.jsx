// [Sprint 3] US-20: task comments with author, time and @mentions.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import TaskComments, { mergeComments } from './TaskComments';
import TasksPanel from './TasksPanel';
import { activeMention, insertMention, splitMentions, suggestMembers } from './mentions';

const at = (minute) => new Date(Date.UTC(2026, 9, 20, 10, minute)).toISOString();
const members = [
  { userId: 'me', name: 'Aarush Sen', username: 'aarush' },
  { userId: 'u1', name: 'Riya Kapoor', username: 'riyak' },
  { userId: 'u2', name: 'Rohan Mehta', username: 'rohanm' },
  { userId: 'u3', name: 'Dev Patel', username: '' }, // no username: cannot be mentioned
];
const comment = (id, body, minute, extra = {}) => ({ _id: id, body, createdAt: at(minute), author: { _id: 'u1', name: 'Riya Kapoor' }, mentions: [], ...extra });

function fakeApi(initial = [comment('k1', 'Started on this', 1)]) {
  let live = null;
  return {
    comments: vi.fn(() => Promise.resolve({ comments: initial, nextAfter: null })),
    addComment: vi.fn((projectId, taskId, body) => Promise.resolve({
      comment: comment('k-new', body, 5, {
        author: { _id: 'me', name: 'Aarush Sen' },
        mentions: body.includes('@riyak') ? [{ _id: 'u1', name: 'Riya Kapoor', username: 'riyak' }] : [],
      }),
    })),
    onComment: vi.fn((projectId, handler) => { live = handler; return () => { live = null; }; }),
    push: (payload) => live?.(payload),
  };
}

describe('mention helpers', () => {
  it('activeMention finds the @word at the caret, not inside emails', () => {
    expect(activeMention('Hi @ri', 6)).toEqual({ start: 3, query: 'ri' });
    expect(activeMention('@', 1)).toEqual({ start: 0, query: '' });
    expect(activeMention('mail a@b', 8)).toBeNull();
    expect(activeMention('Hi @riya done', 13)).toBeNull();
  });

  it('suggestMembers matches username or name, skips yourself and members without a username', () => {
    expect(suggestMembers(members, 'r', { excludeId: 'me' }).map((m) => m.username)).toEqual(['riyak', 'rohanm']);
    expect(suggestMembers(members, 'kap').map((m) => m.username)).toEqual(['riyak']);
    expect(suggestMembers(members, 'dev')).toEqual([]);
  });

  it('insertMention replaces the typed part and adds a space', () => {
    expect(insertMention('Hi @ri', { start: 3 }, 6, 'riyak')).toEqual({ text: 'Hi @riyak ', caret: 10 });
  });

  it('splitMentions highlights only stored mentions, including before punctuation', () => {
    const parts = splitMentions('Thanks @riyak. cc @nobody', [{ username: 'riyak', name: 'Riya' }]);
    expect(parts.map((p) => [p.text, Boolean(p.user)])).toEqual([['Thanks ', false], ['@riyak', true], ['. cc @nobody', false]]);
  });

  it('mergeComments adds once, oldest first', () => {
    const merged = mergeComments([comment('b', 'two', 2)], [comment('a', 'one', 1), comment('b', 'two', 2)]);
    expect(merged.map((c) => c._id)).toEqual(['a', 'b']);
  });
});

describe('TaskComments (US-20)', () => {
  it('shows each comment with author name and time', async () => {
    render(<TaskComments projectId="p1" taskId="t1" api={fakeApi()} canComment members={members} currentUserId="me" />);
    expect(await screen.findByText('Started on this')).toBeTruthy();
    expect(screen.getByText('Riya Kapoor')).toBeTruthy();
    const time = document.querySelector('time');
    expect(time.getAttribute('dateTime')).toBe(at(1));
  });

  it('posts with Enter, shows the comment and highlights the mention', async () => {
    const api = fakeApi();
    render(<TaskComments projectId="p1" taskId="t1" api={api} canComment members={members} currentUserId="me" />);
    const box = await screen.findByLabelText('Add a comment');
    fireEvent.change(box, { target: { value: '@riyak please review', selectionStart: 20 } });
    fireEvent.keyDown(box, { key: 'Enter' });
    const mention = await screen.findByText('@riyak');
    expect(mention.className).toContain('mention');
    expect(api.addComment).toHaveBeenCalledWith('p1', 't1', '@riyak please review');
    expect(screen.getByText('Aarush Sen')).toBeTruthy();
  });

  it('typing @ suggests project members only; picking one inserts @username', async () => {
    render(<TaskComments projectId="p1" taskId="t1" api={fakeApi()} canComment members={members} currentUserId="me" />);
    const box = await screen.findByLabelText('Add a comment');
    fireEvent.change(box, { target: { value: 'cc @r', selectionStart: 5 } });
    const list = await screen.findByRole('listbox', { name: 'Mention a project member' });
    const options = within(list).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['RKRiya Kapoor@riyak', 'RMRohan Mehta@rohanm']);
    fireEvent.mouseDown(options[1]);
    expect(box.value).toBe('cc @rohanm ');
  });

  it('when you are the only member, typing @ explains why nobody is suggested', async () => {
    render(<TaskComments projectId="p1" taskId="t1" api={fakeApi()} canComment members={[members[0]]} currentUserId="me" />);
    const box = await screen.findByLabelText('Add a comment');
    fireEvent.change(box, { target: { value: '@', selectionStart: 1 } });
    expect((await screen.findByRole('status')).textContent).toMatch(/No teammates to mention yet/);
  });

  it('a name that matches nobody says so', async () => {
    render(<TaskComments projectId="p1" taskId="t1" api={fakeApi()} canComment members={members} currentUserId="me" />);
    const box = await screen.findByLabelText('Add a comment');
    fireEvent.change(box, { target: { value: '@zzz', selectionStart: 4 } });
    expect((await screen.findByRole('status')).textContent).toBe('No project member matches "@zzz".');
  });

  it('Enter picks the highlighted suggestion instead of posting', async () => {
    const api = fakeApi();
    render(<TaskComments projectId="p1" taskId="t1" api={api} canComment members={members} currentUserId="me" />);
    const box = await screen.findByLabelText('Add a comment');
    fireEvent.change(box, { target: { value: '@ri', selectionStart: 3 } });
    await screen.findByRole('listbox');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.value).toBe('@riyak ');
    expect(api.addComment).not.toHaveBeenCalled();
  });

  it('shows live comments for this task only, without duplicates', async () => {
    const api = fakeApi();
    render(<TaskComments projectId="p1" taskId="t1" api={api} canComment members={members} currentUserId="me" />);
    await screen.findByText('Started on this');
    const live = comment('k9', 'Live from Rohan', 4);
    act(() => api.push({ projectId: 'p1', taskId: 't1', comment: live }));
    act(() => api.push({ projectId: 'p1', taskId: 't1', comment: live }));
    act(() => api.push({ projectId: 'p1', taskId: 't2', comment: comment('k10', 'Other task', 4) }));
    expect(screen.getAllByText('Live from Rohan')).toHaveLength(1);
    expect(screen.queryByText('Other task')).toBeNull();
  });

  it('Viewers read comments but get no comment box', async () => {
    render(<TaskComments projectId="p1" taskId="t1" api={fakeApi()} canComment={false} members={members} />);
    await screen.findByText('Started on this');
    expect(screen.queryByLabelText('Add a comment')).toBeNull();
    expect(screen.getByText(/can read comments but not add them/)).toBeTruthy();
  });
});

describe('TasksPanel task window', () => {
  const task = { _id: 't1', title: 'Linked task', status: 'To do', priority: 'Medium', version: 0, assignee: null, createdBy: { _id: 'me' } };
  const baseApi = () => ({
    list: vi.fn(() => Promise.resolve({ tasks: [task] })),
    get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), updateStatus: vi.fn(),
  });

  it('shows comments for a saved task when the api supports them', async () => {
    const api = { ...baseApi(), ...fakeApi() };
    render(<TasksPanel projectId="p1" myRole="Contributor" currentUserId="me" members={members} api={api} openTaskId="t1" />);
    expect(await screen.findByText('Started on this')).toBeTruthy();
    expect(api.comments).toHaveBeenCalledWith('p1', 't1');
  });

  it('a comment box Enter does not submit the task form', async () => {
    const api = { ...baseApi(), ...fakeApi() };
    render(<TasksPanel projectId="p1" myRole="Owner" currentUserId="me" members={members} api={api} openTaskId="t1" />);
    const box = await screen.findByLabelText('Add a comment');
    fireEvent.change(box, { target: { value: 'hello', selectionStart: 5 } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await screen.findByText('hello');
    expect(api.update).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Linked task')).toBeTruthy(); // window still open
  });

  it('demo api without comments shows no comments section', async () => {
    render(<TasksPanel projectId="p1" myRole="Owner" currentUserId="me" members={members} api={baseApi()} openTaskId="t1" />);
    await screen.findByDisplayValue('Linked task');
    expect(screen.queryByRole('region', { name: 'Comments' })).toBeNull();
  });
});
