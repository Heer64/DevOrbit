import mongoose from 'mongoose';

/*
 * [Sprint 3 · M2] Join requests for public projects (US-12, US-47, FR-20).
 *
 * A logged-in non-member asks to join a Public project (optionally with a message).
 * The project's Owner or an Admin approves it (the person becomes a member with the role
 * chosen, Contributor by default) or rejects it. After a rejection the person may not ask
 * again for REJOIN_BLOCK_DAYS days.
 *
 * Rows are kept after a decision, so the 7-day block and the history keep working.
 */
export const JOIN_REQUEST_STATUSES = ['Pending', 'Approved', 'Rejected'];
export const JOIN_MESSAGE_MAX = 500;
export const REJOIN_BLOCK_DAYS = 7;

const joinRequestSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    // Who asked to join.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Optional note to the project managers (US-47).
    message: {
      type: String,
      trim: true,
      maxlength: JOIN_MESSAGE_MAX,
      default: '',
    },
    status: {
      type: String,
      enum: JOIN_REQUEST_STATUSES,
      default: 'Pending',
    },
    // Role given on approval. null until approved (and for rejected requests).
    role: {
      type: String,
      enum: ['Admin', 'Contributor', 'Viewer'],
      default: null,
    },
    // Who approved or rejected it, and when.
    decidedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    decidedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// One pending request per person per project. Also stops two quick clicks from making two requests.
joinRequestSchema.index(
  { project: 1, user: 1 },
  { unique: true, partialFilterExpression: { status: 'Pending' } }
);
// The managers' queue: one project's requests by status, oldest first.
joinRequestSchema.index({ project: 1, status: 1, createdAt: 1 });
// "My latest request for this project" and the 7-day block check.
joinRequestSchema.index({ user: 1, project: 1, createdAt: -1 });

export default mongoose.model('JoinRequest', joinRequestSchema);
