/*
 * [Sprint 7 · M8] D5 fix (Sprint 4 re-test, Urvish): a forwarded IP address with a port.
 *
 * Some proxies (smee.io forwarding GitHub deliveries, some load balancers) put the client's port in
 * X-Forwarded-For: "140.82.115.16:15734". With "trust proxy" on (D1 fix, lib/trustProxy.js) Express
 * copies that into req.ip, port included. express-rate-limit keys on req.ip by default, so:
 *   - it logged ERR_ERL_INVALID_IP_ADDRESS, and
 *   - every request came from a "different" address (new port each time) and got its own bucket,
 *     so the limit was never reached for that traffic.
 *
 * rateLimitKey(req) is the keyGenerator every IP-based limiter uses now (app.js, routes/githubWebhook.js,
 * routes/passwordReset.js): the client address without the port, so one client = one bucket again.
 *
 *   "203.0.113.5"            -> "203.0.113.5"
 *   "203.0.113.5:4321"       -> "203.0.113.5"
 *   "[2001:db8::1]:4321"     -> "2001:db8::1"
 *   "2001:db8::1"            -> "2001:db8::1"      (plain IPv6 is never cut at a colon)
 *   "::ffff:203.0.113.5"     -> "203.0.113.5"      (IPv4 written as IPv6 counts as the same client)
 *   missing                  -> the socket address, else "unknown"
 *
 * The D1 protection stays where it was: lib/trustProxy.js refuses TRUST_PROXY=true, so a client can
 * still not choose its own address. A custom keyGenerator skips express-rate-limit's own IP checks
 * (they only log), so the one that found D1 is kept here: one warning when X-Forwarded-For arrives
 * while trust proxy is off (all users would share the proxy's bucket).
 *
 * No database, no environment reads except NODE_ENV for the warning: unit tested in
 * backend/test/rateLimitKey.test.js.
 */
import net from 'node:net';

const IPV4_WITH_PORT = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/;
const BRACKETED_IPV6 = /^\[([^\]]+)\](?::\d{1,5})?$/;
const MAPPED_IPV4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

export const UNKNOWN_CLIENT_KEY = 'unknown';
export const FORWARDED_WITHOUT_TRUST_PROXY_WARNING =
  'X-Forwarded-For was received but TRUST_PROXY is not set, so rate limits count the proxy instead of each client. Set TRUST_PROXY (Render: 1). See lib/trustProxy.js.';

// The address on its own: no port, no brackets, IPv4-mapped IPv6 as plain IPv4. '' when there is nothing.
export function clientAddress(raw) {
  let value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return '';
  const v4 = IPV4_WITH_PORT.exec(value);
  if (v4) value = v4[1];
  const v6 = BRACKETED_IPV6.exec(value);
  if (v6) value = v6[1];
  const mapped = MAPPED_IPV4.exec(value);
  if (mapped) value = mapped[1];
  return value.toLowerCase();
}

let warnedForwardedWithoutTrust = false;
// Tests reset the one-time warning.
export function resetRateLimitKeyWarnings() {
  warnedForwardedWithoutTrust = false;
}

function warnIfForwardedWithoutTrust(req) {
  if (!req || warnedForwardedWithoutTrust || process.env.NODE_ENV === 'test') return;
  const forwarded = typeof req.get === 'function' ? req.get('x-forwarded-for') : req.headers?.['x-forwarded-for'];
  const trust = typeof req.app?.get === 'function' ? req.app.get('trust proxy') : undefined;
  if (forwarded && (trust === false || trust === undefined)) {
    warnedForwardedWithoutTrust = true;
    console.warn(FORWARDED_WITHOUT_TRUST_PROXY_WARNING);
  }
}

// keyGenerator for express-rate-limit: one bucket per client address, whatever port it came from.
export function rateLimitKey(req) {
  warnIfForwardedWithoutTrust(req);
  const address = clientAddress(req?.ip) || clientAddress(req?.socket?.remoteAddress);
  if (!address) return UNKNOWN_CLIENT_KEY;
  // Something that is still not an IP (a proxy sending a name) is used as it is, so it still limits.
  return net.isIP(address) ? address : address.slice(0, 100);
}
