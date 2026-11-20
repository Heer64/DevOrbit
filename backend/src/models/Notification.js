import mongoose from 'mongoose';

/*
 * [Sprint 3 · M7 Part 1] In-app notification storage (US-30, FR-10, FR-33).
 *
 * One row = one notification for one recipient. Rows are written by
 * lib/notifications.js createNotification() and read through routes/notifications.js.
 *
 * The three types come from US-30: "labelled Mention, Assignment or Deadline".
 * FR-33 also names "moderation warning"; add it here when the moderation stories (FR-27) are built.
 */
// [Sprint 6 · M7] US-56 (FR-27, FR-33 "moderation warning") and FR-20 (the requester is told the outcome of a
// join request). These are about the recipient personally, so they are shown to them whether or not they are a
// member of a project (a warned post belongs to no project; a declined requester never became a member).
// [Sprint 7 · M3] post_reply: someone commented on your public post or replied to your comment (no project).
export const PERSONAL_NOTIFICATION_TYPES = ['moderation_warning', 'join_approved', 'join_rejected', 'post_reply'];
export const NOTIFICATION_TYPES = ['mention', 'assignment', 'deadline', ...PERSONAL_NOTIFICATION_TYPES]; // [Sprint 6 · M7] + personal types
// Types that belong to no project (the project field stays empty).
export const PROJECTLESS_NOTIFICATION_TYPES = ['moderation_warning', 'post_reply']; // [Sprint 7 · M3] + post_reply

// Label the UI shows for each type (US-30 acceptance criteria wording).
export const NOTIFICATION_LABELS = {
  mention: 'Mention',
  assignment: 'Assignment',
  deadline: 'Deadline',
  moderation_warning: 'Moderation warning', // [Sprint 6 · M7] US-56
  join_approved: 'Join request approved', // [Sprint 6 · M7] FR-20
  join_rejected: 'Join request declined', // [Sprint 6 · M7] FR-20
  post_reply: 'Reply', // [Sprint 7 · M3] a comment on your post, or a reply to your comment
};

// What a notification points at. Same names as Activity TARGET_TYPES (shared event schema).
// mention -> 'message' (US-18) or 'comment' (US-20); assignment and deadline -> 'task' (US-22, US-23).
export const NOTIFICATION_TARGET_TYPES = ['task', 'message', 'comment', 'post', 'project']; // [Sprint 6 · M7] + post (warning), project (join outcome)

// Links are in-app paths such as /project/<id>?tab=tasks&task=<taskId>.
// Must start with one "/" so a stored link can never send the user to another site
// ("https://...", "//evil.example" and "javascript:..." are all rejected).
export const IN_APP_LINK = /^\/(?![/\\])[^\s]*$/;

const notificationSchema = new mongoose.Schema(
  {
    // Who receives it. Every read and update is filtered by this field.
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
    },
    // Project the notification belongs to. Mentions, assignments and deadlines all happen inside a project.
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      // [Sprint 6 · M7] US-56: a moderation warning is about a public post, which belongs to no project.
      required: function projectRequired() { return !PROJECTLESS_NOTIFICATION_TYPES.includes(this.type); },
      default: null,
    },
    // Who caused it. null for system notifications such as Deadline.
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // Ready-to-show sentence without the actor's name, e.g. 'mentioned you in #general'.
    // The UI shows "<actor name> <summary>" (or just the summary when there is no actor), like the Activity Feed.
    summary: {
      type: String,
      trim: true,
      maxlength: 300,
      required: true,
    },
    // The related task, message or comment (source object).
    targetType: {
      type: String,
      enum: NOTIFICATION_TARGET_TYPES,
      required: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    // Copied in so the notification still reads well after the task is renamed or deleted.
    targetLabel: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
    },
    // Where opening the notification goes (US-30: "taken to the related message or task").
    link: {
      type: String,
      trim: true,
      maxlength: 500,
      required: true,
      match: [IN_APP_LINK, 'Notification link must be an in-app path that starts with "/".'],
    },
    // Read / unread state. New notifications are unread.
    read: {
      type: Boolean,
      default: false,
    },
    readAt: {
      type: Date,
      default: null,
    },
    // Optional key that makes creation idempotent: the same recipient never gets two
    // notifications with the same key, e.g. `deadline:<taskId>:<dueDate ISO>`.
    dedupeKey: {
      type: String,
      trim: true,
      maxlength: 200,
      default: undefined,
    },
  },
  { timestamps: true }
);

// The list reads one user's notifications newest-first, optionally unread only.
notificationSchema.index({ recipient: 1, createdAt: -1, _id: -1 });
notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });
// Idempotency: one notification per (recipient, dedupeKey). Rows without a key are not affected.
notificationSchema.index(
  { recipient: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } }
);

export default mongoose.model('Notification', notificationSchema);
