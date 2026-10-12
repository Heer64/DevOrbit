import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, signup, authed } from './helpers.js';

let app;
let owner, admin, contributor, viewer, outsider;
let projectId;
const as = (account) => authed(app, account.token);

before(async () => {
  ({ app } = await setup());
  [owner, admin, contributor, viewer, outsider] = await Promise.all(
    ['Olivia Owner', 'Adam Admin', 'Casey Contributor', 'Vera Viewer', 'Otto Outsider'].map((name) => signup(app, name))
  );
  const created = await as(owner).post('/api/projects').send({ name: 'Roles Project', description: 'for tests', domain: 'Developer tools', visibility: 'Public' });
  projectId = created.body.project._id;
  // Owner builds the team through the API itself.
  for (const [account, role] of [[admin, 'Admin'], [contributor, 'Contributor'], [viewer, 'Viewer']]) {
    const res = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
});
after(teardown);

const roleOf = async (account) => {
  const res = await as(owner).get(`/api/projects/${projectId}/members`);
  return res.body.members.find((m) => m.userId === account.user.id)?.role;
};

test('US-08 creating a project stores name, description, domain and visibility and makes the creator Owner', async () => {
  const res = await as(owner).post('/api/projects').send({ name: 'Orbit', description: 'A thing', domain: 'Education', visibility: 'Private' });
  assert.equal(res.status, 201);
  const { project } = res.body;
  assert.equal(project.name, 'Orbit');
  assert.equal(project.description, 'A thing');
  assert.equal(project.domain, 'Education');
  assert.equal(project.visibility, 'Private');
  assert.equal(project.members.length, 1);
  assert.equal(String(project.members[0].user), owner.user.id);
  assert.equal(project.members[0].role, 'Owner');
});

test('US-08 name is required and visibility must be Public or Private', async () => {
  assert.equal((await as(owner).post('/api/projects').send({ name: '   ' })).status, 400);
  assert.equal((await as(owner).post('/api/projects').send({ name: 'x'.repeat(81) })).status, 400);
  assert.equal((await as(owner).post('/api/projects').send({ name: 'Ok', visibility: 'Secret' })).status, 400);
  const dflt = await as(owner).post('/api/projects').send({ name: 'Default visibility' });
  assert.equal(dflt.status, 201);
  assert.equal(dflt.body.project.visibility, 'Public');
});

test('private projects are 403 for non-members and open to members', async () => {
  const priv = await as(owner).post('/api/projects').send({ name: 'Secret', visibility: 'Private' });
  const id = priv.body.project._id;
  assert.equal((await as(outsider).get(`/api/projects/${id}`)).status, 403);
  assert.equal((await as(owner).get(`/api/projects/${id}`)).status, 200);
});

test('editing project details: Owner and Admin 200, Contributor and Viewer 403', async () => {
  const patch = (a) => as(a).patch(`/api/projects/${projectId}`).send({ description: 'updated' });
  assert.equal((await patch(owner)).status, 200);
  assert.equal((await patch(admin)).status, 200);
  assert.equal((await patch(contributor)).status, 403);
  assert.equal((await patch(viewer)).status, 403);
  assert.equal((await patch(outsider)).status, 403);
});

test('US-09 a Viewer cannot change roles (403) and nothing changes', async () => {
  const res = await as(viewer).patch(`/api/projects/${projectId}/members/${contributor.user.id}`).send({ role: 'Viewer' });
  assert.equal(res.status, 403);
  assert.equal(await roleOf(contributor), 'Contributor');
  const self = await as(viewer).patch(`/api/projects/${projectId}/members/${viewer.user.id}`).send({ role: 'Admin' });
  assert.equal(self.status, 403);
  assert.equal(await roleOf(viewer), 'Viewer');
});

test('US-09 a Contributor cannot add, change or remove members (403)', async () => {
  assert.equal((await as(contributor).post(`/api/projects/${projectId}/members`).send({ identifier: outsider.user.username, role: 'Viewer' })).status, 403);
  assert.equal((await as(contributor).patch(`/api/projects/${projectId}/members/${viewer.user.id}`).send({ role: 'Contributor' })).status, 403);
  assert.equal((await as(contributor).delete(`/api/projects/${projectId}/members/${viewer.user.id}`)).status, 403);
});

test('US-09 non-members get 403 on every members endpoint', async () => {
  assert.equal((await as(outsider).get(`/api/projects/${projectId}/members`)).status, 403);
  assert.equal((await as(outsider).post(`/api/projects/${projectId}/members`).send({ identifier: outsider.user.username, role: 'Admin' })).status, 403);
  assert.equal((await as(outsider).patch(`/api/projects/${projectId}/members/${viewer.user.id}`).send({ role: 'Admin' })).status, 403);
  assert.equal((await as(outsider).delete(`/api/projects/${projectId}/members/${viewer.user.id}`)).status, 403);
});

test('US-09 any member can list the team; the response has names but no emails or hashes', async () => {
  const res = await as(viewer).get(`/api/projects/${projectId}/members`);
  assert.equal(res.status, 200);
  assert.equal(res.body.membershipRole, 'Viewer');
  assert.equal(res.body.members.length, 4);
  for (const member of res.body.members) {
    assert.deepEqual(Object.keys(member).sort(), ['avatarUrl', 'name', 'role', 'userId', 'username']);
  }
});

test('US-09 Owner can promote and demote members', async () => {
  const up = await as(owner).patch(`/api/projects/${projectId}/members/${viewer.user.id}`).send({ role: 'Contributor' });
  assert.equal(up.status, 200);
  assert.equal(await roleOf(viewer), 'Contributor');
  const down = await as(owner).patch(`/api/projects/${projectId}/members/${viewer.user.id}`).send({ role: 'Viewer' });
  assert.equal(down.status, 200);
  assert.equal(await roleOf(viewer), 'Viewer');
});

test('US-09 the new role takes effect straight away on the server', async () => {
  // Viewer cannot edit; after Owner makes them Admin they can; after demoting they cannot again.
  assert.equal((await as(viewer).patch(`/api/projects/${projectId}`).send({ description: 'v1' })).status, 403);
  await as(owner).patch(`/api/projects/${projectId}/members/${viewer.user.id}`).send({ role: 'Admin' });
  assert.equal((await as(viewer).patch(`/api/projects/${projectId}`).send({ description: 'v2' })).status, 200);
  await as(owner).patch(`/api/projects/${projectId}/members/${viewer.user.id}`).send({ role: 'Viewer' });
  assert.equal((await as(viewer).patch(`/api/projects/${projectId}`).send({ description: 'v3' })).status, 403);
});

test('US-09 Admin can manage Contributors and Viewers but not Admins or the Owner', async () => {
  assert.equal((await as(admin).patch(`/api/projects/${projectId}/members/${viewer.user.id}`).send({ role: 'Contributor' })).status, 200);
  assert.equal((await as(admin).patch(`/api/projects/${projectId}/members/${viewer.user.id}`).send({ role: 'Viewer' })).status, 200);
  // cannot hand out Admin
  assert.equal((await as(admin).patch(`/api/projects/${projectId}/members/${viewer.user.id}`).send({ role: 'Admin' })).status, 403);
  // cannot touch the Owner
  assert.equal((await as(admin).patch(`/api/projects/${projectId}/members/${owner.user.id}`).send({ role: 'Viewer' })).status, 403);
  assert.equal((await as(admin).delete(`/api/projects/${projectId}/members/${owner.user.id}`)).status, 403);
  assert.equal(await roleOf(owner), 'Owner');
});

test('US-09 nobody can make a second Owner or change the Owner', async () => {
  assert.equal((await as(owner).patch(`/api/projects/${projectId}/members/${contributor.user.id}`).send({ role: 'Owner' })).status, 400);
  assert.equal((await as(owner).patch(`/api/projects/${projectId}/members/${owner.user.id}`).send({ role: 'Admin' })).status, 403);
  assert.equal((await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: outsider.user.username, role: 'Owner' })).status, 400);
  assert.equal((await as(owner).delete(`/api/projects/${projectId}/members/${owner.user.id}`)).status, 403);
});

test('US-09 adding members: by username or email, duplicates and unknown people are handled', async () => {
  const byEmail = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: outsider.email.toUpperCase(), role: 'Viewer' });
  assert.equal(byEmail.status, 201);
  assert.equal(byEmail.body.members.find((m) => m.userId === outsider.user.id).role, 'Viewer');
  const dup = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: outsider.user.username, role: 'Viewer' });
  assert.equal(dup.status, 409);
  const unknown = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: 'no-such-user', role: 'Viewer' });
  assert.equal(unknown.status, 404);
  const empty = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: '  ' });
  assert.equal(empty.status, 400);
  const badRole = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: 'x', role: 'Boss' });
  assert.equal(badRole.status, 400);
  // cleanup so later tests see the original team
  assert.equal((await as(owner).delete(`/api/projects/${projectId}/members/${outsider.user.id}`)).status, 200);
});

test('US-09 members can leave; removed members lose access to a private project', async () => {
  const priv = await as(owner).post('/api/projects').send({ name: 'Leave test', visibility: 'Private' });
  const id = priv.body.project._id;
  await as(owner).post(`/api/projects/${id}/members`).send({ identifier: viewer.user.username, role: 'Viewer' });
  assert.equal((await as(viewer).get(`/api/projects/${id}`)).status, 200);
  assert.equal((await as(viewer).delete(`/api/projects/${id}/members/${viewer.user.id}`)).status, 200);
  assert.equal((await as(viewer).get(`/api/projects/${id}`)).status, 403);
});

test('US-09 bad ids are rejected cleanly', async () => {
  assert.equal((await as(owner).get('/api/projects/not-an-id/members')).status, 400);
  assert.equal((await as(owner).patch(`/api/projects/${projectId}/members/not-an-id`).send({ role: 'Viewer' })).status, 400);
  assert.equal((await as(owner).get('/api/projects/64b64b64b64b64b64b64b64b/members')).status, 404);
});
