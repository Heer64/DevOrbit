// [Sprint 1 · gaps] Create-project rules: agreed domain list and starting members (no database).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DOMAIN,
  MAX_STARTING_MEMBERS,
  PROJECT_DOMAINS,
  domainTags,
  matchStartingMembers,
  readDomain,
  readStartingMembers,
  startingMemberLookup,
} from '../src/lib/projectSetup.js';

test('the agreed domain list is the one the create form shows', () => {
  assert.deepEqual(PROJECT_DOMAINS, [
    'Developer tools',
    'Education',
    'Climate tech',
    'Research',
    'Design systems',
    'Backend',
    'Community',
    'Other',
  ]);
});

test('domains: listed values pass in their listed spelling, anything else is refused', () => {
  assert.deepEqual(readDomain('Education'), { ok: true, value: 'Education' });
  assert.deepEqual(readDomain('  climate   TECH '), { ok: true, value: 'Climate tech' });
  assert.deepEqual(readDomain(undefined), { ok: true, value: DEFAULT_DOMAIN });
  assert.deepEqual(readDomain(''), { ok: true, value: DEFAULT_DOMAIN });
  for (const bad of ['General', 'Blockchain', 'Education!', 42, ['Education'], { domain: 'Education' }]) {
    assert.equal(readDomain(bad).ok, false, String(bad));
  }
  assert.equal(readDomain('', { required: true }).ok, false);
  assert.match(readDomain('Nope').message, /Developer tools, Education/);
});

test('tags start with the domain, except the catch-all ones', () => {
  assert.deepEqual(domainTags('Research'), ['Research']);
  assert.deepEqual(domainTags('Other'), []);
  assert.deepEqual(domainTags('General'), []);
});

test('starting members: optional, cleaned, default role Contributor', () => {
  assert.deepEqual(readStartingMembers(undefined), { ok: true, members: [] });
  assert.deepEqual(readStartingMembers([]), { ok: true, members: [] });
  assert.deepEqual(readStartingMembers([{ identifier: ' @Riya ' }, { identifier: 'Jai@Example.com', role: 'Viewer' }]), {
    ok: true,
    members: [
      { identifier: 'riya', role: 'Contributor' },
      { identifier: 'jai@example.com', role: 'Viewer' },
    ],
  });
});

test('starting members: bad lists are refused as a whole', () => {
  assert.equal(readStartingMembers('riya').ok, false);
  assert.equal(readStartingMembers([{ identifier: '' }]).ok, false);
  assert.equal(readStartingMembers(['riya']).ok, false);
  assert.match(readStartingMembers([{ identifier: 'riya', role: 'Owner' }]).message, /one Owner/);
  assert.equal(readStartingMembers([{ identifier: 'riya', role: 'Boss' }]).ok, false);
  assert.match(readStartingMembers([{ identifier: 'riya' }, { identifier: '@RIYA' }]).message, /more than once/);
  const tooMany = Array.from({ length: MAX_STARTING_MEMBERS + 1 }, (_, i) => ({ identifier: `user${i}` }));
  assert.equal(readStartingMembers(tooMany).ok, false);
});

test('one lookup finds people by email and by username', () => {
  assert.deepEqual(startingMemberLookup([{ identifier: 'a@x.com' }, { identifier: 'bob' }]), {
    $or: [{ email: { $in: ['a@x.com'] } }, { username: { $in: ['bob'] } }],
  });
  assert.equal(startingMemberLookup([]), null);
});

test('matching: unknown people, the creator and the same person twice are refused', () => {
  const riya = { _id: 'r1', name: 'Riya', username: 'riya', email: 'riya@x.com' };
  const me = { _id: 'me', name: 'Me', username: 'me', email: 'me@x.com' };
  const ok = matchStartingMembers([{ identifier: 'riya', role: 'Admin' }], [riya], 'me');
  assert.deepEqual(ok, { ok: true, resolved: [{ user: riya, role: 'Admin' }] });

  const unknown = matchStartingMembers(
    [
      { identifier: 'ghost', role: 'Viewer' },
      { identifier: 'riya', role: 'Admin' },
    ],
    [riya],
    'me'
  );
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.unknown, ['ghost']);

  assert.equal(matchStartingMembers([{ identifier: 'me', role: 'Admin' }], [me], 'me').status, 400);
  const twice = matchStartingMembers(
    [
      { identifier: 'riya', role: 'Admin' },
      { identifier: 'riya@x.com', role: 'Viewer' },
    ],
    [riya],
    'me'
  );
  assert.equal(twice.ok, false);
  assert.match(twice.message, /more than once/);
});
