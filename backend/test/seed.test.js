// [Sprint 1 · gaps] Sprint 1 plan line A: database setup / seed process (src/seed/seedData.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import User from '../src/models/User.js';
import Project from '../src/models/Project.js';
import Task from '../src/models/Task.js';
import Message from '../src/models/Message.js';
import { seedDatabase, seedEmail, SEED_USERS } from '../src/seed/seedData.js';

let app;
let outsider;
before(async () => {
  ({ app } = await setup());
  outsider = await signup(app, 'Real Person');
});
after(teardown);

test('seed adds the demo team, projects with every role, tasks and messages', async () => {
  const result = await seedDatabase({ password: 'seed-password-123' });
  assert.equal(result.seeded, true);
  assert.equal(await User.countDocuments({ email: /@seed\.devorbit\.test$/ }), SEED_USERS.length);

  const orbit = await Project.findOne({ name: 'Orbit dashboard' }).lean();
  assert.ok(orbit);
  assert.deepEqual(orbit.members.map((m) => m.role).sort(), ['Admin', 'Contributor', 'Owner', 'Viewer']);
  assert.equal(orbit.domain, 'Developer tools');

  const statuses = (await Task.find({ project: orbit._id }).lean()).map((t) => t.status);
  for (const status of ['To do', 'In progress', 'Blocked', 'Done']) assert.ok(statuses.includes(status), status);
  assert.ok((await Message.countDocuments({ project: orbit._id })) >= 1);
});

test('a seed account can log in and sees its projects', async () => {
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: seedEmail('aarav'), password: 'seed-password-123' });
  assert.equal(login.status, 200);
  const list = await authed(app, login.body.accessToken).get('/api/projects');
  assert.deepEqual(list.body.projects.map((p) => p.name).sort(), ['CampusConnect', 'Orbit dashboard']);
});

test('running it again changes nothing', async () => {
  const before = await Project.countDocuments();
  const again = await seedDatabase({ password: 'seed-password-123' });
  assert.equal(again.seeded, false);
  assert.equal(await Project.countDocuments(), before);
});

test('--reset recreates only the seed data and leaves real users and projects alone', async () => {
  const mine = await authed(app, outsider.token).post('/api/projects').send({ name: 'Real project', domain: 'Research' });
  assert.equal(mine.status, 201);
  const riya = await User.findOne({ email: seedEmail('riya') }).lean();
  await Project.updateOne({ _id: mine.body.project._id }, { $push: { members: { user: riya._id, role: 'Viewer' } } });

  const result = await seedDatabase({ reset: true, password: 'seed-password-123' });
  assert.equal(result.seeded, true);
  assert.equal(result.removed.users, SEED_USERS.length);
  assert.equal(await Project.countDocuments({ name: 'Orbit dashboard' }), 1);
  assert.ok(await User.exists({ email: outsider.email }));

  const real = await Project.findById(mine.body.project._id).lean();
  assert.ok(real, 'the real project is kept');
  assert.equal(real.members.length, 1, 'the old seed user was taken out of it');
});

test('the seed password follows the sign-up rule', async () => {
  await assert.rejects(() => seedDatabase({ reset: true, password: 'short' }), /8 to 128/);
});
