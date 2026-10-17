// Journey 3 (Sprint 2 leftovers): tasks show up on the dashboard (US-23, stat cards, My tasks).
import { test, expect } from '@playwright/test';
import { addTask, createProject, dateInDays, signUp, unique } from './helpers.js';

// The big number on a stat card.
const statValue = (page, title) => page.locator('.stat-card', { hasText: title }).locator('.stat-value b');

test('a task due tomorrow and assigned to me appears on the dashboard', async ({ page }) => {
  const user = await signUp(page);

  // A brand-new user sees empty task panels, not errors.
  await expect(page.getByRole('region', { name: 'Upcoming deadlines' }).getByText('Nothing due in the next 7 days.')).toBeVisible();
  await expect(statValue(page, 'Assigned to me')).toHaveText('0');

  const project = await createProject(page);
  const soon = unique('Prepare demo');
  const later = unique('Plan next sprint');
  await addTask(page, { title: soon, dueDate: dateInDays(1), assignToMe: true, ownerName: user.name });
  await addTask(page, { title: later, dueDate: dateInDays(20) });

  await page.goto('/dashboard');

  const deadlines = page.getByRole('region', { name: 'Upcoming deadlines' });
  await expect(deadlines.getByText(soon)).toBeVisible();
  await expect(deadlines.getByText('Due tomorrow')).toBeVisible();
  await expect(deadlines.getByText(later)).toHaveCount(0); // 20 days away: outside the 7-day window

  const myTasks = page.getByRole('region', { name: 'My tasks' });
  await expect(myTasks.getByText(soon)).toBeVisible();
  await expect(statValue(page, 'Assigned to me')).toHaveText('1');

  // Clicking a deadline opens its project.
  await deadlines.getByRole('button', { name: new RegExp(`Open ${soon}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/project/${project.id}$`));
});

test('completing a task updates the "Tasks completed" card', async ({ page }) => {
  await signUp(page);
  await createProject(page);
  const title = unique('Ship it');
  await addTask(page, { title });

  // The list view's status dot cycles To do -> In progress -> Blocked -> Done.
  const dot = page.locator('article.task-row', { hasText: title }).getByRole('button', { name: /^Status / });
  for (const next of ['In progress', 'Blocked', 'Done']) {
    await dot.click();
    await expect(page.locator('article.task-row', { hasText: title }).getByText(next, { exact: true })).toBeVisible();
  }

  await page.goto('/dashboard');
  await expect(statValue(page, 'Tasks completed')).toHaveText('1');
});
