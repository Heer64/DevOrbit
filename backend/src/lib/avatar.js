import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

/*
 * Profile photos (US-05).
 *
 * [Sprint 1 · gaps] Sprint 1 plan line D: "Store uploads in persistent external storage, not the hosting
 * platform's local disk." Photos used to be written to backend/uploads/avatars, which Render wipes on
 * every redeploy or restart. They are now stored in MongoDB GridFS (bucket "avatars": collections
 * avatars.files / avatars.chunks), the same way project files are (US-37, lib/projectFiles.js), so they
 * survive redeploys and need no extra service or secret.
 *
 * The public URL did not change: /uploads/avatars/<userId>-<16 hex>.<jpg|png>. app.js serves it from
 * GridFS first and falls back to the old folder, so photos uploaded before this change still show
 * wherever the old files still exist (e.g. a local machine).
 */

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB
export const AVATAR_URL_PREFIX = '/uploads/avatars/';
export const AVATARS_BUCKET = 'avatars';

const AVATAR_FILENAME = /^[a-f0-9]{24}-[a-f0-9]{16}\.(jpg|png)$/;
const MIME_BY_EXT = { jpg: 'image/jpeg', png: 'image/png' };

const here = path.dirname(fileURLToPath(import.meta.url));

// Folder that held photos before they moved to GridFS. Only read (legacy files) and cleaned up now.
export function uploadRoot() {
  return path.resolve(process.env.UPLOAD_DIR || path.join(here, '..', '..', 'uploads'));
}

export function avatarDir() {
  return path.join(uploadRoot(), 'avatars');
}

// Decide the real image type from the file's first bytes. The client-sent filename and
// Content-Type header are not trusted. Returns { ext, mime } or null when it is not JPEG/PNG.
export function detectImageType(buffer) {
  if (!buffer || buffer.length < 8) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((byte, index) => buffer[index] === byte)) return { ext: 'png', mime: 'image/png' };
  return null;
}

// True only for names this code creates, so a URL can never point at anything else.
export function isAvatarFilename(name) {
  return typeof name === 'string' && AVATAR_FILENAME.test(name);
}

// "/uploads/avatars/<name>" -> "<name>", or null for anything else.
export function avatarFilenameFromUrl(avatarUrl) {
  if (typeof avatarUrl !== 'string' || !avatarUrl.startsWith(AVATAR_URL_PREFIX)) return null;
  const name = avatarUrl.slice(AVATAR_URL_PREFIX.length);
  return isAvatarFilename(name) ? name : null;
}

export function avatarMimeType(filename) {
  const ext = String(filename).split('.').pop();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

// Created on demand: the database connection opens after this module is loaded.
export function avatarsBucket() {
  const { db } = mongoose.connection;
  if (!db) {
    const error = new Error('Photo storage is not available right now. Please try again.');
    error.status = 503;
    throw error;
  }
  return new mongoose.mongo.GridFSBucket(db, { bucketName: AVATARS_BUCKET });
}

// Stores the photo in GridFS and resolves with its public URL.
export function saveAvatar(userId, buffer, ext) {
  const filename = `${userId}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  return new Promise((resolve, reject) => {
    let upload;
    try {
      upload = avatarsBucket().openUploadStream(filename, {
        metadata: { user: String(userId), contentType: MIME_BY_EXT[ext] || 'application/octet-stream' },
      });
    } catch (error) {
      reject(error);
      return;
    }
    upload.once('error', reject);
    upload.once('finish', () => resolve(`${AVATAR_URL_PREFIX}${filename}`));
    upload.end(buffer);
  });
}

// The stored photo for a filename (newest if somehow there are two), or null.
export async function findAvatar(filename) {
  if (!isAvatarFilename(filename)) return null;
  const [file] = await avatarsBucket().find({ filename }).sort({ uploadDate: -1 }).limit(1).toArray();
  return file || null;
}

export function openAvatar(fileId) {
  return avatarsBucket().openDownloadStream(fileId);
}

// Deletes a photo from GridFS and, for photos from before the move, from the old folder.
// Only ever acts on names this code creates, whatever string is stored on the user.
export async function removeAvatarFile(avatarUrl) {
  const filename = avatarFilenameFromUrl(avatarUrl);
  if (!filename) return;
  try {
    const bucket = avatarsBucket();
    const files = await bucket.find({ filename }).toArray();
    await Promise.all(files.map((file) => bucket.delete(file._id).catch(() => {})));
  } catch {
    // Storage unavailable: the user record is already updated; nothing else to do.
  }
  await fs.rm(path.join(avatarDir(), filename), { force: true }).catch(() => {});
}
