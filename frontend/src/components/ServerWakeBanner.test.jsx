// [Sprint 7 · M6] "Server is waking up…" banner (cold start on Render's free plan).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ServerWakeBanner, { waitedLabel } from './ServerWakeBanner';

// A tiny stand-in for serverWake.js's state, driven by the test.
function fakeStore(initial = { waking: false, since: null, failed: false }) {
  let state = initial;
  const listeners = new Set();
  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) =>
      act(() => {
        state = next;
        listeners.forEach((listener) => listener(state));
      }),
  };
}

const renderBanner = (store, wake = { waitForServer: vi.fn() }) => {
  render(<ServerWakeBanner subscribe={store.subscribe} getState={store.getState} wake={wake} />);
  return wake;
};

describe('waitedLabel', () => {
  it('shows seconds, then minutes and seconds', () => {
    expect(waitedLabel(0)).toBe('');
    expect(waitedLabel(12)).toBe('12s');
    expect(waitedLabel(75)).toBe('1m 15s');
  });
});

describe('ServerWakeBanner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows nothing while the server is awake', () => {
    renderBanner(fakeStore());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says the server is waking up, counts the seconds and goes away when it answers', () => {
    const store = fakeStore();
    renderBanner(store);

    store.set({ waking: true, since: Date.now(), failed: false });
    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain('Server is waking up…');
    expect(banner.textContent).toContain('This can take up to a minute.');
    expect(banner.parentElement).toBe(document.body);

    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(screen.getByRole('status').textContent).toContain('7s');

    store.set({ waking: false, since: null, failed: false });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('after giving up it says the server is not answering, and "Try again" waits again', () => {
    const store = fakeStore({ waking: true, since: Date.now(), failed: true });
    const wake = renderBanner(store);

    expect(screen.getByRole('status').textContent).toContain('The server is not answering');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(wake.waitForServer).toHaveBeenCalledTimes(1);
  });
});
