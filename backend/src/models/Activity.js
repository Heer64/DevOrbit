import mongoose from 'mongoose';

// Every event the activity feed can show. Add new types here first.
export const ACTIVITY_TYPES = [
  'project.created',
  'project.updated',
  'member.added',
  'member.role_changed',
  'member.removed',
  'member.left',
  'task.created',
  'task.updated',
  'task.status_changed',
  'task.assigned',
  'task.deleted',
  'milestone.created',
  'milestone.updated',
  'milestone.deleted',
];

export const TARGET_TYPES = ['project', 'member', 'task', 'milestone'];

const activitySchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    // Who did it.
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: ACTIVITY_TYPES,
      required: true,
    },
    // Ready-to-show sentence without the actor's name, e.g. 'created task "Login page"'.
    // The UI shows "<actor name> <summary>".
    summary: {
      type: String,
      trim: true,
      maxlength: 300,
      required: true,
    },
    // What the event is about. The label is copied in so the feed still reads well
    // after the task or milestone is deleted or renamed.
    targetType: {
      type: String,
      enum: TARGET_TYPES,
      default: 'project',
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    targetLabel: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
    },
    // Small extra details, e.g. { from: 'To do', to: 'Done' }.
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// The project feed and "my activity" both read newest-first by project.
activitySchema.index({ project: 1, createdAt: -1 });

export default mongoose.model('Activity', activitySchema);
