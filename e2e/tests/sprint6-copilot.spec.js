// Sprint 6 M3/M4 / US-41, US-42, US-43: question limits and grounded empty-project response.
import { test, expect } from '@playwright/test';
import { createProject, signUp } from './helpers.js';

test('Sprint 6 M3: Copilot requires a nonempty question and limits input to 500 characters', async ({ page }) => {
  await signUp(page);
  await createProject(page);
  const panel = page.getByRole('region', { name: 'Ask the Copilot' });
  await expect(panel).toBeVisible();
  const input = panel.getByRole('textbox', { name: 'Your question' });
  const ask = panel.getByRole('button', { name: 'Ask', exact: true });
  await expect(ask).toBeDisabled();
  await input.fill('   ');
  await expect(ask).toBeDisabled();
  await input.fill('x'.repeat(500));
  await expect(input).toHaveValue('x'.repeat(500));
  await expect(panel.getByText('500 / 500')).toBeVisible();
  await expect(ask).toBeEnabled();
});

test('Sprint 6 M4: empty project gives a grounded insufficient-data response without AI credentials', async ({ page }) => {
  await signUp(page);
  await createProject(page);
  const panel = page.getByRole('region', { name: 'Ask the Copilot' });
  await panel.getByRole('textbox', { name: 'Your question' }).fill('Which tasks were completed yesterday?');
  await panel.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(panel.getByText('Not enough project data')).toBeVisible();
  await expect(panel.getByRole('list', { name: 'Sources' })).toHaveCount(0);
});
