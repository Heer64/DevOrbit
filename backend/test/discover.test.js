// Sprint 2 leftovers: the endpoints the Discover page now uses.
// GET /api/projects/discover?q=  (Public projects only)
// GET /api/profile/people?q=     (discoverable people only, never yourself)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, signup, authed } from './helpers.js';

let app;
let alice, bob, hidden;

const as = (account) => authed(app, account.token);
const names = (list) => list.map((item) => item.name);

before(async () => {
  ({ app } = await setup());

  [alice, bob, hidden] = await Promise.all(
    ['Alice Builder', 'Bob Reactdev', 'Hana Hidden'].map((name) => signup(app, name))
  );

  for (const body of [
    { name: 'Open Garden', description: 'Community gardening app', domain: 'Community', visibility: 'Public' },
    { name: 'React Toolkit', description: 'Shared UI pieces', domain: 'Developer tools', visibility: 'Public' },
    { name: 'Secret Lab', description: 'Not for discovery', domain: 'Research', visibility: 'Private' },
  ]) {
    const res = await as(alice).post('/api/projects').send(body);
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }

  const skills = await as(bob).patch('/api/profile/me').send({ headline: 'Frontend developer', skills: ['React', 'CSS'] });
  assert.equal(skills.status, 200, JSON.stringify(skills.body));

  const optOut = await as(hidden).patch('/api/profile/me').send({ profileDiscoverable: false });
  assert.equal(optOut.status, 200, JSON.stringify(optOut.body));
});

after(teardown);

test('discover lists public projects only, with a member count and no member details', async () => {
  const res = await as(bob).get('/api/projects/discover');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(names(res.body.projects).includes('Open Garden'));
  assert.ok(names(res.body.projects).includes('React Toolkit'));
  assert.ok(!names(res.body.projects).includes('Secret Lab'), 'private projects are never listed');

  const garden = res.body.projects.find((project) => project.name === 'Open Garden');
  assert.equal(garden.members.length, 1);
  assert.deepEqual(garden.members[0], {}, 'member identities are not exposed');
});

test('discover searches name, description and domain', async () => {
  assert.deepEqual(names((await as(bob).get('/api/projects/discover?q=garden')).body.projects), ['Open Garden']);
  assert.deepEqual(names((await as(bob).get('/api/projects/discover?q=developer%20tools')).body.projects), ['React Toolkit']);
  assert.deepEqual(names((await as(bob).get('/api/projects/discover?q=secret')).body.projects), []);
});

test('people search respects profileDiscoverable and never returns yourself', async () => {
  const res = await as(alice).get('/api/profile/people');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(names(res.body.people).includes('Bob Reactdev'));
  assert.ok(!names(res.body.people).includes('Hana Hidden'), 'people who opted out are hidden');
  assert.ok(!names(res.body.people).includes('Alice Builder'), 'you are not listed to yourself');

  const bobRow = res.body.people.find((person) => person.name === 'Bob Reactdev');
  assert.equal(bobRow.role, 'Frontend developer');
  assert.deepEqual(bobRow.skills, ['React', 'CSS']);
});

test('people search matches skills', async () => {
  assert.deepEqual(names((await as(alice).get('/api/profile/people?q=css')).body.people), ['Bob Reactdev']);
  assert.deepEqual(names((await as(alice).get('/api/profile/people?q=hana')).body.people), []);
});
