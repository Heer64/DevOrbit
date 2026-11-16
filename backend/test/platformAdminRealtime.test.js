// [Sprint 6 · M8] US-58 AC1 for live connections: suspending an account closes its open Socket.IO connections at
// once, and a suspended account cannot open a new one (same check as the REST API).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as connect } from 'socket.io-client';
import { setup, teardown, signup, authed } from './helpers.js';
import { initRealtime, closeRealtime } from '../src/lib/realtime.js';
import User from '../src/models/User.js';

let app;
let server;
let baseUrl;
let admin, member, other;
const sockets = [];

function open(token) {
  const socket = connect(baseUrl, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
  sockets.push(socket);
  return socket;
}

function connected(socket) {
  return new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
}

function disconnected(socket, ms = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`still connected after ${ms} ms`)), ms);
    socket.once('disconnect', (reason) => {
      clearTimeout(timer);
      resolve(reason);
    });
  });
}

before(async () => {
  ({ app } = await setup());
  server = http.createServer(app);
  initRealtime(server, { origins: ['http://localhost:5173'] });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  [admin, member, other] = await Promise.all(['Ada Admin', 'Mel Member', 'Oli Other'].map((name) => signup(app, name)));
  await User.updateOne({ _id: admin.user.id }, { $set: { platformRole: 'admin' } });
});

after(async () => {
  for (const socket of sockets) socket.disconnect();
  await closeRealtime();
  await teardown();
});

test('suspending closes every open live connection of that account, and only of that account', async () => {
  const tabA = open(member.token);
  const tabB = open(member.token);
  const bystander = open(other.token);
  await Promise.all([connected(tabA), connected(tabB), connected(bystander)]);

  const closedA = disconnected(tabA);
  const closedB = disconnected(tabB);
  const res = await authed(app, admin.token).post(`/api/admin/users/${member.user.id}/suspend`);
  assert.equal(res.status, 200);
  assert.equal(await closedA, 'io server disconnect');
  assert.equal(await closedB, 'io server disconnect');
  assert.equal(bystander.connected, true, 'other users stay connected');
});

test('a suspended account cannot open a new live connection, even with a token it still holds', async () => {
  // Suspended directly (sessions kept), so only the account check can refuse it.
  const late = await signup(app, 'Lou Late');
  await User.updateOne({ _id: late.user.id }, { $set: { suspendedAt: new Date() } });
  await assert.rejects(connected(open(late.token)), /Authentication required/);

  // Once the account is active again, the same check lets it in.
  await User.updateOne({ _id: late.user.id }, { $set: { suspendedAt: null } });
  await connected(open(late.token));
});
