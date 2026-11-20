// [Sprint 7 · M7] Transfer ownership: the Owner makes another member the Owner and becomes an Admin,
// after which leaving works (US-14).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { setup, teardown, signup, authed } from './helpers.js';
import Project from '../src/models/Project.js';
import Activity from '../src/models/Activity.js';

let app;
let owner, admin, contributor, viewer, outsider;

const as = (account) => authed(app, account.token);
const transfer = (account, projectId, body) => as(account).post(`/api/projects/${projectId}/transfer-ownership`).send(body);

async function newProject(name = 'Handover Project') {
  const res = await as(owner).post('/api/projects').send({ name, visibility: 'Private' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const id = res.body.project._id;
  for (const [account, role] of [
    [admin, 'Admin'],
    [contributor, 'Contributor'],
    [viewer, 'Viewer'],
  ]) {
    const added = await as(owner).post(`/api/projects/${id}/members`).send({ identifier: account.user.username, role });
    assert.equal(added.status, 201, JSON.stringify(added.body));
  }
  return id;
}

async function rolesOf(projectId) {
  const project = await Project.findById(projectId).lean();
  return Object.fromEntries(project.members.map((member) => [String(member.user), member.role]));
}

const owners = (roles) => Object.values(roles).filter((role) => role === 'Owner').length;

before(async () => {
  ({ app } = await setup());
  [owner, admin, contributor, viewer, outsider] = await Promise.all(
    ['Olu Owner', 'Ada Admin', 'Cy Contributor', 'Vi Viewer', 'Otto Outsider'].map((name) => signup(app, name))
  );
});

after(teardown);

test('the Owner makes a Contributor the Owner: they swap to Owner and Admin in one step', async () => {
  const projectId = await newProject();
  const res = await transfer(owner, projectId, { userId: contributor.user.id, confirm: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.membershipRole, 'Admin');

  const roles = await rolesOf(projectId);
  assert.equal(roles[contributor.user.id], 'Owner');
  assert.equal(roles[owner.user.id], 'Admin');
  assert.equal(roles[admin.user.id], 'Admin', 'other members keep their roles');
  assert.equal(roles[viewer.user.id], 'Viewer');
  assert.equal(owners(roles), 1, 'exactly one Owner');

  const byId = Object.fromEntries(res.body.members.map((member) => [member.userId, member.role]));
  assert.equal(byId[contributor.user.id], 'Owner');
  assert.equal(byId[owner.user.id], 'Admin');

  // Each side sees its new role straight away.
  assert.equal((await as(contributor).get(`/api/projects/${projectId}/members`)).body.membershipRole, 'Owner');
  assert.equal((await as(owner).get(`/api/projects/${projectId}/members`)).body.membershipRole, 'Admin');
});

test('after the transfer the former Owner can leave the project, which was refused before', async () => {
  const projectId = await newProject();
  const refused = await as(owner).delete(`/api/projects/${projectId}/members/${owner.user.id}`);
  assert.equal(refused.status, 403);
  assert.match(refused.body.message, /Transfer ownership to another member before leaving/);

  assert.equal((await transfer(owner, projectId, { userId: admin.user.id, confirm: true })).status, 200);
  const left = await as(owner).delete(`/api/projects/${projectId}/members/${owner.user.id}`);
  assert.equal(left.status, 200, JSON.stringify(left.body));
  const roles = await rolesOf(projectId);
  assert.equal(roles[owner.user.id], undefined);
  assert.equal(roles[admin.user.id], 'Owner');
  assert.equal(owners(roles), 1);
});

test('the new Owner has full Owner rights; the former Owner has Admin rights only', async () => {
  const projectId = await newProject();
  await transfer(owner, projectId, { userId: viewer.user.id, confirm: true });

  // New Owner can promote someone to Admin (Admins cannot).
  const promote = await as(viewer).patch(`/api/projects/${projectId}/members/${contributor.user.id}`).send({ role: 'Admin' });
  assert.equal(promote.status, 200, JSON.stringify(promote.body));
  // Former Owner, now Admin, cannot change another Admin.
  const blocked = await as(owner).patch(`/api/projects/${projectId}/members/${admin.user.id}`).send({ role: 'Viewer' });
  assert.equal(blocked.status, 403);
  // ... cannot transfer again ...
  assert.equal((await transfer(owner, projectId, { userId: admin.user.id, confirm: true })).status, 403);
  // ... and the new Owner can hand it back.
  const back = await transfer(viewer, projectId, { userId: owner.user.id, confirm: true });
  assert.equal(back.status, 200, JSON.stringify(back.body));
  const roles = await rolesOf(projectId);
  assert.equal(roles[owner.user.id], 'Owner');
  assert.equal(roles[viewer.user.id], 'Admin');
});

test('only the Owner can transfer; Admins, Contributors, Viewers and outsiders get 403', async () => {
  const projectId = await newProject();
  for (const account of [admin, contributor, viewer]) {
    const res = await transfer(account, projectId, {
      userId: account.user.id === admin.user.id ? contributor.user.id : admin.user.id,
      confirm: true,
    });
    assert.equal(res.status, 403, JSON.stringify(res.body));
  }
  assert.equal((await transfer(outsider, projectId, { userId: admin.user.id, confirm: true })).status, 403);
  assert.equal(
    (await request(app).post(`/api/projects/${projectId}/transfer-ownership`).send({ userId: admin.user.id, confirm: true })).status,
    401
  );
  const roles = await rolesOf(projectId);
  assert.equal(roles[owner.user.id], 'Owner');
  assert.equal(owners(roles), 1);
});

test('bad requests change nothing: no confirm, yourself, a non-member, bad IDs', async () => {
  const projectId = await newProject();
  const cases = [
    [{ userId: admin.user.id }, 400, /Confirm the transfer/],
    [{ userId: admin.user.id, confirm: 'yes' }, 400, /Confirm the transfer/],
    [{ userId: owner.user.id, confirm: true }, 400, /already the Owner/],
    [{ userId: outsider.user.id, confirm: true }, 404, /not a member/],
    [{ userId: 'nope', confirm: true }, 400, /Choose the member/],
    [{ confirm: true }, 400, /Choose the member/],
  ];
  for (const [body, status, message] of cases) {
    const res = await transfer(owner, projectId, body);
    assert.equal(res.status, status, JSON.stringify(body));
    assert.match(res.body.message, message);
  }
  assert.equal((await transfer(owner, 'not-an-id', { userId: admin.user.id, confirm: true })).status, 400);
  assert.equal((await transfer(owner, new mongoose.Types.ObjectId().toString(), { userId: admin.user.id, confirm: true })).status, 404);
  const roles = await rolesOf(projectId);
  assert.equal(roles[owner.user.id], 'Owner');
  assert.equal(owners(roles), 1);
});

test('two transfers at the same moment: exactly one wins and there is still one Owner', async () => {
  const projectId = await newProject();
  const results = await Promise.all([
    transfer(owner, projectId, { userId: admin.user.id, confirm: true }),
    transfer(owner, projectId, { userId: contributor.user.id, confirm: true }),
  ]);
  const ok = results.filter((res) => res.status === 200);
  assert.equal(ok.length, 1, results.map((res) => `${res.status} ${res.body.message || ''}`).join(' | '));
  for (const res of results.filter((item) => item.status !== 200)) assert.ok([403, 409].includes(res.status));
  const roles = await rolesOf(projectId);
  assert.equal(owners(roles), 1);
  assert.equal(roles[owner.user.id], 'Admin');
});

test('the Owner role still cannot be given through a role change or when adding someone', async () => {
  const projectId = await newProject();
  const viaPatch = await as(owner).patch(`/api/projects/${projectId}/members/${admin.user.id}`).send({ role: 'Owner' });
  assert.equal(viaPatch.status, 400);
  assert.match(viaPatch.body.message, /Transfer ownership/);
  const viaAdd = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: outsider.user.username, role: 'Owner' });
  assert.equal(viaAdd.status, 400);
  assert.equal(owners(await rolesOf(projectId)), 1);
});

test('the transfer is recorded in the activity feed', async () => {
  const projectId = await newProject();
  await transfer(owner, projectId, { userId: contributor.user.id, confirm: true });
  const entry = await Activity.findOne({ project: projectId, type: 'member.ownership_transferred' }).lean();
  assert.ok(entry);
  assert.equal(String(entry.actor), owner.user.id);
  assert.equal(String(entry.targetId), contributor.user.id);
  assert.equal(entry.summary, 'made Cy Contributor the Owner and became an Admin');
  const feed = await as(viewer).get(`/api/projects/${projectId}/activity`);
  assert.equal(feed.status, 200);
  assert.ok(feed.body.activity.some((item) => item.type === 'member.ownership_transferred'));
});
