import { Router } from 'express';
import multer from 'multer';

import ProjectFile from '../models/ProjectFile.js';
import { requireAuth } from '../middleware/auth.js';
import { loadProjectForMember, validId } from '../lib/projectAccess.js';
import { canUploadFiles } from '../lib/permissions.js';
import { logActivity, quote } from '../lib/activity.js';
import {
  EMPTY_FILE_MESSAGE,
  FILE_FIELD,
  FILE_TOO_LARGE_MESSAGE,
  MAX_PROJECT_FILE_BYTES,
  NO_FILE_MESSAGE,
  ONE_FILE_MESSAGE,
  VIEWER_UPLOAD_MESSAGE,
  cleanContentType,
  cleanFileName,
  deleteFileBytes,
  fileBytesExist,
  fileView,
  openFileBytes,
  storeFileBytes,
} from '../lib/projectFiles.js';

/*
 * [Sprint 4 · M5] Project files (US-37 Upload a project file, FR-14a, NFR-8).
 * Mounted at /api/projects/:id/files (see app.js). Project members only, also for Public projects.
 *
 * GET  /                     members (all roles)
 *      -> { files, membershipRole, canUpload, maxBytes }   newest first
 * POST /                     Owner, Admin, Contributor
 *      multipart/form-data with ONE file in the field "file"
 *      -> 201 { file }
 *      413 { message, code: 'file_too_large', maxBytes }  file over 10 MB (nothing is stored)
 *      400 no file / empty file / extra fields or files     403 Viewer or non-member
 * GET  /:fileId/download     members (all roles)
 *      -> the bytes, as an attachment named after the file (Content-Type application/octet-stream)
 *      404 unknown file, a file of another project, or bytes missing from storage
 *
 * Each file: { _id, project, name, size, contentType, uploadedBy { _id, name, username, avatarUrl } | null,
 *              createdAt, downloadUrl }
 *
 * The bytes are stored in MongoDB GridFS, not on the server's disk (lib/projectFiles.js).
 * Activity Feed: 'file.uploaded' (models/Activity.js).
 */

const router = Router({ mergeParams: true });
router.use(requireAuth);

const USER_FIELDS = 'name username avatarUrl';

/*
 * The file is held in memory (10 MB cap) and only written to storage once it has fully
 * arrived under the limit, so a rejected upload never leaves partial data behind.
 * multer runs inside the POST handler, AFTER the membership and role checks, so a
 * non-member or Viewer is refused before the server reads the upload.
 */
const parseUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PROJECT_FILE_BYTES, files: 1, fields: 0 },
  defParamCharset: 'utf8', // keep non-English file names (e.g. "रिपोर्ट.pdf") intact
}).single(FILE_FIELD);

function readUpload(req, res) {
  return new Promise((resolve) => {
    parseUpload(req, res, (error) => resolve(error || null));
  });
}

// Turns a multer error into the answer for the client. Returns true when it answered.
function answerUploadError(error, res) {
  if (!error) return false;
  if (error.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ message: FILE_TOO_LARGE_MESSAGE, code: 'file_too_large', maxBytes: MAX_PROJECT_FILE_BYTES });
    return true;
  }
  if (error.name === 'MulterError') {
    res.status(400).json({ message: ONE_FILE_MESSAGE });
    return true;
  }
  // A broken multipart body (e.g. the browser cancelled the upload half way).
  res.status(400).json({ message: 'The upload could not be read. Please try again.' });
  return true;
}

router.get('/', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;

    const rows = await ProjectFile.find({ project: loaded.project._id })
      .sort({ createdAt: -1, _id: -1 })
      .populate('uploadedBy', USER_FIELDS)
      .lean();

    return res.json({
      files: rows.map(fileView),
      membershipRole: loaded.role,
      canUpload: canUploadFiles(loaded.role),
      maxBytes: MAX_PROJECT_FILE_BYTES,
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;

    if (!canUploadFiles(loaded.role)) {
      return res.status(403).json({ message: VIEWER_UPLOAD_MESSAGE });
    }

    const uploadError = await readUpload(req, res);
    if (answerUploadError(uploadError, res)) return undefined;

    const { file } = req;
    if (!file) return res.status(400).json({ message: NO_FILE_MESSAGE });
    if (!file.buffer || file.size === 0) return res.status(400).json({ message: EMPTY_FILE_MESSAGE });
    // Belt and braces: multer already stops at the limit.
    if (file.size > MAX_PROJECT_FILE_BYTES) {
      return res.status(413).json({ message: FILE_TOO_LARGE_MESSAGE, code: 'file_too_large', maxBytes: MAX_PROJECT_FILE_BYTES });
    }

    const name = cleanFileName(file.originalname);
    const contentType = cleanContentType(file.mimetype);
    const storageId = await storeFileBytes({
      buffer: file.buffer,
      name,
      contentType,
      metadata: { project: loaded.project._id, uploadedBy: req.user.id },
    });

    let created;
    try {
      created = await ProjectFile.create({
        project: loaded.project._id,
        name,
        size: file.size,
        contentType,
        storageId,
        uploadedBy: req.user.id,
      });
    } catch (error) {
      // No record means nobody could ever download these bytes: remove them.
      await deleteFileBytes(storageId);
      throw error;
    }

    await logActivity({
      project: loaded.project._id,
      actor: req.user.id,
      type: 'file.uploaded',
      summary: `uploaded file ${quote(name)}`,
      targetType: 'file',
      targetId: created._id,
      targetLabel: name,
      meta: { size: file.size, contentType },
    });

    const saved = await ProjectFile.findById(created._id).populate('uploadedBy', USER_FIELDS).lean();
    return res.status(201).json({ file: fileView(saved) });
  } catch (error) {
    return next(error);
  }
});

router.get('/:fileId/download', async (req, res, next) => {
  try {
    const loaded = await loadProjectForMember(req, res);
    if (!loaded) return undefined;

    if (!validId(req.params.fileId)) return res.status(400).json({ message: 'Invalid file ID.' });

    // Scoped to this project, so a file ID from another project answers 404.
    const file = await ProjectFile.findOne({ _id: req.params.fileId, project: loaded.project._id }).lean();
    if (!file) return res.status(404).json({ message: 'File not found.' });

    if (!(await fileBytesExist(file.storageId))) {
      return res.status(404).json({ message: 'This file is no longer in storage. Ask the uploader to upload it again.' });
    }

    // Always a download, never shown inline, so an uploaded HTML/SVG file cannot run as a page.
    res.attachment(file.name);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(file.size),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    });

    const stream = openFileBytes(file.storageId);
    stream.once('error', (error) => {
      if (!res.headersSent) next(error);
      else res.destroy(error);
    });
    stream.pipe(res);
    return undefined;
  } catch (error) {
    return next(error);
  }
});

export default router;

/*
 * ---------------------------------------------------------------------------
 * [Sprint 4 · M5] What this file does
 * REST API for project files: list them and download them (any member), upload
 * one (Owner/Admin/Contributor). Files over 10 MB are refused with a 413 and a
 * message naming the limit. Bytes go to MongoDB GridFS (persistent storage, not
 * the server's disk). Every upload is logged in the Activity Feed as file.uploaded.
 * ---------------------------------------------------------------------------
 */
