import mongoose from 'mongoose';

// Channel names look like Slack/Discord ones: lowercase letters, digits, "-" and "_".
export const CHANNEL_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,29}$/;
export const DEFAULT_CHANNEL = 'general';

const channelSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 30,
      match: CHANNEL_NAME_PATTERN,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
    },
    // #general is created automatically for every project and cannot be renamed or removed.
    isDefault: {
      type: Boolean,
      default: false,
    },
    // null for the automatic #general channel.
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

// One channel name per project.
channelSchema.index({ project: 1, name: 1 }, { unique: true });

export default mongoose.model('Channel', channelSchema);

/*
 * ---------------------------------------------------------------------------
 * [Sprint 2 final] What this file does
 * A project's text channels (US-16, FR-5). Every project gets #general
 * automatically (see lib/channels.js); Owners and Admins can add more.
 * Messages live in models/Message.js.
 * ---------------------------------------------------------------------------
 */
