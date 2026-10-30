// [Sprint 3 · M7 Part 2] Notification integration: Assignment and Deadline generation,
// live delivery over the shared Socket.IO server, read events, privacy and duplicate prevention.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as connect } from 'socket.io-client';
import { setup, teardown, signup, authed } from './helpers.js';
import { initRealtime, closeRealtime } from '../src/lib/realtime.js';
import Notification from '../src/models/Notification.js';
import { sendDeadlineNotifications } from '../src/lib/taskNotifications.js';

const DAY_MS = 24 * 60 * 60 * 1000;

let app;
let server;
let baseUrl;
const sockets = [];

const as = (account) => authed(app, account.token);
const isoDay = (date) => new Date(date).toISOString().slice(0, 10);
const todayUtc = () => isoDay(new Date());
const inDays = (n) => isoDay(Date.now() + n * DAY_MS);
// Noon UTC of a "YYYY-MM-DD" day: inside that day's deadline window.
const noonOf = (day) => new Date(`${day}T12:00:00.000Z`);

async function newProject(owner, name, members = []) {
  const res = await as(owner).post('/api/projects').send({ name, visibility: 'Private' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const id = res.body.project._id;
  for (const [account, role] of members) {
    const added = await as(owner).post(`/api/projects/${id}/members`).send({ identifier: account.user.username, role });
    assert.equal(added.status, 201, JSON.stringify(added.body));
  }
  return id;
}

async function createTask(account, projectId, body) {
  const res = await as(account).post(`/api/projects/${projectId}/tasks`).send(body);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.task;
}

const mine = async (account) => (await as(account).get('/api/notifications?limit=50')).body;
const ofType = async (account, type) => (await mine(account)).notifications.filter((n) => n.type === type);

// ---- socket helpers (same style as realtime.test.js)
function open(token) {
  const socket = connect(baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
  sockets.push(socket);
  return socket;
}
function connected(socket) {
  return new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
}
function nextEvent(socket, name, ms = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${name} within ${ms} ms`)), ms);
    socket.once(name, (payload) => { clearTimeout(timer); resolve(payload); });
  });
}
function noEvent(socket, name, ms = 400) {
  return new Promise((resolve, reject) => {
    const handler = (payload) => reject(new Error(`unexpected ${name}: ${JSON.stringify(payload)}`));
    socket.once(name, handler);
    setTimeout(() => { socket.off(name, handler); resolve(); }, ms);
  });
}
async function liveSocket(account) {
  const socket = open(account.token);
  await connected(socket);
  return socket;
}

before(async () => {
  ({ app } = await setup());
  await Notification.init(); // unique dedupe index, needed by the duplicate checks
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

// ---------------------------------------------------------------- Assignment (US-22)

test('Creating a task with an assignee notifies them, live and in the list', async () => {
  const [owner, leo] = await Promise.all(['Nia Owner', 'Leo Member'].map((n) => signup(app, n)));
  const projectId = await newProject(owner, 'Assign Live', [[leo, 'Contributor']]);
  const leoSocket = await liveSocket(leo);
  const ownerSocket = await liveSocket(owner);

  // No project:join needed: notifications go to the user's own room.
  const live = nextEvent(leoSocket, 'notification:created');
  const ownerQuiet = noEvent(ownerSocket, 'notification:created');
  const task = await createTask(owner, projectId, { title: 'Write docs', assignee: leo.user.id });

  const { notification, unreadCount } = await live;
  assert.equal(notification.type, 'assignment');
  assert.equal(notification.summary, 'assigned you to "Write docs"');
  assert.equal(notification.link, `/project/${projectId}?tab=tasks&task=${task._id}`);
  assert.equal(notification.actor.name, 'Nia Owner');
  assert.equal(notification.project.name, 'Assign Live');
  assert.equal(notification.read, false);
  assert.equal(unreadCount, 1);
  await ownerQuiet;

  const list = await mine(leo);
  assert.equal(list.unreadCount, 1);
  assert.equal(list.notifications[0]._id, notification._id, 'the live one is the stored one');
});

test('Assigning yourself, unrelated edits and repeated requests do not notify', async () => {
  const [owner, leo] = await Promise.all(['Ola Owner', 'Lou Member'].map((n) => signup(app, n)));
  const projectId = await newProject(owner, 'Assign Rules', [[leo, 'Contributor']]);

  await createTask(owner, projectId, { title: 'Mine', assignee: owner.user.id });
  assert.equal((await ofType(owner, 'assignment')).length, 0, 'self-assignment tells nobody');

  const task = await createTask(owner, projectId, { title: 'Theirs', assignee: leo.user.id });
  const url = `/api/projects/${projectId}/tasks/${task._id}`;
  assert.equal((await as(owner).patch(url).send({ priority: 'High' })).status, 200);
  assert.equal((await as(owner).patch(url).send({ assignee: leo.user.id })).status, 200, 'same assignee again');
  assert.equal((await as(owner).patch(url).send({ assignee: leo.user.id })).status, 200, 'a retried request');
  assert.equal((await ofType(leo, 'assignment')).length, 1);

  // A non-member cannot be assigned at all, so nobody outside the project is ever told.
  const outsider = await signup(app, 'Out Sider');
  assert.equal((await as(owner).patch(url).send({ assignee: outsider.user.id })).status, 400);
  assert.equal((await mine(outsider)).notifications.length, 0);
});

test('Re-assigning notifies the new assignee, and assigning back notifies again', async () => {
  const [owner, ana, ben] = await Promise.all(['Pia Owner', 'Ana Member', 'Ben Member'].map((n) => signup(app, n)));
  const projectId = await newProject(owner, 'Reassign', [[ana, 'Contributor'], [ben, 'Contributor']]);
  const task = await createTask(owner, projectId, { title: 'Hand over', assignee: ana.user.id });
  const url = `/api/projects/${projectId}/tasks/${task._id}`;

  // A Contributor can assign too; the notification names them as the actor.
  assert.equal((await as(ana).patch(url).send({ assignee: ben.user.id })).status, 200);
  const benGot = await ofType(ben, 'assignment');
  assert.equal(benGot.length, 1);
  assert.equal(benGot[0].actor.name, 'Ana Member');

  assert.equal((await as(owner).patch(url).send({ assignee: null })).status, 200, 'unassigning notifies nobody');
  assert.equal((await as(owner).patch(url).send({ assignee: ana.user.id })).status, 200);
  assert.equal((await ofType(ana, 'assignment')).length, 2, 'a later assignment is a new event');
  assert.equal((await ofType(ben, 'assignment')).length, 1);
});

// ---------------------------------------------------------------- Deadline (US-23)

test('A task saved inside its 24-hour window warns the assignee at once, once', async () => {
  const [owner, leo] = await Promise.all(['Ray Owner', 'Lia Member'].map((n) => signup(app, n)));
  const projectId = await newProject(owner, 'Due Today', [[leo, 'Contributor']]);
  const leoSocket = await liveSocket(leo);

  const events = [];
  leoSocket.on('notification:created', (payload) => events.push(payload.notification.type));
  const task = await createTask(owner, projectId, { title: 'Ship it', assignee: leo.user.id, dueDate: todayUtc() });

  const deadlines = await ofType(leo, 'deadline');
  assert.equal(deadlines.length, 1);
  assert.equal(deadlines[0].summary, '"Ship it" is due in less than 24 hours');
  assert.equal(deadlines[0].actor, null, 'a system notification');
  assert.equal(deadlines[0].link, `/project/${projectId}?tab=tasks&task=${task._id}`);

  // The periodic check and further edits do not repeat it.
  await sendDeadlineNotifications();
  await sendDeadlineNotifications();
  await as(owner).patch(`/api/projects/${projectId}/tasks/${task._id}`).send({ priority: 'High' });
  assert.equal((await ofType(leo, 'deadline')).length, 1);

  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(events.sort(), ['assignment', 'deadline'], 'each pushed live exactly once');
});

test('The periodic check notifies tasks that enter the window, and respects Done, unassigned and new dates', async () => {
  const [owner, leo] = await Promise.all(['Sam Owner', 'Lux Member'].map((n) => signup(app, n)));
  const projectId = await newProject(owner, 'Due Later', [[leo, 'Contributor']]);
  const day = inDays(3);

  const open = await createTask(owner, projectId, { title: 'Open task', assignee: leo.user.id, dueDate: day });
  await createTask(owner, projectId, { title: 'Done task', assignee: leo.user.id, dueDate: day, status: 'Done' });
  await createTask(owner, projectId, { title: 'Nobody', dueDate: day });
  assert.equal((await ofType(leo, 'deadline')).length, 0, 'three days away: too early');

  const result = await sendDeadlineNotifications({ now: noonOf(day) });
  assert.ok(result.checked >= 1);
  const got = await ofType(leo, 'deadline');
  assert.deepEqual(got.map((n) => n.targetLabel), ['Open task'], 'only the open, assigned task');

  await sendDeadlineNotifications({ now: noonOf(day) });
  assert.equal((await ofType(leo, 'deadline')).length, 1, 'running again changes nothing');

  // Moving the due date is a new deadline, so the assignee is told about the new day.
  const later = inDays(5);
  const moved = await as(owner).patch(`/api/projects/${projectId}/tasks/${open._id}`).send({ dueDate: later });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  await sendDeadlineNotifications({ now: noonOf(later) });
  assert.equal((await ofType(leo, 'deadline')).length, 2);
});

test('Moving a task out of Done inside its window warns the assignee', async () => {
  const [owner, leo] = await Promise.all(['Tia Owner', 'Lyn Member'].map((n) => signup(app, n)));
  const projectId = await newProject(owner, 'Reopen', [[leo, 'Contributor']]);
  const task = await createTask(owner, projectId, { title: 'Reopened', assignee: leo.user.id, dueDate: todayUtc(), status: 'Done' });
  assert.equal((await ofType(leo, 'deadline')).length, 0, 'Done tasks are never due');

  const res = await as(owner).patch(`/api/projects/${projectId}/tasks/${task._id}/status`).send({ status: 'In progress', version: task.version });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await ofType(leo, 'deadline')).length, 1);
});

test('Someone removed from the project gets no Deadline notifications for it', async () => {
  const [owner, leo] = await Promise.all(['Uma Owner', 'Leif Member'].map((n) => signup(app, n)));
  const projectId = await newProject(owner, 'Removed', [[leo, 'Contributor']]);
  const day = inDays(4);
  await createTask(owner, projectId, { title: 'Left behind', assignee: leo.user.id, dueDate: day });

  assert.equal((await as(owner).delete(`/api/projects/${projectId}/members/${leo.user.id}`)).status, 200);
  await sendDeadlineNotifications({ now: noonOf(day) });
  assert.equal(await Notification.countDocuments({ recipient: leo.user.id, type: 'deadline' }), 0);
});

// ---------------------------------------------------------------- Mentions (M4) are now live too

test('A mention notification from chat is pushed live to the person mentioned only', async () => {
  const [owner, leo, ivy] = await Promise.all(['Val Owner', 'Lev Member', 'Ivy Member'].map((n) => signup(app, n)));
  const projectId = await newProject(owner, 'Mention Live', [[leo, 'Contributor'], [ivy, 'Contributor']]);
  const channels = await as(owner).get(`/api/projects/${projectId}/channels`);
  const general = channels.body.channels.find((c) => c.isDefault);
  const leoSocket = await liveSocket(leo);
  const ivySocket = await liveSocket(ivy);

  const live = nextEvent(leoSocket, 'notification:created');
  const ivyQuiet = noEvent(ivySocket, 'notification:created');
  const sent = await as(owner).post(`/api/projects/${projectId}/channels/${general._id}/messages`).send({ body: `Hi @${leo.user.username}` });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));

  const { notification } = await live;
  assert.equal(notification.type, 'mention');
  assert.equal(notification.link, `/project/${projectId}?tab=chat&channel=${general._id}&message=${sent.body.message._id}`);
  await ivyQuiet;
});

// ---------------------------------------------------------------- Read state and privacy

test('Marking read updates the other open tabs once; nobody else hears about it', async () => {
  const [owner, leo, ivy] = await Promise.all(['Wes Owner', 'Lars Member', 'Iris Member'].map((n) => signup(app, n)));
  const projectId = await newProject(owner, 'Read Sync', [[leo, 'Contributor'], [ivy, 'Contributor']]);
  await createTask(owner, projectId, { title: 'One', assignee: leo.user.id });
  await createTask(owner, projectId, { title: 'Two', assignee: leo.user.id });
  const [first] = (await mine(leo)).notifications;

  const otherTab = await liveSocket(leo);
  const ivySocket = await liveSocket(ivy);
  const readEvent = nextEvent(otherTab, 'notification:read');
  const ivyQuiet = noEvent(ivySocket, 'notification:read');

  const res = await as(leo).patch(`/api/notifications/${first._id}/read`);
  assert.equal(res.status, 200);
  assert.equal(res.body.unreadCount, 1);
  assert.deepEqual(await readEvent, { notificationId: first._id, unreadCount: 1 });
  await ivyQuiet;

  const quietRepeat = noEvent(otherTab, 'notification:read');
  assert.equal((await as(leo).patch(`/api/notifications/${first._id}/read`)).status, 200);
  await quietRepeat;

  // Someone else cannot mark it, and gets no event.
  assert.equal((await as(ivy).patch(`/api/notifications/${first._id}/read`)).status, 404);
});

test('A socket without a valid session cannot connect, so it never receives notifications', async () => {
  const socket = open('not-a-token');
  await assert.rejects(connected(socket));
});
