import mongoose from 'mongoose';

import Follow from '../models/Follow.js';
import Project from '../models/Project.js';
import Task from '../models/Task.js';
import Message from '../models/Message.js';
import Decision from '../models/Decision.js';
import User from '../models/User.js';
import { followerCount } from './follows.js';
import {
  CONNECTIONS_PAGE_SIZE,
  PROFILE_PROJECT_LIMIT,
  SNAPSHOT_WEEK_MS,
  connectionsPage,
  snapshotView,
  visibleProfileProjects,
} from './profileConnectionsRules.js';

/*
 * [Sprint 7 · M4] Database side of the followers / following lists, the projects shown on a
 * profile, and the real "Contribution snapshot" on My profile (D6). Rules: lib/profileConnectionsRules.js.
 *
 *   followingCount(userId)                      -> number of users userId follows
 *   listConnections(kind, userId, page)         -> { people, total, page, pageSize, hasMore }
 *                                                  kind 'followers' | 'following', newest first
 *   profileProjects(profileUserId, viewerId)    -> [{ _id, name, ..., role, viewerIsMember, path }]
 *   contributionSnapshot(userId, now)           -> { projects, completedProjects, tasksCompleted,
 *                                                    tasksCompletedThisWeek, messagesPosted,
 *                                                    decisionsRecorded, collaborators,
 *                                                    followerCount, followingCount, joinedAt }
 */

const PERSON_FIELDS = 'name username headline avatarUrl';
const objectId = (id) => new mongoose.Types.ObjectId(String(id));

export async function followingCount(userId) {
  return Follow.countDocuments({ follower: userId });
}

export async function listConnections(kind, userId, page = 1) {
  // followers: rows pointing AT the user, show who follows. following: rows FROM the user, show whom.
  const filter = kind === 'followers' ? { following: userId } : { follower: userId };
  const personField = kind === 'followers' ? 'follower' : 'following';
  const [rows, total] = await Promise.all([
    Follow.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * CONNECTIONS_PAGE_SIZE)
      .limit(CONNECTIONS_PAGE_SIZE)
      .populate(personField, PERSON_FIELDS)
      .lean(),
    Follow.countDocuments(filter),
  ]);
  // A deleted account leaves a row with no user: it is skipped by connectionsPage.
  return connectionsPage(
    rows.map((row) => row[personField] || {}),
    total,
    page
  );
}

export async function profileProjects(profileUserId, viewerId) {
  // Public projects of the user, plus Private ones the viewer is also a member of.
  const projects = await Project.find({
    'members.user': profileUserId,
    $or: [{ visibility: 'Public' }, { 'members.user': viewerId }],
  })
    .select('name description domain status visibility tags color members.user members.role updatedAt')
    .sort({ updatedAt: -1, _id: -1 })
    .limit(PROFILE_PROJECT_LIMIT)
    .lean();
  // The rules check the same thing again, so a query mistake can never show a hidden project.
  return visibleProfileProjects(projects, profileUserId, viewerId);
}

// Distinct other people who share at least one project with the user.
async function collaboratorCount(userId) {
  const me = objectId(userId);
  const [row] = await Project.aggregate([
    { $match: { 'members.user': me } },
    { $unwind: '$members' },
    { $match: { 'members.user': { $ne: me } } },
    { $group: { _id: '$members.user' } },
    { $count: 'total' },
  ]);
  return row?.total || 0;
}

export async function contributionSnapshot(userId, now = new Date()) {
  const weekAgo = new Date(now.getTime() - SNAPSHOT_WEEK_MS);
  const [
    user,
    projects,
    completedProjects,
    tasksCompleted,
    tasksCompletedThisWeek,
    messagesPosted,
    decisionsRecorded,
    collaborators,
    followers,
    following,
  ] = await Promise.all([
    User.findById(userId).select('createdAt').lean(),
    Project.countDocuments({ 'members.user': userId }),
    Project.countDocuments({ 'members.user': userId, status: 'Completed' }),
    Task.countDocuments({ assignee: userId, status: 'Done' }),
    Task.countDocuments({ assignee: userId, status: 'Done', completedAt: { $gte: weekAgo } }),
    Message.countDocuments({ author: userId }),
    Decision.countDocuments({ createdBy: userId }),
    collaboratorCount(userId),
    followerCount(userId),
    followingCount(userId),
  ]);
  return snapshotView({
    projects,
    completedProjects,
    tasksCompleted,
    tasksCompletedThisWeek,
    messagesPosted,
    decisionsRecorded,
    collaborators,
    followerCount: followers,
    followingCount: following,
    joinedAt: user?.createdAt || null,
  });
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 7 · M4] What this file does
 * Reads a user's followers and the people they follow (20 per page, newest first), the
 * projects a viewer may see on that user's profile, and counts the real numbers for the
 * "Contribution snapshot" on My profile: projects, tasks done (and this week), messages,
 * decisions, collaborators, followers, following and the date they joined.
 * ---------------------------------------------------------------------------
 */
