// [Sprint 4 · M5] US-37 Upload a project file (FR-14a, NFR-8): upload, list, download, 10 MB limit.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import ProjectFile from '../src/models/ProjectFile.js';
import Activity from '../src/models/Activity.js';
import {
  FILES_BUCKET,
  FILE_TOO_LARGE_MESSAGE,
  MAX_PROJECT_FILE_BYTES,
  cleanContentType,
  cleanFileName,
  deleteFileBytes,
} from '../src/lib/projectFiles.js';
import { canUploadFiles } from '../src/lib/permissions.js';

let app;
let uploadDir;
let owner, admin, contributor, viewer, outsider;
let projectId, otherProjectId;

const as = (account) => authed(app, account.token);
const filesUrl = (id = projectId) => `/api/projects/${id}/files`;

const upload = (account, buffer, filename = 'notes.txt', contentType = 'text/plain', id = projectId) =>
  request(app).post(filesUrl(id)).set('Authorization', `Bearer ${account.token}`).attach('file', buffer, { filename, contentType });

// supertest keeps binary bodies as Buffers only with a parser.
const download = (account, url) =>
  request(app).get(url).set('Authorization', `Bearer ${account.token}`)
    .buffer(true)
    .parse((res, callback) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => callback(null, Buffer.concat(chunks)));
    });

const storedChunks = () => mongoose.connection.db.collection(`${FILES_BUCKET}.chunks`).countDocuments();
const storedFiles = () => mongoose.connection.db.collection(`${FILES_BUCKET}.files`).countDocuments();

before(async () => {
  ({ app, uploadDir } = await setup());
  [owner, admin, contributor, viewer, outsider] = await Promise.all(
    ['Fay Owner', 'Fin Admin', 'Flo Contributor', 'Fox Viewer', 'Fez Outsider'].map((name) => signup(app, name))
  );

  // Public on purpose: files are still members-only.
  const project = await as(owner).post('/api/projects').send({ name: 'Files Project', visibility: 'Public' });
  assert.equal(project.status, 201, JSON.stringify(project.body));
  projectId = project.body.project._id;
  for (const [account, role] of [[admin, 'Admin'], [contributor, 'Contributor'], [viewer, 'Viewer']]) {
    const res = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }

  const other = await as(outsider).post('/api/projects').send({ name: 'Other Files Project' });
  otherProjectId = other.body.project._id;
});

after(async () => {
  await teardown();
});

// --- US-37 acceptance criteria ---------------------------------------------------------------

test('AC1: a Contributor uploads a file of 10 MB or less; it is listed and members can download it', async () => {
  const bytes = Buffer.from('Sprint 4 meeting notes\nUpload works.\n');
  const res = await upload(contributor, bytes, 'meeting-notes.txt', 'text/plain');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const { file } = res.body;
  assert.equal(file.name, 'meeting-notes.txt');
  assert.equal(file.size, bytes.length);
  assert.equal(file.contentType, 'text/plain');
  assert.equal(file.project, projectId);
  assert.equal(file.uploadedBy._id, contributor.user.id);
  assert.equal(file.uploadedBy.name, 'Flo Contributor');
  assert.equal(file.downloadUrl, `/api/projects/${projectId}/files/${file._id}/download`);
  assert.equal(file.storageId, undefined, 'the storage id stays on the server');

  // Listed in the project's files.
  const list = await as(viewer).get(filesUrl());
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.ok(list.body.files.some((row) => row._id === file._id && row.name === 'meeting-notes.txt'));

  // Every member role can download it, byte for byte.
  for (const account of [owner, admin, contributor, viewer]) {
    const got = await download(account, file.downloadUrl);
    assert.equal(got.status, 200, `role download failed: ${got.status}`);
    assert.deepEqual(got.body, bytes);
    assert.equal(got.headers['content-type'], 'application/octet-stream');
    assert.match(got.headers['content-disposition'], /^attachment; filename="meeting-notes\.txt"/);
    assert.equal(got.headers['x-content-type-options'], 'nosniff');
    assert.equal(got.headers['content-length'], String(bytes.length));
  }
});

test('AC1: a file of exactly 10 MB is accepted and downloads intact', async () => {
  const bytes = Buffer.alloc(MAX_PROJECT_FILE_BYTES, 7);
  bytes[0] = 1; bytes[bytes.length - 1] = 9;
  const res = await upload(owner, bytes, 'exactly-10mb.bin', 'application/octet-stream');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.file.size, MAX_PROJECT_FILE_BYTES);

  const got = await download(admin, res.body.file.downloadUrl);
  assert.equal(got.status, 200);
  assert.equal(got.body.length, MAX_PROJECT_FILE_BYTES);
  assert.ok(got.body.equals(bytes));
});

test('AC2: a file larger than 10 MB is rejected with a message stating the 10 MB limit, and nothing is stored', async () => {
  const recordsBefore = await ProjectFile.countDocuments({ project: projectId });
  const filesBefore = await storedFiles();
  const chunksBefore = await storedChunks();

  const res = await upload(contributor, Buffer.alloc(MAX_PROJECT_FILE_BYTES + 1, 1), 'too-big.zip', 'application/zip');
  assert.equal(res.status, 413, JSON.stringify(res.body));
  assert.equal(res.body.message, FILE_TOO_LARGE_MESSAGE);
  assert.match(res.body.message, /10 MB/);
  assert.equal(res.body.code, 'file_too_large');
  assert.equal(res.body.maxBytes, MAX_PROJECT_FILE_BYTES);

  assert.equal(await ProjectFile.countDocuments({ project: projectId }), recordsBefore);
  assert.equal(await storedFiles(), filesBefore);
  assert.equal(await storedChunks(), chunksBefore);
  const list = await as(contributor).get(filesUrl());
  assert.ok(!list.body.files.some((row) => row.name === 'too-big.zip'));
});

// --- NFR-8: persistent external storage --------------------------------------------------------

test('NFR-8: bytes are stored in MongoDB GridFS, not on the server disk', async () => {
  const res = await upload(admin, Buffer.from('stored in gridfs'), 'gridfs.txt');
  assert.equal(res.status, 201);
  const record = await ProjectFile.findById(res.body.file._id).lean();
  const stored = await mongoose.connection.db.collection(`${FILES_BUCKET}.files`).findOne({ _id: record.storageId });
  assert.ok(stored, 'GridFS has the file');
  assert.equal(stored.length, 'stored in gridfs'.length);
  assert.equal(String(stored.metadata.project), projectId);

  // The local upload folder (used by profile photos) gets nothing.
  const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [entry.name])) : []);
  assert.ok(!walk(uploadDir).some((name) => name.includes('gridfs')), 'no copy on local disk');
});

test('the list is newest first and includes the 10 MB limit and upload permission', async () => {
  const first = await upload(owner, Buffer.from('a'), 'order-1.txt');
  const second = await upload(owner, Buffer.from('b'), 'order-2.txt');
  assert.equal(first.status, 201); assert.equal(second.status, 201);

  const list = await as(owner).get(filesUrl());
  assert.equal(list.status, 200);
  const names = list.body.files.map((row) => row.name);
  assert.ok(names.indexOf('order-2.txt') < names.indexOf('order-1.txt'));
  assert.equal(list.body.maxBytes, MAX_PROJECT_FILE_BYTES);
  assert.equal(list.body.membershipRole, 'Owner');
  assert.equal(list.body.canUpload, true);

  const viewerList = await as(viewer).get(filesUrl());
  assert.equal(viewerList.body.membershipRole, 'Viewer');
  assert.equal(viewerList.body.canUpload, false);
});

test('every upload is logged in the Activity Feed as file.uploaded', async () => {
  const res = await upload(contributor, Buffer.from('feed'), 'feed-entry.md', 'text/markdown');
  assert.equal(res.status, 201);
  const event = await Activity.findOne({ project: projectId, type: 'file.uploaded', targetId: res.body.file._id }).lean();
  assert.ok(event, 'activity logged');
  assert.equal(String(event.actor), contributor.user.id);
  assert.equal(event.summary, 'uploaded file "feed-entry.md"');
  assert.equal(event.targetType, 'file');
  assert.equal(event.meta.size, 4);

  const feed = await as(owner).get(`/api/projects/${projectId}/activity?limit=50`);
  assert.equal(feed.status, 200);
  assert.ok(feed.body.activity.some((row) => row.type === 'file.uploaded' && row.targetLabel === 'feed-entry.md'));
});

// --- Permissions --------------------------------------------------------------------------------

test('Owner and Admin can upload; a Viewer gets 403 and nothing is stored', async () => {
  assert.equal((await upload(owner, Buffer.from('o'), 'owner.txt')).status, 201);
  assert.equal((await upload(admin, Buffer.from('a'), 'admin.txt')).status, 201);

  const before = await ProjectFile.countDocuments({ project: projectId });
  const res = await upload(viewer, Buffer.from('v'), 'viewer.txt');
  assert.equal(res.status, 403);
  assert.match(res.body.message, /Viewers can download project files but cannot upload/);
  assert.equal(await ProjectFile.countDocuments({ project: projectId }), before);
});

test('non-members cannot list, upload or download, even on a Public project', async () => {
  const mine = await upload(owner, Buffer.from('private bytes'), 'members-only.txt');
  assert.equal(mine.status, 201);

  assert.equal((await as(outsider).get(filesUrl())).status, 403);
  assert.equal((await upload(outsider, Buffer.from('x'), 'intruder.txt')).status, 403);
  assert.equal((await download(outsider, mine.body.file.downloadUrl)).status, 403);
});

test('signed-out requests get 401', async () => {
  assert.equal((await request(app).get(filesUrl())).status, 401);
  assert.equal((await request(app).post(filesUrl()).attach('file', Buffer.from('x'), 'x.txt')).status, 401);
});

test('a file from another project cannot be downloaded through this project (404)', async () => {
  const theirs = await upload(outsider, Buffer.from('theirs'), 'theirs.txt', 'text/plain', otherProjectId);
  assert.equal(theirs.status, 201, JSON.stringify(theirs.body));
  const res = await download(owner, `/api/projects/${projectId}/files/${theirs.body.file._id}/download`);
  assert.equal(res.status, 404);
});

// --- Input checks ---------------------------------------------------------------------------------

test('upload needs exactly one non-empty file in the "file" field', async () => {
  const none = await request(app).post(filesUrl()).set('Authorization', `Bearer ${owner.token}`);
  assert.equal(none.status, 400);
  assert.equal(none.body.message, 'Choose a file to upload.');

  const json = await as(owner).post(filesUrl()).send({ name: 'not a file' });
  assert.equal(json.status, 400);

  const empty = await upload(owner, Buffer.alloc(0), 'empty.txt');
  assert.equal(empty.status, 400);
  assert.match(empty.body.message, /empty/);

  const wrongField = await request(app).post(filesUrl()).set('Authorization', `Bearer ${owner.token}`)
    .attach('document', Buffer.from('x'), 'x.txt');
  assert.equal(wrongField.status, 400);
  assert.match(wrongField.body.message, /one file/);

  const two = await request(app).post(filesUrl()).set('Authorization', `Bearer ${owner.token}`)
    .attach('file', Buffer.from('1'), 'one.txt')
    .attach('file', Buffer.from('2'), 'two.txt');
  assert.equal(two.status, 400);

  const extraField = await request(app).post(filesUrl()).set('Authorization', `Bearer ${owner.token}`)
    .field('note', 'hello')
    .attach('file', Buffer.from('1'), 'one.txt');
  assert.equal(extraField.status, 400);
});

test('bad IDs: invalid project 400, unknown project 404, invalid file 400, unknown file 404', async () => {
  assert.equal((await as(owner).get('/api/projects/not-an-id/files')).status, 400);
  assert.equal((await as(owner).get(`/api/projects/${new mongoose.Types.ObjectId()}/files`)).status, 404);
  assert.equal((await download(owner, `/api/projects/${projectId}/files/nope/download`)).status, 400);
  assert.equal((await download(owner, `/api/projects/${projectId}/files/${new mongoose.Types.ObjectId()}/download`)).status, 404);
});

test('a file whose bytes went missing from storage answers 404 with a clear message', async () => {
  const res = await upload(owner, Buffer.from('soon gone'), 'gone.txt');
  const record = await ProjectFile.findById(res.body.file._id).lean();
  await deleteFileBytes(record.storageId);
  const got = await download(owner, res.body.file.downloadUrl);
  assert.equal(got.status, 404);
});

test('unsafe file names are cleaned; non-English names survive', async () => {
  const traversal = await upload(owner, Buffer.from('x'), '../../etc/passwd', 'text/plain');
  assert.equal(traversal.status, 201);
  assert.equal(traversal.body.file.name, 'passwd');

  const hindi = await upload(owner, Buffer.from('x'), 'रिपोर्ट.pdf', 'application/pdf');
  assert.equal(hindi.status, 201);
  assert.equal(hindi.body.file.name, 'रिपोर्ट.pdf');
  const got = await download(owner, hindi.body.file.downloadUrl);
  assert.equal(got.status, 200);
  assert.match(got.headers['content-disposition'], /filename\*=UTF-8''%E0%A4%B0/);

  // Uploaded HTML is never served as a page.
  const html = await upload(owner, Buffer.from('<script>alert(1)</script>'), 'page.html', 'text/html');
  const page = await download(owner, html.body.file.downloadUrl);
  assert.equal(page.headers['content-type'], 'application/octet-stream');
  assert.match(page.headers['content-disposition'], /^attachment/);
});

// --- Pure helpers -----------------------------------------------------------------------------------

test('cleanFileName and cleanContentType', () => {
  assert.equal(cleanFileName('C:\\Users\\me\\report.pdf'), 'report.pdf');
  assert.equal(cleanFileName('../../etc/passwd'), 'passwd');
  assert.equal(cleanFileName('.env'), 'env');
  assert.equal(cleanFileName('  a\u0000b<c>.txt  '), 'abc.txt');
  assert.equal(cleanFileName(''), 'file');
  assert.equal(cleanFileName(undefined), 'file');
  const long = cleanFileName(`${'x'.repeat(300)}.pdf`);
  assert.equal(long.length, 200);
  assert.ok(long.endsWith('.pdf'));

  assert.equal(cleanContentType('Application/PDF'), 'application/pdf');
  assert.equal(cleanContentType('text/html; charset=utf-8'), 'application/octet-stream');
  assert.equal(cleanContentType(''), 'application/octet-stream');
});

test('canUploadFiles matches the role rules', () => {
  assert.equal(canUploadFiles('Owner'), true);
  assert.equal(canUploadFiles('Admin'), true);
  assert.equal(canUploadFiles('Contributor'), true);
  assert.equal(canUploadFiles('Viewer'), false);
  assert.equal(canUploadFiles(null), false);
});
