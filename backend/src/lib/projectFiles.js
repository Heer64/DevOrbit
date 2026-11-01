import mongoose from 'mongoose';

/*
 * [Sprint 4 · M5] Project files (US-37, FR-14a, NFR-8).
 *
 * Where the bytes live
 *   NFR-8 asks for persistent external storage (Cloudinary, S3 or GridFS), not the hosting
 *   platform's local disk, which is wiped on every redeploy. We use MongoDB GridFS: the bytes
 *   go into the same MongoDB database the app already uses (MongoDB Atlas when deployed), in
 *   the "projectFiles.files" / "projectFiles.chunks" collections. No extra service, account or
 *   secret is needed, and files survive a Render redeploy.
 *
 * Rules (kept here so the route, the tests and the README use the same values)
 *   - At most 10 MB per file (MAX_PROJECT_FILE_BYTES). The server enforces it; anything bigger
 *     answers 413 with FILE_TOO_LARGE_MESSAGE and nothing is stored.
 *   - One file per upload, in the multipart field "file" (FILE_FIELD).
 *   - Empty files are refused (400).
 *   - The file name is cleaned (cleanFileName): no folders, no control characters, max 200 chars.
 *   - Downloads are always sent as an attachment of type application/octet-stream, so an
 *     uploaded HTML or SVG file can never run as a page on the API's origin.
 */

export const MAX_PROJECT_FILE_MB = 10;
export const MAX_PROJECT_FILE_BYTES = MAX_PROJECT_FILE_MB * 1024 * 1024; // 10 MB
export const FILE_FIELD = 'file';
export const FILE_NAME_MAX = 200;
export const FILES_BUCKET = 'projectFiles';

export const FILE_TOO_LARGE_MESSAGE = `This file is larger than the ${MAX_PROJECT_FILE_MB} MB limit. Files must be ${MAX_PROJECT_FILE_MB} MB or smaller.`;
export const NO_FILE_MESSAGE = 'Choose a file to upload.';
export const EMPTY_FILE_MESSAGE = 'This file is empty. Choose a file with some content.';
export const ONE_FILE_MESSAGE = `Upload one file at a time in the "${FILE_FIELD}" field.`;
export const VIEWER_UPLOAD_MESSAGE = 'Viewers can download project files but cannot upload them.';

// Characters that are unsafe in a file name on common systems, plus control characters.
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME_CHARS = /[\u0000-\u001f\u007f<>:"|?*]/g;

/*
 * Turns the name the browser sent into a safe display / download name.
 *   "C:\\Users\\me\\report.pdf" -> "report.pdf"     "../../etc/passwd" -> "passwd"
 *   ".env" -> "env"                                   "" -> "file"
 * Long names are shortened to FILE_NAME_MAX characters, keeping the extension.
 */
export function cleanFileName(raw) {
  let name = String(raw ?? '').normalize('NFC');
  name = name.split(/[\\/]/).pop() || '';
  name = name.replace(UNSAFE_NAME_CHARS, '').replace(/\s+/g, ' ').trim();
  name = name.replace(/^\.+/, '').trim();
  if (!name) return 'file';
  if (name.length <= FILE_NAME_MAX) return name;

  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
  return `${name.slice(0, FILE_NAME_MAX - ext.length).trimEnd()}${ext}`;
}

// Keeps a plausible "type/subtype" sent by the browser, for display only. Anything else is octet-stream.
export function cleanContentType(raw) {
  const value = String(raw || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/.test(value)
    ? value
    : 'application/octet-stream';
}

/*
 * The GridFS bucket that holds the file bytes. Created on demand because the database
 * connection opens after the app module is loaded (server.js, test helpers).
 */
export function filesBucket() {
  const { db } = mongoose.connection;
  if (!db) {
    const error = new Error('File storage is not available right now. Please try again.');
    error.status = 503;
    throw error;
  }
  return new mongoose.mongo.GridFSBucket(db, { bucketName: FILES_BUCKET });
}

/*
 * Writes the bytes to GridFS and resolves with the new GridFS file id.
 * metadata is stored next to the bytes so the storage can be inspected on its own
 * (e.g. in Atlas: which project and user a stored file belongs to).
 */
export function storeFileBytes({ buffer, name, contentType, metadata = {} }) {
  return new Promise((resolve, reject) => {
    let upload;
    try {
      upload = filesBucket().openUploadStream(name, { metadata: { ...metadata, contentType } });
    } catch (error) {
      reject(error);
      return;
    }
    upload.once('error', reject);
    upload.once('finish', () => resolve(upload.id));
    upload.end(buffer);
  });
}

// Removes stored bytes. Used to clean up when saving the file record fails. Never throws.
export async function deleteFileBytes(storageId) {
  if (!storageId) return;
  try {
    await filesBucket().delete(storageId);
  } catch {
    // Already gone, or storage unavailable: nothing else to do.
  }
}

// True when the bytes for this GridFS id are still in storage.
export async function fileBytesExist(storageId) {
  const found = await filesBucket().find({ _id: storageId }).limit(1).toArray();
  return found.length > 0;
}

export function openFileBytes(storageId) {
  return filesBucket().openDownloadStream(storageId);
}

// API shape of one file. The GridFS id stays on the server.
export function fileView(file) {
  const uploader = file.uploadedBy && typeof file.uploadedBy === 'object' && file.uploadedBy.name !== undefined
    ? {
      _id: String(file.uploadedBy._id),
      name: file.uploadedBy.name,
      username: file.uploadedBy.username,
      avatarUrl: file.uploadedBy.avatarUrl || '',
    }
    : null;

  return {
    _id: String(file._id),
    project: String(file.project),
    name: file.name,
    size: file.size,
    contentType: file.contentType,
    uploadedBy: uploader,
    createdAt: file.createdAt,
    downloadUrl: `/api/projects/${file.project}/files/${file._id}/download`,
  };
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 4 · M5] What this file does
 * The rules for project files (10 MB limit, messages, safe names) and the
 * helpers that put file bytes into MongoDB GridFS and read them back out.
 * ---------------------------------------------------------------------------
 */
