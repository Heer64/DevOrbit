import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2 MB
export const AVATAR_URL_PREFIX = '/uploads/avatars/';

const here = path.dirname(fileURLToPath(import.meta.url));

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

export async function saveAvatar(userId, buffer, ext) {
  const dir = avatarDir();
  await fs.mkdir(dir, { recursive: true });
  const filename = `${userId}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  await fs.writeFile(path.join(dir, filename), buffer, { flag: 'wx' });
  return `${AVATAR_URL_PREFIX}${filename}`;
}

// Only ever deletes files inside the avatar directory, whatever string is stored on the user.
export async function removeAvatarFile(avatarUrl) {
  if (typeof avatarUrl !== 'string' || !avatarUrl.startsWith(AVATAR_URL_PREFIX)) return;
  const filename = path.basename(avatarUrl);
  if (filename !== avatarUrl.slice(AVATAR_URL_PREFIX.length)) return;
  await fs.rm(path.join(avatarDir(), filename), { force: true });
}
