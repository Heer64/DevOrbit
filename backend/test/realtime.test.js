// Sprint 2 Pair D: live task updates over Socket.IO (US-24 "other members see it", US-28).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as connect } from 'socket.io-client';
import { setup, teardown, signup, authed } from './helpers.js';
import { initRealtime, closeRealtime } from '../src/lib/realtime.js';

let app;
let server;
let baseUrl;
let owner, viewer, outsider;
let projectId;
const sockets = [];

const as = (account) => authed(app, account.token);

function open(token) {
  const socket = connect(baseUrl, {
    auth: token === undefined ? {} : { token },
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  sockets.push(socket);
  return socket;
}

function connected(socket) {
  return new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
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

function noEvent(socket, name, ms = 300) {
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

  [owner, viewer, outsider] = await Promise.all(
    ['Rae Owner', 'Rui Viewer', 'Ren Outsider'].map((name) => signup(app, name))
  );

  const project = await as(owner).post('/api/projects').send({ name: 'Realtime Project', visibility: 'Private' });
  projectId = project.body.project._id;

  const added = await as(owner)
    .post(`/api/projects/${projectId}/members`)
    .send({ identifier: viewer.user.username, role: 'Viewer' });
  assert.equal(added.status, 201, JSON.stringify(added.body));
});

after(async () => {
  for (const socket of sockets) socket.disconnect();
  await closeRealtime();
  await teardown();
});

test('A connection without a valid token is refused', async () => {
  await assert.rejects(connected(open()), /Authentication required/);
  await assert.rejects(connected(open('not-a-jwt')), /Authentication required/);
});

test('A non-member cannot join a private project room', async () => {
  const socket = open(outsider.token);
  await connected(socket);
  const reply = await join(socket, projectId);
  assert.equal(reply.ok, false);
});

test('Invalid project IDs are rejected when joining', async () => {
  const socket = open(owner.token);
  await connected(socket);
  assert.equal((await join(socket, 'nope')).ok, false);
});

test('Members (including Viewers) receive task:updated with the new status and version', async () => {
  const socket = open(viewer.token);
  await connected(socket);
  const reply = await join(socket, projectId);
  assert.deepEqual(reply, { ok: true, role: 'Viewer' });

  const created = await as(owner).post(`/api/projects/${projectId}/tasks`).send({ title: 'Live task' });
  const taskId = created.body.task._id;

  const event = nextEvent(socket, 'task:updated');
  const moved = await as(owner)
    .patch(`/api/projects/${projectId}/tasks/${taskId}/status`)
    .send({ status: 'Blocked', version: 0 });
  assert.equal(moved.status, 200);

  const payload = await event;
  assert.equal(payload.projectId, projectId);
  assert.equal(payload.task._id, taskId);
  assert.equal(payload.task.status, 'Blocked');
  assert.equal(payload.task.version, 1);
  assert.equal(typeof payload.task.createdBy.name, 'string');
});

test('A general edit also broadcasts task:updated', async () => {
  const socket = open(owner.token);
  await connected(socket);
  await join(socket, projectId);

  const created = await as(owner).post(`/api/projects/${projectId}/tasks`).send({ title: 'Rename me' });
  const event = nextEvent(socket, 'task:updated');
  await as(owner).patch(`/api/projects/${projectId}/tasks/${created.body.task._id}`).send({ title: 'Renamed' });

  const payload = await event;
  assert.equal(payload.task.title, 'Renamed');
  assert.equal(payload.task.version, 1);
});

test('Rejected moves (409, 403) broadcast nothing', async () => {
  const socket = open(owner.token);
  await connected(socket);
  await join(socket, projectId);

  const created = await as(owner).post(`/api/projects/${projectId}/tasks`).send({ title: 'Quiet task' });
  const url = `/api/projects/${projectId}/tasks/${created.body.task._id}/status`;

  const silence = noEvent(socket, 'task:updated');
  assert.equal((await as(owner).patch(url).send({ status: 'Done', version: 7 })).status, 409);
  assert.equal((await as(viewer).patch(url).send({ status: 'Done', version: 0 })).status, 403);
  await silence;
});

test('After leaving the room, no more events arrive', async () => {
  const socket = open(owner.token);
  await connected(socket);
  await join(socket, projectId);
  socket.emit('project:leave', { projectId });
  await new Promise((resolve) => { setTimeout(resolve, 50); });

  const created = await as(owner).post(`/api/projects/${projectId}/tasks`).send({ title: 'After leave' });
  const silence = noEvent(socket, 'task:updated');
  await as(owner)
    .patch(`/api/projects/${projectId}/tasks/${created.body.task._id}/status`)
    .send({ status: 'Done', version: 0 });
  await silence;
});

// [Sprint 2 final] Tasks created or deleted by someone else appear/disappear without a reload.
test('Creating a task broadcasts task:created to members', async () => {
  const socket = open(viewer.token);
  await connected(socket);
  await join(socket, projectId);

  const event = nextEvent(socket, 'task:created');
  const created = await as(owner).post(`/api/projects/${projectId}/tasks`).send({ title: 'Brand new' });
  assert.equal(created.status, 201);

  const payload = await event;
  assert.equal(payload.projectId, projectId);
  assert.equal(payload.task._id, created.body.task._id);
  assert.equal(payload.task.title, 'Brand new');
  assert.equal(payload.task.version, 0);
  assert.equal(typeof payload.task.createdBy.name, 'string');
});

test('Deleting a task broadcasts task:deleted; a refused delete broadcasts nothing', async () => {
  const socket = open(viewer.token);
  await connected(socket);
  await join(socket, projectId);

  const created = await as(owner).post(`/api/projects/${projectId}/tasks`).send({ title: 'Delete me' });
  const taskId = created.body.task._id;

  const silence = noEvent(socket, 'task:deleted');
  assert.equal((await as(viewer).delete(`/api/projects/${projectId}/tasks/${taskId}`)).status, 403);
  await silence;

  const event = nextEvent(socket, 'task:deleted');
  assert.equal((await as(owner).delete(`/api/projects/${projectId}/tasks/${taskId}`)).status, 200);
  assert.deepEqual(await event, { projectId, taskId });
});

test('Non-members never receive task:created', async () => {
  const socket = open(outsider.token);
  await connected(socket);
  await join(socket, projectId); // refused: private project

  const silence = noEvent(socket, 'task:created');
  await as(owner).post(`/api/projects/${projectId}/tasks`).send({ title: 'Secret' });
  await silence;
});
