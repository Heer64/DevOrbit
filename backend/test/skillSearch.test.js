// [Sprint 5 · M4] US-48 Find a collaborator by skill.
// GET /api/profile/people?skills=react,css[&q=]   (login required)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';

let app;
let searcher, cara, amit, zoe, ben, hidden;

const as = (account) => authed(app, account.token);
const names = (list) => list.map((item) => item.name);
const bySkills = (skills, extra = '') => as(searcher).get(`/api/profile/people?skills=${encodeURIComponent(skills)}${extra}`);

before(async () => {
  ({ app } = await setup());
  [searcher, cara, amit, zoe, ben, hidden] = await Promise.all(
    ['Sara Searcher', 'Cara Fullstack', 'Amit Frontend', 'Zoe Reactonly', 'Ben Designer', 'Hana Hidden'].map((name) => signup(app, name))
  );
  const profiles = [
    [searcher, { skills: ['React', 'CSS'] }],
    [cara, { skills: ['react', 'CSS', 'Node.js'] }],
    [amit, { skills: ['CSS', 'React'] }],
    [zoe, { skills: ['REACT', 'React Native'] }],
    [ben, { skills: ['Figma'] }],
    [hidden, { skills: ['React', 'CSS', 'Node.js'], profileDiscoverable: false }],
  ];
  for (const [account, body] of profiles) {
    const res = await as(account).patch('/api/profile/me').send(body);
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }
});

after(teardown);

test('US-48 AC1: users with at least one tag, ignoring case, most matching tags first', async () => {
  const res = await bySkills('react,CSS,node.js');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(names(res.body.people), ['Cara Fullstack', 'Amit Frontend', 'Zoe Reactonly']);
  assert.deepEqual(res.body.people.map((p) => p.matchCount), [3, 2, 1]);
  assert.deepEqual(res.body.people[0].matchedSkills, ['react', 'CSS', 'Node.js'], 'their own spelling');
  assert.deepEqual(res.body.people[2].matchedSkills, ['REACT'], '"React Native" is a different tag');
  // The row still has everything the Discover card needs.
  const row = res.body.people[0];
  assert.equal(row.username, cara.user.username);
  assert.deepEqual(row.skills, ['react', 'CSS', 'Node.js']);
  assert.equal(row.email, undefined, 'no private fields');
});

test('US-48 AC1: one tag in any case finds every user who has it; whole tags only', async () => {
  for (const tag of ['react', 'REACT', 'ReAcT']) {
    const res = await bySkills(tag);
    assert.equal(res.status, 200);
    assert.deepEqual(names(res.body.people), ['Amit Frontend', 'Cara Fullstack', 'Zoe Reactonly'], `for "${tag}"`);
  }
  assert.deepEqual(names((await bySkills('figma')).body.people), ['Ben Designer']);
  assert.deepEqual(names((await bySkills('reac')).body.people), [], 'part of a tag is not a match');
  assert.deepEqual(names((await bySkills('rust')).body.people), []);
});

test('US-48 AC1: the same parameter may be repeated', async () => {
  const res = await as(searcher).get('/api/profile/people?skills=node.js&skills=figma');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(names(res.body.people), ['Ben Designer', 'Cara Fullstack']);
});

test('US-48 AC2: a user who opted out of collaborator search is never returned; nor are you', async () => {
  const res = await bySkills('react,css,node.js');
  assert.ok(!names(res.body.people).includes('Hana Hidden'), 'opted out');
  assert.ok(!names(res.body.people).includes('Sara Searcher'), 'not yourself');

  const on = await as(hidden).patch('/api/profile/me').send({ profileDiscoverable: true });
  assert.equal(on.status, 200);
  assert.deepEqual(names((await bySkills('react,css,node.js')).body.people), ['Cara Fullstack', 'Hana Hidden', 'Amit Frontend', 'Zoe Reactonly']);
  const off = await as(hidden).patch('/api/profile/me').send({ profileDiscoverable: false });
  assert.equal(off.status, 200);
  assert.ok(!names((await bySkills('react,css,node.js')).body.people).includes('Hana Hidden'));
});

test('US-48: skill tags combine with the text search', async () => {
  const res = await bySkills('react', '&q=amit');
  assert.deepEqual(names(res.body.people), ['Amit Frontend']);
});

test('US-48: bad tag lists are refused with a clear message', async () => {
  const eleven = Array.from({ length: 11 }, (_, i) => `t${i}`).join(',');
  const many = await bySkills(eleven);
  assert.equal(many.status, 400);
  assert.equal(many.body.message, 'Search with no more than 10 skill tags.');

  const long = await bySkills('x'.repeat(41));
  assert.equal(long.status, 400);
  assert.equal(long.body.message, 'Each skill tag must be 40 characters or fewer.');

  const odd = await as(searcher).get('/api/profile/people?skills[a]=react');
  assert.equal(odd.status, 400);
});

test('US-48: without skill tags the old search is unchanged (no match fields), and login is required', async () => {
  const res = await as(searcher).get('/api/profile/people?q=css');
  assert.equal(res.status, 200);
  assert.equal(res.body.people.length, 2);
  assert.ok(res.body.people.every((p) => p.matchCount === undefined && p.matchedSkills === undefined));

  const blank = await bySkills(' , ');
  assert.equal(blank.status, 200, 'an empty tag list is the normal search');

  const anon = await request(app).get('/api/profile/people?skills=react');
  assert.equal(anon.status, 401);
});
