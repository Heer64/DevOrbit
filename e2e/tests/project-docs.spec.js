// [Sprint 4 · M6] Journey: write a Markdown documentation page, read it formatted, edit it (US-38, FR-14b).
import { test, expect } from '@playwright/test';
import { createProject, signUp, unique } from './helpers.js';

const openTab = (page, name) => page.locator('.project-tabs').getByRole('button', { name, exact: true }).click();

test('create a documentation page, read it as formatted text, then edit it', async ({ page }) => {
  await signUp(page);
  await createProject(page);
  await openTab(page, 'Docs');
  await expect(page).toHaveURL(/tab=docs/);
  await expect(page.getByText(/No documentation yet/)).toBeVisible();

  const title = unique('Local setup');
  const content = [
    '# Getting started',
    '',
    'Run **npm install** in each folder.',
    '',
    '- Clone the repo',
    '- Copy backend/.env.example to backend/.env',
    '',
    '<script>window.docScriptRan = true</script>',
  ].join('\n');

  await page.getByRole('button', { name: 'New page', exact: true }).click();
  const form = page.getByRole('form', { name: 'New page' });
  await form.getByLabel('Title').fill(title);
  await form.getByLabel('Content (Markdown)').fill(content);
  await expect(page.getByTestId('doc-counter')).toHaveText(`${content.length} / 10,000`);

  // Preview shows formatted text before saving.
  await form.getByRole('tab', { name: 'Preview' }).click();
  await expect(page.getByTestId('doc-preview').getByRole('heading', { name: 'Getting started' })).toBeVisible();

  await form.getByRole('button', { name: 'Create page' }).click();
  await expect(page.getByText('Page created.')).toBeVisible();
  await expect(page).toHaveURL(/tab=docs&doc=[a-f0-9]{24}/);

  const article = page.getByRole('article', { name: title });
  await expect(article.getByRole('heading', { name: 'Getting started' })).toBeVisible();
  await expect(article.locator('strong', { hasText: 'npm install' })).toBeVisible();
  await expect(article.getByRole('listitem')).toHaveCount(2);
  // HTML in a page is shown as text and never runs.
  await expect(article.getByText('<script>window.docScriptRan = true</script>')).toBeVisible();
  expect(await page.evaluate(() => window.docScriptRan)).toBeUndefined();

  // Edit the title; the change is saved on the server.
  const newTitle = `${title} (v2)`;
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editForm = page.getByRole('form', { name: 'Edit page' });
  await editForm.getByLabel('Title').fill(newTitle);
  await editForm.getByRole('button', { name: 'Save page' }).click();
  await expect(page.getByText('Page saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('article', { name: newTitle })).toBeVisible();

  // Back to the list: the page is there.
  await page.getByRole('button', { name: 'All pages', exact: true }).click();
  await expect(page.getByTestId('doc-row').filter({ hasText: newTitle })).toBeVisible();
});

test('content over 10,000 characters cannot be saved', async ({ page }) => {
  await signUp(page);
  await createProject(page);
  await openTab(page, 'Docs');

  await page.getByRole('button', { name: 'New page', exact: true }).click();
  const form = page.getByRole('form', { name: 'New page' });
  await form.getByLabel('Title').fill('Too long');
  await form.getByLabel('Content (Markdown)').fill('a'.repeat(10_001)); // one character over the limit
  await expect(page.getByTestId('doc-counter')).toHaveText('10,001 / 10,000 — too long');
  await form.getByRole('button', { name: 'Create page' }).click();
  await expect(form.getByRole('alert')).toHaveText('Content must be 10,000 characters or fewer.');
  await expect(page.getByText('Page created.')).toHaveCount(0);
});
