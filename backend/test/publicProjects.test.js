// [Sprint 5 · M1] US-45 Browse and filter public projects — as a Visitor (no login).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import Project from '../src/models/Project.js';
import { PROJECT_STATUSES } from '../src/lib/publicDiscovery.js';

let app;
let alice;

const visitor = (url) => request(app).get(url); // no Authorization header at all
const names = (res) => res.body.projects.map((p) => p.name).sort();

const projects = [
  { name: 'Open Garden', description: 'Community gardening app', domain: 'Community', visibility: 'Public', status: 'In progress', tags: ['Community', 'React'] },
  { name: 'React Toolkit', description: 'Shared UI pieces for students', domain: 'Developer tools', visibility: 'Public', status: 'Planning', tags: ['Developer tools', 'react', 'CSS'] },
  { name: 'Climate Map', description: 'Maps air quality', domain: 'Climate tech', visibility: 'Public', status: 'Completed', tags: ['Climate tech', 'Python'] },
  { name: 'Secret Lab', description: 'Private research notes about gardens', domain: 'Community', visibility: 'Private', status: 'In progress', tags: ['Community', 'React', 'SecretTag'] },
];

before(async () => {
  ({ app } = await setup());
  alice = await signup(app, 'Alice Discover');
  for (const { status, tags, ...body } of projects) {
    const res = await authed(app, alice.token).post('/api/projects').send(body);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    // Status and skill tags are set directly so this test does not depend on other features' rules.
    await Project.updateOne({ _id: res.body.project._id }, { $set: { status, tags } });
  }
});

after(teardown);

// --- US-45 acceptance criteria (Visitor, no token) -----------------------------------------------

test('AC1: a visitor opening Discover sees only public projects', async () => {
  const res = await visitor('/api/public/projects');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(names(res), ['Climate Map', 'Open Garden', 'React Toolkit']);
  assert.equal(res.body.total, 3);
  assert.equal(res.body.page, 1);
  assert.equal(res.body.pageSize, 24);
});

test('AC2: domain, skill-tag and status filters show only matching projects', async () => {
  assert.deepEqual(names(await visitor('/api/public/projects?domain=Community')), ['Open Garden']);
  assert.deepEqual(names(await visitor('/api/public/projects?domain=developer%20tools')), ['React Toolkit']);
  assert.deepEqual(names(await visitor('/api/public/projects?tag=React')), ['Open Garden', 'React Toolkit']);
  assert.deepEqual(names(await visitor('/api/public/projects?tag=python')), ['Climate Map']);
  assert.deepEqual(names(await visitor('/api/public/projects?status=Completed')), ['Climate Map']);
  assert.deepEqual(names(await visitor('/api/public/projects?status=in%20progress')), ['Open Garden']);
});

test('AC2: filters combine (AND)', async () => {
  assert.deepEqual(names(await visitor('/api/public/projects?tag=react&status=Planning')), ['React Toolkit']);
  assert.deepEqual(names(await visitor('/api/public/projects?tag=react&domain=Climate%20tech')), []);
  assert.deepEqual(names(await visitor('/api/public/projects?q=app&domain=Community&tag=React&status=In%20progress')), ['Open Garden']);
});

test('AC3: a keyword returns projects whose name or description contains it', async () => {
  assert.deepEqual(names(await visitor('/api/public/projects?q=garden')), ['Open Garden']);
  assert.deepEqual(names(await visitor('/api/public/projects?q=STUDENTS')), ['React Toolkit']);
  assert.deepEqual(names(await visitor('/api/public/projects?q=air%20quality')), ['Climate Map']);
});

test('the keyword does not match text that is only in the domain or tags', async () => {
  assert.deepEqual(names(await visitor('/api/public/projects?q=developer%20tools')), []);
  assert.deepEqual(names(await visitor('/api/public/projects?q=python')), []);
});

// --- Private projects never leak -----------------------------------------------------------------

test('a private project never appears, whatever the filters or keyword', async () => {
  for (const url of [
    '/api/public/projects?q=Secret%20Lab',
    '/api/public/projects?q=gardens',
    '/api/public/projects?domain=Community&status=In%20progress&tag=React',
    '/api/public/projects?tag=SecretTag',
    '/api/public/projects?visibility=Private',
    '/api/public/projects?q=.*',
    '/api/public/projects?page=2',
  ]) {
    const res = await visitor(url);
    assert.equal(res.status, 200, url);
    assert.ok(!res.body.projects.some((p) => p.name === 'Secret Lab'), url);
  }
});

test('the filter choices list only tags of public projects', async () => {
  const res = await visitor('/api/public/projects/filters');
  assert.equal(res.status, 200);
  assert.ok(res.body.tags.includes('Python'));
  assert.ok(res.body.tags.includes('CSS'));
  assert.ok(!res.body.tags.includes('SecretTag'));
  assert.equal(res.body.tags.filter((t) => t.toLowerCase() === 'react').length, 1);
  assert.deepEqual(res.body.statuses, PROJECT_STATUSES);
  assert.deepEqual(res.body.statuses, Project.schema.path('status').enumValues);
  assert.ok(res.body.domains.includes('Community'));
});

test('each project has only the safe fields: no members, emails, roles or other data', async () => {
  const res = await visitor('/api/public/projects?q=garden');
  const [garden] = res.body.projects;
  assert.deepEqual(Object.keys(garden).sort(), ['_id', 'createdAt', 'description', 'domain', 'memberCount', 'name', 'status', 'tags', 'updatedAt']);
  assert.equal(garden.memberCount, 1);
  assert.equal(JSON.stringify(res.body).includes(alice.user.email), false);
  assert.equal(JSON.stringify(res.body).includes(alice.user.id), false);
});

// --- Input checks --------------------------------------------------------------------------------

test('bad filters answer 400', async () => {
  for (const url of [
    '/api/public/projects?domain=Space',
    '/api/public/projects?status=Archived',
    `/api/public/projects?q=${'x'.repeat(101)}`,
    '/api/public/projects?page=0',
    '/api/public/projects?page=abc',
    '/api/public/projects?q=a&q=b',
  ]) {
    const res = await visitor(url);
    assert.equal(res.status, 400, url);
    assert.ok(res.body.message, url);
  }
});

test('regex symbols in the keyword are searched literally and do not crash', async () => {
  for (const q of ['(', '[', '.*', 'a+b', '\\']) {
    const res = await visitor(`/api/public/projects?q=${encodeURIComponent(q)}`);
    assert.equal(res.status, 200, q);
  }
  assert.deepEqual(names(await visitor('/api/public/projects?q=.*')), []);
});

test('paging: 24 per page, newest updated first', async () => {
  const many = [];
  for (let i = 0; i < 26; i += 1) {
    many.push({ name: `Paging ${String(i).padStart(2, '0')}`, description: 'paging test', domain: 'Education', visibility: 'Public', members: [], status: 'Planning', tags: [] });
  }
  // Raw driver insert, so the given updatedAt values are kept exactly (no Mongoose timestamps).
  await Project.collection.insertMany(many.map((p, i) => ({ ...p, createdAt: new Date(Date.UTC(2026, 0, 1)), updatedAt: new Date(Date.UTC(2026, 0, 1, 0, i)) })));
  const first = await visitor('/api/public/projects?q=paging');
  assert.equal(first.body.total, 26);
  assert.equal(first.body.projects.length, 24);
  assert.equal(first.body.projects[0].name, 'Paging 25');
  const second = await visitor('/api/public/projects?q=paging&page=2');
  assert.deepEqual(second.body.projects.map((p) => p.name), ['Paging 01', 'Paging 00']);
  assert.equal((await visitor('/api/public/projects?q=paging&page=9')).body.projects.length, 0);
});

// --- Login does not matter -----------------------------------------------------------------------

test('a garbage or expired token is ignored: the visitor still gets the public list', async () => {
  for (const header of ['Bearer garbage', 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.x', 'Basic abc']) {
    const res = await request(app).get('/api/public/projects').set('Authorization', header);
    assert.equal(res.status, 200, header);
    assert.ok(!res.body.projects.some((p) => p.name === 'Secret Lab'));
  }
  const loggedIn = await authed(app, alice.token).get('/api/public/projects');
  assert.equal(loggedIn.status, 200);
  assert.ok(!loggedIn.body.projects.some((p) => p.name === 'Secret Lab'), 'even the owner of a private project does not see it on Discover');
});

test('the old logged-in GET /api/projects/discover still works the same', async () => {
  assert.equal((await visitor('/api/projects/discover')).status, 401);
  const res = await authed(app, alice.token).get('/api/projects/discover?q=developer%20tools');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.projects.map((p) => p.name), ['React Toolkit']);
});
