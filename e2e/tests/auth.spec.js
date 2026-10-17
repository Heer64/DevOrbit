// Journey 1 (Sprint 1): sign up, log out, log back in, and pages stay protected.
import { test, expect } from '@playwright/test';
import { logIn, signUp } from './helpers.js';

test('a new user can sign up, log out and log back in', async ({ page }) => {
  const user = await signUp(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(user.firstName);

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);

  // Signed out: protected pages send you back to login.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);

  await logIn(page, user);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(user.firstName);

  // The session survives a page reload (refresh cookie).
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(user.firstName);
});

test('a wrong password shows an error and stays on the login page', async ({ page }) => {
  const user = await signUp(page);
  await page.getByRole('button', { name: 'Log out' }).click();

  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password').fill('definitely wrong password');
  await page.getByRole('button', { name: 'Log in to DevOrbit' }).click();

  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
