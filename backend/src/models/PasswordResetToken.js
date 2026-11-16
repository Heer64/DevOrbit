import mongoose from 'mongoose';

// [Sprint 6 · M1] US-04: one password reset link. Only the SHA-256 hash of the link's token is stored
// (lib/passwordResetRules.js), so a database leak gives nobody a working link.
const passwordResetTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, select: false },
    // AC1: valid for 1 hour. MongoDB's TTL monitor deletes the record shortly after this time.
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    // Set when the link is used (AC1: single use) or replaced by a newer link. A link works only while this is null.
    usedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model('PasswordResetToken', passwordResetTokenSchema);
