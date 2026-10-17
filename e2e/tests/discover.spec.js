// Journey 4 (Sprint 2 leftovers): a Public project is discoverable by another user;
// a Private one is not. Uses two separate browser sessions.
import { test, expect } from '@playwright/test';
import { createProject, signUp, unique } from './helpers.js';

test('another user finds a Public project on Discover, but never a Private one', async ({ browser }) => {
  const tag = unique('Orbitx').split(' ')[1]; // a word only this run uses
  const publicName = `Garden ${tag}`;
  const privateName = `Secret ${tag}`;

  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const ownerUser = await signUp(owner);
  await createProject(owner, { name: publicName, visibility: 'Public', description: 'Community gardening app' });
  await owner.goto('/dashboard');
  await createProject(owner, { name: privateName, visibility: 'Private' });

  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await signUp(visitor);
  await visitor.goto('/discover');

  // Search is debounced and done by the API.
  await visitor.getByRole('textbox', { name: 'Search projects' }).fill(tag);
  await expect(visitor.getByRole('heading', { level: 3, name: publicName })).toBeVisible();
  await expect(visitor.getByRole('heading', { level: 3, name: privateName })).toHaveCount(0);

  // The owner shows up on the People tab.
  await visitor.getByRole('button', { name: /^People/ }).click();
  await visitor.getByRole('textbox', { name: 'Search people' }).fill(ownerUser.name);
  await expect(visitor.getByRole('heading', { level: 3, name: ownerUser.name })).toBeVisible();

  // Opening the Public project works for a non-member.
  await visitor.getByRole('button', { name: /^Projects/ }).click();
  await visitor.getByRole('textbox', { name: 'Search projects' }).fill(tag);
  await visitor.getByRole('button', { name: `View ${publicName}` }).click();
  await expect(visitor.getByRole('heading', { level: 1, name: publicName })).toBeVisible();

  await ownerContext.close();
  await visitorContext.close();
});
