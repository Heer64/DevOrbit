// [Sprint 4 · M5] Journey: upload a project file, see it listed, download it intact (US-37, FR-14a, NFR-8).
import { test, expect } from '@playwright/test';
import { createProject, signUp } from './helpers.js';

const openTab = (page, name) => page.locator('.project-tabs').getByRole('button', { name, exact: true }).click();

test('a member uploads a file, it is listed and downloads with the same content', async ({ page }) => {
  const me = await signUp(page);
  await createProject(page);
  await openTab(page, 'Files');
  await expect(page).toHaveURL(/tab=files/);
  await expect(page.getByText(/No files yet/)).toBeVisible();

  const content = 'Sprint 4 meeting notes\n- files are stored in MongoDB GridFS\n';
  await page.getByLabel('Choose a file to upload').setInputFiles({
    name: 'meeting-notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(content),
  });
  await expect(page.getByText('Uploaded "meeting-notes.txt".')).toBeVisible();

  const files = page.getByRole('list', { name: 'Files' });
  const row = files.getByRole('listitem').filter({ hasText: 'meeting-notes.txt' });
  await expect(row).toBeVisible();
  await expect(row).toContainText(me.name); // who uploaded it

  // Download through the signed-in API: same name, same bytes.
  const downloading = page.waitForEvent('download');
  await row.getByRole('button', { name: 'Download meeting-notes.txt' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('meeting-notes.txt');
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString('utf8')).toBe(content);

  // Saved on the server, not just in the page.
  await page.reload();
  await expect(page.getByRole('list', { name: 'Files' }).getByText('meeting-notes.txt')).toBeVisible();
});

test('a file over 10 MB is refused with the 10 MB message and nothing is added', async ({ page }) => {
  await signUp(page);
  await createProject(page);
  await openTab(page, 'Files');
  await expect(page.getByText(/No files yet/)).toBeVisible();

  await page.getByLabel('Choose a file to upload').setInputFiles({
    name: 'too-big.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 1), // 10 MB + 1 byte: just over the limit
  });
  await expect(page.getByText('This file is larger than the 10 MB limit. Files must be 10 MB or smaller.')).toBeVisible();
  await expect(page.getByText(/No files yet/)).toBeVisible();
});
