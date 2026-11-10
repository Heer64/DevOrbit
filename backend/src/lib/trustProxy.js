/*
 * [Sprint 6 · M1] D1 fix: Express "trust proxy" from the TRUST_PROXY environment variable.
 *
 * Sprint 4 exit checks (defect D1): behind a proxy (Render, or smee forwarding GitHub deliveries),
 * requests carry an X-Forwarded-For header. Without "trust proxy", Express uses the proxy's address
 * as req.ip, so every user shares ONE rate-limit bucket, and express-rate-limit logs
 * ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
 *
 *   TRUST_PROXY            Express gets         Use it for
 *   (not set) / false / 0  false                local development, nothing in front of the API (default)
 *   1, 2, ... 10           that number of hops  deployed API: Render = 1 (one proxy in front)
 *   loopback               ['loopback']         local testing with smee-client / ngrok on the same machine
 *   10.0.0.0/8, 127.0.0.1  list of IPs/subnets  a proxy with known addresses
 *
 * "true" is refused on purpose: it trusts every X-Forwarded-For value, so any client could pick its
 * own IP and dodge the rate limits (express-rate-limit also rejects it: ERR_ERL_PERMISSIVE_TRUST_PROXY).
 * Anything that is not understood falls back to false (the safe default) with a warning.
 *
 * Pure function: no Express, no environment reads, so it is unit tested directly
 * (backend/test/trustProxy.test.js).
 */
import net from 'node:net';

export const MAX_PROXY_HOPS = 10;
const NAMED_RANGES = ['loopback', 'linklocal', 'uniquelocal'];
const OFF = ['', 'false', '0', 'off', 'no'];

function validAddress(entry) {
  if (NAMED_RANGES.includes(entry)) return true;
  const [address, bits, extra] = entry.split('/');
  if (extra !== undefined) return false;
  const version = net.isIP(address);
  if (!version) return false;
  if (bits === undefined) return true;
  if (!/^\d{1,3}$/.test(bits)) return false;
  return Number(bits) <= (version === 4 ? 32 : 128);
}

/**
 * trustProxySetting(raw) -> { value, warning }
 *   value    what to pass to app.set('trust proxy', value)
 *   warning  '' when the setting was understood, otherwise a message for the server log
 */
export function trustProxySetting(raw) {
  const text = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (OFF.includes(text)) return { value: false, warning: '' };

  if (text === 'true') {
    return {
      value: false,
      warning: 'TRUST_PROXY=true is not allowed (any client could fake its IP). Use the number of proxies, e.g. TRUST_PROXY=1. Falling back to false.',
    };
  }

  if (/^\d+$/.test(text)) {
    const hops = Number(text);
    if (hops >= 1 && hops <= MAX_PROXY_HOPS) return { value: hops, warning: '' };
    return {
      value: false,
      warning: `TRUST_PROXY must be between 1 and ${MAX_PROXY_HOPS} proxy hops. Falling back to false.`,
    };
  }

  const entries = text.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (entries.length > 0 && entries.every(validAddress)) return { value: entries, warning: '' };

  return {
    value: false,
    warning: 'TRUST_PROXY is not a number of hops, "loopback", or a list of IP addresses/subnets. Falling back to false.',
  };
}
