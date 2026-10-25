// [Sprint 3 · M3] US-13 Remove a member, US-14 Leave a project.
// Access is lost straight away (REST and live updates), history stays, and the only Owner is protected.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as connect } from 'socket.io-client';
import { setup, teardown, signup, authed } from './helpers.js';
import { initRealtime, closeRealtime } from '../src/lib/realtime.js';

let app;
let server;
let baseUrl;
const sockets = [];

const as = (account) => authed(app, account.token);

async function newProject(owner, name, visibility, members = []) {
  const res = await as(owner).post('/api/projects').send({ name, visibility });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const id = res.body.project._id;
  for (const [account, role] of members) {
    const added = await as(owner).post(`/api/projects/${id}/members`).send({ identifier: account.user.username, role });
    assert.equal(added.status, 201, JSON.stringify(added.body));
  }
  return id;
}

async function generalChannel(account, projectId) {
  const res = await as(account).get(`/api/projects/${projectId}/channels`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.channels.find((channel) => channel.isDefault)._id;
}

const removeMember = (actor, projectId, userId) => as(actor).delete(`/api/projects/${projectId}/members/${userId}`);
const memberIds = async (actor, projectId) => (await as(actor).get(`/api/projects/${projectId}/members`)).body.members.map((m) => m.userId);
const activity = async (actor, projectId) => (await as(actor).get(`/api/projects/${projectId}/activity?limit=100`)).body.activity;

// ---- socket helpers (same style as realtime.test.js)
function open(token) {
  const socket = connect(baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
  sockets.push(socket);
  return socket;
}
function connected(socket) {
  return new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
}
function join(socket, id) {
  return new Promise((resolve) => { socket.emit('project:join', { projectId: id }, resolve); });
}
function nextEvent(socket, name, ms = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${name} within ${ms} ms`)), ms);
    socket.once(name, (payload) => { clearTimeout(timer); resolve(payload); });
  });
}
function noEvent(socket, name, ms = 400) {
  return new Promise((resolve, reject) => {
    const handler = () => reject(new Error(`unexpected ${name}`));
    socket.once(name, handler);
    setTimeout(() => { socket.off(name, handler); resolve(); }, ms);
  });
}

before(async () => {
  ({ app } = await setup());
  server = http.createServer(app);
  initRealtime(server, { origins: ['http://localhost:5173'] });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  for (const socket of sockets) socket.disconnect();
  await closeRealtime();
  await teardown();
});

// ---------------------------------------------------------------- US-13 Remove a member

test('US-13 a removed member can no longer open a private project, and their messages and tasks remain', async () => {
  const [owner, leo, ivy] = await Promise.all(['Nia Owner', 'Leo Contributor', 'Ivy Viewer'].map((n) => signup(app, n)));
  const id = await newProject(owner, 'Private Garden', 'Private', [[leo, 'Contributor'], [ivy, 'Viewer']]);
  const channelId = await generalChannel(owner, id);

  // Leo takes part: a message, a task he created, and a task assigned to him.
  const posted = await as(leo).post(`/api/projects/${id}/channels/${channelId}/messages`).send({ body: 'Hello from Leo' });
  assert.equal(posted.status, 201, JSON.stringify(posted.body));
  const created = await as(leo).post(`/api/projects/${id}/tasks`).send({ title: 'Leo task' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const assigned = await as(owner).post(`/api/projects/${id}/tasks`).send({ title: 'Assigned to Leo', assignee: leo.user.id });
  assert.equal(assigned.status, 201, JSON.stringify(assigned.body));

  const res = await removeMember(owner, id, leo.user.id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(!res.body.members.some((m) => m.userId === leo.user.id), 'the response lists the team without Leo');
  assert.ok(!(await memberIds(owner, id)).includes(leo.user.id));

  // Leo loses access everywhere.
  assert.equal((await as(leo).get(`/api/projects/${id}`)).status, 403);
  assert.equal((await as(leo).get(`/api/projects/${id}/tasks`)).status, 403);
  assert.equal((await as(leo).post(`/api/projects/${id}/tasks`).send({ title: 'Sneaky' })).status, 403);
  assert.equal((await as(leo).get(`/api/projects/${id}/channels`)).status, 403);
  assert.equal((await as(leo).get(`/api/projects/${id}/channels/${channelId}/messages`)).status, 403);
  assert.equal((await as(leo).post(`/api/projects/${id}/channels/${channelId}/messages`).send({ body: 'Still here?' })).status, 403);
  assert.equal((await as(leo).get(`/api/projects/${id}/activity`)).status, 403);
  assert.ok(!(await as(leo).get('/api/projects')).body.projects.some((p) => p._id === id), 'gone from his project list');

  // History stays.
  const messages = (await as(ivy).get(`/api/projects/${id}/channels/${channelId}/messages`)).body.messages;
  const kept = messages.find((m) => m.body === 'Hello from Leo');
  assert.ok(kept, 'his message is still in the channel');
  assert.equal(kept.author.name, 'Leo Contributor');

  const tasks = (await as(owner).get(`/api/projects/${id}/tasks`)).body.tasks;
  const leoTask = tasks.find((t) => t.title === 'Leo task');
  assert.ok(leoTask, 'the task he created is still there');
  assert.equal(leoTask.createdBy.name, 'Leo Contributor');
  const stillAssigned = tasks.find((t) => t.title === 'Assigned to Leo');
  assert.equal(stillAssigned.assignee.name, 'Leo Contributor', 'the assignment is kept as history');

  // The board can still be edited without touching that old assignee.
  const edit = await as(owner).patch(`/api/projects/${id}/tasks/${stillAssigned._id}`).send({ status: 'In progress' });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));

  const feed = await activity(owner, id);
  const removed = feed.find((e) => e.type === 'member.removed');
  assert.equal(removed.summary, 'removed Leo Contributor from the project');
  assert.equal(removed.actor.name, 'Nia Owner');
  assert.ok(feed.some((e) => e.type === 'task.created' && e.actor.name === 'Leo Contributor'), 'his earlier activity stays');
});

test('US-13 only Owners and Admins can remove, Admins only Contributors and Viewers', async () => {
  const [owner, ada, cal, vic, dee] = await Promise.all(['Ola Owner', 'Ada Admin', 'Cal Contributor', 'Vic Viewer', 'Dee Admin'].map((n) => signup(app, n)));
  const id = await newProject(owner, 'Roles Garden', 'Private', [[ada, 'Admin'], [cal, 'Contributor'], [vic, 'Viewer'], [dee, 'Admin']]);

  assert.equal((await removeMember(cal, id, vic.user.id)).status, 403, 'a Contributor cannot remove');
  assert.equal((await removeMember(vic, id, cal.user.id)).status, 403, 'a Viewer cannot remove');
  assert.equal((await removeMember(ada, id, dee.user.id)).status, 403, 'an Admin cannot remove another Admin');
  assert.equal((await removeMember(ada, id, vic.user.id)).status, 200, 'an Admin can remove a Viewer');
  assert.equal((await removeMember(owner, id, dee.user.id)).status, 200, 'the Owner can remove an Admin');

  const ids = await memberIds(owner, id);
  assert.ok(!ids.includes(vic.user.id) && !ids.includes(dee.user.id));
  assert.ok(ids.includes(cal.user.id) && ids.includes(ada.user.id));
});

test('US-13 the only Owner cannot be removed, with an explanation', async () => {
  const [owner, ada] = await Promise.all(['Pia Owner', 'Abe Admin'].map((n) => signup(app, n)));
  const id = await newProject(owner, 'Owner Garden', 'Private', [[ada, 'Admin']]);

  const res = await removeMember(ada, id, owner.user.id);
  assert.equal(res.status, 403);
  assert.equal(res.body.message, 'The project Owner cannot be removed. Every project needs an Owner.');
  assert.ok((await memberIds(ada, id)).includes(owner.user.id));
});

test('US-13 someone removed from a Public project keeps the public read-only view only', async () => {
  const [owner, leo] = await Promise.all(['Qui Owner', 'Lou Contributor'].map((n) => signup(app, n)));
  const id = await newProject(owner, 'Public Garden', 'Public', [[leo, 'Contributor']]);

  assert.equal((await removeMember(owner, id, leo.user.id)).status, 200);

  const page = await as(leo).get(`/api/projects/${id}`);
  assert.equal(page.status, 200);
  assert.equal(page.body.membershipRole, null, 'now a visitor');
  assert.equal((await as(leo).get(`/api/projects/${id}/tasks`)).status, 200, 'public tasks are readable by anyone');
  assert.equal((await as(leo).post(`/api/projects/${id}/tasks`).send({ title: 'No' })).status, 403);
  assert.equal((await as(leo).get(`/api/projects/${id}/channels`)).status, 403);
  assert.equal((await as(leo).get(`/api/projects/${id}/activity`)).status, 403);
});

// ---------------------------------------------------------------- US-14 Leave a project

test('US-14 a member who leaves loses access and their contributions stay', async () => {
  const [owner, cal] = await Promise.all(['Ray Owner', 'Cy Contributor'].map((n) => signup(app, n)));
  const id = await newProject(owner, 'Leave Garden', 'Private', [[cal, 'Contributor']]);
  const channelId = await generalChannel(owner, id);
  await as(cal).post(`/api/projects/${id}/channels/${channelId}/messages`).send({ body: 'Bye team' });
  await as(cal).post(`/api/projects/${id}/tasks`).send({ title: 'Handover notes' });

  const res = await removeMember(cal, id, cal.user.id);
  assert.equal(res.status, 200, JSON.stringify(res.body));

  assert.equal((await as(cal).get(`/api/projects/${id}`)).status, 403);
  assert.equal((await as(cal).get(`/api/projects/${id}/channels`)).status, 403);
  assert.equal((await removeMember(cal, id, cal.user.id)).status, 403, 'leaving twice: no longer a member');

  const messages = (await as(owner).get(`/api/projects/${id}/channels/${channelId}/messages`)).body.messages;
  assert.ok(messages.some((m) => m.body === 'Bye team' && m.author.name === 'Cy Contributor'));
  const tasks = (await as(owner).get(`/api/projects/${id}/tasks`)).body.tasks;
  assert.ok(tasks.some((t) => t.title === 'Handover notes'));

  const left = (await activity(owner, id)).find((e) => e.type === 'member.left');
  assert.equal(left.summary, 'left the project');
  assert.equal(left.actor.name, 'Cy Contributor');
});

test('US-14 Admins and Viewers can leave too', async () => {
  const [owner, ada, vic] = await Promise.all(['Sam Owner', 'Al Admin', 'Val Viewer'].map((n) => signup(app, n)));
  const id = await newProject(owner, 'Any Leaver', 'Private', [[ada, 'Admin'], [vic, 'Viewer']]);
  assert.equal((await removeMember(ada, id, ada.user.id)).status, 200);
  assert.equal((await removeMember(vic, id, vic.user.id)).status, 200);
  assert.deepEqual(await memberIds(owner, id), [owner.user.id]);
});

test('US-14 the only Owner is asked to transfer ownership before leaving', async () => {
  const [owner, cal] = await Promise.all(['Tia Owner', 'Ted Contributor'].map((n) => signup(app, n)));
  const id = await newProject(owner, 'Owner Stays', 'Private', [[cal, 'Contributor']]);

  const res = await removeMember(owner, id, owner.user.id);
  assert.equal(res.status, 403);
  assert.equal(res.body.message, 'You are the only Owner of this project. Transfer ownership to another member before leaving.');
  assert.equal((await as(owner).get(`/api/projects/${id}`)).body.membershipRole, 'Owner');
});

// ---------------------------------------------------------------- live updates stop at once

test('A removed member stops receiving live chat and private task updates; others keep them', async () => {
  const [owner, leo, ivy] = await Promise.all(['Uma Owner', 'Lars Contributor', 'Iris Viewer'].map((n) => signup(app, n)));
  const id = await newProject(owner, 'Live Private', 'Private', [[leo, 'Contributor'], [ivy, 'Viewer']]);
  const channelId = await generalChannel(owner, id);

  const leoSocket = open(leo.token);
  const ivySocket = open(ivy.token);
  await Promise.all([connected(leoSocket), connected(ivySocket)]);
  assert.equal((await join(leoSocket, id)).ok, true);
  assert.equal((await join(ivySocket, id)).ok, true);

  const notice = nextEvent(leoSocket, 'project:access-removed');
  assert.equal((await removeMember(owner, id, leo.user.id)).status, 200);
  assert.deepEqual(await notice, { projectId: id, reason: 'removed' });

  // New chat message: Ivy gets it, Leo does not.
  const ivyGets = nextEvent(ivySocket, 'message:created');
  const leoMissesMessage = noEvent(leoSocket, 'message:created');
  await as(owner).post(`/api/projects/${id}/channels/${channelId}/messages`).send({ body: 'After Leo left' });
  assert.equal((await ivyGets).message.body, 'After Leo left');
  await leoMissesMessage;

  // Private project: no task events or activity either.
  const leoMissesTask = noEvent(leoSocket, 'task:created');
  const leoMissesActivity = noEvent(leoSocket, 'activity:created');
  await as(owner).post(`/api/projects/${id}/tasks`).send({ title: 'Secret plan' });
  await Promise.all([leoMissesTask, leoMissesActivity]);

  // And he cannot simply join the room again.
  assert.equal((await join(leoSocket, id)).ok, false);
});

test('Someone who leaves a Public project stops getting chat but can still watch the public board', async () => {
  const [owner, nia] = await Promise.all(['Vik Owner', 'Noa Contributor'].map((n) => signup(app, n)));
  const id = await newProject(owner, 'Live Public', 'Public', [[nia, 'Contributor']]);
  const channelId = await generalChannel(owner, id);

  const niaSocket = open(nia.token);
  await connected(niaSocket);
  assert.equal((await join(niaSocket, id)).ok, true);

  const notice = nextEvent(niaSocket, 'project:access-removed');
  assert.equal((await removeMember(nia, id, nia.user.id)).status, 200);
  assert.deepEqual(await notice, { projectId: id, reason: 'left' });

  const missesMessage = noEvent(niaSocket, 'message:created');
  await as(owner).post(`/api/projects/${id}/channels/${channelId}/messages`).send({ body: 'Members only' });
  await missesMessage;

  const seesTask = nextEvent(niaSocket, 'task:created');
  await as(owner).post(`/api/projects/${id}/tasks`).send({ title: 'Public task' });
  assert.equal((await seesTask).task.title, 'Public task');
});

test('A refused removal sends no access-removed event', async () => {
  const [owner, ada] = await Promise.all(['Wes Owner', 'Wyn Admin'].map((n) => signup(app, n)));
  const id = await newProject(owner, 'No Event', 'Private', [[ada, 'Admin']]);
  const ownerSocket = open(owner.token);
  await connected(ownerSocket);
  await join(ownerSocket, id);

  const quiet = noEvent(ownerSocket, 'project:access-removed');
  assert.equal((await removeMember(ada, id, owner.user.id)).status, 403);
  await quiet;
});
