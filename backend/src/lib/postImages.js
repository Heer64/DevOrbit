import mongoose from 'mongoose';

/*
 * [Sprint 5 · M6] Where post images are stored (US-50, NFR-8 persistent external storage).
 *
 * Same approach as project files (Sprint 4 · M5, lib/projectFiles.js) and profile photos:
 * the bytes go into MongoDB GridFS (collections "postImages.files" / "postImages.chunks"),
 * so they survive a Render redeploy and need no extra service, account or secret.
 * The rules (5 MB, JPEG/PNG/WebP) are in lib/postRules.js.
 */

export const POST_IMAGES_BUCKET = 'postImages';

// Created on demand because the database connection opens after this module is loaded.
export function postImagesBucket() {
  const { db } = mongoose.connection;
  if (!db) {
    const error = new Error('Image storage is not available right now. Please try again.');
    error.status = 503;
    throw error;
  }
  return new mongoose.mongo.GridFSBucket(db, { bucketName: POST_IMAGES_BUCKET });
}

// Writes the image and resolves with its GridFS id.
export function storePostImage({ buffer, type, userId }) {
  return new Promise((resolve, reject) => {
    let upload;
    try {
      upload = postImagesBucket().openUploadStream(`post-image.${type.ext}`, {
        metadata: { contentType: type.mime, user: String(userId) },
      });
    } catch (error) {
      reject(error);
      return;
    }
    upload.once('error', reject);
    upload.once('finish', () => resolve(upload.id));
    upload.end(buffer);
  });
}

// Removes an image. Never throws (already gone or storage unavailable: nothing else to do).
export async function deletePostImage(storageId) {
  if (!storageId) return;
  try {
    await postImagesBucket().delete(storageId);
  } catch {
    // ignore
  }
}

export async function postImageExists(storageId) {
  if (!storageId) return false;
  const found = await postImagesBucket().find({ _id: storageId }).limit(1).toArray();
  return found.length > 0;
}

export function openPostImage(storageId) {
  return postImagesBucket().openDownloadStream(storageId);
}

/*
 * ---------------------------------------------------------------------------
 * [Sprint 5 · M6] What this file does
 * Saves, reads and deletes post images in MongoDB GridFS (bucket "postImages"),
 * so images are kept in the database, not on the server's disk.
 * ---------------------------------------------------------------------------
 */
