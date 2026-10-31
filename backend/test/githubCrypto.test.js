// [Sprint 4 · M1] US-31 / NFR-4: token encryption and OAuth helpers. No database needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decryptToken, encryptToken, tokenKey } from '../src/lib/githubCrypto.js';
import { authorizeUrl, githubConfig, hashState, looksLikeState, missingGithubSettings, newState, sameState } from '../src/lib/githubOAuth.js';

const KEY = Buffer.alloc(32, 9);
const TOKEN = 'gho_example_token_value';

test('encryptToken/decryptToken round-trip and never store the plain token', () => {
  const stored = encryptToken(TOKEN, KEY);
  assert.ok(stored.startsWith('v1.'));
  assert.equal(stored.includes(TOKEN), false);
  assert.equal(decryptToken(stored, KEY), TOKEN);
});

test('each encryption uses a fresh IV', () => {
  assert.notEqual(encryptToken(TOKEN, KEY), encryptToken(TOKEN, KEY));
});

test('a changed ciphertext or the wrong key fails instead of returning garbage', () => {
  const stored = encryptToken(TOKEN, KEY);
  const parts = stored.split('.');
  const flipped = Buffer.from(parts[3], 'base64url');
  flipped[0] ^= 1;
  parts[3] = flipped.toString('base64url');
  assert.throws(() => decryptToken(parts.join('.'), KEY));
  assert.throws(() => decryptToken(stored, Buffer.alloc(32, 1)));
  assert.throws(() => decryptToken('plain-text', KEY));
});

test('tokenKey accepts exactly 64 hex characters', () => {
  assert.equal(tokenKey({ GITHUB_TOKEN_KEY: 'ab'.repeat(32) }).length, 32);
  assert.equal(tokenKey({ GITHUB_TOKEN_KEY: 'ab'.repeat(31) }), null);
  assert.equal(tokenKey({ GITHUB_TOKEN_KEY: 'zz'.repeat(32) }), null);
  assert.equal(tokenKey({}), null);
  assert.throws(() => encryptToken(TOKEN, null));
});

test('githubConfig needs all four settings and an https (or localhost) callback', () => {
  const env = {
    GITHUB_CLIENT_ID: 'id',
    GITHUB_CLIENT_SECRET: 'secret',
    GITHUB_CALLBACK_URL: 'http://localhost:5000/api/github/callback',
    GITHUB_TOKEN_KEY: 'c'.repeat(64),
  };
  assert.equal(githubConfig(env).configured, true);
  assert.equal(githubConfig({ ...env, GITHUB_CALLBACK_URL: 'https://api.example.com/api/github/callback' }).configured, true);
  assert.equal(githubConfig({ ...env, GITHUB_CALLBACK_URL: 'http://api.example.com/api/github/callback' }).configured, false);
  assert.equal(githubConfig({ ...env, GITHUB_CLIENT_SECRET: '' }).configured, false);
  assert.equal(githubConfig({ ...env, GITHUB_TOKEN_KEY: 'short' }).configured, false);
  assert.deepEqual(missingGithubSettings(env), []);
  const missing = missingGithubSettings({});
  assert.equal(missing.length, 4);
  assert.equal(missing.join(' ').includes('secret'), false, 'names only');
});

test('state helpers: random, hashed, compared in constant time', () => {
  const a = newState();
  const b = newState();
  assert.ok(looksLikeState(a));
  assert.notEqual(a, b);
  assert.equal(hashState(a).length, 64);
  assert.notEqual(hashState(a), a);
  assert.equal(sameState(a, a), true);
  assert.equal(sameState(a, b), false);
  assert.equal(sameState(a, null), false);
  assert.equal(sameState('short', 'short'), false);
});

test('authorizeUrl sends client_id, the fixed callback, scope and state, but never the secret', () => {
  const config = { clientId: 'cid', clientSecret: 'shh', callbackUrl: 'http://localhost:5000/api/github/callback' };
  const url = new URL(authorizeUrl('S'.repeat(43), config));
  assert.equal(url.hostname, 'github.com');
  assert.equal(url.searchParams.get('client_id'), 'cid');
  assert.equal(url.searchParams.get('redirect_uri'), config.callbackUrl);
  assert.equal(url.searchParams.get('scope'), 'repo');
  assert.equal(url.searchParams.get('state'), 'S'.repeat(43));
  assert.equal(url.toString().includes('shh'), false);
});
