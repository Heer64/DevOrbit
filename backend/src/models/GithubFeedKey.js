import mongoose from 'mongoose';

/*
 * [Sprint 4 · M4] US-34: "this GitHub event is already in this project's feed".
 * key comes from lib/githubEvents.js (e.g. "commit:<sha>", "pr:12:merged:<updated_at>").
 * The unique (project, key) index is what stops duplicate feed entries when GitHub sends the same
 * event twice, also under a new delivery ID (a manual redelivery, or the same commit pushed to two branches).
 */
const githubFeedKeySchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    key: { type: String, required: true, trim: true, maxlength: 200 },
    activity: { type: mongoose.Schema.Types.ObjectId, ref: 'Activity', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

githubFeedKeySchema.index({ project: 1, key: 1 }, { unique: true });

export default mongoose.model('GithubFeedKey', githubFeedKeySchema);
