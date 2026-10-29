import mongoose from 'mongoose';
import { DECISION_DESCRIPTION_MAX, DECISION_TITLE_MAX } from '../lib/decisions.js';

/*
 * [Sprint 3 · M8] A recorded project decision (US-35, US-36, FR-13, FR-34).
 *
 * Title, description, participants (project members) and date are required. The decision
 * can point at ONE related item: a task (relatedTask) or a channel thread (relatedMessage =
 * the thread's top-level message, relatedChannel = its channel). The routes check that the
 * item belongs to the same project. If it is deleted later the decision is kept and the API
 * marks the link as missing (lib/decisions.js decisionLinkView).
 */
const decisionSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    title: {
      type: String,
      required: [true, 'Title is required.'],
      trim: true,
      maxlength: DECISION_TITLE_MAX,
    },
    description: {
      type: String,
      required: [true, 'Description is required.'],
      trim: true,
      maxlength: DECISION_DESCRIPTION_MAX,
    },
    participants: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
      ],
      validate: {
        validator: (list) => Array.isArray(list) && list.length > 0,
        message: 'Add at least one participant.',
      },
    },
    // A calendar day, stored as midnight UTC (same rules as task due dates).
    date: {
      type: Date,
      required: [true, 'Decision date is required.'],
    },
    relatedTask: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
      default: null,
    },
    relatedMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
    relatedChannel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Channel',
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Who saved the last edit. null until the decision is edited.
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

// The decision list reads one project's decisions, newest date first.
decisionSchema.index({ project: 1, date: -1, createdAt: -1 });

export default mongoose.model('Decision', decisionSchema);
