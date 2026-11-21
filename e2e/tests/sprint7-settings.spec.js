// [Sprint 7 · M5] Settings page: reachable from the sidebar and account menu; change password (old password
// required, other sessions logged out); privacy switches live here now; theme choice.
import { test, expect } from '@playwright/test';
import { logIn, signUp } from './helpers.js';

const NEW_PASSWORD = 'a brand new password 7';

test('Sprint 7 M5: Settings opens from the sidebar and from the account menu', async ({ page }) => {
  await signUp(page);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole('region', { name: 'Privacy settings' })).toBeVisible();

  // My profile no longer has the switches, only a pointer to Settings.
  await page.goto('/profile');
  await expect(page.getByRole('region', { name: 'Privacy settings' })).toHaveCount(0);
  await expect(page.getByText(/Privacy switches .* are in/)).toBeVisible();
});

test('Sprint 7 M5: changing the password needs the old one and signs out the other sessions', async ({ browser }) => {
  const thisBrowser = await browser.newContext();
  const otherBrowser = await browser.newContext();
  const page = await thisBrowser.newPage();
  const other = await otherBrowser.newPage();

  const account = await signUp(page);
  await logIn(other, account); // a second session of the same account

  await page.goto('/settings');
  const form = page.getByRole('region', { name: 'Change password' });

  // A wrong old password is refused, and this browser is NOT signed out by it.
  await form.getByLabel('Current password').fill('not my password');
  await form.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await form.getByLabel('Confirm new password').fill(NEW_PASSWORD);
  await form.getByRole('button', { name: 'Change password' }).click();
  await expect(form.getByRole('alert')).toHaveText('Your current password is not correct.');
  await expect(page).toHaveURL(/\/settings$/);

  // The right old password changes it.
  await form.getByLabel('Current password').fill(account.password);
  await form.getByRole('button', { name: 'Change password' }).click();
  await expect(form.getByRole('status')).toHaveText('Your password has been changed. 1 other session was signed out.');

  // This browser stays signed in, even after a reload.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

  // The other browser is signed out.
  await other.goto('/dashboard');
  await expect(other).toHaveURL(/\/login$/);

  // The old password no longer works; the new one does.
  await other.getByLabel('Email address').fill(account.email);
  await other.getByLabel('Password').fill(account.password);
  await other.getByRole('button', { name: 'Log in to DevOrbit' }).click();
  await expect(other).toHaveURL(/\/login$/);
  await logIn(other, { email: account.email, password: NEW_PASSWORD });

  await thisBrowser.close();
  await otherBrowser.close();
});

test('Sprint 7 M5: the theme choice applies at once and survives a reload', async ({ page }) => {
  await signUp(page);
  await page.goto('/settings');
  const theme = page.getByRole('radiogroup', { name: 'Theme' });
  await theme.getByRole('radio', { name: 'Light' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(theme.getByRole('radio', { name: 'Light' })).toBeChecked();
  await theme.getByRole('radio', { name: 'Dark' }).check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
