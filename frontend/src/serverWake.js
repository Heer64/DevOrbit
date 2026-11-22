/*
 * [Sprint 7 · M6] Cold start: "Server is waking up…" (NFR-17).
 *
 * The API runs on Render's free plan, which puts the server to sleep after about 15 minutes without
 * visitors. The first request after that waits 30–60 seconds while it starts again, and during a
 * restart (sleep, deploy) the proxy can also answer 502 / 503 / 504 or drop the connection.
 *
 * This module watches every API request (api.js sends them through trackedFetch) and keeps one small
 * shared state that the ServerWakeBanner shows:
 *   { waking: false }                       normal
 *   { waking: true, since, failed: false }  a request has waited over SLOW_MS while the server may be
 *                                           asleep, or the server could not be reached; we poll /api/health
 *   { waking: true, since, failed: true }   still no answer after GIVE_UP_MS (offline, or a real outage)
 *
 * "May be asleep" means: nothing has answered on this page yet, or the last answer is older than
 * STALE_MS. So a slow request in the middle of a session (the Copilot thinking for 8 s, say) never
 * shows the banner, but the first request of the day does.
 *
 * waitForServer() is what api.js uses after a network error or 502/503/504: it polls /api/health
 * until the server answers, so a safe request (GET) can then be sent once more.
 */

export const SLOW_MS = 3000;
export const STALE_MS = 10 * 60_000;
export const POLL_MS = 3000;
export const HEALTH_TIMEOUT_MS = 10_000;
export const GIVE_UP_MS = 120_000;

const GATEWAY_STATUSES = new Set([502, 503, 504]);

const IDLE = Object.freeze({ waking: false, since: null, failed: false });

let state = IDLE;
let lastAnswerAt = 0;
let waitInFlight = null;
let waitingEnabled = true;
const listeners = new Set();

function setState(next) {
  if (next.waking === state.waking && next.failed === state.failed && next.since === state.since) return;
  state = Object.freeze({ ...next });
  listeners.forEach((listener) => listener(state));
}

export function getServerState() {
  return state;
}

// Calls listener(state) after every change. Returns a function that stops listening.
export function subscribeServerState(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// A status the proxy sends while the server itself is not up (asleep, starting, restarting).
export function isGatewayStatus(status) {
  return GATEWAY_STATUSES.has(Number(status));
}

// fetch() rejects with a TypeError when nothing answered at all (no network, connection dropped).
// An AbortError is the page cancelling its own request, not the server.
export function isNetworkError(error) {
  return Boolean(error) && error.name !== 'AbortError' && error instanceof TypeError;
}

function mightBeAsleep(now = Date.now()) {
  return lastAnswerAt === 0 || now - lastAnswerAt > STALE_MS;
}

function startWaking(now = Date.now()) {
  if (!state.waking) setState({ waking: true, since: now, failed: false });
}

// The server answered (any status except the gateway ones): it is awake.
export function serverAnswered(now = Date.now()) {
  lastAnswerAt = now;
  if (state.waking && !waitInFlight) setState(IDLE);
}

/*
 * fetch() that also feeds the waking state. Same arguments and result as fetch.
 * If the request is still open after SLOW_MS while the server may be asleep, the banner appears;
 * it goes away as soon as any request (this one or the health check) gets an answer.
 */
export async function trackedFetch(url, init, { fetchImpl = globalThis.fetch } = {}) {
  const startedAt = Date.now();
  const slowTimer = setTimeout(() => {
    if (mightBeAsleep(startedAt)) startWaking();
  }, SLOW_MS);

  try {
    const response = await fetchImpl(url, init);
    if (isGatewayStatus(response.status)) startWaking();
    else serverAnswered();
    return response;
  } catch (error) {
    if (isNetworkError(error)) startWaking();
    throw error;
  } finally {
    clearTimeout(slowTimer);
  }
}

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function healthAnswers(healthUrl, fetchImpl) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS) : null;
  try {
    const response = await fetchImpl(healthUrl, {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/*
 * Polls GET /api/health every POLL_MS until the server answers 200. Resolves true when it is up, or
 * false after GIVE_UP_MS (the banner then says the server is not answering and offers "Try again").
 * Calls made while one is already running share it, so many failed requests poll only once.
 */
export function waitForServer(healthUrl, { fetchImpl = globalThis.fetch } = {}) {
  if (!waitingEnabled) return Promise.resolve(false);
  if (waitInFlight) return waitInFlight;

  const startedAt = Date.now();
  if (state.failed) setState({ waking: true, since: startedAt, failed: false });
  else startWaking(startedAt);

  waitInFlight = (async () => {
    while (Date.now() - startedAt < GIVE_UP_MS) {
      if (await healthAnswers(healthUrl, fetchImpl)) {
        lastAnswerAt = Date.now();
        return true;
      }
      await sleep(POLL_MS);
    }
    return false;
  })().then((awake) => {
    waitInFlight = null;
    if (awake) setState(IDLE);
    else setState({ waking: true, since: state.since || startedAt, failed: true });
    return awake;
  });

  return waitInFlight;
}

/*
 * Turns the waiting off or on. The unit tests have no API server, so src/test/setup.js turns it off: a request
 * that cannot reach the server then fails at once, exactly as before Sprint 7 · M6 (serverWake.test.js turns it
 * back on to test it).
 */
export function setServerWaitEnabled(enabled) {
  waitingEnabled = Boolean(enabled);
}

// Tests only: forget everything, as on a fresh page load.
export function resetServerWakeForTests() {
  state = IDLE;
  lastAnswerAt = 0;
  waitInFlight = null;
  listeners.clear();
}
