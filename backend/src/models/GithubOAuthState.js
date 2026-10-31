import mongoose from 'mongoose';

/*
 * [Sprint 4 · M1] US-31: one pending "Connect GitHub" attempt.
 *
 * Only a SHA-256 hash of the random state is stored. The raw state goes to GitHub in the
 * authorize URL and to the Owner's browser in an httpOnly cookie; the callback must bring back
 * both, and they must match this record. Each record is single-use (deleted when the callback
 * reads it) and MongoDB removes unused ones after expiresAt.
 */
const githubOAuthStateSchema = new mongoose.Schema(
  {
    stateHash: { type: String, required: true, unique: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true }
);

export default mongoose.model('GithubOAuthState', githubOAuthStateSchema);
