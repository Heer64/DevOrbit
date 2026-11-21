// [Sprint 7 · M5] Change password: the live connections (Socket.IO) of the OTHER sessions are closed and cannot
// reconnect; the browser that made the change stays connected.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import request from 'supertest';
import { io as connect } from 'socket.io-client';
import { setup, teardown, signup, authed } from './helpers.js';
import { initRealtime, closeRealtime } from '../src/lib/realtime.js';

let app;
let server;
let baseUrl;
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

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

before(async () => {
  ({ app } = await setup());
  server = http.createServer(app);
  initRealtime(server, { origins: ['http://localhost:5173'] });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  for (const socket of sockets) socket.disconnect();
  await closeRealtime();
  await teardown();
});

test('other sessions lose their live connection; this session and other users keep theirs', async () => {
  const account = await signup(app, 'Live Changer');
  const login = await request(app).post('/api/auth/login').send({ email: account.email, password: account.password });
  const otherToken = login.body.accessToken;
  const bystander = await signup(app, 'Live Bystander');

  const mine = open(account.token);
  const mineSecondTab = open(account.token); // same session, another tab
  const elsewhere = open(otherToken);
  const someoneElse = open(bystander.token);
  await Promise.all([connected(mine), connected(mineSecondTab), connected(elsewhere), connected(someoneElse)]);

  const closed = disconnected(elsewhere);
  const res = await authed(app, account.token)
    .post('/api/settings/password')
    .send({ currentPassword: account.password, newPassword: 'another new password' });
  assert.equal(res.status, 200);
  assert.equal(await closed, 'io server disconnect');

  await wait(100);
  assert.equal(mine.connected, true, 'the browser that changed the password stays connected');
  assert.equal(mineSecondTab.connected, true, 'its other tabs share the session and stay too');
  assert.equal(someoneElse.connected, true, 'other users are not affected');

  // The ended session cannot open a new live connection with the token it still holds.
  await assert.rejects(connected(open(otherToken)), /Authentication required/);
});
