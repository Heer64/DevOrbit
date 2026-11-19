
import { test, expect } from '@playwright/test';
import { signUp } from './helpers.js';

test('Sprint 3 M7 (US-30): notification bell displays empty state', async ({ page }) => {
  await signUp(page);

  // Open notification bell.
  const bell = page.getByRole('button', {
    name: 'Notifications',
    exact: true,
  });

  await expect(bell).toBeVisible();
  await bell.click();

  // Notifications dropdown should open.
  const list = page.getByRole('region', {
    name: 'Notifications list',
  });

  await expect(list).toBeVisible();

  // New account should not have notifications.
  await expect(
    list.getByText(/No notifications yet/i),
  ).toBeVisible();

  // Close with Escape.
  await page.keyboard.press('Escape');

  await expect(list).toBeHidden();
});
