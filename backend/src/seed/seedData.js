import bcrypt from 'bcryptjs';

import User from '../models/User.js';
import Project from '../models/Project.js';
import Task from '../models/Task.js';
import Milestone from '../models/Milestone.js';
import Channel from '../models/Channel.js';
import Message from '../models/Message.js';
import Activity from '../models/Activity.js';
import Follow from '../models/Follow.js'; // [Sprint 5 · M8] US-54
import DirectConversation from '../models/DirectConversation.js'; // [Sprint 6 · M2] US-19
import DirectMessage from '../models/DirectMessage.js'; // [Sprint 6 · M2] US-19
import { ensureDefaultChannel } from '../lib/channels.js';
import { logActivity, quote } from '../lib/activity.js';
import { domainTags } from '../lib/projectSetup.js';

/*
 * [Sprint 1 · gaps] Database setup / seed process (Sprint 1 plan line A).
 *
 * Fills an EMPTY development or test database with a small, realistic team so the app can be
 * demoed and tested right after a fresh clone: 4 users, 2 projects with every role, milestones,
 * tasks in every status (one overdue, some due this week), the #general channel with messages,
 * and matching activity entries.
 *
 * Run it with `npm run seed` in backend/ (see scripts/seed.js). Rules:
 *   - Seed accounts use the reserved domain @seed.devorbit.test, so they never clash with real users.
 *   - It never changes or deletes anything else. Running it twice does nothing the second time.
 *   - --reset removes ONLY the seed accounts and the projects they own (with those projects' tasks,
 *     milestones, channels, messages and activity), then seeds again.
 *   - It refuses to run when NODE_ENV=production (scripts/seed.js).
 */

export const SEED_EMAIL_DOMAIN = 'seed.devorbit.test';
export const DEFAULT_SEED_PASSWORD = 'DevOrbit@2026';

export const SEED_USERS = [
  {
    key: 'aarav',
    name: 'Aarav Mehta',
    headline: 'Full-stack developer',
    skills: ['React', 'Node.js', 'MongoDB'],
    bio: 'Turns fuzzy ideas into clear, useful products.',
  },
  {
    key: 'riya',
    name: 'Riya Kapoor',
    headline: 'Backend engineer',
    skills: ['Express', 'MongoDB', 'Testing'],
    bio: 'Likes clean APIs and calm on-call weeks.',
  },
  {
    key: 'jai',
    name: 'Jai Shah',
    headline: 'Frontend developer',
    skills: ['React', 'CSS', 'Accessibility'],
    bio: 'Builds interfaces that everyone can use.',
  },
  {
    key: 'mira',
    name: 'Mira Patel',
    headline: 'Product designer',
    skills: ['Figma', 'Research', 'Design systems'],
    bio: 'Asks "who is this for?" before every screen.',
  },
];

export const seedEmail = (key) => `${key}@${SEED_EMAIL_DOMAIN}`;

const DAY_MS = 24 * 60 * 60 * 1000;

// Due dates are calendar days stored as midnight UTC (lib/dueDates.js), counted from today.
export function dayFromToday(offset, now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today + offset * DAY_MS);
}

const SEED_PROJECTS = [
  {
    owner: 'aarav',
    name: 'Orbit dashboard',
    description: 'A shared home for project progress and team momentum.',
    domain: 'Developer tools',
    visibility: 'Public',
    status: 'In progress',
    color: 'violet',
    members: [
      { key: 'riya', role: 'Admin' },
      { key: 'jai', role: 'Contributor' },
      { key: 'mira', role: 'Viewer' },
    ],
    milestones: [
      { key: 'mvp', title: 'MVP release', description: 'Everything needed for the first demo.', due: 10 },
      { key: 'beta', title: 'Public beta', description: 'Polish, docs and feedback round.', due: 30 },
    ],
    tasks: [
      {
        title: 'Set up CI for backend and frontend',
        status: 'Done',
        priority: 'High',
        assignee: 'riya',
        milestone: 'mvp',
        label: 'DevOps',
      },
      { title: 'Design the project dashboard', status: 'Done', priority: 'Medium', assignee: 'mira', milestone: 'mvp', label: 'Design' },
      {
        title: 'Build the Kanban board',
        status: 'In progress',
        priority: 'High',
        assignee: 'jai',
        milestone: 'mvp',
        due: 2,
        label: 'Frontend',
      },
      {
        title: 'Write API tests for tasks',
        status: 'In progress',
        priority: 'Medium',
        assignee: 'riya',
        milestone: 'mvp',
        due: 5,
        label: 'Testing',
      },
      { title: 'Fix login redirect on Safari', status: 'Blocked', priority: 'High', assignee: 'aarav', due: -2, label: 'Bug' },
      { title: 'Add dark mode screenshots to the README', status: 'To do', priority: 'Low', milestone: 'beta', due: 20, label: 'Docs' },
      {
        title: 'Collect feedback from 5 teams',
        status: 'To do',
        priority: 'Medium',
        assignee: 'aarav',
        milestone: 'beta',
        label: 'Research',
      },
    ],
    messages: [
      { author: 'aarav', body: 'Welcome to Orbit dashboard! Tasks for the MVP are on the board.' },
      { author: 'riya', body: 'CI is green on main. I will pick up the task API tests next.' },
      { author: 'jai', body: 'Kanban drag and drop works locally, PR coming tomorrow.' },
    ],
  },
  {
    owner: 'riya',
    name: 'CampusConnect',
    description: 'Helping students find teammates and build beyond the classroom.',
    domain: 'Education',
    visibility: 'Private',
    status: 'Planning',
    color: 'orange',
    members: [{ key: 'aarav', role: 'Contributor' }],
    milestones: [{ key: 'plan', title: 'Scope and user interviews', description: '', due: 14 }],
    tasks: [
      {
        title: 'Interview 10 students about team projects',
        status: 'To do',
        priority: 'High',
        assignee: 'riya',
        milestone: 'plan',
        due: 7,
        label: 'Research',
      },
      { title: 'Sketch the matching flow', status: 'To do', priority: 'Medium', assignee: 'aarav', milestone: 'plan', label: 'Design' },
    ],
    messages: [{ author: 'riya', body: 'Kick-off notes are in the Docs tab. Interviews start next week.' }],
  },
];

// Every seed account, or [] when the database has none.
export function findSeedUsers() {
  return User.find({ email: { $in: SEED_USERS.map((u) => seedEmail(u.key)) } }).lean();
}

// Removes the seed accounts and the projects they own, with everything inside those projects.
export async function removeSeedData() {
  const users = await findSeedUsers();
  if (!users.length) return { users: 0, projects: 0 };
  const userIds = users.map((u) => u._id);
  const projects = await Project.find({ members: { $elemMatch: { user: { $in: userIds }, role: 'Owner' } } })
    .select('_id')
    .lean();
  const projectIds = projects.map((p) => p._id);
  await Promise.all([
    Task.deleteMany({ project: { $in: projectIds } }),
    Milestone.deleteMany({ project: { $in: projectIds } }),
    Message.deleteMany({ project: { $in: projectIds } }),
    Channel.deleteMany({ project: { $in: projectIds } }),
    Activity.deleteMany({ project: { $in: projectIds } }),
  ]);
  await Project.deleteMany({ _id: { $in: projectIds } });
  // Seed users may also have joined other people's projects while someone tested: take them out.
  await Project.updateMany({ 'members.user': { $in: userIds } }, { $pull: { members: { user: { $in: userIds } } } });
  // [Sprint 5 · M8] US-54: follows to or from removed seed accounts would inflate follower counts.
  await Follow.deleteMany({ $or: [{ follower: { $in: userIds } }, { following: { $in: userIds } }] });
  // [Sprint 6 · M2] US-19: direct conversations with a removed seed account, and their messages.
  const conversations = await DirectConversation.find({ participants: { $in: userIds } }).select('_id').lean();
  await DirectMessage.deleteMany({ conversation: { $in: conversations.map((c) => c._id) } });
  await DirectConversation.deleteMany({ _id: { $in: conversations.map((c) => c._id) } });
  await User.deleteMany({ _id: { $in: userIds } });
  return { users: users.length, projects: projectIds.length };
}

/*
 * Seeds the database. Returns a summary:
 *   { seeded: false, reason }                    seed accounts already exist (and reset was not asked for)
 *   { seeded: true, users, projects, tasks, password, removed }
 */
export async function seedDatabase({ reset = false, password = DEFAULT_SEED_PASSWORD, now = new Date() } = {}) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new Error('The seed password must be 8 to 128 characters (same rule as sign up).');
  }
  let removed = null;
  if (reset) removed = await removeSeedData();
  else if ((await findSeedUsers()).length) {
    return { seeded: false, reason: 'Seed accounts already exist. Run with --reset to recreate them.' };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const users = {};
  for (const seed of SEED_USERS) {
    const user = await User.create({
      name: seed.name,
      username: `${seed.key}_seed`,
      email: seedEmail(seed.key),
      passwordHash,
      headline: seed.headline,
      bio: seed.bio,
      skills: seed.skills,
    });
    users[seed.key] = user;
  }

  let taskCount = 0;
  for (const spec of SEED_PROJECTS) {
    const owner = users[spec.owner];
    const project = await Project.create({
      name: spec.name,
      description: spec.description,
      domain: spec.domain,
      visibility: spec.visibility,
      status: spec.status,
      color: spec.color,
      tags: domainTags(spec.domain),
      members: [{ user: owner._id, role: 'Owner' }, ...spec.members.map((m) => ({ user: users[m.key]._id, role: m.role }))],
    });
    await logActivity({
      project: project._id,
      actor: owner._id,
      type: 'project.created',
      summary: `created the project ${quote(project.name)}`,
      targetLabel: project.name,
    });
    for (const m of spec.members) {
      const member = users[m.key];
      await logActivity({
        project: project._id,
        actor: owner._id,
        type: 'member.added',
        summary: `added ${member.name} as ${m.role}`,
        targetType: 'member',
        targetId: member._id,
        targetLabel: member.name,
        meta: { role: m.role },
      });
    }

    const milestones = {};
    for (const m of spec.milestones) {
      milestones[m.key] = await Milestone.create({
        project: project._id,
        title: m.title,
        description: m.description,
        dueDate: dayFromToday(m.due, now),
        createdBy: owner._id,
      });
    }

    for (const t of spec.tasks) {
      await Task.create({
        project: project._id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        label: t.label || '',
        assignee: t.assignee ? users[t.assignee]._id : null,
        milestone: t.milestone ? milestones[t.milestone]._id : null,
        dueDate: t.due === undefined ? null : dayFromToday(t.due, now),
        completedAt: t.status === 'Done' ? now : null,
        createdBy: owner._id,
      });
      taskCount += 1;
    }
    const done = spec.tasks.filter((t) => t.status === 'Done').length;
    project.progress = spec.tasks.length ? Math.round((done / spec.tasks.length) * 100) : 0;
    await project.save();

    const channel = await ensureDefaultChannel(project._id);
    for (const msg of spec.messages) {
      await Message.create({ project: project._id, channel: channel._id, author: users[msg.author]._id, body: msg.body });
    }
  }

  return {
    seeded: true,
    users: SEED_USERS.map((u) => ({ name: u.name, email: seedEmail(u.key), username: `${u.key}_seed` })),
    projects: SEED_PROJECTS.map((p) => p.name),
    tasks: taskCount,
    password,
    removed,
  };
}
