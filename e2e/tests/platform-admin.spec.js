// Sprint 6 · M8 (US-57, US-58, FR-27): the Platform Admin created from the server settings opens the Admin panel,
// makes a member a Content Moderator (their existing login gets moderator access on the next request) and takes it
// back, then suspends the member (their open session ends, login is refused) and reactivates them (login works).
// A normal user has no Admin panel link, and opening /admin directly says it is for Platform Admins only.
import { test, expect } from '@playwright/test';
import { logIn, signUp } from './helpers.js';
import { E2E_PLATFORM_ADMIN } from '../platformAdmin.js';

const API = `http://localhost:${process.env.E2E_API_PORT || 5000}/api`;

test('Platform Admin grants and revokes Content Moderator, suspends and reactivates an account', async ({ browser, request }) => {
  // A member signs up in their own browser and stays logged in there.
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  const account = await signUp(member);

  // No Admin panel for them: no link, and the page itself refuses (the API answers 403 too).
  await expect(member.getByRole('link', { name: 'Admin panel' })).toHaveCount(0);
  await member.goto('/admin');
  await expect(member.getByText('Only a Platform Admin can open the Admin panel.')).toBeVisible();

  // Back to the dashboard. Otherwise, when the suspension logs them out, the login page remembers /admin and
  // sends them back there after the final login (the app's normal "return to where you were" behaviour).
  await member.goto('/dashboard');

  // The member's login from another device, made BEFORE any change. US-57 says the change applies to its next request.
  const apiLogin = await request.post(`${API}/auth/login`, { data: { email: account.email, password: account.password } });
  expect(apiLogin.status()).toBe(200);
  const memberToken = (await apiLogin.json()).accessToken;
  const moderatorAccess = () => request.get(`${API}/moderation/access`, { headers: { Authorization: `Bearer ${memberToken}` } });
  expect((await moderatorAccess()).status()).toBe(403);

  // The Platform Admin from PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD logs in and opens the Admin panel.
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await logIn(admin, E2E_PLATFORM_ADMIN);
  await admin.getByRole('link', { name: 'Admin panel' }).click();
  await expect(admin).toHaveURL(/\/admin$/);
  await expect(admin.getByRole('heading', { level: 1, name: 'Admin panel' })).toBeVisible();

  await admin.getByRole('searchbox', { name: 'Search accounts' }).fill(account.email);
  await admin.getByRole('button', { name: 'Search', exact: true }).click();
  const row = admin.getByRole('listitem', { name: account.name });
  await expect(row.getByText('Member', { exact: true })).toBeVisible();
  await expect(row.getByText('Active', { exact: true })).toBeVisible();

  // US-57 AC1: grant. The member's existing login can use moderator routes on its next request.
  const moderatorSwitch = row.getByRole('switch', { name: `Content Moderator: ${account.name}` });
  await moderatorSwitch.click();
  await expect(admin.getByRole('status')).toHaveText(`${account.name} is now a Content Moderator.`);
  await expect(moderatorSwitch).toHaveAttribute('aria-checked', 'true');
  expect((await moderatorAccess()).status()).toBe(200);

  // Still there after a reload (saved on the server).
  await admin.reload();
  await admin.getByRole('searchbox', { name: 'Search accounts' }).fill(account.email);
  await admin.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(row.getByText('Content Moderator', { exact: true })).toBeVisible();

  // US-57 AC2: revoke. The next request is refused.
  await moderatorSwitch.click();
  await expect(admin.getByRole('status')).toHaveText(`${account.name} is no longer a Content Moderator.`);
  await expect(moderatorSwitch).toHaveAttribute('aria-checked', 'false');
  expect((await moderatorAccess()).status()).toBe(403);

  // US-58 AC1: suspend (asks first).
  await row.getByRole('button', { name: `Suspend ${account.name}` }).click();
  const dialog = admin.getByRole('alertdialog', { name: `Suspend ${account.name}?` });
  await dialog.getByRole('button', { name: 'Suspend account' }).click();
  await expect(admin.getByRole('status')).toHaveText(`${account.name} is suspended and has been logged out everywhere.`);
  await expect(row.getByText(/^Suspended since/)).toBeVisible();

  // Their sessions are over: the API login and the open browser are both logged out.
  expect((await moderatorAccess()).status()).toBe(401);
  await member.reload();
  await expect(member).toHaveURL(/\/login$/);

  // Logging in again is refused with a clear message.
  await member.getByLabel('Email address').fill(account.email);
  await member.getByLabel('Password').fill(account.password);
  await member.getByRole('button', { name: 'Log in to DevOrbit' }).click();
  await expect(member.getByRole('alert')).toHaveText('This account is suspended. Contact a Platform Admin to have it reactivated.');
  await expect(member).toHaveURL(/\/login$/);

  // US-58 AC2: reactivate, then the login succeeds.
  await row.getByRole('button', { name: `Reactivate ${account.name}` }).click();
  await expect(admin.getByRole('status')).toHaveText(`${account.name} is reactivated and can log in again.`);
  await expect(row.getByText('Active', { exact: true })).toBeVisible();
  await logIn(member, account);

  await adminContext.close();
  await memberContext.close();
});
