import mongoose from 'mongoose';

// Retains only the project context for an OAuth attempt cancelled by disconnect.
// The active OAuth state is still deleted, so it can never authorize a connection.
const githubOAuthCancelledStateSchema = new mongoose.Schema(
  {
    stateHash: { type: String, required: true, unique: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true }
);

export default mongoose.model('GithubOAuthCancelledState', githubOAuthCancelledStateSchema);
