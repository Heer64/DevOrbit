import mongoose from 'mongoose';
import { FILE_NAME_MAX, MAX_PROJECT_FILE_BYTES } from '../lib/projectFiles.js';

/*
 * [Sprint 4 · M5] A file uploaded to a project (US-37, FR-14a, NFR-8).
 *
 * This document is the file's record: who uploaded what, when, and how big it is.
 * The bytes themselves are in MongoDB GridFS (bucket "projectFiles"); storageId points at them.
 * See lib/projectFiles.js for the rules and the storage helpers.
 */
const projectFileSchema = new mongoose.Schema(
  {
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    // Cleaned display / download name (lib/projectFiles.js cleanFileName).
    name: {
      type: String,
      required: [true, 'File name is required.'],
      trim: true,
      maxlength: FILE_NAME_MAX,
    },
    // Size in bytes: 1 byte up to the 10 MB limit.
    size: {
      type: Number,
      required: true,
      min: 1,
      max: MAX_PROJECT_FILE_BYTES,
    },
    // Type the browser reported, shown in the list only. Downloads are always octet-stream.
    contentType: {
      type: String,
      default: 'application/octet-stream',
    },
    // The GridFS file id holding the bytes.
    storageId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

// The Files tab lists one project's files, newest first.
projectFileSchema.index({ project: 1, createdAt: -1 });

export default mongoose.model('ProjectFile', projectFileSchema);
