import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import request from 'supertest';

// Each test file runs in its own process. Call setup() in before() and teardown() in after().
let memoryServer = null;
let uploadDir = null;

export async function setup() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
  process.env.CLIENT_ORIGIN = 'http://localhost:5173';
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devorbit-uploads-'));
  process.env.UPLOAD_DIR = uploadDir;

  // CI can point at a real MongoDB with MONGODB_URI_TEST; otherwise an in-memory server is started.
  let uri = process.env.MONGODB_URI_TEST;
  if (!uri) {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri('devorbit_test');
  } else {
    // Unique database per test process so files cannot interfere with each other.
    const url = new URL(uri);
    url.pathname = `/devorbit_test_${process.pid}`;
    uri = url.toString();
  }
  await mongoose.connect(uri);
  await mongoose.connection.dropDatabase();
  // Make sure unique indexes exist before the first request (duplicate-email tests rely on them).
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));

  const { createApp } = await import('../src/app.js');
  return { app: createApp(), uploadDir };
}

export async function teardown() {
  await mongoose.connection.dropDatabase().catch(() => {});
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
  if (uploadDir) fs.rmSync(uploadDir, { recursive: true, force: true });
}

let counter = 0;
export async function signup(app, name = 'Test User') {
  counter += 1;
  const email = `user${counter}-${process.pid}@example.com`;
  const password = 'correct horse battery';
  const res = await request(app).post('/api/auth/signup').send({ name, email, password });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { email, password, token: res.body.accessToken, user: res.body.user, cookies: res.headers['set-cookie'] };
}

export const authed = (app, token) => ({
  get: (url) => request(app).get(url).set('Authorization', `Bearer ${token}`),
  post: (url) => request(app).post(url).set('Authorization', `Bearer ${token}`),
  patch: (url) => request(app).patch(url).set('Authorization', `Bearer ${token}`),
  delete: (url) => request(app).delete(url).set('Authorization', `Bearer ${token}`),
});

// Smallest valid-looking files: real signatures followed by padding. Enough for signature checks.
export const jpegBytes = (size = 1024) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size - 4, 1)]);
export const pngBytes = (size = 1024) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(size - 8, 1)]);
