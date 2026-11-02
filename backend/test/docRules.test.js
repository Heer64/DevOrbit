// [Sprint 4 · M6] US-38: documentation page rules (no database needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOC_CONTENT_MAX,
  DOC_CONTENT_REQUIRED_MESSAGE,
  DOC_CONTENT_TOO_LONG_MESSAGE,
  DOC_TEXT_MESSAGE,
  DOC_TITLE_MAX,
  DOC_TITLE_REQUIRED_MESSAGE,
  DOC_TITLE_TOO_LONG_MESSAGE,
  docPreview,
  normalizeContent,
  readDocInput,
} from '../src/lib/docs.js';

test('a title and Markdown content are accepted; the title is trimmed, the content kept as written', () => {
  const content = '# Setup\n\n  Run `npm install`.\n';
  const result = readDocInput({ title: '  Getting   started ', content });
  assert.deepEqual(result, { ok: true, values: { title: 'Getting started', content } });
});

test('missing or blank fields are refused on create', () => {
  assert.deepEqual(readDocInput({ content: 'x' }), { ok: false, message: DOC_TITLE_REQUIRED_MESSAGE });
  assert.deepEqual(readDocInput({ title: '   ', content: 'x' }), { ok: false, message: DOC_TITLE_REQUIRED_MESSAGE });
  assert.deepEqual(readDocInput({ title: 'T' }), { ok: false, message: DOC_CONTENT_REQUIRED_MESSAGE });
  assert.deepEqual(readDocInput({ title: 'T', content: ' \n\t ' }), { ok: false, message: DOC_CONTENT_REQUIRED_MESSAGE });
  assert.deepEqual(readDocInput(null), { ok: false, message: DOC_TITLE_REQUIRED_MESSAGE });
  assert.deepEqual(readDocInput({ title: 5, content: 'x' }), { ok: false, message: DOC_TEXT_MESSAGE });
  assert.deepEqual(readDocInput({ title: 'T', content: ['x'] }), { ok: false, message: DOC_TEXT_MESSAGE });
});

test('exactly 10,000 characters of content is allowed, 10,001 is refused', () => {
  assert.equal(DOC_CONTENT_MAX, 10000);
  assert.equal(readDocInput({ title: 'T', content: 'a'.repeat(10000) }).ok, true);
  assert.deepEqual(readDocInput({ title: 'T', content: 'a'.repeat(10001) }), { ok: false, message: DOC_CONTENT_TOO_LONG_MESSAGE });
  assert.equal(DOC_CONTENT_TOO_LONG_MESSAGE, 'Content must be 10,000 characters or fewer.');
});

test('Windows line endings count as one character each', () => {
  assert.equal(normalizeContent('a\r\nb\rc\nd'), 'a\nb\nc\nd');
  // 5,000 lines of "a\r\n" is 15,000 characters as sent but 10,000 after normalizing -> allowed.
  const windows = 'a\r\n'.repeat(5000);
  const result = readDocInput({ title: 'T', content: windows });
  assert.equal(result.ok, true);
  assert.equal(result.values.content.length, 10000);
  assert.equal(result.values.content.includes('\r'), false);
  assert.equal(readDocInput({ title: 'T', content: `${windows}a` }).ok, false);
});

test('title limit is 120 characters', () => {
  assert.equal(readDocInput({ title: 't'.repeat(DOC_TITLE_MAX), content: 'x' }).ok, true);
  assert.deepEqual(readDocInput({ title: 't'.repeat(DOC_TITLE_MAX + 1), content: 'x' }), { ok: false, message: DOC_TITLE_TOO_LONG_MESSAGE });
});

test('edit (partial): only sent fields are read, but sent fields must be valid', () => {
  assert.deepEqual(readDocInput({}, { partial: true }), { ok: true, values: {} });
  assert.deepEqual(readDocInput({ title: 'New' }, { partial: true }), { ok: true, values: { title: 'New' } });
  assert.deepEqual(readDocInput({ content: 'Body' }, { partial: true }), { ok: true, values: { content: 'Body' } });
  assert.equal(readDocInput({ title: '' }, { partial: true }).message, DOC_TITLE_REQUIRED_MESSAGE);
  assert.equal(readDocInput({ content: 'a'.repeat(10001) }, { partial: true }).message, DOC_CONTENT_TOO_LONG_MESSAGE);
  assert.equal(readDocInput({ content: null }, { partial: true }).message, DOC_CONTENT_REQUIRED_MESSAGE);
});

test('HTML in the content is kept as plain text (the server never renders it)', () => {
  const content = '<script>alert(1)</script>\n<img src=x onerror=alert(1)>';
  assert.equal(readDocInput({ title: 'T', content }).values.content, content);
});

test('preview is plain text without Markdown symbols, cut to 160 characters', () => {
  assert.equal(
    docPreview('# Setup\n\n- Run **npm install** and `npm test`\n> see [the guide](https://x.dev)\n\n---\n```js\nconst a = 1;\n```'),
    'Setup Run npm install and npm test see the guide const a = 1;'
  );
  const long = docPreview('word '.repeat(100));
  assert.equal(long.length, 160);
  assert.ok(long.endsWith('…'));
  assert.equal(docPreview(''), '');
});
