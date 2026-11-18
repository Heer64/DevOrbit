// Sprint 6 M1 / US-04: Password-reset entry and invalid-link safety checks.
import { test, expect } from '@playwright/test';

test('Sprint 6 M1: forgot-password entry validates the email field', async ({ page }) => {
  await page.goto('/forgot-password');
  const email = page.getByLabel('Email address');
  await expect(email).toBeVisible();
  await expect(email).toHaveAttribute('type', 'email');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  // Browser validation must prevent an empty request.
  expect(await email.evaluate((element) => element.validity.valueMissing)).toBe(true);
  await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
});

test('Sprint 6 M1: missing reset token cannot open a password form', async ({ page }) => {
  await page.goto('/reset-password');
  await expect(page.getByRole('alert')).toContainText(/reset link is invalid/i);
  await expect(page.getByRole('link', { name: 'Request a new link' })).toBeVisible();
  await expect(page.getByLabel('New password')).toHaveCount(0);
});
