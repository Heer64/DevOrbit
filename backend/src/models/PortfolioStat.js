import mongoose from 'mongoose';

/*
 * [Sprint 5 · M5] US-49 / NFR-12: one user's contribution numbers for one Completed project,
 * as shown on their portfolio. Saved with the time they were counted (computedAt) and
 * counted again by lib/portfolio.js once they are 24 hours old, so a portfolio never shows
 * numbers older than that.
 */
const portfolioStatSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    tasksCompleted: { type: Number, default: 0, min: 0 },
    decisionsRecorded: { type: Number, default: 0, min: 0 },
    messagesPosted: { type: Number, default: 0, min: 0 },
    computedAt: { type: Date, required: true },
  },
  { timestamps: true }
);

portfolioStatSchema.index({ user: 1, project: 1 }, { unique: true });

export default mongoose.model('PortfolioStat', portfolioStatSchema);
