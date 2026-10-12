import mongoose from 'mongoose';

const membershipSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['Owner', 'Admin', 'Contributor', 'Viewer'], default: 'Contributor' },
  },
  { _id: false }
);

const projectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    domain: { type: String, trim: true, maxlength: 80, default: 'General' },
    visibility: { type: String, enum: ['Public', 'Private'], default: 'Public' },
    status: { type: String, enum: ['Planning', 'In progress', 'Completed'], default: 'Planning' },
    tags: { type: [{ type: String, trim: true, maxlength: 40 }], default: [] },
    color: { type: String, enum: ['violet', 'mint', 'orange', 'blue'], default: 'violet' },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    githubRepo: { type: String, trim: true, maxlength: 300, default: '' },
    members: { type: [membershipSchema], default: [] },
  },
  { timestamps: true }
);

projectSchema.index({ 'members.user': 1, updatedAt: -1 });
projectSchema.index({ visibility: 1, updatedAt: -1 });

export default mongoose.model('Project', projectSchema);
