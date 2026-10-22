import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  project: vi.fn(),
  onProject: vi.fn(),
  stop: vi.fn(),
  liveHandler: null,
}));

vi.mock('../api', () => ({
  activityApi: {
    project: mocks.project,
  },
  liveApi: {
    onProject: mocks.onProject,
  },
}));

import ActivityPanel from './ActivityPanel';

const messageEvent = (id, summary, minute = 0) => ({
  _id: id,
  project: 'p1',
  type: 'message.posted',
  actor: { _id: 'u1', name: 'Riya Kapoor' },
  summary,
  targetType: 'message',
  targetId: `m-${id}`,
  targetLabel: '#general',
  meta: { channelId: 'c1' },
  createdAt: new Date(Date.UTC(2026, 9, 22, 10, minute)).toISOString(),
});

describe('ActivityPanel live updates (US-29)', () => {
  beforeEach(() => {
    mocks.project.mockReset();
    mocks.onProject.mockReset();
    mocks.stop.mockReset();
    mocks.liveHandler = null;

    mocks.onProject.mockImplementation(
      (projectId, eventName, handler) => {
        mocks.liveHandler = handler;
        return mocks.stop;
      }
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('loads activity and subscribes to activity:created', async () => {
    mocks.project.mockResolvedValue({
      activity: [messageEvent('a1', 'posted in #general: "Hello team"')],
      nextBefore: null,
    });

    render(<ActivityPanel projectId="p1" />);

    expect(
      await screen.findByText('New message', { selector: 'b' })
    ).toBeTruthy();

    expect(
      screen.getByText('Riya Kapoor posted in #general: "Hello team"')
    ).toBeTruthy();

    expect(mocks.onProject).toHaveBeenCalledWith(
      'p1',
      'activity:created',
      expect.any(Function)
    );
  });

  it('shows new live activity without refreshing and avoids duplicates', async () => {
    mocks.project.mockResolvedValue({
      activity: [],
      nextBefore: null,
    });

    render(<ActivityPanel projectId="p1" />);

    expect(await screen.findByText(/No activity yet/)).toBeTruthy();

    const event = messageEvent(
      'live1',
      'posted in #general: "Live message"',
      1
    );

    act(() => {
      mocks.liveHandler({
        projectId: 'p1',
        activity: event,
      });
    });

    expect(
      await screen.findByText('Riya Kapoor posted in #general: "Live message"')
    ).toBeTruthy();

    // Receiving the same event again must not create a duplicate.
    act(() => {
      mocks.liveHandler({
        projectId: 'p1',
        activity: event,
      });
    });

    expect(
      screen.getAllByText('Riya Kapoor posted in #general: "Live message"')
    ).toHaveLength(1);
  });

  it('unsubscribes from live events when the panel unmounts', async () => {
    mocks.project.mockResolvedValue({
      activity: [],
      nextBefore: null,
    });

    const { unmount } = render(<ActivityPanel projectId="p1" />);

    await screen.findByText(/No activity yet/);

    unmount();

    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it('filters loaded activity by type and keeps the filter after a refresh', async () => {
    mocks.project.mockResolvedValue({
      activity: [
        messageEvent('a1', 'posted in #general: "Hi"', 2),
        { ...messageEvent('a2', 'created task "Login page"', 1), type: 'task.created' },
      ],
      nextBefore: null,
    });

    const { rerender } = render(<ActivityPanel projectId="p1" refreshKey={0} />);
    await screen.findByText('Riya Kapoor created task "Login page"');

    fireEvent.change(screen.getByLabelText('Filter by type'), {
      target: { value: 'message.posted' },
    });

    expect(screen.getByText('Riya Kapoor posted in #general: "Hi"')).toBeTruthy();
    expect(screen.queryByText('Riya Kapoor created task "Login page"')).toBeNull();

    // A task edit bumps refreshKey; the chosen filter must stay.
    rerender(<ActivityPanel projectId="p1" refreshKey={1} />);
    await screen.findByText('Riya Kapoor posted in #general: "Hi"');
    expect(screen.getByLabelText('Filter by type').value).toBe('message.posted');
    expect(screen.queryByText('Riya Kapoor created task "Login page"')).toBeNull();
  });
});