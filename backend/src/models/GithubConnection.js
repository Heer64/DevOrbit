import mongoose from 'mongoose';

/*
 * [Sprint 4 · M1] US-31: the GitHub authorization stored for a project after its Owner approves
 * FORGE on GitHub. One per project. Kept in its own collection (not on Project) so the token can
 * never ride along with a project document sent to the browser.
 *
 * encryptedToken is AES-256-GCM ciphertext (lib/githubCrypto.js), is never selected by default,
 * and is stripped from toJSON/toObject as a second guard. Repository choice (US-32) and
 * disconnect / re-authorize (US-33) build on this record.
 */
// [Sprint 4 · M2] US-32: the one repository the Owner connected. Checked against the authorized
// account's repository list when chosen (routes/githubRepository.js). githubUserId records which
// GitHub account it was chosen under: after re-authorizing as another account it no longer counts
// (lib/githubRepos.js repositoryStatus) until the Owner picks again.
const connectedRepositorySchema = new mongoose.Schema(
  {
    githubId: { type: Number, required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    fullName: { type: String, required: true, trim: true, maxlength: 200 },
    owner: { type: String, required: true, trim: true, maxlength: 100 },
    private: { type: Boolean, default: false },
    htmlUrl: { type: String, required: true, trim: true, maxlength: 300 },
    defaultBranch: { type: String, trim: true, maxlength: 255, default: '' },
    admin: { type: Boolean, default: false }, // the authorized account can manage it (webhooks, US-34)
    githubUserId: { type: Number, required: true },
    connectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    connectedAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false }
);

const githubConnectionSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, unique: true },
    authorizedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    githubUserId: { type: Number, required: true },
    githubLogin: { type: String, required: true, trim: true, maxlength: 100 },
    scopes: { type: [{ type: String, trim: true, maxlength: 60 }], default: [] },
    encryptedToken: { type: String, required: true, select: false },
    authorizedAt: { type: Date, required: true, default: Date.now },
    repository: { type: connectedRepositorySchema, default: null }, // [Sprint 4 · M2] US-32
  },
  { timestamps: true }
);

function hideSecret(_doc, ret) {
  delete ret.encryptedToken;
  delete ret.__v;
  return ret;
}
githubConnectionSchema.set('toJSON', { transform: hideSecret });
githubConnectionSchema.set('toObject', { transform: hideSecret });

export default mongoose.model('GithubConnection', githubConnectionSchema);
