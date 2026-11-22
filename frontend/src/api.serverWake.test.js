// [Sprint 7 · M6] api(): what happens to a request while the free Render server is asleep or restarting.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SERVER_WAKING_MESSAGE, api, restoreSession } from './api';
import { getServerState, resetServerWakeForTests, setServerWaitEnabled } from './serverWake';

const answer = (status, data = {}) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(data) });
const isHealth = (url) => String(url).endsWith('/api/health');

let fetchMock;

beforeEach(() => {
  resetServerWakeForTests();
  setServerWaitEnabled(true);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setServerWaitEnabled(false);
});

describe('api() and a sleeping server', () => {
  it('a GET that got 503 waits for /api/health, then is sent once more and succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(answer(503))
      .mockImplementationOnce((url) => Promise.resolve(isHealth(url) ? answer(200, { status: 'ok' }) : answer(500)))
      .mockResolvedValueOnce(answer(200, { projects: [{ _id: 'p1' }] }));

    await expect(api('/projects')).resolves.toEqual({ projects: [{ _id: 'p1' }] });

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toHaveLength(3);
    expect(urls[0]).toMatch(/\/api\/projects$/);
    expect(urls[1]).toMatch(/\/api\/health$/);
    expect(urls[2]).toMatch(/\/api\/projects$/);
    expect(getServerState().waking).toBe(false);
  });

  it('a GET whose connection dropped is also sent again once the server is up', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(answer(200, { status: 'ok' }))
      .mockResolvedValueOnce(answer(200, { tasks: [] }));

    await expect(api('/tasks')).resolves.toEqual({ tasks: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('a POST is never sent twice: it fails with a clear message and the banner waits for the server', async () => {
    vi.useFakeTimers(); // the health check keeps waiting in the background; it must not outlive this test
    fetchMock.mockResolvedValue(answer(503));

    await expect(api('/projects', { method: 'POST', body: JSON.stringify({ name: 'X' }) })).rejects.toMatchObject({
      message: SERVER_WAKING_MESSAGE,
      status: 503,
    });

    const posts = fetchMock.mock.calls.filter(([url, init]) => !isHealth(url) && init?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(getServerState().waking).toBe(true);
  });

  it('the session restore (POST /auth/refresh) is retried, so opening a sleeping site keeps you signed in', async () => {
    fetchMock
      .mockResolvedValueOnce(answer(504))
      .mockResolvedValueOnce(answer(200, { status: 'ok' }))
      .mockResolvedValueOnce(answer(200, { accessToken: 't', user: { id: 'u1' } }));

    await expect(restoreSession()).resolves.toEqual({ accessToken: 't', user: { id: 'u1' } });
    const refreshes = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/refresh'));
    expect(refreshes).toHaveLength(2);
  });

  it('with waiting off (no server at all), a failed GET fails at once with the original error, as before', async () => {
    setServerWaitEnabled(false);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api('/projects')).rejects.toThrow('Failed to fetch');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('normal answers are untouched (a 404 is still a 404)', async () => {
    fetchMock.mockResolvedValueOnce(answer(404, { message: 'Project not found.' }));
    await expect(api('/projects/nope')).rejects.toMatchObject({ status: 404, message: 'Project not found.' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getServerState().waking).toBe(false);
  });
});
