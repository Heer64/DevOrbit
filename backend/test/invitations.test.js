import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import Invitation, { INVITE_EXPIRY_DAYS } from '../src/models/Invitation.js';

// [Sprint 3 · M1] Invitations: US-10 (invite an existing user with a role, 7-day expiry, no duplicates)
// and US-11 (accept -> member with that role; decline -> not added, and the inviter can see it).

const DAY_MS = 24 * 60 * 60 * 1000;

let app;
let owner, admin, contributor, viewer, outsider;
let projectId, otherProjectId;

const as = (account) => authed(app, account.token);
const base = (id = projectId) => `/api/projects/${id}/invitations`;
const invite = (account, body, id = projectId) => as(account).post(base(id)).send(body);
const projectList = (account, query = '', id = projectId) => as(account).get(`${base(id)}${query}`);
const myList = (account, query = '') => as(account).get(`/api/invitations${query}`);
const accept = (account, invitationId) => as(account).post(`/api/invitations/${invitationId}/accept`).send({});
const decline = (account, invitationId) => as(account).post(`/api/invitations/${invitationId}/decline`).send({});
const roleIn = async (account, id = projectId) => (await as(account).get(`/api/projects/${id}`)).body.membershipRole ?? null;
const memberRows = async (account, id = projectId) => (await as(owner).get(`/api/projects/${id}/members`)).body.members.filter((m) => m.userId === account.user.id).length;
const feed = async (id = projectId) => (await as(owner).get(`/api/projects/${id}/activity`)).body.activity;

before(async () => {
  ({ app } = await setup());
  await Invitation.init(); // unique "one pending invitation" index, needed by the race tests

  [owner, admin, contributor, viewer, outsider] = await Promise.all(
    ['Nia Owner', 'Ari Admin', 'Leo Contributor', 'Ivy Viewer', 'Oz Outsider'].map((name) => signup(app, name))
  );

  const created = await as(owner).post('/api/projects').send({ name: 'Secret Lab', visibility: 'Private' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  projectId = created.body.project._id;

  const other = await as(owner).post('/api/projects').send({ name: 'Other Lab', visibility: 'Private' });
  otherProjectId = other.body.project._id;

  for (const [account, role] of [[admin, 'Admin'], [contributor, 'Contributor'], [viewer, 'Viewer']]) {
    const res = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }
});

after(teardown);

// ---------------------------------------------------------------- US-10: sending an invitation

test('An Owner invites a registered user by username with a role; it is pending and expires in 7 days', async () => {
  const guest = await signup(app, 'Gia Guest');
  const before = Date.now();
  const res = await invite(owner, { identifier: guest.user.username, role: 'Viewer' });

  assert.equal(res.status, 201, JSON.stringify(res.body));
  const { invitation } = res.body;
  assert.equal(invitation.status, 'Pending');
  assert.equal(invitation.role, 'Viewer');
  assert.equal(invitation.respondedAt, null);
  assert.equal(invitation.invitee.name, 'Gia Guest');
  assert.equal(invitation.invitedBy.name, 'Nia Owner');
  assert.equal(invitation.project.name, 'Secret Lab');
  assert.equal(invitation.invitee.email, undefined, 'emails are never returned');
  assert.equal(invitation.invitedBy.email, undefined, 'emails are never returned');

  const expires = new Date(invitation.expiresAt).getTime();
  const sent = new Date(invitation.createdAt).getTime();
  assert.ok(Math.abs(expires - sent - INVITE_EXPIRY_DAYS * DAY_MS) < 5_000, 'expires 7 days after it was sent');
  assert.ok(expires > before + 6.9 * DAY_MS);

  // It appears in the invited user's own list ...
  const mine = await myList(guest);
  assert.equal(mine.status, 200, JSON.stringify(mine.body));
  assert.equal(mine.body.invitations.length, 1);
  assert.equal(mine.body.invitations[0]._id, invitation._id);
  assert.equal(mine.body.invitations[0].project.name, 'Secret Lab');
  assert.equal(mine.body.invitations[0].invitedBy.name, 'Nia Owner');

  // ... but does not make them a member yet, and the team can see it in the Activity Feed.
  assert.equal(await roleIn(guest), null);
  const event = (await feed()).find((item) => item.type === 'invite.sent' && item.targetLabel === 'Gia Guest');
  assert.ok(event, 'invite.sent is logged');
  assert.equal(event.summary, 'invited Gia Guest to join as Viewer');
});

test('Invites by email (any case) or "@username"; the default role is Contributor', async () => {
  const byEmail = await signup(app, 'Eve Email');
  const res = await invite(owner, { identifier: `  ${byEmail.email.toUpperCase()}  ` });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.invitation.invitee.name, 'Eve Email');
  assert.equal(res.body.invitation.role, 'Contributor');

  const byHandle = await signup(app, 'Hal Handle');
  const handle = await invite(admin, { identifier: `@${byHandle.user.username}`, role: 'Contributor' });
  assert.equal(handle.status, 201, JSON.stringify(handle.body));
  assert.equal(handle.body.invitation.invitedBy.name, 'Ari Admin', 'Admins can invite too');
});

test('Inviting someone who is already a member or already invited is an error and creates nothing', async () => {
  const guest = await signup(app, 'Dana Double');
  assert.equal((await invite(owner, { identifier: guest.user.username })).status, 201);

  const again = await invite(admin, { identifier: guest.user.username, role: 'Viewer' });
  assert.equal(again.status, 409);
  assert.equal(again.body.message, 'That person already has a pending invitation to this project.');
  assert.equal(await Invitation.countDocuments({ project: projectId, invitee: guest.user.id }), 1);

  const member = await invite(owner, { identifier: contributor.user.username });
  assert.equal(member.status, 409);
  assert.equal(member.body.message, 'That person is already a member of this project.');

  const self = await invite(owner, { identifier: owner.user.username });
  assert.equal(self.status, 409, 'you are already a member of your own project');
  assert.equal(await Invitation.countDocuments({ project: projectId, invitee: contributor.user.id }), 0);

  // The same person can be invited to a different project.
  assert.equal((await invite(owner, { identifier: guest.user.username }, otherProjectId)).status, 201);
});

test('Two invitations sent at the same moment create only one', async () => {
  const guest = await signup(app, 'Rex Racer');
  const results = await Promise.all([
    invite(owner, { identifier: guest.user.username }),
    invite(owner, { identifier: guest.user.username }),
    invite(admin, { identifier: guest.user.username }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
  assert.equal(await Invitation.countDocuments({ project: projectId, invitee: guest.user.id, status: 'Pending' }), 1);
});

test('Only Owners and Admins can invite, and only with roles they may hand out', async () => {
  const guest = await signup(app, 'Pat Perm');
  const body = { identifier: guest.user.username, role: 'Contributor' };

  const byContributor = await invite(contributor, body);
  assert.equal(byContributor.status, 403);
  assert.equal(byContributor.body.message, 'Only project Owners and Admins can invite people.');
  assert.equal((await invite(viewer, body)).status, 403);
  assert.equal((await invite(outsider, body)).status, 403, 'non-members cannot invite');

  const adminAsAdmin = await invite(admin, { ...body, role: 'Admin' });
  assert.equal(adminAsAdmin.status, 403);
  assert.equal(adminAsAdmin.body.message, 'Your role cannot assign the Admin role.');
  assert.equal((await invite(owner, { ...body, role: 'Owner' })).status, 400, 'nobody can be invited as Owner');
  assert.equal((await invite(owner, { ...body, role: 'Boss' })).status, 400);

  assert.equal(await Invitation.countDocuments({ invitee: guest.user.id }), 0);

  // The Owner may invite an Admin.
  const ownerAsAdmin = await invite(owner, { ...body, role: 'Admin' });
  assert.equal(ownerAsAdmin.status, 201, JSON.stringify(ownerAsAdmin.body));
  assert.equal(ownerAsAdmin.body.invitation.role, 'Admin');
});

test('Bad input: no identifier, unknown user, bad project ID, not signed in', async () => {
  const empty = await invite(owner, { identifier: '   ' });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.message, 'Enter the email or username of the person to invite.');

  const unknown = await invite(owner, { identifier: 'nobody-here-12345' });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.message, 'No DevOrbit user matches that email or username.');
  assert.equal((await invite(owner, { identifier: 'nobody@example.com' })).status, 404);

  assert.equal((await as(owner).post('/api/projects/not-an-id/invitations').send({ identifier: 'x' })).status, 400);
  assert.equal((await invite(owner, { identifier: 'x' }, new mongoose.Types.ObjectId().toString())).status, 404);

  assert.equal((await request(app).post(base()).send({ identifier: 'x' })).status, 401);
  assert.equal((await request(app).get(base())).status, 401);
  assert.equal((await request(app).get('/api/invitations')).status, 401);
});

// ---------------------------------------------------------------- US-11: accept

test('Accepting makes me a member with the invited role and closes the invitation', async () => {
  const guest = await signup(app, 'Ada Accept');
  const sent = await invite(owner, { identifier: guest.user.username, role: 'Viewer' });
  const id = sent.body.invitation._id;

  const res = await accept(guest, id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.invitation.status, 'Accepted');
  assert.ok(res.body.invitation.respondedAt);
  assert.equal(res.body.project.name, 'Secret Lab');
  assert.equal(res.body.joined, true);

  // Member with the invited role, and the private project now opens and is in my list.
  assert.equal(await roleIn(guest), 'Viewer');
  assert.equal(await memberRows(guest), 1);
  const projects = await as(guest).get('/api/projects');
  assert.ok(projects.body.projects.some((project) => project._id === projectId));

  // The invitation is closed: gone from my pending list, Accepted in the project's list.
  assert.equal((await myList(guest)).body.invitations.length, 0);
  assert.equal((await myList(guest, '?status=Accepted')).body.invitations.length, 1);
  const forTeam = await projectList(owner, '?status=Accepted');
  assert.ok(forTeam.body.invitations.some((item) => item._id === id));

  const event = (await feed()).find((item) => item.type === 'invite.accepted' && item.targetId === id);
  assert.ok(event, 'invite.accepted is logged');
  assert.equal(event.actor.name, 'Ada Accept');
  assert.equal(event.summary, 'accepted the invitation and joined as Viewer');

  // It cannot be answered again.
  const twice = await accept(guest, id);
  assert.equal(twice.status, 409);
  assert.equal(twice.body.message, 'This invitation was already accepted.');
  assert.equal((await decline(guest, id)).status, 409);
  assert.equal(await memberRows(guest), 1, 'no duplicate membership');
});

test('Accepting after joining some other way keeps one membership and my current role', async () => {
  const guest = await signup(app, 'Sam Sideways');
  const sent = await invite(owner, { identifier: guest.user.username, role: 'Admin' });
  // Added by hand while the invitation was pending.
  await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: guest.user.username, role: 'Viewer' });

  const res = await accept(guest, sent.body.invitation._id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.joined, false);
  assert.equal(res.body.invitation.status, 'Accepted');
  assert.equal(await memberRows(guest), 1);
  assert.equal(await roleIn(guest), 'Viewer');
});

// ---------------------------------------------------------------- US-11: decline

test('Declining does not add me, and the inviter can see it was declined', async () => {
  const guest = await signup(app, 'Dee Decline');
  const sent = await invite(admin, { identifier: guest.user.username });
  const id = sent.body.invitation._id;

  const res = await decline(guest, id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.invitation.status, 'Declined');
  assert.ok(res.body.invitation.respondedAt);

  assert.equal(await roleIn(guest), null);
  assert.equal((await as(guest).get(`/api/projects/${projectId}`)).status, 403, 'the private project stays closed');
  assert.equal((await myList(guest)).body.invitations.length, 0);

  // The inviter sees it in the project's invitations (all, or filtered) ...
  const all = await projectList(admin);
  assert.equal(all.status, 200, JSON.stringify(all.body));
  const row = all.body.invitations.find((item) => item._id === id);
  assert.equal(row.status, 'Declined');
  assert.equal(row.invitee.name, 'Dee Decline');
  const declined = await projectList(owner, '?status=Declined');
  assert.ok(declined.body.invitations.some((item) => item._id === id));
  assert.ok(declined.body.invitations.every((item) => item.status === 'Declined'));

  // ... and in the Activity Feed.
  const event = (await feed()).find((item) => item.type === 'invite.declined' && item.targetId === id);
  assert.ok(event, 'invite.declined is logged');
  assert.equal(event.actor.name, 'Dee Decline');

  assert.equal((await accept(guest, id)).status, 409, 'a declined invitation cannot be accepted later');

  // They can be invited again afterwards.
  assert.equal((await invite(owner, { identifier: guest.user.username })).status, 201);
});

test('Accept and decline clicked at the same moment: only one wins', async () => {
  const guest = await signup(app, 'Tia Twoclick');
  const id = (await invite(owner, { identifier: guest.user.username })).body.invitation._id;
  const results = await Promise.all([accept(guest, id), decline(guest, id), accept(guest, id)]);
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(results.filter((r) => r.status === 409).length, 2);
  assert.ok(await memberRows(guest) <= 1);
});

test('I can only answer my own invitations', async () => {
  const guest = await signup(app, 'Mia Mine');
  const id = (await invite(owner, { identifier: guest.user.username })).body.invitation._id;

  const stranger = await accept(outsider, id);
  assert.equal(stranger.status, 404);
  assert.equal(stranger.body.message, 'Invitation not found.');
  assert.equal((await decline(owner, id)).status, 404, 'not even the inviter can answer for them');
  assert.equal((await myList(outsider)).body.invitations.some((item) => item._id === id), false);
  assert.equal(await roleIn(outsider), null);

  assert.equal((await accept(guest, 'not-an-id')).status, 400);
  assert.equal((await accept(guest, new mongoose.Types.ObjectId().toString())).status, 404);
  assert.equal((await myList(guest)).body.invitations.length, 1, 'still pending for the real invitee');
});

// ---------------------------------------------------------------- 7-day expiry

test('After 7 days an invitation expires: it leaves my list, cannot be accepted, and can be sent again', async () => {
  const guest = await signup(app, 'Lou Late');
  const id = (await invite(owner, { identifier: guest.user.username, role: 'Admin' })).body.invitation._id;

  // Move the clock: as if it was sent 8 days ago, so its 7 days ended yesterday.
  await Invitation.updateOne({ _id: id }, { $set: { expiresAt: new Date(Date.now() - DAY_MS) } });

  assert.equal((await myList(guest)).body.invitations.length, 0, 'expired invitations are not pending');
  const expired = await myList(guest, '?status=Expired');
  assert.equal(expired.body.invitations.length, 1);
  assert.equal(expired.body.invitations[0].status, 'Expired');
  const forTeam = (await projectList(owner)).body.invitations.find((item) => item._id === id);
  assert.equal(forTeam.status, 'Expired');

  const late = await accept(guest, id);
  assert.equal(late.status, 409);
  assert.equal(late.body.message, 'This invitation has expired. Ask the project team to invite you again.');
  assert.equal(await roleIn(guest), null);
  assert.equal((await Invitation.findById(id).lean()).status, 'Expired', 'stored as Expired once touched');
  assert.equal((await decline(guest, id)).status, 409);

  // A new invitation can be sent, and works.
  const again = await invite(owner, { identifier: guest.user.username, role: 'Contributor' });
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.equal((await accept(guest, again.body.invitation._id)).status, 200);
  assert.equal(await roleIn(guest), 'Contributor');
});

test('An invitation that expired without being touched does not block a new one', async () => {
  const guest = await signup(app, 'Kai Keepsending');
  const id = (await invite(owner, { identifier: guest.user.username })).body.invitation._id;
  await Invitation.updateOne({ _id: id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

  const again = await invite(owner, { identifier: guest.user.username });
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.equal((await Invitation.findById(id).lean()).status, 'Expired');
  assert.equal(await Invitation.countDocuments({ invitee: guest.user.id, status: 'Pending' }), 1);
});

// ---------------------------------------------------------------- lists

test('Lists check the status filter and only managers see a project\'s invitations', async () => {
  assert.equal((await projectList(owner, '?status=Maybe')).status, 400);
  assert.equal((await myList(owner, '?status=Maybe')).status, 400);
  assert.equal((await projectList(contributor)).status, 403);
  assert.equal((await projectList(viewer)).status, 403);
  assert.equal((await projectList(outsider)).status, 403);

  const all = await projectList(owner, '?status=all');
  assert.equal(all.status, 200);
  const times = all.body.invitations.map((item) => new Date(item.createdAt).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a), 'newest first');
  assert.ok(all.body.invitations.every((item) => String(item.project._id) === projectId));
});
