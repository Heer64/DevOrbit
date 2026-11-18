// Sprint 5 M3/M4/M5: profile privacy, collaborator skill search, portfolio visibility.
import { test, expect } from '@playwright/test';
import { signUp, unique } from './helpers.js';

test('Sprint 5 M3/M5: privacy settings persist and control portfolio visibility', async ({ page }) => {
  await signUp(page);
  await page.goto('/profile');
  const privacy = page.getByRole('region', { name: 'Privacy settings' });
  const discoverable = privacy.getByRole('switch', { name: 'Appear in collaborator search' });
  const publicPortfolio = privacy.getByRole('switch', { name: 'Public portfolio' });
  await expect(discoverable).toBeVisible();
  await expect(publicPortfolio).toBeVisible();

  await discoverable.uncheck();
  await publicPortfolio.uncheck();
  await privacy.getByRole('button', { name: 'Save privacy settings' }).click();
  await expect(privacy.getByRole('status')).toHaveText('Privacy settings saved.');
  await page.reload();
  await expect(discoverable).not.toBeChecked();
  await expect(publicPortfolio).not.toBeChecked();
  await expect(page.getByRole('region', { name: 'My portfolio' }))
    .toContainText('Your portfolio is private');

  await discoverable.check();
  await publicPortfolio.check();
  await privacy.getByRole('button', { name: 'Save privacy settings' }).click();
  await expect(privacy.getByRole('status')).toHaveText('Privacy settings saved.');
  await page.reload();
  await expect(discoverable).toBeChecked();
  await expect(publicPortfolio).toBeChecked();
  await expect(page.getByRole('region', { name: 'My portfolio' }).getByRole('textbox', { name: 'Portfolio link' })).toBeVisible();
});

test('Sprint 5 M4: users can search for a collaborator using a saved skill', async ({ page }) => {
  const user = await signUp(page);
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Edit profile' }).click();
  const skill = unique('Playwright').replace(/\s+/g, '');
  await page.getByRole('textbox', { name: 'Add a skill tag' }).fill(skill);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();

  // The search UI accepts skill chips and offers an explicit reset control.
  await page.goto('/discover');
  await page.getByRole('button', { name: /^People/ }).click();
  const tags = page.getByRole('group', { name: 'Find people by skill tags' });
  await tags.getByRole('textbox', { name: 'Add a skill tag' }).fill(skill);
  await tags.getByRole('textbox', { name: 'Add a skill tag' }).press('Enter');
  await expect(tags.getByRole('button', { name: `Remove ${skill}` })).toBeVisible();
  await tags.getByRole('button', { name: 'Clear tags' }).click();
  await expect(tags.getByRole('button', { name: `Remove ${skill}` })).toHaveCount(0);
});
