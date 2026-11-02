import mongoose from 'mongoose';
import { DOC_CONTENT_MAX, DOC_TITLE_MAX } from '../lib/docs.js';

/*
 * [Sprint 4 · M6] A project documentation page (US-38, FR-14b).
 *
 * The content is Markdown, stored as plain text (never as HTML) and limited to 10,000 characters.
 * The routes (routes/docs.js) check the fields first with lib/docs.js; the limits here are a
 * second line of defence.
 */
const docPageSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    title: {
      type: String,
      required: [true, 'Title is required.'],
      trim: true,
      maxlength: DOC_TITLE_MAX,
    },
    content: {
      type: String,
      required: [true, 'Write some content before saving.'],
      maxlength: DOC_CONTENT_MAX,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    // Who saved the last edit. null until the page is edited.
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

// The page list reads one project's pages, most recently updated first.
docPageSchema.index({ project: 1, updatedAt: -1 });

export default mongoose.model('DocPage', docPageSchema);
