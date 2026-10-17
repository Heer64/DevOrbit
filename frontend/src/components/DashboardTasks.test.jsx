// Sprint 2 leftovers: dashboard task widgets (Upcoming deadlines, My tasks) and due-date labels.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';

const myTaskApi = vi.hoisted(() => ({ upcoming: vi.fn(), mine: vi.fn(), stats: vi.fn() }));
vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), myTaskApi }));

import { MyTasks, UpcomingDeadlines, dueLabel } from './DashboardTasks';

const realUser = { id: 'u1', name: 'Riya Kapoor', isDemo: false };
const demoUser = { id: 'demo-user', name: 'Aarav Mehta', isDemo: true };
const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(offset) {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) + offset * DAY_MS).toISOString();
}

const task = (id, title, offset, project = { _id: 'p1', name: 'Alpha', color: 'violet' }) => ({
  _id: id, title, status: 'To do', dueDate: offset === null ? null : utcDay(offset), project,
});

function ProjectProbe() {
  const { id } = useParams();
  return <p>Project page {id}</p>;
}

function renderWithRouter(ui) {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/dashboard" element={ui} />
        <Route path="/project/:id" element={<ProjectProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  myTaskApi.upcoming.mockReset();
  myTaskApi.mine.mockReset();
  myTaskApi.stats.mockReset();
});

describe('dueLabel', () => {
  const now = new Date();
  it('describes today, tomorrow and the next few days', () => {
    expect(dueLabel(utcDay(0), now)).toBe('Due today');
    expect(dueLabel(utcDay(1), now)).toBe('Due tomorrow');
    expect(dueLabel(utcDay(4), now)).toBe('Due in 4 days');
    expect(dueLabel(utcDay(10), now)).toMatch(/^Due [A-Z][a-z]{2} \d{1,2}$/);
  });

  it('marks past dates as overdue and handles missing dates', () => {
    expect(dueLabel(utcDay(-1), now)).toMatch(/^Overdue · /);
    expect(dueLabel(null, now)).toBe('No due date');
    expect(dueLabel('not a date', now)).toBe('No due date');
  });
});

describe('Upcoming deadlines (US-23)', () => {
  it('loads the next 7 days of open tasks and shows project and due date', async () => {
    myTaskApi.upcoming.mockResolvedValue({ tasks: [task('t1', 'Ship login page', 0), task('t2', 'Write docs', 3)], days: 7 });
    renderWithRouter(<UpcomingDeadlines user={realUser} />);

    expect(screen.getByText('Loading tasks…')).toBeTruthy();
    const row = (await screen.findByText('Ship login page')).closest('button');
    expect(within(row).getByText('Due today')).toBeTruthy();
    expect(within(row).getByText(/Alpha/)).toBeTruthy();
    expect(screen.getByText('Due in 3 days')).toBeTruthy();
    expect(myTaskApi.upcoming).toHaveBeenCalledWith(7, 6);
  });

  it('opens the task\'s project when a row is clicked', async () => {
    myTaskApi.upcoming.mockResolvedValue({ tasks: [task('t1', 'Ship login page', 1, { _id: 'proj42', name: 'Beta', color: 'blue' })] });
    renderWithRouter(<UpcomingDeadlines user={realUser} />);

    fireEvent.click(await screen.findByRole('button', { name: /Open Ship login page in Beta/ }));
    expect(screen.getByText('Project page proj42')).toBeTruthy();
  });

  it('shows an empty state when nothing is due', async () => {
    myTaskApi.upcoming.mockResolvedValue({ tasks: [], days: 7 });
    renderWithRouter(<UpcomingDeadlines user={realUser} />);
    expect(await screen.findByText('Nothing due in the next 7 days.')).toBeTruthy();
  });

  it('shows the error from the API', async () => {
    myTaskApi.upcoming.mockRejectedValue(new Error('Could not reach the server.'));
    renderWithRouter(<UpcomingDeadlines user={realUser} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Could not reach the server.');
  });

  it('reloads when projects change elsewhere', async () => {
    myTaskApi.upcoming.mockResolvedValue({ tasks: [] });
    renderWithRouter(<UpcomingDeadlines user={realUser} />);
    await waitFor(() => expect(myTaskApi.upcoming).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event('devorbit:projects-updated'));
    await waitFor(() => expect(myTaskApi.upcoming).toHaveBeenCalledTimes(2));
  });

  it('demo users see the sample tasks and the API is not called', () => {
    renderWithRouter(<UpcomingDeadlines user={demoUser} demoTasks={[task('d1', 'Sample deadline', 2)]} />);
    expect(screen.getByText('Sample deadline')).toBeTruthy();
    expect(myTaskApi.upcoming).not.toHaveBeenCalled();
  });
});

describe('My tasks', () => {
  it('lists my open tasks and says how many more there are', async () => {
    myTaskApi.mine.mockResolvedValue({ tasks: [task('m1', 'Fix navbar', 2), task('m2', 'Review PR', null)], total: 5 });
    renderWithRouter(<MyTasks user={realUser} />);

    expect(await screen.findByText('Fix navbar')).toBeTruthy();
    expect(screen.getByText('No due date')).toBeTruthy();
    expect(screen.getByText('+3 more open tasks assigned to you.')).toBeTruthy();
    expect(myTaskApi.mine).toHaveBeenCalledWith(6);
  });

  it('shows an empty state when nothing is assigned to me', async () => {
    myTaskApi.mine.mockResolvedValue({ tasks: [], total: 0 });
    renderWithRouter(<MyTasks user={realUser} />);
    expect(await screen.findByText('No open tasks assigned to you.')).toBeTruthy();
  });
});
