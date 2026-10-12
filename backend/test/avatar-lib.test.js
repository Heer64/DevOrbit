import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_AVATAR_BYTES, detectImageType } from '../src/lib/avatar.js';
import { jpegBytes, pngBytes } from './helpers.js';

test('JPEG and PNG are detected from file bytes', () => {
  assert.deepEqual(detectImageType(jpegBytes()), { ext: 'jpg', mime: 'image/jpeg' });
  assert.deepEqual(detectImageType(pngBytes()), { ext: 'png', mime: 'image/png' });
});

test('other formats are rejected even when they look like images', () => {
  assert.equal(detectImageType(Buffer.from('GIF89a......')), null);
  assert.equal(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(detectImageType(Buffer.from('RIFF....WEBPVP8 ')), null);
  assert.equal(detectImageType(Buffer.alloc(0)), null);
});

test('photo limit is exactly 2 MB', () => {
  assert.equal(MAX_AVATAR_BYTES, 2 * 1024 * 1024);
});
