// [Sprint 7 · M6] Live delivery fix: a socket the server refuses (expired access token) gets a fresh token first,
// and pages hear when the connection comes back so they can load what they missed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A stand-in for the Socket.IO client: records listeners and lets the test fire events.
const fake = vi.hoisted(() => ({ sockets: [] }));
vi.mock('socket.io-client', () => ({
  io: vi.fn((origin, options) => {
    const handlers = new Map();
    const socket = {
      origin,
      options,
      active: false,
      connected: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      emit: vi.fn(),
      on: (event, handler) => {
        handlers.set(event, [...(handlers.get(event) || []), handler]);
        return socket;
      },
      off: (event, handler) => {
        handlers.set(
          event,
          (handlers.get(event) || []).filter((h) => h !== handler)
        );
        return socket;
      },
      fire: (event, payload) => (handlers.get(event) || []).forEach((handler) => handler(payload)),
    };
    fake.sockets.push(socket);
    return socket;
  }),
}));

import { disconnectRealtime, refusedRetryDelay, subscribeToReconnect, subscribeToUserEvent } from './realtime';

// Lets the retry's `await refreshToken()` finish after its timer fired.
const settle = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

function config(overrides = {}) {
  return { origin: 'https://api.example', getToken: () => 'token-1', refreshToken: vi.fn(() => Promise.resolve('token-2')), ...overrides };
}

beforeEach(() => {
  vi.useFakeTimers();
  fake.sockets.length = 0;
});

afterEach(() => {
  disconnectRealtime();
  vi.useRealTimers();
});

describe('refusedRetryDelay', () => {
  it('retries the first refusal at once, then backs off 5 s, 10 s, 20 s … up to 60 s', () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(refusedRetryDelay)).toEqual([0, 5000, 10000, 20000, 40000, 60000, 60000]);
  });
});

describe('a refused handshake (the access token ran out while the socket was away)', () => {
  it('refreshes the token first, then reconnects', async () => {
    const cfg = config();
    subscribeToUserEvent(cfg, 'notification:created', () => {});
    const socket = fake.sockets[0];

    socket.fire('connect_error', new Error('Authentication required.'));
    expect(cfg.refreshToken).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(0);
    await settle();
    expect(cfg.refreshToken).toHaveBeenCalledTimes(1);
    expect(socket.connect).toHaveBeenCalledTimes(1);
  });

  it('keeps trying with a growing pause while the server refuses, and starts over after a connect', async () => {
    const cfg = config({ refreshToken: vi.fn(() => Promise.reject(new Error('signed out'))) });
    subscribeToUserEvent(cfg, 'notification:created', () => {});
    const socket = fake.sockets[0];

    socket.fire('connect_error', new Error('Authentication required.'));
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    expect(socket.connect).toHaveBeenCalledTimes(1);

    socket.fire('connect_error', new Error('Authentication required.'));
    await vi.advanceTimersByTimeAsync(4999);
    expect(socket.connect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(socket.connect).toHaveBeenCalledTimes(2);

    socket.fire('connect');
    socket.fire('connect_error', new Error('Authentication required.'));
    await vi.advanceTimersByTimeAsync(0);
    await settle();
    expect(socket.connect).toHaveBeenCalledTimes(3); // back to "at once"
  });

  it('leaves network problems to Socket.IO itself (socket.active)', async () => {
    const cfg = config();
    subscribeToUserEvent(cfg, 'notification:created', () => {});
    const socket = fake.sockets[0];
    socket.active = true;

    socket.fire('connect_error', new Error('xhr poll error'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(cfg.refreshToken).not.toHaveBeenCalled();
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it('sends whatever token is current at each (re)connect', () => {
    let token = 'old';
    subscribeToUserEvent(config({ getToken: () => token }), 'notification:created', () => {});
    const { auth } = fake.sockets[0].options;
    const sent = [];
    auth((value) => sent.push(value.token));
    token = 'fresh';
    auth((value) => sent.push(value.token));
    expect(sent).toEqual(['old', 'fresh']);
  });
});

describe('subscribeToReconnect', () => {
  it('calls the handler when the connection comes back, not on the first connect', () => {
    const handler = vi.fn();
    const stop = subscribeToReconnect(config(), handler);
    const socket = fake.sockets[0];

    socket.fire('connect');
    expect(handler).not.toHaveBeenCalled();

    socket.fire('disconnect', 'transport close');
    socket.fire('connect');
    expect(handler).toHaveBeenCalledTimes(1);

    stop();
    socket.fire('connect');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('shares one socket with the other subscriptions', () => {
    subscribeToUserEvent(config(), 'notification:created', () => {});
    subscribeToReconnect(config(), () => {});
    expect(fake.sockets).toHaveLength(1);
  });

  it('logging out forgets the handlers (the next user starts clean)', () => {
    const handler = vi.fn();
    subscribeToReconnect(config(), handler);
    fake.sockets[0].fire('connect');
    disconnectRealtime();

    subscribeToUserEvent(config(), 'notification:created', () => {});
    fake.sockets[1].fire('connect');
    fake.sockets[1].fire('connect');
    expect(handler).not.toHaveBeenCalled();
  });
});
