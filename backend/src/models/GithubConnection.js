import mongoose from 'mongoose';

/*
 * [Sprint 4 · M1] US-31: the GitHub authorization stored for a project after its Owner approves
 * FORGE on GitHub. One per project. Kept in its own collection (not on Project) so the token can
 * never ride along with a project document sent to the browser.
 * [Sprint 4 · M3] US-33 adds the soft-disconnect and re-authorization fields below.
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

// [Sprint 4 · M3] US-33: the latest repository check ("Check connection", or right after a
// re-authorize). It only counts for the repository (githubId) and authorization (authorizedAt) it
// was made for; see currentRepositoryAccess() in lib/githubConnection.js.
const repositoryCheckSchema = new mongoose.Schema(
  {
    githubId: { type: Number, required: true },
    authorizedAt: { type: Date, required: true },
    access: { type: String, enum: ['accessible', 'not_accessible', 'unverified'], required: true },
    checkedAt: { type: Date, required: true, default: Date.now },
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
    // [Sprint 4 · M3] US-33: removed on disconnect, so it is only required while connected.
    encryptedToken: {
      type: String,
      select: false,
      required() {
        // In update validators `this` is a query (or null), not the document: the routes always
        // write the token together with status 'connected' there, so only documents are checked.
        return this instanceof mongoose.Document ? this.status !== 'disconnected' : false;
      },
    },
    authorizedAt: { type: Date, required: true, default: Date.now },
    repository: { type: connectedRepositorySchema, default: null }, // [Sprint 4 · M2] US-32
    // [Sprint 4 · M3] US-33 soft disconnect. Records written before US-33 have no status and count
    // as connected. A disconnected record keeps the GitHub account and repository (so re-authorize
    // can restore it) but no token, and lib/githubEventGate.js accepts no events for it.
    status: { type: String, enum: ['connected', 'disconnected'], default: 'connected' },
    disconnectedAt: { type: Date, default: null },
    disconnectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // [Sprint 4 · M3] US-33: GitHub rejected the stored token (401) or it can no longer be decrypted.
    // Set by "Check connection" and by M2's repository calls; cleared by a successful re-authorize.
    needsReauthorization: { type: Boolean, default: false },
    reauthorizationReason: { type: String, enum: ['', 'token_rejected', 'token_unreadable'], default: '' },
    lastCheckedAt: { type: Date, default: null },
    repositoryCheck: { type: repositoryCheckSchema, default: null },
  },
  { timestamps: true }
);

// [Sprint 4 · M3] US-33 / US-34: webhook deliveries are matched to projects by repository ID.
githubConnectionSchema.index({ 'repository.githubId': 1, status: 1 });

function hideSecret(_doc, ret) {
  delete ret.encryptedToken;
  delete ret.__v;
  return ret;
}
githubConnectionSchema.set('toJSON', { transform: hideSecret });
githubConnectionSchema.set('toObject', { transform: hideSecret });

export default mongoose.model('GithubConnection', githubConnectionSchema);
