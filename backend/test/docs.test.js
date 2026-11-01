// [Sprint 4 · M6] US-38: write a Markdown documentation page; every project member can read it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, teardown, signup, authed } from './helpers.js';
import DocPage from '../src/models/DocPage.js';

let app;
let owner, admin, contributor, viewer, outsider;
let projectId, otherProjectId;

const as = (account) => authed(app, account.token);
const docs = (id = projectId) => `/api/projects/${id}/docs`;
const markdown = '# Setup\n\nRun **npm install**, then `npm test`.\n\n- backend\n- frontend\n';

before(async () => {
  ({ app } = await setup());
  [owner, admin, contributor, viewer, outsider] = await Promise.all(
    ['Docs Owner', 'Docs Admin', 'Docs Contributor', 'Docs Viewer', 'Docs Outsider'].map((name) => signup(app, name))
  );

  const project = await as(owner).post('/api/projects').send({ name: 'Docs Project', visibility: 'Public' });
  assert.equal(project.status, 201, JSON.stringify(project.body));
  projectId = project.body.project._id;
  for (const [account, role] of [[admin, 'Admin'], [contributor, 'Contributor'], [viewer, 'Viewer']]) {
    const res = await as(owner).post(`/api/projects/${projectId}/members`).send({ identifier: account.user.username, role });
    assert.equal(res.status, 201, JSON.stringify(res.body));
  }

  const other = await as(outsider).post('/api/projects').send({ name: 'Other Docs Project', visibility: 'Public' });
  otherProjectId = other.body.project._id;
});

after(async () => {
  await teardown();
});

// --- US-38 acceptance criteria -------------------------------------------------------------

test('AC1: a Contributor writes Markdown and saves; the page is listed under the project documentation', async () => {
  const res = await as(contributor).post(docs()).send({ title: 'Getting started', content: markdown });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const { doc } = res.body;
  assert.equal(doc.title, 'Getting started');
  assert.equal(doc.content, markdown);
  assert.equal(doc.createdBy._id, contributor.user.id);
  assert.equal(doc.createdBy.name, 'Docs Contributor');
  assert.equal(doc.updatedBy, null);
  assert.equal(doc.length, markdown.length);

  const list = await as(contributor).get(docs());
  assert.equal(list.status, 200);
  assert.ok(list.body.docs.some((d) => d._id === doc._id && d.title === 'Getting started'));
});

test('AC2: every project member (Viewer too) can open and read a page', async () => {
  const created = (await as(owner).post(docs()).send({ title: 'Architecture', content: markdown })).body.doc;
  for (const account of [owner, admin, contributor, viewer]) {
    const res = await as(account).get(`${docs()}/${created._id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.doc.content, markdown);
    assert.equal(res.body.doc.title, 'Architecture');
  }
});

test('AC3: content over 10,000 characters is refused by the server and nothing is saved', async () => {
  const before = await DocPage.countDocuments({ project: projectId });
  const tooLong = await as(contributor).post(docs()).send({ title: 'Too long', content: 'a'.repeat(10001) });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.body.message, 'Content must be 10,000 characters or fewer.');
  assert.equal(await DocPage.countDocuments({ project: projectId }), before);

  const exact = await as(contributor).post(docs()).send({ title: 'Exactly at the limit', content: 'a'.repeat(10000) });
  assert.equal(exact.status, 201);
  assert.equal(exact.body.doc.content.length, 10000);
});

test('AC4: Viewers get 403 when creating or saving a page', async () => {
  const created = (await as(owner).post(docs()).send({ title: 'Viewer target', content: 'Original' })).body.doc;
  const post = await as(viewer).post(docs()).send({ title: 'Nope', content: 'Nope' });
  assert.equal(post.status, 403);
  const patch = await as(viewer).patch(`${docs()}/${created._id}`).send({ content: 'Changed' });
  assert.equal(patch.status, 403);
  assert.equal((await DocPage.findById(created._id).lean()).content, 'Original');
});

test('AC4: non-members get 403 for list, read, create and save, even on a Public project', async () => {
  const created = (await as(owner).post(docs()).send({ title: 'Members only', content: 'Secret plan' })).body.doc;
  assert.equal((await as(outsider).get(docs())).status, 403);
  assert.equal((await as(outsider).get(`${docs()}/${created._id}`)).status, 403);
  assert.equal((await as(outsider).post(docs()).send({ title: 'x', content: 'y' })).status, 403);
  assert.equal((await as(outsider).patch(`${docs()}/${created._id}`).send({ content: 'y' })).status, 403);
});

test('AC5: HTML and script text are stored exactly as written, as plain text', async () => {
  const content = '<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[x](javascript:alert(1))';
  const res = await as(contributor).post(docs()).send({ title: 'Unsafe looking', content });
  assert.equal(res.status, 201);
  const read = await as(viewer).get(`${docs()}/${res.body.doc._id}`);
  assert.equal(read.body.doc.content, content);
  assert.equal(res.headers['content-type'].startsWith('application/json'), true);
});

// --- Saving (editing) ------------------------------------------------------------------------

test('a Contributor saves changes to a page; the new content and who edited it are shown', async () => {
  const created = (await as(owner).post(docs()).send({ title: 'Draft', content: 'Old text' })).body.doc;
  const res = await as(contributor).patch(`${docs()}/${created._id}`).send({ title: 'Final', content: '## New text' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.doc.title, 'Final');
  assert.equal(res.body.doc.content, '## New text');
  assert.equal(res.body.doc.updatedBy._id, contributor.user.id);
  assert.equal(res.body.doc.createdBy._id, owner.user.id);

  const onlyTitle = await as(admin).patch(`${docs()}/${created._id}`).send({ title: 'Final v2' });
  assert.equal(onlyTitle.body.doc.content, '## New text');
  assert.equal(onlyTitle.body.doc.updatedBy._id, admin.user.id);
});

test('a save with an invalid field is refused and changes nothing', async () => {
  const created = (await as(owner).post(docs()).send({ title: 'Keep me', content: 'Keep this' })).body.doc;
  for (const body of [{ title: '' }, { content: '   ' }, { content: 'a'.repeat(10001) }, { title: 'Changed', content: 'b'.repeat(10001) }]) {
    const res = await as(contributor).patch(`${docs()}/${created._id}`).send(body);
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
  }
  const saved = await DocPage.findById(created._id).lean();
  assert.equal(saved.title, 'Keep me');
  assert.equal(saved.content, 'Keep this');
  assert.equal(saved.updatedBy, null);
});

test('missing fields on create give 400 and nothing is saved', async () => {
  const before = await DocPage.countDocuments({ project: projectId });
  assert.equal((await as(contributor).post(docs()).send({ content: 'No title' })).status, 400);
  assert.equal((await as(contributor).post(docs()).send({ title: 'No content' })).status, 400);
  assert.equal((await as(contributor).post(docs()).send({ title: 'Blank', content: '\n\n' })).status, 400);
  assert.equal(await DocPage.countDocuments({ project: projectId }), before);
});

test('Owners and Admins can write too', async () => {
  assert.equal((await as(owner).post(docs()).send({ title: 'By owner', content: 'x' })).status, 201);
  assert.equal((await as(admin).post(docs()).send({ title: 'By admin', content: 'x' })).status, 201);
});

// --- List ------------------------------------------------------------------------------------

test('the list has title, preview and authors but not the full content, most recently updated first', async () => {
  const older = (await as(owner).post(docs()).send({ title: 'Older page', content: '# Old\nSome **old** notes' })).body.doc;
  await as(owner).post(docs()).send({ title: 'Newer page', content: 'New notes' });
  await as(contributor).patch(`${docs()}/${older._id}`).send({ content: '# Old\nUpdated **notes**' });

  const res = await as(viewer).get(docs());
  assert.equal(res.status, 200);
  const [first] = res.body.docs;
  assert.equal(first.title, 'Older page');
  assert.equal(first.preview, 'Old Updated notes');
  assert.equal(first.updatedBy.name, 'Docs Contributor');
  assert.ok(res.body.docs.every((d) => !('content' in d)));
  const times = res.body.docs.map((d) => d.updatedAt);
  assert.deepEqual(times, [...times].sort().reverse());
});

// --- IDs -------------------------------------------------------------------------------------

test('bad IDs give 400 and a page of another project gives 404', async () => {
  assert.equal((await as(owner).get(`${docs()}/not-an-id`)).status, 400);
  const elsewhere = (await as(outsider).post(docs(otherProjectId)).send({ title: 'Theirs', content: 'x' })).body.doc;
  assert.equal((await as(owner).get(`${docs()}/${elsewhere._id}`)).status, 404);
  assert.equal((await as(owner).patch(`${docs()}/${elsewhere._id}`).send({ title: 'Hijack' })).status, 404);
  assert.equal((await DocPage.findById(elsewhere._id).lean()).title, 'Theirs');
});
