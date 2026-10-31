// [Sprint 4 · M7] Journey: the project dashboard tab shows real numbers (US-39).
import { test, expect } from '@playwright/test';
import { addTask, createProject, dateInDays, signUp, unique } from './helpers.js';

test('project dashboard shows open tasks and tasks due in the next 7 days', async ({ page }) => {
  await signUp(page);
  await createProject(page);
  const soon = unique('Prepare demo');
  const later = unique('Plan next sprint');
  await addTask(page, { title: soon, dueDate: dateInDays(1) });
  await addTask(page, { title: later, dueDate: dateInDays(20) });

  await page.locator('.project-tabs').getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page).toHaveURL(/tab=dashboard/);

  const openTile = page.locator('.pd-stat', { hasText: 'Open tasks' });
  await expect(openTile.locator('.pd-stat-value')).toHaveText('2');

  const due = page.getByRole('region', { name: 'Due in the next 7 days' });
  await expect(due.getByText(soon)).toBeVisible();
  await expect(due.getByText(later)).toHaveCount(0); // 20 days away

  // No milestones yet: an empty state, not an error.
  await expect(page.getByRole('region', { name: 'Milestone progress' }).getByText(/No milestones yet/)).toBeVisible();

  // Clicking an upcoming task opens it in the Tasks tab.
  await due.getByRole('button', { name: `Open task ${soon}` }).click();
  await expect(page).toHaveURL(/tab=tasks&task=[a-f0-9]{24}/);
});
