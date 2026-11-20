// [Sprint 7 · M4] Followers / following lists, projects on a profile, and D6 snapshot, against a real MongoDB.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import Task from '../src/models/Task.js';
import Decision from '../src/models/Decision.js';
import Message from '../src/models/Message.js';
import { ensureDefaultChannel } from '../src/lib/channels.js';
import { CONNECTIONS_PAGE_SIZE } from '../src/lib/profileConnectionsRules.js';

let app;
let ann, ben, cara, dev;
let publicProject, privateWithBen, privateAlone;

const as = (account) => authed(app, account.token);
const userUrl = (account, rest = '') => `/api/profile/users/${encodeURIComponent(account.user.username)}${rest}`;
const doFollow = (who, target) => request(app).put(userUrl(target, '/follow')).set('Authorization', `Bearer ${who.token}`);
const usernames = (res) => res.body.people.map((person) => person.username);
const projectNames = (res) => res.body.projects.map((project) => project.name);

async function createProject(account, body) {
  const res = await as(account).post('/api/projects').send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.project._id;
}
async function addMember(owner, projectId, account, role = 'Contributor') {
  const res = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
  assert.equal(res.status, 201, JSON.stringify(res.body));
}

before(async () => {
  ({ app } = await setup());
  [ann, ben, cara, dev] = await Promise.all(['Ann Author', 'Ben Builder', 'Cara Coder', 'Dev Dana'].map((name) => signup(app, name)));

  // Ben and Cara follow Ann; Ann follows Ben.
  for (const [who, target] of [
    [ben, ann],
    [cara, ann],
    [ann, ben],
  ]) {
    const res = await doFollow(who, target);
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }

  publicProject = await createProject(ann, {
    name: 'Open Garden',
    description: 'Community app',
    domain: 'Community',
    visibility: 'Public',
  });
  privateWithBen = await createProject(ann, {
    name: 'Shared Secret',
    description: 'Ann and Ben only',
    domain: 'Research',
    visibility: 'Private',
  });
  privateAlone = await createProject(ann, { name: 'Solo Secret', description: 'Only Ann', domain: 'Research', visibility: 'Private' });
  await addMember(ann, privateWithBen, ben, 'Contributor');
  await addMember(ann, publicProject, cara, 'Viewer');
});

after(teardown);

test('followers list: who follows the user, newest first, no IDs or emails', async () => {
  const res = await as(dev).get(userUrl(ann, '/followers'));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(usernames(res), [cara.user.username, ben.user.username]);
  assert.equal(res.body.total, 2);
  assert.equal(res.body.hasMore, false);
  assert.equal(res.headers['cache-control'], 'no-store');
  const text = JSON.stringify(res.body);
  for (const secret of [ben.user.id, cara.user.id, ben.email, cara.email]) assert.ok(!text.includes(secret));
  assert.deepEqual(Object.keys(res.body.people[0]).sort(), ['avatarUrl', 'headline', 'name', 'username']);
});

test('following list: whom the user follows (works on your own profile too)', async () => {
  const theirs = await as(cara).get(userUrl(ann, '/following'));
  assert.equal(theirs.status, 200);
  assert.deepEqual(usernames(theirs), [ben.user.username]);
  const mine = await as(ann).get(userUrl(ann, '/following'));
  assert.deepEqual(usernames(mine), [ben.user.username]);
  const nobody = await as(ann).get(userUrl(dev, '/followers'));
  assert.deepEqual(nobody.body.people, []);
  assert.equal(nobody.body.total, 0);
});

test('lists update after unfollow, and the profile has followingCount', async () => {
  let profile = (await as(dev).get(userUrl(ann))).body.profile;
  assert.equal(profile.followerCount, 2);
  assert.equal(profile.followingCount, 1);

  const off = await as(cara).delete(userUrl(ann, '/follow'));
  assert.equal(off.status, 200);
  const res = await as(dev).get(userUrl(ann, '/followers'));
  assert.deepEqual(usernames(res), [ben.user.username]);
  profile = (await as(dev).get(userUrl(ann))).body.profile;
  assert.equal(profile.followerCount, 1);

  assert.equal((await doFollow(cara, ann)).status, 200); // back for the next tests
});

test('lists are paged 20 at a time', async () => {
  const fans = await Promise.all(Array.from({ length: CONNECTIONS_PAGE_SIZE + 2 }, (_, i) => signup(app, `Fan Number${i}`)));
  for (const fan of fans) assert.equal((await doFollow(fan, dev)).status, 200);
  const first = await as(ann).get(userUrl(dev, '/followers'));
  assert.equal(first.body.people.length, CONNECTIONS_PAGE_SIZE);
  assert.equal(first.body.total, CONNECTIONS_PAGE_SIZE + 2);
  assert.equal(first.body.hasMore, true);
  const second = await as(ann).get(userUrl(dev, '/followers?page=2'));
  assert.equal(second.body.people.length, 2);
  assert.equal(second.body.hasMore, false);
  const overlap = usernames(first).filter((name) => usernames(second).includes(name));
  assert.deepEqual(overlap, []);
});

test('lists, projects: 404 for an unknown user, 401 without login', async () => {
  for (const rest of ['/followers', '/following', '/projects']) {
    const missing = await as(ann).get(`/api/profile/users/no.such.user${rest}`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.message, 'User not found.');
    const anon = await request(app).get(userUrl(ann, rest));
    assert.equal(anon.status, 401);
  }
});

test('projects on a profile: a stranger sees only Public ones, linking to the public project page', async () => {
  const res = await as(dev).get(userUrl(ann, '/projects'));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(projectNames(res), ['Open Garden']);
  const [garden] = res.body.projects;
  assert.equal(garden.role, 'Owner');
  assert.equal(garden.visibility, 'Public');
  assert.equal(garden.viewerIsMember, false);
  assert.equal(garden.path, `/discover/${publicProject}`);
  assert.equal(garden.memberCount, 2);
  assert.ok(!('members' in garden));
  assert.ok(!JSON.stringify(res.body).includes('Solo Secret'));
});

test('projects on a profile: Private ones show only when the viewer is a member too, linking to the workspace', async () => {
  const asBen = await as(ben).get(userUrl(ann, '/projects'));
  assert.deepEqual(projectNames(asBen).sort(), ['Open Garden', 'Shared Secret']);
  const shared = asBen.body.projects.find((project) => project.name === 'Shared Secret');
  assert.equal(shared.viewerIsMember, true);
  assert.equal(shared.path, `/project/${privateWithBen}`);

  const asCara = await as(cara).get(userUrl(ann, '/projects'));
  assert.deepEqual(projectNames(asCara), ['Open Garden']);
  assert.equal(asCara.body.projects[0].path, `/project/${publicProject}`, 'a member of a Public project opens the workspace');

  // Ben's own list as Ann sees it: the private project they share, with Ben's role.
  const bensForAnn = await as(ann).get(userUrl(ben, '/projects'));
  assert.deepEqual(projectNames(bensForAnn), ['Shared Secret']);
  assert.equal(bensForAnn.body.projects[0].role, 'Contributor');
});

test('projects on your own profile: all of them, Private included', async () => {
  const res = await as(ann).get(userUrl(ann, '/projects'));
  assert.deepEqual(projectNames(res).sort(), ['Open Garden', 'Shared Secret', 'Solo Secret']);
  assert.ok(res.body.projects.every((project) => project.viewerIsMember));
  assert.ok(String(privateAlone).length > 0);
});

test('D6 snapshot: real numbers for My profile', async () => {
  const empty = await as(dev).get('/api/profile/me/snapshot');
  assert.equal(empty.status, 200, JSON.stringify(empty.body));
  assert.equal(empty.body.snapshot.projects, 0);
  assert.equal(empty.body.snapshot.tasksCompleted, 0);
  assert.equal(empty.body.snapshot.collaborators, 0);
  assert.equal(empty.body.snapshot.followerCount, CONNECTIONS_PAGE_SIZE + 2);
  assert.ok(empty.body.snapshot.joinedAt);

  const by = ann.user.id;
  const old = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
  await Task.create({ project: publicProject, title: 'Done now', status: 'Done', assignee: by, createdBy: by, completedAt: new Date() });
  await Task.create({ project: publicProject, title: 'Done long ago', status: 'Done', assignee: by, createdBy: by, completedAt: old });
  await Task.create({ project: publicProject, title: 'Still open', status: 'In progress', assignee: by, createdBy: by });
  await Task.create({
    project: publicProject,
    title: 'Someone else',
    status: 'Done',
    assignee: ben.user.id,
    createdBy: by,
    completedAt: new Date(),
  });
  await Decision.create({
    project: publicProject,
    title: 'Use React',
    description: 'Team knows it',
    participants: [by],
    date: new Date(),
    createdBy: by,
  });
  const channel = await ensureDefaultChannel(publicProject);
  await Message.create({ project: publicProject, channel: channel._id, author: by, body: 'Hello' });
  await Message.create({ project: publicProject, channel: channel._id, author: by, body: 'Again' });

  const res = await as(ann).get('/api/profile/me/snapshot');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(
    { ...res.body.snapshot, joinedAt: Boolean(res.body.snapshot.joinedAt) },
    {
      projects: 3,
      completedProjects: 0,
      tasksCompleted: 2,
      tasksCompletedThisWeek: 1,
      messagesPosted: 2,
      decisionsRecorded: 1,
      collaborators: 2, // Ben (Shared Secret) and Cara (Open Garden), each counted once
      followerCount: 2,
      followingCount: 1,
      joinedAt: true,
    }
  );
  assert.equal((await request(app).get('/api/profile/me/snapshot')).status, 401);
});

test('D6 About: focus, exploring and open-to are saved, trimmed and length-checked', async () => {
  const ok = await as(ann).patch('/api/profile/me').send({ focus: '  Realtime collaboration  ', exploring: 'Rust', openTo: 'Hackathons' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.user.focus, 'Realtime collaboration');
  assert.equal(ok.body.user.exploring, 'Rust');
  assert.equal(ok.body.user.openTo, 'Hackathons');
  const tooLong = await as(ann)
    .patch('/api/profile/me')
    .send({ focus: 'x'.repeat(161) });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.body.message, 'Focus must be 160 characters or fewer.');
});
