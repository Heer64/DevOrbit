import mongoose from 'mongoose';
import { PLATFORM_ROLES, PLATFORM_ROLE_USER } from '../lib/platformRoleRules.js'; // [Sprint 6 · M8] US-57

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    username: { type: String, required: true, unique: true, sparse: true, lowercase: true, trim: true, maxlength: 30 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    bio: { type: String, maxlength: 500, default: '' },
    headline: { type: String, maxlength: 120, default: '' },
    avatarUrl: { type: String, maxlength: 2048, default: '' },
    skills: { type: [{ type: String, trim: true, maxlength: 40 }], default: [] },
    githubUrl: { type: String, maxlength: 2048, default: '' },
    linkedinUrl: { type: String, maxlength: 2048, default: '' },
    focus: { type: String, maxlength: 160, default: '' },
    exploring: { type: String, maxlength: 200, default: '' },
    openTo: { type: String, maxlength: 200, default: '' },
    profileDiscoverable: { type: Boolean, default: true },
    portfolioPublic: { type: Boolean, default: true },
    loginFailedAttempts: { type: Number, default: 0, select: false },
    loginLockedUntil: { type: Date, default: null, select: false },
    // [Sprint 6 · M5] US-44 Catch Me Up: the last and the one-before-last successful logins (sign-up counts as
    // the first). Catch Me Up summarises what happened since previousLoginAt. Hidden unless selected.
    lastLoginAt: { type: Date, default: null, select: false },
    previousLoginAt: { type: Date, default: null, select: false },
    // [Sprint 6 · M8] US-57: platform-wide role (lib/platformRoleRules.js), separate from project roles.
    // Accounts created before this field existed have no value and count as "user".
    platformRole: { type: String, enum: PLATFORM_ROLES, default: PLATFORM_ROLE_USER },
    // [Sprint 6 · M8] US-58: set while the account is suspended (null = active), and which Platform Admin did it.
    suspendedAt: { type: Date, default: null },
    suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, select: false },
  },
  { timestamps: true }
);

// [Sprint 6 · M8] The admin panel filters by role and by suspended accounts.
userSchema.index({ platformRole: 1 });
userSchema.index({ suspendedAt: 1 });

export default mongoose.model('User', userSchema);
