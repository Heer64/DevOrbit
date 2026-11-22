// [Sprint 7 · M6] Notification popup cards.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { AtSign } from 'lucide-react';
import NotificationToasts, { MAX_TOASTS, TOAST_DURATION_MS, addToast } from './NotificationToasts';

const kinds = { mention: { label: 'Mention', icon: AtSign, tone: 'purple' } };
const note = (id, overrides = {}) => ({
  _id: id,
  type: 'mention',
  summary: 'mentioned you in #general',
  actor: { _id: 'u1', name: 'Nia Owner' },
  project: { _id: 'p1', name: 'Open Garden' },
  link: '/project/p1?tab=chat',
  read: false,
  createdAt: new Date().toISOString(),
  ...overrides,
});

const region = () => screen.getByRole('region', { name: 'New notifications' });

describe('addToast', () => {
  it('adds a notification once, newest last, keeping at most MAX_TOASTS', () => {
    let list = [];
    list = addToast(list, note('a'));
    list = addToast(list, note('a'));
    expect(list.map((n) => n._id)).toEqual(['a']);

    for (const id of ['b', 'c', 'd']) list = addToast(list, note(id));
    expect(list).toHaveLength(MAX_TOASTS);
    expect(list.map((n) => n._id)).toEqual(['b', 'c', 'd']);
    expect(addToast(list, null)).toBe(list);
  });
});

describe('NotificationToasts', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows who did what, the label and the project, in a polite live region', () => {
    render(<NotificationToasts toasts={[note('n1')]} kinds={kinds} onOpen={vi.fn()} onDismiss={vi.fn()} />);
    expect(region().getAttribute('aria-live')).toBe('polite');
    expect(within(region()).getByText('Mention')).toBeTruthy();
    expect(within(region()).getByText('Nia Owner')).toBeTruthy();
    expect(within(region()).getByText('mentioned you in #general')).toBeTruthy();
    expect(within(region()).getByText('Open Garden')).toBeTruthy();
  });

  it('is rendered into <body>, outside the component tree (the top bar would trap a fixed popup)', () => {
    const { container } = render(
      <div className="topbar">
        <NotificationToasts toasts={[note('n1')]} kinds={kinds} onOpen={vi.fn()} onDismiss={vi.fn()} />
      </div>
    );
    expect(container.querySelector('.live-toasts')).toBeNull();
    expect(region().parentElement).toBe(document.body);
  });

  it('selecting the popup opens the notification; the close button only dismisses it', () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    render(<NotificationToasts toasts={[note('n1')]} kinds={kinds} onOpen={onOpen} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: /mentioned you in #general/ }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ _id: 'n1' }));

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(onDismiss).toHaveBeenCalledWith('n1');
  });

  it('goes away by itself after the duration, but waits while the pointer is on it', () => {
    const onDismiss = vi.fn();
    render(<NotificationToasts toasts={[note('n1')]} kinds={kinds} onOpen={vi.fn()} onDismiss={onDismiss} />);
    const card = region().querySelector('.live-toast');

    fireEvent.mouseEnter(card);
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS * 2);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.mouseLeave(card);
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledWith('n1');
  });

  it('an unknown type still shows, labelled by its type', () => {
    render(
      <NotificationToasts
        toasts={[note('n9', { type: 'something_new', actor: null, project: null, summary: 'Hello' })]}
        kinds={kinds}
        onOpen={vi.fn()}
        onDismiss={vi.fn()}
      />
    );
    expect(within(region()).getByText('something_new')).toBeTruthy();
    expect(within(region()).getByText('Hello')).toBeTruthy();
  });
});
