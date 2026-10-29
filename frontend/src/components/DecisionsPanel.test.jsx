// [Sprint 3 · M8] Decisions tab: record a decision (US-35) and view / edit decisions (US-36).
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DecisionsPanel, { decisionPayload, formFromDecision, formatDecisionDate, validateDecisionForm } from './DecisionsPanel';

const P = 'p'.repeat(24);
const members = [
  { userId: 'u1', name: 'Riya Kapoor', username: 'riyak' },
  { userId: 'u2', name: 'Rohan Mehta', username: 'rohanm' },
];
const tasks = [{ _id: 't1', title: 'Set up database' }, { _id: 't2', title: 'Login page' }];

const decision = (id, extra = {}) => ({
  _id: id,
  title: 'Use MongoDB',
  description: 'Fields vary per task.',
  date: '2026-10-20T00:00:00.000Z',
  participants: [{ _id: 'u1', name: 'Riya Kapoor' }],
  createdBy: { _id: 'u1', name: 'Riya Kapoor' },
  updatedBy: null,
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  link: null,
  ...extra,
});

function fakeApi(initial = []) {
  let rows = [...initial];
  return {
    list: vi.fn(() => Promise.resolve({ decisions: rows })),
    create: vi.fn((projectId, payload) => {
      const saved = decision('new', { ...payload, date: `${payload.date}T00:00:00.000Z`, participants: payload.participants.map((id) => members.find((m) => m.userId === id)).map((m) => ({ _id: m.userId, name: m.name })) });
      rows = [saved, ...rows];
      return Promise.resolve({ decision: saved });
    }),
    update: vi.fn((projectId, decisionId, payload) => {
      rows = rows.map((d) => (d._id === decisionId
        ? { ...d, ...payload, date: `${payload.date}T00:00:00.000Z`, updatedBy: { _id: 'u2', name: 'Rohan Mehta' }, updatedAt: '2026-10-22T10:00:00.000Z', participants: payload.participants.map((id) => ({ _id: id, name: members.find((m) => m.userId === id)?.name })) }
        : d));
      return Promise.resolve({ decision: rows.find((d) => d._id === decisionId) });
    }),
  };
}

const fakeChat = () => ({
  list: vi.fn(() => Promise.resolve({ channels: [{ _id: 'c1', name: 'general' }] })),
  messages: vi.fn(() => Promise.resolve({ messages: [{ _id: 'm1', body: 'Mongo or Postgres?', author: { name: 'Riya Kapoor' } }] })),
});

async function renderPanel({ role = 'Contributor', rows = [decision('d1')], api = fakeApi(rows), chat = fakeChat(), onChange = vi.fn() } = {}) {
  render(
    <MemoryRouter>
      <DecisionsPanel projectId={P} myRole={role} members={members} tasks={tasks} api={api} chat={chat} onChange={onChange} />
    </MemoryRouter>
  );
  await screen.findByLabelText('Decisions');
  return { api, chat, onChange };
}

function fill(label, value) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('decision helpers', () => {
  it('formats the date as the stored calendar day (UTC)', () => {
    expect(formatDecisionDate('2026-10-20T00:00:00.000Z')).toBe('Oct 20, 2026');
  });

  it('validateDecisionForm asks for every required field', () => {
    const ok = { title: 'T', description: 'D', date: '2026-10-20', participants: ['u1'], linkType: '', taskId: '', messageId: '' };
    expect(validateDecisionForm(ok)).toBe('');
    expect(validateDecisionForm({ ...ok, title: '  ' })).toBe('Title is required.');
    expect(validateDecisionForm({ ...ok, description: '' })).toBe('Description is required.');
    expect(validateDecisionForm({ ...ok, participants: [] })).toBe('Add at least one participant.');
    expect(validateDecisionForm({ ...ok, date: '' })).toBe('Decision date is required.');
    expect(validateDecisionForm({ ...ok, linkType: 'task' })).toMatch(/related task/);
  });

  it('decisionPayload sends the link on create, and on edit only when it changed', () => {
    const form = { ...formFromDecision(null), title: ' T ', description: 'D', date: '2026-10-20', participants: ['u1'], linkType: 'task', taskId: 't1' };
    expect(decisionPayload(form)).toEqual({ title: 'T', description: 'D', date: '2026-10-20', participants: ['u1'], link: { type: 'task', id: 't1' } });

    const saved = decision('d1', { link: { type: 'task', id: 't9', label: '', href: null, missing: true } });
    expect('link' in decisionPayload(formFromDecision(saved), saved)).toBe(false);
    expect(decisionPayload({ ...formFromDecision(saved), linkType: '' }, saved).link).toBeNull();
  });
});

describe('DecisionsPanel', () => {
  it('lists every decision with its title and date (US-36)', async () => {
    await renderPanel({ role: 'Viewer', rows: [decision('d1'), decision('d2', { title: 'Ship on Vercel', date: '2026-10-28T00:00:00.000Z' })] });
    const items = screen.getAllByTestId('decision');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Use MongoDB')).toBeTruthy();
    expect(within(items[0]).getByText(/Oct 20, 2026/)).toBeTruthy();
    expect(within(items[1]).getByText('Ship on Vercel')).toBeTruthy();
    expect(within(items[1]).getByText(/Oct 28, 2026/)).toBeTruthy();
  });

  it('a Viewer sees the list but no Record or Edit buttons', async () => {
    await renderPanel({ role: 'Viewer' });
    expect(screen.queryByRole('button', { name: /record decision/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /edit use mongodb/i })).toBeNull();
  });

  it('a Contributor records a decision with participants, date and a related task (US-35)', async () => {
    const { api, onChange } = await renderPanel({ rows: [] });
    fireEvent.click(screen.getByRole('button', { name: /record decision/i }));
    fill('Title', 'Pick Vite');
    fill('Description', 'Faster dev server.');
    fill('Date', '2026-10-25');
    fireEvent.click(screen.getByRole('checkbox', { name: /Rohan Mehta/ }));
    fill('Related task or thread', 'task');
    fill('Task', 't2');
    await act(async () => { fireEvent.click(screen.getByLabelText('Title').closest('form').querySelector('button[type=submit]')); });

    expect(api.create).toHaveBeenCalledWith(P, {
      title: 'Pick Vite', description: 'Faster dev server.', date: '2026-10-25', participants: ['u2'], link: { type: 'task', id: 't2' },
    });
    expect(await screen.findByText('Decision recorded.')).toBeTruthy();
    expect(screen.getByText('Pick Vite')).toBeTruthy();
    expect(onChange).toHaveBeenCalled();
  });

  it('a missing required field shows an error, keeps the form open and saves nothing', async () => {
    const { api } = await renderPanel({ rows: [] });
    fireEvent.click(screen.getByRole('button', { name: /record decision/i }));
    fill('Title', 'No participants yet');
    fill('Description', 'Something');
    fill('Date', '2026-10-25');
    const form = screen.getByLabelText('Title').closest('form');
    await act(async () => { fireEvent.submit(form); });
    expect(screen.getByRole('alert').textContent).toBe('Add at least one participant.');
    expect(screen.getByLabelText('Title')).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('shows a server validation error inside the form', async () => {
    const api = fakeApi([]);
    api.create.mockRejectedValueOnce(Object.assign(new Error('Participants must be members of this project.'), { status: 400 }));
    await renderPanel({ api });
    fireEvent.click(screen.getByRole('button', { name: /record decision/i }));
    fill('Title', 'T'); fill('Description', 'D'); fill('Date', '2026-10-25');
    fireEvent.click(screen.getByRole('checkbox', { name: /Riya Kapoor/ }));
    await act(async () => { fireEvent.submit(screen.getByLabelText('Title').closest('form')); });
    expect(screen.getByRole('alert').textContent).toBe('Participants must be members of this project.');
    expect(screen.getByLabelText('Title')).toBeTruthy();
  });

  it('a Contributor edits a decision and the updated details are shown (US-36)', async () => {
    const { api } = await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Use MongoDB' }));
    expect(screen.getByLabelText('Title').value).toBe('Use MongoDB');
    expect(screen.getByLabelText('Date').value).toBe('2026-10-20');
    expect(screen.getByRole('checkbox', { name: /Riya Kapoor/ }).checked).toBe(true);
    fill('Title', 'Use MongoDB Atlas');
    fill('Date', '2026-10-21');
    fireEvent.click(screen.getByRole('checkbox', { name: /Rohan Mehta/ }));
    await act(async () => { fireEvent.submit(screen.getByLabelText('Title').closest('form')); });

    expect(api.update).toHaveBeenCalledWith(P, 'd1', {
      title: 'Use MongoDB Atlas', description: 'Fields vary per task.', date: '2026-10-21', participants: ['u1', 'u2'],
    });
    const item = await screen.findByText('Use MongoDB Atlas');
    const card = item.closest('[data-testid="decision"]');
    expect(within(card).getByText(/Oct 21, 2026/)).toBeTruthy();
    expect(within(card).getByText('Riya Kapoor, Rohan Mehta')).toBeTruthy();
    expect(within(card).getByText(/Edited by Rohan Mehta/)).toBeTruthy();
  });

  it('links open the related task or thread; a deleted target is plain text', async () => {
    await renderPanel({
      rows: [
        decision('d1', { link: { type: 'task', id: 't1', label: 'Set up database', href: `/project/${P}?tab=tasks&task=t1`, missing: false } }),
        decision('d2', { title: 'From chat', link: { type: 'thread', id: 'm1', channelId: 'c1', label: '#general: Mongo or Postgres?', href: `/project/${P}?tab=chat&channel=c1&message=m1&thread=m1`, missing: false } }),
        decision('d3', { title: 'Old link', link: { type: 'task', id: 't9', label: '', href: null, missing: true } }),
      ],
    });
    expect(screen.getByRole('link', { name: /Task: Set up database/ }).getAttribute('href')).toBe(`/project/${P}?tab=tasks&task=t1`);
    expect(screen.getByRole('link', { name: /Thread: #general: Mongo or Postgres\?/ }).getAttribute('href')).toBe(`/project/${P}?tab=chat&channel=c1&message=m1&thread=m1`);
    expect(screen.getByText(/Linked task no longer exists/)).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('the thread picker lists the channel\'s messages and sends the thread link', async () => {
    const { api, chat } = await renderPanel({ rows: [] });
    fireEvent.click(screen.getByRole('button', { name: /record decision/i }));
    fill('Title', 'T'); fill('Description', 'D'); fill('Date', '2026-10-25');
    fireEvent.click(screen.getByRole('checkbox', { name: /Riya Kapoor/ }));
    fill('Related task or thread', 'thread');
    await waitFor(() => expect(chat.messages).toHaveBeenCalledWith(P, 'c1', { limit: 50 }));
    await screen.findByRole('option', { name: /Mongo or Postgres\?/ });
    fill('Thread', 'm1');
    await act(async () => { fireEvent.submit(screen.getByLabelText('Title').closest('form')); });
    expect(api.create.mock.calls[0][1].link).toEqual({ type: 'thread', id: 'm1' });
  });
});
