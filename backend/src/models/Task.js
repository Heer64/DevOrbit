
import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },
    status: {
      type: String,
      enum: ['To do', 'In progress', 'Blocked', 'Done'],
      default: 'To do',
    },
    // Optimistic-concurrency counter (Sprint 2 Pair D, US-28).
    // Every successful change to the task increases it by 1. Clients send the version
    // they loaded; a mismatch means someone else changed the task first (HTTP 409).
    // Tasks created before this field existed have no value stored and count as 0.
    version: {
      type: Number,
      default: 0,
      min: 0,
    },
    priority: {
      type: String,
      enum: ['Low', 'Medium', 'High'],
      default: 'Medium',
    },
    assignee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    dueDate: {
      type: Date,
      default: null,
    },
    milestone: {
  type: mongoose.Schema.Types.ObjectId,
  ref: 'Milestone',
  default: null,
},
completedAt: {
  type: Date,
  default: null,
},
  },
  { timestamps: true }
);

taskSchema.index({ project: 1 });
taskSchema.index({ status: 1 });

export default mongoose.model('Task', taskSchema);
