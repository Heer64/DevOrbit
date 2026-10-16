import mongoose from 'mongoose';

// A milestone groups tasks inside one project. Its progress is not stored:
// it is calculated from the tasks attached to it (see routes/milestones.js).
const milestoneSchema = new mongoose.Schema(
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
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },
    dueDate: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

milestoneSchema.index({ project: 1, dueDate: 1 });

export default mongoose.model('Milestone', milestoneSchema);
