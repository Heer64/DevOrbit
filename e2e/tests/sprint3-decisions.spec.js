
import { test, expect } from '@playwright/test';
import { createProject, signUp, unique, dateInDays } from './helpers.js';

const openDecisions = async (page) => {
  await page.getByRole('button', { name: 'Decisions', exact: true }).click();
  await expect(page).toHaveURL(/tab=decisions/);
};

test('Sprint 3 M8: create and edit a decision', async ({ page }) => {
  const user = await signUp(page);
  await createProject(page);
  await openDecisions(page);

  const title = unique('Sprint 3 Decision');

  await page.getByRole('button', { name: 'Record decision' }).click();

  const form = page.locator('form.modal');
  await form.getByLabel('Title').fill(title);
  await form.getByLabel('Description').fill('Use MongoDB for storing project tasks.');
  await form.getByLabel('Date').fill(dateInDays(0));

  await form.getByRole('checkbox', { name: new RegExp(user.name) }).check();

  await form.getByRole('button', { name: 'Record decision' }).click();

  await expect(page.getByRole('status')).toContainText('Decision recorded.');

  const row = page.getByTestId('decision').filter({ hasText: title });
  await expect(row).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('decision').filter({ hasText: title })).toBeVisible();

  await page.getByRole('button', { name: `Edit ${title}` }).click();

  const editForm = page.locator('form.modal');
  await editForm.getByLabel('Description').fill('Updated decision after team discussion.');
  await editForm.getByRole('button', { name: 'Save changes' }).click();

  await expect(page.getByTestId('decision').filter({ hasText: title }))
    .toContainText('Updated decision after team discussion.');
});

test('Sprint 3 M8: required fields are validated', async ({ page }) => {
  await signUp(page);
  await createProject(page);
  await openDecisions(page);

  await page.getByRole('button', { name: 'Record decision' }).click();

  const form = page.locator('form.modal');
  await form.getByRole('button', { name: 'Record decision' }).click();

  await expect(form.getByRole('alert')).toContainText('Title is required.');
});
