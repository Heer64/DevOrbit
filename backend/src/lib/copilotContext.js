import Activity from '../models/Activity.js';
import Channel from '../models/Channel.js';
import Decision from '../models/Decision.js';
import Message from '../models/Message.js';
import Task from '../models/Task.js';
import TaskComment from '../models/TaskComment.js';
import { commentRecord, decisionRecord, githubRecord, messageRecord, permittedRecords, taskRecord } from './copilotGrounding.js';

/*
 * [Sprint 6 · M4] US-42 (FR-16b): loads the project data the Copilot may use for ONE project.
 *
 * Called by routes/copilot.js only after loadProjectForMember() has confirmed the caller is a member of
 * this project right now. Every member role may read all of it (role-permission matrix: "View project
 * content, Activity Feed" and "Read channels and task comments" are Yes for Owner, Admin, Contributor and
 * Viewer), so the member's access is: this project's
 *
 *   tasks            newest change first         (with assignee name, milestone title)
 *   task comments    newest first                (author name, task title)
 *   decisions        newest decision date first  (participant names, related task title)
 *   channel messages newest first, thread replies included (author name, channel name)
 *   GitHub activity  newest first: github.commit / github.issue / github.pull_request feed entries
 *
 * Every query is filtered by { project: <this project> }, and permittedRecords() checks the result again
 * before it is ranked or sent. Not used: direct messages (private to two users, US-19), notifications,
 * files, docs, other projects, and personal details such as e-mail addresses (only name and @username).
 *
 * LOAD_LIMITS caps how many rows of each kind are read (the newest ones), so a big project cannot make the
 * request slow (NFR-10a). Rows beyond the cap are counted (countDocuments) and reported as "left out".
 * Read-only: no write of any kind happens here.
 */
export const LOAD_LIMITS = { task: 200, decision: 100, message: 300, comment: 150, github: 150 };
export const GITHUB_ACTIVITY_TYPES = ['github.commit', 'github.issue', 'github.pull_request'];

const PERSON = 'name username';

export async function loadCopilotRecords(project) {
  const projectId = String(project._id);
  const filter = { project: project._id };
  const githubFilter = { project: project._id, type: { $in: GITHUB_ACTIVITY_TYPES } };

  // Comments of a deleted task and messages of a missing channel have nothing to link to, so they are
  // neither used nor counted: only comments on this project's tasks, only messages in its channels.
  const [taskIds, channels] = await Promise.all([Task.distinct('_id', filter), Channel.find(filter).select('name').lean()]);
  const commentFilter = { project: project._id, task: { $in: taskIds } };
  const messageFilter = { project: project._id, channel: { $in: channels.map((channel) => channel._id) } };

  const [tasks, comments, decisions, messages, github, available] = await Promise.all([
    Task.find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .limit(LOAD_LIMITS.task)
      .select('project title description status priority label assignee dueDate milestone completedAt createdAt updatedAt')
      .populate('assignee', PERSON)
      .populate('milestone', 'title')
      .lean(),
    TaskComment.find(commentFilter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(LOAD_LIMITS.comment)
      .select('project task author body createdAt')
      .populate('author', PERSON)
      .populate('task', 'title project')
      .lean(),
    Decision.find(filter)
      .sort({ date: -1, createdAt: -1, _id: -1 })
      .limit(LOAD_LIMITS.decision)
      .select('project title description participants date relatedTask createdAt updatedAt')
      .populate('participants', PERSON)
      .populate('relatedTask', 'title')
      .lean(),
    Message.find(messageFilter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(LOAD_LIMITS.message)
      .select('project channel author body parentMessage createdAt')
      .populate('author', PERSON)
      .lean(),
    Activity.find(githubFilter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(LOAD_LIMITS.github)
      .select('project type summary targetLabel meta createdAt')
      .lean(),
    Promise.all([
      Task.countDocuments(filter),
      Decision.countDocuments(filter),
      Message.countDocuments(messageFilter),
      TaskComment.countDocuments(commentFilter),
      Activity.countDocuments(githubFilter),
    ]).then(([task, decision, message, comment, githubCount]) => ({ task, decision, message, comment, github: githubCount })),
  ]);

  const channelNames = new Map(channels.map((channel) => [String(channel._id), channel.name]));

  const records = [
    ...tasks.map((task) => taskRecord(task, projectId)),
    // Checked again: a comment must point at a task of this project.
    ...comments
      .filter((comment) => comment.task && String(comment.task.project) === projectId)
      .map((comment) => commentRecord(comment, projectId)),
    ...decisions.map((decision) => decisionRecord(decision, projectId)),
    // Checked again: a message must be in a channel of this project.
    ...messages
      .filter((message) => channelNames.has(String(message.channel)))
      .map((message) => messageRecord(message, projectId, channelNames.get(String(message.channel)))),
    ...github.map((activity) => githubRecord(activity, projectId)),
  ];

  return { records: permittedRecords(records, projectId), available };
}
