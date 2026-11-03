// [Sprint 1 · gaps] Sprint 1 plan line E: "Create-project form with name, description, domain from an
// agreed fixed list, visibility, optional starting members/roles."
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, signup, authed } from './helpers.js';
import Project from '../src/models/Project.js';
import Activity from '../src/models/Activity.js';

let app;
let owner;
let riya;
let jai;
before(async () => {
  ({ app } = await setup());
  owner = await signup(app, 'Owner Person');
  riya = await signup(app, 'Riya Kapoor');
  jai = await signup(app, 'Jai Shah');
});
after(teardown);

const create = (body, who = owner) => authed(app, who.token).post('/api/projects').send(body);

test('the domain must come from the agreed list (stored in its listed spelling)', async () => {
  const ok = await create({ name: 'Listed', domain: 'climate tech' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.project.domain, 'Climate tech');

  const bad = await create({ name: 'Unlisted', domain: 'Blockchain' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.message, /Domain must be one of/);
  assert.equal(await Project.countDocuments({ name: 'Unlisted' }), 0);
});

test('leaving the domain out gives "Other"', async () => {
  const res = await create({ name: 'No domain' });
  assert.equal(res.status, 201);
  assert.equal(res.body.project.domain, 'Other');
});

test('editing: a new domain must be listed; an old unlisted domain can stay', async () => {
  const res = await create({ name: 'Editable', domain: 'Research' });
  const id = res.body.project._id;
  const bad = await authed(app, owner.token).patch(`/api/projects/${id}`).send({ domain: 'Space' });
  assert.equal(bad.status, 400);
  const good = await authed(app, owner.token).patch(`/api/projects/${id}`).send({ domain: 'backend' });
  assert.equal(good.status, 200);
  assert.equal(good.body.project.domain, 'Backend');

  // A project saved before the list existed.
  await Project.updateOne({ _id: id }, { $set: { domain: 'General' } });
  const keep = await authed(app, owner.token).patch(`/api/projects/${id}`).send({ domain: 'General', description: 'still editable' });
  assert.equal(keep.status, 200);
  assert.equal(keep.body.project.domain, 'General');
});

test('starting members are added with their roles, and logged in the feed', async () => {
  const res = await create({
    name: 'Team from day one',
    domain: 'Education',
    visibility: 'Private',
    members: [
      { identifier: riya.email, role: 'Admin' },
      { identifier: `@${jai.user.username}`, role: 'Viewer' },
    ],
  });
  assert.equal(res.status, 201);
  const roles = Object.fromEntries(res.body.project.members.map((m) => [String(m.user), m.role]));
  assert.equal(roles[owner.user.id || owner.user._id], 'Owner');
  assert.equal(roles[riya.user.id || riya.user._id], 'Admin');
  assert.equal(roles[jai.user.id || jai.user._id], 'Viewer');
  assert.deepEqual(
    res.body.startingMembers.map((m) => m.role),
    ['Admin', 'Viewer']
  );

  // They really are members: Riya can open the Private project, as an Admin.
  const asRiya = await authed(app, riya.token).get(`/api/projects/${res.body.project._id}`);
  assert.equal(asRiya.status, 200);
  assert.equal(asRiya.body.membershipRole, 'Admin');

  const added = await Activity.find({ project: res.body.project._id, type: 'member.added' }).lean();
  assert.equal(added.length, 2);
});

test('the role defaults to Contributor', async () => {
  const res = await create({ name: 'Default role', members: [{ identifier: riya.email }] });
  assert.equal(res.status, 201);
  assert.deepEqual(
    res.body.startingMembers.map((m) => m.role),
    ['Contributor']
  );
});

test('one bad starting member means nothing is created', async () => {
  const before = await Project.countDocuments();
  const unknown = await create({
    name: 'Nope 1',
    members: [{ identifier: riya.email, role: 'Admin' }, { identifier: 'ghost@example.com' }],
  });
  assert.equal(unknown.status, 404);
  assert.deepEqual(unknown.body.unknown, ['ghost@example.com']);

  const ownerRole = await create({ name: 'Nope 2', members: [{ identifier: riya.email, role: 'Owner' }] });
  assert.equal(ownerRole.status, 400);

  const self = await create({ name: 'Nope 3', members: [{ identifier: owner.email, role: 'Admin' }] });
  assert.equal(self.status, 400);

  const twice = await create({ name: 'Nope 4', members: [{ identifier: riya.email }, { identifier: `@${riya.user.username}` }] });
  assert.equal(twice.status, 400);

  const notAList = await create({ name: 'Nope 5', members: 'riya' });
  assert.equal(notAList.status, 400);

  assert.equal(await Project.countDocuments(), before);
});
