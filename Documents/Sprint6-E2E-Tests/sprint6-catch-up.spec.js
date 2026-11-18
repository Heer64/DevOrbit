// Sprint 6 M5 / US-44: a new project's activity recap has no other-member events.
import { test, expect } from '@playwright/test';
import { createProject, signUp } from './helpers.js';

test('Sprint 6 M5: Catch Me Up says nothing new for a project with no other-member activity', async ({ page }) => {
  await signUp(page);
  await createProject(page);
  const panel = page.getByRole('region', { name: 'Catch Me Up' });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Catch me up', exact: true }).click();
  await expect(panel.locator('.catch-up-nothing')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Catch me up again' })).toBeEnabled();
});
