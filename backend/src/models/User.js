import mongoose from 'mongoose';

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
  },
  { timestamps: true }
);


export default mongoose.model('User', userSchema);
