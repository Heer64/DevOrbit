// [Sprint 1 · gaps] Sprint 1 plan line A: database setup / seed process (src/seed/seedData.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { setup, teardown, signup, authed } from './helpers.js';
import User from '../src/models/User.js';
import Project from '../src/models/Project.js';
import Task from '../src/models/Task.js';
import Message from '../src/models/Message.js';
import Decision from '../src/models/Decision.js';
import DocPage from '../src/models/DocPage.js';
import TaskComment from '../src/models/TaskComment.js';
import Invitation from '../src/models/Invitation.js';
import JoinRequest from '../src/models/JoinRequest.js';
import Notification from '../src/models/Notification.js';
import ProjectFile from '../src/models/ProjectFile.js';
import PortfolioStat from '../src/models/PortfolioStat.js';
import GithubConnection from '../src/models/GithubConnection.js';
import GithubFeedKey from '../src/models/GithubFeedKey.js';
import GithubOAuthState from '../src/models/GithubOAuthState.js';
import GithubOAuthCancelledState from '../src/models/GithubOAuthCancelledState.js';
import WebhookDelivery from '../src/models/WebhookDelivery.js';
import Post from '../src/models/Post.js';
import PostVote from '../src/models/PostVote.js';
import PostVoteLog from '../src/models/PostVoteLog.js';
import PostCreateLog from '../src/models/PostCreateLog.js';
import PostReport from '../src/models/PostReport.js';
import Session from '../src/models/Session.js';
import PasswordResetToken from '../src/models/PasswordResetToken.js';
import { storeFileBytes, fileBytesExist } from '../src/lib/projectFiles.js';
import { storePostImage, postImageExists } from '../src/lib/postImages.js';
import { saveAvatar, findAvatar, AVATAR_URL_PREFIX } from '../src/lib/avatar.js';
import { seedDatabase, seedEmail, SEED_USERS } from '../src/seed/seedData.js';

let app;
let outsider;
before(async () => {
  ({ app } = await setup());
  outsider = await signup(app, 'Real Person');
});
after(teardown);

test('seed adds the demo team, projects with every role, tasks and messages', async () => {
  const result = await seedDatabase({ password: 'seed-password-123' });
  assert.equal(result.seeded, true);
  assert.equal(await User.countDocuments({ email: /@seed\.devorbit\.test$/ }), SEED_USERS.length);

  const orbit = await Project.findOne({ name: 'Orbit dashboard' }).lean();
  assert.ok(orbit);
  assert.deepEqual(orbit.members.map((m) => m.role).sort(), ['Admin', 'Contributor', 'Owner', 'Viewer']);
  assert.equal(orbit.domain, 'Developer tools');

  const statuses = (await Task.find({ project: orbit._id }).lean()).map((t) => t.status);
  for (const status of ['To do', 'In progress', 'Blocked', 'Done']) assert.ok(statuses.includes(status), status);
  assert.ok((await Message.countDocuments({ project: orbit._id })) >= 1);
});

test('a seed account can log in and sees its projects', async () => {
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: seedEmail('aarav'), password: 'seed-password-123' });
  assert.equal(login.status, 200);
  const list = await authed(app, login.body.accessToken).get('/api/projects');
  assert.deepEqual(list.body.projects.map((p) => p.name).sort(), ['CampusConnect', 'Orbit dashboard']);
});

test('running it again changes nothing', async () => {
  const before = await Project.countDocuments();
  const again = await seedDatabase({ password: 'seed-password-123' });
  assert.equal(again.seeded, false);
  assert.equal(await Project.countDocuments(), before);
});

test('--reset recreates only the seed data and leaves real users and projects alone', async () => {
  const mine = await authed(app, outsider.token).post('/api/projects').send({ name: 'Real project', domain: 'Research' });
  assert.equal(mine.status, 201);
  const riya = await User.findOne({ email: seedEmail('riya') }).lean();
  await Project.updateOne({ _id: mine.body.project._id }, { $push: { members: { user: riya._id, role: 'Viewer' } } });

  const result = await seedDatabase({ reset: true, password: 'seed-password-123' });
  assert.equal(result.seeded, true);
  assert.equal(result.removed.users, SEED_USERS.length);
  assert.equal(await Project.countDocuments({ name: 'Orbit dashboard' }), 1);
  assert.ok(await User.exists({ email: outsider.email }));

  const real = await Project.findById(mine.body.project._id).lean();
  assert.ok(real, 'the real project is kept');
  assert.equal(real.members.length, 1, 'the old seed user was taken out of it');
});

// [Fix] --reset used to leave behind everything testers made with the seed accounts (decisions, docs, files,
// notifications, posts, votes, ...), pointing at projects and users that no longer existed.
// The records are written straight into the collections (only the fields that matter here), so this
// test checks the clean-up itself and does not depend on every route's validation.
test('--reset also removes what testers made with seed accounts, and keeps real data right', async () => {
  const raw = (Model, doc) => Model.collection.insertOne(doc);
  const aarav = await User.findOne({ email: seedEmail('aarav') }).lean();
  const riya = await User.findOne({ email: seedEmail('riya') }).lean();
  const orbit = await Project.findOne({ name: 'Orbit dashboard' }).lean();
  const task = await Task.findOne({ project: orbit._id }).lean();
  const realProject = await Project.findOne({ name: 'Real project' }).lean();
  const outsiderId = new mongoose.Types.ObjectId(outsider.user.id);

  // Inside a seed project.
  await raw(Decision, { project: orbit._id, title: 'Use MongoDB', createdBy: aarav._id });
  await raw(DocPage, { project: orbit._id, title: 'Notes', content: 'x', createdBy: aarav._id });
  await raw(TaskComment, { project: orbit._id, task: task._id, author: riya._id, text: 'On it' });
  await raw(Invitation, { project: orbit._id, invitee: outsiderId, invitedBy: aarav._id, status: 'Pending' });
  await raw(GithubConnection, { project: orbit._id, authorizedBy: aarav._id });
  await raw(GithubFeedKey, { project: orbit._id, key: 'push:abc' });
  await raw(GithubOAuthCancelledState, { stateHash: 'cancelled-1', project: orbit._id, expiresAt: new Date(Date.now() + 60_000) });
  const fileBytes = await storeFileBytes({ buffer: Buffer.from('hello'), name: 'notes.txt', contentType: 'text/plain' });
  await raw(ProjectFile, { project: orbit._id, name: 'notes.txt', storageId: fileBytes, uploadedBy: aarav._id });
  await raw(WebhookDelivery, { deliveryId: 'delivery-1', event: 'push', projects: [orbit._id, realProject._id], receivedAt: new Date() });

  // Made by seed accounts elsewhere.
  await raw(Notification, { recipient: outsiderId, actor: aarav._id, project: realProject._id, type: 'x' });
  await raw(Notification, { recipient: outsiderId, actor: outsiderId, project: realProject._id, type: 'x' });
  await raw(JoinRequest, { project: realProject._id, user: aarav._id, status: 'Pending' });
  await raw(PortfolioStat, { user: aarav._id, project: realProject._id, computedAt: new Date() });
  await raw(GithubOAuthState, { stateHash: 'state-1', project: realProject._id, user: aarav._id, expiresAt: new Date(Date.now() + 60_000) });
  await raw(Session, { user: aarav._id, tokenHash: 'seed-session-1', expiresAt: new Date(Date.now() + 60_000) });
  await raw(PasswordResetToken, { user: aarav._id, tokenHash: 'seed-reset-1', expiresAt: new Date(Date.now() + 60_000), usedAt: null });
  await raw(PostVoteLog, { user: riya._id, createdAt: new Date() });
  await raw(PostCreateLog, { user: aarav._id, createdAt: new Date() });

  // A seed post with an image, voted on by the real user.
  const imageId = await storePostImage({ buffer: Buffer.from('png'), type: { ext: 'png', mime: 'image/png' }, userId: aarav._id });
  const seedPost = await raw(Post, { author: aarav._id, text: 'Seed post', image: { storageId: imageId, contentType: 'image/png' } });
  await raw(PostVote, { post: seedPost.insertedId, user: outsiderId, value: 1 });

  // A real post that a seed account up-voted and another one reported.
  const realPost = await raw(Post, { author: outsiderId, text: 'Real post', upvotes: 1, downvotes: 0, score: 1 });
  await raw(PostVote, { post: realPost.insertedId, user: riya._id, value: 1 });
  await raw(PostReport, { post: realPost.insertedId, reporter: aarav._id, reason: 'spam', status: 'open' });

  // A profile photo for a seed account (GridFS bucket "avatars").
  const avatarUrl = await saveAvatar(String(aarav._id), Buffer.from('photo'), 'png');
  await User.updateOne({ _id: aarav._id }, { $set: { avatarUrl } });

  const realNotifications = await Notification.countDocuments({ actor: outsiderId });

  const result = await seedDatabase({ reset: true, password: 'seed-password-123' });
  assert.equal(result.seeded, true);

  // Nothing is left inside the old seed project.
  for (const Model of [Decision, DocPage, TaskComment, Invitation, ProjectFile, GithubConnection, GithubFeedKey, GithubOAuthCancelledState]) {
    assert.equal(await Model.countDocuments({ project: orbit._id }), 0, `${Model.modelName} of the old seed project`);
  }
  assert.equal(await fileBytesExist(fileBytes), false, 'the file bytes are deleted from GridFS');

  // Nothing is left that the old seed accounts made.
  const oldSeedIds = [aarav._id, riya._id];
  assert.equal(await Notification.countDocuments({ actor: { $in: oldSeedIds } }), 0);
  assert.equal(await JoinRequest.countDocuments({ user: { $in: oldSeedIds } }), 0);
  assert.equal(await PortfolioStat.countDocuments({ user: { $in: oldSeedIds } }), 0);
  assert.equal(await GithubOAuthState.countDocuments({ user: { $in: oldSeedIds } }), 0);
  assert.equal(await Session.countDocuments({ user: { $in: oldSeedIds } }), 0, 'sessions, including the earlier login');
  assert.equal(await PasswordResetToken.countDocuments({ user: { $in: oldSeedIds } }), 0, 'password reset links');
  assert.equal(await PostVoteLog.countDocuments({ user: { $in: oldSeedIds } }), 0);
  assert.equal(await PostCreateLog.countDocuments({ user: { $in: oldSeedIds } }), 0);
  assert.equal(await Post.countDocuments({ _id: seedPost.insertedId }), 0, 'the seed post');
  assert.equal(await PostVote.countDocuments({ post: seedPost.insertedId }), 0, 'votes on the seed post');
  assert.equal(await postImageExists(imageId), false, 'the post image is deleted from GridFS');
  assert.equal(await PostVote.countDocuments({ user: { $in: oldSeedIds } }), 0, 'votes by seed accounts');
  assert.equal(await PostReport.countDocuments({ reporter: { $in: oldSeedIds } }), 0, 'reports by seed accounts');
  assert.equal(await findAvatar(avatarUrl.slice(AVATAR_URL_PREFIX.length)), null, 'the profile photo is deleted from GridFS');

  // Real data is kept, and the real post's score no longer counts the removed seed vote.
  const post = await Post.findById(realPost.insertedId).lean();
  assert.ok(post, 'the real post is kept');
  assert.equal(post.upvotes, 0);
  assert.equal(post.score, 0);
  assert.equal(await Notification.countDocuments({ actor: outsiderId }), realNotifications, "the real user's own notifications are kept");
  const delivery = await WebhookDelivery.findOne({ deliveryId: 'delivery-1' }).lean();
  assert.deepEqual(delivery.projects.map(String), [String(realProject._id)], 'the delivery log keeps the real project only');
  assert.ok(await Project.exists({ _id: realProject._id }));
});

test('the seed password follows the sign-up rule', async () => {
  await assert.rejects(() => seedDatabase({ reset: true, password: 'short' }), /8 to 128/);
});
