// [Sprint 5 · M1] US-45 Browse and filter public projects, as a Visitor who is NOT logged in.
import { test, expect } from '@playwright/test';
import { createProject, signUp, unique } from './helpers.js';

test('a logged-out visitor browses, searches and filters public projects, never private ones', async ({ browser }) => {
  const word = unique('Visitorx').split(' ')[1]; // a word only this run uses
  const publicName = `Garden ${word}`;
  const privateName = `Secret ${word}`;

  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await signUp(owner);
  await createProject(owner, { name: publicName, visibility: 'Public', description: `Community gardening app ${word}` });
  await owner.goto('/dashboard');
  await createProject(owner, { name: privateName, visibility: 'Private', description: `Private notes ${word}` });

  // A brand-new browser with no account and no session.
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto('/discover');

  // AC1: Discover opens without logging in, in the public frame.
  await expect(visitor).toHaveURL(/\/discover/);
  await expect(visitor.getByRole('link', { name: 'Log in' })).toBeVisible();
  await expect(visitor.getByRole('link', { name: 'Sign up' })).toBeVisible();

  // AC3: keyword search (name or description).
  await visitor.getByRole('textbox', { name: 'Search projects' }).fill(word);
  await expect(visitor.getByRole('heading', { level: 3, name: publicName })).toBeVisible();
  await expect(visitor.getByRole('heading', { level: 3, name: privateName })).toHaveCount(0);
  await expect(visitor).toHaveURL(new RegExp(`q=${word}`));

  // AC2: status filter (a new project starts as Planning).
  await visitor.getByRole('combobox', { name: 'Filter by status' }).selectOption('Planning');
  await expect(visitor.getByRole('heading', { level: 3, name: publicName })).toBeVisible();
  await visitor.getByRole('combobox', { name: 'Filter by status' }).selectOption('Completed');
  await expect(visitor.getByText('No public projects match these filters.')).toBeVisible();
  await expect(visitor.getByRole('heading', { level: 3, name: publicName })).toHaveCount(0);
  await expect(visitor).toHaveURL(/status=Completed/);

  // Clear filters brings everything back.
  await visitor.getByRole('button', { name: 'Clear filters' }).first().click();
  await expect(visitor).not.toHaveURL(/status=/);

  // People search needs an account: a log-in prompt, not an error.
  await visitor.getByRole('button', { name: /^People/ }).click();
  await expect(visitor.getByText('Log in to meet collaborators')).toBeVisible();

  await ownerContext.close();
  await visitorContext.close();
});
