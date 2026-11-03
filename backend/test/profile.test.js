import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import request from 'supertest';
import { setup, teardown, signup, authed, jpegBytes, pngBytes } from './helpers.js';

let app;
let uploadDir;
let me;
before(async () => { ({ app, uploadDir } = await setup()); me = await signup(app, 'Profile User'); });
after(teardown);

const upload = (token, buffer, filename, contentType) =>
  request(app).post('/api/profile/me/avatar').set('Authorization', `Bearer ${token}`).attach('avatar', buffer, { filename, contentType });

// [Sprint 1 · gaps] Photos are stored in MongoDB GridFS (bucket "avatars"), not in the uploads folder.
const storedPhotos = (avatarUrl) =>
  mongoose.connection.db.collection('avatars.files').countDocuments({ filename: path.basename(avatarUrl) });
const onDisk = (avatarUrl) => fs.existsSync(path.join(uploadDir, 'avatars', path.basename(avatarUrl)));

test('US-05 bio can be exactly 500 characters but not 501', async () => {
  const ok = await authed(app, me.token).patch('/api/profile/me').send({ bio: 'a'.repeat(500) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.bio.length, 500);
  const tooLong = await authed(app, me.token).patch('/api/profile/me').send({ bio: 'a'.repeat(501) });
  assert.equal(tooLong.status, 400);
});

test('US-05 skills: 10 are allowed, 11 are not, duplicates collapse', async () => {
  const ten = Array.from({ length: 10 }, (_, i) => `skill-${i}`);
  const ok = await authed(app, me.token).patch('/api/profile/me').send({ skills: ten });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.skills.length, 10);
  const eleven = await authed(app, me.token).patch('/api/profile/me').send({ skills: [...ten, 'skill-10'] });
  assert.equal(eleven.status, 400);
  const dupes = await authed(app, me.token).patch('/api/profile/me').send({ skills: ['React', 'React', ' React '] });
  assert.deepEqual(dupes.body.user.skills, ['React']);
  const longSkill = await authed(app, me.token).patch('/api/profile/me').send({ skills: ['x'.repeat(41)] });
  assert.equal(longSkill.status, 400);
});

test('US-05 avatarUrl cannot be set through the profile PATCH', async () => {
  const res = await authed(app, me.token).patch('/api/profile/me').send({ avatarUrl: 'https://evil.example/x.png' });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.avatarUrl, '');
});

test('US-05 a JPEG under 2 MB uploads and is served back', async () => {
  const res = await upload(me.token, jpegBytes(5000), 'me.jpg', 'image/jpeg');
  assert.equal(res.status, 200);
  assert.match(res.body.user.avatarUrl, /^\/uploads\/avatars\/[a-f0-9]{24}-[a-f0-9]{16}\.jpg$/);
  const file = await request(app).get(res.body.user.avatarUrl);
  assert.equal(file.status, 200);
  assert.equal(file.headers['content-type'], 'image/jpeg');
  assert.equal(file.headers['x-content-type-options'], 'nosniff');
  assert.equal(file.body.length, 5000);
});

test('Sprint 1 D: an uploaded photo is kept in MongoDB, not on the server disk', async () => {
  const res = await upload(me.token, pngBytes(3000), 'p.png', 'image/png');
  assert.equal(res.status, 200);
  assert.equal(await storedPhotos(res.body.user.avatarUrl), 1);
  assert.equal(onDisk(res.body.user.avatarUrl), false);
  const file = await request(app).get(res.body.user.avatarUrl);
  assert.equal(file.status, 200);
  assert.equal(file.headers['content-type'], 'image/png');
  assert.match(file.headers['cache-control'], /immutable/);
});

test('Sprint 1 D: a photo saved in the old uploads folder is still served', async () => {
  const name = `${'a'.repeat(24)}-${'b'.repeat(16)}.jpg`;
  fs.mkdirSync(path.join(uploadDir, 'avatars'), { recursive: true });
  fs.writeFileSync(path.join(uploadDir, 'avatars', name), jpegBytes(700));
  const file = await request(app).get(`/uploads/avatars/${name}`);
  assert.equal(file.status, 200);
  assert.equal(file.headers['content-type'], 'image/jpeg');
  const missing = await request(app).get(`/uploads/avatars/${'c'.repeat(24)}-${'d'.repeat(16)}.png`);
  assert.equal(missing.status, 404);
});

test('US-05 a PNG uploads, and replacing the photo deletes the old file', async () => {
  const first = await upload(me.token, jpegBytes(2000), 'a.jpg', 'image/jpeg');
  assert.equal(await storedPhotos(first.body.user.avatarUrl), 1);
  const second = await upload(me.token, pngBytes(2000), 'b.png', 'image/png');
  assert.equal(second.status, 200);
  assert.match(second.body.user.avatarUrl, /\.png$/);
  assert.equal(await storedPhotos(first.body.user.avatarUrl), 0);
  assert.equal((await request(app).get(first.body.user.avatarUrl)).status, 404);
});

test('US-05 a photo of exactly 2 MB is accepted and one byte over is refused with 413', async () => {
  const exact = await upload(me.token, pngBytes(2 * 1024 * 1024), 'exact.png', 'image/png');
  assert.equal(exact.status, 200);
  const over = await upload(me.token, pngBytes(2 * 1024 * 1024 + 1), 'big.png', 'image/png');
  assert.equal(over.status, 413);
});

test('US-05 non-JPEG/PNG files are refused with 415', async () => {
  const gif = await upload(me.token, Buffer.from('GIF89a' + 'x'.repeat(100)), 'a.gif', 'image/gif');
  assert.equal(gif.status, 415);
  const svg = await upload(me.token, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'a.svg', 'image/svg+xml');
  assert.equal(svg.status, 415);
});

test('US-05 a file that only claims to be an image is refused', async () => {
  const fakeJpeg = await upload(me.token, Buffer.from('<?php echo 1; ?>' + 'x'.repeat(100)), 'shell.jpg', 'image/jpeg');
  assert.equal(fakeJpeg.status, 415);
  // Real PNG bytes sent as image/jpeg do not match the declared type.
  const mismatch = await upload(me.token, pngBytes(500), 'x.jpg', 'image/jpeg');
  assert.equal(mismatch.status, 415);
});

test('US-05 upload needs a file, a field called avatar and a signed-in user', async () => {
  const none = await request(app).post('/api/profile/me/avatar').set('Authorization', `Bearer ${me.token}`);
  assert.equal(none.status, 400);
  const wrongField = await request(app).post('/api/profile/me/avatar').set('Authorization', `Bearer ${me.token}`)
    .attach('photo', jpegBytes(500), { filename: 'a.jpg', contentType: 'image/jpeg' });
  assert.equal(wrongField.status, 400);
  const anon = await request(app).post('/api/profile/me/avatar').attach('avatar', jpegBytes(500), { filename: 'a.jpg', contentType: 'image/jpeg' });
  assert.equal(anon.status, 401);
});

test('US-05 the photo can be removed', async () => {
  const up = await upload(me.token, jpegBytes(900), 'a.jpg', 'image/jpeg');
  assert.equal(await storedPhotos(up.body.user.avatarUrl), 1);
  const del = await authed(app, me.token).delete('/api/profile/me/avatar');
  assert.equal(del.status, 200);
  assert.equal(del.body.user.avatarUrl, '');
  assert.equal(await storedPhotos(up.body.user.avatarUrl), 0);
});

test('users only change their own profile', async () => {
  const other = await signup(app, 'Other Person');
  await authed(app, other.token).patch('/api/profile/me').send({ bio: 'other bio' });
  const mine = await authed(app, me.token).get('/api/profile/me');
  assert.notEqual(mine.body.user.bio, 'other bio');
});
