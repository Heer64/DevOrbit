// [Sprint 5 · M2] US-46 View a public project page (Visitor) and US-47 Request to join a public project.
// Visitor opens the page logged out, is asked to log in to join, sends one request, the Owner sees it.
import { test, expect } from '@playwright/test';
import { createProject, signUp, unique } from './helpers.js';

test('a visitor reads a public project page, logs in to request to join, and the owner sees the request', async ({ browser }) => {
  const tag = unique('Pagex').split(' ')[1];
  const publicName = `Garden ${tag}`;
  const privateName = `Secret ${tag}`;

  // Owner makes one Public and one Private project.
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const ownerUser = await signUp(owner);
  const pub = await createProject(owner, { name: publicName, visibility: 'Public', description: 'Community gardening app' });
  await owner.goto('/dashboard');
  const priv = await createProject(owner, { name: privateName, visibility: 'Private' });

  // A second person signs up, then logs out to look around as a Visitor.
  const joinerContext = await browser.newContext();
  const joiner = await joinerContext.newPage();
  const joinerUser = await signUp(joiner);
  await joinerContext.clearCookies();

  // US-46 AC1: logged out, the public page shows name, description, domain, status and member names.
  await joiner.goto(`/discover/${pub.id}`);
  await expect(joiner.getByRole('heading', { level: 1, name: publicName })).toBeVisible();
  await expect(joiner.getByText('Community gardening app')).toBeVisible();
  await expect(joiner.getByTitle('Project status')).toBeVisible();
  await expect(joiner.getByTitle('Domain')).toBeVisible();
  await expect(joiner.getByRole('region', { name: 'Members' }).getByText(ownerUser.name)).toBeVisible();
  // US-46 AC2: no tasks, chat or files.
  await expect(joiner.getByText('Channels, messages, tasks and files are visible to project members only.')).toBeVisible();
  await expect(joiner.getByRole('button', { name: 'Tasks' })).toHaveCount(0);

  // A Private project has no public page.
  await joiner.goto(`/discover/${priv.id}`);
  await expect(joiner.getByRole('alert')).toHaveText('This project is not available.');
  await expect(joiner.getByText(privateName)).toHaveCount(0);

  // US-47 AC3: "Request to join" asks a logged-out visitor to log in first, then comes back.
  await joiner.goto(`/discover/${pub.id}`);
  await joiner.getByRole('link', { name: /Request to join/ }).click();
  await expect(joiner).toHaveURL(/\/login$/);
  await joiner.getByLabel('Email address').fill(joinerUser.email);
  await joiner.getByLabel('Password').fill(joinerUser.password);
  await joiner.getByRole('button', { name: 'Log in to DevOrbit' }).click();
  await expect(joiner).toHaveURL(new RegExp(`/discover/${pub.id}$`));

  // US-47 AC1: logged in, the request is sent with an optional message and shows as pending.
  await joiner.getByRole('textbox', { name: 'Message to the project team' }).fill('I can help with the UI');
  await joiner.getByRole('button', { name: 'Request to join' }).click();
  await expect(joiner.getByText('Pending', { exact: true })).toBeVisible();
  await expect(joiner.getByRole('button', { name: 'Request to join' })).toHaveCount(0);

  // A non-member opening the workspace link is sent to the public page (no tasks).
  await joiner.goto(`/project/${pub.id}`);
  await expect(joiner).toHaveURL(new RegExp(`/discover/${pub.id}$`));

  // The Owner sees the request in the workspace (Sprint 3 approve/reject flow).
  await owner.goto(`/project/${pub.id}`);
  await expect(owner.getByRole('button', { name: `Approve ${joinerUser.name}` })).toBeVisible();
  await owner.getByRole('button', { name: `Approve ${joinerUser.name}` }).click();

  // Now a member: the public page links to the workspace, and the name is listed.
  await joiner.goto(`/discover/${pub.id}`);
  await expect(joiner.getByRole('region', { name: 'Members' }).getByText(joinerUser.name)).toBeVisible();
  await joiner.getByRole('link', { name: /Open workspace/ }).click();
  await expect(joiner).toHaveURL(new RegExp(`/project/${pub.id}$`));
  await expect(joiner.getByRole('heading', { level: 1, name: publicName })).toBeVisible();

  await ownerContext.close();
  await joinerContext.close();
});

test('logged-in users open a Discover card on its public project page', async ({ page }) => {
  await signUp(page);
  const pub = await createProject(page, { name: unique('Card'), visibility: 'Public' });
  await page.goto(`/discover?q=${encodeURIComponent(pub.name)}`);
  await page.getByRole('button', { name: `View ${pub.name}` }).click();
  await expect(page).toHaveURL(new RegExp(`/discover/${pub.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: pub.name })).toBeVisible();
  await expect(page.getByRole('link', { name: /Open workspace/ })).toBeVisible();
});
