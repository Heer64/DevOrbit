// [Sprint 7 · M6] Cold start: when "Server is waking up…" shows, and how waiting for the server works.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GIVE_UP_MS,
  POLL_MS,
  SLOW_MS,
  STALE_MS,
  getServerState,
  isGatewayStatus,
  isNetworkError,
  resetServerWakeForTests,
  serverAnswered,
  setServerWaitEnabled,
  subscribeServerState,
  trackedFetch,
  waitForServer,
} from './serverWake';

const ok = (status = 200) => ({ ok: status < 400, status });

// A fetch that answers only when the test says so.
function slowFetch() {
  let answer;
  const fetchImpl = vi.fn(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      })
  );
  return { fetchImpl, answer: (status = 200) => answer(ok(status)) };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetServerWakeForTests();
  setServerWaitEnabled(true);
});

afterEach(() => {
  vi.useRealTimers();
  setServerWaitEnabled(false); // as src/test/setup.js has it for every other test
});

describe('helpers', () => {
  it('only 502, 503 and 504 count as "the server is not up"', () => {
    expect([502, 503, 504].every(isGatewayStatus)).toBe(true);
    expect([200, 400, 401, 404, 500].some(isGatewayStatus)).toBe(false);
  });

  it('a failed fetch (TypeError) is a network error, an aborted one is not', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    const aborted = new TypeError('aborted');
    aborted.name = 'AbortError';
    expect(isNetworkError(aborted)).toBe(false);
    expect(isNetworkError(new Error('Request failed (500).'))).toBe(false);
  });
});

describe('trackedFetch', () => {
  it('shows the banner when the first request of the page waits longer than SLOW_MS, and hides it on the answer', async () => {
    const { fetchImpl, answer } = slowFetch();
    const seen = [];
    subscribeServerState((state) => seen.push(state.waking));

    const request = trackedFetch('/api/auth/refresh', {}, { fetchImpl });
    await vi.advanceTimersByTimeAsync(SLOW_MS - 1);
    expect(getServerState().waking).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(getServerState().waking).toBe(true);
    expect(getServerState().since).toBe(Date.now());

    answer(200);
    await request;
    expect(getServerState().waking).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it('a slow request right after another answer (Copilot thinking) does not show it', async () => {
    serverAnswered();
    const { fetchImpl, answer } = slowFetch();
    const request = trackedFetch('/api/projects/p1/copilot', {}, { fetchImpl });
    await vi.advanceTimersByTimeAsync(SLOW_MS * 3);
    expect(getServerState().waking).toBe(false);
    answer(200);
    await request;
  });

  it('a slow request after STALE_MS of silence shows it again (the server may have gone to sleep)', async () => {
    serverAnswered();
    await vi.advanceTimersByTimeAsync(STALE_MS + 1);
    const { fetchImpl, answer } = slowFetch();
    const request = trackedFetch('/api/projects', {}, { fetchImpl });
    await vi.advanceTimersByTimeAsync(SLOW_MS);
    expect(getServerState().waking).toBe(true);
    answer(200);
    await request;
    expect(getServerState().waking).toBe(false);
  });

  it('a 503 from the proxy or a dropped connection shows it at once', async () => {
    await trackedFetch('/api/projects', {}, { fetchImpl: () => Promise.resolve(ok(503)) });
    expect(getServerState().waking).toBe(true);

    resetServerWakeForTests();
    await expect(trackedFetch('/api/projects', {}, { fetchImpl: () => Promise.reject(new TypeError('Failed to fetch')) })).rejects.toThrow(
      'Failed to fetch'
    );
    expect(getServerState().waking).toBe(true);
  });

  it('an ordinary error answer (401, 404, 500) means the server is up', async () => {
    const response = await trackedFetch('/api/x', {}, { fetchImpl: () => Promise.resolve(ok(401)) });
    expect(response.status).toBe(401);
    expect(getServerState().waking).toBe(false);
  });
});

describe('waitForServer', () => {
  it('polls /api/health every POLL_MS until it answers 200, then hides the banner', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(ok(503))
      .mockResolvedValueOnce(ok(200));

    const waiting = waitForServer('/api/health', { fetchImpl });
    expect(getServerState().waking).toBe(true);

    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    await expect(waiting).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/health');
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'GET', cache: 'no-store' });
    expect(getServerState().waking).toBe(false);
  });

  it('many failed requests share one wait (one health check at a time)', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(ok(200)));
    const first = waitForServer('/api/health', { fetchImpl });
    const second = waitForServer('/api/health', { fetchImpl });
    expect(second).toBe(first);
    await expect(first).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('gives up after GIVE_UP_MS and says the server is not answering; "Try again" starts over', async () => {
    const down = vi.fn(() => Promise.resolve(ok(503)));
    const waiting = waitForServer('/api/health', { fetchImpl: down });
    await vi.advanceTimersByTimeAsync(GIVE_UP_MS + POLL_MS);
    await expect(waiting).resolves.toBe(false);
    expect(getServerState()).toMatchObject({ waking: true, failed: true });

    const up = vi.fn(() => Promise.resolve(ok(200)));
    const again = waitForServer('/api/health', { fetchImpl: up });
    expect(getServerState()).toMatchObject({ waking: true, failed: false });
    await expect(again).resolves.toBe(true);
    expect(getServerState().waking).toBe(false);
  });

  it('does nothing when waiting is turned off (the unit-test setting)', async () => {
    setServerWaitEnabled(false);
    const fetchImpl = vi.fn();
    await expect(waitForServer('/api/health', { fetchImpl })).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
